// Fixture-only full-app checks. Uses installed Edge and PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const row = (course, dept, batch = '2025', date = '2026-09-19') =>
  ({ course, code: '', sections: { [dept]: ['A'] }, batch, date, time: '9:00 to 10:00 AM' });
const docs = {
  computing: { source_filename: '1st Sessional.xlsx', exams: [
    row('Software Design and Analysis', 'CS', '2025', '2026-09-21'),
    row('Digital Logic Design', 'CS'), row('Calculus', 'CS', '2024'),
  ] },
  business: { exams: [row('Accounting', 'BAF')] },
  engineering: { exams: [row('Circuits', 'EE')] },
};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let failed = false, delayed = false, pending;
      let onPending;
      const pendingReady = new Promise(resolve => { onPending = resolve; });
      await page.route('**/*', route => {
        const url = new URL(route.request().url()), p = url.pathname;
        if (p === '/js/status.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.SITE_STATUS={isLive:()=>true};' });
        if (p === '/api/db' && url.searchParams.get('doc')?.startsWith('exams/')) {
          const school = url.searchParams.get('doc').split('/')[1];
          if (delayed && school === 'computing') { pending = route; onPending(); return; }
          return failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: docs[school] });
        }
        if (p === '/api/timetable') return route.fulfill({ json: { ok: true, tt: {} } });
        if (p.startsWith('/api/') || p.startsWith('/db/') || url.hostname !== 'vtable.test') return route.fulfill({ json: {} });
        const file = path.join(root, 'web', p === '/' ? 'index.html' : p);
        return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
      });
      await page.goto('http://vtable.test/');
      await page.waitForFunction(() => typeof initExamSchedulePanel === 'function' && document.getElementById('ex-dept'));
      await page.evaluate(() => {
        setProfileCookie({ nuid: '25I-0001', name: 'Fixture', department: 'BS CS', batch: '25', section: 'A' });
        localStorage.setItem('fast_exam_prefs', JSON.stringify({ dept: 'CS', batch: '2025' }));
        initExamSchedulePanel();
      });
      await page.waitForFunction(() => document.querySelector('#exam-out tbody tr'));
      assert.match(await page.locator('#exam-out tbody tr').first().textContent(), /Digital Logic Design/);
      assert.equal(await page.locator('#exam-out tbody tr').count(), 2);
      assert.equal(await page.locator('#exam-source-badge').textContent(), 'SESSIONAL I SCHEDULE');
      assert.equal(await page.locator('#exam-flat-out').textContent(), '', 'Matrix schedules must not show a contradictory empty-course message');
      await page.evaluate(() => {
        const profile = getProfileCookie();
        profile.courseRemoved = ['DLD'];
        profile.courses = [{ name: 'Calculus', dept: 'CS', batch: '24', section: 'A' }];
        setProfileCookie(profile);
        renderExamSchedule();
      });
      assert.doesNotMatch(await page.locator('#exam-out').textContent(), /Digital Logic Design/);
      assert.match(await page.locator('#exam-out').textContent(), /Calculus/);
      for (const [school, dept, course] of [['business', 'BAF', 'Accounting'], ['engineering', 'EE', 'Circuits']]) {
        await page.evaluate(school => setExamSchool(school), school);
        await page.waitForFunction(dept => [...document.getElementById('ex-dept').options].some(o => o.value === dept), dept);
        await page.evaluate(dept => { document.getElementById('ex-dept').value = dept; document.getElementById('ex-batch').value = '2025'; renderExamSchedule(); }, dept);
        assert.match(await page.locator('#exam-out').textContent(), new RegExp(course));
      }
      delayed = true;
      await page.evaluate(() => setExamSchool('computing'));
      await pendingReady;
      assert.ok(pending, 'Computing request is held in flight');
      await page.evaluate(() => setExamSchool('business'));
      await page.waitForFunction(() => _examData?.exams?.[0]?.course === 'Accounting');
      await pending.fulfill({ json: docs.computing });
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      assert.equal(await page.evaluate(() => _examData.exams[0].course), 'Accounting', 'A late school response must not overwrite the selected school');
      delayed = false;
      failed = true;
      await page.evaluate(() => setExamSchool('computing'));
      await page.waitForFunction(() => document.getElementById('exam-out').textContent.includes('Could not load'));
      assert.doesNotMatch(await page.locator('#exam-flat-out').textContent(), /Loading/);
      failed = false;
      await page.evaluate(() => initExamSchedulePanel());
      await page.waitForFunction(() => _examData?.exams?.[0]?.course === 'Software Design and Analysis');
      assert.doesNotMatch(await page.locator('#exam-out').textContent(), /Could not load/);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS (${width}px): school filters, date order, My Courses, late responses, load failure and retry.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
