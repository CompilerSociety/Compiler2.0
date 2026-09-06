// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// All roster and timetable data are fixtures; no external requests or writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('web/js/app.js');
const shared = ['formatNuid', 'validateNuid', 'profileFullBatch', 'parseProfileFromStudent', 'deptCodeToLabel', 'getProfileDataFileForNuid', 'stripNote'].map(name => {
  const start = app.indexOf(`function ${name}(`);
  return app.slice(start, app.indexOf('\n}', start) + 2);
}).join('\n');
const fixtures = `
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], ALL_SECTIONS='ALL';
const owner={name:'Owner',nuid:'25I-0001',department:'BS CS',batch:'25',section:'A'};
const TT={'BS CS':{'2025':{A:{Monday:[]},B:{Monday:[{name:'Friend course',time:'08:30-11:15',location:'C-101'}]},ALL:{Tuesday:[{name:'Shared seminar',time:'01:00-02:20',location:'Auditorium'}]}}}};
const engineering={'BS EE':{'2025':{C:{Wednesday:[{name:'Circuits',time:'08:30-11:15',location:'E-101'}]}}}};
function getProfileCookie(){return owner;}
function setProfileCookie(){throw Error('Friends must not change the owner profile');}
function publishProfileToRoster(){throw Error('Friends must not publish profiles');}
function getMyCourses(){return [];}
function myCoursesRowsForDay(){return [{name:'Owner-only course',time:'08:30-09:50',location:'C-001'}];}
function myScopeFromCookie(){return owner;}
function myCourseSource(school){return school==='engineering'?engineering:TT;}
function mergeSectionEntries(a,b){return [...a,...b];}
function nowMinutes(){return 600;}
function slotToMinutes(value){let [h,m]=value.split(':').map(Number);if(h<8)h+=12;return h*60+m;}
function timeToNumber(value){return slotToMinutes(value);}
`;
new (require('node:vm').Script)(shared+'\n'+fixtures+'\n'+read('web/js/mobile.js'));
const css = ['web/css/main.css', 'web/css/mobile.css'].map(file => read(file).replace(/@import[^;]+;/g, '')).join('\n');
const html = `<!doctype html><html data-mobile-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#141414"><style>${css}</style></head><body>${read('web/components/mobile-app.html')}<script>${shared}\n${fixtures}\n${read('web/js/mobile.js')}</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], writes = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser:',error.message); });
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => {
      const request = route.request();
      if (request.method() !== 'GET') writes.push(request.url());
      if (request.url().includes('/db/students/')) return route.fulfill({ json: { students: [{ nuid: '25I-1234', name: 'Roster Friend', department: 'CS', batch: '25', section: 'B' }] } });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('http://vtable.test/#/profile');
    await page.locator('#m-add-friend').click();
    await page.locator('#m-friend-nuid').fill('25i1234');
    await page.locator('#m-friend-find').click();
    await page.locator('#m-friend-name').waitFor();
    assert.equal(await page.locator('#m-friend-name').inputValue(), 'Roster Friend');
    await page.getByRole('button', { name: 'Save friend', exact: true }).click();
    assert.equal(await page.locator('[data-friend]').count(), 1);
    await page.locator('#m-friends-close').click();
    await page.locator('.m-tab[data-route="today"]').click();
    await page.locator('#m-friends-btn').click();
    await page.locator('[data-friend="25I-1234"]').click();
    const week = await page.locator('#m-friend-week').innerText();
    assert.match(week, /Friend course/);
    assert.match(week, /Shared seminar/);
    assert.match(week, /8:30 AM - 11:15 AM/);
    assert.doesNotMatch(week, /Owner-only course/);
    if (process.env.FRIENDS_SCREENSHOT) await page.screenshot({ path: process.env.FRIENDS_SCREENSHOT });
    await page.locator('#m-friend-back').click();
    await page.locator('#m-friend-new').click();
    await page.locator('#m-friend-nuid').fill('25I-1234');
    await page.locator('#m-friend-find').click();
    assert.match(await page.locator('#m-friend-status').innerText(), /already/);
    await page.locator('#m-friend-nuid').fill('25I-9999');
    await page.locator('#m-friend-find').click();
    await page.locator('#m-friend-name').waitFor();
    assert.match(await page.locator('#m-friend-status').innerText(), /not in the roster/);
    await page.locator('#m-friend-name').fill('Manual Friend');
    await page.locator('#m-friend-school').selectOption('engineering');
    await page.locator('#m-friend-dept').fill('BS EE');
    await page.locator('#m-friend-section').fill('C');
    await page.getByRole('button', { name: 'Save friend', exact: true }).click();
    await page.locator('[data-friend="25I-9999"]').click();
    assert.match(await page.locator('#m-friend-week').innerText(), /Circuits/);
    await page.reload();
    await page.locator('#m-friends-btn').click();
    assert.equal(await page.locator('[data-friend]').count(), 2);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator('#m-friends-body').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    await page.locator('[data-remove-friend="25I-1234"]').click();
    await page.locator('[data-remove-friend="25I-9999"]').click();
    await page.locator('#m-friends-close').click();
    assert.equal(await page.locator('#m-friends-btn').isVisible(), false);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('vtable_friends_v1'))), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log('PASS: roster lookup, manual entry, duplicate prevention, persistence, removal, isolated weekly timetables and mobile widths; no server writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
