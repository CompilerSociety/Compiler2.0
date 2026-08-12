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
// Reads:  db/timetables/*.json, db/metadata/notifications/push-subscriptions.json
// Writes: db/metadata/notifications/class-notify-state.json

import fs from 'node:fs';
import webpush from 'web-push';

// These three paths and the file list below must track the actual db/ layout.
// They previously pointed at a flat db/push-subscriptions.json and a
// db/timetable-*.json glob that stopped existing once the repo moved to
// nested db/timetables/, db/exams/, db/showup/, db/metadata/notifications/
// directories — so this script silently found zero files, exited via the
// "No timetable data" branch, and never sent a single notification.
const TIMETABLE_FILES = ['db/timetables/computing.json', 'db/timetables/business.json', 'db/timetables/engineering.json'];
const SUBS = 'db/metadata/notifications/push-subscriptions.json';
const STATE = 'db/metadata/notifications/class-notify-state.json';

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function writeJson(p, val) { fs.writeFileSync(p, JSON.stringify(val, null, 2) + '\n'); }

const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) { console.log('VAPID keys not set — skipping class push.'); process.exit(0); }
webpush.setVapidDetails(subject, pub, priv);

const deptKeyOf = (dep) => String(dep || '').replace(/^BS\s+/i, '').trim().toUpperCase();
const fullBatch = (b) => (/^\d{2}$/.test(String(b || '').trim()) ? '20' + String(b).trim() : String(b || '').trim());
const sectionLetter = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();

function classStatus(name) {
  const t = String(name || '');
  if (/cancel/i.test(t)) return 'Cancelled';
  if (/\bresch\b|reschedul/i.test(t)) return 'Rescheduled';
  return 'Normal';
}
function cleanCourseName(name) {
  return String(name || '').replace(/\s*(ReSch(eduled)?|Cancelled|Cancel)\b.*$/i, '').trim() || 'your class';
}

// Build the current set of class slots across all timetable files.
const slots = []; // { slotKey, value, status, deptKey, batch, secLetter, section, course, day, time, venue }
for (const f of TIMETABLE_FILES) {
  const doc = readJson(f, null);
  const tt = doc && doc.tt ? doc.tt : null;
  if (!tt) continue;
  for (const dep of Object.keys(tt)) {
    for (const batch of Object.keys(tt[dep] || {})) {
      for (const section of Object.keys(tt[dep][batch] || {})) {
        for (const day of Object.keys(tt[dep][batch][section] || {})) {
          (tt[dep][batch][section][day] || []).forEach((c) => {
            const status = classStatus(c.name);
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

if (slots.length === 0) { console.log('No timetable data — nothing to do.'); process.exit(0); }

const subs = readJson(SUBS, []);
const state = readJson(STATE, {}); // { endpoint: { slotKey: value } }
const liveEndpoints = new Set();

// Pre-index every class currently in the timetable by its stable slotKey.
// Used below to decide, per stored entry, whether the class is still
// cancelled/rescheduled (keep) or has recovered to normal (prune).
const currentBySlotKey = new Map();
for (const s of slots) currentBySlotKey.set(s.slotKey, s);

let sent = 0, skipped = 0, pruned = 0;

// Wrap in async IIFE to support await
(async () => {
  if (Array.isArray(subs)) {
    for (const entry of subs) {
      const subscription = entry?.subscription;
      if (!subscription?.endpoint) continue;
      const endpoint = subscription.endpoint;
      liveEndpoints.add(endpoint);
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
        const body = s.status === 'Cancelled'
          ? `Dear ${name}, your class ${s.course} (${s.section}) has been cancelled.`
          : `Dear ${name}, your class ${s.course} (${s.section}) has been rescheduled to ${s.time} at ${s.venue}.`;
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
          if (code !== 404 && code !== 410) console.warn(`class push failed (${code || 'err'}): ${err?.message || err}`);
        }
      }
    }
  }

  // Drop devices that are no longer subscribed.
  for (const ep of Object.keys(state)) { if (!liveEndpoints.has(ep)) delete state[ep]; }

  writeJson(STATE, state);
  console.log(`Class push summary — sent: ${sent}, skipped: ${skipped}, recovered/pruned: ${pruned}`);
})();
