const assert=require('node:assert/strict');
const engine=require('../../web/js/exam-rooms.js');
const normalize=s=>s.toUpperCase().replace(/\s*-\s*/g,'-');
const schedules=[{school:'computing',exams:[{date:'2025-12-15'},{date:'2025-12-17'}]}];
const seating={room_occupancy:{version:1,complete:true,schools:['computing'],dates:['2025-12-15'],bookings:[
  {date:'2025-12-15',room:'C-301',start:540,end:720,course:'Morning exam'},
  {date:'2025-12-15',room:'C-301',start:780,end:960,course:'Afternoon exam'},
  {date:'2025-12-15',room:'D-301',start:1040,end:1220,course:'Evening exam'}
]}};
assert.equal(engine.dateKey(new Date('2025-12-14T20:00:00Z')),'2025-12-15');
assert.equal(engine.inSeason('2025-12-14',schedules,seating),false);
assert.equal(engine.inSeason('2025-12-15',schedules,seating),true);
assert.equal(engine.inSeason('2025-12-16',schedules,seating),true);
assert.equal(engine.inSeason('2025-12-18',schedules,seating),false);
assert.equal(engine.inSeason('2025-12-15',[],seating),true);
assert.equal(engine.inSeason('2026-12-15',schedules,seating),false);
assert.equal(engine.coverage('2025-12-15',schedules,seating,normalize),true);
assert.equal(engine.coverage('2025-12-16',schedules,seating,normalize),false);
assert.equal(engine.coverage('2025-12-15',schedules,null,normalize),false);
assert.equal(engine.coverage('2025-12-15',[...schedules,{school:'engineering',exams:[{date:'2025-12-15'}]}],seating,normalize),false);
assert.equal(engine.coverage('2025-12-15',schedules,seating,()=>null),false);
assert.equal(engine.occupant('c - 301','2025-12-15',719,720,seating,normalize).course,'Morning exam');
assert.equal(engine.occupant('C-301','2025-12-15',720,780,seating,normalize),null);
assert.equal(engine.occupant('C-301','2025-12-16',540,720,seating,normalize),null);
assert.equal(engine.occupant('C-306','2025-12-15',540,720,seating,normalize),null);
assert.deepEqual(engine.slots('2025-12-15',seating),['00:00-09:00','09:00-12:00','12:00-13:00','13:00-16:00','16:00-17:20','17:20-20:20','20:20-24:00']);
console.log('PASS: campus dates, season boundaries, missing/stale/incomplete coverage, school coverage, room aliases and exact exam/gap boundaries.');
