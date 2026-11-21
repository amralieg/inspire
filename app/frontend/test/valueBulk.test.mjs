// REQ-441: the bulk runner. Fake worker with promises the test releases by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VALUE_BULK_WORKERS, runBulk } from '../src/lib/valueBulk.js';

const tick = () => new Promise((r) => setImmediate(r));
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `U${i + 1}` }));
function fake() {
  const open = new Map();
  const worker = (item) => new Promise((resolve, reject) => { open.set(item.id, { resolve, reject }); });
  const finish = async (id, yearly = { total: { unit: 'USD', amount: 100 } }) => { open.get(id).resolve({ yearly }); open.delete(id); await tick(); };
  const fail = async (id, message) => { open.get(id).reject(new Error(message)); open.delete(id); await tick(); };
  return { worker, open, finish, fail };
}
const countOf = (rows, state) => rows.filter((r) => r.state === state).length;

test('the pool is four workers', () => assert.equal(VALUE_BULK_WORKERS, 4));

test('10 items: exactly 4 working at start, never more than 4, the next starts when one ends', async () => {
  const f = fake();
  let latest = [];
  let peak = 0;
  const done = runBulk({ items: ids(10), worker: f.worker, onUpdate: (r) => { latest = r; peak = Math.max(peak, countOf(r, 'working')); } });
  await tick();
  assert.equal(countOf(latest, 'working'), 4);
  assert.equal(f.open.size, 4);
  await f.finish('U1');
  assert.equal(countOf(latest, 'working'), 4);
  assert.equal(latest[0].state, 'done');
  assert.equal(latest[4].state, 'working');
  for (let i = 2; i <= 10; i += 1) await f.finish(`U${i}`);
  const rows = await done;
  assert.equal(countOf(rows, 'done'), 10);
  assert.ok(peak <= 4, `peak ${peak}`);
});

test('one failure leaves the other 9 done', async () => {
  const f = fake();
  const done = runBulk({ items: ids(10), worker: f.worker });
  await tick();
  await f.fail('U2', 'the plan failed');
  for (const id of ['U1', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10']) await f.finish(id);
  const rows = await done;
  assert.equal(countOf(rows, 'done'), 9);
  assert.deepEqual(rows.find((r) => r.state === 'failed'), { id: 'U2', state: 'failed', message: 'the plan failed' });
});

test('FX-28: a 422 is skipped with the server message; a 500 stays failed', async () => {
  const msg = 'The table has no date column ...';
  const worker = (item) => Promise.reject(item.id === 'U1' ? Object.assign(new Error(msg), { status: 422 }) : Object.assign(new Error('down'), { status: 500 }));
  const rows = await runBulk({ items: ids(2), worker });
  assert.deepEqual(rows.find((r) => r.id === 'U1'), { id: 'U1', state: 'skipped', reason: msg });
  assert.deepEqual(rows.find((r) => r.id === 'U2'), { id: 'U2', state: 'failed', message: 'down' });
});

test('Stop after 2 done: the in-flight ones finish, the rest are stopped, nothing new starts', async () => {
  const f = fake();
  const ctl = new AbortController();
  let latest = [];
  const done = runBulk({ items: ids(10), worker: f.worker, signal: ctl.signal, onUpdate: (r) => { latest = r; } });
  await tick();
  await f.finish('U1');
  await f.finish('U2');
  assert.deepEqual([...f.open.keys()].sort(), ['U3', 'U4', 'U5', 'U6']);
  ctl.abort();
  await tick();
  assert.equal(countOf(latest, 'stopped'), 4);
  assert.equal(countOf(latest, 'working'), 4);
  for (const id of ['U3', 'U4', 'U5', 'U6']) await f.finish(id);
  const rows = await done;
  assert.equal(countOf(rows, 'done'), 6);
  assert.equal(countOf(rows, 'stopped'), 4);
  assert.equal(f.open.size, 0);
});

test('skipped items never reach the worker and do not take a slot', async () => {
  const f = fake();
  const items = [{ id: 'S1', skip: 'already has a value' }, ...ids(4), { id: 'S2', skip: 'no table to count' }];
  const done = runBulk({ items, worker: f.worker });
  await tick();
  assert.equal(f.open.size, 4);
  for (let i = 1; i <= 4; i += 1) await f.finish(`U${i}`);
  const rows = await done;
  assert.deepEqual(rows.filter((r) => r.state === 'skipped').map((r) => r.reason), ['already has a value', 'no table to count']);
});

// REQ-443: one copy of the save; the bulk worker and useCalculatedValues.run both use it.
test('saveAnswers PUTs the same route and body useCalculatedValues.run sent, and gives the reply back', async () => {
  const { saveAnswers, ANSWERS_ROUTE } = await import('../src/lib/calculatedValue.js');
  const calls = [];
  const reply = { version: 2, yearly: { total: { unit: 'USD', amount: 5 } } };
  const put = async (route, body) => { calls.push([route, body]); return reply; };
  const answers = { shape: 2, calculated: false };
  const got = await saveAnswers(put, { inspireDatabase: 'main.inspire', warehouseId: 'wh1', sessionId: 42 }, 'N01-U02', 'main.s.orders', answers);
  assert.equal(got, reply);
  assert.deepEqual(calls, [[ANSWERS_ROUTE, { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U02', table: 'main.s.orders', answers }]]);
  await assert.rejects(saveAnswers(async () => ({}), { inspireDatabase: 'd', warehouseId: 'w', sessionId: 1 }, 'U', 't', {}), /no value back/);
});
