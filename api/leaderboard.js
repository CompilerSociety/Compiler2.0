// api/leaderboard.js
// Vercel serverless function backing the shared arcade leaderboards.
//
// Persistence: MongoDB, one document per player per game (collection
// `leaderboard_scores`), through lib/db/repos.mjs.
//
// This used to write db/games/leaderboards/*.json back into the repo through
// the GitHub Contents API. That worked, but every single personal best was a
// git commit and a Vercel deployment, it burned two authenticated GitHub API
// calls per submission plus two more for rate-limit bookkeeping, and saving a
// score was a read-whole-file / edit / write-against-a-sha cycle that raced
// whenever two people finished a run at the same moment - hence the retry loop
// that used to live here. A conditional upsert replaces all of it.
//
// Reads still fall back to the committed JSON (see lib/db/repos.mjs) when the
// database is unreachable, so an Atlas outage degrades the board to read-only
// rather than taking it down - the same failure shape a revoked GH_TOKEN used
// to produce.
//
// Env:
//   MONGODB_URI - Atlas connection string (required to SAVE a score)
//   MONGODB_DB  - database name (optional, default "compiler2")

import { isEnabled } from '../lib/db/mongo.mjs';
import { topScores, submitScore, rateLimitCheck, rateLimitNote, rosterHas } from '../lib/db/repos.mjs';

const GAMES = ['compiler_run', 'duck_hunter', 'flappy_bird'];

/* ── Security: input validation, identity check, rate limiting ──────────
   - NUID_RE is the ONLY thing that decides what NU IDs reach the database, so
     it also blocks prototype-pollution keys like "__proto__" / "constructor"
     that mattered when scores lived in a plain object.
   - The identity check requires the NU ID to exist in the published roster for
     its batch, which stops anonymous spoofing of fake names/NU IDs. It fails
     OPEN if the roster cannot be read so a storage blip cannot take the
     feature down.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching the database, and the `rate_limit` collection enforces
     the same window across instances. */
// The leading 2 digits are CAPTURED: they select the batch roster.
const NUID_RE = /^(\d{2})[A-Za-z]{1,4}-\d{4}$/;
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_MIN = 10;

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

// Identity check: the NU ID must match NUID_RE and exist in its batch roster.
// Returns { status: null } when allowed; otherwise { status, error, message }.
async function checkIdentity(nuid) {
  const m = NUID_RE.exec(nuid);
  if (!m) {
    return { status: 400, error: 'invalid_nuid', message: 'NU ID must look like 22I-0507.' };
  }
  const batch = m[1];
  const found = await rosterHas(batch, nuid);
  if (found === 'unknown_batch') {
    return { status: 403, error: 'unknown_batch', message: `No roster found for batch ${batch}.` };
  }
  // null means the roster was unreadable - fail open, as before.
  if (found === false) {
    return {
      status: 403,
      error: 'nuid_not_registered',
      message: `No student with NU ID ${nuid} was found in the published roster.`,
    };
  }
  return { status: null, error: null, message: null };
}

function gameOf(req, body) {
  const raw = String((body && body.game) || (req.query && req.query.game) || 'compiler_run').toLowerCase();
  return GAMES.includes(raw) ? raw : 'compiler_run';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      // Never needs the database to be up: repos.topScores falls back to the
      // committed JSON mirror on its own.
      return res.status(200).json({ leaderboard: await topScores(gameOf(req, null)) });
    }

    if (req.method === 'POST') {
      // Saving a score does need the database.
      if (!isEnabled()) {
        // `message` is shown to the player, so it stays plain and blameless.
        // `detail` carries the operator-facing cause.
        return res.status(503).json({
          error: 'leaderboard_read_only',
          message: "Scores can't be saved right now — this is on us, not you.",
          detail: 'MONGODB_URI is not set on the server.',
        });
      }

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const game = gameOf(req, body);
      const { nuid, name, section, department, batch, score } = body || {};

      if (!nuid || typeof nuid !== 'string') {
        return res.status(400).json({ error: 'nuid is required' });
      }
      const numericScore = Math.floor(Number(score));
      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 1000000) {
        return res.status(400).json({ error: 'score must be a valid number' });
      }

      const key = nuid.trim().toUpperCase();

      // 1) Format + identity: only a real student on the published roster can
      //    write a score, and only with a well-formed NU ID.
      const identity = await checkIdentity(key);
      if (identity.status) {
        return res.status(identity.status).json({ error: identity.error, message: identity.message });
      }

      // 2) Rate limit: reject spam fast (in-process) and across instances.
      const ip = clientIp(req);
      if (!burstAllowed(ip)) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({
          error: 'rate_limited',
          message: "You're sending requests too quickly. Wait a minute and try again.",
        });
      }
      const retryAfter = await rateLimitCheck(ip);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'rate_limited',
          message: "You're sending requests too quickly. Wait a moment and try again.",
        });
      }

      // 3) Save. One atomic conditional upsert - no read-modify-write, so
      //    concurrent submissions cannot clobber each other and there is
      //    nothing left to retry.
      const { improved, leaderboard } = await submitScore(game, {
        nuid: key,
        name: (name && String(name).slice(0, 60)) || 'Unknown',
        section: (section && String(section).slice(0, 10)) || '-',
        department: (department && String(department).slice(0, 20)) || '-',
        batch: (batch && String(batch).slice(0, 8)) || '-',
        score: numericScore,
      });

      // Only a write that actually changed something counts against the window.
      if (improved) await rateLimitNote(ip);
      return res.status(200).json({ leaderboard, improved });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('leaderboard API error:', err);
    // A database that is configured but unreachable is a service problem, not
    // the player's. 503 keeps the client's existing "could not save" handling
    // working and tells the operator what actually happened.
    return res.status(503).json({
      error: 'leaderboard_read_only',
      message: "Scores can't be saved right now — this is on us, not you.",
      detail: err?.message || String(err),
    });
  }
}
