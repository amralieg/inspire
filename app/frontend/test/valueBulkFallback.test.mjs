// REQ-448 (D3): the bulk runner saves no estimate when no model planned the use case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { valueWorker } from '../src/lib/valueBulk.js';

const plan = (model) => ({ case_noun: 'record', case_filter: null, groupings: [], grouping: '', metrics: [], model, model_reason: 'x', table: 'main.s.t', date_column: 'd', days: 365,
  groups: [{ g: 'Other', records_per_year: 1000, metrics: {} }],
  drivers: [{ id: 'time_saved', label: 'Time saved', verb: 'REDUCE COST', on: false, why: '', asks: [{ id: 'people', label: 'People', kind: 'count', source: 'estimate', default: 1, why: '' }] }] });
const run = (model) => {
  const saves = [];
  const worker = valueWorker({ apiPostJson: async () => ({ plan: plan(model) }), inspireDatabase: 'c.s', warehouseId: 'w', sessionId: 1, save: async (id, table, answers) => { saves.push({ id, table, answers }); return { yearly: {} }; } });
  return { saves, call: () => worker({ id: 'N01-U01', table: 'main.s.t' }) };
};

test('a plan with no model is not saved: the worker rejects with a 422 that names the cause', async () => {
  const { saves, call } = run(null);
  await assert.rejects(call, (err) => err.status === 422 && /could not reach a model/.test(err.message));
  assert.equal(saves.length, 0);
});

test('a plan a model made is saved once', async () => {
  const { saves, call } = run('chat-1');
  await call();
  assert.equal(saves.length, 1);
});
