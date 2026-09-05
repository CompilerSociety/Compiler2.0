import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { claimDelivery, releaseDelivery } from './store.mjs';

export function recipientKey(entry) {
  return entry.nuid ? String(entry.nuid).trim().toUpperCase() : String(entry.subscription?.endpoint || '');
}

// Claim before talking to the push service. Mongo's unique _id makes this
// atomic across devices, concurrent jobs, restarts and failed state saves.
// Never retry an ambiguous network failure: the provider may have accepted it.
export function createDelivery({ claim = claimDelivery, release = releaseDelivery, send = webpush.sendNotification.bind(webpush) } = {}) {
  return async function deliver(entry, kind, event, payload, alreadyDelivered = false) {
    const id = createHash('sha256').update(JSON.stringify([recipientKey(entry), kind, event])).digest('hex');
    if (!await claim(id, kind)) return false;
    if (alreadyDelivered) return false; // Import legacy delivery history.
    try {
      await send(entry.subscription, JSON.stringify({ ...JSON.parse(payload), notificationId: id }));
      return true;
    } catch (error) {
      // Explicit rejection means no notification was accepted. Permit retry or
      // fallback to another device; retain the claim for timeouts/unknown errors.
      if ([400, 401, 403, 404, 410, 413, 429].includes(error?.statusCode)) await release(id);
      throw error;
    }
  }

}
export const deliverOnce = createDelivery();
