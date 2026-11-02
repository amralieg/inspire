const test = require('node:test');
const assert = require('node:assert/strict');
const { moneyStatements, moneyView } = require('../lib/implementMoney');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: {} };
const BUILT = { spec_version: 2, status: 'ready', spec_json: SPEC, use_case_id: 'N01-U01', job_id: '77' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const SUMMARY = {
  use_case_id: 'N01-U01', run_id: 'r-9', updated_at: '2026-10-20T07:00:00Z', currency: 'USD', decision_basis: 'measured', act_now_amount: '5000',
  review_amount: '1000', act_now_records: '0', review_records: '0', records: '40', value_at_stake: null,
  nothing_to_act: 'No record has 1,000 USD or more at stake, the amount this use case reviews from.',
  value_formula: '{units:number}  units lost x {PRICE:money} a unit x {KEEP:percent} kept', value_expression: 'greatest(0, units * PRICE * KEEP)',
  value_assumptions: JSON.stringify([{ name: 'PRICE', value: 20, kind: 'money' }, { name: 'KEEP', value: 0.5, kind: 'percent' }, { name: 'bad name', value: 1 }]),
  accepted: null,
};
const EDITS = [{ name: 'PRICE', value: '30', changed_by: OWNER, changed_at: '2026-10-23T09:00:00Z', note: 'list price' },
  { name: 'PRICE', value: '25', changed_by: OWNER, changed_at: '2026-10-22T09:00:00Z', note: '' },
  { name: 'GONE', value: '2', changed_by: OWNER, changed_at: '2026-10-22T09:00:00Z', note: '' }];

async function call(base, path) {
  const resp = await fetch(base + path);
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, fn) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await fn(srv.url, made);
  } finally {
    await srv.close();
  }
}

test('the money review reads the formula Genie proposed, each assumption as it stands, and the last run outcome', () => {
  const view = moneyView(SUMMARY, EDITS);
  assert.deepEqual(view.run, {
    run_id: 'r-9', updated_at: '2026-10-20T07:00:00Z', basis: 'measured', currency: 'USD', act_now_amount: 5000, review_amount: 1000, act_now_records: 0,
    review_records: 0, records: 40, value_at_stake: null, accepted: null, preview_sample_entities: null,
    nothing_to_act: 'No record has 1,000 USD or more at stake, the amount this use case reviews from.',
    not_reliable: '', act_now_capacity: null, over_capacity_records: null, impact_kind: '', impact_unit: '', kpi: null,
  });
  assert.equal(view.model.template, '{units:number} units lost x {PRICE:money} a unit x {KEEP:percent} kept');
  assert.deepEqual(view.model.parts, [{ column: 'units', kind: 'number' }, { text: ' units lost x ' }, { assumption: 'PRICE', kind: 'money' },
    { text: ' a unit x ' }, { assumption: 'KEEP', kind: 'percent' }, { text: ' kept' }]);
  assert.deepEqual(view.model.assumptions.map((a) => [a.name, a.kind, a.value, a.run_value, a.changed_by]),
    [['PRICE', 'money', 30, 20, OWNER], ['KEEP', 'percent', 0.5, 0.5, '']], 'the newest App change wins and a bad name is dropped');
  assert.equal(view.model.changed, true);
  assert.deepEqual(view.history.map((h) => [h.name, h.value, h.note]), [['PRICE', 30, 'list price'], ['PRICE', 25, '']], 'a change to a gone assumption is dropped');
  assert.deepEqual(moneyView(null), { run: null, model: null, history: [] });
  const old = moneyView({ ...SUMMARY, value_formula: null, value_assumptions: null, accepted: 'false' }, []);
  assert.equal(old.model, null, 'a run from before the formula was saved has no formula to review');
  assert.equal(old.run.accepted, false);
  assert.equal(old.run.preview_sample_entities, null, 'a summary from before the sample column was added has no sample');
  assert.equal(moneyView({ ...SUMMARY, value_assumptions: 'not json' }).model.assumptions.length, 0);
});

test('the money review carries how many entities a sampled preview trained on, and nothing for a run that trained on all of them', () => {
  assert.equal(moneyView({ ...SUMMARY, accepted: 'true', preview_sample_entities: '20000' }).run.preview_sample_entities, 20000);
  assert.equal(moneyView({ ...SUMMARY, preview_sample_entities: 20000 }).run.preview_sample_entities, 20000);
  for (const none of [null, '', undefined, 'not a number']) {
    assert.equal(moneyView({ ...SUMMARY, preview_sample_entities: none }).run.preview_sample_entities, null, String(none));
  }
});

const UNRELIABLE = "No model passed this use case's acceptance check in the last run.";
const facts = (summary) => {
  const { not_reliable: reason, act_now_capacity: cap, over_capacity_records: over } = moneyView(summary).run;
  return [reason, cap, over];
};

test('the money review carries why a run is not reliable yet and the team capacity, and nothing for a summary from before those columns', () => {
  assert.equal(Object.hasOwn(SUMMARY, 'not_reliable') || Object.hasOwn(SUMMARY, 'act_now_capacity'), false, 'SUMMARY is a row from before the columns');
  assert.deepEqual(facts(SUMMARY), ['', null, null], 'an old summary is reliable and uncapped');
  assert.deepEqual(facts({ ...SUMMARY, not_reliable: `  ${UNRELIABLE} `, act_now_capacity: '50', over_capacity_records: '2950' }), [UNRELIABLE, 50, 2950],
    'the warehouse returns BIGINT columns as text');
  assert.deepEqual(facts({ ...SUMMARY, not_reliable: null, act_now_capacity: 50, over_capacity_records: 0 }), ['', 50, 0], 'a run within its capacity');
  assert.deepEqual(facts({ ...SUMMARY, not_reliable: '', act_now_capacity: null, over_capacity_records: null }), ['', null, null], 'a new run with no cap');
});

test('the Build page says not reliable yet before anything else, and how many more records the team capacity holds in Review', async () => {
  const m = await import(require('node:url').pathToFileURL(require('node:path').resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'moneyReview.js')).href);
  const run = moneyView({ ...SUMMARY, act_now_records: '0', review_records: '0', records: '40' }).run;
  assert.equal(m.nothingToActText({ ...run, not_reliable: UNRELIABLE }), `Not reliable yet: ${UNRELIABLE}`);
  assert.equal(m.nothingToActText({ ...run, not_reliable: UNRELIABLE, act_now_records: 12, records: null }), `Not reliable yet: ${UNRELIABLE}`,
    'never a confident list: not reliable wins over rows to act on and over a run that has not counted its records');
  assert.equal(m.nothingToActText(run), 'Nothing to act on yet, because no record has 1,000 USD or more at stake, the amount this use case reviews from.');
  assert.equal(m.nothingToActText({ ...run, not_reliable: '' }), m.nothingToActText(run), 'a reliable run reads as before');
  assert.equal(m.capacityText({ act_now_capacity: 50, over_capacity_records: 2950 }),
    '2,950 more records would qualify for Act now, but the team capacity of 50 a run holds them in Review.');
  assert.equal(m.capacityText({ act_now_capacity: 50, over_capacity_records: 1 }),
    '1 more record would qualify for Act now, but the team capacity of 50 a run holds it in Review.');
  for (const quiet of [{ act_now_capacity: 50, over_capacity_records: 0 }, { act_now_capacity: null, over_capacity_records: null }, {}, null,
    { act_now_capacity: 0, over_capacity_records: 3 }]) assert.equal(m.capacityText(quiet), '', JSON.stringify(quiet));
});

test('GET money hands the App the not reliable reason and the capacity of the latest run', async () => {
  const row = { ...SUMMARY, not_reliable: UNRELIABLE, act_now_capacity: '50', over_capacity_records: '2950' };
  await withApp({ history: [BUILT], moneySummary: [row], moneyEdits: [] }, async (base) => {
    const got = await call(base, `/api/inspire/implement/money?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual([got.data.run.not_reliable, got.data.run.act_now_capacity, got.data.run.over_capacity_records], [UNRELIABLE, 50, 2950]);
  });
  await withApp({ history: [BUILT], moneySummary: [SUMMARY], moneyEdits: [] }, async (base) => {
    const got = await call(base, `/api/inspire/implement/money?${Q}`);
    assert.deepEqual([got.data.run.not_reliable, got.data.run.act_now_capacity, got.data.run.over_capacity_records], ['', null, null]);
  });
});

test('the money statements read only this use case from the tables next to its result table', () => {
  const s = moneyStatements('main.inspire.churn_out', 'N01-U01');
  assert.equal(s.summary.sql, 'SELECT * FROM `main`.`inspire`.`churn_out_summary` WHERE use_case_id = :uc ORDER BY updated_at DESC NULLS LAST LIMIT 1');
  assert.equal(s.edits.sql, 'SELECT name, value, changed_by, changed_at, note FROM `main`.`inspire`.`churn_out_assumptions` WHERE use_case_id = :uc '
    + 'ORDER BY changed_at DESC LIMIT 50');
  assert.deepEqual(s.summary.parameters, [{ name: 'uc', value: 'N01-U01', type: 'STRING' }]);
  assert.throws(() => moneyStatements('main.out', 'N01-U01'), (e) => e.statusCode === 400 && /must be catalog.schema.table/.test(e.message));
  assert.throws(() => moneyStatements('main.inspire.x`; DROP', 'N01-U01'), (e) => e.statusCode === 400);
});

test('GET money reviews the latest version and treats tables a run has not written yet as empty', async () => {
  await withApp({ history: [BUILT], moneySummary: [SUMMARY], moneyEdits: EDITS }, async (base, made) => {
    const got = await call(base, `/api/inspire/implement/money?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.result_table, 'main.inspire.churn_out');
    assert.equal(got.data.model.assumptions[0].value, 30);
    assert.equal(got.data.run.nothing_to_act, SUMMARY.nothing_to_act);
    const reads = made.sqlCalls.filter((c) => c.sql.includes('churn_out_'));
    assert.deepEqual(reads.map((c) => c.parameters), [[{ name: 'uc', value: 'N01-U01', type: 'STRING' }], [{ name: 'uc', value: 'N01-U01', type: 'STRING' }]]);
  });
  await withApp({ history: [BUILT], sqlErrors: { churn_out_summary: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `churn_out_summary` cannot be found.' } },
    async (base) => {
      const got = await call(base, `/api/inspire/implement/money?${Q}`);
      assert.equal(got.status, 200);
      assert.deepEqual([got.data.run, got.data.model, got.data.history], [null, null, []]);
    });
  await withApp({ history: [BUILT], moneySummary: [{ ...SUMMARY, value_assumptions: null }] }, async (base, made) => {
    await call(base, `/api/inspire/implement/money?${Q}`);
    assert.equal(made.sqlCalls.filter((c) => c.sql.includes('churn_out_assumptions')).length, 0, 'no assumption, no read of their changes');
  });
  await withApp({ history: [{ ...BUILT, spec_json: { ...SPEC, config: { warehouse_id: 'wh1', result_table: '' } } }] }, async (base) => {
    const got = await call(base, `/api/inspire/implement/money?${Q}`);
    assert.deepEqual(got.data, { run: null, model: null, history: [], result_table: '' });
  });
  await withApp({ history: [BUILT], sqlErrors: { churn_out_summary: 'PERMISSION_DENIED: no SELECT' } }, async (base) => {
    const got = await call(base, `/api/inspire/implement/money?${Q}`);
    assert.equal(got.status, 500);
    assert.match(got.data.error, /PERMISSION_DENIED/);
  });
});
