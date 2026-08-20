// scripts/db/export-to-json.mjs
// Dumps MongoDB back out as the db/*.json tree it replaced.
//
//   node scripts/db/export-to-json.mjs --out backup/
//
// This is a BACKUP tool, not part of serving the site. db/ was deleted and
// Mongo is the only store, so nothing reads its output at runtime.
//
// It exists because an Atlas M0 free cluster has NO automated backups, and
// deleting the committed JSON removed the only other copy of this data. The
// scheduled workflow runs this and uploads the result as a GitHub Actions
// artifact - a real backup, retained without putting a single commit back into
// the repo. To restore, unpack an artifact and run scripts/db/migrate-to-mongo.mjs
// against it.
//
// Output is deterministic (explicit sorts everywhere), so two backups of
// unchanged data are byte-identical and easy to diff.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeMongo, isEnabled } from '../../lib/db/mongo.mjs';
import {
  COLLECTIONS, DOCUMENT_FILES, NOTIFY_STATE_FILES, LEADERBOARD_FILES,
} from '../../lib/db/collections.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK_ONLY = process.argv.includes('--check');

// --out <dir> writes the dump somewhere other than the repo. Without it the
// output lands in the working directory, which for a backup run is a scratch
// dir the workflow then uploads.
const outFlag = process.argv.indexOf('--out');
const ROOT = outFlag !== -1 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : REPO_ROOT;

const MAX_ENTRIES = 10; // top-N cached into each leaderboard file

let changed = 0;
let unchanged = 0;

// Matches the indentation these files were committed with, so one backup
// diffs cleanly against an older one.
const INDENT = 2;

function writeJson(rel, value) {
  const abs = path.join(ROOT, rel);
  const text = JSON.stringify(value, null, INDENT) + '\n';
  const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
  if (existing === text) {
    unchanged += 1;
    return;
  }
  changed += 1;
  if (CHECK_ONLY) {
    console.log(`  would update ${rel}`);
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  console.log(`  wrote ${rel}`);
}

// Rebuilds { players: {...}, leaderboard: [...] } for each game. The stored
// `leaderboard` array is a derived top-10 cache; it is recomputed here from the
// same sort the API serves, so the file and the live API can never disagree.
async function exportLeaderboards(db) {
  for (const [game, file] of Object.entries(LEADERBOARD_FILES)) {
    const rows = await db.collection(COLLECTIONS.LEADERBOARD)
      .find({ game }, { projection: { _id: 0, game: 0, migratedAt: 0 } })
      .sort({ highScore: -1, achievedAt: 1 })
      .toArray();

    const leaderboard = rows.slice(0, MAX_ENTRIES);
    // Players are keyed by NU ID and written in sorted key order for a stable
    // diff, independent of the rank order above.
    const byNuid = new Map(rows.map((r) => [r.nuid, r]));
    const players = {};
    for (const nuid of [...byNuid.keys()].sort()) {
      players[nuid] = byNuid.get(nuid);
    }
    writeJson(file, { players, leaderboard });
  }
}

async function exportRateLimit(db) {
  const rows = await db.collection(COLLECTIONS.RATE_LIMIT)
    .find({}, { projection: { hits: 1 } }).sort({ _id: 1 }).toArray();
  const out = {};
  for (const r of rows) out[r._id] = r.hits || [];
  writeJson('db/metadata/rate-limit.json', out);
}

async function exportSubscriptions(db) {
  const rows = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
    .find({}, { projection: { _id: 0, migratedAt: 0 } }).sort({ _id: 1 }).toArray();
  // Rebuilt as the array the send-*-push.mjs scripts expect, with null-valued
  // optional fields dropped so the file matches what subscribe.js used to write
  // rather than gaining a wall of `"prefs": null`.
  const out = rows.map((r) => {
    const entry = {};
    for (const [k, v] of Object.entries(r)) {
      if (v !== null && v !== undefined) entry[k] = v;
    }
    return entry;
  });
  writeJson('db/metadata/notifications/push-subscriptions.json', out);
}

async function exportNotifyState(db) {
  for (const [kind, file] of Object.entries(NOTIFY_STATE_FILES)) {
    const rows = await db.collection(COLLECTIONS.NOTIFY_STATE)
      .find({ kind }, { projection: { key: 1, value: 1 } }).sort({ key: 1 }).toArray();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    writeJson(file, out);
  }
}

async function exportStudents(db) {
  const metas = await db.collection(COLLECTIONS.ROSTER_META)
    .find({}).sort({ _id: 1 }).toArray();
  for (const meta of metas) {
    // Sorted by _id, not by nuid: a student enrolled in two departments has a
    // row for each, and only the composite _id orders those two deterministically.
    const students = await db.collection(COLLECTIONS.STUDENTS)
      .find({ batch: meta.batch }, { projection: { batch: 0, migratedAt: 0 } })
      .sort({ _id: 1 })
      .toArray();
    // Field order matters for the diff, and `count` is recomputed rather than
    // trusted: the stored meta can lag behind a registration that added a row.
    writeJson(`db/students/${meta.batch}.json`, {
      updated_at: meta.updated_at ?? '',
      source_subject: meta.source_subject ?? '',
      count: students.length,
      students: students.map((s) => ({
        name: s.name,
        nuid: s.nuid,
        section: s.section,
        department: s.department,
        batch: meta.batch,
      })),
    });
  }
}

async function exportDocuments(db) {
  const rows = await db.collection(COLLECTIONS.DOCUMENTS).find({}).toArray();
  const byId = new Map(rows.map((r) => [r._id, r]));
  for (const [id, file] of Object.entries(DOCUMENT_FILES)) {
    const row = byId.get(id);
    if (!row) {
      // Absent in Mongo means the generator has not run since the migration.
      // Leaving the committed copy untouched is strictly safer than writing an
      // empty file over a working timetable.
      console.warn(`  (no document "${id}" in Mongo - leaving ${file} as is)`);
      continue;
    }
    writeJson(file, row.data);
  }
}

async function main() {
  if (!isEnabled()) {
    console.error('MONGODB_URI is not set - cannot export.');
    process.exit(1);
  }
  const db = await getDb();
  console.log(CHECK_ONLY ? 'Checking db/ mirror against Mongo...' : 'Exporting Mongo to db/...');
  await exportLeaderboards(db);
  await exportRateLimit(db);
  await exportSubscriptions(db);
  await exportNotifyState(db);
  await exportStudents(db);
  await exportDocuments(db);
  console.log(`\n${changed} file(s) ${CHECK_ONLY ? 'would change' : 'updated'}, ${unchanged} unchanged.`);
  // --check is advisory, not a gate: it reports drift without failing a job.
}

main()
  .catch((err) => { console.error('Export failed:', err); process.exitCode = 1; })
  .finally(() => closeMongo());
