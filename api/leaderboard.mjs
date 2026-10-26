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
// Reads are public. Writes now require a verified session, and the player's
// identity and display fields come from the session and roster rather than the
// request body. An unreachable database is reported as a 503, never as an
// empty board that would look like "nobody has played yet".
//
// Env:
//   MONGODB_URI - Atlas connection string (required to SAVE a score)
//   MONGODB_DB  - database name (optional, default "compiler2")

import { isEnabled } from '../lib/db/mongo.mjs';
import {
  topScores, submitScore, rateLimitCheck, rateLimitNote, findStudentRow,
} from '../lib/db/repos.mjs';
import { requireSession, rejectCrossOrigin } from '../lib/auth/guard.mjs';

const GAMES = ['compiler_run', 'duck_hunter', 'flappy_bird'];

/* ── Security: session identity, roster data, rate limiting ─────────────
   - A score is now tied to a VERIFIED SESSION, not to an NU ID typed into the
     request body. The actor's roll number comes from the session the server
     minted after mailbox verification; body identity fields are ignored.
   - The display fields (name, section, department, batch) come from the
     server's roster row, so a client cannot write a fake name onto the board.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching the database, and the `rate_limit` collection enforces
     the same window across instances. */
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

function gameOf(req, body) {
  const raw = String((body && body.game) || (req.query && req.query.game) || 'compiler_run').toLowerCase();
  return GAMES.includes(raw) ? raw : 'compiler_run';
}

export default async function handler(req, res) {
  // No wildcard CORS any more: the app is same-origin, and a wildcard would be
  // meaningless (and unsafe) once the identity is a cookie.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      // Public read. A database outage is caught below and answered with 503.
      return res.status(200).json({ leaderboard: await topScores(gameOf(req, null)) });
    }

    if (req.method === 'POST') {
      if (rejectCrossOrigin(req, res)) return;

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
      const numericScore = Math.floor(Number(body?.score));
      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 1000000) {
        return res.status(400).json({ error: 'score must be a valid number' });
      }

      // 1) Identity is the session the server minted after mailbox
      //    verification. Body fields like nuid/name are ignored on purpose.
      const session = await requireSession(req, res);
      if (!session) return;
      const key = session.account.nuid;

      // 2) Display data is read from the roster, so a client cannot put a fake
      //    name or section on the board.
      const row = await findStudentRow(key);
      if (!row) {
        return res.status(403).json({
          error: 'not_on_roster',
          message: 'Your NU ID is verified, but it is not on the published roster yet.',
        });
      }

      // 3) Rate limit: reject spam fast (in-process) and across instances.
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

      // 4) Save. One atomic conditional upsert - no read-modify-write, so
      //    concurrent submissions cannot clobber each other and there is
      //    nothing left to retry.
      const { improved, leaderboard } = await submitScore(game, {
        nuid: key,
        name: String(row.name || 'Unknown').slice(0, 60),
        section: String(row.section || '-').slice(0, 10),
        department: String(row.department || '-').slice(0, 20),
        batch: String(row.batch || '-').slice(0, 8),
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
