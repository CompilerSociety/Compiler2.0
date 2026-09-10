// Full application integration, using local static assets and fixture-only APIs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const seating={room_occupancy:{version:1,complete:true,dates:['2025-12-15'],schools:['computing'],bookings:[
  {date:'2025-12-15',room:'C-301',start:540,end:720,course:'Exam fixture'},
  {date:'2025-12-15',room:'C-302',start:780,end:960,course:'Afternoon fixture'}
]},students:[]};
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2025-12-15T06:59:00Z')});
    let missing=false;
    await page.route('**/*',route=>{
      const url=new URL(route.request().url()),p=url.pathname;
      const json=data=>route.fulfill({json:data});
      if(p==='/js/status.js') return route.fulfill({contentType:'text/javascript',body:'window.SITE_STATUS={isLive:()=>true};'});
      if(p==='/db/seating/plan.json') return missing?route.fulfill({status:404}):json(seating);
      if(p.startsWith('/db/exams/')) return json({exams:p.includes('computing')?[{date:'2025-12-15'},{date:'2025-12-16'}]:[]});
      if(p==='/api/timetable') return json({ok:true,tt:{'BS CS':{'2025':{A:{Monday:[{name:'Normal class',time:'08:30-11:15',location:'C-306'}]}}}}});
      if(p.startsWith('/api/')||p.startsWith('/db/')||url.hostname!=='vtable.test') return json({});
      const file=path.join(root,'web',p==='/'?'index.html':p);
      if(fs.existsSync(file)&&fs.statSync(file).isFile()) return route.fulfill({path:file});
      return route.fulfill({status:404});
    });
    await page.goto('http://vtable.test/');
    await page.waitForFunction(()=>typeof roomExamStatus!=='undefined'&&roomExamStatus==='ready'&&typeof window.ExamRooms==='object');
    let result=await page.evaluate(()=>({mode:isExamSeason,message:roomAvailabilityMessage('Monday'),busy:getRoomSlotInfo('C-301','Monday').find(s=>s.slot==='09:00-12:00').occupiedBy,free:getRoomSlotInfo('C-306','Monday').every(s=>!s.occupiedBy)}));
    assert.equal(result.mode,true);
    assert.equal(result.message,'');
    assert.equal(result.busy.course,'Exam fixture');
    assert.equal(result.free,true,'Class timetable must be ignored during exams');
    await page.evaluate(()=>{setProfileCookie({nuid:'25I-0001',name:'Owner',department:'BS CS',batch:'25',section:'A'});location.hash='#/rooms';});
    await page.clock.runFor(2000);
    await page.evaluate(()=>{location.hash='#/rooms';window.dispatchEvent(new HashChangeEvent('hashchange'));});
    await page.locator('[data-block="C"]').click();
    await page.locator('[data-floor="3"]').click();
    assert.match(await page.locator('[data-room="C-301"]').innerText(),/Exam/i);
    assert.match(await page.locator('[data-room="C-306"]').innerText(),/Free now/i);
    await page.clock.setSystemTime(new Date('2025-12-15T07:00:00Z'));
    await page.clock.runFor(1000);
    assert.match(await page.locator('[data-room="C-301"]').innerText(),/Free now/i);
    await page.evaluate(()=>{document.getElementById('r-block').value='C';onBlockChange();document.getElementById('r-floor').value='3';onFloorChange();document.getElementById('r-day-sel').value='Monday';onDayChange();});
    assert.match(await page.locator('#rooms-result').innerText(),/EXAM SEATING/);
    missing=true;
    await page.evaluate(()=>refreshRoomTimetables());
    assert.match(await page.locator('#rooms-result').innerText(),/complete seating plan/);
    assert.match(await page.locator('#m-rooms-out').innerText(),/complete seating plan/);
    await page.clock.setSystemTime(new Date('2025-12-17T05:00:00Z'));
    assert.equal(await page.evaluate(()=>updateRoomMode()),false);
    await page.evaluate(()=>refreshRoomTimetables());
    assert.equal(await page.evaluate(()=>roomAvailabilityMessage()),'');
    assert.equal(await page.evaluate(()=>getRoomSlotInfo('C-306','Monday').find(s=>s.occupiedBy)?.occupiedBy.course),'Normal class');
    assert.deepEqual(errors,[]);
    console.log('PASS: full app startup; exam source replaces classes; desktop display; missing plan becomes unknown; automatic exit from exam season.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
