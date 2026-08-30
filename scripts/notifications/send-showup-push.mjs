// Runs after the show-up schedule is (re)synced. Detects when a section's
// show-up slot changed time or venue and notifies subscribed users in that
// section with the new time & venue.
//
// Env: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (required), VAPID_SUBJECT (optional)
//
// Reads:  the `documents` and `push_subscriptions` collections in MongoDB
// Writes: db/metadata/notifications/showup-notify-state.json  (slotKey -> "time@venue" last seen)
//
// The state file is what makes this a *change* detector: on the first run it is
// just recorded (no spam), and thereafter only slots whose time/venue differ
// from the stored value fire a notification.

import webpush from 'web-push';
import { wants } from './prefs.mjs';
import { loadSubs, loadState, saveState, loadDocument } from './store.mjs';
import { createNotificationJob, EXIT, malformedDocument } from './job.mjs';
import { recordNotificationDelivery } from './notify-log.mjs';

const job = createNotificationJob('showup-push');

// See send-class-push.mjs for why these must be the nested paths, not a flat
// db/ layout that no longer exists. Only computing has a show-up sheet today,
// but this lists every school so a new one starts working without a code
// change here — same shape send-exam-push.mjs uses for its three schools.
// Was a readdir of db/showup, which no longer exists. Listed explicitly now:
// only computing has a show-up sheet today, and adding a school here is the
// same one-line change it was before.
const SHOWUP_DOCS = ['showup/computing'];
const STATE = 'db/metadata/notifications/showup-notify-state.json';


const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) {
  console.error('VAPID keys not set — cannot send show-up push.');
  await job.finish({ outcome: 'vapid_keys_missing', code: EXIT.VAPID });
} else {
webpush.setVapidDetails(subject, pub, priv);

const deptCode = (dep) => String(dep || '').replace(/^BS\s+/i, '').trim().toUpperCase();
const fullBatch = (b) => (/^\d{2}$/.test(String(b || '').trim()) ? '20' + String(b).trim() : String(b || '').trim());
const sectionLetter = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
const slotKey = (dep, sec, batch, code, date) => [dep, sec, batch, code, date].join('|');

// Build the current snapshot of every section slot across all show-up files.
const current = new Map(); // slotKey -> { value, info }
for (const f of SHOWUP_DOCS) {
  const doc = await loadDocument(f);
  if (doc && (typeof doc !== 'object' || !Array.isArray(doc.exams))) {
    throw malformedDocument(`Show-up document "${f}" has no exams array.`);
  }
  const exams = doc && Array.isArray(doc.exams) ? doc.exams : [];
  for (const e of exams) {
    const secs = e.sections || {};
    for (const dep of Object.keys(secs)) {
      for (const tok of secs[dep] || []) {
        const key = slotKey(dep, sectionLetter(tok), fullBatch(e.batch), e.code || '', e.date || '');
        current.set(key, {
          value: `${e.time || ''}@${e.venue || ''}`,
          info: { course: e.course || e.code || 'your exam', day: e.day || '', date: e.date || '', time: e.time || '—', venue: e.venue || '—' },
        });
      }
    }
  }
}

if (current.size === 0) {
  console.log('No show-up data — nothing to do.');
  await job.finish({ outcome: 'no_op', reason: 'no_showup_data' });
} else {

const prevState = await loadState(STATE);
const firstRun = Object.keys(prevState).length === 0;

// Determine which slots changed time/venue (only meaningful after the first run).
const changed = new Map(); // slotKey -> info
if (!firstRun) {
  for (const [key, { value, info }] of current) {
    if (Object.prototype.hasOwnProperty.call(prevState, key) && prevState[key] !== value) {
      changed.set(key, info);
    }
  }
}

// Persist the new snapshot for next time (covers additions and removals).
const newState = {};
for (const [key, { value }] of current) newState[key] = value;
await saveState(STATE, newState);

if (firstRun) {
  console.log('First run — recorded show-up snapshot, no notifications sent.');
  await job.finish({ outcome: 'no_op', reason: 'first_snapshot_recorded' });
} else if (changed.size === 0) {
  console.log('No show-up time/venue changes.');
  await job.finish({ outcome: 'no_op', reason: 'no_changes' });
} else {

const subs = await loadSubs();
if (!Array.isArray(subs) || subs.length === 0) {
  console.log('Slots changed but no subscriptions.');
  await job.finish({ outcome: 'no_op', reason: 'no_subscriptions' });
} else {

let sent = 0, skipped = 0, failed = 0;
for (const entry of subs) {
  const subscription = entry?.subscription;
  if (!subscription?.endpoint) continue;
  if (!wants(entry, 'show')) { skipped++; continue; }
  const dep = deptCode(entry.department);
  const batch = fullBatch(entry.batch);
  const secLetter = sectionLetter(entry.section);
  if (!dep || !batch || !secLetter) { skipped++; continue; }

  const prefix = `${dep}|${secLetter}|${batch}|`;
  const mine = [...changed.entries()].filter(([key]) => key.startsWith(prefix));
  if (mine.length === 0) { skipped++; continue; }

  const name = String(entry.name || '').trim() || 'Student';
  for (const [key, info] of mine) {
    const when = [info.day, info.date].filter(Boolean).join(' ');
    const payload = JSON.stringify({
      title: 'Show-up schedule changed',
      body: `Dear ${name}, the show-up for ${info.course} has a new time & venue: ${info.time} at ${info.venue}${when ? ` (${when})` : ''}.`,
      url: '/',
      tag: `showup-${key}`,
    });
    try {
      await webpush.sendNotification(subscription, payload);
      recordNotificationDelivery({
        kind: 'showup', recipient: { name, nuid: entry.nuid || null, department: entry.department || null, batch: entry.batch || null, section: entry.section || null },
        change: { course: info.course, day: info.day || null, date: info.date || null, time: info.time, venue: info.venue },
      });
      sent++;
    } catch (err) {
      const code = err?.statusCode;
      if (code !== 404 && code !== 410) {
        failed++;
        console.warn(`showup push failed (${code || 'err'}): ${err?.message || err}`);
      }
    }
  }
}

console.log(`Show-up push summary — sent: ${sent}, skipped: ${skipped}, changed slots: ${changed.size}`);
await job.finish({ outcome: failed > 0 ? 'partial_push_failure' : sent > 0 ? 'sent' : 'no_op', counts: { sent, skipped, pruned: 0, failed } });
}
}
}
}
