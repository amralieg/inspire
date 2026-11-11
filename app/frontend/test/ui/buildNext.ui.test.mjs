import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built, builtSpec } from './implementFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};

const measured = (high, currency = 'AED') => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency,
  text: `${currency} ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const notMeasured = () => JSON.stringify({ status: 'not measured yet', text: 'Value not measured yet: measure Weekly sales with its KPI query.' });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });

const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders', 'main.s.customers'), inspire_score: '6' },
  { id: 'N02-U01', name_with_technique: 'Track stock outs', value_estimate: measured(2500), data_evidence: evidence('main.s.stock'), inspire_score: '8' },
  { id: 'N02-U02', name_with_technique: 'Score supplier risk', value_estimate: notMeasured(), data_evidence: evidence('main.s.stock'), inspire_score: '9.1' },
  { id: 'N03-U01', name_with_technique: 'Reorder timing', value_estimate: measured(1200), data_evidence: evidence('main.s.orders'), inspire_score: '5' },
];
const STATE = { ...REVIEW_STATE, useCases: USE_CASES, history: [built({ use_case_id: 'N01-U01' })] };
const PROGRESS = '1 of 5 use cases live, AED 6K at stake covered';

async function openApp(state = STATE) {
  return openUi('app', state, '', { mount });
}

async function go(page, hash) {
  await page.evaluate((target) => { window.location.hash = target; }, hash);
}

// REQ-105: the Start page (ChoosePage, reached from Get Started) shows no Build next section.
test('Start shows no Build next section', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-build-next]').count(), 0);
    assert.equal(await page.locator('[data-build-next-row]').count(), 0);
  } finally {
    await ui.close();
  }
});

test('Review shows the Build next panel with the live count, the value at stake covered, and the unbuilt use cases ranked by value', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await go(page, '#/review/42');
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal((await panel.locator('[data-build-progress]').innerText()).replace(/\s+/g, ' ').trim(), PROGRESS);
    const order = await panel.locator('[data-build-next-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-build-next-row')));
    assert.deepEqual(order, ['N01-U02', 'N02-U01', 'N03-U01']);
    assert.equal(await panel.locator('[data-start-mvp]').count(), 3);
    assert.equal(await page.locator('[data-build-next-row="N02-U02"]').count(), 0, 'the top three only');
  } finally {
    await ui.close();
  }
});

test('a live MVP on Build suggests the unbuilt use cases that read the same tables, ranked by value', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    const step = page.locator('[data-build-next-step]');
    await step.waitFor({ timeout: 20000 });
    const order = await step.locator('[data-next-step-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-next-step-row')));
    assert.deepEqual(order, ['N01-U02', 'N03-U01']);
    assert.match(await step.innerText(), /Shares main\.s\.orders/);
  } finally {
    await ui.close();
  }
});

test('a use case that is not live shows no next-step card', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await go(page, '#/build/42/N02-U01');
    await page.locator('[aria-label="Use case"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-build-next-step]').count(), 0);
  } finally {
    await ui.close();
  }
});

// The Build page's Build next step: Build Now submits the live App's settings for the sibling, Build custom opens the wizard.
const WIZARD = /Start Use Case MVP with Genie/;
const SIBLING_LIST_NAME = 'Score upsell';
const GRANT = 'GRANT SELECT ON TABLE `main`.`s`.`customers` TO `app-sp-id`';
const CUSTOMERS_REFUSAL = {
  text: 'The App cannot read main.s.customers, so the build cannot start.', tables: ['main.s.customers'], can_grant: true, grants: [GRANT],
  app: { name: 'churn-desk', id: 'app-sp-id' },
};

function mountBuilds(app, log, { refuse = null, gate = null } = {}) {
  mount(app);
  app.post('/api/inspire/implement/submit', async (req, res) => {
    log.submits.push(req.body);
    if (gate) await gate;
    if (refuse) return res.status(409).json({ error: refuse.text, app_unreadable: refuse });
    return res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
  });
  app.post('/api/inspire/implement/grant-access', (req, res) => {
    log.grants.push(req.body);
    res.json({ ran: [GRANT], failed: [], app_unreadable: null });
  });
}

const newLog = () => ({ submits: [], grants: [] });
const sibling = (page, id) => page.locator(`[data-next-step-row="${id}"]`);
const buildNowOf = (page, id) => sibling(page, id).getByRole('button', { name: 'Build Now', exact: true });

test('Build Now builds the sibling with the live App settings, its own use case and tables, and opens no wizard', async () => {
  const log = newLog();
  const ui = await openUi('app', STATE, '', { mount: (app) => mountBuilds(app, log) });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    await buildNowOf(page, 'N01-U02').click();
    await until(() => log.submits.length === 1, 'one build submitted');
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
    assert.equal(await page.getByRole('dialog', { name: WIZARD }).count(), 0, 'no wizard opens');

    const { spec, inspire_database: database, warehouse_id: warehouse, session_id: session } = log.submits[0];
    const live = builtSpec();
    assert.deepEqual([database, warehouse, session], ['main.inspire', 'wh1', '42']);
    const [catalog, schema] = live.config.result_table.split('.');
    assert.equal(spec.use_case_id, 'N01-U02');
    assert.equal(spec.based_on_version, null, 'a new build, not a rebuild of the App');
    assert.deepEqual(spec.data.tables, {}, 'the sibling reads its own tables, with no swaps carried over');
    assert.deepEqual(spec.config.widgets, {});
    assert.notEqual(spec.config.result_table, live.config.result_table, 'the sibling writes its own result table');
    assert.equal(spec.config.result_table, `${catalog}.${schema}.n01_u02_results`, 'the App\'s destination schema, the sibling\'s own table');
    assert.deepEqual(spec.schedule, live.schedule, 'the schedule is the App\'s');
    assert.deepEqual(spec.holdout, live.holdout);
    assert.deepEqual(spec.sharing, live.sharing);
    for (const key of ['app_placement', 'app_access', 'app_look', 'app_pages', 'app_options', 'genie_space', 'dashboard', 'alert', 'alert_recipients', 'inspire_url']) {
      assert.deepEqual(spec.outputs[key], live.outputs[key], `outputs.${key} is the App's`);
    }
    assert.deepEqual(spec.outputs.genie_questions, [], 'the App\'s Genie questions belong to its own use case');
    assert.notEqual(spec.use_case.goal, live.use_case.goal);
  } finally {
    await ui.close();
  }
});

test('Build Now shows a spinner while the build is sent, then the build progress of the sibling', async () => {
  const log = newLog();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ui = await openUi('app', STATE, '', { mount: (app) => mountBuilds(app, log, { gate }) });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    await buildNowOf(page, 'N01-U02').click();
    await sibling(page, 'N01-U02').locator('[data-build-spinner]').waitFor({ timeout: 10000 });
    assert.equal(await sibling(page, 'N01-U02').locator('[data-build-now]').isDisabled(), true, 'no second build while one is sent');
    release();
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
    await page.locator('[aria-label="Use case"]').waitFor({ timeout: 20000 });
    assert.equal(log.submits.length, 1);
  } finally {
    release();
    await ui.close();
  }
});

test('Build custom opens the wizard on that sibling and sends no build', async () => {
  const log = newLog();
  const ui = await openUi('app', STATE, '', { mount: (app) => mountBuilds(app, log) });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    await sibling(page, 'N01-U02').getByRole('button', { name: 'Build custom', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: WIZARD });
    await dialog.waitFor({ timeout: 20000 });
    assert.ok((await dialog.getAttribute('aria-label')).includes(SIBLING_LIST_NAME), 'the wizard is for the sibling');
    assert.equal(log.submits.length, 0, 'the wizard alone sends nothing');
  } finally {
    await ui.close();
  }
});

test('Build Now on a sibling whose tables the App cannot read shows the access refusal and Let Inspire read these tables', async () => {
  const log = newLog();
  const ui = await openUi('app', STATE, '', { mount: (app) => mountBuilds(app, log, { refuse: CUSTOMERS_REFUSAL }) });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    await buildNowOf(page, 'N01-U02').click();
    const panel = sibling(page, 'N01-U02').getByRole('region', { name: 'App read access', exact: true });
    await panel.waitFor({ timeout: 20000 });
    assert.match(await panel.innerText(), /The App cannot read main\.s\.customers/);
    assert.equal(await page.getByRole('dialog', { name: WIZARD }).count(), 0, 'the refusal does not open the wizard');
    await panel.getByRole('button', { name: 'Let Inspire read these tables', exact: true }).click();
    await panel.getByRole('status', { name: 'Grant result' }).getByText(/Inspire ran 1 grant with your sign-in/).waitFor({ timeout: 20000 });
    assert.deepEqual(log.grants.map((g) => g.tables), [['main.s.customers']], 'the grant names the unreadable table');
    assert.equal(log.submits.length, 1, 'the refused build is not retried by itself');
  } finally {
    await ui.close();
  }
});

for (const dark of [false, true]) {
  test(`the Build next panel and next-step card meet 4.5:1 contrast in ${dark ? 'dark' : 'light'} mode`, async () => {
    const ui = await openApp();
    const { page } = ui;
    try {
      await setDark(page, dark);
      await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
      await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
      await go(page, '#/review/42');
      await page.locator('[data-build-next]').waitFor({ timeout: 20000 });
      assert.deepEqual((await lowContrast(page, ['[data-build-next]'])).low, [], `${dark ? 'dark' : 'light'} Build next panel`);
      await go(page, '#/build/42/N01-U01');
      await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
      assert.deepEqual((await lowContrast(page, ['[data-build-next-step]'])).low, [], `${dark ? 'dark' : 'light'} next-step card`);
    } finally {
      await ui.close();
    }
  });
}

test('the new panel and card use no dashes or customer-facing selling words', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await go(page, '#/review/42');
    await page.locator('[data-build-next]').waitFor({ timeout: 20000 });
    const text = await page.locator('[data-build-next]').innerText();
    assert.doesNotMatch(text, /[–—]/);
    assert.doesNotMatch(text, /\bcustomer\b|\bpitch\b|\bprospect\b/i);
  } finally {
    await ui.close();
  }
});
