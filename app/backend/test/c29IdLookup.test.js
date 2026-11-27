const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

// REQ-569 part 2 (c29_idlookup): a URL or API call that names a use case by AIx-UCx finds a row saved as Nx-Ux, and the other way round.
// Every fake below answers only the exact id bound in the statement, so a read that never tries the saved form finds nothing.
const OWNER = ['owner', 'example.com'].join('@');
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const QS = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const PAIRS = [['N01-U02', 'AI01-UC02'], ['AI01-UC02', 'N01-U02']]; // [the id the rows hold, the id the request names]
const FEEDBACK = '`main`.`inspire`.`churn_out_feedback`';
const ISSUE = { feedback_id: 'a1b2', section: 'work', record_key: 'R001', text: 'The due date shows last year', filters: '',
  reported_by: OWNER, reported_at: '2026-11-08 10:00:00', status: 'new', vibe_text: null, handled_by: null, handled_at: null };
const SUMMARY = { run_id: 'r-9', updated_at: '2026-10-20T07:00:00Z', currency: 'USD', decision_basis: 'measured', act_now_amount: '5000',
  review_amount: '1000', act_now_records: '0', review_records: '0', records: '40', value_at_stake: null, nothing_to_act: '',
  value_formula: '{units:number} units x {PRICE:money}', value_expression: 'units * PRICE',
  value_assumptions: JSON.stringify([{ name: 'PRICE', value: 20, kind: 'money' }]), accepted: null };
const LOGGED = { asset: 'app', asset_id: 'churn-desk', action: 'stop', result: 'done', message: 'Stop the App: done', acted_by: OWNER, acted_at: '2026-10-26T10:00:00.000Z' };

const bound = (parameters, name) => ((parameters || []).find((p) => p.name === name) || {}).value;
const onlyFor = (held, rows) => (_sql, parameters) => ({ rows: bound(parameters, 'uc') === held ? rows : [] });

function built(held) {
  const spec = { use_case_id: held, use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
    outputs: { dashboard: true } };
  return { session_id: '42', use_case_id: held, spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
    spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(spec, 'https://inspire.example.com')).spec) };
}

async function call(made, method, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

// A strict answers table: each read answers only the use case id it binds; every INSERT is kept as a row.
function answersTable(held) {
  const rows = [1, 2].map((version) => ({ session_id: '42', use_case_id: held, version: String(version), note: '', saved_by: OWNER, saved_at: '2026-11-01',
    answers: JSON.stringify({ drivers: { cost_cut: { spend_per_year: 1000 * version, cut_pct: 10 } }, currency: 'USD', attribution_pct: 100 }),
    yearly: JSON.stringify({ total: { amount: 100 * version } }) }));
  const handler = (sql, parameters) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT')) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map((c) => c.trim());
      const vals = /VALUES \((.*)\)\s*$/s.exec(sql)[1].split(', ').map((v) => v.trim());
      rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i].startsWith(':') ? bound(parameters, vals[i].slice(1)) : vals[i]])));
      return { rows: [] };
    }
    const asked = (parameters || []).map((p) => p.value);
    const mine = rows.filter((r) => asked.includes(r.use_case_id));
    if (/MAX\(version\)/.test(sql)) return { rows: [{ latest: mine.length ? String(Math.max(...mine.map((r) => Number(r.version)))) : null }] };
    const limit = Number((/LIMIT (\d+)/.exec(sql) || [])[1] || 1000);
    return { rows: mine.sort((a, b) => Number(b.version) - Number(a.version)).slice(0, limit) };
  };
  return { rows, statements: { __inspire_value_answers: handler } };
}

for (const [held, asked] of PAIRS) {
  test(`build history: ${asked} finds the rows saved as ${held}`, async () => {
    const made = makeApp({ history: [built(held)] });
    const got = await call(made, 'GET', `/api/inspire/implement/history?${QS}&use_case_id=${asked}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.latest.map((r) => r.use_case_id), [held]);
  });

  test(`money review: ${asked} reads the summary saved as ${held}`, async () => {
    const made = makeApp({ history: [built(held)], statements: {
      '_summary` WHERE use_case_id = :uc': onlyFor(held, [{ use_case_id: held, ...SUMMARY }]),
      '_assumptions` WHERE use_case_id = :uc': onlyFor(held, []) } });
    const got = await call(made, 'GET', `/api/inspire/implement/money?${QS}&use_case_id=${asked}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.result_table, 'main.inspire.churn_out');
    assert.equal(got.data.run && got.data.run.run_id, 'r-9');
  });

  test(`reported issues: ${asked} lists the issues saved as ${held}, and a status change writes ${held}`, async () => {
    const missingApp = () => { throw new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `__inspire_app_feedback` cannot be found.'); };
    const made = makeApp({ history: [built(held)], forwardedToken: 'person-token', statements: {
      [`FROM ${FEEDBACK} WHERE use_case_id = :uc AND feedback_id = :id`]: onlyFor(held, [ISSUE]),
      [`FROM ${FEEDBACK} WHERE use_case_id = :uc ORDER BY`]: onlyFor(held, [ISSUE]),
      [`UPDATE ${FEEDBACK}`]: () => ({ rows: [] }),
      __inspire_app_feedback_: missingApp } });
    const list = await call(made, 'GET', `/api/inspire/implement/feedback?${QS}&use_case_id=${asked}`);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.deepEqual(list.data.items.map((i) => i.feedback_id), ['a1b2']);
    const changed = await call(made, 'POST', '/api/inspire/implement/feedback/status', { ...DB, use_case_id: asked, feedback_id: 'a1b2', status: 'closed' });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    const update = made.sqlCalls.find((c) => c.sql.startsWith(`UPDATE ${FEEDBACK}`));
    assert.equal(bound(update && update.parameters, 'uc'), held, 'the status change names the row by the id it is saved under');
  });

  test(`control log: ${asked} lists the actions logged as ${held}`, async () => {
    const made = makeApp({ history: [built(held)], statements: { 'FROM `main`.`inspire`.`__inspire_control_log` AS l': onlyFor(held, [LOGGED]) } });
    const got = await call(made, 'GET', `/api/inspire/implement/live?${QS}&use_case_id=${asked}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.actions, [LOGGED]);
  });

  test(`value answers: ${asked} reads the versions saved as ${held}; undo and save append under ${held}`, async () => {
    const table = answersTable(held);
    const made = makeApp({ forwardedToken: 'person-tok', columns: [], statements: table.statements });
    const history = await call(made, 'GET', `/api/inspire/value/answers/history?${QS}&use_case_id=${asked}`);
    assert.equal(history.status, 200, JSON.stringify(history.data));
    assert.deepEqual(history.data.history.map((h) => h.version), [2, 1]);
    const undo = await call(made, 'POST', '/api/inspire/value/answers/undo', { ...DB, use_case_id: asked });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    assert.equal(undo.data.version, 3);
    assert.deepEqual(table.rows.slice(2).map((r) => r.use_case_id), [held]);
  });
}
