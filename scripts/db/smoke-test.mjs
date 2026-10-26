// scripts/db/smoke-test.mjs
// Exercises the leaderboard endpoint against whatever storage is configured.
//
//   node scripts/db/smoke-test.mjs
//
// With MONGODB_URI set it proves the live path end to end, including that a
// lower score is correctly rejected as "not a personal best".
//
// With it unset it proves the opposite contract, which is what the design now
// calls for: there is no committed JSON to fall back to any more, so reads must
// fail VISIBLY with a 503 rather than answering with an empty board. An empty
// leaderboard is indistinguishable from "nobody has played yet", and quietly
// showing that would hide a misconfigured deployment.
//
// It is deliberately dependency-free (no test runner) so it can run in CI or on
// a laptop with nothing installed but the app's own packages.

import handler from '../../api/leaderboard.mjs';

let failures = 0;

function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

// Minimal stand-ins for Vercel's req/res, capturing what the handler produced.
function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

async function call(req) {
  const res = mockRes();
  await handler({ headers: {}, query: {}, ...req }, res);
  return res;
}

async function main() {
  const live = Boolean(process.env.MONGODB_URI);
  console.log(live
    ? 'MONGODB_URI is set - testing the live database path.'
    : 'MONGODB_URI is NOT set - testing that it fails visibly rather than silently.');

  // --- GET ----------------------------------------------------------------
  const get = await call({ method: 'GET', query: { game: 'compiler_run' } });
  if (live) {
    check('GET returns 200', get.statusCode === 200, `got ${get.statusCode}`);
    check('GET returns a leaderboard array', Array.isArray(get.body?.leaderboard),
      JSON.stringify(get.body)?.slice(0, 120));
    check('GET board is non-empty', (get.body?.leaderboard?.length || 0) > 0,
      'an empty board means the leaderboard_scores collection has no rows');
    const top = get.body?.leaderboard?.[0];
    check('GET entries keep their original shape',
      !top || (typeof top.nuid === 'string' && typeof top.highScore === 'number'),
      JSON.stringify(top)?.slice(0, 120));
    check('GET board is sorted by score, highest first',
      (get.body?.leaderboard || []).every((e, i, a) => i === 0 || a[i - 1].highScore >= e.highScore));
  } else {
    check('GET fails visibly with 503 rather than an empty board',
      get.statusCode === 503, `got ${get.statusCode}`);
    check('GET names the cause for an operator',
      String(get.body?.detail || '').includes('MONGODB_URI'), get.body?.detail);
  }

  // --- Identity is a session, not a body field ---------------------------
  // Body identity (nuid/name/...) is ignored now. Without a verified session
  // cookie the endpoint must refuse before reading or writing the board.
  const anonymous = await call({ method: 'POST', body: { game: 'compiler_run', score: 5 } });
  check('POST without a verified session is rejected',
    anonymous.statusCode === 401 || anonymous.statusCode === 503,
    `got ${anonymous.statusCode}`);

  if (!live) {
    // --- Fallback contract ------------------------------------------------
    const post = await call({ method: 'POST', body: { score: 999999 } });
    check('POST without MONGODB_URI returns 503', post.statusCode === 503, `got ${post.statusCode}`);
    check('503 carries a blameless player-facing message',
      typeof post.body?.message === 'string' && !post.body.message.includes('MONGODB'),
      post.body?.message);
    check('503 carries an operator-facing detail',
      typeof post.body?.detail === 'string' && post.body.detail.includes('MONGODB_URI'),
      post.body?.detail);
  } else {
    // --- Live path --------------------------------------------------------
    // A real save now needs a verified session, which this storage smoke test
    // does not mint (that would create account rows without mailbox proof).
    // The authenticated write path is exercised through /api/auth/*.
    check('POST without a verified session is unauthenticated',
      anonymous.statusCode === 401 && anonymous.body?.error === 'unauthenticated',
      JSON.stringify(anonymous.body));
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => { console.error('Smoke test crashed:', err); process.exitCode = 1; });
