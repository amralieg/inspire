// REQ-435/436: the Calculate value box reopens on a saved value; History and Undo, a server 400 and the 1280x800 fit (the wizard's own cases are in valueWizard.ui.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { closeBrowser } from './uiSupport.mjs';
import { goTo, mountWizard, openCard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const yearlyOf = (amount, parts = null, attribution = 100) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true,
  entries: [{ kind: 'money', unit: 'USD', amount }], basis: { sampled_records: 1200, eligible_records: 48000, days: 90 },
  ...(parts ? { parts, attribution_pct: attribution, total: { unit: 'USD', amount } } : {}) });
const PARTS = [
  { source: 'data', id: 'data', label: 'From your data', amount: 300000, unit: 'USD' },
  { source: 'assumption', id: 'time_saved', label: 'Time saved', amount: 477000, unit: 'USD' },
];
const SAVED = { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', yearly: yearlyOf(777000, PARTS),
  answers: { currency: 'USD', attribution_pct: 100, drivers: { time_saved: { events_per_year: 1200, people: 2, hours_before: 3, hours_after: 1, cost_per_hour: 150 } } } };

const mountWith = ({ puts = [], posts = [], saved = SAVED, putReply = null, history = [] } = {}) => mountWizard({ puts, posts, saved, putReply, history });

// REQ-438 v8 value box: the amount and its "(estimated)" qualifier sit on their own lines; this reads them as one.
const amount = async (card) => `${(await card.locator('[data-value-amount]').innerText()).trim()} ${(await card.locator('[data-value-qualifier]').innerText()).trim()}`;
const openDialog = async (page) => {
  const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
  await dialog.waitFor();
  return dialog;
};
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
    await goTo(dialog, 'save');
    const rows = dialog.locator('[data-history-row]');
    await rows.first().waitFor({ timeout: 15000 });
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(1).innerText(), /1[\s\S]*sam@example\.com[\s\S]*\$300K/);
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelector('[data-value-yearly] [data-value-amount]')?.textContent.includes('777'), null, { timeout: 15000 });
    assert.equal(posts[0].use_case_id, 'N01-U01');
    assert.equal(await amount(card), '$777K (Provisional estimate)');
  } finally { await ui.close(); }
});

test('B8: a server 400 shows its one line in the box and keeps the typed numbers', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWith({ puts, putReply: { status: 400, body: { error: 'The data part is in AED but the answer currency is USD.' } } }));
  try {
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await goTo(dialog, 'driver:time_saved');
    await dialog.locator('[data-ask="cost_per_hour"] input[type=number]').fill('321');
    await goTo(dialog, 'save');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const alert = dialog.getByRole('alert');
    await alert.waitFor({ timeout: 15000 });
    assert.match(await alert.innerText(), /AED but the answer currency is USD/);
    assert.equal(puts.length, 1, 'the save was sent once');
    assert.equal(puts[0].answers.drivers.time_saved.inputs.cost_per_hour, 321, 'the typed number is kept');
    assert.equal(await amount(card), '$777K (Provisional estimate)', 'the card keeps its last value');
  } finally { await ui.close(); }
});

test('B9: the box fits a 1280x800 window with no sideways scroll, and no new component has a fixed width over 1200px', async () => {
  const { ui, card, page } = await openCard(mountWith());
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await card.getByRole('button', { name: 'Edit value' }).click();
    const dialog = await openDialog(page);
    await goTo(dialog, 'driver:time_saved');
    const over = await dialog.evaluate((el) => {
      const scroller = [el, ...el.querySelectorAll('*')].find((n) => n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX));
      return { page: document.documentElement.scrollWidth > window.innerWidth, inner: Boolean(scroller), width: el.getBoundingClientRect().width };
    });
    assert.equal(over.page, false);
    assert.equal(over.inner, false);
    assert.ok(over.width <= 1280);
  } finally { await ui.close(); }
  for (const file of ['ValueHistory.jsx', 'CalculateValueDialog.jsx', ...readdirSync(new URL('../../src/components/valueWizard/', import.meta.url)).map((f) => `valueWizard/${f}`)]) {
    const text = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/(?:w|min-w)-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 1200, `${file} has ${m[0]}`);
  }
});
