# VTable account verification and database migration plan

Date: 2026-09-06
Status: Implementation plan only. Authentication is not implemented by this document.

## Objective and agreed decisions

Require proof of NU ID ownership before a user changes server-side account records or behavior. Use email OTP, initially sent from Compilersociety@gmail.com through Gmail SMTP. Keep the existing JavaScript frontend, Vercel Node functions and MongoDB stack.

The confirmed Islamabad mapping is `25I-0816` -> `i250816@isb.nu.edu.pk`. Normalize and validate the NU ID on the server, then derive its email; do not accept an arbitrary recipient address from the browser. Support Islamabad IDs initially. Confirm other campus mappings before enabling them.

Every friendship requires recipient acceptance. After verification, MongoDB becomes the source of truth for account data currently stored in the browser.

## Access rules

| Action | Requirement |
| --- | --- |
| Browse public timetables and play without publishing scores | No verification |
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

See [Compiler Society Gmail setup](compilersociety-gmail-setup.txt). Proposed server variables are `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_ORIGIN` and `OTP_PEPPER`, alongside existing `MONGODB_URI` and `MONGODB_DB`. These names are a planned contract, not settings already consumed by the current app.

Gmail is the initial low-volume sender. Google documents possible sending restrictions above 500 emails in a day; resends and ordinary society mail also consume capacity. Use a conservative configurable application budget and migrate delivery to a dedicated provider before a large rollout. [Google sending limits](https://support.google.com/mail/answer/22839)

The sender account's SMTP authentication is separate from student authentication: students still verify using university-email OTP. Gmail supports SMTP with TLS. [Google SMTP documentation](https://developers.google.com/workspace/gmail/imap/imap-smtp)
