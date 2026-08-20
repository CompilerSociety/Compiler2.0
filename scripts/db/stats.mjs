// scripts/db/stats.mjs
// What is actually in the database right now.
//
//   npm run db:stats
//
// Written for the question "is the data there?" - the one worth answering
// before blaming a deployment for showing nothing. It prints counts per
// collection plus the per-batch roster breakdown, since a missing roster is
// what makes the NU ID lookup come back empty.

import { getDb, closeMongo, isEnabled, dbName } from '../../lib/db/mongo.mjs';
import { COLLECTIONS, LEADERBOARD_FILES, DOCUMENT_FILES } from '../../lib/db/collections.mjs';

if (!isEnabled()) {
  console.error('MONGODB_URI is not set in this shell.');
  process.exit(1);
}

const db = await getDb();
console.log(`\nDatabase: ${dbName()}\n`);

const rows = [];
for (const [label, name] of Object.entries(COLLECTIONS)) {
  rows.push([label.toLowerCase(), name, await db.collection(name).countDocuments()]);
}
const w = Math.max(...rows.map((r) => r[1].length));
for (const [, name, count] of rows) {
  console.log(`  ${name.padEnd(w)}  ${String(count).padStart(6)}`);
}

// The roster is the one people actually notice missing: an absent batch makes
// the site answer a typed NU ID with nothing at all.
console.log('\nStudents per batch:');
const byBatch = await db.collection(COLLECTIONS.STUDENTS).aggregate([
  { $group: { _id: '$batch', n: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
if (!byBatch.length) {
  console.log('  (none — a typed NU ID will find nothing)');
} else {
  for (const b of byBatch) console.log(`  batch ${b._id}: ${b.n}`);
}

console.log('\nLeaderboards:');
for (const game of Object.keys(LEADERBOARD_FILES)) {
  const n = await db.collection(COLLECTIONS.LEADERBOARD).countDocuments({ game });
  const top = await db.collection(COLLECTIONS.LEADERBOARD)
    .find({ game }).sort({ highScore: -1 }).limit(1).toArray();
  console.log(`  ${game.padEnd(14)} ${String(n).padStart(4)} players` +
    (top[0] ? `, best ${top[0].highScore} (${top[0].nuid})` : ''));
}

// Which generated blobs are present, and which are still only in the repo.
console.log('\nGenerated documents:');
for (const id of Object.keys(DOCUMENT_FILES)) {
  const row = await db.collection(COLLECTIONS.DOCUMENTS)
    .findOne({ _id: id }, { projection: { updatedAt: 1, 'data.count': 1, 'data.generatedAt': 1 } });
  if (!row) {
    console.log(`  ${id.padEnd(30)} MISSING`);
  } else {
    const when = row.data?.generatedAt || row.updatedAt || '';
    const count = row.data?.count;
    console.log(`  ${id.padEnd(30)} ok` +
      (count !== undefined ? ` (${count} entries)` : '') +
      (when ? ` ${String(when).slice(0, 19)}` : ''));
  }
}

console.log();
await closeMongo();
