// Per-category notification preferences, shared by the four push senders.
//
// A subscription record in db/metadata/notifications/push-subscriptions.json may
// carry a `prefs` object alongside the subscription itself:
//
//   { cls: true, exam: true, show: true, seat: true, room: false }
//
// Every record written before this existed has no `prefs` key at all, so an
// ABSENT preference must read as ON for each category that already ships.
// Defaulting to off would have silently stopped every existing subscriber's
// notifications on the first run after this landed, with nothing in the logs to
// say why — they would simply have looked like people who had opted out.
//
// `room` (the free-room digest) is a DEAD SWITCH: it is stored and honoured
// here, but no sender writes that notification yet, so turning it on currently
// does nothing. It is the one category that defaults OFF — nobody should be
// opted into a feature that does not exist. When the digest sender is written
// it only has to call wants(entry, 'room') and the switch is already live.
// See too_do.md.

export const NOTIFICATION_CATEGORIES = ['cls', 'exam', 'show', 'seat', 'room'];

// What a category means when the subscription record does not name it.
export const NOTIFICATION_DEFAULTS = {
  cls: true,   // class cancelled / rescheduled  -> send-class-push.mjs
  exam: true,  // exam schedule published        -> send-exam-push.mjs
  show: true,  // show-up time/venue changed     -> send-showup-push.mjs
  seat: true,  // seating plan updated           -> send-seating-push.mjs
  room: false, // free-room digest               -> no sender yet (dead switch)
};

/** Fill in every category, keeping only booleans the caller actually set. */
export function normalizePrefs(raw) {
  const prefs = {};
  for (const key of NOTIFICATION_CATEGORIES) {
    prefs[key] = typeof raw?.[key] === 'boolean' ? raw[key] : NOTIFICATION_DEFAULTS[key];
  }
  return prefs;
}

/** True when this subscription still wants notifications of `category`. */
export function wants(entry, category) {
  return normalizePrefs(entry?.prefs)[category] === true;
}
