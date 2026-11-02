import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, lowContrast, openUi, until } from './uiSupport.mjs';

const NOT_DECIDED = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_not_decided_cases.json');

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const OUTAGE = NOT_DECIDED.cases[0];
const VIBES = 'Put the riskiest customers first. Only check on weekdays.';
const ready = (version) => ({ state: 'ready', spec_version: version });
const spec = (top = {}) => {
  const made = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...made, ...top, outputs: { ...made.outputs, dashboard: true } };
};
const row = (version, status, top, assets, extra = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, change_classes: version === 1 ? 'initial' : 'vibe', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(spec(top)), job_id: '77', notebook_path: '/Users/owner/inspire/N01-U01',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published', asset_status: JSON.stringify(assets), ...extra,
});
const live = { dashboard: ready(1), notebook: ready(1) };
const outage = row(2, 'failed', { vibes: VIBES, vibe_previous: 'keep', based_on_version: 1 },
  { ...live, checklist: OUTAGE.entries, checklist_summary: OUTAGE.summary }, { status_message: OUTAGE.status_message });
const STATE = { history: [outage, row(1, 'ready', {}, live)], me: { userName: OWNER, displayName: 'Owner' } };
const region = (page) => page.getByRole('region', { name: 'Vibe checklist of v2', exact: true });
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

test('a vibe the router could not place reads Not decided with the agent reason, never Not met, never held, and Send again sends the same vibe', async () => {
  const ui = await openUi('implement', STATE);
  const { page, made } = ui;
  try {
    const tab = page.locator('[data-mvp-tab="build"]');
    await tab.waitFor({ timeout: 15000 });
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    const box = region(page);
    await box.waitFor({ timeout: 15000 });
    const headline = box.locator('[data-checklist-headline]');
    assert.equal(await headline.textContent(), OUTAGE.status_message, 'the agent reason, word for word');
    assert.match(await headline.getAttribute('class'), /\btext-warning-fg\b/);
    const rows = box.locator('[data-requirement]');
    assert.deepEqual(await rows.evaluateAll((list) => list.map((r) => r.dataset.requirement)), ['not_decided', 'not_decided']);
    assert.equal(await rows.nth(0).locator('p').first().textContent(), `Not decided: \u201c${OUTAGE.entries[0].requirement}\u201d`);
    assert.deepEqual(await rows.locator('[data-requirement-status]').allTextContents(), ['Not decided.', 'Not decided.'], 'the reason is said once, above');
    assert.equal(await box.getByText(/Not met/).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Rephrase', exact: true }).count(), 0);
    assert.equal(await page.locator('[data-held-version]').count(), 0, 'nothing was built, so nothing is held');
    assert.equal(await page.getByRole('region', { name: 'Build failed', exact: true }).count(), 0, 'the checklist says what happened and what to do');
    const contrast = await lowContrast(page, ['[aria-label="Vibe checklist of v2"]']);
    assert.ok(contrast.checked >= 6, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await box.getByRole('button', { name: 'Send again', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the vibe sent again');
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.vibes, sent.vibe_previous, sent.based_on_version], [VIBES, 'keep', 2]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
