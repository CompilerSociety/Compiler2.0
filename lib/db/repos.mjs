// lib/db/repos.mjs
// Domain operations over the collections in collections.mjs, each paired with
// the JSON fallback it replaces.
//
// THE CONTRACT every function here keeps: if MONGODB_URI is unset, or Atlas is
// unreachable, the READ paths return the same data they returned before this
// migration by fetching the committed JSON from raw.githubusercontent, exactly
// as api/*.js did. Only the WRITE paths report failure. That is what makes the
// switch to Mongo non-breaking: the worst case is the site reverting to the
// read-only behaviour it already had when GH_TOKEN was missing.
//
// The fallback deliberately reads over HTTP rather than off disk: a Vercel
// function's bundle does not include db/, so fs would fail there. The same
// files are also the ones scripts/db/export-to-json.mjs keeps fresh.

import { withFallback, isEnabled, getDb } from './mongo.mjs';
import {
  COLLECTIONS, LEADERBOARD_FILES, DOCUMENT_FILES, NOTIFY_STATE_FILES,
  scoreId, notifyStateId, studentId,
} from './collections.mjs';

const MAX_ENTRIES = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_MIN = 10;

export function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
export function branch() { return process.env.GH_BRANCH || 'main'; }

// Reads a committed JSON file from the public repo. No credentials: the repo is
// public, which is why a revoked token can no longer take reads down.
async function readCommitted(file, fallbackValue) {
  const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/${file}?t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'compiler2-db', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return fallbackValue;
    return JSON.parse(await res.text());
  } catch {
    return fallbackValue;
  }
}

/* ── Leaderboards ───────────────────────────────────────────────────── */

// The top-N board for one game. Served straight off the game_rank index, in
// the same order the old file's cached `leaderboard` array used: highest score
// first, and on a tie the player who got there first ranks higher.
export async function topScores(game) {
  return withFallback(
    async (db) => db.collection(COLLECTIONS.LEADERBOARD)
      .find({ game }, { projection: { _id: 0, game: 0, migratedAt: 0 } })
      .sort({ highScore: -1, achievedAt: 1 })
      .limit(MAX_ENTRIES)
      .toArray(),
    async () => {
      const data = await readCommitted(LEADERBOARD_FILES[game], null);
      return (data && Array.isArray(data.leaderboard)) ? data.leaderboard : [];
    },
    'leaderboard.read',
  );
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
  return withFallback(
    async (db) => {
      const now = Date.now();
      const doc = await db.collection(COLLECTIONS.RATE_LIMIT).findOne({ _id: ip });
      const hits = (doc?.hits || []).filter((t) => now - t < RATE_WINDOW_MS);
      if (hits.length >= MAX_WRITES_PER_MIN) {
        return Math.ceil((Math.min(...hits) + RATE_WINDOW_MS - now) / 1000);
      }
      return null;
    },
    // Fail OPEN, matching the old behaviour: a storage blip must not lock
    // every player out of submitting. The in-process burst guard in each
    // endpoint still limits abuse from a single warm instance.
    async () => null,
    'ratelimit.check',
  );
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
  return withFallback(
    async (db) => {
      // By roll no, not by _id: _id is a composite and one student can hold
      // several rows (one per department/section they are enrolled in).
      const hit = await db.collection(COLLECTIONS.STUDENTS)
        .findOne({ nuid: key }, { projection: { _id: 1 } });
      if (hit) return true;
      const any = await db.collection(COLLECTIONS.STUDENTS)
        .findOne({ batch }, { projection: { _id: 1 } });
      return any ? false : 'unknown_batch';
    },
    async () => {
      // A 404 is a real answer (no such batch); a network error is not, and
      // must not be reported as one.
      const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/db/students/${batch}.json?t=${Date.now()}`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'compiler2-identity' } });
        if (res.status === 404) return 'unknown_batch';
        if (!res.ok) return null;
        const data = JSON.parse(await res.text());
        return (data.students || []).some((s) => String(s.nuid).trim().toUpperCase() === key);
      } catch {
        return null;
      }
    },
    'roster.lookup',
  );
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
  return withFallback(
    async (db) => db.collection(COLLECTIONS.SUBSCRIPTIONS)
      .find({}, { projection: { _id: 0, migratedAt: 0 } }).toArray(),
    async () => await readCommitted('db/metadata/notifications/push-subscriptions.json', []) || [],
    'subs.list',
  );
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
  return withFallback(
    async (db) => db.collection(COLLECTIONS.SUBSCRIPTIONS)
      .findOne({ _id: endpoint }, { projection: { _id: 0, migratedAt: 0 } }),
    async () => {
      const all = await readCommitted('db/metadata/notifications/push-subscriptions.json', []) || [];
      return all.find((s) => s?.subscription?.endpoint === endpoint) || null;
    },
    'subs.get',
  );
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
  return withFallback(
    async (db) => db.collection(COLLECTIONS.SUBSCRIPTIONS).countDocuments(),
    async () => ((await readCommitted('db/metadata/notifications/push-subscriptions.json', [])) || []).length,
    'subs.count',
  );
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

export async function getNotifyState(kind) {
  return withFallback(
    async (db) => {
      const rows = await db.collection(COLLECTIONS.NOTIFY_STATE)
        .find({ kind }, { projection: { key: 1, value: 1 } }).toArray();
      const out = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    async () => await readCommitted(NOTIFY_STATE_FILES[kind], {}) || {},
    'notifystate.read',
  );
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
  return withFallback(
    async (db) => {
      const row = await db.collection(COLLECTIONS.DOCUMENTS)
        .findOne({ _id: id }, { projection: { data: 1 } });
      return row ? row.data : await readCommitted(DOCUMENT_FILES[id], null);
    },
    async () => readCommitted(DOCUMENT_FILES[id], null),
    'document.read',
  );
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
