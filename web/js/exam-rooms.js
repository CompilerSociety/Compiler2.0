/* Shared by the browser and Node regression tests. All dates are campus dates. */
(function(root){
  'use strict';
  const dateKey=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const rows=doc=>[...(Array.isArray(doc?.exams)?doc.exams:[]),...(Array.isArray(doc?.flat_exams)?doc.flat_exams:[])].filter(e=>e&&typeof e==='object');
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'');
  function inSeason(date,schedules,seating){
    if(seating?.room_occupancy?.dates?.includes(date)) return true;
    return schedules.some(doc=>{
      const dates=rows(doc).map(e=>e.date).filter(validDate).sort();
      return dates.length>0&&date>=dates[0]&&date<=dates[dates.length-1];
    });
  }
  function coverage(date,schedules,seating,normalize){
    const plan=seating?.room_occupancy;
    if(!plan?.complete||plan.version!==1||!plan.dates?.includes(date)||!Array.isArray(plan.bookings)) return false;
    if(plan.bookings.some(b=>!validDate(b.date)||!b.room||!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.start<0||b.end>1440||b.start>=b.end)) return false;
    // A school-specific seating file cannot prove other schools' rooms free.
    if(schedules.some(doc=>rows(doc).some(e=>e.date===date)&&!plan.schools?.includes(doc.school))) return false;
    const bookings=plan.bookings.filter(b=>b.date===date);
    return bookings.length>0&&bookings.every(b=>Boolean(normalize(b.room)));
  }
  function slots(date,seating){
    const bounds=new Set([0,1440]);
    for(const b of seating?.room_occupancy?.bookings||[]){
      if(b.date===date&&Number.isFinite(b.start)&&Number.isFinite(b.end)){bounds.add(b.start);bounds.add(b.end);}
    }
    const sorted=[...bounds].sort((a,b)=>a-b);
    const fmt=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
    return sorted.slice(0,-1).map((start,i)=>`${fmt(start)}-${fmt(sorted[i+1])}`);
  }
  function occupant(room,date,start,end,seating,normalize){
    const match=(seating?.room_occupancy?.bookings||[]).find(b=>b.date===date&&normalize(b.room)===normalize(room)&&b.start<end&&b.end>start);
    return match?{course:match.course||'Exam',section:'',exam:true}:null;
  }
  const api={dateKey,inSeason,coverage,slots,occupant};
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ExamRooms=api;
})(globalThis);
