const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');
const { agentProbe, pythonReady } = require('./support/agentProbe');

const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.n01_u01_out' },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
};
const ALERTING = { ...BASE.outputs, alert: true, alert_recipients: ['owner@example.com'] };
const CAP_ERROR = (shown) => `capacity act_now ${shown} must be a whole number of rows from 1 to 1000000, or empty for no cap`;
const SOURCE_ERROR = (shown) => `capacity source ${shown} must be one of default, user`;
const DIGEST_ERROR = (shown) => `outputs.alert_digest must be true or false, not ${shown}`;
const NOTIFY_ERROR = (shown) => `outputs.alert_notify_on_ok must be true or false, not ${shown}`;
const rawRow = (spec, assets = { dashboard_id: 'd1' }) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: '1', status: 'ready', spec_json: JSON.stringify(spec), notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1, result_history: 1 } }), ...assets,
});
const builtRow = (spec, assets) => I.parseImplementRow(rawRow(spec, assets));
const AGENT_NOTEBOOK = process.env.INSPIRE_AGENT_NOTEBOOK || path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');

test('a spec without a capacity cleans without one, and a sent capacity is checked the way the agent checks it', () => {
  for (const spec of [BASE, { ...BASE, capacity: null }]) {
    const got = I.validateImplementSpec(spec);
    assert.deepEqual(got.errors, []);
    assert.equal(Object.hasOwn(got.spec, 'capacity'), false, 'nothing sent, nothing kept: the MVP stays uncapped');
  }
  for (const [given, kept, errors] of [
    [{ act_now: 50, source: 'user' }, { act_now: 50, source: 'user' }, []],
    [{ act_now: null, source: 'default' }, { act_now: null, source: 'default' }, []],
    [{ act_now: '' }, { act_now: null, source: 'default' }, []],
    [{ act_now: '25' }, { act_now: 25, source: 'default' }, []],
    [{ act_now: ' 40 ', source: 'USER' }, { act_now: 40, source: 'user' }, []],
    [{ act_now: 5.0 }, { act_now: 5, source: 'default' }, []],
    [{ act_now: 1 }, { act_now: 1, source: 'default' }, []],
    [{ act_now: 1000000 }, { act_now: 1000000, source: 'default' }, []],
    [{ act_now: 0 }, { act_now: null, source: 'default' }, [CAP_ERROR('0')]],
    [{ act_now: -3 }, { act_now: null, source: 'default' }, [CAP_ERROR('-3')]],
    [{ act_now: 2.5 }, { act_now: null, source: 'default' }, [CAP_ERROR('2.5')]],
    [{ act_now: '2.5' }, { act_now: null, source: 'default' }, [CAP_ERROR("'2.5'")]],
    [{ act_now: '1e3' }, { act_now: null, source: 'default' }, [CAP_ERROR("'1e3'")]],
    [{ act_now: 1000001 }, { act_now: null, source: 'default' }, [CAP_ERROR('1000001')]],
    [{ act_now: 1e15 }, { act_now: null, source: 'default' }, [CAP_ERROR('1000000000000000')]],
    [{ act_now: true }, { act_now: null, source: 'default' }, [CAP_ERROR('true')]],
    [{ act_now: 50, source: 'robot' }, { act_now: 50, source: 'default' }, [SOURCE_ERROR("'robot'")]],
    [{ act_now: 50, source: 3 }, { act_now: 50, source: 'default' }, [SOURCE_ERROR('3')]],
    ['50', { act_now: null, source: 'default' }, ['capacity must be an object']],
  ]) {
    const got = I.validateImplementSpec({ ...BASE, capacity: given });
    assert.deepEqual(got.errors, errors, JSON.stringify(given));
    assert.deepEqual(got.spec.capacity, kept, JSON.stringify(given));
  }
});

test('the run reads a capacity only when it is a whole number of one or more rows', () => {
  const read = I.implementActNowCapacity;
  assert.deepEqual([{ act_now: 25 }, { act_now: 1 }, { act_now: 0 }, { act_now: -3 }, { act_now: '25' }, { act_now: 2.5 }, { act_now: true },
    { act_now: null }, {}, null, 'x'].map(read), [25, 1, null, null, null, null, null, null, null, null, null]);
});

test('a capacity larger than the use case has rows is kept as the person set it, and submit saves it with its own change class', async () => {
  const before = I.validateImplementSpec(BASE).spec;
  const { app, sqlCalls, jobs } = makeApp({ history: [rawRow(before)],
    useCase: { id: 'N01-U01', use_case: 'Predict churn', data_evidence: JSON.stringify({ tables: { 'main.s.orders': { rows: 1200, sampled: false } } }),
      genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n' } });
  const srv = await listen(app);
  const body = (capacity) => ({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42',
    spec: { ...BASE, based_on_version: 1, capacity } });
  const post = async (capacity) => {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(capacity)) });
    return { status: resp.status, data: await resp.json() };
  };
  try {
    const refused = await post({ act_now: -3, source: 'user' });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /capacity act_now -3 must be a whole number of rows from 1 to 1000000, or empty for no cap/);
    assert.equal(jobs.length, 0);
    const ok = await post({ act_now: 5000, source: 'user' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const insert = sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    assert.deepEqual(JSON.parse(insert.parameters.find((p) => p.name === 'spec').value).capacity, { act_now: 5000, source: 'user' },
      '5,000 is more than the 1,200 rows the use case has: the cap holds nothing back, and the person\'s number still wins');
    assert.equal(insert.parameters.find((p) => p.name === 'classes').value, 'capacity');
    assert.equal(jobs.length, 1);
  } finally {
    await srv.close();
  }
});

test('a capacity change is a change of its own only when the number of rows changes, and it rebuilds nothing', () => {
  const edit = (capacity) => ({ ...I.validateImplementSpec({ ...BASE, ...(capacity === undefined ? {} : { capacity }) }).spec, based_on_version: 1 });
  const rows = [builtRow(edit(undefined))];
  const capped = I.planSubmission(rows, edit({ act_now: 50, source: 'default' }));
  assert.deepEqual(capped.summary.classes, ['capacity']);
  assert.deepEqual([capped.summary.refill, capped.summary.build, capped.summary.refresh, capped.summary.schedule], [false, [], [], false],
    'the next run reads the capacity from the run controls');
  assert.equal(I.planSubmission(rows, edit({ act_now: null, source: 'default' })).unchanged, true, 'no cap sent is no cap');
  const held = [builtRow(edit({ act_now: 50, source: 'default' }))];
  assert.equal(I.planSubmission(held, edit({ act_now: 50, source: 'user' })).unchanged, true, 'the same number from the person is no change');
  assert.deepEqual(I.planSubmission(held, edit({ act_now: 20, source: 'user' })).summary.classes, ['capacity']);
  assert.deepEqual(I.planSubmission(held, edit(undefined)).summary.classes, ['capacity'], 'dropping the cap is a change');
  assert.equal(I.IMPLEMENT_CHANGE_CLASSES[I.IMPLEMENT_CHANGE_CLASSES.indexOf('holdout') + 1], 'capacity');
});

test('the weekly value email is on unless the alert sets it off, and a value that is not true or false is refused', () => {
  const alert = (extra) => I.validateImplementSpec({ ...BASE, outputs: { ...ALERTING, ...extra } });
  const absent = alert({});
  assert.deepEqual(absent.errors, []);
  assert.equal(Object.hasOwn(absent.spec.outputs, 'alert_digest'), false, 'a spec that sends none cleans to the same spec as before');
  assert.equal(I.implementAlertDigest(absent.spec.outputs), true, 'absent means on');
  for (const [given, kept, errors] of [[true, true, []], [false, false, []], [null, true, []], ['yes', true, [DIGEST_ERROR("'yes'")]],
    [0, true, [DIGEST_ERROR('0')]]]) {
    const got = alert({ alert_digest: given });
    assert.deepEqual(got.errors, errors, JSON.stringify(given));
    assert.equal(got.spec.outputs.alert_digest, kept, JSON.stringify(given));
    assert.equal(I.implementAlertDigest(got.spec.outputs), kept);
  }
  const off = I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs, alert: false, alert_digest: false } });
  assert.deepEqual(off.errors, []);
  assert.equal(Object.hasOwn(off.spec.outputs, 'alert_digest'), false, 'no alert, no email setting');
});

test('turning the weekly value email off rebuilds the alert and nothing else', () => {
  const edit = (digest) => ({ ...I.validateImplementSpec({ ...BASE, outputs: { ...ALERTING, ...(digest === undefined ? {} : { alert_digest: digest }) } }).spec,
    based_on_version: 1 });
  const rows = [builtRow(edit(undefined), { dashboard_id: 'd1', alert_id: 'a1' })];
  const off = I.planSubmission(rows, edit(false));
  assert.deepEqual(off.summary.classes, ['outputs']);
  assert.deepEqual([off.summary.refill, off.summary.build, off.summary.refresh], [false, [], ['alert']]);
  assert.equal(I.planSubmission(rows, edit(true)).unchanged, true, 'sending the default is no change');
});

test('the email when the alert clears is on unless the alert sets it off, and a value that is not true or false is refused', () => {
  const alert = (extra) => I.validateImplementSpec({ ...BASE, outputs: { ...ALERTING, ...extra } });
  const absent = alert({});
  assert.deepEqual(absent.errors, []);
  assert.equal(Object.hasOwn(absent.spec.outputs, 'alert_notify_on_ok'), false, 'a spec that sends none cleans to the same spec as before');
  assert.equal(I.implementAlertNotifyOnOk(absent.spec.outputs), true, 'absent means on');
  for (const [given, kept, errors] of [[true, true, []], [false, false, []], [null, true, []],
    ['yes', true, [NOTIFY_ERROR("'yes'")]], [0, true, [NOTIFY_ERROR('0')]], ['false', true, [NOTIFY_ERROR("'false'")]]]) {
    const got = alert({ alert_notify_on_ok: given });
    assert.deepEqual(got.errors, errors, JSON.stringify(given));
    assert.equal(got.spec.outputs.alert_notify_on_ok, kept, JSON.stringify(given));
    assert.equal(I.implementAlertNotifyOnOk(got.spec.outputs), kept);
  }
  const off = I.validateImplementSpec({ ...BASE, outputs: { ...BASE.outputs, alert: false, alert_notify_on_ok: false } });
  assert.deepEqual(off.errors, []);
  assert.equal(Object.hasOwn(off.spec.outputs, 'alert_notify_on_ok'), false, 'no alert, no setting for the email when it clears');
});

test('turning the email when the alert clears off or back on rebuilds the alert and nothing else', () => {
  const edit = (notify) => ({ ...I.validateImplementSpec({ ...BASE, outputs: { ...ALERTING, ...(notify === undefined ? {} : { alert_notify_on_ok: notify }) } }).spec,
    based_on_version: 1 });
  const rows = [builtRow(edit(undefined), { dashboard_id: 'd1', alert_id: 'a1' })];
  const off = I.planSubmission(rows, edit(false));
  assert.deepEqual(off.summary.classes, ['outputs']);
  assert.deepEqual([off.summary.refill, off.summary.build, off.summary.refresh], [false, [], ['alert']]);
  assert.equal(I.planSubmission(rows, edit(true)).unchanged, true, 'sending the default is no change');
  const held = [builtRow(edit(false), { dashboard_id: 'd1', alert_id: 'a1' })];
  assert.deepEqual(I.planSubmission(held, edit(true)).summary.refresh, ['alert'], 'turning it back on rebuilds the alert');
  assert.deepEqual(I.planSubmission(held, edit(undefined)).summary.refresh, ['alert'], 'dropping the setting turns it back on');
});

const PROBE = String.raw`
out = {"capacity": [], "act_now": [], "digest": [], "on": [], "notify": [], "notify_on": []}
for raw in cases["capacity"]:
    errors = []
    out["capacity"].append({"value": ns["implement_capacity_setting"](raw, errors), "errors": errors})
for raw in cases["act_now"]:
    out["act_now"].append(ns["implement_act_now_capacity"](raw))
for outputs in cases["digest"]:
    options, errors = ns["_implement_alert_options"](outputs, True)
    out["digest"].append({"kept": "alert_digest" in options, "value": options.get("alert_digest"),
                          "errors": [e for e in errors if "alert_digest" in e]})
    out["on"].append(ns["implement_alert_digest"](options))
for outputs in cases["notify"]:
    options, errors = ns["_implement_alert_options"](outputs, True)
    out["notify"].append({"kept": "alert_notify_on_ok" in options, "value": options.get("alert_notify_on_ok"),
                          "errors": [e for e in errors if "alert_notify_on_ok" in e]})
    out["notify_on"].append(ns["implement_alert_notify_on_ok"](options))
out["constants"] = {"max": ns["IMPLEMENT_CAPACITY_MAX"], "sources": list(ns["IMPLEMENT_CAPACITY_SOURCES"]),
                    "classes": list(ns["IMPLEMENT_CHANGE_CLASSES"])}
print(json.dumps(out))
`;

const PARITY_CASES = {
  names: ['implement_capacity_setting', 'implement_act_now_capacity', '_implement_alert_options', 'implement_alert_digest',
    'implement_alert_notify_on_ok', 'IMPLEMENT_CAPACITY_MAX', 'IMPLEMENT_CAPACITY_SOURCES', 'IMPLEMENT_CHANGE_CLASSES'],
  capacity: [null, '', {}, '50', [], { act_now: null }, { act_now: '' }, { act_now: 0 }, { act_now: -3 }, { act_now: 2.5 }, { act_now: '2.5' },
    { act_now: '25' }, { act_now: ' 40 ' }, { act_now: 5.0 }, { act_now: 1 }, { act_now: 1000000 }, { act_now: 1000001 }, { act_now: 1e15 },
    { act_now: true }, { act_now: '1e3' }, { act_now: 'ten' }, { act_now: 50, source: 'user' }, { act_now: 50, source: 'USER' },
    { act_now: 50, source: ' default ' }, { act_now: 50, source: '' }, { act_now: 50, source: null }, { act_now: 50, source: 'robot' },
    { act_now: 50, source: 3 }, { act_now: [], source: {} }],
  act_now: [{ act_now: 25 }, { act_now: 1 }, { act_now: 0 }, { act_now: -3 }, { act_now: '25' }, { act_now: 2.5 }, { act_now: true },
    { act_now: null }, {}, null, 'x'],
  digest: [{}, { alert_digest: true }, { alert_digest: false }, { alert_digest: null }, { alert_digest: 'yes' }, { alert_digest: 0 },
    { alert_digest: 'false' }].map((extra) => ({ alert_recipients: ['owner@example.com'], ...extra })),
  notify: [{}, { alert_notify_on_ok: true }, { alert_notify_on_ok: false }, { alert_notify_on_ok: null }, { alert_notify_on_ok: 'yes' },
    { alert_notify_on_ok: 0 }, { alert_notify_on_ok: 'false' }].map((extra) => ({ alert_recipients: ['owner@example.com'], ...extra })),
};

test('the backend checks the capacity and the weekly email exactly as the agent notebook the App ships does', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const agent = agentProbe(AGENT_NOTEBOOK, PARITY_CASES, PROBE);
  assert.deepEqual(agent.missing, undefined, `the agent notebook at ${AGENT_NOTEBOOK} has no ${agent.missing}: bundle the agent that has the team capacity and the weekly email`);
  assert.deepEqual(PARITY_CASES.capacity.map((raw) => {
    const errors = [];
    return { value: I.capacitySetting(raw, errors), errors };
  }), agent.capacity);
  assert.deepEqual(PARITY_CASES.act_now.map(I.implementActNowCapacity), agent.act_now);
  const js = PARITY_CASES.digest.map((outputs) => I.alertOptions(outputs, true));
  assert.deepEqual(js.map(({ options, errors }) => ({ kept: Object.hasOwn(options, 'alert_digest'), value: options.alert_digest ?? null,
    errors: errors.filter((e) => e.includes('alert_digest')) })), agent.digest);
  assert.deepEqual(js.map(({ options }) => I.implementAlertDigest(options)), agent.on);
  const notify = PARITY_CASES.notify.map((outputs) => I.alertOptions(outputs, true));
  assert.deepEqual(notify.map(({ options, errors }) => ({ kept: Object.hasOwn(options, 'alert_notify_on_ok'), value: options.alert_notify_on_ok ?? null,
    errors: errors.filter((e) => e.includes('alert_notify_on_ok')) })), agent.notify);
  assert.deepEqual(notify.map(({ options }) => I.implementAlertNotifyOnOk(options)), agent.notify_on);
  assert.deepEqual([I.IMPLEMENT_CAPACITY_MAX, I.IMPLEMENT_CAPACITY_SOURCES, I.IMPLEMENT_CHANGE_CLASSES],
    [agent.constants.max, agent.constants.sources, agent.constants.classes]);
});

test('the wizard has no Team capacity field: the Summary says it is set in the App\u2019s Settings', async () => {
  const w = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
  for (const gone of ['CAPACITY_MAX', 'capacityOf', 'capacitySuggestion', 'withCapacity', 'withCapacityDefault', 'withSuggestedCapacity', 'capacityProblems', 'capacityInput']) {
    assert.equal(w[gone], undefined, gone);
  }
  const spec = w.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders' }, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  assert.throws(() => w.stepErrors('settings', spec, { scopeSteps: { grouping: true, firstRun: true } }), /unknown wizard step 'settings'/, 'the wizard has no Settings step (must-exclude)');
  for (const step of w.wizardSteps('mvp', { outputs: { app: true } }, { grouping: true, firstRun: true })) {
    assert.ok(!(step.sections || []).includes('capacity'), step.id);
  }
  assert.equal(w.pickedSummary(spec).some((r) => r.id === 'capacity' || /capacity/i.test(r.label)), false, 'the Summary lists no team capacity, which is set in the App (must-exclude)');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementWizard.jsx'), 'utf8');
  assert.doesNotMatch(src, /TeamCapacity|withCapacity|capacitySuggestion/);
});
