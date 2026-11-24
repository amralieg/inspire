// REQ-510 L6 (declutter after REQ-508): the Build wizard dialog says less and keeps one main action, Next
// (briefs/req510_spec.md section 2.10). Fail-pre (a037bfdfb): the first step shows 188 body words; one primary (Next) already.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { describe, screenFacts } from './req510Declutter.mjs';

test.after(closeBrowser);

test('Build wizard: at most 100 words in the dialog and exactly one primary, Next', async () => {
  const ui = await openUi('wizard', {});
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[role="dialog"] button').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const f = await screenFacts(page, { root: '[role="dialog"]' });
    assert.ok(f.bodyWords <= 100, `wizard body words ${f.bodyWords} > 100 (${describe(f)})`);
    assert.deepEqual(f.primaries, ['Next'], `one primary, Next (${describe(f)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
