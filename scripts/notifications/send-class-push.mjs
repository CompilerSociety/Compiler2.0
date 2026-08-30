// Runs when a timetable JSON changes. Notifies affected users (matched by
// department + batch + section) when a class becomes Cancelled or Rescheduled.
//
// De-dup is PER DEVICE and RECOVERABLE. class-notify-state.json maps each
// subscription endpoint -> { <slotKey>: "<status|time|venue>" }, keyed by the
// CLASS's stable identity (dept|batch|section|day|course), not by a composite
// that includes the disturbance details. On each run:
//
//   - a cancelled/rescheduled class whose slotKey is NOT in this device's
//     state, or whose stored value differs (new time/venue), sends and stores
//   - a cancelled/rescheduled class whose stored value matches exactly is
//     silently skipped (already told)
//   - a class that reappears as Normal has its slotKey pruned from the state,
//     WITHOUT any "recovery" notification — so if it is cancelled again later,
//     it will notify fresh
//
// This replaces the old permanent-composite behaviour, where the entry
// "<slotKey>||<value>" was written once and never cleared, meaning a class
// that got cancelled, recovered, then cancelled again would only ever notify
// on the first cancellation.
//
// Env: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (required), VAPID_SUBJECT (optional)
// Reads:  the `documents` and `push_subscriptions` collections in MongoDB
// Writes: the `notify_state` collection (kind "class-notify"). No commit.

import webpush from 'web-push';
import { wants } from './prefs.mjs';
import { loadSubs, loadState, saveState, loadDocument } from './store.mjs';
import { createNotificationJob, EXIT, malformedDocument } from './job.mjs';

const job = createNotificationJob('class-push');

// These three paths and the file list below must track the actual db/ layout.
// They previously pointed at a flat db/push-subscriptions.json and a
// db/timetable-*.json glob that stopped existing once the repo moved to
// nested db/timetables/, db/exams/, db/showup/, db/metadata/notifications/
// directories — so this script silently found zero files, exited via the
// "No timetable data" branch, and never sent a single notification.
const TIMETABLES = ['timetables/computing', 'timetables/business', 'timetables/engineering'];
const STATE = 'db/metadata/notifications/class-notify-state.json';


const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) {
  console.error('VAPID keys not set — cannot send class push.');
  await job.finish({ outcome: 'vapid_keys_missing', code: EXIT.VAPID });
} else {
webpush.setVapidDetails(subject, pub, priv);

const deptKeyOf = (dep) => String(dep || '').replace(/^BS\s+/i, '').trim().toUpperCase();
const fullBatch = (b) => (/^\d{2}$/.test(String(b || '').trim()) ? '20' + String(b).trim() : String(b || '').trim());
const sectionLetter = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();

function statusFromText(value) {
  const t = String(value || '');
  if (/cancel/i.test(t)) return 'Cancelled';
  if (/\bresch\b|reschedul/i.test(t)) return 'Rescheduled';
  return 'Normal';
}
function classStatus(note, legacyName) {
  // `note` is the durable status emitted by the timetable generator. Keep the
  // name check as a compatibility fallback for documents produced before that
  // field existed and for a manually entered legacy document.
  return statusFromText(note) !== 'Normal' ? statusFromText(note) : statusFromText(legacyName);
}
function cleanCourseName(name) {
  return String(name || '').replace(/\s*(ReSch(eduled)?|Cancelled|Cancel)\b.*$/i, '').trim() || 'your class';
}

// Format a "HH:MM-HH:MM" slot as "H:MM AM–H:MM PM" for a human-readable
// notification body. The stored times are 12-hour ambiguous ("01:00-02:20"
// means 1:00-2:20 PM). Since every scheduled slot lives inside the 8 AM –
// 8 PM school day:
//
//   start hour 8-11  -> AM; anything else (12 or 1-7) -> PM
//   end hour is PM if start is PM, or if end is exactly 12 (noon), or if end
//     is numerically less than start (a range that crossed noon, e.g.
//     "11:30-02:15" -> 11:30 AM – 2:15 PM)
//
// An end hour of 8 in a PM-start slot (evening classes end at 8:05 PM) stays
// PM by the "start is PM" branch.
function fmt12(hhmm, isPM) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return String(hhmm || '');
  const period = isPM ? 'PM' : 'AM';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
function fmtSlot(range) {
  const [a, b] = String(range || '').split('-').map((s) => s.trim());
  if (!a || !b) return String(range || '—');
  const sh = Number(a.split(':')[0]);
  const eh = Number(b.split(':')[0]);
  const startPM = !(sh >= 8 && sh <= 11);
  const endPM = startPM || eh === 12 || eh < sh;
  return `${fmt12(a, startPM)}–${fmt12(b, endPM)}`;
}

// Build the current set of class slots across all timetable files.
const slots = []; // { slotKey, value, status, deptKey, batch, secLetter, section, course, day, time, venue }
for (const f of TIMETABLES) {
  const doc = await loadDocument(f);
  if (doc && (typeof doc !== 'object' || (doc.tt != null && (typeof doc.tt !== 'object' || Array.isArray(doc.tt))))) {
    throw malformedDocument(`Timetable document "${f}" has an invalid tt object.`);
  }
  const tt = doc && doc.tt ? doc.tt : null;
  if (!tt) continue;
  for (const dep of Object.keys(tt)) {
    for (const batch of Object.keys(tt[dep] || {})) {
      for (const section of Object.keys(tt[dep][batch] || {})) {
        for (const day of Object.keys(tt[dep][batch][section] || {})) {
          (tt[dep][batch][section][day] || []).forEach((c) => {
            const status = classStatus(c.note, c.name);
            const course = cleanCourseName(c.name);
            slots.push({
              // No array index in the key: stable identity of a class so a
              // reordered JSON does not look like a brand-new class.
              slotKey: [dep, batch, section, day, course].join('|'),
              value: `${status}|${c.time || ''}|${c.location || ''}`,
              status,
              deptKey: deptKeyOf(dep), batch: fullBatch(batch), secLetter: sectionLetter(section),
              section, course, day, time: c.time || '—', venue: c.location || '—',
            });
          });
        }
      }
    }
  }
}

if (slots.length === 0) {
  console.log('No timetable data — nothing to do.');
  await job.finish({ outcome: 'no_op', reason: 'no_timetable_data' });
} else {

const subs = await loadSubs();
const state = await loadState(STATE); // { endpoint: { slotKey: value } }
const subscriptionInventory = {
  total: Array.isArray(subs) ? subs.length : 0,
  valid_endpoint: Array.isArray(subs) ? subs.filter((entry) => entry?.subscription?.endpoint).length : 0,
  class_enabled: Array.isArray(subs)
    ? subs.filter((entry) => entry?.subscription?.endpoint && wants(entry, 'cls')).length : 0,
  prefs_null: Array.isArray(subs) ? subs.filter((entry) => entry?.prefs === null).length : 0,
};
console.log(JSON.stringify({ event: 'class_push_subscription_inventory', ...subscriptionInventory }));
const liveEndpoints = new Set();

// Pre-index every class currently in the timetable by its stable slotKey.
// Used below to decide, per stored entry, whether the class is still
// cancelled/rescheduled (keep) or has recovered to normal (prune).
const currentBySlotKey = new Map();
for (const s of slots) currentBySlotKey.set(s.slotKey, s);

let sent = 0, skipped = 0, pruned = 0, failed = 0;

// Wrap in async IIFE to support await
(async () => {
  if (Array.isArray(subs)) {
    for (const entry of subs) {
      const subscription = entry?.subscription;
      if (!subscription?.endpoint) continue;
      const endpoint = subscription.endpoint;
      // Registered as live BEFORE the preference gate below, so that a device
      // which has class alerts switched off keeps its state entry instead of
      // being pruned as "no longer subscribed" — otherwise switching the
      // category back on would re-announce every cancellation it was already
      // told about.
      liveEndpoints.add(endpoint);
      if (!wants(entry, 'cls')) { skipped++; continue; }
      const dep = deptKeyOf(entry.department);
      const batch = fullBatch(entry.batch);
      const secLetter = sectionLetter(entry.section);
      if (!dep || !batch || !secLetter) { skipped++; continue; }

      const seen = state[endpoint] || (state[endpoint] = {});
      const name = String(entry.name || '').trim() || 'Student';

      // Recovery pruning, per device. For each class this device has been
      // told about, check its current state: if it is no longer cancelled/
      // rescheduled — either back to Normal, or gone from the timetable
      // entirely (e.g. renamed) — drop the entry so a future re-cancellation
      // is treated as new and notifies again. No "class recovered"
      // notification is sent, by request.
      for (const storedSlotKey of Object.keys(seen)) {
        const cur = currentBySlotKey.get(storedSlotKey);
        if (!cur || cur.status === 'Normal') {
          delete seen[storedSlotKey];
          pruned++;
        }
      }

      // Only this device's matching, currently cancelled/rescheduled classes.
      const mine = slots.filter((s) => s.status !== 'Normal' && s.deptKey === dep && s.batch === batch && s.secLetter === secLetter);

      for (const s of mine) {
        // Skip if this device was already told about this exact
        // cancellation/reschedule (same status, time and venue). A different
        // time/venue is a new composite and will notify.
        if (seen[s.slotKey] === s.value) { continue; }
        // Include the day and formatted time so the student can tell which
        // sitting of a class this is about — a course has multiple slots in
        // the week, and "SDA has been cancelled" alone was ambiguous.
        //
        // For a cancellation, s.time is the slot that ISN'T happening — read
        // as "the sitting at this time is off."
        //
        // For a reschedule, the sheet cell holds the CURRENT (post-move)
        // time/venue, so the message reads as "moved to these coordinates."
        // The original slot is not stored in the timetable, so we cannot
        // include "from where."
        const when = `${s.day} at ${fmtSlot(s.time)}`;
        const body = s.status === 'Cancelled'
          ? `Dear ${name}, your ${s.course} (${s.section}) class on ${when} has been cancelled.`
          : `Dear ${name}, your ${s.course} (${s.section}) class has been rescheduled to ${when} in ${s.venue}.`;
        const payload = JSON.stringify({
          title: s.status === 'Cancelled' ? 'Class cancelled' : 'Class rescheduled',
          body, url: '/', tag: `class-${s.deptKey}-${s.batch}-${s.secLetter}-${s.course}-${s.day}`,
        });
        try {
          await webpush.sendNotification(subscription, payload);
          seen[s.slotKey] = s.value; // remembered until the class recovers
          sent++;
        } catch (err) {
          const code = err?.statusCode;
          if (code !== 404 && code !== 410) {
            failed++;
            console.warn(`class push failed (${code || 'err'}): ${err?.message || err}`);
          }
        }
      }
    }
  }

  // Drop devices that are no longer subscribed.
  for (const ep of Object.keys(state)) { if (!liveEndpoints.has(ep)) delete state[ep]; }

  await saveState(STATE, state);
  console.log(`Class push summary — sent: ${sent}, skipped: ${skipped}, recovered/pruned: ${pruned}`);
  await job.finish({ outcome: failed > 0 ? 'partial_push_failure' : sent > 0 ? 'sent' : 'no_op', counts: { sent, skipped, pruned, failed } });
})().catch(job.fail);
}
}
