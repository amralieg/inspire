import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, lowContrast, openAsset, openUi, setDark, until } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const START = 'Start Use Case MVP with Genie';

test.after(closeBrowser);

const builtSpec = (top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: [OWNER],
    inspire_url: HARNESS_INSPIRE_URL } };
};
const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });
const LIVE = { dashboard: ready(3, { snapshot: true }), genie_space: ready(3, { snapshot: true }), app: ready(3, { snapshot: true }), alert: ready(3) };

const versionRow = (version, { assets = LIVE, top = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  notebook_path: '/Users/owner@example.com/inspire/Acme_implemented/N01-U01',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  alert_id: 'a1', alert_url: 'https://workspace.example.com/sql/alerts-v2/a1',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const GONE = { dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null, app_name: null, app_url: null, alert_id: null, alert_url: null,
  job_id: null, notebook_path: null, last_preview_run_id: null };
const uninstalledRow = (version) => versionRow(version, {
  ...GONE, status: 'uninstalled', change_classes: 'uninstall', top: { uninstall: true },
  status_message: "Dashboard: d1 also holds use case N02-U01, so Inspire did not delete it; this use case's part stays in it",
  assets: { dashboard: { state: 'deleted' }, genie_space: { state: 'deleted' }, app: { state: 'deleted' }, alert: { state: 'deleted' }, notebook: { state: 'deleted' }, kept: { state: 'kept', assets: [] } },
});

const HISTORY = [versionRow(3), versionRow(2), versionRow(1)];
const STATE = { history: HISTORY, appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } } };

function insertsOf(made) {
  return made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
    .map((c) => ({ spec: JSON.parse(c.parameters.find((p) => p.name === 'spec').value), classes: c.parameters.find((p) => p.name === 'classes').value }));
}

async function openBuild(state = STATE) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

async function toJobDrawer(page) {
  await page.locator('[data-asset-tile="job"] [data-tile-versions]').waitFor({ timeout: 15000 });
  const drawer = await openAsset(page, 'job');
  await drawer.getByRole('region', { name: 'History', exact: true }).getByText(/^\d+ spec versions? · /).waitFor({ timeout: 15000 });
}

test('a version an earlier vibe kept live is removed only once the use case id is typed, and the earlier vibe is never sent again', async () => {
  const routed = { state: 'routed', text: 'Put the riskiest first. Add a map by region.', previous: 'keep', spec_version: 3,
    routes: { dashboard: 'Put the riskiest first', app: 'Put the riskiest first' } };
  const kept = { state: 'kept', assets: [{ output: 'dashboard', id: 'd0', url: 'https://workspace.example.com/dashboardsv3/d0/published', title: 'Churn desk v2',
    version: 2, kept_in: 3 }] };
  const ui = await openBuild({ ...STATE, history: [versionRow(3, { change_classes: 'vibe', assets: { ...LIVE, vibe: routed, kept } }), versionRow(2), versionRow(1)] });
  const { page, made } = ui;
  try {
    await toJobDrawer(page);
    const row = (await openAsset(page, 'job')).getByRole('region', { name: 'Kept live from earlier versions' }).locator('[data-kept-version="2"]');
    assert.equal(await row.getByRole('link', { name: /Churn desk v2/ }).getAttribute('href'), 'https://workspace.example.com/dashboardsv3/d0/published');
    await row.getByRole('button', { name: 'Remove v2', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove v2' });
    await dialog.getByText('Inspire deletes what v2 kept live (Dashboard) in a new version of this MVP. The live version stays as it is.').waitFor();
    const confirm = dialog.getByRole('button', { name: 'Remove v2', exact: true });
    const typed = dialog.getByRole('textbox', { name: 'Type the use case id to confirm' });
    assert.equal(await confirm.isDisabled(), true);
    await typed.fill('N01-U0');
    assert.equal(await confirm.isDisabled(), true, 'a near miss is no confirmation');
    await typed.fill('N01-U01');
    await confirm.click();
    await until(() => made.jobs.length === 1, 'the kept removal');
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.classes, sent.spec.remove_kept, Boolean(sent.spec.vibes), Boolean(sent.spec.vibe_previous)], ['remove_kept', [2], false, false],
      'the earlier vibe is never sent again');
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Uninstall all names what goes and what stays, asks for the use case id, and sends one uninstall version', async () => {
  const ui = await openBuild();
  const { page, made } = ui;
  try {
    assert.doesNotMatch(await page.getByRole('button', { name: 'Uninstall all', exact: true }).getAttribute('class'), /error|db-red/, 'Uninstall all is a secondary button (must-exclude)');
    await page.getByRole('button', { name: 'Uninstall all', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall everything N01-U01 built' });
    assert.match(await dialog.getByRole('button', { name: 'Uninstall all', exact: true }).getAttribute('class'), /bg-error-solid/, 'the confirm step stays red (must-keep)');
    await dialog.getByText(/^Inspire deletes the MVP notebook, its job, the dashboard, the Genie Agent, the App, the alert/).waitFor();
    await dialog.getByText(/^The result tables, the history and any notebook Discover wrote for this use case stay\./).waitFor();
    const confirm = dialog.getByRole('button', { name: 'Uninstall all', exact: true });
    assert.equal(await confirm.isDisabled(), true);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[aria-label="Uninstall everything N01-U01 built"]']);
      assert.ok(result.checked >= 5, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(made.jobs.length, 0);

    await page.getByRole('button', { name: 'Uninstall all', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await confirm.click();
    await until(() => made.jobs.length === 1, 'the uninstall');
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.classes, sent.spec.uninstall, sent.spec.based_on_version], ['uninstall', true, 3]);
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an uninstalled MVP says what is kept, offers Start again with no Uninstall, keeps the notebook Discover wrote, and leaves the asset filters', async () => {
  const useCases = [
    { ...HARNESS_USE_CASE, _domain: 'Retention', has_genie_code: 'Y', notebook_path: '/Users/owner@example.com/inspire/Acme/N01-U01' },
    { id: 'N02-U01', Name: 'Score suppliers', use_case: 'Score suppliers', _domain: 'Supply', has_genie_code: 'Y', notebook_path: '/Users/owner@example.com/inspire/Acme/N02-U01' },
    { id: 'N01-U02', Name: 'Forecast demand', use_case: 'Forecast demand', _domain: 'Supply', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
  ];
  const ui = await openBuild({ ...STATE, useCases, history: [uninstalledRow(4), ...HISTORY] });
  const { page } = ui;
  try {
    const note = page.locator('[data-uninstalled]');
    await note.waitFor();
    assert.equal((await note.textContent()).trim(), "Uninstalled in v4. Not removed: Dashboard: d1 also holds use case N02-U01, so Inspire did not delete it; "
      + `this use case's part stays in it. The result tables and the history are kept. ${START} builds it again.`);
    assert.equal(await page.getByRole('button', { name: 'Uninstall all', exact: true }).count(), 0, 'nothing is left to uninstall');
    await page.getByRole('button', { name: START, exact: true }).waitFor();
    const notebook = page.locator('[data-asset-panel="notebook"]');
    assert.equal(await notebook.getByRole('link', { name: 'Open the notebook', exact: true }).getAttribute('href'),
      'https://workspace.example.com/#workspace/Workspace/Users/owner@example.com/inspire/Acme/N01-U01', 'the notebook Discover wrote stays and still opens');
    assert.equal(await page.locator('[data-asset-tiles]').count(), 0, 'an uninstalled MVP has no asset tiles');
    assert.equal(await page.locator('[data-vibe-box]').count(), 0, 'and nothing to vibe');

    const filters = page.getByRole('group', { name: 'Show use cases with' });
    const counts = await filters.locator('[data-asset-filter]').evaluateAll((chips) => chips.map((c) => [c.dataset.assetFilter, c.textContent.trim(), c.disabled]));
    assert.deepEqual(counts, [['notebook', 'Notebook 2', false], ['app', 'App 0', true], ['dashboard', 'Dashboard 0', true], ['genie_space', 'Genie Agent 0', true],
      ['alert', 'Alert 0', true]], 'the removed assets no longer count, and the notebooks Discover wrote still do');
    const nav = page.getByRole('navigation', { name: 'Use cases' });
    await filters.getByRole('button', { name: /^Notebook/ }).click();
    await nav.getByText('Forecast demand').waitFor({ state: 'detached' });
    assert.equal(await filters.getByRole('button', { name: /^Notebook/ }).getAttribute('aria-pressed'), 'true');
    await nav.getByText('Score suppliers').waitFor();
    await filters.getByRole('button', { name: 'All', exact: true }).click();
    await nav.getByText('Forecast demand').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the asset filters count a built MVP\'s outputs and show only the use cases that have the one picked', async () => {
  const useCases = [
    { ...HARNESS_USE_CASE, _domain: 'Retention' },
    { id: 'N02-U01', Name: 'Score suppliers', use_case: 'Score suppliers', _domain: 'Supply', has_genie_code: 'Y', notebook_path: '/Users/owner@example.com/inspire/Acme/N02-U01' },
    { id: 'N01-U02', Name: 'Forecast demand', use_case: 'Forecast demand', _domain: 'Supply', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
  ];
  const ui = await openBuild({ ...STATE, useCases });
  const { page } = ui;
  try {
    const filters = page.getByRole('group', { name: 'Show use cases with' });
    const nav = page.getByRole('navigation', { name: 'Use cases' });
    await filters.waitFor();
    assert.deepEqual(await filters.locator('[data-asset-filter]').evaluateAll((chips) => chips.map((c) => c.textContent.trim())),
      ['Notebook 2', 'App 1', 'Dashboard 1', 'Genie Agent 1', 'Alert 1']);
    await filters.getByRole('button', { name: /^App/ }).click();
    await nav.getByText('Score suppliers').waitFor({ state: 'detached' });
    await nav.getByText('Forecast demand').waitFor({ state: 'detached' });
    await nav.getByText('Predict churn').waitFor();
    await filters.getByRole('button', { name: /^App/ }).click();
    assert.equal(await filters.getByRole('button', { name: 'All', exact: true }).getAttribute('aria-pressed'), 'true', 'a second click lets the filter go');
    await nav.getByText('Forecast demand').waitFor();
    await filters.getByRole('button', { name: /^Dashboard/ }).click();
    await nav.getByText('Forecast demand').waitFor({ state: 'detached' });
    await page.getByLabel('Search use cases').fill('forecast');
    await nav.getByText('No use case matching "forecast" has a Dashboard yet.').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
