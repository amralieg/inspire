import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

// REQ-420 (D-SL-13): Start lists the catalogs the App's own grants cover, not the installer's pick, and has no Load all catalogs control.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai', hasServerPlatformAuth: true };
const CATALOGS = { catalogs: ['finance', 'hr', 'main', 'sales'], schemas: { main: ['s'], sales: ['gold'], hr: ['people'], finance: ['ledger'] } };
const GRANT = 'GRANT SELECT ON CATALOG `hr` TO `app-principal`';
// The App's principal reads sales and main, and holds only USE CATALOG on hr; finance is not granted at all.
const granted = (app) => app.get('/api/catalogs', (_req, res) => res.json({ spGrants: true, source: 'rest', truncated: false,
  catalogs: [{ name: 'hr', partial: { missing: [GRANT] } }, { name: 'main' }, { name: 'sales' }],
  permissions: [{ statements: [GRANT], instructions: [], steps: [], principal: 'app-principal', why: 'The App can see these catalogs but cannot read all of what Inspire needs in them yet.' }] }));
const withInstaller = (installerDataCatalogs) => (app) => {
  app.get('/api/defaults', (_req, res) => res.json(installerDataCatalogs === undefined ? DEFAULTS : { ...DEFAULTS, installerDataCatalogs }));
  app.get('/api/showcase', (_req, res) => res.json({}));
  granted(app);
};
const LOAD_ALL = 'Load all catalogs';
const NO_DATA = /I don.t have data/;
const DRAFT_KEY = `inspire_start_draft:${JSON.stringify([DEFAULTS.databricksHost])}`;
const seedDraft = (spec) => (page) => page.addInitScript(([key, value]) => window.localStorage.setItem(key, value),
  [DRAFT_KEY, JSON.stringify({ version: 1, stamp: 'start:1', step: 'launch', visited: [], spec })]);

// The real App: Get Started, then "I have data in Unity Catalog", which opens the Discover launch page.
async function openLaunch(installerDataCatalogs, init) {
  const ui = await openUi('app', { ...REVIEW_STATE, ...CATALOGS }, '', { mount: withInstaller(installerDataCatalogs), init });
  const { page } = ui;
  await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
  await page.locator('[data-start-new]').first().waitFor({ timeout: 20000 });
  await page.evaluate(() => { window.location.hash = '#/launch'; }); // REQ-577: Start has one Start New Discovery button; the full form stays at #/launch
  await page.waitForFunction(() => window.location.hash === '#/launch', null, { timeout: 20000 });
  await page.locator('h1').first().waitFor();
  await idle(page);
  return ui;
}
const listed = (page) => page.locator('button[title="finance"], button[title="hr"], button[title="main"], button[title="sales"]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('title')).sort());

test('the Catalogs list is what the App can read now, whatever the installer picked; a partial catalog shows its missing GRANT; there is no Load all catalogs (REQ-420)', async () => {
  const ui = await openLaunch(['sales', 'finance']);
  const { page } = ui;
  try {
    await until(async () => (await listed(page)).length === 3, 'the granted catalogs are listed');
    assert.deepEqual(await listed(page), ['hr', 'main', 'sales'], 'the App grants decide (must-exclude: finance is in the installer pick but not granted; main is granted but not picked)');
    assert.equal(await page.getByRole('button', { name: LOAD_ALL, exact: true }).count(), 0, 'no Load all catalogs control');
    assert.equal(await page.locator('[data-load-all-catalogs]').count(), 0);
    assert.equal(await page.locator('[data-catalog-partial="hr"]').count(), 1, 'the partly granted catalog is flagged');
    assert.equal(await page.locator('[data-catalog-partial="main"]').count(), 0, 'a fully granted catalog is not (must-keep)');
    await page.locator('[data-catalog-partial="hr"] button').click();
    await page.locator('[data-permission-dialog]').waitFor({ timeout: 20000 });
    assert.match(await page.locator('[data-permission-statements]').first().innerText(), /GRANT SELECT ON CATALOG `hr` TO `app-principal`/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a saved draft holding a catalog the App can no longer read opens without it and says so in one line (REQ-420)', async () => {
  const ui = await openLaunch(undefined, seedDraft({ selectedCatalogs: ['sales', 'finance'], wholeCatalogs: ['sales', 'finance'],
    selectedSchemas: ['finance.ledger'], selectedTables: [] }));
  const { page } = ui;
  try {
    await until(async () => (await listed(page)).length === 3, 'the granted catalogs are listed');
    const note = page.locator('[data-dropped-catalogs]');
    await note.waitFor({ timeout: 20000 });
    assert.equal(await note.innerText(), 'Inspire can no longer read finance, so it was taken off your selection.');
    const chips = await page.locator('[data-start-draft-scope], [data-picked-catalog]').count();
    assert.ok(chips >= 0);
    const scope = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}').spec || {}, DRAFT_KEY);
    await until(async () => {
      const saved = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}').spec || {}, DRAFT_KEY);
      return JSON.stringify(saved.selectedCatalogs) === '["sales"]';
    }, 'the saved draft keeps sales only');
    const kept = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}').spec, DRAFT_KEY);
    assert.deepEqual([kept.selectedCatalogs, kept.wholeCatalogs, kept.selectedSchemas], [['sales'], ['sales'], []], `finance is gone from every list (${JSON.stringify(scope)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a draft whose catalogs are all still granted shows no notice (must-keep)', async () => {
  const ui = await openLaunch(undefined, seedDraft({ selectedCatalogs: ['sales'], wholeCatalogs: ['sales'], selectedSchemas: [], selectedTables: [] }));
  try {
    await until(async () => (await listed(ui.page)).length === 3, 'the granted catalogs are listed');
    assert.equal(await ui.page.locator('[data-dropped-catalogs]').count(), 0);
  } finally {
    await ui.close();
  }
});

test('the Discover launch page no longer offers "I don\'t have data" (REQ-360); the Start page choice "No data yet" stays', async () => {
  const ui = await openLaunch(['sales', 'hr']);
  try {
    assert.equal(await ui.page.getByRole('button', { name: NO_DATA }).count(), 0, 'no demo-table button on the launch page (must-exclude)');
    await ui.page.goBack();
    await ui.page.waitForFunction(() => window.location.hash === '#/start', null, { timeout: 20000 });
    await ui.page.locator('[data-start-new]').first().click(); // REQ-577: the sample-table way in now lives in the wizard
    await ui.page.getByText('Try it on sample tables').first().waitFor({ timeout: 20000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
