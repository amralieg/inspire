// REQ-436/437: the AI case plan (validated against the table), its fallback, and the per-group value maths.
const test = require('node:test');
const assert = require('node:assert/strict');
const VCP = require('../lib/valueCasePlan');
const DEF = require('../lib/valueDrivers.json');

const COLUMNS = [
  { column_name: 'region', data_type: 'STRING' }, { column_name: 'status', data_type: 'STRING' },
  { column_name: 'avg_amount', data_type: 'DOUBLE' }, { column_name: 'event_date', data_type: 'DATE' },
];
const reply = (obj) => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });
const kindOf = (driverId, askId) => DEF.drivers.find((d) => d.id === driverId).inputs.find((i) => i.id === askId).kind;

test('a valid model JSON becomes a plan whose asks are all valid; unknown column, driver and ask are dropped', () => {
  const plan = VCP.planFrom(reply({
    case_noun: 'Fraud Case',
    case_filter: { column: 'status', op: '=', value: 'open' },
    groupings: [{ column: 'region', label: 'By region' }, { column: 'nope', label: 'By nothing' }],
    metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }, { id: 'bad', label: 'Bad', column: 'ghost', agg: 'avg' }],
    drivers: [
      { id: 'risk_avoided', label: 'Fraud avoided', on: true, why: 'fewer losses', asks: [
        { id: 'incidents_per_year', source: 'data', metric: 'records' },
        { id: 'cost_per_incident', source: 'data', metric: 'avg_amount' },
        { id: 'reduction_pct', source: 'estimate', default: 30, why: 'a guess' },
        { id: 'made_up_ask', source: 'estimate', default: 5, why: 'x' },
        { id: 'cost_per_incident', source: 'data', metric: 'ghost' }] },
      { id: 'not_a_driver', label: 'x', on: true, asks: [] }],
  }), COLUMNS);
  assert.equal(plan.case_noun, 'fraud case');
  assert.deepEqual(plan.case_filter, { column: 'status', op: '=', value: 'open' });
  assert.deepEqual(plan.groupings.map((g) => g.column), ['region']);
  assert.equal(plan.grouping, 'region');
  assert.deepEqual(plan.metrics.map((m) => m.id), ['avg_amount']);
  assert.ok(!plan.drivers.some((d) => d.id === 'not_a_driver'));
  for (const d of plan.drivers) {
    const def = DEF.drivers.find((x) => x.id === d.id);
    assert.ok(def, d.id);
    for (const a of d.asks) {
      assert.ok(def.inputs.some((i) => i.id === a.id), `ask ${a.id}`);
      assert.equal(a.kind, kindOf(d.id, a.id));
      if (a.source === 'data') assert.ok(a.metric === 'records' || plan.metrics.some((m) => m.id === a.metric), `metric ${a.metric}`);
      else assert.ok(Number.isFinite(a.default));
    }
  }
  const risk = plan.drivers.find((d) => d.id === 'risk_avoided');
  assert.equal(risk.label, 'Fraud avoided');
  assert.equal(risk.on, true);
  assert.deepEqual(risk.asks.map((a) => a.id), ['incidents_per_year', 'cost_per_incident', 'reduction_pct']);
  assert.equal(risk.asks[1].metric, 'avg_amount', 'the ask with an unknown metric did not replace the valid one');
});

test('invalid JSON, or no endpoint, gives the fallback plan with model null and incidents/events mapped to records', () => {
  for (const plan of [VCP.planFrom(reply('not json at all'), COLUMNS), VCP.fallbackPlan(COLUMNS)]) {
    assert.equal(plan.model, null);
    assert.deepEqual(plan.drivers.map((d) => d.id), DEF.drivers.map((d) => d.id));
    const asks = plan.drivers.flatMap((d) => d.asks.map((a) => ({ ...a, driver: d.id })));
    for (const a of asks) {
      if (['incidents_per_year', 'events_per_year'].includes(a.id)) assert.deepEqual([a.source, a.metric], ['data', 'records'], a.id);
      else assert.equal(a.source, 'estimate', a.id);
    }
    assert.equal(asks.length, DEF.drivers.reduce((n, d) => n + d.inputs.length, 0));
  }
});

// Two groups: records 1000 and 3000, average amount 10 and 20.
const PLAN = {
  case_noun: 'fraud case', table: 'main.s.orders', date_column: 'event_date', days: 365, grouping: 'region',
  groupings: [{ column: 'region', label: 'By region' }],
  groups: [{ g: 'north', records_per_year: 1000, metrics: { avg_amount: 10 } }, { g: 'south', records_per_year: 3000, metrics: { avg_amount: 20 } }],
  metrics: [{ id: 'avg_amount', label: 'Average amount', column: 'avg_amount', agg: 'avg' }],
  drivers: [
    { id: 'risk_avoided', label: 'Fraud avoided', verb: 'AVOID RISK', on: true, why: '', asks: [
      { id: 'incidents_per_year', label: 'Incidents', kind: 'count', source: 'data', metric: 'records' },
      { id: 'cost_per_incident', label: 'Cost', kind: 'money', source: 'data', metric: 'avg_amount' },
      { id: 'reduction_pct', label: 'Prevented', kind: 'pct', source: 'estimate', default: 30, why: '' }] },
    { id: 'productivity', label: 'Productivity', verb: 'REDUCE COST', on: false, why: '', asks: [
      { id: 'headcount', label: 'People', kind: 'count', source: 'estimate', default: 5, why: '' },
      { id: 'cost_per_person_year', label: 'Cost', kind: 'money', source: 'estimate', default: 1000, why: '' },
      { id: 'gain_pct', label: 'Gain', kind: 'pct', source: 'estimate', default: 1, why: '' }] },
  ],
};
const ANSWERS = {
  shape: 2, currency: 'USD', attribution_pct: 100, grouping: 'region', excluded_groups: [], calculated: true,
  drivers: { risk_avoided: { on: true, inputs: { reduction_pct: 50 } }, productivity: { on: false, inputs: { headcount: 10, cost_per_person_year: 100000, gain_pct: 10 } } },
};
const withAnswers = (patch) => ({ ...ANSWERS, ...patch });
const clone = (x) => JSON.parse(JSON.stringify(x));

test('per-group maths: 35,000 for two groups; 5,000 when the second is excluded; attribution halves it', () => {
  const all = VCP.yearlyOf(PLAN, ANSWERS);
  assert.equal(all.errors, undefined);
  assert.equal(all.yearly.total.amount, 35000);
  assert.equal(all.yearly.total.unit, 'USD');
  assert.deepEqual(all.yearly.groups, { grouping_label: 'By region', covered: 2, of: 2 });
  assert.equal(all.yearly.verb, 'AVOID RISK');
  assert.equal(all.yearly.calculated, true);
  assert.equal(all.yearly.estimated, false);
  const part = all.yearly.parts.find((p) => p.id === 'risk_avoided');
  assert.equal(part.per_group, true);
  assert.deepEqual(part.inputs.map((i) => [i.id, i.source, i.value]), [['incidents_per_year', 'data', 4000], ['cost_per_incident', 'data', 17.5], ['reduction_pct', 'estimate', 50]]);
  const one = VCP.yearlyOf(PLAN, withAnswers({ excluded_groups: ['south'] }));
  assert.equal(one.yearly.total.amount, 5000);
  assert.deepEqual([one.yearly.groups.covered, one.yearly.groups.of], [1, 2]);
  assert.equal(VCP.yearlyOf(PLAN, withAnswers({ attribution_pct: 50 })).yearly.total.amount, 17500);
  assert.equal(VCP.yearlyOf(PLAN, withAnswers({ calculated: false })).yearly.estimated, true);
});

test('a driver with no data ask is counted once, not once per group', () => {
  const on = clone(ANSWERS);
  on.drivers.risk_avoided.on = false;
  on.drivers.productivity.on = true;
  const got = VCP.yearlyOf(PLAN, on);
  assert.equal(got.yearly.total.amount, 100000);
  assert.equal(got.yearly.parts.find((p) => p.id === 'productivity').per_group, false);
});

test('a pct over 100 or a negative number is an error for that driver id', () => {
  const over = clone(ANSWERS);
  over.drivers.risk_avoided.inputs.reduction_pct = 120;
  assert.ok(VCP.yearlyOf(PLAN, over).errors.risk_avoided);
  const negative = clone(ANSWERS);
  negative.drivers.productivity.on = true;
  negative.drivers.productivity.inputs.headcount = -3;
  const got = VCP.yearlyOf(PLAN, negative);
  assert.ok(got.errors.productivity);
  assert.equal(got.errors.risk_avoided, undefined);
  assert.equal(got.yearly, undefined);
});
