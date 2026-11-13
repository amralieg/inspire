import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' };
const labelCount = (page) => page.locator('[data-wizard-header] ol li').count();
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

test('the Build wizard shows no step count while the spec loads, so the first count it shows is the final count', async () => {
  let release;
  const held = new Promise((done) => { release = done; });
  const ui = await openUi('wizard', { me: ME }, '', {
    init: async (page) => {
      await page.route('**/api/inspire/implement/context?*', async (route) => {
        await held;
        await route.continue();
      });
    },
  });
  const { page, pageErrors } = ui;
  try {
    const during = [];
    for (let i = 0; i < 8; i += 1) {
      during.push(await labelCount(page));
      await sleep(100);
    }
    assert.deepEqual(during.filter((n) => n > 0), [], `no step count shows before the spec loads, saw ${during.join(',')}`);
    assert.equal(await page.locator('[data-step-bar-loading]').count(), 1, 'a loading line stands in for the step bar');
    release();
    await page.locator('[data-wizard-header] ol li').first().waitFor({ timeout: 15000 });
    const final = await labelCount(page);
    assert.ok(final > 0, 'the step bar shows once the spec is known');
    const after = [];
    for (let i = 0; i < 8; i += 1) {
      after.push(await labelCount(page));
      await sleep(100);
    }
    assert.deepEqual([...new Set(after)], [final], `the count never changes after it first shows, saw ${after.join(',')}`);
    assert.deepEqual(pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});
