import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

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

test('Start shows Build next with the live count, the value at stake covered, and the unbuilt use cases ranked by value', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal((await panel.locator('[data-build-progress]').innerText()).replace(/\s+/g, ' ').trim(), PROGRESS);
    const order = await panel.locator('[data-build-next-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-build-next-row')));
    assert.deepEqual(order, ['N01-U02', 'N02-U01', 'N03-U01']);
    const valueLine = await panel.locator('[data-build-next-row="N01-U02"] [data-value-estimate]').innerText();
    assert.match(valueLine, /AED 9,000 a year/);
    assert.equal(await page.locator('[data-build-next-row="N02-U02"]').count(), 0, 'the top three only');
  } finally {
    await ui.close();
  }
});

test('Start Use Case MVP on the Build next panel opens Build on that use case', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-build-next]').waitFor({ timeout: 20000 });
    await page.locator('[data-build-next-row="N01-U02"] [data-start-mvp]').click();
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
  } finally {
    await ui.close();
  }
});

test('Review shows the same Build next panel for its run', async () => {
  const ui = await openApp();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await go(page, '#/review/42');
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal((await panel.locator('[data-build-progress]').innerText()).replace(/\s+/g, ' ').trim(), PROGRESS);
    assert.equal(await panel.locator('[data-start-mvp]').count(), 3);
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

for (const dark of [false, true]) {
  test(`the Build next panel and next-step card meet 4.5:1 contrast in ${dark ? 'dark' : 'light'} mode`, async () => {
    const ui = await openApp();
    const { page } = ui;
    try {
      await setDark(page, dark);
      await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
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
    await page.locator('[data-build-next]').waitFor({ timeout: 20000 });
    const text = await page.locator('[data-build-next]').innerText();
    assert.doesNotMatch(text, /[–—]/);
    assert.doesNotMatch(text, /\bcustomer\b|\bpitch\b|\bprospect\b/i);
  } finally {
    await ui.close();
  }
});

test('a run card with no measured KPI baseline says Value at stake: Not calculated, and its Measure action opens that use case (must-exclude a made-up number)', async () => {
  const ui = await openApp({ ...STATE, useCases: USE_CASES.map((uc) => (uc.id === 'N01-U02' ? { ...uc, value_estimate: notMeasured() } : uc)) });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    const row = panel.locator('[data-build-next-row="N02-U02"]');
    const line = await row.locator('[data-value-estimate="not-calculated"]').innerText();
    assert.match(line, /Value at stake: Not calculated/);
    assert.doesNotMatch(line, /AED|\d/, 'no number is shown for a use case without a measured baseline');
    assert.equal(await row.locator('[data-measure-value="N02-U02"]').innerText(), 'Measure');
    assert.match(await panel.locator('[data-build-next-row="N02-U01"] [data-value-estimate]').innerText(), /AED 2,500/, 'a measured card still shows its estimate');
    await row.locator('[data-measure-value="N02-U02"]').click();
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N02-U02'), null, { timeout: 20000 });
    await page.getByRole('region', { name: 'Measure' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('[data-wizard-header]').innerText(), /Step \d+ of \d+|Measure/, 'the wizard opens on its Measure step');
  } finally {
    await ui.close();
  }
});

test('the Measure step opens once from the Build next action; picking another use case does not reopen it', async () => {
  const ui = await openApp({ ...STATE, useCases: USE_CASES.map((uc) => (uc.id === 'N01-U02' ? { ...uc, value_estimate: notMeasured() } : uc)) });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const panel = page.locator('[data-build-next]');
    await panel.waitFor({ timeout: 20000 });
    await panel.locator('[data-build-next-row="N02-U02"] [data-measure-value="N02-U02"]').click();
    await page.getByRole('region', { name: 'Measure' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('region', { name: 'Measure' }).waitFor({ state: 'detached', timeout: 20000 });
    await go(page, '#/build/42/N02-U01');
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N02-U01'), null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-wizard-header]').count(), 0, 'the wizard does not reopen on Measure for another use case (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
