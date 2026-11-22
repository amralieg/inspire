import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built, STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

// FX-39b (REQ-457, W16 D27, D28, D37, D38, D39): the Build page reads one value source and one count source, shows how long a build has run,
// and stops polling after a 401.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mountBase = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };

async function go(page, hash) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
  await page.evaluate((target) => { window.location.hash = target; }, hash);
}

// D27: the use case is calculated on Review (totals), its rule estimate still asks for a rule. The Build list and detail read the totals too.
test('D27: the Build list and detail show the calculated value, not "Set a money rule", when the totals value the use case', async () => {
  const mount = (app) => {
    mountBase(app);
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: { 'N01-U01': { status: 'set_rule' } } }));
    app.get('/api/inspire/value/totals', (req, res) => res.json({ run: { totals: [], n: 1, n_calculated: 1, n_estimated: 0, n_none: 0, by_verb: [] },
      use_cases: { 'N01-U01': { status: 'calculated', amount: 3100000, currency: 'USD', verb: 'Value at stake' } } }));
  };
  const ui = await openUi('app', { ...REVIEW_STATE, history: [] }, '', { mount });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[aria-label="Use case"]').waitFor({ timeout: 20000 });
    await page.locator('[data-value-line-amount]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const text = await page.locator('[data-implement-page]').innerText();
    assert.doesNotMatch(text, /Set a money rule/, 'no ask for a rule next to a calculated value (must-exclude)');
    assert.match(await page.locator('nav[aria-label="Use cases"]').innerText(), /3\.1M|3,100,000/, 'the list shows the card amount');
    assert.match(await page.locator('[aria-label="Use case"]').innerText(), /3\.1M|3,100,000/, 'the detail shows the card amount');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

// D28/D39: an MVP with a delivered notebook counts in the header and in the filter chip alike.
test('D28/D39: the header notebook count equals the Notebook chip count', async () => {
  const delivered = built({ status: 'failed', status_message: 'the App stopped', notebook_path: '/Workspace/Users/someone/notebook', ...{ app_name: null, app_url: null } });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [delivered] });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const chip = page.locator('[data-asset-filter="notebook"]').locator('xpath=..');
    await chip.waitFor({ timeout: 20000 });
    const chipCount = Number((await chip.textContent()).match(/(\d+)\s*$/)[1]);
    const header = await page.locator('section[aria-label="Build summary"]').textContent();
    const headerCount = Number(header.match(/(\d+)Genie Code notebooks?/)[1]);
    assert.equal(chipCount, 1, 'the chip counts the delivered notebook');
    assert.equal(headerCount, chipCount, 'the header counts the same notebook (must-fail: 0 before the fix)');
    assert.match(await page.locator('h1 + p').innerText(), /1 Genie Code notebook\b/, 'the page subtitle agrees');
  } finally {
    await ui.close();
  }
});

// D38: a running build shows how long it has run and how long a build usually takes.
test('D38: a build that has run 26 minutes shows the elapsed time and a typical duration', async () => {
  const started = new Date(Date.now() - 26 * 60 * 1000).toISOString();
  const building = built({ status: 'building_outputs', status_message: 'building outputs', implement_run_id: '5555555555555555', created_at: started,
    updated_at: new Date().toISOString(), ...NOTHING_BUILT });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [building], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const line = page.locator('[data-progress-line]').first();
    await line.waitFor({ timeout: 20000 });
    const text = await line.innerText();
    assert.match(text, /Running for 2[67]m/, `the progress line shows the elapsed time (line: ${text})`);
    assert.match(text, /usually takes/i, 'the progress line shows a typical duration');
  } finally {
    await ui.close();
  }
});

// D37: after the first 401 the page stops polling and offers Reload.
test('D37: after a 401 the Build page stops polling and shows Reload', async () => {
  const log = { history: 0 };
  const mount = (app) => {
    mountBase(app);
    app.get('/api/inspire/implement/history', (_req, res) => { log.history += 1; res.status(401).json({ error: 'Your Databricks sign-in has expired.' }); });
  };
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built()] }, '', { mount, init: (page) => page.clock.install() });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).waitFor({ timeout: 20000 });
    const seen = log.history;
    await page.clock.fastForward(60000);
    await page.waitForTimeout(500);
    assert.equal(log.history, seen, 'no further history poll after the 401 (must-fail: one more every 10 s before the fix)');
  } finally {
    await ui.close();
  }
});
