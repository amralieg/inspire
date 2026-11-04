const { isMissingTableError } = require('./lib/inspireFeedback');
const { stepsStatement } = require('./lib/sqlInputs');
const I = require('./lib/inspireImplement');
const { createGenieJobGuard } = require('./lib/genieJobGuard');
const { genieNotebookJobName, latestGenieNotebookRun } = require('./lib/genieNotebookJob');
const C = require('./lib/implementControl');
const { appShellCatalog } = require('./lib/appShell');
const { moneyStatements, moneyView } = require('./lib/implementMoney');
const { HOSTED_NO_TOKEN } = require('./lib/hostedRun');
const { inspireJobEnvironmentChange, inspireJobEnvironmentWarning, inspireJobTestTagChange, inspireJobTestTagWarning } = require('./lib/inspireJobParams');
const R = require('./lib/reviewFigures');
const A = require('./lib/useCaseAlerts');
const P = require('./lib/requestPerson');
const RP = require('./lib/routePolicy');
const U = require('./lib/ucReads');
const G = require('./lib/groupingSql');
const GR = require('./lib/groupingRule');
const GP = require('./lib/groupingProfile');
const { runWithRequestDeadline } = require('./lib/sqlStatements');
const { fsApiPath } = require('./lib/workspacePaths');
const { int64Id, isInt64Id, requireInt64Id, jsonWithInt64Ids } = require('./lib/int64Id');
const { parseExactJson } = require('./lib/exactJson');
const { grantJobViewer, rememberViewer } = require('./lib/jobViewer');

function sendError(res, err) {
  const code = err && Number.isFinite(err.statusCode) ? err.statusCode : 500;
  return res.status(code).json({ ...(err && err.details), error: err.message || String(err) });
}

function q(req, key) {
  const v = req.query[key] ?? req.body?.[key];
  return v == null ? '' : String(v).trim();
}

function principalsOf(req) {
  const raw = q(req, 'principals');
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw I.badRequest('principals must be a JSON list of principal names');
  }
  if (!Array.isArray(parsed)) throw I.badRequest('principals must be a JSON list of principal names');
  return parsed.map((p) => String(p == null ? '' : p).trim()).filter(Boolean).slice(0, 100);
}

function sessionIdOf(req) {
  const sid = int64Id(q(req, 'session_id'));
  if (!sid) {
    const err = new Error('session_id must be a numeric Inspire session id.');
    err.statusCode = 400;
    throw err;
  }
  return sid;
}

function warehouseOf(req) {
  const warehouseId = q(req, 'warehouse_id');
  if (!warehouseId) {
    const err = new Error('warehouse_id is required.');
    err.statusCode = 400;
    throw err;
  }
  return warehouseId;
}

function dbOf(req, splitInspireDatabase) {
  const inspire_database = q(req, 'inspire_database');
  const parsed = splitInspireDatabase(inspire_database);
  if (!parsed) {
    const err = new Error(inspire_database ? 'inspire_database must be exactly catalog.schema (one dot).' : I.IMPLEMENT_NOT_AVAILABLE);
    err.statusCode = 400;
    throw err;
  }
  return { inspire_database: inspire_database.trim(), ...parsed };
}

async function rowsOf(executeSql, sqlResultToObjects, host, token, warehouseId, statement) {
  const result = await executeSql(host, token, warehouseId, statement.sql, statement.parameters);
  return sqlResultToObjects(result);
}

async function jsonOf(dbFetch, host, token, path, opts = {}) {
  const resp = await dbFetch(host, token, path, opts);
  const text = await resp.text();
  let data = {};
  if (text) {
    try { data = parseExactJson(text); } catch { data = { raw: text }; }
  }
  return { ok: resp.ok, status: resp.status, data };
}

function registerImplementRoutes(app, deps) {
  const {
    requireToken,
    executeSql,
    sqlResultToObjects,
    dbFetch,
    fetchInspireSessionWidgetRow,
    notebookParamsFromSessionForGenerateRun,
    triggerInspireNotebookJob,
    splitInspireDatabase,
    databricksJobRunUrl,
    ensureTableColumns,
    runRoute1GenieFlagUpdates,
    hostedRun = null,
    runDefaults = () => ({}),
    appToken = async () => '',
    appBaseUrl = (req) => I.inspireBaseUrl(process.env.DATABRICKS_APP_URL)
      || I.inspireBaseUrl(String(req.headers['x-forwarded-host'] || '').split(',')[0]),
  } = deps;

  const sqlRows = (host, token, warehouseId, statement) =>
    rowsOf(executeSql, sqlResultToObjects, host, token, warehouseId, statement);
  const liveCache = C.createLiveCache();
  const fetchJsonFor = (req) => (path) => jsonOf(dbFetch, req.dbHost, req.dbToken, path);

  const readMeFor = (req) => (token) => jsonOf(dbFetch, req.dbHost, token, P.SCIM_ME_PATH);

  async function loadTokenPrincipal(req) {
    const got = await readMeFor(req)(req.dbToken);
    return got.ok ? got.data : {};
  }

  const personOf = (req) => P.requestPerson(req, readMeFor(req));
  const nextVersionOf = (history) => Math.max(0, ...history.map((r) => Number(r.spec_version) || 0)) + 1;
  function personReadToken(req) {
    const token = P.personTokenOf(req);
    if (token) return token;
    const { error, ...details } = RP.noPersonTokenBody(req.policyKey);
    throw Object.assign(I.badRequest(error, 401), { details });
  }

  async function implementColumnsOf(host, token, warehouseId, table) {
    return I.describedColumnNames(await sqlRows(host, token, warehouseId, { sql: `DESCRIBE TABLE ${table}`, parameters: null }));
  }

  async function ensureImplementTable(host, token, warehouseId, table) {
    await executeSql(host, token, warehouseId, I.implementTableCreateSql(table));
    const missing = I.implementMissingColumns(await implementColumnsOf(host, token, warehouseId, table));
    if (missing.length) await ensureTableColumns(host, token, warehouseId, table, missing);
  }

  async function describedRows(host, token, warehouseId, table, statementFor) {
    try {
      try {
        return await sqlRows(host, token, warehouseId, statementFor(null));
      } catch (err) {
        if (!I.isMissingColumnError(err)) throw err;
        return await sqlRows(host, token, warehouseId, statementFor(await implementColumnsOf(host, token, warehouseId, table)));
      }
    } catch (err) {
      if (isMissingTableError(err)) return null;
      throw err;
    }
  }

  async function implementRows(host, token, warehouseId, table, statementFor) {
    return ((await describedRows(host, token, warehouseId, table, statementFor)) || []).map(I.parseImplementRow);
  }

  async function loadHistory(host, token, warehouseId, catalog, schema, sid, useCaseId) {
    const table = I.implementTableName(catalog, schema);
    return implementRows(host, token, warehouseId, table, (existing) => I.implementHistoryStatement(table, sid, useCaseId || null, existing));
  }

  async function loadMergeTargets(req, warehouseId, catalog, schema, sid, useCaseId, only = null) {
    const table = I.implementTableName(catalog, schema);
    const [rows, hubRows] = await Promise.all([
      implementRows(req.dbHost, req.dbToken, warehouseId, table, (existing) => I.implementRegistryStatement(table, existing)),
      implementRows(req.dbHost, req.dbToken, warehouseId, table, (existing) => I.implementHubStatement(catalog, schema, sid, existing)),
    ]);
    const registry = I.mergeRegistry(rows, { sessionId: sid, useCaseId, only });
    registry.app = I.withHubEntries(registry.app, hubRows, { sessionId: sid, useCaseId, only });
    const targets = {};
    await Promise.all(I.IMPLEMENT_MERGE_OUTPUTS.map(async (name) => {
      const got = await Promise.all(registry[name].map((entry) => jsonOf(dbFetch, req.dbHost, req.dbToken, I.mergeTargetPath(name, entry.id))));
      const held = name === 'app' ? await Promise.all(got.map((app) => appSettingsOf(req, app))) : [];
      targets[name] = registry[name].map((entry, i) => I.mergeTarget(name, entry, got[i], req.dbHost, held[i])).filter(Boolean);
    }));
    return targets;
  }

  async function appSettingsOf(req, app) {
    const file = I.appSettingsPath(app);
    if (!file) return null;
    const read = await jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/workspace/export?path=${encodeURIComponent(file)}&direct_download=true`)
      .catch(() => null);
    return read && read.ok ? read.data : null;
  }

  async function loadUseCase(host, token, warehouseId, catalog, schema, sid, useCaseId) {
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    const rows = await sqlRows(host, token, warehouseId, I.useCaseRowStatement(table, sid, useCaseId));
    return rows[0] || null;
  }

  async function loadSession(host, token, warehouseId, catalog, schema, sid) {
    const session = await fetchInspireSessionWidgetRow(host, token, warehouseId, catalog, schema, sid);
    if (!session) {
      const err = new Error(`No __inspire_session row for session_id=${sid}.`);
      err.statusCode = 404;
      throw err;
    }
    return session;
  }

  async function loadFeatures(req) {
    const [apps, spaces, alerts] = await Promise.all([
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/apps?page_size=1'),
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/genie/spaces?page_size=1'),
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/alerts?page_size=1'),
    ]);
    return { apps: apps.ok, genie_spaces: spaces.ok, alerts: alerts.ok };
  }

  async function appWarehouseCheck(req, warehouseId, identity, warehouseName, forApp = false) {
    const [permissions, principal, warehouse] = await Promise.all([
      jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/permissions/sql/warehouses/${encodeURIComponent(warehouseId)}`),
      loadTokenPrincipal(req),
      warehouseName ? null : jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/sql/warehouses/${encodeURIComponent(warehouseId)}`),
    ]);
    const identities = [identity, principal.userName, principal.applicationId, ...(principal.emails || []).map((e) => e && e.value)];
    const groups = (principal.groups || []).map((g) => g && (g.display || g.value));
    const name = warehouseName || (warehouse && warehouse.ok && warehouse.data.name) || warehouseId;
    return I.warehouseManageCheck(permissions, identities, groups, name, forApp);
  }

  async function loadResultTableHolder(req, warehouseId, catalog, schema, table) {
    const rows = await sqlRows(req.dbHost, req.dbToken, warehouseId, I.resultTableHolderStatement(I.implementTableName(catalog, schema), table))
      .catch((err) => { if (isMissingTableError(err)) return []; throw err; });
    return rows[0] || null;
  }

  async function movedResultTable(req, warehouseId, useCaseId, table, history = null) {
    const { inspire_database, catalog, schema } = dbOf(req, splitInspireDatabase);
    if (!I.sameTable(table, I.sharedDefaultResultTable(inspire_database, useCaseId))) return null;
    const sid = sessionIdOf(req);
    const rows = history || await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
    if (!I.carriesSharedDefault(table, rows, inspire_database, useCaseId)) return null;
    const holder = await loadResultTableHolder(req, warehouseId, catalog, schema, table);
    return I.resultTableMove(table, holder, { inspireDatabase: inspire_database, sessionId: sid, useCaseId, history: rows });
  }

  async function checkOutput(req, warehouseId, table, useCaseId, options = {}) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const statement = I.outputAccessStatement(table);
    const asked = q(req, 'model_name');
    if (asked && I.resultTableNameError(asked, 'model_name')) throw I.badRequest(I.resultTableNameError(asked, 'model_name'));
    const modelName = asked || I.defaultModelName(table);
    const elsewhere = !I.sameSchema(modelName, table);
    const sid = sessionIdOf(req);
    const [rows, useCase, modelRows, holder] = await Promise.all([
      sqlRows(req.dbHost, req.dbToken, warehouseId, statement),
      loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
      elsewhere ? sqlRows(req.dbHost, req.dbToken, warehouseId, I.outputAccessStatement(modelName)) : null,
      loadResultTableHolder(req, warehouseId, catalog, schema, table),
    ]);
    const access = I.outputAccess(rows, table);
    const model = I.trainsModel(useCase) ? I.modelAccess(elsewhere ? modelRows : rows, modelName) : null;
    const warehouse = await appWarehouseCheck(req, warehouseId, access.identity, options.warehouseName);
    const own = Boolean(options.appWarehouse) && options.appWarehouse !== warehouseId;
    const appWarehouse = own ? await appWarehouseCheck(req, options.appWarehouse, access.identity, '', true) : warehouse;
    const warnings = [...I.shareWarnings(table, rows, options.principals),
      ...I.shareWarehouseWarnings(warehouse, options.principals, options.viewed, options.warehouseName)];
    if (warnings.length) access.grant = { ...access.grant, warn: warnings.join(' ') };
    access.app = I.appAccessCheck(access.app, own ? null : warehouse);
    const appGaps = I.accessPlan(table, rows).gaps;
    const person = P.personTokenOf(req);
    if (appGaps.length && person && person !== req.dbToken) {
      const offer = I.newAppsAccessOffer(table, await accessRowsOf(req, person, warehouseId, table), appGaps);
      if (offer) access.app = { ...access.app, offer };
    }
    access.app_warehouse = appWarehouse;
    let safety = { ok: true, detail: access.exists ? `${access.table} holds only this use case's rows` : `${access.table} is new; the first run creates it` };
    const held = I.resultTableHolderProblem(table, holder, sid, useCaseId);
    if (held) safety = { ok: false, detail: held };
    else if (access.exists && access.write.ok) {
      const columns = await sqlRows(req.dbHost, req.dbToken, warehouseId, I.columnsStatement(table));
      let problem = I.resultTableProblem(access.table, columns, 0);
      if (!problem && columns.length) {
        const counted = await sqlRows(req.dbHost, req.dbToken, warehouseId, I.otherUseCaseRowsStatement(table, useCaseId));
        problem = I.resultTableProblem(access.table, columns, counted[0] && counted[0].others);
      }
      if (problem) safety = { ok: false, detail: problem };
      else if (!columns.length) {
        safety = { ok: true, detail: `${access.table} exists but its columns could not be read, so Inspire could not check whose rows it holds` };
      }
    }
    return { ...access, safety, ...(model ? { model } : {}), ok: access.write.ok && safety.ok && (!model || model.ok) };
  }

  async function countApps(req, limit) {
    let count = 0;
    let pageToken = '';
    for (let page = 0; page < 10 && count <= limit; page += 1) {
      const got = await jsonOf(dbFetch, req.dbHost, req.dbToken,
        `/api/2.0/apps?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`);
      if (!got.ok) return null;
      count += (got.data.apps || []).length;
      pageToken = String(got.data.next_page_token || '');
      if (!pageToken) break;
    }
    return count;
  }

  /**
   * Route 1: set generate_genie_code_instruction = 'Yes' for selected UC ids, then submit
   * notebook job with 15_operation = Generate Use Cases and 14_session_id = session.
   */
  const genieJobGuard = createGenieJobGuard();

  async function genieRunState(host, token, runId) {
    if (!runId) return null;
    const got = await jsonOf(dbFetch, host, token, `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(runId)}`);
    return got.ok ? got.data?.state?.life_cycle_state || null : null;
  }

  async function handleInspireGenerateGenie(req, res) {
    try {
      const {
        inspire_database,
        warehouse_id,
        session_id,
        use_case_ids: useCaseIdsRaw,
        cluster_id,
        notebook_path,
      } = req.body || {};

      if (!inspire_database || !warehouse_id) {
        return res.status(400).json({ error: 'inspire_database and warehouse_id are required.' });
      }
      const sidStr = int64Id(session_id);
      if (!sidStr) {
        return res.status(400).json({ error: 'session_id must be a numeric Inspire session id.' });
      }

      const use_case_ids = Array.isArray(useCaseIdsRaw)
        ? useCaseIdsRaw.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (use_case_ids.length === 0) {
        return res.status(400).json({ error: 'use_case_ids must be a non-empty array of use case id strings.' });
      }
      if (use_case_ids.length > 50) {
        return res.status(400).json({ error: 'At most 50 use cases per Generate request.' });
      }

      const safeIds = use_case_ids.filter((id) => /^[a-zA-Z0-9_.\-]+$/.test(id));
      if (safeIds.length !== use_case_ids.length) {
        return res.status(400).json({
          error: 'Each use_case_id must match /^[a-zA-Z0-9_.\\-]+$/ (Inspire tracking table id / No).',
        });
      }

      const parsedDb = splitInspireDatabase(inspire_database);
      if (!parsedDb) {
        return res.status(400).json({ error: 'inspire_database must be exactly catalog.schema (one dot).' });
      }
      const { catalog, schema } = parsedDb;

      const session = await fetchInspireSessionWidgetRow(
        req.dbHost,
        req.dbToken,
        warehouse_id,
        catalog,
        schema,
        sidStr,
      );
      if (!session) {
        return res.status(404).json({ error: `No __inspire_session row for session_id=${sidStr}.` });
      }

      const params = notebookParamsFromSessionForGenerateRun(session, sidStr);
      if (!params['02_inspire_database']) {
        params['02_inspire_database'] = inspire_database.trim();
      }
      if (!params['01_uc_metadata']) {
        return res.status(400).json({
          error:
            'This session has no UC metadata (catalogs/schemas/tables or docs-only JSON path) stored on __inspire_session. Run Discover from this app first, or set metadata manually.',
        });
      }
      const refused = await U.runReadRefusal(dbFetch, req, U.discoverReads(params));
      if (refused) return res.status(refused.status).json({ error: refused.message, unreadable: refused.unreadable });

      const lastRun = await latestGenieNotebookRun(fetchJsonFor(req), sidStr);
      if (lastRun?.state === 'running') {
        return res.status(409).json({
          error: 'A Genie Code notebook for this session is already being written. Wait for that run to finish, then try again.',
          run_id: lastRun.run_id,
          job_run_url: lastRun.url || databricksJobRunUrl(req.dbHost, lastRun.job_id, lastRun.run_id),
        });
      }
      const claim = await genieJobGuard.claim(sidStr, (runId) => genieRunState(req.dbHost, req.dbToken, runId));
      if (!claim.ok) {
        return res.status(409).json({
          error: 'Genie instructions for this session are already being generated. Wait for that run to finish, then try again.',
          run_id: claim.entry?.run_id || null,
          job_run_url: claim.entry?.job_run_url || null,
        });
      }
      let out;
      try {
        await runRoute1GenieFlagUpdates(
          req.dbHost,
          req.dbToken,
          warehouse_id,
          catalog,
          schema,
          sidStr,
          safeIds,
        );

        out = await triggerInspireNotebookJob(req.dbHost, req.dbToken, {
          params,
          notebook_path,
          cluster_id,
          jobType: 'genie_regen',
          jobName: genieNotebookJobName(sidStr),
          useCaseIds: safeIds,
          launchedBy: (await personOf(req)).username,
        });
      } catch (launchErr) {
        genieJobGuard.failed(sidStr);
        throw launchErr;
      }
      genieJobGuard.launched(sidStr, out);

      console.log(`   🧞 Generate Genie: session=${sidStr}, flagged=${safeIds.length}, run_id=${out.run_id}`);
      res.json({
        ...out,
        session_id: sidStr,
        flagged_use_case_ids: safeIds,
      });
    } catch (err) {
      const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
      res.status(code).json({ error: err.message });
    }
  }

  app.post('/api/inspire/generate-genie', requireToken, handleInspireGenerateGenie);
  app.post('/api/inspire/generate_genie', requireToken, handleInspireGenerateGenie);

  app.get('/api/inspire/implement/context', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const [session, useCase, history, person, features] = await Promise.all([
        loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid),
        loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        personOf(req),
        loadFeatures(req),
      ]);
      if (!useCase) return res.status(404).json({ error: `No use case ${useCaseId} in this session.` });
      const latest = history[0] || null;
      const { missing, app_unreadable: appUnreadable } = await sourceAccess(req, warehouseId,
        I.checkedSourceTables(latest && latest.spec_json, I.useCaseTables(useCase)));
      const widgets = I.implementWidgets(history, useCase.genie_instruction || useCase.generate_genie_code_instruction || '');
      const assets = I.carriedAssets(history);
      const goneAssets = await goneMergeAssets(req, assets);
      const family = I.executionFamily(useCase.code_structure_mandate);
      res.json({
        session_id: sid,
        use_case: useCase,
        discovery_type: session.discovery_type || 'Standard',
        business_name: session.business_name || '',
        generation_path: session.generation_path || '',
        me: person,
        history,
        latest,
        assets,
        gone_assets: goneAssets,
        family,
        trains_model: I.trainsModel(useCase),
        evidence: I.parseEvidence(useCase.data_evidence),
        features,
        widgets: widgets.widgets,
        widget_source: widgets.source,
        widget_groups: I.groupWidgets(widgets.widgets),
        inspire_database: `${catalog}.${schema}`,
        missing_tables: missing,
        app_unreadable: appUnreadable,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/history', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = q(req, 'use_case_id');
      const history = await loadHistory(
        req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId ? I.validateUseCaseId(useCaseId) : null,
      );
      const latestByUc = {};
      for (const row of history) {
        if (!latestByUc[row.use_case_id]) latestByUc[row.use_case_id] = row;
      }
      const latest = Object.values(latestByUc);
      const [notebook] = await Promise.all([
        latestGenieNotebookRun(fetchJsonFor(req), sid).then((run) => ({ run, error: '' }), (err) => ({ run: null, error: err.message })),
        ...latest.map(async (row) => { row.stalled = await stalledOf(req, row); }),
      ]);
      res.json({ history, latest, notebook_run: notebook.run, notebook_run_error: notebook.error });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/portfolio', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const parsed = splitInspireDatabase(q(req, 'inspire_database'));
      if (!parsed) throw I.badRequest('inspire_database must be exactly catalog.schema (one dot).');
      const at = (name) => `\`${parsed.catalog}\`.\`${parsed.schema}\`.\`${name}\``;
      const [session, useCases, implement] = R.PORTFOLIO_TABLES.map(at);
      const read = (table, statementFor) => describedRows(req.dbHost, req.dbToken, warehouseId, table, statementFor);
      const [runs, useCaseRows, mvpRows] = await Promise.all([
        read(session, () => R.portfolioSessionStatement(session)),
        read(useCases, (existing) => R.portfolioUseCaseStatement(useCases, existing)),
        read(implement, (existing) => R.portfolioImplementStatement(implement, existing)),
      ]);
      const missing = R.PORTFOLIO_TABLES.filter((_, i) => [runs, useCaseRows, mvpRows][i] === null);
      res.set('Cache-Control', 'no-store').json(R.portfolioView({ runs: runs && runs[0], useCases: useCaseRows, mvps: mvpRows, missing }));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/app-look', requireToken, (_req, res) => {
    const catalog = appShellCatalog();
    if (!catalog.ok) return res.status(503).json({ error: catalog.error });
    return res.json(catalog);
  });

  app.get('/api/inspire/implement/lakebase', requireToken, async (req, res) => {
    const catalog = appShellCatalog();
    if (!catalog.ok) return res.status(503).json({ error: catalog.error });
    let got;
    try {
      got = await fetchJsonFor(req)(C.LAKEBASE_PROBE_PATH);
    } catch (err) {
      got = { ok: false, status: 0, data: { message: err.message } };
    }
    return res.json(C.lakebaseOffer(got, catalog.backends));
  });

  app.get('/api/inspire/implement/merge-targets', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const targets = await loadMergeTargets(req, warehouseId, catalog, schema, sid, useCaseId);
      const sessions = I.scopeSessions(I.hubsFirst(targets.app));
      const scope = sessions.length
        ? await sqlRows(req.dbHost, req.dbToken, warehouseId, I.useCaseScopeStatement(catalog, schema, sessions))
          .catch((err) => { if (isMissingTableError(err) || I.isMissingColumnError(err)) return []; throw err; })
        : [];
      res.json({ targets: { ...targets, app: I.withUseCaseScope(targets.app, scope) }, cap: I.IMPLEMENT_MERGE_TARGET_CAP });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/columns', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      const statement = I.columnsStatement(table);
      const rows = await sqlRows(req.dbHost, personReadToken(req), warehouseId, statement);
      res.json({ table, columns: rows });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/swaps', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      const required = Array.isArray(req.body?.required_columns) ? req.body.required_columns : [];
      const statement = I.tableSwapStatement(table, required);
      const token = P.personTokenOf(req);
      if (!token) return res.json({ table, swaps: [], why: I.IMPLEMENT_SWAPS_NO_SIGN_IN });
      const rows = await sqlRows(req.dbHost, token, warehouseId, statement);
      const catalog = statement.catalog;
      return res.json({
        table,
        swaps: rows.map((r) => ({
          table: `${catalog}.${r.table_schema}.${r.table_name}`,
          matched: Number(r.matched) || 0,
          total: Number(r.total) || 0,
        })),
        why: '',
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/tables', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const [history, person] = await Promise.all([loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId), personOf(req)]);
      const before = I.previousBuilt(history);
      const nextVersion = nextVersionOf(history);
      if (!before) return res.json({ editable: false, why: I.IMPLEMENT_SETTINGS_NOT_BUILT, built_version: null, next_version: nextVersion });
      const refused = I.implementSettingsOwnerRefusal(before, person.username);
      return res.json({ editable: !refused, why: refused ? refused.message : '', built_version: before.spec_version, next_version: nextVersion });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/table-change', requireToken, async (req, res) => {
    try {
      const { sid, warehouseId, catalog, schema, history, asked } = await askedSpec(req);
      const useCaseId = I.validateUseCaseId(asked.use_case_id);
      const [useCase, person] = await Promise.all([loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId), personOf(req)]);
      if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
      const before = I.previousBuilt(history);
      if (!before) throw I.badRequest(I.IMPLEMENT_SETTINGS_NOT_BUILT, 409);
      const refused = I.implementSettingsOwnerRefusal(before, person.username);
      if (refused) throw I.badRequest(refused.message, refused.status);
      const { previous, change } = await tableChangeOf(req, warehouseId, history, asked, useCase);
      const nextVersion = nextVersionOf(history);
      return res.json({ ...change, ...I.implementTableChangeText(previous.data, asked.data, change, nextVersion), next_version: nextVersion });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/values', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      const statement = I.columnValuesStatement(table, q(req, 'column'), q(req, 'limit') || 200);
      const rows = await sqlRows(req.dbHost, personReadToken(req), warehouseId, statement);
      res.json({ values: rows.map((r) => r.value).filter((v) => v != null && v !== '') });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/readiness', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const discovery = String(req.body?.discovery_type || '').trim() || 'Standard';
      if (discovery === 'Standard') {
        return res.json({ skipped: true, reason: 'metadata only, readiness checked at preview run', row_count: null, null_share: {} });
      }
      const table = q(req, 'table');
      const statement = I.readinessStatement(table, {
        columns: req.body?.columns || [],
        filters: req.body?.filters || [],
        window: req.body?.window || {},
      });
      const rows = await sqlRows(req.dbHost, personReadToken(req), warehouseId, statement);
      res.json({ skipped: false, ...I.readinessFromRow(rows[0] || {}, statement.columns) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/serving-endpoints', requireToken, async (req, res) => {
    try {
      const got = await jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/serving-endpoints');
      if (!got.ok) return res.status(got.status).json({ error: got.data.message || got.data.error || 'serving endpoints are not available' });
      const endpoints = (got.data.endpoints || []).map((e) => ({ name: e.name, state: e.state?.ready || e.state, task: e.task }));
      res.json({ endpoints });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/principals', requireToken, async (req, res) => {
    try {
      const filter = q(req, 'q').slice(0, 80);
      if (filter.length < 2) return res.json({ principals: [] });
      const encoded = encodeURIComponent(`userName co "${filter}" or displayName co "${filter}"`);
      const groupEncoded = encodeURIComponent(`displayName co "${filter}"`);
      const [users, groups] = await Promise.all([
        jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/preview/scim/v2/Users?filter=${encoded}&count=20`),
        jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/preview/scim/v2/Groups?filter=${groupEncoded}&count=20`),
      ]);
      const principals = [];
      for (const u of users.data.Resources || []) {
        principals.push({ type: 'user', name: u.userName || u.displayName, display: u.displayName || u.userName });
      }
      for (const g of groups.data.Resources || []) {
        principals.push({ type: 'group', name: g.displayName, display: g.displayName });
      }
      res.json({ principals });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/output-check', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const moved = await movedResultTable(req, warehouseId, useCaseId, q(req, 'table'));
      const output = await checkOutput(req, warehouseId, moved ? moved.to : q(req, 'table'), useCaseId);
      res.json(moved ? { ...output, result_table_moved: moved } : output);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/preflight', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const resultTable = q(req, 'result_table');
      const appName = q(req, 'app_name');
      const mergeApp = q(req, 'merge_app');
      const appWarehouse = appName && I.IMPLEMENT_MERGE_ID_RE.test(q(req, 'app_warehouse')) ? q(req, 'app_warehouse') : '';
      const wantsAlert = q(req, 'alert') === '1';
      const wantsGenie = q(req, 'genie') === '1';
      const wantsDashboard = q(req, 'dashboard') !== '0';
      const shares = q(req, 'share') === '1';
      const principals = principalsOf(req);
      if (I.resultTableNameError(resultTable)) throw I.badRequest(I.resultTableNameError(resultTable));
      const [principal, features, warehouses, existingApp] = await Promise.all([
        loadTokenPrincipal(req),
        loadFeatures(req),
        jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/sql/warehouses/${encodeURIComponent(warehouseId)}`),
        appName ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/apps/${encodeURIComponent(appName)}`) : null,
      ]);
      const warehouseName = warehouses.ok ? (warehouses.data.name || warehouseId) : warehouseId;
      let output = null;
      let outputError = '';
      let moved = null;
      try {
        const viewed = [wantsDashboard && 'the dashboard', wantsGenie && 'the Genie Agent'];
        moved = await movedResultTable(req, warehouseId, useCaseId, resultTable);
        output = await checkOutput(req, warehouseId, moved ? moved.to : resultTable, useCaseId,
          { principals, warehouseName, viewed, appWarehouse });
      } catch (err) {
        outputError = err.message || String(err);
      }
      const outputDetail = output && (output.write.ok ? `${output.write.detail}; ${output.safety.detail}` : output.write.detail);
      const checks = {
        warehouse: output
          ? { ok: true, detail: `${warehouseName} ran the access check for you` }
          : { ok: false, detail: `${warehouseName} could not run a statement for you: ${outputError}` },
        output: output
          ? { ok: output.write.ok && output.safety.ok, detail: moved ? `${moved.detail}; ${outputDetail}` : outputDetail }
          : { ok: false, detail: 'not checked, because the warehouse could not run the access check' },
      };
      if (output && output.model) checks.model = output.model;
      if (shares) checks.result_grant = output ? output.grant : { ok: false, detail: 'not checked' };
      if (appName) {
        const name = I.appNameCheck(appName, existingApp && existingApp.ok ? existingApp.data : null, { useCaseId, sessionId: sid });
        checks.app_name = name;
        if (name.creates) checks.app_access = output ? output.app : { ok: false, detail: 'not checked, because the warehouse could not run the access check' };
        const swaps = !name.creates && I.appWarehouseMoves(existingApp && existingApp.ok ? existingApp.data : null, appWarehouse || warehouseId);
        if ((name.creates && appWarehouse && appWarehouse !== warehouseId) || swaps) {
          checks.app_warehouse = output ? output.app_warehouse : { ok: false, detail: 'not checked, because the warehouse could not run the access check' };
        }
        if (!features.apps) checks.apps = { ok: false, detail: 'this workspace cannot create Databricks Apps' };
        else {
          const limit = I.appsLimit(req.dbHost);
          const count = name.creates ? await countApps(req, limit) : 0;
          checks.apps = count == null
            ? { ok: false, detail: 'the Apps list is not available to you, so the App quota cannot be checked' }
            : I.appsQuotaCheck(count, limit, name.creates);
        }
      } else if (mergeApp) {
        checks.app_access = output ? output.app : { ok: false, detail: 'not checked, because the warehouse could not run the access check' };
      }
      if (wantsGenie) {
        checks.genie_spaces = { ok: features.genie_spaces, detail: features.genie_spaces ? 'you can create Genie Agents' : 'you cannot create Genie Agents in this workspace' };
      }
      if (wantsAlert) {
        checks.alerts = { ok: features.alerts, detail: features.alerts ? 'you can create SQL alerts' : 'you cannot create SQL alerts in this workspace' };
      }
      res.json({
        ok: Object.values(checks).every((c) => c.ok),
        identity: (output && output.identity) || P.principalOf(principal).username,
        checks,
        features,
        ...(moved ? { result_table_moved: moved } : {}),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/destinations', requireToken, async (req, res) => {
    try {
      const destinations = [];
      let pageToken = '';
      for (let page = 0; page < 10; page += 1) {
        const got = await jsonOf(dbFetch, req.dbHost, req.dbToken,
          `/api/2.0/notification-destinations?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`);
        if (!got.ok) {
          return res.status(got.status).json({ error: got.data.message || got.data.error || 'notification destinations are not available' });
        }
        destinations.push(...I.destinationsFromList(got.data));
        pageToken = String(got.data.next_page_token || '');
        if (!pageToken) break;
      }
      res.json({ destinations });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function goneMergeAssets(req, assets) {
    const names = I.IMPLEMENT_MERGE_OUTPUTS.filter((name) => assets[name]);
    const got = await Promise.all(names.map((name) => jsonOf(dbFetch, req.dbHost, req.dbToken, I.mergeTargetPath(name, assets[name])).catch(() => null)));
    return names.filter((_name, i) => got[i] && got[i].status === 404);
  }

  async function appIdentity(req) {
    const me = await loadTokenPrincipal(req);
    const id = String(me.applicationId || me.userName || '').trim();
    return { name: String(me.displayName || '').trim() || id, id };
  }

  const accessRowsOf = (req, token, warehouseId, table) => Promise.resolve()
    .then(() => sqlRows(req.dbHost, token, warehouseId, I.outputAccessStatement(table)))
    .catch(() => []);

  async function sourceAccess(req, warehouseId, tables) {
    const probes = await Promise.all(tables.map((table) => sqlRows(req.dbHost, req.dbToken, warehouseId, I.tableProbeStatement(table))
      .then(() => null)
      .catch((err) => {
        const reason = I.tableAccessReason(table, err && err.message);
        return reason ? { table, reason, error: String(err.message || '').slice(0, 300) } : null;
      })));
    const lost = probes.filter(Boolean);
    const person = P.personTokenOf(req);
    if (!lost.length || !person || person === req.dbToken) return { missing: lost, app_unreadable: null };
    const readable = await Promise.all(lost.map((m) => sqlRows(req.dbHost, person, warehouseId, I.tableProbeStatement(m.table))
      .then(() => true).catch(() => false)));
    const appOnly = lost.filter((_m, i) => readable[i]).map((m) => m.table);
    if (!appOnly.length) return { missing: lost, app_unreadable: null };
    const [app, rows] = await Promise.all([appIdentity(req), Promise.all(appOnly.map((t) => accessRowsOf(req, person, warehouseId, t)))]);
    const offer = I.appReadGrantsOffer(appOnly, appOnly.map((t, i) => I.accessPlan(t, rows[i], app.id)), app);
    return { missing: lost.filter((m) => !appOnly.includes(m.table)), app_unreadable: { ...offer, text: I.appUnreadableMessage(offer) } };
  }

  async function refuseMissingSources(req, warehouseId, spec, useCase) {
    const { missing, app_unreadable: appUnreadable } = await sourceAccess(req, warehouseId, I.sourceTables(spec, I.useCaseTables(useCase)));
    if (!missing.length && !appUnreadable) return;
    const err = I.badRequest([missing.length ? I.missingTablesMessage(missing) : '', appUnreadable ? appUnreadable.text : ''].filter(Boolean).join('. '), 409);
    err.details = { missing_tables: missing, app_unreadable: appUnreadable };
    throw err;
  }

  async function runPersonGrants(req, token, warehouseId, statements) {
    const ran = [];
    const failed = [];
    for (const sql of statements) {
      try {
        await executeSql(req.dbHost, token, warehouseId, sql);
        ran.push(sql);
      } catch (err) {
        failed.push(`${sql}: ${String((err && err.message) || err).slice(0, 200)}`);
      }
    }
    return { ran, failed };
  }

  async function grantNewAppsAccess(req, token, warehouseId, table) {
    const { catalog } = I.tableParts(table);
    const facts = I.catalogAccessFacts(await sqlRows(req.dbHost, token, warehouseId, I.outputAccessStatement(table)));
    let decided = I.catalogAccessDecision('', catalog, facts.accountUsers, facts.person, [], false);
    if (decided.decision === 'grant') {
      const below = await sqlRows(req.dbHost, token, warehouseId, I.belowCatalogStatement(catalog));
      decided = I.catalogAccessDecision('', catalog, facts.accountUsers, facts.person, below, false);
    }
    const { ran, failed } = decided.decision === 'grant' ? await runPersonGrants(req, token, warehouseId, [I.newAppsCatalogGrant(catalog)]) : { ran: [], failed: [] };
    if (failed.length) throw I.badRequest(`Inspire could not grant with your sign-in: ${failed.join('; ')}`, 403);
    return { ...decided, ran, detail: I.newAppsAccessText(catalog, decided.decision, decided.real) };
  }

  async function grantSourceAccess(req, token, warehouseId, tables) {
    const before = await sourceAccess(req, warehouseId, tables);
    const offer = before.app_unreadable;
    if (!offer) return { granted: 0, ran: [], failed: [], missing_tables: before.missing, app_unreadable: null };
    if (!offer.can_grant) {
      const err = I.badRequest(offer.text, 403);
      err.details = { app_unreadable: offer };
      throw err;
    }
    const { ran, failed } = await runPersonGrants(req, token, warehouseId, offer.grants);
    const after = await sourceAccess(req, warehouseId, tables);
    return { granted: ran.length, ran, failed, missing_tables: after.missing, app_unreadable: after.app_unreadable };
  }

  app.post('/api/inspire/implement/grant-access', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const kind = q(req, 'kind');
      if (!I.IMPLEMENT_GRANT_KINDS.includes(kind)) throw I.badRequest(`kind must be one of ${I.IMPLEMENT_GRANT_KINDS.join(', ')}`);
      const token = P.personTokenOf(req);
      if (!token) throw I.badRequest(I.IMPLEMENT_GRANT_NO_SIGN_IN, 401);
      if (kind === 'new_apps') {
        const table = q(req, 'table');
        if (I.resultTableNameError(table, 'table')) throw I.badRequest(I.resultTableNameError(table, 'table'));
        return res.json({ kind, ...(await grantNewAppsAccess(req, token, warehouseId, table)) });
      }
      const raw = Array.isArray(req.body && req.body.tables) ? req.body.tables : [];
      const tables = I.uniqueTables(raw.map((t) => String(t == null ? '' : t).trim()).filter(Boolean)).slice(0, 50);
      const bad = tables.map((t) => I.resultTableNameError(t, 'tables')).find(Boolean);
      if (!tables.length || bad) throw I.badRequest(bad || 'tables must be a list of catalog.schema.table names');
      return res.json({ kind, ...(await grantSourceAccess(req, token, warehouseId, tables)) });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function stalledOf(req, row) {
    if (!row || !I.IMPLEMENT_ACTIVE_STATUSES.includes(row.status)) return null;
    const runId = String(row.implement_run_id ?? '');
    const got = /^\d{1,19}$/.test(runId)
      ? await jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${runId}`).catch(() => null)
      : null;
    return I.implementStalled(row, got && got.ok ? got.data : null);
  }

  async function askedSpec(req) {
    const sid = sessionIdOf(req);
    const warehouseId = warehouseOf(req);
    const { inspire_database, catalog, schema } = dbOf(req, splitInspireDatabase);
    const raw = I.withInspireUrl(req.body?.spec || req.body, appBaseUrl(req));
    const draftId = I.validateImplementSpec(raw).spec.use_case_id;
    const history = draftId && I.IMPLEMENT_USE_CASE_ID_RE.test(draftId)
      ? await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, draftId) : [];
    const legacyAccess = I.legacyAppAccess(history);
    const impact = I.implementNotebookImpact(I.implementCarried(history).status);
    const { spec: asked, errors } = I.validateImplementSpec(raw, { legacyAccess, impact });
    if (errors.length) throw I.badRequest(errors.join('; '));
    return { sid, warehouseId, inspire_database, catalog, schema, raw, history, legacyAccess, asked };
  }

  async function tableChangeOf(req, warehouseId, history, spec, useCase) {
    const before = I.previousBuilt(history);
    if (!before) return null;
    const previous = I.validateImplementSpec(before.spec_json, { legacyAccess: I.legacyAppAccess(history) }).spec;
    const changes = I.implementTableSwapChanges(previous.data, spec.data);
    const tables = I.uniqueTables(changes.flatMap((c) => [c.replaced, c.chosen]));
    const token = P.personTokenOf(req);
    if (tables.length && !token) throw I.badRequest(I.IMPLEMENT_TABLES_NO_SIGN_IN, 401);
    const read = await Promise.all(tables.map((t) => sqlRows(req.dbHost, token, warehouseId, I.columnsStatement(t))));
    const unseen = tables.filter((_t, i) => !read[i].length);
    if (unseen.length) throw I.badRequest(I.implementTablesUnreadable(unseen), 409);
    const columnsOf = (name) => read[tables.findIndex((t) => t.toLowerCase() === name.toLowerCase())];
    const columns = Object.fromEntries(tables.map((t, i) => [t, read[i]]));
    const used = Object.fromEntries(changes.map((c) => [c.original, I.implementUsedColumns(useCase && useCase.data_evidence, c.original, columnsOf(c.replaced))]));
    return { before, previous, change: I.implementTableChange(previous.data, spec.data, used, columns) };
  }

  async function ownerTableChange(req, warehouseId, history, spec, useCase, person) {
    const before = I.previousBuilt(history);
    if (!before || I.implementSettingsOwnerRefusal(before, person.username) || !P.personTokenOf(req)) return { change: null, error: '' };
    try {
      const got = await tableChangeOf(req, warehouseId, history, spec, useCase);
      return { change: got && got.change.class ? got.change : null, error: '' };
    } catch (err) {
      return { change: null, error: err.message || String(err) };
    }
  }

  async function prepareSubmission(req) {
    const { sid, warehouseId, inspire_database, catalog, schema, raw, history, legacyAccess, asked } = await askedSpec(req);
    const changed = I.publishHeldDifference(history, asked, legacyAccess);
    if (changed) throw I.badRequest(changed, 409);
    const rolled = I.rollbackSpec(history, asked);
    const useCaseId = I.validateUseCaseId(rolled.use_case_id);
    const moved = await movedResultTable(req, warehouseId, useCaseId, rolled.config.result_table, history);
    const spec = moved ? I.withResultTable(rolled, moved.to) : rolled;
    const [session, useCase, person] = await Promise.all([
      loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid),
      loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
      personOf(req),
    ]);
    if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
    const problems = I.removedTableProblems(spec, I.useCaseTables(useCase), I.primaryTableOf(useCase));
    if (problems.length) throw I.badRequest(problems.join('; '));
    const kpiIssues = I.implementKpiTargetProblems(raw, I.implementKpiOptions(useCase, history), history);
    if (kpiIssues.length) throw I.badRequest(kpiIssues.join('; '));
    const assumptionIssues = I.implementAssumptionProblems(spec, I.implementSettingsModel(history));
    if (assumptionIssues.length) throw I.badRequest(`assumption values are out of range: ${assumptionIssues.join('; ')}`);
    const widgets = I.implementWidgets(history, useCase.genie_instruction || useCase.generate_genie_code_instruction || '');
    const widgetIssues = I.widgetProblems(widgets.widgets, spec.config.widgets);
    if (widgetIssues.length) throw I.badRequest(`widget values are out of range: ${widgetIssues.join('; ')}`);
    if (I.IMPLEMENT_MERGE_OUTPUTS.some((name) => spec.outputs.merge[name])) {
      const targets = await loadMergeTargets(req, warehouseId, catalog, schema, sid, useCaseId, spec.outputs.merge);
      const mergeIssues = I.mergeProblems(spec, targets, I.carriedAssets(history));
      if (mergeIssues.length) throw I.badRequest(mergeIssues.join('; '));
    }
    const [stalled, tables] = await Promise.all([stalledOf(req, history[0]), ownerTableChange(req, warehouseId, history, spec, useCase, person)]);
    const plan = I.planSubmission(history, spec, stalled, { requester: person.username, tableChange: tables.change });
    if (moved) plan.summary.result_table_moved = moved;
    if (tables.change) plan.summary.table_change = tables.change;
    if (tables.error) plan.summary.table_change_error = tables.error;
    if (plan.summary.refill || (tables.change && tables.change.class === 'settings')) await refuseMissingSources(req, warehouseId, spec, useCase);
    return { sid, warehouseId, inspire_database, catalog, schema, spec, useCaseId, useCase, session, history, plan, person };
  }

  async function refusePersonUnreadable(req, spec, useCase) {
    const refused = await U.runReadRefusal(dbFetch, req, { tables: I.sourceTables(spec, I.useCaseTables(useCase)) });
    if (!refused) return;
    const err = I.badRequest(refused.message, refused.status);
    err.details = { unreadable: refused.unreadable };
    throw err;
  }

  app.post('/api/inspire/implement/plan', requireToken, async (req, res) => {
    try {
      const { sid, warehouseId, catalog, schema, useCaseId, plan } = await prepareSubmission(req);
      const sharing = plan.summary.delete.some((name) => I.IMPLEMENT_MERGE_OUTPUTS.includes(name))
        ? await sharedOf(req, { sid, warehouseId, catalog, schema, useCaseId }) : {};
      res.json({ use_case_id: useCaseId, spec_version: plan.nextVersion, based_on_version: plan.built ? plan.built.spec_version : null,
        summary: plan.summary, unchanged: plan.unchanged, ...sharing });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function startVersion(req, { sid, warehouseId, inspire_database, catalog, schema, spec, useCaseId, useCase, session, plan, person }) {
    I.refuseUnchanged(plan);
    await refusePersonUnreadable(req, spec, useCase);
    if (spec.config.result_table) {
      const output = await checkOutput(req, warehouseId, spec.config.result_table, useCaseId);
      if (!output.ok) throw I.badRequest(output.write.ok ? output.safety.detail : output.write.detail, 403);
    }
    const params = I.implementJobParams(notebookParamsFromSessionForGenerateRun(session, sid), useCaseId, plan.nextVersion);
    if (!params['02_inspire_database']) params['02_inspire_database'] = inspire_database;
    if (!params['01_uc_metadata']) {
      const err = new Error('This session has no UC metadata stored on __inspire_session. Run Discover from this app first.');
      err.statusCode = 400;
      throw err;
    }
    const createdBy = person.username;
    const table = I.implementTableName(catalog, schema);
    await ensureImplementTable(req.dbHost, req.dbToken, warehouseId, table);
    const insert = I.implementInsertStatement(table, {
      sessionId: sid,
      useCaseId,
      specVersion: plan.nextVersion,
      basedOnVersion: spec.based_on_version == null ? (plan.built ? plan.built.spec_version : null) : spec.based_on_version,
      spec,
      createdBy,
      statusMessage: 'queued',
      changeClasses: plan.summary.classes,
    });
    await executeSql(req.dbHost, req.dbToken, warehouseId, insert.sql, insert.parameters);

    const version = { sessionId: sid, useCaseId, specVersion: plan.nextVersion };
    let out;
    try {
      out = await triggerInspireNotebookJob(req.dbHost, req.dbToken, {
        params,
        notebook_path: req.body?.notebook_path,
        cluster_id: req.body?.cluster_id,
        jobType: 'implement',
        useCaseIds: [useCaseId],
        launchedBy: createdBy,
      });
    } catch (err) {
      const failed = I.implementStartFailedStatement(table, { ...version, message: `the MVP run could not start: ${err.message}` });
      try {
        await executeSql(req.dbHost, req.dbToken, warehouseId, failed.sql, failed.parameters);
      } catch (e) {
        console.warn(`implement start-failure write failed: ${e.message}`);
      }
      throw err;
    }
    const started = I.implementRunStartedStatement(table, { ...version, runId: out.run_id, message: out.job_run_url || `run ${out.run_id}` });
    try {
      await executeSql(req.dbHost, req.dbToken, warehouseId, started.sql, started.parameters);
    } catch (e) {
      console.warn(`implement run id write failed: ${e.message}`);
    }
    return {
      session_id: sid,
      use_case_id: useCaseId,
      spec_version: plan.nextVersion,
      summary: plan.summary,
      ...out,
    };
  }

  app.post('/api/inspire/implement/submit', requireToken, async (req, res) => {
    try {
      res.json(await startVersion(req, await prepareSubmission(req)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/publish', requireToken, async (req, res) => {
    try {
      const prepared = await prepareSubmission(req);
      const named = q(req, 'use_case_id');
      if (named && named !== prepared.useCaseId) throw I.badRequest(`the spec is for use case ${prepared.useCaseId}, not ${named}`);
      if (prepared.spec.publish_held == null) throw I.badRequest('Publish anyway sends the held spec with publish_held set to the held version');
      res.json(await startVersion(req, prepared));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/status', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      const stepTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_step\``;
      const stepStmt = stepsStatement(stepTable, sid, q(req, 'since') || (history[0] && history[0].created_at) || '');
      let steps = [];
      try {
        steps = I.filterImplementSteps(await sqlRows(req.dbHost, req.dbToken, warehouseId, stepStmt), useCaseId);
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
      }
      const session = await loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid).catch(() => null);
      const runLog = I.liveLogPath(`${catalog}.${schema}`, session?.business_name, sid, history[0] && history[0].implement_run_id);
      const sessionLog = I.liveLogPath(`${catalog}.${schema}`, session?.business_name, sid);
      let logPath = runLog;
      let feed = [];
      const readLog = (path) => jsonOf(dbFetch, req.dbHost, req.dbToken, fsApiPath('files', path)).catch((err) => {
        console.warn(`[implement] live log read ended early, the feed keeps its last messages: ${path}: ${err.message}`);
        return { ok: false, status: 0, data: {} };
      });
      if (runLog) {
        let got = await readLog(runLog);
        if (!got.ok && got.status === 404 && runLog !== sessionLog) {
          logPath = sessionLog;
          got = await readLog(sessionLog);
        }
        if (got.ok) {
          const text = typeof got.data === 'string' ? got.data : (got.data.raw || '');
          feed = I.genieFeed(text, useCaseId, history[0] && history[0].created_at);
        }
      }
      const appName = I.carriedAssets(history).app;
      const jobId = int64Id((history.find((r) => r.job_id) || {}).job_id);
      const held = history[0] && history[0].status === I.IMPLEMENT_VIBE_NOT_MET ? history[0].spec_version : null;
      const [appInfo, runInfo, stalled, person] = await Promise.all([
        appName ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/apps/${encodeURIComponent(appName)}`) : null,
        jobId ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/list?job_id=${jobId}&limit=10`) : null,
        stalledOf(req, history[0]),
        held == null ? null : personOf(req),
      ]);
      const listedNone = runInfo && runInfo.ok && !(Array.isArray(runInfo.data && runInfo.data.runs) && runInfo.data.runs.length);
      const jobInfo = listedNone ? await jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/get?job_id=${jobId}`) : null;
      res.json({
        latest: history[0] || null,
        stalled,
        history,
        steps,
        log_path: logPath,
        feed,
        rerun_widgets: I.rerunWidgets(history),
        app_status: I.appStatusFrom(appInfo, { useCaseId, sessionId: sid, history }),
        runs: I.jobRunsFrom(runInfo, jobInfo),
        can_publish_held: held != null && !I.publishHeldRefusal(history, { publish_held: held }, person.username),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function loadRunPages(req, warehouseId, catalog, schema) {
    const table = I.implementTableName(catalog, schema);
    const rows = await implementRows(req.dbHost, req.dbToken, warehouseId, table, (existing) => I.implementRegistryStatement(table, existing));
    const sessions = [...new Set(I.runPages(rows).map((p) => p.session_id).map(int64Id).filter(Boolean))].slice(0, I.IMPLEMENT_SCOPE_SESSION_CAP);
    const scope = sessions.length
      ? await sqlRows(req.dbHost, req.dbToken, warehouseId, I.useCaseScopeStatement(catalog, schema, sessions))
        .catch((err) => { if (isMissingTableError(err) || I.isMissingColumnError(err)) return []; throw err; })
      : [];
    return I.runPages(rows, scope);
  }

  const runContext = (req, warehouseId, catalog, schema) => ({ key: `${req.dbHost}|${catalog}.${schema}`, warehouseId, catalog, schema });

  if (hostedRun) {
    hostedRun.useReader(async (req, ctx) => {
      let at = ctx;
      if (!at) {
        const defaults = runDefaults() || {};
        const parsed = splitInspireDatabase(String(defaults.inspireDatabase || ''));
        if (!parsed || !defaults.warehouseId) return null;
        at = runContext(req, defaults.warehouseId, parsed.catalog, parsed.schema);
      }
      const pages = await loadRunPages(req, at.warehouseId, at.catalog, at.schema);
      return { entries: I.runPagesServed(pages), ctx: at };
    });
  }

  app.get('/api/run/pages', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const [pages, person] = await Promise.all([loadRunPages(req, warehouseId, catalog, schema), personOf(req)]);
      if (hostedRun) hostedRun.setListed(I.runPagesServed(pages), runContext(req, warehouseId, catalog, schema));
      const forwarded = Boolean(P.forwardedTokenOf(req));
      res.json({
        pages: I.runPagesView(pages, { who: person.username, stateOf: hostedRun ? hostedRun.stateOf : null }),
        user_authorization: forwarded,
        ...(forwarded ? {} : { user_authorization_note: HOSTED_NO_TOKEN }),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function optionalRows(req, warehouseId, statement) {
    try {
      return await sqlRows(req.dbHost, req.dbToken, warehouseId, statement);
    } catch (err) {
      if (isMissingTableError(err)) return [];
      throw err;
    }
  }

  app.get('/api/inspire/implement/money', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      const table = String(history[0]?.spec_json?.config?.result_table || '').trim();
      if (!table) return res.json({ run: null, model: null, history: [], result_table: '' });
      const statements = moneyStatements(table, useCaseId);
      const summary = (await optionalRows(req, warehouseId, statements.summary))[0] || null;
      const edits = summary && summary.value_assumptions ? await optionalRows(req, warehouseId, statements.edits) : [];
      return res.json({ ...moneyView(summary, edits), result_table: table });
    } catch (err) {
      return sendError(res, err);
    }
  });

  const appFetch = deps.appFetch || fetch;

  async function settingsContext(req) {
    const sid = sessionIdOf(req);
    const warehouseId = warehouseOf(req);
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
    const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
    const target = I.implementSettingsTarget(history, useCaseId);
    const built = history.some((row) => I.IMPLEMENT_DONE_STATUSES.includes(row.status));
    const refusal = !built ? [409, I.IMPLEMENT_SETTINGS_NOT_BUILT] : !target ? [409, I.IMPLEMENT_SETTINGS_NO_APP]
      : !I.implementAppUrlOk(target.url) ? [409, I.IMPLEMENT_SETTINGS_NOT_APP_URL] : !P.forwardedTokenOf(req) ? [401, I.IMPLEMENT_SETTINGS_NO_SIGN_IN] : null;
    return { history, built, target: target && I.implementAppUrlOk(target.url) ? target : null, refusal };
  }

  async function callApp(req, target, method, path, body) {
    const resp = await appFetch(`${target.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${P.forwardedTokenOf(req)}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 500) };
    }
    return { status: resp.status, ok: resp.ok, data: data && typeof data === 'object' ? data : { error: String(data) } };
  }

  app.get('/api/inspire/implement/settings', requireToken, async (req, res) => {
    try {
      const { history, built, target, refusal } = await settingsContext(req);
      const recorded = (why) => res.json({ source: 'recorded', settings: built ? I.implementSettingsRecorded(history) : [], history: [], editable: false,
        can_run: false, why, app: target });
      if (refusal) return recorded(refusal[1]);
      let got;
      try {
        got = await callApp(req, target, 'GET', `/api/settings?page=${encodeURIComponent(target.page)}`);
      } catch (err) {
        return recorded(`The App\u2019s settings could not be read: ${err.message}`);
      }
      if (!got.ok) return recorded(String(got.data.error || `The App answered ${got.status} for its settings`));
      const view = got.data;
      return res.json({ source: 'app', settings: I.implementAppSettings(view.settings, history), history: Array.isArray(view.history) ? view.history : [],
        editable: view.editable === true, can_run: view.can_run === true, why: String(view.why || ''), app: target });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/runs', requireToken, async (req, res) => {
    try {
      const { target, refusal } = await settingsContext(req);
      const none = (why) => res.json({ runs: [], why });
      if (refusal) return none(refusal[1]);
      let got;
      try {
        got = await callApp(req, target, 'GET', `/api/runs?page=${encodeURIComponent(target.page)}`);
      } catch (err) {
        return none(`The App\u2019s runs could not be read: ${err.message}`);
      }
      if (!got.ok) return none(String(got.data.error || `The App answered ${got.status} for its runs`));
      return res.json({ runs: Array.isArray(got.data.runs) ? got.data.runs.slice(0, 2) : [], why: '' });
    } catch (err) {
      return sendError(res, err);
    }
  });

  const settingsAction = (action, keys) => async (req, res) => {
    try {
      const { history, target, refusal } = await settingsContext(req);
      if (refusal) return res.status(refusal[0]).json({ error: refusal[1] });
      const sent = req.body || {};
      const body = { page: target.page, ...Object.fromEntries(keys.filter((key) => sent[key] !== undefined).map((key) => [key, sent[key]])) };
      let got;
      try {
        got = await callApp(req, target, 'POST', `/api/settings/${action}`, body);
      } catch (err) {
        return res.status(502).json({ error: `The App could not be reached: ${err.message}` });
      }
      const view = got.data && Array.isArray(got.data.settings) ? { ...got.data, settings: I.implementAppSettings(got.data.settings, history) } : got.data;
      return res.status(got.status).json(view);
    } catch (err) {
      return sendError(res, err);
    }
  };
  app.post('/api/inspire/implement/settings/preview', requireToken, settingsAction('preview', ['name', 'value']));
  app.post('/api/inspire/implement/settings/save', requireToken, settingsAction('save', ['name', 'value', 'was', 'note']));
  app.post('/api/inspire/implement/settings/run', requireToken, settingsAction('run', []));

  function groupingAsked(req) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const checked = G.checkGroupingSql(body.sql);
    if (!checked.ok) throw Object.assign(I.badRequest(checked.text), { details: { refused: { rule: checked.rule, at: checked.at } } });
    const main = G.groupingMainTable(body.main_table);
    if (!main) throw I.badRequest('main_table must name the use case table as catalog.schema.table.');
    if (!checked.tables.includes(main.canonical)) {
      throw I.badRequest(body.purpose === 'first_run' ? `The first run SQL does not read ${main.canonical}, the use case table; read it, so it returns that table's records.`
        : `The grouping SQL does not read ${main.canonical}, the use case table; read it, so every record can get a group.`);
    }
    const keys = G.groupingKeyColumns(body.key_columns);
    if (!keys) throw I.badRequest('key_columns must list 1 to 8 different record key column names, none of them group_name.');
    if (body.purpose !== undefined && !['grouping', 'first_run'].includes(body.purpose)) throw I.badRequest("purpose must be 'grouping' or 'first_run'.");
    return { checked, main, keys, purpose: body.purpose === 'first_run' ? 'first_run' : 'grouping' };
  }

  function sqlFailure(err, texts) {
    if (err && err.statusCode) return err;
    const message = String((err && err.message) || err);
    const submitted = /^SQL failed \((\d{3})\)/.exec(message);
    const kind = err && err.code === 'SQL_DEADLINE' ? 'deadline'
      : submitted && submitted[1] === '401' ? 'sign_in'
        : I.isReadDenied(message) || (submitted && submitted[1] === '403') ? 'denied'
          : submitted ? 'submitted' : isMissingTableError(err) ? 'missing' : 'failed';
    const [status, text] = texts[kind](message);
    return I.badRequest(text, status);
  }

  const GROUPING_FAILURES = {
    deadline: () => [504, `The grouping SQL did not finish within ${G.GROUPING_PREVIEW_MS / 1000} seconds, so Inspire stopped it; make it lighter, `
      + 'or try again once the warehouse is running.'],
    sign_in: (m) => [401, `Databricks did not accept your sign-in for the grouping SQL: ${m}`],
    denied: (m) => [403, `${G.GROUPING_DENIED}: ${m}`],
    submitted: (m) => [502, `Databricks could not run the grouping SQL: ${m}`],
    missing: (m) => [400, `Databricks found no table the grouping SQL reads, or you cannot see it with your own sign-in: ${m}`],
    failed: (m) => [400, `The grouping SQL failed: ${m}`],
  };
  const groupingFailure = (err) => sqlFailure(err, GROUPING_FAILURES);

  const profileFailures = (table) => ({
    deadline: () => [504, `Inspire read ${table} for the Grouping for ${GP.PROFILE_MS / 1000} seconds with no answer, so it stopped; `
      + 'try again once the warehouse is running.'],
    sign_in: (m) => [401, `Databricks did not accept your sign-in to read ${table} for the Grouping: ${m}`],
    denied: () => [403, `${U.runUnreadableText([table])}.`],
    submitted: (m) => [502, `Databricks could not read ${table} for the Grouping: ${m}`],
    missing: () => [403, `${U.runUnreadableText([table])}.`],
    failed: (m) => [400, `Inspire could not read ${table} for the Grouping: ${m}`],
  });

  const groupingColumns = (result) => (result.manifest?.schema?.columns || []).map((c) => c.name);

  function groupingResultTable(built, asked) {
    const spec = built && built.spec_json && typeof built.spec_json === 'object' ? built.spec_json : {};
    const builtName = String(spec.config?.result_table || '').trim();
    const name = builtName || String(asked || '').trim();
    const named = G.groupingMainTable(name);
    if (!named) throw I.badRequest('result_table must name the use case result table as catalog.schema.table, so its run reads the saved grouping.');
    const wanted = builtName && asked ? G.groupingMainTable(asked) : null;
    if (wanted && wanted.canonical !== named.canonical) {
      throw I.badRequest(`This use case writes its results to ${named.canonical}, so its grouping is saved there and not in ${wanted.canonical}; `
        + 'reload the page and save again.', 409);
    }
    return { result: named.canonical, table: G.groupingSettingsTable(name) };
  }

  app.post('/api/grouping/preview', requireToken, async (req, res) => {
    const token = P.personTokenOf(req);
    if (!token) return res.status(401).json({ error: G.GROUPING_NO_SIGN_IN });
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    try {
      const warehouseId = warehouseOf(req);
      const { checked, main, keys, purpose } = groupingAsked(req);
      const options = { rowLimit: G.GROUPING_ROW_LIMIT, byteLimit: G.GROUPING_BYTE_LIMIT, waitTimeout: '10s', signal: stop.signal };
      const run = (sql) => executeSql(req.dbHost, token, warehouseId, sql, null, options);
      const view = await runWithRequestDeadline(async () => {
        const columns = groupingColumns(await run(G.groupingShapeSql(checked.sql)));
        const problem = G.shapeProblem(columns, keys, purpose);
        if (problem) throw I.badRequest(problem);
        if (purpose === 'first_run') {
          const [sample, totals] = await Promise.all([run(G.scopeSqlSampleSql(checked.sql, keys)), run(G.scopeSqlTotalsSql(checked.sql, keys))]);
          const shown = G.scopeSqlPreviewView(sqlResultToObjects(sample), sqlResultToObjects(totals)[0] || {}, keys);
          return { ...shown, columns, truncated: Boolean(sample.manifest?.truncated || totals.manifest?.truncated) };
        }
        const [top, totals] = await Promise.all([run(G.groupingTopSql(checked.sql)), run(G.groupingTotalsSql(checked.sql, main, keys))]);
        const shown = G.groupingPreviewView(sqlResultToObjects(top), sqlResultToObjects(totals)[0] || {});
        return { ...shown, columns, truncated: Boolean(top.manifest?.truncated || totals.manifest?.truncated) };
      }, G.GROUPING_PREVIEW_MS);
      return res.json({ sql: checked.sql, tables: checked.tables, hash: checked.hash, main_table: main.canonical, key_columns: keys, ...view });
    } catch (err) {
      stop.abort();
      if (err && err.code === 'SQL_CANCELLED') return undefined;
      return sendError(res, groupingFailure(err));
    }
  });

  app.post('/api/grouping/save', requireToken, async (req, res) => {
    const token = P.personTokenOf(req);
    if (!token) return res.status(401).json({ error: G.GROUPING_NO_SIGN_IN });
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const { checked, main, keys, purpose } = groupingAsked(req);
      const [person, useCase, history] = await Promise.all([personOf(req), loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId)]);
      if (!person.username) throw I.badRequest(`Inspire could not tell who you are, so it saved no grouping: ${P.personProblem(person)}.`, 403);
      if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
      const before = I.previousBuilt(history);
      const refused = before ? I.implementSettingsOwnerRefusal(before, person.username) : null;
      if (refused) throw I.badRequest(refused.message, refused.status);
      const { result, table } = groupingResultTable(before, q(req, 'result_table'));
      const checkedAt = new Date().toISOString();
      const options = { waitTimeout: '10s', signal: stop.signal };
      await runWithRequestDeadline(async () => {
        const shape = await executeSql(req.dbHost, token, warehouseId, G.groupingShapeSql(checked.sql), null, { ...options, rowLimit: 1 });
        const problem = G.shapeProblem(groupingColumns(shape), keys, purpose);
        if (problem) throw I.badRequest(problem);
        const row = { useCaseId, sql: checked.sql, tables: checked.tables, hash: checked.hash, checkedBy: person.username, checkedAt };
        const insert = purpose === 'first_run' ? G.groupingSettingsInsert(table, row, G.SCOPE_SQL_SETTINGS, G.SCOPE_SQL_SAVED_NOTE) : G.groupingSettingsInsert(table, row);
        await executeSql(req.dbHost, token, warehouseId, G.groupingSettingsCreateSql(table), null, options);
        await executeSql(req.dbHost, token, warehouseId, insert.sql, insert.parameters, options);
      }, G.GROUPING_PREVIEW_MS);
      const [sqlName, tablesName, hashName, byName, atName] = purpose === 'first_run' ? G.SCOPE_SQL_SETTINGS : G.GROUPING_SETTINGS;
      return res.json({ saved: true, result_table: result, setting: { ...(purpose === 'first_run' ? { run_scope: 'custom' } : { group_by: 'custom' }),
        [sqlName]: checked.sql, [tablesName]: checked.tables, [hashName]: checked.hash, [byName]: person.username, [atName]: checkedAt,
        main_table: main.canonical, key_columns: keys } });
    } catch (err) {
      stop.abort();
      if (err && err.code === 'SQL_CANCELLED') return undefined;
      return sendError(res, groupingFailure(err));
    }
  });

  function builtData(history) {
    const built = I.previousBuilt(history);
    const spec = built && built.spec_json && typeof built.spec_json === 'object' ? built.spec_json : {};
    return spec.data && typeof spec.data === 'object' ? spec.data : {};
  }

  function profiledTable(useCase, data) {
    const primary = I.primaryTableOf(useCase) || I.useCaseTables(useCase)[0] || '';
    const swaps = data.tables && typeof data.tables === 'object' ? data.tables : {};
    const swapped = Object.keys(swaps).find((k) => k.replace(/`/g, '').toLowerCase() === primary.replace(/`/g, '').toLowerCase());
    return swapped === undefined ? primary : String(swaps[swapped] || primary).trim();
  }

  app.post('/api/grouping/profile', requireToken, async (req, res) => {
    const token = P.personTokenOf(req);
    if (!token) return res.status(401).json(RP.noPersonTokenBody(req.policyKey));
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    let table = '';
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const days = GP.scopeDaysOf(req.body?.scope_days ?? req.query.scope_days);
      if (days === null) throw I.badRequest(`scope_days must be a whole number of days from 1 to ${GP.PROFILE_DAYS_MAX}.`);
      const [useCase, history] = await Promise.all([loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId)]);
      if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
      const data = builtData(history);
      table = profiledTable(useCase, data);
      const main = G.groupingMainTable(table);
      if (!main || !/^[^`]+\.[^`]+\.[^`]+$/.test(table)) {
        throw I.badRequest(`Use case ${useCaseId} names no main table as catalog.schema.table, so Inspire cannot read it for the Grouping.`);
      }
      const options = (rowLimit) => ({ rowLimit, byteLimit: G.GROUPING_BYTE_LIMIT, waitTimeout: '10s', signal: stop.signal });
      const rows = async (sql, parameters, rowLimit) => sqlResultToObjects(await executeSql(req.dbHost, token, warehouseId, sql, parameters, options(rowLimit)));
      const view = await runWithRequestDeadline(async () => {
        const [cat, sch, tbl] = table.split('.');
        const columnsAsked = I.columnsStatement(table);
        const keysAsked = GP.keysStatement(cat, sch, tbl);
        const [columns, keyRows] = await Promise.all([rows(columnsAsked.sql, columnsAsked.parameters, GP.PROFILE_META_ROWS),
          rows(keysAsked.sql, keysAsked.parameters, GP.PROFILE_META_ROWS).catch((err) => {
            if (['SQL_DEADLINE', 'SQL_CANCELLED'].includes(err && err.code)) throw err;
            console.warn(`grouping profile: the declared keys of ${table} could not be read, so the grouping SQL starts with no key: ${err.message}`);
            return [];
          })]);
        if (!columns.length) throw I.badRequest(`${U.runUnreadableText([table])}.`, 403);
        const roles = data.column_roles && typeof data.column_roles === 'object' ? data.column_roles : {};
        const keys = GP.declaredKeys(keyRows);
        const saved = GP.savedJoins(useCase.table_joins, table);
        const joins = saved.length ? saved : keys.joins;
        const namedTime = GR.namedTimeColumn(roles, GP.eliteAssessmentOf(useCase.elite_assessment), table);
        const timeRefs = GR.timeRefsOf(namedTime, columns, joins);
        const linked = [...saved, ...keys.joins];
        const refs = [...new Set([...timeRefs, ...GR.joinedTables(linked)])];
        const tagsAsked = GP.tagsStatement([table, ...refs]);
        const readRefColumns = Promise.all(refs.map(async (ref) => {
          const asked = I.columnsStatement(ref);
          const found = await rows(asked.sql, asked.parameters, GP.PROFILE_META_ROWS).catch((err) => {
            if (['SQL_DEADLINE', 'SQL_CANCELLED'].includes(err && err.code)) throw err;
            console.warn(`grouping profile: the columns of ${ref} could not be read, so neither its dates nor its columns group ${table}: ${err.message}`);
            return [];
          });
          return [ref.toLowerCase(), found];
        }));
        const readTags = rows(tagsAsked.sql, tagsAsked.parameters, GP.PROFILE_META_ROWS).catch((err) => {
          if (['SQL_DEADLINE', 'SQL_CANCELLED'].includes(err && err.code)) throw err;
          console.warn(`grouping profile: the column tags of ${table} could not be read, so only column names mark personal columns: ${err.message}`);
          return [];
        });
        const [refPairs, tagRows] = await Promise.all([readRefColumns, readTags]);
        const refColumns = Object.fromEntries(refPairs);
        const tags = GP.columnTagsOf(tagRows);
        const time = GR.timeSourceOf(namedTime, columns, joins, refColumns);
        const joined = GR.joinedCandidates(linked, refColumns, tags, time && time.via ? time.via.table : '');
        const text = [useCase.use_case, useCase.statement, useCase.solution].map((v) => (v == null ? '' : String(v))).join(' ');
        const candidates = GR.groupingCandidates(columns, roles, table, { primary: keys.primary, joined, text, time: time ? time.column : '', tags })
          .filter((name) => !name.includes(',')).slice(0, GR.GROUP_PROFILED);
        const profiledJoined = joined.filter((c) => candidates.includes(c.name));
        const [statRows, sample] = await Promise.all([rows(GP.statsSql(main, candidates, time, days, profiledJoined), null, 1),
          candidates.length ? rows(GP.sampleSql(main, candidates, profiledJoined), null, GP.PROFILE_META_ROWS) : []]);
        const stats = statRows[0] || {};
        const picked = GP.profiledColumns(stats, candidates);
        const values = picked.length ? await rows(GP.valuesSql(main, picked, profiledJoined), null, GP.PROFILE_VALUE_ROWS) : [];
        const draft = (paths) => GP.profileView({ table, technique: useCase.analytics_technique, columns, candidates, stats, sample, values, paths,
          time, days, keys, joins: saved, joined: profiledJoined, readAt: new Date().toISOString() });
        const first = draft(null);
        if (first.recommended.length < 2) return first;
        const paths = await rows(GP.pathsSql(main, first.recommended, profiledJoined), null, GP.PROFILE_PATH_ROWS);
        return draft(paths);
      }, GP.PROFILE_MS);
      return res.json({ ...view, deep_suggestion: GP.deepSuggestionOf(useCase) });
    } catch (err) {
      stop.abort();
      if (err && err.code === 'SQL_CANCELLED') return undefined;
      return sendError(res, sqlFailure(err, profileFailures(table || 'the use case table')));
    }
  });

  const useCaseAlerts = deps.useCaseAlerts || A.createUseCaseAlerts();

  function alertIo(req, warehouseId) {
    const who = A.personOf(req);
    return {
      who,
      io: {
        sp: (path, opts = {}) => jsonOf(dbFetch, req.dbHost, req.dbToken, path, opts),
        person: (path, opts = {}) => jsonOf(dbFetch, req.dbHost, who.token, path, opts),
        sql: who.token ? (warehouse, sql, parameters) => executeSql(req.dbHost, who.token, warehouse, sql, parameters) : null,
        host: String(req.dbHost || '').replace(/\/+$/, ''),
        link: A.inspireLink(req.headers),
        warehouse: warehouseId,
      },
    };
  }

  async function alertsFor(req, warehouseId, catalog, schema, sid, useCaseId, step, body) {
    const { who, io } = alertIo(req, warehouseId);
    if (step !== 'listing') A.requirePerson(who);
    const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
    io.useCase = () => loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
    return useCaseAlerts[step](history, useCaseId, io, who, body);
  }

  app.get('/api/inspire/implement/alerts', requireToken, async (req, res) => {
    let asked;
    try {
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      asked = [warehouseOf(req), catalog, schema, sessionIdOf(req), I.validateUseCaseId(q(req, 'use_case_id'))];
    } catch (err) {
      return sendError(res, err);
    }
    try {
      return res.json(await alertsFor(req, ...asked, 'listing'));
    } catch (err) {
      return res.json(A.unavailableListing(err));
    }
  });

  const alertStep = (step) => async (req, res) => {
    try {
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      res.json(await alertsFor(req, warehouseOf(req), catalog, schema, sessionIdOf(req), I.validateUseCaseId(q(req, 'use_case_id')), step,
        req.body || {}));
    } catch (err) {
      sendError(res, err);
    }
  };
  app.post('/api/inspire/implement/alerts/preview', requireToken, alertStep('preview'));
  app.post('/api/inspire/implement/alerts/save', requireToken, alertStep('save'));
  app.post('/api/inspire/implement/alerts/pause', requireToken, alertStep('pause'));
  app.post('/api/inspire/implement/alerts/delete', requireToken, alertStep('delete'));

  if (hostedRun && hostedRun.useAlerts) {
    hostedRun.useAlerts(async (req, entry, step, body) => {
      const at = entry.ctx || {};
      if (!at.warehouseId || !at.catalog || !at.schema || !isInt64Id(entry.session_id)) {
        throw Object.assign(new Error('Inspire cannot tell which use case this page belongs to, so it cannot keep its alerts; open it from the Run tab'),
          { statusCode: 409 });
      }
      return alertsFor(req, at.warehouseId, at.catalog, at.schema, int64Id(entry.session_id), I.validateUseCaseId(entry.use_case_id), step, body);
    });
  }

  if (hostedRun && hostedRun.useDecisions) {
    hostedRun.useDecisions(async (req, entry) => {
      const at = entry.ctx || {};
      if (!at.warehouseId || !at.catalog || !at.schema || !isInt64Id(entry.session_id)) {
        throw Object.assign(new Error('Inspire cannot tell which use case this page belongs to, so it records no decision on it; open it from the Run tab'),
          { statusCode: 409 });
      }
      const useCaseId = I.validateUseCaseId(entry.use_case_id);
      const history = await loadHistory(req.dbHost, req.dbToken, at.warehouseId, at.catalog, at.schema, int64Id(entry.session_id), useCaseId);
      const live = I.previousBuilt(history);
      const hosted = live ? I.hostedRecord(live) : null;
      if (!hosted || hosted.id !== entry.record.id || hosted.version !== entry.record.version) {
        throw Object.assign(new Error('this page is no longer the live page of its use case, so Inspire records no decision on it; open it again from the Run tab'),
          { statusCode: 409 });
      }
      const resultTable = String((live.spec_json && live.spec_json.config && live.spec_json.config.result_table) || '').trim();
      if (!resultTable) {
        throw Object.assign(new Error('this MVP names no result table in its settings, so Inspire cannot check which table its decisions belong to; '
          + 'pick the result table in Edit MVP and build it again'), { statusCode: 409 });
      }
      const token = await appToken();
      if (!token) {
        throw Object.assign(new Error('Inspire has no sign-in of its own here, so it cannot record decisions for this page; '
          + 'open the page from the Inspire App in Databricks'), { statusCode: 503 });
      }
      return { result_table: resultTable, writer: { token, warehouse: at.warehouseId } };
    });
  }

  async function controlContext(req) {
    const sid = sessionIdOf(req);
    const warehouseId = warehouseOf(req);
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
    const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
    return {
      sid, warehouseId, catalog, schema, useCaseId, history,
      targets: C.controlTargets(history),
      key: `${req.dbHost}|${catalog}.${schema}|${sid}|${useCaseId}`,
      logTable: C.controlLogTableName(catalog, schema),
    };
  }

  async function sharedOf(req, ctx) {
    try {
      const table = I.implementTableName(ctx.catalog, ctx.schema);
      const rows = await implementRows(req.dbHost, req.dbToken, ctx.warehouseId, table, (existing) => I.implementRegistryStatement(table, existing));
      return { shared: I.sharedHolders(rows, { sessionId: ctx.sid, useCaseId: ctx.useCaseId }), shared_error: '' };
    } catch (err) {
      return { shared: null, shared_error: err.message };
    }
  }

  app.get('/api/inspire/implement/live', requireToken, async (req, res) => {
    try {
      const ctx = await controlContext(req);
      const live = await liveCache.get(ctx.key, async () => {
        const paths = C.livePaths(ctx.targets);
        const names = Object.keys(paths);
        const got = await Promise.all(names.map((name) => jsonOf(dbFetch, req.dbHost, req.dbToken, paths[name])));
        let actions = [];
        try {
          actions = await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId,
            C.controlLogSelect(ctx.logTable, { sessionId: ctx.sid, useCaseId: ctx.useCaseId }));
        } catch (err) {
          if (!isMissingTableError(err)) throw err;
        }
        const { shared, shared_error: sharedError } = await sharedOf(req, ctx);
        return {
          targets: ctx.targets,
          assets: C.liveStatus(ctx.targets, Object.fromEntries(names.map((name, i) => [name, got[i]])),
            { useCaseId: ctx.useCaseId, sessionId: ctx.sid, history: ctx.history }),
          actions,
          shared,
          shared_error: sharedError,
          checked_at: new Date().toISOString(),
        };
      });
      res.json(live);
    } catch (err) {
      sendError(res, err);
    }
  });

  const ownedControlLogs = new Set();

  async function alignControlLogOwner(req, ctx) {
    if (ownedControlLogs.has(ctx.logTable)) return '';
    try {
      const rows = await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId, C.controlLogOwnerSql(ctx.catalog, ctx.schema));
      const fix = C.controlLogOwnerFix(rows, ctx.logTable);
      if (fix) await executeSql(req.dbHost, req.dbToken, ctx.warehouseId, fix);
      ownedControlLogs.add(ctx.logTable);
      return '';
    } catch (e) {
      console.warn(`implement control log owner change failed: ${e.message}`);
      return `${C.CONTROL_LOG_TABLE} keeps the App as its owner, so only the App can read it: ${e.message}`;
    }
  }

  app.post('/api/inspire/implement/control', requireToken, async (req, res) => {
    try {
      const asset = q(req, 'asset');
      const action = q(req, 'action');
      const ctx = await controlContext(req);
      const id = C.controlTarget(asset, ctx.targets);
      const known = Object.hasOwn(C.CONTROL_ACTIONS, asset) && Object.hasOwn(C.CONTROL_ACTIONS[asset], action);
      const phrase = known ? C.controlPhrase(C.CONTROL_ACTIONS[asset][action]) : `act on the ${asset === 'job' ? 'job' : I.IMPLEMENT_OUTPUT_LABELS[asset] || asset}`;
      const latest = ctx.history[0] || {};
      if (asset !== 'build' && I.IMPLEMENT_ACTIVE_STATUSES.includes(latest.status)) {
        throw I.badRequest(`spec v${latest.spec_version} is still ${latest.status}; ${phrase} after it finishes, or stop the build first`, 409);
      }
      const owner = await jsonOf(dbFetch, req.dbHost, req.dbToken, C.ownerCheckPath(asset, id));
      const problem = C.ownerProblem(asset, owner, { useCaseId: ctx.useCaseId, sessionId: ctx.sid, history: ctx.history });
      if (problem) throw I.badRequest(`Inspire did not ${phrase}: ${problem}`, 409);
      const label = C.controlAction(asset, action);
      if (C.SHARED_CONTROL_ASSETS.includes(asset) && q(req, 'confirm_shared') !== 'true') {
        const { shared, shared_error: sharedError } = await sharedOf(req, ctx);
        const sharing = C.sharedControlProblem(asset, action, id, shared, sharedError);
        if (sharing) throw I.badRequest(`Inspire did not ${C.controlPhrase(label)}: ${sharing}`, 409);
      }
      const spec = latest.spec_json ? I.validateImplementSpec(latest.spec_json).spec : null;
      const request = C.controlRequest(asset, action, id, { warehouseId: spec && spec.config.warehouse_id });
      await executeSql(req.dbHost, req.dbToken, ctx.warehouseId, C.controlLogCreateSql(ctx.logTable));
      const ownerError = await alignControlLogOwner(req, ctx);
      const got = await jsonOf(dbFetch, req.dbHost, req.dbToken, request.path,
        { method: request.method, ...(request.body ? { body: jsonWithInt64Ids(request.body, request.int64 || []) } : {}) });
      const failure = got.ok ? '' : String((got.data && (got.data.message || got.data.error || got.data.raw)) || `HTTP ${got.status}`);
      const message = got.ok ? `${label}: done` : `${label} failed: ${failure}`;
      const person = await personOf(req);
      const insert = C.controlLogInsert(ctx.logTable, {
        sessionId: ctx.sid, useCaseId: ctx.useCaseId, asset, assetId: id, action, result: got.ok ? 'done' : 'failed', message, actedBy: person.username,
      });
      let auditError = '';
      try {
        await executeSql(req.dbHost, req.dbToken, ctx.warehouseId, insert.sql, insert.parameters);
      } catch (e) {
        auditError = `the action was not recorded in ${C.CONTROL_LOG_TABLE}: ${e.message}`;
        console.warn(`implement control audit write failed: ${e.message}`);
      }
      if (ownerError) auditError = [auditError, ownerError].filter(Boolean).join('; ');
      liveCache.forget(ctx.key);
      if (!got.ok) throw I.badRequest(message, got.status >= 400 && got.status < 500 ? got.status : 502);
      res.json({ ok: true, asset, action, asset_id: id, message, audit_error: auditError });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function alignJobSettings(host, token, jobId) {
    const refused = (err) => ({ ok: false, status: 0, data: { message: err.message } });
    const reason = (got) => got.data.message || got.data.error_code || `HTTP ${got.status}`;
    const job = await jsonOf(dbFetch, host, token, `/api/2.1/jobs/get?job_id=${jobId}`).catch(refused);
    if (!job.ok) return inspireJobEnvironmentWarning(jobId, { reason: reason(job) });
    const change = inspireJobEnvironmentChange(job.data.settings);
    const tagged = inspireJobTestTagChange(job.data.settings);
    if (!change && !tagged) return '';
    const update = { job_id: jobId, new_settings: change ? { environments: change.environments } : {} };
    if (tagged && Object.keys(tagged.tags).length) update.new_settings.tags = tagged.tags;
    if (tagged && !tagged.to) update.fields_to_remove = ['tags'];
    const updated = await jsonOf(dbFetch, host, token, '/api/2.1/jobs/update', {
      method: 'POST',
      body: jsonWithInt64Ids(update, ['job_id']),
    }).catch(refused);
    if (updated.ok) return '';
    return [change && inspireJobEnvironmentWarning(jobId, { from: change.from, reason: reason(updated) }),
      tagged && inspireJobTestTagWarning(jobId, { ...tagged, reason: reason(updated) })].filter(Boolean).join(' ');
  }

  app.post('/api/inspire/implement/rerun', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      const latest = history[0];
      if (!latest || !latest.job_id) {
        const err = new Error('this use case has no Implement job to re-run yet');
        err.statusCode = 400;
        throw err;
      }
      const widgets = I.rerunWidgets(history);
      const overrides = I.rerunOverrides(req.body?.overrides);
      const notebookParams = I.rerunParams(widgets.map((w) => w.name), overrides);
      const overrideIssues = I.widgetProblems(widgets, overrides);
      if (overrideIssues.length) throw I.badRequest(`widget values are out of range: ${overrideIssues.join('; ')}`);
      const useCase = await loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      await refusePersonUnreadable(req, latest.spec_json, useCase);
      await refuseMissingSources(req, warehouseId, latest.spec_json, useCase);
      const jobId = requireInt64Id(latest.job_id, 'job_id');
      const warning = await alignJobSettings(req.dbHost, req.dbToken, jobId);
      const viewer = await grantJobViewer(dbFetch, req.dbHost, req.dbToken, jobId, (await personOf(req)).username);
      const resp = await dbFetch(req.dbHost, req.dbToken, '/api/2.1/jobs/run-now', {
        method: 'POST',
        body: jsonWithInt64Ids({ job_id: jobId, notebook_params: notebookParams, only: [I.IMPLEMENT_NOTEBOOK_TASK_KEY] }, ['job_id']),
      });
      const text = await resp.text();
      let data = {};
      try { data = parseExactJson(text); } catch { data = { raw: text }; }
      if (!resp.ok) {
        const err = new Error(data.message || data.error || text);
        err.statusCode = resp.status;
        throw err;
      }
      rememberViewer(data.run_id, viewer);
      res.json({
        run_id: data.run_id,
        job_id: latest.job_id,
        job_run_url: databricksJobRunUrl(req.dbHost, latest.job_id, data.run_id),
        notebook_params: notebookParams,
        ...(warning ? { warning } : {}),
        viewer_granted: viewer.granted,
        ...(viewer.note ? { viewer_note: viewer.note } : {}),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return { loadHistory };
}

module.exports = { jsonOf, registerImplementRoutes };
