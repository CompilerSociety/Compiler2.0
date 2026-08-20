// lib/db/repos.mjs
// Domain operations over the collections in collections.mjs, each paired with
// the JSON fallback it replaces.
//
// Mongo is the ONLY store. There is no JSON fallback any more - db/*.json was
// deleted, so there is nothing to fall back to and every read here goes to the
// database.
//
// That makes the failure policy explicit, and it differs per call on purpose:
//
//   * Reads that feed a page THROW, so api/db.js answers 503. Returning an
//     empty document instead would render as "no classes today" - a wrong
//     answer is worse than a visible error.
//   * rosterHas and rateLimitCheck FAIL OPEN, as they always have: an outage
//     must not lock real students out of registering or submitting a score.
//   * Notification state THROWS, and the senders abort on it. Treating an
//     unreadable state as empty would make every sender think nothing had ever
//     been notified and re-send the entire backlog to every device.

import { isEnabled, getDb } from './mongo.mjs';
import {
  COLLECTIONS, DOCUMENT_FILES, scoreId, notifyStateId, studentId,
} from './collections.mjs';

const MAX_ENTRIES = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_MIN = 10;

/* ── Leaderboards ───────────────────────────────────────────────────── */

// The top-N board for one game. Served straight off the game_rank index, in
// the same order the old file's cached `leaderboard` array used: highest score
// first, and on a tie the player who got there first ranks higher.
export async function topScores(game) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  return db.collection(COLLECTIONS.LEADERBOARD)
    .find({ game }, { projection: { _id: 0, game: 0, migratedAt: 0 } })
    .sort({ highScore: -1, achievedAt: 1 })
    .limit(MAX_ENTRIES)
    .toArray();
}

// Records a score if it beats the player's stored best.
//
// This is the change that makes concurrent play safe. The old code read the
// whole file, edited it, and wrote it back against a sha, so two players
// finishing at once raced and one write was retried or lost. Here the
// conditional upsert is a single atomic operation: the $gt filter means the
// database itself decides whether this run is a personal best, and two
// simultaneous submissions cannot overwrite each other.
//
// Returns { improved, leaderboard }.
export async function submitScore(game, player) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const _id = scoreId(game, player.nuid);
  const achievedAt = new Date().toISOString();

  let improved = false;
  try {
    const res = await db.collection(COLLECTIONS.LEADERBOARD).updateOne(
      // Matches only when this run is genuinely a new personal best.
      { _id, $or: [{ highScore: { $lt: player.score } }, { highScore: { $exists: false } }] },
      {
        $set: {
          game,
          nuid: String(player.nuid).toUpperCase(),
          name: player.name,
          section: player.section,
          department: player.department,
          batch: player.batch,
          highScore: player.score,
          achievedAt,
        },
      },
      { upsert: true },
    );
    improved = Boolean(res.upsertedCount || res.modifiedCount);
  } catch (err) {
    // The row exists and did NOT beat the stored best, so the filter matched
    // nothing and the upsert tried to insert a second document under the same
    // _id. That duplicate-key error is the expected "not a personal best"
    // outcome, not a failure - it is the same answer the old
    // read-compare-write path returned. Anything else is a real error.
    if (err?.code !== 11000) throw err;
    improved = false;
  }
  return { improved, leaderboard: await topScores(game) };
}

/* ── Rate limiting ──────────────────────────────────────────────────── */

// Per-IP sliding window, shared across serverless instances. Replaces the
// read-modify-write of db/metadata/rate-limit.json, which cost two GitHub API
// calls per submission and grew without bound; the TTL index now evicts stale
// rows on its own.
//
// Returns seconds to wait, or null when the caller is clear to proceed.
export async function rateLimitCheck(ip) {
  if (!isEnabled()) return null;
  try {
    const db = await getDb();
    const now = Date.now();
    const doc = await db.collection(COLLECTIONS.RATE_LIMIT).findOne({ _id: ip });
    const hits = (doc?.hits || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= MAX_WRITES_PER_MIN) {
      return Math.ceil((Math.min(...hits) + RATE_WINDOW_MS - now) / 1000);
    }
    return null;
  } catch (err) {
    // Fail OPEN: a storage blip must not lock every player out of submitting.
    // The in-process burst guard in each endpoint still limits abuse from a
    // single warm instance.
    console.error('[ratelimit.check] failing open:', err?.message);
    return null;
  }
}

// Records one successful write. Best effort: bookkeeping must never fail the
// request that already did the real work.
export async function rateLimitNote(ip) {
  if (!isEnabled()) return;
  try {
    const db = await getDb();
    const now = Date.now();
    await db.collection(COLLECTIONS.RATE_LIMIT).updateOne(
      { _id: ip },
      {
        $push: { hits: { $each: [now], $slice: -MAX_WRITES_PER_MIN } },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('rate-limit bookkeeping:', err?.message);
  }
}

/* ── Students / rosters ─────────────────────────────────────────────── */

// Roster membership for one NU ID. The three outcomes the callers already
// distinguish are kept distinct, because they mean very different things to a
// student staring at an error message:
//
//   true            - on the published roster, allow
//   false           - the batch is known and this ID is NOT on it, reject
//   'unknown_batch' - no roster exists for this batch at all
//   null            - the roster could not be read; callers FAIL OPEN
//
// That last case is the one worth preserving deliberately: the original code
// allowed the request through when GitHub was unreachable, so a storage blip
// could not lock every real student out of the feature. Collapsing it into
// 'unknown_batch' would silently turn an outage into a wall of rejections.
export async function rosterHas(batch, nuid) {
  const key = String(nuid).trim().toUpperCase();
  if (!isEnabled()) return null;
  try {
    const db = await getDb();
    // By roll no, not by _id: _id is a composite and one student can hold
    // several rows (one per department/section they are enrolled in).
    const hit = await db.collection(COLLECTIONS.STUDENTS)
      .findOne({ nuid: key }, { projection: { _id: 1 } });
    if (hit) return true;
    const any = await db.collection(COLLECTIONS.STUDENTS)
      .findOne({ batch }, { projection: { _id: 1 } });
    return any ? false : 'unknown_batch';
  } catch (err) {
    console.error('[roster.lookup] failing open:', err?.message);
    return null;
  }
}

// Adds a student to a roster, or updates the record if the NU ID already
// exists. One atomic upsert, so two students registering at the same moment can
// no longer clobber one another's row the way a whole-file rewrite could.
export async function upsertStudent(batch, student) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const nuid = String(student.nuid).trim().toUpperCase();
  const _id = studentId(nuid, student.department, student.section);
  const res = await db.collection(COLLECTIONS.STUDENTS).updateOne(
    { _id },
    {
      $set: {
        nuid,
        name: student.name ?? null,
        section: student.section ?? null,
        department: student.department ?? null,
        batch,
      },
    },
    { upsert: true },
  );
  // Keep the batch header's count honest for the JSON mirror export.
  await db.collection(COLLECTIONS.ROSTER_META).updateOne(
    { _id: batch },
    { $set: { batch }, $setOnInsert: { updated_at: '', source_subject: '' } },
    { upsert: true },
  );
  return { created: Boolean(res.upsertedCount) };
}

/* ── Push subscriptions ─────────────────────────────────────────────── */

export async function listSubscriptions() {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  return db.collection(COLLECTIONS.SUBSCRIPTIONS)
    .find({}, { projection: { _id: 0, migratedAt: 0 } }).toArray();
}

// Keyed by endpoint, so re-subscribing the same device updates its record
// instead of appending a duplicate - which the array-in-a-file version could
// only prevent by scanning the whole array first.
export async function upsertSubscription(entry) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const endpoint = entry?.subscription?.endpoint;
  if (!endpoint) throw new Error('subscription.endpoint is required');
  await db.collection(COLLECTIONS.SUBSCRIPTIONS).updateOne(
    { _id: endpoint },
    { $set: { ...entry } },
    { upsert: true },
  );
}

export async function getSubscription(endpoint) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  return db.collection(COLLECTIONS.SUBSCRIPTIONS)
    .findOne({ _id: endpoint }, { projection: { _id: 0, migratedAt: 0 } });
}

// Returns the number of records removed (0 or 1), so the endpoint can report
// "already off" the same way it did when it diffed two array lengths.
export async function removeSubscription(endpoint) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const res = await db.collection(COLLECTIONS.SUBSCRIPTIONS).deleteOne({ _id: endpoint });
  return res.deletedCount || 0;
}

export async function countSubscriptions() {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  return db.collection(COLLECTIONS.SUBSCRIPTIONS).countDocuments();
}

// Adds a self-registered student, and ONLY if that NU ID is not already on the
// roster. Append-only on purpose, preserving the property the file-based
// version documented: an existing row is never edited or replaced, so
// re-POSTing someone else's roll no cannot overwrite their real name, section
// or assigned seat. $setOnInsert is what enforces it - an existing document is
// left completely untouched.
//
// Returns true if a row was actually added.
export async function enrolStudent(batch, student) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const nuid = String(student.nuid).trim().toUpperCase();
  // Matched on the roll no ALONE, deliberately. _id is a composite, but
  // enrolment must stay append-only per student the way the file version was:
  // someone re-POSTing an existing roll no with a different section must not
  // be able to add a second row for a student who is already on the roster.
  const res = await db.collection(COLLECTIONS.STUDENTS).updateOne(
    { nuid },
    {
      $setOnInsert: {
        _id: studentId(nuid, student.department, student.section),
        nuid,
        name: student.name,
        section: student.section,
        department: student.department,
        batch,
        // Same shape as a seating-plan row so every downstream reader
        // (send-seating-push, the profile tabs) treats the two identically.
        paper: '', time: '', class: '', seat: '',
        self_registered: true,
        added_at: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  if (res.upsertedCount) {
    await db.collection(COLLECTIONS.ROSTER_META).updateOne(
      { _id: batch },
      {
        $set: { batch, updated_at: new Date().toISOString() },
        $setOnInsert: { source_subject: `Self-registered ${batch}` },
      },
      { upsert: true },
    );
    return true;
  }
  return false;
}

/* ── Notification state ─────────────────────────────────────────────── */

// Throws rather than returning {} on failure. An empty state reads as "nothing
// has ever been notified", which would make a sender re-deliver its entire
// backlog to every subscribed device.
export async function getNotifyState(kind) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const rows = await db.collection(COLLECTIONS.NOTIFY_STATE)
    .find({ kind }, { projection: { key: 1, value: 1 } }).toArray();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// Writes the whole map for one kind, mirroring how the send-*-push scripts
// rewrote their state file at the end of a run.
export async function setNotifyState(kind, state) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const entries = Object.entries(state || {});
  if (!entries.length) return;
  await db.collection(COLLECTIONS.NOTIFY_STATE).bulkWrite(
    entries.map(([key, value]) => ({
      updateOne: {
        filter: { _id: notifyStateId(kind, key) },
        update: { $set: { kind, key, value } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/* ── Generated documents (timetables, exams, seating, showup, faculty) ─ */

// Returns the payload in exactly the shape the committed file has, so every
// existing parser downstream keeps working untouched.
export async function getDocument(id) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const row = await db.collection(COLLECTIONS.DOCUMENTS)
    .findOne({ _id: id }, { projection: { data: 1 } });
  return row ? row.data : null;
}

export async function putDocument(id, data) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  await db.collection(COLLECTIONS.DOCUMENTS).updateOne(
    { _id: id },
    { $set: { kind: id.split('/')[0], file: DOCUMENT_FILES[id], data, updatedAt: new Date() } },
    { upsert: true },
  );
}

/* ── File-shaped reads ──────────────────────────────────────────────────
   The frontend used to fetch db/*.json directly as static files. Now that
   those files are gone, api/db.js serves the same payloads from Mongo, and
   these helpers rebuild the exact shapes the old files had so no parser on the
   client had to change. */

// Rebuilds db/students/<batch>.json.
export async function getRoster(batch) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const meta = await db.collection(COLLECTIONS.ROSTER_META).findOne({ _id: batch });
  const students = await db.collection(COLLECTIONS.STUDENTS)
    .find({ batch }, { projection: { batch: 0, migratedAt: 0 } })
    .sort({ _id: 1 })
    .toArray();
  if (!meta && !students.length) return null;
  return {
    updated_at: meta?.updated_at ?? '',
    source_subject: meta?.source_subject ?? '',
    count: students.length,
    students: students.map((s) => ({
      name: s.name,
      nuid: s.nuid,
      section: s.section,
      department: s.department,
      batch,
    })),
  };
}

// Rebuilds db/games/leaderboards/<game>.json: the full player map plus the
// top-10 array, both derived from the same rows the live API serves.
export async function getLeaderboardFile(game) {
  if (!isEnabled()) throw new Error('MONGODB_URI is not set');
  const db = await getDb();
  const rows = await db.collection(COLLECTIONS.LEADERBOARD)
    .find({ game }, { projection: { _id: 0, game: 0, migratedAt: 0 } })
    .sort({ highScore: -1, achievedAt: 1 })
    .toArray();
  const byNuid = new Map(rows.map((r) => [r.nuid, r]));
  const players = {};
  for (const nuid of [...byNuid.keys()].sort()) players[nuid] = byNuid.get(nuid);
  return { players, leaderboard: rows.slice(0, MAX_ENTRIES) };
}
