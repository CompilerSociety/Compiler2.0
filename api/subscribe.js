// Vercel Node serverless function.
// Stores a push subscription (+ NU ID) in MongoDB, one document per push
// endpoint, through lib/db/repos.mjs.
//
// This used to write db/metadata/notifications/push-subscriptions.json back
// into the repo through the GitHub Contents API. Every subscribe cost four
// authenticated API calls and two commits (the list plus rate-limit
// bookkeeping), rewrote an 88-entry array to change one row, and needed a
// sha-retry loop because two devices subscribing at once raced each other.
// Reads still fall back to that committed file when the database is
// unreachable, so an outage degrades this to read-only rather than breaking it.
//
// Required environment variables (set in Vercel project settings):
//   MONGODB_URI - Atlas connection string (required to CHANGE a subscription)
//   MONGODB_DB  - database name (optional, default "compiler2")
//   GH_REPO     - "owner/name" (optional) - only for the read-only fallback
//   GH_BRANCH   - branch to read the fallback from (optional, default "main")

import { isEnabled } from '../lib/db/mongo.mjs';
import {
  rosterHas as dbRosterHas, enrolStudent, getSubscription, upsertSubscription,
  removeSubscription, countSubscriptions, rateLimitCheck, rateLimitNote,
} from '../lib/db/repos.mjs';

/* ── Security: input validation, identity check, rate limiting ──────────
   - NUID_RE requires a well-formed NU ID, which also rules out junk keys.
   - The identity step reads the published roster for the ID's batch
     (db/students/<batch>.json). A roll no that is NOT on it is ENROLLED
     rather than rejected: the roster only ever holds whoever the seating-plan
     email happened to name, so it lags every new intake (26.json held 3
     students while the whole 26 batch was trying to sign up) and a hard gate
     locked out real students with no way in. See enrolStudent for what that
     write is and is not allowed to do.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching the database, and the `rate_limit` collection enforces
     the same window across instances. The identity step runs AFTER it, so the
     roster write is rate-limited too. */
// The leading 2 digits are CAPTURED: they select the batch roster. Without the
// group m[1] is undefined for every well-formed ID, which used to reject the
// user with "No roster found for batch undefined".
const NUID_RE = /^(\d{2})[A-Za-z]{1,4}-\d{4}$/;
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_MIN = 5;

const _burst = new Map(); // ip -> { t, count } (in-process only)

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return fwd.split(',')[0].trim() || 'unknown';
}

function burstAllowed(ip) {
  const now = Date.now();
  const rec = _burst.get(ip);
  if (!rec || now - rec.t > RATE_WINDOW_MS) {
    _burst.set(ip, { t: now, count: 1 });
    return true;
  }
  if (rec.count >= MAX_WRITES_PER_MIN) return false;
  rec.count += 1;
  rec.t = now;
  return true;
}

/* Rate limiting and roster/subscription storage now live in
   lib/db/repos.mjs, backed by MongoDB. What used to be here was a
   read-modify-write of db/metadata/rate-limit.json and
   db/metadata/notifications/push-subscriptions.json through the GitHub
   Contents API: four authenticated API calls and two commits for every
   subscribe, with a sha-retry loop because two devices subscribing at once
   raced each other. Each of those is now a single atomic upsert. */


// Per-category notification preferences. Kept in step with
// scripts/notifications/prefs.mjs, which is the source of truth and carries the
// reasoning; it is duplicated rather than imported because that module ships to
// GitHub Actions, not to this serverless bundle.
//
// Only these keys are stored, and only as booleans, so a client cannot grow the
// record with arbitrary fields. An omitted key is left OUT of the stored object
// entirely rather than written as a default — the senders treat "absent" as
// "on" for the categories that already ship, which is what keeps subscriptions
// made before preferences existed working unchanged.
const PREF_KEYS = ['cls', 'exam', 'show', 'seat', 'room'];

function sanitizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const prefs = {};
  for (const key of PREF_KEYS) {
    if (typeof raw[key] === 'boolean') prefs[key] = raw[key];
  }
  return Object.keys(prefs).length ? prefs : null;
}

// ── Push endpoint allowlist ─────────────────────────────────────────────
// Every stored subscription is later POSTed to by the GitHub Actions senders,
// so a forged endpoint would make them send requests to an arbitrary host
// (SSRF) and could redirect notification traffic to an attacker's server.
// Only real web-push endpoints from the known browser push services are
// accepted, and only over HTTPS. web-push's own HTTPS check no longer exists
// in current versions, so this is the enforcement point.
const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',             // Chrome / Edge / all FCM-backed browsers
  'web.push.apple.com',             // Safari
  'updates.push.services.mozilla.com', // Firefox (standard)
  'push.services.mozilla.com',      // Firefox (legacy autopush host)
];

function isValidEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint));
    if (url.protocol !== 'https:') return false;
    return ALLOWED_PUSH_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

// Minimal shape check: the fields web-push requires to encrypt a payload.
function isValidSubscription(subscription) {
  const sub = subscription && typeof subscription === 'object' ? subscription : null;
  if (!sub || typeof sub.endpoint !== 'string') return false;
  const keys = sub.keys || {};
  return typeof keys.p256dh === 'string' && keys.p256dh.length > 0 &&
    typeof keys.auth === 'string' && keys.auth.length > 0;
}

function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
function branch() { return process.env.GH_BRANCH || 'main'; }


function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

// DELETE — the user turned notifications off.
//
// Authorisation is the endpoint itself. A push endpoint is an unguessable
// bearer capability minted by the browser's push service: whoever holds it can
// already send this device notifications, so being able to stop them is
// strictly less power than they have. No NU ID is required or accepted, which
// also means this cannot be used to enumerate or clear anyone else's row.
//
// Removing the row is the half that stops the GitHub Actions senders from
// targeting the device; the client also unsubscribes locally, which is what
// stops delivery outright.
async function handleUnsubscribe(req, res) {
  const payload = parseBody(req);
  const endpoint = String(payload.endpoint || payload?.subscription?.endpoint || '').trim();
  if (!endpoint || !isValidEndpoint(endpoint)) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_subscription',
      message: 'A valid push endpoint is required.',
    });
  }

  const ip = clientIp(req);
  if (!burstAllowed(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: "You're sending requests too quickly. Wait a minute and try again.",
    });
  }
  const retryAfter = await rateLimitCheck(ip);
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: "You're sending requests too quickly. Wait a moment and try again.",
    });
  }

  if (!isEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'unsubscribe_unavailable',
      message: "Notifications can't be changed right now — this is on us, not you.",
      detail: 'MONGODB_URI is not set on the server.',
    });
  }

  // One targeted delete, keyed by the endpoint. No read-modify-write of the
  // whole subscription list, so there is no sha to race and nothing to retry.
  // Already gone — report success rather than 404. Turning something off twice
  // is not an error, and the caller only cares that it is off now.
  const removed = await removeSubscription(endpoint);
  if (removed) await rateLimitNote(ip);
  return res.status(200).json({ ok: true, removed, count: await countSubscriptions() });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    if (req.method === 'DELETE') return await handleUnsubscribe(req, res);

    const payload = parseBody(req);
    const nuid = String(payload.nuid || '').trim().toUpperCase();
    const name = String(payload.name || '').trim();
    const department = String(payload.department || '').trim();
    const batch = String(payload.batch || '').trim();
    const section = String(payload.section || '').trim();
    const subscription = payload.subscription;
    const prefs = sanitizePrefs(payload.prefs);
    if (!nuid || !subscription || !subscription.endpoint) {
      return res.status(400).json({ ok: false, error: 'nuid and a valid subscription are required' });
    }

    // 0) Endpoint + shape: only real web-push endpoints from known push
    //    services may be stored (blocks SSRF + notification redirection).
    if (!isValidEndpoint(subscription.endpoint) || !isValidSubscription(subscription)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_subscription',
        message: 'Subscription must be a valid HTTPS web-push subscription.',
      });
    }

    // 1) Format: cheap and local, so a junk ID is rejected before this costs
    //    a roster fetch or any rate-limit bookkeeping.
    const idParts = NUID_RE.exec(nuid);
    if (!idParts) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_nuid',
        message: 'NU ID must look like 22I-0507.',
      });
    }
    const rosterBatch = idParts[1];

    // 2) Rate limit: reject spam fast (in-process) and across instances.
    //    Ahead of the identity step, because that step can now WRITE.
    const ip = clientIp(req);
    if (!burstAllowed(ip)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: "You're sending requests too quickly. Wait a minute and try again.",
      });
    }
    const retryAfter = await rateLimitCheck(ip);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: "You're sending requests too quickly. Wait a moment and try again.",
      });
    }

    // 3) Cap string fields so a client can't grow the stored record unbounded
    //    (the values are later interpolated into push notification bodies).
    const record = {
      nuid,
      name: name.slice(0, 60),
      department: department.slice(0, 20),
      batch: batch.slice(0, 8),
      section: section.slice(0, 10),
      subscription,
      updated_at: Date.now(),
    };

    if (!isEnabled()) {
      // `message` is shown to the user, so it stays plain and blameless.
      // `detail` carries the operator-facing cause.
      return res.status(503).json({
        ok: false,
        error: 'subscribe_unavailable',
        message: "Notifications can't be enabled right now — this is on us, not you.",
        detail: 'MONGODB_URI is not set on the server.',
      });
    }

    // 4) Identity: on the roster already, or enrol them onto it now.
    //    A roster miss is not a rejection any more — the seating-plan email is
    //    the only thing that ever populates db/students/, so it lags every new
    //    intake and used to lock those students out entirely.
    // 'unknown_batch' means no roster exists for this intake yet, which is a
    // definite "not on it" and enrols them — the same call the 404 branch made
    // before. null means the roster was unreadable, and is deliberately treated
    // as "already there" so a storage blip neither blocks sign-up nor appends a
    // duplicate.
    const known = await dbRosterHas(rosterBatch, nuid);
    if (known === false || known === 'unknown_batch') {
      // Only enrol a complete profile. The mobile and desktop registration
      // screens both collect all three before they let the user through, so a
      // request missing them is a stale client, not a student to write down as
      // a nameless row that no downstream reader could use.
      if (!record.name || !record.department || !record.section) {
        return res.status(400).json({
          ok: false,
          error: 'incomplete_profile',
          message: 'Add your name, department and section to your profile, then enable alerts.',
        });
      }
      try {
        const added = await enrolStudent(rosterBatch, {
          name: record.name,
          nuid,
          section: record.section,
          department: record.department,
        });
        if (added) console.log(`enrolled ${nuid} in the ${rosterBatch} roster`);
      } catch (err) {
        // The subscription is the thing the user asked for; the roster row is
        // bookkeeping. Losing the row must not cost them their alerts, so this
        // is logged and the subscribe continues.
        console.error('roster enrolment failed, continuing to subscribe:', err?.message);
      }
    }

    // A POST that names no preferences must not wipe the ones already stored:
    // the profile re-subscribes on plain "enable notifications" too, and that
    // path should leave an existing choice alone.
    const existing = await getSubscription(subscription.endpoint);
    const merged = { ...(existing?.prefs || {}), ...(prefs || {}) };
    if (Object.keys(merged).length) record.prefs = merged;

    // Keyed by endpoint, so re-subscribing the same device replaces its record
    // rather than appending a duplicate — which is also why the old
    // read-filter-append-write cycle, and its sha retry loop, are gone.
    await upsertSubscription(record);
    await rateLimitNote(ip);
    return res.status(200).json({ ok: true, count: await countSubscriptions() });
  } catch (err) {
    console.error('subscribe API error:', err);
    // A database that is configured but unreachable is a service problem, not
    // the user's. 503 keeps the client's existing handling working and tells
    // the operator what actually happened.
    return res.status(503).json({
      ok: false,
      error: 'subscribe_unavailable',
      message: "Notifications can't be enabled right now — this is on us, not you.",
      detail: err?.message || String(err),
    });
  }
}
