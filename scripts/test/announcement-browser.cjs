// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const css = ['main', 'mobile', 'announcement'].map(name => read(`web/css/${name}.css`).replace(/^@import[^\r\n]+/gm, '')).join('\n');
const script = read('web/js/announcement.js');
const expiry = Date.parse('2026-09-25T10:00:00+05:00');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    async function setup({ now = expiry - 3600000, width = 390, theme = 'light', blocked = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'America/New_York' });
      await context.addInitScript(({ now, blocked }) => {
        Date.now = () => window.testNow ?? now;
        if (blocked) Storage.prototype.setItem = () => { throw Error('Storage blocked'); };
      }, { now, blocked });
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="${theme}" data-mobile-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><button id="underlying">Page content</button><script>${script}</script></body></html>` }));
      const page = await context.newPage();
      page.on('pageerror', error => { throw error; });
      await page.goto('http://localhost/announcement-test#timetable');
      return { context, page };
    }
    for (const method of ['x', 'outside', 'back', 'escape', 'done']) {
      const { context, page } = await setup();
      await page.locator('dialog[open]').waitFor();
      assert.match(await page.locator('h2').innerText(), /today/);
      await page.locator('#class-notice-copy').click();
      assert.equal(await page.locator('dialog[open]').count(), 1);
      if (method === 'x') await page.getByRole('button', { name: 'Close announcement' }).click();
      if (method === 'outside') await page.mouse.click(3, 3);
      if (method === 'back') await page.goBack();
      if (method === 'escape') await page.keyboard.press('Escape');
      if (method === 'done') await page.getByRole('button', { name: 'Got it' }).click();
      await page.waitForFunction(() => !document.querySelector('dialog'));
      await page.waitForFunction(() => !history.state?.vtableClassNotice);
      assert.match(page.url(), /#timetable$/);
      await page.reload();
      assert.equal(await page.locator('dialog').count(), 0);
      await context.close();
    }
    for (const now of [expiry, expiry + 1, expiry + 86400000]) {
      const { context, page } = await setup({ now });
      assert.equal(await page.locator('dialog').count(), 0);
      await context.close();
    }
    const timed = await setup({ now: expiry - 1 });
    await timed.page.locator('dialog[open]').waitFor();
    await timed.page.evaluate(value => { window.testNow = value; document.dispatchEvent(new Event('visibilitychange')); }, expiry);
    assert.equal(await timed.page.locator('dialog').count(), 0);
    await timed.context.close();
    const unavailable = await setup({ blocked: true });
    assert.equal(await unavailable.page.locator('dialog').count(), 0);
    await unavailable.context.close();
    for (const width of [320, 390, 1280]) {
      for (const theme of ['light', 'dark']) {
        const { context, page } = await setup({ now: Date.parse('2026-09-24T21:00:00+05:00'), width, theme });
        await page.locator('dialog[open]').waitFor();
        assert.match(await page.locator('h2').innerText(), /tomorrow/);
        const appearance = await page.locator('dialog').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, width: el.getBoundingClientRect().width, overflow: el.scrollWidth > el.clientWidth }));
        const expected = width < 768 ? (theme === 'dark' ? 'rgb(20, 20, 20)' : 'rgb(255, 255, 255)') : (theme === 'dark' ? 'rgb(22, 40, 28)' : 'rgb(255, 255, 255)');
        assert.equal(appearance.background, expected);
        assert.equal(appearance.overflow, false);
        assert.ok(appearance.width <= width - 32);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.closest('dialog') !== null), true);
        await page.screenshot({ path: `.cache/announcement-${theme}-${width}.png` });
        // Seen on presentation, even if the original tab is still open.
        const second = await context.newPage();
        await second.goto('http://localhost/announcement-test');
        assert.equal(await second.locator('dialog').count(), 0);
        await context.close();
      }
    }
    console.log('PASS: all dismissals, persistence, cutoff, resume, focus, timezone independence, and six theme/viewport combinations.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
