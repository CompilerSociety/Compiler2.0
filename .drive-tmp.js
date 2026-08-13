// Does the app call the SAME rooms empty, at every point in the day?
//
// Walks every block and floor and reads each room card's free/busy verdict
// straight off the rendered UI, at 20 points across Thursday — inside every
// slot, in every gap between slots, and outside class hours at both ends.
// Compares the pre-change build (8098) against the current one (8099).
const { chromium } = require('playwright-core');

const DATE = '2026-08-13'; // Thursday
// PKT is UTC+5, so subtract 5 to get the UTC instant.
const at = (hh, mm) => new Date(`${DATE}T${String(hh - 5).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
const TIMES = [
  [7, 0], [8, 30], [9, 0], [9, 49], [9, 55], [10, 0], [10, 45], [11, 25],
  [11, 30], [12, 30], [12, 55], [13, 0], [14, 0], [14, 25], [14, 30], [15, 45],
  [15, 52], [16, 30], [17, 18], [17, 30], [18, 42], [19, 30], [20, 5], [21, 0],
];
const label = ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

async function sweep(port) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  await page.clock.install({ time: at(11, 0) });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => setProfileCookie({ nuid: '22I-0507', name: 'T', department: 'CS', batch: '22', section: 'A' }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const result = {};
  for (const t of TIMES) {
    await page.clock.setFixedTime(at(t[0], t[1]));
    const key = label(t);
    const verdicts = {};
    // Re-enter the tab so the block grid recomputes at the new time.
    await page.evaluate(() => { location.hash = '#/today'; });
    await page.waitForTimeout(120);
    await page.evaluate(() => { location.hash = '#/rooms'; });
    await page.waitForTimeout(200);

    verdicts['__blockgrid'] = await page.$$eval('.m-block', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    verdicts['__slotline'] = await page.$eval('#m-rooms-slot', e => e.textContent.trim());

    for (const b of ['A', 'B', 'C', 'D']) {
      await page.click(`.m-block[data-block="${b}"]`);
      await page.waitForTimeout(100);
      const floors = await page.$$eval('#m-floor-row .m-chip', els => els.map(e => e.dataset.floor));
      for (const f of floors) {
        await page.click(`#m-floor-row .m-chip[data-floor="${f}"]`);
        await page.waitForTimeout(120);
        const rows = await page.$$eval('.m-room-card', cards => cards.map(c => {
          const btn = c.querySelector('.m-room');
          return [
            btn.querySelector('.m-room-name').textContent.trim(),
            btn.querySelector('.m-room-status').textContent.trim(),
            c.classList.contains('is-free') ? 'FREE' : c.classList.contains('is-busy') ? 'BUSY' : 'NEUTRAL',
            // the slot bar: which of the day's slots are drawn green
            [...btn.querySelectorAll('.m-slot')].map(s => s.classList.contains('is-free') ? '1' : '0').join(''),
          ].join('~');
        }));
        rows.forEach(r => { verdicts[r.split('~')[0]] = r; });
        await page.click(`#m-floor-row .m-chip[data-floor="${f}"]`);
        await page.waitForTimeout(60);
      }
      await page.click(`.m-block[data-block="${b}"]`);
      await page.waitForTimeout(60);
    }
    result[key] = verdicts;
    process.stdout.write('.');
  }
  await browser.close();
  return { result, errs };
}

(async () => {
  console.log('sweeping BEFORE build');
  const a = await sweep(8098);
  console.log('\nsweeping AFTER build');
  const b = await sweep(8099);
  console.log('\n');

  let totalRooms = 0, diffs = 0;
  const perTime = [];
  for (const t of TIMES.map(label)) {
    const A = a.result[t], B = b.result[t];
    const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
    let d = 0;
    for (const k of keys) {
      if (k.startsWith('__')) continue;
      totalRooms++;
      if (A[k] !== B[k]) {
        d++; diffs++;
        if (diffs <= 8) console.log(`  DIFF ${t} ${k}\n    before: ${A[k]}\n    after : ${B[k]}`);
      }
    }
    const gridSame = A.__blockgrid === B.__blockgrid;
    if (!gridSame) console.log(`  GRID DIFF ${t}\n    before: ${A.__blockgrid}\n    after : ${B.__blockgrid}`);
    perTime.push({ t, rooms: keys.filter(k => !k.startsWith('__')).length, roomDiffs: d, gridSame, grid: B.__blockgrid, slot: B.__slotline });
  }

  console.log('time    rooms  diffs  block grid (after)');
  for (const p of perTime) {
    console.log(`  ${p.t}   ${String(p.rooms).padStart(3)}   ${String(p.roomDiffs).padStart(4)}   ${p.grid}${p.gridSame ? '' : '   <-- GRID MISMATCH'}`);
  }
  console.log(`\nroom verdicts compared : ${totalRooms}`);
  console.log(`differences            : ${diffs}`);
  console.log('page errors            :', JSON.stringify(a.errs), JSON.stringify(b.errs));
  console.log(diffs === 0 ? '\nEMPTY ROOMS IDENTICAL AT EVERY TIME OF DAY' : '\nMISMATCH');
})();
