// Runs in GitHub Actions after the seating plan syncs.
// For every stored subscription, look up its NU ID in db/seating/plan.json;
// if the seat details changed since last time, send a system-tray push.
//
// Env: VAPID_PRIVATE_KEY (required), VAPID_PUBLIC_KEY (required),
//      VAPID_SUBJECT (optional, e.g. "mailto:compilersociety@gmail.com")
//
// Reads/writes (the workflow commits these):
//   db/seating/plan.json       - source seat data (read only)
//   db/metadata/notifications/push-subscriptions.json - who to notify (dead subs pruned)
//   db/metadata/notifications/push-state.json         - endpoint -> last seat hash (avoids re-spamming)

import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';

const SEATING = 'db/seating/plan.json';
const SUBS = 'db/metadata/notifications/push-subscriptions.json';
const STATE = 'db/metadata/notifications/push-state.json';

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')); }
  catch { return fallback; }
}
function writeJson(path, val) { fs.writeFileSync(path, JSON.stringify(val, null, 2) + '\n'); }

const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) {
  console.log('VAPID keys not set — skipping push send.');
  process.exit(0);
}
webpush.setVapidDetails(subject, pub, priv);

const seating = readJson(SEATING, { students: [] });
const students = Array.isArray(seating.students) ? seating.students : [];
const byNuid = new Map();
for (const s of students) {
  const k = String(s.nuid || '').trim().toUpperCase();
  if (k) byNuid.set(k, s);
}

const subs = readJson(SUBS, []);
const state = readJson(STATE, {});

if (!Array.isArray(subs) || subs.length === 0) {
  console.log('No subscriptions — nothing to send.');
  process.exit(0);
}

const seatHash = (s) =>
  crypto.createHash('sha1')
    .update([s.paper || '', s.time || '', s.class || '', s.seat || ''].join('|'))
    .digest('hex');

function buildMessage(student) {
  const name = student.name || 'Student';
  const paper = student.paper || 'your exam';
  const room = student.class || '—';
  const time = student.time || '—';
  const seat = student.seat || '—';
  // System-tray notifications are plain text (no bold possible here).
  return {
    title: 'Seating plan updated',
    body: `Dear ${name}, your seating plan for ${paper} is ${room} at ${time}. Seat ${seat}.`,
    url: '/',
    tag: `seat-${String(student.nuid || '').toUpperCase()}`,
  };
}

const keptSubs = [];
let sent = 0, skipped = 0, pruned = 0;

for (const entry of subs) {
  const nuid = String(entry?.nuid || '').trim().toUpperCase();
  const subscription = entry?.subscription;
  if (!nuid || !subscription?.endpoint) { continue; }

  const student = byNuid.get(nuid);
  if (!student) { keptSubs.push(entry); skipped++; continue; } // NU ID not in this plan yet

  const endpoint = subscription.endpoint;
  const hash = seatHash(student);
  if (state[endpoint] === hash) { keptSubs.push(entry); skipped++; continue; } // unchanged -> no spam

  const payload = JSON.stringify(buildMessage(student));
  try {
    await webpush.sendNotification(subscription, payload);
    state[endpoint] = hash;
    keptSubs.push(entry);
    sent++;
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) {
      // Subscription expired/unsubscribed — drop it.
      delete state[endpoint];
      pruned++;
    } else {
      console.warn(`push failed for ${nuid} (${code || 'err'}): ${err?.message || err}`);
      keptSubs.push(entry); // keep and retry next time
    }
  }
}

writeJson(SUBS, keptSubs);
writeJson(STATE, state);
console.log(`Push summary — sent: ${sent}, skipped: ${skipped}, pruned: ${pruned}`);
