// FX-63c items 2 and 4 (REQ-472, REQ-473, D-uae-06): the Build next rows follow the shown list without refetching, and the money editor keeps a saved rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barePage, closeBare } from './fx63cBundle.mjs';

test.after(closeBare);

const uc = (id, name) => ({ id, use_case: name, name_with_technique: name, primary_table: 'main.s.t', tables_involved: 'main.s.t' });
const LISTED = [uc('N01-U01', 'Alpha'), uc('N01-U02', 'Beta')];
const FROM_RUN = [uc('N09-U01', 'From the run')];

// Mounts the panel on a bare page; window.__calls counts the reads, window.__show(list) renders again with that list.
async function mountPanel(page) {
  await page.evaluate((fromRun) => {
    const { React, createRoot, BuildNextPanel } = window.__lib;
    window.__calls = [];
    const apiFetch = async (url) => {
      window.__calls.push(url.split('?')[0]);
      if (url.includes('/usecases')) return { usecases: fromRun };
      if (url.includes('/implement/history')) return { latest: [] };
      return { use_cases: {} };
    };
    const root = createRoot(document.getElementById('root'));
    window.__show = (list) => root.render(React.createElement(BuildNextPanel, { apiFetch, inspireDatabase: 'main.inspire', warehouseId: 'wh1', sessionId: '42', useCases: list }));
  }, FROM_RUN);
}
const rowsOf = (page) => page.locator('[data-build-next-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-build-next-row')));

test('a new list identity with the same use case ids does not read the three APIs again; a different set of ids does', async () => {
  const { page, errors } = await barePage();
  try {
    await mountPanel(page);
    await page.evaluate((list) => window.__show(list), LISTED);
    await page.locator('[data-build-next-row]').first().waitFor({ timeout: 10000 });
    const reads = await page.evaluate(() => window.__calls.length);
    assert.equal(reads, 4, 'one read of use cases, history, estimates and totals');
    await page.evaluate((list) => window.__show(list.map((u) => ({ ...u }))), LISTED);
    await page.evaluate((list) => window.__show(list.map((u) => ({ ...u }))), LISTED);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__calls.length), reads, 'same ids, no new read');
    assert.deepEqual(await rowsOf(page), ['N01-U01', 'N01-U02']);
    await page.evaluate((list) => window.__show(list.slice(0, 1)), LISTED);
    await page.waitForFunction(() => document.querySelectorAll('[data-build-next-row]').length === 1);
    assert.deepEqual(await rowsOf(page), ['N01-U01'], 'the rows follow the new list');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an absent list (undefined or null) suggests from the run use cases; an empty list suggests nothing and does not fall back', async () => {
  const { page } = await barePage();
  try {
    await mountPanel(page);
    await page.evaluate(() => window.__show(undefined));
    await page.locator('[data-build-next-row="N09-U01"]').waitFor({ timeout: 10000 });
    await page.evaluate(() => window.__show(null));
    await page.waitForTimeout(300);
    assert.deepEqual(await rowsOf(page), ['N09-U01']);
    await page.evaluate(() => window.__show([]));
    await page.waitForFunction(() => document.querySelectorAll('[data-build-next]').length === 0, null, { timeout: 10000 });
    assert.equal(await page.locator('[data-build-next-row]').count(), 0, 'an empty shown list is nothing to suggest');
  } finally { await page.close(); }
});

// FX-63c item 4 (REQ-473): the editor no longer asks for the value, direction or sign; an old saved rule still carries them on every edit.
const OLD_RULE = { currency: 'convert', base: 'USD', rates: { AED: 0.27, EUR: 1.08 }, window: { periods: 6 }, statuses: ['closed'], status_column: 'status', rule: 'net',
  sign: { kind: 'column', column: 'direction' }, value: { method: 'fixed', amount: 120, currency: 'USD' } };

async function editOnce(part, selector, text) {
  const { page, errors } = await barePage();
  try {
    await page.evaluate(({ rule, part: p }) => {
      const { React, createRoot, MoneyRuleEditor } = window.__lib;
      window.__changes = [];
      createRoot(document.getElementById('root')).render(React.createElement(MoneyRuleEditor, { value: rule, part: p, columns: ['amount', 'currency_code', 'status', 'direction'],
        sample: { amount: 'amount', currency: 'currency_code', status: 'status' }, api: {}, onChange: (v) => window.__changes.push(v) }));
    }, { rule: OLD_RULE, part });
    await page.locator(selector).waitFor({ timeout: 10000 });
    await page.locator(selector).fill(text);
    await page.waitForFunction(() => window.__changes.length > 0, null, { timeout: 5000 });
    const changes = await page.evaluate(() => window.__changes);
    assert.deepEqual(errors, []);
    return changes.at(-1);
  } finally { await page.close(); }
}

test('a window edit keeps the saved rule, sign and value unchanged in the onChange payload', async () => {
  const sent = await editOnce('window', '[data-money-window]', '12');
  assert.equal(sent.window.periods, 12);
  assert.equal(sent.rule, 'net');
  assert.deepEqual(sent.sign, OLD_RULE.sign);
  assert.deepEqual(sent.value, OLD_RULE.value);
});

test('a currency edit keeps the saved rule, sign and value unchanged in the onChange payload', async () => {
  const sent = await editOnce('currency', '[data-money-base]', 'EUR');
  assert.equal(sent.base, 'EUR');
  assert.equal(sent.rule, 'net');
  assert.deepEqual(sent.sign, OLD_RULE.sign);
  assert.deepEqual(sent.value, OLD_RULE.value);
});
