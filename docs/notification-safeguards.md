# Notification delivery safeguards

All four senders (class changes, exam schedules, show-up changes, seating plans)
use `scripts/notifications/delivery.mjs`. Before contacting a push provider, they
insert an event claim into MongoDB's `notification_deliveries` collection. Its
unique `_id` hashes the normalized student NU ID, category and event details.
This collection is created automatically on first use and requires no migration.

Only one device receives a given student/event notification. The most recently
updated subscription is considered first. Existing per-device delivery state is
checked during migration so previously delivered events aren't announced again.
Claims survive job retries, concurrent jobs, endpoint changes and failed writes
to the older notification-state collection. Claims are not expired or reset on
sign-out. Changing notification details creates a different event; identical
class details remain suppressed even if the class temporarily recovered.

This deliberately provides **at-most-once submission**, not guaranteed delivery.
An explicit provider rejection releases the claim for retry/fallback. A timeout,
unknown provider error, or crash after claiming retains it because delivery may
already have occurred. That can lose an alert, but avoids resending it. Database
claim errors fail closed. The service worker also uses the event ID as its tag
and disables re-alerting for replacements of the same visible notification.

Course edits are synchronized through `/api/subscribe`, including on startup
and reconnection. The newest edited course overlay is used for all subscriptions
of that student: section defaults minus removed names, plus explicitly added
courses with their originating school, program, batch and section. Class,
exam and show-up matching respects that overlay; seating checks its paper name.
Name comparison supports exact normalized names, acronyms and corresponding
abbreviated words, and keeps labs distinct. Unrelated naming conventions still
require a shared course identifier in the source data for reliable matching.
Legacy subscriptions without course preferences retain their previous defaults
until the student opens the updated app and successfully synchronizes.

Validation (fixture transport only; no real notifications):

```
node --test scripts/test/notification-safeguards.mjs
node scripts/test/class-push-integration.mjs
```
