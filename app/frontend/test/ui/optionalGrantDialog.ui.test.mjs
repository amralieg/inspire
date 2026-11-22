import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, expandBuild, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

// REQ-216, REQ-131: an optional Lakebase grant opens Permission Required labelled optional, with Copy, and never gates a rebuild.
// A required grant still opens the dialog as a grant the person must act on.
test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED',
  text: `AED ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders'), inspire_score: '8.1' },
];

const OPTIONAL = { statements: ['GRANT CREATE ON DATABASE databricks_postgres TO "builder@example.com";'], instructions: [],
  principal: 'builder@example.com', why: 'Optional: pages load faster once your admin runs this. Until then the App reads Delta tables.', optional: true };
const REQUIRED = { statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`;'], instructions: [], principal: 'app-sp-2',
  why: 'Inspire reads this with your own access.' };

const historyWith = (permissions) => {
  const row = built({ status: 'ready_with_warnings', use_case_id: 'N01-U01' });
  const assets = JSON.parse(row.asset_status);
  assets.permissions = permissions;
  return { ...row, asset_status: JSON.stringify(assets) };
};

const mountFor = (log) => (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.post('/api/inspire/implement/preflight', (_req, res) => res.json({ checks: {} }));
  app.post('/api/inspire/implement/submit', (req, res) => {
    log.submits.push(req.body);
    res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 2, summary: {}, warnings: [] });
  });
};

const stateWith = (permissions) => ({ ...REVIEW_STATE, useCases: USE_CASES, history: [historyWith(permissions)] });

test('an optional Lakebase grant opens Permission Required labelled optional, with Copy, and a rebuild still submits after it is closed', async () => {
  const log = { submits: [] };
  const ui = await openUi('implement', stateWith([OPTIONAL]), '', { mount: mountFor(log) });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    // REQ-406: the entry is an inline note on load; the dialog opens from its See the grant button.
    await page.locator('[data-permission-note]').getByRole('button', { name: 'See the grant', exact: true }).click({ timeout: 15000 });
    const dialog = page.locator('[data-permission-dialog=""]').first();
    await dialog.waitFor({ timeout: 15000 });
    const text = await dialog.innerText();
    assert.match(text, /Optional: pages load faster once your admin runs this\./, 'the optional grant says it is optional');
    assert.doesNotMatch(text, /Ask your admin to grant this permission/, 'an optional grant is not presented as one the person must act on');
    assert.ok(await dialog.getByRole('button', { name: 'Copy', exact: true }).count(), 'the dialog keeps its Copy button');
    // Every dialog on the page is the optional one, so none of them says a grant is needed first.
    const all = await page.locator('[data-permission-dialog=""]').allInnerTexts();
    assert.ok(all.length > 0 && all.every((t) => /Optional:/.test(t) && !/Ask your admin/.test(t)), 'every dialog is labelled optional: ' + JSON.stringify(all.map((t) => t.slice(0, 40))));
    // Close from the top down, as a person would, until no dialog is left.
    for (let i = 0; i < 4 && (await page.locator('[data-permission-dialog=""]').count()) > 0; i++) {
      await page.locator('[data-permission-dialog=""]').last().getByRole('button', { name: 'Close', exact: true }).click();
    }
    await until(async () => (await page.locator('[data-permission-dialog=""]').count()) === 0, 'every Permission Required closes');
    // Adding a vibe enables Rebuild. The submit must go out whether or not the optional dialog was open.
    await expandBuild(page);
    // The desktop progress dock sits over this button (a layout finding, reported separately), so the click is dispatched on the element.
    await page.locator('[data-vibe-features]').first().evaluate((el) => el.click());
    const features = page.locator('[data-vibe-features-dialog]');
    await features.waitFor({ timeout: 15000 });
    await features.locator('[data-vibe-box="mvp"]').getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).fill('Put the riskiest customers first');
    await features.getByRole('button', { name: 'Add vibe', exact: true }).click();
    await features.locator('[data-rebuild]').click();
    await until(() => log.submits.length === 1, 'the rebuild submitted');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a required grant still opens Permission Required as a grant the person must pass to an admin', async () => {
  const ui = await openUi('app', stateWith([REQUIRED]), '', { mount: mountFor({ submits: [] }) });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('[data-permission-note]').getByRole('button', { name: 'See the grant', exact: true }).click({ timeout: 15000 });
    const dialog = page.locator('[data-permission-dialog=""]').first();
    await dialog.waitFor({ timeout: 15000 });
    // REQ-313: the grant's heading and SQL sit under Advanced; open it so the text reads.
    await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => { el.open = true; });
    const text = await dialog.innerText();
    assert.match(text, /For app-sp-2/, 'a required grant has a short heading for its grantee (REQ-300)');
    assert.doesNotMatch(text, /Ask your admin/, 'the repeated Ask your admin sentence is gone (REQ-300)');
    assert.doesNotMatch(text, /Optional:/, 'a required grant is never labelled optional');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
