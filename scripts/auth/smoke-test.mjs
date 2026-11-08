// scripts/auth/smoke-test.mjs
// Dependency-free checks for the pure auth helpers plus the anonymous guards on
// protected endpoints (no database, no network).
//
//   node scripts/auth/smoke-test.mjs
//   npm run auth:smoke
//
// The endpoint wiring is exercised separately against a real database; these
// checks pin down the parts that must never be wrong: the NU ID -> mailbox
// rule, the OTP digest binding, the cookie round trip, and the refusal to take
// identity from a request body.

import { parseNuid, maskEmail, normalizeNuid } from '../../lib/auth/nuid.mjs';
import { newOtp, hashOtp, otpMatches, OTP_LENGTH } from '../../lib/auth/otp.mjs';
import {
  randomToken, randomDigits, hashWithPepper, timingSafeEqualHex, validClientNonce,
} from '../../lib/auth/tokens.mjs';
import { parseCookies, serializeCookie, appendSetCookie } from '../../lib/auth/cookies.mjs';
import {
  OTP_DEFAULT_DAILY_MAX, OTP_MAX_DAILY_MAX, OTP_DEFAULT_MAX_PER_IP,
  OTP_MAX_MAX_PER_IP, otpDailyMax, otpMaxPerIp,
} from '../../lib/auth/limits.mjs';
import { emailProvider, emailConfigError } from '../../lib/auth/email-config.mjs';

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

// ── NU ID -> mailbox ────────────────────────────────────────────────────
const isb = parseNuid('25I-0816');
check('Islamabad ID parses', isb.ok === true);
check('derives the confirmed mailbox', isb.email === 'i250816@isb.nu.edu.pk', isb.email);
check('batch comes from the ID', isb.batch === '25', isb.batch);
check('masked email hides the local part', isb.maskedEmail === 'i2***16@isb.nu.edu.pk', isb.maskedEmail);

const messy = parseNuid('  22i-0507  ');
check('normalises case and whitespace', messy.ok && messy.nuid === '22I-0507', messy.nuid);

check('rejects a short serial', parseNuid('25I-081').error === 'invalid_nuid');
check('rejects a three-digit batch', parseNuid('123I-0816').error === 'invalid_nuid');
check('unsupported campus is distinct from malformed', parseNuid('25K-0816').error === 'campus_not_supported');
check('normalizeNuid is pure', normalizeNuid(' 25i-0816 ') === '25I-0816');
check('maskEmail needs an @', maskEmail('nonsense') === '');

// ── OTP digest binding ──────────────────────────────────────────────────
const code = newOtp();
check('code is six digits', code.length === OTP_LENGTH && /^\d+$/.test(code), code);

const base = { challengeId: 'challenge-a', nuid: '25I-0816', code, pepper: 'pepper' };
const hash = hashOtp(base);
check('same input hashes stably', hashOtp(base) === hash);
check('correct code matches', otpMatches({ ...base, expectedHash: hash }) === true);
check('wrong code is rejected', otpMatches({ ...base, code: '000000', expectedHash: hash }) === false);
check('another challenge cannot reuse the digest',
  otpMatches({ ...base, challengeId: 'challenge-b', expectedHash: hash }) === false);
check('another NU ID cannot reuse the digest',
  otpMatches({ ...base, nuid: '22I-0507', expectedHash: hash }) === false);
check('a different pepper changes the digest',
  hashOtp({ ...base, pepper: 'other' }) !== hash);

// ── OTP policy ──────────────────────────────────────────────────────────
check('daily budget defaults when unset', otpDailyMax('') === OTP_DEFAULT_DAILY_MAX);
check('daily budget ignores non-positive values', otpDailyMax('0') === OTP_DEFAULT_DAILY_MAX);
check('daily budget clamps oversized values', otpDailyMax('9999') === OTP_MAX_DAILY_MAX);
check('per-IP limit defaults above the old campus-NAT limit',
  otpMaxPerIp('') === OTP_DEFAULT_MAX_PER_IP && OTP_DEFAULT_MAX_PER_IP > 10);
check('per-IP limit clamps oversized values', otpMaxPerIp('9999') === OTP_MAX_MAX_PER_IP);

// ── Email provider selection ─────────────────────────────────────────────
const savedEmailEnv = {
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  VERCEL: process.env.VERCEL,
};
function restoreEmailEnv() {
  for (const [key, value] of Object.entries(savedEmailEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
for (const key of Object.keys(savedEmailEnv)) delete process.env[key];
check('no provider is selected without credentials', emailProvider() === 'none');

process.env.RESEND_API_KEY = 're_test';
process.env.EMAIL_FROM = 'VTable <no-reply@vtable.site>';
check('Resend is selected from its API key', emailProvider() === 'resend');
check('local development does not require email config', emailConfigError() === null);
process.env.VERCEL = '1';
check('deployed Resend config is accepted', emailConfigError() === null);
delete process.env.EMAIL_FROM;
check('deployed Resend requires a from address', /EMAIL_FROM/.test(emailConfigError() || ''));

delete process.env.RESEND_API_KEY;
process.env.EMAIL_PROVIDER = 'smtp';
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_USER = 'user@example.com';
process.env.SMTP_PASS = 'secret';
process.env.SMTP_FROM = 'VTable <user@example.com>';
check('SMTP is selected when requested', emailProvider() === 'smtp');
check('deployed SMTP config is accepted', emailConfigError() === null);
delete process.env.SMTP_PASS;
check('deployed SMTP requires a password', /SMTP_PASS/.test(emailConfigError() || ''));
restoreEmailEnv();

// ── Tokens ──────────────────────────────────────────────────────────────
check('randomToken is unique', randomToken() !== randomToken());
check('randomDigits has the requested length', randomDigits(6).length === 6);
check('timingSafeEqualHex accepts equal values', timingSafeEqualHex(hash, hash) === true);
const flipped = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
check('timingSafeEqualHex rejects different values', timingSafeEqualHex(hash, flipped) === false);
check('timingSafeEqualHex rejects bad hex', timingSafeEqualHex('zz', 'zz') === false);
check('peppered hash differs from unpeppered', hashWithPepper('x', 'p') !== hashWithPepper('x', ''));

// ── Cookies ─────────────────────────────────────────────────────────────
const header = 'a=1; vtable_session=abc%3D; empty=';
const parsed = parseCookies(header);
check('parses and decodes cookies', parsed.vtable_session === 'abc=' && parsed.a === '1', JSON.stringify(parsed));
check('ignores a valueless entry', parsed.empty === '');
const weird = parseCookies('__proto__=x');
check('does not touch Object.prototype',
  Object.getPrototypeOf(weird) === null && ({}).x === undefined);

const cookie = serializeCookie('vtable_session', 'abc', { maxAge: 60, secure: true });
check('cookie is HttpOnly', cookie.includes('HttpOnly'));
check('cookie is Secure when asked', cookie.includes('Secure'));
check('cookie is SameSite=Lax', cookie.includes('SameSite=Lax'));
check('cookie carries Max-Age', cookie.includes('Max-Age=60'));

const cookies = [];
const mockRes = {
  headers: {},
  getHeader(name) { return this.headers[name]; },
  setHeader(name, value) { this.headers[name] = value; },
};
appendSetCookie(mockRes, 'one=1');
appendSetCookie(mockRes, 'two=2');
cookies.push(...mockRes.headers['Set-Cookie']);
check('appendSetCookie keeps both values', cookies.length === 2, JSON.stringify(cookies));

// ── Protected endpoints fail closed without a session ────────────────────
// With no MONGODB_URI these answer 503 before auth; with a database they
// answer 401 before touching the body. Either way a body-supplied NU ID must
// not be accepted as identity.
const registerHandler = (await import('../../api/register.mjs')).default;
const subscribeHandler = (await import('../../api/subscribe.mjs')).default;
const rosterLookupHandler = (await import('../../api/roster/lookup.mjs')).default;
const requestCodeHandler = (await import('../../api/auth/request-code.mjs')).default;
const { authRateNote } = await import('../../lib/db/repos.mjs');

function endpointRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    getHeader(name) { return this.headers[name]; },
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

async function callEndpoint(handler, method, body, query = {}) {
  const res = endpointRes();
  await handler({ method, headers: {}, body, query }, res);
  return res;
}

const anonRegister = await callEndpoint(registerHandler, 'POST', {
  nuid: '25I-0816', name: 'Someone Else', department: 'CS', section: 'A',
});
check('register ignores body identity without a session',
  anonRegister.statusCode === 401 || anonRegister.statusCode === 503,
  `got ${anonRegister.statusCode}`);
check('register never returns success for an anonymous body identity',
  anonRegister.body?.ok !== true, JSON.stringify(anonRegister.body));

const anonSubscribe = await callEndpoint(subscribeHandler, 'POST', {
  nuid: '25I-0816', department: 'CS', section: 'A',
  subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'x', auth: 'y' } },
});
check('subscribe ignores body identity without a session',
  anonSubscribe.statusCode === 401 || anonSubscribe.statusCode === 503,
  `got ${anonSubscribe.statusCode}`);
check('subscribe never returns success for an anonymous body identity',
  anonSubscribe.body?.ok !== true, JSON.stringify(anonSubscribe.body));

const anonLookup = await callEndpoint(rosterLookupHandler, 'GET', undefined, {
  nuid: '25I-0816',
});
check('roster lookup refuses requests without a verified session',
  anonLookup.statusCode === 401 || anonLookup.statusCode === 503,
  `got ${anonLookup.statusCode}`);
check('roster lookup never returns a student anonymously',
  anonLookup.body?.found !== true && anonLookup.body?.ok !== true,
  JSON.stringify(anonLookup.body));

// ── Browser-generated OTP nonce ────────────────────────────────────────
// The browser makes its own nonce so a lost request-code reply cannot strand
// a code that was already emailed.
check('accepts a 32-char base64url client nonce', validClientNonce('A'.repeat(32)) === 'A'.repeat(32));
check('rejects a short client nonce', validClientNonce('abc') === '');
check('rejects a client nonce with other characters', validClientNonce(`${'A'.repeat(30)}=;`) === '');

// ── Mail failures: only a clear refusal counts as "nothing sent" ───────────
{
  const { sendOtpEmail } = await import('../../lib/auth/mailer.mjs');
  const saved = { fetch: globalThis.fetch, provider: process.env.EMAIL_PROVIDER, key: process.env.RESEND_API_KEY };
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test';
  const attempt = async (impl) => {
    globalThis.fetch = impl;
    try { await sendOtpEmail({ to: 'a@b.c', code: '123456', nuid: '25I-0816' }); return null; } catch (err) { return err; }
  };
  const timeout = await attempt(async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; });
  check('a provider timeout is not a definite failure', timeout && timeout.definite === false);
  const refused = await attempt(async () => new Response('{"name":"validation_error"}', { status: 422 }));
  check('a provider 4xx is a definite failure', refused && refused.definite === true);
  const flaky = await attempt(async () => new Response('{}', { status: 502 }));
  check('a provider 5xx is not a definite failure', flaky && flaky.definite === false);
  globalThis.fetch = saved.fetch;
  if (saved.provider === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = saved.provider;
  if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
}

// An auth limiter that cannot be read must fail closed. Use an invalid URI so
// the failure is immediate and no real database or network is involved.
process.env.MONGODB_URI = 'not-a-mongodb-uri';
const failedRateLimit = await callEndpoint(requestCodeHandler, 'POST', {
  nuid: '25I-0816',
});
check('request-code fails closed when the auth limiter is unavailable',
  failedRateLimit.statusCode === 503 && failedRateLimit.body?.error === 'auth_unavailable',
  `${failedRateLimit.statusCode} ${JSON.stringify(failedRateLimit.body)}`);
check('failed request-code sets no nonce cookie',
  !failedRateLimit.headers['Set-Cookie'], JSON.stringify(failedRateLimit.headers));

let noteThrew = false;
try {
  await authRateNote('otp-test');
} catch {
  noteThrew = true;
}
check('auth rate booking fails closed on a storage fault', noteThrew);
delete process.env.MONGODB_URI;

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll auth helper checks passed.');
}
