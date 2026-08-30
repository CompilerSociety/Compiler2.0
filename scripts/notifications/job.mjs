// Lifecycle support for the short-lived notification Action entry points.
// Mongo's client is cached for serverless reuse, so an Action must explicitly
// release its pool before Node can drain its event loop.
import { closeMongo } from '../../lib/db/mongo.mjs';

export const EXIT = Object.freeze({
  SENT: 0,
  NOOP: 10,
  MONGO: 20,
  VAPID: 21,
  MALFORMED_DOCUMENT: 22,
  PARTIAL_PUSH_FAILURE: 23,
  HANG_PREVENTION_TIMEOUT: 24,
  UNEXPECTED: 1,
});

const SAFETY_TIMEOUT_MS = Number(process.env.NOTIFICATION_JOB_TIMEOUT_MS || 8 * 60_000);

function errorDetail(err) {
  if (!err) return null;
  return {
    name: err.name || 'Error', message: err.message || String(err),
    code: err.code ?? err.statusCode ?? null,
  };
}

function classify(err) {
  const text = `${err?.name || ''} ${err?.message || ''}`;
  if (err?.name === 'MalformedDocumentError') return EXIT.MALFORMED_DOCUMENT;
  if (/Mongo|MONGODB_URI|server selection|authentication|auth failed|ECONN|ENOTFOUND/i.test(text)) return EXIT.MONGO;
  if (/VAPID/i.test(text)) return EXIT.VAPID;
  return EXIT.UNEXPECTED;
}

export function malformedDocument(message) {
  const err = new Error(message);
  err.name = 'MalformedDocumentError';
  return err;
}

export function createNotificationJob(name) {
  const startedAt = Date.now();
  let finished = false;
  let finishing;
  const timer = setTimeout(() => {
    if (finished) return;
    const record = {
      event: 'notification_job_exit', job: name, outcome: 'hang_prevention_timeout',
      duration_ms: Date.now() - startedAt, counts: { sent: 0, skipped: 0, pruned: 0, failed: 0 },
      error: { name: 'HangPreventionTimeout', message: `Job exceeded ${SAFETY_TIMEOUT_MS}ms; an active handle or operation did not settle.` },
      exit_code: EXIT.HANG_PREVENTION_TIMEOUT,
    };
    console.error(JSON.stringify(record));
    // Do not await cleanup here: this path exists specifically for a stuck
    // event loop/operation and must give CI a deterministic outcome.
    process.exit(EXIT.HANG_PREVENTION_TIMEOUT);
  }, SAFETY_TIMEOUT_MS);

  async function finish({ outcome, counts = {}, code, error = null, reason = null }) {
    if (finished) return finishing;
    finished = true;
    clearTimeout(timer);
    if (!error && outcome === 'vapid_keys_missing') {
      error = new Error('VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY must both be configured.');
      error.name = 'VapidConfigurationError';
    }
    if (!error && outcome === 'partial_push_failure') {
      error = new Error(`${counts.failed || 0} push delivery attempt(s) failed; successful sends/state writes were retained.`);
      error.name = 'PushDeliveryPartialFailure';
    }
    finishing = (async () => {
      const exitCode = code ?? (counts.failed > 0 ? EXIT.PARTIAL_PUSH_FAILURE : counts.sent > 0 ? EXIT.SENT : EXIT.NOOP);
      try {
        await closeMongo();
      } catch (closeErr) {
        error ||= closeErr;
      }
      const record = {
        event: 'notification_job_exit', job: name, outcome,
        duration_ms: Date.now() - startedAt,
        counts: { sent: counts.sent || 0, skipped: counts.skipped || 0, pruned: counts.pruned || 0, failed: counts.failed || 0 },
        ...(reason ? { reason } : {}), ...(error ? { error: errorDetail(error) } : {}), exit_code: exitCode,
      };
      console.log(JSON.stringify(record));
      process.exitCode = exitCode;
    })();
    return finishing;
  }

  async function fail(err) {
    console.error(`[${name}] fatal error`, errorDetail(err));
    return finish({ outcome: 'failed', code: classify(err), error: err });
  }

  // Top-level await failures otherwise bypass the scripts' normal final log.
  process.once('uncaughtException', (err) => { void fail(err); });
  process.once('unhandledRejection', (err) => { void fail(err); });
  return { finish, fail };
}
