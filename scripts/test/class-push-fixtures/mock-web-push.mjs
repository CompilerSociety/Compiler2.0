// Test-only transport: records the intended delivery locally and never sends.
import fs from 'node:fs';

const sendLog = process.env.CLASS_PUSH_TEST_SEND_LOG;
if (!sendLog) throw new Error('CLASS_PUSH_TEST_SEND_LOG is required');

export default {
  setVapidDetails() {},
  async sendNotification(subscription, payload) {
    fs.appendFileSync(sendLog, `${JSON.stringify({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })}\n`);
  },
};
