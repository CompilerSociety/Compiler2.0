// scripts/notifications/store.mjs
// Storage for the four send-*-push.mjs senders, shared so the four copies of
// readJson/writeJson cannot drift apart the way the old path constants did.
//
// Reads come from MongoDB, which matters most for the subscription list: a
// student who enables alerts at 9am is written straight to Mongo by
// api/subscribe.js, and if these scripts read the committed mirror instead they
// would not see that device until the mirror was next exported. Reading the
// database means a new subscriber is reachable on the very next run, which is
// how it behaved when subscribe.js committed the file directly.
//
// Writes go to BOTH Mongo and the committed file. These scripts run inside a
// workflow that already commits their output, so writing the file too keeps the
// db/ mirror fresh for free, with no extra export job for this data.
//
// With no MONGODB_URI everything falls back to the files on disk, so the
// senders behave exactly as they did before the migration.

import fs from 'node:fs';
import { isEnabled } from '../../lib/db/mongo.mjs';
import {
  listSubscriptions, getNotifyState, setNotifyState, removeSubscription,
} from '../../lib/db/repos.mjs';

export const SUBS_PATH = 'db/metadata/notifications/push-subscriptions.json';

// Maps a state file to the `kind` tag its rows carry in the notify_state
// collection. Mirrors NOTIFY_STATE_FILES in lib/db/collections.mjs.
const STATE_KINDS = {
  'db/metadata/notifications/push-state.json': 'push',
  'db/metadata/notifications/push-exam-state.json': 'push-exam',
  'db/metadata/notifications/class-notify-state.json': 'class-notify',
  'db/metadata/notifications/showup-notify-state.json': 'showup-notify',
};

export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}

export function writeJson(p, val) {
  fs.writeFileSync(p, JSON.stringify(val, null, 2) + '\n');
}

// The subscription list, newest state first. Falls back to the committed file.
export async function loadSubs() {
  if (!isEnabled()) return readJson(SUBS_PATH, []);
  try {
    const subs = await listSubscriptions();
    // An empty database with a populated file almost certainly means the
    // migration has not been run yet, not that everyone unsubscribed. Sending
    // to nobody is a silent failure, so prefer the file in that case.
    if (!subs.length) {
      const fromFile = readJson(SUBS_PATH, []);
      if (fromFile.length) {
        console.warn(`No subscriptions in Mongo but ${fromFile.length} in ${SUBS_PATH} - using the file.`);
        return fromFile;
      }
    }
    return subs;
  } catch (err) {
    console.warn('Subscription read from Mongo failed, using the committed file:', err?.message);
    return readJson(SUBS_PATH, []);
  }
}

// Replaces the stored subscription list with `kept`, dropping the rest. Used by
// the seating sender when a push service reports an endpoint as gone (404/410).
// Deletes the dropped rows from Mongo as well as rewriting the file - pruning
// only the mirror would leave dead endpoints in the database to be retried on
// every future run.
export async function pruneSubs(kept) {
  const kepts = new Set(kept.map((e) => e?.subscription?.endpoint).filter(Boolean));
  if (isEnabled()) {
    const before = await loadSubs();
    for (const entry of before) {
      const endpoint = entry?.subscription?.endpoint;
      if (endpoint && !kepts.has(endpoint)) {
        try {
          await removeSubscription(endpoint);
        } catch (err) {
          console.warn(`Could not prune ${endpoint}:`, err?.message);
        }
      }
    }
  }
  writeJson(SUBS_PATH, kept);
}

export async function loadState(path) {
  const kind = STATE_KINDS[path];
  if (!isEnabled() || !kind) return readJson(path, {});
  try {
    const state = await getNotifyState(kind);
    // Same reasoning as above, and here it is worse: an empty state makes every
    // sender think nothing has been notified yet and re-send the entire
    // backlog to every device.
    if (!Object.keys(state).length) return readJson(path, {});
    return state;
  } catch (err) {
    console.warn(`State read from Mongo failed for ${kind}, using ${path}:`, err?.message);
    return readJson(path, {});
  }
}

// Writes state to Mongo AND to its committed file. The file write always
// happens - it is what the workflow commits, and what the fallback above reads.
export async function saveState(path, state) {
  writeJson(path, state);
  const kind = STATE_KINDS[path];
  if (!isEnabled() || !kind) return;
  try {
    await setNotifyState(kind, state);
  } catch (err) {
    // The file was still written and will still be committed, so the run is
    // not lost - it just has to be reconciled by the next export.
    console.warn(`State write to Mongo failed for ${kind}:`, err?.message);
  }
}
