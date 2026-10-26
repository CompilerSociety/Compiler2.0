# VTable account verification and database migration plan

Date: 2026-09-06
Status: Backend authentication, desktop/mobile OTP sign-in, protected registration/subscriptions, account-scoped profile reads and the session-gated friend lookup are implemented. The public roster gate is deployed but the `ALLOW_PUBLIC_ROSTER` switch still needs to be flipped off after the client rollout, then the rewrites removed. Account migration, batch 26 registration and friendships are still to come.

## Objective and agreed decisions

Require proof of NU ID ownership before a user changes server-side account records or behavior. Use email OTP, initially sent from Compilersociety@gmail.com through Gmail SMTP. Keep the existing JavaScript frontend, Vercel Node functions and MongoDB stack.

The confirmed Islamabad mapping is `25I-0816` -> `i250816@isb.nu.edu.pk`. Normalize and validate the NU ID on the server, then derive its email; do not accept an arbitrary recipient address from the browser. Support Islamabad IDs initially. Confirm other campus mappings before enabling them.

Every friendship requires recipient acceptance. After verification, MongoDB becomes the source of truth for account data currently stored in the browser.

## Access rules

| Action | Requirement |
| --- | --- |
| Browse public timetables and play without publishing scores | No verification |
| Read your own roster row | Verified session for that account |
| Look up a student by exact NU ID | Verified session, exact match, per-account limits |
| Download a batch or the full roster | Not public; no endpoint |
| Record batch 26 initial login/registration | Narrow unverified exception |
| Publish a score, including batch 26 | Verified session |
| Edit stored profile, courses or account preferences | Verified session belonging to that account |
| Send, accept, decline, cancel or remove a friendship | Verified session and permission for that action |
| Toggle allow friendships | Verified account owner |
| Create/change/remove push subscriptions and notification preferences | Verified session and subscription ownership |
| Administrative or automated dataset changes | Authorized administrator or authenticated service identity |

The batch 26 exception is append-only for initial registration and must not overwrite an existing profile, create a verified session or authorize any other action. Derive batch from the NU ID, never a separate client field. Treat initial profile claims as unverified until mailbox ownership is established.

OTP challenges, sessions, abuse counters and minimal operational logs necessarily write before verification; these are tightly scoped authentication infrastructure, not a general account-write exception.

## OTP and sessions

1. The browser requests verification for a normalized NU ID.
2. The server validates the campus mapping and applies database-backed limits per identity and IP, plus a global email budget.
3. Generate a cryptographically random six-digit code. Store only a keyed digest bound to the challenge and NU ID; keep the key in server environment variables.
4. Send the code to the derived university mailbox. Never log codes or return them to the browser API response.
5. Verify the challenge atomically with expiration, attempt and consumption checks. A successful code can establish only one session; simultaneous requests cannot reuse it.
6. Create a random opaque session token. Store its hash and account association in MongoDB and deliver the token in a Secure, HttpOnly, SameSite cookie.
7. Return the verified account, then perform the validated local-data import.

Proposed defaults: code expiry 10 minutes, maximum five failed attempts per challenge, resend cooldown 60 seconds, session expiry 30 days. Resending invalidates the prior code without resetting broader attempt limits. Bind the challenge to the requesting browser using an opaque nonce. Apply request size limits and generic errors that do not disclose account existence.

Check expiration in application code; MongoDB TTL cleanup is asynchronous. Logout revokes the server session. Account switching clears the previous account's cache. Verification outages reject protected writes instead of bypassing checks.

Every protected endpoint must derive the actor from the session, enforce ownership/roles, validate its payload and apply CSRF protection with a strict allowed origin. A browser flag, roster lookup or client-supplied NU ID is never authorization. A permanent verified flag does not let someone log in by typing that ID later.

## Database structure

Proposed collections, finalized during implementation:

- `accounts`: unique normalized NU ID, verified email and timestamp, validated profile, courses, preferences, friendship setting, revision and migration version.
- `auth_challenges`: challenge identifier, keyed code digest, browser binding, expiry, failed attempts and consumed state.
- `auth_sessions`: hashed token, account ID, expiry and revocation state.
- `friendships`: canonical unique account pair, requester, recipient, status and timestamps.
- `auth_rate_limits`: shared attempt, resend and send-budget counters.

Keep authoritative roster data separate from user-editable preferences. Do not let imported profile claims rewrite published academic records. Keep authentication collections inaccessible through public dataset endpoints.

## Browser-data migration

Inventory cookies, localStorage and sessionStorage in desktop and mobile code before implementing import. Include profile, courses, friends, timetable/exam preferences, theme and other persistent account settings. Browser caches and transient interface state may remain local; device-bound push endpoints remain associated with their device.

After successful verification:

1. Load database account data first.
2. Import only allowlisted, bounded and validated fields for the matching NU ID. Never transfer another local profile's data merely because a different account verified on the same browser.
3. Preserve existing database values. Fill missing fields from local data; use revisions to avoid overwriting concurrent changes.
4. Store imported friends as legacy saved entries requiring a new request. Do not create accepted relationships or send requests automatically.
5. Historical local game records may be retained as explicitly unverified personal history; never publish them as verified leaderboard scores.
6. Mark the import version complete atomically with the import, or use an equivalent resumable, idempotent design. Retrying must not duplicate records.
7. Retain the local copy until the server acknowledges success, then use account-scoped browser storage as a cache.

Do not upload the browser's entire storage blob. Verification proves mailbox access, not that every local value is true. If a later device has conflicting local data, retain database values and offer explicit review rather than silently replacing them.

## Friendships and privacy

Use pending -> accepted or declined requests. Only the recipient can accept/decline; only the requester can cancel a pending request. Either participant can remove an accepted friendship. Prevent self-requests, duplicate pairs and automatic acceptance of crossed requests.

Proposed default: allow friendships is off until enabled by the verified owner. Turning it off blocks new requests and acceptance of pending requests, while preserving existing accepted friendships. Make this behavior clear in the UI.

Enforce friendship permissions on server reads as well as writes. Expose personal course selections only to authorized viewers. Public timetable datasets remain public. Review existing public roster endpoints so they cannot bypass new restrictions on private account data.

## Implementation order

1. Audit all API mutations, legacy routes and automated writers. Current registration and leaderboard paths rely on submitted identity; the leaderboard's roster lookup must not fail open.
2. Add shared identity validation, SMTP delivery, OTP challenges, rate limits, sessions and authorization helpers.
3. Protect registration, scores, subscriptions and any legacy profile-writing route. Preserve only the defined batch 26 exception.
4. Add account read/update and migration endpoints, with strict field allowlists and ownership checks.
5. Add friendship endpoints and permission-aware reads.
6. Add the shared desktop/mobile verification UI and database-backed account settings. Preserve existing local data until import succeeds.
7. Validate in development using a mock mail transport, then test real delivery to an owner-controlled university mailbox after credentials are configured.
8. Deploy backend enforcement and compatible frontend together. Old clients must receive a verification-required response rather than retaining write access.

## Validation and rollout

Test expired/wrong/reused codes, resend invalidation, concurrent verification, shared rate limits, missing SMTP configuration and database outages. Test session expiry/revocation, forged NU IDs, cross-account updates and CSRF attempts. Confirm batch 26 cannot bypass protected actions.

Test migration retries, malformed payloads, multiple devices, mismatched local identities and preservation of existing database values. Test friendship acceptance authorization, duplicate/crossed requests, disabled friendships and private-data reads. Confirm unverified local scores never enter the public leaderboard. Account verification alone is not score anti-cheat; retain separate score validation.

Monitor delivery failures and quota exhaustion without recording codes, tokens or credentials. If delivery fails, keep browsing available and protected writes blocked. Do not restore anonymous writes as a rollback strategy.

## Email setup and configuration

See [Compiler Society Gmail setup](compilersociety-gmail-setup.txt). The auth slice consumes `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_ORIGIN`, `OTP_PEPPER` and `SESSION_PEPPER`, alongside existing `MONGODB_URI` and `MONGODB_DB`. SMTP delivery itself still needs to be exercised against a real inbox.

Gmail is the initial low-volume sender. Google documents possible sending restrictions above 500 emails in a day; resends and ordinary society mail also consume capacity. Use a conservative configurable application budget and migrate delivery to a dedicated provider before a large rollout. [Google sending limits](https://support.google.com/mail/answer/22839)

The sender account's SMTP authentication is separate from student authentication: students still verify using university-email OTP. Gmail supports SMTP with TLS. [Google SMTP documentation](https://developers.google.com/workspace/gmail/imap/imap-smtp)

## Implemented backend slice (2026-10-26)

The OTP + session loop now exists end to end at the API layer.

**Endpoints**

- `POST /api/auth/request-code` — validates the NU ID, derives the university mailbox on the server, stores a keyed code digest, emails a six-digit code, and sets a browser-bound nonce cookie.
- `POST /api/auth/verify` — checks the code against the challenge and nonce, claims the challenge atomically, creates the account, and sets an HttpOnly session cookie.
- `GET /api/auth/me` — resolves the account from the session cookie; never from a client-supplied NU ID. It also returns that account's roster row (`name`, `department`, `batch`, `section`) or `student: null`, which replaces the client-side batch-roster read.
- `GET /api/roster/lookup?nuid=...` — verified-session exact-match friend lookup. Returns `name`, `department` and `batch` only; there is no prefix search, batch listing, section or seat in the response.
- `POST /api/auth/logout` — revokes the session row and clears the cookie.
- `POST /api/leaderboard` — now requires a verified session. Score identity and display fields come from the session and roster, not the request body.

**Code**

- `lib/auth/nuid.mjs` — the ID → mailbox rule. Islamabad (`…I-…` → `i<batch><serial>@isb.nu.edu.pk`) is the only enabled campus; other campuses return `campus_not_supported` until their mapping is confirmed.
- `lib/auth/otp.mjs`, `lib/auth/tokens.mjs` — code generation, keyed digests, constant-time comparison.
- `lib/auth/session.mjs`, `lib/auth/cookies.mjs` — opaque server-side sessions, cookie handling.
- `lib/auth/mailer.mjs` — SMTP delivery; without credentials it prints the code to the server console **only when not on Vercel**.
- `lib/auth/guard.mjs` — origin check, session guard, production config check.
- `lib/db/collections.mjs` — `accounts`, `auth_challenges`, `auth_sessions`, `auth_rate_limits`, `roster_lookup_events` plus TTL/unique indexes (created by `ensureIndexes`, i.e. run the migration/setup path on a new database).
- `lib/db/repos.mjs` — `findStudentRow` supplies the session account's own row; `findStudentForFriend` is the minimal exact-match projection; `rosterLookupCheck`/`rosterLookupNote` keep weighted per-account counters in Mongo.

**Configuration**

- Required in production: `OTP_PEPPER`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (plus existing `MONGODB_URI`).
- Optional: `SMTP_PORT` (default 587), `SMTP_SECURE`, `SMTP_FROM`, `SESSION_PEPPER` (defaults to `OTP_PEPPER`), `APP_ORIGIN`.
- Rollout switches: `ALLOW_PUBLIC_ROSTER=0` closes `api/db.mjs?doc=students/*`; unset keeps the old read available for the first deploy so cached clients are not cut off. `ROSTER_LOOKUP_ENABLED=0` disables the friend lookup without a deploy.
- If `OTP_PEPPER` or SMTP is missing on Vercel, auth returns 503 rather than silently using weaker defaults.

## Implemented sign-in and protected writes (2026-10-26)

**Frontend**

- Desktop profile modal: NU ID -> send code -> enter the six-digit code -> verified session -> own roster row from `/api/auth/me`. `/api/auth/me` also restores the session when the modal opens, and "Sign out" revokes it and clears the cached profile.
- Mobile sign-in: the same two-step flow inline on `#m-signin`, reusing an existing session instead of sending a second code.
- Registration and profile saving now require the typed NU ID to match the verified session. A session for one account cannot publish another account's profile.
- `/api/register` and `/api/subscribe` calls send the session cookie; `web/js/app.js` no longer sends identity fields for those writes.

**Server**

- `POST /api/register` requires a session. The roll number and batch come from the session; the body only supplies name, department and section.
- `POST /api/subscribe` requires a session. The roll number and batch come from the session; the display fields, endpoint, preferences and course overlay still come from the body.
- `DELETE /api/subscribe` deliberately remains capability-based: the unguessable push endpoint is the authorization, which lets a student turn notifications off even when signed out. Local unsubscribe is the authoritative off switch.
- CORS wildcards were removed from both routes; state-changing requests are same-origin checked.
- `api/db.mjs?doc=students/*` is behind `ALLOW_PUBLIC_ROSTER`. When closed it returns 403 before touching the roster, and no legacy `/db/students/*.json` rewrite can bypass the check.
- Friend lookup is session-gated and exact-match only. It is weighted per account (60/hour, 200/day, a miss costs five) in `roster_lookup_events`, logs account/target/result, and stores events with a 24-hour TTL.
- `/api/auth/me` and the friend flow fail closed: there is no public-roster fallback when auth or the database is unavailable.
- The OTP request limiter also fails closed. If the per-IP or per-NU-ID counters cannot be read or written, the request returns 503 and no code is created or emailed. Accepted attempts are booked before the email is sent.

**Verification**

- `npm run auth:smoke` and `npm run db:smoke` pass. The auth smoke test also checks that `/api/register`, `POST /api/subscribe` and `/api/roster/lookup` never accept an anonymous caller.
- `node --check` passes on the modified `.mjs` and frontend `.js` files.
- Local dev-server checks: `/api/auth/me` returns 401 signed out; register, subscribe, request-code and friend lookup return 503 without `MONGODB_URI`; static pages still load.
- `auth:smoke` also checks that an unreadable auth limiter returns 503, sets no nonce cookie, and that rate-limit booking surfaces storage faults.
- The in-memory Mongo integration test now asserts `students/26` is denied when `ALLOW_PUBLIC_ROSTER=0`, and the mobile friend browser test mocks the authenticated lookup response.

**Still pending**

- Flip `ALLOW_PUBLIC_ROSTER=0` after the new clients are live, then remove the `/db/students/*.json` rewrites in a later release. An old cached client will otherwise lose profile sync at the flip.
- Purge the CDN copies of `/db/students/*.json` after flipping the flag; the old 200 response had `s-maxage=300, stale-while-revalidate=3600`.
- Importing existing browser profile/course/preferences into the account after verification.
- Batch 26 unverified initial-registration exception.
- Friendships and permission-aware reads, beyond the exact friend lookup above.
- End-to-end integration test against a real MongoDB database and a test SMTP inbox (`npm run auth:smoke` covers the pure helpers and anonymous endpoint guards, not the DB-backed session path).
