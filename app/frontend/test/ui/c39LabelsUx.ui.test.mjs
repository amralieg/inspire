// c39 (REQ-585 items 8 and 9) acceptance, written by the c39 spec writer; the builder may not edit or weaken this file.
// 8: a catalog the person picks is kept. When its name looks dev (lib/devNames.js), the Data step warns
//    "<name> looks like a dev catalog; Inspire advises production data." and the catalog still goes out with the launch.
// 9: while a Let Inspire Decides launch is pending, the wizard polls GET /api/inspire/labels/progress?session_id=<the run's 14_session_id>
//    and shows "n of N tables".
// Neutral fixture names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { ROUTES, WIZ_TITLE } from '../../src/lib/startWizard.js';
import { PLAN } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const EMPTY = { sessions: [], portfolioRuns: [{ runs: '0', businesses: '0' }], portfolioUseCases: [], portfolioMvps: [] };
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });
const nextWhenReady = async (dialog, what) => {
  await until(async () => !(await next(dialog).isDisabled()), `${what} is ready`, 20000);
  await next(dialog).click();
};
const WARNING = (name) => `${name} looks like a dev catalog; Inspire advises production data.`;

async function openWizard(state, mount) {
  const ui = await openUi('choose', state, '', { mount });
  await ui.page.locator('[data-start-new]').first().click();
  const dialog = ui.page.getByRole('dialog', { name: WIZ_TITLE });
  await dialog.waitFor({ timeout: 15000 });
  await dialog.locator('[data-wiz-path="discover"]').click();
  await next(dialog).click();
  await dialog.locator('[data-wiz-step="business"]').getByPlaceholder(BUSINESS).fill('Example Co');
  await next(dialog).click();
  await dialog.locator('[data-wiz-step="data"]').waitFor({ timeout: 10000 });
  return { ui, dialog };
}
const toReview = async (dialog) => {
  await nextWhenReady(dialog, 'Data');
  await nextWhenReady(dialog, 'Goals');
  await nextWhenReady(dialog, 'Settings');
  await dialog.locator('[data-wiz-step="review"]').waitFor();
};

test('REQ-585 8: choose myself, a picked dev-looking catalog shows the warning and is kept in the launch (must-fail on the base)', async () => {
  const { ui, dialog } = await openWizard({ ...EMPTY, catalogs: ['main', 'dev_sales'] });
  const { made } = ui;
  try {
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.locator('[data-wiz-data-choice="choose"]').click();
    await data.locator('button[title="main"]').click();
    await until(async () => !(await next(dialog).isDisabled()), 'a catalog is picked', 15000);
    assert.equal(await dialog.locator('[data-wiz-dev-warning]').count(), 0, 'a production name shows no warning (must-keep)');
    await data.locator('button[title="dev_sales"]').click();
    const warning = dialog.locator('[data-wiz-dev-warning]');
    await until(async () => (await warning.count()) > 0, 'the dev warning shows', 10000);
    assert.match(await warning.first().innerText(), new RegExp(WARNING('dev_sales').replace(/[.;]/g, '\\$&')));
    await toReview(dialog);
    await dialog.locator('[data-wiz-start]').click();
    await until(() => made.launches.length === 1, 'one run was sent', 20000);
    const scope = String(made.launches[0].params['01_uc_metadata'] || '');
    assert.match(scope, /(^|,)\s*dev_sales\b/, `the dev-looking catalog is kept, not dropped: ${scope}`);
    assert.match(scope, /(^|,)\s*main\b/);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-585 8 / REQ-583: Find suitable data, a ticked demo-looking catalog shows the warning and still goes to the plan sort (must-fail on the base)', async () => {
  const sorts = [];
  const mount = (app) => app.post(ROUTES.planSort, (req, res) => { sorts.push(req.body); res.json(PLAN); });
  const { ui, dialog } = await openWizard({ ...EMPTY, catalogs: ['main', 'demo_retail'] }, mount);
  try {
    const find = dialog.locator('[data-wiz-step="find"]');
    await find.getByRole('checkbox', { name: 'main', exact: true }).check();
    assert.equal(await dialog.locator('[data-wiz-dev-warning]').count(), 0, 'a production name shows no warning (must-keep)');
    await find.getByRole('checkbox', { name: 'demo_retail', exact: true }).check();
    const warning = dialog.locator('[data-wiz-dev-warning]');
    await until(async () => (await warning.count()) > 0, 'the dev warning shows', 10000);
    assert.ok((await warning.first().innerText()).includes(WARNING('demo_retail')));
    await nextWhenReady(dialog, 'Data');
    await until(() => sorts.length >= 1, 'the plan sort was asked', 15000);
    assert.deepEqual([...sorts[0].catalogs].sort(), ['demo_retail', 'main'], 'the ticked demo catalog is kept');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-585 9: while a Let Inspire Decides launch labels the tables, the wizard shows "n of N tables" (must-fail on the base)', async () => {
  const runs = [];
  const polls = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const mount = (app) => {
    app.get('/api/inspire/labels/progress', (req, res) => { polls.push(String(req.query.session_id || '')); res.json({ session_id: req.query.session_id, done: 3, total: 7, state: 'labelling' }); });
    app.post('/api/run', async (req, res) => { runs.push(req.body); await held; res.json({ run_id: 99 }); });
  };
  const { ui, dialog } = await openWizard(EMPTY, mount);
  try {
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.locator('[data-wiz-data-choice="choose"]').click();
    await data.locator('button[title="main"]').click();
    await toReview(dialog);
    await dialog.locator('[data-wiz-start]').click();
    await until(() => runs.length === 1, 'the launch is pending', 20000);
    assert.equal(runs[0].params['04_table_election'], 'Let Inspire Decides', 'a whole catalog launches as Let Inspire Decides');
    await until(async () => /\b3 of 7 tables\b/.test(await dialog.innerText()), 'the wizard shows 3 of 7 tables', 15000);
    assert.ok(polls.length > 0 && polls.every((id) => id === String(runs[0].params['14_session_id'])), `polled with the run's session id: ${polls}`);
    release();
    await until(async () => (await ui.page.locator('output[aria-label="Launched"]').innerText()).endsWith(':99'), 'the Start page hears the launch', 15000);
    assert.deepEqual(errors(ui), []);
  } finally { release(); await ui.close(); }
});
