const http = require('node:http');
const { folderAnswer, folderModel } = require('./workspaceFolders');
const { BELOW_BAR_ELITE_STATUSES, HIGH_PRIORITY_MIN_SCORE, HIGH_PRIORITY_SQL, MEETS_BAR_SQL } = require('../../lib/reviewFigures');

const APP_NAME = 'inspire-test-app';
const APP_SP = 'app-sp-client-id';
const APP_TOKEN = 'app-sp-token';
const PERSON_TOKEN = 'person-token';
const APP_DB = 'main.inspire';
const APP_WAREHOUSE = 'wh1';

const ENV = {
  NODE_ENV: 'production',
  DATABRICKS_HOST: 'https://workspace.example.com',
  DATABRICKS_CLIENT_ID: APP_SP,
  DATABRICKS_CLIENT_SECRET: 'app-sp-secret',
  DATABRICKS_APP_NAME: APP_NAME,
  INSPIRE_DATABASE: APP_DB,
  INSPIRE_WAREHOUSE_ID: APP_WAREHOUSE,
  NOTEBOOK_PATH: '/Shared/inspire-test-app/dbx_inspire_ai_agent',
  INSPIRE_AUTO_SETUP: 'true',
};

const state = {
  logs: [],
  managers: [],
  managerGroups: [],
  personGroups: [],
  aclStatus: 200,
  launchers: {},
  sessionLaunchers: {},
  history: [],
  calls: [],
};

function reset(overrides = {}) {
  Object.assign(state, {
    managers: [], managerGroups: [], personGroups: [], aclStatus: 200, personAppsScope: true, launchers: {}, sessionLaunchers: {}, history: [], calls: [],
    launches: [], knownSessions: [], ledgerSessions: [], nextRunId: 501, sessionRows: {}, groupParents: {}, indirectGroups: [], conflictOn: null,
    createdJob: null, runJobs: {}, runStates: null, sessionList: [], usecases: [],
    ...folderModel({ folders: { '/Shared/demos': { id: 7, writers: '*' } } }),
  }, overrides);
}

function sqlResult(columns, rows) {
  return { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } },
    result: { data_array: rows } };
}

function paramOf(body, name) {
  return ((body.parameters || []).find((p) => p.name === name) || {}).value;
}

const HISTORY_COLUMNS = ['session_id', 'use_case_id', 'spec_version', 'status', 'created_by', 'spec_json'];

function answerSql(body) {
  const sql = String(body.statement || '');
  const conflict = state.conflictOn ? state.conflictOn(sql) : '';
  if (conflict) return { statement_id: 's1', status: { state: 'FAILED', error: { message: conflict } } };
  if (/^\s*INSERT INTO\b/i.test(sql) && sql.includes('__inspire_launch')) {
    const row = Object.fromEntries((body.parameters || []).map((p) => [p.name, p.value]));
    state.launches.push(row);
    state.launchers[row.run_id] = row.launched_by;
    state.ledgerSessions.push(row.session_id);
    if (row.opened_session === 'true') state.sessionLaunchers[row.session_id] = row.launched_by;
    return sqlResult(['num_inserted_rows'], [['1']]);
  }
  if (/^\s*SELECT 1 AS seen\b/i.test(sql) && sql.includes('__inspire_session')) {
    return sqlResult(['seen'], state.knownSessions.includes(paramOf(body, 'session_id')) ? [['1']] : []);
  }
  if (/^\s*SELECT 1 AS seen\b/i.test(sql) && sql.includes('__inspire_launch')) {
    const sid = paramOf(body, 'session_id');
    return sqlResult(['seen'], state.ledgerSessions.includes(sid) || state.sessionLaunchers[sid] ? [['1']] : []);
  }
  if (/^\s*SELECT\b/i.test(sql) && sql.includes('__inspire_launch') && sql.includes('run_id = :run_id')) {
    const who = state.launchers[paramOf(body, 'run_id')];
    return sqlResult(['launched_by'], who ? [[who]] : []);
  }
  if (/^\s*SELECT\b/i.test(sql) && sql.includes('__inspire_launch') && sql.includes('session_id = :session_id')) {
    const who = state.sessionLaunchers[paramOf(body, 'session_id')];
    return sqlResult(['launched_by'], who ? [[who]] : []);
  }
  if (/^\s*SELECT s\.generation_path\b/i.test(sql) && sql.includes(`\`main\`.\`inspire\`.\`__inspire_launch\``)) {
    const db = paramOf(body, 'inspire_database');
    const sessions = (state.sessionRows || {})[APP_DB] || [];
    const rows = state.launches.filter((l) => /output_checked IN \('passed', 'manager'\)/.test(sql) && ['passed', 'manager'].includes(l.output_checked) && l.inspire_database === db)
      .map((l) => [sessions.find((s) => String(s.session_id) === String(l.session_id)), l.output_folder])
      .filter(([s]) => s).map(([s, folder]) => [s.generation_path, folder]);
    return sqlResult(['generation_path', 'output_folder'], rows);
  }
  if (/^\s*SELECT CAST\(run_id AS STRING\) AS run_id, session_id, launched_at\b/.test(sql) && sql.includes('__inspire_launch')) {
    const db = paramOf(body, 'inspire_database');
    const rows = state.launches.filter((l) => l.inspire_database === db && l.run_type === 'discovery' && l.opened_session === 'true')
      .map((l) => [String(l.run_id), l.session_id, l.launched_at || '2026-11-02T10:00:00.000Z']).reverse();
    return sqlResult(['run_id', 'session_id', 'launched_at'], rows);
  }
  if (/^\s*SELECT CAST\(session_id AS STRING\) AS session_id FROM\b/.test(sql) && sql.includes('__inspire_session')) {
    const asked = (body.parameters || []).map((p) => p.value);
    return sqlResult(['session_id'], asked.filter((sid) => state.knownSessions.includes(sid)).map((sid) => [sid]));
  }
  if (/^\s*SELECT\b/i.test(sql) && sql.includes('AS business_rank') && sql.includes('__inspire_session')) {
    const columns = ['session_id', 'business_name', 'completed_percent', 'create_at', 'business_runs', 'business_rank'];
    return sqlResult(columns, state.sessionList.map((s) => columns.map((c) => (s[c] == null ? null : String(s[c])))));
  }
  if (/^\s*SELECT session_id,/.test(sql) && sql.includes('__inspire_usecases')) {
    const asked = new Set(((/WHERE session_id IN \(([^)]*)\)/.exec(sql) || [])[1] || '').split(',').map((t) => t.trim()).filter(Boolean));
    const rows = state.usecases.filter((u) => asked.has(u.session_id));
    if (sql.includes('AS usecase_count')) {
      if (!sql.includes(`WHEN ${HIGH_PRIORITY_SQL} THEN`) || !sql.includes(`WHEN ${MEETS_BAR_SQL} THEN`)) throw new Error(`overview counts are not the shared rule: ${sql}`);
      const sids = [...new Set(rows.map((u) => u.session_id))];
      return sqlResult(['session_id', 'usecase_count', 'high_priority_count', 'meets_bar_count', 'domain_count'], sids.map((sid) => {
        const mine = rows.filter((u) => u.session_id === sid);
        const meets = mine.filter((u) => !BELOW_BAR_ELITE_STATUSES.includes(String(u.elite_status || '').trim().toUpperCase()));
        const high = mine.filter((u) => (u.priority_score || 0) >= HIGH_PRIORITY_MIN_SCORE);
        return [sid, String(mine.length), String(high.length), String(meets.length), String(new Set(mine.map((u) => u.business_domain)).size)];
      }));
    }
    if (sql.includes(' AS Name,')) {
      return sqlResult(['session_id', 'Name', 'name_with_technique', 'rn'],
        rows.map((u, i) => [u.session_id, u.use_case, u.name_with_technique == null ? null : String(u.name_with_technique), String(i + 1)]));
    }
    return sqlResult(['session_id', 'title', 'rn'], rows.map((u, i) => [u.session_id, u.use_case, String(i + 1)]));
  }
  if (/^\s*SELECT\b/i.test(sql) && sql.includes('__inspire_implement')) {
    const rows = state.history.map((r) => HISTORY_COLUMNS.map((c) => (c === 'spec_json' ? JSON.stringify(r[c] || {}) : (r[c] == null ? null : String(r[c])))));
    return sqlResult(HISTORY_COLUMNS, rows);
  }
  return sqlResult(['ok'], []);
}

function categoryOf(method, path, body, token) {
  if (path === '/oidc/v1/token') return 'auth';
  if (method === 'GET' && path === `/api/2.0/permissions/apps/${APP_NAME}`) return 'policy';
  if (method === 'GET' && path === '/api/2.0/preview/scim/v2/Me' && token === PERSON_TOKEN) return 'policy';
  if (method === 'POST' && path === '/api/2.0/sql/statements') {
    const sql = String(body.statement || '');
    if (/^\s*SELECT\b/i.test(sql) && /__inspire_launch|__inspire_implement/.test(sql) && body.warehouse_id === APP_WAREHOUSE) return 'policy';
  }
  return 'action';
}

function json(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Map([['content-type', 'application/json']]),
    json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => Buffer.from(JSON.stringify(data)) };
}

async function stubFetch(url, opts = {}) {
  const u = new URL(String(url));
  const method = String(opts.method || 'GET').toUpperCase();
  const headers = opts.headers || {};
  const auth = String(headers.Authorization || headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let body = {};
  if (typeof opts.body === 'string') {
    try { body = JSON.parse(opts.body); } catch { body = {}; }
  }
  const call = { method, path: u.pathname, query: u.search, token, statement: body.statement || '', raw: typeof opts.body === 'string' ? opts.body : '', category: categoryOf(method, u.pathname, body, token) };
  state.calls.push(call);
  if (u.pathname === '/oidc/v1/token') return json({ access_token: APP_TOKEN, expires_in: 3600 });
  if (u.pathname === `/api/2.0/permissions/apps/${APP_NAME}`) {
    if (state.aclStatus !== 200) return json({ message: 'denied' }, state.aclStatus);
    if (token === PERSON_TOKEN && !state.personAppsScope) {
      return json({ error_code: 403, message: 'Provided OAuth token does not have required scopes: access-management' }, 403);
    }
    const me = String(state.person || '').toLowerCase();
    const manages = token === PERSON_TOKEN && (state.managers.map((m) => m.toLowerCase()).includes(me)
      || state.personGroups.some((g) => state.managerGroups.includes(g)));
    if (!manages) return json({ error_code: 'PERMISSION_DENIED', message: 'User 1 does not have apps.ruleSets/get on workspaces/1/apps/1/ruleSets/default' }, 403);
    return json({ access_control_list: [
      ...state.managers.map((user_name) => ({ user_name, all_permissions: [{ permission_level: 'CAN_MANAGE' }] })),
      ...state.managerGroups.map((group_name) => ({ group_name, all_permissions: [{ permission_level: 'CAN_MANAGE' }] })),
      { group_name: 'users', all_permissions: [{ permission_level: 'CAN_USE' }] },
    ] });
  }
  if (u.pathname === '/api/2.0/preview/scim/v2/Me') {
    if (token === PERSON_TOKEN) {
      const type = (display) => ((state.indirectGroups || []).includes(display) ? 'indirect' : 'direct');
      return json({ userName: state.person || '', groups: state.personGroups.map((display) => ({ display, type: type(display) })) });
    }
    return json({ userName: APP_SP, applicationId: APP_SP, displayName: APP_NAME });
  }
  if (u.pathname === '/api/2.0/sql/statements') return json(answerSql(body));
  if (u.pathname === '/api/2.0/workspace/import') return json({ message: 'stubbed import refused' }, 400);
  const folder = folderAnswer(state, { method, pathname: u.pathname, searchParams: u.searchParams, body, token }, writableBy);
  if (folder) return json(folder[1], folder[0]);
  if (u.pathname === '/api/2.0/workspace/get-status') return json({});
  if (token === PERSON_TOKEN && u.pathname.startsWith('/api/2.0/permissions/directories/')) {
    return json({ error_code: 403, message: 'Provided OAuth token does not have required scopes: access-management' }, 403);
  }
  if (token === PERSON_TOKEN && /^\/api\/2\.1\/unity-catalog\/(effective-permissions|permissions|volumes)\//.test(u.pathname)) {
    return json({ error_code: 403, message: 'Provided OAuth token does not have required scopes: unity-catalog' }, 403);
  }
  if (u.pathname === '/api/2.1/jobs/create') {
    state.createdJob = body;
    return json({ job_id: 5 });
  }
  if (u.pathname === '/api/2.1/jobs/run-now') {
    state.runJobs[String(state.nextRunId)] = state.createdJob;
    return json({ run_id: state.nextRunId });
  }
  if (u.pathname === '/api/2.1/jobs/runs/get' && state.runStates) {
    const id = u.searchParams.get('run_id');
    if (!state.runStates[id]) return json({ error_code: 'RESOURCE_DOES_NOT_EXIST', message: `Run ${id} does not exist.` }, 404);
    const job = state.runJobs[id] || {};
    return json({ run_id: Number(id), state: { life_cycle_state: state.runStates[id] }, tasks: (job.tasks || []).map((t) => ({ task_key: t.task_key, notebook_task: t.notebook_task })) });
  }
  return json({});
}

function writableBy(parent, token) {
  const [, top, catalog, schema, volume] = parent.split('/');
  const grant = top === 'Volumes' ? (state.volumes[`${catalog}.${schema}.${volume}`] || {}).writers : (state.folders[parent] || {}).writers;
  if (grant === '*') return true;
  if (token !== PERSON_TOKEN || !Array.isArray(grant)) return false;
  const reached = new Set([String(state.person || '').toLowerCase()]);
  let level = state.personGroups.map((g) => `group:${g}`);
  while (level.length) {
    level.forEach((g) => reached.add(g));
    level = level.flatMap((g) => (state.groupParents[g.slice('group:'.length)] || []).map((p) => `group:${p}`)).filter((g) => !reached.has(g));
  }
  return grant.some((who) => reached.has(String(who).toLowerCase()));
}

let started = null;

function startServer() {
  if (started) return started;
  Object.assign(process.env, ENV);
  global.fetch = stubFetch;
  for (const level of ['log', 'info', 'warn', 'error']) console[level] = (...args) => { state.logs.push(args.map(String).join(' ')); };
  const { app } = require('../../server');
  started = new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port })); });
  return started;
}

async function request(method, path, { person = 'nonowner@example.com', body, headers = {}, signedIn = true, userToken = true } = {}) {
  const { port } = await startServer();
  state.person = person;
  const sent = { 'content-type': 'application/json', ...headers };
  if (signedIn && person) {
    sent['x-forwarded-email'] = person;
    sent['x-forwarded-preferred-username'] = person;
    if (userToken) sent['x-forwarded-access-token'] = PERSON_TOKEN;
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: payload ? { ...sent, 'content-length': Buffer.byteLength(payload) } : sent }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        resolve({ status: res.statusCode, data, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function stopServer() {
  if (started) { const { server } = await started; await new Promise((resolve) => server.close(resolve)); }
  started = null;
}

module.exports = { APP_NAME, APP_SP, APP_DB, APP_WAREHOUSE, PERSON_TOKEN, state, reset, request, startServer, stopServer };
