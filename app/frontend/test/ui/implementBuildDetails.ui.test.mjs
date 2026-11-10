import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const SKIPPED = 'hr.p.salaries';
const COUNT = "Skipped 1 table you can't read.";

test('a build with a skipped table says the count on the Build page and the table name only under Details (must-exclude)', async () => {
  const ui = await openUi('implement', ME);
  const { page } = ui;
  try {
    // The build response carries the count as a warning and the names as warning_details, as the backend returns them.
    await page.route('**/api/inspire/implement/submit', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'mvp', use_case_id: 'N01-U01', run_id: '991', warnings: [COUNT], warning_details: [`Tables you can't read: ${SKIPPED}`] }),
    }));
    await page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).click();
    await toSummary(page);
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 15000 });
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    const notes = page.locator('[data-build-notes]');
    await notes.waitFor({ timeout: 15000 });
    assert.equal((await notes.innerText()).trim(), COUNT, 'the sentence is the count only');
    assert.doesNotMatch(await notes.innerText(), /hr\.p\.salaries/, 'the table name is not in the sentence');
    const details = page.locator('[data-technical-details]');
    await details.first().waitFor();
    assert.match(await details.first().textContent(), /Details[\s\S]*Tables you can't read: hr\.p\.salaries/, 'the table name sits under Details');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
