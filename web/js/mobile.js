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

  let route='today';
  let toastTimer=null;

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
  // The sheet writes afternoon slots 12-hour and unlabelled ("01:00" is 1 PM).
  // Everything shown to a student is normalised to 24h so "01:00" can never be
  // read as one in the morning.
  function to24(hhmm){
    try{
      const m=timeToNumber(hhmm);
      return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    }catch(e){ return String(hhmm||''); }
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
    const signedIn=Boolean(profile());
    const onboarding=route==='onboard';
    const signin=route==='signin'||(!signedIn&&!skipped()&&!onboarding);

    $('m-signin').classList.toggle('on',signin);
    $('m-onboard').classList.toggle('on',onboarding);
    $('m-main').classList.toggle('on',!signin&&!onboarding);
    const inner=['today','lookup','rooms','faculty','facdetail','exams','profile'];
    if(signin||onboarding){
      inner.forEach(id=>$('m-'+id).classList.remove('on'));
      return;
    }
    inner.forEach(id=>{ $('m-'+id).classList.toggle('on',route===id); });
    $('m-head-title').textContent=TITLES[route]||'VTable';

    const tabRoute=route==='facdetail'?'faculty':route;
    document.querySelectorAll('.m-tab').forEach(btn=>{
      const on=btn.dataset.route===tabRoute;
      btn.classList.toggle('is-active',on);
      if(on) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
    });

    const p=profile();
    $('m-avatar-initials').textContent=p?initials(p.name):'—';

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
        signinStatus('No student found for that NU ID. Check it, or skip login for now.',true);
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

  /* ══ TODAY / WEEK ══════════════════════════════════════════════════ */
  let weekMode=false;

  // The section's classes for one day, with batch-wide ("ALL") entries folded
  // in exactly as the desktop timetable does.
  function classesFor(dept,batch,sec,day){
    const base=(TT[dept]&&TT[dept][batch]&&TT[dept][batch][sec]&&TT[dept][batch][sec][day])||[];
    const all=(sec&&TT[dept]&&TT[dept][batch]&&TT[dept][batch][ALL_SECTIONS]&&TT[dept][batch][ALL_SECTIONS][day])||[];
    const merged=all.length?mergeSectionEntries(base,all):base;
    return sortByTime(merged);
  }
  function profileKeys(){
    const p=profile();
    if(!p) return null;
    const dept=String(p.department||'').trim();
    const batch=(typeof profileFullBatch==='function')?profileFullBatch(p):String(p.batch||'');
    const sec=String(p.section||'').trim().toUpperCase();
    if(!dept||!batch||!sec) return null;
    return {dept,batch,sec,profile:p};
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
    const list=classesFor(keys.dept,keys.batch,keys.sec,day);
    if(!Object.keys(TT).length){
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

    let html='';
    if(current){
      html+=`<div class="m-now" id="m-now-banner" title="">
        <div class="m-now-head"><span class="m-now-dot"></span><span>IN CLASS NOW · ENDS ${esc(to24(current.end))}</span></div>
        <div class="m-now-name">${esc(cleanName(current.name))}</div>
        <div class="m-now-stats">
          <div><div class="m-now-stat-label">Room</div><div class="m-now-stat-value">${esc(current.room)}</div></div>
          <div><div class="m-now-stat-label">Time</div><div class="m-now-stat-value">${esc(to24(current.start))}</div></div>
        </div>
      </div>`;
    }
    html+=`<div class="m-meta-row"><span>${esc(day.toUpperCase())} · ${rows.length} CLASS${rows.length===1?'':'ES'}</span>
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

    const banner=$('m-now-banner');
    if(banner){
      // Same easter egg as double-clicking the header logo on desktop.
      banner.addEventListener('dblclick',()=>{ if(window.openGamePicker) window.openGamePicker(); });
      let lastTap=0;
      banner.addEventListener('pointerup',ev=>{
        const t=Date.now();
        if(t-lastTap>0&&t-lastTap<450){ ev.preventDefault(); if(window.openGamePicker) window.openGamePicker(); lastTap=0; }
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
      <div class="m-row-time"><div class="m-row-start">${esc(to24(r.start))}</div><div class="m-row-end">${esc(to24(r.end))}</div></div>
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
      <span class="m-gap-text">Free until ${esc(to24(until))} — see what rooms are open</span>
      <span class="m-gap-go">Find one &rsaquo;</span>
    </button>`;
  }

  function renderWeek(keys,pane){
    if(!Object.keys(TT).length){ pane.innerHTML='<div class="m-empty">Loading your timetable…</div>'; return; }
    const today=todayName();
    const cards=DAYS.map(day=>{
      const list=classesFor(keys.dept,keys.batch,keys.sec,day);
      const body=list.length
        ? list.map(e=>{
            const time=e.time||e.t||'';
            return `<div class="m-dayrow">
              <div class="m-dayrow-time">${esc(to24(time.split('-')[0]||''))}</div>
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
    const programs=Object.keys(TT||{});
    if(lk.program&&!programs.includes(lk.program)) lk.program='';
    const batches=lk.program?Object.keys(TT[lk.program]||{}):[];
    if(lk.batch&&!batches.includes(lk.batch)) lk.batch='';
    const sections=(lk.program&&lk.batch)
      ? Object.keys(TT[lk.program][lk.batch]||{}).filter(s=>s!==ALL_SECTIONS)
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
  const rm={block:'',floor:''};

  // Whole-day occupancy for one room. Deliberately NOT getRoomSlotInfo(),
  // which hides slots that have already passed when the day is today — the
  // design's bar is the day's full slot grid, green for free, grey for busy.
  function roomSlots(room,day){
    const list=slotsForRoom(room);
    const sources=BLOCK_SOURCES[roomBlock(room)]||['computing'];
    const useSheet=(typeof isCDBlockRoom==='function')&&isCDBlockRoom(room);
    return list.map(slot=>{
      let occupiedBy=useSheet?findCDOccupancy(room,day,slot):null;
      for(let i=0;i<sources.length&&!occupiedBy;i++){
        occupiedBy=findOccupancyInTT(ROOM_TT[sources[i]],room,day,slot);
      }
      return {slot,occupiedBy};
    });
  }
  function roomsOfBlock(block){
    const floors=BLOCK_FLOORS[block]||{};
    return Object.keys(floors).reduce((acc,f)=>acc.concat(floors[f]||[]),[]);
  }
  function isFreeNow(room,day){
    if(day!==todayName()) return null;
    const list=slotsForRoom(room);
    const cur=getCurrentSlotFor(list);
    if(!cur) return null;
    const info=roomSlots(room,day).find(s=>s.slot===cur);
    return info?!info.occupiedBy:null;
  }

  function renderRooms(){
    const day=todayName();
    const cur=(typeof getCurrentSlot==='function')?getCurrentSlot():null;
    $('m-rooms-slot').textContent=cur?('SLOT '+cur):'OUTSIDE CLASS HOURS';
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
        renderRooms();
      });
    });

    if(!rm.floor){
      $('m-rooms-out').innerHTML='<div class="m-empty">Now pick a floor.</div>';
      return;
    }
    const rooms=(BLOCK_FLOORS[rm.block]||{})[rm.floor]||[];
    if(!rooms.length){
      $('m-rooms-out').innerHTML='<div class="m-empty">No rooms listed on this floor yet.</div>';
      return;
    }
    const cards=rooms.map(room=>{
      const slots=roomSlots(room,day);
      const free=isFreeNow(room,day);
      const bars=slots.map(s=>`<span class="m-slot${s.occupiedBy?'':' is-free'}" title="${esc(s.slot)}${s.occupiedBy?' · '+esc(s.occupiedBy):' · free'}"></span>`).join('');
      const status=free===true?'Free now':free===false?'Class':'—';
      return `<div class="m-room${free===true?' is-free':''}">
        <div class="m-room-name">${esc(room)}</div>
        <div class="m-slots">${bars}</div>
        <div class="m-room-status">${esc(status)}</div>
      </div>`;
    }).join('');
    $('m-rooms-out').innerHTML=`<div class="m-roomlist m-reveal">${cards}</div>
      <div class="m-caption">Each bar is the day’s slots — green is free, grey is booked. Labs run four long slots instead of eight.</div>`;
  }
  function tickRoomsClock(){
    const el=$('m-rooms-clock');
    if(!el) return;
    el.textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
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

  /* ══ PROFILE ═══════════════════════════════════════════════════════ */
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
    const batch=(typeof profileFullBatch==='function')?profileFullBatch(p):p.batch;
    out.innerHTML=`<div class="m-pcard">
        <div class="m-pcard-avatar">${esc(initials(p.name))}</div>
        <div style="min-width:0">
          <div class="m-pcard-name">${esc(p.name||'Student')}</div>
          <div class="m-pcard-sub">${esc(p.nuid||'')} · ${esc(p.department||'')} · ${esc(p.section||'')}</div>
        </div>
      </div>
      <div class="m-section-label">Notifications</div>
      <button class="m-btn-ghost" id="m-enable-push" type="button" style="margin-bottom:12px">Enable notifications</button>
      ${cats.map(c=>`<label class="m-toggle-row${c.dead?' is-pending':''}" for="m-pref-${c.key}">
          <span class="m-toggle-text">
            <span class="m-toggle-label">${esc(c.label)}${c.dead?'<span class="m-soon">Soon</span>':''}</span>
            <span class="m-toggle-help">${esc(c.help)}</span>
          </span>
          <input class="m-toggle" id="m-pref-${c.key}" type="checkbox" ${prefs[c.key]?'checked':''} ${c.dead?'disabled':''}>
        </label>`).join('')}
      <div class="m-section-label">Your section</div>
      <div class="m-drow"><div class="m-drow-label">Program · batch · section</div>
        <div class="m-drow-value">${esc(p.department||'—')} · ${esc(batch||'—')} · ${esc(p.section||'—')}</div></div>
      <button class="m-btn-ghost" id="m-signout" type="button" style="margin-top:18px">Sign out</button>`;

    cats.forEach(c=>{
      const el=$('m-pref-'+c.key);
      if(el&&!c.dead) el.addEventListener('change',()=>{
        if(typeof onNotificationPrefChange==='function') onNotificationPrefChange(c.key,el.checked);
        toast('Saved');
      });
    });
    const push=$('m-enable-push');
    if(push) push.addEventListener('click',()=>{ if(typeof enableSeatAlerts==='function') enableSeatAlerts(); });
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
    $('m-skip-btn').addEventListener('click',()=>{
      setSkipped(true);
      route='today';
      render();
      toast('Browsing without a profile');
    });
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

    $('m-seg-today').addEventListener('click',()=>{ weekMode=false; renderToday(); });
    $('m-seg-week').addEventListener('click',()=>{ weekMode=true; renderToday(); });
    ['schedule','seating','showup'].forEach(t=>{
      $('m-seg-'+t).addEventListener('click',()=>{ ex.tab=t; $('m-exam-out').innerHTML=''; renderExams(); });
    });

    $('m-fac-search').addEventListener('input',e=>{ fac.q=e.target.value; renderFaculty(); });
    $('m-fac-back').addEventListener('click',()=>go('faculty'));

    window.addEventListener('hashchange',()=>{
      const r=readHash();
      if(r&&r!==route){ route=r; render(); }
    });
    // The desktop layer owns data loading; re-render when it lands something new.
    document.addEventListener('vtable:data',()=>{ if(MQ.matches) render(); });
    setInterval(()=>{ if(MQ.matches&&route==='rooms') tickRoomsClock(); },30000);
  }

  function start(){
    if(!$('m-app')) return;
    wire();
    const r=readHash();
    if(r&&['today','lookup','rooms','faculty','exams','profile','signin'].includes(r)) route=r;
    if(route==='facdetail') route='faculty';
    render();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
