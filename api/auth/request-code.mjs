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
import { newOtp, hashOtp, OTP_TTL_MS } from '../../lib/auth/otp.mjs';
import { randomToken, hashWithPepper } from '../../lib/auth/tokens.mjs';
import { setNonceCookie } from '../../lib/auth/session.mjs';
import { sendOtpEmail } from '../../lib/auth/mailer.mjs';
import {
  createAuthChallenge, deleteAuthChallenge, authRateCheck, authRateNote,
} from '../../lib/db/repos.mjs';
import { rejectCrossOrigin, clientIp, authConfigError } from '../../lib/auth/guard.mjs';

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
  const configError = authConfigError();
  if (configError) {
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: configError,
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

    const pepper = process.env.OTP_PEPPER || '';
    const nonce = randomToken(18);
    const challengeId = randomToken(18);
    const code = newOtp();
    const now = Date.now();

    await createAuthChallenge({
      _id: challengeId,
      nuid: parsed.nuid,
      email: parsed.email,
      code_hash: hashOtp({ challengeId, nuid: parsed.nuid, code, pepper }),
      // Binds the challenge to this browser. A challenge id leaked from one
      // device cannot be completed from another.
      browser_hash: hashWithPepper(nonce, pepper),
      attempts: 0,
      consumed: false,
      created_at: new Date(now),
      expires_at: new Date(now + OTP_TTL_MS),
    });

    try {
      await sendOtpEmail({ to: parsed.email, code, nuid: parsed.nuid });
    } catch (err) {
      // No code went out, so leave no live challenge behind that could still be
      // guessed at.
      await deleteAuthChallenge(challengeId).catch(() => {});
      console.error('auth mail delivery failed:', err?.message);
      return res.status(503).json({
        ok: false,
        error: 'delivery_failed',
        message: "We couldn't send your code right now — this is on us, not you.",
      });
    }

    setNonceCookie(res, nonce);

    return res.status(200).json({
      ok: true,
      challenge_id: challengeId,
      expires_in: Math.floor(OTP_TTL_MS / 1000),
      email: parsed.maskedEmail,
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
