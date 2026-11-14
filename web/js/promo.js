/* Vexilot x VTable sponsor poster.
   Batch 26 students see it on up to 2 app opens per day; everyone else
   (other batches and guests) on 1. "Day" is the Pakistan calendar day,
   independent of device timezone. */
(() => {
  const key = 'vtable-promo-vexilot-v1';
  const marker = 'vtablePromo';
  const href = 'https://vexilot.dev';
  const image = '/assets/images/vexilot-vtable20.webp';
  const BOOST_BATCH = '26';
  const BOOST_LIMIT = 2;
  const DEFAULT_LIMIT = 1;

  function pkDay() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  }

  function readProfile() {
    try { if (typeof getProfileCookie === 'function') return getProfileCookie(); } catch (_) {}
    try { return JSON.parse(localStorage.getItem('vtable_profile') || 'null'); } catch (_) { return null; }
  }

  // Two-digit batch: from the NU ID ("26I-0816" -> "26"), else the stored
  // batch ("26" or a hand-picked "2026").
  function studentBatch() {
    const p = readProfile();
    if (!p) return '';
    const fromId = String(p.nuid || '').trim().match(/^(\d{2})/);
    if (fromId) return fromId[1];
    const b = String(p.batch || '').trim();
    if (/^\d{2}$/.test(b)) return b;
    if (/^\d{4}$/.test(b)) return b.slice(2);
    return '';
  }

  // Splash and sign-in/registration screens still decide who the user is.
  function startupBusy() {
    return ['m-splash', 'm-signin', 'm-onboard', 'm-manual', 'm-register'].some(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('on') && el.getClientRects().length;
    });
  }

  function show() {
    if (startupBusy()) { setTimeout(start, 400); return; }
    const limit = studentBatch() === BOOST_BATCH ? BOOST_LIMIT : DEFAULT_LIMIT;
    // Record before displaying. If storage is unavailable, skip rather than
    // show the poster on every open.
    try {
      const today = pkDay();
      let seen = null;
      try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
      const count = seen && seen.day === today ? Number(seen.count) || 0 : 0;
      if (count >= limit) return;
      localStorage.setItem(key, JSON.stringify({ day: today, count: count + 1 }));
    } catch (_) { return; }

    const dialog = document.createElement('dialog');
    dialog.className = 'promo-poster';
    dialog.setAttribute('aria-label', 'Vexilot: practice PF and OOP. VTable students get 20% off with code VTABLE20.');
    dialog.innerHTML = `
      <button class="promo-poster-close" type="button" aria-label="Close" autofocus>&times;</button>
      <a class="promo-poster-link" href="${href}" target="_blank" rel="noopener">
        <img src="${image}" width="1280" height="1600" alt="Vexilot x VTable. Free between classes? Practice PF and OOP. VTable students get 20% off with code VTABLE20 at vexilot.dev.">
      </a>
      <div class="promo-poster-actions">
        <button class="promo-poster-later" type="button">Not now</button>
        <a class="promo-poster-go" href="${href}" target="_blank" rel="noopener">Visit vexilot.dev</a>
      </div>`;
    document.body.appendChild(dialog);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    let finished = false;
    history.pushState({ ...history.state, [marker]: true }, '', location.href);

    function dismiss(fromBack = false) {
      if (finished) return;
      finished = true;
      window.removeEventListener('popstate', onBack);
      dialog.close();
      dialog.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      if (!fromBack && history.state?.[marker]) history.back();
    }
    function onBack() { dismiss(true); }

    dialog.querySelector('.promo-poster-close').addEventListener('click', () => dismiss());
    dialog.querySelector('.promo-poster-later').addEventListener('click', () => dismiss());
    // Following the link closes the poster too, so the app is ready on return.
    dialog.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setTimeout(dismiss, 0)));
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    let startedOutside = false;
    function outside(event) {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
    }
    dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
    dialog.addEventListener('click', event => { if (startedOutside && outside(event)) dismiss(); });
    window.addEventListener('popstate', onBack);
    document.body.style.overflow = 'hidden';
    dialog.showModal();
  }

  // Web Locks serialize the daily count across simultaneously opened tabs.
  function start() {
    if (navigator.locks) navigator.locks.request(key, show);
    else show();
  }
  start();
})();
