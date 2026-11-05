import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { apiWatch, tabButton, walkInspireDemo } from '../../../scripts/showcaseRecorder.mjs';
import { DEMO_LAYOUTS, DEMO_RECORDED, KINDS_DEMO, USE_CASES } from '../../../scripts/kindsShowcase.mjs';
import { SHOWCASE_BUTTON, SHOWCASE_NOTE } from '../../src/lib/showcase.js';
import { RUN_BACK } from '../../src/lib/runPages.js';

const require = createRequire(import.meta.url);
const { SHOWCASE_DIR, SHOWCASE_HEADER, SHOWCASE_MISSING, SHOWCASE_PLAN_NOTE: S_NOTE, loadShowcases, registerShowcaseRoutes } = require('../../../backend/lib/showcase.js');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../../../backend/lib/appShell.js');

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

async function openDemoApp(dir, shellFiles = SHELL) {
  const ui = await openUi('app', {}, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
      registerShowcaseRoutes(app, { dir, shellFiles, log: { error: (m) => { throw new Error(m); } } });
    },
  });
  const missing = [];
  const outside = [];
  const framed = [];
  ui.page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.frame() !== ui.page.mainFrame()) framed.push(`${r.method()} ${p}`);
    else if (p.startsWith('/api/') && !['/api/showcase', '/api/defaults'].includes(p) && !r.headers()[SHOWCASE_HEADER]) outside.push(`${r.method()} ${p}`);
  });
  ui.page.on('response', async (r) => {
    const p = new URL(r.url()).pathname;
    if (!p.startsWith('/api/') || r.status() !== 404) return;
    const body = await r.json().catch(() => ({}));
    if (body.error === SHOWCASE_MISSING) missing.push(`${r.request().headers()[SHOWCASE_HEADER]}: ${r.request().method()} ${p}${new URL(r.url()).search}`);
  });
  return { ...ui, missing, outside, framed };
}

const KINDS_FILE = `${KINDS_DEMO.id}.json.gz`;
const REAL_SHELL = appShellFiles(appShellPayload(bundledAppShellText()));

async function openKindsDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-kinds-'));
  fs.copyFileSync(path.join(SHOWCASE_DIR, KINDS_FILE), path.join(dir, KINDS_FILE));
  const ui = await openDemoApp(dir, REAL_SHELL);
  const close = ui.close;
  ui.close = async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }); };
  await ui.page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
  await cardsOf(ui.page).first().waitFor({ timeout: 60000 });
  return ui;
}

async function openMvpFromBuild(page, settle, u) {
  await tabButton(page, 'implement').click();
  const item = page.locator('nav[aria-label="Use cases"] section button').filter({ hasText: u.no });
  await item.first().waitFor({ timeout: 60000 });
  await item.first().click();
  await settle();
  const open = page.locator(`[data-demo-open-mvp="${u.no}"]`);
  await open.waitFor();
  assert.equal((await open.innerText()).trim(), 'Open MVP');
  await open.click();
  await page.locator(`[data-run-full] iframe[data-run-frame="${u.no}"]`).waitFor();
  const frame = page.frameLocator(`[data-run-full] iframe[data-run-frame="${u.no}"]`);
  await frame.locator('main h1').first().waitFor({ timeout: 60000 });
  return frame;
}

const backToRun = async (page, settle) => {
  await page.locator('[data-run-control-toggle]').click();
  await page.getByRole('button', { name: RUN_BACK, exact: true }).click();
  await page.locator('[data-run-page-root]').waitFor();
  await settle();
};

test('the App carries the recorded demos: the kinds demo first with an MVP App for each use case, then NYC Taxi and TPC-DS Retail, results-only', () => {
  assert.deepEqual(FILES, [KINDS_FILE, 'nyctaxi.json.gz', 'tpcds-retail.json.gz']);
  assert.deepEqual(Object.keys(COMMITTED), [KINDS_DEMO.id, 'nyctaxi', 'tpcds-retail']);
  for (const bundle of Object.values(COMMITTED)) {
    assert.ok(useCasesOf(bundle).length > 0, `${bundle.id} has use cases`);
    assert.ok(useCasesOf(bundle).every((u) => String(u.session_id) === bundle.session_id), `${bundle.id} has the use cases of its own run alone`);
    if (bundle.id === KINDS_DEMO.id) assert.deepEqual(Object.keys(bundle.mvps).sort(), useCasesOf(bundle).map((u) => u.id).sort(), 'every use case of the kinds demo has its MVP App');
    else assert.deepEqual(bundle.mvps, {}, `${bundle.id} is a results-only demo`);
  }
});

test('the kinds demo names every use case in the kinds style on Review, with its kind chip and the technique in the name', async () => {
  const ui = await openKindsDemo();
  try {
    const bundle = COMMITTED[KINDS_DEMO.id];
    assert.equal(await cardsOf(ui.page).count(), USE_CASES.length);
    const text = await ui.page.getByRole('region', { name: 'Use case list' }).innerText();
    for (const u of useCasesOf(bundle)) {
      assert.equal(u.name_with_technique, `${u.Name} using ${u['Analytics Technique'].toLowerCase()}`, `${u.id} keeps the technique out of the name and shows it once`);
      assert.ok(text.includes(u.name_with_technique), `${u.id} shows ${u.name_with_technique}`);
      assert.ok(await ui.page.locator(`[data-kind-chip="${u.use_case_kind}"]`).count() > 0, `${u.id} shows its kind ${u.use_case_kind}`);
    }
    assert.deepEqual(new Set(useCasesOf(bundle).map((u) => u.use_case_kind)).size, USE_CASES.length, 'each use case shows a different kind');
    assert.deepEqual(ui.outside, []);
  } finally {
    await ui.close();
  }
});

test('Build shows Open MVP on every use case of the kinds demo, and each opens its MVP App, hosted by the Inspire App, with no call to the workspace', async () => {
  const ui = await openKindsDemo();
  const { page } = ui;
  try {
    const settle = apiWatch(page);
    const layouts = new Set();
    for (const u of USE_CASES) {
      const frame = await openMvpFromBuild(page, settle, u);
      assert.equal((await frame.locator('main h1').first().innerText()).trim(), u.title, `${u.no} opens its own MVP App`);
      layouts.add(u.mvp.layout);
      await backToRun(page, settle);
    }
    assert.deepEqual([...layouts].sort(), [...DEMO_LAYOUTS].sort(), 'the demo opens an MVP App of every layout it carries');
    const hosted = `/showcase/${KINDS_DEMO.id}/mvp/`;
    assert.ok(ui.framed.length > 0, 'the MVP Apps made their requests');
    assert.deepEqual(ui.framed.filter((r) => !r.split(' ')[1].startsWith(hosted)), [], 'every MVP App request stays inside the demo');
    assert.deepEqual(ui.missing, []);
    assert.deepEqual(ui.outside, []);
    assert.equal(ui.made.sqlCalls.length, 0);
    assert.equal(ui.made.fetches.length, 0);
    assert.equal(ui.made.jobs.length, 0);
  } finally {
    await ui.close();
  }
});

test('Build opens at the top with the first use case shown, after Review was scrolled down, and a picked use case opens at its top', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 600, height: 900 }]) {
    const ui = await openKindsDemo();
    const { page } = ui;
    try {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await until(async () => (await page.evaluate(() => window.scrollY)) > 200, 'Review scrolled down');
      await tabButton(page, 'implement').click();
      const pane = page.getByRole('region', { name: 'Use case' });
      const first = page.locator('nav[aria-label="Use cases"] section button').first();
      await first.waitFor({ timeout: 60000 });
      await pane.locator('[data-use-case-pane]').first().waitFor({ timeout: 60000 });
      assert.equal(await page.evaluate(() => window.scrollY), 0, `${viewport.width}: the Build page opens at its top`);
      assert.equal(await first.getAttribute('aria-current'), 'true', `${viewport.width}: the first use case is picked`);
      const top = await pane.locator('[data-use-case-pane]').first().boundingBox();
      assert.ok(top && top.y >= 0 && (viewport.width < 768 || top.y < viewport.height), `${viewport.width}: the picked use case shows ${viewport.width < 768 ? 'below the list' : 'in the window'}`);
      if (viewport.width >= 768) {
        await pane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.locator('nav[aria-label="Use cases"] section button').nth(1).click();
        await until(async () => (await pane.evaluate((el) => el.scrollTop)) === 0, 'a newly picked use case opens at its top');
      }
    } finally {
      await ui.close();
    }
  }
});

test('Genie in a kinds demo MVP App answers a suggested question with the recorded answer, marked as a demo answer', async () => {
  const ui = await openKindsDemo();
  const { page } = ui;
  try {
    const settle = apiWatch(page);
    const u = USE_CASES[0];
    const frame = await openMvpFromBuild(page, settle, u);
    await frame.locator('header.top button.genie-btn').click();
    const ask = frame.locator('.genie .g-sugg button.sugg').filter({ hasText: u.genie[0].q });
    await ask.first().click();
    const answer = frame.locator('.msg--genie').last();
    await answer.filter({ hasText: DEMO_RECORDED }).waitFor({ timeout: 60000 });
    const said = await answer.innerText();
    assert.ok(said.includes(u.genie[0].a), 'Genie gives the answer recorded for the question');
    assert.ok(said.includes(DEMO_RECORDED), 'the answer says it is a recorded demo answer');
    assert.deepEqual(ui.missing, []);
    assert.equal(ui.made.fetches.length, 0);
  } finally {
    await ui.close();
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
      const walk = await walkInspireDemo(ui.page, { settle, mvps: Object.keys(bundle.mvps).length > 0 });
      const n = useCasesOf(bundle).length;
      t.diagnostic(`${name}: ${fs.statSync(path.join(dir, name)).size} bytes, ${n} use cases`);
      await demoBar(ui.page).locator('p').getByText(bundle.title, { exact: true }).waitFor();
      assert.equal(walk.runs, 1, 'Review lists the demo run alone');
      assert.equal(walk.results, n, 'Review shows every use case of the run');
      assert.equal(walk.build.length, n, 'Build lists every use case of the run');
      if (Object.keys(bundle.mvps).length) assert.deepEqual(walk.build.filter((b) => !b.tabs.length), [], 'every use case of a demo with MVP Apps is built');
      else assert.deepEqual(walk.build.filter((b) => b.tabs.length), [], 'no use case of a results-only demo opens an MVP');
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
    const titles = Object.values(COMMITTED).map((b) => b.title);
    await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    const pick = demoBar(page).getByRole('combobox', { name: 'Choose a demo' });
    assert.deepEqual(await pick.locator('option').allInnerTexts(), titles);
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

test('a kinds demo plan takes Accept, Override with a reason, refuses an Override without one, and Take all, and keeps each decision across a refresh so Take all never decides a line twice', async () => {
  const ui = await openKindsDemo();
  const { page } = ui;
  const decided = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/api/plan/decide')) decided.push(JSON.parse(r.postData() || '{}')); });
  try {
    const plans = USE_CASES.filter((c) => ['planner', 'forecast_cockpit'].includes(c.mvp.layout));
    assert.deepEqual([...new Set(plans.map((c) => c.mvp.layout))].sort(), ['forecast_cockpit', 'planner'], 'the demo carries both plan layouts');
    for (const u of plans) {
    decided.length = 0;
    let frame = await openMvpFromBuild(page, apiWatch(page), u);
    const plan = () => frame.locator('section.plan');
    const rows = () => plan().locator('tbody tr[data-plan-row]');
    await rows().first().waitFor({ timeout: 60000 });
    const keys = await rows().evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-plan-row')));
    assert.ok(keys.length >= 3, 'the plan has lines to decide');
    const line = (key) => plan().locator(`tr[data-plan-row="${key}"]`);
    const takeAll = () => plan().locator('[data-take-all]');
    assert.equal((await takeAll().innerText()).trim(), `Take all ${keys.length} ★ suggestions`);
    const counter = () => frame.locator('[data-todo-count]');
    const total = Number((await counter().innerText()).match(/of (\d+) waiting/)[1]);
    assert.equal(total, keys.length, 'the counter counts the plan lines');
    const waits = (n) => until(async () => (await counter().innerText()).trim() === `${n} of ${total} waiting for you`, `${n} of ${total} waiting`);
    await waits(total);

    await line(keys[0]).getByRole('button', { name: 'Accept', exact: true }).click();
    await line(keys[0]).locator('[data-decided]').filter({ hasText: /^Accepted the recommended / }).waitFor();
    assert.equal((await plan().locator(`[data-plan-said="${keys[0]}"]`).innerText()).trim(), S_NOTE, 'the demo says next to the line where the decision is kept');
    assert.equal((await line(keys[0]).locator('td').nth(3).innerText()).trim(), 'Done', 'the accepted line no longer says New');
    await waits(total - 1);

    await line(keys[1]).getByRole('button', { name: 'Override', exact: true }).click();
    const form = plan().locator('tr.plan-form form');
    const save = form.getByRole('button', { name: 'Save override' });
    await form.getByLabel('Your value').fill('7');
    assert.equal(await save.isDisabled(), true, 'an override with no reason cannot be saved');
    await form.getByLabel('Why you override it').fill('   ');
    assert.equal(await save.isDisabled(), true, 'a reason of spaces is no reason');
    await form.getByLabel('Why you override it').press('Enter');
    assert.equal(decided.length, 1, 'nothing is sent for an override without a reason');
    await form.getByLabel('Why you override it').fill('Store event this week');
    await save.click();
    await line(keys[1]).locator('[data-decided]').filter({ hasText: /^Override to 7 instead of .+: Store event this week$/ }).waitFor();
    assert.deepEqual([decided[1].decision, decided[1].value, decided[1].reason], ['override', 7, 'Store event this week']);
    await waits(total - 2);

    assert.equal((await takeAll().innerText()).trim(), keys.length - 2 === 1 ? 'Take the ★ suggestion' : `Take all ${keys.length - 2} ★ suggestions`);
    await takeAll().click();
    await until(async () => (await plan().locator('[data-decided]').count()) === keys.length, 'every line is decided');
    assert.equal(await takeAll().count(), 0);
    assert.match(await plan().locator('[data-plan-said="all"]').innerText(), new RegExp(`^Accepted ${keys.length - 2} suggested lines?\\. `));
    await waits(total - keys.length);
    assert.deepEqual(decided.map((d) => d.record_key).sort(), [...keys].sort(), 'Take all accepted only the lines still open, each once');

    await page.reload();
    await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
    await cardsOf(page).first().waitFor({ timeout: 60000 });
    frame = await openMvpFromBuild(page, apiWatch(page), u);
    await rows().first().waitFor({ timeout: 60000 });
    await until(async () => (await plan().locator('[data-decided]').count()) === keys.length, 'the decisions are still there after a refresh');
    assert.match((await line(keys[1]).locator('[data-decided]').innerText()).trim(), /^Override to 7 instead of .+: Store event this week$/);
    assert.match((await line(keys[0]).locator('[data-decided]').innerText()).trim(), /^Accepted the recommended /);
    assert.equal(await takeAll().count(), 0, 'after a refresh Take all offers no line already decided');
    await waits(total - keys.length);
    assert.equal(decided.length, keys.length, 'the refresh decided nothing again');
    await backToRun(page, apiWatch(page));
    }
    assert.deepEqual(ui.missing, []);
    assert.deepEqual(ui.outside, []);
    assert.equal(ui.made.sqlCalls.length, 0);
    assert.equal(ui.made.fetches.length, 0);
  } finally {
    await ui.close();
  }
});
