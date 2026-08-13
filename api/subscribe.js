// Vercel Node serverless function.
// Stores a push subscription (+ NU ID) in db/metadata/notifications/push-subscriptions.json in the repo
// via the GitHub Contents API, because Vercel's own filesystem is read-only.
//
// Required environment variables (set in Vercel project settings):
//   GH_TOKEN  - GitHub token with "contents: write" on the repo
//   GH_REPO   - "owner/name" (optional, defaults below)
//   GH_BRANCH - branch to write to (optional, default "main")

const SUBS_PATH = 'db/metadata/notifications/push-subscriptions.json';

/* ── Security: input validation, identity check, rate limiting ──────────
   These helpers are duplicated here and in api/leaderboard.js rather than
   shared in a lib/ module because Vercel only bundles each function's own
   directory. Keep the two copies in step.

   - NUID_RE requires a well-formed NU ID, which also rules out junk keys.
   - The identity check requires the NU ID to exist in the published roster for
     its batch (db/students/<batch>.json), so nobody can attach another
     student's identity to a device or flood the file with fake records. It
     fails OPEN if the roster cannot be fetched so a GitHub blip can't take
     notifications down.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching GitHub, and a small state file in the repo
     (db/metadata/rate-limit.json) enforces the same window across instances. */
const NUID_RE = /^\d{2}[A-Za-z]{1,4}-\d{4}$/;
const RATE_LIMIT_PATH = 'db/metadata/rate-limit.json';
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
// request that already saved the subscription).
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

function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
function branch() { return process.env.GH_BRANCH || 'main'; }

// GitHub rejecting the credential is a server misconfiguration, not a blip —
// tagged so the handler can say so plainly instead of a bare "HTTP 500" (see
// api/leaderboard.js, which hit the same failure mode against the same token).
function authError(status) {
  const err = new Error(
    `GitHub rejected GH_TOKEN (${status}). The token is missing, expired, ` +
    `revoked, or lacks contents:write on the repo.`
  );
  err.isAuthFailure = true;
  return err;
}

async function ghGet(token) {
  const url = `https://api.github.com/repos/${repo()}/contents/${SUBS_PATH}?ref=${branch()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'compiler2-push-subscribe',
    },
  });
  if (res.status === 404) return { subs: [], sha: null };
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok) throw new Error(`read subscriptions failed (${res.status})`);
  const data = await res.json();
  let subs = [];
  try {
    subs = JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf-8'));
    if (!Array.isArray(subs)) subs = [];
  } catch { subs = []; }
  return { subs, sha: data.sha };
}

async function ghPut(token, subs, sha) {
  const url = `https://api.github.com/repos/${repo()}/contents/${SUBS_PATH}`;
  const body = {
    message: 'Update push subscriptions',
    content: Buffer.from(JSON.stringify(subs, null, 2)).toString('base64'),
    branch: branch(),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'compiler2-push-subscribe',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw authError(res.status);
  if (!res.ok) throw new Error(`write subscriptions failed (${res.status})`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
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

    // 1) Format + identity: only a real student on the published roster can
    //    attach a device, and only with a well-formed NU ID.
    const identity = await rosterLookup(nuid);
    if (identity.status) {
      return res.status(identity.status).json({ ok: false, error: identity.error, message: identity.message });
    }

    // 2) Rate limit: reject spam fast (in-process) and across instances.
    const ip = clientIp(req);
    if (!burstAllowed(ip)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: "You're sending requests too quickly. Wait a minute and try again.",
      });
    }
    const retryAfter = await persistentBlocked(ip);
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

    const token = process.env.GH_TOKEN;
    if (!token) {
      // `message` is shown to the user, so it stays plain and blameless.
      // `detail` carries the operator-facing cause.
      return res.status(503).json({
        ok: false,
        error: 'subscribe_unavailable',
        message: "Notifications can't be enabled right now — this is on us, not you.",
        detail: 'GH_TOKEN is not set on the server.',
      });
    }

    // Retry a couple of times: a concurrent subscribe changes the file sha.
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { subs, sha } = await ghGet(token);
      const existing = subs.find((s) => s?.subscription?.endpoint === subscription.endpoint);
      const filtered = subs.filter((s) => s?.subscription?.endpoint !== subscription.endpoint);
      // A POST that names no preferences must not wipe the ones already stored:
      // the profile re-subscribes on plain "enable notifications" too, and that
      // path should leave an existing choice alone.
      const merged = { ...(existing?.prefs || {}), ...(prefs || {}) };
      if (Object.keys(merged).length) record.prefs = merged;
      filtered.push(record);
      try {
        await ghPut(token, filtered, sha);
        await noteSuccessfulWrite(token, ip);
        return res.status(200).json({ ok: true, count: filtered.length });
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw lastErr || new Error('Could not save subscription');
  } catch (err) {
    console.error('subscribe API error:', err);
    if (err?.isAuthFailure) {
      return res.status(503).json({
        ok: false,
        error: 'subscribe_unavailable',
        message: "Notifications can't be enabled right now — this is on us, not you.",
        detail: err.message,
      });
    }
    return res.status(500).json({
      ok: false,
      error: 'Internal error',
      message: err?.message || String(err),
    });
  }
}
