// lib/auth/otp.mjs
// The rules for a one-time code: how long it lives, how many guesses it allows,
// and how the stored digest is bound to a specific challenge and NU ID.
//
// Binding matters: the digest covers `challengeId:nuid:code`, so a hash copied
// from one challenge cannot be replayed against another, and a code issued for
// one roll number cannot be verified against a different one.

import { randomDigits, hashWithPepper, timingSafeEqualHex } from './tokens.mjs';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;

export function newOtp() {
  return randomDigits(OTP_LENGTH);
}

export function hashOtp({ challengeId, nuid, code, pepper }) {
  return hashWithPepper(`${challengeId}:${nuid}:${code}`, pepper);
}

export function otpMatches({ challengeId, nuid, code, pepper, expectedHash }) {
  const actual = hashOtp({ challengeId, nuid, code, pepper });
  return timingSafeEqualHex(actual, expectedHash);
}
