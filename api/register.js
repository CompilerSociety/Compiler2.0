// Vercel Node serverless function: POST /api/register
//
// Writes a newly created student profile into db/students/<batch>.json via the
// GitHub Contents API. Called the moment someone finishes the registration
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
//   GH_TOKEN  - GitHub token with "contents: write" on the repo
//   GH_REPO   - "owner/name" (optional, defaults below)
//   GH_BRANCH - branch to write to (optional, default "main")

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
   - Per-IP rate limiting, in-process for bursts plus a repo-backed window
     shared with /api/subscribe.

   These helpers are duplicated from api/subscribe.js rather than shared in a
   lib/ module because Vercel only bundles each function's own directory. Keep
   the copies in step. */

const NUID_RE = /^(\d{2})[A-Za-z]{1,4}-\d{4}$/;
const RATE_LIMIT_PATH = 'db/metadata/rate-limit.json';
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_MIN = 5;
const rosterPath = (batch) => `db/students/${batch}.json`;

const _burst = new Map(); // ip -> { t, count } (in-process only)

function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
function branch() { return process.env.GH_BRANCH || 'main'; }

function authError(status) {
  const err = new Error(
    `GitHub rejected GH_TOKEN (${status}). The token is missing, expired, ` +
    `revoked, or lacks contents:write on the repo.`
  );
  err.isAuthFailure = true;
  return err;
}

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

// Best effort — bookkeeping must never fail a request that already succeeded.
async function noteSuccessfulWrite(token, ip) {
  try {
    const state = await readRateLimitState();
    const now = Date.now();
    const list = (state[ip] || []).filter((t) => now - t < RATE_WINDOW_MS);
    list.push(now);
    state[ip] = list;
    const res = await fetch(`https://api.github.com/repos/${repo()}/contents/${RATE_LIMIT_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'compiler2-rate-limit',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update rate-limit state',
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
        branch: branch(),
      }),
    });
    if (!res.ok) throw new Error(`write rate-limit state failed (${res.status})`);
  } catch (err) {
    console.error('rate-limit bookkeeping:', err?.message);
  }
}

// Append a student to db/students/<batch>.json.
// Returns 'added' when a row was written, 'exists' when the roll no was
// already on the roster (which is a success for the caller, not an error).
async function appendToRoster(token, batch, student) {
  const url = `https://api.github.com/repos/${repo()}/contents/${rosterPath(batch)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'compiler2-register',
  };
  // Retry: a concurrent registration moves the file sha out from under the PUT.
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await fetch(`${url}?ref=${branch()}`, { headers });
    if (read.status === 401 || read.status === 403) throw authError(read.status);
    let doc = {};
    let sha = null;
    if (read.status !== 404) {
      if (!read.ok) throw new Error(`read roster failed (${read.status})`);
      const meta = await read.json();
      sha = meta.sha;
      try {
        const parsed = JSON.parse(Buffer.from(meta.content || '', 'base64').toString('utf-8'));
        if (parsed && typeof parsed === 'object') doc = parsed;
      } catch { doc = {}; }
    }
    const students = Array.isArray(doc.students) ? doc.students : [];
    if (students.some((s) => String(s?.nuid || '').trim().toUpperCase() === student.nuid)) {
      return 'exists';
    }
    students.push({
      ...student,
      // Same shape as a seating-plan row, so every downstream reader
      // (send-seating-push, the profile tabs) treats the two identically.
      paper: '', time: '', class: '', seat: '',
      self_registered: true,
      added_at: new Date().toISOString(),
    });
    const next = {
      ...doc,
      updated_at: new Date().toISOString(),
      source_subject: doc.source_subject || `Self-registered ${batch}`,
      count: students.length,
      students,
    };
    const put = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Register ${student.nuid} in the ${batch} roster`,
        content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64'),
        branch: branch(),
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.status === 401 || put.status === 403) throw authError(put.status);
    if (put.ok) return 'added';
    if (attempt === 2) throw new Error(`write roster failed (${put.status})`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Could not write the roster');
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
    const retryAfter = await persistentBlocked(ip);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: "You're sending requests too quickly. Wait a moment and try again.",
      });
    }

    const token = process.env.GH_TOKEN;
    if (!token) {
      // `message` is shown to the user, so it stays plain and blameless.
      // `detail` carries the operator-facing cause.
      return res.status(503).json({
        ok: false,
        error: 'register_unavailable',
        message: "Your profile couldn't be published right now — this is on us, not you.",
        detail: 'GH_TOKEN is not set on the server.',
      });
    }

    const result = await appendToRoster(token, batch, { name, nuid, section, department, batch });
    if (result === 'added') {
      await noteSuccessfulWrite(token, ip);
      console.log(`registered ${nuid} in ${rosterPath(batch)}`);
    }
    return res.status(200).json({ ok: true, batch, added: result === 'added' });
  } catch (err) {
    console.error('register API error:', err);
    if (err?.isAuthFailure) {
      return res.status(503).json({
        ok: false,
        error: 'register_unavailable',
        message: "Your profile couldn't be published right now — this is on us, not you.",
        detail: err.message,
      });
    }
    return res.status(500).json({ ok: false, error: 'Internal error', message: err?.message || String(err) });
  }
}
