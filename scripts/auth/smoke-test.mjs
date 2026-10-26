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
  randomToken, randomDigits, hashWithPepper, timingSafeEqualHex,
} from '../../lib/auth/tokens.mjs';
import { parseCookies, serializeCookie, appendSetCookie } from '../../lib/auth/cookies.mjs';

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
