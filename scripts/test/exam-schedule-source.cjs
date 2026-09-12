const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require('node:path').join(__dirname, '../../web/js/app.js'), 'utf8');
const row = (code, course, date) => ({code, course, date, time:'9:00 to 10:00 AM', batch:'2025', sections:{CS:['A']}});
const latest = {exams:[
  row('CS3004', 'Software Design and Analysis', '2026-09-21'),
  row('EE1005', 'Digital Logic Design', '2026-09-19'),
]};
const stale = {exams:[row('CS3004', 'Software Design and Analysis', '2026-09-21')]};
const requests = [];
const context = vm.createContext({
  fetch: async url => {requests.push(url); return {ok:true, json:async()=>url.startsWith('/api/db?doc=exams/')?latest:stale};},
  getProfileCookie:()=>({department:'BS CS',batch:'25',section:'A'}),
  profileDeptCode:()=> 'CS', profileFullBatch:()=> '2025',
  getMyCourses:()=>[{name:'SDA'}, {name:'DLD'}],
  parseClock:(hours,minutes)=>Number(hours)*60+Number(minutes),
});
vm.runInContext(app.slice(app.indexOf('const EXAM_SCHEDULE_URLS='), app.indexOf('function onExamSchoolChange()')), context);
vm.runInContext(app.slice(app.indexOf('function examCourseName('), app.indexOf("const EXAM_PREF_KEY=")), context);
(async()=>{
  await vm.runInContext('loadExamScheduleData()', context);
  assert.deepEqual(requests, ['/api/db?doc=exams/computing']);
  const first = vm.runInContext("examsForDeptBatch('CS','2025').sort(compareExamDateTime)[0]", context);
  assert.equal(first.code, 'EE1005');
  assert.equal(first.date, '2026-09-19');
  for(const school of ['engineering','business']) {
    await vm.runInContext(`_examSchool='${school}'; _examData=null; _examLoadPromise=null; loadExamScheduleData()`, context);
    assert.equal(requests.at(-1), `/api/db?doc=exams/${school}`);
  }
  console.log('Exam source regression passed: live API wins over stale snapshot; CS 2025 starts with DLD.');
})().catch(error=>{console.error(error);process.exitCode=1;});
