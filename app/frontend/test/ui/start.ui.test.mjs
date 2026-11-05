import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark } from './uiSupport.mjs';
import { REVIEW_PORTFOLIO, REVIEW_STATE } from './reviewFixtures.js';
import { PORTFOLIO_GROUPS } from '../../src/lib/reviewFigures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
const TOTALS = { businesses: '3', runs: '6', use_cases: '18', domains: '3', best_of_best: '3', mvps_started: '3', mvps_live: '2', apps: '1', dashboards: '2',
  genie_spaces: '2', alerts: '1' };
const LABELS = {
  businesses: 'Show the 3 businesses', runs: 'Show the 6 runs', use_cases: 'Show the runs that found the 18 use cases',
  domains: 'Show the runs that found the 3 domains', best_of_best: 'Show the runs with the 3 Best of Best use cases',
  mvps_started: 'Show the 3 MVPs started in Build', mvps_live: 'Show the 2 live MVPs in Build', apps: 'Show the 1 App in Build',
  dashboards: 'Show the 2 dashboards in Build', genie_spaces: 'Show the 2 Genie Agents in Build', alerts: 'Show the 1 alert in Build',
};
const totals = (page) => page.getByRole('region', { name: 'Across all runs' });
const card = (page, key) => totals(page).locator(`[data-portfolio-card="${key}"]`);
const chip = (page) => page.locator('[data-run-filter]');
const rows = (page) => page.locator('[data-run]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run')));
const runButtons = async (strip) => (await strip.getByRole('group').getByRole('button').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());

async function openStart(state = REVIEW_STATE) {
  const ui = await openUi('app', state, '', { mount });
  try {
    await ui.page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await ui.page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await card(ui.page, 'businesses').locator('[data-card-value]').filter({ hasText: /^\d/ }).waitFor({ timeout: 20000 });
  } catch (err) {
    await ui.close();
    throw err;
  }
  return ui;
}

test('a run still starting shows on Start as Starting, and opening it follows that run on Monitor', async () => {
  const STARTING = { session_id: '7001', run_id: '701', starting: true, business_name: 'Acme', completed_percent: 0, create_at: '2026-11-02T10:00:00Z',
    last_updated: new Date().toISOString(), widget_values: { business: 'Acme', operation_mode: 'Discover Use Cases' } };
  const runReads = [];
  const ui = await openUi('app', { ...REVIEW_STATE, sessions: [STARTING, ...REVIEW_STATE.sessions] }, '', {
    mount: (app) => {
      mount(app);
      app.get('/api/run/:runId/cancel', (_req, res) => res.json({ allowed: true }));
      app.get('/api/run/:runId', (req, res) => { runReads.push(req.params.runId); res.json({ run_id: Number(req.params.runId), life_cycle_state: 'PENDING', tasks: [] }); });
    },
  });
  const { page } = ui;
  const missing = [];
  page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const row = page.locator('[data-run="7001"]');
    await row.waitFor({ timeout: 20000 });
    assert.match(await row.innerText(), /Acme[\s\S]*Starting/);
    assert.doesNotMatch(await page.locator('[data-run="42"]').innerText(), /Starting/, 'a run that wrote its rows keeps its own status');
    const runRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/run/701', { timeout: 15000 });
    await row.getByRole('button').first().click();
    await page.getByRole('heading', { name: 'Pipeline Monitor', level: 1 }).waitFor({ timeout: 15000 });
    await runRead;
    assert.ok(runReads.includes('701'), `Monitor reads the run: ${runReads.join(', ')}`);
    assert.deepEqual(missing, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start shows the totals above the runs list from three aggregate reads, and every card is a button that says what it does', async () => {
  const ui = await openStart();
  const { page, made } = ui;
  try {
    const shown = {};
    const labels = {};
    for (const group of PORTFOLIO_GROUPS) {
      const box = totals(page).getByRole('group', { name: group.label });
      for (const c of group.cards) {
        const cell = box.locator(`[data-portfolio-card="${c.key}"]`);
        assert.equal((await cell.locator('[data-card-label]').innerText()).trim(), c.label);
        shown[c.key] = (await cell.locator('[data-card-value]').innerText()).trim();
        assert.equal(await cell.evaluate((el) => el.tagName), 'BUTTON', `${c.key} is a button`);
        labels[c.key] = await cell.getAttribute('aria-label');
      }
    }
    assert.deepEqual(shown, TOTALS);
    assert.deepEqual(labels, LABELS);
    const reads = made.sqlCalls.filter((c) => c.sql.includes('GROUP BY ROLLUP') || c.sql.includes('AS businesses FROM'));
    assert.equal(new Set(reads.map((c) => c.sql)).size, 3, 'one aggregate statement per table, whatever the number of runs');
    assert.ok(made.state.sessionsAsked.some((q) => q.all === '1'), 'Start lists every run, not the newest 20');
    const above = await page.evaluate(() => Boolean(document.querySelector('[data-portfolio]').compareDocumentPosition(document.querySelector('[data-run="42"]'))
      & Node.DOCUMENT_POSITION_FOLLOWING));
    assert.equal(above, true, 'the totals sit above the runs list');
    assert.equal(await page.getByText(/use cases discovered/).count(), 0, 'the old one-line total is gone, so no figure shows twice');
    assert.equal(await page.locator('button button').count(), 0);

    await page.locator('h1').click();
    let focused = '';
    for (let i = 0; i < 40 && focused !== 'businesses'; i += 1) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.getAttribute('data-portfolio-card') || '');
    }
    assert.equal(focused, 'businesses', 'the keyboard reaches the cards');
    const ring = await card(page, 'businesses').evaluate((el) => ({ visible: el.matches(':focus-visible'), shadow: getComputedStyle(el).boxShadow }));
    assert.equal(ring.visible, true);
    assert.notEqual(ring.shadow, 'none', 'a focused card shows its focus ring');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-portfolio-card')), 'runs');

    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[data-portfolio]']);
      assert.ok(measured.checked >= 24, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} totals`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Businesses, Runs and the use case cards filter the runs list in place with a Showing chip and Clear, and a second press clears too', async () => {
  const ui = await openStart();
  const { page } = ui;
  try {
    assert.deepEqual(await rows(page), ['42', '41', '50', '51', '60'], 'the first page of runs');
    const cases = [
      ['businesses', 'Showing: the latest run of each of 3 businesses', ['42', '50', '51']],
      ['runs', 'Showing: all 6 runs', ['42', '41', '50', '51', '60', '61']],
      ['use_cases', 'Showing: the 3 runs that found use cases', ['42', '41', '50']],
      ['domains', 'Showing: the 3 runs that found domains', ['42', '41', '50']],
      ['best_of_best', 'Showing: the 2 runs with Best of Best use cases', ['42', '41']],
    ];
    for (const [key, text, want] of cases) {
      await card(page, key).click();
      await chip(page).waitFor();
      assert.equal(await chip(page).getAttribute('data-run-filter'), key);
      assert.equal(await chip(page).locator('p').innerText(), text);
      assert.equal(await card(page, key).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await rows(page), want, key);
      assert.equal(await page.getByRole('button', { name: /Show \d+ more experiment/ }).count(), 0, `${key} shows every run it keeps`);
      assert.equal(await page.getByRole('heading', { name: 'Build', exact: true }).count(), 0, `${key} stays on Start`);
    }
    assert.equal(await card(page, 'businesses').getAttribute('aria-pressed'), 'false', 'one filter at a time');
    await chip(page).getByRole('button', { name: 'Clear' }).click();
    await chip(page).waitFor({ state: 'detached' });
    assert.deepEqual(await rows(page), ['42', '41', '50', '51', '60']);
    assert.equal(await card(page, 'best_of_best').getAttribute('aria-pressed'), 'false');
    await card(page, 'runs').click();
    await chip(page).waitFor();
    await card(page, 'runs').click();
    await chip(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).then((r) => r.length), 5, 'pressing the active card again clears it');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const TWO_RUNS = {
  ...REVIEW_STATE,
  portfolioMvps: [...REVIEW_PORTFOLIO.portfolioMvps, { sid: '50', is_total: '0', mvps_started: '1', mvps_live: '1', apps: '1', dashboards: '0', genie_spaces: '0', alerts: '0' }],
};

test('the MVP, App, dashboard, Genie Agent and alert cards open Build filtered to that kind, and a kind in several runs lists each run', async () => {
  const ui = await openStart(TWO_RUNS);
  const { page, made } = ui;
  const strip = page.locator('[data-build-filter]');
  const pressed = () => page.locator('[data-asset-filter][aria-pressed="true"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-asset-filter')));
  const toStart = async () => {
    await page.locator('header nav button', { hasText: 'Start' }).click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await card(page, 'apps').locator('[data-card-value]').filter({ hasText: /^\d/ }).waitFor();
  };
  try {
    const cases = [
      ['genie_spaces', ['genie_space'], 'Showing: use cases with a Genie Agent in Acme', []],
      ['dashboards', ['dashboard'], 'Showing: use cases with a dashboard in Acme', []],
      ['alerts', ['alert'], 'Showing: use cases with an alert in Acme', []],
      ['mvps_started', [], 'Showing: use cases with an MVP in Acme', ['Acme 1', 'Beta Foods 1']],
      ['mvps_live', [], 'Showing: use cases with a live MVP in Acme', ['Acme 1', 'Beta Foods 1']],
    ];
    for (const [key, asset, text, runNames] of cases) {
      await card(page, key).click();
      await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
      await strip.waitFor();
      assert.equal(await strip.getAttribute('data-build-filter'), key);
      assert.equal(await strip.getByRole('status').innerText(), text);
      await page.locator('nav[aria-label="Use cases"] section button').first().waitFor();
      assert.deepEqual(await pressed(), asset, `${key} presses its asset filter`);
      const listed = await page.locator('nav[aria-label="Use cases"] section button').evaluateAll((els) => els.map((el) => el.querySelector('.font-mono')?.textContent));
      assert.deepEqual(listed, ['N01-U01'], `${key} lists only the use case that has one`);
      if (asset.length) {
        const tile = page.locator(`[data-asset-tiles] [data-asset-tile="${asset[0]}"]`);
        await tile.waitFor({ timeout: 15000 });
        assert.notEqual(await tile.getAttribute('data-tile-kind'), 'off', `${key} shows the ${asset[0]} tile of the use case as part of its MVP`);
      }
      if (runNames.length) assert.deepEqual(await runButtons(strip), runNames, `${key} lists each run that holds it`);
      else assert.equal(await strip.getByRole('group').count(), 0, `one run holds ${key}, so there is no run to pick`);
      await toStart();
    }

    made.sqlCalls.length = 0;
    await card(page, 'apps').click();
    await strip.waitFor({ timeout: 20000 });
    assert.equal(await strip.getByRole('status').innerText(), 'Showing: use cases with an App in Acme');
    const runs = strip.getByRole('group', { name: 'Runs with Apps' });
    assert.deepEqual(await runButtons(strip), ['Acme 1', 'Beta Foods 1']);
    assert.equal(await runs.locator('[data-build-run="42"]').getAttribute('aria-pressed'), 'true');
    await runs.locator('[data-build-run="50"]').click();
    await page.waitForFunction(() => document.querySelector('[data-build-filter] [role="status"]')?.textContent === 'Showing: use cases with an App in Beta Foods');
    assert.equal(await strip.locator('[data-build-run="50"]').getAttribute('aria-pressed'), 'true');
    await page.locator('nav[aria-label="Use cases"] section button').first().waitFor();
    assert.deepEqual(await pressed(), ['app'], 'the other run opens with the same filter');
    assert.ok(made.sqlCalls.some((c) => (c.parameters || []).some((p) => String(p.value) === '50') || String(c.sql).includes('50')),
      'Build reads the run that was picked');

    await strip.getByRole('button', { name: 'Clear' }).click();
    await strip.waitFor({ state: 'detached' });
    assert.deepEqual(await pressed(), [], 'Clear shows every use case again');
    await toStart();
    await card(page, 'apps').click();
    await strip.waitFor({ timeout: 20000 });
    await page.locator('[data-asset-filter="dashboard"]').click();
    await strip.waitFor({ state: 'detached' });
    assert.deepEqual(await pressed(), ['dashboard'], 'picking another asset leaves the filter from Start');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const ZERO = {
  ...REVIEW_STATE,
  portfolioMvps: [
    { sid: null, is_total: '1', mvps_started: '1', mvps_live: '1', apps: '1', dashboards: '1', genie_spaces: '0', alerts: '0' },
    { sid: '42', is_total: '0', mvps_started: '1', mvps_live: '1', apps: '1', dashboards: '1', genie_spaces: '0', alerts: '0' },
  ],
};

test('a card with a count of 0 is shown, says why, and never navigates or filters', async () => {
  const ui = await openStart(ZERO);
  const { page } = ui;
  try {
    await page.clock.install();
    for (const [key, why] of [['alerts', 'No MVP has an alert yet.'], ['genie_spaces', 'No MVP has a Genie Agent yet.']]) {
      const off = card(page, key);
      assert.equal(await off.evaluate((el) => el.tagName), 'DIV', `${key} at 0 is no button`);
      assert.equal(await off.getAttribute('data-card-off'), '');
      assert.equal((await off.locator('[data-card-value]').innerText()).trim(), '0');
      assert.equal(await off.locator('[data-card-why]').innerText(), why);
      assert.equal(await off.evaluate((el) => el.tabIndex), -1, 'the keyboard skips it');
      await off.click();
      await page.clock.runFor(500);
      assert.equal(await page.getByRole('heading', { name: 'Build', exact: true }).count(), 0, `${key} at 0 never opens Build`);
      assert.equal(await page.locator('[data-run-filter], [data-build-filter]').count(), 0, `${key} at 0 sets no filter`);
      assert.deepEqual(await rows(page), ['42', '41', '50', '51', '60']);
    }
    await page.clock.resume();
    assert.equal(await totals(page).getByRole('button').count(), 9, 'the 9 cards with a count are buttons');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      assert.deepEqual((await lowContrast(page, ['[data-card-off]'])).low, [], `${dark ? 'dark' : 'light'} reason text`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('totals that cannot be read say why on Start, and the runs list still works', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE, sqlErrors: { 'AS businesses FROM': 'PERMISSION_DENIED: User does not have SELECT on __inspire_session' } }, '', { mount });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await totals(page).getByRole('alert').waitFor({ timeout: 20000 });
    assert.match(await totals(page).getByRole('alert').innerText(), /^Inspire could not count across the runs: PERMISSION_DENIED/);
    assert.equal(await totals(page).locator('[data-portfolio-card]').count(), 0);
    await page.locator('[data-run="42"]').waitFor();
    assert.deepEqual(await rows(page), ['42', '41', '50', '51', '60']);
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 500/.test(e)), []);
  } finally {
    await ui.close();
  }
});

const choice = (page, id) => page.locator(`[data-start-choice="${id}"]`);
const DEMO_LIST = { showcases: [{ id: 'acme', session_id: '42', title: 'Acme retail', business: 'Acme', summary: 'Demo' }] };

test('Start offers three unmistakable ways in: your own data, sample data Inspire creates for you, or a finished demo, and each opens its page', async () => {
  const withDemo = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json(DEMO_LIST));
  };
  for (const state of [REVIEW_STATE, { ...REVIEW_STATE, sessions: [] }]) {
    const ui = await openUi('app', state, '', { mount: withDemo });
    const { page } = ui;
    try {
      await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
      const ways = page.getByRole('region', { name: 'How do you want to start?' });
      await ways.waitFor({ timeout: 20000 });
      assert.deepEqual(await ways.locator('[data-start-choice]').evaluateAll((els) => els.map((el) => el.getAttribute('data-start-choice'))), ['data', 'no-data', 'demo']);
      assert.equal(await page.getByRole('button', { name: 'I have data in Unity Catalog', exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'No data yet', exact: true }).count(), 1);
      assert.match(await choice(page, 'no-data').innerText(), /creates sample tables for it and simulates a full run on them/);
      assert.match(await choice(page, 'data').innerText(), /Inspire finds use cases in your own data/);
      assert.match(await choice(page, 'demo').innerText(), /Nothing in your workspace changes/);
      assert.equal(await choice(page, 'no-data').getAttribute('aria-describedby') !== null, true, 'each choice reads its explanation to screen readers');
      for (const id of ['data', 'no-data', 'demo']) assert.doesNotMatch(await choice(page, id).innerText(), /[\u2013\u2014]/);
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity));
      const box = async (id) => choice(page, id).boundingBox();
      const [data, noData, demo] = [await box('data'), await box('no-data'), await box('demo')];
      assert.equal(Math.round(data.height), Math.round(noData.height), 'the two ways to run Inspire are the same size, side by side');
      assert.equal(Math.round(data.y), Math.round(noData.y));
      assert.ok(demo.y >= noData.y + noData.height, 'the demo sits below them as the third, lighter way in');
      assert.deepEqual(ui.pageErrors, []);
      await choice(page, 'demo').click();
      await page.getByRole('region', { name: 'Demo' }).waitFor({ timeout: 20000 });
      assert.equal(await page.evaluate(() => window.location.hash), '#/demo/acme/review', 'the demo opens on its Review page');
    } finally {
      await ui.close();
    }
  }
  const ui = await openUi('app', REVIEW_STATE, '', { mount });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await choice(page, 'data').waitFor({ timeout: 20000 });
    assert.equal(await choice(page, 'demo').count(), 0, 'an App with no demo offers none (must-exclude)');
    await choice(page, 'data').click();
    await page.waitForFunction(() => window.location.hash === '#/launch', null, { timeout: 20000 });
    await page.locator('h1').first().waitFor();
    await page.goBack();
    await page.waitForFunction(() => window.location.hash === '#/start', null, { timeout: 20000 });
    await choice(page, 'no-data').click();
    await page.getByRole('heading', { level: 1, name: "I don't have data" }).waitFor({ timeout: 20000 });
    assert.equal(await page.evaluate(() => window.location.hash), '#/generate-data');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('each Start run row says how many MVPs were built for that run, from the same portfolio read, and a run with none says nothing', async () => {
  const state = {
    ...REVIEW_STATE,
    portfolioMvps: [
      { sid: null, is_total: '1', mvps_started: '5', mvps_live: '3', apps: '1', dashboards: '2', genie_spaces: '2', alerts: '1' },
      { sid: '42', is_total: '0', mvps_started: '3', mvps_live: '2', apps: '1', dashboards: '1', genie_spaces: '1', alerts: '1' },
      { sid: '41', is_total: '0', mvps_started: '1', mvps_live: '1', apps: '0', dashboards: '1', genie_spaces: '1', alerts: '0' },
      { sid: '50', is_total: '0', mvps_started: '0', mvps_live: '0', apps: '0', dashboards: '0', genie_spaces: '0', alerts: '0' },
    ],
  };
  const ui = await openStart(state);
  const { page } = ui;
  try {
    const mvps = (sid) => page.locator(`[data-run="${sid}"] [data-run-mvps]`);
    await mvps('42').waitFor({ timeout: 20000 });
    assert.equal((await mvps('42').innerText()).trim(), '2 MVPs built, 1 more started');
    assert.equal((await mvps('41').innerText()).trim(), '1 MVP built');
    assert.equal(await mvps('50').count(), 0, 'a run with no MVP shows no count (must-exclude)');
    const all = await page.locator('[data-run]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-run'), Boolean(el.querySelector('[data-run-mvps]'))]));
    assert.deepEqual(all.filter(([, shown]) => shown).map(([sid]) => sid), ['42', '41']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
