const express = require('express');
const { registerImplementRoutes } = require('../../implementRoutes');
const { IMPLEMENT_COLUMNS } = require('../../lib/inspireImplement');
const { noPersonTokenBody } = require('../../lib/routePolicy');
const { sqlCancelledError } = require('../../lib/sqlStatements');

function sqlResultToObjects(result) {
  return result.rows || [];
}

function makeApp(overrides = {}, { mount } = {}) {
  const sqlCalls = [];
  const fetches = [];
  const jobs = [];
  const altered = [];
  const flagged = [];
  const appCalls = [];
  const launches = [];
  const catalogLists = [];
  const state = {
    implementColumns: IMPLEMENT_COLUMNS.map(([name]) => name),
    alertsOk: true,
    destinations: { results: [] },
    destinationsStatus: 200,
    session: { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.orders', generation_path: '/tmp/out', inspire_database_name: 'main.inspire' },
    useCase: { id: 'N01-U01', use_case: 'Predict churn', genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n' },
    history: [],
    columns: [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }],
    warehouses: { warehouses: [{ id: 'wh1', name: 'SQL' }] },
    appsOk: true,
    spacesOk: true,
    appExists: false,
    app: {},
    appsList: {},
    access: [
      { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'amr@x' },
      { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'amr@x' },
      { level: 'schema', privilege: 'OWNER', principal: 'amr@x', mine: 'true', me: 'amr@x' },
    ],
    others: 0,
    me: { userName: 'amr@x', displayName: 'Amr' },
    warehousePermissions: { access_control_list: [{ user_name: 'amr@x', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] },
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (state.forwardedToken) req.headers['x-forwarded-access-token'] = state.forwardedToken;
    if (state.forwardedEmail) req.headers['x-forwarded-email'] = state.forwardedEmail;
    const host = state.forwardedHost === undefined ? 'inspire.example.com' : state.forwardedHost;
    if (host && !req.headers['x-forwarded-host']) req.headers['x-forwarded-host'] = host;
    next();
  });
  if (mount) mount(app);
  app.use('/api/inspire/implement', async (req, _res, next) => { await (state.hold || {})[req.path]; next(); });
  registerImplementRoutes(app, {
    ...(state.buildStamp ? { buildStamp: () => state.buildStamp } : {}),
    requireToken: (req, _res, next) => {
      req.dbHost = 'https://workspace.example.com';
      req.dbToken = state.dbToken || 'tok';
      if (state.tokenKind) req.dbTokenKind = state.tokenKind;
      next();
    },
    executeSql: async (_h, token, warehouse, sql, parameters, options) => {
      if (options && options.signal && options.signal.aborted) throw sqlCancelledError(null);
      sqlCalls.push({ sql, parameters, token, warehouse, options });
      for (const [needle, message] of Object.entries(state.sqlErrors || {})) if (sql.includes(needle)) throw new Error(message);
      for (const [needle, out] of Object.entries(state.statements || {})) {
        if (sql.includes(needle)) return typeof out === 'function' ? out(sql, parameters, token) : out;
      }
      if (sql.startsWith('SELECT table_name, table_owner FROM')) return { rows: state.tableOwners || [] };
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (sql.startsWith('SELECT') && sql.includes('__inspire_control_log')) {
        if (state.controlLogError) throw new Error(state.controlLogError);
        return { rows: state.controlLog || [] };
      }
      if (sql.startsWith('DESCRIBE TABLE') && sql.includes('__inspire_usecases')) {
        return { rows: [...(state.useCaseColumns || []).map((col_name) => ({ col_name, data_type: 'string' })), { col_name: '', data_type: '' }] };
      }
      if (sql.includes('AS businesses FROM') && sql.includes('__inspire_session')) return { rows: state.portfolioRuns || [] };
      if (sql.includes('GROUP BY ROLLUP') && sql.includes('__inspire_usecases')) return { rows: state.portfolioUseCases || [] };
      if (sql.startsWith('DESCRIBE TABLE') && sql.includes('__inspire_implement')) {
        return { rows: [...state.implementColumns.map((col_name) => ({ col_name, data_type: 'string' })),
          { col_name: '', data_type: '' }, { col_name: '# Clustering Information', data_type: '' }, { col_name: 'session_id', data_type: '' }] };
      }
      if (sql.includes('__inspire_implement') && sql.includes('INSERT')) return { rows: [] };
      if (sql.includes('__inspire_implement') && sql.includes('`app_name` IS NOT NULL')) {
        if (state.registryError) throw new Error(state.registryError);
        return { rows: state.registry || [] };
      }
      if (sql.includes('__inspire_implement') && sql.includes('UPDATE')) return { rows: [] };
      if (sql.includes('__inspire_implement') && sql.includes('outputs.app_placement AS STRING')) return { rows: state.hubRows || [] };
      if (sql.includes('__inspire_implement') && sql.includes('held AS')) {
        if (state.holderError) throw new Error(state.holderError);
        const holders = state.resultTableHolders || [];
        if (Array.isArray(holders)) return { rows: holders };
        return { rows: holders[((parameters || []).find((p) => p.name === 't') || {}).value] || [] };
      }
      if (sql.includes('__inspire_implement')) {
        const unknown = IMPLEMENT_COLUMNS.map(([name]) => name)
          .find((name) => !state.implementColumns.includes(name) && sql.includes(`\`${name}\``) && !sql.includes(`NULL AS \`${name}\``));
        if (unknown) throw new Error(`[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name \`${unknown}\` cannot be resolved.`);
        if (sql.includes('GROUP BY ROLLUP')) return { rows: state.portfolioMvps || [] };
        return { rows: state.history };
      }
      if (sql.includes('u.business_domain AS domain')) return { rows: state.useCaseScope || [] };
      if (sql.includes('__inspire_usecases')) return { rows: state.useCase ? [state.useCase] : [] };
      if (sql.includes('_summary` WHERE use_case_id = :uc')) return { rows: state.moneySummary || [] };
      if (sql.includes('_assumptions` WHERE use_case_id = :uc')) return { rows: state.moneyEdits || [] };
      if (sql.includes('system.information_schema.catalogs')) {
        if (state.accessError) throw new Error(state.accessError);
        const asked = ((parameters || []).find((p) => p.name === 's') || {}).value;
        return { rows: (state.accessBySchema || {})[asked] || state.access };
      }
      if (sql.includes('COUNT_IF(use_case_id')) return { rows: [{ others: String(state.others) }] };
      if (sql.includes('information_schema.column_tags')) {
        if (state.tagsError) throw new Error(state.tagsError);
        return { rows: state.columnTags || [] };
      }
      if (sql.includes('information_schema.columns') && sql.includes('WITH o AS')) {
        return { rows: state.swapRowsByToken ? state.swapRowsByToken[token] || [] : state.swapRows || [] };
      }
      if (sql.includes('information_schema.columns') && state.columnsByTable) {
        const catalog = (/FROM `([^`]+)`\.information_schema\.columns/.exec(sql) || [])[1] || '';
        const named = (key) => ((parameters || []).find((p) => p.name === key) || {}).value || '';
        const table = `${catalog}.${named('s')}.${named('t')}`.toLowerCase();
        const found = Object.entries(state.columnsByTable).find(([name]) => name.toLowerCase() === table);
        return { rows: found ? found[1] : [] };
      }
      if (sql.includes('information_schema.columns')) return { rows: state.columns };
      if (sql.includes('__inspire_step')) {
        const since = (parameters || []).find((p) => p.name === 'since');
        const steps = state.steps || [];
        return { rows: since ? steps.filter((s) => Date.parse(s.last_updated) > Date.parse(since.value)) : steps };
      }
      if (sql.startsWith('SELECT COUNT(*) AS row_count')) {
        const named = Object.entries(state.readinessByTable || {}).find(([t]) => sql.includes(t.split('.').map((p) => `\`${p}\``).join('.')));
        return { rows: named ? [{ row_count: named[1] }] : state.readinessRows || [{ row_count: '1200' }] };
      }
      for (const [table, message] of Object.entries(state.probeErrors || {})) {
        if (sql === `SELECT * FROM ${table} LIMIT 0`) throw new Error(message);
      }
      return { rows: [] };
    },
    sqlResultToObjects,
    dbFetch: async (_host, token, path, opts = {}) => {
      fetches.push({ path, opts, token });
      const routed = `${String(opts.method || 'GET').toUpperCase()} ${path.split('?')[0]}`;
      if (state.workspace) {
        const got = await state.workspace({ token, path, method: String(opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null });
        if (got !== undefined) return json(got[0], got[1] || 200);
      }
      const ucTable = /^\/api\/2\.1\/unity-catalog\/tables\/([^/?]+)$/.exec(path);
      if (ucTable) {
        const name = decodeURIComponent(ucTable[1]).toLowerCase();
        const readable = !state.readableTables || (state.readableTables[token] || []).some((t) => t.toLowerCase() === name);
        return readable ? json({ full_name: name }) : json({ error_code: 'PERMISSION_DENIED', message: `User does not have SELECT on Table '${name}'.` }, 403);
      }
      if (state.fetchThrows && Object.prototype.hasOwnProperty.call(state.fetchThrows, routed)) throw new Error(state.fetchThrows[routed]);
      if (state.responses && Object.prototype.hasOwnProperty.call(state.responses, routed)) {
        const [data, status = 200] = state.responses[routed];
        return json(data, status);
      }
      if (path.includes('/scim/v2/Me')) return json(state.me);
      if (path.startsWith('/api/2.0/permissions/sql/warehouses/')) {
        return json(state.warehousePermissions, state.warehousePermissionsStatus || 200);
      }
      if (path.includes('/sql/warehouses')) return json(state.warehouses);
      if (path.match(/\/api\/2\.0\/apps\/.+/) && !path.includes('page_size') && state.appsByName) {
        const found = state.appsByName[decodeURIComponent(path.split('/').pop())];
        return json(found || { error_code: 'NOT_FOUND' }, found ? found.status_code || 200 : 404);
      }
      if (path.match(/\/api\/2\.0\/apps\/.+/ ) && !path.includes('page_size')) return json(state.app, state.appExists ? 200 : 404);
      if (path.includes('/api/2.0/apps')) return json(state.appsList, state.appsOk ? 200 : 404);
      if (path.includes('/genie/spaces')) return json({}, state.spacesOk ? 200 : 404);
      if (path.startsWith('/api/2.0/lakeview/dashboards/') && path.endsWith('/published')) return json({}, state.dashboardPublished === false ? 404 : 200);
      if (path.startsWith('/api/2.0/lakeview/dashboards/')) return json({ display_name: 'Dashboard', lifecycle_state: 'ACTIVE' });
      if (path.startsWith('/api/2.0/alerts')) return json(state.alert || {}, state.alertsOk ? 200 : 403);
      if (path.startsWith('/api/2.0/notification-destinations')) {
        const pages = Array.isArray(state.destinations) ? state.destinations : [state.destinations];
        const token = new URL(`https://x${path}`).searchParams.get('page_token');
        return json(pages[token ? Number(token) : 0], state.destinationsStatus);
      }
      if (path === '/api/2.1/jobs/run-now') return json({ run_id: 501 });
      if (path.startsWith('/api/2.1/jobs/runs/get')) {
        return json(state.implementRun || { run_id: 99, state: { life_cycle_state: 'RUNNING' } }, state.implementRunStatus || 200);
      }
      if (path.startsWith('/api/2.1/jobs/list')) return json(state.jobsList || { jobs: [] }, state.jobsListStatus || 200);
      if (path.startsWith('/api/2.1/jobs/runs/list')) {
        const jobId = new URL(`https://x${path}`).searchParams.get('job_id');
        return json((state.runsByJob && state.runsByJob[jobId]) || state.runs || { runs: [] }, state.runsStatus || 200);
      }
      if (path.startsWith('/api/2.1/jobs/get')) return json(state.job || { job_id: 77 }, state.jobStatus || 200);
      if (path.includes('/serving-endpoints')) return json({ endpoints: [{ name: 'databricks-meta-llama-3-3-70b-instruct' }] });
      if (path.includes('/fs/files') && state.liveLogs) {
        const log = state.liveLogs[path.split('/').pop()];
        if (log instanceof Error) return { ok: true, status: 200, text: async () => { throw log; } };
        return log === undefined ? json('raw', 404) : json(log);
      }
      if (path.includes('/fs/files')) return state.liveLog === undefined ? json('raw', 404) : json(state.liveLog);
      if (path.startsWith('/ai-gateway/')) {
        const gateway = { codex: [], claude: [], answer: () => [{ object: 'response' }], ...(state.gateway || {}) };
        if (routed.startsWith('GET ')) {
          return path.startsWith('/ai-gateway/anthropic/') ? json({ data: gateway.claude.map((id) => ({ id })) })
            : json({ models: gateway.codex.map((slug) => ({ slug })) });
        }
        const [data, status = 200] = gateway.answer(path, JSON.parse(opts.body || '{}').model);
        return json(data, status);
      }
      return json({ message: 'not mocked ' + path }, 500);
    },
    fetchInspireSessionWidgetRow: async () => state.session,
    notebookParamsFromSessionForGenerateRun: (session, sid) => ({
      '15_operation': 'Generate Use Cases',
      '00_business_name': session.business_name,
      '01_uc_metadata': state.ucMetadata === undefined ? 'main.s.orders' : state.ucMetadata,
      '02_inspire_database': 'main.inspire',
      '14_session_id': sid,
    }),
    triggerInspireNotebookJob: async (_h, _t, args) => {
      jobs.push(args);
      if (state.triggerError) throw new Error(state.triggerError);
      if (state.afterTrigger) state.afterTrigger(args);
      return { run_id: 99, job_id: 7, notebook_path: '/Shared/nb', job_run_url: 'https://example/#job/7/run/99' };
    },
    splitInspireDatabase: (v) => {
      const parts = String(v || '').split('.');
      return parts.length === 2 ? { catalog: parts[0], schema: parts[1] } : null;
    },
    databricksJobRunUrl: (_h, jobId, runId) => `https://example/#job/${jobId}/run/${runId}`,
    ensureTableColumns: async (_h, _t, _w, table, columns) => {
      altered.push({ table, columns });
      for (const [name] of columns) if (!state.implementColumns.includes(name)) state.implementColumns.push(name);
    },
    runRoute1GenieFlagUpdates: async (_h, _t, warehouseId, catalog, schema, sid, ids) => {
      flagged.push({ warehouseId, catalog, schema, sid, ids });
    },
    hostedRun: state.hostedRun || null,
    appToken: async () => state.appToken || '',
    useCaseAlerts: state.useCaseAlerts,
    runDefaults: () => state.runDefaults || {},
    appFetch: async (url, opts = {}) => {
      appCalls.push({ url, method: String(opts.method || 'GET').toUpperCase(), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
      const routed = `${String(opts.method || 'GET').toUpperCase()} ${new URL(url).pathname}`;
      if (state.appThrows) throw new Error(state.appThrows);
      const [data, status = 200] = (state.appApi || {})[routed] || [{ error: `no API route ${routed}` }, 404];
      return json(typeof data === 'function' ? data(appCalls[appCalls.length - 1]) : data, status);
    },
  });
  app.get('/api/inspire/results', (req, res) => {
    const sid = String(req.query.session_id || '');
    if (sid && (state.deniedRuns || []).includes(sid)) {
      return res.status(403).json({ error: 'PERMISSION_DENIED: User does not have SELECT on Table `main`.`inspire`.`__inspire_session`.' });
    }
    if (sid && state.knownRuns && !state.knownRuns.includes(sid)) return res.json({ results: null, found: false });
    return res.json({ results: state.results || null, found: true });
  });
  app.get('/api/inspire/sessions', (req, res) => {
    state.sessionsAsked = [...(state.sessionsAsked || []), { ...req.query }];
    if (state.sessionsErrors?.length) return res.status(500).json({ error: state.sessionsErrors.shift() });
    return res.json({
      sessions: state.sessions || [{ session_id: '42', completed_percent: 100, business_name: state.session.business_name, widget_values: { business: state.session.business_name } }],
      truncated: Boolean(state.sessionsTruncated),
    });
  });
  app.get('/api/inspire/step-results', (_req, res) => res.json({ results: state.stepResults || null }));
  app.get('/api/warehouses', (_req, res) => {
    const listed = (state.warehouses && state.warehouses.warehouses) || [];
    return res.json({ warehouses: listed.map((w) => ({ id: w.id, name: w.name, state: w.state, cluster_size: w.cluster_size })) });
  });
  app.get('/api/catalogs', (req, res) => {
    catalogLists.push(req.query);
    if (state.catalogsError) return res.status(500).json({ error: state.catalogsError });
    if (state.noPersonToken) return res.status(401).json(noPersonTokenBody('GET /api/catalogs'));
    return res.json({ catalogs: (state.catalogs || ['main']).map((name) => ({ name })), truncated: Boolean(state.catalogsCut) });
  });
  app.get('/api/tables/:catalog/:schema', (req, res) => {
    const scope = `${req.params.catalog}.${req.params.schema}`;
    const names = (state.tables || {})[scope] || [];
    return res.json({ tables: names.map((name) => ({ name, full_name: `${scope}.${name}`, schema_name: req.params.schema })), count: names.length });
  });
  app.post('/api/output-folder/check', (req, res) => res.json({ allowed: true, folder: String((req.body || {}).generation_path || '/Shared/demos'), checked: 'passed' }));
  app.post('/api/demo-data/start', (req, res) => {
    launches.push(req.body);
    const [status, data] = state.demoAnswer || [200, { ok: true, session_id: '1', pipeline: { inspire_agent_notebook: '/Shared/inspire-ai/agent' } }];
    res.status(status).json(data);
  });

  app.post('/api/run', (req, res) => {
    launches.push(req.body);
    const [status, data] = state.runAnswer || [200, { run_id: 99 }];
    return res.status(status).json(data);
  });
  app.get('/api/catalogs/:catalog/schemas', (req, res) => {
    if (state.noPersonToken) return res.status(401).json(noPersonTokenBody('GET /api/catalogs/:catalog/schemas'));
    const names = (state.schemas || { main: ['inspire', 's'] })[req.params.catalog] || [];
    return res.json({ schemas: names.map((name) => ({ name, full_name: `${req.params.catalog}.${name}` })) });
  });
  app.get('/api/inspire/feedback', (_req, res) => res.json(state.feedback || { available: false, latest: [], message: '' }));
  app.get('/api/inspire/session', (_req, res) => res.json({ session: state.inspireSession || null }));
  app.get('/api/inspire/steps', (_req, res) => res.json({ steps: state.runSteps || [], count: (state.runSteps || []).length }));
  app.get('/api/workspace/export', (req, res) => {
    const text = (state.notebooks || {})[req.query.path];
    if (text === undefined) return res.status(404).json({ error: 'not found', tried: [req.query.path] });
    return res.type('text/plain').send(text);
  });
  app.get('/api/workspace/list', (_req, res) => res.json({ files: [] }));
  app.get('/api/inspire/usecases', (_req, res) => {
    const usecases = state.useCases || (state.useCase ? [state.useCase] : []);
    res.json({ usecases, count: usecases.length });
  });
  return { app, sqlCalls, fetches, jobs, state, altered, flagged, appCalls, launches, catalogLists };
}

function json(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

module.exports = { makeApp, json, listen, sqlResultToObjects };
