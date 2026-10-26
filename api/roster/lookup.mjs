// GET /api/roster/lookup?nuid=25I-0632
//
// Exact-match replacement for the public batch-roster read the mobile friend
// flow used to make. It exists because adding a friend by typing every field by
// hand produces typos and fake entries, but a whole publishable roster must not
// be downloadable by anyone.
//
// Security properties:
//   - verified session required; no session, no roster data
//   - exact NU ID only, never a prefix search or a batch listing
//   - name, department and batch only; section and seat are not needed to add a
//     friend and stay out of the response
//   - per-account hourly and daily limits kept in Mongo, shared across every
//     serverless instance; a miss costs more than a hit
//   - account, target and result are logged; ROSTER_LOOKUP_ENABLED=0 is a kill
//     switch that turns the endpoint off without a deploy

import { isEnabled } from '../../lib/db/mongo.mjs';
import { requireSession } from '../../lib/auth/guard.mjs';
import {
  findStudentForFriend, rosterLookupCheck, rosterLookupNote,
} from '../../lib/db/repos.mjs';

const NUID_RE = /^(\d{2})([A-Z]{1,4})-(\d{4})$/;
const MIN_BATCH = 22;
const MAX_BATCH = 26;

function lookupEnabled() {
  const value = process.env.ROSTER_LOOKUP_ENABLED;
  if (value === undefined || value === '') return true;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (!lookupEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'lookup_disabled',
      message: 'Friend lookup is temporarily unavailable. Enter their details instead.',
    });
  }

  if (!isEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'database_unavailable',
      message: 'Friend lookup is temporarily unavailable. Enter their details instead.',
      detail: 'MONGODB_URI is not set on the server.',
    });
  }

  try {
    const session = await requireSession(req, res);
    if (!session) return;

    // A session is only minted after mailbox proof, but checking the flag keeps
    // any future unverified registration path from silently gaining this read.
    if (session.account.email_verified !== true) {
      return res.status(403).json({
        ok: false,
        error: 'verification_required',
        message: 'Verify your university email before looking up friends.',
      });
    }

    const nuid = String((req.query && req.query.nuid) || '')
      .trim().toUpperCase().replace(/\s+/g, '');
    const parts = NUID_RE.exec(nuid);
    const batch = parts ? Number(parts[1]) : 0;
    if (!parts || batch < MIN_BATCH || batch > MAX_BATCH) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_nuid',
        message: 'NU ID must look like 25I-0632.',
      });
    }

    const account = String(session.account.nuid || '').trim().toUpperCase();
    const limit = await rosterLookupCheck(account);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: 'Too many friend lookups. Try again later, or enter their details instead.',
      });
    }

    const student = await findStudentForFriend(nuid);
    const result = student ? 'hit' : 'miss';
    await rosterLookupNote(account, nuid, result);
    console.log(`[roster.lookup] account=${account} target=${nuid} result=${result}`);

    if (!student) return res.status(200).json({ ok: true, found: false });
    return res.status(200).json({
      ok: true,
      found: true,
      student: {
        name: student.name || '',
        department: student.department || '',
        batch: student.batch || parts[1],
      },
    });
  } catch (err) {
    console.error('roster lookup API error:', err);
    return res.status(503).json({
      ok: false,
      error: 'lookup_unavailable',
      message: 'Friend lookup is temporarily unavailable. Enter their details instead.',
      detail: err?.message || String(err),
    });
  }
}
