const express = require('express');
const { registerImplementRoutes } = require('../../implementRoutes');
const { IMPLEMENT_COLUMNS } = require('../../lib/inspireImplement');
const { noPersonTokenBody } = require('../../lib/routePolicy');
const { sqlCancelledError } = require('../../lib/sqlStatements');
const { withServicePrincipal } = require('./appRecord');
const { lakebaseCatalogOf } = require('../../lib/appShell');

function sqlResultToObjects(result) {
  return result.rows || [];
}

// The Data Management reads (REQ-370), answered from state.columnsByTable: the column search (ILIKE :q, one query per catalog) and the
// columns of a picked scope (one query per catalog, the picked tables bound as s<i> and t<i>). A metric view is not in columnsByTable.
function scopeRowsOf(columnsByTable, sql, parameters) {
  const catalog = ((/FROM `([^`]+)`\.information_schema\.columns/.exec(sql) || [])[1] || '').toLowerCase();
  const named = (re) => parameters.filter((p) => re.test(p.name));
  const whole = sql.includes('(TRUE)');
  const searching = sql.includes('ILIKE :q');
  // The pattern decides the match as ILIKE does: a leading % is ends-with, a trailing % is starts-with, both is contains (REQ-379).
  const raw = searching ? String(named(/^q$/)[0].value) : '';
  const leading = raw.startsWith('%');
  const trailing = raw.endsWith('%') && !raw.endsWith('\\%');
  const text = raw.slice(leading ? 1 : 0, trailing ? -1 : undefined).replace(/\\([\\%_])/g, '$1').toLowerCase();
  const textMatches = (name) => {
    if (leading && !trailing) return name.endsWith(text);
    if (trailing && !leading) return name.startsWith(text);
    return name.includes(text);
  };
  const schemas = searching ? named(/^s\d+$/).map((p) => p.value) : [];
  const pairs = searching
    ? named(/^ts\d+$/).map((p, i) => [p.value, (named(/^tt\d+$/).find((x) => x.name === `tt${i}`) || {}).value])
    : named(/^s\d+$/).map((p, i) => [p.value, (named(/^t\d+$/).find((x) => x.name === `t${i}`) || {}).value]);
  const inScope = (schema, table) => whole || schemas.includes(schema) || pairs.some(([s, t]) => s === schema && t === table);
  const rows = [];
  for (const [name, cols] of Object.entries(columnsByTable)) {
    const [c, schema, table] = name.split('.');
    if (c.toLowerCase() !== catalog || !inScope(schema, table)) continue;
    for (const col of cols) {
      if (searching && !textMatches(col.column_name.toLowerCase())) continue;
      rows.push({ table_schema: schema, table_name: table, column_name: col.column_name, data_type: col.data_type });
    }
  }
  if (!searching) return rows;
  return rows.slice(0, 300).map((r) => ({ ...r, total: rows.length }));
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
    profiles: [],
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
    // REQ-418: the App reads and saves with the warehouse as its service principal, so that is the principal that holds CAN MANAGE.
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp-id', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] },
    ...overrides,
  };
  const app = express();
  app.use(express.json({ limit: '50mb' })); // REQ-526: as server.js; a designed A4 PDF is far above the 100 kB default
  app.use((req, _res, next) => {
    if (state.forwardedToken) req.headers['x-forwarded-access-token'] = state.forwardedToken;
    if (state.forwardedEmail) req.headers['x-forwarded-email'] = state.forwardedEmail;
    const host = state.forwardedHost === undefined ? 'inspire.example.com' : state.forwardedHost;
    if (host && !req.headers['x-forwarded-host']) req.headers['x-forwarded-host'] = host;
    next();
  });
  if (mount) mount(app);
  app.use('/api/inspire/implement', async (req, _res, next) => { await (state.hold || {})[req.path]; next(); });
  // REQ-311: Request for Access. state.accessCheck is the offer the check reads; state.accessSend is the answer to the send, and
  // state.accessSent records the statements the dialog sent.
  app.post('/api/access-request/check', (req, res) => res.json(state.accessCheck || { offered: false, destinations: [], reason: 'no one has set up where access requests for these go yet' }));
  app.post('/api/access-request', (req, res) => {
    if (Array.isArray(req.body?.objects)) {
      state.accessSentObjects = req.body.objects;
      const results = req.body.objects.map((o) => ({ type: o.type, full_name: o.full_name, sent: true, destinations: ['owner@example.com'], reason: '' }));
      return res.json(state.accessSend || { sent: true, destinations: ['owner@example.com'], reason: '', links: [], results });
    }
    state.accessSent = req.body?.statements || [];
    res.json(state.accessSend || { sent: false, destinations: [], reason: 'no destination' });
  });
  async function dbFetchImpl(_host, token, path, opts = {}) {
        fetches.push({ path, opts, token });
        if (state.fetchLatencyMs) await new Promise((done) => setTimeout(done, state.fetchLatencyMs));
        const routed = `${String(opts.method || 'GET').toUpperCase()} ${path.split('?')[0]}`;
        if (state.workspace) {
          const got = await state.workspace({ token, path, method: String(opts.method || 'GET').toUpperCase(), body: opts.body ? JSON.parse(opts.body) : null });
          if (got !== undefined) return json(got[0], got[1] || 200);
        }
        if (/^\/api\/2\.1\/unity-catalog\/policies\/table\//i.test(path)) {
          const denied = typeof state.abacUnreadable === 'function' ? state.abacUnreadable(token)
            : state.abacUnreadable && (!state.abacUnreadableAppOnly || token === (state.dbToken || 'tok'));
          if (denied) return json({ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403);
          // REQ-418: `policies` maps a table (lower case) to its policies, e.g. { 'main.s.orders': [{ policy_type: 'POLICY_TYPE_ROW_FILTER' }] }.
          const policied = /^\/api\/2\.1\/unity-catalog\/policies\/table\/([^/?]+)/i.exec(path);
          const listed = policied ? (state.policies || {})[decodeURIComponent(policied[1]).toLowerCase()] : null;
          return json({ policies: listed || [] });
        }
        const ucTable = /^\/api\/2\.1\/unity-catalog\/tables\/([^/?]+)$/.exec(path);
        if (ucTable) {
          const name = decodeURIComponent(ucTable[1]).toLowerCase();
          const readable = !state.readableTables || (state.readableTables[token] || []).some((t) => t.toLowerCase() === name);
          const rowFilter = (state.rowFilters || {})[name];
          return readable ? json(rowFilter ? { full_name: name, row_filter: rowFilter } : { full_name: name }) : json({ error_code: 'PERMISSION_DENIED', message: `User does not have SELECT on Table '${name}'.` }, 403);
        }
        if (state.fetchThrows && Object.prototype.hasOwnProperty.call(state.fetchThrows, routed)) throw new Error(state.fetchThrows[routed]);
        if (state.responses && Object.prototype.hasOwnProperty.call(state.responses, routed)) {
          const [data, status = 200] = state.responses[routed];
          return json(data, status);
        }
        // RC6-C-04: the Lakebase catalog the build writes to exists by default; the name is the one the backend reads (a test overrides it through state.responses).
        if (path.split('?')[0] === `/api/2.1/unity-catalog/catalogs/${encodeURIComponent(lakebaseCatalogOf())}`) return json({ name: lakebaseCatalogOf() });
        // REQ-418: the App's own token answers as the App's service principal; a person's token answers as the person.
        if (path.includes('/scim/v2/Me')) return json(token === (state.dbToken || 'tok') ? (state.appMe || { applicationId: state.builtAppSp || 'app-sp-id', displayName: 'inspire-manual' }) : state.me, 200, state.orgId === undefined ? ORG_ID : state.orgId);
        if (path.startsWith('/api/2.0/permissions/sql/warehouses/')) {
          return json(state.warehousePermissions, state.warehousePermissionsStatus || 200);
        }
        if (path.includes('/sql/warehouses')) return json(state.warehouses);
        // The built App's record: its service principal is the one the fixtures name as the App's (the host identity by default).
        const builtApp = /^\/api\/2\.0\/apps\/([^/?]+)$/.exec(path);
        if (builtApp && !state.appsByName && state.builtAppSp !== undefined) return json({ name: decodeURIComponent(builtApp[1]), service_principal_client_id: state.builtAppSp, service_principal_name: 'app-sp' });
        if (path.match(/\/api\/2\.0\/apps\/.+/) && !path.includes('page_size') && state.appsByName) {
          const found = state.appsByName[decodeURIComponent(path.split('/').pop())];
          return json(withServicePrincipal(found) || { error_code: 'NOT_FOUND' }, found ? found.status_code || 200 : 404);
        }
        if (path.match(/\/api\/2\.0\/apps\/.+/ ) && !path.includes('page_size')) return json(withServicePrincipal(state.app), state.appExists ? 200 : 404);
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
      }

  registerImplementRoutes(app, {
    ...(state.buildStamp ? { buildStamp: () => state.buildStamp } : {}),
    requireToken: (req, _res, next) => {
      req.dbHost = 'https://workspace.example.com';
      // state.dbToken '' is an App with no credential; unset is the harness App token.
      req.dbToken = state.dbToken === undefined ? 'tok' : state.dbToken;
      if (state.tokenKind) req.dbTokenKind = state.tokenKind;
      next();
    },
    executeSql: async (_h, token, warehouse, sql, parameters, options) => {
      if (options && options.signal && options.signal.aborted) throw sqlCancelledError(null);
      if (state.sqlLatencyMs) await new Promise((done) => setTimeout(done, state.sqlLatencyMs));
      sqlCalls.push({ sql, parameters, token, warehouse, options });
      // A denial needle matches the statement text and its bound parameters (a picked table is often bound, not written, into the SQL).
      const denialText = `${sql} ${JSON.stringify(parameters || [])}`;
      for (const [needle, message] of Object.entries(state.sqlErrors || {})) if (denialText.includes(needle)) throw new Error(message);
      // sqlDeniedFor: { [token]: { [needle]: message } } refuses a read made with that token only (REQ-267: the person cannot read the App's table).
      for (const [needle, message] of Object.entries((state.sqlDeniedFor || {})[token] || {})) if (denialText.includes(needle)) throw new Error(message);
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
        // The real query filters by use case (use_case_id = :uc); the fixture history is for the whole session.
        const askedHistory = ((parameters || []).find((p) => p.name === 'uc') || {}).value;
        return { rows: (state.history || []).filter((row) => askedHistory === undefined || String(row.use_case_id) === String(askedHistory)) };
      }
      if (sql.includes('u.business_domain AS domain')) return { rows: state.useCaseScope || [] };
      if (sql.includes('__inspire_usecases')) {
        // REQ-569 (e80ada8d6 ids): the row read asks for every stored form of the id (:uc0, :uc1), the older reads for :uc.
        const asked = (parameters || []).filter((p) => /^uc\d*$/.test(p.name)).map((p) => String(p.value));
        const listed = (state.useCases || []).find((row) => asked.includes(String(row.id)));
        return { rows: listed ? [listed] : (state.useCase ? [state.useCase] : []) };
      }
      // The run summary of every use case is one batched statement (REQ-323): each row carries the use_case_id of the parameter it answers.
      if (sql.includes('AS run_rank')) {
        const ids = (parameters || []).filter((p) => /^uc\d+$/.test(p.name)).map((p) => p.value);
        return { rows: ids.flatMap((id) => (state.moneySummary || []).map((row) => ({ use_case_id: id, ...row }))) };
      }
      if (sql.includes('_summary` WHERE use_case_id = :uc')) return { rows: state.moneySummary || [] };
      if (sql.includes('_assumptions` WHERE use_case_id = :uc')) return { rows: state.moneyEdits || [] };
      if (sql.includes('system.information_schema.catalogs') && !sql.includes('WITH o AS')) {
        if (state.accessError) throw new Error(state.accessError);
        const asked = ((parameters || []).find((p) => p.name === 's') || {}).value;
        return { rows: (state.accessBySchema || {})[asked] || state.access };
      }
      if (sql.includes('COUNT_IF(use_case_id')) return { rows: [{ others: String(state.others) }] };
      if (sql.includes('information_schema.column_tags')) {
        if (state.tagsError) throw new Error(state.tagsError);
        return { rows: state.columnTags || [] };
      }
      if (sql.includes('SELECT DISTINCT CAST(')) {
        const column = (/SELECT DISTINCT CAST\(`([^`]+)`/.exec(sql) || [])[1] || '';
        return { rows: ((state.valuesByColumn || {})[column] || []).map((value) => ({ value })) };
      }
      if (sql.includes('key_column_usage')) {
        return { rows: (state.primaryKeys || []).map((column_name) => ({ column_name })) };
      }
      if (sql.includes('SELECT COUNT(*) AS matched')) return { rows: state.matchRows || [{ matched: '4', total: '4' }] };
      if (sql.includes('table_type FROM') && sql.includes('information_schema.tables')) {
        // The table type of one picked table: a metric view when the test names it in metricViews, else a managed table.
        const catalog = (/FROM `([^`]+)`\.information_schema\.tables/.exec(sql) || [])[1] || '';
        const named = (key) => ((parameters || []).find((p) => p.name === key) || {}).value || '';
        const name = `${catalog}.${named('s')}.${named('t')}`.toLowerCase();
        const views = (state.metricViews || []).map((v) => String(v).toLowerCase());
        return { rows: [{ table_type: views.includes(name) ? 'METRIC_VIEW' : 'MANAGED' }] };
      }
      if (sql.includes('information_schema.columns') && sql.includes('WITH o AS')) {
        return { rows: state.swapRowsByToken ? state.swapRowsByToken[token] || [] : state.swapRows || [] };
      }
      if (sql.includes('information_schema.columns') && state.columnsByTable && (sql.includes('ILIKE :q') || sql.includes('table_schema = lower(:s0)'))) {
        return { rows: scopeRowsOf(state.columnsByTable, sql, parameters || []) };
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
      // REQ-380: the reason an empty group list gets (rows read and rows with a value under the same filters).
      if (sql.startsWith('SELECT COUNT(*) AS rows_read')) return { rows: [state.groupReasonRow || { rows_read: '1200', with_value: '1200' }] };
      if (sql.includes(' GROUP BY ') && sql.includes(' AS records FROM ')) {
        const grouped = (/CAST\(`([^`]+)` AS STRING\) AS/.exec(sql) || [])[1] || '';
        return { rows: (state.groupCountsByColumn || {})[grouped] || state.groupCounts || [] };
      }
      if (sql.startsWith('SELECT COUNT(*) AS row_count')) {
        const filtered = (parameters || []).map((p) => String(p.value)).find((v) => state.readinessByFilter && Object.hasOwn(state.readinessByFilter, v));
        if (filtered !== undefined) return { rows: [{ row_count: state.readinessByFilter[filtered] }] };
        const named = Object.entries(state.readinessByTable || {}).find(([t]) => sql.includes(t.split('.').map((p) => `\`${p}\``).join('.')));
        return { rows: named ? [{ row_count: named[1] }] : state.readinessRows || [{ row_count: '1200' }] };
      }
      const appDenied = token === (state.dbToken || 'tok') ? state.appProbeErrors || {} : {};
      for (const [table, message] of Object.entries({ ...(state.probeErrors || {}), ...appDenied })) {
        if (sql === `SELECT * FROM ${table} LIMIT 0`) throw new Error(message);
      }
      return { rows: [] };
    },
    sqlResultToObjects,
    dbFetch: dbFetchImpl,
    fetchInspireSessionWidgetRow: async () => state.session,
    notebookParamsFromSessionForGenerateRun: (session, sid) => ({
      '15_operation': 'Implement Use Cases',
      '00_business_name': session.business_name,
      '01_uc_metadata': state.ucMetadata === undefined ? 'main.s.orders' : state.ucMetadata,
      '02_inspire_database': 'main.inspire',
      '14_session_id': sid,
      ...(session.table_scope ? { '17_table_scope': session.table_scope } : {}),
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
    // SEC-02: the session check of server.js (L1). The harness person may see every session unless a test sets state.hiddenSessions.
    sessionHidden: async (_req, sid) => (state.hiddenSessions && state.hiddenSessions.includes(String(sid)) ? { status: 403, request: 'person', permissions: [], unreadable: [] } : null),
    visibleSessions: async (_req, sessions) => sessions.filter((s) => !(state.hiddenSessions && state.hiddenSessions.includes(String(s.session_id)))),
    useCaseAlerts: state.useCaseAlerts,
    runDefaults: () => state.runDefaults || {},
    // c23 SEC-07: the harness person is an App manager (so a caller-chosen database and warehouse are kept) unless a test sets state.manager = false.
    ...(state.noIsManager ? {} : { isManager: async () => state.manager !== false }),
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
  app.get('/api/inspire/profiles', (req, res) => {
    const business = String(req.query.business_name || '').trim().toLowerCase();
    const listed = (state.profiles || []).filter((p) => !business || String(p.business_name).toLowerCase() === business);
    res.json({ profiles: listed.map(profileSummaryOf) });
  });
  app.get('/api/inspire/profiles/:profileId', (req, res) => {
    if (state.profileRefusal) return res.status(403).json({ error: state.profileRefusal.message, permissions: state.profileRefusal.permissions });
    const found = (state.profiles || []).find((p) => p.profile_id === req.params.profileId);
    if (!found) return res.status(404).json({ error: 'That business profile was not found' });
    return res.json({ profile: found });
  });
  app.post('/api/inspire/profiles', (req, res) => {
    const body = req.body || {};
    state.profileSaves = [...(state.profileSaves || []), body];
    const taken = (state.profiles || []).find((p) => p.name.toLowerCase() === String(body.name || '').trim().toLowerCase());
    if (taken && !body.overwrite) return res.status(409).json({ error: `A business profile named "${body.name}" already exists.`, exists: true, profile_id: taken.profile_id });
    const row = { profile_id: taken ? taken.profile_id : `profile-${(state.profiles || []).length + 1}`, name: String(body.name || '').trim(),
      business_name: String(body.business_name || ''), updated_by: 'amr@x', updated_at: '2026-11-16T09:00:00Z', spec: body.spec || {} };
    state.profiles = taken ? state.profiles.map((p) => (p.profile_id === taken.profile_id ? row : p)) : [...(state.profiles || []), row];
    return res.json({ profile: profileSummaryOf(row) });
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
    if (state.tablesRefusal) return require('../../lib/permissionError').sendFailure(res, 403, state.tablesRefusal);
    const names = (state.tables || {})[scope] || [];
    // state.unusableTables: full name -> reason (the picker shows the row as not usable); state.leftOut: scope -> {count, schema}.
    const unusable = state.unusableTables || {};
    // state.busyTables: full name -> reason (the picker shows the row as busy: not a verdict, and it can be checked again).
    const busy = state.busyTables || {};
    const tables = names.map((name) => {
      const full = `${scope}.${name}`;
      const flag = unusable[full] ? { usable: false, unusable_reason: unusable[full] }
        : busy[full] ? { type_check: 'busy', unusable_reason: busy[full] } : {};
      return { name, full_name: full, schema_name: req.params.schema, ...flag };
    });
    // state.metricViews: full names of the metric views in this schema, left out of the listing and named back (REQ-370).
    const metricViews = (state.metricViews || []).filter((v) => String(v).toLowerCase().startsWith(`${scope.toLowerCase()}.`));
    return res.json({ tables, count: names.length, metric_views: metricViews, ...((state.leftOut || {})[scope] ? { left_out: state.leftOut[scope] } : {}) });
  });
  app.post('/api/output-folder/check', (req, res) => {
    if (state.outputRefusal) return res.status(403).json({ error: state.outputRefusal.message, permissions: state.outputRefusal.permissions });
    return res.json({ allowed: true, folder: String((req.body || {}).generation_path || '/Shared/demos'), checked: 'passed' });
  });
  app.post('/api/demo-data/start', (req, res) => {
    launches.push(req.body);
    const [status, data] = state.demoAnswer || [200, { ok: true, session_id: '1', pipeline: { inspire_agent_notebook: '/Shared/inspire-ai/agent' } }];
    res.status(status).json(data);
  });

  app.get('/api/run/:runId', (req, res, next) => (state.runRead ? res.status(state.runRead.status || 200).json(state.runRead.body || {}) : next()));
  // state.checkHold / state.runHold: the backend never answers that call (a stalled warehouse), so the browser must end the spinner itself.
  app.post('/api/run/check', (req, res) => {
    if (state.checkHold) return undefined;
    res.json({ permissions: state.checkPermissions || [], warnings: [] });
    return undefined;
  });
  app.post('/api/run', (req, res) => {
    launches.push(req.body);
    if (state.runHold) return undefined;
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
  // c33 (REQ-578, REQ-579): every Monitor and Results page asks whether its session is a Match run; a test's own mount answers first.
  app.get('/api/inspire/match/result', (_req, res) => res.json(state.matchResult || { state: 'none', inputs: [], reports: [], decisions: [] }));
  // c36 (REQ-581): a live Use Cases stage on the Monitor reads the provisional candidates; a test's own mount answers first.
  app.get('/api/inspire/candidates', (_req, res) => res.json(state.candidates || { candidates: [] }));
  // c33 (REQ-577): the Start page advances the person's waiting plan runs on every visit; a test's own mount answers first.
  app.post('/api/inspire/plan/advance', (_req, res) => res.json(state.planAdvance || { started: [] }));
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
  app.get('/api/inspire/value', (_req, res) => res.json(state.value || { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json(state.valueEstimates || { use_cases: {}, totals: { estimated: {} } }));
  return { app, sqlCalls, fetches, jobs, state, altered, flagged, appCalls, launches, catalogLists };
}

// Business profiles as the App shares them (REQ-364 to REQ-366). state.profiles holds the saved rows; state.profileSaves records each save the page sent.
function profileSummaryOf(row) {
  return { profile_id: row.profile_id, name: row.name, business_name: row.business_name, updated_by: row.updated_by, updated_at: row.updated_at };
}

// The workspace id every Databricks response carries in x-databricks-org-id.
const ORG_ID = '1234567890123456';

function json(data, status = 200, orgId = ORG_ID) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'x-databricks-org-id' && orgId ? orgId : null) },
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

module.exports = { makeApp, json, listen, sqlResultToObjects, ORG_ID };
