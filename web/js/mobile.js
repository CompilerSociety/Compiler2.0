/* ══════════════════════════════════════════════════════════════════════
   PHONE APP
   A second view over the SAME data layer as the desktop app. Loaded as a
   classic script immediately after js/app.js, so it shares that file's
   global scope and reads its live bindings (TT, ROOM_TT, FACULTY_DATA, the
   profile helpers, the slot/occupancy helpers) rather than re-fetching or
   re-deriving anything.

   It never mutates desktop state. The one exception is the school selector:
   Lookup has to be able to switch schools, and the only loader is the one
   the desktop select drives, so that path sets #school and calls the
   existing refresh — the same thing a desktop click does.

   Nothing here runs above the phone breakpoint; see css/mobile.css.
   ══════════════════════════════════════════════════════════════════════ */
(function MobileApp(){
  'use strict';

  const MQ=window.matchMedia('(max-width:767px)');
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
  // Floor on the splash. The auth check itself is instant (localStorage), but
  // without this the splash strobes on a warm load.
  const MIN_SPLASH_MS=450;

  /* ── Small helpers ─────────────────────────────────────────────────── */
  function toast(msg){
    const el=$('m-toast'); if(!el) return;
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
  // The real calendar day, for the header. Deliberately not todayName(), which
  // folds Sunday onto Monday so the class list has something to show.
  function headerDate(){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',
      weekday:'long',day:'numeric',month:'long',year:'numeric'}).formatToParts(new Date());
    const get=t=>(parts.find(x=>x.type===t)||{}).value||'';
    return `${get('weekday')} · ${get('day')} ${get('month')} ${get('year')}`.toUpperCase();
  }
  function todayName(){
    const d=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
    return d==='Sunday'?'Monday':d;
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
    const signin=route==='signin'||(!signedIn&&!skipped()&&!onboarding&&!manual&&!registering);

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
    $('m-avatar-initials').textContent=p?(initials(p.name)!=='—'?initials(p.name)
      :(String(p.department||'').replace(/^BS\s+/i,'').slice(0,2).toUpperCase()||'—')):'—';

    if(route==='today') renderToday();
    else if(route==='lookup') renderLookup();
    else if(route==='rooms') renderRooms();
    else if(route==='faculty') renderFaculty();
    else if(route==='facdetail') renderFacDetail();
    else if(route==='exams') renderExams();
    else if(route==='profile') renderProfile();
  }

  /* ══ SIGN IN ═══════════════════════════════════════════════════════ */
  function signinStatus(msg,isError){
    const el=$('m-signin-status');
    if(!el) return;
    el.textContent=msg||'';
    el.classList.toggle('is-error',Boolean(isError));
  }
  let signingIn=false;
  async function doSignIn(){
    if(signingIn) return;
    const input=$('m-nuid');
    const raw=input?input.value:'';
    const err=(typeof validateNuid==='function')?validateNuid(raw):null;
    if(err){ signinStatus(err,true); return; }
    const nuid=(typeof formatNuid==='function')?formatNuid(raw):String(raw).toUpperCase();
    if(input) input.value=nuid;

    signingIn=true;
    const btn=$('m-signin-btn');
    if(btn){ btn.disabled=true; btn.innerHTML='<span class="m-spinner"></span>Checking…'; }
    signinStatus('');
    try{
      const students=await loadProfileStudents(nuid);
      const match=students.find(s=>String(s.nuid||'').trim().toUpperCase()===nuid);
      if(!match){
        // Not a dead end: the roster lags every new intake (26-* is published
        // months after they can log in), so collect the details instead —
        // the same thing the desktop registration form does.
        startRegistration(nuid);
        return;
      }
      const p=parseProfileFromStudent(match);
      setProfileCookie(p);
      seedProfileSchedulePrefs(p,true);
      setSkipped(false);
      renderOnboard(p);
      route='onboard';
      render();
    }catch(e){
      signinStatus('Could not reach the student roster. Try again, or skip login.',true);
    }finally{
      signingIn=false;
      if(btn){ btn.disabled=false; btn.textContent='Continue'; }
    }
  }

  function renderOnboard(p){
    $('m-onboard-kicker').textContent='READ FROM '+(p.nuid||'YOUR ROLL NO');
    $('m-onboard-title').textContent='Got it — you’re '+(p.department||'set')+'.';
    const rows=[
      ['Name',p.name||'—'],
      ['Program',p.department||'—'],
      ['Batch',(typeof profileFullBatch==='function'?profileFullBatch(p):p.batch)||'—'],
      ['Section',p.section||'—']
    ];
    $('m-onboard-rows').innerHTML=rows.map(([l,v])=>
      `<div class="m-orow"><div class="m-orow-label">${esc(l)}</div><div class="m-orow-value">${esc(v)}</div></div>`
    ).join('');
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
     someone who does not exist. */
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
      <button class="m-btn-primary m-locked-btn" id="m-locked-login" type="button">Log in</button>
    </div>`;
  }
  function wireLocked(container){
    const btn=container.querySelector('#m-locked-login');
    if(btn) btn.addEventListener('click',()=>{ setSkipped(false); route='signin'; render(); });
  }

  function renderToday(){
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
      target.innerHTML=lockedHTML();
      wireLocked(target);
      return;
    }
    if(weekMode) renderWeek(keys,weekPane); else renderTodayList(keys,todayPane);
  }

  function renderTodayList(keys,pane){
    const day=todayName();
    const list=classesFor(keys.dept,keys.batch,keys.sec,day,keys.tt);
    if(!Object.keys(keys.tt||{}).length){
      pane.innerHTML='<div class="m-empty">Loading your timetable…</div>';
      return;
    }
    const now=nowMinutes();
    const rows=list.map(e=>{
      const time=e.time||e.t||'';
      const b=slotBounds(time);
      return {
        name:e.name||e.c||'', room:e.location||e.l||'—', time,
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
    html+=`<div class="m-meta-row"><span>${rows.length} CLASS${rows.length===1?'':'ES'}</span>
      <b>${esc(keys.dept)} · ${esc(keys.batch)} · ${esc(keys.sec)}</b></div>`;

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
    pane.innerHTML=html;

    tickBanner();
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
    pane.querySelectorAll('.m-gap').forEach(btn=>{
      btn.addEventListener('click',()=>go('rooms'));
    });
  }

  function classRowHTML(r){
    const note=noteOf(r.name);
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
      const list=classesFor(keys.dept,keys.batch,keys.sec,day,keys.tt);
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

  function renderWeek(keys,pane){
    if(!Object.keys(keys.tt||{}).length){ pane.innerHTML='<div class="m-empty">Loading your timetable…</div>'; return; }
    const today=todayName();
    const cards=DAYS.map(day=>{
      const list=classesFor(keys.dept,keys.batch,keys.sec,day,keys.tt);
      const body=list.length
        ? list.map(e=>{
            const time=e.time||e.t||'';
            return `<div class="m-dayrow">
              <div class="m-dayrow-time">${esc(toAmPm(time.split('-')[0]||''))}</div>
              <div class="m-dayrow-name">${esc(cleanName(e.name||e.c||''))}</div>
              <span class="m-pill">${esc(e.location||e.l||'—')}</span>
            </div>`;
          }).join('')
        : '<div class="m-dayrow"><div class="m-dayrow-name" style="color:rgba(22,33,15,.45);font-weight:500">No classes</div></div>';
      return `<div class="m-daycard${day===today?' is-today':''}">
        <div class="m-daycard-head"><span class="m-daycard-day">${esc(day)}</span>
          <span class="m-daycard-meta">${list.length} class${list.length===1?'':'es'}</span></div>
        <div class="m-daycard-body">${body}</div>
      </div>`;
    }).join('');
    pane.innerHTML='<div class="m-daycards">'+cards+'</div>';
  }

  /* ══ LOOKUP ════════════════════════════════════════════════════════ */
  const lk={school:'computing',program:'',batch:'',section:'',day:''};
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

    const batchLabel=b=>b==='REPEAT'?'Repeat':b;
    fields.innerHTML=[
      fieldHTML('School','school',lk.school?SCHOOL_LABELS[lk.school]:'',Object.keys(SCHOOL_LABELS),lk.school,k=>SCHOOL_LABELS[k]),
      fieldHTML('Program','program',lk.program,programs,lk.program),
      fieldHTML('Batch','batch',batchLabel(lk.batch),batches,lk.batch,batchLabel,'Pick a program first.'),
      fieldHTML('Section','section',lk.section,sections,lk.section,null,'Pick a batch first.'),
      fieldHTML('Day','day',lk.day,DAYS,lk.day)
    ].join('');

    fields.querySelectorAll('.m-chip').forEach(chip=>{
      chip.addEventListener('click',()=>onLookupPick(chip.dataset.field,chip.dataset.value));
    });
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
      lk.school=value; lk.program=''; lk.batch=''; lk.section='';
      // Only loader available: drive the desktop selector, same as a click there.
      const sel=$('school');
      if(sel){ sel.value=value; }
      if(typeof onSchoolChange==='function') onSchoolChange();
      else if(typeof refreshTimetableFromGoogleSheet==='function') refreshTimetableFromGoogleSheet();
      toast('Loading '+(SCHOOL_LABELS[value]||value)+'…');
      renderLookup();
      return;
    }
    if(field==='program'){ lk.program=lk.program===value?'':value; lk.batch=''; lk.section=''; }
    else if(field==='batch'){ lk.batch=lk.batch===value?'':value; lk.section=''; }
    else if(field==='section'){ lk.section=lk.section===value?'':value; }
    else if(field==='day'){ lk.day=lk.day===value?'':value; }
    renderLookup();
  }
  function renderLookupOut(){
    const out=$('m-lookup-out');
    if(!lk.program||!lk.batch||!lk.section||!lk.day){
      out.innerHTML='<div class="m-empty">Pick a school, program, batch, section and day to load a timetable.</div>';
      return;
    }
    const list=classesFor(lk.program,lk.batch,lk.section,lk.day);
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
    const cur=(typeof getCurrentSlot==='function')?getCurrentSlot():null;
    // cur is a raw "02:20-03:40" slot key — render it the way students read it.
    $('m-rooms-slot').textContent=cur
      ?('SLOT '+toAmPm(cur.split('-')[0])+' – '+toAmPm(cur.split('-')[1]))
      :'OUTSIDE CLASS HOURS';
    tickRoomsClock();

    $('m-block-grid').innerHTML=['A','B','C','D'].map(b=>{
      const rooms=roomsOfBlock(b);
      // Outside class hours nothing is "busy", so a free count would read 0 for
      // every block and look broken. Show the block's size instead.
      const sub=!rooms.length?'—'
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
    const startOf=r=>toAmPm(r.slot.split('-')[0]);
    const live=rows.find(r=>now>=r.start&&now<=r.end);
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
    const rooms=(BLOCK_FLOORS[rm.block]||{})[rm.floor]||[];
    if(!rooms.length){
      $('m-rooms-out').innerHTML='<div class="m-empty">No rooms listed on this floor yet.</div>';
      return;
    }
    const cards=rooms.map(room=>{
      const slots=roomSlots(room,day);
      const free=freeNowFromSlots(room,day,slots);
      const open=rm.open===room;
      const bars=slots.map(s=>`<span class="m-slot${s.occupiedBy?'':' is-free'}"></span>`).join('');
      const status=free===true?'Free now':free===false?'Class':'—';
      const detail=open?`<div class="m-room-detail" id="m-room-detail">
          <div class="m-room-summary">${esc(roomSummary(slots))}</div>
          <div class="m-slotrows">${slots.map(s=>{
            const busy=Boolean(s.occupiedBy);
            const who=busy?[s.occupiedBy.course,s.occupiedBy.section].filter(Boolean).join(' · '):'Free';
            return `<div class="m-slotrow">
              <span class="m-slotpill">${esc(toAmPm(s.slot.split('-')[0]))}–${esc(toAmPm(s.slot.split('-')[1]))}</span>
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
  const ex={tab:'schedule',dept:'',batch:'',seatQuery:''};

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
    if(!ex.dept&&typeof profileDeptCode==='function') ex.dept=profileDeptCode(p);
    if(!ex.batch&&typeof profileFullBatch==='function') ex.batch=profileFullBatch(p);
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
    return `<div class="m-meta-row"><span>Department</span><b style="${ex.dept?'':'color:rgba(22,33,15,.35)'}">${esc(ex.dept||'—')}</b></div>
      <div class="m-chip-row">${depts.map(d=>`<button class="m-chip${ex.dept===d?' is-on':''}" data-ex="dept" data-value="${esc(d)}" type="button">${esc(d)}</button>`).join('')}</div>
      <div class="m-meta-row"><span>Batch</span><b style="${ex.batch?'':'color:rgba(22,33,15,.35)'}">${esc(ex.batch||'—')}</b></div>
      <div class="m-chip-row">${batches.map(b=>`<button class="m-chip${ex.batch===b?' is-on':''}" data-ex="batch" data-value="${esc(b)}" type="button">${esc(b)}</button>`).join('')}</div>`;
  }
  function wireFilterChips(){
    $('m-exam-filters').querySelectorAll('.m-chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const k=btn.dataset.ex;
        ex[k]=ex[k]===btn.dataset.value?'':btn.dataset.value;
        renderExams();
      });
    });
  }

  function renderExamSchedule(){
    loadExamScheduleData().then(doc=>{
      if(ex.tab!=='schedule') return;
      const exams=(doc&&doc.exams)||[];
      const depts=Array.from(new Set(exams.flatMap(e=>Object.keys(e.sections||{})))).sort();
      const batches=Array.from(new Set(exams.map(e=>String(e.batch||'')).filter(Boolean))).sort();
      $('m-exam-filters').innerHTML=filterChips(depts,batches);
      wireFilterChips();

      const out=$('m-exam-out');
      if(!ex.dept||!ex.batch){
        out.innerHTML='<div class="m-empty">Pick a department and batch to see the exam schedule.</div>';
        return;
      }
      const mine=examsForDeptBatch(ex.dept,ex.batch)
        .slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
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
            <div class="m-exam-name">${esc(e.course||e.code||'Exam')}</div>
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
      mine=mine.slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
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
    // needsAim: the only game whose input is a POSITION rather than a press,
    // so it is the only one the rotation has to correct for. See wireAim().
    {id:'duck',name:'Duck Hunter',emoji:'🦆',desc:"Shoot the ducks, don't let them escape",
     canvas:'dh-canvas',lb:'dh-lb',best:'duck_hunter_hi',
     open:'openDuckHunter',close:'closeDuckHunter',
     needsAim:true,overLabel:'OUT OF LIVES',unit:'ducks'},
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
      // layoutStage() sizes and turns the canvas with inline styles. Those must
      // come off on the way out, or the desktop modal shows a rotated game.
      if(el.tagName==='CANVAS'){ el.style.width=''; el.style.height=''; el.classList.remove('is-rot'); }
      if(home) home.appendChild(el);
    });
    borrowedHome.clear();
    stageRotated=false;
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
     The play field is fixed at 720x220: each game reads canvas.width/height
     once into a const at load and tunes its ground line, gravity and gap sizes
     against them — and the leaderboard is shared with the desktop, so changing
     the field would make phone scores incomparable with the ones already on
     the board. Laid flat across a 390px phone that is 390x119, about 14% of
     the screen.

     So it is turned onto the phone's long axis instead: ~258x844, roughly 4.7x
     the play area, without touching a single game constant. Only taken when it
     is a clear win, so a wide window still gets the upright layout. */
  let stageRotated=false;
  function layoutStage(){
    const g=arcadeGame; if(!g) return;
    const cv=document.getElementById(g.canvas), host=$('m-stage-full');
    if(!cv||!host) return;
    const vw=host.clientWidth, vh=host.clientHeight;
    if(!vw||!vh) return;
    const ar=cv.width/cv.height;
    const flatW=vw, flatH=vw/ar;                  // upright: full width
    let turnLen=vh, turnThick=vh/ar;              // turned: full height
    if(turnThick>vw){ turnThick=vw; turnLen=vw*ar; }
    stageRotated=(turnLen*turnThick)>(flatW*flatH)*1.2;
    cv.classList.toggle('is-rot',stageRotated);
    cv.style.width=(stageRotated?turnLen:flatW)+'px';
    cv.style.height=(stageRotated?turnThick:flatH)+'px';
    showTurnHint(stageRotated);
  }
  let turnHintTimer=null;
  function showTurnHint(on){
    const el=$('m-turn-hint');
    if(!el) return;
    clearTimeout(turnHintTimer);
    el.hidden=!on;
    if(on) turnHintTimer=setTimeout(()=>{ el.hidden=true; },4200);
  }

  /* Viewport point -> canvas point, through whatever transform is applied.
     getBoundingClientRect() on a rotated element is its AXIS-ALIGNED box, so
     the naive (clientX - left) * (W / width) the games use is wrong the moment
     the canvas is turned. Everything that needs a position goes through here. */
  function toCanvasPoint(cv,clientX,clientY){
    const r=cv.getBoundingClientRect();
    const cw=parseFloat(cv.style.width)||r.width;    // pre-transform CSS size
    const ch=parseFloat(cv.style.height)||r.height;
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    let dx=clientX-cx, dy=clientY-cy;
    if(stageRotated){ const t=dx; dx=dy; dy=-t; }    // inverse of rotate(90deg)
    return {x:(dx+cw/2)*(cv.width/cw), y:(dy+ch/2)*(cv.height/ch)};
  }

  function startGame(g){
    stopGame();
    arcadeGame=g;
    $('m-stage-full').hidden=false;
    $('m-dead').hidden=true;
    borrow(g.canvas,$('m-play-stage'));
    layoutStage();
    if(g.duckZone) wireDuckZone(g);
    if(g.needsAim) wireAim(g);
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
    showTurnHint(false);
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
      // In GAME space, so the split lands in the same place whether the canvas
      // is upright or turned onto the phone's long axis.
      if(toCanvasPoint(cv,ev.clientX,ev.clientY).y/cv.height < DUCK_ZONE) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      duckHeld=true;
      sendKey('keydown','ArrowDown');
    },true);
    // Release wherever the finger lifts — including off the canvas, which would
    // otherwise leave the player ducking for the rest of the run.
    ['pointerup','pointercancel'].forEach(t=>window.addEventListener(t,releaseDuck));
  }

  /* ── Aim, through the rotation ─────────────────────────────────────────
     Duck Hunter is the one game whose input is a POSITION, and it recovers
     that position with `(clientX - rect.left) * (W / rect.width)`. That is
     correct for a plain scaled canvas and wrong for a rotated one, because the
     rect is then the axis-aligned box.

     Rather than reach into the game (its shoot() is closure-private), the real
     tap is intercepted, mapped properly, and re-issued at whatever clientX /
     clientY the game's own formula needs in order to arrive at the right
     square. Untrusted events are ignored so the re-issue is not re-intercepted. */
  let aimWired=null;
  function wireAim(g){
    const cv=document.getElementById(g.canvas);
    if(!cv||cv===aimWired) return;
    aimWired=cv;
    cv.addEventListener('pointerdown',ev=>{
      if(!ev.isTrusted) return;                            // our own re-issue
      if(!arcadeGame||arcadeGame.canvas!==cv.id) return;
      if(!stageRotated) return;                            // upright: already correct
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const p=toCanvasPoint(cv,ev.clientX,ev.clientY);
      const r=cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,
        clientX:r.left+p.x*r.width/cv.width,
        clientY:r.top +p.y*r.height/cv.height}));
    },true);
  }

  /* ── You died ──────────────────────────────────────────────────────────
     app.js fires this from each game's gameOver(). Only now does the
     leaderboard come on screen. */
  function onGameOver(ev){
    if(!arcadeGame||!MQ.matches) return;
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

  function wireArcade(){
    const wrap=$('m-arcade');
    if(!wrap) return;
    $('m-arcade-close').addEventListener('click',closeArcade);
    $('m-stage-x').addEventListener('click',showPicker);
    $('m-dead-again').addEventListener('click',playAgain);
    $('m-dead-quit').addEventListener('click',showPicker);
    document.addEventListener('vtable:gameover',onGameOver);
    window.addEventListener('resize',()=>{ if(arcadeGame&&MQ.matches) layoutStage(); });
    // Turning the phone sideways puts the window past the mobile breakpoint, so
    // .m-app — and the canvas borrowed into it — goes display:none while the
    // desktop overlay reappears empty. Hand the game back at that moment and
    // the desktop modal picks it up mid-run, which is the right shape for a
    // 720x220 field anyway. Coming back to portrait re-borrows it.
    const onBreakpoint=()=>{
      if(!arcadeGame) return;
      if(MQ.matches){
        borrow(arcadeGame.canvas,$('m-play-stage'));
        if(!$('m-dead').hidden) borrow(arcadeGame.lb,$('m-play-lb'));
        layoutStage();
      }else{
        releaseDuck();
        returnAllBorrowed();
      }
    };
    if(MQ.addEventListener) MQ.addEventListener('change',onBreakpoint);
    else if(MQ.addListener) MQ.addListener(onBreakpoint);
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
      if(profile()) go('profile'); else { route='signin'; render(); }
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
      <div class="m-section-label">Your section</div>
      <div class="m-drow"><div class="m-drow-label">Program · batch · section</div>
        <div class="m-drow-value">${esc(p.department||'—')} · ${esc(batch||'—')} · ${esc(p.section||'—')}</div></div>
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

    const so=$('m-signout');
    if(so) so.addEventListener('click',()=>{
      if(typeof clearProfileCookie==='function') clearProfileCookie();
      setSkipped(false);
      fac.selected=null;
      route='signin';
      render();
    });
  }

  /* ══ WIRING ════════════════════════════════════════════════════════ */
  function wire(){
    $('m-signin-btn').addEventListener('click',doSignIn);
    $('m-nuid').addEventListener('keydown',e=>{ if(e.key==='Enter') doSignIn(); });
    $('m-reg-go').addEventListener('click',saveRegistration);
    $('m-reg-back').addEventListener('click',()=>{ route='signin'; render(); });
    $('m-reg-name').addEventListener('keydown',e=>{ if(e.key==='Enter') saveRegistration(); });
    $('m-manual-btn').addEventListener('click',()=>{ route='manual'; render(); });
    $('m-manual-go').addEventListener('click',saveManual);
    $('m-manual-back').addEventListener('click',()=>{ route='signin'; render(); });
    $('m-onboard-push').addEventListener('click',()=>enablePush('m-onboard-push-status','m-onboard-push'));
    $('m-onboard-go').addEventListener('click',()=>{ go('today',true); });
    $('m-onboard-back').addEventListener('click',()=>{
      if(typeof clearProfileCookie==='function') clearProfileCookie();
      route='signin'; render();
    });

    document.querySelectorAll('.m-tab').forEach(btn=>{
      btn.addEventListener('click',()=>go(btn.dataset.route));
    });
    $('m-avatar-btn').addEventListener('click',()=>go('profile'));
    $('m-bell-btn').addEventListener('click',()=>toast('Notification inbox is coming soon'));
    wireArcade();

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
      const r=readHash();
      if(r&&r!==route){ route=r; render(); }
    });
    // The desktop layer owns data loading; re-render when it lands something new.
    document.addEventListener('vtable:data',()=>{ if(MQ.matches) render(); });
    setInterval(()=>{ if(MQ.matches&&route==='rooms') tickRoomsClock(); },30000);
    setInterval(()=>{ if(MQ.matches&&route==='today'&&!weekMode) tickBanner(); },1000);
  }

  function start(){
    if(!$('m-app')) return;
    wire();
    render(); // paint the splash immediately
    const r=readHash();
    // render() decides sign-in vs app from the stored profile, so "today" is
    // just the default landing spot — a signed-in user goes straight there and
    // never sees the sign-in screen.
    const target=(r&&['today','lookup','rooms','faculty','exams','profile','signin'].includes(r))?r:'today';
    setTimeout(()=>{
      route=target;
      render();
    },Math.max(0,MIN_SPLASH_MS-(performance.now()||0)));
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
