// Integration test - runs against a REAL mongod, started in-memory.
//
// Needs a dev-only package that is deliberately NOT in package.json, because it
// downloads a ~780MB MongoDB binary on first use and no production build or
// deploy should ever pay that:
//
//   npm i --no-save mongodb-memory-server
//   node scripts/db/integration-accounts.mjs
//
// Everything here is a property the migration had to preserve, so if you change
// lib/db/ or the endpoints, run this.

// Default import, not a named one: the package is CommonJS, and the named
// form only resolves under some layouts.
import mms from 'mongodb-memory-server';
const { MongoMemoryServer } = mms;

const REPO = new URL('../..', import.meta.url).pathname;
const M = (rel) => new URL(`../../${rel}`, import.meta.url).href;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB = 'compiler2test';

const { getDb, closeMongo } = await import(M('lib/db/mongo.mjs'));
const { ensureIndexes, COLLECTIONS } = await import(M('lib/db/collections.mjs'));
const db = await getDb();
await ensureIndexes(db);

const registerH = (await import(M('api/register.mjs'))).default;
const subscribeH = (await import(M('api/subscribe.mjs'))).default;

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
}
async function call(h, req) {
  const res = mkRes();
  await h({ headers: {}, query: {}, ...req }, res);
  return res;
}

const ip = (v) => ({ 'x-forwarded-for': v });

console.log('--- register ---');
let r = await call(registerH, {
  method: 'POST', headers: ip('10.0.0.1'),
  body: { nuid: '26I-1234', name: 'New Student', department: 'CS', section: 'A' },
});
check('registers a new student', r.statusCode === 200 && r.body?.added === true,
  `${r.statusCode} ${JSON.stringify(r.body)}`);
check('batch derived from the roll no, not the payload', r.body?.batch === '26');

const stored = await db.collection(COLLECTIONS.STUDENTS).findOne({ nuid: '26I-1234' });
check('row has seating-plan shape', stored?.seat === '' && stored?.self_registered === true,
  JSON.stringify(stored));

r = await call(registerH, {
  method: 'POST', headers: ip('10.0.0.2'),
  body: { nuid: '26I-1234', name: 'IMPOSTER', department: 'XX', section: 'Z' },
});
check('re-registering is a success, not an error', r.statusCode === 200, `${r.statusCode}`);
check('re-registering reports added:false', r.body?.added === false, JSON.stringify(r.body));
const after = await db.collection(COLLECTIONS.STUDENTS).findOne({ nuid: '26I-1234' });
check('APPEND-ONLY: existing row was NOT overwritten', after?.name === 'New Student',
  `name is now ${after?.name}`);
const rows = await db.collection(COLLECTIONS.STUDENTS).countDocuments({ nuid: '26I-1234' });
check('re-registering with a different section adds no second row', rows === 1, `rows=${rows}`);

r = await call(registerH, { method: 'POST', headers: ip('10.0.0.3'), body: { nuid: 'garbage', name: 'x', department: 'y', section: 'z' } });
check('malformed roll no rejected', r.statusCode === 400 && r.body?.error === 'invalid_nuid',
  `${r.statusCode} ${JSON.stringify(r.body)}`);

r = await call(registerH, { method: 'POST', headers: ip('10.0.0.4'), body: { nuid: '26I-5555' } });
check('incomplete profile rejected', r.statusCode === 400 && r.body?.error === 'incomplete_profile',
  `${r.statusCode} ${JSON.stringify(r.body)}`);

console.log('\n--- register rate limit ---');
let limited = false;
for (let i = 0; i < 12; i++) {
  const rr = await call(registerH, {
    method: 'POST', headers: ip('10.9.9.9'),
    body: { nuid: `26I-${String(2000 + i).padStart(4, '0')}`, name: 'n', department: 'CS', section: 'A' },
  });
  if (rr.statusCode === 429) { limited = true; break; }
}
check('a hammering IP gets 429', limited);

console.log('\n--- subscribe ---');
const sub = (endpoint) => ({
  endpoint,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
});
r = await call(subscribeH, {
  method: 'POST', headers: ip('10.0.1.1'),
  body: {
    nuid: '26I-1234', name: 'New Student', department: 'CS', batch: '26', section: 'A',
    subscription: sub('https://fcm.googleapis.com/fcm/send/abc123'),
    prefs: { cls: true, exam: false },
  },
});
check('subscribes successfully', r.statusCode === 200 && r.body?.ok === true,
  `${r.statusCode} ${JSON.stringify(r.body)}`);

// Re-subscribe with NO prefs: the stored choice must survive.
r = await call(subscribeH, {
  method: 'POST', headers: ip('10.0.1.2'),
  body: {
    nuid: '26I-1234', name: 'New Student', department: 'CS', batch: '26', section: 'A',
    subscription: sub('https://fcm.googleapis.com/fcm/send/abc123'),
  },
});
check('re-subscribing succeeds', r.statusCode === 200, `${r.statusCode} ${JSON.stringify(r.body)}`);
check('re-subscribing does not duplicate', r.body?.count === 1, `count=${r.body?.count}`);
const subDoc = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
  .findOne({ _id: 'https://fcm.googleapis.com/fcm/send/abc123' });
check('existing prefs survive a prefs-less re-subscribe',
  subDoc?.prefs?.cls === true && subDoc?.prefs?.exam === false, JSON.stringify(subDoc?.prefs));

r = await call(subscribeH, {
  method: 'POST', headers: ip('10.0.1.3'),
  body: { nuid: '26I-1234', subscription: { endpoint: 'http://evil.example/x' } },
});
check('non-push endpoint rejected', r.statusCode === 400, `${r.statusCode} ${JSON.stringify(r.body)}`);

console.log('\n--- subscribe enrols an unknown student ---');
r = await call(subscribeH, {
  method: 'POST', headers: ip('10.0.2.1'),
  body: {
    nuid: '27I-0001', name: 'Fresh Intake', department: 'CS', batch: '27', section: 'B',
    subscription: sub('https://fcm.googleapis.com/fcm/send/newguy'),
  },
});
check('unknown batch still subscribes', r.statusCode === 200, `${r.statusCode} ${JSON.stringify(r.body)}`);
const enrolled = await db.collection(COLLECTIONS.STUDENTS).findOne({ nuid: '27I-0001' });
check('and enrols them onto the roster', Boolean(enrolled), JSON.stringify(enrolled));

console.log('\n--- FSE / FSM students are never stored ---');
// The rule: only School of Computing students exist server-side, because only
// they are ever notified. FSE and FSM keep their profile in a cookie.
for (const [label, dept, id] of [['engineering', 'EE', '25I-7001'], ['business', 'FT', '25I-7002']]) {
  r = await call(registerH, {
    method: 'POST', headers: ip('10.5.0.' + id.slice(-1)),
    body: { nuid: id, name: 'Should Not Persist', department: dept, section: 'A' },
  });
  check(label + ' register returns 200 (not an error for the user)',
    r.statusCode === 200, `${r.statusCode} ${JSON.stringify(r.body)}`);
  check(label + ' register reports it did not store',
    r.body?.stored === false && r.body?.added === false, JSON.stringify(r.body));
  const rows = await db.collection(COLLECTIONS.STUDENTS).countDocuments({ nuid: id });
  check(label + ' student is NOT in the roster', rows === 0, `found ${rows} row(s)`);

  const endpoint = 'https://fcm.googleapis.com/fcm/send/' + label;
  r = await call(subscribeH, {
    method: 'POST', headers: ip('10.5.1.' + id.slice(-1)),
    body: {
      nuid: id, name: 'Should Not Persist', department: dept, batch: '25', section: 'A',
      subscription: sub(endpoint),
    },
  });
  check(label + ' subscribe returns 200', r.statusCode === 200, `${r.statusCode}`);
  check(label + ' subscribe reports it did not store', r.body?.stored === false,
    JSON.stringify(r.body));
  const subRows = await db.collection(COLLECTIONS.SUBSCRIPTIONS).countDocuments({ _id: endpoint });
  check(label + ' subscription is NOT stored', subRows === 0, `found ${subRows}`);
  const enrolled = await db.collection(COLLECTIONS.STUDENTS).countDocuments({ nuid: id });
  check(label + ' subscribe did not enrol them either', enrolled === 0, `found ${enrolled}`);
}

// The rule must not catch computing students, including PCS - which was missing
// from the department list and would otherwise have been silently excluded.
for (const [dept, id] of [['CS', '25I-7010'], ['PCS', '25I-7011'], ['BS AI', '25I-7012']]) {
  r = await call(registerH, {
    method: 'POST', headers: ip('10.5.2.9'),
    body: { nuid: id, name: 'Computing Student', department: dept, section: 'A' },
  });
  const rows = await db.collection(COLLECTIONS.STUDENTS).countDocuments({ nuid: id });
  check('computing dept "' + dept + '" IS stored', rows === 1,
    `${r.statusCode} rows=${rows} ${JSON.stringify(r.body)}`);
}

console.log('\n--- unsubscribe ---');
r = await call(subscribeH, {
  method: 'DELETE', headers: ip('10.0.3.1'),
  body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' },
});
check('unsubscribes', r.statusCode === 200 && r.body?.removed === 1,
  `${r.statusCode} ${JSON.stringify(r.body)}`);
r = await call(subscribeH, {
  method: 'DELETE', headers: ip('10.0.3.2'),
  body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' },
});
check('unsubscribing twice is still a success', r.statusCode === 200 && r.body?.removed === 0,
  `${r.statusCode} ${JSON.stringify(r.body)}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
await closeMongo();
await mongod.stop();
process.exit(failures ? 1 : 0);
