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
  ['/components/footer.html', 'footer-container']
];
const requiredElementIds = ['app', 'batch', 'batch-label', 'bg3d', 'chess-mode-picker', 'chess-soon-msg', 'cr-canvas', 'cr-lb', 'cr-lb-body', 'cr-lb-status', 'cr-overlay', 'day', 'dept', 'dh-canvas', 'dh-lb', 'dh-lb-body', 'dh-lb-status', 'dh-overlay', 'ex-batch', 'ex-dept', 'exam-flat-out', 'exam-out', 'exam-source-badge', 'fb-canvas', 'fb-lb', 'fb-lb-body', 'fb-lb-status', 'fb-overlay', 'footer-last-sync', 'fv-dept', 'fv-hod-email', 'fv-hod-name', 'fv-hod-room', 'fv-hos-email', 'fv-hos-name', 'fv-hos-room', 'fv-results-count', 'fv-school', 'fv-search', 'fv-teacher-grid', 'game-picker', 'game-soon-msg', 'header-logo', 'liveDate', 'liveDay', 'liveTime', 'main-content', 'nc0', 'nc1', 'nc2', 'nc3', 'nc4', 'nc5', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'profile-actions', 'profile-batch', 'profile-batch-input', 'profile-bell-btn', 'profile-card', 'profile-card-top', 'profile-delete-btn', 'profile-department', 'profile-department-input', 'profile-launcher', 'profile-modal-backdrop', 'profile-modal-title', 'profile-name', 'profile-nuid', 'profile-nuid-display', 'profile-push-status', 'profile-registration', 'profile-save-btn', 'profile-section', 'profile-section-input', 'profile-status', 'profile-success-text', 'profile-success-toast', 'profile-sync-help', 'profile-sync-row', 'pwa-install-bar', 'pwa-install-btn', 'pwa-install-close', 'pwa-ios-close', 'pwa-ios-sheet', 'r-block', 'r-day-div', 'r-day-sel', 'r-floor', 'r-free-count', 'r-slot', 'r-time', 'repeat-course', 'repeat-course-label', 'rooms-result', 'sb1', 'sb2', 'sb3', 'school', 'sec', 'sec-cell', 'showup-out', 'showup-source-badge', 'sp-query', 'sp-result', 'sp-search-btn', 'sp-status', 'su-batch', 'su-dept', 'su-sec', 'tt-out'];
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
function loadCompatibilityRuntime() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/app.js'; script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load compatibility runtime: js/app.js'));
    document.body.appendChild(script);
  });
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

async function startApplication() {
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
}
startApplication().catch(error => {
  console.error('Application startup failed:', error);
  showGlobalError(error, 'Startup failed');
  document.documentElement.dataset.applicationStartupError = error.message;
});
