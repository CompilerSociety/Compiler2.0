/**
 * Gmail -> GitHub trigger for the seating-plan / exam-schedule / show-up
 * schedule sync.
 *
 * Watches the compilersociety mailbox and fires the "Sync seating plan / exam
 * schedule / show up schedule" GitHub Actions workflow ONLY when a new unread
 * email with "seating", "schedule", OR "showup" in the subject arrives. No
 * matching email => no run. The Python backend (api/fetch-timetable.py)
 * inspects the subject itself to decide which pipeline to run (seating PDF vs
 * exam-schedule/show-up-schedule xlsx).
 *
 * ── SETUP (do this once, signed in as compilersociety@gmail.com) ──────────────
 * 1. Go to https://script.google.com  ->  New project.
 * 2. Delete the sample code, paste this whole file.
 * 3. Create the GitHub fine-grained PAT at
 *    https://github.com/settings/tokens?type=beta
 *    Repository access = only "Riftwalker23x/Compiler2.0",
 *    Permissions -> Repository -> "Contents: Read and write".
 *    (Or a classic token with the "repo" scope.)
 * 4. Create a random dispatch secret, e.g.
 *    `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`, and:
 *      a) Add it as a repo secret in
 *         https://github.com/Riftwalker23x/Compiler2.0/settings/secrets/actions
 *         named SYNC_DISPATCH_SECRET (same value here). The workflow refuses
 *         dispatches whose client_payload.secret does not match.
 *      b) Optionally add a repo secret SYNC_DISPATCH_ALLOWED_SENDERS =
 *         "<your-github-login>" to also allowlist the PAT owner as the sender.
 * 5. Store both values as script properties so they are NOT committed to any
 *    repo (Project Settings / gear icon -> "Script properties" -> Add property):
 *      GITHUB_TOKEN           = <the fine-grained PAT from step 3>
 *      SYNC_DISPATCH_SECRET   = <the secret from step 4>
 * 6. Save. Run `checkSyncEmails` once and approve the Gmail/UrlFetch access
 *    prompt.
 * 7. Left sidebar -> Triggers (clock icon) -> Add Trigger:
 *      Function: checkSyncEmails
 *      Event source: Time-driven -> Minutes timer -> Every minute
 *    (1 minute is Apps Script's fastest polling interval.)
 *
 * That's it. New seating/schedule/showup email -> within ~1 min the workflow
 * runs and the site updates. For true real-time (seconds) you'd need Gmail
 * push via Google Cloud Pub/Sub, which is a lot more setup; polling every
 * minute is the simple choice.
 */

const GITHUB_OWNER = 'Riftwalker23x';
const GITHUB_REPO  = 'Compiler2.0';

const SCRIPT_PROPS = PropertiesService.getScriptProperties();

function getScriptProperty_(name) {
  const value = SCRIPT_PROPS.getProperty(name);
  if (!value) {
    throw new Error(name + ' script property is not set — see the SETUP section in docs/apps-script/seating-gmail-trigger.gs');
  }
  return value;
}

function checkSyncEmails() {
  // Unread, subject contains "seating", "schedule", or "showup", from the
  // last day. The workflow marks the email read once processed, so it won't
  // re-trigger.
  const threads = GmailApp.search('is:unread (subject:seating OR subject:schedule OR subject:showup) newer_than:1d');
  if (!threads.length) {
    return; // nothing new -> do not trigger the workflow
  }

  // Fail loudly (visible in the Apps Script execution log) if the credentials
  // are missing instead of firing a dispatch the workflow will reject.
  const token = getScriptProperty_('GITHUB_TOKEN');
  const secret = getScriptProperty_('SYNC_DISPATCH_SECRET');

  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/dispatches';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
    },
    payload: JSON.stringify({
      event_type: 'new-seating-email',
      client_payload: { secret: secret },
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code === 204) {
    Logger.log('Triggered sync workflow (%s unread thread(s)).', threads.length);
  } else {
    Logger.log('GitHub dispatch failed: %s %s', code, response.getContentText());
  }
}
