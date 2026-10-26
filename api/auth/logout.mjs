// POST /api/auth/logout
//
// Revokes the session row and clears the cookie. The cookie is cleared even if
// revocation fails, so the browser is logged out locally; the row then expires
// on its own TTL. Logging out twice is not an error.

import { clearSessionCookie, revokeSessionFromRequest } from '../../lib/auth/session.mjs';
import { rejectCrossOrigin } from '../../lib/auth/guard.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (rejectCrossOrigin(req, res)) return;

  try {
    await revokeSessionFromRequest(req);
  } catch (err) {
    console.error('logout revoke failed:', err?.message);
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
