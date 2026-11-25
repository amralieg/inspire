// REQ-520 AD-33: on the dashboard filter bar the "Ask Genie" chip and the "?" help button sit on one line, bottom-aligned with the filter row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

for (const [w, h] of [[1280, 800], [1920, 1080], [2560, 1440]]) {
  test(`REQ-520 AD-33 @${w}: the Ask Genie chip and the ? button are centred on one line, on the filter row's bottom edge`, async () => {
    const { page } = await openApp(browser, served.base, appInfo(DECIDE), { hash: '#/n01_u05/dashboard', width: w, height: h, ready: '[data-ready]' });
    const f = await page.evaluate(() => {
      const bar = document.querySelector('.fbar');
      const rect = (el) => { const r = el.getBoundingClientRect(); return { mid: (r.top + r.bottom) / 2, bottom: r.bottom }; };
      const chip = rect(bar.querySelector('.ask-genie'));
      const help = rect(bar.querySelector('.help-q'));
      const row = Math.max(...[...bar.querySelectorAll('.fld')].map((e) => e.getBoundingClientRect().bottom));
      return { chip, help, row };
    });
    assert.ok(Math.abs(f.chip.mid - f.help.mid) <= 2, `chip centre ${f.chip.mid} vs ? centre ${f.help.mid}`);
    assert.ok(Math.abs(f.chip.bottom - f.row) <= 1 && Math.abs(f.help.bottom - f.row) <= 3, `bottoms: chip ${f.chip.bottom}, ? ${f.help.bottom}, filter row ${f.row}`);
  });
}
