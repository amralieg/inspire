import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const SHOTS = '/tmp/fx_home_shots';
const PROMISE = [
  'AI Enhanced Discovery is recommended: it gives the best results',
  'It groups your data and counts each group, so every use case fits the data you really have.',
  'No row of your data is ever shared with the AI. The AI sees only metadata, such as table and column names, and those counts.',
];
const FALSE_CLAIMS = [/nothing is shared/i, /\bunless\b/i, /\bDeep\b/, /[\u2013\u2014]/, /Standard Discovery is recommended/];
const SCREENS = [
  ['Start', 'launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } }, '[data-discovery-panel]'],
];

test('Start says, beside the discovery choice, that AI Enhanced Discovery gives the best results, groups the data and shares no data row with the AI', async () => {
  mkdirSync(SHOTS, { recursive: true });
  for (const [name, open, overrides, ready] of SCREENS) {
    const ui = await openUi(open, overrides);
    const { page } = ui;
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator(ready).first().waitFor({ timeout: 20000 });
      const promise = page.locator('[data-discovery-panel] [data-discovery-promise]');
      assert.equal(await promise.count(), 1, `${name} shows the message once`);
      await promise.scrollIntoViewIfNeeded();
      assert.equal(await promise.isVisible(), true, `${name} shows the message`);
      const text = await promise.innerText();
      for (const line of PROMISE) assert.ok(text.includes(line), `${name} says: ${line}`);
      for (const claim of FALSE_CLAIMS) assert.doesNotMatch(text, claim, `${name} makes no false claim ${claim}`);
      await page.screenshot({ path: `${SHOTS}/${name.toLowerCase()}_1280x800.png` });
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
