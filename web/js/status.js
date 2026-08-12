/* ══════════════════════════════════════════
   SITE STATUS
   The launch switch for vtable.site.

   Loaded as a plain (non-module) script in the <head> of index.html, so it
   runs before /js/main.js and before any component or app code. That ordering
   is what makes the gate airtight: when the site is waiting, the real app is
   never fetched, never parsed, and never boots.

   HOW TO GO LIVE
     Set waitingPage to false and live to true, then deploy. Nothing else to
     change. To put the site back behind the holding page, flip them back.

   THE TWO FLAGS
     waitingPage  true  -> show the coming-soon page, nothing else works
     live         true  -> serve the real site

   The real site runs only when live === true AND waitingPage === false.
   Every other combination shows the coming-soon page, so a half-set or
   mistyped flag fails safe onto the holding page rather than exposing a
   half-booted app.
   ══════════════════════════════════════════ */

window.SITE_STATUS = {
  waitingPage: false,
  live: true,

  /* Countdown target: 14 August, 12:01 AM Pakistan Standard Time.
     The +05:00 offset is written explicitly so the countdown ends at the same
     instant for every visitor, whatever timezone their device is set to. */
  launchAt: '2026-08-14T00:01:00+05:00'
};

/* True only when the site should serve the real app. */
window.SITE_STATUS.isLive = function () {
  return window.SITE_STATUS.live === true && window.SITE_STATUS.waitingPage !== true;
};
