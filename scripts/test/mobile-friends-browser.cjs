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
engineering['BS EE']['2024']={D:{Thursday:[]}};
function getProfileCookie(){return owner;}
function setProfileCookie(){throw Error('Friends must not change the owner profile');}
function publishProfileToRoster(){throw Error('Friends must not publish profiles');}
function getMyCourses(){return [];}
function myCoursesRowsForDay(){return [{name:'Owner-only course',time:'08:30-09:50',location:'C-001'}];}
function myScopeFromCookie(){return owner;}
function myCourseSource(school){return school==='engineering'?engineering:school==='business'?{}:TT;}
function mergeSectionEntries(a,b){return [...a,...b];}
function nowMinutes(){return 600;}
function slotToMinutes(value){let [h,m]=value.split(':').map(Number);if(h<8)h+=12;return h*60+m;}
function timeToNumber(value){return slotToMinutes(value);}
`;
new (require('node:vm').Script)(shared+'\n'+fixtures+'\n'+read('web/js/mobile.js'));
const css = ['web/css/main.css', 'web/css/mobile.css'].map(file => read(file).replace(/@import[^;]+;/g, '')).join('\n');
const html = `<!doctype html><html data-mobile-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#141414"><style>${css}</style></head><body>${read('web/components/mobile-app.html')}<script>${shared}\n${fixtures}\n${read('web/js/mobile.js')}</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], writes = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser:',error.message); });
    page.setDefaultTimeout(10000);
    let businessFails=true;
    const business={'BS Business Administration':{'2025':{A:{Monday:[{name:'Management',time:'08:30-09:50',location:'A-101'}]}}}};
    await page.route('**/*', route => {
      const request = route.request();
      if (request.method() !== 'GET') writes.push(request.url());
      if (request.url().includes('/api/timetable?school=business')) return businessFails
        ? route.fulfill({status:503,json:{ok:false}}) : route.fulfill({json:{ok:true,tt:business}});
      if (request.url().includes('/db/students/')) return route.fulfill({ json: { students: [{ nuid: '25I-1234', name: 'Roster Friend', department: 'CS', batch: '25', section: 'B' }] } });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('http://vtable.test/#/profile');
    await page.locator('#m-dark-mode-tip').waitFor({state:'visible'});
    assert.match(await page.locator('#m-dark-mode-tip').innerText(),/Dark mode to switch it on or off/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('vtable_dark_mode_tip_seen')),'1');
    await page.locator('#m-dark-mode-tip-close').click();
    assert.equal(await page.locator('#m-dark-mode-tip').isVisible(),false);
    await page.reload();
    await page.locator('#m-add-friend').waitFor({state:'visible'});
    assert.equal(await page.locator('#m-dark-mode-tip').isVisible(),false);
    assert.equal(await page.locator('#m-friend-sharing-setting').isVisible(),false);
    const pick=async(field,value)=>{
      await page.locator(`[data-picker="${field}"] summary`).click();
      await page.locator(`[data-pick="${field}"]`).and(page.locator(`[data-value="${value}"]`)).click();
    };
    await page.locator('#m-add-friend').click();
    for(const ownId of ['25I-0001','25i0001']){
      await page.locator('#m-friend-nuid').fill(ownId);
      await page.locator('#m-friend-find').click();
      assert.equal(await page.locator('#m-toast').isVisible(),true);
      assert.equal(await page.locator('#m-toast [lang="ur-Latn"]').innerText(), 'bazeecha-e-atfal ha dunia mery aagy\nhota ha shab-o-roz tamasha mery aagy');
      assert.equal(await page.locator('#m-toast [lang="ur"]').innerText(), 'بازیچۂ اطفال ہے دنیا مرے آگے\nہوتا ہے شب و روز تماشا مرے آگے');
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.mobileTheme=theme,theme);
        assert.equal(await page.locator('#m-toast').evaluate(el=>getComputedStyle(el).color),theme==='light'?'rgb(47, 107, 49)':'rgb(196, 125, 70)');
        await page.setViewportSize({width:320,height:844});
        assert.equal(await page.locator('#m-toast').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
        if(process.env.FRIENDS_SCREENSHOT) await page.screenshot({path:process.env.FRIENDS_SCREENSHOT.replace('.png',`-quote-${theme}.png`)});
      }
      assert.equal(await page.locator('#m-friend-save-form').count(),0);
    }
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
    assert.equal(await page.locator('#m-friend-save').isDisabled(),true);
    await pick('dept','BS CS');
    await pick('section','B');
    await pick('school','business');
    await page.getByText('Could not load the timetable for this school. Please retry.',{exact:true}).waitFor();
    assert.equal(await page.locator('#m-friend-save').isDisabled(),true);
    assert.equal(await page.locator('#m-friend-section').inputValue(),'');
    businessFails=false;
    await page.locator('#m-friend-retry').click();
    await pick('dept','BS Business Administration');
    await pick('section','A');
    assert.equal(await page.locator('#m-friend-save').isDisabled(),false);
    await pick('school','engineering');
    assert.equal(await page.locator('#m-friend-dept').inputValue(),'');
    assert.equal(await page.locator('#m-friend-section').inputValue(),'');
    await pick('dept','BS EE');
    await pick('batch','2024');
    await pick('section','D');
    await pick('batch','2025');
    assert.equal(await page.locator('#m-friend-section').inputValue(),'');
    assert.equal(await page.locator('#m-friend-save').isDisabled(),true);
    await pick('section','C');
    await page.locator('[data-picker="section"] summary').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-pick="section"][data-value="C"]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-picker="section"]').getAttribute('open'),null);
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.dataset.mobileTheme=theme,theme);
      await page.locator('[data-picker="school"] summary').click();
      await page.locator('[data-picker="section"] summary').click();
      for(const width of [320,390]){
        await page.setViewportSize({width,height:844});
        assert.equal(await page.locator('#m-friends-body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
        assert.equal(await page.locator('[data-picker="section"] summary').evaluate(el=>getComputedStyle(el).borderRadius),'16px');
        if(process.env.FRIENDS_SCREENSHOT) await page.screenshot({path:process.env.FRIENDS_SCREENSHOT.replace('.png',`-${theme}-${width}.png`)});
      }
      await page.locator('[data-picker="school"] summary').click();
      await page.locator('[data-picker="section"] summary').click();
    }
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
    console.log('PASS: self-add rejection; roster and fallback entry; cascading school/program/batch/section pickers; loading retry; keyboard selection; light/dark mobile widths; persistence, removal and isolated timetables; sharing toggle hidden; no server writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
