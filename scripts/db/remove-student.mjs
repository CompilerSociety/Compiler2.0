// scripts/db/remove-student.mjs
// Removes every roster row for one NU ID, and anything keyed to it.
//
//   node scripts/db/remove-student.mjs 25I-0000            # show what would go
//   node scripts/db/remove-student.mjs 25I-0000 --confirm  # actually delete
//
// Deliberately dry by default. This is the only script in here that destroys
// data, and the roster is the one collection where a wrong argument is not
// recoverable from a backup without a restore.
//
// A student can hold SEVERAL roster rows - one per department/section they are
// enrolled in - so this matches on the nuid field rather than on _id.

import { getDb, closeMongo, isEnabled, dbName } from '../../lib/db/mongo.mjs';
import { COLLECTIONS } from '../../lib/db/collections.mjs';

const nuid = (process.argv[2] || '').trim().toUpperCase();
const confirmed = process.argv.includes('--confirm');

if (!nuid) {
  console.error('Usage: node scripts/db/remove-student.mjs <NUID> [--confirm]');
  process.exit(1);
}
if (!isEnabled()) {
  console.error('MONGODB_URI is not set in this shell.');
  process.exit(1);
}

const db = await getDb();
console.log(`\nDatabase: ${dbName()}   NU ID: ${nuid}\n`);

const students = await db.collection(COLLECTIONS.STUDENTS).find({ nuid }).toArray();
const scores = await db.collection(COLLECTIONS.LEADERBOARD).find({ nuid }).toArray();
const subs = await db.collection(COLLECTIONS.SUBSCRIPTIONS).find({ nuid }).toArray();

console.log(`  roster rows        ${students.length}`);
for (const s of students) console.log(`      ${s._id}  ${s.name ?? ''} (${s.department ?? '-'}/${s.section ?? '-'})`);
console.log(`  leaderboard rows   ${scores.length}`);
for (const s of scores) console.log(`      ${s._id}  ${s.highScore}`);
console.log(`  subscriptions      ${subs.length}`);
for (const s of subs) console.log(`      ${s._id?.slice(0, 60)}...`);

const total = students.length + scores.length + subs.length;
if (!total) {
  console.log('\nNothing found for that NU ID — already gone.');
  await closeMongo();
  process.exit(0);
}

if (!confirmed) {
  console.log(`\nDRY RUN — ${total} document(s) would be deleted.`);
  console.log('Re-run with --confirm to delete them.');
  await closeMongo();
  process.exit(0);
}

const r1 = await db.collection(COLLECTIONS.STUDENTS).deleteMany({ nuid });
const r2 = await db.collection(COLLECTIONS.LEADERBOARD).deleteMany({ nuid });
const r3 = await db.collection(COLLECTIONS.SUBSCRIPTIONS).deleteMany({ nuid });
console.log(`\nDeleted ${r1.deletedCount} roster, ${r2.deletedCount} leaderboard, `
  + `${r3.deletedCount} subscription document(s).`);
await closeMongo();
