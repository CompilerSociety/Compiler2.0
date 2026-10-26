// lib/auth/guard.mjs
// Shared request checks. Cookies are sent automatically, so state-changing
// requests need an origin check as well as SameSite: this rejects a POST that a
// different site's page tried to make with the student's cookie attached.

import { readSession } from './session.mjs';

// On a deployed server, a missing pepper or SMTP credential must fail closed.
// Locally both are optional: the code is hashed unkeyed and printed to the
// console, which is what makes the flow testable without an inbox.
export function authConfigError() {
  if (!process.env.VERCEL) return null;
  const missing = [];
  if (!process.env.OTP_PEPPER) missing.push('OTP_PEPPER');
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    missing.push('SMTP_HOST/SMTP_USER/SMTP_PASS');
  }
  return missing.length ? `Missing ${missing.join(', ')}` : null;
}

// Same-origin browser requests always send Origin for POST. A missing Origin is
// allowed because curl, server-to-server calls and some same-origin GETs omit
// it; it is never a way for a cross-site page to send a cookie it cannot read.
export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return Boolean(host) && url.host === host;
  } catch {
    return false;
  }
}

// Returns true when the request was rejected, so callers can `if (rejectCrossOrigin(req, res)) return;`.
export function rejectCrossOrigin(req, res) {
  if (isSameOrigin(req)) return false;
  res.status(403).json({
    ok: false,
    error: 'bad_origin',
    message: 'This request came from an origin VTable does not accept.',
  });
  return true;
}

export async function requireSession(req, res) {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: 'unauthenticated',
      message: 'Sign in to continue.',
    });
    return null;
  }
  return session;
}

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '');
  return forwarded.split(',')[0].trim() || 'unknown';
}
