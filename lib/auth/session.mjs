// lib/auth/session.mjs
// Sessions are server-side rows, not signed blobs. The browser holds an opaque
// token; the database holds only its keyed digest, so a stolen database dump
// cannot be turned back into usable cookies. Logout revokes the row, which is
// the property a stateless JWT would lack.

import { randomToken, hashWithPepper } from './tokens.mjs';
import { parseCookies, serializeCookie, appendSetCookie } from './cookies.mjs';
import {
  createAuthSession, getAuthSession, revokeAuthSession, getAccountByNuid,
} from '../db/repos.mjs';

export const SESSION_COOKIE = 'vtable_session';
export const NONCE_COOKIE = 'vtable_otp_nonce';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionPepper() {
  return process.env.SESSION_PEPPER || process.env.OTP_PEPPER || '';
}

export function hashSessionToken(token) {
  return hashWithPepper(token, sessionPepper());
}

// Secure cookies are required in production, but would make local http://
// development silently unable to log in. Vercel sets VERCEL=1; a bare local
// server does not, so the flag follows the deployment rather than a guess.
export function secureCookies() {
  if (process.env.VERCEL) return true;
  return String(process.env.APP_ORIGIN || '').startsWith('https://');
}

export function setSessionCookie(res, token) {
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_MS / 1000,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'Lax',
  }));
}

export function clearSessionCookie(res) {
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'Lax',
  }));
}

export function setNonceCookie(res, nonce) {
  appendSetCookie(res, serializeCookie(NONCE_COOKIE, nonce, {
    maxAge: 15 * 60,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'Lax',
  }));
}

export function clearNonceCookie(res) {
  appendSetCookie(res, serializeCookie(NONCE_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'Lax',
  }));
}

export function readNonce(req) {
  return parseCookies(req.headers.cookie)[NONCE_COOKIE] || '';
}

export function readSessionCookie(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
}

export async function createSession(nuid, req) {
  const token = randomToken(32);
  const now = Date.now();
  await createAuthSession({
    _id: hashSessionToken(token),
    account_id: String(nuid).trim().toUpperCase(),
    nuid: String(nuid).trim().toUpperCase(),
    created_at: new Date(now),
    expires_at: new Date(now + SESSION_TTL_MS),
    revoked_at: null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
  });
  return token;
}

// Returns { tokenHash, session, account } for a valid session, or null. A
// database error is allowed to propagate so the endpoint can answer 503 instead
// of pretending the user is logged out.
export async function readSession(req) {
  const token = readSessionCookie(req);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await getAuthSession(tokenHash);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const account = await getAccountByNuid(session.account_id || session.nuid);
  if (!account) return null;
  return { tokenHash, session, account };
}

export async function revokeSessionFromRequest(req) {
  const token = readSessionCookie(req);
  if (!token) return false;
  await revokeAuthSession(hashSessionToken(token));
  return true;
}
