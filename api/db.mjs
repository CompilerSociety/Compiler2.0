// api/db.js
// Serves the datasets that used to live in db/*.json, straight from MongoDB.
//
// The committed JSON tree is gone. The frontend used to fetch those files as
// static assets through the vercel.json rewrites; those rewrites now point
// here, so the client still asks for /db/timetable-computing.json and still
// gets byte-identical JSON back - it just comes from the database instead of a
// file in the repo, which means it is live rather than as old as the last
// commit.
//
//   /api/db?doc=timetables/computing
//   /api/db?doc=students/26
//   /api/db?doc=leaderboards/compiler-run
//
// CACHING IS THE WHOLE TRICK HERE. A timetable is read on nearly every page
// load by a few thousand students, and a free M0 cluster has 500 connections
// total - going to Atlas for every one of those would be both slow and
// fragile. `s-maxage` lets Vercel's CDN serve the response from the edge like
// the static file it replaced, and `stale-while-revalidate` means the refresh
// happens in the background so nobody ever waits for it.
//
// Cache windows are set per dataset by how fast it actually changes: a
// timetable moves a few times a semester, a leaderboard moves every few
// minutes. Leaderboards are deliberately NOT edge-cached - the whole point of
// moving them to the database was that a score shows up immediately.

import { isEnabled } from '../lib/db/mongo.mjs';
import { getDocument, getRoster, getLeaderboardFile } from '../lib/db/repos.mjs';
import { DOCUMENT_FILES } from '../lib/db/collections.mjs';

const GAMES = {
  'compiler-run': 'compiler_run',
  'duck-hunter': 'duck_hunter',
  'flappy-bird': 'flappy_bird',
};

// Seconds the CDN may serve a cached copy, then how long it may serve a stale
// one while fetching a fresh copy behind the scenes.
const CACHE = {
  timetables: [300, 3600],
  exams: [300, 3600],
  showup: [300, 3600],
  seating: [120, 3600],
  faculty: [3600, 86400],
  students: [300, 3600],
  leaderboards: [0, 0], // live, never edge-cached
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const doc = String((req.query && req.query.doc) || '').trim();
  // Only the known datasets are reachable, matched against fixed maps rather
  // than interpolated into a query - a client cannot ask for a collection or a
  // document that was not meant to be public.
  const [kind, name] = doc.split('/');
  if (!kind || !name) {
    return res.status(400).json({ error: 'bad_request', message: 'doc must look like timetables/computing.' });
  }

  if (!isEnabled()) {
    // There is no file to fall back to any more, so say plainly that the
    // datastore is not configured rather than serving an empty document that
    // the client would render as "no classes today".
    return res.status(503).json({
      error: 'database_unavailable',
      message: 'Data is temporarily unavailable — this is on us, not you.',
      detail: 'MONGODB_URI is not set on the server.',
    });
  }

  try {
    let payload = null;

    if (kind === 'students') {
      payload = await getRoster(name);
    } else if (kind === 'leaderboards') {
      const game = GAMES[name];
      if (!game) return res.status(404).json({ error: 'not_found' });
      payload = await getLeaderboardFile(game);
    } else if (DOCUMENT_FILES[doc]) {
      payload = await getDocument(doc);
    } else {
      return res.status(404).json({ error: 'not_found' });
    }

    if (payload === null || payload === undefined) {
      return res.status(404).json({ error: 'not_found', message: `No data for ${doc}.` });
    }

    const [maxAge, swr] = CACHE[kind] || [60, 300];
    res.setHeader(
      'Cache-Control',
      maxAge
        ? `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`
        : 'no-store',
    );
    return res.status(200).json(payload);
  } catch (err) {
    console.error(`db API error for ${doc}:`, err);
    return res.status(503).json({
      error: 'database_unavailable',
      message: 'Data is temporarily unavailable — this is on us, not you.',
      detail: err?.message || String(err),
    });
  }
}
