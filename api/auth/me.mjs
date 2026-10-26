// GET /api/auth/me
// PUT /api/auth/me
//
// The only way the browser learns who it is. It sends the session cookie and
// gets back the account the SERVER resolved from it; the client never tells the
// server its own NU ID for identity purposes.
//
// GET also returns the profile and friends address book saved on the account,
// so a sign-in on a new device (or after a logout) restores the student's
// section, repeat/extra courses and friends instead of starting from nothing.
// PUT replaces them. Saves are compare-and-set on `revision`: a client holding
// a stale copy gets a 409 with the stored one rather than overwriting a newer
// edit made on another device.

import { readSession } from '../../lib/auth/session.mjs';
import { rejectCrossOrigin } from '../../lib/auth/guard.mjs';
import { sanitizeProfile, sanitizeFriends } from '../../lib/auth/profile.mjs';
import {
  findStudentRow, getAccountProfile, saveAccountProfile,
} from '../../lib/db/repos.mjs';

const MAX_BODY_BYTES = 64 * 1024;

function parseBody(req) {
  if (typeof req.body === 'string') {
    if (req.body.length > MAX_BODY_BYTES) throw new Error('Body too large');
    return JSON.parse(req.body || '{}');
  }
  const body = req.body || {};
  if (JSON.stringify(body).length > MAX_BODY_BYTES) throw new Error('Body too large');
  return body;
}

function savedView(saved) {
  return { profile: saved.profile, friends: saved.friends, revision: saved.revision };
}

async function handlePut(req, res, account) {
  let payload;
  let profile = null;
  let friends = null;
  try {
    payload = parseBody(req);
    if (payload.profile !== undefined) profile = sanitizeProfile(payload.profile);
    if (payload.friends !== undefined) {
      friends = sanitizeFriends(payload.friends).filter(f => f.nuid !== account.nuid);
    }
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_profile',
      message: 'Your profile could not be saved because some of it was not valid.',
      detail: err?.message || String(err),
    });
  }
  if (!profile && !friends) {
    return res.status(400).json({ ok: false, error: 'nothing_to_save' });
  }

  const revision = await saveAccountProfile(account.nuid, payload.revision, profile, friends);
  if (revision === null) {
    const saved = await getAccountProfile(account.nuid);
    return res.status(409).json({
      ok: false,
      error: 'stale_revision',
      message: 'Your profile was changed on another device. The latest copy has been loaded.',
      saved: savedView(saved),
    });
  }
  return res.status(200).json({ ok: true, revision });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (req.method === 'PUT' && rejectCrossOrigin(req, res)) return;

  try {
    const session = await readSession(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'unauthenticated' });
    }
    const account = session.account;
    if (req.method === 'PUT') return await handlePut(req, res, account);

    // The session is authoritative for identity. The roster row is attached
    // only for the account the session resolved, so this replaces the public
    // batch-roster read the desktop and mobile sign-in flows used to make.
    const [student, saved] = await Promise.all([
      findStudentRow(account.nuid),
      getAccountProfile(account.nuid),
    ]);
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
        saved: savedView(saved),
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
