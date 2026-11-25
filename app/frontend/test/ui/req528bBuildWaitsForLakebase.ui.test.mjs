// REQ-528b (Amr, 2026-11-25): "user must have the app using Lakebase, if not found, or not able to create it, then use delta". Pressing Build while the Lakebase
// check is still running must wait, never build on Delta. Build is disabled with a spinner beside the text, and the spec sent after the check says lakebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openFolded, openUi, startMvp, toAppAccess, toSummary, until, BUILD_IT, POLICIED_SOURCE } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const CHECKING = 'Checking whether Lakebase is available';

// Per-user sign-in is the path where Next does not already wait for the check (the shared-access path stops at Where it lives), so it reaches Build with the check pending.
const FN = 'main.s.hide';
const filtered = {
  me: { userName: OWNER, displayName: 'Owner' },
  policies: POLICIED_SOURCE,
  rowFilters: { 'main.s.orders': { function_name: FN, input_column_names: ['region'] } },
  responses: { 'GET /api/2.0/postgres/projects': [{ projects: [] }, 200],
    [`GET /api/2.1/unity-catalog/functions/${FN}`]: [{ routine_definition: 'SELECT true', input_params: { parameters: [{ name: 'region' }] } }, 200] },
};

test('Build waits while the Lakebase check runs, then starts on Lakebase', async () => {
  const held = [];
  const mount = (app) => {
    app.get('/api/inspire/implement/lakebase', (_req, res) => { held.push(res); });
  };
  const ui = await openUi('wizard', filtered, '', { mount });
  const { page, made } = ui;
  try {
    await goToStep(page, 'Data');
    await goToStep(page, 'What to build');
    await toAppAccess(page);
    await page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Sensitive data/ }).check();
    await goToStep(page, 'Where it lives');
    await openFolded(page, 'App look');
    await toSummary(page);
    await until(() => held.length > 0, 'the Lakebase check was asked');
    const build = page.locator('button', { hasText: CHECKING });
    await build.waitFor({ timeout: 15000 });
    assert.equal(await build.isDisabled(), true, 'Build is disabled while the check runs');
    assert.equal(await build.locator('svg.animate-spin').count(), 1, 'a spinner sits beside the text');
    assert.equal(await page.getByRole('button', { name: BUILD_IT, exact: true }).count(), 0, 'the Build label is not shown while checking');
    assert.equal(made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO')).length, 0, 'nothing was submitted');
    for (const res of held) res.json({ state: 'available', enforce: { 'main.s.orders': { enforced: true } } });
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    assert.equal(inserts.length, 1);
    assert.equal(JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value).outputs.app_backend, 'lakebase');
  } finally { await ui.close(); }
});
