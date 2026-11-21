// REQ-435: the Calculate value box stays editable; the value drivers that are not in the data; answers live on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DRIVER_DEFS = JSON.parse(readFileSync(new URL('../../../backend/lib/valueDrivers.json', import.meta.url), 'utf8'));
const TIME = DRIVER_DEFS.drivers.find((d) => d.id === 'time_saved');
const COST_LABEL = TIME.inputs.find((i) => i.id === 'cost_per_hour').label;
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const MONEY = { currency: 'per_currency', value: { method: 'fixed', amount: 1, currency: 'USD' } };
const yearlyOf = (amount, parts = null, attribution = 100) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true,
  entries: [{ kind: 'money', unit: 'USD', amount }], basis: { sampled_records: 1200, eligible_records: 48000, days: 90 },
  ...(parts ? { parts, attribution_pct: attribution, total: { unit: 'USD', amount } } : {}) });
const PARTS = [
  { source: 'data', id: 'data', label: 'From your data', amount: 300000, unit: 'USD' },
  { source: 'assumption', id: 'time_saved', label: 'Time saved', amount: 477000, unit: 'USD' },
];
const SAVED = { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', yearly: yearlyOf(777000, PARTS),
  answers: { money: MONEY, kpi: null, currency: 'USD', attribution_pct: 100,
    drivers: { time_saved: { events_per_year: 1200, people: 2, hours_before: 3, hours_after: 1, cost_per_hour: 150 } } } };

function mountWith({ puts = [], posts = [], saved = SAVED, putReply = null, history = [] } = {}) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/overall', (_req, res) => res.json({ at_stake: [], saved: [], runs: 0, businesses: 0 }));
    app.get('/api/inspire/value/runs', (_req, res) => res.json({ runs: {} }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: saved ? { 'N01-U01': saved } : {} }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history }));
    app.put('/api/inspire/value/answers', (req, res) => {
      puts.push(req.body);
      if (putReply?.status) return res.status(putReply.status).json(putReply.body);
      return res.json(putReply?.body || { version: 3, yearly: yearlyOf(888000, PARTS), disclaimer: 'x' });
    });
    app.post('/api/inspire/value/answers/undo', (req, res) => {
      posts.push(req.body);
      res.json({ version: 4, answers: SAVED.answers, yearly: yearlyOf(777000, PARTS) });
    });
  };
}

async function openCard(mount) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[aria-expanded]').first().waitFor();
  const card = list.locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
  return { ui, card, page: ui.page };
}
const amount = async (card) => (await card.locator('[data-value-amount]').innerText()).replace(/\s+/g, ' ').trim();
const openDialog = async (page) => {
  const dialog = page.getByRole('dialog', { name: 'Calculate value at stake' });
  await dialog.waitFor();
  return dialog;
};
const openPart = (dialog, label) => dialog.getByRole('button', { name: label, exact: false }).filter({ hasText: label }).first().click();

test('B1: a card with a value shows Edit value, and the box reopens with the saved number', async () => {
  const { ui, card, page } = await openCard(mountWith());
  try {
    await card.locator('[data-value-yearly]').waitFor({ timeout: 15000 });
    const edit = card.getByRole('button', { name: 'Edit value' });
    await edit.click();
    const dialog = await openDialog(page);
    await openPart(dialog, TIME.label);
    assert.equal(await dialog.getByLabel(COST_LABEL).inputValue(), '150');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('B2: changing a driver number and pressing Calculate saves it with PUT and the card shows the returned total', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWith({ puts }));
  try {
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await openPart(dialog, TIME.label);
    await dialog.getByLabel(COST_LABEL).fill('200');
    await dialog.getByRole('button', { name: 'Calculate', exact: true }).click();
    await dialog.locator('[data-split-total]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].use_case_id, 'N01-U01');
    assert.equal(puts[0].answers.drivers.time_saved.cost_per_hour, 200);
    assert.equal(puts[0].answers.attribution_pct, 100);
    assert.equal(puts[0].answers.currency, 'USD');
    assert.equal(await amount(card), '$888K (estimated)');
  } finally { await ui.close(); }
});

test('B3: the box lists the five drivers by the labels in valueDrivers.json, and the share input starts at 100', async () => {
  const { ui, card, page } = await openCard(mountWith({ saved: null }));
  try {
    await card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
    await card.locator('[data-value-calculate]').click();
    const dialog = await openDialog(page);
    for (const d of DRIVER_DEFS.drivers) assert.ok(await dialog.getByText(d.label, { exact: true }).first().isVisible(), `${d.label} is listed`);
    assert.equal(await dialog.getByLabel(DRIVER_DEFS.attribution.label).inputValue(), String(DRIVER_DEFS.attribution.default));
    assert.equal(await dialog.getByText('your assumption').count() >= 5, true);
    assert.equal(await dialog.getByText('from data').count() >= 1, true);
  } finally { await ui.close(); }
});

test('B4: an empty driver is not sent, and a driver alone (no money) can be calculated', async () => {
  const puts = [];
  const mount = mountWith({ puts, saved: null });
  const { ui, card, page } = await openCard((app) => {
    mount(app);
    app.post('/api/money/value-preview', (_req, res) => res.status(400).json({ error: 'no table' }));
  });
  try {
    await card.locator('[data-value-calculate]').click();
    const dialog = await openDialog(page);
    await dialog.getByRole('list', { name: 'Money decisions' }).waitFor();
    await dialog.getByLabel('Use the value from your data').uncheck();
    await openPart(dialog, TIME.label);
    for (const i of TIME.inputs) await dialog.getByLabel(i.label).fill(i.id === 'hours_after' ? '1' : '2');
    const go = dialog.getByRole('button', { name: 'Calculate', exact: true });
    assert.equal(await go.isEnabled(), true);
    await go.click();
    await dialog.locator('[data-split-total]').waitFor({ timeout: 15000 });
    assert.deepEqual(Object.keys(puts[0].answers.drivers), ['time_saved']);
    assert.equal(puts[0].answers.money == null, true, 'no money is sent for a driver-only answer');
  } finally { await ui.close(); }
});

test('B5: after Calculate the box shows one row per part with its tag, and the total', async () => {
  const { ui, card, page } = await openCard(mountWith());
  try {
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Calculate', exact: true }).click();
    const split = dialog.locator('[data-value-split]');
    await split.waitFor({ timeout: 15000 });
    const rows = split.locator('[data-split-row]');
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(0).innerText(), /From your data[\s\S]*\$300K[\s\S]*from data/);
    assert.match(await rows.nth(1).innerText(), /Time saved[\s\S]*\$477K[\s\S]*your assumption/);
    assert.match(await split.locator('[data-split-total]').innerText(), /\$888K/);
    assert.match(await split.innerText(), /100%/);
    assert.match(await dialog.innerText(), /not a validated business case/);
  } finally { await ui.close(); }
});

test('B6: History lists the versions and Undo restores the earlier one on the card', async () => {
  const posts = [];
  const history = [
    { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', note: '', answers: SAVED.answers, yearly: yearlyOf(777000, PARTS) },
    { version: 1, saved_at: '2026-11-19T10:00:00Z', saved_by: 'sam@example.com', note: '', answers: SAVED.answers, yearly: yearlyOf(300000, PARTS.slice(0, 1)) },
  ];
  const { ui, card, page } = await openCard(mountWith({ posts, history }));
  try {
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    const rows = dialog.locator('[data-history-row]');
    await rows.first().waitFor({ timeout: 15000 });
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(1).innerText(), /1[\s\S]*sam@example\.com[\s\S]*\$300K/);
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelector('[data-value-yearly] [data-value-amount]')?.textContent.includes('777'), null, { timeout: 15000 });
    assert.equal(posts[0].use_case_id, 'N01-U01');
    assert.equal(await amount(card), '$777K (estimated)');
  } finally { await ui.close(); }
});

test('B8: a server 400 shows its one line in the box and keeps the typed numbers', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWith({ puts, putReply: { status: 400, body: { error: 'The data part is in AED but the answer currency is USD.' } } }));
  try {
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await openPart(dialog, TIME.label);
    await dialog.getByLabel(COST_LABEL).fill('321');
    await dialog.getByRole('button', { name: 'Calculate', exact: true }).click();
    const alert = dialog.getByRole('alert');
    await alert.waitFor({ timeout: 15000 });
    assert.match(await alert.innerText(), /AED but the answer currency is USD/);
    assert.equal(await dialog.getByLabel(COST_LABEL).inputValue(), '321');
    assert.equal(await amount(card), '$777K (estimated)', 'the card keeps its last value');
  } finally { await ui.close(); }
});

test('B9: the box fits a 1280x800 window with no sideways scroll, and no new component has a fixed width over 1200px', async () => {
  const { ui, card, page } = await openCard(mountWith());
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await openPart(dialog, TIME.label);
    const over = await dialog.evaluate((el) => {
      const scroller = [el, ...el.querySelectorAll('*')].find((n) => n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX));
      return { page: document.documentElement.scrollWidth > window.innerWidth, inner: Boolean(scroller), width: el.getBoundingClientRect().width };
    });
    assert.equal(over.page, false);
    assert.equal(over.inner, false);
    assert.ok(over.width <= 1280);
  } finally { await ui.close(); }
  for (const file of ['ValueDrivers.jsx', 'ValueHistory.jsx', 'CalculateValueDialog.jsx']) {
    const text = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/(?:w|min-w)-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 1200, `${file} has ${m[0]}`);
  }
});
