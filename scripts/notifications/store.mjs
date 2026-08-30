// scripts/notifications/store.mjs
// Storage for the four send-*-push.mjs senders, shared so the four copies of
// the old readJson/writeJson helpers cannot drift apart the way their path
// constants once did.
//
// Everything comes from MongoDB. db/*.json is gone, so there is no file to read
// and nothing is written back to the repo - a notification run no longer
// produces a commit at all.
//
// FAILING SAFELY IS THE POINT OF THIS MODULE. The obvious implementation
// returns an empty object when the database cannot be read, and that is the
// worst possible answer here: an empty notify-state means "nothing has ever
// been sent", so every sender would cheerfully re-deliver its entire backlog
// to every subscribed device. Reads therefore throw, and `abortOnFailure`
// turns that into a clean exit that sends nothing.

import { isEnabled } from '../../lib/db/mongo.mjs';
import {
  listSubscriptions, getNotifyState, setNotifyState, removeSubscription,
  getDocument,
} from '../../lib/db/repos.mjs';

// Maps a sender's state name to the `kind` tag its rows carry in the
// notify_state collection. Mirrors NOTIFY_STATE_FILES in lib/db/collections.mjs.
const STATE_KINDS = {
  'db/metadata/notifications/push-state.json': 'push',
  'db/metadata/notifications/push-exam-state.json': 'push-exam',
  'db/metadata/notifications/class-notify-state.json': 'class-notify',
  'db/metadata/notifications/showup-notify-state.json': 'showup-notify',
};

function abortOnFailure(what, err) {
  const failure = new Error(`Could not read ${what} from MongoDB: ${err?.message || err}`, { cause: err });
  failure.name = 'MongoNotificationStoreError';
  throw failure;
}

function requireMongo() {
  if (!isEnabled()) {
    const failure = new Error('MONGODB_URI is not set.');
    failure.name = 'MongoNotificationStoreError';
    throw failure;
  }
}

export async function loadSubs() {
  requireMongo();
  try {
    return await listSubscriptions();
  } catch (err) {
    return abortOnFailure('the subscription list', err);
  }
}

// One generated document (a timetable, exam schedule, seating plan...) by the
// id it carries in the `documents` collection, e.g. "timetables/computing".
// Returns null when it is not there, which every caller already treats as
// "nothing to notify about" rather than an error - a school with no timetable
// published yet is a normal state.
export async function loadDocument(id) {
  requireMongo();
  try {
    return await getDocument(id);
  } catch (err) {
    return abortOnFailure(`document "${id}"`, err);
  }
}

export async function loadState(name) {
  requireMongo();
  const kind = STATE_KINDS[name];
  if (!kind) throw new Error(`Unknown notify state: ${name}`);
  try {
    return await getNotifyState(kind);
  } catch (err) {
    return abortOnFailure(`notify state "${kind}"`, err);
  }
}

export async function saveState(name, state) {
  const kind = STATE_KINDS[name];
  if (!kind) throw new Error(`Unknown notify state: ${name}`);
  await setNotifyState(kind, state);
}

// Drops the subscriptions the push services reported as gone (404/410). Used by
// the seating sender, which is the one that fans out to every device.
export async function pruneSubs(kept) {
  const keptEndpoints = new Set(kept.map((e) => e?.subscription?.endpoint).filter(Boolean));
  const all = await listSubscriptions();
  for (const entry of all) {
    const endpoint = entry?.subscription?.endpoint;
    if (endpoint && !keptEndpoints.has(endpoint)) {
      try {
        await removeSubscription(endpoint);
      } catch (err) {
        console.warn(`Could not prune ${endpoint}:`, err?.message);
      }
    }
  }
}
