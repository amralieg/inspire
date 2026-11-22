const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateOf, totalsOf } = require('../lib/valueEstimate');

const fixed = (amount, currency = 'AED') => ({ app: 'Sales App', money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount, currency } } });

test('a measured use case has no estimate: the measured figure is the figure', () => {
  assert.equal(estimateOf({ measured: true, baseline: 120, rules: [fixed(50)] }), null);
});

test('a fixed-amount rule estimates KPI baseline times the per-record amount, labelled with the App whose rule it is', () => {
  const e = estimateOf({ baseline: 120, rules: [fixed(50)] });
  assert.deepEqual(e, { status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
});

test('with no rule anywhere, no number is shown: the App asks for a money rule', () => {
  assert.deepEqual(estimateOf({ baseline: 120, rules: [] }), { status: 'set_rule' });
  assert.deepEqual(estimateOf({ baseline: 120, rules: [{ app: 'Sales App', money: { currency: 'per_currency' } }] }), { status: 'set_rule' });
});

test('a column or equation rule gives no number: the App says it cannot estimate yet', () => {
  const column = { app: 'Sales App', money: { currency: 'convert', base: 'AED', value: { method: 'column', column: 'amount', currency: 'AED' } } };
  const equation = { app: 'Sales App', money: { currency: 'convert', base: 'AED', value: { method: 'equation', expression: 'a * b', currency: 'AED' } } };
  assert.deepEqual(estimateOf({ baseline: 120, rules: [column] }), { status: 'cannot', app: 'Sales App', method: 'column', borrowed: false });
  assert.deepEqual(estimateOf({ baseline: 120, rules: [equation] }), { status: 'cannot', app: 'Sales App', method: 'equation', borrowed: false });
});

test('no KPI baseline gives no number, even with a rule', () => {
  assert.deepEqual(estimateOf({ baseline: null, rules: [fixed(50)] }), { status: 'no_baseline', app: 'Sales App' });
  assert.deepEqual(estimateOf({ baseline: 0, rules: [fixed(50)] }), { status: 'no_baseline', app: 'Sales App' });
});

test('a use case takes its own App rule first, else the rule of a sibling App in the same domain', () => {
  const own = { app: 'Own App', money: { currency: 'convert', base: 'USD', value: { method: 'fixed', amount: 10, currency: 'USD' } } };
  const sibling = fixed(99);
  assert.equal(estimateOf({ baseline: 2, rules: [own, sibling] }).app, 'Own App');
  assert.equal(estimateOf({ baseline: 2, rules: [{ app: 'No value', money: { currency: 'per_currency' } }, sibling] }).app, 'Sales App');
});

test('a fixed amount with no currency on the value uses the rule base', () => {
  const rule = { app: 'Sales App', money: { currency: 'convert', base: 'USD', value: { method: 'fixed', amount: 10, currency_column: 'cur' } } };
  assert.equal(estimateOf({ baseline: 3, rules: [rule] }).currency, 'USD');
});

test('estimated totals are kept apart per currency and never include a measured figure', () => {
  const totals = totalsOf([estimateOf({ baseline: 120, rules: [fixed(50)] }), estimateOf({ baseline: 1, rules: [fixed(0.5, 'USD')] }),
    { status: 'cannot' }, null, { status: 'set_rule' }, estimateOf({ baseline: 2, rules: [fixed(50)] })]);
  assert.deepEqual(totals, { estimated: { AED: 6100, USD: 0.5 } });
});

const V = require('../lib/valueEstimate');
const ruleSpec = (name, amount, extra = {}) => ({ use_case_name: name, money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount, currency: 'AED' } }, ...extra });

test('the SQL reads the latest spec per use case, with its money rule and result table, and the summary baseline by use case', () => {
  const sql = V.latestSpecsSql('`main`.`inspire`.`__inspire_implement`', '42');
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY use_case_id ORDER BY spec_version DESC\)/);
  assert.match(sql, /WHERE session_id = 42/);
  assert.match(V.baselineSql('`main`.`inspire`.`orders_summary`'), /WHERE use_case_id = :uc ORDER BY updated_at DESC NULLS LAST LIMIT 1$/);
  assert.match(V.useCasesSql('`main`.`inspire`.`__inspire_usecases`', '42'), /SELECT id, business_domain, CAST\(value_estimate AS STRING\) AS value_estimate FROM .* WHERE session_id = 42$/);
});

test('a malformed spec is no spec, never a guessed one', () => {
  assert.equal(V.parseSpec('{not json'), null);
  assert.equal(V.parseSpec('"text"'), null);
  assert.deepEqual(V.parseSpec('{"money":{}}'), { money: {} });
});

test('an unbuilt sibling takes no rule from its domain (FX-48): it is shown "set a rule", and no baseline is read for it', async () => {
  const useCases = [{ id: 'N01-U01', business_domain: 'Sales' }, { id: 'N01-U02', business_domain: 'Sales' }];
  const specs = new Map([['N01-U01', ruleSpec('Sales App', 50, { config: { result_table: 'main.inspire.sales' } })]]);
  const calls = [];
  const out = await V.estimatesFor({ useCases, specs, measured: {}, baselineOf: async (table, id) => { calls.push([table, id]); return 120; } });
  assert.deepEqual(out.use_cases['N01-U01'], { status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
  assert.deepEqual(out.use_cases['N01-U02'], { status: 'set_rule' });
  assert.deepEqual(calls, [['main.inspire.sales', 'N01-U01']], 'the baseline is read only from the use case’s own result table');
  assert.deepEqual(out.totals, { estimated: { AED: 6000 } });
});

test('a measured use case is never estimated, and its baseline is not read', async () => {
  const useCases = [{ id: 'N01-U01', business_domain: 'Sales' }];
  const specs = new Map([['N01-U01', ruleSpec('Sales App', 50, { config: { result_table: 'main.inspire.sales' } })]]);
  let read = 0;
  const out = await V.estimatesFor({ useCases, specs, measured: { 'N01-U01': { measured: true } }, baselineOf: async () => { read += 1; return 1; } });
  assert.equal(out.use_cases['N01-U01'], null);
  assert.equal(read, 0);
  assert.deepEqual(out.totals, { estimated: {} });
});

test('no rule anywhere in the domain: the use case asks for a money rule, with no number and no baseline read', async () => {
  const useCases = [{ id: 'N01-U01', business_domain: 'Sales' }];
  const specs = new Map([['N01-U01', { config: { result_table: 'main.inspire.sales' } }]]);
  let read = 0;
  const out = await V.estimatesFor({ useCases, specs, measured: {}, baselineOf: async () => { read += 1; return 1; } });
  assert.deepEqual(out.use_cases['N01-U01'], { status: 'set_rule' });
  assert.equal(read, 0);
});

test('a sibling in another domain is not a rule source', async () => {
  const useCases = [{ id: 'N01-U01', business_domain: 'Sales' }, { id: 'N02-U01', business_domain: 'Finance' }];
  const specs = new Map([['N02-U01', ruleSpec('Finance App', 50)]]);
  const out = await V.estimatesFor({ useCases, specs, measured: {}, baselineOf: async () => 1 });
  assert.deepEqual(out.use_cases['N01-U01'], { status: 'set_rule' });
});

// FX-48: no estimate borrows a sibling's rule; the borrowed-rule tests of REQ-078 walk defect 4 were removed with the borrowing.
const colRule = (app) => ({ app, money: { currency: 'convert', base: 'AED', value: { method: 'column', column: 'amount', currency: 'AED' } } });
const fixedRule = (app, amount) => ({ app, money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount, currency: 'AED' } } });

test('the own rule wins even when it is a column rule: the borrowed fixed rule is not used on top of it', () => {
  const rules = [{ ...colRule('Own App'), borrowed: false }, { ...fixedRule('Sibling App', 50), borrowed: true }];
  assert.deepEqual(estimateOf({ baseline: 120, rules }), { status: 'cannot', app: 'Own App', method: 'column', borrowed: false });
});

// REQ-078 rc7 walk: Discover measured 6 of 24 use cases from their KPI query, and the value ledger
// holds none of them, so the route answered "set rule" for every card and a rule estimate would have replaced the measured figure.
const measuredJson = JSON.stringify({ status: 'measured', currency: 'USD', text: 'USD 77.1K-231.4K a year' });
const notMeasuredJson = JSON.stringify({ status: 'not measured yet', text: 'Value not measured yet: measure losses caught early.' });

test('a use case Discover measured keeps its measured figure: no rule estimate replaces it, even with no ledger row and no money rule', async () => {
  const useCases = [{ id: 'N02-U01', business_domain: 'Sales', value_estimate: measuredJson }];
  const out = await V.estimatesFor({ useCases, specs: new Map(), measured: {}, baselineOf: async () => 120 });
  assert.equal(out.use_cases['N02-U01'], null);
  assert.deepEqual(out.totals, { estimated: {} });
});

test('live-shaped rc7 session: 6 measured use cases get no estimate, the 18 unmeasured with no money rule say set a rule', async () => {
  const MEASURED_IDS = ['N02-U01', 'N03-U01', 'N03-U02', 'N03-U03', 'N03-U04', 'N06-U04'];
  const ALL_IDS = ['N01-U01', 'N01-U02', 'N01-U03', 'N02-U01', 'N02-U02', 'N02-U03', 'N02-U04', 'N03-U01', 'N03-U02', 'N03-U03', 'N03-U04',
    'N04-U01', 'N04-U02', 'N04-U03', 'N04-U04', 'N04-U05', 'N04-U06', 'N05-U01', 'N05-U02', 'N05-U03', 'N06-U01', 'N06-U02', 'N06-U03', 'N06-U04'];
  const useCases = ALL_IDS.map((id) => ({
    id,
    business_domain: id.slice(0, 3),
    value_estimate: MEASURED_IDS.includes(id) ? measuredJson : notMeasuredJson,
  }));
  const out = await V.estimatesFor({ useCases, specs: new Map(), measured: {}, baselineOf: async () => null });
  for (const id of MEASURED_IDS) assert.equal(out.use_cases[id], null, `${id} is measured`);
  const unmeasured = ALL_IDS.filter((id) => !MEASURED_IDS.includes(id));
  assert.equal(unmeasured.length, 18);
  for (const id of unmeasured) assert.deepEqual(out.use_cases[id], { status: 'set_rule' }, `${id} has no money rule`);
});

test('discoveredMeasured reads Discover status from a JSON string, an object, or nothing, never a guess', () => {
  assert.equal(V.discoveredMeasured({ value_estimate: measuredJson }), true);
  assert.equal(V.discoveredMeasured({ value_estimate: { status: 'measured' } }), true);
  assert.equal(V.discoveredMeasured({ value_estimate: notMeasuredJson }), false);
  assert.equal(V.discoveredMeasured({ value_estimate: '{not json' }), false);
  assert.equal(V.discoveredMeasured({ value_estimate: null }), false);
  assert.equal(V.discoveredMeasured({}), false);
});
