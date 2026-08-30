// Test-only store used by class-push-integration.mjs. It never contacts Mongo.
import fs from 'node:fs';

const stateFile = process.env.CLASS_PUSH_TEST_STATE_FILE;
if (!stateFile) throw new Error('CLASS_PUSH_TEST_STATE_FILE is required');

const documents = {
  'timetables/computing': {
    tt: {
      'BS CS': {
        '2025': {
          G: {
            Monday: [
              { name: 'Data St', location: 'C-401', time: '11:30-12:50', note: 'Rescheduled' },
              { name: 'PF', location: 'C-301', time: '08:30-09:50' },
            ],
          },
        },
      },
    },
  },
  'timetables/business': { tt: {} },
  'timetables/engineering': { tt: {} },
};

const subscriptions = [
  { name: 'Test Student', department: 'BS CS', batch: '2025', section: 'G', subscription: { endpoint: 'https://test.invalid/matching' } },
  { name: 'Opted Out', department: 'BS CS', batch: '2025', section: 'G', prefs: { cls: false }, subscription: { endpoint: 'https://test.invalid/opted-out' } },
  { name: 'Other Section', department: 'BS CS', batch: '2025', section: 'A', subscription: { endpoint: 'https://test.invalid/other-section' } },
];

export async function loadDocument(id) { return documents[id] ?? null; }
export async function loadSubs() { return subscriptions; }
export async function loadState() {
  return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
}
export async function saveState(_name, state) {
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}
export async function pruneSubs() {}
