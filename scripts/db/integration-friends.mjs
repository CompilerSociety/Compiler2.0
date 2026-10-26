// Integration test for account-stored profiles and friendships - runs against
// a REAL mongod, started in-memory. Same setup as integration-accounts.mjs:
//
//   npm i --no-save mongodb-memory-server
//   node scripts/db/integration-friends.mjs
//
// The properties checked here are the privacy ones: a student's saved courses
// are readable only by themselves and by accepted friends, and every friendship
// transition can only be made by the side allowed to make it.

import mms from 'mongodb-memory-server';
const { MongoMemoryServer } = mms;

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
const { ensureIndexes } = await import(M('lib/db/collections.mjs'));
const { upsertVerifiedAccount } = await import(M('lib/db/repos.mjs'));
const { createSession, SESSION_COOKIE } = await import(M('lib/auth/session.mjs'));
const meH = (await import(M('api/auth/me.mjs'))).default;
const friendsH = (await import(M('api/friends.mjs'))).default;
await ensureIndexes(await getDb());

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

async function signIn(nuid) {
  await upsertVerifiedAccount(nuid, `${nuid}@example.test`);
  const token = await createSession(nuid, { headers: {} });
  return { cookie: `${SESSION_COOKIE}=${token}` };
}
const as = (who, req) => ({ ...req, headers: { ...(req.headers || {}), ...who } });
const friendsOf = (who) => call(friendsH, as(who, { method: 'GET' }));
const act = (who, action, nuid) => call(friendsH, as(who, { method: 'POST', body: { action, nuid } }));

const A = await signIn('25I-0001');
const B = await signIn('25I-0002');
const C = await signIn('25I-0003');

const profileA = {
  name: 'Student A', school: 'computing', department: 'BS CS', batch: '25', section: 'a',
  courses: [{ school: 'computing', dept: 'BS CS', batch: '2024', section: 'C', name: 'Data Structures' }],
  courseRemoved: ['Calculus'], coursePrefsRevision: 5,
};

console.log('--- profile save / restore ---');
let r = await call(meH, as(A, { method: 'GET' }));
check('fresh account has no saved profile', r.statusCode === 200 && r.body.account.saved.profile === null
  && r.body.account.saved.revision === 0, JSON.stringify(r.body));

r = await call(meH, as(A, { method: 'PUT', body: { revision: 0, profile: profileA, friends: [
  { nuid: '25i-0002', name: 'B', school: 'computing', department: 'BS CS', batch: '2025', section: 'B' },
  { nuid: '25I-0001', name: 'me', school: 'computing', department: 'BS CS', batch: '2025', section: 'A' },
] } }));
check('first save accepted at revision 0', r.statusCode === 200 && r.body.revision === 1, JSON.stringify(r.body));

r = await call(meH, as(A, { method: 'GET' }));
const saved = r.body.account.saved;
check('saved courses come back', saved.profile.courses.length === 1 && saved.profile.courses[0].name === 'Data Structures');
check('section normalised to upper case', saved.profile.section === 'A');
check('own NU ID dropped from friends, others normalised',
  saved.friends.length === 1 && saved.friends[0].nuid === '25I-0002', JSON.stringify(saved.friends));

r = await call(meH, as(A, { method: 'PUT', body: { revision: 0, profile: { ...profileA, section: 'C' } } }));
check('stale revision rejected with stored copy', r.statusCode === 409 && r.body.saved.profile.section === 'A',
  JSON.stringify(r.body));

r = await call(meH, as(A, { method: 'PUT', body: { revision: 1, profile: { ...profileA, courses: 'x' } } }));
check('malformed courses rejected', r.statusCode === 400);
r = await call(meH, as(A, { method: 'PUT', body: { revision: 1, profile: { ...profileA, name: 'x'.repeat(500) } } }));
check('oversized field rejected', r.statusCode === 400);
r = await call(meH, { method: 'PUT', body: { revision: 1, profile: profileA } });
check('save without a session is 401', r.statusCode === 401);
r = await call(meH, as(A, { method: 'PUT', headers: { origin: 'https://evil.example', host: 'vtable.site' },
  body: { revision: 1, profile: profileA } }));
check('cross-origin save rejected', r.statusCode === 403);

console.log('--- friendships ---');
r = await act(A, 'request', '25I-0001');
check('self request rejected', r.statusCode === 400 && r.body.error === 'self_request');

r = await act(A, 'request', '25I-0002');
check('A requests B', r.statusCode === 200 && r.body.status === 'pending');
r = await friendsOf(B);
check('B sees incoming request with A\'s saved name',
  r.body.incoming.length === 1 && r.body.incoming[0].nuid === '25I-0001' && r.body.incoming[0].name === 'Student A',
  JSON.stringify(r.body));
check('pending request exposes no courses to B', r.body.friends.length === 0);

r = await act(B, 'request', '25I-0001');
check('crossed request is not auto-accepted', r.statusCode === 409 && r.body.error === 'incoming_pending');
r = await act(A, 'accept', '25I-0002');
check('requester cannot accept own request', r.statusCode === 409);
r = await act(C, 'accept', '25I-0001');
check('a third account cannot accept it', r.statusCode === 409);

r = await act(B, 'accept', '25I-0001');
check('recipient accepts', r.statusCode === 200 && r.body.status === 'accepted');
r = await friendsOf(B);
const seenByB = r.body.friends.find(f => f.nuid === '25I-0001');
check('accepted friend sees courses', seenByB?.profile?.courses?.[0]?.name === 'Data Structures', JSON.stringify(r.body));
check('accepted friend does not see the address book', seenByB && !('friends' in seenByB.profile));

r = await friendsOf(C);
check('non-friend sees nothing of A', r.body.friends.length === 0 && r.body.incoming.length === 0);

console.log('--- decline / cancel / remove ---');
r = await act(C, 'request', '25I-0001');
r = await act(A, 'decline', '25I-0003');
check('A declines C', r.statusCode === 200 && r.body.status === 'declined');
r = await friendsOf(C);
check('decline still reads as pending to C', r.body.outgoing.some(o => o.nuid === '25I-0001'));
r = await act(C, 'request', '25I-0001');
check('C cannot re-send after decline', r.statusCode === 200 && r.body.status === 'pending');
r = await friendsOf(A);
check('declined request no longer in A\'s inbox', r.body.incoming.length === 0);
r = await act(C, 'cancel', '25I-0001');
check('C can withdraw', r.statusCode === 200);

r = await act(C, 'remove', '25I-0001');
check('remove needs an accepted friendship', r.statusCode === 409);
r = await act(B, 'remove', '25I-0001');
check('either side removes an accepted friendship', r.statusCode === 200);
r = await friendsOf(B);
check('removed friend stops seeing courses', r.body.friends.length === 0);

r = await call(friendsH, { method: 'GET' });
check('friends without a session is 401', r.statusCode === 401);

await closeMongo();
await mongod.stop();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
