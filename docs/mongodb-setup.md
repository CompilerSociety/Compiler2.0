# MongoDB setup

`db/` moved to MongoDB. This is the one-time setup to switch it on.

`MONGODB_URI` is now **required**. The committed `db/*.json` tree has been
deleted, so without it the site has no data at all — see "What happens when the
database is down" below for exactly how each part fails.

---

## 1. Create a free Atlas cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster** → choose **M0 (Free)**. Any region near Pakistan is fine
   (`ap-south-1`, Mumbai, is the closest). M0 gives 512 MB, which is far more
   than this project needs — the whole dataset is about 1.6 MB.
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

**MongoDB is the only store. `db/*.json` no longer exists.**

Nothing about this data touches git any more. A score, a registration, a
subscription, a regenerated timetable — none of them produce a commit.

The frontend still asks for the same URLs it always did
(`/db/timetable-computing.json` and ~35 others). The `vercel.json` rewrites
point those at [`api/db.js`](../api/db.js), which serves the identical JSON
from MongoDB. No client code changed; the data is simply live now instead of
being as old as the last commit.

Reads are cached at Vercel's edge (`s-maxage`) so a few thousand students
loading a timetable do not each become an Atlas query — a free M0 cluster has
500 connections in total. Leaderboards are the deliberate exception: they are
`no-store`, because serving a cached score would undo the point of the move.

### Collections

| Collection | Holds | `_id` |
| --- | --- | --- |
| `leaderboard_scores` | one row per player per game | `<game>:<nuid>` |
| `students` | one row per student per department/section | `<nuid>:<dept>:<section>` |
| `roster_meta` | per-batch roster header | `<batch>` |
| `push_subscriptions` | one row per device | push endpoint |
| `notify_state` | what each device was last told | `<kind>:<key>` |
| `rate_limit` | per-IP sliding window | client IP |
| `documents` | generated blobs, stored verbatim | e.g. `timetables/computing` |

Runtime records are one document each, so a score or a registration is a single
atomic upsert — which is what removed the read-modify-write races the old
GitHub-Contents-API code needed retry loops for. Generated blobs keep their
exact JSON shape under a `data` field, so `api/timetable.js` and the frontend
parse precisely what they parsed before.

A student is keyed by roll no **and** department/section, never roll no alone:
someone enrolled across two departments holds a row for each. Push endpoints and
client IPs are used as keys and are full of dots, which cannot be MongoDB field
names — hence one document each rather than fields on one big one.

### What happens when the database is down

The failure policy differs per call, on purpose:

- **Page data** returns 503. An empty timetable would render as "no classes
  today", and a wrong answer is worse than a visible error.
- **Roster and rate-limit checks fail open.** An outage must never lock real
  students out of registering or submitting a score.
- **Notification state throws and the senders abort.** Treating unreadable state
  as empty would make every sender believe nothing had ever been sent and
  re-deliver its entire backlog to every device.

---

## Backups — read this

**An Atlas M0 free cluster has no automated backups**, and deleting `db/`
removed the only other copy of this data. That is what
[`.github/workflows/backup-mongo.yml`](../.github/workflows/backup-mongo.yml)
is for: it dumps the database daily to the old JSON layout and uploads it as a
GitHub Actions artifact, retained 30 days. An artifact rather than a commit,
since the whole point was to stop this data churning the repo.

It fails loudly if `MONGODB_URI` is missing or the dump looks suspiciously
small, because a backup job that silently uploads an empty archive is worse
than none at all.

**To restore**, download an artifact, unzip it, and point the import at it:

```bash
node scripts/db/migrate-to-mongo.mjs --from path/to/unzipped
```

That is safe to run against a live database. It only ever upserts, never
deletes, and it can only raise a high score, never lower one — so recovering
from a week-old dump cannot demote anybody to last week's numbers.

---

## Rolling back

There is no committed JSON to fall back to any more, so rolling back means
restoring from a backup artifact into a database, not clearing a variable. If
you need the pre-migration state, it is in git history at the commit before
`Delete db/, serve everything live from MongoDB`.
