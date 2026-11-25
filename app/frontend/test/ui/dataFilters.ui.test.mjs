import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { HARNESS_USE_CASE } from './implementFixtures.js';

test.after(closeBrowser);

// REQ-171: the use case details show a 'Data Filters' line with each filtered column and its picked values, read from the session's
// Table Scope by the use-case list. A use case with no filter shows no line; one whose session cannot be read says so.
const FILTERED = [{ column: 'product', text: 'Tokyo Tidbits' }, { column: 'region', text: 'north, south' }];

async function detailsLine(useCase) {
  const ui = await openUi('implement', { useCase: { ...HARNESS_USE_CASE, ...useCase } });
  const { page } = ui;
  try {
    await page.locator('[aria-label="Use case"]').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Use case details' }).click();
    await page.getByRole('dialog', { name: /^Use case details: / }).waitFor();
    return {
      line: await page.locator('[data-data-filters]').count() ? (await page.locator('[data-data-filters]').first().innerText()).trim() : null,
      unread: await page.locator('[data-data-filters="unread"]').count(),
      errors: ui.pageErrors,
    };
  } finally {
    await ui.close();
  }
}

test('the use case details list each filtered column with its picked values, in one Data Filters line', async () => {
  const got = await detailsLine({ data_filters: FILTERED });
  assert.equal(got.line, 'Data Filters: product: Tokyo Tidbits; region: north, south');
  assert.deepEqual(got.errors, []);
});

test('a use case with no filter shows no Data Filters line, and a session whose Table Scope cannot be read says so', async () => {
  assert.equal((await detailsLine({ data_filters: [] })).line, null, 'no filter, no line');
  const unread = await detailsLine({ data_filters: null });
  assert.equal(unread.unread, 1, 'an unreadable session is said so, never shown as no filters');
  assert.match(unread.line, /could not be read from this session/);
});

// REQ-389 follow-up (risk 2): when the build record cannot be read, the Discover filters stay and the details say the build's scope is unknown.
test('a use case whose build record cannot be read keeps the Discover filters and says the build scope could not be read (must-fail before)', async () => {
  const ui = await openUi('implement', { useCase: { ...HARNESS_USE_CASE, data_filters: FILTERED, build_scope_unread: true } });
  const { page } = ui;
  try {
    await page.locator('[aria-label="Use case"]').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Use case details' }).click();
    await page.getByRole('dialog', { name: /^Use case details: / }).waitFor();
    assert.equal((await page.locator('[data-data-filters]').first().innerText()).trim(), 'Data Filters: product: Tokyo Tidbits; region: north, south');
    assert.equal((await page.locator('[data-build-scope-unread]').innerText()).trim(), "The build's scope could not be read. The Data Filters above are the Discover run's.");
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
