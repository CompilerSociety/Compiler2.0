// POST /api/auth/request-code
//
// Starts verification: validate the NU ID, derive its university mailbox on the
// server, generate a six-digit code, store only a keyed digest, and email the
// code. The browser is told where the code went in masked form and nothing that
// could be used to log in.
//
// The recipient address is NEVER taken from the request body. A client supplies
// a roll number; `lib/auth/nuid.mjs` decides the mailbox. This is what stops
// "verify me as 25I-0816" from sending a code to the attacker's own inbox.

import { isEnabled } from '../../lib/db/mongo.mjs';
import { parseNuid } from '../../lib/auth/nuid.mjs';
import { setSessionCookie, createSession } from '../../lib/auth/session.mjs';
import {
  upsertVerifiedAccount, authRateCheck, authRateNote,
} from '../../lib/db/repos.mjs';
import { rejectCrossOrigin, clientIp } from '../../lib/auth/guard.mjs';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_PER_NUID = 3;

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return {};
  }
}

function rateLimited(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    ok: false,
    error: 'rate_limited',
    message: "That's a lot of attempts. Wait a few minutes and try again.",
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (rejectCrossOrigin(req, res)) return;

  if (!isEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: 'MONGODB_URI is not set on the server.',
    });
  }
  // OTP verification is disabled: no email is sent, so only the session pepper
  // is required on a deployed server.
  if (process.env.VERCEL && !(process.env.SESSION_PEPPER || process.env.OTP_PEPPER)) {
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: 'SESSION_PEPPER or OTP_PEPPER is not set on the server.',
    });
  }

  const payload = parseBody(req);
  const parsed = parseNuid(payload.nuid);
  if (!parsed.ok) {
    if (parsed.error === 'campus_not_supported') {
      return res.status(400).json({
        ok: false,
        error: 'campus_not_supported',
        message: 'Sign-in is not available for your campus yet. Islamabad IDs (…I-…) work now.',
      });
    }
    return res.status(400).json({
      ok: false,
      error: 'invalid_nuid',
      message: 'NU ID must look like 25I-0816.',
    });
  }

  try {
    const ip = clientIp(req);
    const limits = [
      [`otp-ip:${ip}`, MAX_PER_IP],
      [`otp-nuid:${parsed.nuid}`, MAX_PER_NUID],
    ];
    for (const [key, max] of limits) {
      const retryAfter = await authRateCheck(key, max, RATE_WINDOW_MS);
      if (retryAfter !== null) return rateLimited(res, retryAfter);
    }

    // Book the attempt BEFORE creating or emailing a code. If the counters
    // cannot be written, fail closed: sending a code the limiter never saw
    // would let repeated storage faults turn into unlimited emails.
    await authRateNote(`otp-ip:${ip}`);
    await authRateNote(`otp-nuid:${parsed.nuid}`);

    // No OTP: the NU ID alone signs the browser in.
    const account = await upsertVerifiedAccount(parsed.nuid, parsed.email);
    const token = await createSession(parsed.nuid, req);
    setSessionCookie(res, token);

    return res.status(200).json({
      ok: true,
      verified: true,
      account: {
        nuid: account.nuid,
        email: account.email,
        batch: String(account.nuid).slice(0, 2),
        verified_at: account.verified_at,
      },
    });
  } catch (err) {
    console.error('request-code API error:', err);
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: err?.message || String(err),
    });
  }
}
