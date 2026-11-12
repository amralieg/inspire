const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, json, listen } = require('./support/implementApp');
const I = require('../lib/inspireImplement');
const { INSPIRE_ENVIRONMENT_VERSION } = require('../lib/inspireJobParams');

async function call(base, path, opts = {}) {
  const resp = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const OUT = 'result_table=main.inspire.churn_out';

const SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true },
};

test('context returns the use case, widgets and empty history', async () => {
  const { app } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200);
    assert.equal(got.data.use_case.id, 'N01-U01');
    assert.equal(got.data.discovery_type, 'AI Enhanced Discovery', 'a stored Deep session reads back under the new name');
    assert.ok(got.data.widgets.some((w) => w.name === 'top_k'));
    assert.equal(got.data.me.username, 'amr@x');
  } finally {
    await srv.close();
  }
});

test('preflight disables Apps when the workspace returns 404', async () => {
  const { app } = makeApp({ appsOk: false, spacesOk: true });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.features.apps, false);
    assert.equal(got.data.checks.apps.ok, false);
    assert.equal(got.data.checks.warehouse.ok, true);
    assert.equal(got.data.ok, false);
  } finally {
    await srv.close();
  }
});

test('submit writes the spec then launches an implement job', async () => {
  const { app, jobs, sqlCalls } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.spec_version, 1);
    assert.equal(got.data.run_id, 99);
    assert.equal(jobs[0].jobType, 'implement');
    assert.equal(jobs[0].params['15_operation'], 'Implement Use Cases');
    assert.equal(jobs[0].params.inspire_implement_use_case, 'N01-U01');
    assert.deepEqual(jobs[0].useCaseIds, ['N01-U01'], 'the implement job is tagged with the use case it builds');
    assert.match(jobs[0].jobName, /^Inspire AI - MVP - N01-U01 \S.* - v1$/, 'the MVP job names the use case it builds');
    assert.ok(sqlCalls.some((c) => String(c.sql).includes('CREATE TABLE IF NOT EXISTS')));
    assert.ok(sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')));
  } finally {
    await srv.close();
  }
});

test('behind the Apps proxy the wizard and the spec row name the signed-in person, and the checks name the identity that ran them', async () => {
  const sp = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai-implement' };
  const { app, sqlCalls } = makeApp({ me: sp });
  const srv = await listen(app);
  const headers = { 'x-forwarded-email': 'person@x.com' };
  try {
    const context = await call(srv.url, `/api/inspire/implement/context?${Q}`, { headers });
    assert.deepEqual(context.data.me, { username: 'person@x.com', display_name: 'person@x.com', source: 'forwarded_headers' });
    const local = await call(srv.url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual(local.data.me, { username: sp.userName, display_name: sp.displayName, source: 'request_token' },
      'with no forwarded person and a token that is not the App\u2019s own, the token names who asks, as before');
    const preflight = await call(srv.url, `/api/inspire/implement/preflight?${Q}&${OUT}`, { headers });
    assert.equal(preflight.data.identity, 'amr@x');
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      headers,
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const insert = sqlCalls.find((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(insert.parameters.find((p) => p.name === 'by').value, 'person@x.com');
  } finally {
    await srv.close();
  }
  await withApp({ me: sp, accessError: 'PERMISSION_DENIED: You do not have CAN_USE on warehouse wh1' }, async (url) => {
    const blocked = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`, { headers });
    assert.equal(blocked.data.checks.warehouse.ok, false);
    assert.equal(blocked.data.identity, sp.userName);
  });
});

test('submit 409s while a run is still active', async () => {
  const { app } = makeApp({
    history: [{ spec_version: 1, status: 'filling', spec_json: SPEC, use_case_id: 'N01-U01' }],
  });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 409);
    assert.match(got.data.error, /still filling/);
  } finally {
    await srv.close();
  }
});

const SUBMIT = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC };
const RAIL = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';

test('submit records the run it started on the version it wrote', async () => {
  await withApp({}, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: SUBMIT });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const writes = made.sqlCalls.filter((c) => /^(INSERT|UPDATE)/.test(String(c.sql)));
    assert.deepEqual(writes.map((c) => String(c.sql).split(' ')[0]), ['INSERT', 'UPDATE']);
    assert.match(writes[1].sql, /SET implement_run_id = :run, status_message = CASE WHEN status = 'queued'/);
    assert.deepEqual(writes[1].parameters.map((p) => [p.name, p.value]),
      [['run', '99'], ['message', 'Inspire started building this version.'], ['sid', '42'], ['uc', 'N01-U01'], ['v', '1']]);
  });
});

test('a version whose run could not start is failed with the reason, so it never blocks the next one', async () => {
  await withApp({ triggerError: 'RESOURCE_EXHAUSTED: too many concurrent runs' }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: SUBMIT });
    assert.equal(got.status, 500);
    assert.match(got.data.error, /too many concurrent runs/);
    const writes = made.sqlCalls.filter((c) => /^(INSERT|UPDATE)/.test(String(c.sql)));
    assert.deepEqual(writes.map((c) => String(c.sql).split(' ')[0]), ['INSERT', 'UPDATE']);
    assert.match(writes[1].sql, /SET status = 'failed', status_message = :message, updated_at = current_timestamp\(\) .* AND status = 'queued'$/);
    assert.deepEqual(writes[1].parameters.map((p) => [p.name, p.value]), [['message', 'the MVP run could not start: RESOURCE_EXHAUSTED: too many concurrent runs'],
      ['sid', '42'], ['uc', 'N01-U01'], ['v', '1']]);
  });
});

test('a session without UC metadata is refused before a spec row is written', async () => {
  await withApp({ ucMetadata: '' }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: SUBMIT });
    assert.equal(got.status, 400);
    assert.match(got.data.error, /no UC metadata/);
    assert.ok(!made.sqlCalls.some((c) => /^(INSERT|UPDATE)/.test(String(c.sql))));
    assert.equal(made.jobs.length, 0);
  });
});

test('the Implement page progress shows only the steps of the latest version', async () => {
  const step = (name, at) => ({ step_id: name, stage_name: 'Implement Use Cases', step_name: name, sub_step_name: 'N01-U01',
    status: 'ended_success', message: name, last_updated: at, result_json: JSON.stringify({ use_case_id: 'N01-U01' }) });
  const v1Steps = [step('v1 plan', '2026-10-26T06:10:35.000Z'), step('v1 build', '2026-10-26T06:33:29.000Z')];
  const v2Created = '2026-10-26T08:48:17.961Z';
  const history = [
    { spec_version: 2, status: 'queued', spec_json: SPEC, use_case_id: 'N01-U01', created_at: v2Created, updated_at: new Date().toISOString() },
    { spec_version: 1, status: 'failed', spec_json: SPEC, use_case_id: 'N01-U01', created_at: '2026-10-26T06:05:00.000Z' },
  ];
  const names = (got) => got.data.steps.map((s) => s.step_name);
  await withApp({ history, steps: v1Steps }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(names(got), [], 'a queued v2 shows none of the v1 steps');
    const stepCall = made.sqlCalls.find((c) => c.sql.includes('__inspire_step'));
    assert.deepEqual(stepCall.parameters, [{ name: 'since', value: v2Created, type: 'STRING' }]);
  });
  await withApp({ history, steps: [...v1Steps, step('v2 plan', '2026-10-26T08:52:00.000Z')] }, async (url) => {
    assert.deepEqual(names(await call(url, `/api/inspire/implement/status?${Q}`)), ['v2 plan']);
  });
  await withApp({ history: [{ ...history[1], created_at: null }], steps: v1Steps }, async (url) => {
    assert.deepEqual(names(await call(url, `/api/inspire/implement/status?${Q}`)), ['v1 plan', 'v1 build'],
      'a version row without created_at keeps every step of the use case');
  });
  await withApp({ history, steps: v1Steps }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}&since=2026-10-26T06:20:00Z`);
    assert.deepEqual(names(got), ['v1 build'], 'an explicit since still wins');
  });
});

test('the Genie feed reads the log of the run building the latest version, so another run of the session never replaces it', async () => {
  const note = (text) => `2026-10-28 04:55:00 - DatabricksInspire - INFO - [IMPLEMENT N01-U01] ${text}\n`;
  const history = [{ spec_version: 2, status: 'building_outputs', spec_json: SPEC, use_case_id: 'N01-U01', implement_run_id: '111122223333444',
    created_at: '2026-10-28T04:50:00Z', updated_at: new Date().toISOString() }];
  const notes = (got) => got.data.feed.filter((item) => item.kind === 'note').map((item) => item.text);
  const logs = { 'log_implement_111122223333444.log': note('this run'), 'log.log': note('another run of the session') };
  await withApp({ history, liveLogs: logs }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.log_path, '/Volumes/main/inspire/vol_root/logs/Acme/session_42/log_implement_111122223333444.log');
    assert.deepEqual(notes(got), ['this run']);
    assert.ok(!made.fetches.some((f) => f.path.endsWith('/log.log')), 'the run log was there, so the session log is never read');
  });
  await withApp({ history, liveLogs: { 'log.log': note('written by an agent that predates run logs') } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.data.log_path, '/Volumes/main/inspire/vol_root/logs/Acme/session_42/log.log');
    assert.deepEqual(notes(got), ['written by an agent that predates run logs']);
  });
  await withApp({ history: [{ ...history[0], implement_run_id: null }], liveLogs: logs }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.deepEqual(notes(got), ['another run of the session']);
    assert.ok(!made.fetches.some((f) => f.path.includes('log_implement_')), 'a version without a run id has no run log to read');
  });
  await withApp({ history, liveLogs: {} }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.feed, []);
  });
  const cut = { 'log_implement_111122223333444.log': `${note('this run')}${note('this run is building the dashboard').slice(0, 90)}` };
  await withApp({ history, liveLogs: cut }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.deepEqual(notes(got), ['this run'], 'a line the agent is still writing is left for the next poll');
  });
  const ended = { ...logs, 'log_implement_111122223333444.log': new TypeError('terminated') };
  await withApp({ history, liveLogs: ended }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, `a log read that ends early never fails the status: ${JSON.stringify(got.data)}`);
    assert.deepEqual(got.data.feed, []);
    assert.equal(got.data.latest.spec_version, 2, 'the rest of the status still arrives');
    assert.ok(!made.fetches.some((f) => f.path.endsWith('/log.log')), 'a run log that ended early is not swapped for the session log');
  });
});

test('a version whose run ended while it was still active is written failed once with the reason, offers no Stop the build, and a new version may replace it', async () => {
  const fresh = () => [{ session_id: '42', spec_version: 1, status: 'filling', spec_json: SPEC, use_case_id: 'N01-U01',
    implement_run_id: '5555555555555555', updated_at: new Date().toISOString() }];
  const history = fresh();
  const ended = { run_id: 5555555555555555, run_page_url: 'https://x/run/5555555555555555',
    state: { life_cycle_state: 'TERMINATED', result_state: 'CANCELED', state_message: 'Run cancelled by amr@x' } };
  const reason = 'the run building v1 ended (Stopped: Run cancelled by amr@x) while v1 was still filling';
  const endedWrites = (made) => made.sqlCalls.filter((c) => /^UPDATE .* SET status = 'failed'/.test(String(c.sql)) && /implement_run_id = :run/.test(String(c.sql)));
  for (const read of [`/api/inspire/implement/status?${Q}`, `/api/inspire/implement/history?${RAIL}`, `/api/inspire/implement/live?${Q}`]) {
    await withApp({ history: fresh(), implementRun: ended }, async (url, made) => {
      const got = await call(url, read);
      assert.equal(got.status, 200, `${read} ${JSON.stringify(got.data)}`);
      const writes = endedWrites(made);
      assert.equal(writes.length, 1, `${read} writes the ended run once`);
      const p = Object.fromEntries(writes[0].parameters.map((x) => [x.name, x.value]));
      assert.deepEqual([p.message, p.endedBy, p.was, p.run, p.v, p.uc], [reason, 'user', 'filling', '5555555555555555', '1', 'N01-U01'], read);
      const stalled = { run_id: '5555555555555555', run_url: 'https://x/run/5555555555555555', reason, ended: true, ended_by: 'user' };
      if (read.includes('/status')) {
        assert.deepEqual(got.data.stalled, stalled, 'the stopped build still reads as stopped, with its reason and its run');
        assert.deepEqual([got.data.latest.status, got.data.latest.status_message], ['failed', reason]);
      }
      if (read.includes('/history')) assert.deepEqual(got.data.latest.map((r) => [r.status, r.stalled]), [['failed', stalled]]);
      if (read.includes('/live')) assert.equal(got.data.targets.build, undefined, 'a cancelled build offers no Stop the build');
    });
  }
  await withApp({ history, implementRun: ended }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: SUBMIT });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.spec_version, 2);
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/runs/get?run_id=5555555555555555'));
  });
  await withApp({ history: fresh(), implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } }, async (url, made) => {
    await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(endedWrites(made).length, 0, 'a running build is never written as ended');
  });
  const recorded = [{ ...fresh()[0], status: 'failed', status_message: reason, ended_by: 'user' }];
  await withApp({ history: recorded, implementRun: ended }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.deepEqual(got.data.stalled, { run_id: '5555555555555555', run_url: 'https://x/run/5555555555555555', reason, ended: true, ended_by: 'user' },
      'read again after the write, it still reads as stopped');
    assert.equal(endedWrites(made).length, 0, 'and it is written only once');
  });
  await withApp({ history: [{ ...fresh()[0], status: 'failed', status_message: 'the notebook failed: division by zero' }] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.data.stalled, null, 'a build the agent wrote failed stays failed');
    assert.deepEqual(made.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/runs/get')).map((f) => f.path),
      ['/api/2.1/jobs/runs/get?run_id=5555555555555555'], 'its one run lookup finds the link to the run for the failed panel');
    assert.ok('build_run_url' in got.data);
  });
  await withApp({ history, implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } }, async (url) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.data.stalled, null);
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: SUBMIT });
    assert.equal(got.status, 409);
    assert.match(got.data.error, /still filling/);
  });
  await withApp({ history, implementRun: { error_code: 'PERMISSION_DENIED', message: 'no access' }, implementRunStatus: 403 }, async (url) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.data.stalled, null, 'a run Inspire cannot read is not called stopped while the version is still recent');
  });
  const old = [{ ...history[0], implement_run_id: null, updated_at: '2026-01-01T00:00:00Z' }];
  await withApp({ history: old }, async (url, made) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.match(status.data.stalled.reason, /^v1 has been filling with no progress since 2026-01-01T00:00:00.000Z/);
    assert.ok(!made.fetches.some((f) => f.path.startsWith('/api/2.1/jobs/runs/get')), 'a version without a run id is never looked up');
  });
  await withApp({ history: [{ ...history[0], status: 'ready' }] }, async (url, made) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.data.stalled, null);
    await call(url, `/api/inspire/implement/history?${RAIL}`);
    assert.ok(!made.fetches.some((f) => f.path.startsWith('/api/2.1/jobs/runs/get')), 'a finished version never costs a run lookup');
  });
});

test('an invalid spec is 400 and does not launch a job', async () => {
  const { app, jobs } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { use_case_id: '' } },
    });
    assert.equal(got.status, 400);
    assert.equal(jobs.length, 0);
  } finally {
    await srv.close();
  }
});

const ALERT_SPEC = {
  ...SPEC,
  outputs: { dashboard: true, alert: true, alert_recipients: ['owner@x.com'], alert_destinations: [{ id: '1234abcd-ef', name: 'Slack' }] },
};

test('submit on a table from an older build adds the alert columns before it writes the spec', async () => {
  const { app, sqlCalls, altered, state } = makeApp();
  state.implementColumns = state.implementColumns.filter((c) => c !== 'alert_id' && c !== 'alert_url');
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: ALERT_SPEC },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(altered, [{ table: '`main`.`inspire`.`__inspire_implement`', columns: [['alert_id', 'STRING'], ['alert_url', 'STRING']] }]);
    const describeAt = sqlCalls.findIndex((c) => String(c.sql).startsWith('DESCRIBE TABLE'));
    const insertAt = sqlCalls.findIndex((c) => String(c.sql).includes('INSERT INTO'));
    assert.ok(describeAt >= 0 && insertAt > describeAt);
    const stored = JSON.parse(sqlCalls[insertAt].parameters.find((p) => p.name === 'spec').value);
    assert.equal(stored.outputs.alert_tiers, 'act_now');
    assert.equal(stored.outputs.alert_threshold, 1);
    assert.deepEqual(stored.outputs.alert_recipients, ['owner@x.com']);
  } finally {
    await srv.close();
  }
});

test('submit on a current table alters nothing', async () => {
  const { app, altered } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(altered, []);
  } finally {
    await srv.close();
  }
});

test('an alert with nobody to notify is 400 and launches nothing', async () => {
  const { app, jobs } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { ...SPEC, outputs: { dashboard: true, alert: true } } },
    });
    assert.equal(got.status, 400);
    assert.match(got.data.error, /at least one recipient email or notification destination/);
    assert.equal(jobs.length, 0);
  } finally {
    await srv.close();
  }
});

test('history on a table from an older build reads the missing columns as empty instead of failing', async () => {
  const history = [{ spec_version: 1, status: 'ready', use_case_id: 'N01-U01', spec_json: JSON.stringify(SPEC), dashboard_id: 'd1' }];
  const { app, sqlCalls, state, altered } = makeApp({ history });
  state.implementColumns = state.implementColumns.filter((c) => c !== 'alert_id' && c !== 'alert_url');
  const srv = await listen(app);
  try {
    const got = await call(srv.url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.history.length, 1);
    assert.equal(got.data.history[0].dashboard_id, 'd1');
    const selects = sqlCalls.filter((c) => String(c.sql).startsWith('SELECT') && String(c.sql).includes('__inspire_implement'));
    assert.ok(selects.some((c) => c.sql.includes('NULL AS `alert_id`') && c.sql.includes('NULL AS `alert_url`')));
    assert.deepEqual(altered, [], 'a read never alters the table');
  } finally {
    await srv.close();
  }
});

test('preflight blocks an alert only when the alert was asked for and alerts are unavailable', async () => {
  const { app } = makeApp({ alertsOk: false });
  const srv = await listen(app);
  try {
    const asked = await call(srv.url, `/api/inspire/implement/preflight?${Q}&${OUT}&alert=1`);
    assert.equal(asked.status, 200);
    assert.equal(asked.data.ok, false);
    assert.equal(asked.data.checks.alerts.ok, false);
    assert.equal(asked.data.features.alerts, false);
    const notAsked = await call(srv.url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(notAsked.data.ok, true, JSON.stringify(notAsked.data));
    assert.equal(notAsked.data.features.alerts, false);
  } finally {
    await srv.close();
  }
  const ok = makeApp();
  const srv2 = await listen(ok.app);
  try {
    const got = await call(srv2.url, `/api/inspire/implement/preflight?${Q}&${OUT}&alert=1`);
    assert.equal(got.data.ok, true);
    assert.equal(got.data.features.alerts, true);
  } finally {
    await srv2.close();
  }
});

test('destinations list every page, drop entries without a usable id, and pass errors through', async () => {
  const { app } = makeApp({
    destinations: [
      { results: [{ id: '1234abcd-ef01', display_name: 'Churn Slack', destination_type: 'SLACK' }, { id: 'x', display_name: 'bad' }], next_page_token: '1' },
      { results: [{ id: 'abcdef12-3456', destination_type: 'MICROSOFT_TEAMS' }] },
    ],
  });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/destinations');
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.destinations, [
      { id: '1234abcd-ef01', name: 'Churn Slack', type: 'slack' },
      { id: 'abcdef12-3456', name: 'abcdef12-3456', type: 'microsoft_teams' },
    ]);
  } finally {
    await srv.close();
  }
  const denied = makeApp({ destinations: { message: 'User is not authorized' }, destinationsStatus: 403 });
  const srv2 = await listen(denied.app);
  try {
    const got = await call(srv2.url, '/api/inspire/implement/destinations');
    assert.equal(got.status, 403);
    assert.match(got.data.error, /not authorized/);
  } finally {
    await srv2.close();
  }
});

test('an Implement page re-run is a preview of the notebook task only, so the alert task never fires on it', async () => {
  const history = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(ALERT_SPEC),
    genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25' }]) }];
  const { app, fetches } = makeApp({ history });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '10' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const runNow = fetches.find((f) => f.path === '/api/2.1/jobs/run-now');
    assert.deepEqual(JSON.parse(runNow.opts.body), { job_id: 77, notebook_params: { top_k: '10', run_profile: 'preview' }, only: ['inspire_task'] });
  } finally {
    await srv.close();
  }
});

const TWO_TABLES = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.returns' };

test('submit refuses to remove the primary table and never writes or launches', async () => {
  const { app, jobs, sqlCalls } = makeApp({ useCase: TWO_TABLES });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42',
        spec: { ...SPEC, data: { removed_tables: ['main.s.orders'] } } },
    });
    assert.equal(got.status, 400);
    assert.match(got.data.error, /main\.s\.orders is the primary table of this use case; swap it instead of removing it/);
    assert.equal(jobs.length, 0);
    assert.ok(!sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')));
  } finally {
    await srv.close();
  }
});

test('submit accepts removing a side table and stores it in the spec', async () => {
  const { app, sqlCalls } = makeApp({ useCase: TWO_TABLES });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42',
        spec: { ...SPEC, data: { removed_tables: ['main.s.returns'] } } },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const insert = sqlCalls.find((c) => String(c.sql).includes('INSERT INTO'));
    const spec = JSON.parse(insert.parameters.find((p) => p.name === 'spec').value);
    assert.deepEqual(spec.data.removed_tables, ['main.s.returns']);
  } finally {
    await srv.close();
  }
});

test('submit 404s for a use case that is not in the session', async () => {
  const { app, jobs } = makeApp({ useCase: null });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 404);
    assert.match(got.data.error, /No use case N01-U01 in this session/);
    assert.equal(jobs.length, 0);
  } finally {
    await srv.close();
  }
});

test('plan returns the change list for the pending edit without writing or launching', async () => {
  const built = { spec_version: 2, status: 'ready', use_case_id: 'N01-U01', dashboard_id: 'd1', notebook_path: '/W/nb',
    asset_status: { notebook: { state: 'ready', spec_version: 2, result_history: 1 } },
    spec_json: { ...SPEC, outputs: { dashboard: true } } };
  const { app, jobs, sqlCalls } = makeApp({ useCase: TWO_TABLES, history: [built] });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/implement/plan', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42',
        spec: { ...SPEC, based_on_version: 2, outputs: { dashboard: true, genie_space: true } } },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.spec_version, 3);
    assert.equal(got.data.based_on_version, 2);
    assert.deepEqual(got.data.summary.classes, ['outputs']);
    assert.deepEqual(got.data.summary.build, ['genie_space']);
    assert.equal(got.data.summary.refill, false);
    assert.equal(got.data.unchanged, false);
    assert.equal(jobs.length, 0);
    assert.ok(!sqlCalls.some((c) => /INSERT INTO|CREATE TABLE/.test(String(c.sql))));
  } finally {
    await srv.close();
  }
});

test('plan reports the same refusals submit would, and says when nothing changed without refusing', async () => {
  const built = { spec_version: 2, status: 'ready', use_case_id: 'N01-U01', dashboard_id: 'd1', notebook_path: '/W/nb',
    spec_json: { ...SPEC, outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' } } };
  const { app, jobs, sqlCalls } = makeApp({ useCase: TWO_TABLES, history: [built] });
  const srv = await listen(app);
  try {
    const body = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { ...SPEC, based_on_version: 2 } };
    const same = await call(srv.url, '/api/inspire/implement/plan', { method: 'POST', body });
    assert.equal(same.status, 200, JSON.stringify(same.data));
    assert.equal(same.data.unchanged, true);
    assert.equal(same.data.based_on_version, 2);
    const refused = await call(srv.url, '/api/inspire/implement/submit', { method: 'POST', body });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /^nothing changed since version 2, the last built version, so there is nothing new to build/);
    assert.equal(jobs.length, 0);
    assert.ok(!sqlCalls.some((c) => /INSERT INTO/.test(String(c.sql))), 'an unchanged spec writes no version');
    const primary = await call(srv.url, '/api/inspire/implement/plan', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42',
        spec: { ...SPEC, based_on_version: 2, data: { removed_tables: ['main.s.orders'] } } },
    });
    assert.equal(primary.status, 400);
    assert.match(primary.data.error, /is the primary table/);
  } finally {
    await srv.close();
  }
});

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

const NOT_MINE_SCHEMA = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'amr@x' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
];
const EXISTING = [...NOT_MINE_SCHEMA,
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'analysts', mine: 'true', me: 'amr@x' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
  { level: 'table', privilege: 'MODIFY', principal: 'analysts', mine: 'true', me: 'amr@x' },
  { level: 'table', privilege: 'SELECT', principal: 'analysts', mine: 'true', me: 'amr@x' }];
const KEY_COLUMNS = ['use_case_id', 'run_id', 'as_of_date', 'score'].map((column_name) => ({ column_name }));
const CHECK = `/api/inspire/implement/output-check?${Q}&table=main.inspire.churn_out`;

test('in the App the output check names the identity Inspire builds as, not the signed-in person', async () => {
  const spRows = NOT_MINE_SCHEMA.map((r) => ({ ...r, me: 'sp-1234' }));
  await withApp({ access: spRows, forwardedToken: 'person-token', forwardedEmail: 'amr@x' }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.write.detail,
      'sp-1234, the identity Inspire builds as, needs USE SCHEMA on main.inspire and CREATE TABLE on main.inspire to create main.inspire.churn_out');
  });
});

test('the output check passes a new table the user can create and names what is missing otherwise', async () => {
  await withApp({}, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.ok, true);
    assert.equal(got.data.identity, 'amr@x');
    assert.deepEqual(got.data.write, { ok: true, detail: 'you can create main.inspire.churn_out' });
    assert.deepEqual(got.data.safety, { ok: true, detail: 'main.inspire.churn_out is new; the First run creates it' });
  });
  await withApp({ access: NOT_MINE_SCHEMA }, async (url, made) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.write.detail, 'you need USE SCHEMA on main.inspire and CREATE TABLE on main.inspire to create main.inspire.churn_out');
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('COUNT_IF')), 'no row count when the user cannot write');
  });
  await withApp({}, async (url) => {
    const got = await call(url, `/api/inspire/implement/output-check?${Q}&table=main.out`);
    assert.equal(got.status, 400);
    assert.match(got.data.error, /result_table 'main.out' must be catalog.schema.table/);
  });
});

test('the output check refuses an existing table that is not an Inspire result table or that holds other use cases', async () => {
  await withApp({ access: EXISTING, columns: [{ column_name: 'order_id' }] }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.write.ok, true);
    assert.match(got.data.safety.detail, /is not an Inspire result table \(it has no use_case_id, run_id and as_of_date\)/);
  });
  await withApp({ access: EXISTING, columns: KEY_COLUMNS, others: 4 }, async (url, made) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, false);
    assert.match(got.data.safety.detail, /already holds rows of other use cases/);
    assert.doesNotMatch(got.data.safety.detail, /\b4\b/, 'no row count of a table the person may not read');
    const counted = made.sqlCalls.find((c) => String(c.sql).includes('COUNT_IF'));
    assert.deepEqual(counted.parameters, [{ name: 'uc', value: 'N01-U01', type: 'STRING' }]);
  });
  await withApp({ access: EXISTING, columns: KEY_COLUMNS, others: 0 }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, true);
    assert.equal(got.data.safety.detail, "main.inspire.churn_out holds only this use case's rows");
    assert.equal(got.data.grant.ok, false);
  });
  await withApp({ access: EXISTING, columns: [] }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.ok, true);
    assert.match(got.data.safety.detail, /its columns could not be read, so Inspire could not check whose rows it holds/);
  });
});

test('a result table another Discover session\'s use case with the same id already uses is refused, at the check and at submit', async () => {
  const taken = 'main.inspire.churn_out already holds the results of use case N01-U01 of session 2222222222222222222; give each use '
    + 'case its own result table so its outputs show only its rows';
  await withApp({ access: EXISTING, columns: KEY_COLUMNS, others: 0, resultTableHolders: [{ session_id: '2222222222222222222', use_case_id: 'N01-U01' }] },
    async (url, made) => {
      const got = await call(url, CHECK);
      assert.equal(got.data.ok, false);
      assert.deepEqual(got.data.safety, { ok: false, detail: taken }, 'the same use case id in another session is another use case');
      const asked = made.sqlCalls.find((c) => String(c.sql).includes('held AS'));
      assert.deepEqual(asked.parameters, [{ name: 't', value: 'main.inspire.churn_out', type: 'STRING' }]);
      assert.match(asked.sql, /FROM `main`\.`inspire`\.`__inspire_implement`/);
      assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('COUNT_IF')), 'a held table is refused before its rows are counted');
      const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
      assert.equal(pre.data.checks.output.ok, false);
      assert.match(pre.data.checks.output.detail, /already holds the results of use case N01-U01 of session 2222222222222222222/);
      const sent = await call(url, '/api/inspire/implement/submit', {
        method: 'POST',
        body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
      });
      assert.deepEqual([sent.status, sent.data.error], [403, taken]);
      assert.equal(made.jobs.length, 0, 'no job starts');
      assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')), 'no version is written');
    });
  await withApp({ access: EXISTING, columns: KEY_COLUMNS, resultTableHolders: [{ session_id: '42', use_case_id: 'N01-U01' }] }, async (url) => {
    const got = await call(url, CHECK);
    assert.deepEqual([got.data.ok, got.data.safety.detail], [true, "main.inspire.churn_out holds only this use case's rows"],
      'the use case that named the table first keeps it');
  });
  await withApp({ resultTableHolders: [{ session_id: '42', use_case_id: 'N02-U01' }] }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.data.safety.ok, false);
    assert.match(got.data.safety.detail, /holds the results of use case N02-U01 of session 42/, 'another use case of the same session is refused too');
  });
  await withApp({ holderError: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`__inspire_implement` cannot be found.' }, async (url) => {
    const got = await call(url, CHECK);
    assert.deepEqual([got.status, got.data.ok], [200, true], 'before the first MVP there is no implement table, so nothing holds the table');
  });
  await withApp({ holderError: 'warehouse stopped' }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.status, 500);
    assert.match(got.data.error, /warehouse stopped/, 'an unexpected error is never read as "nobody holds it"');
  });
});

test('the holder statement reads each use case\'s latest version and orders by the first version that named the table', () => {
  const s = I.resultTableHolderStatement('`main`.`inspire`.`__inspire_implement`', '`Main`.inspire.`Churn_Out`');
  assert.deepEqual(s.parameters, [{ name: 't', value: 'main.inspire.churn_out', type: 'STRING' }]);
  assert.match(s.sql, /ROW_NUMBER\(\) OVER \(PARTITION BY session_id, use_case_id ORDER BY spec_version DESC\) AS latest/);
  assert.match(s.sql, /WHERE latest = 1 AND t = :t/, 'a use case that moved to another table no longer holds this one');
  assert.match(s.sql, /ORDER BY MIN\(n\.created_at\), n\.session_id, n\.use_case_id LIMIT 1/);
  assert.equal(I.resultTableHolderProblem('main.s.t', null, '42', 'N01-U01'), '');
  assert.equal(I.resultTableHolderProblem('main.s.t', { session_id: '42', use_case_id: 'N01-U01' }, '42', 'N01-U01'), '');
  assert.equal(I.resultTableHolderProblem('main.s.t', { session_id: '', use_case_id: '' }, '42', 'N01-U01'), '');
  assert.match(I.resultTableHolderProblem('`main`.`s`.`t`', { session_id: 43, use_case_id: 'N01-U01' }, '42', 'N01-U01'),
    /^main\.s\.t already holds the results of use case N01-U01 of session 43;/);
});

const SHARED = 'main.inspire.n01_u01_out';
const OWN = 'main.inspire.n01_u01_s42_out';
const OTHER_HOLDS = { session_id: '2222222222222222222', use_case_id: 'N01-U01' };
const MOVED = `results move to ${OWN}, because ${SHARED} holds the results of use case N01-U01 of session 2222222222222222222; `
  + 'earlier versions of this use case wrote there under the old shared name';

test('the backend names a use case\'s Inspire database result table exactly as the wizard does', async () => {
  const w = await import(require('node:url').pathToFileURL(require('node:path').resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
  const cases = [['main.inspire', 'N01-U01', '42'], ['main.inspire', 'N01-U01', ' 42 '], ['main.inspire', 'N01-U01', 'x'], ['', 'N01-U01', '42'],
    ['main.inspire', '--', '42'], ['c.s', `N01-${'U'.repeat(60)}`, '7'], ['c.s', 'n05 u02', '9']];
  for (const [db, uc, sid] of cases) assert.equal(I.defaultResultTable(db, uc, sid), w.inspireSchemaResultTable(db, uc, sid), JSON.stringify([db, uc, sid]));
  assert.equal(I.defaultResultTable('main.inspire', 'N01-U01', '42'), OWN);
  assert.equal(I.sharedDefaultResultTable('main.inspire', 'N01-U01'), SHARED);
});

test('only a carried result table under the old shared name that another use case holds moves to this session\'s own table', () => {
  const carried = [{ spec_version: 2, spec_json: { config: { result_table: SHARED } } }];
  const args = { inspireDatabase: 'main.inspire', sessionId: '42', useCaseId: 'N01-U01', history: carried };
  assert.deepEqual(I.resultTableMove(SHARED, OTHER_HOLDS, args), { from: SHARED, to: OWN, detail: MOVED });
  assert.equal(I.resultTableMove('`Main`.`inspire`.`N01_U01_OUT`', OTHER_HOLDS, args).to, OWN, 'case and backticks do not hide the old name');
  assert.equal(I.resultTableMove(SHARED, { session_id: '42', use_case_id: 'N02-U01' }, args).to, OWN, 'another use case of this session holds it');
  assert.equal(I.resultTableMove(SHARED, null, args), null, 'nobody else holds it, so it stays');
  assert.equal(I.resultTableMove(SHARED, { session_id: '42', use_case_id: 'N01-U01' }, args), null, 'this use case named it first, so it keeps it');
  assert.equal(I.resultTableMove(SHARED, OTHER_HOLDS, { ...args, history: [] }), null, 'a name no earlier version used was typed, so it is kept and refused');
  assert.equal(I.resultTableMove(SHARED, OTHER_HOLDS, { ...args, history: [{ spec_json: { config: { result_table: 'main.inspire.churn_out' } } }] }), null,
    'earlier versions wrote elsewhere, so the shared name was typed now');
  const typed = [{ spec_json: { config: { result_table: 'main.inspire.churn_out' } } }];
  assert.equal(I.resultTableMove('main.inspire.churn_out', OTHER_HOLDS, { ...args, history: typed }), null, 'a name the user chose is never moved');
  const theirs = [{ spec_json: { config: { result_table: 'main.inspire.n02_u01_out' } } }];
  assert.equal(I.resultTableMove('main.inspire.n02_u01_out', OTHER_HOLDS, { ...args, history: theirs }), null, 'another use case\'s old name is not this one\'s default');
  const elsewhere = [{ spec_json: { config: { result_table: 'other.db.n01_u01_out' } } }];
  assert.equal(I.resultTableMove('other.db.n01_u01_out', OTHER_HOLDS, { ...args, history: elsewhere }), null, 'the old name in another schema was chosen');
  assert.equal(I.resultTableMove(SHARED, OTHER_HOLDS, { ...args, sessionId: 'abc' }), null, 'no session number, no own name to move to');
  assert.deepEqual(I.withResultTable({ config: { result_table: SHARED, widgets: { top_k: '5' } }, outputs: {} }, OWN),
    { config: { result_table: OWN, widgets: { top_k: '5' } }, outputs: {} });
});

test('a Rebuild that carries the old shared result table another use case holds moves to its own table, says so at every check, and builds there', async () => {
  const spec = { ...SPEC, config: { ...SPEC.config, result_table: SHARED } };
  const history = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', spec_json: JSON.stringify(spec), dashboard_id: 'd1' }];
  await withApp({ history, resultTableHolders: { [SHARED]: [OTHER_HOLDS] } }, async (url, made) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=${SHARED}`);
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.equal(pre.data.checks.output.ok, true, JSON.stringify(pre.data.checks.output));
    assert.ok(pre.data.checks.output.detail.startsWith(`${MOVED}; `), pre.data.checks.output.detail);
    assert.deepEqual(pre.data.result_table_moved, { from: SHARED, to: OWN, detail: MOVED });
    const checked = await call(url, `/api/inspire/implement/output-check?${Q}&table=${SHARED}`);
    assert.deepEqual([checked.data.ok, checked.data.table, checked.data.result_table_moved.to], [true, OWN, OWN]);
    const body = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec };
    const planned = await call(url, '/api/inspire/implement/plan', { method: 'POST', body });
    assert.equal(planned.status, 200, JSON.stringify(planned.data));
    assert.deepEqual(planned.data.summary.result_table_moved, { from: SHARED, to: OWN, detail: MOVED });
    assert.ok(planned.data.summary.classes.includes('config'), 'a new table is a config change, so the notebook refills it');
    assert.equal(made.jobs.length, 0, 'the plan starts nothing');
    const sent = await call(url, '/api/inspire/implement/submit', { method: 'POST', body });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.summary.result_table_moved.to, OWN);
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(JSON.parse(insert.parameters.find((p) => p.name === 'spec').value).config.result_table, OWN, 'the new version writes to its own table');
    assert.equal(made.jobs.length, 1);
  });
});

test('the old shared name typed by hand, or held by this use case, is never moved', async () => {
  const spec = { ...SPEC, config: { ...SPEC.config, result_table: SHARED } };
  const body = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec };
  await withApp({ resultTableHolders: { [SHARED]: [OTHER_HOLDS] } }, async (url, made) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=${SHARED}`);
    assert.equal(pre.data.checks.output.ok, false);
    assert.equal(pre.data.result_table_moved, undefined);
    const sent = await call(url, '/api/inspire/implement/submit', { method: 'POST', body });
    assert.equal(sent.status, 403);
    assert.match(sent.data.error, /^main\.inspire\.n01_u01_out already holds the results of use case N01-U01 of session 2222222222222222222;/);
    assert.equal(made.jobs.length, 0);
  });
  const history = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', spec_json: JSON.stringify(spec), dashboard_id: 'd1' }];
  await withApp({ history, resultTableHolders: { [SHARED]: [{ session_id: '42', use_case_id: 'N01-U01' }] } }, async (url, made) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=${SHARED}`);
    assert.equal(pre.data.result_table_moved, undefined, 'the use case that named the table first keeps it');
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('held AS') && c.parameters.some((p) => p.value === OWN)));
  });
  await withApp({ history }, async (url, made) => {
    await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(made.sqlCalls.filter((c) => String(c.sql).includes('held AS')).length, 1, 'any other name costs no extra query');
  });
});

const TRAINS = { id: 'N01-U01', use_case: 'Predict churn', code_structure_mandate: 'Execution pattern: family B (classification).', genie_instruction: '' };
const WRITES_NO_MODEL = [...NOT_MINE_SCHEMA,
  { level: 'schema', privilege: 'USE_SCHEMA', principal: 'amr@x', mine: 'true', me: 'amr@x' },
  { level: 'schema', privilege: 'CREATE_TABLE', principal: 'amr@x', mine: 'true', me: 'amr@x' }];

test('a use case that trains a model is checked for CREATE MODEL where its model is registered, before anything is built', async () => {
  await withApp({ useCase: TRAINS, access: WRITES_NO_MODEL }, async (url) => {
    const got = await call(url, CHECK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual([got.data.ok, got.data.write.ok, got.data.safety.ok], [false, true, true]);
    assert.deepEqual(got.data.model, { ok: false, detail: 'you need CREATE MODEL on main.inspire to register the model main.inspire.churn_out_model' });
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(pre.data.ok, false);
    assert.equal(pre.data.checks.output.ok, true);
    assert.deepEqual(pre.data.checks.model, got.data.model);
  });
  await withApp({ useCase: TRAINS }, async (url, made) => {
    const got = await call(url, CHECK);
    assert.deepEqual([got.data.ok, got.data.model], [true, { ok: true, detail: 'you can register the model main.inspire.churn_out_model' }]);
    assert.equal(made.sqlCalls.filter((c) => String(c.sql).includes('system.information_schema.catalogs')).length, 1);
  });
  await withApp({ access: WRITES_NO_MODEL }, async (url) => {
    const got = await call(url, CHECK);
    assert.deepEqual([got.data.ok, 'model' in got.data], [true, false]);
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.deepEqual([pre.data.ok, 'model' in pre.data.checks], [true, false]);
  });
  await withApp({ useCase: { ...TRAINS, code_structure_mandate: 'Execution pattern: family F (rules).' }, access: WRITES_NO_MODEL }, async (url) => {
    assert.equal((await call(url, CHECK)).data.ok, true);
  });
});

test('a model name set in another schema is checked in that schema, not next to the result table', async () => {
  const owner = [{ level: 'catalog', privilege: 'OWNER', principal: 'amr@x', mine: 'true', me: 'amr@x' },
    { level: 'schema', privilege: 'OWNER', principal: 'amr@x', mine: 'true', me: 'amr@x' }];
  await withApp({ useCase: TRAINS, access: owner, accessBySchema: { models: WRITES_NO_MODEL } }, async (url, made) => {
    const got = await call(url, `${CHECK}&model_name=main.models.churn`);
    assert.deepEqual([got.data.ok, got.data.write.ok], [false, true]);
    assert.equal(got.data.model.detail, 'you need CREATE MODEL on main.models to register the model main.models.churn');
    const asked = made.sqlCalls.filter((c) => String(c.sql).includes('system.information_schema.catalogs'))
      .map((c) => c.parameters.find((p) => p.name === 's').value).sort();
    assert.deepEqual(asked, ['inspire', 'models']);
  });
  await withApp({ useCase: TRAINS, access: WRITES_NO_MODEL, accessBySchema: { models: owner } }, async (url) => {
    const got = await call(url, `${CHECK}&model_name=main.models.churn`);
    assert.deepEqual([got.data.ok, got.data.model.ok], [true, true]);
    const bad = await call(url, `${CHECK}&model_name=main.churn`);
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /^model_name 'main.churn' must be catalog.schema.table/);
  });
});

test('preflight checks the grant only when sharing, and names a warehouse that cannot run statements', async () => {
  await withApp({ access: EXISTING, columns: KEY_COLUMNS }, async (url) => {
    const shared = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&share=1`);
    assert.equal(shared.data.ok, true, 'a share the person cannot make does not stop the build');
    assert.equal(shared.data.checks.output.ok, true);
    assert.match(shared.data.checks.result_grant.detail, /you cannot share main.inspire.churn_out/);
    assert.equal(shared.data.checks.result_grant.warn, 'Build still runs, without the sharing. Share the result table once you can.');
    const solo = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(solo.data.ok, true, JSON.stringify(solo.data));
    assert.equal(solo.data.checks.result_grant, undefined);
  });
  await withApp({ accessError: 'PERMISSION_DENIED: You do not have CAN_USE on warehouse wh1' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(got.status, 200);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.checks.warehouse.detail, 'wh1 could not run a statement for you: PERMISSION_DENIED: You do not have CAN_USE on warehouse wh1');
    assert.equal(got.data.checks.output.ok, false);
  });
  await withApp({}, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}`);
    assert.equal(got.status, 400);
    assert.match(got.data.error, /must be catalog.schema.table/);
  });
});

test('preflight refuses an App name used by another App, updates this use case\'s App, and never blocks a new App on a guessed Apps limit', async () => {
  await withApp({ appExists: true, app: { name: 'churn-desk', description: 'Finance team tool' } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.checks.app_name.detail, "'churn-desk' is used by another App in this workspace; pick another name");
  });
  await withApp({ appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): churn' } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.ok, true, JSON.stringify(got.data));
    assert.match(got.data.checks.apps.detail, /no new App is needed/);
    assert.ok(!made.fetches.some((f) => f.path.includes('/api/2.0/apps?page_size=100')), 'no quota count for an App that exists');
  });
  const many = { apps: Array.from({ length: 163 }, (_, i) => ({ name: `app-${i}` })) };
  await withApp({ appsList: many }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.checks.app_name.ok, true);
    assert.deepEqual(got.data.checks.apps, { ok: true, detail: 'Inspire creates a new App; if Databricks has no room for it, the build stops with the reason Databricks gives' });
    assert.equal(got.data.ok, true, 'no guessed Apps limit blocks a workspace that already holds 163 Apps');
    assert.ok(!made.fetches.some((f) => f.path.includes('/api/2.0/apps?page_size=100')), 'Inspire never counts the Apps against a guessed limit');
  });
  await withApp({ spacesOk: false }, async (url) => {
    const asked = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&genie=1`);
    assert.deepEqual([asked.data.ok, asked.data.checks.genie_spaces.ok], [false, false]);
    const notAsked = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}`);
    assert.equal(notAsked.data.ok, true);
  });
});

test('preflight names the next free App name when another App holds the name, and names none it could not check', async () => {
  const other = (name) => ({ name, description: 'Finance team tool' });
  const taken = { 'churn-desk': other('churn-desk'), 'churn-desk-2': other('churn-desk-2') };
  await withApp({ appsByName: taken }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.ok, false);
    assert.equal(got.data.checks.app_name.detail, "'churn-desk' is used by another App in this workspace; pick another name");
    assert.equal(got.data.checks.app_name.name, 'churn-desk');
    assert.equal(got.data.checks.app_name.suggested, 'churn-desk-3');
    assert.deepEqual(made.fetches.map((f) => f.path).filter((p) => /\/api\/2\.0\/apps\/churn/.test(p)),
      ['/api/2.0/apps/churn-desk', '/api/2.0/apps/churn-desk-2', '/api/2.0/apps/churn-desk-3']);
  });
  await withApp({ appsByName: { 'churn-desk': other('churn-desk') } }, async (url) => {
    const free = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk-2`);
    assert.equal(free.data.checks.app_name.ok, true);
    assert.equal(free.data.checks.app_name.suggested, undefined);
  });
  await withApp({ appsByName: { 'churn-desk': other('churn-desk'), 'churn-desk-2': { error_code: 'PERMISSION_DENIED', status_code: 403 } } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.checks.app_name.ok, false);
    assert.equal(got.data.checks.app_name.suggested, undefined, 'a name Inspire could not check is never offered as free');
  });
  const all = Object.fromEntries(['churn-desk', ...[2, 3, 4, 5, 6].map((n) => `churn-desk-${n}`)].map((n) => [n, other(n)]));
  await withApp({ appsByName: all }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.checks.app_name.ok, false);
    assert.equal(got.data.checks.app_name.suggested, undefined);
  });
});

const SP_ROW = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: mine ? 'true' : 'false', me: 'inspire-sp' });
const SP_INSTALL = [SP_ROW('catalog', 'OWNER', 'amr@x', false), SP_ROW('schema', 'OWNER', 'amr@x', false),
  SP_ROW('table', 'OWNER', 'inspire-sp', true), SP_ROW('catalog', 'USE_CATALOG', 'inspire-sp', true),
  SP_ROW('schema', 'USE_SCHEMA', 'inspire-sp', true), SP_ROW('schema', 'CREATE_TABLE', 'inspire-sp', true)];
const SP_STATE = {
  access: SP_INSTALL,
  columns: KEY_COLUMNS,
  others: 0,
  me: { userName: 'inspire-sp', groups: [{ display: 'users' }] },
  warehousePermissions: { access_control_list: [{ service_principal_name: 'inspire-sp', all_permissions: [{ permission_level: 'CAN_USE' }] },
    { group_name: 'admins', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] },
};
const CANNOT_MANAGE = 'Inspire cannot manage wh1, so it cannot give a new App access to it: ask the warehouse owner to grant Inspire CAN MANAGE on it, or re-run the Inspire installer';

test('preflight disables a new App up front when its service principal could not read the table or Inspire cannot manage the warehouse', async () => {
  const gaps = [{ privilege: 'USE CATALOG', level: 'catalog', object: '`main`', owner: 'amr@x' },
    { privilege: 'USE SCHEMA', level: 'schema', object: '`main`.`inspire`', owner: 'amr@x' }];
  const principals = encodeURIComponent(JSON.stringify(['amr@x', 'planners']));
  await withApp(SP_STATE, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk&share=1&principals=${principals}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.checks.app_access,
      { ok: false, detail: `${I.appAccessMessage('main.inspire.churn_out', gaps, 'inspire-sp')}; ${CANNOT_MANAGE}` });
    assert.equal(got.data.ok, false);
    assert.equal(got.data.checks.result_grant.ok, true);
    const warehouseWarning = I.shareWarehouseWarnings({ ok: false }, ['amr@x', 'planners'], ['the dashboard'], 'wh1')[0];
    assert.match(warehouseWarning, /^amr@x and planners need CAN USE on wh1 to open the dashboard, because they query with their own access/);
    assert.equal(got.data.checks.result_grant.warn, `${I.accessGapMessage('planners', gaps)} ${warehouseWarning}`);
    assert.ok(made.fetches.some((f) => f.path === '/api/2.0/permissions/sql/warehouses/wh1'));
    const genie = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&share=1&genie=1&principals=${principals}`);
    assert.match(genie.data.checks.result_grant.warn, /to open the dashboard and the Genie Agent, because/);
    const appOnly = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&share=1&dashboard=0&principals=${principals}`);
    assert.equal(appOnly.data.checks.result_grant.warn, I.accessGapMessage('planners', gaps), 'no dashboard or Genie Agent, so no warehouse access to ask for');
    assert.deepEqual(appOnly.data.new_app, got.data.checks.app_access, 'with no App asked for, the new App check is still answered');
    assert.equal(appOnly.data.checks.app_access, undefined, 'and it stays out of the checks, so a build without an App is not stopped (must-exclude)');
    assert.equal(got.data.new_app, undefined, 'an App asked for is checked in the checks only (must-exclude)');
    const check = await call(url, CHECK);
    assert.equal(check.data.ok, true, 'App access never blocks the Data step');
    assert.equal(check.data.app.ok, false);
    assert.equal(check.data.grant.warn, undefined);
  });
  const managed = {
    ...SP_STATE,
    access: [...SP_INSTALL, SP_ROW('catalog', 'MANAGE', 'inspire-sp', true)],
    warehousePermissions: { access_control_list: [{ service_principal_name: 'inspire-sp', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] },
  };
  await withApp(managed, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk&share=1&principals=${principals}`);
    assert.equal(got.data.ok, true, JSON.stringify(got.data));
    assert.equal(got.data.checks.app_access.ok, true);
    assert.equal(got.data.checks.result_grant.warn, undefined);
  });
  await withApp({ ...SP_STATE, warehousePermissionsStatus: 403, warehousePermissions: { message: 'no' },
    me: { userName: 'inspire-sp', groups: [{ display: 'admins' }] } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.match(got.data.checks.app_access.detail, new RegExp(`${CANNOT_MANAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });
  await withApp({ ...SP_STATE, appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): churn' } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&app_name=churn-desk`);
    assert.equal(got.data.checks.app_access, undefined, 'an App that exists is updated, so nothing is attached or granted to a new one');
    assert.equal(got.data.ok, true, JSON.stringify(got.data));
  });
  await withApp(SP_STATE, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&share=1&principals=not-json`);
    assert.equal(got.status, 400);
    assert.equal(got.data.error, 'principals must be a JSON list of principal names');
    const obj = await call(url, `/api/inspire/implement/preflight?${Q}&${OUT}&share=1&principals=${encodeURIComponent('{"a":1}')}`);
    assert.equal(obj.status, 400);
  });
});

test('context returns the execution family, whether it trains a model, the Deep evidence and the workspace features', async () => {
  const evidence = { tables: { 'main.s.orders': { rows: 1200, sampled: false, date_ranges: { order_date: { min: '2024-01-01', max: '2024-12-31' } } } } };
  const cases = [['Execution pattern: family E, anomaly detection.\nRun pattern: x.', 'E', false], ['Execution pattern: family B, classification.', 'B', true], ['', '', null]];
  for (const [mandate, family, trains] of cases) {
    await withApp({ useCase: { id: 'N01-U01', use_case: 'Predict churn', code_structure_mandate: mandate, data_evidence: JSON.stringify(evidence), genie_instruction: '' }, spacesOk: false }, async (url) => {
      const got = await call(url, `/api/inspire/implement/context?${Q}`);
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.deepEqual([got.data.family, got.data.trains_model], [family, trains], mandate);
      assert.equal(got.data.evidence.tables['main.s.orders'].rows, 1200);
      assert.deepEqual(got.data.features, { apps: true, genie_spaces: false, alerts: true,
        genie_code: { available: true, route: 'Codex route', model: 'gpt-5.6-sol', reason: '', fix: '' } });
    });
  }
});

test('submit refuses an output table the user cannot create, and a widget value outside its range, before writing or launching', async () => {
  await withApp({ access: NOT_MINE_SCHEMA }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', {
      method: 'POST', body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 403);
    assert.match(got.data.error, /you need USE SCHEMA on main.inspire and CREATE TABLE on main.inspire/);
    assert.equal(made.jobs.length, 0);
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')));
  });
  const instruction = '## 3. Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n| `top_k` | text | 5 | whole number, 1 to 10 | Rows to show |\n';
  await withApp({ useCase: { id: 'N01-U01', use_case: 'Predict churn', genie_instruction: instruction } }, async (url, made) => {
    const bad = await call(url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { ...SPEC, config: { ...SPEC.config, widgets: { top_k: '50' } } } },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, "widget values are out of range: top_k is '50'; allowed: whole number, 1 to 10");
    assert.equal(made.jobs.length, 0);
    const good = await call(url, '/api/inspire/implement/submit', {
      method: 'POST',
      body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { ...SPEC, config: { ...SPEC.config, widgets: { top_k: '7' } } } },
    });
    assert.equal(good.status, 200, JSON.stringify(good.data));
  });
});

test('an Implement page re-run after an outputs-only version still knows the widgets Genie built', async () => {
  const history = [
    { spec_version: 3, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC), genie_widgets: null },
    { spec_version: 1, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC),
      genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]) }];
  await withApp({ history }, async (url, made) => {
    const ok = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '10' } } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const runNow = made.fetches.find((f) => f.path === '/api/2.1/jobs/run-now');
    assert.deepEqual(JSON.parse(runNow.opts.body).notebook_params, { top_k: '10', run_profile: 'preview' });
    const bad = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '-3' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, "widget values are out of range: top_k is '-3'; allowed: whole number, at least 1");
  });
});

test('an Implement page re-run refuses an override outside the widget\'s range and never calls run-now', async () => {
  const history = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC),
    genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]) }];
  await withApp({ history }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '-3' } } });
    assert.equal(got.status, 400);
    assert.equal(got.data.error, "widget values are out of range: top_k is '-3'; allowed: whole number, at least 1");
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
});

const RERUN_HISTORY = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC),
  genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]) }];
const ON_APP_VERSION = [{ environment_key: 'Default', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION } }];
const RELEASED_JOB = { job_id: 77, settings: { name: 'Inspire AI - Acme', tasks: [{ task_key: 'inspire_notebook', environment_key: 'Default' }],
  environments: [{ environment_key: 'Default', spec: { client: '1' } }] } };
const NEEDS = `In a workspace with no internet the run needs serverless environment ${INSPIRE_ENVIRONMENT_VERSION}, `
  + 'because the packages Inspire installs offline are built for it.';
const jobCalls = (made) => made.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/'))
  .map((f) => `${String(f.opts.method || 'GET').toUpperCase()} ${f.path}`);
const rerunNow = (url) => call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });

test('an Implement re-run moves a job made on client 1 to the App environment version before it runs, and changes only its environments', async () => {
  await withApp({ history: RERUN_HISTORY, job: RELEASED_JOB, responses: { 'POST /api/2.1/jobs/update': [{}] } }, async (url, made) => {
    const got = await rerunNow(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal('warning' in got.data, false);
    assert.deepEqual(jobCalls(made), ['GET /api/2.1/jobs/get?job_id=77', 'POST /api/2.1/jobs/update', 'POST /api/2.1/jobs/run-now']);
    const update = made.fetches.find((f) => f.path === '/api/2.1/jobs/update');
    assert.deepEqual(JSON.parse(update.opts.body), { job_id: 77, new_settings: { environments: ON_APP_VERSION } });
  });
});

test('an Implement re-run of a job already on the App environment version, or on a cluster, runs it with no update', async () => {
  const onVersion = { job_id: 77, settings: { ...RELEASED_JOB.settings, environments: ON_APP_VERSION } };
  const onCluster = { job_id: 77, settings: { name: 'Inspire AI - Acme', tasks: [{ task_key: 'inspire_notebook', existing_cluster_id: '0101-abc' }] } };
  for (const job of [onVersion, onCluster]) {
    await withApp({ history: RERUN_HISTORY, job }, async (url, made) => {
      const got = await rerunNow(url);
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal('warning' in got.data, false);
      assert.deepEqual(jobCalls(made), ['GET /api/2.1/jobs/get?job_id=77', 'POST /api/2.1/jobs/run-now']);
    });
  }
});

test('an Implement re-run whose job update is refused still runs and says which environment it ran on and why that fails offline', async () => {
  const denied = 'User does not have Manage permission on job 77';
  await withApp({ history: RERUN_HISTORY, job: RELEASED_JOB,
    responses: { 'POST /api/2.1/jobs/update': [{ error_code: 'PERMISSION_DENIED', message: denied }, 403] } }, async (url, made) => {
    const got = await rerunNow(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.run_id, 501);
    assert.equal(got.data.warning, `Inspire could not move job 77 from serverless environment 1 to environment ${INSPIRE_ENVIRONMENT_VERSION} `
      + `(${denied}), so this run uses environment 1. ${NEEDS}`);
    assert.deepEqual(jobCalls(made), ['GET /api/2.1/jobs/get?job_id=77', 'POST /api/2.1/jobs/update', 'POST /api/2.1/jobs/run-now']);
  });
});

test('an Implement re-run of a job released main made, with no assets path in its parameters, sends the installed assets path', async () => {
  const assets = '/Workspace/Shared/inspire-ai/assets/v1.3.0';
  const released = { job_id: 77, settings: { ...RELEASED_JOB.settings, tasks: [{ task_key: 'inspire_notebook', environment_key: 'Default',
    notebook_task: { notebook_path: '/Shared/inspire/dbx_inspire_ai_agent', base_parameters: { '00_business_name': 'Acme', '14_session_id': '42' } } }] } };
  const saved = process.env.INSPIRE_ASSETS_PATH;
  process.env.INSPIRE_ASSETS_PATH = assets;
  try {
    await withApp({ history: RERUN_HISTORY, job: released, responses: { 'POST /api/2.1/jobs/update': [{}] } }, async (url, made) => {
      const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '10' } } });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      const runNow = made.fetches.find((f) => f.path === '/api/2.1/jobs/run-now');
      assert.deepEqual(JSON.parse(runNow.opts.body).notebook_params, { top_k: '10', run_profile: 'preview', inspire_assets_path: assets });
      assert.deepEqual(got.data.notebook_params, { top_k: '10', run_profile: 'preview', inspire_assets_path: assets });
      const sent = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { inspire_assets_path: '/Users/x/evil' } } });
      assert.equal(sent.status, 400, 'a path the request sends is refused, never run');
    });
  } finally {
    if (saved === undefined) delete process.env.INSPIRE_ASSETS_PATH;
    else process.env.INSPIRE_ASSETS_PATH = saved;
  }
});

async function withTestTag(value, body) {
  const saved = process.env.INSPIRE_TEST_TAG;
  if (value === undefined) delete process.env.INSPIRE_TEST_TAG;
  else process.env.INSPIRE_TEST_TAG = value;
  try {
    await body();
  } finally {
    if (saved === undefined) delete process.env.INSPIRE_TEST_TAG;
    else process.env.INSPIRE_TEST_TAG = saved;
  }
}

test('an Implement re-run from a test install tags the job it re-runs, in the same update as its environment', async () => {
  const job = { job_id: 77, settings: { ...RELEASED_JOB.settings, tags: { dbx_inspire_ai_version: 'v1.3.1' } } };
  await withTestTag('inspire-rc0', () => withApp({ history: RERUN_HISTORY, job, responses: { 'POST /api/2.1/jobs/update': [{}] } }, async (url, made) => {
    const got = await rerunNow(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal('warning' in got.data, false);
    assert.deepEqual(jobCalls(made), ['GET /api/2.1/jobs/get?job_id=77', 'POST /api/2.1/jobs/update', 'POST /api/2.1/jobs/run-now']);
    const update = made.fetches.find((f) => f.path === '/api/2.1/jobs/update');
    assert.deepEqual(JSON.parse(update.opts.body), { job_id: 77, new_settings: { environments: ON_APP_VERSION,
      tags: { dbx_inspire_ai_version: 'v1.3.1', dbx_inspire_ai_test: 'inspire-rc0' } } });
    const runNow = made.fetches.find((f) => f.path === '/api/2.1/jobs/run-now');
    assert.equal(JSON.parse(runNow.opts.body).notebook_params.dbx_inspire_ai_test, 'inspire-rc0');
  }));
});

test('an Implement re-run from a production install takes a test tag a test run left on the job off it, and sends no test tag', async () => {
  const cases = [
    [{ dbx_inspire_ai_version: 'v1.3.1', dbx_inspire_ai_test: 'inspire-rc0' },
      { job_id: 77, new_settings: { tags: { dbx_inspire_ai_version: 'v1.3.1' } }, fields_to_remove: ['tags'] }],
    [{ dbx_inspire_ai_test: 'inspire-rc0' }, { job_id: 77, new_settings: {}, fields_to_remove: ['tags'] }],
  ];
  for (const value of [undefined, '', '   ']) {
    for (const [tags, sent] of cases) {
      const job = { job_id: 77, settings: { ...RELEASED_JOB.settings, environments: ON_APP_VERSION, tags } };
      await withTestTag(value, () => withApp({ history: RERUN_HISTORY, job, responses: { 'POST /api/2.1/jobs/update': [{}] } }, async (url, made) => {
        const got = await rerunNow(url);
        assert.equal(got.status, 200, JSON.stringify(got.data));
        const update = made.fetches.find((f) => f.path === '/api/2.1/jobs/update');
        assert.deepEqual(JSON.parse(update.opts.body), sent);
        const runNow = made.fetches.find((f) => f.path === '/api/2.1/jobs/run-now');
        assert.equal('dbx_inspire_ai_test' in JSON.parse(runNow.opts.body).notebook_params, false);
      }));
    }
  }
});

test('an Implement re-run from a test install moves a test tag of another install to its own value without removing the other tags', async () => {
  const job = { job_id: 77, settings: { ...RELEASED_JOB.settings, environments: ON_APP_VERSION, tags: { a: '1', dbx_inspire_ai_test: 'inspire-rc1' } } };
  await withTestTag('inspire-rc0', () => withApp({ history: RERUN_HISTORY, job, responses: { 'POST /api/2.1/jobs/update': [{}] } }, async (url, made) => {
    assert.equal((await rerunNow(url)).status, 200);
    const update = made.fetches.find((f) => f.path === '/api/2.1/jobs/update');
    assert.deepEqual(JSON.parse(update.opts.body), { job_id: 77, new_settings: { tags: { a: '1', dbx_inspire_ai_test: 'inspire-rc0' } } });
  }));
});

test('an Implement re-run whose test tag update is refused still runs and says the tag is missing', async () => {
  const denied = 'User does not have Manage permission on job 77';
  const job = { job_id: 77, settings: { ...RELEASED_JOB.settings, environments: ON_APP_VERSION } };
  await withTestTag('inspire-rc0', () => withApp({ history: RERUN_HISTORY, job,
    responses: { 'POST /api/2.1/jobs/update': [{ error_code: 'PERMISSION_DENIED', message: denied }, 403] } }, async (url) => {
    const got = await rerunNow(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.warning, `Inspire could not tag job 77 with dbx_inspire_ai_test=inspire-rc0 (${denied}), so usage reports may count this test run.`);
  }));
});

test('an Implement re-run that cannot read its job still runs and says it could not check the environment', async () => {
  const cases = [
    [{ job: { error_code: 'PERMISSION_DENIED', message: 'User does not have View permission on job 77' }, jobStatus: 403 }, 'User does not have View permission on job 77'],
    [{ fetchThrows: { 'GET /api/2.1/jobs/get': 'socket hang up' } }, 'socket hang up'],
  ];
  for (const [state, reason] of cases) {
    await withApp({ history: RERUN_HISTORY, ...state }, async (url, made) => {
      const got = await rerunNow(url);
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal(got.data.warning, `Inspire could not read job 77 to check its serverless environment (${reason}), `
        + `so this run uses the environment the job already has. ${NEEDS}`);
      assert.deepEqual(jobCalls(made), ['GET /api/2.1/jobs/get?job_id=77', 'POST /api/2.1/jobs/run-now']);
    });
  }
});

const BUILT = (extra = {}) => ({ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC),
  notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1, result_history: 1 } }),
  genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]), ...extra });

test('an Implement page re-run runs without a dropped secondary table and refuses only when the primary table is gone', async () => {
  const gone = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns` cannot be found. Verify the spelling. SQLSTATE: 42P01';
  await withApp({ history: [BUILT()], useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`returns`': gone } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'), 'the notebook drops the secondary table and warns');
    assert.deepEqual(made.sqlCalls.filter((c) => c.sql.endsWith('LIMIT 0')).map((c) => c.sql).sort(),
      ['SELECT * FROM `main`.`s`.`orders` LIMIT 0', 'SELECT * FROM `main`.`s`.`returns` LIMIT 0']);
  });
  const lost = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders` cannot be found. Verify the spelling. SQLSTATE: 42P01';
  await withApp({ history: [BUILT()], useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`orders`': lost } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 409);
    assert.equal(got.data.error, 'the preview cannot run because these source tables are missing or not readable: main.s.orders '
      + '(the primary table, not found). Open Edit, Data step, to swap main.s.orders for a table with the same role, because the primary table '
      + 'can be swapped, not removed');
    assert.deepEqual(got.data.missing_tables, [{ table: 'main.s.orders', reason: 'not found', error: lost, primary: true }]);
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
  const denied = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";
  await withApp({ history: [BUILT()], useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`orders`': denied } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 409);
    assert.deepEqual(got.data.missing_tables.map((m) => [m.table, m.reason]), [['main.s.orders', 'no read access']]);
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
});

test('an Implement page re-run checks the swapped table, skips removed ones, and is not blocked by an unrelated probe error', async () => {
  const swapped = { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' }, removed_tables: ['main.s.returns'] } };
  const timeout = 'Statement timed out after 50 seconds on warehouse wh1';
  await withApp({ history: [BUILT({ spec_json: JSON.stringify(swapped) })], useCase: TWO_TABLES,
    probeErrors: { '`main`.`s`.`orders_v2`': timeout } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(made.sqlCalls.filter((c) => c.sql.endsWith('LIMIT 0')).map((c) => c.sql), ['SELECT * FROM `main`.`s`.`orders_v2` LIMIT 0']);
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
});

const LOST_SWAP = { ...SPEC, data: { tables: { 'main.s.returns': 'main.s.returns_old' } } };
const GONE_OLD = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns_old` cannot be found. Verify the spelling. SQLSTATE: 42P01';
const LOST_HISTORY = [
  BUILT({ spec_version: 2, status: 'failed', spec_json: JSON.stringify({ ...LOST_SWAP, data: { ...LOST_SWAP.data, notes: 'try again' } }) }),
  BUILT({ spec_version: 1, status: 'ready_with_warnings', spec_json: JSON.stringify(LOST_SWAP) }),
];
const probesOf = (made) => made.sqlCalls.filter((c) => String(c.sql).endsWith('LIMIT 0')).map((c) => c.sql).sort();

const LOST_PRIMARY = { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_old' } } };
const GONE_PRIMARY = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders_old` cannot be found. Verify the spelling. SQLSTATE: 42P01';
const LOST_PRIMARY_HISTORY = [
  BUILT({ spec_version: 2, status: 'failed', spec_json: JSON.stringify({ ...LOST_PRIMARY, data: { ...LOST_PRIMARY.data, notes: 'try again' } }) }),
  BUILT({ spec_version: 1, status: 'ready_with_warnings', spec_json: JSON.stringify(LOST_PRIMARY) }),
];

test('plan and submit refuse a rebuild that inherits a swap of the primary table to a dropped table, name it, and never write or start a job', async () => {
  await withApp({ history: LOST_PRIMARY_HISTORY, useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`orders_old`': GONE_PRIMARY } }, async (url, made) => {
    const spec = { ...LOST_PRIMARY, based_on_version: 2, data: { ...LOST_PRIMARY.data, notes: 'try again' } };
    for (const route of ['plan', 'submit']) {
      const got = await call(url, `/api/inspire/implement/${route}`, { method: 'POST', body: { ...SUBMIT, spec } });
      assert.equal(got.status, 409, `${route}: ${JSON.stringify(got.data)}`);
      assert.equal(got.data.error, 'the preview cannot run because these source tables are missing or not readable: main.s.orders_old '
        + '(the primary table, not found). Open Edit, Data step, to swap main.s.orders_old for a table with the same role, because the primary table '
        + 'can be swapped, not removed');
      assert.deepEqual(got.data.missing_tables, [{ table: 'main.s.orders_old', reason: 'not found', error: GONE_PRIMARY, primary: true }]);
    }
    assert.equal(made.sqlCalls.some((c) => /INSERT INTO/.test(String(c.sql))), false, 'no version row is written');
    assert.equal(made.jobs.length, 0, 'no job starts');
  });
});

test('a rebuild that inherits a swap of a secondary table to a dropped table plans and starts, and the notebook drops that table', async () => {
  await withApp({ history: LOST_HISTORY, useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD } }, async (url, made) => {
    const spec = { ...LOST_SWAP, based_on_version: 2, data: { ...LOST_SWAP.data, notes: 'try again' } };
    for (const route of ['plan', 'submit']) {
      const got = await call(url, `/api/inspire/implement/${route}`, { method: 'POST', body: { ...SUBMIT, spec } });
      assert.equal(got.status, 200, `${route}: ${JSON.stringify(got.data)}`);
    }
    assert.equal(made.jobs.length, 1, 'the submit starts one job');
  });
});

test('a rebuild back on the use case\'s own table plans and starts, and a rebuild that reads no source table is never probed', async () => {
  await withApp({ history: LOST_HISTORY, useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD } }, async (url, made) => {
    const spec = { ...SPEC, based_on_version: 2, data: { tables: {}, notes: 'try again' } };
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...SUBMIT, spec } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(probesOf(made), ['SELECT * FROM `main`.`s`.`orders` LIMIT 0', 'SELECT * FROM `main`.`s`.`returns` LIMIT 0']);
    assert.equal(made.jobs.length, 1);
  });
  await withApp({ history: LOST_HISTORY, useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD } }, async (url, made) => {
    const spec = { ...LOST_SWAP, based_on_version: 2, outputs: { dashboard: true, dashboard_vibes: 'Put the biggest records first' } };
    const got = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...SUBMIT, spec } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.summary.refill, false);
    assert.deepEqual(probesOf(made), [], 'a dashboard-only rebuild reads the result table, not the source tables');
  });
});

test('context names each source table that is gone, checking the use case\'s own table behind a swap too', async () => {
  await withApp({ history: LOST_HISTORY, useCase: TWO_TABLES, probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.missing_tables, [{ table: 'main.s.returns_old', reason: 'not found', error: GONE_OLD }]);
    assert.deepEqual(probesOf(made), ['SELECT * FROM `main`.`s`.`orders` LIMIT 0', 'SELECT * FROM `main`.`s`.`returns_old` LIMIT 0',
      'SELECT * FROM `main`.`s`.`returns` LIMIT 0']);
  });
  await withApp({ useCase: TWO_TABLES }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.missing_tables, []);
    assert.deepEqual(probesOf(made), ['SELECT * FROM `main`.`s`.`orders` LIMIT 0', 'SELECT * FROM `main`.`s`.`returns` LIMIT 0']);
  });
});

test('context names each output the use case had that no longer exists, and only those', async () => {
  const history = [BUILT({ app_name: 'old-desk', dashboard_id: 'd1', genie_space_id: 'g1' })];
  await withApp({ history, appsByName: {}, responses: { 'GET /api/2.0/lakeview/dashboards/d1': [{ error_code: 'RESOURCE_DOES_NOT_EXIST' }, 404] } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.assets, { dashboard: 'd1', genie_space: 'g1', app: 'old-desk' });
    assert.deepEqual(got.data.gone_assets, ['dashboard', 'app']);
  });
  await withApp({ history, appsByName: { 'old-desk': { name: 'old-desk' } } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual(got.data.gone_assets, []);
  });
  await withApp({ history, appsByName: { 'old-desk': { name: 'old-desk' } }, fetchThrows: { 'GET /api/2.0/genie/spaces/g1': 'socket hang up' } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.gone_assets, [], 'an output Inspire could not check is not called gone');
  });
  await withApp({}, async (url) => {
    const got = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual(got.data.gone_assets, []);
  });
});

test('an Implement page re-run refuses to override the result table and drops blank overrides', async () => {
  await withApp({ history: [BUILT()] }, async (url, made) => {
    for (const name of ['result_table', 'RESULT_TABLE']) {
      const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { [name]: 'main.other.t' } } });
      assert.equal(got.status, 400);
      assert.equal(got.data.error, 'the result table is part of the spec; change it in all settings (Vibe/Add/Remove Features, then Open all settings), which checks the table before any run writes to it');
    }
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
    const blank = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: { top_k: '   ', as_of_date: '' } } });
    assert.equal(blank.status, 200, JSON.stringify(blank.data));
    assert.deepEqual(blank.data.notebook_params, { run_profile: 'preview' });
  });
});

test('the Implement page status returns the re-run widgets, the App\'s live status and the job\'s recent runs', async () => {
  const widgets = [{ name: 'result_table', type: 'text', default: 'main.inspire.churn_out' }, { name: 'run_profile', type: 'dropdown', default: 'full_load' },
    { name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }, { name: 'as_of_date', type: 'text', default: '' }];
  const history = [
    { spec_version: 3, status: 'ready', use_case_id: 'N01-U01', job_id: 77, app_name: 'n01-u01-churn', spec_json: JSON.stringify(SPEC), genie_widgets: null },
    { spec_version: 1, status: 'ready', use_case_id: 'N01-U01', job_id: 77, app_name: 'n01-u01-churn', spec_json: JSON.stringify(SPEC),
      genie_widgets: JSON.stringify(widgets) }];
  const app = { name: 'n01-u01-churn', url: 'https://n01-u01-churn.example.databricksapps.com', app_status: { state: 'RUNNING', message: 'App is running' },
    description: 'Inspire use case N01-U01 (session 42): Predict churn',
    compute_status: { state: 'ACTIVE' }, active_deployment: { status: { state: 'SUCCEEDED', message: 'App started successfully' }, update_time: '2026-10-25T03:00:00Z' } };
  const runs = { runs: [{ run_id: 9, start_time: 1761361200000, run_duration: 125400, trigger: 'ONE_TIME', run_page_url: 'https://x/run/9',
    state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', state_message: '' }, overriding_parameters: { notebook_params: { run_profile: 'preview' } } },
  { run_id: 8, start_time: 1761357600000, execution_duration: 3000, trigger: 'PERIODIC', state: { life_cycle_state: 'RUNNING' } }] };
  await withApp({ history, app, appExists: true, runs }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.rerun_widgets.map((w) => w.name), ['top_k', 'as_of_date']);
    assert.deepEqual(got.data.app_status, { ok: true, name: 'n01-u01-churn', url: app.url, app_state: 'RUNNING', app_message: 'App is running',
      compute_state: 'ACTIVE', deployment_state: 'SUCCEEDED', deployment_message: 'App started successfully', deployed_at: '2026-10-25T03:00:00Z' });
    assert.deepEqual(got.data.runs, { ok: true, runs: [
      { run_id: 9, started: '2025-10-25T03:00:00.000Z', duration_s: 125, state: 'SUCCESS', message: '', trigger: 'ONE_TIME', profile: 'preview', url: 'https://x/run/9' },
      { run_id: 8, started: '2025-10-25T02:00:00.000Z', duration_s: 3, state: 'RUNNING', message: '', trigger: 'PERIODIC', profile: '', url: '' }] });
    assert.ok(made.fetches.some((f) => f.path === '/api/2.0/apps/n01-u01-churn'));
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/runs/list?job_id=77&limit=10'));
    assert.ok(!made.fetches.some((f) => f.path.startsWith('/api/2.1/jobs/get')));
  });
  await withApp({ history, appExists: false, runs: { has_more: false }, job: { error_code: 'PERMISSION_DENIED', message: 'User sp does not have View permissions on Job 77' },
    jobStatus: 403 }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.runs, { ok: false, error: 'Inspire cannot see this job, so it cannot list its runs: User sp does not have View permissions on Job 77', runs: [] });
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/get?job_id=77'));
  });
  await withApp({ history, appExists: false, runs: { has_more: false } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.deepEqual(got.data.runs, { ok: true, runs: [] });
  });
  await withApp({ history, appExists: false, runs: { message: 'no permission to view runs of job 77' }, runsStatus: 403 }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.app_status, { ok: false, error: 'the App no longer exists' });
    assert.deepEqual(got.data.runs, { ok: false, error: 'no permission to view runs of job 77', runs: [] });
  });
  await withApp({ history: [] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.app_status, null);
    assert.equal(got.data.runs, null);
    assert.deepEqual(got.data.rerun_widgets, []);
    assert.ok(!made.fetches.some((f) => f.path.startsWith('/api/2.0/apps/') || f.path.startsWith('/api/2.1/jobs/runs/list')));
  });
});

const NOTEBOOK_JOB = 'Inspire AI - Genie Code - 42';
const GENERATE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_ids: ['N01-U01'], notebook_path: '/Shared/nb' };
const notebookJobs = (life, result = '') => ({
  jobsList: { jobs: [{ job_id: 31, created_time: 5, settings: { name: NOTEBOOK_JOB } }] },
  runsByJob: { 31: { runs: [{ run_id: 310, state: { life_cycle_state: life, result_state: result }, run_page_url: 'https://w/#job/31/run/310' }] } },
});

test('a notebook-only request flags just its use case and starts the session notebook job', async () => {
  const { app, jobs, flagged } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/generate-genie', { method: 'POST', body: GENERATE });
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.flagged_use_case_ids, ['N01-U01']);
    assert.deepEqual(flagged, [{ warehouseId: 'wh1', catalog: 'main', schema: 'inspire', sid: '42', ids: ['N01-U01'] }]);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobName, NOTEBOOK_JOB);
    assert.equal(jobs[0].jobType, 'genie_regen');
    assert.equal(jobs[0].params['15_operation'], 'Generate Use Cases');
    assert.equal(jobs[0].params['14_session_id'], '42');
    assert.deepEqual(jobs[0].useCaseIds, ['N01-U01'], 'the notebook job is tagged with the use cases it writes');
  } finally {
    await srv.close();
  }
});

test('a notebook run still running blocks a second request even after the App restarted', async () => {
  const { app, jobs, flagged } = makeApp(notebookJobs('RUNNING'));
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/generate-genie', { method: 'POST', body: { ...GENERATE, use_case_ids: ['N02-U01'] } });
    assert.equal(got.status, 409);
    assert.match(got.data.error, /already being written/);
    assert.equal(got.data.run_id, 310);
    assert.equal(got.data.job_run_url, 'https://w/#job/31/run/310');
    assert.deepEqual(flagged, []);
    assert.equal(jobs.length, 0);
  } finally {
    await srv.close();
  }
});

test('a finished notebook run lets the next request start', async () => {
  for (const [life, result] of [['TERMINATED', 'SUCCESS'], ['TERMINATED', 'FAILED'], ['INTERNAL_ERROR', '']]) {
    const { app, jobs } = makeApp(notebookJobs(life, result));
    const srv = await listen(app);
    try {
      const got = await call(srv.url, '/api/inspire/generate-genie', { method: 'POST', body: GENERATE });
      assert.equal(got.status, 200, `${life}/${result}`);
      assert.equal(jobs.length, 1);
    } finally {
      await srv.close();
    }
  }
});

test('a notebook request is refused when the jobs list cannot be read, so a running notebook is never doubled', async () => {
  const { app, jobs, flagged } = makeApp({ jobsListStatus: 403, jobsList: { message: 'no access to jobs' } });
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/generate-genie', { method: 'POST', body: GENERATE });
    assert.equal(got.status, 502);
    assert.match(got.data.error, /Listing the Genie Code notebook jobs failed \(403\)/);
    assert.deepEqual(flagged, []);
    assert.equal(jobs.length, 0);
  } finally {
    await srv.close();
  }
});

test('history carries the session notebook run, and a jobs error beside the MVP rows instead of failing them', async () => {
  const RAIL = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
  {
    const { app } = makeApp(notebookJobs('RUNNING'));
    const srv = await listen(app);
    try {
      const got = await call(srv.url, `/api/inspire/implement/history?${RAIL}`);
      assert.equal(got.status, 200);
      assert.equal(got.data.notebook_run.state, 'running');
      assert.equal(got.data.notebook_run.run_id, 310);
      assert.equal(got.data.notebook_run_error, '');
    } finally {
      await srv.close();
    }
  }
  {
    const { app } = makeApp({ jobsListStatus: 500, jobsList: { message: 'jobs down' } });
    const srv = await listen(app);
    try {
      const got = await call(srv.url, `/api/inspire/implement/history?${RAIL}`);
      assert.equal(got.status, 200);
      assert.deepEqual(got.data.latest, []);
      assert.equal(got.data.notebook_run, null);
      assert.match(got.data.notebook_run_error, /failed \(500\): jobs down/);
    } finally {
      await srv.close();
    }
  }
});

test('the context names the generation path the notebook is written to', async () => {
  const { app } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, `/api/inspire/implement/context?${Q}`);
    assert.equal(got.data.generation_path, '/tmp/out');
  } finally {
    await srv.close();
  }
});
