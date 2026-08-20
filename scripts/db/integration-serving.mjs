// Integration test - runs against a REAL mongod, started in-memory.
//
//   npm i --no-save mongodb-memory-server
//   node scripts/db/integration-serving.mjs
//
// Covers api/db.mjs, which replaced the deleted db/*.json tree. The properties
// here are the ones that keep the site working now that there is no file to
// fall back to: every public URL still resolves, the payloads keep the exact
// shape the old files had, and cache headers let the CDN absorb the read load
// that a free-tier cluster could not.

import mms from 'mongodb-memory-server';
const { MongoMemoryServer } = mms;
import fs from 'node:fs';

const M = (rel) => new URL(`../../${rel}`, import.meta.url).href;

let failures = 0;
const check = (l, c, d) => {
  if (c) console.log(`  PASS  ${l}`);
  else { failures++; console.log(`  FAIL  ${l}${d ? ` - ${d}` : ''}`); }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB = 'servingtest';

const { getDb, closeMongo } = await import(M('lib/db/mongo.mjs'));
const { ensureIndexes, COLLECTIONS } = await import(M('lib/db/collections.mjs'));
const db = await getDb();
await ensureIndexes(db);

// Seed one of each kind.
const tt = { ok: true, tt: { CS: { 1: { A: { Monday: [] } } } }, count: 0, generatedAt: 'x' };
await db.collection(COLLECTIONS.DOCUMENTS).insertOne({ _id: 'timetables/computing', kind: 'timetables', data: tt });
await db.collection(COLLECTIONS.DOCUMENTS).insertOne({ _id: 'seating/plan', kind: 'seating', data: { students: [{ nuid: '22I-0507', seat: 'C1R6' }] } });
await db.collection(COLLECTIONS.ROSTER_META).insertOne({ _id: '26', batch: '26', updated_at: 'u', source_subject: 's' });
await db.collection(COLLECTIONS.STUDENTS).insertOne({ _id: '26I-0001:CS:A', nuid: '26I-0001', name: 'A', section: 'A', department: 'CS', batch: '26' });
await db.collection(COLLECTIONS.LEADERBOARD).insertOne({ _id: 'compiler_run:26I-0001', game: 'compiler_run', nuid: '26I-0001', name: 'A', highScore: 42, achievedAt: new Date().toISOString() });

const handler = (await import(M('api/db.mjs'))).default;
const call = async (doc) => {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
  await handler({ method: 'GET', headers: {}, query: { doc } }, res);
  return res;
};

console.log('--- payload shapes match the deleted files ---');
let r = await call('timetables/computing');
check('timetable returns 200', r.statusCode === 200, `${r.statusCode}`);
check('timetable is byte-identical to what was stored',
  JSON.stringify(r.body) === JSON.stringify(tt), JSON.stringify(r.body)?.slice(0, 120));

r = await call('students/26');
check('roster returns the old file shape',
  r.statusCode === 200 && r.body.count === 1
    && r.body.students[0].nuid === '26I-0001'
    && 'updated_at' in r.body && 'source_subject' in r.body,
  JSON.stringify(r.body)?.slice(0, 160));

r = await call('leaderboards/compiler-run');
check('leaderboard returns { players, leaderboard }',
  r.statusCode === 200 && r.body.players?.['26I-0001']?.highScore === 42
    && r.body.leaderboard?.[0]?.highScore === 42,
  JSON.stringify(r.body)?.slice(0, 160));

r = await call('seating/plan');
check('seating plan round-trips', r.statusCode === 200 && r.body.students[0].seat === 'C1R6');

console.log('\n--- caching ---');
r = await call('timetables/computing');
check('timetables are edge-cached', /s-maxage=\d+/.test(r.headers['Cache-Control'] || ''),
  r.headers['Cache-Control']);
r = await call('leaderboards/compiler-run');
check('leaderboards are NOT cached (scores must be live)',
  r.headers['Cache-Control'] === 'no-store', r.headers['Cache-Control']);

console.log('\n--- errors ---');
r = await call('timetables/nonexistent');
check('unknown document is 404', r.statusCode === 404, `${r.statusCode}`);
r = await call('../../etc/passwd');
check('path traversal is rejected', r.statusCode === 400 || r.statusCode === 404, `${r.statusCode}`);
r = await call('exams/computing');
check('a known-but-absent document is 404, not an empty body',
  r.statusCode === 404, `${r.statusCode} ${JSON.stringify(r.body)}`);

console.log('\n--- every public URL in vercel.json resolves ---');
const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8'));
const docRoutes = vercel.rewrites.filter((x) => x.destination.startsWith('/api/db?doc='));
check('rewrites point at api/db', docRoutes.length > 0, `${docRoutes.length}`);
let unroutable = [];
for (const route of docRoutes) {
  const doc = decodeURIComponent(route.destination.split('doc=')[1]);
  const res = await call(doc);
  // 404 is fine (nothing seeded); 400/503 would mean the route is malformed.
  if (![200, 404].includes(res.statusCode)) unroutable.push(`${route.source} -> ${res.statusCode}`);
}
check('every rewrite maps to a dataset api/db understands',
  unroutable.length === 0, unroutable.join(', '));

console.log('\n--- no leftover references to the deleted tree ---');
check('db/ directory is gone', !fs.existsSync(new URL('../../db', import.meta.url)));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
await closeMongo();
await mongod.stop();
process.exit(failures ? 1 : 0);
