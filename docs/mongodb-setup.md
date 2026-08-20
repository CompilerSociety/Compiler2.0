# MongoDB setup

`db/` moved to MongoDB. This is the one-time setup to switch it on.

Until `MONGODB_URI` is set, **nothing changes**: every endpoint reads the
committed JSON exactly as it did before, and the write paths refuse with the
same 503 they already returned when `GH_TOKEN` was missing. So you can do this
whenever you like, and roll it back by clearing one variable.

---

## 1. Create a free Atlas cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster** → choose **M0 (Free)**. Any region near Pakistan is fine
   (`ap-south-1`, Mumbai, is the closest). M0 gives 512 MB, which is far more
   than this project needs — the whole of `db/` is 1.6 MB today.
3. **Database Access** → *Add New Database User*. Pick a username and let Atlas
   generate the password. Give it the **Read and write to any database** role.
   Save the password somewhere safe; Atlas will not show it again.
4. **Network Access** → *Add IP Address* → **Allow access from anywhere**
   (`0.0.0.0/0`).

   This is required, not laziness: Vercel functions and GitHub Actions runners
   both get arbitrary egress IPs, so there is no range to allowlist. The
   database user's password is what protects the cluster, which is why it must
   be a strong generated one.
5. **Connect** → *Drivers* → *Node.js*, and copy the connection string. It looks
   like:

   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Replace `<password>` with the real password. If the password contains any of
   `@ : / ? # [ ] %`, percent-encode those characters or the URI will not parse.

**Treat that string as a credential.** It grants full read/write access. Do not
commit it, paste it into an issue, or put it in a client-side file.

---

## 2. Set it where the code runs

Three places, same value:

| Where | How |
| --- | --- |
| **Vercel** (the API functions) | Project → Settings → Environment Variables → add `MONGODB_URI` for Production, Preview and Development |
| **GitHub Actions** (the sync jobs, push senders and mirror export) | Repo → Settings → Secrets and variables → Actions → New repository secret → `MONGODB_URI` |
| **Your machine** (to run the migration) | set it in your shell for the one command below |

`MONGODB_DB` is optional and defaults to `compiler2`.

---

## 3. Migrate the existing data

From a clean checkout, with `MONGODB_URI` set in your shell:

```bash
node scripts/db/migrate-to-mongo.mjs --dry-run
```

That writes nothing and reports what it would import. It should look like:

```
leaderboard_scores      118 documents
rate_limit                1 documents
push_subscriptions       88 documents
notify_state            641 documents
students               4361 documents
roster_meta               5 documents
documents                10 documents
```

Then run it for real:

```bash
node scripts/db/migrate-to-mongo.mjs
```

It is **idempotent and never deletes** — every write is an upsert keyed by a
natural id. Re-running it after a partial failure is safe, and a score saved
after you took the snapshot will not be rolled back by running it again.

---

## 4. Check it worked

```bash
node scripts/db/smoke-test.mjs
```

With `MONGODB_URI` set this exercises the live path, including that a lower
score is correctly rejected as "not a personal best". With it unset it proves
the fallback still works.

Then redeploy Vercel so the functions pick up the new variable.

---

## How the pieces fit

**MongoDB is the source of truth. `db/*.json` stays as a generated mirror.**

That is the whole design, and it is why the migration is not a cliff edge:

- The frontend fetches `/db/timetable-computing.json` and friends as **static
  files** through the `vercel.json` rewrites — no API call, no auth, no database.
  Those keep working.
- `api/leaderboard.js` and `api/subscribe.js` fall back to the committed copy
  when Atlas is unreachable, so an outage makes the site **read-only** rather
  than broken.
- `python/tools/timetable_audit/*.py` read `db/timetables/*.json` off disk.

The mirror is kept fresh two ways. The Python sync jobs and the push senders
write their files *and* Mongo, and the workflow that runs them already commits
the result. Everything written by the Vercel functions — scores, registrations,
subscriptions — never touches git at all, so
`.github/workflows/export-db-mirror.yml` exports it once a day.

Once a day is deliberate. That export is now the only thing that commits arcade
scores, and the point of the move was to stop a busy evening of play from
spending the day's Vercel deploy quota. One commit a day, one deployment.

### Collections

| Collection | Holds | `_id` |
| --- | --- | --- |
| `leaderboard_scores` | one row per player per game | `<game>:<nuid>` |
| `students` | one row per student | `<nuid>` |
| `roster_meta` | per-batch roster header | `<batch>` |
| `push_subscriptions` | one row per device | push endpoint |
| `notify_state` | what each device was last told | `<kind>:<key>` |
| `rate_limit` | per-IP sliding window | client IP |
| `documents` | generated blobs, stored verbatim | e.g. `timetables/computing` |

Runtime records are one document each, so a score or a registration is a single
atomic upsert — which is what removed the read-modify-write races and the retry
loops the old GitHub-Contents-API code needed. The generated blobs keep their
exact JSON shape under a `data` field, so `api/timetable.js` and the frontend
parse precisely what they parsed before.

Push endpoints and client IPs are used as *keys*, and they are full of dots,
which cannot be MongoDB field names. That is why each becomes its own document
rather than a field on one big one.

---

## Rolling back

Clear `MONGODB_URI` everywhere and redeploy. Reads revert to the committed JSON
and writes return 503 — the same behaviour as a missing `GH_TOKEN`. The mirror
is at most a day behind, so at worst you lose the scores and registrations from
since the last export.
