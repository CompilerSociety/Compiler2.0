// Vercel Node serverless function: POST /api/register
//
// Writes a newly created student profile into the `students` collection in
// MongoDB. Called the moment someone finishes the registration
// screen (mobile) or the registration form (desktop) — the profile itself
// lives in a cookie, but the roster row has to be server-side so that
// everything keyed off the roster (notification sign-up, seat lookups, the
// published student count) knows the student exists.
//
// Why an endpoint at all: db/students/*.json is only ever populated by the
// seating-plan email, so it trails each new intake by months. api/profile.py
// was meant to fill this gap but writes with open()/json.dump to the local
// filesystem, which on Vercel is read-only and thrown away after the
// invocation — so nothing it wrote ever reached the repo, and no client
// called it.
//
// Required environment variables (set in Vercel project settings):
//   MONGODB_URI - Atlas connection string (required to register)
//   MONGODB_DB  - database name (optional, default "compiler2")

/* ── Security ────────────────────────────────────────────────────────────
   This endpoint takes anonymous writes, so it is deliberately narrow:

   - NUID_RE fixes the shape of a roll no, and its captured first two digits —
     NOT anything the client sends — choose the roster file. A client cannot
     name the file it writes to.
   - The write is APPEND-ONLY. An existing row is never edited or replaced, so
     re-POSTing another student's roll no cannot overwrite their name, section
     or assigned seat; the worst case is a row that was not there before.
   - Every stored string is length-capped, and only the five known fields are
     kept, so the file cannot be grown into a blob store.
   - Per-IP rate limiting, in-process for bursts plus a database-backed
     window shared with /api/subscribe. */

import { isEnabled } from '../lib/db/mongo.mjs';
import { enrolStudent, rateLimitCheck, rateLimitNote } from '../lib/db/repos.mjs';

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

/* Rate limiting and the roster write now live in lib/db/repos.mjs, backed
   by MongoDB. What was here read the whole roster file through the GitHub
   Contents API, appended one row, and wrote it back against a sha - four
   authenticated calls and two commits per registration, with a retry loop
   because two students registering at once raced each other. enrolStudent
   is a single atomic upsert and keeps the append-only guarantee above:
   $setOnInsert means an existing row is never touched. */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const nuid = String(payload.nuid || '').trim().toUpperCase();
    const name = String(payload.name || '').trim().slice(0, 60);
    const department = String(payload.department || '').trim().slice(0, 20);
    const section = String(payload.section || '').trim().toUpperCase().slice(0, 10);

    // 1) Shape. The batch comes from the roll no, never from the payload, so
    //    the client cannot choose which file it lands in.
    const parts = NUID_RE.exec(nuid);
    if (!parts) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_nuid',
        message: 'NU ID must look like 22I-0507.',
      });
    }
    const batch = parts[1];
    if (!name || !department || !section) {
      return res.status(400).json({
        ok: false,
        error: 'incomplete_profile',
        message: 'Name, department and section are all required.',
      });
    }

    // 2) Rate limit, before anything that writes.
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
      // `message` is shown to the user, so it stays plain and blameless.
      // `detail` carries the operator-facing cause.
      return res.status(503).json({
        ok: false,
        error: 'register_unavailable',
        message: "Your profile couldn't be published right now — this is on us, not you.",
        detail: 'MONGODB_URI is not set on the server.',
      });
    }

    // Returns false when the roll no was already on the roster, which is a
    // success for the caller, not an error.
    const added = await enrolStudent(batch, { name, nuid, section, department });
    if (added) {
      await rateLimitNote(ip);
      console.log(`registered ${nuid} in the ${batch} roster`);
    }
    return res.status(200).json({ ok: true, batch, added });
  } catch (err) {
    console.error('register API error:', err);
    // A database that is configured but unreachable is a service problem, not
    // the user's - reported the same way a missing credential always was.
    return res.status(503).json({
      ok: false,
      error: 'register_unavailable',
      message: "Your profile couldn't be published right now — this is on us, not you.",
      detail: err?.message || String(err),
    });
  }
}
