import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase, UNDELIVERED_LABEL } from '../../src/lib/implementWizard.js';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const APP_FAILED = 'App not published: Inspire tried 2 times and could not build it: the App still failed after 3 Genie rounds: '
  + 'page.json does not fit the App: page setting 11 needs a name of its own, of letters, digits and _';
const MESSAGE = `${APP_FAILED}; Notebook: Genie used Literal inspire_read_source calls reused by every step instead of Direct Spark table and SQL reads`;
const spec = () => {
  const made = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...made, outputs: { ...made.outputs, app: true } };
};
const row = (status, assets, message) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status, change_classes: 'initial', created_by: OWNER,
  updated_at: '2026-11-09T02:52:41Z', created_at: '2026-11-09T01:57:09Z', spec_json: JSON.stringify(spec()), job_id: '77',
  notebook_path: '/W/inspire/N01-U01', asset_status: JSON.stringify(assets), status_message: message,
});
const notPublished = {
  notebook: { state: 'ready', spec_version: 1 }, app: { state: 'failed', error: APP_FAILED.slice('App not published: '.length), spec_version: 1 },
  delivery: { spec_version: 1, delivered: [], not_delivered: [{ output: 'app', label: 'App', reason: 'Inspire tried 2 times and could not build it' }] },
};

test('a build whose App was not published says MVP incomplete in one plain sentence, with the raw reason under Details', async () => {
  const ui = await openUi('implement', { history: [row('ready_with_warnings', notPublished, MESSAGE)], me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    const card = page.locator('[data-progress-card]');
    await card.waitFor({ timeout: 15000 });
    assert.match(await card.locator('[data-build-headline]').textContent(), new RegExp(`^${UNDELIVERED_LABEL}`));
    assert.equal(await card.getByText(/^Warnings$/).count(), 0, 'an App that was not published is never a build done with warnings');
    const said = card.locator('[data-build-summary-reason]');
    assert.equal(await said.textContent(), 'The MVP is incomplete: Inspire could not build the App. Rebuild in Vibe/Add/Remove Features to try again.');
    assert.doesNotMatch(await said.textContent(), /page\.json|Genie rounds/);
    const details = card.locator('[data-technical-details]');
    assert.equal(await details.locator('summary').textContent(), 'Details');
    await details.locator('summary').click();
    assert.equal((await details.locator('pre').textContent()).trim(), MESSAGE);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a build that delivered every output keeps its own words and has no MVP incomplete (must-exclude)', async () => {
  const delivered = { notebook: { state: 'ready', spec_version: 1 }, app: { state: 'ready', spec_version: 1 },
    delivery: { spec_version: 1, delivered: ['app'], not_delivered: [] } };
  const warned = 'Notebook: Genie set Minimum usable rows to 1, not 0: the allowed range starts at 1';
  const ui = await openUi('implement', { history: [row('ready_with_warnings', delivered, warned)], me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    const card = page.locator('[data-progress-card]');
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getByText(UNDELIVERED_LABEL).count(), 0);
    assert.equal(await card.locator('[data-build-summary-reason]').textContent(), warned);
    assert.equal(await card.locator('[data-technical-details]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
