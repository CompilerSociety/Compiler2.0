/* One-off class notice. All dates are Pakistan time, independent of device timezone. */
(() => {
  const key = 'vtable-online-classes-2026-09-25-seen';
  const expires = Date.parse('2026-09-25T10:00:00+05:00');
  const classDay = Date.parse('2026-09-25T00:00:00+05:00');
  const marker = 'vtableClassNotice';

  function show() {
    if (Date.now() >= expires) return;
    // Wait for mobile startup routing before adding our Back-button entry.
    const splash = document.querySelector('.m-splash.on');
    if (splash && splash.getClientRects().length) {
      setTimeout(start, 250);
      return;
    }
    // If persistence is unavailable, skip the notice instead of repeating it.
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch (_) { return; }

    const dialog = document.createElement('dialog');
    dialog.className = 'class-notice';
    dialog.setAttribute('aria-labelledby', 'class-notice-title');
    dialog.setAttribute('aria-describedby', 'class-notice-copy');
    dialog.innerHTML = `
      <div class="class-notice-head">
        <span class="class-notice-kicker">Class update</span>
        <button class="class-notice-close" type="button" aria-label="Close announcement" autofocus>&times;</button>
      </div>
      <div class="class-notice-icon" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5M9 9l2 2 4-4"/></svg>
      </div>
      <h2 id="class-notice-title">Classes are online ${Date.now() < classDay ? 'tomorrow' : 'today'}</h2>
      <p class="class-notice-date">Friday, 25 September 2026</p>
      <p id="class-notice-copy">Your classes will be held online. Please attend remotely.</p>
      <button class="class-notice-done" type="button">Got it</button>`;
    document.body.appendChild(dialog);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    let timer;
    let finished = false;
    history.pushState({ ...history.state, [marker]: true }, '', location.href);

    function dismiss(fromBack = false) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('popstate', onBack);
      window.removeEventListener('pageshow', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
      dialog.close();
      dialog.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      if (!fromBack && history.state?.[marker]) history.back();
    }
    function onBack() { dismiss(true); }
    function checkExpiry() {
      if (Date.now() >= expires) dismiss();
      else if (Date.now() >= classDay) {
        dialog.querySelector('h2').textContent = 'Classes are online today';
      }
    }
    dialog.querySelector('.class-notice-close').addEventListener('click', () => dismiss());
    dialog.querySelector('.class-notice-done').addEventListener('click', () => dismiss());
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const first = dialog.querySelector('.class-notice-close');
      const last = dialog.querySelector('.class-notice-done');
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    // Native dialog makes the page inert and traps keyboard focus. Only a tap
    // outside the card dismisses it; tapping its text or padding does not.
    let startedOutside = false;
    function outside(event) {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
    }
    dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
    dialog.addEventListener('click', event => { if (startedOutside && outside(event)) dismiss(); });
    window.addEventListener('popstate', onBack);
    window.addEventListener('pageshow', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    function tick() {
      checkExpiry();
      if (!finished) timer = setTimeout(tick, Math.min(60000, expires - Date.now()));
    }
    tick();
  }
  // Web Locks serialize the seen check across simultaneously opened tabs.
  function start() {
    if (navigator.locks) navigator.locks.request(key, show);
    else show();
  }
  start();
})();
