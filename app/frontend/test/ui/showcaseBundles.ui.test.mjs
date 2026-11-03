import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { apiWatch, tabButton, walkInspireDemo } from '../../../scripts/showcaseRecorder.mjs';
import { SHOWCASE_BUTTON, SHOWCASE_NOTE } from '../../src/lib/showcase.js';

const require = createRequire(import.meta.url);
const { SHOWCASE_DIR, SHOWCASE_HEADER, SHOWCASE_MISSING, loadShowcases, registerShowcaseRoutes } = require('../../../backend/lib/showcase.js');

test.after(closeBrowser);

const COMMITTED = loadShowcases();
const FILES = fs.readdirSync(SHOWCASE_DIR).filter((n) => /\.json(\.gz)?$/.test(n)).sort();
const DEFAULTS = {
  envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com',
  warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai',
};
const SHELL = { 'static/index.html': '<!doctype html><html><body><main class="app">MVP</main></body></html>' };
const demoBar = (page) => page.getByRole('region', { name: 'Demo' });
const cardsOf = (page) => page.getByRole('region', { name: 'Use case list' }).locator('[aria-expanded]');
const useCasesOf = (bundle) => bundle.inspire[`GET /api/inspire/usecases?session_id=${bundle.session_id}`].body.usecases;

async function openDemoApp(dir) {
  const ui = await openUi('app', {}, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
      registerShowcaseRoutes(app, { dir, shellFiles: SHELL, log: { error: (m) => { throw new Error(m); } } });
    },
  });
  const missing = [];
  const outside = [];
  ui.page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/') && !['/api/showcase', '/api/defaults'].includes(p) && !r.headers()[SHOWCASE_HEADER]) outside.push(`${r.method()} ${p}`);
  });
  ui.page.on('response', async (r) => {
    const p = new URL(r.url()).pathname;
    if (!p.startsWith('/api/') || r.status() !== 404) return;
    const body = await r.json().catch(() => ({}));
    if (body.error === SHOWCASE_MISSING) missing.push(`${r.request().headers()[SHOWCASE_HEADER]}: ${r.request().method()} ${p}${new URL(r.url()).search}`);
  });
  return { ...ui, missing, outside };
}

test('the App carries the recorded demos: NYC Taxi first, then TPC-DS Retail, each a results-only demo with its own use cases', () => {
  assert.deepEqual(FILES, ['nyctaxi.json.gz', 'tpcds-retail.json.gz']);
  assert.deepEqual(Object.keys(COMMITTED), ['nyctaxi', 'tpcds-retail']);
  for (const bundle of Object.values(COMMITTED)) {
    assert.ok(useCasesOf(bundle).length > 0, `${bundle.id} has use cases`);
    assert.ok(useCasesOf(bundle).every((u) => String(u.session_id) === bundle.session_id), `${bundle.id} has the use cases of its own run alone`);
    assert.deepEqual(bundle.mvps, {}, `${bundle.id} is a results-only demo`);
  }
});

for (const name of FILES) {
  test(`See Demo opens ${name} and every view the recorder walked replays from the file, with no call to the workspace`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-demo-'));
    fs.copyFileSync(path.join(SHOWCASE_DIR, name), path.join(dir, name));
    const bundle = Object.values(loadShowcases(dir))[0];
    const ui = await openDemoApp(dir);
    try {
      const settle = apiWatch(ui.page);
      const walk = await walkInspireDemo(ui.page, { settle, mvps: false });
      const n = useCasesOf(bundle).length;
      t.diagnostic(`${name}: ${fs.statSync(path.join(dir, name)).size} bytes, ${n} use cases`);
      await demoBar(ui.page).locator('p').getByText(bundle.title, { exact: true }).waitFor();
      assert.equal(walk.runs, 1, 'Review lists the demo run alone');
      assert.equal(walk.results, n, 'Review shows every use case of the run');
      assert.equal(walk.build.length, n, 'Build lists every use case of the run');
      assert.deepEqual(walk.build.filter((b) => b.tabs.length), [], 'no use case of a results-only demo opens an MVP');
      assert.equal(walk.start.runs, 1, 'Start lists the demo run alone');
      assert.deepEqual(walk.monitor, { steps: true }, 'Monitor shows the steps of the run');
      assert.deepEqual(ui.missing, [], 'every view the walk opened has a saved answer');
      assert.deepEqual(ui.outside, [], 'every request in the demo was a demo request');
      assert.equal(ui.made.sqlCalls.length, 0);
      assert.equal(ui.made.fetches.length, 0);
      assert.equal(ui.made.jobs.length, 0);
      assert.deepEqual(ui.pageErrors.filter((e) => !/status of 40[34]/.test(e)), []);
    } finally {
      await ui.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('with more than one demo, the demo bar lists them and switches to the use cases of the one picked, and back', async () => {
  const ui = await openDemoApp(SHOWCASE_DIR);
  const { page } = ui;
  try {
    const settle = apiWatch(page);
    const [first, second] = Object.values(COMMITTED);
    await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    const pick = demoBar(page).getByRole('combobox', { name: 'Choose a demo' });
    assert.deepEqual(await pick.locator('option').allInnerTexts(), [first.title, second.title]);
    for (const bundle of [first, second, first]) {
      if ((await pick.inputValue()) !== bundle.id) await pick.selectOption(bundle.id);
      await demoBar(page).locator('p').getByText(bundle.title, { exact: true }).waitFor();
      await cardsOf(page).first().waitFor({ timeout: 60000 });
      await settle();
      assert.equal(await cardsOf(page).count(), useCasesOf(bundle).length, `${bundle.id} shows its own use cases`);
      assert.equal(await pick.inputValue(), bundle.id);
    }
    let at = first;
    for (const tab of ['monitor', 'implement', 'choose', 'run']) {
      await tabButton(page, tab).click();
      await settle();
      at = at === first ? second : first;
      await pick.selectOption(at.id);
      await demoBar(page).locator('p').getByText(at.title, { exact: true }).waitFor();
      await cardsOf(page).first().waitFor({ timeout: 60000 });
      await settle();
      assert.equal(await cardsOf(page).count(), useCasesOf(at).length, `switching from the ${tab} tab opens Review of the demo picked`);
    }
    assert.deepEqual(ui.missing, [], 'no page asks one demo for an answer of the other');
    assert.deepEqual(ui.outside, []);
  } finally {
    await ui.close();
  }
});

test('with one demo the demo bar offers no list to pick from', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-demo-one-'));
  fs.copyFileSync(path.join(SHOWCASE_DIR, FILES[0]), path.join(dir, FILES[0]));
  const ui = await openDemoApp(dir);
  try {
    await ui.page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
    await demoBar(ui.page).getByText(SHOWCASE_NOTE).waitFor();
    assert.equal(await demoBar(ui.page).getByRole('combobox', { name: 'Choose a demo' }).count(), 0);
  } finally {
    await ui.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
