(function headerLiveClock(){
  const dayEl=document.getElementById('liveDay');
  const dateEl=document.getElementById('liveDate');
  const timeEl=document.getElementById('liveTime');
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function pad(n){return n<10?'0'+n:n}
  function tick(){
    const now=new Date();
    if(dayEl) dayEl.textContent=now.toLocaleDateString('en-US',{weekday:'long'});
    if(dateEl) dateEl.textContent=`${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    if(timeEl){
      let h=now.getHours();const m=pad(now.getMinutes());const s=pad(now.getSeconds());
      const ampm=h>=12?'PM':'AM';h=h%12;if(h===0)h=12;
      timeEl.textContent=`${pad(h)}:${m}:${s} ${ampm}`;
    }
  }
  tick();
  setInterval(tick,1000);
})();
(function headerScrollHide(){
  let lastY=0;
  const hdr=document.querySelector('.hdr');
  if(!hdr||window.innerWidth>700) return;
  let ticking=false;
  window.addEventListener('scroll',()=>{
    if(!ticking){
      requestAnimationFrame(()=>{
        const y=window.scrollY;
        if(y>80&&y>lastY+10) hdr.classList.add('hidden');
        else if(y<lastY-10||y<80) hdr.classList.remove('hidden');
        lastY=y;
        ticking=false;
      });
      ticking=true;
    }
  },{passive:true});
})();

/* Extracted from index.html; order intentionally preserved for behavioural compatibility. */

let PROFILE_STUDENTS_CACHE=null;
let PROFILE_SYNC_IN_PROGRESS=false;
const PROFILE_STORAGE_KEY='vtable_profile_nuid';
const PROFILE_COOKIE_KEY='vtable_profile';
let PROFILE_SUCCESS_TIMEOUT=null;

function getProfileCookie(){
  // Prefer localStorage (works on file:// where cookies are blocked), fall back to cookie.
  try{
    const stored=localStorage.getItem(PROFILE_COOKIE_KEY);
    if(stored) return JSON.parse(stored);
  }catch(err){ /* localStorage unavailable */ }
  const cookies=document.cookie ? document.cookie.split(';') : [];
  const match=cookies.map(cookie=>cookie.trim()).find(cookie=>cookie.startsWith(`${PROFILE_COOKIE_KEY}=`));
  if(!match) return null;
  try{
    return JSON.parse(decodeURIComponent(match.slice(PROFILE_COOKIE_KEY.length+1)));
  }catch(err){
    return null;
  }
}
function setProfileCookie(profile){
  const json=JSON.stringify(profile);
  try{ localStorage.setItem(PROFILE_COOKIE_KEY,json); }catch(err){ /* ignore */ }
  // Also set a cookie when the protocol supports it (http/https).
  try{ document.cookie=`${PROFILE_COOKIE_KEY}=${encodeURIComponent(json)}; path=/; max-age=31536000; SameSite=Lax`; }catch(err){ /* ignore */ }
}
function clearProfileCookie(){
  try{ localStorage.removeItem(PROFILE_COOKIE_KEY); }catch(err){ /* ignore */ }
  try{ document.cookie=`${PROFILE_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`; }catch(err){ /* ignore */ }
}
function showProfileSuccessToast(message,isError){
  const toast=document.getElementById('profile-success-toast');
  const text=document.getElementById('profile-success-text');
  const icon=toast?.querySelector('.profile-success-icon');
  if(text && message) text.textContent=message;
  if(toast) toast.classList.toggle('is-error',Boolean(isError));
  if(icon) icon.textContent=isError?'✕':'✓';
  if(toast){
    toast.hidden=false;
    if(PROFILE_SUCCESS_TIMEOUT) clearTimeout(PROFILE_SUCCESS_TIMEOUT);
    PROFILE_SUCCESS_TIMEOUT=setTimeout(()=>{ if(toast) toast.hidden=true; },1800);
  }
}
function setProfileSyncVisible(visible){
  const row=document.getElementById('profile-sync-row');
  const help=document.getElementById('profile-sync-help');
  const status=document.getElementById('profile-status');
  if(row) row.hidden=!visible;
  if(help) help.hidden=!visible;
  if(status) status.hidden=!visible;
}
function showProfileActions(saveVisible, deleteVisible){
  const actions=document.getElementById('profile-actions');
  const saveBtn=document.getElementById('profile-save-btn');
  const deleteBtn=document.getElementById('profile-delete-btn');
  if(actions) actions.hidden=!(saveVisible||deleteVisible);
  if(saveBtn) saveBtn.hidden=!saveVisible;
  if(deleteBtn) deleteBtn.hidden=!deleteVisible;
}
function buildSavedProfileFromDom(){
  const nuid=(document.getElementById('profile-nuid')?.value||document.getElementById('profile-nuid-display')?.textContent||'').trim().toUpperCase();
  const profile={
    nuid,
    name: document.getElementById('profile-card-top')?.textContent?.trim() || 'Student',
    section: document.getElementById('profile-section')?.textContent?.trim() || '-',
    department: document.getElementById('profile-department')?.textContent?.trim() || '-',
    batch: document.getElementById('profile-batch')?.textContent?.trim() || '-'
  };
  return profile;
}
function renderProfileCard(profile){
  const card=document.getElementById('profile-card');
  const registration=document.getElementById('profile-registration');
  const top=document.getElementById('profile-card-top');
  const nuidEl=document.getElementById('profile-nuid-display');
  const sectionEl=document.getElementById('profile-section');
  const batchEl=document.getElementById('profile-batch');
  const deptEl=document.getElementById('profile-department');
  if(!profile){
    if(card) card.hidden=true;
    if(registration) registration.hidden=true;
    return;
  }
  if(top) top.textContent=profile.name || 'Student';
  if(nuidEl) nuidEl.textContent=profile.nuid || '-';
  if(sectionEl) sectionEl.textContent=profile.section || '-';
  if(batchEl) batchEl.textContent=profile.batch || '-';
  if(deptEl) deptEl.textContent=profile.department || '-';
  if(card) card.hidden=false;
  if(registration) registration.hidden=true;
}
function clearRegistrationFields(){
  ['profile-name','profile-section-input','profile-department-input','profile-batch-input'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
}
function resetProfileModal(){
  const input=document.getElementById('profile-nuid');
  const status=document.getElementById('profile-status');
  const card=document.getElementById('profile-card');
  const registration=document.getElementById('profile-registration');
  if(input) input.value='';
  clearRegistrationFields();
  if(card) card.hidden=true;
  if(registration) registration.hidden=true;
  setProfileSyncVisible(true);
  showProfileActions(false,false);
  if(status) status.textContent='Type your NU ID and press sync.';
}
// ── Use the saved profile to pre-select the schedule tabs ──────────────
const COMPUTING_DEPTS=['CS','AI','DS','CY','SE']; // School of Computing
function profileDeptCode(profile){
  return String(profile?.department||'').replace(/^BS\s+/i,'').trim().toUpperCase();
}
function profileFullBatch(profile){
  const b=String(profile?.batch||'').trim();
  return /^\d{2}$/.test(b) ? `20${b}` : b; // "25" -> "2025"
}
function profileIsComputing(profile){
  return COMPUTING_DEPTS.includes(profileDeptCode(profile));
}
function currentWeekdayName(){
  const d=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
  return ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].includes(d)?d:'';
}
function _readPref(key){ try{ const r=localStorage.getItem(key); return r?JSON.parse(r):null; }catch(e){ return null; } }
function _writePref(key,val){ try{ localStorage.setItem(key,JSON.stringify(val)); }catch(e){} }
// Seed each tab's remembered-selection store from the profile.
// force=true (on save) overwrites; force=false (on load) only fills what is missing.
function seedProfileSchedulePrefs(profile,force){
  if(!profile) return;
  const deptLabel=String(profile.department||'').trim();     // "BS CS" (timetable value)
  const deptCode=profileDeptCode(profile);                   // "CS" (showup/exam value)
  const fullBatch=profileFullBatch(profile);                 // "2025"
  const sec=String(profile.section||'').trim().toUpperCase();
  const computing=profileIsComputing(profile);
  const today=currentWeekdayName();

  // Timetable
  const ttExisting=_readPref('fast_timetable_prefs');
  const tt=(force||!ttExisting)?{}:{...ttExisting};
  if(force||!ttExisting){
    if(computing) tt.school='computing';
    tt.dept=deptLabel; tt.batch=fullBatch; tt.sec=sec; tt.course=tt.course||'';
  }
  if(today) tt.day=today; // requirement: default the timetable to the current day
  _writePref('fast_timetable_prefs',tt);

  // Show Up schedule
  if(force||!_readPref('fast_showup_prefs')){
    _writePref('fast_showup_prefs',{dept:deptCode,batch:fullBatch,sec});
  }
  // Exam schedule
  if(force||!_readPref('fast_exam_prefs')){
    _writePref('fast_exam_prefs',{dept:deptCode,batch:fullBatch});
  }
}
// Apply the profile to the Faculty Vault school selector (School of Computing for CS/AI/DS/CY/SE).
// Faculty-vault department names keyed by profile department code.
const FV_DEPT_BY_CODE={
  CS:'Computer Science',
  AI:'Artificial Intelligence & Data Science',
  DS:'Artificial Intelligence & Data Science',
  SE:'Software Engineering',
  CY:'Cyber Security'
};
function applyProfileToFacultyVault(){
  const profile=getProfileCookie();
  if(!profile) return;
  const schoolSel=document.getElementById('fv-school');
  const deptSel=document.getElementById('fv-dept');
  if(!schoolSel||schoolSel.value) return;
  schoolSel.value=profileIsComputing(profile)?'School of computing':'Sciences and Humanities';
  if(typeof onFvSchoolChange==='function') onFvSchoolChange(); // populates the dept options
  const wantDept=FV_DEPT_BY_CODE[profileDeptCode(profile)];
  if(deptSel&&wantDept&&[...deptSel.options].some(o=>o.value===wantDept)){
    deptSel.value=wantDept;
    if(typeof onFvDeptChange==='function') onFvDeptChange();
  }
}
// Re-apply the (now seeded) selections to whichever schedule panel is on screen.
function applyProfileToOpenScheduleTabs(){
  const on=id=>document.getElementById(id)?.classList.contains('on');
  try{
    if(on('p0')&&typeof refreshTTFilters==='function'){ refreshTTFilters(); if(typeof loadTT==='function') loadTT(); }
    if(on('p2')&&typeof initShowupSchedulePanel==='function') initShowupSchedulePanel();
    if(on('p3')&&typeof initExamSchedulePanel==='function') initExamSchedulePanel();
    if(on('p4')&&typeof initSeatingPlan==='function') initSeatingPlan();
    if(on('p5')) applyProfileToFacultyVault();
  }catch(e){ /* ignore */ }
}
function saveProfileCookie(){
  const status=document.getElementById('profile-status');
  const profile=buildSavedProfileFromDom();
  if(!profile.nuid){
    if(status) status.textContent='Sync a profile first before saving it.';
    return;
  }
  setProfileCookie(profile);
  seedProfileSchedulePrefs(profile,true);
  renderProfileCard(profile);
  showProfileActions(false,true);
  setProfileSyncVisible(false);
  showProfileSuccessToast('Your profile has been saved');
  if(status) status.textContent='Profile saved locally on this browser.';
  closeProfileModal();
  applyProfileToOpenScheduleTabs();
}
function deleteSavedProfile(){
  if(!window.confirm('Delete this saved profile from this browser?')) return;
  clearProfileCookie();
  try{ localStorage.removeItem(PROFILE_STORAGE_KEY); }catch(err){ /* ignore */ }
  const input=document.getElementById('profile-nuid');
  if(input) input.value='';
  resetProfileModal();
  const status=document.getElementById('profile-status');
  if(status) status.textContent='Saved profile removed. You can sync again.';
  showProfileSuccessToast('Your profile has been deleted',true);
  closeProfileModal();
}
function openProfileModal(){
  const backdrop=document.getElementById('profile-modal-backdrop');
  const input=document.getElementById('profile-nuid');
  const status=document.getElementById('profile-status');
  const registration=document.getElementById('profile-registration');
  const card=document.getElementById('profile-card');
  if(backdrop){ backdrop.hidden=false; }
  const savedProfile=getProfileCookie();
  const savedNuid=localStorage.getItem(PROFILE_STORAGE_KEY)||'';
  if(input){
    input.value=savedProfile?.nuid || savedNuid || '';
    input.focus();
  }
  if(savedProfile){
    setProfileSyncVisible(false);
    renderProfileCard(savedProfile);
    showProfileActions(false,true);
    if(card) card.hidden=false;
    if(registration) registration.hidden=true;
    return;
  }
  setProfileSyncVisible(true);
  if(card) card.hidden=true;
  if(registration) registration.hidden=true;
  showProfileActions(false,false);
  if(status) status.textContent='Type your NU ID and press sync.';
}
function closeProfileModal(){
  const backdrop=document.getElementById('profile-modal-backdrop');
  if(backdrop){ backdrop.hidden=true; }
}
function deptCodeToLabel(code){
  const normalized=(code||'').toUpperCase();
  switch(normalized){
    case 'BAI': return 'BS AI';
    case 'CS': return 'BS CS';
    case 'SE': return 'BS SE';
    case 'DS': return 'BS DS';
    case 'CY': return 'BS CY';
    default: return normalized || 'Unknown';
  }
}
function parseProfileFromStudent(student){
  const explicitDepartment=(student.department||'').trim().toUpperCase();
  const explicitSection=(student.section||'').trim().toUpperCase();
  const explicitBatch=(student.batch||'').trim();

  let department=explicitDepartment;
  let batch=explicitBatch;
  let section=explicitSection;

  if(!department || !batch || !section){
    const paper=(student.paper||'').trim();
    const rawMatch=paper.match(/([A-Za-z]{2,4})-?(\d+)([A-Za-z]\d*)?/i);
    if(rawMatch){
      department=rawMatch[1].toUpperCase();
      batch=rawMatch[2]||batch;
      section=(rawMatch[3]||'').toUpperCase();
    }
  }

  const sectionLabel = section || (batch ? `${batch}` : '') || (student.class || '').trim();
  return {
    name: student.name || 'Student',
    nuid: student.nuid || '',
    department: deptCodeToLabel(department),
    batch,
    section: sectionLabel,
    room: student.class || '-'
  };
}
function getProfileDataFileForNuid(nuid){
  const match=String(nuid||'').trim().match(/^(\d{2})/);
  const year=match ? match[1] : '';
  if(['22','23','24','25','26'].includes(year)) return `/db/students/${year}.json`;
  return '/db/seating/plan.json';
}
function formatNuid(raw){
  const cleaned=String(raw||'').trim().toUpperCase().replace(/\s+/g,'');
  // Accept forms like 25i0632, 25I0632, 25-I-0632, 25I-0632 -> 25I-0632
  const m=cleaned.match(/^(\d{2})-?([A-Z])-?(\d{3,4})$/);
  if(m) return `${m[1]}${m[2]}-${m[3]}`;
  return cleaned;
}
// Valid NU ID = batch year 20-26 + campus letter (I,L,K,F,P,M) + exactly 4 digits.
// Returns an error message string if invalid, or null if valid.
function validateNuid(raw){
  const cleaned=String(raw||'').trim().toUpperCase().replace(/[\s-]+/g,'');
  if(!cleaned) return 'Please enter your NU ID first.';
  const year=cleaned.slice(0,2);
  if(!/^\d{2}$/.test(year) || Number(year)<22 || Number(year)>26){
    return 'Invalid NU ID: it must start with a batch year from 22 to 26 (e.g. 25I-0632).';
  }
  const letter=cleaned.slice(2,3);
  if(!/[ILKFPM]/.test(letter)){
    return 'Invalid NU ID: the year must be followed by a campus letter I, L, K, F, P or M (e.g. 25I-0632).';
  }
  const digits=cleaned.slice(3);
  if(!/^\d{4}$/.test(digits)){
    return 'Invalid NU ID: it must end with exactly 4 digits (e.g. 25I-0632).';
  }
  return null;
}
function getBatchFromNuid(nuid){
  const match=String(nuid||'').trim().match(/^(\d{2})/);
  return match ? match[1] : '';
}
function updateProfileRegistrationFields(nuid){
  const batchInput=document.getElementById('profile-batch-input');
  const registration=document.getElementById('profile-registration');
  const batch=getBatchFromNuid(nuid);
  // Start each lookup with a clean form so a previous entry never carries over.
  clearRegistrationFields();
  if(batchInput){ batchInput.value=batch; }
  // Do NOT reveal the form here; it is only shown after a lookup finds no match,
  // otherwise it flashes on screen while the data is still loading.
}
async function loadProfileStudents(nuid){
  const cacheKey=`profile:${String(nuid||'').trim().toUpperCase()}`;
  if(PROFILE_STUDENTS_CACHE && PROFILE_STUDENTS_CACHE.cacheKey===cacheKey) return PROFILE_STUDENTS_CACHE.students;
  const sourceFile=getProfileDataFileForNuid(nuid);
  try{
    const res=await fetch(sourceFile,{cache:'no-store'});
    if(!res.ok) throw new Error('Profile data unavailable');
    const data=await res.json();
    const students=Array.isArray(data.students)?data.students:[];
    PROFILE_STUDENTS_CACHE={cacheKey,students};
    return students;
  }catch(err){
    console.warn('Profile sync failed:', err);
    PROFILE_STUDENTS_CACHE={cacheKey,students:[]};
    return [];
  }
}
async function syncProfile(){
  if(PROFILE_SYNC_IN_PROGRESS) return;
  const input=document.getElementById('profile-nuid');
  const status=document.getElementById('profile-status');
  const card=document.getElementById('profile-card');
  const registration=document.getElementById('profile-registration');
  const top=document.getElementById('profile-card-top');
  const sectionEl=document.getElementById('profile-section');
  const batchEl=document.getElementById('profile-batch');
  const deptEl=document.getElementById('profile-department');
  const validationError=validateNuid(input?.value||'');
  if(validationError){
    if(status){ status.textContent=validationError; status.classList.add('is-error'); }
    if(card) card.hidden=true;
    return;
  }
  const nuid=formatNuid(input?.value||'');
  if(input) input.value=nuid;
  if(status) status.classList.remove('is-error');
  updateProfileRegistrationFields(nuid);
  localStorage.setItem(PROFILE_STORAGE_KEY,nuid);
  // Clean loading state: hide both the card and the registration form while fetching.
  if(card) card.hidden=true;
  if(registration) registration.hidden=true;
  if(status) status.textContent='Syncing profile...';
  PROFILE_SYNC_IN_PROGRESS=true;
  try{
    const students=await loadProfileStudents(nuid);
    const match=students.find(student=>String(student.nuid||'').trim().toUpperCase()===nuid);
    if(!match){
      if(status) status.textContent='No student found for that NU ID.';
      if(card) card.hidden=true;
      if(registration) registration.hidden=false;
      return;
    }
    const profile=parseProfileFromStudent(match);
    renderProfileCard(profile);
    const savedProfile=getProfileCookie();
    const hasSavedProfile=Boolean(savedProfile && String(savedProfile.nuid||'').trim().toUpperCase()===nuid);
    showProfileActions(!hasSavedProfile, hasSavedProfile);
    if(status) status.textContent=hasSavedProfile ? 'Profile synced successfully. Your saved profile is shown.' : 'Profile synced successfully. Save it locally to keep it on this browser.';
  }catch(err){
    if(status) status.textContent='Unable to load profile right now.';
    if(card) card.hidden=true;
  }finally{
    PROFILE_SYNC_IN_PROGRESS=false;
  }
}
function registerProfile(){
  const status=document.getElementById('profile-status');
  const nuid=formatNuid(document.getElementById('profile-nuid')?.value||'');
  const validationError=validateNuid(nuid);
  if(validationError){
    if(status){ status.textContent=validationError; status.classList.add('is-error'); }
    return;
  }
  const name=(document.getElementById('profile-name')?.value||'').trim();
  const section=(document.getElementById('profile-section-input')?.value||'').trim().toUpperCase();
  const departmentRaw=(document.getElementById('profile-department-input')?.value||'').trim();
  const batch=getBatchFromNuid(nuid);
  if(!name||!section||!departmentRaw){
    if(status){ status.textContent='Please fill in your name, section, and department.'; status.classList.add('is-error'); }
    return;
  }
  if(status) status.classList.remove('is-error');
  // Profile lives only in this browser (works on any static host, e.g. Vercel).
  const profile={ nuid, name, section, batch, department: deptCodeToLabel(departmentRaw) };
  setProfileCookie(profile);
  seedProfileSchedulePrefs(profile,true);
  renderProfileCard(profile);
  showProfileActions(false,true);
  setProfileSyncVisible(false);
  showProfileSuccessToast('Your profile has been saved');
  if(status) status.textContent='Profile saved locally on this browser.';
  closeProfileModal();
  applyProfileToOpenScheduleTabs();
}
window.openProfileModal=openProfileModal;
window.closeProfileModal=closeProfileModal;
window.syncProfile=syncProfile;
window.registerProfile=registerProfile;
window.saveProfileCookie=saveProfileCookie;
window.deleteSavedProfile=deleteSavedProfile;
// ── Web Push: system-tray seat alerts when the seating plan updates ──────
const VAPID_PUBLIC_KEY='BGOmViIePhP9aBBqwrvit66eErJRLqqxStDMb4Hz5o4oqevUIngebRO5xCbJ8pBIAdzvrdDP6qqBq1sgGkO6teU';
const PUSH_SUBSCRIBE_URL='/api/subscribe';
function _urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  const arr=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
  return arr;
}
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return null;
  try{ return await navigator.serviceWorker.register('/service-worker.js'); }
  catch(err){ console.warn('SW register failed:',err); return null; }
}
function setPushStatus(msg){ const el=document.getElementById('profile-push-status'); if(el) el.textContent=msg||''; }
async function enableSeatAlerts(){
  const profile=getProfileCookie();
  if(!profile||!profile.nuid){ setPushStatus('Save your profile first, then enable alerts.'); return; }
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){
    setPushStatus('This browser does not support notifications.'); return;
  }
  if(window.isSecureContext===false){ setPushStatus('Alerts need HTTPS (open the deployed site).'); return; }
  const btn=document.getElementById('profile-bell-btn');
  if(btn) btn.disabled=true;
  setPushStatus('Requesting permission…');
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){ setPushStatus('Notifications were blocked. Enable them in browser settings.'); if(btn) btn.disabled=false; return; }
    const reg=await registerServiceWorker();
    if(!reg){ setPushStatus('Could not start the notification worker.'); if(btn) btn.disabled=false; return; }
    await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:_urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    }
    const res=await fetch(PUSH_SUBSCRIBE_URL,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        nuid:profile.nuid,
        name:profile.name||'',
        department:profile.department||'',
        batch:profile.batch||'',
        section:profile.section||'',
        subscription:sub
      })
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    setPushStatus('✓ Notifications are on for '+profile.nuid+'.');
  }catch(err){
    console.warn('enableSeatAlerts failed:',err);
    setPushStatus('Could not enable alerts right now. '+(err.message||err));
    if(btn) btn.disabled=false;
  }
}
// Register the worker on load (no permission prompt yet — that needs a click).
registerServiceWorker();

// ── "Download V Table app" install prompt (PWA / Add to Home Screen) ──────
let _deferredInstallPrompt=null;
const PWA_DISMISS_KEY='pwa_install_dismissed_at';
function _isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
}
function _isiOS(){
  const ua=window.navigator.userAgent||'';
  const iOS=/iphone|ipad|ipod/i.test(ua);
  const iPadOS=navigator.platform==='MacIntel' && navigator.maxTouchPoints>1;
  return iOS||iPadOS;
}
function _recentlyDismissed(){
  const t=Number(localStorage.getItem(PWA_DISMISS_KEY)||0);
  return t && (Date.now()-t) < 7*24*60*60*1000; // snooze 7 days after dismiss
}
function hideFloatingOverlays(){
  const iosSheet=document.getElementById('pwa-ios-sheet');
  const profileBackdrop=document.getElementById('profile-modal-backdrop');
  const compilerOverlay=document.getElementById('cr-overlay');
  const duckOverlay=document.getElementById('dh-overlay');
  const flappyOverlay=document.getElementById('fb-overlay');
  const gamePicker=document.getElementById('game-picker');
  const chessPicker=document.getElementById('chess-mode-picker');
  if(iosSheet) iosSheet.hidden=true;
  if(profileBackdrop) profileBackdrop.hidden=true;
  if(compilerOverlay) compilerOverlay.classList.remove('on');
  if(duckOverlay) duckOverlay.classList.remove('on');
  if(flappyOverlay) flappyOverlay.classList.remove('on');
  if(gamePicker) gamePicker.classList.remove('on');
  if(chessPicker) chessPicker.classList.remove('on');
}
function showInstallBar(){
  const bar=document.getElementById('pwa-install-bar');
  if(bar && !_isStandalone() && !_recentlyDismissed()) bar.hidden=false;
}
function hideInstallBar(){ const bar=document.getElementById('pwa-install-bar'); if(bar) bar.hidden=true; }
function initInstallPrompt(){
  const bar=document.getElementById('pwa-install-bar');
  const btn=document.getElementById('pwa-install-btn');
  const closeBtn=document.getElementById('pwa-install-close');
  const iosSheet=document.getElementById('pwa-ios-sheet');
  const iosClose=document.getElementById('pwa-ios-close');
  if(!bar) return;
  if(_isStandalone()) return; // already installed — never nag

  // Android / desktop Chrome: the browser fires this when installable.
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    _deferredInstallPrompt=e;
    showInstallBar();
  });
  window.addEventListener('appinstalled',()=>{ _deferredInstallPrompt=null; hideInstallBar(); });

  // iOS Safari has no beforeinstallprompt — show the bar and guide via a sheet.
  if(_isiOS()) showInstallBar();

  btn?.addEventListener('click',async ()=>{
    if(_deferredInstallPrompt){
      _deferredInstallPrompt.prompt();
      try{ await _deferredInstallPrompt.userChoice; }catch(e){}
      _deferredInstallPrompt=null;
      hideInstallBar();
    }else if(_isiOS()&&iosSheet){
      hideFloatingOverlays();
      iosSheet.hidden=false; // show Add to Home Screen instructions
    }else{
      hideInstallBar();
    }
  });
  closeBtn?.addEventListener('click',()=>{ localStorage.setItem(PWA_DISMISS_KEY,String(Date.now())); hideInstallBar(); });
  iosClose?.addEventListener('click',()=>{ if(iosSheet) iosSheet.hidden=true; });
  iosSheet?.addEventListener('click',e=>{ if(e.target===iosSheet) iosSheet.hidden=true; });
}
function initTabKeyboardNavigation(){
  const tabs=[...document.querySelectorAll('[role="tab"]')];
  if(!tabs.length) return;
  tabs.forEach((tab,index)=>{
    tab.addEventListener('keydown',event=>{
      const key=event.key;
      let nextIndex=-1;
      if(key==='ArrowRight'||key==='ArrowDown') nextIndex=(index+1)%tabs.length;
      else if(key==='ArrowLeft'||key==='ArrowUp') nextIndex=(index-1+tabs.length)%tabs.length;
      else if(key==='Home') nextIndex=0;
      else if(key==='End') nextIndex=tabs.length-1;
      if(nextIndex>=0){
        event.preventDefault();
        const nextTab=tabs[nextIndex];
        nextTab.focus();
        const control=nextTab.getAttribute('aria-controls');
        if(control){
          const panelIndex=parseInt(control.replace(/^p/,''),10);
          if(Number.isFinite(panelIndex)) sw(panelIndex);
        }
      }
    });
  });
}
initInstallPrompt();
initTabKeyboardNavigation();
window.enableSeatAlerts=enableSeatAlerts;
window.applyProfileToFacultyVault=applyProfileToFacultyVault;
document.getElementById('profile-launcher')?.addEventListener('click',openProfileModal);
document.getElementById('profile-modal-backdrop')?.addEventListener('click',event=>{ if(event.target.id==='profile-modal-backdrop') closeProfileModal(); });
// On load, seed the schedule tabs from an existing saved profile (fills only what
// the user hasn't already chosen; the current day is always refreshed).
try{ const _savedProfile=getProfileCookie(); if(_savedProfile) seedProfileSchedulePrefs(_savedProfile,false); }catch(e){}

/* Extracted from index.html; order intentionally preserved for behavioural compatibility. */

/* ══════════════════════════════════════════
   TIMETABLE DATA
══════════════════════════════════════════ */
let TT={};
// Hand-maintained repeat (yellow) courses, loaded from db/repeat-<school>.json.
// Lets you list repeat classes without regenerating from the Google Sheet.
let MANUAL_REPEAT=[];

const DEFAULT_BLOCK_FLOORS={
  A:{
    0:["A-01","A-02","A-03","A-04","A-Audi"],
    1:["A-101","A-102","A-103","A-104"],
    2:["A-201","A-202","A-203","A-210","A-211","A-CALL-1","A-CALL-2"],
    3:["A-301","A-302","A-303","A-305","A-310","A-311","A-314","A-315","A-316","A-Mehran 1","A-Mehran 2","A-CALL-3"],
    Labs:["A-KK-I","A-KK-II","A-KK-III","A-Khyber I","A-Khyber II","A-Khyber III","A-Khyber IV"],
  },
  B:{
    0:["B-019","B-020","B-027","B-028","B-030"],
    1:["B-119","B-127","B-129","B-130"],
    2:["B-227","B-229","B-230","B-Rawal Lab 3","B-DLD Lab"],
    Labs:["B-Phy","B-Ckt","B-Poth","B-Wshop","B-Comp-I","B-Comp-II","B-Comp-III","B-Koh","B-IPC"],
  },
  C:{
    1:["C-110"],
    2:["C-Margala 1","C-Margala 2","C-Margala 3","C-Margala 4"],
    3:["C-301","C-302","C-303","C-304","C-305","C-306","C-307","C-308","C-309","C-310","C-311"],
    4:["C-401","C-402","C-403","C-404","C-405","C-406","C-407","C-408","C-409","C-410"],
    5:["C-Rawal 1","C-Rawal 4","C-GPU Lab"],
  },
  D:{
    2:["D-IT Lab 1","D-IT Lab 2","D-IT Lab 3","D-IT Lab 4"],
    3:["D-301","D-302","D-303","D-304","D-305","D-306","D-311","D-312","D-313","D-314","D-315","D-316"],
    4:["D-401","D-402","D-403","D-404","D-405","D-406","D-411","D-412","D-413","D-414","D-415","D-416"],
    5:["D-501","D-502","D-503","D-504","D-505","D-506"],
  },
};
let BLOCK_FLOORS=cloneFloors(DEFAULT_BLOCK_FLOORS);

const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
// Section key used by the generator for batch-wide classes the sheet lists
// without a section letter. Never shown as a pickable section — it is merged
// into whatever section the student selects.
const ALL_SECTIONS="ALL";
/* ── Game leaderboards ──────────────────────────────────────────────────
   The scores live in committed JSON that Vercel also serves as a static
   file, so when /api/leaderboard is unavailable — a revoked GH_TOKEN once
   took it down with a 500 — the board is still readable. Read the API
   first (it is the freshest), then fall back to the static copy rather
   than showing an empty "could not load" board. */
const LB_STATIC_PATHS={
  compiler_run:'/db/leaderboard.json',
  duck_hunter:'/db/leaderboard-duck-hunter.json',
  flappy_bird:'/db/leaderboard-flappy-bird.json',
};
async function fetchLeaderboard(game){
  const q=game&&game!=='compiler_run'?`?game=${encodeURIComponent(game)}`:'';
  try{
    const res=await fetch(`/api/leaderboard${q}`,{cache:'no-store'});
    if(!res.ok) throw new Error(`API ${res.status}`);
    const data=await res.json();
    return data.leaderboard||[];
  }catch(apiErr){
    const path=LB_STATIC_PATHS[game]||LB_STATIC_PATHS.compiler_run;
    console.warn(`Leaderboard API unavailable (${apiErr.message}); using ${path}`);
    const res=await fetch(`${path}?cachebust=${Date.now()}`,{cache:'no-store'});
    if(!res.ok) throw new Error(`static leaderboard HTTP ${res.status}`);
    const data=await res.json();
    return data.leaderboard||[];
  }
}
// Merge batch-wide entries into a section's own list, skipping any the section
// already lists (same course, room and time) so nothing appears twice.
function mergeSectionEntries(secData,allData){
  const seen=new Set(secData.map(e=>`${e.name||e.c}|${e.location||e.l}|${e.time||e.t}`));
  return secData.concat(allData.filter(e=>!seen.has(`${e.name||e.c}|${e.location||e.l}|${e.time||e.t}`)));
}
const DAYNAMES=["SUN","MON","TUE","WED","THU","FRI","SAT"];
const CLASSROOM_SLOTS=["08:30-09:50","10:00-11:20","11:30-12:50","01:00-02:20","02:30-03:50","03:55-05:15","05:20-06:40","06:45-08:05"];
const LAB_SLOTS=["08:30-11:15","11:30-02:15","02:30-05:15","05:20-08:05"];
const SLOTS=CLASSROOM_SLOTS.concat(LAB_SLOTS);
function floorLabel(f){
  if(f==='0') return 'Ground Floor';
  if(f==='Labs') return 'Labs';
  if(isNaN(f)) return `${f} (Special)`;
  return `Floor ${f}`;
}
function sortFloorKeys(keys){
  return [...keys].sort((a,b)=>{
    if(a==='Labs') return 1;
    if(b==='Labs') return -1;
    return Number(a)-Number(b);
  });
}
function syncBlockLabsSections(floors){
  Object.keys(floors).forEach(block=>{
    const labs=[];
    const extraLabs=(floors[block].Labs||[]).slice();
    Object.entries(floors[block]).forEach(([key,rooms])=>{
      if(key==='Labs') return;
      (rooms||[]).forEach(room=>{
        if(isLabRoom(room)&&!labs.some(x=>sameRoom(x,room))) labs.push(room);
      });
    });
    extraLabs.forEach(room=>{
      if(!labs.some(x=>sameRoom(x,room))) labs.push(room);
    });
    labs.sort((a,b)=>normalizeRoomName(a).localeCompare(normalizeRoomName(b),undefined,{numeric:true}));
    floors[block].Labs=labs;
  });
}
function isLabRoom(room){
  const r=normalizeRoomName(room);
  if(/^D-IT LAB \d+$/i.test(r)) return true;
  if(/^D-LAB/i.test(r)) return true;
  if(/^C-MARGALA \d+$/i.test(r)) return true;
  if(/^C-RAWAL \d+$/i.test(r)) return true;
  if(/^C-GPU LAB$/i.test(r)) return true;
  if(/^A-(MEHRAN|CALL|KK|KHYBER)/i.test(r)) return true;
  if(/^A-AUDI$/i.test(r)) return true;
  if(/^B-(RAWAL LAB|DLD LAB|PHY|CKT|POTH|WSHOP|COMP-|KOH|IPC)/i.test(r)) return true;
  if(/^D-AUDI$/i.test(r)) return true;
  if(/CYBER/i.test(r)) return true;
  return false;
}
function slotsForRoom(room){return isLabRoom(room)?LAB_SLOTS:CLASSROOM_SLOTS;}
function isLabFloor(floorName){
  if(!floorName) return false;
  return /^labs$/i.test(floorName);
}


/* ══════════════════════════════════════════
   LIVE GOOGLE SHEET SYNC
   - Pulls Monday–Saturday tabs from your Google Sheet
   - Rebuilds TT in the same shape used by Class Timetable and Free Rooms
   - Refreshes every 10 minutes without redeploying on Vercel
══════════════════════════════════════════ */
const SCHOOLS={
  computing:{id:"1vlTuotLw34fedME3gNQj09cZw-todVomxAiu5P1wZ6Q",tabs:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],label:"Computing (FSC)"},
  engineering:{id:"1fL2TWhPgbPc2d66vm_KywTpdsGBIaBLqlmz4JLPudCw",tabs:["Monday"],label:"Engineering (FSE)"},
  business:{id:"1m5yFyi0QgWx0JhdEicQQL2JOEpSmcmVDOIi15_4p9Dw",tabs:["Monday"],label:"Business (FSM)"},
};
const GOOGLE_SHEET_ID=SCHOOLS.computing.id;
const GOOGLE_SHEET_TABS=SCHOOLS.computing.tabs;
const GOOGLE_SHEET_REFRESH_MS=15*60*1000;
const CD_SHEET_REFRESH_MS=15*60*1000;
let _sheetTimer=null;
let _cdSheetTimer=null;
let _roomTTTimer=null;
let _sheetHadSuccessfulLoad=false;
let CD_ROOM_OCCUPANCY={};
let _cdSheetLastSync=null;

/* ── Free Rooms: block → timetable sources ──
   The Free Rooms panel decides whether a room is busy by scanning the
   right school timetables for that block, independent of the school
   chosen on the Class Timetable panel:
     Block A → FSC (computing) + FSM (business)
     Block B → FSC (computing) + FSE (engineering)
     Block C/D → FSC (computing) only
   Each school's db/timetables/{school}.json is loaded into ROOM_TT. */
let ROOM_TT={computing:{},business:{},engineering:{}};
const BLOCK_SOURCES={A:['computing','business'],B:['computing','engineering'],C:['computing'],D:['computing']};


function cloneFloors(obj){return JSON.parse(JSON.stringify(obj));}
function cleanTxt(v){return String(v??'').replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').trim();}
function oneLine(v){return cleanTxt(v).replace(/\s+/g,' ');}
function getGoogleSheetId(idOrUrl) {
  if (!idOrUrl) return "";
  const match = idOrUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : idOrUrl;
}
function gvizUrl(sheetName){
  const sheetId = getGoogleSheetId(GOOGLE_SHEET_ID);
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&cachebust=${Date.now()}`;
}

function timetableApiUrl(){
  const school=document.getElementById('school')?.value||'computing';
  return `/db/timetables/${school}.json?cachebust=${Date.now()}`;
}
function cdRoomsApiUrl(){
  return `/api/timetable?rooms=cd&cachebust=${Date.now()}`;
}

function setSheetStatus(msg,ok=true){
  const el=document.getElementById('sheet-sync');
  if(!el) return;
  el.textContent=msg;
  el.title=msg;
  el.style.color=ok?'var(--success)':'var(--danger)';
}
function updateFooterSyncTime(){
  const el=document.getElementById('footer-last-sync');
  if(el) el.textContent='Last synced: '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
}

function parseGVizText(text){
  const raw=String(text||'').trim();
  // Google Visualization usually returns: google.visualization.Query.setResponse({...});
  // Some endpoints may return pure JSON. Support both so debugging is easier.
  if(raw.startsWith('{')) return JSON.parse(raw);
  const start=raw.indexOf('('),end=raw.lastIndexOf(')');
  if(start<0||end<0||end<=start) throw new Error('Unexpected Google Sheets response. Is the sheet viewable by anyone with the link?');
  return JSON.parse(raw.slice(start+1,end));
}

function fetchGVizJsonp(sheetName){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const googleObj=window.google=window.google||{};
    googleObj.visualization=googleObj.visualization||{};
    const previousQuery=googleObj.visualization.Query;
    let done=false;
    const cleanup=()=>{
      script.remove();
      if(previousQuery) googleObj.visualization.Query=previousQuery;
    };
    googleObj.visualization.Query={setResponse:(data)=>{
      if(done) return;done=true;cleanup();resolve(data);
    }};
    script.onerror=()=>{if(done)return;done=true;cleanup();reject(new Error('Google Sheets JSONP load failed'));};
    script.src=gvizUrl(sheetName);
    document.head.appendChild(script);
    setTimeout(()=>{if(done)return;done=true;cleanup();reject(new Error('Google Sheets JSONP timeout'));},15000);
  });
}

async function fetchGVizSheet(sheetName){
  try{
    const res=await fetch(gvizUrl(sheetName),{cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGVizText(await res.text());
  }catch(fetchErr){
    // JSONP fallback avoids browser CORS issues on some Google Sheets responses.
    return fetchGVizJsonp(sheetName);
  }
}

async function loadSheetGrid(sheetName){
  const data=await fetchGVizSheet(sheetName);
  const rows=(data.table&&data.table.rows)||[];
  const colCount=Math.max((data.table&&data.table.cols&&data.table.cols.length)||0,...rows.map(r=>(r.c||[]).length));
  return rows.map(r=>Array.from({length:colCount},(_,i)=>{
    const cell=(r.c||[])[i];
    if(!cell) return '';
    return cleanTxt(cell.f??cell.v??'');
  }));
}

function replaceSlots(nextSlots){
  SLOTS.length=0;
  (Array.isArray(nextSlots)?nextSlots:[]).forEach(slot=>{
    if(slot&&!SLOTS.includes(slot)) SLOTS.push(slot);
  });
  SLOTS.sort((a,b)=>slotToMinutes(a.split('-')[0])-slotToMinutes(b.split('-')[0]));
}

function rebuildSlotsFromTimetable(tt){
  const slots=[];
  Object.values(tt||{}).forEach(batches=>{
    Object.values(batches||{}).forEach(sections=>{
      Object.values(sections||{}).forEach(days=>{
        Object.values(days||{}).forEach(arr=>{
          (arr||[]).forEach(entry=>{
            const time=entry?.time||entry?.t;
            if(time&&!slots.includes(time)) slots.push(time);
          });
        });
      });
    });
  });
  replaceSlots(slots);
}

function legacyTTToReferenceTT(tt){
  const out={};
  Object.entries(tt||{}).forEach(([depCode,batches])=>{
    const depLabel=depCode.startsWith('BS ')||depCode.startsWith('MS ')?depCode:`BS ${depCode}`;
    out[depLabel]=out[depLabel]||{};
    Object.entries(batches||{}).forEach(([batch,sections])=>{
      out[depLabel][batch]=out[depLabel][batch]||{};
      Object.entries(sections||{}).forEach(([section,days])=>{
        out[depLabel][batch][section]=out[depLabel][batch][section]||{};
        Object.entries(days||{}).forEach(([day,arr])=>{
          out[depLabel][batch][section][day]=(arr||[]).map(entry=>({
            name:entry.name||entry.c||'',
            location:entry.location||entry.l||'',
            time:entry.time||entry.t||''
          }));
        });
      });
    });
  });
  return out;
}

function applyTimetablePayload(payload,sourceLabel){
  if(!payload||typeof payload!=='object') throw new Error('Timetable payload is empty');
  if(!payload.tt||typeof payload.tt!=='object') throw new Error('Timetable payload is missing timetable data');

  TT=payload.tt;
  if(Array.isArray(payload.slots)&&payload.slots.length) replaceSlots(payload.slots);
  else rebuildSlotsFromTimetable(TT);

  rebuildBlockFloorsFromTT();
  refreshTTFilters();
  refreshRoomSelectorsAfterDataUpdate();
  _sheetHadSuccessfulLoad=true;

  const stamp=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const count=typeof payload.count==='number' ? payload.count : countTTEntries(TT);
  setSheetStatus(`${sourceLabel} · ${count} CLASSES · ${stamp}`);
  updateFooterSyncTime();

  const p0=document.getElementById('p0');
  if(p0&&p0.classList.contains('on')) loadTT();
  const p1=document.getElementById('p1');
  if(p1&&p1.classList.contains('on')) onDayChange();
  loadManualRepeat();
}

// Load the hand-maintained repeat-courses list for the current school and
// refresh the Repeat Courses filters so newly-added courses appear.
async function loadManualRepeat(){
  const school=document.getElementById('school')?.value||'computing';
  try{
    const res=await fetch(`/db/timetables/repeat-${school}.json?cachebust=${Date.now()}`,{cache:'no-store'});
    MANUAL_REPEAT=res.ok?((await res.json()).repeat||[]):[];
  }catch(e){
    MANUAL_REPEAT=[];
  }
  refreshTTFilters();
  const p0=document.getElementById('p0');
  if(p0&&p0.classList.contains('on')&&isRepeatMode()) loadTT();
}

function normalizeDay(day){
  const t=cleanTxt(day).toLowerCase();
  return DAYS.find(d=>t.includes(d.toLowerCase()))||null;
}
function minutesToSlotLabel(min){
  let h=Math.floor(min/60),m=min%60;
  if(h>12) h-=12;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function parseClock(h,mm,ampm){
  let hour=Number(h),minute=Number(mm||0);
  const ap=(ampm||'').toUpperCase();
  if(ap==='PM'&&hour<12) hour+=12;
  if(ap==='AM'&&hour===12) hour=0;
  if(!ap&&hour>=1&&hour<=6) hour+=12;
  return hour*60+minute;
}
function normalizeTimeSlot(text){
  const t=cleanTxt(text).replace(/[–—]/g,'-');
  const m=t.match(/(\d{1,2})[:.](\d{2})\s*(AM|PM)?\s*(?:-|to)\s*(\d{1,2})[:.](\d{2})\s*(AM|PM)?/i);
  if(!m) return null;
  const start=parseClock(m[1],m[2],m[3]||m[6]);
  const end=parseClock(m[4],m[5],m[6]||m[3]);
  if(Number.isNaN(start)||Number.isNaN(end)) return null;
  return `${minutesToSlotLabel(start)}-${minutesToSlotLabel(end)}`;
}
function registerSlot(slot){
  if(!slot||SLOTS.includes(slot)) return;
  SLOTS.push(slot);
  SLOTS.sort((a,b)=>slotToMinutes(a.split('-')[0])-slotToMinutes(b.split('-')[0]));
}

function normalizeRoomName(room){
  let r=cleanTxt(room).toUpperCase();
  r=r.replace(/\s+/g,' ');
  let m;
  m=r.match(/^([A-D])\s*[-]\s*(\d{3}|(?:IT\s*)?LAB\s*\d+|MARGALA\s*\d*|RAWAL\s*\d*|GPU\s*LAB|MEHRAN\s*\d*|CALL-\d+|DIGITAL\b)/i);
  if(m) return `${m[1].toUpperCase()}-${m[2].toUpperCase().replace(/\s+/g,' ').trim()}`;
  r=r.replace(/\b([A-D])\s+(\d{3})\b/,'$1-$2');
  r=r.replace(/\b([A-D])\s+(IT\s+)?LAB\s*[-#]?\s*(\d+)\b/i,'$1-$2LAB $3');
  r=r.replace(/\b([A-D])\s+(MARGALA|RAWAL)\s+(\d+)\b/i,'$1-$2 $3');
  r=r.replace(/\b([A-D])\s+GPU\s+LAB\b/i,'$1-GPU LAB');
  r=r.replace(/\b([A-D])\s+(MEHRAN|CALL)\s*[-#]?\s*(\d*)\b/i,'$1-$2 $3').trim();
  r=r.replace(/\b([A-D])\s+(DIGITAL)\b/i,'$1-$2');
  m=r.match(/CYBER\s*\(?\s*([A-D])-(\d{3})/i);
  if(m) return `Cyber (${m[1].toUpperCase()}-${m[2]})`;
  m=r.match(/^(MARGALA|RAWAL|MEHRAN|KHYBER|CALL|DLD|GPU)\s+LABS?\s*\(?\s*(\d+)?\s*\)?/i);
  if(m) return `${m[1][0]}${m[1].slice(1).toLowerCase()} Lab${m[2]?' '+m[2]:''}`.toUpperCase();
  if(/\bAUDI(TORIUM)?\b/.test(r)){
    if(/\bA\b/.test(r)||/^A-/.test(r)) return 'A-AUDI';
    return 'D-AUDI';
  }
  return r;
}

function sameRoom(a,b){return normalizeRoomName(a)===normalizeRoomName(b);}

function addCourseToTT(target,{dept,batch,section,day,course,room,time}){
  if(!dept||!batch||!section||!day||!course||!room||!time) return false;
  registerSlot(time);
  target[dept]=target[dept]||{};
  target[dept][batch]=target[dept][batch]||{};
  target[dept][batch][section]=target[dept][batch][section]||{};
  target[dept][batch][section][day]=target[dept][batch][section][day]||[];
  const arr=target[dept][batch][section][day];
  if(!arr.some(x=>x.c===course&&sameRoom(x.l,room)&&x.t===time)) arr.push({c:course,l:room,t:time});
  return true;
}
function countTTEntries(tt){
  let n=0;
  Object.values(tt).forEach(batches=>Object.values(batches).forEach(sections=>Object.values(sections).forEach(days=>Object.values(days).forEach(arr=>n+=arr.length))));
  return n;
}

function inferRoomLocation(room){
  const r=normalizeRoomName(room);
  let m;

  // Standard 3-digit rooms: C-301, D-301, A-101, B-119
  m=r.match(/^([A-D])-(\d{3})$/);
  if(m) return {block:m[1],floor:String(Number(m[2][0]))};

  // Ground floor 2-digit rooms: A-01, A-02
  m=r.match(/^([A-D])-(\d{2})$/);
  if(m) return {block:m[1],floor:'0'};

  // D-IT Lab
  if(/^D-IT LAB \d+$/i.test(r)) return {block:'D',floor:'2'};
  if(/^D-LAB/i.test(r)) return {block:'D',floor:'Lab'};

  // Auditorium
  if(/^A-AUDI$/i.test(r)) return {block:'A',floor:'0'};
  if(/^D-AUDI$/i.test(r)) return {block:'D',floor:'Audi'};

  // C block labs
  if(/^C-MARGALA \d+$/i.test(r)) return {block:'C',floor:'2'};
  if(/^C-RAWAL \d+$/i.test(r)) return {block:'C',floor:'5'};
  if(/^C-GPU LAB$/i.test(r)) return {block:'C',floor:'5'};

  // A block labs
  if(/^A-MEHRAN \d+$/i.test(r)) return {block:'A',floor:'3'};
  m=r.match(/^A-CALL[- ]?(\d+)$/i);
  if(m) return {block:'A',floor:Number(m[1])<=2?'2':'3'};
  if(/^A-KK/i.test(r)||/^A-KHYBER/i.test(r)) return {block:'A',floor:'Labs'};

  // B block labs
  if(/^B-RAWAL LAB/i.test(r)||/^B-DLD LAB/i.test(r)) return {block:'B',floor:'2'};
  if(/^B-(PHY|CKT|POTH|WSHOP|COMP-|KOH|IPC)/i.test(r)) return {block:'B',floor:'Labs'};

  // Cyber (D-514)
  if(/CYBER/i.test(r)) return {block:'D',floor:'Cyber'};

  // Legacy name fragments
  if(r.includes('MARGALA')) return {block:'C',floor:'2'};
  if(r.includes('RAWAL')&&r.startsWith('C')) return {block:'C',floor:'5'};
  if(r.includes('GPU')) return {block:'C',floor:'5'};
  if(r.includes('MEHRAN')) return {block:'A',floor:'3'};
  if(r.includes('CALL')) return {block:'A',floor:'2'};
  if(r.includes('DIGITAL')) return {block:'B',floor:'Digital'};

  // Fallback: extract block letter from prefix
  m=r.match(/^([A-D])-/);
  if(m) return {block:m[1],floor:'Other'};

  return null;
}
function addRoomToFloors(floors,room){
  const loc=inferRoomLocation(room);
  if(!loc) return;
  floors[loc.block]=floors[loc.block]||{};
  floors[loc.block][loc.floor]=floors[loc.block][loc.floor]||[];
  if(!floors[loc.block][loc.floor].some(x=>sameRoom(x,room))) floors[loc.block][loc.floor].push(room);
  if(isLabRoom(room)){
    floors[loc.block].Labs=floors[loc.block].Labs||[];
    if(!floors[loc.block].Labs.some(x=>sameRoom(x,room))) floors[loc.block].Labs.push(room);
  }
}
function rebuildBlockFloorsFromTT(){
  const floors=cloneFloors(DEFAULT_BLOCK_FLOORS);
  Object.values(TT).forEach(batches=>Object.values(batches).forEach(sections=>Object.values(sections).forEach(days=>Object.values(days).forEach(arr=>arr.forEach(c=>addRoomToFloors(floors,entryLocation(c)))))));
  Object.values(ROOM_TT).forEach(tt=>Object.values(tt).forEach(batches=>Object.values(batches).forEach(sections=>Object.values(sections).forEach(days=>Object.values(days).forEach(arr=>arr.forEach(c=>addRoomToFloors(floors,entryLocation(c))))))));
  Object.values(CD_ROOM_OCCUPANCY).forEach(dayMap=>Object.keys(dayMap).forEach(room=>addRoomToFloors(floors,room)));
  Object.values(floors).forEach(block=>Object.entries(block).forEach(([key,list])=>{
    if(key==='Labs') return;
    list.sort((a,b)=>normalizeRoomName(a).localeCompare(normalizeRoomName(b),undefined,{numeric:true}));
  }));
  syncBlockLabsSections(floors);
  BLOCK_FLOORS=floors;
}

function entryLocation(e){return e?.location||e?.l||'';}
function entryTime(e){return e?.time||e?.t||'';}
function entryCourse(e){return e?.name||e?.c||'';}
function isCDBlockRoom(room){return /^[CD]-/.test(normalizeRoomName(room));}
function addCDOccupancy(target,day,room,time,info){
  const key=normalizeRoomName(room);
  target[day]=target[day]||{};
  target[day][key]=target[day][key]||[];
  if(!target[day][key].some(x=>x.time===time&&x.course===info.course)) target[day][key].push({...info,time});
}
function cellToOccupancyInfo(cell){
  const t=oneLine(cell);
  if(!t||/^reserved$/i.test(t)) return null;
  const parsed=parseTimetableCell(t);
  if(parsed) return {course:parsed.course,dept:parsed.depts[0],batch:parsed.batch,section:parsed.section};
  return {course:(t.replace(/\s*\([^)]*\).*$/,'').trim()||t),dept:'',batch:'',section:''};
}
function parseRoomBlockRowsCD(grid,startRow,endRow,block,day,target){
  let added=0;
  for(let r=startRow;r<Math.min(endRow,grid.length);r++){
    const row=grid[r]||[];
    const room=normalizeRoomName(oneLine(row[block.roomCol]||''));
    if(!room||room.length<2||/^(room|admin)$/i.test(room)) continue;
    if(!isCDBlockRoom(room)) continue;
    for(let i=0;i<block.slotCols.length;i++){
      const timeCol=block.slotCols[i];
      const time=block.slotMap[timeCol];
      const nextCol=block.slotCols[i+1]??(block.endCol??row.length);
      const scanEnd=Math.min(nextCol,block.endCol??row.length,row.length);
      for(let col=timeCol;col<scanEnd;col++){
        const info=cellToOccupancyInfo(row[col]||'');
        if(!info) continue;
        addCDOccupancy(target,day,room,time,info);
        added++;
        break;
      }
    }
  }
  return added;
}
function parseGridToCDOccupancy(grid,day,target){
  const hr=findHeaderRow(grid);
  if(hr<0) return 0;
  const lr=findLabHeaderRow(grid,hr+1);
  const classroomEnd=lr>0?lr:grid.length;
  let added=0;
  added+=parseRoomBlockRowsCD(grid,hr+1,classroomEnd,CLASSROOM_LEFT_BLOCK,day,target);
  added+=parseRoomBlockRowsCD(grid,hr+1,classroomEnd,CLASSROOM_RIGHT_BLOCK,day,target);
  if(lr>0) added+=parseRoomBlockRowsCD(grid,lr+1,grid.length,LAB_BLOCK,day,target);
  return added;
}
function applyCDRoomOccupancy(occupancy,total,sourceLabel){
  CD_ROOM_OCCUPANCY=occupancy||{};
  _cdSheetLastSync=new Date();
  rebuildBlockFloorsFromTT();
  refreshRoomSelectorsAfterDataUpdate();
  const stamp=_cdSheetLastSync.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  setSheetStatus(`${sourceLabel} · ${total} C/D SLOTS · ${stamp}`);
  updateFooterSyncTime();
  const p1=document.getElementById('p1');
  if(p1&&p1.classList.contains('on')) onDayChange();
}
async function refreshCDRoomScheduleFromSheet(){
  try{
    const apiRes=await fetch(cdRoomsApiUrl(),{cache:'no-store'});
    if(apiRes.ok){
      const data=await apiRes.json();
      if(data.ok&&data.occupancy){
        applyCDRoomOccupancy(data.occupancy,data.count||0,'FREE ROOMS C/D · API');
        return;
      }
    }
  }catch(apiErr){
    console.warn('CD rooms API unavailable, loading Google Sheet directly:',apiErr);
  }
  try{
    const grids=await Promise.all(GOOGLE_SHEET_TABS.map(tab=>loadSheetGrid(tab).catch(()=>null)));
    const next={};
    let total=0;
    grids.forEach((grid,i)=>{
      if(!grid||!grid.length) return;
      total+=parseGridToCDOccupancy(grid,DAYS[i],next);
    });
    if(!total) throw new Error('No C/D room data parsed from Google Sheet');
    applyCDRoomOccupancy(next,total,'FREE ROOMS C/D · SHEET');
  }catch(err){
    console.warn('CD room sheet sync failed:',err);
    if(Object.keys(CD_ROOM_OCCUPANCY).length){
      const stamp=_cdSheetLastSync?_cdSheetLastSync.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'';
      setSheetStatus(`FREE ROOMS C/D · LAST SHEET DATA · ${stamp}`,false);
    }
  }
}
function findCDOccupancy(room,day,slot){
  const entries=(CD_ROOM_OCCUPANCY[day]||{})[normalizeRoomName(room)]||[];
  const hit=entries.find(e=>e.time===slot);
  if(!hit) return null;
  return {course:hit.course,dept:hit.dept||'',batch:hit.batch||'',section:hit.section||''};
}

function fillSelectOptions(sel,values,labelFn,placeholder){
  if(!sel) return;
  const previous=sel.value;
  sel.innerHTML=`<option value="">${placeholder}</option>`;
  values.forEach(v=>{
    const opt=document.createElement('option');
    opt.value=v;opt.textContent=labelFn?labelFn(v):v;
    sel.appendChild(opt);
  });
  if(values.includes(previous)) sel.value=previous;
}

const TT_PREF_KEY='fast_timetable_prefs';
function readTTPrefs(){
  try{
    const raw=localStorage.getItem(TT_PREF_KEY);
    return raw?JSON.parse(raw):{};
  }catch(e){
    return {};
  }
}
function saveTTPrefs(){
  const school=document.getElementById('school')?.value||'computing';
  const dept=document.getElementById('dept')?.value||'';
  const batch=document.getElementById('batch')?.value||'';
  const day=document.getElementById('day')?.value||'';
  const sec=document.getElementById('sec')?.value||'';
  const course=document.getElementById('repeat-course')?.value||'';
  try{
    localStorage.setItem(TT_PREF_KEY,JSON.stringify({school,dept,batch,day,sec,course}));
  }catch(e){}
}

function formatDeptLabel(dept){
  return dept;
}

function sortDeptCodes(a,b){
  return a.localeCompare(b);
}

function setDefaultDay(){
  const daySel=document.getElementById('day');
  if(!daySel) return;
  const prefs=readTTPrefs();
  if(prefs.day&&[...daySel.options].some(opt=>opt.value===prefs.day)) return;
  const dayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const currentDayIndex=new Date().getDay();
  const currentDayName=dayNames[currentDayIndex===0?1:currentDayIndex];
  if([..."Monday Tuesday Wednesday Thursday Friday Saturday".split(' ')].includes(currentDayName)){
    daySel.value=currentDayName;
  }
}

function timeToNumber(timeStr){
  const time=String(timeStr||'').trim().split('-')[0].trim();
  const m=time.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) throw new Error(`Invalid time format: ${timeStr}`);
  let hours=Number(m[1]);
  const minutes=Number(m[2]);
  if(hours===12) return 12*60+minutes;
  if(hours>=8&&hours<12) return hours*60+minutes;
  if(hours>=1&&hours<8) return (hours+12)*60+minutes;
  throw new Error(`Invalid time format: ${timeStr}`);
}

/* ── Repeat (yellow) courses ──
   Yellow-highlighted cells in the source timetable are repeat classes. The
   data pipeline buckets them under a non-real batch key (auto-detected from
   the yellow legend colour). We hide that bucket from the normal Batch list
   and instead surface it as a virtual "Repeat Courses" department: pick the
   course name, then optionally filter by day/section. */
const REPEAT_DEPT='__REPEAT__';
const REPEAT_DEPT_LABEL='Repeat Courses (Yellow)';
// Batch keys that hold yellow "repeat" classes. 'REPEAT' is written by the
// updated generator; '2026' is the legacy auto-detected yellow bucket kept
// for backward compatibility with data generated before that change.
const REPEAT_BATCH_KEYS=['REPEAT'];

function buildRepeatIndex(){
  const rows=[];
  const seen=new Set();
  const push=(r)=>{
    const row={dept:r.dept||'',section:r.section||'',day:r.day||'',name:r.name||r.course||r.c||'',location:r.location||r.l||'',time:r.time||r.t||'',note:r.note||''};
    const key=[row.name,row.day,row.section,row.dept,row.time,row.location].join('|').toUpperCase();
    if(seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  // 1) Yellow classes captured by the data pipeline (REPEAT/legacy buckets).
  Object.entries(TT).forEach(([dept,batches])=>{
    if(dept===REPEAT_DEPT) return;
    REPEAT_BATCH_KEYS.forEach(bk=>{
      const secObj=batches&&batches[bk];
      if(!secObj) return;
      Object.entries(secObj).forEach(([section,days])=>{
        Object.entries(days||{}).forEach(([day,arr])=>{
          (arr||[]).forEach(e=>push({dept,section,day,...e}));
        });
      });
    });
  });
  // 2) Hand-maintained repeat courses (db/repeat-<school>.json).
  (MANUAL_REPEAT||[]).forEach(e=>push(e));
  return rows;
}
function repeatCourseNames(index){
  return [...new Set(index.map(r=>r.name).filter(Boolean))].sort();
}
function isRepeatMode(){
  return document.getElementById('dept')?.value===REPEAT_DEPT;
}
// Swap the Batch field for a Course field when "Repeat Courses" is the selected
// department; restore Batch otherwise. In repeat mode the Section dropdown lists
// the full dept+section the course is offered to (e.g. CS-C, CY-A).
function applyRepeatModeUI(){
  const batchSel=document.getElementById('batch'),courseSel=document.getElementById('repeat-course'),batchLabel=document.getElementById('batch-label'),secCell=document.getElementById('sec-cell'),secSel=document.getElementById('sec'),repeatLabel=document.getElementById('repeat-course-label');
  if(!batchSel||!courseSel||!batchLabel) return;
  const repeat=isRepeatMode();
  batchSel.style.display=repeat?'none':'';
  courseSel.style.display=repeat?'':'none';
  if(repeatLabel) repeatLabel.style.display=repeat?'':'none';
  batchLabel.textContent=repeat?'COURSE':'BATCH YEAR';
  if(secCell) secCell.style.display=repeat?'none':'';
  if(!repeat) return;
  const prefs=readTTPrefs();
  fillSelectOptions(courseSel,repeatCourseNames(buildRepeatIndex()),null,'Select Course');
  if(prefs.course&&[...courseSel.options].some(o=>o.value===prefs.course)) courseSel.value=prefs.course;
  refreshRepeatSections();
  if(prefs.sec&&secSel&&[...secSel.options].some(o=>o.value===prefs.sec)) secSel.value=prefs.sec;
}
// Populate the Section dropdown with EVERY dept+section combo (CS-C, CY-A…)
// the chosen repeat course is offered to — across all days, not just the
// currently selected day.
function refreshRepeatSections(){
  const courseSel=document.getElementById('repeat-course'),secSel=document.getElementById('sec');
  if(!courseSel||!secSel) return;
  const course=courseSel.value;
  const rows=buildRepeatIndex().filter(r=>r.name===course);
  const combos=[...new Map(rows.filter(r=>r.dept&&r.section).map(r=>[
    `${r.dept}~~${r.section}`, `${r.dept.replace(/^BS\s+/,'')}-${r.section}`
  ])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  const prev=secSel.value;
  secSel.innerHTML='<option value="">Select Section</option>';
  combos.forEach(([val,label])=>{const o=document.createElement('option');o.value=val;o.textContent=label;secSel.appendChild(o);});
  if(combos.some(([v])=>v===prev)) secSel.value=prev;
}

function refreshTTFilters(){
  const schoolSel=document.getElementById('school'),deptSel=document.getElementById('dept'),batchSel=document.getElementById('batch'),secSel=document.getElementById('sec'),daySel=document.getElementById('day');
  if(!schoolSel||!deptSel||!batchSel||!secSel) return;
  const prefs=readTTPrefs();
  if(prefs.school&&[...schoolSel.options].some(o=>o.value===prefs.school)) schoolSel.value=prefs.school;
  const depts=Object.keys(TT).filter(d=>d!==REPEAT_DEPT).sort(sortDeptCodes);
  fillSelectOptions(deptSel,depts,formatDeptLabel,'Select Department');
  // Surface repeat (yellow) courses as a virtual department, if any exist.
  if(buildRepeatIndex().length){
    const opt=document.createElement('option');
    opt.value=REPEAT_DEPT;opt.textContent=REPEAT_DEPT_LABEL;
    deptSel.appendChild(opt);
  }
  if(prefs.dept===REPEAT_DEPT) deptSel.value=REPEAT_DEPT;
  else if(prefs.dept&&depts.includes(prefs.dept)) deptSel.value=prefs.dept;
  const dep=deptSel.value;
  if(dep===REPEAT_DEPT){
    applyRepeatModeUI();
    if(daySel&&prefs.day&&[...daySel.options].some(opt=>opt.value===prefs.day)) daySel.value=prefs.day;
    else setDefaultDay();
    return;
  }
  applyRepeatModeUI();
  const batches=Object.keys(TT[dep]||{}).filter(b=>!REPEAT_BATCH_KEYS.includes(b)).sort((a,b)=>Number(b)-Number(a));
  fillSelectOptions(batchSel,batches,null,'-- Batch --');
  if(prefs.batch&&batches.includes(prefs.batch)) batchSel.value=prefs.batch;
  const bat=batchSel.value;
  const secs=Object.keys(((TT[dep]||{})[bat])||{}).filter(s=>s!==ALL_SECTIONS).sort();
  fillSelectOptions(secSel,secs,null,'-- Section --');
  if(prefs.sec&&secs.includes(prefs.sec)) secSel.value=prefs.sec;
  else if(secs.length===1) secSel.value=secs[0];
  if(daySel&&prefs.day&&[...daySel.options].some(opt=>opt.value===prefs.day)) daySel.value=prefs.day;
  else setDefaultDay();
}
function onSchoolChange(){
  saveTTPrefs();
  const schoolSel=document.getElementById('school');
  if(!schoolSel) return;
  const school=schoolSel.value;
  document.getElementById('dept').innerHTML='<option value="">-- Department --</option>';
  document.getElementById('batch').innerHTML='<option value="">-- Batch --</option>';
  document.getElementById('sec').innerHTML='<option value="">-- Section --</option>';
  const ttOut=document.getElementById('tt-out');
  if(ttOut){
    ttOut.innerHTML=renderUiState({
      kind:'loading',
      title:'Loading timetable',
      message:`Fetching the latest timetable for ${SCHOOLS[school]?.label || 'the selected school'}.`,
      note:'The latest sheet data usually appears within a moment.'
    });
  }
  refreshTimetableFromGoogleSheet();
}
function setupTTFilterListeners(){
  const schoolSel=document.getElementById('school'),deptSel=document.getElementById('dept'),batchSel=document.getElementById('batch'),secSel=document.getElementById('sec'),daySel=document.getElementById('day');
  if(schoolSel&&!schoolSel.dataset.liveBound){
    schoolSel.dataset.liveBound='1';
    schoolSel.addEventListener('change',()=>{onSchoolChange();});
  }
 if(deptSel&&!deptSel.dataset.liveBound){
    deptSel.dataset.liveBound='1';
    deptSel.addEventListener('change',()=>{
      const dep=deptSel.value;
      if(dep===REPEAT_DEPT){
        applyRepeatModeUI();
        saveTTPrefs();loadTT();
        return;
      }
      applyRepeatModeUI();
      const batches=Object.keys(TT[dep]||{}).filter(b=>!REPEAT_BATCH_KEYS.includes(b)).sort((a,b)=>Number(b)-Number(a));
      fillSelectOptions(batchSel,batches,null,'-- Batch --');
      // Refill sections for whatever batch survived the dept switch — fillSelectOptions
      // keeps the previous value when the new dept also offers that batch, and changing
      // dept fires no 'change' on the batch select, so blanking the section list here
      // left it empty until the next page load.
      const secs=Object.keys(((TT[dep]||{})[batchSel.value])||{}).filter(s=>s!==ALL_SECTIONS).sort();
      fillSelectOptions(secSel,secs,null,'-- Section --');
      if(secs.length===1) secSel.value=secs[0];
      saveTTPrefs();loadTT();
    });
  }
  const courseSel=document.getElementById('repeat-course');
  if(courseSel&&!courseSel.dataset.liveBound){
    courseSel.dataset.liveBound='1';
    courseSel.addEventListener('change',()=>{refreshRepeatSections();saveTTPrefs();loadTT();});
  }
  if(batchSel&&!batchSel.dataset.liveBound){
    batchSel.dataset.liveBound='1';
    batchSel.addEventListener('change',()=>{
      const dep=deptSel.value,bat=batchSel.value;
      const secs=Object.keys(((TT[dep]||{})[bat])||{}).filter(s=>s!==ALL_SECTIONS).sort();
      fillSelectOptions(secSel,secs,null,'-- Section --');
      if(secs.length===1) secSel.value=secs[0];
      saveTTPrefs();loadTT();
    });
  }
  [secSel,daySel].forEach(sel=>{
    if(sel&&!sel.dataset.liveBound){sel.dataset.liveBound='1';sel.addEventListener('change',()=>{saveTTPrefs();loadTT();});}
  });
}

function refreshRoomSelectorsAfterDataUpdate(){
  const blockSel=document.getElementById('r-block'),floorSel=document.getElementById('r-floor'),daySel=document.getElementById('r-day-sel');
  if(!blockSel||!floorSel||!daySel) return;
  const oldBlock=blockSel.value,oldFloor=floorSel.value,oldDay=daySel.value;
  blockSel.innerHTML='<option value="">-- Choose --</option>';
  Object.keys(BLOCK_FLOORS).sort().forEach(b=>{
    const opt=document.createElement('option');opt.value=b;opt.textContent=`Block ${b}`;blockSel.appendChild(opt);
  });
  if(BLOCK_FLOORS[oldBlock]) blockSel.value=oldBlock;
  if(!blockSel.value){floorSel.disabled=true;daySel.disabled=true;return;}
  floorSel.disabled=false;
  floorSel.innerHTML='<option value="">-- Choose Floor --</option>';
  sortFloorKeys(Object.keys(BLOCK_FLOORS[blockSel.value])).forEach(f=>{
    const opt=document.createElement('option');opt.value=f;opt.textContent=floorLabel(f);floorSel.appendChild(opt);
  });
  if(BLOCK_FLOORS[blockSel.value][oldFloor]) floorSel.value=oldFloor;
  if(!floorSel.value){daySel.disabled=true;return;}
  daySel.disabled=false;
  daySel.innerHTML='<option value="">-- Choose Day --</option>';
  DAYS.forEach(d=>{const opt=document.createElement('option');opt.value=d;opt.textContent=d;daySel.appendChild(opt);});
  if(DAYS.includes(oldDay)) daySel.value=oldDay;
  if(daySel.value) onDayChange();
}

function selectedDayIsToday(day){
  const todayIndex=new Date().getDay();
  return todayIndex>=1&&todayIndex<=6&&DAYS[todayIndex-1]===day;
}
function getSlotsForDay(day,slots){return selectedDayIsToday(day)?getUpcomingSlots(slots):[...(slots||CLASSROOM_SLOTS)];}

/* ═══════════════════════════════════════════════════════════════
   NEW PARSER — room×slot matrix, correct cell format
   ═══════════════════════════════════════════════════════════════ */

// Time slot column positions (every 4th column starting from B)
const SLOT_COLS={
  1: "08:30-09:50", 6: "10:00-11:20", 11: "11:30-12:50",
  16:"01:00-02:20", 21:"02:30-03:50", 26:"03:55-05:15",
  31:"05:20-06:40", 36:"06:45-08:05",
};
const LAB_SLOT_COLS={
  1: "08:30-11:15", 11: "11:30-02:15", 21: "02:30-05:15", 31:"05:20-08:05",
};

// Batch mapping for Spring-2026: no suffix = 2023 (senior), 25/24/22 = batch
const BATCH_MAP={"25":"2025","24":"2024","22":"2022"};

// Cell regex: "OOP (CS-E)" or "PF (CS-C, 25)" or "AI Lab (AI/DS-A, 24)"
// or "NLP (DS, Gp-I)" or "Civics (CS-D) 09:00-10:45 Extended till 11:20"
// Section is optional: "(DS, Gp-I)" has dept DS, no section, group Gp-I
const CELL_REGEX=/(.+?)\s*\(([A-Z]+(?:\s*[\/,]\s*(?!GP?\b)[A-Z]+)*)(?:-([A-Z]+)(\d+)?)?(?:,\s*(?:Gp?-([IV]+)|(\d{2})))?\s*\)/i;

function inferBatchFromCourse(courseName) {
  const name = String(courseName || "").toUpperCase();
  // Batch 2022 (Seniors, 8th sem)
  if (/\b(CAPSTONE|FYP|SENIOR\s+PROJECT|FINAL\s+YEAR\s+PROJECT|TECH\s+STARTUP|TECH\s+ENTREPRENEURSHIP|INNOVATION\s+LAB|RESEARCH\s+METHODS|AI\s+ETHICS|DIGITAL\s+FORENSICS|ETHICAL\s+HACK|MALWARE|BIG\s+DATA|BDA|AUTONOMOUS\s+VEHICLES|ROBOTICS|IOT|PROFESSIONAL\s+ETHICS|BUSINESS\s+COMMUNICATION|ENTRE|TECH\s+MGT|COMP\s+VISION|COMPUTER\s+VISION)\b/i.test(name)) {
    return "2022";
  }
  // Batch 2023 (Juniors, 6th sem)
  if (/\b(COMPILER|COMP\s+CONST|PDC|PARALLEL|ARTIFICIAL\s+INTELLIGENCE|\bAI\b|MACHINE\s+LEARNING|\bML\b|DEEP\s+LEARN|DEEP\s+LEARNING|COMPUTER\s+NETWORKS|\bCN\b|COMP\s+NET|SOFTWARE\s+ENGINEERING|\bSE\b|SPM|PROJECT\s+MANAGEMENT|INFO\s+SEC|INFORMATION\s+SECURITY|PPIT|PROFESSIONAL\s+PRACTICES|IMAGE\s+PROCESSING|\bDIP\b|NATURAL\s+LANGUAGE|NLP|CLOUD\s+COMP|METRIC|GEN\s+AI|GENERATIVE\s+AI|PRODUCT\s+DEV|GAME\s+DEV|MOBILE\s+APP|STAT\s+MODELING|DIGITAL\s+MKTG|FIN\s+MGT)\b/i.test(name)) {
    return "2023";
  }
  // Batch 2024 (Sophomores, 4th sem)
  if (/\b(DATA\s+ST|DATA\s+STRUCTURES|OPERATING\s+SYSTEMS|\bOS\b|DATABASE|\bDB\b|REQUIREMENTS|SRE|DESIGN\s+&\s+ARCHITECTURE|SDA|COMPUTER\s+ORGANIZATION|COAL|PROBABILITY|PROB\s+&\s+STATS|STATS\s+FOR\s+ML|LINEAR\s+ALGEBRA|DATA\s+ANALYSIS)\b/i.test(name)) {
    return "2024";
  }
  // Batch 2025 (Freshmen, 2nd sem)
  if (/\b(OBJECT|OOP|DISCRETE|DIGITAL\s+LOGIC|DLD|MULTIVARIABLE|MV\s+CALCULUS|APPLIED\s+PHYSICS|\bAP\b|PAK\s+STUDIES|PAKISTAN|FUNCTIONAL\s+ENGLISH|EXP\s+WRITING|EXPOSITORY|SEERAH|ISLAMIC|CIVICS|PROGRAMMING|\bPF\b|INTRO\s+TO\s+COMPUTING|ITC|CALCULUS|COMPOSITION)\b/i.test(name)) {
    return "2025";
  }
  return null;
}

function parseTimetableCell(text){
  const t=oneLine(text);
  if(!t) return null;
  // Strip everything after the first ) to handle trailing room/time info
  const parenEnd=t.indexOf(')');
  const core=parenEnd>=0?t.slice(0,parenEnd+1):t;
  const m=core.match(CELL_REGEX);
  if(!m) return null;
  let course=m[1].trim();
  const deptStr=m[2];
  let section=m[3]; // May be undefined (e.g. "NLP (DS, Gp-I)")
  const subgroup=m[4]; // trailing digit e.g. "CS-B1" -> section "B", subgroup "1"
  // Skip entries without a section letter — can't assign to a specific section
  const group=m[5];
  if(!section&&group) section=`G-${group.toUpperCase()}`;
  if(subgroup) course=`${course} (Gp ${subgroup})`;
  const batchShort=m[6];
  let batch=batchShort?(BATCH_MAP[batchShort]||"20"+batchShort):null;
  if(!batch){
    batch=inferBatchFromCourse(course)||"2023";
  }
  const depts=deptStr.split(/\s*[\/,]\s*/).map(dept=>dept.trim().toUpperCase()).filter(Boolean);
  return {depts,section:section||null,batch,course};
}

function findHeaderRow(grid){
  // First try row index 4 (0-indexed), which is the expected "Room" header row
  // Then try scanning the first 10 rows with looser matching
  const candidates=[];
  for(let r=0;r<Math.min(grid.length,10);r++){
    const cell=oneLine(grid[r][0]||"");
    if(/room/i.test(cell)){
      // Check that at least 4 slot columns have valid time strings
      let slotsFound=0;
      for(const cIdx of Object.keys(SLOT_COLS)){
        const v=oneLine(grid[r][parseInt(cIdx)]||"");
        if(normalizeTimeSlot(v)) slotsFound++;
      }
      if(slotsFound>=4) return r;
      candidates.push(r);
    }
  }
  // Fallback: return first candidate that looked like a room header
  if(candidates.length) return candidates[0];
  return -1;
}

function findLabHeaderRow(grid,afterRow){
  for(let r=afterRow;r<grid.length;r++){
    const colA=oneLine(grid[r][0]||"").toLowerCase();
    // Lab row has "Lab" or "Lab ..." in col A
    if(colA.includes("lab")) return r;
    // Or col B has a 3-hour time range like "08:30-11:15" indicating lab header
    const colB=oneLine(grid[r][1]||"");
    if(/^\d{1,2}:\d{2}-(?:1[0-5]|0\d|2[0-3]):\d{2}$/.test(colB)&&grid[r].filter(c=>oneLine(c)).length<=6) return r;
  }
  return -1;
}

const CLASSROOM_LEFT_BLOCK={
  roomCol:0,
  endCol:30,
  slotCols:[1,6,11,16,21,26],
  slotMap:{1:"08:30-09:50",6:"10:00-11:20",11:"11:30-12:50",16:"01:00-02:20",21:"02:30-03:50",26:"03:55-05:15"}
};
const CLASSROOM_RIGHT_BLOCK={
  roomCol:30,
  endCol:null,
  slotCols:[31,36],
  slotMap:{31:"05:20-06:40",36:"06:45-08:05"}
};
const LAB_BLOCK={
  roomCol:0,
  endCol:null,
  slotCols:[1,11,21,31],
  slotMap:{1:"08:30-11:15",11:"11:30-02:15",21:"02:30-05:15",31:"05:20-08:05"}
};

/* ── Timetable sync: API only ── */

async function refreshTimetableFromGoogleSheet(){
  setSheetStatus('SHEET: SYNCING...');
  try{
    const apiRes=await fetch(timetableApiUrl(),{cache:'no-store'});
    if(!apiRes.ok) throw new Error(`Timetable API HTTP ${apiRes.status}`);
    const apiData=await apiRes.json();
    if(!apiData.ok) throw new Error(apiData.error||'Timetable API returned an error');
    applyTimetablePayload(apiData,'SHEET: LIVE API');
  }catch(apiErr){
    console.warn('Primary timetable source failed:',apiErr);
    // Fallback to fastschedule.github.io reference JSON (day-first format)
    try{
      const fbRes=await fetch(`https://fastschedule.github.io/db/timetable.json?v=${Date.now()}`,{cache:'no-store'});
      if(!fbRes.ok) throw new Error(`Fallback HTTP ${fbRes.status}`);
      const fbData=await fbRes.json();
      // Reference JSON is day-first: {Monday:{BS CS:{2025:{A:[...]}}}}
      // Convert to dept-first for applyTimetablePayload
      const tt={};
      const dayKeys=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      dayKeys.forEach(day=>{
        const dayData=fbData[day];
        if(!dayData) return;
        Object.entries(dayData).forEach(([dept,batches])=>{
          tt[dept]=tt[dept]||{};
          Object.entries(batches).forEach(([batch,sections])=>{
            tt[dept][batch]=tt[dept][batch]||{};
            Object.entries(sections).forEach(([sec,arr])=>{
              tt[dept][batch][sec]=tt[dept][batch][sec]||{};
              tt[dept][batch][sec][day]=(arr||[]).map(e=>({
                name:e.name||e.c||'',location:e.location||e.l||'',time:e.time||e.t||''
              }));
            });
          });
        });
      });
      let n=0;
      Object.values(tt).forEach(b=>Object.values(b).forEach(s=>Object.values(s).forEach(d=>Object.values(d).forEach(a=>{n+=a.length;}))));
      applyTimetablePayload({ok:true,tt,count:n},'FALLBACK: fastschedule.github.io');
    }catch(fbErr){
      console.warn('Fallback timetable source also failed:',fbErr);
      const message=(apiErr&&apiErr.message)?apiErr.message:String(apiErr);
      setSheetStatus((_sheetHadSuccessfulLoad?'SHEET: LAST LIVE DATA · ':'SHEET ERROR · ')+message,false);
      if(!_sheetHadSuccessfulLoad&&Object.keys(TT).length>0){
        refreshTTFilters();
        rebuildBlockFloorsFromTT();
        refreshRoomSelectorsAfterDataUpdate();
        const p0=document.getElementById('p0');
        if(p0&&p0.classList.contains('on')) loadTT();
      }
    }
  }
}

// True if a timetable has at least one real (non-TBA) room location.
function ttHasRealRooms(tt){
  for(const dep of Object.values(tt||{}))
    for(const bat of Object.values(dep||{}))
      for(const sec of Object.values(bat||{}))
        for(const arr of Object.values(sec||{}))
          for(const e of (arr||[])){
            const loc=e&&(e.location||e.l||'');
            if(loc&&!/^tba$/i.test(loc)) return true;
          }
  return false;
}

// Fetch one school's timetable: live Google-Sheet API first (reflects
// reschedules), committed db/*.json snapshot as fallback when the serverless
// API isn't reachable (e.g. static local hosting).
async function fetchSchoolTT(school){
  try{
    const res=await fetch(`/api/timetable?school=${school}&cachebust=${Date.now()}`,{cache:'no-store'});
    if(res.ok){
      const data=await res.json();
      if(data&&data.ok&&data.tt&&ttHasRealRooms(data.tt)) return data.tt;
    }
  }catch(err){/* fall through to static snapshot */}
  try{
    const res=await fetch(`/db/timetables/${school}.json?cachebust=${Date.now()}`,{cache:'no-store'});
    if(res.ok){
      const data=await res.json();
      if(data&&data.tt) return data.tt;
    }
  }catch(err){console.warn(`Free Rooms: ${school} timetable load failed`,err);}
  return null;
}

// Load every school's timetable so Free Rooms can merge them per block.
async function refreshRoomTimetables(){
  await Promise.all(Object.keys(ROOM_TT).map(async school=>{
    const tt=await fetchSchoolTT(school);
    if(tt) ROOM_TT[school]=canonicalizeTTLocations(tt);
  }));
  rebuildBlockFloorsFromTT();
  refreshRoomSelectorsAfterDataUpdate();
  const p1=document.getElementById('p1');
  if(p1&&p1.classList.contains('on')) onDayChange();
}

function initLiveSheetSync(){
  setupTTFilterListeners();
  refreshTimetableFromGoogleSheet();
  refreshCDRoomScheduleFromSheet();
  refreshRoomTimetables();
  clearInterval(_sheetTimer);
  clearInterval(_cdSheetTimer);
  clearInterval(_roomTTTimer);
  _sheetTimer=setInterval(refreshTimetableFromGoogleSheet,GOOGLE_SHEET_REFRESH_MS);
  _cdSheetTimer=setInterval(refreshCDRoomScheduleFromSheet,CD_SHEET_REFRESH_MS);
  _roomTTTimer=setInterval(refreshRoomTimetables,GOOGLE_SHEET_REFRESH_MS);
  updateFooterSyncTime();
}

/* ── Time helpers ── */
const SLOT_MINUTE_MAP={
  "08:30":510,"09:50":590,
  "10:00":600,"11:20":680,
  "11:30":690,"12:50":770,
  "01:00":780,"02:20":860,
  "02:30":870,"03:50":950,
  "03:55":955,"05:15":1035,
  "05:20":1040,"06:40":1120,
  "06:45":1125,"08:05":1205,
  "08:30-11:15":510,"11:30-02:15":690,
  "02:30-05:15":870,"05:20-08:05":1040,
};
function slotToMinutes(timeStr){
  if(timeStr in SLOT_MINUTE_MAP) return SLOT_MINUTE_MAP[timeStr];
  const[hh,mm]=timeStr.split(":").map(Number);
  const hour=(hh>=1&&hh<=6)?hh+12:hh;
  return hour*60+mm;
}

function fmtTime(timeStr){
  // Convert to minutes first, then derive AM/PM from total minutes
  if(timeStr in SLOT_MINUTE_MAP){
    const mins=SLOT_MINUTE_MAP[timeStr];
    const h=Math.floor(mins/60),m=mins%60;
    const isPM=h>=12;
    const hour=h>12?h-12:(h===0?12:h);
    return `${hour}:${String(m).padStart(2,'0')} ${isPM?'PM':'AM'}`;
  }
  // Fallback heuristic for unknown times
  const[hh,mm]=timeStr.split(":").map(Number);
  const isPM=(hh>=1&&hh<=6)||hh===12;
  const hour=(hh>=1&&hh<=6)?hh:(hh>12?hh-12:hh);
  return `${hour}:${String(mm).padStart(2,'0')} ${isPM?'PM':'AM'}`;
}

function fmtSlot(slot){
  const[s,e]=slot.split("-");
  return `${fmtTime(s)}–${fmtTime(e)}`;
}

function nowMinutes(){
  const n=new Date();return n.getHours()*60+n.getMinutes();
}

function getCurrentSlot(){
  const cur=nowMinutes();
  for(const s of SLOTS){
    const[start,end]=s.split("-");
    if(cur>=slotToMinutes(start)&&cur<=slotToMinutes(end)) return s;
  }
  return null;
}

// The current slot within a specific room's slot grid. A classroom and a lab
// have different grids that both contain "now" (e.g. at 2 PM a classroom is in
// 01:00-02:20 while a lab is in 11:30-02:15), so the room's own list must be
// used or the "FREE NOW" status comes out wrong.
function getCurrentSlotFor(slotList){
  const cur=nowMinutes();
  for(const s of (slotList||SLOTS)){
    const r=slotRange(s);
    if(r&&cur>=r[0]&&cur<=r[1]) return s;
  }
  return null;
}

// Returns only slots whose end time is still in the future (includes current slot)
function getUpcomingSlots(slots){
  const cur=nowMinutes();
  return (slots||SLOTS).filter(s=>slotToMinutes(s.split("-")[1])>cur);
}

/* ── Free Rooms occupancy helpers ── */
// Lab names arrive in three different styles across the FSC / FSM / FSE
// sheets (e.g. "KK-I", "PHY", "COMP-I", "A-KHYBER-1"). labSig() reduces any
// of them to a comparable signature so they map onto the room-card names.
let _labSigMap=null;
function labSig(x){
  let s=oneLine(x).toUpperCase().replace(/\bLABS?\b/g,' ').replace(/^[A-D]\s*-\s*/,'');
  s=s.replace(/\bIV\b/g,'4').replace(/\bIII\b/g,'3').replace(/\bII\b/g,'2').replace(/\bI\b/g,'1');
  s=s.replace(/[^A-Z0-9]/g,'');
  s=s.replace(/^CAL(?=\d)/,'CALL').replace(/^PTH$/,'POTH').replace(/^GPU$/,'GPULAB');
  return s;
}
// signature → canonical room-card name, built once from DEFAULT_BLOCK_FLOORS
function labSigMap(){
  if(_labSigMap) return _labSigMap;
  _labSigMap={};
  Object.values(DEFAULT_BLOCK_FLOORS).forEach(block=>Object.values(block).forEach(rooms=>{
    (rooms||[]).forEach(room=>{
      if(!isLabRoom(room)) return;
      const sig=labSig(room);
      if(sig&&!(sig in _labSigMap)) _labSigMap[sig]=room;
    });
  }));
  return _labSigMap;
}
// Rewrite a timetable location onto the canonical room-card identity.
function canonicalizeLoc(loc){
  if(!loc) return loc;
  if(/^[A-D]-\d{2,3}$/.test(normalizeRoomName(loc))) return loc; // plain classroom
  return labSigMap()[labSig(loc)]||loc;
}
function canonicalizeTTLocations(tt){
  Object.values(tt||{}).forEach(batches=>Object.values(batches||{}).forEach(sections=>Object.values(sections||{}).forEach(days=>Object.values(days||{}).forEach(arr=>(arr||[]).forEach(e=>{
    const loc=canonicalizeLoc(entryLocation(e));
    if('location' in e) e.location=loc;
    if('l' in e) e.l=loc;
    if(!('location' in e)&&!('l' in e)) e.location=loc;
  })))));
  return tt;
}
function roomBlock(room){const m=normalizeRoomName(room).match(/^([A-D])/);return m?m[1]:null;}
// Convert a "HH:MM-HH:MM" string to [startMin,endMin], or null.
function slotRange(t){
  const p=String(t||'').split('-');
  if(p.length<2) return null;
  const a=slotToMinutes(p[0].trim()),b=slotToMinutes(p[1].trim());
  return (Number.isNaN(a)||Number.isNaN(b))?null:[a,b];
}
// A room is busy in a displayed slot if any class there overlaps its time
// range. Overlap (not exact equality) lets the FSC/FSM grid line up with the
// offset FSE grid used on Block B.
function findOccupancyInTT(tt,room,day,slot){
  const sr=slotRange(slot);
  if(!sr) return null;
  for(const [dep,batches] of Object.entries(tt||{})){
    for(const [bat,sections] of Object.entries(batches||{})){
      for(const [sec,days] of Object.entries(sections||{})){
        for(const c of (days[day]||[])){
          if(!sameRoom(entryLocation(c),room)) continue;
          const cr=slotRange(entryTime(c));
          if(cr&&cr[0]<sr[1]&&cr[1]>sr[0]){
            return {course:entryCourse(c),dept:dep,batch:bat,section:sec};
          }
        }
      }
    }
  }
  return null;
}

// Returns per-slot schedule for a room on a given day (upcoming slots only)
function getRoomSlotInfo(room,day,slotsForFloor){
  const slotList=slotsForFloor||slotsForRoom(room);
  const sources=BLOCK_SOURCES[roomBlock(room)]||['computing'];
  const useSheet=isCDBlockRoom(room);
  // Only hide already-passed slots when the selected day is actually today.
  // For any other day show the full day's slots (labs have just four, so
  // clock-filtering them in the evening made them look empty/broken).
  return getSlotsForDay(day,slotList).map(slot=>{
    let occupiedBy=useSheet?findCDOccupancy(room,day,slot):null;
    for(let i=0;i<sources.length&&!occupiedBy;i++){
      occupiedBy=findOccupancyInTT(ROOM_TT[sources[i]],room,day,slot);
    }
    return{slot,occupiedBy};
  });
}

/* ── UI handlers ── */
// Prominent "rooms free right now" badge in the top banner.
function setRoomsFreeBadge(free,total){
  const el=document.getElementById('r-free-count');
  if(!el) return;
  if(free==null){el.style.display='none';return;}
  el.style.display='';
  el.textContent=`${free}/${total} FREE NOW`;
  el.className='rooms-free-badge '+(free>0?'some-free':'none-free');
}

function onBlockChange(){
  const block=document.getElementById('r-block').value;
  const floorSel=document.getElementById('r-floor');
  const daySel=document.getElementById('r-day-sel');
  document.getElementById('sb2').className='step-box'+(block?' active-step':'');
  document.getElementById('sb3').className='step-box';
  const res=document.getElementById('rooms-result');
  setRoomsFreeBadge(null);
  floorSel.innerHTML='<option value="">-- Choose Floor --</option>';
  daySel.innerHTML='<option value="">-- Choose Floor First --</option>';
  daySel.disabled=true;
  if(!block){
    floorSel.disabled=true;
    if(res){
      res.innerHTML=renderUiState({
        kind:'empty',
        title:'Select a block',
        message:'Choose a block to unlock the available floors.',
        note:'The room grid appears after block, floor, and day are selected.'
      });
    }
    return;
  }
  floorSel.disabled=false;
  sortFloorKeys(Object.keys(BLOCK_FLOORS[block])).forEach(f=>{
    const opt=document.createElement('option');
    opt.value=f;
    opt.textContent=floorLabel(f);
    floorSel.appendChild(opt);
  });
}

function onFloorChange(){
  const block=document.getElementById('r-block').value;
  const floor=document.getElementById('r-floor').value;
  const daySel=document.getElementById('r-day-sel');
  document.getElementById('sb3').className='step-box'+(floor?' active-step':'');
  const res=document.getElementById('rooms-result');
  setRoomsFreeBadge(null);
  daySel.innerHTML='<option value="">-- Choose Day --</option>';
  if(!floor){
    daySel.disabled=true;
    if(res){
      res.innerHTML=renderUiState({
        kind:'empty',
        title:'Select a floor',
        message:'Pick a floor to unlock the day selector.',
        note:'Floor availability updates from the live room schedule.'
      });
    }
    return;
  }
  daySel.disabled=false;
  DAYS.forEach(d=>{
    const opt=document.createElement('option');
    opt.value=d;opt.textContent=d;
    daySel.appendChild(opt);
  });
  // Auto-select today if it's a weekday
  const todayIndex=new Date().getDay();
  const todayName=todayIndex>=1&&todayIndex<=6 ? DAYS[todayIndex-1] : '';
  if(todayName){daySel.value=todayName;onDayChange();}
}

function onDayChange(){
  const block=document.getElementById('r-block').value;
  const floor=document.getElementById('r-floor').value;
  const day=document.getElementById('r-day-sel').value;
  const res=document.getElementById('rooms-result');
  if(!block||!floor||!day){
    if(res){
      res.innerHTML=renderUiState({
        kind:'empty',
        title:'Choose block, floor, and day',
        message:'Once all three selectors are set, the room timeline appears here.',
        note:'Use today’s day selection to see current availability.'
      });
    }
    setRoomsFreeBadge(null);
    return;
  }

  const allRooms=BLOCK_FLOORS[block][floor]||[];
  const isToday=selectedDayIsToday(day);
  // Only today can run out of slots; other days always show the full schedule.
  const hasUpcoming=!isToday||allRooms.some(room=>getUpcomingSlots(slotsForRoom(room)).length>0);

  if(!allRooms.length){
    res.innerHTML=renderUiState({
      kind:'empty',
      title:'No rooms on this floor',
      message:'This block and floor combination does not have any room data.',
      note:'Try a different floor or block.'
    });
    setRoomsFreeBadge(null);
    return;
  }
  if(!hasUpcoming){
    res.innerHTML=renderUiState({
      kind:'empty',
      title:'All slots have passed for today',
      message:'This floor has no remaining free slots for the selected day.',
      note:'Come back tomorrow or switch to another day.'
    });
    setRoomsFreeBadge(null);
    return;
  }

  // Build per-room data. A room is "busy now" if it is occupied in the slot
  // that matches the current wall-clock time on the selected day — that drives
  // the whole-card red/green colour.
  const roomData=allRooms.map(room=>{
    const slotInfo=getRoomSlotInfo(room,day,slotsForRoom(room));
    const curSlot=getCurrentSlotFor(slotsForRoom(room));
    const currentEntry=curSlot?slotInfo.find(s=>s.slot===curSlot):null;
    const busyNow=currentEntry?currentEntry.occupiedBy:null;
    return{room,slotInfo,busyNow,curSlot};
  });

  // Free-now rooms first, then busy-now
  roomData.sort((a,b)=>(!a.busyNow&&b.busyNow)?-1:(a.busyNow&&!b.busyNow)?1:0);

  const freeNowCount=roomData.filter(r=>!r.busyNow).length;

  const cards=roomData.map(({room,slotInfo,busyNow,curSlot})=>{
    const cardClass=busyNow?'room-card busy-now':'room-card free-now';

    const statusBadge=busyNow
      ?`<span class="status-now busy" title="${busyNow.course} · ${busyNow.dept} ${busyNow.batch}-${busyNow.section}">${busyNow.course}</span>`
      :`<span class="status-now free">FREE NOW</span>`;

    const slotsHTML=slotInfo.map(({slot,occupiedBy})=>{
      const isCurrent=slot===curSlot;
      const slotClass=occupiedBy?'busy-slot':'free-slot';
      let dotClass,statusHTML,nowBadge='';
      if(isCurrent){
        dotClass=occupiedBy?'current-busy':'current-free';
        nowBadge=`<span class="now-badge${occupiedBy?' busy':''}">NOW</span>`;
      } else {
        dotClass=occupiedBy?'busy':'free';
      }
      statusHTML=occupiedBy
        ?`<span class="slot-status-busy" title="${occupiedBy.course} · ${occupiedBy.dept} ${occupiedBy.batch}-${occupiedBy.section}">${occupiedBy.course}</span>`
        :`<span class="slot-status-free">FREE</span>`;
      return `<div class="slot-row ${slotClass}${isCurrent?' is-current':''}">
        <div class="slot-dot ${dotClass}"></div>
        <span class="slot-time-lbl">${fmtSlot(slot)}</span>
        ${statusHTML}
        ${nowBadge}
      </div>`;
    }).join('');

    return `<div class="${cardClass}">
      <div class="room-card-head">
        <span class="room-card-name">${room}</span>
        ${statusBadge}
      </div>
      <div class="room-card-body">${slotsHTML}</div>
    </div>`;
  }).join('');

  const countClass=freeNowCount>0?'result-count green':'result-count red';
  res.innerHTML=`<div class="result-header">
    <span class="result-label">BLOCK ${block} &nbsp;&#9656;&nbsp; ${floorLabel(floor).toUpperCase()} &nbsp;&#9656;&nbsp; ${day.toUpperCase()}</span>
    <span class="${countClass}">${freeNowCount}/${allRooms.length} FREE NOW</span>
  </div>
  <div class="rooms-grid">${cards}</div>`;
  setRoomsFreeBadge(freeNowCount,allRooms.length);
}

/* ── Tab switch with hash routing ── */
function sw(i, pushHash=true){
  ['nc0','nc1','nc2','nc3','nc4','nc5'].forEach((id,j)=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.className='nav-card'+(j===i?' active':'');
    el.setAttribute('aria-selected',j===i);
    el.setAttribute('tabindex',j===i?0:-1);
  });
  ['p0','p1','p2','p3','p4','p5'].forEach((id,j)=>{
    const panel=document.getElementById(id);
    if(!panel) return;
    panel.className='panel'+(j===i?' on':'');
    panel.setAttribute('aria-hidden',j===i?'false':'true');
  });
  if(pushHash){
    const slugs=['timetable','freerooms','showup','exams','seating','faculty'];
    if(location.hash!=='#'+slugs[i]) history.replaceState(null,'','#'+slugs[i]);
  }
  if(i===1){
    // Re-check the moment the user opens Free Rooms: recompute against the
    // current time with the data in hand, then pull the latest timetables
    // (which re-render on arrival) so reschedules are reflected.
    const daySel=document.getElementById('r-day-sel');
    if(daySel&&daySel.value) onDayChange();
    refreshRoomTimetables();
    refreshCDRoomScheduleFromSheet();
  }
  if(i===2) initShowupSchedulePanel();
  if(i===3) initExamSchedulePanel();
  if(i===4) initSeatingPlan();
  if(i===5){ renderFacultyVault(); applyProfileToFacultyVault(); }
}

/* ── Timetable panel ── */
// Detect a Rescheduled ("ReSch") / Cancelled note either from an explicit note
// field or from text appended to a course cell in the sheet.
function extractNote(text){
  const t=String(text||'');
  if(/cancel/i.test(t)) return 'Cancelled';
  if(/\bresch\b|reschedul/i.test(t)) return 'Rescheduled';
  return '';
}
// Strip a trailing note off a course name so the badge isn't duplicated.
function stripNote(name){
  return String(name||'').replace(/\s*(ReSch(eduled)?|Cancelled|Cancel)\b.*$/i,'').trim();
}
function noteBadgeHTML(note){
  if(!note) return '';
  const cancel=/cancel/i.test(note);
  return `<span class="tt-note ${cancel?'cancel':'resch'}">${cancel?'CANCELLED':'RESCHEDULED'}</span>`;
}
function loadRepeatTT(){
  const out=document.getElementById('tt-out');
  if(!out) return;
  const course=document.getElementById('repeat-course')?.value||'';
  const day=document.getElementById('day')?.value||'';
  const secVal=document.getElementById('sec')?.value||'';
  const currentSlot=getCurrentSlot();
  if(!course){
      out.innerHTML=renderUiState({
        kind:'empty',
        title:'Choose a repeat course',
        message:'Pick a repeat course to view its full schedule for the selected day.',
        note:'Repeat courses are listed under the virtual department in the dropdown.'
      });
    return;
  }
  saveTTPrefs();
  let rows=buildRepeatIndex().filter(r=>r.name===course);
  if(day) rows=rows.filter(r=>r.day===day);
  // Section value encodes the full dept+section (e.g. "BS CS~~C"); filter to it.
  if(secVal.includes('~~')){
    const [selDept,selSec]=secVal.split('~~');
    rows=rows.filter(r=>r.dept===selDept&&r.section===selSec);
  }
  const dayOrder=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  rows.sort((a,b)=>{
    const d=dayOrder.indexOf(a.day)-dayOrder.indexOf(b.day);
    if(d!==0) return d;
    try{return timeToNumber(a.time)-timeToNumber(b.time);}catch(e){return 0;}
  });
  if(!rows.length){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'No repeat sessions found',
      message:'No repeat courses match the current selection.',
      note:'Try another day, section, or course.'
    });
    return;
  }
  out.innerHTML=`<table class="tt-result-table">
    <thead><tr><th style="width:26%">Course</th><th style="width:14%">Day</th><th style="width:12%">Section</th><th style="width:18%">Location</th><th style="width:30%">Time</th></tr></thead>
    <tbody>${rows.map(r=>{
      const secLabel=`${String(r.dept||'').replace(/^BS\s+/,'')}${r.section?('-'+r.section):''}`;
      const note=r.note||extractNote(r.name);
      const cls=/cancel/i.test(note)?'tt-course tt-repeat is-cancelled':'tt-course tt-repeat';
      const isCurrent=currentSlot && String(r.time||'').includes('-') && String(r.time||'').split('-')[0].trim()===currentSlot.split('-')[0].trim();
      const fmtTime = r.time && r.time.includes('-') ? fmtSlot(r.time) : r.time;
      return `<tr class="${isCurrent?'is-current':''}"><td>${noteBadgeHTML(note)}<div class="${cls}">${stripNote(r.name)}</div></td><td><div class="tt-day">${r.day}</div></td><td><div class="tt-sec">${secLabel}</div></td><td><div class="tt-room">${r.location}</div></td><td><div class="tt-time">${fmtTime}</div></td></tr>`;
    }).join('')}</tbody>
  </table>`;
}
function showTTSkeleton(){
  const out=document.getElementById('tt-out');
  if(!out) return;
  out.innerHTML='<div class="tt-skeleton">'+
    Array(4).fill('<div class="tt-skeleton-row"><div class="tt-skeleton-bar wide"></div><div class="tt-skeleton-bar med"></div><div class="tt-skeleton-bar narrow"></div></div>').join('')+
  '</div>';
}
function loadTT(){
  showTTSkeleton();
  const dep=document.getElementById('dept').value;
  if(dep===REPEAT_DEPT){loadRepeatTT();return;}
  const bat=document.getElementById('batch').value;
  const sec=document.getElementById('sec').value;
  const day=document.getElementById('day').value;
  // Batch-wide classes (the sheet names a dept and year but no section, e.g.
  // "Project (AI/DS)") are stored once under ALL_SECTIONS. Fold them into
  // whichever section is selected so the whole batch sees them.
  const secData=(TT[dep]&&TT[dep][bat]&&TT[dep][bat][sec]&&TT[dep][bat][sec][day])||[];
  const allData=(sec&&TT[dep]&&TT[dep][bat]&&TT[dep][bat][ALL_SECTIONS]&&TT[dep][bat][ALL_SECTIONS][day])||[];
  const rawData=allData.length?mergeSectionEntries(secData,allData):secData;
  // A repeat (yellow) class must appear ONLY under "Repeat Courses", never in
  // the regular batch/section view. Drop any entry that matches a repeat one
  // for this dept+section+day (matched by time + room, or time + course name).
  const repIdx=buildRepeatIndex().filter(r=>r.dept===dep&&r.section===sec&&r.day===day);
  const data=repIdx.length?rawData.filter(e=>{
    const tm=e.time||e.t||'';
    const nloc=normalizeRoomName(e.location||e.l||'');
    const nm=String(e.name||e.c||'').toUpperCase().trim();
    return !repIdx.some(r=>r.time===tm&&(normalizeRoomName(r.location)===nloc||r.name.toUpperCase().trim()===nm));
  }):rawData;
  const out=document.getElementById('tt-out');
  if(out){
    if(!dep||!bat||!sec||!day){
      out.innerHTML='<div class="tt-empty-card"><svg class="tt-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div class="tt-empty-title">Select your timetable</div><div class="tt-empty-copy">Choose the school, department, batch, day, and section to view your classes.</div></div>';
      return;
    }
    saveTTPrefs();
    const validEntries=[];
    const invalidEntries=[];
    data.forEach(course=>{
      try{
        timeToNumber(course.time||course.t||'');
        validEntries.push(course);
      }catch(e){
        invalidEntries.push(course);
      }
    });
    const sortedValidEntries=validEntries.sort((a,b)=>timeToNumber(a.time||a.t||'')-timeToNumber(b.time||b.t||''));
    const finalEntries=[...sortedValidEntries,...invalidEntries];
    if(!finalEntries.length){
      out.innerHTML='<div class="tt-empty-card"><div class="tt-empty-icon" aria-hidden="true">◌</div><div class="tt-empty-title">No classes today</div><div class="tt-empty-copy">This section does not have a class scheduled for the selected day.</div></div>';
      return;
    }
    const currentSlot=getCurrentSlot();
    out.innerHTML=`<table class="tt-result-table">
      <thead><tr><th style="width:38%">Course</th><th style="width:22%">Location</th><th style="width:40%">Time</th></tr></thead>
      <tbody>${finalEntries.map(r=>{
        const name=r.name||r.c||'';
        const location=r.location||r.l||'';
        const time=r.time||r.t||'';
        const note=r.note||extractNote(name);
        const cls=/cancel/i.test(note)?'tt-course is-cancelled':'tt-course';
        const isCurrent=currentSlot && String(time).includes('-') && String(time).split('-')[0].trim()===currentSlot.split('-')[0].trim();
        const fmtTime = time && time.includes('-') ? fmtSlot(time) : time;
        return `<tr class="${isCurrent?'is-current':''}"><td>${noteBadgeHTML(note)}<div class="${cls}">${stripNote(name)}</div></td><td><div class="tt-room">${location}</div></td><td><div class="tt-time">${fmtTime}</div></td></tr>`;
      }).join('')}</tbody>
    </table>`;
  }
}

/* ── Live clock + auto-refresh rooms when slot changes ── */
let _lastSlot=null;
function tickBanner(){
  const n=new Date();
  const t=n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  const d=DAYNAMES[n.getDay()];
  const dateStr=n.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const slot=getCurrentSlot();

  const hc=document.getElementById('clk');if(hc)hc.textContent=t;
  const hd=document.getElementById('clk-day');if(hd)hd.textContent=d+' — '+dateStr;
  const rt=document.getElementById('r-time');if(rt)rt.textContent=t;
  const rd=document.getElementById('r-day-div');if(rd)rd.textContent=d+' · '+dateStr;
  const rs=document.getElementById('r-slot');if(rs)rs.textContent=slot?`CURRENT SLOT: ${fmtSlot(slot)}`:'NO ACTIVE SLOT RIGHT NOW';

  // Auto-refresh rooms view whenever the active slot changes
  if(slot!==_lastSlot){
    _lastSlot=slot;
    const p1=document.getElementById('p1');
    if(p1&&p1.classList.contains('on')){
      const daySel=document.getElementById('r-day-sel');
      if(daySel&&daySel.value) onDayChange();
    }
  }
}
setInterval(tickBanner,1000);
tickBanner();
syncBlockLabsSections(DEFAULT_BLOCK_FLOORS);
syncBlockLabsSections(BLOCK_FLOORS);
initLiveSheetSync();

// Hash-based routing: open panel from URL hash on load
(function initHashRouting(){
  const hash=location.hash.replace('#','');
  const slugs=['timetable','freerooms','showup','exams','seating','faculty'];
  const idx=slugs.indexOf(hash);
  // Deferred to a microtask, not called inline. sw() runs the opened tab's
  // init, and those inits read bindings declared further down this file
  // (SHOWUP_SCHEDULE_URL, EXAM_SCHEDULE_URL, SEATING_PLAN_URL, FACULTY_DATA).
  // Calling it here reached them inside their temporal dead zone, and the
  // ReferenceError aborted the rest of app.js — so deep-linking to #showup,
  // #exams, #seating or #faculty left the app half-initialized. A microtask
  // runs once this script finishes but still before first paint, so the tab
  // opens with everything defined and without a flash of the default tab.
  if(idx>=0) queueMicrotask(()=>sw(idx,false));
  window.addEventListener('hashchange',()=>{
    const h=location.hash.replace('#','');
    const i=slugs.indexOf(h);
    if(i>=0) sw(i,false);
  });
})();

/* ══════════════════════════════════════════
   SHOW UP SCHEDULE
   Real data, loaded from db/showup/<school>.json (synced from
   an emailed workbook whose subject contains "showup"). Same matrix layout
   and JSON shape as the Final Exam Schedule (date/time-slot cells with
   BS(dept) (sections) groups per course).
══════════════════════════════════════════ */
const SHOWUP_SCHEDULE_URL='/db/showup/computing.json';
let _showupData=null;
let _showupLoadPromise=null;

function loadShowupScheduleData(){
  if(_showupData) return Promise.resolve(_showupData);
  if(_showupLoadPromise) return _showupLoadPromise;
  _showupLoadPromise=fetch(SHOWUP_SCHEDULE_URL,{cache:'no-store'})
    .then(r=>{ if(!r.ok) throw new Error('Show up schedule file not found'); return r.json(); })
    .then(data=>{
      _showupData=data||{};
      if(!Array.isArray(_showupData.exams)) _showupData.exams=[];
      return _showupData;
    })
    .catch(err=>{ _showupLoadPromise=null; throw err; });
  return _showupLoadPromise;
}

function showupForDeptBatch(dept,batch){
  const exams=(_showupData&&_showupData.exams)||[];
  return exams.filter(e=>e.sections&&e.sections[dept]&&(!batch||e.batch===batch));
}

// A section like "J1"/"J2" belongs to the same base section "J". Grouping by
// this base means the dropdown offers just "J" and selecting it matches both.
function baseSection(sec){
  return String(sec||'').replace(/\d+$/,'');
}

const SHOWUP_PREF_KEY='fast_showup_prefs';
function readShowupPrefs(){
  try{ const raw=localStorage.getItem(SHOWUP_PREF_KEY); return raw?JSON.parse(raw):{}; }
  catch(e){ return {}; }
}
function saveShowupPrefs(){
  const dept=document.getElementById('su-dept')?.value||'';
  const batch=document.getElementById('su-batch')?.value||'';
  const sec=document.getElementById('su-sec')?.value||'';
  try{ localStorage.setItem(SHOWUP_PREF_KEY,JSON.stringify({dept,batch,sec})); }catch(e){}
}

function refreshShowupSourceBadge(){
  const badge=document.getElementById('showup-source-badge');
  if(!badge) return;
  badge.textContent='SHOW UP SCHEDULE';
}

function refreshShowupSectionOptions(){
  const dept=document.getElementById('su-dept').value;
  const batch=document.getElementById('su-batch').value;
  const secSel=document.getElementById('su-sec');
  if(!secSel) return;
  const prev=secSel.value;
  const bases=[...new Set(showupForDeptBatch(dept,batch).flatMap(e=>(e.sections[dept]||[]).map(baseSection)))].sort();
  fillSelectOptions(secSel,bases,null,'-- Any Section --');
  if(bases.includes(prev)) secSel.value=prev;
}

function onShowupDeptChange(){ saveShowupPrefs(); refreshShowupSectionOptions(); renderShowupSchedule(); }
function onShowupBatchChange(){ saveShowupPrefs(); refreshShowupSectionOptions(); renderShowupSchedule(); }

function renderShowupSchedule(){
  const dept=document.getElementById('su-dept').value;
  const batch=document.getElementById('su-batch').value;
  const sec=document.getElementById('su-sec').value;
  const out=document.getElementById('showup-out');
  if(!out) return;
  if(!dept||!batch){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'Select department and batch year',
      message:'Choose both filters to load the latest show-up schedule.',
      note:'The schedule appears here after the synced data is available.'
    });
    return;
  }
  saveShowupPrefs();
  let data=showupForDeptBatch(dept,batch);
  // Selected section is a base (e.g. "J"); match any token whose base equals it (J1, J2, ...).
  if(sec) data=data.filter(e=>(e.sections[dept]||[]).some(s=>baseSection(s)===sec));

  if(!data.length){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'No show-up schedule found',
      message:'No entries match this department and batch year.',
      note:'Try another batch or clear the section filter.'
    });
    return;
  }

  const sorted=[...data].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const rows=sorted.map(e=>{
    const d=e.date?new Date(e.date+'T00:00:00'):null;
    const cd=d?examCountdown(d):null;
    const secsForDept=(e.sections[dept]||[]).join(', ');
    return `<tr>
      <td><div class="exam-course-name">${escHtml(e.code||'')} ${escHtml(e.course||'')}</div><div class="exam-time-txt">SEC ${escHtml(secsForDept)}${e.teacher?' &middot; '+escHtml(e.teacher):''}</div></td>
      <td>
        <div class="exam-date-pill fin">${d?dDay(d)+', '+dFmt(d):'—'}</div>
        <div class="exam-time-txt">${escHtml(e.time||'')}</div>
        ${cd?`<span class="exam-countdown ${cd.cls}">${cd.label}</span>`:''}
      </td>
      <td><div class="exam-room-txt">${escHtml(e.venue||'—')}</div></td>
    </tr>`;
  }).join('');

  out.innerHTML=`
    <div class="exam-header-bar">
      <span class="exam-header-label">BS ${dept} &nbsp;·&nbsp; BATCH ${batch}${sec?(' &nbsp;·&nbsp; SEC '+sec):''}</span>
      <span class="exam-header-badge fin">SHOW UP</span>
    </div>
    <div class="exam-table-wrap">
      <table class="exam-tbl">
        <thead><tr>
          <th class="fin" style="width:48%">COURSE</th>
          <th class="fin" style="width:32%">DATE &amp; TIME</th>
          <th class="fin" style="width:20%">VENUE</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function initShowupSchedulePanel(){
  const prefs=readShowupPrefs();
  const deptSel=document.getElementById('su-dept'),batchSel=document.getElementById('su-batch'),secSel=document.getElementById('su-sec');
  const out=document.getElementById('showup-out');
  if(out) out.innerHTML=renderUiState({ kind:'loading', title:'Loading show-up schedule', message:'Fetching the latest synced schedule.' });
  loadShowupScheduleData().then(()=>{
    if(prefs.dept&&deptSel) deptSel.value=prefs.dept;
    if(prefs.batch&&batchSel) batchSel.value=prefs.batch;
    refreshShowupSourceBadge();
    refreshShowupSectionOptions();
    if(prefs.sec&&secSel) secSel.value=prefs.sec;
    renderShowupSchedule();
  }).catch(()=>{
    refreshShowupSourceBadge();
    if(out) out.innerHTML=renderUiState({
      kind:'error',
      title:'Could not load show-up schedule',
      message:'The synced schedule source is unavailable right now.',
      note:'Try again in a moment.'
    });
  });
}

/* ══════════════════════════════════════════
   EXAM SCHEDULE DATA
══════════════════════════════════════════ */
function dFmt(d){const M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;}
function dDay(d){return["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];}

/* Real data, loaded from db/exams/<school>.json (synced from the
   Final Examination Schedule xlsx via the Gmail sync backend). */
const EXAM_SCHEDULE_URL='/db/exams/computing.json';
let _examData=null;
let _examLoadPromise=null;

function loadExamScheduleData(){
  if(_examData) return Promise.resolve(_examData);
  if(_examLoadPromise) return _examLoadPromise;
  _examLoadPromise=fetch(EXAM_SCHEDULE_URL,{cache:'no-store'})
    .then(r=>{ if(!r.ok) throw new Error('Exam schedule file not found'); return r.json(); })
    .then(data=>{
      _examData=data||{};
      if(!Array.isArray(_examData.exams)) _examData.exams=[];
      if(!Array.isArray(_examData.flat_exams)) _examData.flat_exams=[];
      return _examData;
    })
    .catch(err=>{ _examLoadPromise=null; throw err; });
  return _examLoadPromise;
}

// Some "schedule" emails are a Midterm/Sessional schedule rather than the
// Final Exam Schedule - a room-grid layout with no department/section info
// at all per course, so it's shown as one flat table (no dept/batch/section
// filtering applies to it) instead of going through examsForDeptBatch.
function renderFlatExamSchedule(){
  const out=document.getElementById('exam-flat-out');
  if(!out) return;
  const flat=(_examData&&_examData.flat_exams)||[];
  if(!flat.length){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'No midterm schedule loaded',
      message:'This section appears only when a midterm or sessional schedule is available.',
      note:'Use the filters below to view the final exam schedule.'
    });
    return;
  }
  const sorted=[...flat].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));
  const rows=sorted.map(e=>{
    const d=e.date?new Date(e.date+'T00:00:00'):null;
    const cd=d?examCountdown(d):null;
    return `<tr>
      <td><div class="exam-course-name">${escHtml(e.code||'')} ${escHtml(e.course||'')}</div></td>
      <td>
        <div class="exam-date-pill fin">${d?dDay(d)+', '+dFmt(d):'—'}</div>
        <div class="exam-time-txt">${escHtml(e.time||'')}</div>
        ${cd?`<span class="exam-countdown ${cd.cls}">${cd.label}</span>`:''}
      </td>
      <td><div class="exam-room-txt">${escHtml(e.room||'—')}</div></td>
    </tr>`;
  }).join('');
  out.innerHTML=`
    <div class="exam-header-bar">
      <span class="exam-header-label">MIDTERM / SESSIONAL SCHEDULE — ALL COURSES</span>
      <span class="exam-header-badge fin">NO DEPT FILTER</span>
    </div>
    <div class="exam-table-wrap" style="margin-bottom:18px">
      <table class="exam-tbl">
        <thead><tr>
          <th class="fin" style="width:48%">COURSE</th>
          <th class="fin" style="width:32%">DATE &amp; TIME</th>
          <th class="fin" style="width:20%">ROOM</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function examsForDeptBatch(dept,batch){
  const exams=(_examData&&_examData.exams)||[];
  return exams.filter(e=>e.sections&&e.sections[dept]&&(!batch||e.batch===batch));
}

const EXAM_PREF_KEY='fast_exam_prefs';
function readExamPrefs(){
  try{ const raw=localStorage.getItem(EXAM_PREF_KEY); return raw?JSON.parse(raw):{}; }
  catch(e){ return {}; }
}
function saveExamPrefs(){
  const dept=document.getElementById('ex-dept')?.value||'';
  const batch=document.getElementById('ex-batch')?.value||'';
  try{ localStorage.setItem(EXAM_PREF_KEY,JSON.stringify({dept,batch})); }catch(e){}
}

function refreshExamSourceBadge(){
  const badge=document.getElementById('exam-source-badge');
  if(!badge) return;
  badge.textContent='FINAL EXAM SCHEDULE';
}

function onExamDeptChange(){ saveExamPrefs(); renderExamSchedule(); }
function onExamBatchChange(){ saveExamPrefs(); renderExamSchedule(); }

function examCountdown(date){
  const now=new Date();
  now.setHours(0,0,0,0);
  const d=new Date(date);d.setHours(0,0,0,0);
  const diff=Math.round((d-now)/(1000*60*60*24));
  if(diff<0) return{label:`${Math.abs(diff)}d ago`,cls:'past'};
  if(diff===0) return{label:'TODAY',cls:'soon'};
  if(diff<=3) return{label:`IN ${diff}d`,cls:'soon'};
  return{label:`IN ${diff}d`,cls:'upcoming'};
}

function renderExamSchedule(){
  const dept=document.getElementById('ex-dept').value;
  const batch=document.getElementById('ex-batch').value;
  const out=document.getElementById('exam-out');
  if(!out) return;
  if(!dept||!batch){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'Select department and batch year',
      message:'Choose both filters to load the latest exam schedule.',
      note:'The results area fills as soon as both selectors are set.'
    });
    return;
  }
  saveExamPrefs();
  const data=examsForDeptBatch(dept,batch);

  if(!data.length){
    out.innerHTML=renderUiState({
      kind:'empty',
      title:'No exam data found',
      message:'No exam entries match this department and batch year.',
      note:'Try a different batch year or another department.'
    });
    return;
  }

  const sorted=[...data].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const rows=sorted.map(e=>{
    const d=e.date?new Date(e.date+'T00:00:00'):null;
    const cd=d?examCountdown(d):null;
    const secsForDept=(e.sections[dept]||[]).join(', ');
    return `<tr>
      <td><div class="exam-course-name">${escHtml(e.code||'')} ${escHtml(e.course||'')}</div><div class="exam-time-txt">SEC ${escHtml(secsForDept)}</div></td>
      <td>
        <div class="exam-date-pill fin">${d?dDay(d)+', '+dFmt(d):'—'}</div>
        <div class="exam-time-txt">${escHtml(e.time||'')}${e.notes?' &middot; '+escHtml(e.notes):''}</div>
        ${cd?`<span class="exam-countdown ${cd.cls}">${cd.label}</span>`:''}
      </td>
    </tr>`;
  }).join('');

  out.innerHTML=`
    <div class="exam-header-bar">
      <span class="exam-header-label">BS ${dept} &nbsp;·&nbsp; BATCH ${batch}</span>
      <span class="exam-header-badge fin">FINAL EXAM</span>
    </div>
    <div class="exam-table-wrap">
      <table class="exam-tbl">
        <thead><tr>
          <th class="fin" style="width:60%">COURSE</th>
          <th class="fin" style="width:40%">DATE &amp; TIME</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function initExamSchedulePanel(){
  const prefs=readExamPrefs();
  const deptSel=document.getElementById('ex-dept'),batchSel=document.getElementById('ex-batch');
  const out=document.getElementById('exam-out');
  const flatOut=document.getElementById('exam-flat-out');
  if(flatOut) flatOut.innerHTML=renderUiState({ kind:'loading', title:'Loading schedule', message:'Checking whether a sessional schedule is available.' });
  if(out) out.innerHTML=renderUiState({ kind:'loading', title:'Loading exam schedule', message:'Fetching the latest exam data.' });
  loadExamScheduleData().then(()=>{
    if(prefs.dept&&deptSel) deptSel.value=prefs.dept;
    if(prefs.batch&&batchSel) batchSel.value=prefs.batch;
    refreshExamSourceBadge();
    renderFlatExamSchedule();
    renderExamSchedule();
  }).catch(()=>{
    if(out) out.innerHTML=renderUiState({
      kind:'error',
      title:'Could not load exam schedule',
      message:'The schedule data source is unavailable right now.',
      note:'Try again once the data sync completes.'
    });
  });
}

/* ══════════════════════════════════════════
   SEATING PLAN
══════════════════════════════════════════ */
const SEATING_PLAN_URL='/db/seating/plan.json';
let _seatingData=null;
let _seatingLoadPromise=null;

function initSeatingPlan(){
  // If a profile is saved, prefill the search with its NU ID and search automatically.
  const inp=document.getElementById('sp-query');
  const profile=(typeof getProfileCookie==='function')?getProfileCookie():null;
  if(inp&&profile&&profile.nuid&&!inp.value.trim()){
    inp.value=profile.nuid;
    searchSeatingPlan();
    return;
  }
  loadSeatingPlanData().then(()=>{
    const status=document.getElementById('sp-status');
    if(status&&!status.classList.contains('err')){
      const count=(_seatingData&&_seatingData.students)?_seatingData.students.length:0;
      status.textContent=count?`${count} STUDENT RECORDS LOADED`:'NO SEATING DATA YET — WAIT FOR GMAIL SYNC';
    }
  }).catch(()=>{});
}

function loadSeatingPlanData(){
  if(_seatingData) return Promise.resolve(_seatingData);
  if(_seatingLoadPromise) return _seatingLoadPromise;
  _seatingLoadPromise=fetch(SEATING_PLAN_URL,{cache:'no-store'})
    .then(r=>{
      if(!r.ok) throw new Error('Seating plan file not found');
      return r.json();
    })
    .then(data=>{
      _seatingData=data||{};
      if(!Array.isArray(_seatingData.students)) _seatingData.students=[];
      return _seatingData;
    })
    .catch(err=>{
      _seatingLoadPromise=null;
      throw err;
    });
  return _seatingLoadPromise;
}

function normalizeQuery(q){
  return String(q||'').trim().toLowerCase();
}

function normalizeNuid(n){
  return String(n||'').trim().toUpperCase().replace(/\s+/g,'');
}

// Strips everything but letters/digits so "22i1096", "22I-1096" and "22I1096"
// all compare equal, and a bare "1096" still matches as a substring.
function nuidKey(n){
  return normalizeNuid(n).replace(/[^A-Z0-9]/g,'');
}

function findSeatingMatches(query){
  const q=normalizeQuery(query);
  if(!q) return [];
  const students=(_seatingData&&_seatingData.students)||[];
  const qKey=nuidKey(query);

  return students.filter(s=>{
    const name=normalizeQuery(s.name);
    const key=nuidKey(s.nuid);
    if(key&&qKey&&(key===qKey||key.includes(qKey)||qKey.includes(key))) return true;
    if(name&&(name===q||name.includes(q)||q.includes(name))) return true;
    return false;
  });
}

function renderSeatingCard(student){
  return `<div class="sp-card">
    <div class="sp-identity">
      <div class="sp-name">${escHtml(student.name||'—')}</div>
      <div class="sp-nuid">NU ID: ${escHtml(student.nuid||'—')}</div>
    </div>
    <div class="sp-spotlight">
      <div class="sp-spotlight-item">
        <div class="sp-spotlight-label">PAPER</div>
        <div class="sp-spotlight-value">${escHtml(student.paper||'—')}</div>
      </div>
      <div class="sp-spotlight-item">
        <div class="sp-spotlight-label">TIME</div>
        <div class="sp-spotlight-value">${escHtml(student.time||'—')}</div>
      </div>
      <div class="sp-spotlight-item">
        <div class="sp-spotlight-label">CLASS</div>
        <div class="sp-spotlight-value">${escHtml(student.class||'—')}</div>
      </div>
    </div>
    <div class="sp-seat-block">
      <div class="sp-seat-label">SEAT NO</div>
      <div class="sp-seat-value">${escHtml(student.seat||'—')}</div>
    </div>
  </div>`;
}

function searchSeatingPlan(){
  const inp=document.getElementById('sp-query');
  const btn=document.getElementById('sp-search-btn');
  const status=document.getElementById('sp-status');
  const result=document.getElementById('sp-result');
  const query=inp?inp.value.trim():'';

  if(!query){
    status.textContent='ENTER YOUR NAME OR NUID TO SEARCH';
    status.className='sp-status err';
    result.innerHTML='';
    return;
  }

  btn.disabled=true;
  status.textContent='SEARCHING...';
  status.className='sp-status';
  result.innerHTML='';

  loadSeatingPlanData().then(()=>{
    const matches=findSeatingMatches(query);
    if(!matches.length){
      status.textContent='NO MATCH FOUND — CHECK SPELLING OR TRY YOUR NUID';
      status.className='sp-status err';
      result.innerHTML=renderUiState({
        kind:'empty',
        title:'No seating record found',
        message:`No seating record matched "${query.toUpperCase()}".`,
        note:'Check spelling or try your NU ID.'
      });
      return;
    }
    status.textContent=matches.length>1?`${matches.length} MATCHES FOUND`:'SEAT FOUND';
    status.className='sp-status';
    result.innerHTML=matches.map(renderSeatingCard).join('');
  }).catch(()=>{
    status.textContent='COULD NOT LOAD SEATING DATA — FILE MAY NOT BE SYNCED YET';
    status.className='sp-status err';
      result.innerHTML=renderUiState({
        kind:'error',
        title:'Seating data unavailable',
        message:'The seating plan file could not be loaded right now.',
        note:'Try again after the sync completes.'
      });
  }).finally(()=>{
    btn.disabled=false;
  });
}

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function renderUiState({ kind = 'empty', title = '', message = '', note = '' } = {}) {
  const mode = kind === 'loading' ? 'loading' : kind === 'error' ? 'error' : 'empty';
  const graphic = mode === 'loading'
    ? '<div class="ui-state-graphic" aria-hidden="true"><span class="ui-state-spinner"></span></div>'
    : mode === 'error'
      ? '<div class="ui-state-graphic" aria-hidden="true"><svg class="ui-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></div>'
      : '<div class="ui-state-graphic" aria-hidden="true"><svg class="ui-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/><path d="M12 8v8"/></svg></div>';
  return `<div class="ui-state-card ${mode}" role="status" aria-live="polite" aria-busy="${mode === 'loading' ? 'true' : 'false'}">
    ${graphic}
    <div class="ui-state-body">
      ${title ? `<div class="ui-state-title">${escHtml(title)}</div>` : ''}
      ${message ? `<div class="ui-state-copy">${escHtml(message)}</div>` : ''}
      ${note ? `<div class="ui-state-note">${escHtml(note)}</div>` : ''}
    </div>
  </div>`;
}
function setTextOrFallback(id, value, fallback = 'Not available') {
  const el = document.getElementById(id);
  if (el) el.textContent = value && String(value).trim() ? value : fallback;
}
function setFacultyLeadershipValues(values) {
  setTextOrFallback('fv-hos-name', values.hosName, 'Select a school');
  setTextOrFallback('fv-hos-email', values.hosEmail, 'Select a school');
  setTextOrFallback('fv-hos-room', values.hosRoom, 'Select a school');
  setTextOrFallback('fv-hod-name', values.hodName, 'Select a department');
  setTextOrFallback('fv-hod-email', values.hodEmail, 'Select a department');
  setTextOrFallback('fv-hod-room', values.hodRoom, 'Select a department');
}
function showCopied(btn){
  if(!btn) return;
  btn.classList.add('copied');
  setTimeout(()=>btn.classList.remove('copied'),1200);
}
function fallbackCopyEmail(email,btn){
  const ta=document.createElement('textarea');
  ta.value=email;
  ta.style.position='fixed';
  ta.style.left='-9999px';
  document.body.appendChild(ta);
  ta.select();
  try{document.execCommand('copy');showCopied(btn);}catch(e){console.warn('Copy failed',e);}
  document.body.removeChild(ta);
}
function copyEmail(text,btn){
  const email=String(text||'').trim();
  if(!email||email==='-') return;
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(email).then(()=>showCopied(btn)).catch(()=>fallbackCopyEmail(email,btn));
  }else{
    fallbackCopyEmail(email,btn);
  }
}

function copyEmailById(id,btn){
  const el=document.getElementById(id);
  copyEmail(el?el.textContent:'',btn);
}



/* ══════════════════════════════════════════
   FACULTY VAULT
══════════════════════════════════════════ */
const FACULTY_SHEET_ID="1HF6g11HUJdnHo9D35fvtCzSxR2fTeu_K";
const FACULTY_SHEET_GID="473774965";
const FACULTY_FALLBACK_DATA_URL="/db/faculty/data.json";
const FACULTY_SHEET_CACHE_KEY="faculty_sheet_designations_v3";
const FACULTY_SHEET_REFRESH_MS=24*60*60*1000;
let _facultySheetTimer=null;

let FACULTY_DATA = {
  "School of computing": {
    hosName: "Dr. Hasan Mujtaba",
        hosDesignation: "Professor & Head, FSC",
    hosEmail: "hasan.mujtaba@nu.edu.pk",
    hosRoom: "C-201 A",
    departments: {
      "Computer Science": {
        hodName: "Dr. Muhammad Arshad Islam",
        hodDesignation: "Professor & HoD",
        hodEmail: "arshad.islam@nu.edu.pk",
        hodRoom: "D-101 D",
        teachers: [
          { name: "Dr. Aftab Maroof", designation: "Professor & Rector NUCES", email: "aftab.maroof@nu.edu.pk", room: "A-114 A"  },
          { name: "Dr. Ahmad Raza Shahid", designation: "Professor", email: "ahmadraza.shahid@nu.edu.pk", room: "D-113 F"  },
          { name: "Dr. Hammad Majeed", designation: "Professor & Director, QEC", email: "hammad.majeed@nu.edu.pk", room: "D-113 D"  },
          { name: "Dr. Akhtar Jamil", designation: "Associate Professor & Coordinator GSC", email: "akhtar.jamil@nu.edu.pk", room: "C-202 E"  },
          { name: "Dr. Ejaz Ahmed", designation: "Associate Professor", email: "ejaz.ahmed@nu.edu.pk", room: "C-202 E"  },
          { name: "Dr. Labiba Fahad", designation: "Associate Professor", email: "labiba.fahad@nu.edu.pk", room: "D-113 A"  },
          { name: "Dr. Afia Zafar", designation: "Assistant Professor", email: "afia.zafar@isb.nu.edu.pk", room: "D-109 A"  },
          { name: "Dr. Ali Zeeshan Ijaz", designation: "Assistant Professor", email: "ali.zeeshan@isb.nu.edu.pk", room: "D-110 D"  },
          { name: "Dr. Basharat Hussain", designation: "Assistant Professor", email: "basharat.hussain@isb.nu.edu.pk", room: "D-113 E"  },
          { name: "Dr. Faisal Cheema", designation: "Assistant Professor", email: "faisal.cheema@nu.edu.pk", room: "C-202 C"  },
          { name: "Dr. Hina Ayaz", designation: "Assistant Professor", email: "hina.ayaz@isb.nu.edu.pk", room: "D-111 E"  },
          { name: "Dr. Mehreen Alam", designation: "Assistant Professor", email: "mehreen.alam@nu.edu.pk", room: "D-110 E"  },
          { name: "Dr. Muhammad Rizwan", designation: "Assistant Professor", email: "muhammad.rizwan@isb.nu.edu.pk", room: "D-109 H"  },
          { name: "Dr. Tajwar Mehmood", designation: "Assistant Professor", email: "tajwar.mehmood@nu.edu.pk", room: "D-112 D"  },
          { name: "Dr. Syeda Javaria Imtiaz", designation: "Assistant Professor", email: "javaria.imtiaz@nu.edu.pk", room: "D-109 D"  },
          { name: "Dr. Suleman Khan", designation: "Assistant Professor", email: "suleman.khan@isb.nu.edu.pk", room: "D-110 B"  },
          { name: "Dr. Amna Basharat", designation: "Assistant Professor", email: "amna.basharat@nu.edu.pk", room: "D-205 D"  },
          { name: "Dr. Nabila Ahmad", designation: "Assistant Professor", email: "nabila.ahmad@isb.nu.edu.pk", room: "D-110 H"  },
          { name: "Ms. Amna Irum", designation: "Assistant Professor", email: "amna.irum@nu.edu.pk", room: "D-111 B"  },
          { name: "Ms. Noor ul Ain", designation: "Assistant Professor", email: "noorul.ain@nu.edu.pk", room: "C-205 G"  },
          { name: "Mr. Aqib Rehman", designation: "Lecturer", email: "aqib.rehman@isb.nu.edu.pk", room: "C-205 A"  },
          { name: "Mr. Fahad Shafique", designation: "Lecturer", email: "fahad.shafique@isb.nu.edu.pk", room: "C-205 F"  },
          { name: "Mr. Furqan Nasir", designation: "Lecturer", email: "furqan.nasir@isb.nu.edu.pk", room: "D-111 H"  },
          { name: "Mr. M. Aadil Ur Rehman", designation: "Lecturer", email: "aadil.rehman@isb.nu.edu.pk", room: "D-109 B"  },
          { name: "Mr. Majid Hussain", designation: "Lecturer", email: "majid.hussain@nu.edu.pk", room: "D-110 C"  },
          { name: "Mr. Muhammad Aamir Gulzar", designation: "Lecturer", email: "aamir.gulzar@nu.edu.pk", room: "C-203 G"  },
          { name: "Mr. Muhammad Almas Khan", designation: "Lecturer", email: "muhammad.almas@nu.edu.pk", room: "D-109 G"  },
          { name: "Mr. Muhammad Farrukh Bashir", designation: "Lecturer", email: "farrukh.bashir@isb.nu.edu.pk", room: "D-111 G"  },
          { name: "Mr. Muhammad Owais Idrees", designation: "Lecturer", email: "Owais.idrees@nu.edu.pk", room: "C-205 B"  },
          { name: "Mr. Shams Farooq", designation: "Lecturer", email: "shams.farooq@nu.edu.pk", room: "C-204 F"  },
          { name: "Mr. Shehreyar Rashid", designation: "Lecturer", email: "shehreyar.rashid@nu.edu.pk", room: "D-111 C"  },
          { name: "Mr. Syed Muhammad Saad Salman", designation: "Lecturer", email: "saad.salman@nu.edu.pk", room: "D-112 G"  },
          { name: "Ms. Hira Mastoor", designation: "Lecturer", email: "hira.mastoor@nu.edu.pk", room: "D-109 F"  },
          { name: "Ms. Marium Hida", designation: "Lecturer", email: "marium.hida@nu.edu.pk", room: "D-112 C"  },
          { name: "Ms. Maryam Shahbaz", designation: "Lecturer", email: "maryam.shahbaz@nu.edu.pk", room: "D-110 F"  },
          { name: "Ms. Munazza Nida", designation: "Lecturer", email: "munazza.nida@isb.nu.edu.pk", room: "D-112 H"  },
          { name: "Ms. Nirmal Tariq", designation: "Lecturer", email: "nirmal.tariq@nu.edu.pk", room: "D-112 F"  },
          { name: "Ms. Nimra Shahid", designation: "Lecturer", email: "nimra.shahid@nu.edu.pk", room: "C-202 F"  },
          { name: "Ms. Rabail Zahid", designation: "Lecturer", email: "rabail.zahid@isb.nu.edu.pk", room: "D-112 B"  },
          { name: "Ms. Bushra Mehmood", designation: "Lecturer", email: "bushra.mehmood@isb.nu.edu.pk", room: "D-111 F"  },
          { name: "Ms. Bushra Kanwal", designation: "Lecturer", email: "bushra.kanwal@isb.nu.edu.pk", room: "D-109 C"  },
          { name: "Ms. Bushra Fatima Tariq", designation: "Lecturer", email: "bushra.fatima@nu.edu.pk", room: "D-110 G"  },
          { name: "Mr. Abdullah Bin Zahid", designation: "Instructor", email: "abdullahbin.zahid@isb.nu.edu.pk", room: "C-503 F"  },
          { name: "Mr. Ali Umer", designation: "Instructor", email: "ali.umer@isb.nu.edu.pk", room: "D-620 B"  },
          { name: "Mr. Hamza Mahmood Sheikh", designation: "Instructor", email: "hamza.mahmood@isb.nu.edu.pk", room: "D-513 A"  },
          { name: "Mr. Imran Khan", designation: "Instructor", email: "imran.khan@isb.nu.edu.pk", room: "C-203 A"  },
          { name: "Mr. Muhammad Ismail", designation: "Instructor", email: "muhammad.ismail@isb.nu.edu.pk", room: "D-513 B"  },
          { name: "Mr. Muhammad Talha Sharif", designation: "Instructor", email: "talha.sharif@isb.nu.edu.pk", room: "D-513 B"  },
          { name: "Mr. Muhammad Umair Khalid", designation: "Instructor", email: "umair.khalid@isb.nu.edu.pk", room: "D-620 B"  },
          { name: "Mr. Usama Bin Imran", designation: "Instructor", email: "usama.imran@isb.nu.edu.pk", room: "D-513 F"  },
          { name: "Ms. Asma Tufail", designation: "Instructor", email: "asma.tufail@isb.nu.edu.pk", room: "D-513 G"  },
          { name: "Ms. Hajira Uzair", designation: "Instructor", email: "hajira.uzair@isb.nu.edu.pk", room: "D-513 G"  },
          { name: "Ms. Laiba Noor", designation: "Instructor", email: "laiba.noor@isb.nu.edu.pk", room: "D-110 A"  },
          { name: "Ms. Syeda Mahnoor Javed", designation: "Instructor", email: "mahnoor.javed@isb.nu.edu.pk", room: "C-204 A"  },
          { name: "Ms. Zill-E-Huma", designation: "Instructor", email: "zille.huma@isb.nu.edu.pk", room: "D-112 A"  },
          { name: "Mr. Muhammad Faheem Muhammadi", designation: "Instructor", email: "muhammad.faheem@isb.nu.edu.pk", room: "C-204 G"  },
          { name: "Ms. Seerat Afreen Satti", designation: "Instructor", email: "seerat.afreen@isb.nu.edu.pk", room: "D-110 A"  }
        ]
      },
      "Artifical Intelligence": {
        hodName: "Dr. Ahmad Din",
        hodDesignation: "Professor & HoD",
        hodEmail: "ahmad.din@nu.edu.pk",
        hodRoom: "D-201 C",
        teachers: [
          { name: "Dr. Mirza Omer Beg", designation: "Professor (Adjunct)", email: "omer.beg@nu.edu.pk", room: "C-205 C"  },
          { name: "Dr. Muhammad Asif Naeem", designation: "Professor & Director ORIC", email: "asif.naeem@nu.edu.pk", room: "D-214 C"  },
          { name: "Dr. Waseem Shahzad", designation: "Professor & Director", email: "waseem.shahzad@nu.edu.pk", room: "Director office"  },
          { name: "Dr. Muhammad Ishtiaq", designation: "Associate Professor", email: "m.ishtiaq@nu.edu.pk", room: "D-214 D"  },
          { name: "Dr. Mateen Yaqoob", designation: "Assistant Professor", email: "mateen.yaqoob@isb.nu.edu.pk", room: "D-212 D"  },
          { name: "Dr. Muhammad Nouman Noor", designation: "Assistant Professor", email: "nouman.noor@isb.nu.edu.pk", room: "D-202 E"  },
          { name: "Dr. Noshina Tariq", designation: "Associate Professor", email: "noshina.tariq@isb.nu.edu.pk", room: "D-202 D"  },
          { name: "Dr. Qurat Ul Ain", designation: "Assistant Professor", email: "quratul.ain@isb.nu.edu.pk", room: "D-212 E"  },
          { name: "Dr. Zohair Ahmed", designation: "Assistant Professor", email: "zohair.ahmed@isb.nu.edu.pk", room: "C-203 B"  },
          { name: "Dr. Adil Majeed", designation: "Assistant Professor", email: "adil.majeed@nu.edu.pk", room: "D-204 E"  },
          { name: "Mr. Ahmad Raza", designation: "Lecturer", email: "ahmad.raza@isb.nu.edu.pk", room: "D-202 C"  },
          { name: "Mr. Usama Imtiaz", designation: "Lecturer", email: "Usama.Imtiaz@isb.nu.edu.pk", room: "D-112 E"  },
          { name: "Ms. Ayesha Kamran ul Haq", designation: "Lecturer", email: "ayesha.kamran@nu.edu.pk", room: "D-212 H"  },
          { name: "Mr. Mohsin Khan", designation: "Lecturer", email: "mohsin.khan@isb.nu.edu.pk", room: "C-202 G"  }
        ]
      },
      "Data Science": {
        hodName: "Dr. Ahmad Din",
        hodDesignation: "Professor & HoD",
        hodEmail: "ahmad.din@nu.edu.pk",
        hodRoom: "D-201 C",
        teachers: [
          { name: "Mr. Muhammad Atif Saeed", designation: "Lecturer", email: "atif.saeed@isb.nu.edu.pk", room: "D-111 A"  },
          { name: "Mr. Muhammad Sohail Abbas", designation: "Lecturer", email: "sohail.abbas@isb.nu.edu.pk", room: "D-204 G"  },
          { name: "Mr. Shahbaz Hassan", designation: "Lecturer", email: "shahbaz.hassan@isb.nu.edu.pk", room: "D-212 C"  },
          { name: "Mr. Shoaib Saleem Khattak", designation: "Lecturer", email: "shoaib.saleem@nu.edu.pk", room: "D-204 H"  },
          { name: "Mr. Ubaid Ur Rehman", designation: "Lecturer", email: "ubaid.rehman@isb.nu.edu.pk", room: "D-204 A"  },
          { name: "Ms. Azka Atiq", designation: "Lecturer", email: "azka.atiq@isb.nu.edu.pk", room: "C-202 A"  },
          { name: "Ms. Kainat Iqbal", designation: "Lecturer", email: "kainat.Iqbal@isb.nu.edu.pk", room: "D-212 F"  },
          { name: "Ms. Kanza Hamid", designation: "Lecturer", email: "kanza.hamid@isb.nu.edu.pk", room: "D-204 F"  },
          { name: "Ms. Laraib Afzaal", designation: "Lecturer", email: "laraib.afzaal@nu.edu.pk", room: "D-202 B"  },
          { name: "Ms. Mahnoor Tariq", designation: "Lecturer", email: "mahnoor.tariq@isb.nu.edu.pk", room: "D-212 B"  },
          { name: "Ms. Mariam Bint Imran", designation: "Lecturer", email: "mariam.imran@isb.nu.edu.pk", room: "D-202 A"  },
          { name: "Ms. Maryam Sana", designation: "Lecturer", email: "maryam.sana@isb.nu.edu.pk", room: "C-203 F"  },
          { name: "Ms. Parisa Salma", designation: "Lecturer", email: "parisa.salma@nu.edu.pk", room: "D-202 G"  },
          { name: "Ms. Saira Qamar", designation: "Lecturer", email: "saira.qamar@nu.edu.pk", room: "D-212 G"  },
          { name: "Ms. Umarah Qaseem", designation: "Lecturer", email: "umarah.qaseem@isb.nu.edu.pk", room: "D-202 F"  },
          { name: "Ms. Zonera Anjum", designation: "Lecturer", email: "zonera.anjum@isb.nu.edu.pk", room: "D-204 B"  },
          { name: "Mr. Abdul Hammad Rasheed", designation: "Instructor", email: "hammad.rasheed@isb.nu.edu.pk", room: "D-513 A"  },
          { name: "Mr. Abdul Wahab Khan", designation: "Instructor", email: "abdul.wahab@isb.nu.edu.pk", room: "D-513 C"  },
          { name: "Mr. Ali Hamza", designation: "Instructor", email: "ali.hamza@isb.nu.edu.pk", room: "D-513 D"  },
          { name: "Mr. Muhammad Ammar Masood", designation: "Instructor", email: "ammar.masood@isb.nu.edu.pk", room: "D-513 A"  },
          { name: "Mr. Talha Tariq", designation: "Instructor", email: "talha.tariq@isb.nu.edu.pk", room: "D-513 D"  },
          { name: "Ms. Maryam Hussain", designation: "Instructor", email: "maryam.hussain@isb.nu.edu.pk", room: "C-108 A"  },
          { name: "Ms. Mubrra Asma", designation: "Instructor", email: "mubrra.asma@isb.nu.edu.pk", room: "C-513 C"  },
          { name: "Ms. Nabeelah Maryam", designation: "Instructor", email: "nabeelah.maryam@isb.nu.edu.pk", room: "D-513 E"  },
          { name: "Ms. Nayyera Wasim", designation: "Instructor", email: "nayyera.wasim@isb.nu.edu.pk", room: "C-108 A"  },
          { name: "Ms. Palwasha Zahid", designation: "Instructor", email: "palwasha.zahid@isb.nu.edu.pk", room: "C-513 B"  },
          { name: "Ms. Sidra Fayyaz", designation: "Instructor", email: "sidra.fayyaz@isb.nu.edu.pk", room: "C-513 A"  },
          { name: "Ms. Umaima Aman", designation: "Instructor", email: "umaima.aman@isb.nu.edu.pk", room: "D-202 H"  }
        ]
      },
      "Cyber Security": {
        hodName: "Dr. Qaisar Shafi",
        hodDesignation: "Assistant Professor & HoD",
        hodEmail: "qaisar.shafi@nu.edu.pk",
        hodRoom: "D-208 A",
        teachers: [
          { name: "Dr. Muhammad Asim", designation: "Professor", email: "muhammad.asim@nu.edu.pk", room: "C-204 E"  },
          { name: "Dr. Subhan Ullah", designation: "Associate Professor", email: "subhan.ullah@nu.edu.pk", room: "C-203 E"  },
          { name: "Dr. Zafar Iqbal", designation: "Associate Professor", email: "zafar.iqbal@isb.nu.edu.pk", room: "C-205 E"  },
          { name: "Dr. Sana Aurangzeb", designation: "Assistant Professor", email: "sana.aurangzeb@nu.edu.pk", room: "D-205 E"  },
          { name: "Mr. Jawad Hassan Nisar", designation: "Assistant Professor", email: "jawad.hassan@nu.edu.pk", room: "D-204 D"  },
          { name: "Ms. Aneeqa Khalil", designation: "Lecturer", email: "aneeqa.khalil@isb.nu.edu.pk", room: "C-202 B"  },
          { name: "Mr. Arslan Aslam", designation: "Lecturer", email: "arslan.aslam@nu.edu.pk", room: "D-205 B"  },
          { name: "Mr. Mehmood ul Hassan", designation: "Lecturer", email: "mehmood.hassan@nu.edu.pk", room: "D-204 C"  },
          { name: "Ms. Amina Siddique", designation: "Lecturer", email: "amina.siddique@nu.edu.pk", room: "D-205 H"  },
          { name: "Ms. Farheen Tabassum", designation: "Lecturer", email: "farheen.tabassum@isb.nu.edu.pk", room: "D-205 C"  },
          { name: "Ms. Hina Binte Haq", designation: "Lecturer", email: "hina.haq@nu.edu.pk", room: "D-205 F"  },
          { name: "Ms. Naveen Khan", designation: "Lecturer", email: "naveen.khan@isb.nu.edu.pk", room: "D-205 A"  },
          { name: "Ms. Sadia Saad", designation: "Lecturer", email: "sadia.saad@nu.edu.pk", room: "D-205 G"  },
          { name: "Mr. Ahsan Shakeel Malik", designation: "Instructor", email: "ahsan.shakeel@isb.nu.edu.pk", room: "D-513 H"  },
          { name: "Mr. Nawfal Waqar", designation: "Instructor", email: "nawfal.waqar@isb.nu.edu.pk", room: "C-204 G"  },
          { name: "Ms. Syeda Rubab Zainab", designation: "Instructor", email: "rubab.zainab@isb.nu.edu.pk", room: "D-112 A"  },
          { name: "Ms. Areej Fatima", designation: "Instructor", email: "areej.fatima@isb.nu.edu.pk", room: "D-513 E"  },
          { name: "Mr. Khubab Ahmed", designation: "Instructor", email: "khubab.ahmed@isb.nu.edu.pk", room: "C-204 B"  }
        ]
      },
      "Software Engineering": {
        hodName: "Dr. Usman Habib",
        hodDesignation: "Professor & HoD",
        hodEmail: "usman.habib@nu.edu.pk",
        hodRoom: "C-501 C",
        teachers: [
          { name: "Dr. Naveed Ahmad", designation: "Professor (Adjunct)", email: "naveed.ahmad@nu.edu.pk", room: "C-204 C"  },
          { name: "Dr. Asif Muhammad", designation: "Assistant Professor", email: "asif.muhammad@isb.nu.edu.pk", room: "C-503 E"  },
          { name: "Dr. Atif Aftab Ahmed Jilani", designation: "Associate Professor", email: "atif.jilani@nu.edu.pk", room: "C-502 C"  },
          { name: "Dr. Behjat Zuhaira", designation: "Assistant Professor", email: "behjat.zuhaira@nu.edu.pk", room: "C-203 C"  },
          { name: "Dr. Isma Ul Hassan", designation: "Assistant Professor", email: "isma.hassan@nu.edu.pk", room: "D-111 D"  },
          { name: "Dr. Muhammad Bilal", designation: "Assistant Professor", email: "muhammad.bilal@isb.nu.edu.pk", room: "C-502 E"  },
          { name: "Dr. Shahela Saif", designation: "Assistant Professor", email: "shahela.saif@nu.edu.pk", room: "C-505 C"  },
          { name: "Dr. Zeshan Khan", designation: "Assistant Professor", email: "zeshan.khan@nu.edu.pk", room: "C-505 E"  },
          { name: "Mr. Bilal Khalid Dar", designation: "Lecturer", email: "bilal.khalid@nu.edu.pk", room: "C-502 B"  },
          { name: "Mr. Irfan Ullah", designation: "Lecturer", email: "irfan.ullah@nu.edu.pk", room: "C-504 F"  },
          { name: "Mr. Junaid Ali khan", designation: "Lecturer", email: "junaid.ali@isb.nu.edu.pk", room: "C-505 B"  },
          { name: "Mr. Pir Sami Ullah Shah", designation: "Lecturer", email: "samiullah.shah@nu.edu.pk", room: "C-503 B"  },
          { name: "Mr. Zaheer Ul Hussain Sani", designation: "Lecturer", email: "zaheer.sani@nu.edu.pk", room: "C-505 E"  },
          { name: "Ms. Anum kaleem", designation: "Lecturer", email: "anum.kaleem@isb.nu.edu.pk", room: "C-504 B"  },
          { name: "Ms. Fatima Gillani", designation: "Lecturer", email: "fatima.gillani@isb.nu.edu.pk", room: "C-505 A"  },
          { name: "Ms. Laiba Imran", designation: "Lecturer", email: "laiba.imran@nu.edu.pk", room: "C-505 G"  },
          { name: "Ms. Momina Behzad", designation: "Lecturer", email: "momina.behzad@isb.nu.edu.pk", room: "C-504 A"  },
          { name: "Ms. Nigar Azhar Butt", designation: "Lecturer", email: "nigar.azhar@isb.nu.edu.pk", room: "C-503 C"  },
          { name: "Ms. Zoya Sumbul Zaheer", designation: "Lecturer", email: "zoya.sumbul@nu.edu.pk", room: "C-502 F"  },
          { name: "Ms. Samia Aziz", designation: "Lecturer", email: "samia.aziz@nu.edu.pk", room: "C-504 G"  },
          { name: "Ms. Mahnoor Ayaz", designation: "Lecturer", email: "mahnoor.ayaz@isb.nu.edu.pk", room: "C-503 F"  },
          { name: "Ms. Daniya Jadoon", designation: "Lecturer", email: "daniya.jadoon@isb.nu.edu.pk", room: "C-505 F"  },
          { name: "Mr. Akbar Ali Shah", designation: "Instructor", email: "akbar.ali@isb.nu.edu.pk", room: "C-503 F"  },
          { name: "Mr. Muhammad Muneeb Baig", designation: "Instructor", email: "muneeb.baig@isb.nu.edu.pk", room: "C-502 A"  },
          { name: "Mr. Syed Daniyal Hussain Shah", designation: "Instructor", email: "daniyal.hussain@isb.nu.edu.pk", room: "C-502 A"  },
          { name: "Ms. Arige Anjum", designation: "Instructor", email: "arige.anjum@isb.nu.edu.pk", room: "C-503 A"  },
          { name: "Ms. Hifza Umer", designation: "Instructor", email: "Hifza.Umer@isb.nu.edu.pk", room: "C-503 A"  },
          { name: "Ms. Noor ul Ain", designation: "Instructor", email: "Noor.ulAin@isb.nu.edu.pk", room: "C-502 G"  },
          { name: "Ms. Zoya Mahboob", designation: "Instructor", email: "Zoya.Mahboob@isb.nu.edu.pk", room: "C-502 G"  },
          { name: "Mr. Jawad Wakeel", designation: "Instructor", email: "jawad.wakeel@isb.nu.edu.pk", room: "C-503 F"  }
        ]
      }
    }
  },
  "Sciences and Humanities": {
    hosName: "Dr. Muhammad Tayyeb Nadeem",
        hosDesignation: "Professor",
    hosEmail: "tayyeb.nadeem@nu.edu.pk",
    hosRoom: "B-101 A",
    departments: {
      "Social Sciences": {
        hodName: "Farah Jabeen",
        hodDesignation: "Assistant Professor",
        hodEmail: "farah.awan@nu.edu.pk",
        hodRoom: "B-102",
        teachers: [
          { name: "Aisha", designation: "Assistant Professor", email: "aisha.ijaz@nu.edu.pk", room: "B-201"  },
          { name: "Arisha Wasim", designation: "Instructor", email: "arisha.wassim@nu.edu.pk", room: "B-202"  },
          { name: "Eeman Mirza", designation: "Lecturer", email: "eeman.mirza@nu.edu.pk", room: "B-203"  },
          { name: "Farah Jabeen", designation: "Assistant Professor", email: "farah.awan@nu.edu.pk", room: "B-102"  },
          { name: "Ghalia", designation: "Instructor", email: "ghalia.gohar@nu.edu.pk", room: "B-204"  },
          { name: "Hajra Khalid", designation: "Lecturer", email: "hajra.khalid@nu.edu.pk", room: "B-205"  },
          { name: "Halla Waheed", designation: "Instructor", email: "halla.waheed@nu.edu.pk", room: "B-206"  },
          { name: "Hazber", designation: "Lecturer", email: "hazber.samson@isb.nu.edu.pk", room: "B-207"  },
          { name: "Khadija Farooq", designation: "Assistant Professor", email: "khadija.farooq@nu.edu.pk", room: "B-208"  },
          { name: "Maryam Abid", designation: "Lecturer", email: "maryam.abid@nu.edu.pk", room: "B-209"  },
          { name: "Mehreen", designation: "Lecturer", email: "mehreen@nu.edu.pk", room: "B-210"  },
          { name: "Mehwish Hassan", designation: "Assistant Professor", email: "mehwish.hassan@nu.edu.pk", room: "B-211"  },
          { name: "Memoona Rasool", designation: "Assistant Professor", email: "maimoona.rasool@nu.edu.pk", room: "B-212"  },
          { name: "Momal Saleem", designation: "Instructor", email: "momal.saleem@nu.edu.pk", room: "B-213"  },
          { name: "Muhammad Ali", designation: "Associate Professor", email: "m.ali@nu.edu.pk", room: "B-214"  },
          { name: "Muhammad Usman Rashid", designation: "Lecturer", email: "usman.rashid@nu.edu.pk", room: "B-215"  },
          { name: "Rabia Islam", designation: "Lecturer", email: "rabia.islam@isb.nu.edu.pk", room: "B-216"  },
          { name: "Sadia Nauman", designation: "Lecturer", email: "sadia.nauman@nu.edu.pk", room: "B-217"  },
          { name: "Sara Aziz", designation: "Assistant Professor", email: "sara.aziz@nu.edu.pk", room: "B-218"  },
          { name: "Sana Ilyas", designation: "Lecturer", email: "sanaa.ilyas@nu.edu.pk", room: "B-219"  },
          { name: "Sehrish Hassan", designation: "Assistant Professor", email: "sehrish.hassan@nu.edu.pk", room: "B-220"  },
          { name: "Shahzad Mahmood", designation: "Assistant Professor", email: "shahzad.mahmood@nu.edu.pk", room: "B-221"  },
          { name: "Sumera Abbas", designation: "Lecturer", email: "sumera.abbas@nu.edu.pk", room: "B-222"  },
          { name: "Sumaira Azhar", designation: "Assistant Professor", email: "sumaira.azhar@nu.edu.pk", room: "B-223"  },
          { name: "Sumayyah Malik", designation: "Lecturer", email: "sumayyah.malik@nu.edu.pk", room: "B-224"  },
          { name: "Tayyaba Waseem", designation: "Lecturer", email: "tayyaba.waseem@isb.nu.edu.pk", room: "B-225"  },
          { name: "Zirwa", designation: "Instructor", email: "zirva.shabbir@isb.nu.edu.pk", room: "B-226"  },
          { name: "Ms. Iqra Fatima", designation: "Instructor", email: "iqra.fatima@isb.nu.edu.pk", room: "B-227"  },
          { name: "Ms. Sadia Sahar", designation: "Instructor", email: "sadia.sahar@isb.nu.edu.pk", room: "B-228"  },
          { name: "Faisal ur rahman", designation: "Lecturer", email: "faisal.rehman@isb.nu.edu.pk", room: "B-229"  },
          { name: "Muhammad Saqib", designation: "Lecturer", email: "muhammad.saqib@isb.nu.edu.pk", room: "B-230"  },
          { name: "Sayeda Hassan", designation: "Instructor", email: "sayeda.hassan@isb.nu.edu.pk", room: "B-231"  },
          { name: "Sayeda Mahnoor Ali", designation: "Instructor", email: "mahnoor.ali@isb.nu.edu.pk", room: "B-232"  },
          { name: "Tehmina ijaz", designation: "Lecturer", email: "tehmina.ejaz@isb.nu.edu.pk", room: "B-233"  },
          { name: "Aseefa Zareen", designation: "Lecturer", email: "asefa.zareen@isb.nu.edu.pk", room: "B-234"  }
        ]
      },
      "Mathematics": {
        hodName: "Dr. Muhammad Tayyeb Nadeem",
        hodDesignation: "Professor",
        hodEmail: "tayyeb.nadeem@nu.edu.pk",
        hodRoom: "B-101 A",
        teachers: [
          { name: "Dr. Muhammad Tayyeb Nadeem", designation: "Professor", email: "tayyeb.nadeem@nu.edu.pk", room: "B-101 A"  },
          { name: "Dr. Muhammad Usman Ashraf", designation: "Professor", email: "usman.ashraf@nu.edu.pk", room: "B-110"  },
          { name: "Aqsa Malik", designation: "Lecturer", email: "aqsa.malik@nu.edu.pk", room: "B-111"  },
          { name: "Abdul Basit", designation: "Instructor", email: "abdul.basit@isb.nu.edu.pk", room: "B-112"  },
          { name: "Hamda khan", designation: "Associate Professor", email: "hamda.khan@nu.edu.pk", room: "B-113"  },
          { name: "Hasham Ahmad", designation: "Lecturer", email: "hasham.ahmad@nu.edu.pk", room: "B-114"  },
          { name: "Hafiz Muhammad Hammad", designation: "Lecturer", email: "hafiz.hammad@isb.nu.edu.pk", room: "B-115"  },
          { name: "Khalil Ullah", designation: "Assistant Professor", email: "khalil.awan@nu.edu.pk", room: "B-116"  },
          { name: "Rao M. Touqeer", designation: "Lecturer", email: "muhammad.touqeer@isb.nu.edu.pk", room: "B-117"  },
          { name: "Waqar Ahmad", designation: "Lecturer", email: "waqar.ahmad@isb.nu.edu.pk", room: "B-118"  },
          { name: "Lubna", designation: "Lecturer", email: "lubna@nu.edu.pk", room: "B-119"  }
        ]
      },
      "Physics": {
        hodName: "Syed Irfan Shah",
        hodDesignation: "Professor",
        hodEmail: "irfan.shah@nu.edu.pk",
        hodRoom: "B-103",
        teachers: [
          { name: "Syed Irfan Shah", designation: "Professor", email: "irfan.shah@nu.edu.pk", room: "B-103"  },
          { name: "Maria Mazhar", designation: "Lecturer", email: "maria.mazhar@isb.nu.edu.pk", room: "B-120"  },
          { name: "Muhammad Ajmal", designation: "Lecturer", email: "muhammad.ajmal@nu.edu.pk", room: "B-121"  },
          { name: "Muhammad Ibrahim", designation: "Lecturer", email: "m.ibraheem@nu.edu.pk", room: "B-122"  },
          { name: "Muhammad Umer", designation: "Instructor", email: "muhammad.umer@isb.nu.edu.pk", room: "B-123"  },
          { name: "Shan e Batool", designation: "Instructor", email: "shan.batool@isb.nu.edu.pk", room: "B-124"  }
        ]
      }
    }
  }
};

function facultySheetCsvUrl(){
  return `https://docs.google.com/spreadsheets/d/${FACULTY_SHEET_ID}/export?format=csv&gid=${FACULTY_SHEET_GID}&cachebust=${Date.now()}`;
}

function facultySheetGVizUrl(){
  return `https://docs.google.com/spreadsheets/d/${FACULTY_SHEET_ID}/gviz/tq?tqx=out:json&gid=${FACULTY_SHEET_GID}&cachebust=${Date.now()}`;
}

function parseCsvRows(text){
  const rows=[];
  let row=[],cell='',inQuotes=false;
  const src=String(text||'');
  for(let i=0;i<src.length;i++){
    const ch=src[i],next=src[i+1];
    if(ch==='"'){
      if(inQuotes&&next==='"'){cell+='"';i++;}
      else inQuotes=!inQuotes;
    }else if(ch===','&&!inQuotes){
      row.push(cell);cell='';
    }else if((ch==='\n'||ch==='\r')&&!inQuotes){
      if(ch==='\r'&&next==='\n') i++;
      row.push(cell);
      if(row.some(v=>cleanTxt(v))) rows.push(row);
      row=[];cell='';
    }else{
      cell+=ch;
    }
  }
  row.push(cell);
  if(row.some(v=>cleanTxt(v))) rows.push(row);
  return rows;
}

function buildFacultyDataFromRows(rows) {
  const data = {};
  let currentSchool = null;
  let currentDept = null;

  rows.forEach(row => {
    const cells = row.map(v => cleanTxt(v));
    const rowText = cells.join(' ');

    if (/School of Computing/i.test(rowText)) {
      currentSchool = "School of computing";
      currentDept = null;
      if (!data[currentSchool]) {
        data[currentSchool] = {
          hosName: "-",
          hosEmail: "-",
          hosRoom: "-",
          hosRole: "-",
          departments: {}
        };
      }
      return;
    }

    if (/Science And Humanities/i.test(rowText) || /Sciences and Humanities/i.test(rowText)) {
      currentSchool = "Sciences and Humanities";
      currentDept = "Science And Humanities";
      if (!data[currentSchool]) {
        data[currentSchool] = {
          hosName: "-",
          hosEmail: "-",
          hosRoom: "-",
          hosRole: "-",
          departments: {}
        };
      }
      if (!data[currentSchool].departments[currentDept]) {
        data[currentSchool].departments[currentDept] = {
          hodName: "-",
          hodEmail: "-",
          hodRoom: "-",
          hodRole: "-",
          teachers: []
        };
      }
      return;
    }

    if (/Faculty Department of/i.test(rowText)) {
      const match = rowText.match(/Faculty Department of\s+([^,]+)/i);
      if (match && currentSchool) {
        currentDept = cleanTxt(match[1]);
        if (!data[currentSchool].departments[currentDept]) {
          data[currentSchool].departments[currentDept] = {
            hodName: "-",
            hodEmail: "-",
            hodRoom: "-",
            hodRole: "-",
            teachers: []
          };
        }
      }
      return;
    }

    const emailIdx = cells.findIndex(c => /@/i.test(c));
    if (emailIdx >= 0) {
      const email = cells[emailIdx].replace(/\s+/g, '');
      const nonEmpties = cells.map((v, i) => ({val: v, originalIdx: i})).filter(item => item.val !== '');

      let name = "";
      let designation = "";
      let room = "";

      const emailItemIdx = nonEmpties.findIndex(item => /@/.test(item.val));
      if (emailItemIdx >= 0) {
        let nameItem = nonEmpties[0];
        if (nameItem && /^\d+$/.test(nameItem.val) && nonEmpties[1]) {
          nameItem = nonEmpties[1];
        }
        name = nameItem ? nameItem.val : "";

        const nameItemIdx = nonEmpties.indexOf(nameItem);
        if (emailItemIdx > nameItemIdx + 1) {
          designation = nonEmpties[nameItemIdx + 1].val;
        } else {
          if (/^Dr\./i.test(name)) {
            designation = "Assistant Professor";
          } else {
            designation = "Lecturer";
          }
        }

        if (nonEmpties[emailItemIdx + 1]) {
          room = nonEmpties[emailItemIdx + 1].val;
        }
      }

      if (!name || !email) return;

      const teacher = { name, email, room, designation };

      if (currentSchool) {
        if (currentDept) {
          data[currentSchool].departments[currentDept].teachers.push(teacher);

          if (/HOD/i.test(designation) || /Head of Department/i.test(designation)) {
            data[currentSchool].departments[currentDept].hodName = name;
            data[currentSchool].departments[currentDept].hodEmail = email;
            data[currentSchool].departments[currentDept].hodRoom = room || "-";
            data[currentSchool].departments[currentDept].hodRole = designation;
          }
        } else {
          data[currentSchool].hosName = name;
          data[currentSchool].hosEmail = email;
          data[currentSchool].hosRoom = room || "-";
          data[currentSchool].hosRole = designation;
        }
      }
    }
  });

  // Fallback for Sciences and Humanities HOS/HOD if not set
  if (data["Sciences and Humanities"]) {
    const sh = data["Sciences and Humanities"];
    const shDept = sh.departments["Science And Humanities"];
    if (shDept) {
      const tayyeb = shDept.teachers.find(t => /tayyeb\.nadeem/i.test(t.email) || /Tayyeb Nadeem/i.test(t.name));
      if (tayyeb) {
        sh.hosName = tayyeb.name;
        sh.hosEmail = tayyeb.email;
        sh.hosRoom = tayyeb.room || "B-101 A";
        sh.hosRole = "Professor & Head, S&H";
        
        shDept.hodName = tayyeb.name;
        shDept.hodEmail = tayyeb.email;
        shDept.hodRoom = tayyeb.room || "B-101 A";
        shDept.hodRole = "Professor & Head, S&H";
      }
    }
  }

  return data;
}

function parseFacultyGViz(data) {
  const rows = [];
  const gvizRows = data?.table?.rows || [];
  gvizRows.forEach(row => {
    const cells = row.c || [];
    const rowCells = cells.map(cell => cleanTxt(cell?.f ?? cell?.v ?? ''));
    rows.push(rowCells);
  });
  return buildFacultyDataFromRows(rows);
}

function parseFacultyCsv(csvText) {
  const rows = parseCsvRows(csvText);
  return buildFacultyDataFromRows(rows);
}

function fetchFacultyGVizJsonp(){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const googleObj=window.google=window.google||{};
    googleObj.visualization=googleObj.visualization||{};
    const previousQuery=googleObj.visualization.Query;
    let done=false;
    const cleanup=()=>{
      script.remove();
      if(previousQuery) googleObj.visualization.Query=previousQuery;
    };
    googleObj.visualization.Query={setResponse:(data)=>{
      if(done) return;done=true;cleanup();resolve(data);
    }};
    script.onerror=()=>{if(done)return;done=true;cleanup();reject(new Error('Faculty sheet JSONP load failed'));};
    script.src=facultySheetGVizUrl();
    document.head.appendChild(script);
    setTimeout(()=>{if(done)return;done=true;cleanup();reject(new Error('Faculty sheet JSONP timeout'));},15000);
  });
}

async function fetchFacultySheetData() {
  try {
    const res = await fetch(facultySheetCsvUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Faculty sheet CSV HTTP ${res.status}`);
    const csvText = await res.text();
    if (csvText && csvText.toLowerCase().includes('faculty')) {
      return parseFacultyCsv(csvText);
    }
    throw new Error('Faculty CSV export was empty');
  } catch (csvErr) {
    try {
      const res = await fetch(facultySheetGVizUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Faculty sheet GViz HTTP ${res.status}`);
      return parseFacultyGViz(parseGVizText(await res.text()));
    } catch (gvizErr) {
      try {
        return parseFacultyGViz(await fetchFacultyGVizJsonp());
      } catch (jsonpErr) {
        throw new Error(`Live faculty sheet unavailable: ${csvErr.message}`);
      }
    }
  }
}

async function loadFacultyFallbackData() {
  try {
    const res = await fetch(FACULTY_FALLBACK_DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Fallback faculty JSON HTTP ${res.status}`);
    const data = await res.json();
    if (data && typeof data === 'object' && Object.keys(data).length) {
      FACULTY_DATA = data;
      renderFacultyVault();
      return true;
    }
  } catch (err) {
    console.warn('Faculty fallback JSON failed:', err);
  }
  return false;
}

function readFacultySheetCache(allowStale = false) {
  try {
    const cached = JSON.parse(localStorage.getItem(FACULTY_SHEET_CACHE_KEY) || 'null');
    if (!cached || !cached.facultyData || !cached.syncedAt) return null;
    if (!allowStale && Date.now() - cached.syncedAt >= FACULTY_SHEET_REFRESH_MS) return null;
    return cached;
  } catch (e) {
    return null;
  }
}

async function refreshFacultySheetData(force = false) {
  const freshCache = !force && readFacultySheetCache(false);
  if (freshCache) {
    FACULTY_DATA = freshCache.facultyData;
    renderFacultyVault();
    return;
  }
  try {
    const facultyData = await fetchFacultySheetData();
    if (facultyData && Object.keys(facultyData).length > 0) {
      FACULTY_DATA = facultyData;
      localStorage.setItem(FACULTY_SHEET_CACHE_KEY, JSON.stringify({ syncedAt: Date.now(), facultyData }));
    }
    renderFacultyVault();
  } catch (err) {
    console.warn('Faculty sheet sync failed:', err);
    const staleCache = readFacultySheetCache(true);
    if (staleCache) {
      FACULTY_DATA = staleCache.facultyData;
      renderFacultyVault();
    } else {
      await loadFacultyFallbackData();
    }
  }
}

function onFvSchoolChange() {
  const school = document.getElementById('fv-school').value;
  const deptSelect = document.getElementById('fv-dept');
  deptSelect.innerHTML = '';
  deptSelect.disabled = !school;

  if (school && FACULTY_DATA[school]) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Department';
    deptSelect.appendChild(placeholder);

    const depts = Object.keys(FACULTY_DATA[school].departments);
    depts.forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      deptSelect.appendChild(opt);
    });
    deptSelect.value = '';
    setFacultyLeadershipValues({
      hosName: FACULTY_DATA[school].hosName,
      hosEmail: FACULTY_DATA[school].hosEmail,
      hosRoom: FACULTY_DATA[school].hosRoom,
      hodName: 'Select a department',
      hodEmail: 'Select a department',
      hodRoom: 'Select a department'
    });
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select School First';
    deptSelect.appendChild(placeholder);
    setFacultyLeadershipValues({
      hosName: 'Select a school',
      hosEmail: 'Select a school',
      hosRoom: 'Select a school',
      hodName: 'Select a school',
      hodEmail: 'Select a school',
      hodRoom: 'Select a school'
    });
  }
  renderFacultyVault();
}

function onFvDeptChange() {
  const school = document.getElementById('fv-school').value;
  const dept = document.getElementById('fv-dept').value;
  if (!school) {
    setFacultyLeadershipValues({
      hosName: 'Select a school',
      hosEmail: 'Select a school',
      hosRoom: 'Select a school',
      hodName: 'Select a school',
      hodEmail: 'Select a school',
      hodRoom: 'Select a school'
    });
    renderFacultyVault();
    return;
  }
  if (!dept) {
    const schoolData = FACULTY_DATA[school];
    setFacultyLeadershipValues({
      hosName: schoolData?.hosName,
      hosEmail: schoolData?.hosEmail,
      hosRoom: schoolData?.hosRoom,
      hodName: 'Select a department',
      hodEmail: 'Select a department',
      hodRoom: 'Select a department'
    });
    renderFacultyVault();
    return;
  }
  
  const schoolData = FACULTY_DATA[school];
  if (schoolData) {
    setFacultyLeadershipValues({
      hosName: schoolData.hosName,
      hosEmail: schoolData.hosEmail,
      hosRoom: schoolData.hosRoom,
      hodName: 'Not available',
      hodEmail: 'Not available',
      hodRoom: 'Not available'
    });
    
    const deptData = schoolData.departments[dept];
    if (deptData) {
      setFacultyLeadershipValues({
        hosName: schoolData.hosName,
        hosEmail: schoolData.hosEmail,
        hosRoom: schoolData.hosRoom,
        hodName: deptData.hodName,
        hodEmail: deptData.hodEmail,
        hodRoom: deptData.hodRoom
      });
    }
  } else {
    setFacultyLeadershipValues({
      hosName: 'Select a school',
      hosEmail: 'Select a school',
      hosRoom: 'Select a school',
      hodName: 'Select a school',
      hodEmail: 'Select a school',
      hodRoom: 'Select a school'
    });
  }
  
  renderFacultyVault();
}

function onSearchInput() {
  renderFacultyVault();
}

function renderFacultyVault() {
  const school = document.getElementById('fv-school').value;
  const dept = document.getElementById('fv-dept').value;
  const search = (document.getElementById('fv-search').value || '').trim().toLowerCase();
  
  const grid = document.getElementById('fv-teacher-grid');
  const countEl = document.getElementById('fv-results-count');
  
  if (!grid) return;
  
  const schoolData = FACULTY_DATA[school];
  if (!schoolData) {
    grid.innerHTML = renderUiState({
      kind:'empty',
      title:'Choose a school',
      message:'Pick a school to browse faculty members, leadership contacts, room numbers, and email addresses.',
      note:'Use the school selector above to start.'
    });
    countEl.textContent = 'Select a school';
    return;
  }
  
  const deptData = schoolData.departments[dept];
  if (!deptData) {
    grid.innerHTML = renderUiState({
      kind:'empty',
      title:'Choose a department',
      message:'Pick a department to view its faculty directory.',
      note:'You can search once the department is selected.'
    });
    countEl.textContent = 'Select a department';
    return;
  }
  
  let teachers = deptData.teachers;
  if (search) {
    teachers = teachers.filter(t => t.name.toLowerCase().includes(search));
  }
  
  countEl.textContent = `${teachers.length} MEMBER${teachers.length !== 1 ? 'S' : ''}`;
  
  if (teachers.length === 0) {
    grid.innerHTML = renderUiState({
      kind:'empty',
      title:'No teachers matched',
      message:`No faculty members match "${search.toUpperCase()}".`,
      note:'Try another name or clear the search box.'
    });
    return;
  }
  
  grid.innerHTML = teachers.map(t => {
    const designation=t.designation||'Designation not available';
    return `<div class="fv-teacher-card">
      <div class="fv-teacher-name">${escHtml(t.name)}</div>
      <div class="fv-email-line"><div class="fv-teacher-email">${escHtml(t.email)}</div><button type="button" class="fv-copy-btn" data-email="${escHtml(t.email)}" aria-label="Copy email" title="Copy email" onclick="copyEmail(this.dataset.email,this)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H6C4.9 1 4 1.9 4 3v12h2V3h10V1zm3 4H10C8.9 5 8 5.9 8 7v14c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16h-9V7h9v14z"/></svg></button></div>
      <div class="fv-teacher-room">Room: ${escHtml(t.room || 'N/A')}</div>
      <div class="fv-teacher-tag">${escHtml(designation)}</div>
    </div>`;
  }).join('');
}

// Initialise faculty vault
document.getElementById('fv-dept').disabled = true;
renderFacultyVault();
refreshFacultySheetData();
if(_facultySheetTimer) clearInterval(_facultySheetTimer);
_facultySheetTimer=setInterval(()=>refreshFacultySheetData(true),FACULTY_SHEET_REFRESH_MS);

/* ── Background 3D grid ── */
(function bg(){
  const cv=document.getElementById('bg3d'),ctx=cv.getContext('2d');
  function resize(){cv.width=cv.offsetWidth;cv.height=Math.max(cv.offsetHeight,760)}
  resize();window.addEventListener('resize',resize);
  const pts=Array.from({length:28},()=>({x:Math.random(),y:Math.random(),vx:(Math.random()-.5)*.0005,vy:(Math.random()-.5)*.0005}));
  let t=0;
  function draw(){
    const W=cv.width,H=cv.height;
    const dark=document.documentElement.getAttribute('data-theme')==='dark';
    const bgFill=dark?'#0d1912':'#f0f7f0';
    const lineRGB=dark?'120,220,160':'0,140,70';
    ctx.fillStyle=bgFill;ctx.fillRect(0,0,W,H);
    const pers=260,fov=0.5,camz=t*.00022;
    for(let i=0;i<=10;i++){
      const x=i/10;
      for(let d=0;d<2;d++){
        const z0=camz+d,z1=camz+d+1;
        ctx.strokeStyle=`rgba(${lineRGB},${0.065*(1-Math.abs(x-.5)*1.4)})`;ctx.lineWidth=.7;
        ctx.beginPath();ctx.moveTo((x-.5)*pers/(z0*fov)+W/2,(0-.5)*pers/(z0*fov)+H/2);ctx.lineTo((x-.5)*pers/(z1*fov)+W/2,(0-.5)*pers/(z1*fov)+H/2);ctx.stroke();
        ctx.beginPath();ctx.moveTo((x-.5)*pers/(z0*fov)+W/2,(1-.5)*pers/(z0*fov)+H/2);ctx.lineTo((x-.5)*pers/(z1*fov)+W/2,(1-.5)*pers/(z1*fov)+H/2);ctx.stroke();
        for(let j=0;j<=10;j++){const y=j/10;ctx.strokeStyle=`rgba(${lineRGB},0.05)`;ctx.beginPath();ctx.moveTo((0-.5)*pers/(z0*fov)+W/2,(y-.5)*pers/(z0*fov)+H/2);ctx.lineTo((1-.5)*pers/(z0*fov)+W/2,(y-.5)*pers/(z0*fov)+H/2);ctx.stroke();}
      }
    }
    pts.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0||p.x>1)p.vx*=-1;if(p.y<0||p.y>1)p.vy*=-1;
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,1.4,0,Math.PI*2);ctx.fillStyle=`rgba(${lineRGB},0.15)`;ctx.fill();
    });
    pts.forEach((a,i)=>pts.slice(i+1).forEach(b=>{
      const dx=(a.x-b.x)*W,dy=(a.y-b.y)*H,dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<72){ctx.beginPath();ctx.moveTo(a.x*W,a.y*H);ctx.lineTo(b.x*W,b.y*H);ctx.strokeStyle=`rgba(${lineRGB},${0.07*(1-dist/72)})`;ctx.lineWidth=.5;ctx.stroke();}
    }));
    t++;requestAnimationFrame(draw);
  }
  draw();
})();

/* ══════════════════════════════════════════
   COMPILER RUN  — Chrome-dino-style endless runner
   Player = desktop 🖥️ · ground obstacle = virus 🦠 · flyer = "AI"
   Opens on double-click of the logo.
══════════════════════════════════════════ */
(function CompilerRun(){
  const overlay=document.getElementById('cr-overlay');
  const canvas=document.getElementById('cr-canvas');
  if(!overlay||!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const GROUND=H-26;              // y of ground line
  const HI_KEY='compiler_run_hi';

  const GREEN='#0a7a3a', GREEN2='#2d8a50', RED='#b3261e', BLUE='#1a4a8a';
  let hi=parseInt(localStorage.getItem(HI_KEY)||'0',10)||0;

  let player, obstacles, speed, score, spawnTimer, state, rafId, lastT;
  // state: 'ready' | 'run' | 'over' | 'paused'

  function reset(){
    player={x:60,w:26,h:28,duckH:14,y:GROUND-28,vy:0,ducking:false,onGround:true};
    obstacles=[];
    speed=3.6;                 // 40% slower than before
    score=0;
    spawnTimer=48;
    state='ready';
  }

  function jump(){
    if(state==='ready'){ state='run'; return; }
    if(state==='over'){ reset(); state='run'; return; }
    if(state!=='run') return;
    if(player.onGround){ player.vy=-12.4; player.onGround=false; }
  }
  function setDuck(on){ if(state==='run') player.ducking=on; }

  function spawn(){
    // ~30% AI flyers once there's some speed. Viruses sit on the ground
    // (jump over); AI flies high (duck under).
    const flyer = speed>4.3 && Math.random()<0.3;
    if(flyer){
      const h=26, w=40;
      obstacles.push({type:'ai', x:W+10, y:GROUND-42, w, h});   // hits a standing PC, clears a ducking one
    } else {
      const big = Math.random()<0.35;
      const s = big?32:24;
      obstacles.push({type:'virus', x:W+10, y:GROUND-s, w:s, h:s});
    }
  }

  function hit(a,b){
    // shrink boxes a touch for fair collisions
    const pad=4;
    return a.x+pad < b.x+b.w-pad && a.x+a.w-pad > b.x+pad &&
           a.y+pad < b.y+b.h-pad && a.y+a.h-pad > b.y+pad;
  }

  function update(){
    if(state!=='run') return;
    // player physics
    player.vy += 0.72;                       // gravity
    player.y += player.vy;
    if(player.y >= GROUND-player.h){ player.y=GROUND-player.h; player.vy=0; player.onGround=true; }
    // Hitbox follows the player: ducking only shrinks it while grounded; while
    // airborne it must sit at the actual jump height (player.y), not the ground -
    // otherwise jumping "over" a virus still collides.
    let curH, curTop;
    if(player.ducking && player.onGround){ curH=player.duckH; curTop=GROUND-curH; }
    else { curH=player.h; curTop=player.y; }
    const pbox={x:player.x, y:curTop, w:player.w, h:curH};

    // obstacles
    for(const o of obstacles) o.x -= speed;
    obstacles = obstacles.filter(o=>o.x + o.w > -4);
    if(--spawnTimer<=0){
      spawn();
      const base = Math.max(46, 92 - speed*3);
      spawnTimer = base + Math.random()*44;
    }

    // collisions
    for(const o of obstacles){ if(hit(pbox,o)){ gameOver(); break; } }

    // score + difficulty (scaled 40% slower)
    score += 1;
    if(score % 8 === 0 && speed < 9) speed += 0.027;
  }

  function gameOver(){
    state='over';
    const finalScore=Math.floor(score/6);
    hi=Math.max(hi, finalScore);
    localStorage.setItem(HI_KEY, String(hi));
    submitScoreToLeaderboard(finalScore);
  }

  // ── shared leaderboard (server-backed) ──
  let LB_STATUS='';

  function renderLeaderboard(entries){
    const body=document.getElementById('cr-lb-body');
    const status=document.getElementById('cr-lb-status');
    if(!body) return;
    if(status) status.textContent=LB_STATUS;
    const profile=(typeof getProfileCookie==='function') ? getProfileCookie() : null;
    const myNuid=profile && profile.nuid ? String(profile.nuid).toUpperCase() : null;
    // No saved profile -> scores are hidden behind a red "make your profile" prompt.
    if(!myNuid){
      body.innerHTML='<tr><td colspan="4" class="cr-lb-cta" onclick="closeCompilerRun();openProfileModal()">Create your profile to join the leaderboard &mdash; tap here</td></tr>';
      return;
    }
    if(!entries || entries.length===0){
      body.innerHTML='<tr><td colspan="4" class="cr-lb-empty">No scores yet &mdash; be the first!</td></tr>';
      return;
    }
    body.innerHTML=entries.map((row,i)=>{
      const isMe=myNuid && row.nuid && String(row.nuid).toUpperCase()===myNuid;
      const name=escapeHtml(row.name||'Unknown');
      const section=escapeHtml(row.section||'-');
      return `<tr class="${isMe?'cr-lb-row-me':''}"><td class="cr-rank">${i+1}</td><td>${name}</td><td>${section}</td><td class="cr-score">${row.highScore}</td></tr>`;
    }).join('');
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  let LB_LOADED_ONCE=false;
  async function loadLeaderboard(){
    if(!LB_LOADED_ONCE){ LB_STATUS='Loading...'; renderLeaderboard(null); }
    try{
      const entries=await fetchLeaderboard('compiler_run');
      LB_STATUS='';
      LB_LOADED_ONCE=true;
      renderLeaderboard(entries);
    }catch(err){
      LB_STATUS='Could not load leaderboard.';
      renderLeaderboard([]);
    }
  }

  async function submitScoreToLeaderboard(finalScore){
    const profile=(typeof getProfileCookie==='function') ? getProfileCookie() : null;
    if(!profile || !profile.nuid){
      // No synced profile — nothing to submit under, just refresh local view.
      return;
    }
    try{
      const res=await fetch('/api/leaderboard',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          nuid:profile.nuid,
          name:profile.name,
          section:profile.section,
          department:profile.department,
          batch:profile.batch,
          score:finalScore
        })
      });
      if(!res.ok) throw new Error('bad status');
      const data=await res.json();
      LB_STATUS='';
      renderLeaderboard(data.leaderboard||[]);
    }catch(err){
      LB_STATUS='Could not submit score.';
      renderLeaderboard(null);
    }
  }

  // ── drawing ──
  function emoji(ch,x,y,size){ ctx.font=size+'px "Segoe UI Emoji","Noto Color Emoji",serif'; ctx.textBaseline='alphabetic'; ctx.fillText(ch,x,y); }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // sky grid backdrop
    ctx.strokeStyle='rgba(10,122,58,0.06)'; ctx.lineWidth=1;
    for(let x=(-(score*speed*0)%40); x<W; x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,GROUND); ctx.stroke(); }

    // ground
    ctx.strokeStyle=GREEN; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,GROUND+1); ctx.lineTo(W,GROUND+1); ctx.stroke();
    ctx.setLineDash([4,10]); ctx.strokeStyle='rgba(10,122,58,0.4)';
    const off=(score*speed)%14;
    ctx.beginPath(); ctx.moveTo(-off,GROUND+8); ctx.lineTo(W,GROUND+8); ctx.stroke(); ctx.setLineDash([]);

    // player (desktop) - shrinks when ducking so the AI passes overhead
    const ph = player.ducking && player.onGround ? player.duckH : player.h;
    const baseY = (player.onGround ? GROUND : player.y+player.h) + 6;
    emoji('🖥️', player.x, baseY, ph+8);

    // obstacles
    for(const o of obstacles){
      if(o.type==='virus'){
        emoji('🦠', o.x, o.y+o.h, o.h+6);
      } else {
        // "AI" flyer chip
        ctx.fillStyle=BLUE; roundRect(o.x,o.y,o.w,o.h,6); ctx.fill();
        ctx.fillStyle='#fff'; ctx.font='bold 18px "VT323",monospace'; ctx.textBaseline='middle'; ctx.textAlign='center';
        ctx.fillText('AI', o.x+o.w/2, o.y+o.h/2+1);
        ctx.textAlign='left';
      }
    }

    // score
    ctx.fillStyle=GREEN2; ctx.font='20px "VT323",monospace'; ctx.textBaseline='alphabetic'; ctx.textAlign='right';
    ctx.fillText('HI '+String(hi).padStart(5,'0')+'   '+String(Math.floor(score/6)).padStart(5,'0'), W-12, 26);
    ctx.textAlign='left';

    if(state==='ready') centerText('PRESS SPACE TO RUN', GREEN);
    if(state==='over'){
      centerText('SYSTEM CRASH! PRESS SPACE TO RETRY', RED, -14);
      ctx.fillStyle=GREEN; ctx.font='18px "VT323",monospace'; ctx.textAlign='center';
      ctx.fillText('SCORE '+Math.floor(score/6)+'   ·   BEST '+hi, W/2, H/2+16); ctx.textAlign='left';
    }
  }
  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function centerText(t,color,dy){ ctx.fillStyle=color; ctx.font='22px "VT323",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t, W/2, H/2+(dy||0)); ctx.textAlign='left'; ctx.textBaseline='alphabetic'; }

  function loop(t){
    if(!overlay.classList.contains('on')) return;      // stopped
    update();
    draw();
    rafId=requestAnimationFrame(loop);
  }

  // ── controls: SPACE/Up jump over viruses · Down ducks under the AI ──
  function onKey(e){
    if(!overlay.classList.contains('on')) return;
    if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); jump(); }
    else if(e.code==='ArrowDown'){ e.preventDefault(); setDuck(true); }
    else if(e.key==='Escape'){ closeCompilerRun(); }
  }
  function onKeyUp(e){ if(e.code==='ArrowDown') setDuck(false); }
  document.addEventListener('keydown',onKey);
  document.addEventListener('keyup',onKeyUp);
  canvas.addEventListener('pointerdown',e=>{ e.preventDefault(); jump(); });

  // Keep the board live while the game is open: refresh every 15s so new top
  // scores from other players appear without reopening.
  let lbPollId=null;
  window.openCompilerRun=function(){
    reset();
    overlay.classList.add('on');
    cancelAnimationFrame(rafId);
    rafId=requestAnimationFrame(loop);
    loadLeaderboard();
    clearInterval(lbPollId);
    lbPollId=setInterval(loadLeaderboard,15000);
  };
  window.closeCompilerRun=function(){
    overlay.classList.remove('on');
    cancelAnimationFrame(rafId);
    clearInterval(lbPollId);
    lbPollId=null;
  };

  overlay.addEventListener('pointerdown',e=>{ if(e.target===overlay) closeCompilerRun(); });
})();

// ── Game picker: double-click the logo -> choose a game ──
(function GamePicker(){
  const picker=document.getElementById('game-picker');
  const soonMsg=()=>document.getElementById('game-soon-msg');
  window.openGamePicker=function(){ if(picker) picker.classList.add('on'); const m=soonMsg(); if(m) m.hidden=true; };
  window.closeGamePicker=function(){ if(picker) picker.classList.remove('on'); };
  window.showComingSoon=function(){ const m=soonMsg(); if(m) m.hidden=false; };
  picker&&picker.addEventListener('pointerdown',e=>{ if(e.target===picker) window.closeGamePicker(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&picker&&picker.classList.contains('on')) window.closeGamePicker(); });
  const logo=document.getElementById('header-logo');
  if(logo){
    logo.addEventListener('dblclick', ()=>window.openGamePicker());
    // Touch screens don't fire a reliable dblclick — detect a manual double-tap.
    let lastTap=0;
    logo.addEventListener('pointerup', e=>{
      const now=Date.now();
      if(now-lastTap>0 && now-lastTap<450){ e.preventDefault(); window.openGamePicker(); lastTap=0; }
      else lastTap=now;
    });
    logo.style.touchAction='manipulation'; // avoid the browser's tap-to-zoom delay
  }
})();

// ── Compiler Chess: mode picker (1v1 / friend / engine) ──
(function ChessModePicker(){
  const picker=document.getElementById('chess-mode-picker');
  const msg=()=>document.getElementById('chess-soon-msg');
  window.openChessModePicker=function(){ if(picker) picker.classList.add('on'); const m=msg(); if(m) m.hidden=true; };
  window.closeChessModePicker=function(){ if(picker) picker.classList.remove('on'); };
  window.showChessComingSoon=function(modeLabel){
    const m=msg(); if(!m) return;
    m.innerHTML='&#128679; '+modeLabel+' &mdash; stay tuned, coming soon!';
    m.hidden=false;
  };
  picker&&picker.addEventListener('pointerdown',e=>{ if(e.target===picker) window.closeChessModePicker(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&picker&&picker.classList.contains('on')) window.closeChessModePicker(); });
})();

// ══════════════════════════════════════════
//   DUCK HUNTER — click the ducks before they escape
// ══════════════════════════════════════════
(function DuckHunter(){
  const overlay=document.getElementById('dh-overlay');
  const canvas=document.getElementById('dh-canvas');
  if(!overlay||!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const HI_KEY='duck_hunter_hi';
  const GREEN='#0a7a3a', GREEN2='#2d8a50', RED='#b3261e';
  let hi=parseInt(localStorage.getItem(HI_KEY)||'0',10)||0;
  let ducks, score, lives, state, rafId, spawnTimer;
  // state: 'ready' | 'run' | 'over'

  function reset(){ ducks=[]; score=0; lives=3; spawnTimer=70; state='ready'; }

  function spawn(){
    const fromLeft=Math.random()<0.5;
    const y=20+Math.random()*(H-120);
    const spd=1.7+Math.random()*1.5+score*0.03;
    ducks.push({ x:fromLeft?-56:W+56, y, vx:spd*(fromLeft?1:-1), vy:(Math.random()-0.5)*1.4, w:54, h:44, alive:true, flash:0 });
  }

  function update(){
    if(state!=='run') return;
    // Start slow with only 3-4 ducks on screen, ramp up as the score climbs.
    const aliveCount=ducks.reduce((n,d)=>n+(d.alive?1:0),0);
    const cap=Math.min(7, 3+Math.floor(score/6));
    if(--spawnTimer<=0){
      if(aliveCount<cap) spawn();
      spawnTimer=Math.max(28, 105-score*1.4);
    }
    for(const d of ducks){ d.x+=d.vx; d.y+=d.vy; if(d.y<18||d.y>H-42) d.vy*=-1; if(d.flash>0) d.flash--; }
    ducks=ducks.filter(d=>{
      if(!d.alive) return d.flash>0;                 // keep a moment for the hit splash
      const escaped=(d.vx>0&&d.x>W+30)||(d.vx<0&&d.x<-30);
      if(escaped){ lives--; if(lives<=0) gameOver(); return false; }
      return true;
    });
  }

  function shoot(mx,my){
    if(state==='ready'){ state='run'; return; }
    if(state==='over'){ reset(); state='run'; return; }
    if(state!=='run') return;
    for(let i=ducks.length-1;i>=0;i--){
      const d=ducks[i];
      if(d.alive && mx>=d.x-4 && mx<=d.x+d.w+4 && my>=d.y-4 && my<=d.y+d.h+4){
        d.alive=false; d.flash=10; score++; hi=Math.max(hi,score); return;
      }
    }
  }

  function gameOver(){ state='over'; localStorage.setItem(HI_KEY,String(hi)); submitScore(score); }

  // ── leaderboard (its own JSON via ?game=duck_hunter) ──
  let LB_STATUS='', LB_LOADED_ONCE=false, lbPollId=null;
  function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderLB(entries){
    const body=document.getElementById('dh-lb-body'); const status=document.getElementById('dh-lb-status');
    if(!body) return; if(status) status.textContent=LB_STATUS;
    const profile=(typeof getProfileCookie==='function')?getProfileCookie():null;
    const myNuid=profile&&profile.nuid?String(profile.nuid).toUpperCase():null;
    if(!myNuid){ body.innerHTML='<tr><td colspan="4" class="cr-lb-cta" onclick="closeDuckHunter();openProfileModal()">Create your profile to join the leaderboard &mdash; tap here</td></tr>'; return; }
    if(!entries||entries.length===0){ body.innerHTML='<tr><td colspan="4" class="cr-lb-empty">No scores yet &mdash; be the first!</td></tr>'; return; }
    body.innerHTML=entries.map((row,i)=>{
      const isMe=myNuid&&row.nuid&&String(row.nuid).toUpperCase()===myNuid;
      return `<tr class="${isMe?'cr-lb-row-me':''}"><td class="cr-rank">${i+1}</td><td>${esc(row.name||'Unknown')}</td><td>${esc(row.section||'-')}</td><td class="cr-score">${row.highScore}</td></tr>`;
    }).join('');
  }
  async function loadLB(){
    if(!LB_LOADED_ONCE){ LB_STATUS='Loading...'; renderLB(null); }
    try{
      const entries=await fetchLeaderboard('duck_hunter');
      LB_STATUS=''; LB_LOADED_ONCE=true; renderLB(entries);
    }catch(err){ LB_STATUS='Could not load leaderboard.'; renderLB([]); }
  }
  async function submitScore(finalScore){
    const profile=(typeof getProfileCookie==='function')?getProfileCookie():null;
    if(!profile||!profile.nuid) return;
    try{
      const res=await fetch('/api/leaderboard',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ game:'duck_hunter', nuid:profile.nuid, name:profile.name, section:profile.section, department:profile.department, batch:profile.batch, score:finalScore }) });
      if(!res.ok) throw new Error('bad status');
      const data=await res.json(); LB_STATUS=''; renderLB(data.leaderboard||[]);
    }catch(err){ LB_STATUS='Could not submit score.'; }
  }

  // ── drawing ──
  // A bold, high-contrast duck drawn with shapes (emoji renders too faint on
  // some devices). Facing right by default; flipped for left-moving ducks.
  function drawDuck(d){
    const dir=d.vx<0?-1:1;
    ctx.save();
    ctx.translate(d.x+d.w/2, d.y+d.h/2);
    ctx.scale(dir,1);
    const bw=d.w, bh=d.h;
    ctx.lineWidth=2.5; ctx.strokeStyle='#5a3610';
    // body
    ctx.fillStyle='#f0a93a';
    ctx.beginPath(); ctx.ellipse(-bw*0.06, bh*0.10, bw*0.42, bh*0.30, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // tail
    ctx.beginPath(); ctx.moveTo(-bw*0.42, bh*0.02); ctx.lineTo(-bw*0.56,-bh*0.14); ctx.lineTo(-bw*0.40,-bh*0.10); ctx.closePath(); ctx.fill(); ctx.stroke();
    // wing
    ctx.fillStyle='#d98a26';
    ctx.beginPath(); ctx.ellipse(-bw*0.10, bh*0.04, bw*0.24, bh*0.16, -0.25, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // head (mallard green for contrast)
    ctx.fillStyle='#1e7d34';
    ctx.beginPath(); ctx.arc(bw*0.30, -bh*0.24, bh*0.26, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // beak
    ctx.fillStyle='#f4a200';
    ctx.beginPath(); ctx.moveTo(bw*0.48,-bh*0.28); ctx.lineTo(bw*0.72,-bh*0.20); ctx.lineTo(bw*0.48,-bh*0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    // eye
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(bw*0.34,-bh*0.30, 3.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(bw*0.35,-bh*0.30, 1.7, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawHit(d){
    const cx=d.x+d.w/2, cy=d.y+d.h/2;
    ctx.fillStyle='#e23b2e'; ctx.beginPath(); ctx.arc(cx,cy, d.h*0.4, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(cx-8,cy-8); ctx.lineTo(cx+8,cy+8); ctx.moveTo(cx+8,cy-8); ctx.lineTo(cx-8,cy+8); ctx.stroke();
  }
  function draw(){
    ctx.clearRect(0,0,W,H);
    // sky
    ctx.fillStyle='rgba(10,122,58,0.05)'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle=GREEN; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,H-14); ctx.lineTo(W,H-14); ctx.stroke();
    for(const d of ducks){
      if(d.alive) drawDuck(d);
      else if(d.flash>0) drawHit(d);
    }
    // HUD
    ctx.fillStyle=GREEN2; ctx.font='20px "VT323",monospace'; ctx.textBaseline='alphabetic'; ctx.textAlign='right';
    ctx.fillText('HI '+String(hi).padStart(4,'0')+'   '+String(score).padStart(4,'0'), W-12, 24); ctx.textAlign='left';
    ctx.fillText('LIVES '+'❤'.repeat(Math.max(0,lives)), 12, 24);
    if(state==='ready') centerText('CLICK / TAP TO START', GREEN);
    if(state==='over'){
      centerText('OUT OF LIVES! CLICK TO RETRY', RED, -14);
      ctx.fillStyle=GREEN; ctx.font='18px "VT323",monospace'; ctx.textAlign='center';
      ctx.fillText('DUCKS '+score+'   ·   BEST '+hi, W/2, H/2+16); ctx.textAlign='left';
    }
  }
  function centerText(t,color,dy){ ctx.fillStyle=color; ctx.font='22px "VT323",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t,W/2,H/2+(dy||0)); ctx.textAlign='left'; ctx.textBaseline='alphabetic'; }

  function loop(){ if(!overlay.classList.contains('on')) return; update(); draw(); rafId=requestAnimationFrame(loop); }

  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    shoot((e.clientX-r.left)*(W/r.width), (e.clientY-r.top)*(H/r.height));
  });
  document.addEventListener('keydown',e=>{ if(overlay.classList.contains('on')&&e.key==='Escape') window.closeDuckHunter(); });
  overlay.addEventListener('pointerdown',e=>{ if(e.target===overlay) window.closeDuckHunter(); });

  window.openDuckHunter=function(){
    reset(); overlay.classList.add('on');
    cancelAnimationFrame(rafId); rafId=requestAnimationFrame(loop);
    LB_LOADED_ONCE=false; loadLB(); clearInterval(lbPollId); lbPollId=setInterval(loadLB,15000);
  };
  window.closeDuckHunter=function(){ overlay.classList.remove('on'); cancelAnimationFrame(rafId); clearInterval(lbPollId); lbPollId=null; };
})();

// ══════════════════════════════════════════
//   FLAPPY BYTE — tap to fly through the pipes
// ══════════════════════════════════════════
(function FlappyByte(){
  const overlay=document.getElementById('fb-overlay');
  const canvas=document.getElementById('fb-canvas');
  if(!overlay||!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  const HI_KEY='flappy_byte_hi';
  const GREEN='#0a7a3a', GREEN2='#2d8a50', RED='#b3261e';
  let hi=parseInt(localStorage.getItem(HI_KEY)||'0',10)||0;
  const GAP=78, PIPE_W=46, GROUND=H-16;
  let bird, pipes, score, state, rafId, spawnTimer;
  // state: 'ready' | 'run' | 'over'

  function reset(){ bird={x:120,y:H/2,vy:0,r:12}; pipes=[]; score=0; spawnTimer=0; state='ready'; }
  function flap(){
    if(state==='ready'){ state='run'; bird.vy=-4.6; return; }
    if(state==='over'){ reset(); state='run'; bird.vy=-4.6; return; }
    if(state==='run') bird.vy=-4.6;
  }
  function spawnPipe(){
    const margin=34;
    const gapY=margin+GAP/2+Math.random()*(GROUND-GAP-margin*2);
    pipes.push({ x:W+10, gapY, passed:false });
  }
  function update(){
    if(state!=='run') return;
    bird.vy+=0.32; bird.y+=bird.vy;
    if(--spawnTimer<=0){ spawnPipe(); spawnTimer=110; }
    for(const p of pipes) p.x-=2.4;
    pipes=pipes.filter(p=>p.x+PIPE_W>-4);
    // score + collision
    for(const p of pipes){
      if(!p.passed && p.x+PIPE_W<bird.x){ p.passed=true; score++; hi=Math.max(hi,score); }
      const inX=bird.x+bird.r>p.x && bird.x-bird.r<p.x+PIPE_W;
      const inGap=bird.y-bird.r>p.gapY-GAP/2 && bird.y+bird.r<p.gapY+GAP/2;
      if(inX && !inGap){ gameOver(); return; }
    }
    if(bird.y+bird.r>=GROUND || bird.y-bird.r<=0){ gameOver(); }
  }
  function gameOver(){ if(state==='over')return; state='over'; if(bird.y+bird.r>GROUND) bird.y=GROUND-bird.r; localStorage.setItem(HI_KEY,String(hi)); submitScore(score); }

  // ── leaderboard (its own JSON via ?game=flappy_bird) ──
  let LB_STATUS='', LB_LOADED_ONCE=false, lbPollId=null;
  function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderLB(entries){
    const body=document.getElementById('fb-lb-body'); const status=document.getElementById('fb-lb-status');
    if(!body) return; if(status) status.textContent=LB_STATUS;
    const profile=(typeof getProfileCookie==='function')?getProfileCookie():null;
    const myNuid=profile&&profile.nuid?String(profile.nuid).toUpperCase():null;
    if(!myNuid){ body.innerHTML='<tr><td colspan="4" class="cr-lb-cta" onclick="closeFlappy();openProfileModal()">Create your profile to join the leaderboard &mdash; tap here</td></tr>'; return; }
    if(!entries||entries.length===0){ body.innerHTML='<tr><td colspan="4" class="cr-lb-empty">No scores yet &mdash; be the first!</td></tr>'; return; }
    body.innerHTML=entries.map((row,i)=>{
      const isMe=myNuid&&row.nuid&&String(row.nuid).toUpperCase()===myNuid;
      return `<tr class="${isMe?'cr-lb-row-me':''}"><td class="cr-rank">${i+1}</td><td>${esc(row.name||'Unknown')}</td><td>${esc(row.section||'-')}</td><td class="cr-score">${row.highScore}</td></tr>`;
    }).join('');
  }
  async function loadLB(){
    if(!LB_LOADED_ONCE){ LB_STATUS='Loading...'; renderLB(null); }
    try{
      const entries=await fetchLeaderboard('flappy_bird');
      LB_STATUS=''; LB_LOADED_ONCE=true; renderLB(entries);
    }catch(err){ LB_STATUS='Could not load leaderboard.'; renderLB([]); }
  }
  async function submitScore(finalScore){
    const profile=(typeof getProfileCookie==='function')?getProfileCookie():null;
    if(!profile||!profile.nuid) return;
    try{
      const res=await fetch('/api/leaderboard',{ method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ game:'flappy_bird', nuid:profile.nuid, name:profile.name, section:profile.section, department:profile.department, batch:profile.batch, score:finalScore }) });
      if(!res.ok) throw new Error('bad status');
      const data=await res.json(); LB_STATUS=''; renderLB(data.leaderboard||[]);
    }catch(err){ LB_STATUS='Could not submit score.'; }
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='rgba(10,122,58,0.05)'; ctx.fillRect(0,0,W,H);
    // pipes
    for(const p of pipes){
      ctx.fillStyle='#1e7d34'; ctx.strokeStyle='#0a4a20'; ctx.lineWidth=2;
      ctx.fillRect(p.x,0,PIPE_W,p.gapY-GAP/2); ctx.strokeRect(p.x,0,PIPE_W,p.gapY-GAP/2);
      ctx.fillRect(p.x,p.gapY+GAP/2,PIPE_W,GROUND-(p.gapY+GAP/2)); ctx.strokeRect(p.x,p.gapY+GAP/2,PIPE_W,GROUND-(p.gapY+GAP/2));
    }
    // ground
    ctx.strokeStyle=GREEN; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,GROUND); ctx.lineTo(W,GROUND); ctx.stroke();
    // bird
    ctx.save(); ctx.translate(bird.x,bird.y); ctx.rotate(Math.max(-0.5,Math.min(0.9,bird.vy*0.08)));
    ctx.fillStyle='#f4c20a'; ctx.strokeStyle='#7a5a00'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,bird.r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#f4a200'; ctx.beginPath(); ctx.moveTo(bird.r-2,-2); ctx.lineTo(bird.r+7,1); ctx.lineTo(bird.r-2,4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(4,-4,3.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(5,-4,1.8,0,Math.PI*2); ctx.fill();
    ctx.restore();
    // score
    ctx.fillStyle=GREEN2; ctx.font='20px "VT323",monospace'; ctx.textBaseline='alphabetic'; ctx.textAlign='right';
    ctx.fillText('HI '+String(hi).padStart(4,'0')+'   '+String(score).padStart(4,'0'), W-12, 24); ctx.textAlign='left';
    if(state==='ready') centerText('TAP / SPACE TO FLY', GREEN);
    if(state==='over'){
      centerText('CRASHED! TAP TO RETRY', RED, -14);
      ctx.fillStyle=GREEN; ctx.font='18px "VT323",monospace'; ctx.textAlign='center';
      ctx.fillText('SCORE '+score+'   ·   BEST '+hi, W/2, H/2+16); ctx.textAlign='left';
    }
  }
  function centerText(t,color,dy){ ctx.fillStyle=color; ctx.font='22px "VT323",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t,W/2,H/2+(dy||0)); ctx.textAlign='left'; ctx.textBaseline='alphabetic'; }
  function loop(){ if(!overlay.classList.contains('on')) return; update(); draw(); rafId=requestAnimationFrame(loop); }

  canvas.addEventListener('pointerdown',e=>{ e.preventDefault(); flap(); });
  document.addEventListener('keydown',e=>{
    if(!overlay.classList.contains('on')) return;
    if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); flap(); }
    else if(e.key==='Escape'){ window.closeFlappy(); }
  });
  overlay.addEventListener('pointerdown',e=>{ if(e.target===overlay) window.closeFlappy(); });

  window.openFlappy=function(){
    reset(); overlay.classList.add('on');
    cancelAnimationFrame(rafId); rafId=requestAnimationFrame(loop);
    LB_LOADED_ONCE=false; loadLB(); clearInterval(lbPollId); lbPollId=setInterval(loadLB,15000);
  };
  window.closeFlappy=function(){ overlay.classList.remove('on'); cancelAnimationFrame(rafId); clearInterval(lbPollId); lbPollId=null; };
})();
