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

function gameOf(req, body) {
  const raw = String((body && body.game) || (req.query && req.query.game) || 'compiler_run').toLowerCase();
  return LB_FILES[raw] ? raw : 'compiler_run';
}

function repo() { return process.env.GH_REPO || 'Riftwalker23x/Compiler2.0'; }
function branch() { return process.env.GH_BRANCH || 'main'; }

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
    if (!token) {
      return res.status(500).json({ error: 'Server not configured (missing GH_TOKEN)' });
    }

    if (req.method === 'GET') {
      const file = LB_FILES[gameOf(req, null)];
      const { db } = await ghGet(token, file);
      return res.status(200).json({ leaderboard: db.leaderboard });
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

      // Retry a few times: concurrent submissions change the file sha.
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { db, sha } = await ghGet(token, file);
        const key = nuid.trim().toUpperCase();
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
    return res.status(500).json({ error: 'Internal error', message: err?.message || String(err) });
  }
}
