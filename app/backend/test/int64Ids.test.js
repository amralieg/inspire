const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const { int64Id, isInt64Id, requireInt64Id, jsonWithInt64Ids } = require('../lib/int64Id');
const C = require('../lib/implementControl');
const L = require('../lib/launchLedger');
const I = require('../lib/inspireImplement');
const { genieNotebookJobName, latestGenieNotebookRun } = require('../lib/genieNotebookJob');
const { validateFeedbackBody } = require('../lib/inspireFeedback');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const MAX = '9223372036854775807';
const HALF = (BigInt(MAX) / 2n + 2n).toString();
const OVER = (BigInt(MAX) + 1n).toString();
const NEIGHBOUR = (BigInt(MAX) - 1n).toString();
const LIST = `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&all=1`;

test('int64Id keeps every launcher session id byte for byte and refuses what is not a 63-bit whole number (must-exclude)', () => {
  for (const id of [MAX, HALF, '1', '0', '9007199254740993', '1000000000000000000']) assert.equal(int64Id(id), id);
  assert.equal(int64Id(` ${HALF} `), HALF);
  assert.equal(int64Id('0042'), '42');
  assert.equal(int64Id(42), '42');
  assert.equal(int64Id(BigInt(MAX)), MAX);
  for (const bad of [OVER, '18446744073709551615', '12345678901234567890', '-1', '1.5', '1e3', '12a', '', '  ', null, undefined, true, {}, [], -1, 1.5,
    Number(HALF), Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, BigInt(OVER), -1n]) {
    assert.equal(int64Id(bad), null, String(bad));
    assert.equal(isInt64Id(bad), false, String(bad));
  }
  assert.throws(() => requireInt64Id(OVER, 'run_id'), (e) => e.statusCode === 400 && /run_id must be a whole number id of at most 19 digits/.test(e.message));
});

test('jsonWithInt64Ids sends the id digits as a bare JSON number, never through a rounded double', () => {
  const text = jsonWithInt64Ids({ job_id: MAX, notebook_params: { sid: HALF }, only: ['main'], skip: undefined }, ['job_id']);
  assert.equal(text, `{"job_id":${MAX},"notebook_params":{"sid":"${HALF}"},"only":["main"]}`);
  assert.notEqual(JSON.stringify({ job_id: Number(MAX) }), `{"job_id":${MAX}}`, 'a plain JSON.stringify of Number loses the digits');
  assert.throws(() => jsonWithInt64Ids({ run_id: OVER }, ['run_id']), (e) => e.statusCode === 400);
  assert.throws(() => jsonWithInt64Ids({ run_id: Number(HALF) }, ['run_id']), (e) => e.statusCode === 400, 'an already rounded number is refused, not sent');
});

test('the Choose page overview names each 19-digit session exactly, so its counts and preview titles come back', async () => {
  S.reset({
    sessionList: [
      { session_id: MAX, business_name: 'Acme', completed_percent: 100, create_at: '2026-11-02T10:00:00Z', business_runs: 2, business_rank: 1 },
      { session_id: HALF, business_name: 'Acme', completed_percent: 100, create_at: '2026-11-01T10:00:00Z', business_runs: 2, business_rank: 2 },
      { session_id: '17', business_name: 'Beta', completed_percent: 100, create_at: '2026-10-01T10:00:00Z', business_runs: 1, business_rank: 1 },
    ],
    usecases: [
      { session_id: MAX, use_case: 'Forecast demand by zone', inspire_score: 8.4, business_domain: 'Operations' },
      { session_id: MAX, use_case: 'Reduce churn', inspire_score: 2, business_domain: 'Customer' },
      { session_id: HALF, use_case: 'Price basket mix', inspire_score: 9, business_domain: 'Sales' },
      { session_id: NEIGHBOUR, use_case: 'A neighbouring run that must not leak in', priority_score: 5, business_domain: 'Other' },
    ],
  });
  const got = await S.request('GET', LIST, { person: 'reader@example.com' });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  const bySid = Object.fromEntries(got.data.sessions.map((s) => [s.session_id, s.usecase_overview]));
  assert.deepEqual(got.data.sessions.map((s) => s.session_id), [MAX, HALF, '17']);
  const preview = (...names) => names.map((Name) => ({ Name, name_with_technique: null }));
  assert.deepEqual(bySid[MAX], { total: 2, high: 1, meets: 2, domains: 2, preview_use_cases: preview('Forecast demand by zone', 'Reduce churn') });
  assert.deepEqual(bySid[HALF], { total: 1, high: 1, meets: 1, domains: 1, preview_use_cases: preview('Price basket mix') });
  assert.deepEqual(bySid['17'], { total: 0, high: 0, meets: 0, domains: 0, preview_use_cases: [] }, 'a run with no use cases stays at zero');
  const asked = S.state.calls.filter((c) => c.statement.includes('__inspire_usecases'));
  assert.equal(asked.length, 2);
  for (const c of asked) assert.ok(c.statement.includes(`IN (${MAX},${HALF},17)`), c.statement);
});

test('the Choose page counts high priority by one rule, Inspire Score of 3 or more out of 5, the same count the frontend gives, and counts the ones that meet the bar on their own', async () => {
  const { computeHighPriorityCount } = await import('../../frontend/src/lib/useCaseFields.js');
  const usecases = [
    { session_id: MAX, use_case: 'Stored Inspire Score 7 of 10', inspire_score: '7', priority_score: '8.6', business_domain: 'Sales' },
    { session_id: MAX, use_case: 'Stored Inspire Score exactly 6 of 10', inspire_score: '6', priority_score: '1', business_domain: 'Sales' },
    { session_id: MAX, use_case: 'High priority score, low Inspire Score', inspire_score: '5', priority_score: '9.1', elite_status: 'FALLBACK_BELOW_BAR', business_domain: 'Sales' },
    { session_id: MAX, use_case: 'No stored score, strong quality', quality_score: '4', priority_score: '7.5', elite_status: 'domain_coverage_pick', business_domain: 'Ops' },
    { session_id: MAX, use_case: 'No stored score, weak quality', quality_score: '2', priority_score: '3.5', business_domain: 'Ops' },
    { session_id: MAX, use_case: 'Scores past the scale', quality_score: '5', priority_score: '20', business_domain: 'Ops' },
    { session_id: MAX, use_case: 'Unscored, priority only', priority_score: '9', business_domain: 'Ops' },
    { session_id: MAX, use_case: 'Very High label, low scores', Priority: 'Very High', quality_score: '1', priority_score: '2', business_domain: 'Ops' },
  ];
  S.reset({ sessionList: [{ session_id: MAX, business_name: 'Acme', completed_percent: 100, create_at: '2026-11-02T10:00:00Z', business_runs: 1, business_rank: 1 }], usecases });
  const got = await S.request('GET', LIST, { person: 'reader@example.com' });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  const { total, high, meets } = got.data.sessions[0].usecase_overview;
  assert.deepEqual({ total, high, meets }, { total: 8, high: 4, meets: 6 });
  assert.equal(computeHighPriorityCount(usecases), high, 'the frontend gives the same count on the same rows');
  assert.equal(usecases.filter((u) => Number(u.priority_score) >= 3).length, 6, 'the old score-of-3 rule counted 6 of these, the new rule counts 4 (must-exclude)');
  const statement = S.state.calls.find((c) => c.statement.includes('AS usecase_count')).statement;
  assert.ok(statement.includes('COALESCE(inspire_score, 0.65 * LEAST(10, GREATEST(0, quality_score * 2)) + 0.35 * LEAST(10, GREATEST(0, priority_score))) / 2'), statement);
  assert.equal(statement.includes('COALESCE(priority_score, 0) >= 3'), false, 'no priority-only cut (must-exclude)');
});

test('a session id beyond 63 bits is left out of the overview query instead of naming a rounded neighbour (must-exclude)', async () => {
  S.reset({
    sessionList: [{ session_id: '99999999999999999999', business_name: 'Acme', completed_percent: 100, create_at: '2026-11-02T10:00:00Z', business_runs: 1, business_rank: 1 }],
    usecases: [{ session_id: '99999999999999999999', use_case: 'Never asked for', priority_score: 5, business_domain: 'Sales' }],
  });
  const got = await S.request('GET', LIST, { person: 'reader@example.com' });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(got.data.sessions[0].usecase_overview, undefined);
  assert.deepEqual(S.state.calls.filter((c) => c.statement.includes('__inspire_usecases')), []);
});

test('cancelling a run with a 19-digit run id sends the exact id to the Jobs API', async () => {
  S.reset({ launchers: { [MAX]: 'launcher@example.com' } });
  const got = await S.request('POST', `/api/run/${MAX}/cancel`, { person: 'launcher@example.com' });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  const sent = S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/cancel');
  assert.deepEqual(sent.map((c) => c.raw), [`{"run_id":${MAX}}`]);
  const over = await S.request('POST', `/api/run/${OVER}/cancel`, { person: 'launcher@example.com' });
  assert.notEqual(over.status, 200, 'a run id beyond 63 bits never reaches the Jobs API');
  assert.equal(S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/cancel').length, 1);
});

test('a request body that carries the session id as a bare JSON number keeps all 19 digits', async () => {
  S.reset({ managers: ['manager@example.com'] });
  const { port } = await S.startServer();
  S.state.person = 'manager@example.com';
  const http = require('node:http');
  const payload = `{"inspire_database":"${S.APP_DB}","warehouse_id":"${S.APP_WAREHOUSE}","session_id":${HALF},"use_case_ids":["N01-U01"]}`;
  const got = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/inspire/sync-genie-flags', headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-forwarded-email': 'manager@example.com',
      'x-forwarded-preferred-username': 'manager@example.com', 'x-forwarded-access-token': S.PERSON_TOKEN } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(payload);
  });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(JSON.parse(got.text).session_id, HALF);
  const updates = S.state.calls.filter((c) => /UPDATE|MERGE/i.test(c.statement) && c.statement.includes('__inspire_usecases'));
  assert.ok(updates.length > 0);
  for (const c of updates) assert.ok(c.raw.includes(HALF), c.raw.slice(0, 300));
  assert.ok(!updates.some((c) => c.raw.includes(String(Number(HALF)))), 'the rounded neighbour is never written');
});

test('Implement controls name 19-digit job and build ids exactly in their paths and bodies', () => {
  assert.deepEqual(C.controlRequest('job', 'cancel', MAX), { method: 'POST', path: '/api/2.1/jobs/runs/cancel-all', body: { job_id: MAX }, int64: ['job_id'] });
  assert.deepEqual(C.controlRequest('build', 'cancel', HALF), { method: 'POST', path: '/api/2.1/jobs/runs/cancel', body: { run_id: HALF }, int64: ['run_id'] });
  const req = C.controlRequest('build', 'cancel', HALF);
  assert.equal(jsonWithInt64Ids(req.body, req.int64), `{"run_id":${HALF}}`);
  assert.equal(C.ownerCheckPath('job', MAX), `/api/2.1/jobs/get?job_id=${MAX}`);
  assert.equal(C.ownerCheckPath('build', HALF), `/api/2.1/jobs/runs/get?run_id=${HALF}`);
  assert.equal(C.livePaths({ job: MAX }).runs, `/api/2.1/jobs/runs/list?job_id=${MAX}&active_only=true&limit=5`);
  assert.deepEqual(C.livePaths({ job: OVER }), {}, 'a job id beyond 63 bits is not read');
  assert.throws(() => C.controlRequest('job', 'cancel', OVER), (e) => e.statusCode === 400);
  assert.throws(() => C.ownerCheckPath('build', 'abc'), (e) => e.statusCode === 400);
});

test('the Genie Code notebook job and its runs are read by the exact session and job id', async () => {
  assert.equal(genieNotebookJobName(MAX), `Inspire AI - Genie Code - ${MAX}`);
  assert.throws(() => genieNotebookJobName(OVER), /numeric Inspire session id/);
  const asked = [];
  const fetchJson = async (p) => {
    asked.push(p);
    if (p.startsWith('/api/2.1/jobs/list')) return { ok: true, data: { jobs: [{ job_id: HALF, created_time: 1, settings: { name: genieNotebookJobName(MAX) } }] } };
    return { ok: true, data: { runs: [{ run_id: MAX, state: { life_cycle_state: 'RUNNING' } }] } };
  };
  const run = await latestGenieNotebookRun(fetchJson, MAX);
  assert.equal(asked[1], `/api/2.1/jobs/runs/list?job_id=${HALF}&limit=1`);
  assert.equal(run.state, 'running');
});

test('session id checks across the App take 19-digit ids and refuse ids beyond 63 bits (must-exclude)', () => {
  const seen = L.sessionsSeenStatement(S.APP_DB, [MAX, HALF, OVER, '99999999999999999999', 'x']);
  assert.deepEqual(seen.parameters.map((p) => p.value), [MAX, HALF]);
  assert.equal(L.sessionsSeenStatement(S.APP_DB, [OVER]), null);
  assert.deepEqual(I.scopeSessions([{ use_cases: [{ session_id: MAX }, { session_id: OVER }, { session_id: HALF }, { session_id: MAX }] }]), [MAX, HALF]);
  assert.equal(I.defaultResultTable('c.s', 'N01-U01', MAX), `c.s.n01_u01_s${MAX}_out`);
  assert.equal(I.defaultResultTable('c.s', 'N01-U01', OVER), '');
  assert.throws(() => validateFeedbackBody({ session_id: OVER, use_case_key: 'k', status: 'accepted' }), /session_id must be numeric/);
});

test('no backend source passes a session, run or job id through Number, parseInt, parseFloat or a bare digit check', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'server.js'), path.join(root, 'implementRoutes.js'),
    ...fileNames(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'lib', f))];
  const lossy = /\b(Number|parseInt|parseFloat)\(\s*[^)]*\b(session_?id|sessionId|sid|run_?id|runId|job_?id|jobId|id)\b/;
  const bare = /\/\^\\d\+\$\/\.test\([^)]*(session|sid|run_?id|runId|job)/i;
  const allowed = [['lib/showcaseRecord.js', 'const parsed = Number(sessionId);', 'the showcase scrub also replaces the rounded form JSON already wrote']];
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (allowed.some(([f, text]) => f === rel && line.trim() === text)) return;
      if (lossy.test(line) || bare.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(hits, []);
  assert.ok(lossy.test('.map((id) => String(Number(id))),') && lossy.test('run_id: parseInt(req.params.runId)'), 'the old sites are caught');
});
