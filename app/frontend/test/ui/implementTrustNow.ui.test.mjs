import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, built } from './implementFixtures.js';
import { CURRENT_BUILD, closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const NOTE = 'Built with an earlier Inspire release. Rebuild to get the latest fixes.';
const LATER = 'Not reliable yet: run 333333333333333 stopped before it wrote any record: the newest pickup is 2016-02-29, older than the freshness limit';
const stamped = () => {
  const row = built();
  return { ...row, asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), built_with: CURRENT_BUILD }) };
};
const unstamped = () => built();
const wrote = (made) => made.fetches.some((f) => f.opts.method && f.opts.method !== 'GET' && /jobs|apps/.test(f.path))
  || made.sqlCalls.some((c) => /^(INSERT|UPDATE|MERGE)/.test(String(c.sql).trim()) && String(c.sql).includes('__inspire_implement'));

test('an MVP built on an older release says so on its Build page with the rebuild action, and nothing rebuilds on its own', async () => {
  const ui = await openUi('implement', { history: [unstamped()], buildStamp: CURRENT_BUILD });
  const { page, made } = ui;
  try {
    const note = page.locator('[data-rebuild-note] [data-older-build]');
    await note.waitFor({ timeout: 15000 });
    assert.equal((await note.textContent()).trim(), NOTE);
    const action = page.locator('[data-rebuild-note] button');
    assert.equal((await action.textContent()).trim(), 'Vibe/Add/Remove Features');
    await page.waitForTimeout(1500);
    assert.equal(wrote(made), false, 'opening the page never rebuilds');
  } finally {
    await ui.close();
  }
});

test('a build of this release shows no older-build note (must-exclude)', async () => {
  const ui = await openUi('implement', { history: [stamped()], buildStamp: CURRENT_BUILD });
  const { page } = ui;
  try {
    await page.locator('[data-use-case-pane]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('[data-older-build]').count(), 0);
  } finally {
    await ui.close();
  }
});

test('a run that turns unreliable after the build shows on the Build page with the rebuild action', async () => {
  const ui = await openUi('implement', { history: [stamped()], buildStamp: CURRENT_BUILD, moneySummary: [{ not_reliable: LATER, updated_at: '2026-11-05T01:00:00Z' }] });
  const { page } = ui;
  try {
    const banner = page.locator('[data-rebuild-note]');
    await banner.waitFor({ timeout: 15000 });
    assert.match(await banner.textContent(), /The newest run says its results are not reliable yet\. Fix what it names, then rebuild\./);
    await until(async () => (await page.getByText('MVP built, results not trusted yet').count()) > 0, 'the tile to say results are not trusted', 15000);
  } finally {
    await ui.close();
  }
});

test('the App list marks an MVP built on an older release and opens its Build page to rebuild', async () => {
  const registry = [{ ...unstamped(), created_by: OWNER, spec_json: JSON.stringify({ use_case_name: 'Predict churn', outputs: { app: true, app_owners: [] } }) }];
  const ui = await openUi('run', { registry, buildStamp: CURRENT_BUILD, useCaseScope: [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }] });
  const { page, made } = ui;
  try {
    const listed = page.locator('[data-run-page] [data-older-build]');
    await listed.waitFor({ timeout: 15000 });
    assert.equal((await listed.textContent()).trim(), NOTE);
    await page.locator('[data-run-page]').first().click();
    const action = page.getByRole('button', { name: 'Open its Build page to rebuild' });
    await action.waitFor({ timeout: 15000 });
    assert.equal(wrote(made), false);
    await action.click();
    await until(async () => (await page.getByLabel('Opened Build').textContent()) === '42:N01-U01', 'the Build page of this use case to open');
    assert.equal(wrote(made), false, 'it opens the Build page and starts nothing');
  } finally {
    await ui.close();
  }
});
