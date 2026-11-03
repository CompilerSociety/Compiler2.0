// lib/auth/limits.mjs
// Shared OTP policy constants and the one tunable budget value.
//
// The per-IP and per-NU-ID windows live in api/auth/request-code.mjs. These
// values are exported so the smoke test can pin the defaults without starting
// a database or importing the endpoint.

export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;

// A campus NAT can put an entire lab behind one address. Ten requests per
// quarter-hour was low enough to lock out a class during the OTP launch; the
// per-NU-ID limit and the global daily budget are the real anti-abuse controls.
export const OTP_DEFAULT_MAX_PER_IP = 60;
export const OTP_MAX_MAX_PER_IP = 500;

export const OTP_DEFAULT_DAILY_MAX = 250;
export const OTP_MAX_DAILY_MAX = 1000;
export const OTP_DAILY_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export function otpMaxPerIp(raw = process.env.OTP_MAX_PER_IP) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return OTP_DEFAULT_MAX_PER_IP;
  return Math.min(value, OTP_MAX_MAX_PER_IP);
}

// The provider's plan quota is the hard ceiling, but this budget is the
// application-level guard against a retry loop or abuse burst. Keep the default
// conservative and make it tunable without a code change. Invalid or
// non-positive values fall back to the default rather than disabling it.
export function otpDailyMax(raw = process.env.OTP_DAILY_MAX) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return OTP_DEFAULT_DAILY_MAX;
  return Math.min(value, OTP_MAX_DAILY_MAX);
}
