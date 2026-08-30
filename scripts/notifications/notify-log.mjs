// TEMPORARY DELIVERY AUDIT ---------------------------------------------------
// Set this to false (or remove this module's callers) to stop writing the
// repository-root notifylog.jsonl file. Do not record subscription endpoints,
// p256dh/auth keys, or payloads: this log is committed to Git history.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENABLE_NOTIFY_LOG = true;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOG_FILE = path.join(REPO_ROOT, 'notifylog.jsonl');

export function recordNotificationDelivery(record) {
  if (!ENABLE_NOTIFY_LOG) return;
  const line = JSON.stringify({
    sent_at: new Date().toISOString(),
    ...record,
  });
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}
