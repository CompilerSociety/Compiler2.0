/* ══════════════════════════════════════════════════════════════════════
   THE APP (phone and desktop)
   A second view over the SAME data layer as the desktop app. Loaded as a
   classic script immediately after js/app.js, so it shares that file's
   global scope and reads its live bindings (TT, ROOM_TT, FACULTY_DATA, the
   profile helpers, the slot/occupancy helpers) rather than re-fetching or
   re-deriving anything.

   It never mutates desktop state. The one exception is the school selector:
   Lookup has to be able to switch schools, and the only loader is the one
   the desktop select drives, so that path sets #school and calls the
   existing refresh — the same thing a desktop click does.

   It was phone-only; it is now the UI at every width. css/desktop.css lays
   the same screens out for wide windows, and the one behavioural split is
   login: phones open on the sign-in screen until the student logs in or
   picks "Continue as guest", while desktop opens straight into the app as a
   guest and offers "Log in" from the header and sidebar. Either way, the
   features that need a profile (your own Today/Week, My courses, friends,
   notifications, profile) stay locked until there is one.
   ══════════════════════════════════════════════════════════════════════ */
(function MobileApp(){
  'use strict';

  // PHONE gates the few things that only make sense under a finger;
  // DESK picks the desktop layout's behaviour (no forced sign-in).
  const PHONE=window.matchMedia('(max-width:767px)');
  const DESK=window.matchMedia('(min-width:768px)');
  const MOBILE_THEME_KEY='vtable_mobile_theme';
  let coursesExpanded=false;
  function setMobileTheme(dark){
    document.documentElement.setAttribute('data-mobile-theme',dark?'dark':'light');
    try{ localStorage.setItem(MOBILE_THEME_KEY,dark?'dark':'light'); }catch(e){}
    syncMobileThemeChrome();
  }
  function syncMobileThemeChrome(){
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content=document.documentElement.dataset.mobileTheme==='dark'?'#141414':'#ffffff';
    const side=$('m-side-dark');
    if(side) side.checked=document.documentElement.dataset.mobileTheme==='dark';
  }
  const SKIP_KEY='vtable_skipped_login';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const TAB_ROUTES=['today','lookup','rooms','faculty','exams'];
  const TITLES={today:'Today',lookup:'Lookup',rooms:'Free rooms',faculty:'Faculty',
                facdetail:'Faculty',exams:'Exams',profile:'Profile'};

  // Starts on the splash and stays there until start() has read the stored
  // profile and worked out where to land, so no screen is shown speculatively.
  let route='splash';
  let toastTimer=null;
  const DARK_MODE_TIP_KEY='vtable_dark_mode_tip_seen';
  function showDarkModeTipOnce(){
    const tip=$('m-dark-mode-tip');
    if(!tip||!PHONE.matches||!profile()) return;
    try{
      if(localStorage.getItem(DARK_MODE_TIP_KEY)) return;
      // Record before displaying. If storage is blocked, skip the tip so it
      // cannot nag the user on every launch.
      localStorage.setItem(DARK_MODE_TIP_KEY,'1');
    }catch(e){return;}
    tip.hidden=false;
    const timer=setTimeout(()=>{tip.hidden=true;},8000);
    $('m-dark-mode-tip-close').onclick=()=>{tip.hidden=true;clearTimeout(timer);};
  }

  /* ── Small helpers ─────────────────────────────────────────────────── */
  function toast(msg){
    const el=$('m-toast'); if(!el) return;
    closeSelfFriendQuote();
    el.classList.remove('m-friend-quote');
    el.textContent=msg; el.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{ el.hidden=true; },2300);
  }
  function initials(name){
    const parts=String(name||'').trim().split(/\s+/).filter(w=>/[A-Za-z]/.test(w));
    if(!parts.length) return '—';
    const first=parts[0][0];
    const last=parts.length>1?parts[parts.length-1][0]:'';
    return (first+last).toUpperCase();
  }
  function profile(){ return (typeof getProfileCookie==='function')?getProfileCookie():null; }
  function skipped(){ try{ return localStorage.getItem(SKIP_KEY)==='1'; }catch(e){ return false; } }
  function setSkipped(v){ try{ v?localStorage.setItem(SKIP_KEY,'1'):localStorage.removeItem(SKIP_KEY); }catch(e){} }
  // On desktop the sign-in screen is a page you visit, not a gate, so it gets
  // a history entry and Back returns to wherever the student was.
  function openSignin(){
    if(typeof resetSigninCode==='function') resetSigninCode();
    if(DESK.matches) go('signin');
    else { route='signin'; render(); }
  }
  // The real calendar day, for the header. Deliberately not todayName(), which
  // folds Sunday onto Monday so the class list has something to show.
  function headerDate(){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',
      weekday:'long',day:'numeric',month:'long',year:'numeric'}).formatToParts(new Date());
    const get=t=>(parts.find(x=>x.type===t)||{}).value||'';
    return `${get('weekday')} · ${get('day')} ${get('month')} ${get('year')}`.toUpperCase();
  }
  function todayName(){
    return new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',weekday:'long'}).format(new Date());
  }
  // Start/end of a "08:30-09:50" slot in minutes, using the app's own
  // 12-hour-ambiguity rule (timeToNumber) so "01:00" reads as 1 PM.
  function slotBounds(time){
    const parts=String(time||'').split('-');
    if(parts.length!==2) return null;
    try{
      const start=timeToNumber(parts[0].trim());
      const end=timeToNumber(parts[1].trim());
      return [start,end<start?end+720:end];
    }catch(e){ return null; }
  }
  // The sheet writes afternoon slots 12-hour and unlabelled ("01:00" is 1 PM),
  // so a raw slot string is ambiguous. Resolve it to real minutes first, then
  // render as 12-hour AM/PM — the same format the desktop uses (fmtTime), and
  // the only one students actually read a timetable in.
  // slotToMinutes, not timeToNumber: only the former consults SLOT_MINUTE_MAP,
  // which is where the day's real boundaries live. timeToNumber's generic rule
  // (8-11 => AM) turned the last slot's 08:05 end into 08:05 instead of 20:05.
  function toAmPm(hhmm){
    try{
      const m=slotToMinutes(String(hhmm).trim());
      if(!Number.isFinite(m)) return String(hhmm||'');
      const h=Math.floor(m/60),mins=m%60;
      const hour=h%12===0?12:h%12;
      return `${hour}:${String(mins).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    }catch(e){ return String(hhmm||''); }
  }
  // Seconds since midnight in Islamabad. nowMinutes() is minute-resolution,
  // which would leave a live countdown looking frozen for up to 60s.
  const _secFmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  function nowSeconds(){
    const p=_secFmt.formatToParts(new Date());
    const get=t=>parseInt((p.find(x=>x.type===t)||{}).value,10)||0;
    return (get('hour')%24)*3600+get('minute')*60+get('second');
  }
  // "2d 4h" / "1h 23m" / "23m 10s" / "10s" — coarse while far out, precise
  // near the edge, so an overnight wait is not a twitching seconds counter.
  function countdown(secs){
    if(secs<0) secs=0;
    const d=Math.floor(secs/86400),h=Math.floor((secs%86400)/3600),
          m=Math.floor((secs%3600)/60),s=secs%60;
    if(d>0) return `${d}d ${h}h`;
    if(h>0) return `${h}h ${m}m`;
    if(m>0) return `${m}m ${String(s).padStart(2,'0')}s`;
    return `${s}s`;
  }
  // Weekday name N calendar days from now, in Islamabad.
  const _dayFmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',weekday:'long'});
  function weekdayIn(offsetDays){
    return _dayFmt.format(new Date(Date.now()+offsetDays*86400000));
  }
  function sortByTime(list){
    return [...list].sort((a,b)=>{
      const A=slotBounds(a.time||a.t||''),B=slotBounds(b.time||b.t||'');
      return (A?A[0]:1e9)-(B?B[0]:1e9);
    });
  }
  function noteOf(name){
    return (typeof extractNote==='function')?extractNote(name):'';
  }
  function cleanName(name){
    return (typeof stripNote==='function')?stripNote(name):String(name||'');
  }

  /* ── Routing ───────────────────────────────────────────────────────── */
  // Mobile routes carry a leading slash ("#/today"). The desktop router in
  // app.js matches bare slugs ("#timetable"), so the two never collide and
  // desktop deep links keep working untouched.
  function go(next,replace){
    route=next;
    const hash='#/'+next;
    if(location.hash!==hash){
      if(replace) history.replaceState(null,'',hash); else history.pushState(null,'',hash);
    }
    render();
  }
  function readHash(){
    const m=String(location.hash||'').match(/^#\/([a-z]+)/);
    return m?m[1]:null;
  }

  function render(){
    const booting=route==='splash';
    $('m-splash').classList.toggle('on',booting);
    if(booting){
      ['m-signin','m-onboard','m-manual','m-register','m-main'].forEach(id=>$(id).classList.remove('on'));
      return;
    }
    const signedIn=Boolean(profile());
    const onboarding=route==='onboard';
    const manual=route==='manual';
    const registering=route==='register';
    // Desktop never forces the sign-in screen: a logged-out visitor is a
    // guest until they choose to log in.
    const signin=route==='signin'||(!signedIn&&!skipped()&&!DESK.matches&&!onboarding&&!manual&&!registering);
    $('m-app').classList.toggle('is-guest',!signedIn);

    $('m-signin').classList.toggle('on',signin);
    $('m-onboard').classList.toggle('on',onboarding);
    $('m-manual').classList.toggle('on',manual);
    $('m-register').classList.toggle('on',registering);
    $('m-main').classList.toggle('on',!signin&&!onboarding&&!manual&&!registering);
    const inner=['today','lookup','rooms','faculty','facdetail','exams','profile'];
    if(signin||onboarding||manual||registering){
      if(manual) renderManual();
      if(registering) renderRegister();
      inner.forEach(id=>$('m-'+id).classList.remove('on'));
      return;
    }
    // A route the main app does not know (a stale #/signin after logging in,
    // say) lands on Today rather than a blank body.
    if(!inner.includes(route)) route='today';
    inner.forEach(id=>{ $('m-'+id).classList.toggle('on',route===id); });
    $('m-head-title').textContent=TITLES[route]||'VTable';
    const sub=$('m-head-sub');
    sub.hidden=route!=='today';
    if(route==='today') sub.textContent=headerDate();

    const tabRoute=route==='facdetail'?'faculty':route;
    document.querySelectorAll('.m-tab').forEach(btn=>{
      const on=btn.dataset.route===tabRoute;
      btn.classList.toggle('is-active',on);
      if(on) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
    });

    const p=profile();
    // A hand-picked FSE/FSM profile has no name to initial, so fall back to
    // the department code ("EE", "BBA") which is what identifies it.
    $('m-avatar-initials').textContent=avatarText(p);
    renderSideAccount(p);

    if(route==='today') renderToday();
    else if(route==='lookup') renderLookup();
    else if(route==='rooms') renderRooms();
    else if(route==='faculty') renderFaculty();
    else if(route==='facdetail') renderFacDetail();
    else if(route==='exams') renderExams();
    else if(route==='profile') renderProfile();
    showDarkModeTipOnce();
  }

  function avatarText(p){
    if(!p) return '—';
    return initials(p.name)!=='—'?initials(p.name)
      :(String(p.department||'').replace(/^BS\s+/i,'').slice(0,2).toUpperCase()||'—');
  }

  /* ══ GUEST vs LOGGED IN (desktop) ══════════════════════════════════
     What a profile adds. Listed wherever a guest meets a locked feature, so
     logging in reads as an upgrade rather than a wall. */
  const PERKS=[
    ['Your day, live','Today’s classes with a countdown to the next one, and your whole week.'],
    ['My courses','Add repeat or elective courses from other sections; drop ones you don’t take.'],
    ['Friends','Save friends’ sections and see their week next to yours.'],
    ['Notifications','Class changes, exam seating and show-up alerts for your section.'],
    ['Exams for you','Exam and show-up schedules pre-filtered to your batch and section.'],
    ['Leaderboards','Put your name on the arcade high-score boards.']
  ];
  function perksHTML(limit){
    return `<ul class="m-perks">${PERKS.slice(0,limit||PERKS.length).map(([t,d])=>
      `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>`;
  }

  // Sidebar footer (desktop only; hidden on phones by CSS).
  function renderSideAccount(p){
    const host=$('m-side-account');
    if(!host) return;
    if(!p){
      host.innerHTML=`<div class="m-side-guest">
          <div class="m-side-kicker">Browsing as guest</div>
          <p>Log in with your NU ID to get your own timetable, courses, friends and alerts.</p>
          <button class="m-btn-primary m-side-login" id="m-side-login" type="button">Log in</button>
        </div>`;
      $('m-side-login').addEventListener('click',openSignin);
      return;
    }
    const sub=[p.manual?(MANUAL_SCHOOLS[p.school]||''):p.nuid,p.section].filter(Boolean).join(' · ');
    host.innerHTML=`<button class="m-side-me${route==='profile'?' is-active':''}" id="m-side-me" type="button"${route==='profile'?' aria-current="page"':''}>
        <span class="m-side-me-avatar">${esc(avatarText(p))}</span>
        <span class="m-side-me-text"><span class="m-side-me-name">${esc(p.name||p.department||'Student')}</span>
          <span class="m-side-me-sub">${esc(sub||p.department||'')}</span></span>
      </button>`;
    $('m-side-me').addEventListener('click',()=>go('profile'));
  }

  // Desktop guest landing, shown on Today in place of the class timetable a
  // signed-in student would see. The public tools work without a profile, so
  // point at them first, then at what logging in adds.
  function guestHomeHTML(){
    const tools=[
      ['lookup','Timetable lookup','Any section’s classes, by school, program, batch and day.'],
      ['rooms','Free rooms','Which rooms are empty right now, by block and floor.'],
      ['faculty','Faculty','Offices, emails and courses for every teacher.'],
      ['exams','Exams','Sessional and final schedules, plus show-up days.']
    ];
    return `<div class="m-guest-home">
      <div class="m-guest-hero">
        <div class="m-kicker">WELCOME TO VTABLE</div>
        <h1 class="m-hero">Stop wandering FAST.</h1>
        <p class="m-hero-sub">Everything below works without an account.</p>
      </div>
      <div class="m-guest-tools">${tools.map(([r,t,d])=>
        `<button class="m-guest-tool" type="button" data-guest-go="${r}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}
      </div>
      <div class="m-guest-unlock">
        <div class="m-section-label">Log in to unlock</div>
        ${perksHTML()}
        <button class="m-btn-primary m-locked-btn" id="m-locked-login" type="button">Log in with your NU ID</button>
      </div>
    </div>`;
  }

  /* ══ SIGN IN ═══════════════════════════════════════════════════════ */
  function signinStatus(msg,isError){
    const el=$('m-signin-status');
    if(!el) return;
    el.textContent=msg||'';
    el.classList.toggle('is-error',Boolean(isError));
  }
  let signingIn=false;
  let signinChallenge=null;

  function resetSigninCode(){
    signinChallenge=null;
    const wrap=$('m-code-wrap');
    const code=$('m-code');
    const btn=$('m-signin-btn');
    if(wrap) wrap.hidden=true;
    if(code) code.value='';
    if(btn && !signingIn) btn.textContent='Continue';
  }

  async function finishSignIn(nuid){
    // /api/auth/me is the only profile read now: it returns the roster row for
    // the account the session resolved, never a downloadable batch.
    const account=await refreshAuthSession();
    if(!account || String(account.nuid||'').trim().toUpperCase()!==nuid){
      throw new Error('Your session could not be verified. Please try again.');
    }
    // refreshAuthSession() has already restored a profile saved on the
    // account (section, courses, friends); use it instead of the roster row.
    const saved=account.saved&&account.saved.profile;
    if(saved&&saved.department){
      const p=profile();
      seedProfileSchedulePrefs(p,true);
      setSkipped(false);
      renderOnboard(p);
      route='onboard';
      render();
      return;
    }
    const match=account.student||null;
    if(!match){
      // Not a dead end: the roster lags every new intake (26-* is published
      // months after they can log in), so collect the details instead —
      // the same thing the desktop registration form does.
      startRegistration(nuid);
      return;
    }
    const p=parseProfileFromStudent(match);
    // Keep a course overlay this browser already holds for the same student;
    // it is uploaded to the account by setProfileCookie.
    const local=profile();
    if(local&&String(local.nuid||'').trim().toUpperCase()===nuid){
      ['courses','courseRemoved','coursePrefsRevision'].forEach(k=>{ if(local[k]!==undefined) p[k]=local[k]; });
    }
    setProfileCookie(p);
    seedProfileSchedulePrefs(p,true);
    setSkipped(false);
    renderOnboard(p);
    route='onboard';
    render();
  }

  async function doSignIn(){
    if(signingIn) return;
    const input=$('m-nuid');
    const raw=input?input.value:'';
    const err=(typeof validateNuid==='function')?validateNuid(raw):null;
    if(err){ signinStatus(err,true); return; }
    const nuid=(typeof formatNuid==='function')?formatNuid(raw):String(raw).toUpperCase();
    if(input) input.value=nuid;

    const btn=$('m-signin-btn');
    // Second press: verify the emailed code, then continue with the roster.
    if(signinChallenge){
      const code=String($('m-code')?.value||'').trim();
      if(!/^\d{6}$/.test(code)){
        signinStatus('Enter the 6-digit code we emailed you.',true);
        return;
      }
      signingIn=true;
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="m-spinner"></span>Verifying…'; }
      signinStatus('');
      const challenge=signinChallenge;
      let stage='verify';
      try{
        await verifyAuthCode(challenge.challengeId,code);
        stage='profile';
        // The code is spent and a session now exists. Clearing the challenge
        // first means a profile-load failure can retry via the session-reuse
        // path above instead of asking for another code.
        resetSigninCode();
        await finishSignIn(challenge.nuid);
      }catch(e){
        signinStatus(stage==='verify'
          ? (e.message||'That code could not be verified.')
          : 'Signed in, but your profile could not be loaded. Press Continue to retry.',true);
      }finally{
        signingIn=false;
        if(btn){ btn.disabled=false; btn.textContent=signinChallenge?'Verify code':'Continue'; }
      }
      return;
    }

    signingIn=true;
    if(btn){ btn.disabled=true; btn.innerHTML='<span class="m-spinner"></span>Signing in…'; }
    signinStatus('');
    try{
      // A session may already exist (page reload, or coming back from the
      // registration screen). Reuse it instead of sending another code.
      const account=await refreshAuthSession();
      if(account && String(account.nuid||'').trim().toUpperCase()===nuid){
        resetSigninCode();
        await finishSignIn(nuid);
        return;
      }
      // No OTP: the server signs this NU ID in directly.
      await requestAuthCode(nuid);
      await finishSignIn(nuid);
    }catch(e){
      signinStatus(e.message||'Could not sign in.',true);
    }finally{
      signingIn=false;
      if(btn){ btn.disabled=false; if(!signinChallenge) btn.textContent='Continue'; }
    }
  }

  function renderOnboard(p){
    $('m-onboard-kicker').textContent='READ FROM '+(p.nuid||'YOUR ROLL NO');
    $('m-onboard-title').textContent='Got it — you’re '+(p.department||'set')+'.';
    const rows=[
      ['Name',p.name||'—'],
      ['Program',p.department||'—'],
      ['Batch',(typeof profileFullBatch==='function'?profileFullBatch(p):p.batch)||'—']
    ];
    $('m-onboard-rows').innerHTML=rows.map(([l,v])=>
      `<div class="m-orow"><div class="m-orow-label">${esc(l)}</div><div class="m-orow-value">${esc(v)}</div></div>`
    ).join('');
    // Wrong section on the roster (a late section swap, a roster typo) is
    // exactly the kind of thing a student notices right here, first look —
    // so it's fixable on the spot rather than only later in Profile.
    const secHost=$('m-onboard-sec');
    if(secHost){
      secHost.innerHTML=sectionPickerHTML(p,'m-onboard-sec-chips');
      secHost.querySelectorAll('.m-chip').forEach(chip=>{
        chip.addEventListener('click',()=>changeProfileSection(chip.dataset.sec));
      });
    }
  }

  /* ══ NOTIFICATIONS ═════════════════════════════════════════════════
     enableSeatAlerts() lives in app.js and writes its progress to a desktop
     element inside the hidden .shell, so the phone would otherwise show
     nothing at all — including the server's reason for a refusal, which is
     the only clue a student gets when their roll number is not yet on the
     published roster. Point the shared hook at whichever line is on screen. */
  function enablePush(statusId,btnId){
    const line=$(statusId), btn=$(btnId);
    if(typeof enableSeatAlerts!=='function'){
      if(line) line.textContent='Notifications are unavailable right now.';
      return;
    }
    window.onPushStatus=msg=>{
      if(!line) return;
      line.textContent=msg;
      // Only the success line starts with a tick; everything else is a problem.
      line.classList.toggle('is-error',Boolean(msg)&&!/^✓/.test(msg));
    };
    if(btn) btn.disabled=true;
    Promise.resolve(enableSeatAlerts()).finally(()=>{ if(btn) btn.disabled=false; });
  }

  /* ══ REGISTRATION (roll no not on the roster) ══════════════════════
     db/students/<year>.json trails each new intake by months, so a lookup
     miss is normally a brand-new student rather than a typo. Collect the
     details by hand, exactly as the desktop registration form does, and
     store them in the same profile cookie. The row is also published to
     db/students/<year>.json via /api/register so the server side learns about
     the student too — without it the roster never grows, and everything keyed
     off it (notification sign-up above all) keeps treating a real student as
     someone who does not exist. The request is made after the OTP step, and
     /api/register takes the roll no from that session rather than this form. */
  const reg={nuid:'',batch:'',program:'',section:''};

  function startRegistration(nuid){
    reg.nuid=nuid;
    reg.batch=(typeof getBatchFromNuid==='function')?getBatchFromNuid(nuid):String(nuid).slice(0,2);
    reg.program=''; reg.section='';
    const nameEl=$('m-reg-name'); if(nameEl) nameEl.value='';
    regStatus('');
    route='register';
    render();
  }
  function regStatus(msg,isError){
    const el=$('m-reg-status');
    if(!el) return;
    el.textContent=msg||'';
    el.classList.toggle('is-error',Boolean(isError));
  }
  function regFullBatch(){
    return (typeof profileFullBatch==='function')?profileFullBatch({batch:reg.batch}):('20'+reg.batch);
  }

  function renderRegister(){
    const full=regFullBatch();
    $('m-reg-kicker').textContent='NEW STUDENT · '+reg.nuid;
    // Only offer departments that actually publish this batch, so a new
    // intake never lands on a section with no timetable behind it.
    const programs=Object.keys(TT||{}).filter(p=>TT[p]&&TT[p][full]);
    if(reg.program&&!programs.includes(reg.program)) reg.program='';
    const sections=reg.program
      ? Object.keys(TT[reg.program][full]||{}).filter(s=>s!==ALL_SECTIONS)
          .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      : [];
    if(reg.section&&!sections.includes(reg.section)) reg.section='';

    $('m-reg-fields').innerHTML=[
      `<div class="m-lk-field"><div class="m-meta-row"><span>Batch</span><b>${esc(full)}</b></div></div>`,
      fieldHTML('Department','program',reg.program,programs,reg.program,null,
                programs.length?'':'No timetable published for this batch yet.'),
      fieldHTML('Section','section',reg.section,sections,reg.section,null,'Pick a department first.')
    ].join('');
    $('m-reg-fields').querySelectorAll('.m-chip').forEach(chip=>{
      chip.addEventListener('click',()=>{
        const f=chip.dataset.field,v=chip.dataset.value;
        if(f==='program'){ reg.program=reg.program===v?'':v; reg.section=''; }
        else if(f==='section'){ reg.section=reg.section===v?'':v; }
        renderRegister();
      });
    });
  }

  function saveRegistration(){
    if(typeof profileAuthMatches!=='function' || !profileAuthMatches(reg.nuid)){
      regStatus('Verify your university email before saving this profile.',true);
      return;
    }
    const name=($('m-reg-name')?$('m-reg-name').value:'').trim();
    if(!name){ regStatus('Please enter your name.',true); return; }
    if(!reg.program||!reg.section){ regStatus('Pick your department and section.',true); return; }
    regStatus('');
    // Two-digit batch and no manual flag, so this profile behaves exactly like
    // one resolved from the roster (profileFullBatch expands "26" -> "2026").
    const p={nuid:reg.nuid,name,department:reg.program,batch:reg.batch,section:reg.section};
    setProfileCookie(p);
    // Fire-and-forget: the profile is already saved locally, so a failed
    // publish must not strand the user on the registration screen.
    if(typeof publishProfileToRoster==='function') publishProfileToRoster(p);
    if(typeof seedProfileSchedulePrefs==='function') seedProfileSchedulePrefs(p,true);
    setSkipped(false);
    renderOnboard(p);
    route='onboard';
    render();
  }

  /* ══ MANUAL SETUP (FSE / FSM) ══════════════════════════════════════
     Only FSC publishes a roll-no → student roster, so these two schools
     choose their section by hand. The result goes into the same profile
     cookie the roll-no flow writes — it never leaves the device. */
  const MANUAL_SCHOOLS={engineering:'FSE',business:'FSM'};
  const mn={school:'',program:'',batch:'',section:''};

  function renderManual(){
    const src=mn.school?ttFor(mn.school):{};
    const programs=Object.keys(src||{}).sort();
    if(mn.program&&!programs.includes(mn.program)) mn.program='';
    const batches=mn.program?Object.keys(src[mn.program]||{}).sort():[];
    if(mn.batch&&!batches.includes(mn.batch)) mn.batch='';
    const sections=(mn.program&&mn.batch)
      ? Object.keys(src[mn.program][mn.batch]||{}).filter(s=>s!==ALL_SECTIONS)
          .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      : [];
    if(mn.section&&!sections.includes(mn.section)) mn.section='';

    const schoolEmpty=mn.school&&!programs.length
      ? 'Still loading this school’s timetable — give it a moment.' : 'Pick a school first.';
    $('m-manual-fields').innerHTML=[
      fieldHTML('School','school',mn.school?MANUAL_SCHOOLS[mn.school]:'',
                Object.keys(MANUAL_SCHOOLS),mn.school,k=>MANUAL_SCHOOLS[k]),
      fieldHTML('Department','program',mn.program,programs,mn.program,null,schoolEmpty),
      fieldHTML('Batch','batch',mn.batch,batches,mn.batch,null,'Pick a department first.'),
      fieldHTML('Section','section',mn.section,sections,mn.section,null,'Pick a batch first.')
    ].join('');
    $('m-manual-fields').querySelectorAll('.m-chip').forEach(chip=>{
      chip.addEventListener('click',()=>{
        const f=chip.dataset.field,v=chip.dataset.value;
        if(f==='school'){ if(mn.school!==v){ mn.school=v; mn.program=''; mn.batch=''; mn.section=''; } }
        else if(f==='program'){ mn.program=mn.program===v?'':v; mn.batch=''; mn.section=''; }
        else if(f==='batch'){ mn.batch=mn.batch===v?'':v; mn.section=''; }
        else if(f==='section'){ mn.section=mn.section===v?'':v; }
        renderManual();
      });
    });
  }

  function saveManual(){
    const el=$('m-manual-status');
    if(!mn.school||!mn.program||!mn.batch||!mn.section){
      if(el){ el.textContent='Pick a school, department, batch and section first.'; el.classList.add('is-error'); }
      return;
    }
    if(el){ el.textContent=''; el.classList.remove('is-error'); }
    // No name/roll no to store — this profile is section-level only.
    setProfileCookie({
      name:'', nuid:'', department:mn.program, batch:mn.batch,
      section:mn.section, school:mn.school, manual:true
    });
    setSkipped(false);
    lk.school=mn.school;
    go('today',true);
    toast(MANUAL_SCHOOLS[mn.school]+' · '+mn.program+' '+mn.batch+'-'+mn.section);
  }

  /* ══ TODAY / WEEK ══════════════════════════════════════════════════ */
  let weekMode=false;

  // The section's classes for one day, with batch-wide ("ALL") entries folded
  // in exactly as the desktop timetable does.
  // Which timetable object a school's classes live in. The global TT only ever
  // holds the school the desktop layer last loaded (computing by default);
  // ROOM_TT holds all three at once, refreshed on a timer for Free Rooms, so
  // it is the reliable source for an FSE/FSM profile.
  function ttFor(school){
    if(school&&school!=='computing'&&typeof ROOM_TT!=='undefined'&&ROOM_TT[school]) return ROOM_TT[school];
    return TT;
  }
  /* My Courses replaces the section timetable once anything is saved.
     Everything that shows the student their OWN day — Today, Week, the up-next
     banner — goes through myClassesFor, so the swap happens in one place
     instead of three that could drift apart.

     The saved list is shared with the desktop layer (same profile cookie, same
     helpers in app.js), so a course added on a laptop is already there on the
     phone. */
  // Under the overlay model getMyCourses() defaults to exactly the student's
  // own section (defaults minus anything removed, plus anything added), so
  // routing through it unconditionally is correct, not just for a customised
  // profile: a brand-new profile with nothing changed yet produces exactly
  // the rows the plain section lookup would. Only fall back to the raw
  // section lookup when no scope could be resolved at all (myScopeFromCookie
  // returns null) - a rare edge case, not something a genuinely empty day
  // should be mistaken for.
  function myClassesFor(keys,day){
    if(typeof myCoursesRowsForDay==='function'
       && (typeof myScopeFromCookie!=='function' || myScopeFromCookie())){
      return myCoursesRowsForDay(day).map(r=>({name:r.name,location:r.location,time:r.time,note:r.note||''}));
    }
    return classesFor(keys.dept,keys.batch,keys.sec,day,keys.tt);
  }
  function hasOwnCourses(){
    // Kept for callers that only care "is my course list meaningfully
    // populated" (the Today meta label). Under the overlay model this is
    // almost always true once a profile exists.
    return typeof getMyCourses==='function' && getMyCourses().length>0;
  }
  function classesFor(dept,batch,sec,day,src){
    const t=src||TT;
    const base=(t[dept]&&t[dept][batch]&&t[dept][batch][sec]&&t[dept][batch][sec][day])||[];
    const all=(sec&&t[dept]&&t[dept][batch]&&t[dept][batch][ALL_SECTIONS]&&t[dept][batch][ALL_SECTIONS][day])||[];
    const merged=all.length?mergeSectionEntries(base,all):base;
    return sortByTime(merged);
  }
  function profileKeys(){
    const p=profile();
    if(!p) return null;
    const dept=String(p.department||'').trim();
    // A hand-picked FSE/FSM profile stores the batch exactly as the timetable
    // keys it, so it must not go through the "25" -> "2025" roll-no expansion.
    const batch=p.manual?String(p.batch||'')
      :((typeof profileFullBatch==='function')?profileFullBatch(p):String(p.batch||''));
    const sec=String(p.section||'').trim().toUpperCase();
    if(!dept||!batch||!sec) return null;
    return {dept,batch,sec,profile:p,tt:ttFor(p.school)};
  }

  function lockedHTML(){
    return `<div class="m-locked">
      <div class="m-locked-title">Please login with your nu ID to use this feature</div>
      ${DESK.matches?perksHTML():''}
      <button class="m-btn-primary m-locked-btn" id="m-locked-login" type="button">Log in</button>
    </div>`;
  }
  function wireLocked(container){
    const btn=container.querySelector('#m-locked-login');
    if(btn) btn.addEventListener('click',()=>{ setSkipped(false); openSignin(); });
    container.querySelectorAll('[data-guest-go]').forEach(b=>{
      b.addEventListener('click',()=>go(b.dataset.guestGo));
    });
  }

  function renderToday(){
    updateFriendsButton();
    const todayPane=$('m-today-pane');
    const weekPane=$('m-week-pane');
    $('m-seg-today').classList.toggle('is-active',!weekMode);
    $('m-seg-today').setAttribute('aria-selected',String(!weekMode));
    $('m-seg-week').classList.toggle('is-active',weekMode);
    $('m-seg-week').setAttribute('aria-selected',String(weekMode));
    todayPane.hidden=weekMode;
    weekPane.hidden=!weekMode;

    const keys=profileKeys();
    if(!keys){
      const target=weekMode?weekPane:todayPane;
      target.innerHTML=(DESK.matches&&!profile())?guestHomeHTML():lockedHTML();
      wireLocked(target);
      return;
    }
    if(weekMode) renderWeek(keys,weekPane); else renderTodayList(keys,todayPane);
  }

  function renderTodayList(keys,pane){
    const day=todayName();
    const list=myClassesFor(keys,day);
    if(!Object.keys(keys.tt||{}).length&&!hasOwnCourses()){
      pane.innerHTML='<div class="m-empty">Loading your timetable…</div>';
      return;
    }
    const now=nowMinutes();
    const rows=list.map(e=>{
      const time=e.time||e.t||'';
      const b=slotBounds(time);
      return {
        name:e.name||e.c||'', room:e.location||e.l||'—', time,
        note:e.note||e.n||'',
        start:time.split('-')[0]||'', end:(time.split('-')[1]||'').trim(),
        isNow:Boolean(b&&now>=b[0]&&now<=b[1]),
        isPast:Boolean(b&&now>b[1]), startMin:b?b[0]:null, endMin:b?b[1]:null
      };
    });
    const current=rows.find(r=>r.isNow);

    // The banner is always on screen and has three states: the live class
    // (red, counting down to the end), the next one still to come (green,
    // counting down to the start), and the idle card once the day is done.
    // data-until is seconds-since-midnight; tickBanner() re-reads it every
    // second so the countdown moves without re-rendering the whole pane.
    const next=findNextClass(keys);
    let html='';
    if(current){
      html+=`<div class="m-now is-live" id="m-now-banner" data-until="${Date.now()+(current.endMin*60-nowSeconds())*1000}">
        <div class="m-now-head"><span class="m-now-dot"></span><span>IN CLASS NOW · ${esc(toAmPm(current.start))} – ${esc(toAmPm(current.end))}</span></div>
        <div class="m-now-name">${esc(cleanName(current.name))}</div>
        <div class="m-now-stats">
          <div><div class="m-now-stat-label">Room</div><div class="m-now-stat-value">${esc(current.room)}</div></div>
          <div><div class="m-now-stat-label">Ends in</div><div class="m-now-stat-value" id="m-now-count">—</div></div>
        </div>
      </div>`;
    }else if(next){
      const when=next.dayOffset===0?'UP NEXT'
        :next.dayOffset===1?'TOMORROW':next.day.toUpperCase();
      html+=`<div class="m-now" id="m-now-banner" data-until="${Date.now()+next.startsIn*1000}">
        <div class="m-now-head"><span class="m-now-dot"></span><span>${esc(when)} · ${esc(toAmPm(next.start))} – ${esc(toAmPm(next.end))}</span></div>
        <div class="m-now-name">${esc(cleanName(next.name))}</div>
        <div class="m-now-stats">
          <div><div class="m-now-stat-label">Room</div><div class="m-now-stat-value">${esc(next.room)}</div></div>
          <div><div class="m-now-stat-label">Starts in</div><div class="m-now-stat-value" id="m-now-count">—</div></div>
        </div>
      </div>`;
    }else{
      html+=`<div class="m-now is-idle" id="m-now-banner">
        <div class="m-now-head"><span class="m-now-dot"></span><span>NO CLASSES FOUND</span></div>
        <div class="m-now-name">The university cannot<br>hurt you right now.</div>
      </div>`;
    }
    // The section identity while nothing has been customised (more useful
    // than "MY COURSES" when the two are identical anyway); once something
    // has actually been added or removed, this genuinely stops being "just
    // BS CS 2025-G" and the label says so.
    const customised=typeof hasMyCourses==='function' && hasMyCourses();
    const meta=customised?'MY COURSES'
      :`${esc(keys.dept)} · ${esc(keys.batch)} · ${esc(keys.sec)}`;
    html+='<div id="m-today-class-list">';
    html+=`<div class="m-meta-row"><span>${rows.length} CLASS${rows.length===1?'':'ES'}</span>
      <b>${meta}</b></div>`;

    if(!rows.length){
      html+='<div class="m-empty">Nothing scheduled today. Enjoy it.</div>';
    }else{
      html+='<div class="m-rows">';
      rows.forEach((r,i)=>{
        html+=classRowHTML(r);
        const next=rows[i+1];
        if(next&&r.endMin!=null&&next.startMin!=null&&next.startMin-r.endMin>=40&&!r.isPast){
          html+=gapHTML(next.start);
        }
      });
      html+='</div>';
    }
    html+='</div>';
    pane.innerHTML=html;

    tickBanner();
    wireTodayBanner();
  }

  function wireTodayBanner(){
    const banner=$('m-now-banner');
    if(banner){
      // Same easter egg as double-clicking the header logo on desktop, but it
      // opens the phone's own arcade rather than the desktop overlay.
      banner.addEventListener('dblclick',()=>openArcade());
      let lastTap=0;
      banner.addEventListener('pointerup',ev=>{
        const t=Date.now();
        if(t-lastTap>0&&t-lastTap<450){ ev.preventDefault(); openArcade(); lastTap=0; }
        else lastTap=t;
      });
      banner.style.touchAction='manipulation';
    }
    $('m-today-pane')?.querySelectorAll('.m-gap').forEach(btn=>{
      btn.addEventListener('click',()=>go('rooms'));
    });
  }

  function seatingTimeBounds(time){
    const parts=String(time||'').trim().split(/\s*[-\u2013\u2014]\s*/);
    if(parts.length!==2) return null;
    const minute=value=>{
      const match=String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
      if(!match) return null;
      let hour=Number(match[1]), mins=Number(match[2]);
      if(mins>59||hour<1||hour>12) return null;
      // Seating plans omit AM/PM. Their 1:00–7:20 slots are afternoon.
      if(hour>=1&&hour<=7) hour+=12;
      return hour*60+mins;
    };
    const start=minute(parts[0]),end=minute(parts[1]);
    return start!=null&&end!=null&&end>start?[start,end]:null;
  }
  function examTimeLabel(minute){
    const hour=Math.floor(minute/60), mins=minute%60;
    return `${hour%12||12}:${String(mins).padStart(2,'0')} ${hour>=12?'PM':'AM'}`;
  }
  function campusDateKey(){
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  }
  function showHomeExamBanner(){
    const p=profile();
    const nuid=String(p?.nuid||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!nuid||typeof loadSeatingPlanData!=='function') return;
    const clearForMissingPlan=()=>{
      // During an exam period, never fall back to a lecture card when the
      // seating file has not arrived yet. The Home area stays deliberately
      // blank until there is a real paper assignment for the student.
      if(typeof isExamSeason!=='undefined'&&isExamSeason){
        const banner=$('m-now-banner');
        if(banner) banner.outerHTML='<div class="m-home-exam-empty" id="m-now-banner" aria-hidden="true"></div>';
      }
    };
    loadSeatingPlanData().then(doc=>{
      if(route!=='today'||weekMode) return;
      const examDate=doc?.exam_date||doc?.room_occupancy?.dates?.[0]||'';
      const today=campusDateKey();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(examDate)||examDate<today){ clearForMissingPlan(); return; }
      const dayOffset=Math.round((Date.parse(`${examDate}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000);
      const now=nowSeconds();
      const exams=(doc?.students||[]).map(student=>{
        const key=String(student.nuid||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
        const bounds=seatingTimeBounds(student.time);
        if(key!==nuid||!bounds) return null;
        const startsIn=dayOffset*86400+bounds[0]*60-now;
        const endsIn=dayOffset*86400+bounds[1]*60-now;
        return {...student,bounds,startsIn,endsIn};
      }).filter(Boolean).filter(exam=>exam.endsIn>0)
        .sort((a,b)=>a.startsIn-b.startsIn);
      if(!exams.length){ clearForMissingPlan(); return; }
      const exam=exams.find(item=>item.startsIn<=0)||exams[0];
      // The top card is the active/nearest paper. If another paper remains on
      // the same day, show it immediately below rather than making students
      // wait for the first countdown to end.
      const following=exams.filter(item=>item!==exam&&item.startsIn>0).slice(0,1);
      const live=exam.startsIn<=0;
      const when=live?'EXAM NOW':dayOffset===0?'NEXT EXAM · TODAY':dayOffset===1?'NEXT EXAM · TOMORROW':'NEXT EXAM';
      const until=Date.now()+(live?exam.endsIn:exam.startsIn)*1000;
      const banner=$('m-now-banner');
      if(!banner) return;
      const card=(item,label,withCountdown=false)=>`<div class="m-now${item===exam&&live?' is-live':''}">
          <div class="m-now-head"><span class="m-now-dot"></span><span>${esc(label)} · ${esc(examTimeLabel(item.bounds[0]))} – ${esc(examTimeLabel(item.bounds[1]))}</span></div>
          <div class="m-now-name">${esc(item.paper||'Exam')}</div>
          <div class="m-now-stats">
            <div><div class="m-now-stat-label">Room · Seat</div><div class="m-now-stat-value">${esc(item.class||'—')} · ${esc(item.seat||'—')}</div></div>
            <div><div class="m-now-stat-label">${withCountdown?(live?'Ends in':'Starts in'):'After this'}</div><div class="m-now-stat-value"${withCountdown?' id="m-now-count"':''}>${withCountdown?'—':examTimeLabel(item.bounds[0])}</div></div>
          </div>
        </div>`;
      banner.outerHTML=`<div class="m-home-exam-stack" id="m-now-banner" data-until="${until}">
        ${card(exam,when,true)}
        ${following.map(item=>card(item,live?'AFTER THIS PAPER':'THEN',false)).join('')}
      </div>`;
      // A seating assignment takes precedence over the normal class list for
      // the day.  Keeping it hidden (rather than deleting it) lets a normal
      // render restore lectures as soon as there is no applicable plan.
      $('m-today-class-list')?.setAttribute('hidden','');
      tickBanner();
      wireTodayBanner();
    }).catch(clearForMissingPlan);
  }

  function classRowHTML(r){
    const note=r.note||r.n||noteOf(r.name);
    const noteCls=/cancel/i.test(note)?'cancel':'resch';
    return `<div class="m-row${r.isNow?' is-now':''}${r.isPast?' is-past':''}">
      <div class="m-row-time"><div class="m-row-start">${esc(toAmPm(r.start))}</div><div class="m-row-end">${esc(toAmPm(r.end))}</div></div>
      <div class="m-row-rule"></div>
      <div class="m-row-main">
        ${note?`<span class="m-note ${noteCls}">${esc(note)}</span>`:''}
        <div class="m-row-name">${esc(cleanName(r.name))}</div>
        <div class="m-row-pills"><span class="m-pill${r.isNow?' is-green':''}">${esc(r.room)}</span></div>
      </div>
    </div>`;
  }
  function gapHTML(until){
    return `<button class="m-gap" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span class="m-gap-text">Free until ${esc(toAmPm(until))} — see what rooms are open</span>
      <span class="m-gap-go">Find one &rsaquo;</span>
    </button>`;
  }

  // Drives the banner countdown once a second. When it reaches zero the class
  // has started or ended, so the whole pane is re-rendered to move the banner
  // on to its next state.
  function tickBanner(){
    const el=$('m-now-count');
    const banner=$('m-now-banner');
    if(!el||!banner) return;
    const until=Number(banner.dataset.until);
    if(!Number.isFinite(until)) return;
    // Absolute epoch ms, not seconds-since-midnight: the target can be on a
    // later day, and a midnight-relative figure would go negative overnight.
    const left=Math.round((until-Date.now())/1000);
    if(left<=0){ if(route==='today'&&!weekMode) renderToday(); return; }
    el.textContent=countdown(left);
  }

  // The next class from this moment on, looking past the end of today. Once
  // the last class of the day is over, "no classes found" is the wrong
  // answer — a student still wants to know when they are next due in, so
  // scan forward a week and only give up if nothing is published at all.
  function findNextClass(keys){
    const nowSec=nowSeconds();
    for(let off=0;off<=7;off++){
      const day=weekdayIn(off);
      if(day==='Sunday') continue; // no classes are published for Sunday
      const list=myClassesFor(keys,day);
      for(const e of list){
        const time=e.time||e.t||'';
        const b=slotBounds(time);
        if(!b) continue;
        if(off===0&&b[0]*60<=nowSec) continue; // already started/finished today
        return {
          day, dayOffset:off, time,
          start:time.split('-')[0]||'', end:(time.split('-')[1]||'').trim(),
          room:e.location||e.l||'—', name:e.name||e.c||'',
          startsIn:off*86400+b[0]*60-nowSec
        };
      }
    }
    return null;
  }

  function renderWeek(keys,pane,rowsForDay=null){
    if(!Object.keys(keys.tt||{}).length&&(rowsForDay||!hasOwnCourses())){ pane.innerHTML='<div class="m-empty">Loading your timetable…</div>'; return; }
    const today=todayName();
    const cards=DAYS.map(day=>{
      const list=rowsForDay?rowsForDay(day):myClassesFor(keys,day);
      const body=list.length
        ? list.map(e=>{
            const time=e.time||e.t||'';
            return `<div class="m-dayrow">
              <div class="m-dayrow-time">${esc(time.split(/[-\u2013\u2014]/).map(part=>toAmPm(part.trim())).filter(Boolean).join(' - '))}</div>
              <div class="m-dayrow-name">${esc(cleanName(e.name||e.c||''))}</div>
              <span class="m-pill">${esc(e.location||e.l||'—')}</span>
            </div>`;
          }).join('')
        : '<div class="m-dayrow"><div class="m-dayrow-name" style="color:var(--mute);font-weight:500">No classes</div></div>';
      return `<div class="m-daycard${day===today?' is-today':''}">
        <div class="m-daycard-head"><span class="m-daycard-day">${esc(day)}</span>
          <span class="m-daycard-meta">${list.length} class${list.length===1?'':'es'}</span></div>
        <div class="m-daycard-body">${body}</div>
      </div>`;
    }).join('');
    pane.innerHTML='<div class="m-daycards">'+cards+'</div>';
  }

  /* ══ LOOKUP ════════════════════════════════════════════════════════ */
  const lk={school:'computing',program:'',batch:'',section:'',day:'',course:''};
  const SCHOOL_LABELS={computing:'Computing',engineering:'Engineering',business:'Business'};

  function renderLookup(){
    const fields=$('m-lookup-fields');
    const src = ttFor(lk.school) || {};
    const programs=Object.keys(src||{});
    if(lk.program&&!programs.includes(lk.program)) lk.program='';
    const batches=lk.program?Object.keys(src[lk.program]||{}):[];
    if(lk.batch&&!batches.includes(lk.batch)) lk.batch='';
    const sections=(lk.program&&lk.batch)
      ? Object.keys(src[lk.program][lk.batch]||{}).filter(s=>s!==ALL_SECTIONS)
          .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      : [];
    if(lk.section&&!sections.includes(lk.section)) lk.section='';

    // The distinct courses that section runs — what "add a course" picks from.
    const courseNames=[];
    if(lk.program&&lk.batch&&lk.section){
      const seen=new Set();
      [lk.section,ALL_SECTIONS].forEach(sec=>{
        const days=((src[lk.program]||{})[lk.batch]||{})[sec]||{};
        Object.values(days).forEach(arr=>(arr||[]).forEach(e=>{
          const n=(typeof stripNote==='function'?stripNote(e.name||e.c||''):(e.name||e.c||'')).trim();
          if(n&&!seen.has(n)){ seen.add(n); courseNames.push(n); }
        }));
      });
      courseNames.sort();
    }
    if(lk.course&&!courseNames.includes(lk.course)) lk.course='';

    const batchLabel=b=>b==='REPEAT'?'Repeat':b;
    fields.innerHTML=[
      fieldHTML('School','school',lk.school?SCHOOL_LABELS[lk.school]:'',Object.keys(SCHOOL_LABELS),lk.school,k=>SCHOOL_LABELS[k]),
      fieldHTML('Program','program',lk.program,programs,lk.program),
      fieldHTML('Batch','batch',batchLabel(lk.batch),batches,lk.batch,batchLabel,'Pick a program first.'),
      fieldHTML('Section','section',lk.section,sections,lk.section,null,'Pick a batch first.'),
      fieldHTML('Day','day',lk.day,DAYS,lk.day),
      fieldHTML('Course','course',lk.course,courseNames,lk.course,null,'Pick a section first.')
    ].join('');

    fields.querySelectorAll('.m-chip').forEach(chip=>{
      chip.addEventListener('click',()=>onLookupPick(chip.dataset.field,chip.dataset.value));
    });
    renderLookupAdd(courseNames);
    renderLookupOut();
  }
  function fieldHTML(label,field,valueLabel,options,selected,fmt,emptyCopy){
    const chips=options.map(o=>
      `<button class="m-chip${o===selected?' is-on':''}" data-field="${field}" data-value="${esc(o)}" type="button">${esc(fmt?fmt(o):o)}</button>`
    ).join('');
    return `<div class="m-lk-field">
      <div class="m-meta-row"><span>${esc(label)}</span><b style="${valueLabel?'':'color:rgba(22,33,15,.35)'}">${esc(valueLabel||'—')}</b></div>
      <div class="m-chip-row">${chips||`<span class="m-caption">${esc(emptyCopy||'Nothing to pick here yet.')}</span>`}</div>
    </div>`;
  }
  function onLookupPick(field,value){
    if(field==='school'){
      if(lk.school===value) return;
      lk.school=value; lk.program=''; lk.batch=''; lk.section=''; lk.course='';
      // Only loader available: drive the desktop selector, same as a click there.
      const sel=$('school');
      if(sel){ sel.value=value; }
      if(typeof onSchoolChange==='function') onSchoolChange();
      else if(typeof refreshTimetableFromGoogleSheet==='function') refreshTimetableFromGoogleSheet();
      toast('Loading '+(SCHOOL_LABELS[value]||value)+'…');
      renderLookup();
      return;
    }
    // Anything broader than the course invalidates it — a course only means
    // something inside one section.
    if(field==='program'){ lk.program=lk.program===value?'':value; lk.batch=''; lk.section=''; lk.course=''; }
    else if(field==='batch'){ lk.batch=lk.batch===value?'':value; lk.section=''; lk.course=''; }
    else if(field==='section'){ lk.section=lk.section===value?'':value; lk.course=''; }
    else if(field==='day'){ lk.day=lk.day===value?'':value; }
    else if(field==='course'){ lk.course=lk.course===value?'':value; }
    renderLookup();
  }
  function renderLookupAdd(courseNames){
    const host=$('m-lookup-add');
    if(!host) return;
    if(!lk.course||!courseNames.length){ host.innerHTML=''; return; }
    const already=typeof getMyCourses==='function'
      && getMyCourses().some(c=>String(c.name).trim().toUpperCase()===lk.course.trim().toUpperCase()
        && c.dept===lk.program && c.batch===lk.batch && c.section===lk.section);
    host.innerHTML='<button class="m-btn-primary m-course-add" type="button"'+(already?' disabled':'')+'>'
      +(already?'Already in my courses':'+ Add "'+esc(lk.course)+'" to my courses')+'</button>'
      +'<div class="m-signin-status" id="m-lookup-add-status" role="status" aria-live="polite"></div>';
    const btn=host.querySelector('.m-course-add');
    if(btn&&!already) btn.addEventListener('click',addLookupCourse);
  }
  function addLookupCourse(){
    const el=$('m-lookup-add-status');
    const say=(m,bad)=>{ if(el){ el.textContent=m; el.classList.toggle('is-error',!!bad); } };
    if(typeof addMyCourse!=='function'){ say('Course saving is unavailable.',true); return; }
    if(!profile()){ say('Set up your profile first — courses are saved with it.',true); return; }
    const res=addMyCourse({school:lk.school,dept:lk.program,batch:lk.batch,section:lk.section,name:lk.course});
    if(!res.ok){
      say(res.reason==='duplicate'?'Already in your courses.'
        :res.reason==='full'?'You have reached the saved-course limit.'
        :'Set up your profile first — courses are saved with it.',true);
      return;
    }
    toast('Added '+lk.course);
    renderLookup();
  }
  function renderLookupOut(){
    const out=$('m-lookup-out');
    if(!lk.program||!lk.batch||!lk.section||!lk.day){
      out.innerHTML='<div class="m-empty">Pick a school, program, batch, section and day to load a timetable.</div>';
      return;
    }
    // ttFor(lk.school), not the global TT: TT only ever holds whichever school
    // the desktop layer last loaded, so an FSE or FSM lookup listed the right
    // sections and then showed computing's classes for them (usually none).
    const list=classesFor(lk.program,lk.batch,lk.section,lk.day,ttFor(lk.school));
    let html=`<div class="m-rooms-bar m-reveal"><span>${esc(lk.program)} · ${esc(lk.batch)} · ${esc(lk.section)}</span><span>${esc(lk.day.slice(0,3).toUpperCase())}</span></div>`;
    if(!list.length){
      html+='<div class="m-empty">No published classes for that combination.</div>';
    }else{
      html+='<div class="m-rows m-reveal">'+list.map(e=>{
        const time=e.time||e.t||'';
        return classRowHTML({
          name:e.name||e.c||'', room:e.location||e.l||'—',
          start:time.split('-')[0]||'', end:(time.split('-')[1]||'').trim(),
          isNow:false, isPast:false
        });
      }).join('')+'</div>';
    }
    out.innerHTML=html;
  }

  /* ══ FREE ROOMS ════════════════════════════════════════════════════ */
  const rm={block:'',floor:'',open:''};

  // Whole-day occupancy for one room. Deliberately NOT getRoomSlotInfo(),
  // which hides slots that have already passed when the day is today — the
  // design's bar is the day's full slot grid, green for free, grey for busy.
  function slotOccupant(room,day,slot){
    updateRoomMode(roomDateForDay(day));
    const sources=BLOCK_SOURCES[roomBlock(room)]||['computing'];
    let occupiedBy=((typeof isCDBlockRoom==='function')&&isCDBlockRoom(room))
      ?findCDOccupancy(room,day,slot):null;
    for(let i=0;i<sources.length&&!occupiedBy;i++){
      occupiedBy=findOccupancyInTT(ROOM_TT[sources[i]],room,day,slot);
    }
    return occupiedBy;
  }
  function roomSlots(room,day){
    return slotsForRoom(room).map(slot=>({slot,occupiedBy:slotOccupant(room,day,slot)}));
  }
  function roomsOfBlock(block){
    const floors=BLOCK_FLOORS[block]||{};
    return Object.keys(floors).reduce((acc,f)=>acc.concat(floors[f]||[]),[]);
  }
  // The current slot only. This used to build the room's whole day and then
  // throw away seven eighths of it, and the block grid calls it once for every
  // room in the building.
  function isFreeNow(room,day){
    if(day!==todayName()) return null;
    const cur=getCurrentSlotFor(slotsForRoom(room));
    if(!cur) return null;
    return !slotOccupant(room,day,cur);
  }
  // Same answer as isFreeNow(), read off a day vector the caller already has,
  // so a room that has just been computed is not computed a second time.
  function freeNowFromSlots(room,day,slots){
    if(day!==todayName()) return null;
    const cur=getCurrentSlotFor(slotsForRoom(room));
    if(!cur) return null;
    const info=slots.find(s=>s.slot===cur);
    return info?!info.occupiedBy:null;
  }

  function renderRooms(){
    const day=todayName();
    const availabilityMessage=roomAvailabilityMessage(day);
    const cur=getCurrentSlot();
    // cur is a raw "02:20-03:40" slot key — render it the way students read it.
    $('m-rooms-slot').textContent=cur
      ?('SLOT '+roomTime(cur.split('-')[0])+' – '+roomTime(cur.split('-')[1]))
      :'OUTSIDE CLASS HOURS';
    tickRoomsClock();

    $('m-block-grid').innerHTML=['A','B','C','D'].map(b=>{
      const rooms=roomsOfBlock(b);
      // Outside class hours nothing is "busy", so a free count would read 0 for
      // every block and look broken. Show the block's size instead.
      const sub=availabilityMessage?'Pending':!rooms.length?'—'
        :!cur?rooms.length+' rooms'
        :rooms.filter(r=>isFreeNow(r,day)===true).length+' free';
      return `<button class="m-block${rm.block===b?' is-on':''}" data-block="${b}" type="button">
        <span class="m-block-letter">${b}</span>
        <span class="m-block-free">${esc(sub)}</span>
      </button>`;
    }).join('');
    $('m-block-grid').querySelectorAll('.m-block').forEach(btn=>{
      btn.addEventListener('click',()=>{
        rm.block=rm.block===btn.dataset.block?'':btn.dataset.block;
        rm.floor='';
        rm.open='';
        renderRooms();
      });
    });

    const floorWrap=$('m-floor-wrap');
    if(availabilityMessage){
      floorWrap.hidden=true;
      $('m-rooms-out').innerHTML=`<div class="m-empty" role="status">${esc(availabilityMessage)}</div>`;
      return;
    }
    if(!rm.block){
      floorWrap.hidden=true;
      $('m-rooms-out').innerHTML='<div class="m-empty">Pick a block to see which rooms are open.</div>';
      return;
    }
    floorWrap.hidden=false;
    floorWrap.classList.add('m-reveal');
    // Floors come from the live BLOCK_FLOORS, not a fixed three — the blocks
    // genuinely differ (A has 0–3 + Labs, C has 1–5, D has 2–5).
    const floors=sortFloorKeys(Object.keys(BLOCK_FLOORS[rm.block]||{}));
    $('m-floor-row').innerHTML=floors.map(f=>
      `<button class="m-chip${rm.floor===f?' is-on':''}" data-floor="${esc(f)}" type="button">${esc(floorLabel(f))}</button>`
    ).join('');
    $('m-floor-row').querySelectorAll('.m-chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        rm.floor=rm.floor===btn.dataset.floor?'':btn.dataset.floor;
        rm.open='';
        renderRooms();
      });
    });

    if(!rm.floor){
      $('m-rooms-out').innerHTML='<div class="m-empty">Now pick a floor.</div>';
      return;
    }
    renderRoomList();
  }

  // A one-line answer to "when can I actually get in here?", derived from the
  // same slot vector the bar is drawn from.
  function roomSummary(slots){
    const now=nowMinutes();
    const rows=slots.map(s=>{
      const b=slotBounds(s.slot);
      return {slot:s.slot,busy:Boolean(s.occupiedBy),start:b?b[0]:0,end:b?b[1]:0};
    });
    const startOf=r=>roomTime(r.slot.split('-')[0]);
    const live=rows.find(r=>now>=r.start&&now<r.end);
    if(live&&!live.busy){
      const nextBusy=rows.find(r=>r.start>live.start&&r.busy);
      return nextBusy?`Free now — booked again at ${startOf(nextBusy)}`
                     :'Free now — nothing booked after this';
    }
    if(live&&live.busy){
      const nextFree=rows.find(r=>r.start>live.start&&!r.busy);
      return nextFree?`In use — free from ${startOf(nextFree)}`
                     :'In use — booked for the rest of the day';
    }
    // Outside the slot grid (before 08:30, or after the last slot ends).
    const nextFree=rows.find(r=>r.start>now&&!r.busy);
    if(nextFree) return `Free from ${startOf(nextFree)}`;
    return rows.some(r=>!r.busy)?'Nothing free later today':'Booked all day';
  }

  function renderRoomList(){
    const day=todayName();
    if(roomAvailabilityMessage(day)){renderRooms();return;}
    const rooms=(BLOCK_FLOORS[rm.block]||{})[rm.floor]||[];
    if(!rooms.length){
      $('m-rooms-out').innerHTML='<div class="m-empty">No rooms listed on this floor yet.</div>';
      return;
    }
    const cards=rooms.map(room=>{
      const slots=roomSlots(room,day);
      const free=freeNowFromSlots(room,day,slots);
      const open=rm.open===room;
      const currentSlot=getCurrentSlotFor(slotsForRoom(room,day));
      const currentBooking=currentSlot&&slots.find(s=>s.slot===currentSlot)?.occupiedBy;
      const summary=roomSummary(slots);
      const bars=slots.map(s=>`<span class="m-slot${s.occupiedBy?'':' is-free'}"></span>`).join('');
      const status=free===true?'Free now':free===false?'Class':'—';
      // During exams, make the active course and the next free time visible
      // without requiring the student to open the complete room timeline.
      const liveExam='';
      const detail=open?`<div class="m-room-detail" id="m-room-detail">
          <div class="m-room-summary">${esc(summary)}</div>
          <div class="m-slotrows">${slots.map(s=>{
            const busy=Boolean(s.occupiedBy);
            const who=busy?[s.occupiedBy.course,s.occupiedBy.section].filter(Boolean).join(' · '):'Free';
            return `<div class="m-slotrow">
              <span class="m-slotpill">${esc(roomTime(s.slot.split('-')[0]))}–${esc(roomTime(s.slot.split('-')[1]))}</span>
              <span class="m-slotwho${busy?'':' is-free'}">${esc(who)}</span>
            </div>`;
          }).join('')}</div>
        </div>`:'';
      const stateClass=free===true?' is-free':free===false?' is-busy':'';
      return `<div class="m-room-card${stateClass}${open?' is-open':''}">
        <button class="m-room${stateClass}" type="button" data-room="${esc(room)}"
                aria-expanded="${open}">
          <span class="m-room-name">${esc(room)}</span>
          <span class="m-slots">${bars}</span>
          <span class="m-room-status">${esc(status)}</span>
          <svg class="m-room-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        ${liveExam}
        ${detail}
      </div>`;
    }).join('');
    $('m-rooms-out').innerHTML=`<div class="m-roomlist m-reveal">${cards}</div>
      <div class="m-caption">Each bar is the day’s slots — green is free, grey is booked. A room card in red is in use right now. Tap a room to see when it frees up. Labs run four long slots instead of eight.</div>`;
    $('m-rooms-out').querySelectorAll('.m-room').forEach(btn=>{
      btn.addEventListener('click',()=>{
        rm.open=rm.open===btn.dataset.room?'':btn.dataset.room;
        renderRoomList();
      });
    });
  }
  function tickRoomsClock(){
    const el=$('m-rooms-clock');
    if(!el) return;
    el.textContent=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date());
  }
  function roomTime(value){return toAmPm(value);}

  /* ══ FACULTY ═══════════════════════════════════════════════════════ */
  const fac={q:'',dept:'All',selected:null};

  function facultyList(){
    const out=[];
    const data=(typeof FACULTY_DATA!=='undefined'&&FACULTY_DATA)||{};
    Object.keys(data).forEach(school=>{
      const depts=(data[school]&&data[school].departments)||{};
      Object.keys(depts).forEach(dept=>{
        (depts[dept].teachers||[]).forEach(t=>{
          out.push({name:t.name||'',title:t.designation||'',email:t.email||'',room:t.room||'',dept,school});
        });
      });
    });
    return out;
  }
  function deptShort(name){
    const map={'Computer Science':'CS','Artifical Intelligence':'AI','Artificial Intelligence':'AI',
      'Data Science':'DS','Cyber Security':'CY','Software Engineering':'SE',
      'Social Sciences':'SS','Mathematics':'Maths','Physics':'Physics'};
    return map[name]||name;
  }
  function renderFaculty(){
    const all=facultyList();
    const depts=['All',...Array.from(new Set(all.map(t=>t.dept)))];
    $('m-fac-depts').innerHTML=depts.map(d=>
      `<button class="m-chip is-ink${fac.dept===d?' is-on':''}" data-dept="${esc(d)}" type="button">${esc(d==='All'?'All':deptShort(d))}</button>`
    ).join('');
    $('m-fac-depts').querySelectorAll('.m-chip').forEach(btn=>{
      btn.addEventListener('click',()=>{ fac.dept=btn.dataset.dept; renderFaculty(); });
    });

    const search=$('m-fac-search');
    if(search&&search.value!==fac.q) search.value=fac.q;

    const q=fac.q.trim().toLowerCase();
    // Rank word-start matches above mid-word ones: searching "hammad" should
    // lead with Dr. Hammad, not with the 30 people named Muhammad.
    const rank=t=>{
      const name=String(t.name).toLowerCase();
      if(name.split(/\s+/).some(w=>w.startsWith(q))) return 0;
      if(name.includes(q)) return 1;
      return 2;
    };
    const filtered=all.filter(t=>{
      if(fac.dept!=='All'&&t.dept!==fac.dept) return false;
      if(!q) return true;
      return [t.name,t.title,t.room,t.dept].some(v=>String(v).toLowerCase().includes(q));
    });
    if(q) filtered.sort((a,b)=>rank(a)-rank(b));

    const out=$('m-fac-out');
    if(!all.length){ out.innerHTML='<div class="m-empty">Loading the faculty directory…</div>'; return; }
    if(!filtered.length){
      out.innerHTML='<div class="m-empty">No one by that name — try a surname or a department.</div>';
      return;
    }
    out.innerHTML='<div class="m-faclist">'+filtered.map((t,i)=>{
      const idx=all.indexOf(t);
      return `<button class="m-fac" data-idx="${idx}" type="button">
        <span class="m-fac-avatar" style="background:${i%2?'#eef1ec':'#dcebd9'}">${esc(initials(t.name))}</span>
        <span class="m-fac-main">
          <span class="m-fac-name">${esc(t.name)}</span>
          <span class="m-fac-title">${esc(t.title||deptShort(t.dept))}</span>
        </span>
        <span class="m-pill">${esc(t.room||'—')}</span>
      </button>`;
    }).join('')+'</div>';
    out.querySelectorAll('.m-fac').forEach(btn=>{
      btn.addEventListener('click',()=>{
        fac.selected=all[Number(btn.dataset.idx)];
        go('facdetail');
      });
    });
  }
  function renderFacDetail(){
    const t=fac.selected;
    const out=$('m-facdetail-out');
    if(!t){ out.innerHTML='<div class="m-empty">Pick someone from the directory.</div>'; return; }
    out.innerHTML=`<div class="m-fac-head">
        <div class="m-fac-avatar" style="background:#dcebd9">${esc(initials(t.name))}</div>
        <div class="m-fac-head-name">${esc(t.name)}</div>
        <div class="m-fac-head-title">${esc(t.title||'')}</div>
      </div>
      <div class="m-fac-actions"><button class="m-btn-primary" id="m-fac-copy" type="button">Copy email</button></div>
      <div class="m-detail-rows">
        <div class="m-drow"><div class="m-drow-label">Email</div><div class="m-drow-value">${esc(t.email||'—')}</div></div>
        <div class="m-drow"><div class="m-drow-label">Office</div><div class="m-drow-value">${esc(t.room||'—')}</div></div>
        <div class="m-drow"><div class="m-drow-label">Department</div><div class="m-drow-value">${esc(t.dept||'—')}</div></div>
        <div class="m-drow"><div class="m-drow-label">School</div><div class="m-drow-value">${esc(t.school||'—')}</div></div>
      </div>`;
    const copy=$('m-fac-copy');
    if(copy) copy.addEventListener('click',()=>{
      const email=t.email||'';
      if(!email){ toast('No email on file'); return; }
      const done=()=>toast('Email copied');
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(email).then(done,()=>toast('Could not copy'));
      else done();
    });
  }

  /* ══ EXAMS ═════════════════════════════════════════════════════════ */
  const ex={tab:'schedule',school:'computing',dept:'',batch:'',seatQuery:''};

  function examType(doc){
    const f=String((doc&&(doc.source_filename||doc.source_subject))||'').toLowerCase();
    if(/(2nd|second|\bii\b)\s*sessional/.test(f)||f.includes('sessional 2')) return 'Sessional II';
    if(/(1st|first|\bi\b)\s*sessional/.test(f)||f.includes('sessional 1')) return 'Sessional I';
    if(f.includes('sessional')) return 'Sessional';
    if(f.includes('mid')) return 'Mid-term';
    if(/final\s*(exam|term|examination)/.test(f)||f.includes('terminal')) return 'Final';
    return 'Exam';
  }
  function seedExamFilters(){
    if(ex.dept&&ex.batch) return;
    const p=profile();
    if(!p) return;
    const ownDept=typeof profileDeptCode==='function'?profileDeptCode(p):'';
    if(!ex.dept) ex.dept=ownDept;
    if(!ex.batch&&ex.dept===ownDept&&typeof profileFullBatch==='function') ex.batch=profileFullBatch(p);
  }

  function renderExams(){
    ['schedule','seating','showup'].forEach(t=>{
      const btn=$('m-seg-'+t);
      btn.classList.toggle('is-active',ex.tab===t);
      btn.setAttribute('aria-selected',String(ex.tab===t));
    });
    seedExamFilters();
    if(ex.tab==='seating') renderSeating();
    else if(ex.tab==='showup') renderShowup();
    else renderExamSchedule();
  }

  function filterChips(depts,batches){
    const schools=ex.tab==='schedule'?`<div class="m-meta-row"><span>School</span><b>${esc(ex.school.toUpperCase())}</b></div><div class="m-chip-row">${[['computing','FSC'],['engineering','FSE'],['business','FSM']].map(([v,l])=>`<button class="m-chip${ex.school===v?' is-on':''}" data-ex="school" data-value="${v}" type="button">${l}</button>`).join('')}</div>`:'';
    return schools+`<div class="m-meta-row"><span>Department</span><b style="${ex.dept?'':'color:rgba(22,33,15,.35)'}">${esc(ex.dept||'—')}</b></div>
      <div class="m-chip-row">${depts.map(d=>`<button class="m-chip${ex.dept===d?' is-on':''}" data-ex="dept" data-value="${esc(d)}" type="button">${esc(d)}</button>`).join('')}</div>
      <div class="m-meta-row"><span>Batch</span><b style="${ex.batch?'':'color:rgba(22,33,15,.35)'}">${esc(ex.batch||'—')}</b></div>
      <div class="m-chip-row">${batches.map(b=>`<button class="m-chip${ex.batch===b?' is-on':''}" data-ex="batch" data-value="${esc(b)}" type="button">${esc(b)}</button>`).join('')}</div>`;
  }
  function wireFilterChips(){
    $('m-exam-filters').querySelectorAll('.m-chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const k=btn.dataset.ex;
        const value=ex[k]===btn.dataset.value?'':btn.dataset.value;
        ex[k]=value;
        if(k==='dept') ex.batch='';
        if(k==='school'){
          ex.dept=''; ex.batch='';
          if(typeof setExamSchool==='function') setExamSchool(ex.school);
        }
        renderExams();
      });
    });
  }

  function renderExamSchedule(){
    if(typeof _examSchool!=='undefined') _examSchool=ex.school;
    loadExamScheduleData().then(doc=>{
      if(ex.tab!=='schedule') return;
      const exams=(doc&&doc.exams)||[];
      const selectedExams=exams.filter(e=>typeof examMatchesMyCourse==='function'&&examMatchesMyCourse(e));
      const depts=Array.from(new Set(exams.flatMap(e=>Object.keys(e.sections||{})))).sort();
      // A profile may carry CS from FSC. Clear it when the selected school's
      // data only contains another department set, such as EE/CE for FSE.
      if(ex.dept&&!depts.includes(ex.dept)){ ex.dept=''; ex.batch=''; }
      const batches=Array.from(new Set(exams
        .filter(e=>!ex.dept||(e.sections&&e.sections[ex.dept]))
        .map(e=>String(e.batch||'')).filter(Boolean))).sort();
      $('m-exam-filters').innerHTML=filterChips(depts,batches);
      wireFilterChips();

      const out=$('m-exam-out');
      const usesMyCourses=typeof examUsesMyCourses==='function'&&examUsesMyCourses(ex.dept,ex.batch);
      if(usesMyCourses&&!selectedExams.length){
        out.innerHTML='<div class="m-empty">No courses selected locally. Add courses to My Courses to see their papers here.</div>';
        return;
      }
      if(!ex.dept||!ex.batch){
        out.innerHTML='<div class="m-empty">Pick a department and batch to see the exam schedule.</div>';
        return;
      }
      const mine=examsForDeptBatch(ex.dept,ex.batch)
        .slice().sort(compareExamDateTime);
      if(!mine.length){ out.innerHTML='<div class="m-empty">No exams published for that department and batch.</div>'; return; }

      const today=new Date().toISOString().slice(0,10);
      const next=mine.find(e=>String(e.date||'')>=today);
      let html='';
      if(next){
        const days=Math.max(0,Math.round((new Date(next.date+'T00:00:00')-new Date(today+'T00:00:00'))/86400000));
        html+=`<div class="m-hero-dark"><div class="m-hero-kicker">Next paper in</div>
          <div class="m-hero-big">${days===0?'Today':days+' day'+(days===1?'':'s')}</div>
          <div class="m-hero-line">${esc(next.course||next.code||'')} · ${esc(next.date||'')} · ${esc(next.time||'')}</div></div>`;
      }
      html+=`<div class="m-section-label">${esc(examType(doc))} schedule</div><div class="m-rows m-reveal">`;
      html+=mine.map(e=>{
        const d=e.date?new Date(e.date+'T00:00:00'):null;
        const isNext=next&&e===next;
        return `<div class="m-exam${isNext?' is-next':''}">
          <div class="m-exam-date"><span class="m-exam-day">${d?d.getDate():'—'}</span>
            <span class="m-exam-mon">${d?d.toLocaleDateString('en-GB',{month:'short'}):''}</span></div>
          <div class="m-exam-main">
            <div class="m-exam-name">${esc(typeof examCourseName==='function'?examCourseName(e):(e.course||e.code||'Exam'))}</div>
            <div class="m-exam-meta">${esc(e.day||'')} · ${esc(e.time||'—')}${e.code?' · '+esc(e.code):''}</div>
          </div>
        </div>`;
      }).join('')+'</div>';
      out.innerHTML=html;
    }).catch(()=>{
      $('m-exam-filters').innerHTML='';
      $('m-exam-out').innerHTML='<div class="m-empty">Exam schedule is unavailable right now.</div>';
    });
  }

  function renderShowup(){
    loadShowupScheduleData().then(doc=>{
      if(ex.tab!=='showup') return;
      const exams=(doc&&doc.exams)||[];
      const depts=Array.from(new Set(exams.flatMap(e=>Object.keys(e.sections||{})))).sort();
      const batches=Array.from(new Set(exams.map(e=>String(e.batch||'')).filter(Boolean))).sort();
      $('m-exam-filters').innerHTML=filterChips(depts,batches);
      wireFilterChips();

      const out=$('m-exam-out');
      if(!ex.dept||!ex.batch){
        out.innerHTML='<div class="m-empty">Pick a department and batch to see the show-up schedule.</div>';
        return;
      }
      let mine=showupForDeptBatch(ex.dept,ex.batch);
      const p=profile();
      const sec=p?String(p.section||'').replace(/\d+$/,'').toUpperCase():'';
      if(sec){
        const forMe=mine.filter(e=>(e.sections[ex.dept]||[]).some(t=>String(t).replace(/\d+$/,'').toUpperCase()===sec));
        if(forMe.length) mine=forMe;
      }
      mine=mine.slice().sort(compareExamDateTime);
      if(!mine.length){ out.innerHTML='<div class="m-empty">No show-up slots published for that department and batch.</div>'; return; }

      out.innerHTML=`<div class="m-section-label">Show-up schedule</div><div class="m-rows m-reveal">`+mine.map(e=>{
        const d=e.date?new Date(e.date+'T00:00:00'):null;
        return `<div class="m-exam">
          <div class="m-exam-date"><span class="m-exam-day">${d?d.getDate():'—'}</span>
            <span class="m-exam-mon">${d?d.toLocaleDateString('en-GB',{month:'short'}):''}</span></div>
          <div class="m-exam-main">
            <div class="m-exam-name">${esc(e.course||e.code||'Show-up')}</div>
            <div class="m-exam-meta">${esc(e.time||'—')} · ${esc(e.venue||'—')}${e.teacher?' · '+esc(e.teacher):''}</div>
          </div>
        </div>`;
      }).join('')+'</div>';
    }).catch(()=>{
      $('m-exam-filters').innerHTML='';
      $('m-exam-out').innerHTML='<div class="m-empty">Show-up schedule is unavailable right now.</div>';
    });
  }

  // Seat lookup only. The seating plan carries no room, and its C#R#
  // coordinates repeat across rooms (8 students share "C1R1"), so a seat map
  // cannot be drawn from it — see too_do.md.
  function renderSeating(){
    const p=profile();
    if(!ex.seatQuery&&p&&p.nuid) ex.seatQuery=p.nuid;
    $('m-exam-filters').innerHTML=`<div class="m-search-wrap">
        <svg class="m-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="m-search" id="m-seat-input" type="search" placeholder="NU ID or name…" value="${esc(ex.seatQuery)}" aria-label="Search the seating plan">
      </div>`;
    const input=$('m-seat-input');
    if(input){
      input.addEventListener('input',()=>{ ex.seatQuery=input.value; runSeatSearch(); });
    }
    runSeatSearch();
  }
  function runSeatSearch(){
    const out=$('m-exam-out');
    const q=ex.seatQuery.trim();
    if(!q){ out.innerHTML='<div class="m-empty">Search your NU ID to find your seat.</div>'; return; }
    loadSeatingPlanData().then(doc=>{
      if(ex.tab!=='seating') return;
      const matches=findSeatingMatches(q);
      if(!matches.length){
        out.innerHTML='<div class="m-empty">No seat found for that NU ID in the current plan.</div>';
        return;
      }
      out.innerHTML=matches.slice(0,8).map(s=>`<div class="m-seat-card m-reveal" style="margin-bottom:10px">
          <div class="m-seat-name">${esc(s.name||'Student')}</div>
          <div class="m-seat-label">${esc(s.nuid||'')}</div>
          <div class="m-seat-meta">${esc(s.paper||'—')} · ${esc(s.time||'—')} · <span class="m-seat-room">${esc(s.class||'—')}</span></div>
          <div class="m-seat-value">${esc(s.seat||'—')}</div>
        </div>`).join('')+
        `<div class="m-caption">${esc((doc&&doc.source_subject)||'Current seating plan')}</div>`;
    }).catch(()=>{
      out.innerHTML='<div class="m-empty">Seating plan is unavailable right now.</div>';
    });
  }

  /* ══ ARCADE ════════════════════════════════════════════════════════
     Double-tap the Today banner. The games are app.js's — this only supplies
     the phone chrome and the touch controls.

     How the borrowing works: each game IIFE in app.js closes over its own
     <canvas> element and drives a rAF loop that runs for exactly as long as
     its desktop overlay carries the class `on`. So the overlay must stay
     "open" while a game is running; css/mobile.css hides it instead, and the
     canvas is moved into the stage below. Nothing about the games' state,
     scoring, or leaderboards is duplicated here.

     Compiler Chess is not a built game on the desktop either — it is a mode
     picker that answers "coming soon" — so it is presented as exactly that. */
  const GAMES=[
    // duckZone: Compiler Run is the one game with a second action (ArrowDown)
    // and no touch equivalent, so its canvas is split instead of given a
    // button. See wireDuckZone().
    {id:'run',name:'Compiler Run',emoji:'🖥️',desc:'Jump the virus, duck the AI',
     canvas:'cr-canvas',lb:'cr-lb',best:'compiler_run_hi',
     open:'openCompilerRun',close:'closeCompilerRun',
     duckZone:true,restartKey:'Space',overLabel:'SYSTEM CRASH',unit:'points'},
    // Duck Hunter's input is a POSITION rather than a press. It recovers that
    // from the canvas rect itself, which is correct now the stage no longer
    // applies a transform, so it needs nothing wired here.
    {id:'duck',name:'Duck Hunter',emoji:'🦆',desc:"Shoot the ducks, don't let them escape",
     canvas:'dh-canvas',lb:'dh-lb',best:'duck_hunter_hi',
     open:'openDuckHunter',close:'closeDuckHunter',
     overLabel:'OUT OF LIVES',unit:'ducks'},
    {id:'flappy',name:'Flappy Byte',emoji:'🐦',desc:'Tap to fly through the pipes',
     canvas:'fb-canvas',lb:'fb-lb',best:'flappy_byte_hi',
     open:'openFlappy',close:'closeFlappy',
     restartKey:'Space',overLabel:'CRASHED',unit:'pipes'},
    {id:'chess',name:'Compiler Chess',emoji:'♛',desc:'Choose how to play',soon:true,
     modes:[['♟','1V1','Two players, one device'],
            ['🤝','PLAY WITH FRIEND','Invite a friend to a match'],
            ['🤖','VS COMPILER ENGINE','Play against the computer']]}
  ];

  let arcadeGame=null;              // the game currently on screen
  let arcadeOpenedAt=0;             // see the guard in the picker's click handler
  const borrowedHome=new Map();     // element -> the parent it must go back to

  function borrow(id,into){
    const el=id&&document.getElementById(id);
    if(!el||!into) return;
    if(!borrowedHome.has(el)) borrowedHome.set(el,el.parentNode);
    into.appendChild(el);
  }
  function returnAllBorrowed(){
    borrowedHome.forEach((home,el)=>{
      // Hand the field back to the desktop 720x220 — setGameField clears the
      // inline sizing layoutStage() applied, so the modal gets its own shape.
      if(el.tagName==='CANVAS' && typeof window.setGameField==='function') window.setGameField(el.id,0,0);
      if(home) home.appendChild(el);
    });
    borrowedHome.clear();
  }

  function bestFor(g){
    if(!g.best) return '';
    try{ return String(parseInt(localStorage.getItem(g.best)||'0',10)||0); }catch(e){ return ''; }
  }

  function openArcade(){
    const wrap=$('m-arcade');
    if(!wrap) return;
    arcadeOpenedAt=Date.now();
    wrap.hidden=false;
    showPicker();
  }
  function closeArcade(){
    stopGame();
    const wrap=$('m-arcade');
    if(wrap) wrap.hidden=true;
  }

  function showPicker(){
    stopGame();
    $('m-arcade-kicker').textContent='COMPILER SOCIETY';
    $('m-arcade-title').textContent='Arcade';
    $('m-arcade-play').hidden=true;
    const pick=$('m-arcade-pick');
    pick.hidden=false;
    pick.innerHTML=GAMES.map(g=>{
      const best=bestFor(g);
      return `<button class="m-game-card${g.soon?' is-soon':''}" type="button" data-game="${g.id}">
        <span class="m-game-emoji">${g.emoji}</span>
        <span class="m-game-text">
          <span class="m-game-name">${esc(g.name)}${g.soon?'<span class="m-soon">Soon</span>':''}</span>
          <span class="m-game-desc">${esc(g.desc)}</span>
        </span>
        ${best&&best!=='0'?`<span class="m-game-best">Best ${esc(best)}</span>`:''}
      </button>`;
    }).join('');
    pick.querySelectorAll('.m-game-card').forEach(btn=>{
      btn.addEventListener('click',()=>{
        // A double-TAP opens this screen, and the browser then delivers the
        // second tap's `click` to whatever now sits under the finger — which
        // was a game card, so the arcade appeared to skip the picker and boot
        // straight into Duck Hunter. Ignore anything arriving in the same
        // breath as the open.
        if(Date.now()-arcadeOpenedAt<500) return;
        const g=GAMES.find(x=>x.id===btn.dataset.game);
        if(g) g.soon?showSoon(g):startGame(g);
      });
    });
  }

  // Chess: the three modes, each answering "coming soon" — the same thing the
  // desktop mode picker does, rather than a card that leads nowhere.
  function showSoon(g){
    $('m-arcade-kicker').textContent='CHOOSE HOW TO PLAY';
    $('m-arcade-title').textContent=g.name;
    $('m-arcade-pick').hidden=true;
    $('m-arcade-play').hidden=false;
    $('m-play-modes').innerHTML=(g.modes||[]).map(([emoji,name,desc])=>
      `<button class="m-game-card" type="button" data-mode="${esc(name)}">
        <span class="m-game-emoji">${emoji}</span>
        <span class="m-game-text">
          <span class="m-game-name">${esc(name)}</span>
          <span class="m-game-desc">${esc(desc)}</span>
        </span>
      </button>`).join('')+
      `<div class="m-soon-note" id="m-chess-soon" hidden></div>
       <button class="m-btn-ghost" id="m-modes-back" type="button">&lsaquo; All games</button>`;
    $('m-play-modes').querySelectorAll('.m-game-card').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const note=$('m-chess-soon');
        if(note){ note.textContent='🚧 '+btn.dataset.mode+' — stay tuned, coming soon!'; note.hidden=false; }
      });
    });
    $('m-modes-back').addEventListener('click',showPicker);
  }

  /* ── Filling the screen ────────────────────────────────────────────────
     The field used to be frozen at 720x220, which laid flat across a 390px
     phone is 390x119 — about 14% of the screen. The arcade answered that by
     turning the canvas 90deg onto the phone's long axis, so a game in a
     portrait-locked app played sideways and asked the student to tilt the
     phone the app itself refuses to rotate into.

     The field is a variable in js/app.js now (setGameField), so the stage just
     hands over the upright box it has and the game lays itself out to fit.
     Portrait, full width, no transform, and roughly 6x the play area of the
     old flat layout. */
  function layoutStage(){
    const g=arcadeGame; if(!g) return;
    const cv=document.getElementById(g.canvas), host=$('m-stage-full');
    if(!cv||!host||typeof window.setGameField!=='function') return;
    const vw=host.clientWidth, vh=host.clientHeight;
    if(!vw||!vh) return;
    // Full width, and as much height as the stage gives — floored so the field
    // is never shorter than it is wide, capped so a tall phone does not
    // stretch it past what stays readable at arm's length.
    if(DESK.matches){
      // A window, not a phone: a landscape field framed inside the stage,
      // short enough that the whole thing stays on screen.
      const w=Math.round(Math.min(vw-64, 1000));
      const h=Math.round(Math.min(vh-112, w*0.62));
      window.setGameField(g.canvas, w, h);
      return;
    }
    const w=Math.round(vw);
    const h=Math.round(Math.min(w*1.6, Math.max(w, vh)));
    window.setGameField(g.canvas, w, h);
  }

  function startGame(g){
    stopGame();
    arcadeGame=g;
    $('m-stage-full').hidden=false;
    $('m-dead').hidden=true;
    borrow(g.canvas,$('m-play-stage'));
    layoutStage();
    if(g.duckZone) wireDuckZone(g);
    // Starts the game's own loop and its leaderboard polling. The board stays
    // off screen until the run ends — it is still loading in the background so
    // it is ready the moment it is needed.
    if(typeof window[g.open]==='function') window[g.open]();
  }

  function stopGame(){
    if(arcadeGame&&typeof window[arcadeGame.close]==='function') window[arcadeGame.close]();
    arcadeGame=null;
    releaseDuck();
    returnAllBorrowed();
    const stage=$('m-stage-full');
    if(stage) stage.hidden=true;
    const dead=$('m-dead');
    if(dead) dead.hidden=true;
    const lb=$('m-play-lb');
    if(lb) lb.innerHTML='';
  }

  /* ── Compiler Run's duck, without a button ─────────────────────────────
     Every other input in these games is "tap the canvas", which is why there
     are no on-screen controls. Compiler Run is the exception: it has a second
     action bound to ArrowDown with no touch equivalent at all, which left the
     AI flyers impossible to avoid on a phone.

     So the canvas is split: a touch in the lower part ducks and holds, and
     anywhere above it is the jump the game already handles. The listener runs
     in the capture phase and stops the event, so the game's own
     pointerdown -> jump() never sees a duck. */
  const DUCK_ZONE=0.62;   // fraction of the canvas height below which a touch ducks
  let duckHeld=false, duckWired=null;
  function sendKey(type,code){
    const ev=new KeyboardEvent(type,{code,key:code==='Space'?' ':code,bubbles:true,cancelable:true});
    return document.dispatchEvent(ev)===false;
  }
  function releaseDuck(){
    if(!duckHeld) return;
    duckHeld=false;
    sendKey('keyup','ArrowDown');
  }
  function wireDuckZone(g){
    const cv=document.getElementById(g.canvas);
    if(!cv||cv===duckWired) return;   // listeners are permanent; wire each canvas once
    duckWired=cv;
    cv.addEventListener('pointerdown',ev=>{
      if(!arcadeGame||arcadeGame.canvas!==cv.id) return;   // not the game on screen
      const r=cv.getBoundingClientRect();
      if(!r.height || (ev.clientY-r.top)/r.height < DUCK_ZONE) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      duckHeld=true;
      sendKey('keydown','ArrowDown');
    },true);
    // Release wherever the finger lifts — including off the canvas, which would
    // otherwise leave the player ducking for the rest of the run.
    ['pointerup','pointercancel'].forEach(t=>window.addEventListener(t,releaseDuck));
  }

  /* ── You died ──────────────────────────────────────────────────────────
     app.js fires this from each game's gameOver(). Only now does the
     leaderboard come on screen. */
  function onGameOver(ev){
    if(!arcadeGame) return;
    const d=(ev&&ev.detail)||{};
    if(d.game&&d.game!==arcadeGame.id) return;
    releaseDuck();
    $('m-dead-kicker').textContent=arcadeGame.overLabel||'GAME OVER';
    $('m-dead-score').innerHTML=esc(String(d.score==null?'—':d.score))+
      ` <span>${esc(arcadeGame.unit||'points')} · best ${esc(String(d.best==null?'—':d.best))}</span>`;
    borrow(arcadeGame.lb,$('m-play-lb'));
    $('m-dead').hidden=false;
  }

  function playAgain(){
    if(!arcadeGame) return;
    $('m-dead').hidden=true;
    // Each game restarts out of its 'over' state on the same input that plays
    // it, so replay that input rather than reaching into the game's closure.
    // A key where one exists — a synthetic tap would have to dodge Compiler
    // Run's duck zone, and Duck Hunter ignores the coordinates while it is over.
    if(arcadeGame.restartKey){ sendKey('keydown',arcadeGame.restartKey); sendKey('keyup',arcadeGame.restartKey); return; }
    const cv=document.getElementById(arcadeGame.canvas);
    if(cv) cv.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:0,clientY:0}));
  }


  /* ══ MY COURSES SHEET ═══════════════════════════════════════════════
     Opened from the button on Today. Shows the effective list (the
     student's own section by default, plus whatever they added, minus
     whatever they removed) with a remove control on every row, and a
     compact add-a-course cascade below it.

     The cascade is a second, independent copy of Lookup's school → program →
     batch → section → course steps, on its own state object (`mc`, not
     `lk`) so opening this sheet can never disturb whatever a student is
     mid-way through browsing in Lookup. */
  const mc={school:'',program:'',batch:'',section:'',course:''};

  function openCoursesSheet(){
    const wrap=$('m-courses-sheet');
    if(!wrap) return;
    wrap.hidden=false;
    // Defaults to the student's own school, if one is known, so adding a
    // course usually starts from the school the student is actually in.
    const p=(typeof profile==='function')?profile():null;
    if(p&&!mc.school) mc.school=p.school||(typeof profileIsComputing==='function'&&profileIsComputing(p)?'computing':'computing');
    renderCoursesSheet();
  }
  function closeCoursesSheet(){
    const wrap=$('m-courses-sheet');
    if(wrap) wrap.hidden=true;
  }

  function renderCoursesSheet(){
    renderCoursesList();
    renderCourseAddFields();
  }

  function renderCoursesList(){
    const host=$('m-courses-list');
    const btnCount=$('m-courses-btn-count');
    if(!host) return;
    const list=(typeof getMyCourses==='function')?getMyCourses():[];
    if(btnCount){
      if(list.length){ btnCount.hidden=false; btnCount.textContent=String(list.length); }
      else btnCount.hidden=true;
    }
    if(!list.length){
      host.innerHTML='<div class="m-empty">Nothing here yet. Your section&#39;s classes will appear once your profile is set up.</div>';
      return;
    }
    host.innerHTML='<div class="m-section-label">Your courses ('+list.length+')</div>'+
      '<div class="m-course-list" id="m-course-list">'+list.map(c=>{
        const key=myCourseKey(c);
        const origin=(String(c.dept||'').replace(/^BS\s+/,'')+' '+(c.batch||'')+(c.section?('-'+c.section):'')).trim();
        const tag=c.isDefault?'<span class="m-course-tag">SECTION</span>':'<span class="m-course-tag is-added">ADDED</span>';
        return '<div class="m-course-row"><span class="m-course-text">'
          +'<span class="m-course-name">'+esc(c.name)+tag+'</span>'
          +'<span class="m-course-origin">'+esc(origin)+'</span></span>'
          +'<button class="m-course-remove" type="button" data-key="'+esc(key)+'" aria-label="Remove '+esc(c.name)+'">&times;</button></div>';
      }).join('')+'</div>';
    host.querySelectorAll('.m-course-remove').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const course=getMyCourses().find(c=>myCourseKey(c)===btn.dataset.key);
        if(course) removeMyCourse(course);
        renderCoursesSheet();
        if(route==='today') renderToday();
        toast('Course removed');
      });
    });
  }

  function renderCourseAddFields(){
    const fieldsHost=$('mc-fields');
    if(!fieldsHost) return;
    const src=(typeof ttFor==='function')?(ttFor(mc.school)||{}):{};
    const programs=Object.keys(src||{});
    if(mc.program&&!programs.includes(mc.program)) mc.program='';
    const batches=mc.program?Object.keys(src[mc.program]||{}):[];
    if(mc.batch&&!batches.includes(mc.batch)) mc.batch='';
    const sections=(mc.program&&mc.batch)
      ? Object.keys(src[mc.program][mc.batch]||{}).filter(s=>s!==ALL_SECTIONS)
          .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
      : [];
    if(mc.section&&!sections.includes(mc.section)) mc.section='';
    const courseNames=[];
    if(mc.program&&mc.batch&&mc.section){
      const seen=new Set();
      [mc.section,ALL_SECTIONS].forEach(sec=>{
        const days=((src[mc.program]||{})[mc.batch]||{})[sec]||{};
        Object.values(days).forEach(arr=>(arr||[]).forEach(e=>{
          const n=(typeof stripNote==='function'?stripNote(e.name||e.c||''):(e.name||e.c||'')).trim();
          if(n&&!seen.has(n)){ seen.add(n); courseNames.push(n); }
        }));
      });
      courseNames.sort();
    }
    if(mc.course&&!courseNames.includes(mc.course)) mc.course='';

    const batchLabel=b=>b==='REPEAT'?'Repeat':b;
    fieldsHost.innerHTML=[
      fieldHTML('School','mc-school',mc.school?SCHOOL_LABELS[mc.school]:'',Object.keys(SCHOOL_LABELS),mc.school,k=>SCHOOL_LABELS[k]),
      fieldHTML('Program','mc-program',mc.program,programs,mc.program),
      fieldHTML('Batch','mc-batch',batchLabel(mc.batch),batches,mc.batch,batchLabel,'Pick a program first.'),
      fieldHTML('Section','mc-section',mc.section,sections,mc.section,null,'Pick a batch first.'),
      fieldHTML('Course','mc-course',mc.course,courseNames,mc.course,null,'Pick a section first.')
    ].join('');
    fieldsHost.querySelectorAll('.m-chip').forEach(chip=>{
      chip.addEventListener('click',()=>onCourseAddPick(chip.dataset.field,chip.dataset.value));
    });
    renderCourseAddButton(courseNames);
  }

  function onCourseAddPick(field,value){
    if(field==='mc-school'){
      if(mc.school===value) return;
      mc.school=value; mc.program=''; mc.batch=''; mc.section=''; mc.course='';
      // Loads that school's sheet if it has not been opened yet this session,
      // exactly as picking a school in Lookup does.
      const sel=$('school');
      if(sel && sel.value!==value){ sel.value=value; if(typeof onSchoolChange==='function') onSchoolChange(); }
      renderCourseAddFields();
      return;
    }
    if(field==='mc-program'){ mc.program=mc.program===value?'':value; mc.batch=''; mc.section=''; mc.course=''; }
    else if(field==='mc-batch'){ mc.batch=mc.batch===value?'':value; mc.section=''; mc.course=''; }
    else if(field==='mc-section'){ mc.section=mc.section===value?'':value; mc.course=''; }
    else if(field==='mc-course'){ mc.course=mc.course===value?'':value; }
    renderCourseAddFields();
  }

  function renderCourseAddButton(courseNames){
    const host=$('mc-add');
    if(!host) return;
    if(!mc.course||!courseNames.length){ host.innerHTML=''; return; }
    const already=(typeof getMyCourses==='function') && getMyCourses().some(c=>
      String(c.name).trim().toUpperCase()===mc.course.trim().toUpperCase()
      && c.dept===mc.program && c.batch===mc.batch && c.section===mc.section);
    host.innerHTML='<button class="m-btn-primary m-course-add" type="button"'+(already?' disabled':'')+'>'
      +(already?'Already in your courses':'+ Add "'+esc(mc.course)+'" to my courses')+'</button>'
      +'<div class="m-course-status" id="mc-add-status" role="status" aria-live="polite"></div>';
    const btn=host.querySelector('.m-course-add');
    if(btn&&!already) btn.addEventListener('click',addCourseFromSheet);
  }

  function addCourseFromSheet(){
    const el=$('mc-add-status');
    const say=(m,bad)=>{ if(el){ el.textContent=m; el.classList.toggle('is-error',!!bad); } };
    if(typeof addMyCourse!=='function'){ say('Course saving is unavailable.',true); return; }
    if(!(typeof profile==='function'&&profile())){ say('Set up your profile first — courses are saved with it.',true); return; }
    const res=addMyCourse({school:mc.school,dept:mc.program,batch:mc.batch,section:mc.section,name:mc.course});
    if(!res.ok){
      say(res.reason==='duplicate'?'Already in your courses.'
        :res.reason==='full'?'You have reached the saved-course limit.'
        :'Set up your profile first — courses are saved with it.',true);
      return;
    }
    toast('Added '+mc.course);
    renderCoursesSheet();
    if(route==='today') renderToday();
  }

  function wireCoursesSheet(){
    const btn=$('m-courses-btn');
    const close=$('m-courses-close');
    if(btn) btn.addEventListener('click',openCoursesSheet);
    if(close) close.addEventListener('click',closeCoursesSheet);
    renderCoursesList(); // populate the header badge on load
  }


  /* Friends are a separate device-local address book, never profile/roster writes. */
  const FRIENDS_KEY='vtable_friends_v1';
  const SELF_FRIEND_MESSAGE='bazeecha-e-atfal ha dunia mery aagy\nhota ha shab-o-roz tamasha mery aagy';
  const SELF_FRIEND_URDU='بازیچۂ اطفال ہے دنیا مرے آگے\nہوتا ہے شب و روز تماشا مرے آگے';
  let selfFriendQuoteOpener=null;
  function closeSelfFriendQuote(){
    const el=$('m-toast');
    if(!el||el.hidden||!el.classList.contains('m-friend-quote')) return;
    clearTimeout(toastTimer);
    el.hidden=true;
    if(el.contains(document.activeElement)&&selfFriendQuoteOpener?.isConnected) selfFriendQuoteOpener.focus();
  }
  function showSelfFriendQuote(){
    friendStatus('');
    const el=$('m-toast');
    if(!el) return;
    clearTimeout(toastTimer);
    el.classList.add('m-friend-quote');
    selfFriendQuoteOpener=document.activeElement;
    el.innerHTML=`<button class="m-friend-quote-close" type="button" aria-label="Close quote">&times;</button><p lang="ur-Latn" dir="ltr">${esc(SELF_FRIEND_MESSAGE)}</p><p lang="ur" dir="rtl">${esc(SELF_FRIEND_URDU)}</p>`;
    el.hidden=false;
    const close=el.querySelector('.m-friend-quote-close');
    close.addEventListener('click',closeSelfFriendQuote);
    close.focus({preventScroll:true});
    toastTimer=setTimeout(closeSelfFriendQuote,10000);
  }
  const friendView={mode:'list',selected:null,request:0,opener:null};
  function isOwnFriendId(nuid){
    const owner=typeof getProfileCookie==='function'?getProfileCookie():null;
    return !!owner?.nuid&&formatNuid(owner.nuid)===formatNuid(nuid);
  }
  function readFriends(){
    const raw=JSON.parse(localStorage.getItem(FRIENDS_KEY)||'[]');
    if(!Array.isArray(raw)) throw new Error('Saved friends could not be read.');
    return raw.filter(f=>f&&typeof f.nuid==='string'&&typeof f.name==='string'&&!isOwnFriendId(f.nuid));
  }
  function writeFriends(list){
    localStorage.setItem(FRIENDS_KEY,JSON.stringify(list));
    updateFriendsButton();
    if(typeof queueAccountSync==='function') queueAccountSync();
  }

  /* Friendships live on the server (api/friends.mjs). The address book above
     is what you saved; a friendship is what they agreed to. Only an accepted
     friendship returns their saved profile, which is what shows their real
     section and their repeat/extra courses. */
  const friendServer={loaded:false,loading:null,error:'',friends:[],incoming:[],outgoing:[]};
  function friendsSignedIn(){
    return typeof PROFILE_AUTH_ACCOUNT!=='undefined'&&!!PROFILE_AUTH_ACCOUNT;
  }
  function loadFriendServer(){
    if(!friendsSignedIn()){
      Object.assign(friendServer,{loaded:false,error:'',friends:[],incoming:[],outgoing:[]});
      return Promise.resolve();
    }
    if(friendServer.loading) return friendServer.loading;
    friendServer.loading=(async()=>{
      try{
        const res=await fetch('/api/friends',{credentials:'same-origin',cache:'no-store'});
        const data=await res.json().catch(()=>null);
        if(!res.ok||!data||!data.ok) throw new Error((data&&data.message)||'Friends are unavailable right now.');
        Object.assign(friendServer,{loaded:true,error:'',friends:data.friends||[],
          incoming:data.incoming||[],outgoing:data.outgoing||[]});
        mergeAcceptedFriends();
      }catch(e){
        friendServer.error=e.message||'Friends are unavailable right now.';
      }finally{
        friendServer.loading=null;
      }
    })();
    return friendServer.loading;
  }
  // Where a saved profile's timetable lives. Same rules as profileKeys(): a
  // hand-picked FSE/FSM batch is stored as the timetable keys it.
  function friendScope(p){
    if(!p) return null;
    const dept=String(p.department||'').trim();
    const batch=p.manual?String(p.batch||''):profileFullBatch(p);
    const sec=String(p.section||'').trim().toUpperCase();
    const school=p.school||(profileIsComputing(p)?'computing':'');
    if(!dept||!batch||!sec||!school) return null;
    return {school,dept,batch,sec};
  }
  // A friend accepted elsewhere (another device, or they asked you) joins the
  // address book from their own saved profile.
  function mergeAcceptedFriends(){
    let list;
    try{ list=readFriends(); }catch(e){ return; }
    let changed=false;
    friendServer.friends.forEach(f=>{
      if(list.some(x=>x.nuid===f.nuid)) return;
      const scope=friendScope(f.profile);
      list.push({nuid:f.nuid,name:f.profile?.name||f.nuid,school:scope?.school||'computing',
        department:scope?.dept||'',batch:scope?.batch||'',section:scope?.sec||''});
      changed=true;
    });
    if(changed){ try{ writeFriends(list); }catch(e){ /* storage unavailable */ } }
  }
  function friendState(nuid){
    if(friendServer.friends.some(f=>f.nuid===nuid)) return 'accepted';
    if(friendServer.outgoing.some(f=>f.nuid===nuid)) return 'pending';
    return 'none';
  }
  async function friendAction(action,nuid){
    const res=await fetch('/api/friends',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,nuid})
    });
    const data=await res.json().catch(()=>null);
    if(!res.ok||!data||!data.ok){
      const err=new Error((data&&data.message)||'That did not work. Try again.');
      err.code=data&&data.error;
      throw err;
    }
    await loadFriendServer();
    return data;
  }
  function updateFriendsButton(){
    const btn=$('m-friends-btn');
    if(!btn) return;
    // Waiting requests keep the button visible even with no saved friends;
    // otherwise someone new would never see who asked them.
    const waiting=friendsSignedIn()?friendServer.incoming.length:0;
    const hint=btn.querySelector('small');
    if(hint) hint.textContent=waiting
      ?`${waiting} friend request${waiting===1?'':'s'} waiting`
      :"View your friends' weekly timetables";
    try{
      const count=readFriends().length;
      btn.hidden=count===0&&!waiting;
      $('m-friends-count').textContent=String(count);
    }catch(e){ btn.hidden=false; $('m-friends-count').textContent='!'; }
  }
  function openFriends(mode='list'){
    friendView.opener=document.activeElement;
    $('m-friends-sheet').hidden=false;
    $('m-main').inert=true;
    if(mode==='add') renderFriendLookup(); else renderFriendsList();
    $('m-friends-close').focus();
  }
  function closeFriends(){
    closeSelfFriendQuote();
    const sheet=$('m-friends-sheet');
    if(!sheet||sheet.hidden) return;
    friendView.request++;
    sheet.hidden=true;
    $('m-main').inert=false;
    if(friendView.opener?.isConnected) friendView.opener.focus();
  }
  function friendStatus(message){
    const status=$('m-friend-status');
    if(status) status.textContent=message;
  }
  function renderFriendsList(fresh){
    const request=++friendView.request;
    friendView.mode='list';
    $('m-friends-title').textContent='My Friends';
    const host=$('m-friends-body');
    let friends;
    try{ friends=readFriends(); }
    catch(e){ host.innerHTML='<div class="m-empty">Saved friends could not be read on this device.</div>'; return; }
    const signedIn=friendsSignedIn();
    const stateLabel={accepted:'Friends &middot; sees courses',pending:'Request sent'};
    const incoming=signedIn?friendServer.incoming:[];
    host.innerHTML=(incoming.length?'<div class="m-section-label">Friend requests</div><div class="m-friend-list">'
        +incoming.map(r=>`<div class="m-friend-row">
          <div class="m-friend-open"><span class="m-course-name">${esc(r.name||r.nuid)}</span>
            <span class="m-course-origin">${esc(r.nuid)} wants to share timetables</span></div>
          <button class="m-chip" type="button" data-accept-friend="${esc(r.nuid)}">Accept</button>
          <button class="m-course-remove" type="button" data-decline-friend="${esc(r.nuid)}" aria-label="Decline ${esc(r.name||r.nuid)}">&times;</button>
        </div>`).join('')+'</div>':'')
      +'<p class="m-friends-copy">'+(signedIn
        ?'Choose a friend to view their week. Once they accept your request you also see their repeat and extra courses.'
        :'Choose a friend to view their published weekly timetable. Sign in to send friend requests and see their courses.')+'</p>'
      +'<div class="m-friend-list">'+(friends.length?friends.map(f=>{
        const state=signedIn?friendState(f.nuid):'none';
        return `<div class="m-friend-row">
        <button class="m-friend-open" type="button" data-friend="${esc(f.nuid)}">
          <span class="m-course-name">${esc(f.name)}</span>
          <span class="m-course-origin">${esc(f.nuid)} &middot; ${esc(f.department)} ${esc(f.batch)}-${esc(f.section)}${stateLabel[state]?' &middot; '+stateLabel[state]:''}</span>
        </button>
        ${signedIn&&friendServer.loaded&&state==='none'?`<button class="m-chip" type="button" data-request-friend="${esc(f.nuid)}">Send request</button>`:''}
        <button class="m-course-remove" type="button" data-remove-friend="${esc(f.nuid)}" aria-label="Remove ${esc(f.name)}">&times;</button>
      </div>`;}).join(''):'<div class="m-empty">No friends added yet.</div>')+'</div>'
      +'<button class="m-btn-primary" id="m-friend-new" type="button">Add Friends</button>'
      +'<div class="m-signin-status" id="m-friend-status" role="status" aria-live="polite"></div>';
    if(signedIn&&friendServer.error) friendStatus(friendServer.error);
    $('m-friend-new').addEventListener('click',renderFriendLookup);
    host.querySelectorAll('[data-friend]').forEach(btn=>btn.addEventListener('click',()=>{
      friendView.selected=friends.find(f=>f.nuid===btn.dataset.friend);
      renderFriendWeek();
    }));
    // Every server action re-renders from fresh state, so the list never shows
    // a status the server no longer agrees with.
    const act=(btn,action,nuid,message)=>btn.addEventListener('click',async()=>{
      btn.disabled=true;
      try{ await friendAction(action,nuid); toast(message); }
      catch(e){ friendStatus(e.message); btn.disabled=false; return; }
      if(friendView.mode==='list'&&!$('m-friends-sheet').hidden) renderFriendsList(true);
    });
    host.querySelectorAll('[data-accept-friend]').forEach(btn=>act(btn,'accept',btn.dataset.acceptFriend,'Friend request accepted'));
    host.querySelectorAll('[data-decline-friend]').forEach(btn=>act(btn,'decline',btn.dataset.declineFriend,'Request declined'));
    host.querySelectorAll('[data-request-friend]').forEach(btn=>act(btn,'request',btn.dataset.requestFriend,'Friend request sent'));
    host.querySelectorAll('[data-remove-friend]').forEach(btn=>btn.addEventListener('click',async()=>{
      const nuid=btn.dataset.removeFriend;
      const state=signedIn?friendState(nuid):'none';
      // Removing an accepted friend ends the friendship for both of you, so
      // they stop seeing your courses too; a pending request is withdrawn.
      if(state!=='none'){
        try{ await friendAction(state==='accepted'?'remove':'cancel',nuid); }
        catch(e){ friendStatus(e.message); return; }
      }
      try{ writeFriends(readFriends().filter(f=>f.nuid!==nuid)); renderFriendsList(true); toast('Friend removed'); }
      catch(e){ friendStatus('Could not save the change on this device.'); }
    }));
    if(signedIn&&!fresh){
      loadFriendServer().then(()=>{
        if(request===friendView.request&&friendView.mode==='list'&&!$('m-friends-sheet').hidden) renderFriendsList(true);
      });
    }
  }
  function renderFriendLookup(){
    friendView.request++;
    friendView.mode='add';
    $('m-friends-title').textContent='Add Friends';
    $('m-friends-body').innerHTML=`<button class="m-back" id="m-friend-back" type="button">&lsaquo; My Friends</button>
      <p class="m-friends-copy">Enter your friend's NU ID to look up their details. Your friends list stays on this device.</p>
      <form id="m-friend-lookup" class="m-friend-form">
        <label class="m-field-label" for="m-friend-nuid">NU ID</label>
        <input class="m-settings-select" id="m-friend-nuid" placeholder="25I-0632" maxlength="20" autocomplete="off" required>
        <button class="m-btn-primary" id="m-friend-find" type="submit">Find friend</button>
      </form>
      <div class="m-signin-status" id="m-friend-status" role="status" aria-live="polite"></div>
      <div id="m-friend-details"></div>`;
    $('m-friend-back').addEventListener('click',()=>renderFriendsList());
    $('m-friend-lookup').addEventListener('submit',lookupFriend);
    $('m-friend-nuid').addEventListener('input',()=>{
      friendView.request++;
      $('m-friend-details').innerHTML='';
      friendStatus('');
    });
  }
  async function lookupFriend(ev){
    ev.preventDefault();
    const input=$('m-friend-nuid');
    const error=validateNuid(input.value);
    if(error){ friendStatus(error); return; }
    const nuid=formatNuid(input.value);
    input.value=nuid;
    if(isOwnFriendId(nuid)){
      $('m-friend-details').innerHTML='';
      showSelfFriendQuote();
      return;
    }
    try{
      if(readFriends().some(f=>f.nuid===nuid)){ friendStatus('This friend is already in your list.'); return; }
    }catch(e){ friendStatus('Local storage is unavailable. Friends cannot be saved.'); return; }
    const request=++friendView.request;
    const btn=$('m-friend-find');
    btn.disabled=true; input.disabled=true;
    $('m-friend-details').innerHTML='';
    friendStatus('Looking up your friend...');
    let match=null,unavailable=false,authRequired=false,limited=false;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(`/api/roster/lookup?nuid=${encodeURIComponent(nuid)}`,{
        cache:'no-store',credentials:'same-origin',signal:controller.signal
      });
      if(response.status===401||response.status===403){ authRequired=true; throw new Error('Sign in required'); }
      if(response.status===429){ limited=true; throw new Error('Lookup rate limited'); }
      if(!response.ok) throw new Error('Roster unavailable');
      const data=await response.json();
      if(data&&data.ok===true&&data.found===true&&data.student) match=data.student;
      else if(!data||data.ok!==true||data.found!==false) throw new Error('Roster unavailable');
    }catch(e){ unavailable=true; }
    finally{ clearTimeout(timeout); }
    if(request!==friendView.request||$('m-friends-sheet').hidden) return;
    btn.disabled=false; input.disabled=false;
    const p=match?parseProfileFromStudent(match):{};
    const draft={nuid,name:p.name||'',school:'computing',department:p.department||'',
      batch:p.batch?profileFullBatch(p):'20'+nuid.slice(0,2),section:p.section||''};
    friendStatus(match?'Found in the roster. Check the details, then save your friend.'
      :authRequired?'Sign in to look up the roster, or enter their details below.'
      :limited?'Too many lookups right now. Enter their details below, or try again later.'
      :unavailable?'The roster is unavailable. Try again, or enter their details below.'
      :'This NU ID is not in the roster yet. Enter their details below.');
    renderFriendDetails(draft);
  }
  const friendTimetables={};
  const friendLoads={};
  function friendSource(school){
    const shared=typeof myCourseSource==='function'?myCourseSource(school):{};
    return Object.keys(shared||{}).length?shared:(friendTimetables[school]||{});
  }
  async function loadFriendSchool(school){
    if(Object.keys(friendSource(school)).length) return;
    if(!friendLoads[school]) friendLoads[school]=(async()=>{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),15000);
      try{
        const res=await fetch(`/api/timetable?school=${encodeURIComponent(school)}`,{cache:'no-store',signal:controller.signal});
        const data=await res.json();
        if(!res.ok||!data.ok||!data.tt||!Object.keys(data.tt).length) throw new Error('Timetable unavailable');
        friendTimetables[school]=data.tt;
      }finally{ clearTimeout(timeout); delete friendLoads[school]; }
    })();
    return friendLoads[school];
  }
  function friendPicker(field,label,value,options,emptyCopy){
    return `<div class="m-friend-field m-lk-field"><span class="m-field-label" id="m-friend-${field}-label">${esc(label)}</span>
      <input type="hidden" id="m-friend-${field}" value="${esc(value)}">
      <details class="m-friend-picker" data-picker="${field}">
        <summary aria-labelledby="m-friend-${field}-label m-friend-${field}-value"><span id="m-friend-${field}-value">${esc(options.find(o=>o.value===value)?.label||`Choose ${label.toLowerCase()}`)}</span><span class="m-friend-chevron" aria-hidden="true"></span></summary>
        <div class="m-friend-options m-chip-row" role="group" aria-labelledby="m-friend-${field}-label">${options.length?options.map(o=>`<button type="button" class="m-chip${o.value===value?' is-on':''}" data-pick="${field}" data-value="${esc(o.value)}" aria-pressed="${o.value===value}">${esc(o.label)}</button>`).join(''):`<span class="m-caption">${esc(emptyCopy||'No options available.')}</span>`}</div>
      </details></div>`;
  }
  function renderFriendDetails(draft){
    const host=$('m-friend-details');
    const schools={computing:'School of Computing (FSC)',engineering:'School of Engineering (FSE)',business:'School of Management (FSM)'};
    const choice={school:draft.school,dept:draft.department,batch:draft.batch,section:draft.section};
    host.innerHTML=`<form class="m-friend-form" id="m-friend-save-form">
      <div class="m-section-label">Friend details &middot; ${esc(draft.nuid)}</div>
      <label class="m-field-label" for="m-friend-name">Name</label>
      <input class="m-settings-select" id="m-friend-name" value="${esc(draft.name)}" maxlength="60" autocomplete="off" required>
      <div id="m-friend-pickers"></div>
      <div class="m-caption" id="m-friend-data-status" role="status"></div>
      <button class="m-btn-ghost" id="m-friend-retry" type="button" hidden>Retry loading timetable</button>
      <button class="m-btn-primary" id="m-friend-save" type="submit">Save friend</button>
    </form>`;
    const form=$('m-friend-save-form');
    let loading=false,loadError=false;
    const sort=keys=>keys.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const opts=keys=>keys.map(value=>({value,label:value}));
    function paint(){
      if(!form.isConnected) return;
      const source=friendSource(choice.school);
      const programs=sort(Object.keys(source).filter(d=>d!=='Unassigned'));
      if(programs.length){
        const normalized=typeof deptCodeToLabel==='function'?deptCodeToLabel(choice.dept):choice.dept;
        choice.dept=programs.find(d=>d.toUpperCase()===choice.dept.toUpperCase()||d.toUpperCase()===normalized.toUpperCase())||'';
      }
      const batches=sort(Object.keys(source[choice.dept]||{}));
      const sections=sort(Object.keys(source[choice.dept]?.[choice.batch]||{}).filter(s=>s!==ALL_SECTIONS));
      if(programs.length&&!sections.includes(choice.section)) choice.section='';
      const available=!!source[choice.dept]?.[choice.batch]?.[choice.section];
      $('m-friend-pickers').innerHTML=[
        friendPicker('school','School',choice.school,Object.entries(schools).map(([value,label])=>({value,label}))),
        friendPicker('dept','Program',choice.dept,opts(programs),loading?'Loading programs...':'No programs available. Retry loading the timetable.'),
        friendPicker('batch','Batch',batches.includes(choice.batch)?choice.batch:'',opts(batches),choice.dept?'No batches available.':'Choose a program first.'),
        friendPicker('section','Section',choice.section,opts(sections),!choice.dept?'Choose a program first.':!batches.includes(choice.batch)?'Choose a batch first.':'No sections available for this batch.')
      ].join('');
      $('m-friend-save').disabled=loading||!available;
      $('m-friend-data-status').textContent=loading?'Loading timetable options...':loadError?'Could not load the timetable for this school. Please retry.':choice.dept&&!batches.includes(choice.batch)?'Choose the batch your friend attends.':'';
      $('m-friend-retry').hidden=!loadError;
      form.querySelectorAll('[data-pick]').forEach(btn=>btn.addEventListener('click',()=>{
        const field=btn.dataset.pick,value=btn.dataset.value;
        if(choice[field]!==value){
          choice[field]=value;
          if(field==='school'){ choice.dept=''; choice.section=''; }
          if(field==='dept'||field==='batch') choice.section='';
        }
        paint();
        form.querySelector(`[data-picker="${field}"] summary`)?.focus();
        if(field==='school') refresh();
      }));
    }
    async function refresh(){
      const school=choice.school;
      loading=!Object.keys(friendSource(school)).length; loadError=false; paint();
      try{ await loadFriendSchool(school); }
      catch(e){ if(choice.school===school) loadError=true; }
      if(!form.isConnected||choice.school!==school) return;
      loading=false; paint();
    }
    $('m-friend-retry').addEventListener('click',refresh);
    friendView.refreshDetails=()=>{ if(form.isConnected) refresh(); };
    refresh();
    form.addEventListener('submit',ev=>{
      ev.preventDefault();
      if(isOwnFriendId(draft.nuid)){
        showSelfFriendQuote();
        return;
      }
      const friend={nuid:draft.nuid,name:$('m-friend-name').value.trim(),school:choice.school,
        department:choice.dept,batch:choice.batch,section:choice.section};
      if(loading||!friend.name||!friendSource(friend.school)[friend.department]?.[friend.batch]?.[friend.section]){
        friendStatus('Enter a name and choose a program, batch and section from the timetable.'); return;
      }
      try{
        const friends=readFriends();
        if(friends.some(f=>f.nuid===friend.nuid)){ friendStatus('This friend is already in your list.'); return; }
        if(friends.length>=100){ friendStatus('You can save up to 100 friends. Remove one before adding another.'); return; }
        writeFriends([...friends,friend]);
      }catch(e){ friendStatus('Could not save this friend. Check that local storage is available.'); return; }
      if(!friendsSignedIn()){
        renderFriendsList();
        toast('Friend saved on this device');
        return;
      }
      friendAction('request',friend.nuid)
        .then(data=>toast(data.status==='accepted'?'Friend saved':'Friend saved · request sent'))
        .catch(e=>toast(e.code==='incoming_pending'?'Friend saved · they already asked you, accept it below':'Friend saved · request not sent, try again from the list'))
        .finally(()=>{ if(friendView.mode!=='week'&&!$('m-friends-sheet').hidden) renderFriendsList(true); });
    });
  }
  // One day of an accepted friend's classes, built the way getMyCourses()
  // builds yours: their own section minus the courses they dropped, plus every
  // slot of each course they added from another section (repeats, electives).
  function friendClassesFor(scope,shared,day){
    const sameName=(e,name)=>stripNote(entryCourse(e)).trim().toUpperCase()===name;
    const removed=new Set((shared.courseRemoved||[]).map(n=>String(n).trim().toUpperCase()));
    const rows=classesFor(scope.dept,scope.batch,scope.sec,day,friendSource(scope.school))
      .filter(e=>!removed.has(stripNote(entryCourse(e)).trim().toUpperCase()));
    (shared.courses||[]).forEach(c=>{
      const name=String(c.name||'').trim().toUpperCase();
      classesFor(c.dept,c.batch,c.section,day,friendSource(c.school||scope.school))
        .filter(e=>sameName(e,name))
        .forEach(e=>rows.push(e));
    });
    return sortByTime(rows);
  }
  function renderFriendWeek(tried=new Set()){
    const friend=friendView.selected;
    if(!friend) return renderFriendsList();
    const request=++friendView.request;
    friendView.mode='week';
    const accepted=friendServer.friends.find(f=>f.nuid===friend.nuid);
    const shared=accepted&&accepted.profile;
    const scope=friendScope(shared)||{school:friend.school,dept:friend.department,batch:friend.batch,sec:friend.section};
    const extras=shared?(shared.courses||[]):[];
    $('m-friends-title').textContent=friend.name;
    $('m-friends-body').innerHTML=`<button class="m-back" id="m-friend-back" type="button">&lsaquo; My Friends</button>
      <p class="m-friends-copy">${esc(friend.nuid)} &middot; ${esc(scope.dept)} ${esc(scope.batch)}-${esc(scope.sec)}<br>${shared
        ?'Their week, including repeat and extra courses'
        :friendsSignedIn()&&friendState(friend.nuid)==='pending'
          ?'Weekly section timetable. Their repeat and extra courses show once they accept your request.'
          :'Weekly section timetable'}</p>
      ${shared?`<div class="m-section-label">Repeat &amp; extra courses (${extras.length})</div>
        <div class="m-friend-list">${extras.length?extras.map(c=>`<div class="m-friend-row"><div class="m-friend-open">
          <span class="m-course-name">${esc(c.name)}</span>
          <span class="m-course-origin">${esc(c.dept)} ${esc(c.batch)}-${esc(c.section)}</span></div></div>`).join('')
          :'<div class="m-empty">No repeat or extra courses.</div>'}</div>`:''}
      <div id="m-friend-week"></div>`;
    $('m-friend-back').addEventListener('click',()=>renderFriendsList());
    const pane=$('m-friend-week');
    // Extra courses can come from another school's timetable; load every one
    // this week needs before drawing it.
    const schools=[...new Set([scope.school,...extras.map(c=>c.school||scope.school)].filter(Boolean))];
    const missing=schools.filter(s=>!tried.has(s)&&!Object.keys(friendSource(s)).length);
    if(missing.length){
      missing.forEach(s=>tried.add(s));
      pane.innerHTML='<div class="m-empty">Loading their timetable…</div>';
      Promise.allSettled(missing.map(loadFriendSchool)).then(()=>{
        if(request!==friendView.request||friendView.mode!=='week'||$('m-friends-sheet').hidden) return;
        renderFriendWeek(tried);
      });
      return;
    }
    const source=friendSource(scope.school);
    const keys={dept:scope.dept,batch:scope.batch,sec:scope.sec,tt:source};
    if(!source[scope.dept]?.[scope.batch]?.[scope.sec]&&!extras.length){
      pane.innerHTML='<div class="m-empty">No timetable is available for this section right now. Check their details or try again after the timetable loads.</div>';
      return;
    }
    renderWeek(keys,pane,day=>shared
      ?friendClassesFor(scope,shared,day)
      :classesFor(keys.dept,keys.batch,keys.sec,day,source));
  }
  function wireFriends(){
    let dismissedQuotePointer=false;
    document.addEventListener('pointerdown',ev=>{
      const quote=$('m-toast');
      dismissedQuotePointer=!!quote&&!quote.hidden&&quote.classList.contains('m-friend-quote')&&!quote.contains(ev.target);
      if(dismissedQuotePointer){
        ev.preventDefault();ev.stopImmediatePropagation();closeSelfFriendQuote();
      }
    },true);
    document.addEventListener('click',ev=>{
      if(dismissedQuotePointer){
        dismissedQuotePointer=false;
        ev.preventDefault();ev.stopImmediatePropagation();
      }
    },true);
    window.addEventListener('popstate',closeSelfFriendQuote);
    document.addEventListener('keydown',ev=>{
      const quote=$('m-toast');
      if(!quote||quote.hidden||!quote.classList.contains('m-friend-quote')) return;
      if(ev.key==='Escape'){
        ev.preventDefault();ev.stopImmediatePropagation();closeSelfFriendQuote();
      }else if(ev.key==='Tab'){
        ev.preventDefault();ev.stopImmediatePropagation();quote.querySelector('.m-friend-quote-close').focus();
      }
    },true);
    $('m-friends-btn').addEventListener('click',()=>openFriends());
    $('m-friends-close').addEventListener('click',closeFriends);
    document.addEventListener('keydown',ev=>{
      if($('m-friends-sheet').hidden) return;
      if(ev.key==='Escape'){ ev.preventDefault(); closeFriends(); }
      if(ev.key==='Tab'){
        const fields=[...$('m-friends-sheet').querySelectorAll('button,input,select,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
        const first=fields[0],last=fields[fields.length-1];
        if(ev.shiftKey&&document.activeElement===first){ ev.preventDefault(); last?.focus(); }
        else if(!ev.shiftKey&&document.activeElement===last){ ev.preventDefault(); first?.focus(); }
      }
    });
    window.addEventListener('storage',ev=>{
      if(ev.key!==FRIENDS_KEY) return;
      updateFriendsButton();
      if(!$('m-friends-sheet').hidden&&friendView.mode==='list') renderFriendsList();
    });
    document.addEventListener('vtable:account',()=>{
      updateFriendsButton();
      if(!$('m-friends-sheet').hidden&&friendView.mode==='list') renderFriendsList();
    });
    document.addEventListener('vtable:data',()=>{
      if(!$('m-friends-sheet').hidden&&friendView.mode==='add') friendView.refreshDetails?.();
      if(!$('m-friends-sheet').hidden&&friendView.mode==='week') renderFriendWeek();
    });
    updateFriendsButton();
  }

  function wireArcade(){
    const wrap=$('m-arcade');
    if(!wrap) return;
    $('m-arcade-close').addEventListener('click',closeArcade);
    $('m-stage-x').addEventListener('click',showPicker);
    $('m-dead-again').addEventListener('click',playAgain);
    $('m-dead-quit').addEventListener('click',showPicker);
    document.addEventListener('vtable:gameover',onGameOver);
    window.addEventListener('resize',()=>{ if(arcadeGame) layoutStage(); });
    // The leaderboard's signed-out row is desktop markup with an inline onclick
    // that opens the DESKTOP profile modal — invisible inside the mobile
    // breakpoint, so the tap would appear to do nothing. Catch it in the
    // capture phase (before the inline handler runs) and send the student to
    // the phone's own sign-in instead.
    wrap.addEventListener('click',ev=>{
      const cta=ev.target.closest&&ev.target.closest('.cr-lb-cta');
      if(!cta) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeArcade();
      if(profile()) go('profile'); else openSignin();
    },true);
  }


  /* ══ PROFILE ═══════════════════════════════════════════════════════ */

  /* Master notification switch state.
     Cached at module scope because renderProfile() is synchronous while the
     honest answer — does this browser hold a live push subscription? — needs
     an await. The cache paints the last known state instantly and
     refreshPushState() corrects it a tick later, so the switch never sits in a
     "checking…" limbo and never claims to be on while nothing is delivered. */
  let pushLive=false;
  // Kept across re-renders: flipping the switch re-renders the whole section,
  // which would otherwise wipe the one line explaining what just happened.
  let pushMsg='';
  // A switch operation is in flight. While it is, `pushLive` is what the user
  // ASKED for rather than what the browser currently reports, so every reader
  // that would otherwise overwrite it has to stand down until it settles.
  let pushBusy=false;

  // Success lines from app.js start with a tick; the switch-off path reports
  // plainly instead ("Notifications are off."), and both are normal outcomes.
  // Everything else — a refused permission, a failed unsubscribe, an
  // unsupported browser — is a problem and reads red.
  const PUSH_OK=/^(✓|Notifications are off)/;
  function paintPushStatus(){
    const line=$('m-push-status');
    if(!line) return;
    line.textContent=pushMsg;
    // Collapse when there is nothing to say, rather than holding open a gap
    // between the master switch and the categories it governs.
    line.hidden=!pushMsg;
    line.classList.toggle('is-error',Boolean(pushMsg)&&!PUSH_OK.test(pushMsg));
  }

  function refreshPushState(){
    // An optimistic update is showing. The browser still reports the old state
    // until the unsubscribe lands, so reading it here would snap the switch
    // straight back and undo what the user just did.
    if(pushBusy) return Promise.resolve(pushLive);
    if(typeof pushAlertsActive!=='function') return Promise.resolve(false);
    return Promise.resolve(pushAlertsActive()).then(on=>{
      const changed=on!==pushLive;
      pushLive=on;
      // Guarded by `changed`, so this settles rather than looping.
      if(changed&&route==='profile') renderProfile();
      return on;
    }).catch(()=>pushLive);
  }

  function myCoursesSectionHTML(){
    if(typeof getMyCourses!=='function') return '';
    const list=getMyCourses();
    const rows=list.length
      ? list.map(c=>{
          const origin=(String(c.dept||'').replace(/^BS\s+/,'')+' '+(c.batch||'')
            +(c.section?('-'+c.section):'')).trim();
          return '<div class="m-course-row"><span class="m-course-text">'
            +'<span class="m-course-name">'+esc(c.name)+'</span>'
            +'<span class="m-course-origin">'+esc(origin)+'</span></span>'
            +'<button class="m-course-remove" type="button" data-key="'+esc(myCourseKey(c))
            +'" aria-label="Remove '+esc(c.name)+'">&times;</button></div>';
        }).join('')
      : '<div class="m-empty" style="margin:0">No courses saved. Add them from Lookup.</div>';
    return '<details class="m-settings-dropdown" id="m-settings-courses"'+(coursesExpanded?' open':'')+'><summary>My courses ('+list.length+')</summary>'
      +'<div class="m-course-list" id="m-course-list">'+rows+'</div></details>';
  }
  function wireMyCourses(){
    const dropdown=$('m-settings-courses');
    if(dropdown) dropdown.addEventListener('toggle',()=>{ coursesExpanded=dropdown.open; });
    document.querySelectorAll('#m-course-list .m-course-remove').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const course=getMyCourses().find(c=>myCourseKey(c)===btn.dataset.key);
        if(course) removeMyCourse(course);
        renderProfile();
        toast('Course removed');
      });
    });
  }
  // Sections the student's own department+batch actually publishes, from the
  // same live timetable data the Today/Lookup screens already read — so the
  // list can never offer a section with nothing behind it.
  function availableSectionsForProfile(p){
    const src=ttFor(p.school)||{};
    const dept=String(p.department||'').trim();
    const batch=p.manual?String(p.batch||'')
      :((typeof profileFullBatch==='function')?profileFullBatch(p):p.batch);
    const secs=Object.keys((src[dept]||{})[batch]||{}).filter(s=>s!==ALL_SECTIONS);
    return secs.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  }
  // chipsId is per-caller (not a fixed id) because the onboarding screen and
  // the Profile tab can both hold one of these in the DOM at once — only one
  // is ever "on" at a time, but a duplicate id would still make
  // #id-based querySelectorAll wiring match both.
  function sectionPickerHTML(p,chipsId){
    const secs=availableSectionsForProfile(p);
    if(!secs.length){
      return '<div class="m-caption" style="margin:8px 2px 0">Sections aren’t available to change right now.</div>';
    }
    if(chipsId==='m-profile-sec-chips'){
      const current=String(p.section||'');
      return '<label class="m-field-label" for="m-profile-section">Section</label>'
        +'<select class="m-settings-select" id="m-profile-section">'
        +(!secs.includes(current)?'<option value="" selected disabled>Choose section</option>':'')
        +secs.map(s=>'<option value="'+esc(s)+'"'+(s===current?' selected':'')+'>'+esc(s)+'</option>').join('')
        +'</select>';
    }
    const chips=secs.map(s=>
      `<button class="m-chip${s===p.section?' is-on':''}" data-sec="${esc(s)}" type="button">${esc(s)}</button>`
    ).join('');
    return `<div class="m-lk-field" style="margin-top:10px">
      <div class="m-meta-row"><span>Section</span><b>${esc(p.section||'—')}</b></div>
      <div class="m-chip-row" id="${chipsId}">${chips}</div>
    </div>`;
  }
  // Switches which section's classes the student sees, and — if push
  // notifications are already on for this device — quietly re-syncs the
  // server's subscription record so class-change alerts follow the new
  // section too (senders match on the subscription's own section field, not
  // the append-only roster, so this is the write that actually matters).
  function changeProfileSection(newSection){
    const p=profile();
    if(!p) return;
    const sec=String(newSection||'').trim().toUpperCase();
    if(!sec||sec===String(p.section||'').trim().toUpperCase()) return;
    const updated={...p,section:sec};
    setProfileCookie(updated);
    if(typeof seedProfileSchedulePrefs==='function') seedProfileSchedulePrefs(updated,true);
    if(typeof syncNotificationPrefs==='function') syncNotificationPrefs();
    toast('Section changed to '+sec);
    if(route==='onboard') renderOnboard(updated);
    else if(route==='profile') renderProfile();
  }

  function renderProfile(){
    const p=profile();
    const out=$('m-profile-out');
    if(!p){
      out.innerHTML=lockedHTML();
      wireLocked(out);
      return;
    }
    const cats=(typeof NOTIFICATION_CATEGORIES!=='undefined')?NOTIFICATION_CATEGORIES:[];
    const prefs=(typeof readNotifPrefs==='function')?readNotifPrefs():{};
    const batch=p.manual?String(p.batch||'')
      :((typeof profileFullBatch==='function')?profileFullBatch(p):p.batch);
    const av=$('m-avatar-initials')?$('m-avatar-initials').textContent:initials(p.name);
    // Manual profiles have no name or roll no — lead with the school instead.
    const sub=[p.manual?MANUAL_SCHOOLS[p.school]:p.nuid,p.department,p.section]
      .filter(Boolean).join(' · ');
    out.innerHTML=`<div class="m-pcard">
        <div class="m-pcard-avatar">${esc(av)}</div>
        <div style="min-width:0">
          <div class="m-pcard-name">${esc(p.name||p.department||'Student')}</div>
          <div class="m-pcard-sub">${esc(sub)}</div>
        </div>
      </div>
          <div class="m-profile-program">
      <div class="m-drow"><div class="m-drow-label">Program · batch</div>
        <div class="m-drow-value">${esc(p.department||'—')} · ${esc(batch||'—')}</div></div>
      ${sectionPickerHTML(p,'m-profile-sec-chips')}
          </div>
      <div class="m-section-label">Notifications</div>
      <!-- One master switch, then the categories it governs. The categories are
           inert until it is on: a per-category choice is meaningless while
           nothing can be delivered, and letting them be toggled anyway implied
           notifications were already running. -->
      <label class="m-toggle-row m-toggle-master" for="m-push-master">
        <span class="m-toggle-text">
          <span class="m-toggle-label">Push notifications</span>
          <span class="m-toggle-help">${pushLive
            ? 'On for this device. Turning this off removes it from our list.'
            : 'Off. Turn this on to pick what you get alerted about.'}</span>
        </span>
        <input class="m-toggle" id="m-push-master" type="checkbox" ${pushLive?'checked':''} ${pushBusy?'disabled':''}>
      </label>
      <div class="m-signin-status" id="m-push-status" role="status" aria-live="polite" style="margin-bottom:12px"></div>
      <div class="m-pref-group${pushLive?'':' is-locked'}"${pushLive?'':' aria-disabled="true"'}>
        ${cats.map(c=>{
          const off=c.dead||!pushLive;
          return `<label class="m-toggle-row${c.dead?' is-pending':''}" for="m-pref-${c.key}">
          <span class="m-toggle-text">
            <span class="m-toggle-label">${esc(c.label)}${c.dead?'<span class="m-soon">Soon</span>':''}</span>
            <span class="m-toggle-help">${esc(c.help)}</span>
          </span>
          <input class="m-toggle" id="m-pref-${c.key}" type="checkbox" ${prefs[c.key]?'checked':''} ${off?'disabled':''}>
        </label>`;
        }).join('')}
      </div>
      <section class="m-customization" aria-labelledby="m-customization-title">
        <h2 class="m-section-label" id="m-customization-title">Course customization</h2>
        <div class="m-customization-fields">
          ${myCoursesSectionHTML()}
          <button class="m-btn-ghost m-add-friend" id="m-add-friend" type="button">Add Friends</button>
          <!-- Deferred sharing preference: hidden and inactive until enabled deliberately. -->
          <div id="m-friend-sharing-setting" hidden>
            <label class="m-toggle-row" for="m-allow-friends">
              <span class="m-toggle-text"><span class="m-toggle-label">Allow friends to add you</span></span>
              <input class="m-toggle" id="m-allow-friends" type="checkbox" role="switch" disabled>
            </label>
          </div>
      <label class="m-toggle-row" for="m-dark-mode">
        <span class="m-toggle-text"><span class="m-toggle-label">Dark mode</span>
          <span class="m-toggle-help">Dark backgrounds with orange accents.</span></span>
        <input class="m-toggle" id="m-dark-mode" type="checkbox" role="switch" ${document.documentElement.dataset.mobileTheme==='dark'?'checked':''}>
      </label>
        </div>
      </section>
      <button class="m-btn-ghost" id="m-signout" type="button" style="margin-top:18px">Sign out</button>`;

    // app.js writes every push status line through this hook; point it at the
    // line that is currently on screen. renderProfile() re-claims it on each
    // pass, so returning here after the onboarding screen borrowed it is fine.
    window.onPushStatus=msg=>{ pushMsg=msg||''; paintPushStatus(); };
    paintPushStatus();

    cats.forEach(c=>{
      const el=$('m-pref-'+c.key);
      if(el&&!c.dead&&pushLive) el.addEventListener('change',()=>{
        if(typeof onNotificationPrefChange==='function') onNotificationPrefChange(c.key,el.checked);
        toast('Saved');
      });
    });

    /* The two directions are deliberately NOT symmetrical.

       OFF is applied optimistically — the switch flips and the categories grey
       out on the click, before any network call. Turning notifications off is
       a promise the browser can keep on its own: sub.unsubscribe() is local,
       and deleting the server record is cleanup that only decides how quickly
       an already-dead endpoint stops being written to. Holding the UI open for
       a GitHub round-trip would leave the categories live and tappable for a
       second or two after the user said stop.

       ON is not, and must not be. It needs a permission prompt the user has
       not answered yet and a subscription the push service may refuse, so
       showing "on" up front would be showing something that may never become
       true. */
    const master=$('m-push-master');
    if(master) master.addEventListener('change',()=>{
      if(pushBusy){ master.checked=pushLive; return; } // an operation is already settling
      const want=master.checked;
      const fn=want?(typeof enableSeatAlerts==='function'?enableSeatAlerts:null)
                   :(typeof disableSeatAlerts==='function'?disableSeatAlerts:null);
      if(!fn){
        pushMsg='Notifications are unavailable right now.';
        master.checked=!want;
        paintPushStatus();
        return;
      }
      pushBusy=true;
      pushMsg='';
      if(!want){
        pushLive=false;
        renderProfile(); // instantly: switch off, categories greyed and inert
      }else{
        master.disabled=true;
        paintPushStatus();
      }
      Promise.resolve(fn()).catch(err=>{
        console.warn('push switch failed:',err);
      }).then(()=>{
        pushBusy=false;
        // Confirm against the browser's own state. A refused permission prompt
        // or an unsubscribe that did not take snaps the switch back to the
        // truth, and the status line says why.
        return refreshPushState();
      }).then(()=>{
        // refreshPushState() only re-renders when it disagrees; render anyway
        // so the master switch comes back out of its in-flight disabled state.
        if(route==='profile') renderProfile();
      });
    });

    // Correct the cached state on entry, in case permission was revoked or the
    // subscription was dropped since the last time this screen was open.
    refreshPushState();

    $('m-add-friend').addEventListener('click',()=>openFriends('add'));
    $('m-dark-mode').addEventListener('change',e=>setMobileTheme(e.target.checked));
    const sectionSelect=$('m-profile-section');
    if(sectionSelect) sectionSelect.addEventListener('change',e=>changeProfileSection(e.target.value));
    wireMyCourses();

    const so=$('m-signout');
    if(so) so.addEventListener('click',()=>{
      if(typeof signOutProfile==='function') signOutProfile();
      if(typeof clearProfileCookie==='function') clearProfileCookie();
      setSkipped(false);
      fac.selected=null;
      resetSigninCode();
      // Desktop carries on as a guest; the phone goes back to its sign-in.
      if(DESK.matches) go('today',true);
      else { route='signin'; render(); }
    });
  }

  /* ══ WIRING ════════════════════════════════════════════════════════ */
  function wire(){
    $('m-signin-btn').addEventListener('click',doSignIn);
    $('m-nuid').addEventListener('keydown',e=>{ if(e.key==='Enter') doSignIn(); });
    $('m-nuid').addEventListener('input',()=>{
      if(!signinChallenge) return;
      resetSigninCode();
      signinStatus('NU ID changed. Press Continue to send a new code.');
    });
    $('m-code').addEventListener('keydown',e=>{ if(e.key==='Enter') doSignIn(); });
    $('m-reg-go').addEventListener('click',saveRegistration);
    $('m-reg-back').addEventListener('click',()=>{ resetSigninCode(); route='signin'; render(); });
    $('m-reg-name').addEventListener('keydown',e=>{ if(e.key==='Enter') saveRegistration(); });
    $('m-manual-btn').addEventListener('click',()=>{ route='manual'; render(); });
    $('m-guest-btn').addEventListener('click',()=>{
      // Remembered, so a guest is not sent back to sign-in on every launch.
      // Lookup, not Today: a guest has no timetable of their own to show.
      setSkipped(true);
      go('lookup',true);
    });
    $('m-manual-go').addEventListener('click',saveManual);
    $('m-manual-back').addEventListener('click',()=>{ resetSigninCode(); route='signin'; render(); });
    $('m-onboard-push').addEventListener('click',()=>enablePush('m-onboard-push-status','m-onboard-push'));
    $('m-onboard-go').addEventListener('click',()=>{ go('today',true); });
    $('m-onboard-back').addEventListener('click',()=>{
      if(typeof clearProfileCookie==='function') clearProfileCookie();
      if(typeof clearProfileStorage==='function') clearProfileStorage();
      resetSigninCode();
      route='signin'; render();
    });

    document.querySelectorAll('.m-tab').forEach(btn=>{
      btn.addEventListener('click',()=>go(btn.dataset.route));
    });
    $('m-avatar-btn').addEventListener('click',()=>go('profile'));
    $('m-login-btn').addEventListener('click',openSignin);
    $('m-side-dark').addEventListener('change',e=>{
      setMobileTheme(e.target.checked);
      const other=$('m-dark-mode'); if(other) other.checked=e.target.checked;
    });
    // The old desktop logo's easter egg, moved onto the sidebar wordmark.
    $('m-side-wordmark').addEventListener('dblclick',()=>openArcade());
    // The bell is not its own inbox - it opens Profile, which already has the
    // real notification toggles (see the "NOTIFICATIONS" section rendered by
    // renderProfile()). Same destination as the avatar button, just a second,
    // more discoverable way to reach it.
    $('m-bell-btn').addEventListener('click',()=>go('profile'));
    wireArcade();
    wireCoursesSheet();
    wireFriends();

    $('m-seg-today').addEventListener('click',()=>{ weekMode=false; renderToday(); });
    $('m-seg-week').addEventListener('click',()=>{ weekMode=true; renderToday(); });
    ['schedule','seating','showup'].forEach(t=>{
      $('m-seg-'+t).addEventListener('click',()=>{ ex.tab=t; $('m-exam-out').innerHTML=''; renderExams(); });
    });

    $('m-fac-search').addEventListener('input',e=>{ fac.q=e.target.value; renderFaculty(); });
    $('m-fac-back').addEventListener('click',()=>go('faculty'));

    window.addEventListener('hashchange',()=>{
      // The arcade is an overlay, not a route, so it would otherwise sit on top
      // of whatever the back button navigated to. Closing it here also stops
      // the running game, which is what "back" should mean here.
      closeArcade();
      closeFriends();
      const r=readHash();
      if(r&&r!==route){ route=r; render(); }
    });
    // The desktop layer owns data loading; re-render when it lands something new.
    document.addEventListener('vtable:data',()=>render());
    // Crossing the breakpoint changes whether sign-in is a gate.
    DESK.addEventListener('change',()=>render());
    let roomMinute='';
    setInterval(()=>{
      if(route==='rooms'){
        const minute=roomDateForDay()+':'+nowMinutes();
        if(minute!==roomMinute){roomMinute=minute;renderRooms();}
      }
    },1000);
    setInterval(()=>{ if(route==='today'&&!weekMode) tickBanner(); },1000);
  }

  function start(){
    if(!$('m-app')) return;
    syncMobileThemeChrome();
    wire();
    let r=readHash();
    // Old desktop deep links (#timetable, vtable.site/freerooms, …) open the
    // matching screen of this UI.
    const legacy={timetable:'lookup',freerooms:'rooms',faculty:'faculty',exams:'exams',seating:'exams',showup:'exams'};
    const old=String(location.hash||'').replace(/^#/,'');
    if(!r&&legacy[old]){
      r=legacy[old];
      if(old==='showup'||old==='seating') ex.tab=old;
      history.replaceState(null,'','#/'+r);
    }
    // render() decides sign-in vs app from the stored profile, so "today" is
    // just the default landing spot — a signed-in user goes straight there and
    // never sees the sign-in screen. A returning phone guest opens on Lookup
    // instead (desktop guests keep their landing on Today). No minimum splash
    // time: the app opens the moment this script has run.
    const home=(!profile()&&skipped()&&!DESK.matches)?'lookup':'today';
    route=(r&&['today','lookup','rooms','faculty','exams','profile','signin'].includes(r))?r:home;
    render();
    // The account's saved profile replaced the local one (new device, after a
    // logout, or edited elsewhere). Mid sign-in, finishSignIn routes instead.
    document.addEventListener('vtable:account',()=>{
      if(signingIn) return;
      if(route==='signin'&&profile()) go('today',true);
      else render();
    });
    dropUnverifiedProfile();
  }

  // A profile saved before email verification existed (or on a session that
  // has since expired) would otherwise count as signed in forever. Only a
  // definite 401 clears it: offline or a server error keeps the profile, so
  // the installed app still opens without a connection. Manual FSE/FSM
  // profiles carry no NU ID and never had a session to check. A valid session
  // restores the account's saved profile through the 'vtable:account' event.
  async function dropUnverifiedProfile(){
    await refreshAuthSession();
    if(friendsSignedIn()) loadFriendServer().then(updateFriendsButton);
    const p=profile();
    if(!p||!p.nuid||p.manual) return;
    if(PROFILE_AUTH_STATUS!==401) return;
    if(typeof clearProfileCookie==='function') clearProfileCookie();
    if(typeof clearProfileStorage==='function') clearProfileStorage();
    resetSigninCode();
    if(DESK.matches){ go('today',true); return; }
    route='signin';
    render();
    const input=$('m-nuid');
    if(input) input.value=p.nuid;
    signinStatus('Please verify your university email to continue.');
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
