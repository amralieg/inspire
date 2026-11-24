import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { closeBrowser, expandBuild, openSettings, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const I = createRequire(import.meta.url)('../../../backend/lib/inspireImplement');
const PREFLIGHT = '/api/inspire/implement/preflight';

// REQ-456: the default result location is right; only USE CATALOG on the Inspire catalog is missing for a new App's service principal.
const APP_TOKEN = 'tok';
const DEFAULT_TABLE = 'main._inspire_n01_u01.n01_u01_results';
const row = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: String(mine), me: OWNER });
// the catalog owner is someone else, account users hold no USE CATALOG, and the Inspire principal owns the schema
const MY_AWS_SHAPE = [row('catalog', 'OWNER', 'admins', false), row('catalog', 'USE_CATALOG', 'inspire-sp', true),
  row('catalog', 'CREATE_SCHEMA', 'inspire-sp', true), row('catalog', 'BROWSE', 'account users', true),
  row('schema', 'OWNER', 'inspire-sp', true), row('table', 'OWNER', 'inspire-sp', true)];

test('the default result table is the Inspire-owned schema, and a missing USE CATALOG names the exact GRANT, not another table (REQ-456)', async () => {
  const spec = { ...builtSpec(), config: { ...builtSpec().config, result_table: DEFAULT_TABLE } };
  assert.equal(spec.config.result_table, DEFAULT_TABLE, 'must-keep: the default location is already an Inspire-owned schema');
  // the backend's own verdict for a catalog-only USE CATALOG gap, served through the preflight route the page reads
  const gap = I.accessPlan(DEFAULT_TABLE, MY_AWS_SHAPE, '', {}).gaps;
  assert.deepEqual(gap.map((g) => g.privilege), ['USE CATALOG'], 'the my-aws shape leaves exactly the catalog gap');
  const detail = I.appAccessMessage(DEFAULT_TABLE, gap);
  const ok = (what) => ({ ok: true, detail: what });
  const mount = (app) => app.post(PREFLIGHT, (_req, res) => res.json({
    ok: false, identity: 'inspire-manual',
    checks: { warehouse: ok('ran'), output: ok('written'), app_access: { ok: false, detail } },
    features: {},
  }));
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
      updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(spec), app_name: 'churn-desk', asset_status: JSON.stringify({}) }],
  }, '', { mount });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await openSettings(page);
    await page.getByRole('region', { name: 'Vibes', exact: true }).getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).fill('Answer in euros', { timeout: 15000 });
    await toSummary(page);
    await page.locator('[data-access-verdict="pending"]').waitFor({ state: 'detached', timeout: 25000 });
    await page.getByText(/reads the data/).first().waitFor({ timeout: 30000 });
    const text = await page.getByText(/reads the data/).first().locator('xpath=ancestor::*[3]').textContent(); // the GRANT sits in the closed Details drawer by design
    assert.match(text, /App reads the data/, 'the row is on the page');
    // REQ-478 FX-91 (d12197f4b): no GRANT wording to business users; the row says the App cannot open the catalog and to run the installer again
    assert.ok(text.includes('it cannot open the catalog yet') && text.includes('run the Inspire installer again'), 'the row names the catalog gap and the installer');
    assert.doesNotMatch(text, /GRANT /);
    assert.doesNotMatch(text, /choose a result table in a catalog and schema Inspire manages/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
