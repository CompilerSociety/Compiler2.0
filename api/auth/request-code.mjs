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
import { randomToken, hashWithPepper, validClientNonce } from '../../lib/auth/tokens.mjs';
import { setNonceCookie } from '../../lib/auth/session.mjs';
import { sendOtpEmail } from '../../lib/auth/mailer.mjs';
import {
  createAuthChallenge, deleteAuthChallenge, authRateCheck, authRateNote,
  consumeAuthEmailBudget,
} from '../../lib/db/repos.mjs';
import { rejectCrossOrigin, clientIp, authConfigError } from '../../lib/auth/guard.mjs';
import {
  OTP_COOLDOWN_MS, OTP_RATE_WINDOW_MS, OTP_DAILY_TTL_MS,
  otpDailyMax, otpMaxPerIp,
} from '../../lib/auth/limits.mjs';

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

function dailyLimitReached(res) {
  res.setHeader('Retry-After', '3600');
  return res.status(429).json({
    ok: false,
    error: 'daily_limit',
    message: 'Too many sign-in codes have been requested today. Try again tomorrow, or contact Compiler Society.',
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
      // One code per minute per roll number. This is separate from the wider
      // window so a student cannot spam their own inbox by retrying quickly.
      [`otp-cool:${parsed.nuid}`, 1, OTP_COOLDOWN_MS],
      [`otp-ip:${ip}`, otpMaxPerIp(), OTP_RATE_WINDOW_MS],
      [`otp-nuid:${parsed.nuid}`, MAX_PER_NUID, OTP_RATE_WINDOW_MS],
    ];
    for (const [key, max, windowMs] of limits) {
      const retryAfter = await authRateCheck(key, max, windowMs);
      if (retryAfter !== null) return rateLimited(res, retryAfter);
    }

    // Reserve from the global daily budget before touching the mail provider.
    // A provider quota or an abuse burst must not turn into an unbounded send
    // loop. The budget is intentionally charged even if delivery later fails:
    // repeated provider faults must not become unlimited attempts.
    const day = `otp:${new Date().toISOString().slice(0, 10)}`;
    const reserved = await consumeAuthEmailBudget(day, otpDailyMax(), OTP_DAILY_TTL_MS);
    if (!reserved) return dailyLimitReached(res);

    // Book the attempt BEFORE creating or emailing a code. If the counters
    // cannot be written, fail closed: sending a code the limiter never saw
    // would let repeated storage faults turn into unlimited emails.
    await authRateNote(`otp-cool:${parsed.nuid}`);
    await authRateNote(`otp-ip:${ip}`);
    await authRateNote(`otp-nuid:${parsed.nuid}`);

    const pepper = process.env.OTP_PEPPER || '';
    // Prefer the nonce the browser generated: it then holds the binding secret
    // before this reply arrives, so a lost reply cannot strand a sent code.
    const nonce = validClientNonce(payload.client_nonce) || randomToken(18);
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

    let delivery = 'sent';
    try {
      await sendOtpEmail({
        to: parsed.email,
        code,
        nuid: parsed.nuid,
        idempotencyKey: challengeId,
      });
    } catch (err) {
      // Log only provider-neutral fields: never the code, recipient, or the
      // provider's raw response body.
      console.error('auth mail delivery failed:', JSON.stringify({
        provider: err?.provider || 'unknown',
        code: err?.code || 'unknown',
        status: err?.status || 0,
        definite: Boolean(err?.definite),
      }));
      if (err?.definite) {
        // No code went out, so leave no live challenge behind that could still
        // be guessed at.
        await deleteAuthChallenge(challengeId).catch(() => {});
        return res.status(503).json({
          ok: false,
          error: 'delivery_failed',
          message: "We couldn't send your code right now — this is on us, not you.",
        });
      }
      // A timeout or dropped connection: the provider may well have delivered
      // it. Keep the challenge and let the student enter the code if it
      // arrives; the cooldown stops them requesting another straight away, so
      // deleting the challenge here would strand a code they already hold.
      delivery = 'uncertain';
    }
    setNonceCookie(res, nonce);

    return res.status(200).json({
      ok: true,
      challenge_id: challengeId,
      expires_in: Math.floor(OTP_TTL_MS / 1000),
      email: parsed.maskedEmail,
      delivery,
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
