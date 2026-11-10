import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const SAMPLE = 'samples.bakehouse.sales_transactions';
const STORED = "The App's service principal cannot read the access policies of samples.bakehouse.sales_transactions, so Inspire cannot tell whether the results keep them";

test('a stale stored refusal never drives the build card: the live verdict says copy the table, and no grant button is offered', async () => {
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    tokenKind: 'app',
    forwardedToken: 'person-tok',
    abacUnreadable: true,
    useCase: { id: 'N01-U01', use_case: 'Predict churn', primary_table: SAMPLE, tables_involved: SAMPLE },
    history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'failed', change_classes: 'initial', created_by: OWNER,
      updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()),
      asset_status: JSON.stringify({ protection: { state: 'failed', spec_version: 1, reason: STORED, sql: [], check: true, details: 'raw', tables: [SAMPLE] } }) }],
    statements: {},
  });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const banner = page.getByRole('region', { name: 'Build failed', exact: true });
    await banner.getByText('built-in sample catalog that Databricks owns', { exact: false }).waitFor({ timeout: 15000 });
    assert.equal(await banner.getByRole('button', { name: 'Let Inspire read these tables', exact: true }).count(), 0, 'no grant button when can_grant is false');
    assert.equal(await page.getByRole('button', { name: 'Let Inspire read these tables', exact: true }).count(), 0);
    assert.doesNotMatch(await banner.innerText(), /cannot read the access policies of samples/, 'the stored refusal is history under Details, not the main sentence');
    assert.match(await banner.innerText(), /built-in sample catalog that Databricks owns/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
