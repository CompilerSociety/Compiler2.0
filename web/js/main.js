/** Startup barrier: components and their IDs must exist before legacy code runs. */
const componentTargets = [
  ['/modals/all-modals.html', 'modal-container'],
  ['/components/navbar.html', 'navbar-container'],
  ['/components/timetable.html', 'content-container'],
  ['/components/free-rooms.html', 'content-container'],
  ['/components/showup-schedule.html', 'content-container'],
  ['/components/exam-schedule.html', 'content-container'],
  ['/components/seating-plan.html', 'content-container'],
  ['/components/faculty-vault.html', 'content-container'],
  ['/components/footer.html', 'footer-container'],
  ['/components/mobile-app.html', 'mobile-container']
];
const requiredElementIds = ['app', 'batch', 'batch-label', 'bg3d', 'chess-mode-picker', 'chess-soon-msg', 'cr-canvas', 'cr-lb', 'cr-lb-body', 'cr-lb-status', 'cr-overlay', 'day', 'dept', 'dh-canvas', 'dh-lb', 'dh-lb-body', 'dh-lb-status', 'dh-overlay', 'ex-batch', 'ex-dept', 'exam-flat-out', 'exam-out', 'exam-source-badge', 'fb-canvas', 'fb-lb', 'fb-lb-body', 'fb-lb-status', 'fb-overlay', 'footer-last-sync', 'fv-dept', 'fv-hod-email', 'fv-hod-name', 'fv-hod-room', 'fv-hos-email', 'fv-hos-name', 'fv-hos-room', 'fv-results-count', 'fv-school', 'fv-search', 'fv-teacher-grid', 'game-picker', 'game-soon-msg', 'header-logo', 'liveDate', 'liveDay', 'liveTime', 'main-content', 'nc0', 'nc1', 'nc2', 'nc3', 'nc4', 'nc5', 'notif-pref-cls', 'notif-pref-exam', 'notif-pref-room', 'notif-pref-seat', 'notif-pref-show', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'profile-actions', 'profile-batch', 'profile-batch-input', 'profile-bell-btn', 'profile-card', 'profile-card-top', 'profile-delete-btn', 'profile-department', 'profile-department-input', 'profile-launcher', 'profile-modal-backdrop', 'profile-modal-title', 'profile-name', 'profile-nuid', 'profile-nuid-display', 'profile-push-status', 'profile-registration', 'profile-save-btn', 'profile-section', 'profile-section-input', 'profile-status', 'profile-success-text', 'profile-success-toast', 'profile-sync-help', 'profile-sync-row', 'pwa-install-bar', 'pwa-install-btn', 'pwa-install-close', 'pwa-ios-close', 'pwa-ios-sheet', 'r-block', 'r-day-div', 'r-day-sel', 'r-floor', 'r-free-count', 'r-slot', 'r-time', 'repeat-course', 'repeat-course-label', 'rooms-result', 'sb1', 'sb2', 'sb3', 'school', 'sec', 'sec-cell', 'showup-out', 'showup-source-badge', 'sp-query', 'sp-result', 'sp-search-btn', 'sp-status', 'su-batch', 'su-dept', 'su-sec', 'tt-out'];
let globalErrorBanner = null;
let globalErrorBannerHideTimer = null;
let lastGlobalErrorSignature = '';

function getGlobalErrorMessage(reason) {
  if (!reason) return 'An unexpected error occurred.';
  if (reason instanceof Error) return reason.message || 'An unexpected error occurred.';
  if (typeof reason === 'string') return reason;
  if (typeof reason === 'object') {
    if (typeof reason.message === 'string' && reason.message) return reason.message;
    try { return JSON.stringify(reason); } catch (e) {}
  }
  return String(reason);
}

function getGlobalErrorDetail(reason) {
  if (reason instanceof Error && reason.stack) return reason.stack;
  if (reason && typeof reason === 'object' && typeof reason.message === 'string' && reason.message) return reason.message;
  return '';
}

function ensureGlobalErrorBanner() {
  if (globalErrorBanner) return globalErrorBanner;
  const banner = document.createElement('div');
  banner.className = 'global-error-toast';
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <div class="global-error-copy">
      <div class="global-error-title">Something broke</div>
      <div class="global-error-message" data-global-error-message></div>
      <details class="global-error-details" data-global-error-details hidden>
        <summary>Technical details</summary>
        <pre></pre>
      </details>
    </div>
    <div class="global-error-actions">
      <button type="button" class="global-error-btn" data-global-error-retry>Reload</button>
      <button type="button" class="global-error-btn ghost" data-global-error-dismiss>Dismiss</button>
    </div>
  `;
  banner.querySelector('[data-global-error-retry]')?.addEventListener('click', () => window.location.reload());
  banner.querySelector('[data-global-error-dismiss]')?.addEventListener('click', () => {
    banner.hidden = true;
    if (globalErrorBannerHideTimer) clearTimeout(globalErrorBannerHideTimer);
  });
  document.body.appendChild(banner);
  globalErrorBanner = banner;
  return banner;
}

function showGlobalError(reason, context) {
  const message = getGlobalErrorMessage(reason);
  const detail = getGlobalErrorDetail(reason);
  const signature = `${context || ''}::${message}::${detail}`;
  if (signature === lastGlobalErrorSignature) return;
  lastGlobalErrorSignature = signature;
  const banner = ensureGlobalErrorBanner();
  const messageEl = banner.querySelector('[data-global-error-message]');
  const detailsEl = banner.querySelector('[data-global-error-details]');
  const preEl = detailsEl?.querySelector('pre');
  if (messageEl) messageEl.textContent = context ? `${context}: ${message}` : message;
  if (detail && preEl && detailsEl) {
    preEl.textContent = detail;
    detailsEl.hidden = false;
  } else if (detailsEl) {
    detailsEl.hidden = true;
    if (preEl) preEl.textContent = '';
  }
  banner.hidden = false;
  if (globalErrorBannerHideTimer) clearTimeout(globalErrorBannerHideTimer);
}

window.addEventListener('error', event => {
  if (!event) return;
  if (!event.error && event.target && event.target !== window) return;
  showGlobalError(event.error || event.message || 'Unexpected error', 'Runtime error');
}, true);

window.addEventListener('unhandledrejection', event => {
  if (!event) return;
  showGlobalError(event.reason || 'Unhandled promise rejection', 'Promise rejected');
});

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event?.data;
    if (!data || data.type !== 'vtable-sw-error') return;
    showGlobalError(data.message || 'Service worker error', 'Service worker');
  });
}

async function fetchComponent(path) {
  let response;
  try { response = await fetch(path); }
  catch (cause) { throw new Error(`Failed to load component "${path}": ${cause.message}`); }
  if (!response.ok) throw new Error(`Failed to load component "${path}": HTTP ${response.status}`);
  return response.text();
}
async function loadComponents() {
  const fragments = await Promise.all(componentTargets.map(([path]) => fetchComponent(path)));
  fragments.forEach((fragment, index) => {
    const [path, targetId] = componentTargets[index];
    const target = document.getElementById(targetId);
    if (!target) throw new Error(`Failed to load component "${path}": target #${targetId} is missing`);
    target.insertAdjacentHTML('beforeend', fragment);
  });
}
function verifyRequiredElements() {
  const missing = requiredElementIds.filter(id => !document.getElementById(id));
  if (missing.length) throw new Error(`Component validation failed; missing required IDs: ${missing.join(', ')}`);
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(script);
  });
}
// Read back off this module's own URL (index.html loads it as
// /js/main.js?v=N) so index.html stays the single place a deploy bumps.
// Hardcoding it here too meant app.js/mobile.js could silently keep serving
// a stale cached copy whenever only one of the two spots got updated.
const ASSET_VERSION = (() => {
  try { return new URL(import.meta.url).searchParams.get('v') || ''; }
  catch (e) { return ''; }
})();
const versioned = (path) => (ASSET_VERSION ? `${path}?v=${ASSET_VERSION}` : path);
function loadCompatibilityRuntime() {
  return loadScript(versioned('/js/app.js'));
}
// The phone view reads app.js's globals directly, so it must load after it and
// as a classic script — a module would not share that global scope.
function loadMobileRuntime() {
  return loadScript(versioned('/js/mobile.js'));
}
// Original initialization remains in app.js so its globals, listener order, and
// inline-handler compatibility remain exactly as extracted. These boundaries
// preserve the required initialization sequence without duplicate startup.
function initializeRouting() {}
function initializeNavigation() {}
function initializeTheme() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
}
function initializeClocks() {}
function initializeBackground() {}
function initializeProfile() {}
function initializeNotifications() {}
function initializePwa() {}
function initializeTimetable() {}
function initializeFreeRooms() {}
function initializeShowup() {}
function initializeExams() {}
function initializeSeating() {}
function initializeFaculty() {}
function initializeCompilerRun() { return loadCompatibilityRuntime(); }

/* ── Launch gate ──────────────────────────────────────────────────────────
   js/status.js decides whether the real site boots. When it is gated we
   render the holding page and return, so loadComponents() never runs and
   js/app.js is never fetched — nothing of the app exists to interact with. */

function isSiteLive() {
  const status = window.SITE_STATUS;
  // No status file (or a broken one) fails safe onto the holding page.
  if (!status || typeof status.isLive !== 'function') return false;
  return status.isLive();
}

function startLaunchCountdown() {
  const target = new Date(window.SITE_STATUS?.launchAt || '').getTime();
  const note = document.getElementById('cs-launch-note');
  const fields = {
    days: document.getElementById('cs-days'),
    hours: document.getElementById('cs-hours'),
    mins: document.getElementById('cs-mins'),
    secs: document.getElementById('cs-secs')
  };
  if (!fields.days) return;

  if (!Number.isFinite(target)) {
    // Unparseable launchAt: drop the countdown rather than show "NaN".
    const box = document.getElementById('cs-countdown');
    if (box) box.remove();
    if (note) note.textContent = 'Launching soon.';
    return;
  }

  const pad = n => String(Math.max(0, n)).padStart(2, '0');

  function tick() {
    const left = target - Date.now();
    if (left <= 0) {
      Object.values(fields).forEach(el => { el.textContent = '00'; });
      if (note) note.textContent = 'Launching now — refreshing.';
      clearInterval(timer);
      // The flags in status.js are the real switch, so a visitor sitting on
      // this page needs a reload to pick up the deploy that flips them. Once
      // only: if the deploy has not landed yet, they keep the holding page
      // instead of being caught in a reload loop.
      try {
        if (!sessionStorage.getItem('vtable-launch-reloaded')) {
          sessionStorage.setItem('vtable-launch-reloaded', '1');
          setTimeout(() => location.reload(), 2000);
        } else if (note) {
          note.textContent = 'Launching now — refresh in a moment.';
        }
      } catch (e) { /* private mode: skip the reload, keep the page */ }
      return;
    }
    const secs = Math.floor(left / 1000);
    fields.days.textContent = pad(Math.floor(secs / 86400));
    fields.hours.textContent = pad(Math.floor(secs / 3600) % 24);
    fields.mins.textContent = pad(Math.floor(secs / 60) % 60);
    fields.secs.textContent = pad(secs % 60);
  }

  tick();
  const timer = setInterval(tick, 1000);
}

async function showComingSoon() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = await fetchComponent('/components/coming-soon.html');
  startLaunchCountdown();
}

async function startApplication() {
  if (!isSiteLive()) {
    await showComingSoon();
    return;
  }
  await loadComponents();
  verifyRequiredElements();
  initializeRouting();
  initializeNavigation();
  initializeTheme();
  initializeClocks();
  initializeBackground();
  initializeProfile();
  initializeNotifications();
  initializePwa();
  initializeTimetable();
  initializeFreeRooms();
  initializeShowup();
  initializeExams();
  initializeSeating();
  initializeFaculty();
  await initializeCompilerRun();
  await loadMobileRuntime();
}
startApplication().catch(error => {
  console.error('Application startup failed:', error);
  showGlobalError(error, 'Startup failed');
  document.documentElement.dataset.applicationStartupError = error.message;
});
