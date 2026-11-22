// REQ-480 (FX-75): when a run's values are saved, the whole-run review route is called once; a run with nothing done calls it never; its failure never fails the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_REVIEW_ROUTE, runBulk, valueWorker } from '../../src/lib/valueBulk.js';
import { PLAN } from './valueWizardSupport.mjs';

const where = { inspireDatabase: 'main.inspire', warehouseId: 'wh', sessionId: 1001 };
const makeWorker = (calls, failReview = false) => valueWorker({ ...where, save: async (id) => ({ yearly: { total: { unit: 'USD', amount: 1000000 }, calculated: true, id } }),
  apiPostJson: async (route, body) => {
    calls.push({ route, body });
    if (route === RUN_REVIEW_ROUTE && failReview) throw new Error('model down');
    return { plan: PLAN };
  } });

test('the run review is posted once, after every use case of the run is saved', async () => {
  const calls = [];
  const worker = makeWorker(calls);
  await runBulk({ items: [{ id: 'A', table: 't.a' }, { id: 'B', table: 't.b' }], worker, afterRun: worker.afterRun });
  const reviews = calls.filter((c) => c.route === RUN_REVIEW_ROUTE);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].body.session_id, '1001');
  assert.equal(calls.at(-1).route, RUN_REVIEW_ROUTE, 'it is the last call');
});

test('a run with nothing done does not ask for a review, and a failing review does not fail the run', async () => {
  const calls = [];
  const none = makeWorker(calls);
  await runBulk({ items: [{ id: 'A', skip: 'already calculated' }], worker: none, afterRun: none.afterRun });
  assert.equal(calls.filter((c) => c.route === RUN_REVIEW_ROUTE).length, 0);
  const bad = makeWorker(calls, true);
  const rows = await runBulk({ items: [{ id: 'A', table: 't.a' }], worker: bad, afterRun: bad.afterRun });
  assert.equal(rows[0].state, 'done');
});

test('the build-next money text caps at 20M+ through the one helper', async () => {
  const { moneyText } = await import('../../src/lib/buildNext.js');
  assert.equal(moneyText({ currency: 'USD', amount: 25000000 }), '$20M+');
  assert.equal(moneyText({ currency: 'USD', amount: 1500000 }), 'USD 1.5M');
});
