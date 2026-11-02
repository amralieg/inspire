const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { moneyView } = require('../lib/implementMoney');
const FIXTURE = require('./fixtures/kpi_filter_parity.json');

const APP = path.resolve(__dirname, '..', '..');
const lib = (name) => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', name)).href);
const named = (list, name) => list.find((c) => c.name === name);
const STORED = named(FIXTURE.comparisons, 'a stored negative-profit share filtered with = 0').spec;
const RIGHT = named(FIXTURE.comparisons, 'the same share filtered with < 0').spec;
const MISMATCH = named(FIXTURE.comparisons, 'a stored negative-profit share filtered with = 0').problem;

test('every KPI filter reads exactly as the agent builder writes it, typed literals, filters from before operators and refusals included', async () => {
  const F = await lib('kpiFilter.js');
  assert.deepEqual(F.KPI_FILTER_OPERATORS, FIXTURE.operators);
  assert.equal(F.KPI_FILTER_MISMATCH_LEAD, FIXTURE.lead);
  assert.equal(F.KPI_BASELINE_MISMATCH, FIXTURE.mismatch_note);
  assert.ok(FIXTURE.filters.length >= 60);
  assert.ok(FIXTURE.filters.filter((c) => 'error' in c).length >= 15 && FIXTURE.filters.filter((c) => c.text).length >= 40);
  for (const c of FIXTURE.filters) {
    if ('error' in c) {
      assert.throws(() => F.kpiFilterText(c.part), { message: c.error }, c.name);
      assert.deepEqual(F.kpiFilterShown(c.part), { text: '', problem: c.error }, c.name);
    } else {
      assert.equal(F.kpiFilterText(c.part), c.text, c.name);
    }
  }
});

test('a KPI whose name compares is judged against its filter exactly as the agent judges it, and only a computable KPI counts as mismatched', async () => {
  const F = await lib('kpiFilter.js');
  assert.ok(FIXTURE.comparisons.filter((c) => c.problem).length >= 10, 'the cases include KPIs the check must refuse');
  assert.ok(FIXTURE.comparisons.filter((c) => !c.problem).length >= 10, 'and KPIs it must keep');
  for (const c of FIXTURE.comparisons) {
    assert.equal(F.kpiComparisonProblem(c.spec, c.definition, c.distinct), c.problem, c.name);
    assert.equal(F.kpiFilterMismatch(c.spec), c.mismatch, c.name);
  }
  assert.equal(F.isFilterMismatchReason(MISMATCH), true);
  assert.equal(F.isFilterMismatchReason('its query returned no value'), false);
});

test('a state word before over a span compares, a time window, an idiom compound or a two-valued column does not, read exactly as the agent reads them', async () => {
  const F = await lib('kpiFilter.js');
  const of = (prefix) => FIXTURE.comparisons.filter((c) => c.name.startsWith(prefix));
  const state = of('a state word then over a span');
  assert.ok(state.length >= 45 && of('a window or an idiom').length >= 20 && of('a two-valued column').length >= 9);
  for (const c of state) {
    const op = c.spec.filter_op;
    assert.equal(F.kpiComparisonProblem(c.spec), c.problem, c.name);
    assert.equal(Boolean(c.problem), op !== '>', `${c.name}: only a greater-than filter matches over a span`);
  }
  for (const c of of('a window or an idiom')) assert.equal(F.kpiComparisonProblem(c.spec), '', c.name);
  const named = (name) => FIXTURE.comparisons.find((c) => c.name === name);
  for (const [name, refused] of [['dotted capital I in a comparison word', true], ['dotless i in a comparison word', true],
    ['a long s in past due', true], ['a Kelvin sign in a late compound', false], ['a long s does not repeat an s', true],
    ['a dotted capital I repeats an i', false], ['a dotless i does not repeat an i', true], ['a byte order mark is not a space before time', true],
    ['an en dash is not a hyphen', true], ['a late compound glued to a digit', true], ['a repeated compound that does not repeat before one that does', true],
    ['a late compound before a repeated one', false]]) {
    const c = named(name);
    assert.equal(F.kpiComparisonProblem(c.spec, c.definition, c.distinct), c.problem, name);
    assert.equal(Boolean(c.problem), refused, name);
  }
  assert.deepEqual(of('a two-valued column').map((c) => [c.distinct ?? null, Boolean(c.problem)]),
    [[null, true], [2, false], [3, true], [true, false], [false, true], [0, true], [2.5, true], [1, false], ['2', true]]);
});

test('a baseline a refused KPI measured is cleared in every wording the agent clears, and only those', async () => {
  const V = await lib('v130UseCase.js');
  assert.equal(V.KPI_BASELINE_PENDING, FIXTURE.pending_note);
  assert.ok(FIXTURE.scrub.length >= 80 && FIXTURE.scrub.filter((c) => c.out !== c.text).length >= 25 && FIXTURE.scrub.filter((c) => c.out === c.text).length >= 25);
  for (const c of FIXTURE.scrub) assert.equal(V.kpiWithoutStaleBaselines(c.text, c.specs), c.out, JSON.stringify([c.text, c.specs?.[0]?.name]));
  assert.ok(FIXTURE.baseline_shown.length >= 160);
});

test('the KPI line, its shown baseline and the benefits that quote a stale or mismatched baseline read as the agent writes them', async () => {
  const V = await lib('v130UseCase.js');
  const { placeholderWords } = await lib('placeholderWords.js');
  for (const c of FIXTURE.kpi_text) assert.equal(V.kpiText(c.spec), c.text, JSON.stringify(c.spec.name));
  assert.ok(FIXTURE.kpi_text.some((c) => c.text.endsWith(': not measured, because its filter does not match its name')));
  for (const c of FIXTURE.baseline_shown) assert.deepEqual(V.kpiBaselineShown(c.baseline, c.spec), c.shown, JSON.stringify(c));
  for (const c of FIXTURE.stale) assert.deepEqual(V.v130View({ KPIs: c.kpis, 'Financial Benefits': c.items }).financial, c.out.map(placeholderWords), JSON.stringify(c.items));
  const view = V.v130View({ KPIs: [STORED, RIGHT] });
  assert.deepEqual(view.kpis.map((k) => k.baseline), [null, RIGHT.baseline], 'the mismatched KPI shows no baseline, the right one keeps its own');
});

test('the KPI source line shows each filter with the agent builder, on a share, on a single measure and when the filter cannot be read', async () => {
  const V = await lib('v130UseCase.js');
  assert.equal(V.kpiSource(STORED), "count of rows where ws_net_profit = '0' / count of rows, on main.sales.web_sales");
  assert.equal(V.kpiSource(RIGHT), 'count of rows where ws_net_profit < 0 / count of rows, on main.sales.web_sales');
  assert.equal(V.kpiSource({ table: 'main.s.orders', column: 'amount', aggregation: 'SUM', filter_column: 'status', filter_op: '!=', filter_value: 'returned',
    filter_type: 'text' }), "main.s.orders.amount (sum) where status != 'returned'", 'a single measure keeps its filter');
  assert.equal(V.kpiSource({ table: 'main.s.orders', column: 'paid_on', aggregation: 'COUNT_DISTINCT', filter_column: 'paid_on', filter_op: '>=',
    filter_value: '2026-01-01', filter_type: 'date', denominator: { aggregation: 'COUNT', column: null, filter_column: 'is_late', filter_op: '=',
      filter_value: 'TRUE', filter_type: 'boolean' } }),
  "count_distinct of paid_on where paid_on >= DATE '2026-01-01' / count of rows where is_late = TRUE, on main.s.orders");
  assert.equal(V.kpiSource({ table: 'main.s.orders', aggregation: 'COUNT', column: null, filter_column: 'status', filter_op: '<', filter_value: 'b',
    filter_type: 'text', denominator: { aggregation: 'COUNT', column: null } }),
  'count of rows (its filter cannot be read: the KPI filter status < compares a text column; only number and date columns take <, <=, > or >=) '
    + '/ count of rows, on main.s.orders');
  assert.equal(V.kpiSource({ table: 'main.s.orders', column: 'amount', aggregation: 'SUM' }), 'main.s.orders.amount (sum)', 'no filter, no words');
});

test('no App source formats a KPI filter except the one helper the agent text is pinned against', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', 'test', 'fixtures'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(c?js|mjs|jsx)$/.test(entry.name) && entry.name !== 'notebook_bundle.js'
        && /\bfilter_(?:value|column|op|type)\b/.test(fs.readFileSync(full, 'utf8'))) found.push(path.relative(APP, full));
    }
  };
  walk(path.join(APP, 'frontend', 'src'));
  walk(path.join(APP, 'backend'));
  assert.deepEqual(found, [path.join('frontend', 'src', 'lib', 'kpiFilter.js')]);
});

test('value tracking shows a KPI the agent did not measure with its reason and never a number', async () => {
  const V = await lib('v130UseCase.js');
  const lost = { use_case_key: 'loss|c.s.web', title: 'Loss', kpi: STORED.name, baseline: STORED.baseline, current: null, change: 0.4, query: null,
    status: 'not_measured', reason: MISMATCH };
  assert.deepEqual(V.trackedKpiValue(lost), { baseline: null, change: null }, 'a baseline from an older run is never shown for it');
  assert.equal(V.trackedKpiNote(lost), `Not measured: ${MISMATCH}`);
  assert.equal(V.trackedKpiNote({ ...lost, reason: '  ' }), 'Not measured');
  const measured = { ...lost, kpi: RIGHT.name, baseline: RIGHT.baseline, current: { value: 3.1 }, change: 0.12, status: 'measured', reason: undefined };
  assert.deepEqual(V.trackedKpiValue(measured), { baseline: RIGHT.baseline, change: 0.12 });
  assert.equal(V.trackedKpiNote(measured), '');
});

test('a mismatched target KPI shows the reason on its card and never a number, even next to a run that measured it before', async () => {
  const K = await lib('targetKpi.js');
  const record = { name: STORED.name, source: 'inspire', picked_by: 'inspire', kpi_id: null, unit: '%', direction: 'decrease', computable: false, query: null,
    reason: MISMATCH, baseline: null, baseline_on: null, target: 1.5, target_text: 'Cut the share to 1.5 percent', prior_rows: false, spec_version: 4 };
  const before = { kpi: { name: STORED.name, unit: '%', status: 'measured', latest: 0.03, baseline: 0.0285, target: 1.5, target_text: '', reason: '', query: '',
    baseline_on: '2026-10-24', measured_at: '2026-10-25T06:00:00Z' } };
  for (const [label, shown] of [['recorded since prior_rows', record], ['recorded before prior_rows', Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'prior_rows'))]]) {
    const view = K.targetKpiView(shown, before, null);
    assert.equal(view.note, `Not measured: ${MISMATCH}`, label);
    assert.deepEqual([view.baseline, view.latest, view.hasTarget, view.target, view.baselineFlag], ['Not measured', 'Not measured', false, 'Cut the share to 1.5 percent', ''], label);
    assert.equal(K.kpiLine(view), `Target KPI: ${STORED.name}, not measured: ${MISMATCH}.`, label);
  }
  const reported = K.targetKpiView(null, { kpi: { ...before.kpi, status: 'not_measured', latest: null, baseline: 0.0285, reason: MISMATCH } }, null);
  assert.deepEqual([reported.note, reported.baseline, reported.latest], [`Not measured: ${MISMATCH}`, 'Not measured', 'Not measured'], 'a run that reports the mismatch shows no number');
});

test('the card reads a summary row as its KPI only when the agent would: the same query, or a row from before queries only when prior_rows says so', async () => {
  const K = await lib('targetKpi.js');
  const query = 'SELECT SUM(`hours`) AS v FROM `main`.`ops`.`cases`';
  const record = { name: 'Analyst hours', source: 'inspire', picked_by: 'inspire', unit: 'hours', direction: 'increase', computable: true, query, prior_rows: false,
    baseline: null, target: null, target_text: '', spec_version: 3 };
  const row = (extra) => ({ kpi: { name: 'Analyst hours', unit: 'hours', status: 'measured', latest: 1100, baseline: 1500, baseline_on: '2026-09-01', reason: '',
    measured_at: '2026-10-30T06:00:00Z', target: null, target_text: '', ...extra } });
  const hours = K.impactOf({ impact_kind: 'hours', impact_unit: 'hours' });
  const seen = (rec, run) => {
    const view = K.targetKpiView(rec, run, hours);
    return [view.status, view.latest, view.baseline];
  };
  assert.deepEqual(seen(record, row({ query: `  ${query.replace(' AS ', '  AS ')} ` })), ['measured', '1,100 hours', '1,500 hours'], 'the same query, spaced as the agent writes it');
  assert.deepEqual(seen(record, row({ query: `${query} WHERE x = 1` })), ['pending', 'Not measured', 'Not measured'], 'another query is another KPI');
  assert.deepEqual(seen(record, row({ query: '' })), ['pending', 'Not measured', 'Not measured'], 'a row from before queries is not this KPI unless prior_rows says so');
  assert.deepEqual(seen({ ...record, prior_rows: true }, row({ query: '' })), ['measured', '1,100 hours', '1,500 hours'], 'prior_rows keeps the first value');
  assert.deepEqual(seen({ ...record, prior_rows: true }, row({ query: '', unit: 'minutes' })), ['pending', 'Not measured', 'Not measured'], 'another unit is another KPI');
  assert.deepEqual(seen({ ...record, computable: false, query: null, reason: 'it is tracked as text' }, row({ query: '', status: 'not_measured', latest: null })).slice(0, 2),
    ['not_measured', 'Not measured'], 'a row of a KPI with no query is its own not measured row');
  const legacy = Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'prior_rows'));
  assert.deepEqual(seen(legacy, row({ query: '' })), ['measured', '1,100 hours', '1,500 hours'], 'a version built before prior_rows reads the row by name as before');
  assert.equal(K.summaryRowIsKpi(record, null), false);
  const other = K.targetKpiView({ ...record, computable: false, query: null, reason: 'Inspire cannot build its query: no table' }, row({ query }), hours);
  assert.equal(other.note, 'Not measured: Inspire cannot build its query: no table', 'a KPI with no query says why even beside a run of another query');
});

test('the summary row hands the card the query the agent wrote, spaced as the agent spaces it', () => {
  const { run } = moneyView({ use_case_id: 'N01-U01', kpi_name: 'Analyst hours', kpi_status: 'measured', kpi_latest: '1100', kpi_query: '  SELECT  1  AS v ' }, []);
  assert.equal(run.kpi.query, 'SELECT 1 AS v');
  assert.equal(moneyView({ use_case_id: 'N01-U01', kpi_name: 'Analyst hours' }, []).run.kpi.query, '', 'a row written before kpi_query has none');
});
