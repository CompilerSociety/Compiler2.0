// lib/auth/tokens.mjs
// Random values and the hashing used to store them. Nothing here touches the
// database or the network, so it is safe to unit test in isolation.

import crypto from 'node:crypto';

// URL-safe, 256 bits by default. Used for session tokens and browser nonces.
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// A zero-padded six-digit code. randomInt is rejection-sampled, so this does
// not bias toward low numbers the way `random() % 1000000` would.
export function randomDigits(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

// Keyed digest when a pepper is configured, plain SHA-256 otherwise. The pepper
// lives only in server environment variables, so a database dump alone cannot
// be used to test guesses offline. With no pepper the code still works for
// local development, it is just weaker.
export function hashWithPepper(value, pepper) {
  const text = String(value);
  if (pepper) {
    return crypto.createHmac('sha256', String(pepper)).update(text).digest('hex');
  }
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Constant-time comparison for two hex digests. Length is checked first because
// timingSafeEqual throws on different lengths.
export function timingSafeEqualHex(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length || left.length % 2 !== 0) return false;
  // Buffer.from(..., 'hex') silently drops invalid characters, which would make
  // two malformed strings compare equal as two empty buffers.
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}
