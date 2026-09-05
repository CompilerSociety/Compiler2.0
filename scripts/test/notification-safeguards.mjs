import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery } from '../notifications/delivery.mjs';
import { sanitizeCoursePrefs, wantsCourse, wantsPaper } from '../../lib/notification-courses.mjs';

const student = { nuid: '25I-1234', department: 'BS CS', batch: '25', section: '2G', subscription: { endpoint: 'device-one' } };
const event = { school: 'computing', dept: 'CS', batch: '2025', section: 'G', course: 'Data St Rescheduled' };

test('course overlay removes defaults, retains others and supports explicit picks', () => {
  const entry = { ...student, coursePrefs: sanitizeCoursePrefs({ removed: ['data st'], added: [], revision: 1 }) };
  assert.equal(wantsCourse(entry, event), false);
  assert.equal(wantsCourse(entry, { ...event, course: 'Data Structures' }), false);
  assert.equal(wantsPaper({ coursePrefs: { removed: ['PF'], added: [] } }, 'Programming Fundamentals'), false);
  assert.equal(wantsPaper({ coursePrefs: { removed: ['PF'], added: [] } }, 'Programming Fundamentals Lab'), true);
  assert.equal(wantsCourse(entry, { ...event, course: 'PF' }), true);
  assert.equal(wantsCourse(entry, { ...event, course: 'PF', section: 'A' }), false);
  assert.equal(wantsCourse(student, event), true); // old subscriptions
  entry.coursePrefs.added.push({ school: 'computing', dept: 'BS CS', batch: '2025', section: 'A', name: 'Data St' });
  assert.equal(wantsCourse(entry, { ...event, section: 'A' }), true);
  assert.equal(wantsCourse(entry, event), false);
  assert.equal(wantsPaper({ ...entry, coursePrefs: { removed: ['Data St'], added: [] } }, 'Data St'), false);
  assert.equal(wantsCourse(student, { ...event, section: 'ALL' }), true);
  assert.equal(wantsCourse(student, { ...event, school: 'engineering' }), false);
  assert.throws(() => sanitizeCoursePrefs({ removed: Array(41).fill('PF'), added: [] }));
  assert.throws(() => sanitizeCoursePrefs({ removed: [42], added: [] }));
});

function fixture() {
  const claims = new Set(), sends = [];
  let failure;
  const deliver = createDelivery({
    claim: async id => { if (claims.has(id)) return false; claims.add(id); return true; },
    release: async id => claims.delete(id),
    send: async (subscription, payload) => {
      if (failure) throw failure;
      sends.push({ subscription, payload: JSON.parse(payload) });
    },
  });
  return { deliver, sends, claims, fail: error => { failure = error; } };
}
const payload = JSON.stringify({ title: 'Class cancelled', body: 'Test', tag: 'class-test' });

test('concurrent jobs and multiple devices deliver once per student for every category', async () => {
  for (const kind of ['class', 'exam', 'showup', 'seating']) {
    const f = fixture();
    const second = { ...student, nuid: '25i-1234', subscription: { endpoint: 'device-two' } };
    await Promise.all(Array.from({ length: 20 }, (_, i) => f.deliver(i % 2 ? student : second, kind, 'event-1', payload)));
    assert.equal(f.sends.length, 1);
    assert.ok(f.sends[0].payload.notificationId);
    assert.equal(await f.deliver(student, kind, 'event-1', payload), false);
    assert.equal(await f.deliver(student, kind, 'event-2', payload), true);
    assert.equal(await f.deliver({ ...student, nuid: '25I-5678' }, kind, 'event-1', payload), true);
  }
});

test('legacy history is claimed without redelivery', async () => {
  const f = fixture();
  assert.equal(await f.deliver(student, 'class', 'old', payload, true), false);
  assert.equal(await f.deliver(student, 'class', 'old', payload), false);
  assert.equal(f.sends.length, 0);
});

test('ambiguous failures stay claimed; explicit rejection permits retry', async () => {
  const f = fixture();
  f.fail(new Error('timeout after provider may have accepted'));
  await assert.rejects(f.deliver(student, 'class', 'uncertain', payload));
  f.fail(null);
  assert.equal(await f.deliver(student, 'class', 'uncertain', payload), false);
  f.fail(Object.assign(new Error('expired'), { statusCode: 410 }));
  await assert.rejects(f.deliver(student, 'class', 'rejected', payload));
  f.fail(null);
  assert.equal(await f.deliver(student, 'class', 'rejected', payload), true);
});

test('unavailable delivery store fails closed', async () => {
  let sends = 0;
  const deliver = createDelivery({ claim: async () => { throw Error('database unavailable'); }, send: async () => sends++ });
  await assert.rejects(deliver(student, 'class', 'event', payload));
  assert.equal(sends, 0);
});
