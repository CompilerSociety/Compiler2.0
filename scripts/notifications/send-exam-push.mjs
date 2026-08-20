// Runs after the sync workflow completes. When an exam schedule has arrived and
// a subscribed user's department + batch + section all appear in it, send them a
// "best of luck" push — once per distinct exam schedule document.
//
// Env: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (required),
//      VAPID_SUBJECT (optional)
//
// Reads:  db/exams/*.json, db/metadata/notifications/push-subscriptions.json
// Writes: db/metadata/notifications/push-exam-state.json  (endpoint -> exam-doc id already notified)

import fs from 'node:fs';
import webpush from 'web-push';
import { wants } from './prefs.mjs';
import { readJson, writeJson, loadSubs, loadState, saveState } from './store.mjs';

// See send-class-push.mjs for why these must be the nested paths, not a flat
// db/ layout that no longer exists.
const EXAM_FILES = ['db/exams/computing.json', 'db/exams/business.json', 'db/exams/engineering.json'];
const SUBS = 'db/metadata/notifications/push-subscriptions.json';
const STATE = 'db/metadata/notifications/push-exam-state.json';


const priv = process.env.VAPID_PRIVATE_KEY;
const pub = process.env.VAPID_PUBLIC_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:compilersociety@gmail.com';
if (!priv || !pub) { console.log('VAPID keys not set — skipping exam push.'); process.exit(0); }
webpush.setVapidDetails(subject, pub, priv);

// Load every exam schedule file (computing / business / engineering).
const examDocs = EXAM_FILES
  .map((f) => readJson(f, null))
  .filter((d) => d && Array.isArray(d.exams));

if (examDocs.length === 0) { console.log('No exam schedules present — nothing to send.'); process.exit(0); }

const subs = await loadSubs();
if (!Array.isArray(subs) || subs.length === 0) { console.log('No subscriptions.'); process.exit(0); }
const state = await loadState(STATE);

const deptCode = (dep) => String(dep || '').replace(/^BS\s+/i, '').trim().toUpperCase();
const fullBatch = (b) => (/^\d{2}$/.test(String(b || '').trim()) ? '20' + String(b).trim() : String(b || '').trim());
const sectionLetter = (s) => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();

// Which exam is this? Derived from the workbook's file name.
function examType(doc) {
  const f = String(doc.source_filename || doc.source_subject || '').toLowerCase();
  // Check sessional/mid BEFORE final: filenames often say "(Version Final)" even
  // for a sessional schedule, so a bare "final" test would misclassify them.
  if (/(2nd|second|\bii\b)\s*sessional/.test(f) || f.includes('sessional 2')) return '2nd Sessional Exam';
  if (/(1st|first|\bi\b)\s*sessional/.test(f) || f.includes('sessional 1')) return '1st Sessional Exam';
  if (f.includes('sessional')) return 'Sessional Exam';
  if (f.includes('mid')) return 'Mid-Term Exam';
  if (/final\s*(exam|term|examination)/.test(f) || f.includes('terminal')) return 'Final Exam';
  return 'Examination';
}
// Stable id for a given exam document — changes when a new schedule arrives.
const docId = (doc) => String(doc.source_filename || doc.updated_at || 'exam');

function userMatches(doc, dep, batch, secLetter) {
  return doc.exams.some((e) => {
    if (String(e.batch || '').trim() !== batch) return false;
    const secs = (e.sections && e.sections[dep]) || [];
    return secs.some((tok) => sectionLetter(tok) === secLetter);
  });
}

let sent = 0, skipped = 0;
for (const entry of subs) {
  const subscription = entry?.subscription;
  if (!subscription?.endpoint) { continue; }
  if (!wants(entry, 'exam')) { skipped++; continue; }
  const dep = deptCode(entry.department);
  const batch = fullBatch(entry.batch);
  const secLetter = sectionLetter(entry.section);
  if (!dep || !batch || !secLetter) { skipped++; continue; } // pre-exam subscriptions lack these

  // Find the first exam document this user appears in.
  const doc = examDocs.find((d) => userMatches(d, dep, batch, secLetter));
  if (!doc) { skipped++; continue; }

  const id = docId(doc);
  const endpoint = subscription.endpoint;
  if (state[endpoint] === id) { skipped++; continue; } // already told them about this schedule

  const name = String(entry.name || '').trim() || 'Student';
  const payload = JSON.stringify({
    title: 'Exam schedule',
    body: `Dear ${name}, your examination schedule for ${examType(doc)} has arrived. Best of luck for your exams 🍀`,
    url: '/',
    tag: `exam-${id}`,
  });
  try {
    await webpush.sendNotification(subscription, payload);
    state[endpoint] = id;
    sent++;
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) { delete state[endpoint]; } // expired; seating sender prunes it
    else console.warn(`exam push failed (${code || 'err'}): ${err?.message || err}`);
  }
}

await saveState(STATE, state);
console.log(`Exam push summary — sent: ${sent}, skipped: ${skipped}`);
