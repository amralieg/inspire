import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, TABLE, appInfo, openApp, serveDist, tracked, until } from './harness.mjs';
import { filterRows, localFilters, localKind, moveKey, orderColumns, passes, savedOrder } from '../src/grid.js';
import { CHOICES_SHOWN, choicesHint, searchHint, withValue } from '../src/filters.js';
import { DEFAULT_PREFS, GRID_CAPS, MY_KEY, cleanPrefs, columnOrder, setColumnOrder } from '../src/prefs.js';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const COLS = [{ key: '_pick', fixed: true }, { key: 'a' }, { key: 'b', num: true }, { key: 'c', date: true }, { key: '_ask', fixed: true }];
const keys = (columns) => columns.map((c) => c.key);

test('a saved order keeps the fixed columns in place, drops a column that is gone and puts a new column beside its first neighbour', () => {
  assert.deepEqual(keys(orderColumns(COLS, null)), ['_pick', 'a', 'b', 'c', '_ask']);
  assert.deepEqual(keys(orderColumns(COLS, ['c', 'a', 'b'])), ['_pick', 'c', 'a', 'b', '_ask']);
  assert.deepEqual(savedOrder(['a', 'b', 'c'], ['gone', 'c', 'a']), ['c', 'a', 'b'], 'a removed column is dropped and a new one follows its natural neighbour');
  assert.deepEqual(savedOrder(['n', 'a', 'b'], ['b', 'a']), ['n', 'b', 'a'], 'a new first column goes first');
  assert.deepEqual(savedOrder(['a', 'b'], ['x', 'y']), ['a', 'b'], 'an order with no column left falls back to the natural order');
  assert.deepEqual(savedOrder(['a', 'b'], 'a,b'), ['a', 'b']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'c', -4), ['c', 'a', 'b'], 'a move past the start stops at the start');
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'z', 0), ['a', 'b', 'c'], 'a fixed or unknown column never moves');
});

test('the column order is kept per table in My view, bounded, and saving the first order forgets it', () => {
  let prefs = setColumnOrder(DEFAULT_PREFS, 'page:p:records', ['b', 'a']);
  assert.deepEqual(columnOrder(prefs, 'page:p:records'), ['b', 'a']);
  assert.equal(columnOrder(prefs, 'page:p:table:t'), null, 'each table keeps its own order');
  prefs = setColumnOrder(prefs, 'page:p:records', null);
  assert.deepEqual(prefs.columns, {});
  const many = Object.fromEntries(Array.from({ length: GRID_CAPS.grids + 5 }, (_, i) => [`g${i}`, ['a']]));
  const kept = cleanPrefs({ columns: many }).columns;
  assert.equal(Object.keys(kept).length, GRID_CAPS.grids);
  assert.ok(kept[`g${GRID_CAPS.grids + 4}`] && !kept.g0, 'the most recently saved orders are the ones kept');
  assert.equal(cleanPrefs({ columns: { g: Array.from({ length: GRID_CAPS.keys + 9 }, (_, i) => `k${i}`) } }).columns.g.length, GRID_CAPS.keys);
  assert.deepEqual(cleanPrefs({ columns: { ['x'.repeat(GRID_CAPS.chars + 1)]: ['a'], g: ['x'.repeat(GRID_CAPS.chars + 1)] } }).columns, {});
});

test('each column of a table held in the browser takes a filter of its kind, and a fixed column takes none', () => {
  assert.deepEqual(COLS.map(localKind), ['', 'multi_select', 'number_range', 'date_range', '']);
  assert.equal(localKind({ key: 'x', filter: false }), '', 'a column can turn its filter off');
  const rows = [{ a: 'Web', b: 12, c: '2026-10-02T09:00:00Z' }, { a: 'Store', b: '40', c: '2026-10-20' }, { a: 'Web', b: null, c: null }, { a: '', b: 'n/a', c: 'soon' }];
  const filters = localFilters(COLS, rows);
  assert.deepEqual(filters.map((f) => [f.column, f.type]), [['a', 'multi_select'], ['b', 'number_range'], ['c', 'date_range']]);
  assert.deepEqual(filters[0].options, ['Store', 'Web'], 'the choices are the distinct values, blanks left out');
  assert.deepEqual(localFilters([{ key: 'a' }], [{ a: null }]), [], 'a column with no value to pick offers no empty choice list');
  const pick = (values) => filterRows(rows, COLS, filters, values).map((r) => rows.indexOf(r));
  assert.deepEqual(pick({}), [0, 1, 2, 3]);
  assert.deepEqual(pick({ a: ['Web'] }), [0, 2]);
  assert.deepEqual(pick({ b: { min: 20, max: null } }), [1], 'a number range compares numbers, and a blank or text cell is out');
  assert.deepEqual(pick({ b: { min: null, max: 12 } }), [0]);
  assert.deepEqual(pick({ c: { from: '2026-10-01', to: '2026-10-10' } }), [0], 'a date range compares days, and a cell that is no date is out');
  assert.deepEqual(pick({ a: ['Web'], c: { from: '2026-10-15', to: null } }), [], 'filters on two columns must both hold');
  assert.equal(passes(filters[0], 'Web', []), true, 'an empty pick filters nothing');
  const shown = [{ key: 'who', sortValue: (r) => r.name.toUpperCase() }];
  assert.deepEqual(localFilters(shown, [{ name: 'ann' }])[0].options, ['ANN'], 'a column filters on the value it sorts by');
});

test('the choice lists stay bounded and say so', () => {
  assert.equal(choicesHint(CHOICES_SHOWN), '');
  assert.equal(choicesHint(CHOICES_SHOWN + 1), `Showing ${CHOICES_SHOWN} of ${CHOICES_SHOWN + 1} choices. Type to narrow them.`);
  const lazy = { searchable: true, lazy: true, options: [] };
  assert.equal(searchHint(lazy, '', { busy: true }), 'Loading the choices…');
  assert.equal(searchHint(lazy, '', { q: '', options: Array(50).fill('a') }), 'Showing the first 50 choices. Type to search all of them.');
  assert.equal(searchHint(lazy, '', { q: '', options: ['a'] }), '');
  assert.equal(searchHint(lazy, '', { q: '', error: 'boom' }), 'The choices could not load: boom');
  assert.deepEqual(withValue({ a: ['x'] }, 'b', ['y']), { a: ['x'], b: ['y'] });
  assert.deepEqual(withValue({ a: ['x'] }, 'a', []), {}, 'clearing a column drops it');
});

const LIST = (page) => page.locator('section.card--list');
const heads = (page) => LIST(page).locator('thead th').evaluateAll((all) => all.map((th) => th.dataset.col));
const stored = (page) => page.evaluate((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}')).map((p) => p.columns || {}), MY_KEY);

test('a person moves a column with the keyboard and by dragging, the order stays after a reload, and Reset puts it back', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE, options: { ...DECIDE.options, modify: true } }, 1, TABLE), { routes });
  await LIST(page).locator('tbody tr').first().waitFor();
  const before = await heads(page);
  assert.equal(before[0], '_pick');
  assert.equal(before.at(-1), '_ask');
  assert.ok(before.includes('_actions') && before.includes('action_owner'));
  for (const fixed of ['_pick', '_actions', '_ask']) {
    const th = LIST(page).locator(`th[data-col="${fixed}"]`);
    assert.equal(await th.locator('.th-move, .th-sort, .cf-b').count(), 0, `${fixed} is fixed: it does not move, sort or filter`);
  }
  const movable = before.filter((k) => !k.startsWith('_'));
  assert.ok(movable.every(Boolean));
  assert.equal(await LIST(page).locator('.th-move').count(), movable.length, 'every data column has a grip');
  const [first, second] = movable;
  const grip = LIST(page).locator(`th[data-col="${first}"] .th-move`);
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(([a, b]) => {
    const cols = [...document.querySelectorAll('section.card--list thead th')].map((th) => th.dataset.col);
    return cols.indexOf(b) < cols.indexOf(a);
  }, [first, second]);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('th')?.dataset.col), first, 'focus stays on the moved grip');
  assert.match(await LIST(page).locator('[data-moved]').first().textContent(), /moved to column 2 of/);
  const cells = await LIST(page).locator('tbody tr').first().locator('td').count();
  assert.equal(cells, before.length, 'the cells move with their header');
  const saved = (await stored(page)).find((c) => c['page:n01_u05:records']);
  assert.deepEqual(saved['page:n01_u05:records'].slice(0, 2), [second, first]);
  const third = movable[2];
  const from = await LIST(page).locator(`th[data-col="${third}"] .th-move`).boundingBox();
  const to = await LIST(page).locator(`th[data-col="${second}"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((want) => [...document.querySelectorAll('section.card--list thead th')].map((th) => th.dataset.col).filter((k) => !k.startsWith('_'))
    .slice(0, 3).join() === want, [third, second, first].join());
  await page.reload();
  await LIST(page).locator('tbody tr').first().waitFor();
  assert.deepEqual((await heads(page)).filter((k) => !k.startsWith('_')).slice(0, 3), [third, second, first], 'the order is kept after a reload');
  await LIST(page).locator('[data-reset-columns]').click();
  await page.waitForFunction((want) => [...document.querySelectorAll('section.card--list thead th')].map((th) => th.dataset.col).join() === want, before.join());
  assert.equal((await stored(page)).some((c) => c['page:n01_u05:records']), false, 'the first order is not stored');
  assert.equal(await LIST(page).locator('[data-reset-columns]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an order saved before a run changed the columns still shows every column once', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes });
  await LIST(page).locator('tbody tr').first().waitFor();
  const natural = (await heads(page)).filter((k) => !k.startsWith('_'));
  await page.evaluate(([key, order]) => {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    const person = Object.keys(all)[0] || '';
    all[person] = { ...(all[person] || {}), columns: { 'page:n01_u05:records': order } };
    localStorage.setItem(key, JSON.stringify(all));
  }, [MY_KEY, ['gone_column', natural.at(-1), natural[0]]]);
  await page.reload();
  await LIST(page).locator('tbody tr').first().waitFor();
  const after = (await heads(page)).filter((k) => !k.startsWith('_'));
  assert.deepEqual([...after].sort(), [...natural].sort(), 'no column is lost or doubled, and the gone one is not drawn');
  assert.equal(after[0], natural.at(-1));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const USAGE = {
  days: 30, since: '2026-09-24', kinds: ['action', 'edit'],
  pages: [{ id: 'a', title: 'Desk A', counts: { action: 3, edit: 9 }, people: 2, total: 12, last: '2026-10-20T08:00:00Z', errors: [] },
    { id: 'b', title: 'Desk B', counts: { action: 40, edit: 1 }, people: 5, total: 41, last: '2026-10-02T08:00:00Z', errors: [] },
    { id: 'c', title: 'Desk C', counts: { action: 0, edit: 0 }, people: 0, total: 0, last: null, errors: [] }],
  people: [],
};

test('a table held in the browser sorts and filters each column in place, and says how many column filters are on', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: { 'admin/usage': ({ json }) => json(200, USAGE) } });
  await page.goto(`${served.base}#/admin`);
  const card = page.locator('section[aria-label="By use case"]');
  await card.locator('tbody tr').first().waitFor();
  const names = () => card.locator('tbody tr td:first-child b').allInnerTexts();
  assert.deepEqual(await names(), ['Desk A', 'Desk B', 'Desk C']);
  await card.locator('.th-sort', { hasText: 'All' }).click();
  assert.deepEqual(await names(), ['Desk B', 'Desk A', 'Desk C'], 'a number column sorts largest first');
  await card.locator('.th-sort', { hasText: 'Last change' }).click();
  assert.deepEqual(await names(), ['Desk B', 'Desk A', 'Desk C'], 'a date column sorts oldest first, and a blank goes last');
  await card.getByRole('button', { name: 'Filter Use case' }).click();
  await page.getByRole('listbox', { name: 'Use case' }).getByText('Desk A').click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await names(), ['Desk A']);
  assert.equal(await card.locator('.cf-n').innerText(), '1 column filter on');
  await card.getByRole('button', { name: 'Clear filters' }).click();
  await card.getByRole('button', { name: 'Filter All' }).click();
  const range = page.getByRole('dialog', { name: 'Filter All' });
  await range.getByLabel('From').fill('10');
  await range.getByRole('button', { name: 'Apply' }).click();
  assert.deepEqual((await names()).sort(), ['Desk A', 'Desk B']);
  await card.getByRole('button', { name: 'Filter Last change' }).click();
  const days = page.getByRole('dialog', { name: 'Filter Last change' });
  await days.getByLabel('From').fill('2026-10-10');
  await days.getByRole('button', { name: 'Apply' }).click();
  assert.deepEqual(await names(), ['Desk A']);
  assert.equal(await card.locator('.cf-n').innerText(), '2 column filters on');
  await card.getByRole('button', { name: /^Filter All, / }).click();
  await page.getByRole('dialog', { name: 'Filter All' }).getByRole('button', { name: 'Clear', exact: true }).click();
  await card.getByRole('button', { name: /^Filter Last change, / }).click();
  await page.getByRole('dialog', { name: 'Filter Last change' }).getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await card.locator('.cf-n').count(), 0, 'with every filter cleared the count goes away');
  await card.getByRole('button', { name: 'Filter Use case' }).click();
  await page.getByRole('listbox', { name: 'Use case' }).getByText('Desk C').click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await names(), ['Desk C']);
  await card.getByRole('button', { name: /^Filter Use case, / }).click();
  await page.getByRole('listbox', { name: 'Use case' }).getByText('Desk C').click();
  await page.getByRole('listbox', { name: 'Use case' }).getByText('Desk B').click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await names(), ['Desk B']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a choice list the server fills on demand loads its first choices when it opens and searches the rest', async () => {
  const asked = [];
  const columns = { list: [{ column: 'category', type: 'multi_select', label: 'Category', options: [], searchable: true, lazy: true, implied: true }], tables: {} };
  const routes = {
    filters: ({ json }) => json(200, { filters: [], columns }),
    'filters/options': ({ json, url }) => {
      const q = url.searchParams.get('q') || '';
      asked.push(q);
      return json(200, { options: ['Books', 'Music', 'Toys'].filter((v) => v.toLowerCase().includes(q.toLowerCase())) });
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes });
  await LIST(page).locator('tbody tr').first().waitFor();
  await LIST(page).getByRole('button', { name: 'Filter Category' }).click();
  const list = page.getByRole('listbox', { name: 'Category' });
  await list.getByText('Music').waitFor();
  assert.deepEqual(asked, [''], 'opening the list asks the server once for its first choices');
  await page.getByLabel('Search Category').fill('to');
  await until(() => asked.includes('to'));
  await list.getByText('Toys').waitFor();
  assert.equal(await list.getByText('Music').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
