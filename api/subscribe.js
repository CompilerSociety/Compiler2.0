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
   - The identity step reads the published roster for the ID's batch
     (db/students/<batch>.json). A roll no that is NOT on it is ENROLLED
     rather than rejected: the roster only ever holds whoever the seating-plan
     email happened to name, so it lags every new intake (26.json held 3
     students while the whole 26 batch was trying to sign up) and a hard gate
     locked out real students with no way in. See enrolInRoster for what that
     write is and is not allowed to do.
   - Rate limiting is per-IP: an in-process burst guard rejects fast repeats
     without touching GitHub, and a small state file in the repo
     (db/metadata/rate-limit.json) enforces the same window across instances.
     The identity step runs AFTER it, so the roster write is rate-limited too. */
// The leading 2 digits are CAPTURED: they select db/students/<batch>.json.
// Without the group m[1] is undefined for every well-formed ID, so every
// lookup fetched .../students/undefined.json, 404'd, and rejected the user
// with "No roster found for batch undefined".
const NUID_RE = /^(\d{2})[A-Za-z]{1,4}-\d{4}$/;
const rosterPath = (batch) => `db/students/${batch}.json`;
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

// Is this NU ID already on its batch roster?
//
// Returns true/false, or null when the roster could not be read at all. null
// means "don't know", and the caller treats it as "already there" so a GitHub
// blip neither blocks sign-up nor appends a duplicate on a half-read file.
// A 404 is NOT unknown — it means this batch has no roster file yet (a brand
// new intake), which is a definite "not on it" and the file gets created.
async function rosterHas(batch, nuid) {
  const fresh = _rosterCache.batch === batch && Date.now() - _rosterCache.fetchedAt <= 600_000;
  if (!fresh) {
    const url = `https://raw.githubusercontent.com/${repo()}/${branch()}/${rosterPath(batch)}?t=${Date.now()}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'compiler2-identity' } });
      if (res.status === 404) {
        _rosterCache = { batch, set: new Set(), fetchedAt: Date.now() };
        return false;
      }
      if (!res.ok) throw new Error(`roster fetch failed (${res.status})`);
      const data = await res.json();
      const set = new Set((data.students || []).map((s) => String(s.nuid).trim().toUpperCase()));
      _rosterCache = { batch, set, fetchedAt: Date.now() };
    } catch (err) {
      console.error('roster read failed, treating as known:', err?.message);
      return null;
    }
  }
  return _rosterCache.set.has(nuid);
}

// Append a self-registered student to db/students/<batch>.json.
//
// Deliberately append-only. An existing row is never edited or replaced, so a
// caller cannot overwrite a real roster entry (name, section, or an assigned
// seat) by re-POSTing someone else's roll no — the worst they can do is add a
// row that was not there. Rows carry self_registered:true so a later
// seating-plan import can tell them apart from mail-sourced ones and
// reconcile or prune them.
//
// The caller has already rate-limited this IP, and isValidEndpoint means a
// real browser push subscription had to be minted first, which is what keeps
// this from being a trivially scriptable way to stuff the file.
async function enrolInRoster(token, batch, student) {
  const url = `https://api.github.com/repos/${repo()}/contents/${rosterPath(batch)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'compiler2-roster-enrol',
  };
  // Retry: a concurrent enrolment moves the file sha out from under this PUT.
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
      return false; // someone else added them between the read and now
    }
    students.push({
      ...student,
      // Same shape as a seating-plan row so every downstream reader
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
        message: `Enrol ${student.nuid} in the ${batch} roster`,
        content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64'),
        branch: branch(),
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.status === 401 || put.status === 403) throw authError(put.status);
    if (put.ok) {
      // Keep the warm cache in step so an immediate re-POST doesn't try again.
      if (_rosterCache.batch === batch && _rosterCache.set) _rosterCache.set.add(student.nuid);
      return true;
    }
    if (put.status !== 409 && attempt === 2) throw new Error(`write roster failed (${put.status})`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Could not write the roster');
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
    return res.status(503).json({
      ok: false,
      error: 'unsubscribe_unavailable',
      message: "Notifications can't be changed right now — this is on us, not you.",
      detail: 'GH_TOKEN is not set on the server.',
    });
  }

  // Same retry as the POST: a concurrent write moves the file sha.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { subs, sha } = await ghGet(token);
    const kept = subs.filter((s) => s?.subscription?.endpoint !== endpoint);
    const removed = subs.length - kept.length;
    // Already gone — report success rather than 404. Turning something off
    // twice is not an error, and the caller only cares that it is off now.
    if (!removed) return res.status(200).json({ ok: true, removed: 0, count: subs.length });
    try {
      await ghPut(token, kept, sha);
      await noteSuccessfulWrite(token, ip);
      return res.status(200).json({ ok: true, removed, count: kept.length });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr || new Error('Could not remove subscription');
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

    // 4) Identity: on the roster already, or enrol them onto it now.
    //    A roster miss is not a rejection any more — the seating-plan email is
    //    the only thing that ever populates db/students/, so it lags every new
    //    intake and used to lock those students out entirely.
    const known = await rosterHas(rosterBatch, nuid);
    if (known === false) {
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
        const added = await enrolInRoster(token, rosterBatch, {
          name: record.name,
          nuid,
          section: record.section,
          department: record.department,
          batch: rosterBatch,
        });
        if (added) console.log(`enrolled ${nuid} in ${rosterPath(rosterBatch)}`);
      } catch (err) {
        // The subscription is the thing the user asked for; the roster row is
        // bookkeeping. Losing the row must not cost them their alerts, so this
        // is logged and the subscribe continues.
        if (err?.isAuthFailure) throw err;
        console.error('roster enrolment failed, continuing to subscribe:', err?.message);
      }
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
