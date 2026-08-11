// Runs when a timetable JSON changes. Notifies affected users (matched by
// department + batch + section) when a class becomes Cancelled or Rescheduled.
//
// De-dup is PER DEVICE and PERMANENT: db/metadata/notifications/class-notify-state.json maps each
// subscription endpoint -> { "<slotKey>||<status|time|venue>": true } for every
// cancel/reschedule that device has already been sent. We only ever send a
// cancel/reschedule a device has NOT received before; anything it already got
// is never sent again (whether or not it was opened), even though that entry
// keeps living in the timetable JSON. A genuinely different change to the same
// class (new time/venue) is a new composite, so it is sent.
//
// Env: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (required), VAPID_SUBJECT (optional)
// Reads:  db/timetables/*.json, db/metadata/notifications/push-subscriptions.json
// Writes: db/metadata/notifications/class-notify-state.json

import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const DB = 'db';
const SUBS = path.join(DB, 'push-subscriptions.json');
const STATE = path.join(DB, 'class-notify-state.json');

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
const files = fs.existsSync(DB) ? fs.readdirSync(DB).filter((f) => /^timetable-.*\.json$/.test(f)) : [];
const slots = []; // { slotKey, value, status, deptKey, batch, secLetter, section, course, day, time, venue }
for (const f of files) {
  const doc = readJson(path.join(DB, f), null);
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

let sent = 0, skipped = 0;
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

    // Only this device's matching, currently cancelled/rescheduled classes.
    const mine = slots.filter((s) => s.status !== 'Normal' && s.deptKey === dep && s.batch === batch && s.secLetter === secLetter);

    for (const s of mine) {
      const composite = `${s.slotKey}||${s.value}`;
      if (seen[composite]) { continue; } // this device already received this exact cancel/reschedule
      const body = s.status === 'Cancelled'
        ? `Dear ${name}, your class ${s.course} (${s.section}) has been cancelled.`
        : `Dear ${name}, your class ${s.course} (${s.section}) has been rescheduled to ${s.time} at ${s.venue}.`;
      const payload = JSON.stringify({
        title: s.status === 'Cancelled' ? 'Class cancelled' : 'Class rescheduled',
        body, url: '/', tag: `class-${s.deptKey}-${s.batch}-${s.secLetter}-${s.course}-${s.day}`,
      });
      try {
        await webpush.sendNotification(subscription, payload);
        seen[composite] = true; // remember permanently — never send this one to this device again
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
console.log(`Class push summary — sent: ${sent}, skipped: ${skipped}`);
