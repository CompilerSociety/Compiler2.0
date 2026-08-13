#!/usr/bin/env node
/**
 * Local dev server — the closest thing to the deployed site without deploying.
 *
 *     node scripts/devserver.mjs [port]        # default 8000
 *
 * Why this exists alongside devserver.py: that one serves static files only,
 * so two things silently misbehave locally in ways they never do in production.
 *
 *   1. vercel.json rewrites the flat /db/*.json names the app actually asks
 *      for onto their real nested paths (/db/leaderboard.json ->
 *      db/games/leaderboards/compiler-run.json, and 20-odd others). Without
 *      them the leaderboards, seating plan and exam schedules 404 and the app
 *      shows its "could not load" fallbacks — which looks like a bug in the
 *      feature you are testing.
 *   2. /api/* never runs, so leaderboards, score submission, notification
 *      sign-up and the live timetable all fall back or fail.
 *
 * This server reads the rewrite table STRAIGHT OUT OF vercel.json rather than
 * restating it, so it cannot drift from production, and it executes the real
 * api/*.js handlers in-process behind a small Vercel-shaped req/res shim.
 *
 * Request order matches Vercel: functions, then real files, then rewrites.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

// ── vercel.json rewrites, compiled ──────────────────────────────────────
// Sources are either literal ("/db/22.json") or end in a ":name*" wildcard
// ("/css/:path*"). Order is preserved: Vercel takes the first match, and the
// final "/:path*" catch-all is what serves the SPA shell for deep links.
function loadRewrites() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  } catch (err) {
    console.error('Could not read vercel.json —', err.message);
    return [];
  }
  return (cfg.rewrites || []).map(({ source, destination }) => {
    const wildcard = source.match(/^(.*?):([A-Za-z_]\w*)\*$/);
    if (wildcard) {
      const prefix = wildcard[1];
      return { test: (p) => (p.startsWith(prefix) ? p.slice(prefix.length) : null),
               to: (rest) => destination.replace(/:[A-Za-z_]\w*\*/, rest) };
    }
    return { test: (p) => (p === source ? '' : null), to: () => destination };
  });
}
const REWRITES = loadRewrites();

const safeJoin = (rel) => {
  // Contain everything under the repo: a path that escapes it is a traversal.
  const full = path.resolve(ROOT, '.' + decodeURIComponent(rel));
  return full.startsWith(ROOT) ? full : null;
};
const fileAt = (rel) => {
  const full = safeJoin(rel);
  if (!full) return null;
  try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
};

function sendFile(res, full) {
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
    // Never cache during development: the whole point is seeing your last edit.
    'Cache-Control': 'no-store, must-revalidate',
  });
  fs.createReadStream(full).pipe(res);
}

// ── /api/* — run the real handlers ──────────────────────────────────────
// Vercel hands the handler a Node req/res with a few extras bolted on
// (req.query, parsed req.body, res.status().json()). Recreate just those.
async function runApi(name, req, res, query) {
  const file = path.join(ROOT, 'api', `${name}.js`);
  if (!fs.existsSync(file)) return false;

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  req.query = query;
  req.body = raw;
  if (raw && (req.headers['content-type'] || '').includes('json')) {
    try { req.body = JSON.parse(raw); } catch { /* handlers re-parse strings */ }
  }

  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => { res.end(typeof body === 'string' ? body : JSON.stringify(body)); return res; };

  // Cache-bust the module so an edit to api/*.js is picked up without a restart.
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  await mod.default(req, res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const [rawPath, search = ''] = req.url.split('?');
  const pathname = rawPath.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams(search));

  try {
    // 1. Functions win, exactly as they do on Vercel.
    if (pathname.startsWith('/api/')) {
      const name = pathname.slice(5).split('/')[0];
      if (await runApi(name, req, res, query)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `No api/${name}.js` }));
    }

    // 2. A real file at the literal path (this is how /db/timetables/*.json,
    //    already correct in the source, get served).
    const direct = fileAt(pathname);
    if (direct) return sendFile(res, direct);

    // 3. Otherwise the rewrite table, first match wins.
    for (const rule of REWRITES) {
      const rest = rule.test(pathname);
      if (rest === null) continue;
      const target = fileAt(rule.to(rest));
      if (target) return sendFile(res, target);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 ${pathname}`);
  } catch (err) {
    console.error(`500 ${pathname}:`, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || [])
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

// 0.0.0.0 so a phone on the same Wi-Fi can reach it.
server.listen(PORT, '0.0.0.0', () => {
  const api = fs.existsSync(path.join(ROOT, 'api'))
    ? fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).map((f) => '/api/' + f.replace(/\.js$/, ''))
    : [];
  console.log(`\n  V Table dev server\n`);
  console.log(`  desktop   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  phone     http://${ip}:${PORT}`);
  console.log(`\n  rewrites  ${REWRITES.length} loaded from vercel.json`);
  console.log(`  api       ${api.join(' ') || '(none)'}`);
  if (!process.env.GH_TOKEN) {
    console.log(`\n  note      GH_TOKEN is not set, so anything that WRITES to the repo`);
    console.log(`            (score submission, notification sign-up) returns 503.`);
    console.log(`            Reads — leaderboards, rosters, timetables — work.`);
  }
  console.log(`\n  On a phone over http:// there is no service worker and no`);
  console.log(`  notifications (not a secure context). To test those on a real`);
  console.log(`  device, use Chrome's port forwarding — see scripts/devserver.mjs.\n`);
});

/* ── Testing notifications / install on a REAL phone ──────────────────────
   Push, the service worker and "Add to home screen" all require a secure
   context. http://localhost qualifies; http://192.168.x.x does not, so over
   plain Wi-Fi those paths stay dark no matter what the code does.

   Chrome's port forwarding fixes it without certificates or a tunnel: the
   phone reaches the server AS localhost, so it counts as secure.

     1. Phone: Settings > Developer options > USB debugging, then plug it in.
     2. Desktop Chrome: chrome://inspect/#devices > Port forwarding…
     3. Add   8000  ->  localhost:8000   and tick "Enable port forwarding".
     4. On the phone open http://localhost:8000

   Failing that, `npx cloudflared tunnel --url http://localhost:8000` gives a
   throwaway https:// URL that works on any device. */
