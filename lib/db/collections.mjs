// lib/db/collections.mjs
// The authoritative map from the committed db/*.json layout to MongoDB, plus
// the indexes those collections need. Every reader and writer - Node and
// Python alike - goes through this naming, so the layout is defined once.
//
// Two shapes are used, chosen per dataset rather than uniformly:
//
//  A) DOCUMENT-PER-RECORD, for anything mutated at runtime by a request.
//     Registering a student or saving a score becomes a single atomic upsert
//     instead of read-whole-file / edit / write-whole-file. That is what
//     removes the sha-conflict retry loops in api/*.js, and it is why two
//     students registering in the same second can no longer clobber each other.
//
//  B) DOCUMENT-PER-FILE (the `documents` collection), for the big blobs that a
//     Python job regenerates wholesale - timetables, exams, seating, showup,
//     faculty. Nothing edits an individual timetable entry; the generator
//     replaces the entire payload. Keeping the payload byte-identical under a
//     `data` field means api/timetable.js (1300+ lines of parsing) and the
//     frontend see exactly the JSON they see today, with no reshaping.
//
// A note on keys: push endpoints and client IPs are used as OBJECT KEYS in the
// current JSON (db/metadata/rate-limit.json, push-state.json, ...). They are
// full of dots, which cannot be Mongo field names, so each key becomes its own
// document keyed by _id instead of a field on one giant document.

export const COLLECTIONS = {
  // A) Runtime-mutable
  LEADERBOARD: 'leaderboard_scores',
  RATE_LIMIT: 'rate_limit',
  SUBSCRIPTIONS: 'push_subscriptions',
  NOTIFY_STATE: 'notify_state',
  STUDENTS: 'students',
  ROSTER_META: 'roster_meta',
  // B) Generated blobs
  DOCUMENTS: 'documents',
};

// Which file each `documents` entry came from. The _id is the key here, so the
// mirror export can rebuild db/ byte-for-byte and a reader can ask for
// "timetables/computing" without knowing the path convention.
export const DOCUMENT_FILES = {
  'timetables/computing': 'db/timetables/computing.json',
  'timetables/business': 'db/timetables/business.json',
  'timetables/engineering': 'db/timetables/engineering.json',
  'timetables/repeat-computing': 'db/timetables/repeat-computing.json',
  'exams/computing': 'db/exams/computing.json',
  'exams/business': 'db/exams/business.json',
  'exams/engineering': 'db/exams/engineering.json',
  // All three schools are mapped even though only computing publishes a
  // show-up sheet today, so a new one starts working without a code change.
  'showup/computing': 'db/showup/computing.json',
  'showup/business': 'db/showup/business.json',
  'showup/engineering': 'db/showup/engineering.json',
  // The Google Sheet the show-up poller watches - written once when the link is
  // first spotted in an email, then read on every poll.
  'showup/source': 'db/showup/source.json',
  'seating/plan': 'db/seating/plan.json',
  'faculty/data': 'db/faculty/data.json',
};

// The four notification state files. Each is a flat map of key -> value, and
// each becomes documents in NOTIFY_STATE tagged with this `kind`.
export const NOTIFY_STATE_FILES = {
  push: 'db/metadata/notifications/push-state.json',
  'push-exam': 'db/metadata/notifications/push-exam-state.json',
  'class-notify': 'db/metadata/notifications/class-notify-state.json',
  'showup-notify': 'db/metadata/notifications/showup-notify-state.json',
};

export const LEADERBOARD_FILES = {
  compiler_run: 'db/games/leaderboards/compiler-run.json',
  duck_hunter: 'db/games/leaderboards/duck-hunter.json',
  flappy_bird: 'db/games/leaderboards/flappy-bird.json',
};

// Composite ids. Kept as functions so the separator is never hand-written at a
// call site and can never drift between the writer and the reader.
export const scoreId = (game, nuid) => `${game}:${String(nuid).toUpperCase()}`;
export const notifyStateId = (kind, key) => `${kind}:${key}`;

// A student is NOT uniquely identified by NU ID alone. db/students/22.json
// carries 1804 rows for 1304 distinct roll numbers, because a student taking
// courses across two departments is listed once per department/section - e.g.
// 22I-0507 appears as both CS section A and AI section C. Keying on the roll no
// alone silently collapsed 500 of those rows on import, so the section and
// department are part of the identity.
//
// Roster MEMBERSHIP is still asked by roll no alone (see rosterHas), which is
// the question the identity checks actually ask.
export const studentId = (nuid, department, section) =>
  `${String(nuid).trim().toUpperCase()}:${department || '-'}:${section || '-'}`;

// Creates every index the app relies on. Safe to run repeatedly - createIndexes
// is a no-op when an identical index already exists - so the migration and the
// sync jobs can both call it without coordinating.
export async function ensureIndexes(db) {
  await db.collection(COLLECTIONS.LEADERBOARD).createIndexes([
    // Serves the top-10 query directly: equality on game, then the exact sort
    // the board uses (highest score first, earliest achiever wins a tie).
    { key: { game: 1, highScore: -1, achievedAt: 1 }, name: 'game_rank' },
  ]);
  await db.collection(COLLECTIONS.RATE_LIMIT).createIndexes([
    // Rate-limit rows are worthless once their window has passed. A TTL index
    // lets Mongo evict them instead of the file growing forever, which is what
    // db/metadata/rate-limit.json did.
    { key: { updatedAt: 1 }, name: 'ttl_1h', expireAfterSeconds: 3600 },
  ]);
  await db.collection(COLLECTIONS.SUBSCRIPTIONS).createIndexes([
    // send-*-push.mjs fans out per student; the notification scripts look
    // subscriptions up by NU ID.
    { key: { nuid: 1 }, name: 'by_nuid' },
    { key: { batch: 1, department: 1, section: 1 }, name: 'by_class' },
  ]);
  await db.collection(COLLECTIONS.NOTIFY_STATE).createIndexes([
    { key: { kind: 1 }, name: 'by_kind' },
  ]);
  await db.collection(COLLECTIONS.STUDENTS).createIndexes([
    { key: { batch: 1 }, name: 'by_batch' },
    // _id is a composite, so membership lookups by roll no need their own
    // index. Not unique: one student can hold several rows.
    { key: { nuid: 1 }, name: 'by_nuid' },
  ]);
  await db.collection(COLLECTIONS.DOCUMENTS).createIndexes([
    { key: { kind: 1 }, name: 'by_kind' },
  ]);
}
