// POST /api/auth/verify
//
// Completes verification. The challenge is checked against the code AND the
// browser nonce set by request-code, then claimed atomically before any session
// is minted. The account is created only here, after mailbox ownership is
// proven; before this point an NU ID is just an unverified claim.

import { isEnabled } from '../../lib/db/mongo.mjs';
import { otpMatches, OTP_MAX_ATTEMPTS } from '../../lib/auth/otp.mjs';
import { hashWithPepper, timingSafeEqualHex } from '../../lib/auth/tokens.mjs';
import {
  readNonce, clearNonceCookie, setSessionCookie, createSession,
} from '../../lib/auth/session.mjs';
import {
  getAuthChallenge, incrementAuthChallengeAttempts, consumeAuthChallenge,
  upsertVerifiedAccount,
} from '../../lib/db/repos.mjs';
import { rejectCrossOrigin } from '../../lib/auth/guard.mjs';

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return {};
  }
}

function invalidChallenge(res, message = 'That code has expired. Request a new one.') {
  return res.status(400).json({ ok: false, error: 'invalid_challenge', message });
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
  // Verification reads OTP_PEPPER, so a deploy without it must not pretend the
  // unkeyed hashes are equivalent to a keyed deployment.
  if (process.env.VERCEL && !process.env.OTP_PEPPER) {
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: 'OTP_PEPPER is not set on the server.',
    });
  }

  const payload = parseBody(req);
  const challengeId = String(payload.challenge_id || '').trim();
  const code = String(payload.code || '').trim();
  if (!challengeId || !code) {
    return res.status(400).json({
      ok: false,
      error: 'incomplete',
      message: 'The challenge and the code are both required.',
    });
  }

  try {
    const nonce = readNonce(req);
    if (!nonce) return invalidChallenge(res);

    const challenge = await getAuthChallenge(challengeId);
    if (!challenge || challenge.consumed) return invalidChallenge(res);

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      return invalidChallenge(res, 'That code has expired. Request a new one.');
    }
    if ((challenge.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        ok: false,
        error: 'too_many_attempts',
        message: 'Too many wrong codes. Request a new one.',
      });
    }

    const pepper = process.env.OTP_PEPPER || '';
    const browserHash = hashWithPepper(nonce, pepper);
    if (!timingSafeEqualHex(browserHash, challenge.browser_hash)) {
      return invalidChallenge(res);
    }

    const correct = otpMatches({
      challengeId,
      nuid: challenge.nuid,
      code,
      pepper,
      expectedHash: challenge.code_hash,
    });
    if (!correct) {
      await incrementAuthChallengeAttempts(challengeId);
      const left = OTP_MAX_ATTEMPTS - ((challenge.attempts || 0) + 1);
      return res.status(400).json({
        ok: false,
        error: 'invalid_code',
        message: 'That code is not correct.',
        attempts_left: Math.max(0, left),
      });
    }

    // Single-use claim: two simultaneous correct submissions cannot both win.
    const claimed = await consumeAuthChallenge(challengeId);
    if (!claimed) return invalidChallenge(res);

    const account = await upsertVerifiedAccount(challenge.nuid, challenge.email);
    const token = await createSession(challenge.nuid, req);
    setSessionCookie(res, token);
    clearNonceCookie(res);

    return res.status(200).json({
      ok: true,
      account: {
        nuid: account.nuid,
        email: account.email,
        batch: String(account.nuid).slice(0, 2),
        verified_at: account.verified_at,
      },
    });
  } catch (err) {
    console.error('verify API error:', err);
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: "Sign-in can't work right now — this is on us, not you.",
      detail: err?.message || String(err),
    });
  }
}
