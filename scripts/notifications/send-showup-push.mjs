// Runs after the show-up schedule is (re)synced. Detects when a section's
// show-up slot changed time or venue and notifies subscribed users in that
// section with the new time & venue.
//
// Env: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (required), VAPID_SUBJECT (optional)
//
// Reads:  db/showup/*.json, db/metadata/notifications/push-subscriptions.json
// Writes: db/metadata/notifications/showup-notify-state.json  (slotKey -> "time@venue" last seen)
//
// The state file is what makes this a *change* detector: on the first run it is
// just recorded (no spam), and thereafter only slots whose time/venue differ
// from the stored value fire a notification.

import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const DB = 'db';
const SUBS = path.join(DB, 'push-subscriptions.json');
const STATE = path.join(DB, 'showup-notify-state.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function writeJson(p, val) { fs.writeFileSync(p, JSON.stringify(val, null, 2) + '\n'); }

const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) { console.log('VAPID keys not set — skipping show-up push.'); process.exit(0); }
webpush.setVapidDetails(subject, pub, priv);

const deptCode = (dep) => String(dep || '').replace(/^BS\s+/i, '').trim().toUpperCase();
const fullBatch = (b) => (/^\d{2}$/.test(String(b || '').trim()) ? '20' + String(b).trim() : String(b || '').trim());
const sectionLetter = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
const slotKey = (dep, sec, batch, code, date) => [dep, sec, batch, code, date].join('|');

// Build the current snapshot of every section slot across all show-up files.
const files = fs.existsSync(DB)
  ? fs.readdirSync(DB).filter((f) => /^showup-schedule-.*\.json$/.test(f))
  : [];
const current = new Map(); // slotKey -> { value, info }
for (const f of files) {
  const doc = readJson(path.join(DB, f), null);
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

if (current.size === 0) { console.log('No show-up data — nothing to do.'); process.exit(0); }

const prevState = readJson(STATE, {});
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
writeJson(STATE, newState);

if (firstRun) { console.log('First run — recorded show-up snapshot, no notifications sent.'); process.exit(0); }
if (changed.size === 0) { console.log('No show-up time/venue changes.'); process.exit(0); }

const subs = readJson(SUBS, []);
if (!Array.isArray(subs) || subs.length === 0) { console.log('Slots changed but no subscriptions.'); process.exit(0); }

let sent = 0, skipped = 0;
for (const entry of subs) {
  const subscription = entry?.subscription;
  if (!subscription?.endpoint) continue;
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
      sent++;
    } catch (err) {
      const code = err?.statusCode;
      if (code !== 404 && code !== 410) console.warn(`showup push failed (${code || 'err'}): ${err?.message || err}`);
    }
  }
}

console.log(`Show-up push summary — sent: ${sent}, skipped: ${skipped}, changed slots: ${changed.size}`);
