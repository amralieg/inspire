const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { moneyView } = require('../lib/implementMoney');
const { makeApp, listen } = require('./support/implementApp');
const { agentProbe, pythonReady } = require('./support/agentProbe');
const FIXTURE = require('../../agent/tests/fixtures/implement_change_classes.json');

const AGENT_NOTEBOOK = process.env.INSPIRE_AGENT_NOTEBOOK || path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');
const KPI_PROBE = String.raw`
out = {"choice": [ns["implement_kpi_choice"](spec) for spec in cases["choices"]],
       "picked": [ns["implement_pick_kpi"]([{"name": name} for name in options], target)[1] for target, options in cases["picks"]]}
print(json.dumps(out))
`;

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const OWNER = ['owner', 'example.com'].join('@');
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const KPIS = [
  { name: 'Churn rate', direction: 'decrease', unit: '%', kpi_id: 'K1', computable: true },
  { name: 'Hours  saved', direction: 'increase', unit: 'hours' },
];
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n', kpis: JSON.stringify(KPIS) };
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
};
const EMOJI = '\u{1F600}';

function clean(top = {}) {
  const out = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), ...top });
  assert.deepEqual(out.errors, [], JSON.stringify(top));
  return out.spec;
}

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function post(base, url, body) {
  const resp = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER }, body: JSON.stringify(body) });
  return { status: resp.status, data: await resp.json() };
}

const inserts = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

const evaluatedRow = (version, status = 'ready') => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, created_by: OWNER, updated_at: `2026-10-2${version}T04:00:00Z`,
  spec_json: JSON.stringify(clean()),
  asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: version },
    target_kpi: { name: 'Late deliveries', source: 'evaluated', picked_by: 'inspire', options: ['Late deliveries', 'Hours lost'],
      evaluated: [{ name: 'Late deliveries', unit: 'deliveries' }, { name: 'Hours lost', unit: 'hours' }] } }),
});

const TARGET_CASES = [
  ['no target lets Inspire pick', '', ['Churn rate', 'Hours saved'], true],
  ['an exact name', 'Churn rate', ['Churn rate', 'Hours saved'], true],
  ['a name in another case with extra spaces', '  churn   RATE ', ['Churn rate', 'Hours saved'], true],
  ['a name stored with two spaces matches one space', 'Hours saved', ['Churn rate', 'Hours  saved'], true],
  ['a case folded name', 'STRASSE COUNT', ['Straße count'], true],
  ['a name that is not listed', 'Revenue', ['Churn rate', 'Hours saved'], false],
  ['a prefix of a listed name', 'Churn', ['Churn rate', 'Hours saved'], false],
  ['any name when the use case has no KPI yet', 'Churn rate', [], false],
  ['201 characters', 'k'.repeat(201), ['k'.repeat(201)], false],
  ['200 emoji, a listed name', EMOJI.repeat(200), [EMOJI.repeat(200)], true],
  ['201 emoji', EMOJI.repeat(201), [EMOJI.repeat(201)], false],
];

test('the validator keeps the target KPI the way the agent does, and the change classes and plans match the shared fixture', () => {
  const kept = I.validateImplementSpec({ ...BASE, kpi: { target: '  Hours   saved  ', tracked: 'Hours saved', source: 'inspire' } });
  assert.deepEqual(kept.errors, []);
  assert.deepEqual(kept.spec.kpi, { target: 'Hours   saved' }, 'trimmed like every text field, inner spaces kept, the fields the agent records dropped');
  assert.equal(I.IMPLEMENT_KPI_TARGET_MAX, 200);
  assert.equal([...I.validateImplementSpec({ ...BASE, kpi: { target: EMOJI.repeat(205) } }).spec.kpi.target].length, 200, 'clipped by characters, as the agent clips');
  assert.deepEqual(I.validateImplementSpec({ ...BASE, kpi: { target: 5 } }).errors, ['kpi.target must be text, not 5']);
  assert.deepEqual(I.validateImplementSpec({ ...BASE, kpi: 'Hours saved' }).errors, ['kpi must be an object']);
  assert.equal(Object.hasOwn(I.validateImplementSpec(BASE).spec, 'kpi'), false, 'a spec that sends no kpi keeps none');
  const kpiCases = FIXTURE.cases.filter((c) => c.name.startsWith('target KPI'));
  assert.equal(kpiCases.length, 6);
  for (const c of kpiCases) {
    const previous = c.previous ? I.validateImplementSpec(c.previous).spec : null;
    assert.deepEqual(I.classifyImplementChange(previous, I.validateImplementSpec(c.current).spec), c.classes, c.name);
  }
  assert.deepEqual(kpiCases.find((c) => c.name === 'target KPI changed').classes, ['config'], 'a new target KPI rebuilds the notebook');
  const plans = FIXTURE.plans.filter((p) => p.case.startsWith('target KPI'));
  assert.equal(plans.length, 3);
  for (const p of plans) {
    const c = FIXTURE.cases.find((x) => x.name === p.case);
    const summary = I.implementChangeSummary(I.validateImplementSpec(c.previous).spec, I.validateImplementSpec(c.current).spec, p.assets);
    assert.deepEqual([summary.classes, summary.refill, summary.schedule], [p.summary.classes, p.summary.refill, p.summary.schedule], p.name);
  }
  assert.equal(I.implementKpiChoice({ kpi: { target: ' Straße\tcount ' } }), I.implementKpiChoice({ kpi: { target: 'STRASSE COUNT' } }));
});

test('the backend and the wizard refuse and accept the same target KPIs: listed names only, ignoring case and spacing, at most 200 characters', async () => {
  const K = await lib('targetKpi.js');
  assert.equal(K.KPI_TARGET_MAX, I.IMPLEMENT_KPI_TARGET_MAX);
  for (const [name, target, options, ok] of TARGET_CASES) {
    const backend = I.implementKpiTargetProblems({ kpi: { target } }, options);
    const wizard = K.kpiTargetProblems({ kpi: { target } }, options.map((o) => ({ name: o })));
    assert.equal(backend.length === 0, ok, `backend, ${name}: ${backend.join('; ')}`);
    assert.equal(wizard.length === 0, ok, `wizard, ${name}: ${wizard.join('; ')}`);
  }
  assert.deepEqual(I.implementKpiTargetProblems({ kpi: { target: 'Revenue' } }, ['Churn rate', 'Hours saved']),
    ["kpi.target 'Revenue' is not one of this use case's KPIs (Churn rate, Hours saved); send one of them, or no kpi.target to let Inspire pick"]);
  assert.deepEqual(I.implementKpiTargetProblems({ kpi: { target: 'k'.repeat(201) } }, ['Churn rate']),
    ['kpi.target is 201 characters; a target KPI name is at most 200']);
  assert.deepEqual(I.implementKpiTargetProblems({ kpi: { target: 'Revenue' } }, []),
    ["kpi.target 'Revenue' is not one of this use case's KPIs: it has none yet, so Inspire evaluates the best KPIs for it when it builds; send no kpi.target to let Inspire pick"]);
  assert.deepEqual(I.implementKpiTargetProblems('{"kpi":{"target":"Revenue"}}', ['Revenue']), [], 'a spec sent as JSON text is read the same way');
  assert.deepEqual(I.implementKpiTargetProblems({ kpi: { target: 5 } }, []), [], 'a target that is not text is the validator\u2019s error, said once');
});

test('the backend compares and matches target KPIs exactly as the agent notebook the App ships does, on spacing, case and Unicode', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const odd = ['Straße count', 'STRASSE COUNT', 'ẞ count', 'ss COUNT', 'Kayıp oranı', 'KAYIP ORANI', 'kayip orani', 'ΟΔΟΣ', 'οδος', 'İade', 'i\u0307ade',
    '\uFB00 rate', 'FF rate', 'Hours\tsaved', 'Hours\u00a0saved', 'Hours\u3000saved', 'Hours\x1csaved', 'Hours\x85saved', 'Hours\u200bsaved', ' Hours  saved ', 'K\u212Apis'];
  const cases = {
    names: ['implement_kpi_choice', 'implement_pick_kpi'],
    choices: [...odd.map((target) => ({ kpi: { target } })), {}, { kpi: null }, { kpi: {} }, { kpi: { target: null } }, { kpi: { target: '' } }],
    picks: [...odd.flatMap((target) => [[target, ['Straße count', 'Kayıp oranı', 'ΟΔΟΣ', 'İade', 'ff rate', 'Hours saved', 'kkpis']], [target, ['Churn rate']]]),
      ['Churn rate', []], ['Churn', ['Churn rate']], [EMOJI.repeat(200), [EMOJI.repeat(200)]]],
  };
  const agent = agentProbe(AGENT_NOTEBOOK, cases, KPI_PROBE);
  assert.equal(agent.missing, undefined, `the agent notebook at ${AGENT_NOTEBOOK} has no ${agent.missing}: bundle the agent that tracks a target KPI`);
  assert.deepEqual(cases.choices.map(I.implementKpiChoice), agent.choice, 'a target KPI change is the change the agent sees');
  assert.deepEqual(cases.picks.map(([target, options]) => I.implementKpiTargetProblems({ kpi: { target } }, options).length === 0),
    agent.picked.map((by) => by === 'user'), 'the backend accepts exactly the targets the agent tracks as the person\u2019s pick');
  assert.ok(agent.picked.filter((by) => by === 'user').length >= 15 && agent.picked.filter((by) => by !== 'user').length >= 15, 'both outcomes are exercised');
});

test('the options are the use case\u2019s own Inspire KPIs, else the ones Inspire evaluated on the newest version that recorded a target KPI', async () => {
  const K = await lib('targetKpi.js');
  assert.deepEqual(I.implementKpiOptions(USE_CASE, []), ['Churn rate', 'Hours saved']);
  assert.deepEqual(K.kpiTargetOptions({ kpis: JSON.stringify(KPIS) }, []).map((o) => [o.name, o.unit]), [['Churn rate', '%'], ['Hours saved', 'hours']]);
  assert.deepEqual(I.implementKpiOptions({ ...USE_CASE, kpis: JSON.stringify([...KPIS, { name: 'churn  RATE' }, { name: ' ' }, 'x']) }, []), ['Churn rate', 'Hours saved'],
    'a blank name, a duplicate in another case and an entry that is not a KPI are left out');
  const history = [{ ...evaluatedRow(3, 'filling'), asset_status: {} }, evaluatedRow(2), evaluatedRow(1)].map((r) => ({ ...r, asset_status: typeof r.asset_status === 'string' ? JSON.parse(r.asset_status) : r.asset_status }));
  const none = { ...USE_CASE, kpis: '[]' };
  assert.deepEqual(I.implementKpiOptions(none, history), ['Late deliveries', 'Hours lost'], 'a version still building has recorded no KPI, so the one before it holds them');
  assert.deepEqual(K.kpiTargetOptions({ kpis: '[]' }, history).map((o) => [o.name, o.unit]), [['Late deliveries', 'deliveries'], ['Hours lost', 'hours']]);
  const picked = [{ ...history[1], asset_status: { target_kpi: { name: 'Churn rate', source: 'inspire', options: ['Churn rate'] } } }];
  assert.deepEqual(I.implementKpiOptions(none, picked), [], 'options Inspire took from the use case are never offered once the use case has none');
  assert.deepEqual(K.kpiTargetOptions({ kpis: '[]' }, picked), []);
  assert.deepEqual(I.implementKpiOptions(none, []), []);
});

test('a submitted target KPI must be one of the use case\u2019s KPIs: a bad name and one over 200 characters are refused, a match in another case is written as sent', async () => {
  await withApp({}, async (url, made) => {
    const bad = await post(url, '/api/inspire/implement/submit', { ...DB, spec: { ...BASE, kpi: { target: 'Revenue' } } });
    assert.deepEqual([bad.status, bad.data.error],
      [400, "kpi.target 'Revenue' is not one of this use case's KPIs (Churn rate, Hours saved); send one of them, or no kpi.target to let Inspire pick"]);
    const long = await post(url, '/api/inspire/implement/plan', { ...DB, spec: { ...BASE, kpi: { target: `Churn rate${' x'.repeat(100)}` } } });
    assert.deepEqual([long.status, long.data.error], [400, 'kpi.target is 210 characters; a target KPI name is at most 200']);
    assert.equal(made.jobs.length, 0, 'nothing starts');
    assert.equal(inserts(made).length, 0, 'nothing is written');
    const ok = await post(url, '/api/inspire/implement/submit', { ...DB, spec: { ...BASE, kpi: { target: ' churn RATE ' } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(inserts(made)[0].kpi, { target: 'churn RATE' }, 'the agent matches it ignoring case and spacing, so it goes in as the person sent it');
  });
  const carried = { ...evaluatedRow(1), dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
    spec_json: JSON.stringify({ ...clean(), kpi: { target: 'Hours lost', tracked: 'Hours lost' } }), asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 } }) };
  await withApp({ history: [carried] }, async (url, made) => {
    const uninstall = await post(url, '/api/inspire/implement/submit', { ...DB, spec: { ...clean(), based_on_version: 1, kpi: { target: 'hours  LOST' }, uninstall: true } });
    assert.equal(uninstall.status, 200, `a target the version before carried, no longer one of the use case's KPIs, never blocks Uninstall: ${JSON.stringify(uninstall.data)}`);
    const changed = await post(url, '/api/inspire/implement/plan', { ...DB, spec: { ...BASE, based_on_version: 1, kpi: { target: 'Revenue' } } });
    assert.equal(changed.status, 400, 'a new target that is not listed is still refused');
    assert.equal(made.jobs.length, 1);
  });
  assert.deepEqual(I.implementKpiTargetProblems({ kpi: { target: 'Hours lost' } }, ['Churn rate'], [I.parseImplementRow(carried)]), []);
  assert.equal(I.implementKpiTargetProblems({ kpi: { target: 'Hours lost' } }, ['Churn rate'], []).length, 1, 'without that version the same target is refused');
  await withApp({ useCase: { ...USE_CASE, kpis: null }, history: [evaluatedRow(1)] }, async (url, made) => {
    const ok = await post(url, '/api/inspire/implement/submit', { ...DB, spec: { ...BASE, based_on_version: 1, kpi: { target: 'Hours lost' } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(inserts(made)[0].kpi, { target: 'Hours lost' }, 'an evaluated KPI of the version before is a valid pick');
  });
});

test('Vibe/Add/Remove Features, Try again and Publish anyway keep the target KPI through the one shared helper, and the backend writes it', async () => {
  const W = await lib('implementWizard.js');
  const K = await lib('targetKpi.js');
  const stored = { ...clean({ vibes: 'Count returns by week', vibe_previous: 'keep', based_on_version: 1 }),
    kpi: { target: 'Hours saved', tracked: 'Hours saved', source: 'inspire', picked_by: 'user', computable: false, impact_kind: 'hours', impact_unit: 'hours' } };
  const held = { session_id: '42', use_case_id: 'N01-U01', spec_version: 2, status: 'vibe_not_met', created_by: OWNER, updated_at: '2026-10-22T04:00:00Z',
    spec_json: stored, asset_status: { held: { parts: ['dashboard'], reason: '1 of 2 vibe requirements met after 3 rounds' } } };
  const built = { ...held, spec_version: 1, status: 'ready', spec_json: clean(), asset_status: { dashboard: { state: 'ready', spec_version: 1 } } };
  assert.equal(W.specFromHeld(held).kpi.target, 'Hours saved', 'Try again');
  const fallback = W.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' }, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  assert.equal(Object.hasOwn(fallback, 'kpi'), false, 'a new MVP starts on Let Inspire pick');
  const edit = W.specFromLatest(held, fallback);
  assert.equal(K.kpiTargetOf(edit), 'Hours saved', 'Vibe/Add/Remove Features of a held version');
  assert.equal(K.kpiTargetOf(W.specFromLatest({ ...held, status: 'ready' }, fallback)), 'Hours saved', 'Vibe/Add/Remove Features of a built version');
  assert.deepEqual(W.sentSpec(edit, null, 1).kpi, { target: 'Hours saved' }, 'the wizard sends only the target, never the fields the agent recorded');
  assert.equal(Object.hasOwn(W.sentSpec(K.withKpiTarget(edit, ''), null, 1), 'kpi'), false, 'Let Inspire pick sends no target');
  assert.deepEqual(K.withKpiTarget(edit, 'Churn rate').kpi, { target: 'Churn rate' });
  const history = [held, built].map((r) => ({ ...r, spec_json: JSON.stringify(r.spec_json), asset_status: JSON.stringify(r.asset_status) }));
  for (const [route, spec] of [['/api/inspire/implement/submit', W.specFromHeld(held)]]) {
    await withApp({ history }, async (url, made) => {
      const got = await post(url, route, { ...DB, spec });
      assert.equal(got.status, 200, `${route}: ${JSON.stringify(got.data)}`);
      assert.deepEqual(inserts(made)[0].kpi, { target: 'Hours saved' }, `${route} writes the target KPI the held version asked for`);
    });
  }
});

test('the money route carries the impact kind and the target KPI the last run wrote', () => {
  const summary = { use_case_id: 'N01-U01', run_id: 7, currency: 'USD', value_at_stake: '12.5', impact_kind: ' hours ', impact_unit: 'hours',
    kpi_name: 'Hours saved', kpi_source: 'inspire', kpi_direction: 'increase', kpi_unit: 'hours', kpi_baseline: '40', kpi_latest: '46.5', kpi_target: '60',
    kpi_baseline_on: '2026-10-29', kpi_target_text: 'Raise hours saved to 60', kpi_status: 'measured', kpi_reason: null, kpi_measured_at: '2026-10-30T06:00:00Z' };
  const { run } = moneyView(summary, []);
  assert.deepEqual([run.impact_kind, run.impact_unit], ['hours', 'hours']);
  assert.deepEqual(run.kpi, { name: 'Hours saved', source: 'inspire', direction: 'increase', unit: 'hours', baseline: 40, latest: 46.5, target: 60,
    baseline_on: '2026-10-29', target_text: 'Raise hours saved to 60', status: 'measured', reason: '', measured_at: '2026-10-30T06:00:00Z', query: '' });
  const old = moneyView({ use_case_id: 'N01-U01', currency: 'USD', value_at_stake: '5' }, []).run;
  assert.deepEqual([old.impact_kind, old.impact_unit, old.kpi], ['', '', null], 'a summary written before target KPIs has none');
});

test('the KPI card view reads the version\u2019s KPI and the last run: measured, not measured, failed, not yet run, a new KPI not run yet, and a baseline on another table', async () => {
  const K = await lib('targetKpi.js');
  const record = { name: 'Hours saved', source: 'inspire', picked_by: 'inspire', kpi_id: null, unit: 'hours', direction: 'increase', computable: true,
    baseline: 40, baseline_on: '2026-10-29', target: 60, target_text: 'Raise hours saved to 60', spec_version: 3 };
  const run = (kpi) => ({ kpi: { name: 'Hours saved', unit: 'hours', baseline: 40, latest: 46.5, target: 60, baseline_on: '2026-10-29', status: 'measured', reason: '',
    measured_at: '2026-10-30T06:00:00Z', ...kpi } });
  const hours = K.impactOf({ impact_kind: 'hours', impact_unit: 'hours' });
  const measured = K.targetKpiView(record, run({}), hours);
  assert.deepEqual([measured.status, measured.baseline, measured.baselineOn, measured.latest, measured.latestOn, measured.target, measured.direction, measured.note, measured.baselineFlag],
    ['measured', '40 hours', 'Oct 29, 2026', '46.5 hours', 'Oct 30, 2026', '60 hours', 'Increase', '', '']);
  assert.equal(K.kpiLine(measured), 'Target KPI: Hours saved, 46.5 hours against a target of 60 hours, from a baseline of 40 hours.');
  const off = K.targetKpiView(record, run({ status: 'not_measured', latest: null, reason: 'its query returned no value' }), hours);
  assert.deepEqual([off.status, off.latest, off.note, off.tone, off.baselineFlag], ['not_measured', 'Not measured', 'Not measured: its query returned no value', 'warning', '']);
  const failed = K.targetKpiView({ ...record, baseline_reason: 'its baseline was measured on a.b.c' }, run({ status: 'failed', latest: null, reason: 'its query failed: boom' }), hours);
  assert.deepEqual([failed.status, failed.note, failed.tone, failed.baselineFlag], ['failed', 'Not measured: its query failed: boom', 'error', ''],
    'a KPI that was not measured says only why, which already names the baseline table');
  assert.equal(K.kpiLine(failed), 'Target KPI: Hours saved, not measured: its query failed: boom.');
  const pending = K.targetKpiView(record, null, hours);
  assert.deepEqual([pending.status, pending.note, pending.baseline, pending.latest], ['pending', 'Not measured yet: the notebook has not run since this version was built', '40 hours', 'Not measured']);
  const text = K.targetKpiView({ ...record, computable: false, reason: 'it is tracked as text', baseline: null }, null, hours);
  assert.deepEqual([text.note, text.baseline, text.baselineOn], ['Not measured: it is tracked as text', 'Not measured', '']);
  const renamed = K.targetKpiView({ ...record, name: 'Churn rate', unit: '%', baseline: 18, target: 15 }, run({}), hours);
  assert.deepEqual([renamed.name, renamed.status, renamed.note, renamed.baseline, renamed.target],
    ['Churn rate', 'pending', 'Not measured yet: the notebook has not run since Inspire started tracking Churn rate', '18%', '15%'], 'the last run measured the KPI before');
  const swapped = K.targetKpiView({ ...record, baseline_reason: 'its baseline was measured on a.b.c, but it is measured now on a.b.d' }, run({}), hours);
  assert.equal(swapped.baselineFlag, 'Baseline: Its baseline was measured on a.b.c, but it is measured now on a.b.d.');
  assert.equal(K.targetKpiView(record, run({ reason: 'its baseline was measured on a.b.c' }), hours).baselineFlag, 'Baseline: Its baseline was measured on a.b.c.',
    'a measured run that gives a reason is giving the baseline flag');
  assert.equal(K.targetKpiView(null, null), null);
  assert.equal(K.targetKpiView(null, run({})).name, 'Hours saved', 'a run the version did not record still shows');
  assert.equal(K.kpiPickText({ picked_by: 'user' }), 'You picked it.');
  assert.equal(K.kpiPickText({ picked_by: 'inspire', kpi_id: 'K1' }), 'Inspire picked it: your strategy links it to this use case.');
  assert.match(K.kpiPickText({ picked_by: 'inspire', source: 'evaluated' }), /^Inspire picked it: this use case has no Inspire KPI, so Inspire evaluated/);
});

test('one formatter names what is at stake: money only when the impact is money, the KPI\u2019s own unit otherwise, never a currency for a KPI that is not money', async () => {
  const K = await lib('targetKpi.js');
  const hours = K.impactOf({ impact_kind: 'hours', impact_unit: 'hours', currency: 'USD' });
  assert.deepEqual(hours, { kind: 'hours', unit: 'hours' }, 'a currency left on the row never reaches an hours KPI');
  const cases = [
    [{ impact_kind: 'money', impact_unit: 'EUR' }, 'Money at stake', 'money at stake', '1,234.5 EUR'],
    [{ impact_kind: 'money', impact_unit: '', currency: 'USD' }, 'Money at stake', 'money at stake', '1,234.5 USD'],
    [{ currency: 'USD' }, 'Money at stake', 'money at stake', '1,234.5 USD'],
    [{ impact_kind: 'hours', impact_unit: 'hours', currency: 'USD' }, 'Hours at stake', 'hours at stake', '1,234.5 hours'],
    [{ impact_kind: 'count', impact_unit: 'late deliveries' }, 'Late deliveries at stake', 'late deliveries at stake', '1,234.5 late deliveries'],
    [{ impact_kind: 'percent', impact_unit: 'points of churn rate' }, 'Points of churn rate at stake', 'points of churn rate at stake', '1,234.5 points of churn rate'],
    [{ impact_kind: 'number', impact_unit: 'minutes' }, 'Minutes at stake', 'minutes at stake', '1,234.5 minutes'],
    [{ impact_kind: 'count', impact_unit: '' }, 'Count at stake', 'count at stake', '1,234.5'],
  ];
  for (const [row, label, words, amount] of cases) {
    const impact = K.impactOf(row);
    assert.equal(K.stakeLabel(impact), label, JSON.stringify(row));
    assert.equal(K.stakeWords(impact), words, JSON.stringify(row));
    assert.equal(K.stakeAmount(1234.5, impact), amount, JSON.stringify(row));
  }
  assert.equal(K.stakeLabel(null), 'At stake', 'before a build the App does not know the unit, so it names none');
  assert.equal(K.stakeWords(null), 'amount at stake');
  assert.equal(K.stakeAmount(12, null), '12');
  assert.equal(K.stakeAmount(null, hours), '');
  assert.deepEqual([K.stakeShort(412000, K.impactOf({ currency: 'USD' })), K.stakeShort(412000, hours), K.stakeShort(412000, null), K.stakeShort(1500000, K.impactOf({ impact_kind: 'money', impact_unit: 'EUR' }))],
    ['$412K', '412K hours', '412K', '\u20ac1.5M']);
  const money = K.impactOf({});
  const oldRun = { currency: 'USD', impact_kind: '' };
  assert.deepEqual(K.liveImpact(oldRun, money), { kind: 'money', unit: 'USD' }, 'a run written before target KPIs keeps its own currency');
  assert.deepEqual(K.liveImpact(oldRun, null), { kind: 'money', unit: 'USD' });
  assert.deepEqual(K.liveImpact(oldRun, hours), hours, 'a notebook rebuilt for an hours KPI is counted in hours even before its first run');
  assert.deepEqual(K.liveImpact({ impact_kind: 'count', impact_unit: 'late deliveries', currency: 'USD' }, money), { kind: 'count', unit: 'late deliveries' },
    'a run that names its impact wins over what the version recorded');
  assert.deepEqual(K.liveImpact(null, hours), hours);
  assert.equal(K.liveImpact(null, null), null);
  assert.deepEqual(K.rowImpact({ asset_status: { notebook: { impact: { kind: 'hours', unit: 'hours', kpi: 'Hours saved' } } } }), { kind: 'hours', unit: 'hours' });
  assert.deepEqual(K.rowImpact({ asset_status: { notebook: { state: 'ready' } } }), { kind: 'money', unit: '' }, 'a notebook built before keeps money until it is rebuilt');
  assert.equal(K.rowImpact(null), null);
});
