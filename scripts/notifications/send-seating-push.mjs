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
import { wants } from './prefs.mjs';
import { readJson, loadSubs, loadState, saveState, pruneSubs } from './store.mjs';

const SEATING = 'db/seating/plan.json';
const SUBS = 'db/metadata/notifications/push-subscriptions.json';
const STATE = 'db/metadata/notifications/push-state.json';


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

const subs = await loadSubs();
const state = await loadState(STATE);

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

  // This is the one sender that rewrites the subscription file from keptSubs,
  // so an opted-out device MUST be pushed back onto keptSubs before skipping.
  // Bare `continue` here would delete the subscription outright and the student
  // would have to grant permission again to turn the category back on.
  if (!wants(entry, 'seat')) { keptSubs.push(entry); skipped++; continue; }

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

await pruneSubs(keptSubs);
await saveState(STATE, state);
console.log(`Push summary — sent: ${sent}, skipped: ${skipped}, pruned: ${pruned}`);
