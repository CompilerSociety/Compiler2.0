// GET  /api/friends
// POST /api/friends   { action: 'request'|'accept'|'decline'|'cancel'|'remove', nuid }
//
// Friendships with recipient acceptance. A friend's saved profile (their real
// section and their repeat/extra courses) is returned ONLY across an accepted
// friendship, so knowing someone's NU ID is not enough to read their courses.
//
// Rules, all enforced here rather than in the client:
//   - verified session required; identity comes from the session
//   - only the recipient may accept or decline a pending request
//   - only the requester may cancel a pending request
//   - either side may remove an accepted friendship
//   - no self-requests; one row per pair, so a crossed request is reported as
//     an incoming request to accept instead of being auto-accepted
//   - a declined request keeps reading as pending to the requester, so a
//     decline is not announced and cannot be re-sent in a loop
//   - requests are rate limited per account

import { isEnabled } from '../lib/db/mongo.mjs';
import { requireSession, rejectCrossOrigin } from '../lib/auth/guard.mjs';
import { NUID_RE, normalizeNuid, sharedProfileView } from '../lib/auth/profile.mjs';
import {
  listFriendships, getFriendship, createFriendRequest, setFriendshipStatus,
  deleteFriendship, getProfilesFor, findStudentForFriend, authRateCheck, authRateNote,
} from '../lib/db/repos.mjs';

const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 30;
const ACTIONS = ['request', 'accept', 'decline', 'cancel', 'remove'];

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return {};
  }
}

// Display name for someone who asked to be your friend: what they saved on
// their account, else their roster row, else nothing.
async function nameFor(nuid, profiles) {
  const saved = profiles[nuid]?.name;
  if (saved) return saved;
  const row = await findStudentForFriend(nuid).catch(() => null);
  return row?.name || '';
}

async function listView(me) {
  const rows = await listFriendships(me);
  const other = row => (row.a === me ? row.b : row.a);
  const accepted = rows.filter(r => r.status === 'accepted').map(other);
  const incoming = rows.filter(r => r.status === 'pending' && r.recipient === me).map(other);
  const outgoing = rows
    .filter(r => r.requester === me && (r.status === 'pending' || r.status === 'declined'))
    .map(other);

  const profiles = await getProfilesFor([...accepted, ...incoming]);
  return {
    friends: accepted.map(nuid => ({ nuid, profile: sharedProfileView(profiles[nuid]) })),
    incoming: await Promise.all(incoming.map(async nuid => ({ nuid, name: await nameFor(nuid, profiles) }))),
    outgoing: outgoing.map(nuid => ({ nuid })),
  };
}

function bad(res, error, message, status = 400) {
  return res.status(status).json({ ok: false, error, message });
}

async function runAction(me, action, target) {
  switch (action) {
    case 'request': {
      const existing = await getFriendship(me, target);
      if (existing?.status === 'accepted') return { status: 'accepted' };
      if (existing && existing.recipient === me && existing.status === 'pending') {
        return { error: 'incoming_pending', message: 'They already sent you a request. Accept it instead.' };
      }
      if (existing) return { status: 'pending' };
      await createFriendRequest(me, target);
      return { status: 'pending', created: true };
    }
    case 'accept':
      return await setFriendshipStatus(me, target, { from: 'pending', to: 'accepted', recipient: me })
        ? { status: 'accepted' }
        : { error: 'no_request', message: 'That request is no longer waiting for you.' };
    case 'decline':
      return await setFriendshipStatus(me, target, { from: 'pending', to: 'declined', recipient: me })
        ? { status: 'declined' }
        : { error: 'no_request', message: 'That request is no longer waiting for you.' };
    case 'cancel':
      // Declined rows are included: to the requester they still read as pending.
      return await deleteFriendship(me, target, { requester: me, status: { $in: ['pending', 'declined'] } })
        ? { status: 'none' }
        : { error: 'no_request', message: 'There is no request to cancel.' };
    case 'remove':
      return await deleteFriendship(me, target, { status: 'accepted' })
        ? { status: 'none' }
        : { error: 'not_friends', message: 'You are not friends with this account.' };
    default:
      return { error: 'invalid_action', message: 'Unknown friend action.' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (req.method === 'POST' && rejectCrossOrigin(req, res)) return;

  if (!isEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'database_unavailable',
      message: 'Friends are temporarily unavailable.',
      detail: 'MONGODB_URI is not set on the server.',
    });
  }

  try {
    const session = await requireSession(req, res);
    if (!session) return;
    if (session.account.email_verified !== true) {
      return bad(res, 'verification_required', 'Verify your university email to use friends.', 403);
    }
    const me = normalizeNuid(session.account.nuid);

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, ...(await listView(me)) });
    }

    const payload = parseBody(req);
    const action = String(payload.action || '');
    const target = normalizeNuid(payload.nuid);
    if (!ACTIONS.includes(action)) return bad(res, 'invalid_action', 'Unknown friend action.');
    if (!NUID_RE.test(target)) return bad(res, 'invalid_nuid', 'NU ID must look like 25I-0632.');
    if (target === me) return bad(res, 'self_request', "You can't add yourself as a friend.");

    if (action === 'request') {
      const limitKey = `friend-req:${me}`;
      const retryAfter = await authRateCheck(limitKey, MAX_REQUESTS_PER_HOUR, REQUEST_WINDOW_MS);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        return bad(res, 'rate_limited', 'Too many friend requests. Try again later.', 429);
      }
      await authRateNote(limitKey);
    }

    const result = await runAction(me, action, target);
    if (result.error) return bad(res, result.error, result.message, 409);
    return res.status(200).json({ ok: true, nuid: target, status: result.status });
  } catch (err) {
    console.error('friends API error:', err);
    return res.status(503).json({
      ok: false,
      error: 'friends_unavailable',
      message: 'Friends are temporarily unavailable.',
      detail: err?.message || String(err),
    });
  }
}
