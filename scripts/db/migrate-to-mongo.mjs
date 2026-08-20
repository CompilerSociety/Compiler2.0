// scripts/db/migrate-to-mongo.mjs
// One-time (and safely repeatable) import of every committed db/*.json file
// into MongoDB.
//
//   node scripts/db/migrate-to-mongo.mjs --dry-run   # report only, writes nothing
//   node scripts/db/migrate-to-mongo.mjs             # perform the import
//
// Requires MONGODB_URI in the environment. Every write is an upsert keyed by a
// natural id, so running it twice imports the same data into the same
// documents rather than duplicating rows - safe to re-run after a partial
// failure, and safe to run again later to backfill.
//
// It never deletes. If a record exists in Mongo but not in the JSON, it is left
// alone: the JSON files are a point-in-time snapshot, and a score saved after
// that snapshot was taken must not be rolled back by re-running the migration.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeMongo, isEnabled, dbName } from '../../lib/db/mongo.mjs';
import {
  COLLECTIONS, DOCUMENT_FILES, NOTIFY_STATE_FILES, LEADERBOARD_FILES,
  scoreId, notifyStateId, ensureIndexes,
} from '../../lib/db/collections.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry-run');

function readJson(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (err) {
    throw new Error(`${rel} is not valid JSON: ${err.message}`);
  }
}

// Every migrator returns { collection, ops } so the runner can report and
// execute them uniformly, and so --dry-run shows exactly what the real run
// would do instead of a second code path that can drift from it.
function upsert(_id, doc) {
  return {
    updateOne: {
      filter: { _id },
      update: { $set: { ...doc, migratedAt: new Date() } },
      upsert: true,
    },
  };
}

function migrateLeaderboards() {
  const ops = [];
  for (const [game, file] of Object.entries(LEADERBOARD_FILES)) {
    const data = readJson(file);
    if (!data) continue;
    // `players` is the authoritative map; the `leaderboard` array in the file
    // is a derived top-10 cache and is deliberately NOT imported - it is
    // recomputed from the collection by the rank index on every read.
    for (const [nuid, p] of Object.entries(data.players || {})) {
      ops.push(upsert(scoreId(game, nuid), {
        game,
        nuid: String(nuid).toUpperCase(),
        name: p.name ?? 'Unknown',
        section: p.section ?? '-',
        department: p.department ?? '-',
        batch: p.batch ?? '-',
        highScore: Number(p.highScore) || 0,
        achievedAt: p.achievedAt || new Date(0).toISOString(),
      }));
    }
  }
  return { collection: COLLECTIONS.LEADERBOARD, ops };
}

function migrateRateLimit() {
  const data = readJson('db/metadata/rate-limit.json') || {};
  const ops = [];
  for (const [ip, hits] of Object.entries(data)) {
    const list = Array.isArray(hits) ? hits : [];
    ops.push(upsert(ip, {
      hits: list,
      // Drives the TTL index. Using the newest hit rather than "now" means
      // stale rows imported from an old file expire immediately instead of
      // being granted a fresh hour of life.
      updatedAt: new Date(list.length ? Math.max(...list) : 0),
    }));
  }
  return { collection: COLLECTIONS.RATE_LIMIT, ops };
}

function migrateSubscriptions() {
  const data = readJson('db/metadata/notifications/push-subscriptions.json') || [];
  const ops = [];
  for (const entry of Array.isArray(data) ? data : []) {
    const endpoint = entry?.subscription?.endpoint;
    // A record with no endpoint cannot be pushed to and cannot be keyed.
    // Skipping it matches what the send scripts already do at fan-out time.
    if (!endpoint) continue;
    ops.push(upsert(endpoint, {
      nuid: entry.nuid ?? null,
      name: entry.name ?? null,
      department: entry.department ?? null,
      batch: entry.batch ?? null,
      section: entry.section ?? null,
      subscription: entry.subscription,
      prefs: entry.prefs ?? null,
    }));
  }
  return { collection: COLLECTIONS.SUBSCRIPTIONS, ops };
}

function migrateNotifyState() {
  const ops = [];
  for (const [kind, file] of Object.entries(NOTIFY_STATE_FILES)) {
    const data = readJson(file) || {};
    for (const [key, value] of Object.entries(data)) {
      ops.push(upsert(notifyStateId(kind, key), { kind, key, value }));
    }
  }
  return { collection: COLLECTIONS.NOTIFY_STATE, ops };
}

function migrateStudents() {
  const ops = [];
  const metaOps = [];
  const batchFiles = fs.readdirSync(path.join(ROOT, 'db/students'))
    .filter((f) => f.endsWith('.json'));
  for (const file of batchFiles) {
    const batch = path.basename(file, '.json');
    const data = readJson(`db/students/${file}`);
    if (!data) continue;
    // The per-file header (updated_at / source_subject / count) describes the
    // roster import, not any one student, so it lives in its own collection
    // rather than being duplicated onto 1800 student documents.
    metaOps.push(upsert(batch, {
      batch,
      updated_at: data.updated_at ?? '',
      source_subject: data.source_subject ?? '',
      count: Number(data.count) || (data.students || []).length,
    }));
    for (const s of data.students || []) {
      const nuid = String(s.nuid || '').trim().toUpperCase();
      if (!nuid) continue;
      ops.push(upsert(nuid, {
        nuid,
        name: s.name ?? null,
        section: s.section ?? null,
        department: s.department ?? null,
        // Trust the filename over the row: the batch file IS the grouping, and
        // a handful of rows carry a blank or mismatched batch field.
        batch,
      }));
    }
  }
  return [
    { collection: COLLECTIONS.STUDENTS, ops },
    { collection: COLLECTIONS.ROSTER_META, ops: metaOps },
  ];
}

function migrateDocuments() {
  const ops = [];
  for (const [id, file] of Object.entries(DOCUMENT_FILES)) {
    const data = readJson(file);
    if (data === null) {
      console.warn(`  (skipping ${file} - not present)`);
      continue;
    }
    ops.push(upsert(id, {
      kind: id.split('/')[0],
      file,
      // Stored verbatim, so every consumer downstream keeps parsing the exact
      // shape it parses today.
      data,
    }));
  }
  return { collection: COLLECTIONS.DOCUMENTS, ops };
}

async function main() {
  if (!isEnabled()) {
    console.error('MONGODB_URI is not set - nothing to migrate into.');
    console.error('See docs/mongodb-setup.md for how to create a cluster and get the URI.');
    process.exit(1);
  }

  const groups = [
    migrateLeaderboards(),
    migrateRateLimit(),
    migrateSubscriptions(),
    migrateNotifyState(),
    ...migrateStudents(),
    migrateDocuments(),
  ];

  console.log(`${DRY ? 'DRY RUN - ' : ''}migrating db/ into database "${dbName()}"`);
  for (const g of groups) {
    console.log(`  ${g.collection.padEnd(20)} ${String(g.ops.length).padStart(6)} documents`);
  }

  if (DRY) {
    console.log('\nDry run: nothing was written.');
    return;
  }

  const db = await getDb();
  await ensureIndexes(db);

  let total = 0;
  for (const g of groups) {
    if (!g.ops.length) continue;
    // Chunked: a single bulkWrite of 1800 students is fine, but bounded
    // batches keep memory flat if a roster grows by an order of magnitude.
    for (let i = 0; i < g.ops.length; i += 500) {
      const chunk = g.ops.slice(i, i + 500);
      // ordered:false - one malformed record should not abort the rest of the
      // batch, and every op is an independent upsert with no ordering needs.
      const res = await db.collection(g.collection).bulkWrite(chunk, { ordered: false });
      total += (res.upsertedCount || 0) + (res.modifiedCount || 0);
    }
    console.log(`  wrote ${g.collection}`);
  }
  console.log(`\nDone. ${total} documents inserted or updated.`);
}

main()
  .catch((err) => { console.error('Migration failed:', err); process.exitCode = 1; })
  .finally(() => closeMongo());
