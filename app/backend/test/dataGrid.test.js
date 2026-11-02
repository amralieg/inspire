const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'dataGrid.js')).href;

function memory() {
  const kept = new Map();
  return { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), kept };
}

test('a column takes the kind of its values: numbers, days or text, and a column may name its own kind', async () => {
  const G = await import(libUrl);
  const rows = [{ n: '1,250', d: '2026-10-01', t: 'Retail', m: 4 }, { n: '7.5%', d: '2026-09-30T10:00:00Z', t: '12', m: '' }, { n: null, d: '', t: '', m: 'x' }];
  assert.equal(G.columnKind({ key: 'n' }, rows), 'number');
  assert.equal(G.columnKind({ key: 'd' }, rows), 'date');
  assert.equal(G.columnKind({ key: 't' }, rows), 'text');
  assert.equal(G.columnKind({ key: 'm' }, rows), 'text', 'one word among numbers makes the column text');
  assert.equal(G.columnKind({ key: 'm', kind: 'number' }, rows), 'number');
  assert.equal(G.columnKind({ key: 'none' }, rows), 'text');
  assert.equal(G.numberOf('1,250'), 1250);
  assert.equal(G.numberOf('Ultra High'), null);
  assert.equal(G.numberOf('12-3'), null);
  assert.equal(G.numberOf(Infinity), null);
  assert.equal(G.dayOf(new Date(Date.UTC(2026, 0, 2))), '2026-01-02');
  assert.equal(G.dayOf('Jan 2'), '');
});

test('sorting orders numbers by value, days by date and text by words with numbers in them, keeps blanks last both ways and ties in their first order', async () => {
  const G = await import(libUrl);
  const rows = [{ id: 'a', v: '10' }, { id: 'b', v: '9' }, { id: 'c', v: '' }, { id: 'd', v: '9' }, { id: 'e', v: '100' }];
  const ids = (list) => list.map((r) => r.id).join('');
  assert.equal(ids(G.sortRows(rows, { key: 'v' }, 1, 'number')), 'bdaec');
  assert.equal(ids(G.sortRows(rows, { key: 'v' }, -1, 'number')), 'eabdc');
  assert.equal(ids(G.sortRows(rows, { key: 'v' }, 1, 'text')), 'bdaec', 'text sorts the numbers in it by value too');
  const days = [{ id: 'x', v: '2026-10-02' }, { id: 'y', v: '2025-12-31' }];
  assert.equal(ids(G.sortRows(days, { key: 'v' }, 1, 'date')), 'yx');
  assert.equal(G.sortRows(rows, { key: 'v' }, 0, 'number'), rows, 'no direction keeps the rows as given');
  assert.deepEqual(G.nextSort(null, 'v', 'number'), { key: 'v', dir: -1 }, 'a number column sorts biggest first');
  assert.deepEqual(G.nextSort({ key: 'v', dir: -1 }, 'v', 'number'), { key: 'v', dir: 1 });
  assert.equal(G.nextSort({ key: 'v', dir: 1 }, 'v', 'number'), null, 'a third click goes back to the first order');
  assert.deepEqual(G.nextSort({ key: 'v', dir: -1 }, 't', 'text'), { key: 't', dir: 1 }, 'a text column sorts A to Z first');
});

test('each filter kind keeps only matching rows, a blank value fails an active filter, and a fixed or turned off column never filters', async () => {
  const G = await import(libUrl);
  const columns = [{ key: 'name' }, { key: 'score' }, { key: 'day' }, { key: '#', fixed: true }, { key: 'note', filter: false }];
  const rows = [
    { name: 'Churn', score: '4.5', day: '2026-10-01', '#': 1, note: 'x' },
    { name: 'Upsell', score: '2', day: '2026-09-01', '#': 2, note: 'y' },
    { name: '', score: '', day: '', '#': 3, note: 'z' },
  ];
  const kinds = { name: 'text', score: 'number', day: 'date', '#': 'number', note: 'text' };
  const names = (filters) => G.filterRows(rows, columns, kinds, filters).map((r) => r['#']);
  assert.deepEqual(names({}), [1, 2, 3]);
  assert.deepEqual(names({ name: { values: ['Upsell'] } }), [2]);
  assert.deepEqual(names({ name: { values: [] } }), [1, 2, 3], 'an empty choice list filters nothing');
  assert.deepEqual(names({ score: { min: '3' } }), [1]);
  assert.deepEqual(names({ score: { max: '3' } }), [2]);
  assert.deepEqual(names({ score: { min: '2', max: '4.5' } }), [1, 2]);
  assert.deepEqual(names({ day: { from: '2026-09-15' } }), [1]);
  assert.deepEqual(names({ day: { to: '2026-09-15' } }), [2]);
  assert.deepEqual(names({ name: { values: ['Churn', 'Upsell'] }, score: { max: '3' } }), [2], 'every active filter must hold');
  assert.deepEqual(names({ '#': { min: '2' } }), [1, 2, 3], 'a fixed column never filters');
  assert.deepEqual(names({ note: { values: ['x'] } }), [1, 2, 3], 'a turned off column never filters');
  assert.equal(G.filtersOn({ name: { values: ['a'] }, score: { min: '' }, day: { to: '2026-01-01' } }), 2);
  assert.deepEqual(G.toggleChoice({ values: ['a'] }, 'a'), { values: [] });
  assert.deepEqual(G.toggleChoice(undefined, 'b'), { values: ['b'] });
  assert.equal(G.filterText({ key: 'score', label: 'Score' }, 'number', { min: '1', max: '3' }), 'Score from 1 to 3');
  assert.equal(G.filterText({ key: 'day', label: 'Day' }, 'date', { to: '2026-01-01' }), 'Day up to 2026-01-01');
  assert.equal(G.filterText({ key: 'name', label: 'Name' }, 'text', { values: ['a', 'b'] }), 'Name is one of 2 values');
});

test('choice lists are distinct, sorted, bounded and searched as you type, and say when they show only part', async () => {
  const G = await import(libUrl);
  const rows = Array.from({ length: 450 }, (_, i) => ({ v: `Item ${i % 300}` }));
  const all = G.choicesOf(rows, { key: 'v' });
  assert.equal(all.length, 300);
  assert.deepEqual(all.slice(0, 3), ['Item 0', 'Item 1', 'Item 2']);
  assert.equal(all[10], 'Item 10', 'numbers inside the words sort by value');
  const wide = G.narrowChoices(all, '');
  assert.equal(wide.shown.length, G.CHOICES_SHOWN);
  assert.equal(wide.count, 300);
  assert.equal(G.choicesHint(wide.count), `Showing ${G.CHOICES_SHOWN} of 300 choices. Type to narrow them.`);
  const typed = G.narrowChoices(all, 'item 29');
  assert.deepEqual(typed.shown, ['Item 29', 'Item 290', 'Item 291', 'Item 292', 'Item 293', 'Item 294', 'Item 295', 'Item 296', 'Item 297', 'Item 298', 'Item 299']);
  assert.equal(G.choicesHint(typed.count), '');
});

test('a saved order keeps fixed columns in place, drops a column that is gone and puts a new column beside its first neighbour', async () => {
  const G = await import(libUrl);
  const columns = [{ key: '#', fixed: true }, { key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'act', fixed: true }];
  const natural = G.movableKeys(columns);
  assert.deepEqual(natural, ['a', 'b', 'c']);
  assert.deepEqual(G.savedOrder(natural, ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(G.savedOrder(natural, ['c', 'gone', 'a']), ['c', 'a', 'b'], 'b comes back after a, its neighbour before it');
  assert.deepEqual(G.savedOrder(['n', 'a', 'b'], ['b', 'a']), ['n', 'b', 'a'], 'a new first column goes first');
  assert.deepEqual(G.savedOrder(natural, ['gone']), natural);
  assert.deepEqual(G.savedOrder(natural, 'junk'), natural);
  assert.deepEqual(G.orderColumns(columns, ['c', 'a', 'b']).map((c) => c.key), ['#', 'c', 'a', 'b', 'act']);
  assert.deepEqual(G.moveKey(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(G.moveKey(['a', 'b', 'c'], 'c', -4), ['c', 'a', 'b']);
  assert.deepEqual(G.moveKey(['a', 'b'], 'z', 0), ['a', 'b']);
});

test('the column order is kept per table, the newest last, bounded in tables, keys and length, and saving none forgets it', async () => {
  const G = await import(libUrl);
  const store = memory();
  assert.equal(G.loadColumnOrder('t1', store), null);
  assert.equal(G.saveColumnOrder('t1', ['b', 'a', 'b', '', 5], store), true);
  assert.deepEqual(G.loadColumnOrder('t1', store), ['b', 'a']);
  G.saveColumnOrder('t2', ['x'], store);
  G.saveColumnOrder('t1', ['a', 'b'], store);
  assert.deepEqual(Object.keys(JSON.parse(store.kept.get(G.GRID_ORDER_KEY))), ['t2', 't1'], 'the last saved table is the newest');
  G.saveColumnOrder('t1', null, store);
  assert.equal(G.loadColumnOrder('t1', store), null);
  for (let i = 0; i < G.GRID_CAPS.grids + 20; i += 1) G.saveColumnOrder(`g${i}`, ['k'], store);
  const kept = JSON.parse(store.kept.get(G.GRID_ORDER_KEY));
  assert.equal(Object.keys(kept).length, G.GRID_CAPS.grids);
  assert.equal(kept.g0, undefined, 'the oldest tables are dropped first');
  G.saveColumnOrder('big', Array.from({ length: 150 }, (_, i) => `k${i}`), store);
  assert.equal(G.loadColumnOrder('big', store).length, G.GRID_CAPS.keys);
  assert.equal(G.saveColumnOrder('x'.repeat(G.GRID_CAPS.chars + 1), ['a'], store), false);
  store.setItem(G.GRID_ORDER_KEY, '{not json');
  assert.equal(G.loadColumnOrder('t2', store), null, 'a broken store reads as nothing saved');
  assert.equal(G.saveColumnOrder('t3', ['a'], { getItem: () => null, setItem: () => { throw new Error('full'); } }), false);
});
