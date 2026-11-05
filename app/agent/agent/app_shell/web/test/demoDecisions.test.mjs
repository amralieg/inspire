import test from 'node:test';
import assert from 'node:assert/strict';

const stores = new Map();
const sessionStorage = {
  getItem: (k) => (stores.has(k) ? stores.get(k) : null),
  setItem: (k, v) => stores.set(k, String(v)),
};
globalThis.window = { sessionStorage };
globalThis.location = { pathname: '/showcase/kinds-retail/mvp/plan/' };
let answer = null;
const posted = [];
globalThis.fetch = async (url, init) => {
  posted.push([url, JSON.parse(init.body || 'null')]);
  const body = answer(url);
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
};

const { decidePlan, demoDecided, getRecords } = await import('../src/api.js');

const ROWS = [{ record_key: 'A', _inspire_version: '1' }, { record_key: 'B', _inspire_version: '1' }, { record_key: 'C', _inspire_version: '1' }];
const SUMMARY = { open: 5, done: 0, resolved: 0, left: 0, owners: [] };
const listed = (filters = {}, rows = ROWS) => { answer = () => ({ rows: rows.map((r) => ({ ...r })), total: 5, summary: { ...SUMMARY }, actions: true }); return getRecords({ page: 'plan', filters }); };
const decide = (key, row) => { answer = () => ({ showcase: true, saved: false, note: 'demo', row }); return decidePlan({ page: 'plan', record_key: key, decision: 'accept', recommended: 1 }); };

test('a demo plan decision is kept in this browser session per page and shows on every later read of the list, so a decided line is not offered again', async () => {
  assert.deepEqual((await listed()).rows.map((r) => r._inspire_status), [undefined, undefined, undefined]);
  await decide('A', { _inspire_status: 'Done', _inspire_closed_note: 'Accepted the recommended 1' });
  await decide('C', { _inspire_status: 'Done', _inspire_closed_note: 'Override to 4 instead of 1: event week' });
  const after = (await listed()).rows;
  assert.deepEqual(after.map((r) => r._inspire_status), ['Done', undefined, 'Done']);
  assert.equal(after[2]._inspire_closed_note, 'Override to 4 instead of 1: event week');
  assert.deepEqual(Object.keys(demoDecided('plan')).sort(), ['A', 'C']);
  assert.deepEqual([(await listed()).summary.open, (await listed()).summary.done], [3, 2], 'the waiting counter counts the decided lines as done');
  assert.deepEqual([(await listed({}, ROWS.slice(1, 2))).summary.open], [3], 'a line decided outside the shown window still leaves the whole list');
  assert.deepEqual([(await listed({ category: ['X'] }, ROWS.slice(1, 2))).summary.open], [5], 'a filtered list counts only the decided lines it shows (must-exclude)');
  assert.deepEqual([(await listed({ category: [] }, ROWS.slice(1, 2))).summary.open], [3], 'an empty filter is no filter');
  assert.deepEqual(demoDecided('other'), {}, 'another page keeps its own decisions');
  assert.deepEqual([...stores.keys()], ['inspire-demo-decisions:/showcase/kinds-retail/mvp/plan/:plan'], 'the store is keyed by the hosted MVP and the page');
});

test('a real decision, saved by the App, is never kept in the browser: the list it reads is the one the server sends', async () => {
  stores.clear();
  answer = () => ({ written: ['B'], conflicts: [] });
  await decidePlan({ page: 'plan', record_key: 'B', decision: 'accept', recommended: 1 });
  answer = () => ({ showcase: true, saved: true, row: { _inspire_status: 'Done' } });
  await decidePlan({ page: 'plan', record_key: 'B', decision: 'accept', recommended: 1 });
  assert.equal(stores.size, 0);
  assert.deepEqual((await listed()).rows.map((r) => r._inspire_status), [undefined, undefined, undefined]);
});

test('a browser that refuses storage still decides: the demo answer comes back and nothing breaks', async () => {
  globalThis.window = { get sessionStorage() { throw new Error('blocked'); } };
  const got = await decide('A', { _inspire_status: 'Done' });
  assert.equal(got.showcase, true);
  assert.deepEqual(demoDecided('plan'), {});
  assert.equal((await listed()).rows.length, 3);
  globalThis.window = { sessionStorage };
});
