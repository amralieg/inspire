import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE, REVIEW_SESSIONS } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED } : s));

test('the Review shows the two document buttons, and both wait for the catalog to be listed (REQ-077)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS });
  const { page } = ui;
  try {
    await page.locator('[data-document-actions]').waitFor();
    assert.equal((await page.locator('[data-doc-action="strategy-document"]').innerText()).trim(), 'Create strategy document');
    assert.equal((await page.locator('[data-doc-action="use-case-catalog"]').innerText()).trim(), 'Refresh use case catalog');
    assert.equal(await page.locator('[data-doc-action="strategy-document"]').isDisabled(), true, 'no catalog listed, so no job');
    assert.match(await page.locator('[data-document-actions]').innerText(), /Open the artifacts folder/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
