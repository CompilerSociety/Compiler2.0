// Runs the real class sender twice with a fixture store and a no-network push
// transport. This verifies its persisted per-device deduplication end to end.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler2-class-push-'));
const stateFile = path.join(temp, 'state.json');
const sendLog = path.join(temp, 'sends.ndjson');
const loader = path.join(root, 'scripts/test/class-push-fixtures/loader.mjs');
const sender = 'scripts/notifications/send-class-push.mjs';

function run(label, expectedExitCode) {
  const result = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, sender], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLASS_PUSH_TEST_STATE_FILE: stateFile,
      CLASS_PUSH_TEST_SEND_LOG: sendLog,
      VAPID_PUBLIC_KEY: 'test-public-key', VAPID_PRIVATE_KEY: 'test-private-key',
      VAPID_SUBJECT: 'mailto:test@example.invalid',
    },
  });
  process.stdout.write(`\n--- ${label} ---\n${result.stdout}${result.stderr}`);
  assert.equal(result.status, expectedExitCode, `${label} exited ${result.status}`);
  const summary = /Class push summary — sent: (\d+), skipped: (\d+), recovered\/pruned: (\d+)/.exec(result.stdout);
  assert.ok(summary, `${label} did not emit class summary`);
  return summary.slice(1).map(Number);
}

try {
  assert.deepEqual(run('first run', 0), [1, 1, 0]);
  assert.deepEqual(run('second run', 10), [0, 1, 0]);
  const sends = fs.readFileSync(sendLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].endpoint, 'https://test.invalid/matching');
  assert.equal(sends[0].payload.title, 'Class rescheduled');
  console.log('\nPASS: the first run planned one fixture delivery; the second planned zero duplicates.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
