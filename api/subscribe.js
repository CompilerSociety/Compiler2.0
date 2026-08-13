// Vercel Node serverless function.
// Stores a push subscription (+ NU ID) in db/metadata/notifications/push-subscriptions.json in the repo
// via the GitHub Contents API, because Vercel's own filesystem is read-only.
//
// Required environment variables (set in Vercel project settings):
//   GH_TOKEN  - GitHub token with "contents: write" on the repo
//   GH_REPO   - "owner/name" (optional, defaults below)
//   GH_BRANCH - branch to write to (optional, default "main")

const SUBS_PATH = 'db/metadata/notifications/push-subscriptions.json';

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
      const record = { nuid, name, department, batch, section, subscription, updated_at: Date.now() };
      // A POST that names no preferences must not wipe the ones already stored:
      // the profile re-subscribes on plain "enable notifications" too, and that
      // path should leave an existing choice alone.
      const merged = { ...(existing?.prefs || {}), ...(prefs || {}) };
      if (Object.keys(merged).length) record.prefs = merged;
      filtered.push(record);
      try {
        await ghPut(token, filtered, sha);
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
