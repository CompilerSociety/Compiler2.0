// GET /api/auth/me
//
// The only way the browser learns who it is. It sends the session cookie and
// gets back the account the SERVER resolved from it; the client never tells the
// server its own NU ID for identity purposes.

import { readSession } from '../../lib/auth/session.mjs';
import { findStudentRow } from '../../lib/db/repos.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const session = await readSession(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'unauthenticated' });
    }
    const account = session.account;
    // The session is authoritative for identity. The roster row is attached
    // only for the account the session resolved, so this replaces the public
    // batch-roster read the desktop and mobile sign-in flows used to make.
    const student = await findStudentRow(account.nuid);
    return res.status(200).json({
      ok: true,
      account: {
        nuid: account.nuid,
        email: account.email,
        batch: String(account.nuid).slice(0, 2),
        verified_at: account.verified_at,
        student: student ? {
          name: student.name,
          nuid: student.nuid,
          department: student.department,
          batch: student.batch,
          section: student.section,
        } : null,
      },
    });
  } catch (err) {
    console.error('me API error:', err);
    return res.status(503).json({
      ok: false,
      error: 'auth_unavailable',
      message: 'Your session could not be checked right now.',
      detail: err?.message || String(err),
    });
  }
}
