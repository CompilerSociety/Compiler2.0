// Integration test - runs against a REAL mongod, started in-memory.
//
// Needs a dev-only package that is deliberately NOT in package.json, because it
// downloads a ~780MB MongoDB binary on first use and no production build or
// deploy should ever pay that:
//
//   npm i --no-save mongodb-memory-server
//   node scripts/db/integration-leaderboard.mjs
//
// Everything here is a property the migration had to preserve, so if you change
// lib/db/ or the endpoints, run this.

// Default import, not a named one: the package is CommonJS, and the named
// form only resolves under some layouts.
import mms from 'mongodb-memory-server';
const { MongoMemoryServer } = mms;
const M = (rel) => new URL(`../../${rel}`, import.meta.url).href;

const REPO = new URL('../..', import.meta.url).pathname;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB = 'compiler2test';
console.log('mongod up at', process.env.MONGODB_URI);

const { getDb, closeMongo } = await import(M('lib/db/mongo.mjs'));
const { ensureIndexes, COLLECTIONS } = await import(M('lib/db/collections.mjs'));
const repos = await import(M('lib/db/repos.mjs'));

const db = await getDb();
await ensureIndexes(db);
console.log('\n--- indexes ---');
const idx = await db.collection(COLLECTIONS.LEADERBOARD).indexes();
check('game_rank index created', idx.some((i) => i.name === 'game_rank'));
const rlIdx = await db.collection(COLLECTIONS.RATE_LIMIT).indexes();
check('rate_limit TTL index created',
  rlIdx.some((i) => i.name === 'ttl_1h' && i.expireAfterSeconds === 3600));

// Seed a roster so identity checks pass.
await db.collection(COLLECTIONS.STUDENTS).insertOne({
  _id: '25I-0632', nuid: '25I-0632', name: 'Test Player', section: 'G',
  department: 'BS CS', batch: '25',
});

console.log('\n--- submitScore ---');
let r = await repos.submitScore('compiler_run', {
  nuid: '25I-0632', name: 'Test Player', section: 'G', department: 'BS CS', batch: '25', score: 500,
});
check('first score is improved', r.improved === true, JSON.stringify(r));
check('board now has the player', r.leaderboard[0]?.highScore === 500);

r = await repos.submitScore('compiler_run', {
  nuid: '25I-0632', name: 'Test Player', section: 'G', department: 'BS CS', batch: '25', score: 100,
});
check('LOWER score is not improved (dup-key path)', r.improved === false, JSON.stringify(r));
check('board still shows the high score', r.leaderboard[0]?.highScore === 500,
  JSON.stringify(r.leaderboard[0]));

r = await repos.submitScore('compiler_run', {
  nuid: '25I-0632', name: 'Test Player', section: 'G', department: 'BS CS', batch: '25', score: 500,
});
check('EQUAL score is not improved', r.improved === false, JSON.stringify(r));

r = await repos.submitScore('compiler_run', {
  nuid: '25I-0632', name: 'Test Player', section: 'G', department: 'BS CS', batch: '25', score: 900,
});
check('HIGHER score is improved', r.improved === true, JSON.stringify(r));
check('board reflects the new best', r.leaderboard[0]?.highScore === 900);

console.log('\n--- concurrency (the race the old file-write had) ---');
const results = await Promise.all([300, 1500, 700, 1200, 400].map((score, i) =>
  repos.submitScore('duck_hunter', {
    nuid: '25I-0632', name: 'Test Player', section: 'G', department: 'BS CS', batch: '25', score,
  }).catch((e) => ({ error: e.message }))));
check('no concurrent submission errored', results.every((x) => !x.error),
  JSON.stringify(results.filter((x) => x.error)));
const duck = await repos.topScores('duck_hunter');
check('highest concurrent score won', duck[0]?.highScore === 1500, JSON.stringify(duck[0]));
check('exactly one row per player per game', duck.length === 1, `got ${duck.length}`);

console.log('\n--- ranking / tie-break ---');
const now = Date.now();
await db.collection(COLLECTIONS.LEADERBOARD).insertMany([
  { _id: 'flappy_bird:A', game: 'flappy_bird', nuid: 'A', highScore: 50, achievedAt: new Date(now).toISOString() },
  { _id: 'flappy_bird:B', game: 'flappy_bird', nuid: 'B', highScore: 50, achievedAt: new Date(now - 60000).toISOString() },
  { _id: 'flappy_bird:C', game: 'flappy_bird', nuid: 'C', highScore: 80, achievedAt: new Date(now).toISOString() },
]);
const flap = await repos.topScores('flappy_bird');
check('sorted by score desc', flap[0].nuid === 'C', JSON.stringify(flap.map((f) => f.nuid)));
check('tie broken by earliest achiever', flap[1].nuid === 'B',
  JSON.stringify(flap.map((f) => `${f.nuid}:${f.highScore}`)));
check('top-10 cap respected', flap.length <= 10);

console.log('\n--- roster ---');
check('known student found', (await repos.rosterHas('25', '25I-0632')) === true);
check('unknown student in a known batch rejected',
  (await repos.rosterHas('25', '25I-9999')) === false);
check('unknown batch reported distinctly',
  (await repos.rosterHas('99', '99I-0001')) === 'unknown_batch');

console.log('\n--- rate limiting ---');
check('fresh IP is not limited', (await repos.rateLimitCheck('1.2.3.4')) === null);
for (let i = 0; i < 10; i++) await repos.rateLimitNote('1.2.3.4');
const wait = await repos.rateLimitCheck('1.2.3.4');
check('IP is limited after 10 writes', typeof wait === 'number' && wait > 0, `got ${wait}`);
check('a different IP is unaffected', (await repos.rateLimitCheck('5.6.7.8')) === null);

console.log('\n--- documents round-trip ---');
const payload = { ok: true, tt: { CS: { 1: {} } }, count: 0, generatedAt: 'x' };
await repos.putDocument('timetables/computing', payload);
const back = await repos.getDocument('timetables/computing');
check('document round-trips byte-identically',
  JSON.stringify(back) === JSON.stringify(payload), JSON.stringify(back));

console.log('\n--- subscriptions ---');
await repos.upsertSubscription({ nuid: '25I-0632', subscription: { endpoint: 'https://x.example/1' } });
await repos.upsertSubscription({ nuid: '25I-0632', name: 'renamed', subscription: { endpoint: 'https://x.example/1' } });
let subs = await repos.listSubscriptions();
check('re-subscribing the same endpoint does not duplicate', subs.length === 1, `got ${subs.length}`);
check('re-subscribing updates the record', subs[0]?.name === 'renamed');
await repos.removeSubscription('https://x.example/1');
subs = await repos.listSubscriptions();
check('removal works', subs.length === 0, `got ${subs.length}`);

console.log('\n--- endpoint through the real handler ---');
const handler = (await import(M('api/leaderboard.js'))).default;
const res = {
  statusCode: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(p) { this.body = p; return this; },
  end() { return this; },
};
await handler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, query: {},
  body: { game: 'compiler_run', nuid: '25I-0632', name: 'Test Player', score: 12345 } }, res);
check('handler POST returns 200', res.statusCode === 200, `${res.statusCode} ${JSON.stringify(res.body)}`);
check('handler reports improved', res.body?.improved === true, JSON.stringify(res.body));
check('handler returns the updated board', res.body?.leaderboard?.[0]?.highScore === 12345);

const res2 = { ...res, statusCode: null, body: null };
await handler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, query: {},
  body: { nuid: '99I-0001', score: 10 } }, res2);
check('handler rejects an off-roster NU ID', res2.statusCode === 403,
  `${res2.statusCode} ${JSON.stringify(res2.body)}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll live checks passed.');
await closeMongo();
await mongod.stop();
process.exit(failures ? 1 : 0);
