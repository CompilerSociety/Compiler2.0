// api/leaderboard.js
// Vercel serverless function backing the Compiler Run shared leaderboard.
//
// Persistence: db/games/leaderboards/compiler-run.json in the GitHub repo, read/written via the
// GitHub Contents API (same pattern as api/subscribe.js) — Vercel's own
// filesystem is read-only and /tmp is wiped on cold starts/redeploys, so the
// repo file is the durable store. Keeps each player's best score; serves the
// top 10.
//
// Env (already configured for subscriptions): GH_TOKEN, optional GH_REPO /
// GH_BRANCH.

const MAX_ENTRIES = 10;
// Each game has its OWN leaderboard JSON file in the repo.
const LB_FILES = {
  compiler_run: 'db/games/leaderboards/compiler-run.json',
  duck_hunter: 'db/games/leaderboards/duck-hunter.json',
  flappy_bird: 'db/games/leaderboards/flappy-bird.json',
};

/* ── Security: input validation, identity check, rate limiting ──────────
   These helpers are duplicated here and in api/subscribe.js rather than shared
   in a lib/ module because Vercel only bundles each function's own directory.
   Keep the two copies in step.

   - NUID_RE is the ONLY thing that decides what keys enter db.players, so it
     also blocks prototype-pollution keys like "__proto__" / "constructor".
   - The identity check requires the NU ID to exist in the published roster for
     its batch (db/students/<batch>.json), which stops anonymous spoofing of
     fake names/NU IDs. It fails OPEN if the roster cannot be fetched so a
     GitHub blip can't take the feature down.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching GitHub, and a small state file in the repo
     (db/metadata/rate-limit.json) enforces the same window across instances. */
// The leading 2 digits are CAPTURED: rosterLookup reads m[1] to pick the
// db/students/<batch>.json roster. Without the group m[1] is undefined for
// every well-formed ID, so every lookup fetched .../students/undefined.json,
// 404'd, and rejected the user with "No roster found for batch undefined".
const NUID_RE = /^(\d{2})[A-Za-z]{1,4}-\d{4}$/;
const RATE_LIMIT_PATH = 'db/metadata/rate-limit.json';
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

async function readRateLimitState() {
  const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/${RATE_LIMIT_PATH}?t=${Date.now()}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'compiler2-rate-limit' } });
    if (res.status === 404) return {};
    if (!res.ok) return {};
    const parsed = JSON.parse(await res.text());
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

// Persistent per-IP window check. Returns seconds to wait, or null if clear.
async function persistentBlocked(ip) {
  const state = await readRateLimitState();
  const now = Date.now();
  const ts = (state[ip] || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (ts.length >= MAX_WRITES_PER_MIN) {
    const oldest = Math.min(...ts);
    return Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000);
  }
  return null;
}

// Record a successful write (best effort — bookkeeping must never fail the
// request that already wrote the score).
async function noteSuccessfulWrite(token, ip) {
  try {
    const state = await readRateLimitState();
    const now = Date.now();
    const list = (state[ip] || []).filter((t) => now - t < RATE_WINDOW_MS);
    list.push(now);
    state[ip] = list;
    const url = `https://api.github.com/repos/${repo()}/contents/${RATE_LIMIT_PATH}`;
    const body = {
      message: 'Update rate-limit state',
      content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
      branch: branch(),
    };
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'compiler2-rate-limit',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) throw authError(res.status);
    if (!res.ok) throw new Error(`write rate-limit state failed (${res.status})`);
  } catch (err) {
    console.error('rate-limit bookkeeping:', err?.message);
  }
}

let _rosterCache = { batch: null, set: null, fetchedAt: 0 };

// Identity check: the NU ID must match NUID_RE and exist in its batch roster.
// Returns { status: null } when allowed; otherwise { status, error, message }.
async function rosterLookup(nuid) {
  const m = NUID_RE.exec(nuid);
  if (!m) {
    return { status: 400, error: 'invalid_nuid', message: 'NU ID must look like 22I-0507.' };
  }
  const batch = m[1];
  if (!_rosterCache.batch || _rosterCache.batch !== batch || Date.now() - _rosterCache.fetchedAt > 600_000) {
    const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/db/students/${batch}.json?t=${Date.now()}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'compiler2-identity' } });
      if (res.status === 404) {
        return { status: 403, error: 'unknown_batch', message: `No roster found for batch ${batch}.` };
      }
      if (!res.ok) throw new Error(`roster fetch failed (${res.status})`);
      const data = await res.json();
      const set = new Set((data.students || []).map((s) => String(s.nuid).trim().toUpperCase()));
      _rosterCache = { batch, set, fetchedAt: Date.now() };
    } catch (err) {
      console.error('roster lookup failed, failing open:', err?.message);
      return { status: null, error: null, message: null }; // fail-open
    }
  }
  if (!_rosterCache.set.has(nuid)) {
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
  return LB_FILES[raw] ? raw : 'compiler_run';
}

function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
function branch() { return process.env.GH_BRANCH || 'main'; }

// Reading needs no credentials: the repo is public and these files are
// committed, so raw.githubusercontent serves them directly. Reads used to go
// through the authenticated Contents API, which meant a stale or revoked
// GH_TOKEN took every leaderboard down with a 500 even though the scores were
// sitting in a public file. Only writing a new score needs the token now.
async function readPublic(file) {
  const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/${file}?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'compiler2-leaderboard', 'Cache-Control': 'no-cache' },
  });
  if (res.status === 404) return emptyDB();
  if (!res.ok) throw new Error(`public read failed (${res.status})`);
  return normalizeDB(JSON.parse(await res.text()));
}

// GitHub rejecting the credential is a server misconfiguration, not a blip.
// Tagging it lets the handler say so plainly instead of returning a generic
// 500 that the UI can only report as "could not submit score".
function authError(status) {
  const err = new Error(
    `GitHub rejected GH_TOKEN (${status}). The token is missing, expired, ` +
    `revoked, or lacks contents:write on the repo.`
  );
  err.isAuthFailure = true;
  return err;
}

async function ghGet(token, file) {
  const url = `https://api.github.com/repos/${repo()}/contents/${file}?ref=${branch()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'compiler2-leaderboard',
    },
  });
  if (res.status === 404) return { db: emptyDB(), sha: null };
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok) throw new Error(`read leaderboard failed (${res.status})`);
  const data = await res.json();
  let db = emptyDB();
  try {
    db = normalizeDB(JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf-8')));
  } catch { db = emptyDB(); }
  return { db, sha: data.sha };
}

async function ghPut(token, file, db, sha) {
  const url = `https://api.github.com/repos/${repo()}/contents/${file}`;
  const body = {
    message: 'Update Compiler Run leaderboard',
    content: Buffer.from(JSON.stringify(db, null, 2) + '\n').toString('base64'),
    branch: branch(),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'compiler2-leaderboard',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok) throw new Error(`write leaderboard failed (${res.status})`);
}

function emptyDB() {
  return { players: {}, leaderboard: [] };
}

function normalizeDB(parsed) {
  return {
    players: (parsed && parsed.players) || {},
    leaderboard: Array.isArray(parsed && parsed.leaderboard) ? parsed.leaderboard : [],
  };
}

function rebuildLeaderboard(players) {
  return Object.values(players)
    .sort((a, b) => {
      if (b.highScore !== a.highScore) return b.highScore - a.highScore;
      // Tied scores: earlier achievedAt ranks higher.
      return new Date(a.achievedAt).getTime() - new Date(b.achievedAt).getTime();
    })
    .slice(0, MAX_ENTRIES);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const token = process.env.GH_TOKEN;

    if (req.method === 'GET') {
      const file = LB_FILES[gameOf(req, null)];
      try {
        const db = await readPublic(file);
        return res.status(200).json({ leaderboard: db.leaderboard });
      } catch (publicErr) {
        // Only worth trying the authenticated path if a token exists at all.
        if (!token) throw publicErr;
        const { db } = await ghGet(token, file);
        return res.status(200).json({ leaderboard: db.leaderboard });
      }
    }

    // Writing a score does need the token: it commits back to the repo.
    if (!token) {
      // `message` is shown to the player, so it stays plain and blameless.
      // `detail` carries the operator-facing cause.
      return res.status(503).json({
        error: 'leaderboard_read_only',
        message: "Scores can't be saved right now — this is on us, not you.",
        detail: 'GH_TOKEN is not set on the server.',
      });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const file = LB_FILES[gameOf(req, body)];
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
      const identity = await rosterLookup(key);
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
      const retryAfter = await persistentBlocked(ip);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'rate_limited',
          message: "You're sending requests too quickly. Wait a moment and try again.",
        });
      }

      // Retry a few times: concurrent submissions change the file sha.
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { db, sha } = await ghGet(token, file);
        const existing = db.players[key];

        if (existing && numericScore <= existing.highScore) {
          // Not a new personal best — nothing to write, return current board.
          return res.status(200).json({ leaderboard: db.leaderboard, improved: false });
        }

        db.players[key] = {
          nuid: key,
          name: (name && String(name).slice(0, 60)) || existing?.name || 'Unknown',
          section: (section && String(section).slice(0, 10)) || existing?.section || '-',
          department: (department && String(department).slice(0, 20)) || existing?.department || '-',
          batch: (batch && String(batch).slice(0, 8)) || existing?.batch || '-',
          highScore: numericScore,
          achievedAt: new Date().toISOString(),
        };
        db.leaderboard = rebuildLeaderboard(db.players);

        try {
          await ghPut(token, file, db, sha);
          await noteSuccessfulWrite(token, ip);
          return res.status(200).json({ leaderboard: db.leaderboard, improved: true });
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      throw lastErr || new Error('Could not save score');
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error('leaderboard API error:', err);
    if (err?.isAuthFailure) {
      // 503, not 500: the service is fine, its credential is not. The client
      // shows this message verbatim so the cause is visible rather than hiding
      // behind a generic failure.
      return res.status(503).json({
        error: 'leaderboard_read_only',
        message: "Scores can't be saved right now — this is on us, not you.",
        detail: err.message,
      });
    }
    return res.status(500).json({
      error: 'Internal error',
      message: err?.message || String(err),
    });
  }
}
