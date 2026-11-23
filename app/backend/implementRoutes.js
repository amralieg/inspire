const { isMissingTableError } = require('./lib/inspireFeedback');
const VALUE_DISCLAIMER = require('./lib/valueDisclaimer.json');
const SR = require('./lib/scoreRefine');
const { INSPIRE_DB_SHAPE, USE_CASE_ID_SHAPE, noSessionText, stepsStatement } = require('./lib/sqlInputs');
const I = require('./lib/inspireImplement');
const RL = require('./lib/relationships');
const { createGenieJobGuard } = require('./lib/genieJobGuard');
const { invokeChatModel, appChatModels } = require('./lib/modelAccess');
const { mapLimit } = require('./lib/mapLimit');

// REQ-323: how many history rows are enriched at once.
const HISTORY_ROW_CONCURRENCY = 8;
const { runWithQueryTags, lookupWithRetry } = require('./lib/sqlStatements');
const { genieNotebookJobName, latestGenieNotebookRun } = require('./lib/genieNotebookJob');
const C = require('./lib/implementControl');
const LE = require('./lib/lakebaseEnforce');
const { appShellCatalog, bundledBuildStamp } = require('./lib/appShell');
const { moneyStatements, moneyView, moneyWithheld } = require('./lib/implementMoney');
const FB = require('./lib/appFeedback');
const { specVibeAsks } = require('../frontend/src/lib/vibeLimits.js');
const { chosenTableScopes } = require('../frontend/src/lib/tableScope.js');
const { HOSTED_NO_TOKEN } = require('./lib/hostedRun');
const { ownServicePrincipalId } = require('./lib/inspireSpGrants');
const { inspireJobEnvironmentChange, inspireJobEnvironmentWarning, inspireJobTestTagChange, inspireJobTestTagWarning, parseTableScopeText, withChosenTableScope, previewScopesOf } = require('./lib/inspireJobParams');
const R = require('./lib/reviewFigures');
const A = require('./lib/useCaseAlerts');
const P = require('./lib/requestPerson');
const RP = require('./lib/routePolicy');
const U = require('./lib/ucReads');
const G = require('../frontend/src/lib/tableName.js');
const GR = require('./lib/groupingRule');
const GP = require('./lib/groupingProfile');
const FX = require('./lib/fxRates');
const JC = require('./lib/jobCurrency');
const MD = require('./lib/moneyDescribe');
const { TAGS_UNREAD_NOTE, personalColumn } = require('../frontend/src/lib/personalColumns.js');
const {
  clearedText, emptyScopeWarningOf, nextAppName, ownSchemaClashNote, readinessScope, removeTable, skippedAsksText, withoutSkippedAsks,
} = require('../frontend/src/lib/implementWizard.js');
const { canonicalDiscoveryType } = require('../frontend/src/lib/discoveryType.js');
const { runWithRequestDeadline } = require('./lib/sqlStatements');
const { fsApiPath } = require('./lib/workspacePaths');
const { int64Id, isInt64Id, requireInt64Id, jsonWithInt64Ids } = require('./lib/int64Id');
const { parseExactJson } = require('./lib/exactJson');
const { grantJobViewer, rememberViewer } = require('./lib/jobViewer');
const PM = require('./lib/permissions');
const UA = require('./lib/useCaseAssets');
const { coarseGrants } = require('./lib/grantScope');
const L = require('./lib/launchLedger');
const PM_ERROR = require('./lib/permissionError');
const GC = require('./lib/genieCodeCheck');
const SA = require('./lib/sourceAccess');
const D = require('./lib/buildDiagnostics');
const MV = require('./lib/metricViews');
const DM = require('./lib/dataManagement');
const { joinSentences } = require('./lib/sentences');
const AR = require('./lib/accessRequest');
const VY = require('./lib/valueYearly');
const VE = require('./lib/valueEstimate');
const VDC = require('./lib/valueDriversCalc');
const VA = require('./lib/valueAnswers');
const VR = require('./lib/valueReview');
const VCP = require('./lib/valueCasePlan');
const IV = require('./lib/inspireValue');

function sendError(res, err) {
  return PM_ERROR.sendFailure(res, PM_ERROR.failureStatus(err), (err && err.message) || String(err), err && err.details, err && err.denial);
}

function q(req, key) {
  const v = req.query[key] ?? req.body?.[key];
  return v == null ? '' : String(v).trim();
}

// A similar-table row from system.information_schema, as the catalog.schema.table name the picker shows.
const SWAP_SEARCH_LIMIT_MS = 15000;
const candidateOf = (r) => `${r.table_catalog}.${r.table_schema}.${r.table_name}`;

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
    const err = new Error(inspire_database ? INSPIRE_DB_SHAPE : I.IMPLEMENT_NOT_AVAILABLE);
    err.statusCode = 400;
    throw err;
  }
  return { inspire_database: inspire_database.trim(), ...parsed };
}

async function rowsOf(executeSql, sqlResultToObjects, host, token, warehouseId, statement) {
  const result = await executeSql(host, token, warehouseId, statement.sql, statement.parameters);
  return sqlResultToObjects(result);
}

const FREE_APP_NAME_TRIES = 5;
const LAKEBASE_ENFORCE_TABLES = 50;

async function freeAppName(dbFetch, host, token, taken) {
  let name = taken;
  for (let i = 0; i < FREE_APP_NAME_TRIES; i += 1) {
    name = nextAppName(name);
    const found = await jsonOf(dbFetch, host, token, `/api/2.0/apps/${encodeURIComponent(name)}`);
    if (found.status === 404) return name;
    if (!found.ok) return '';
  }
  return '';
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
  // REQ-354 follow-up: one delete per Uninstall all run's own build job, per running App (see I.settleUninstallRunJob).
  const uninstallJobCache = new Map();
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
    buildStamp = bundledBuildStamp,
    runDefaults = () => ({}),
    appToken = async () => '',
    genieCodeCheck = GC.createGenieCodeCheck(),
    appBaseUrl = (req) => I.inspireBaseUrl(process.env.DATABRICKS_APP_URL)
      || I.inspireBaseUrl(String(req.headers['x-forwarded-host'] || '').split(',')[0]),
  } = deps;

  const sqlRows = (host, token, warehouseId, statement) =>
    rowsOf(executeSql, sqlResultToObjects, host, token, warehouseId, statement);
  const liveCache = C.createLiveCache();
  const missingControlLogs = new Map();
  const fetchJsonFor = (req) => (path) => jsonOf(dbFetch, req.dbHost, req.dbToken, path);

  const readMeFor = (req) => (token) => jsonOf(dbFetch, req.dbHost, token, P.SCIM_ME_PATH);
  const { accessRowsOf, appReads, appTokenOf, grantSourceAccess, runPersonGrants, sourceAccess } = SA.createSourceAccess({ executeSql, sqlResultToObjects, dbFetch, appToken });

  async function loadTokenPrincipal(req) {
    const got = await readMeFor(req)(req.dbToken);
    return got.ok ? got.data : {};
  }

  const personOf = (req) => P.requestPerson(req, readMeFor(req));
  const nextVersionOf = (history) => Math.max(0, ...history.map((r) => Number(r.spec_version) || 0)) + 1;
  // REQ-418: the App's service principal token every read uses (requireToken sets it for every route that is not a person's own action).
  function appReadToken(req) {
    const token = req.dbToken;
    if (token) return token;
    const { error, ...details } = RP.noPersonTokenBody(req.policyKey);
    throw Object.assign(I.badRequest(error, 401), { details });
  }

  // A metric view is not a table: a route that reads a picked table's rows refuses it first, with one plain line.
  // A failed type lookup does not block the read; the read then reports its own error.
  // A metric view is not a table; with unknownType, neither is a table whose type cannot be read (fail closed). Each is refused by
  // name before any read, from the one type lookup (tableTypeOf). Several tables are checked in order.
  async function refuseTableTypes(req, warehouseId, tables, { unknownType = false } = {}) {
    const named = (tables || []).map((t) => String(t || '').trim()).filter(Boolean);
    if (!named.length) return;
    const token = appReadToken(req);
    const looked = await Promise.all(named.map((t) => tableTypeOf(req, () => token, warehouseId, t)));
    named.forEach((table, i) => {
      const { type, transient, denied } = looked[i];
      // A refusal from Unity Catalog is the person's answer: it reaches the route as the Permission Required payload (REQ-313).
      if (denied) throw denied;
      if (MV.isMetricViewType(type)) throw tableRefusal(MV.metricViewRefusal(table));
      if (!unknownType || type) return;
      // A transient lookup failure is not a verdict on the table: it is retryable, never shown as not usable.
      throw transient ? tableRetryable(table) : tableRefusal(MV.unknownTypeRefusal(table));
    });
  }

  // A refusal is a 400 the caller must surface as-is: a route that catches read errors to keep going never swallows it.
  function tableRefusal(message) {
    return Object.assign(new Error(message), { statusCode: 400, refusal: true });
  }

  function tableRetryable(table) {
    return Object.assign(new Error(MV.typeCheckBusyRefusal(table)), { statusCode: 503, refusal: true });
  }

  async function refuseMetricView(req, warehouseId, table, { unknownType = false } = {}) {
    await refuseTableTypes(req, warehouseId, [table], { unknownType });
  }

  // The type of one table from information_schema: { type } when it reads (null when the table names no type), and on a failure
  // { type: null, transient } where transient says a retry can change it. A transient failure is retried once (lookupWithRetry).
  async function tableTypeOf(req, tokenOf, warehouseId, table) {
    const got = await lookupWithRetry(() => sqlRows(req.dbHost, tokenOf(), warehouseId, I.tableTypeStatement(table)));
    if (got.error) return { type: null, transient: got.transient, denied: PM_ERROR.accessDenied(got.error) ? got.error : null };
    const rows = got.value;
    return { type: rows.length ? String(rows[0].table_type || '') || null : null, transient: false };
  }


  // The App's service principal as the build names it: its display name, else its application id.
  const builderLabelOf = (me) => String((me && (me.displayName || me.applicationId)) || '').trim();

  async function loadBuilderPrincipal(req) {
    const got = await readMeFor(req)(await appTokenOf(req));
    return got.ok ? got.data : {};
  }

  async function readColumnTags(req, token, warehouseId, tables) {
    const asked = GP.tagsStatement(tables);
    if (!asked) return { tags: {}, error: '' };
    try {
      return { tags: GP.columnTagsOf(await sqlRows(req.dbHost, token, warehouseId, asked)), error: '' };
    } catch (err) {
      console.warn(`implement: the column tags of ${tables.join(', ')} could not be read, so only column names are checked for personal data: ${err.message}`);
      return { tags: {}, error: err.message || String(err) };
    }
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

  // The build record is the App's own tracking table, so it is read as the App, as the Build page's status and history read it. The
  // Check runs on load for every person: a person who cannot read that table gets a plain reason, never a 500 (REQ-267).
  async function appRecordOf(req, warehouseId, catalog, schema, sid, useCaseId) {
    try {
      return await loadHistory(req.dbHost, await appTokenOf(req), warehouseId, catalog, schema, sid, useCaseId);
    } catch (err) {
      if (!I.isReadDenied(err && err.message)) throw err;
      throw I.badRequest('Inspire cannot read the build record of this use case, so it cannot tell what the App still needs. '
        + 'Ask your workspace admin to give the Inspire App SELECT on its tracking table, then click Try again.', 403);
    }
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

  // The name the Genie regeneration job tags with: the user's name for the use case, else its own. Empty when unreadable, so no name is invented.
  async function regenUseCaseName(req, warehouseId, catalog, schema, sid, useCaseId) {
    try {
      const row = await loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      return String((row && (row.user_use_case_name || row.use_case)) || '').trim();
    } catch {
      return '';
    }
  }

  async function loadUseCase(host, token, warehouseId, catalog, schema, sid, useCaseId) {
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    const rows = await sqlRows(host, token, warehouseId, I.useCaseRowStatement(table, sid, useCaseId));
    return rows[0] || null;
  }

  // The tables a build-context grant may name. With a spec (the Launch wizard's, before any build), the spec is validated by the same
  // path plan and submit use, and its own tables and Data Filters count. Without one, the latest saved build's spec does. Either way
  // the use case's saved involved tables are the base, so an injected table is refused.
  async function requireBuildSources(req, warehouseId, tables, asked = null) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const sid = sessionIdOf(req);
    const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
    if (asked && asked.use_case_id !== useCaseId) throw I.badRequest(`the spec is for use case ${asked.use_case_id || '(none)'}, not ${useCaseId}`, 400);
    // The saved involved tables and the build record are the App's own tracking tables: read as the App (REQ-268 sweep, as REQ-267).
    const appToken = await appTokenOf(req);
    const involved = await useCasesTables(req, warehouseId, catalog, schema, sid, [useCaseId], appToken);
    if (!involved.length) throw I.badRequest(`Inspire has no source tables saved for use case ${useCaseId}, so it grants none.`, 409);
    let spec = asked;
    if (!spec) {
      const history = await loadHistory(req.dbHost, appToken, warehouseId, catalog, schema, sid, useCaseId);
      const latest = [...(history || [])].sort((a, b) => (Number(b.spec_version) || 0) - (Number(a.spec_version) || 0))[0];
      spec = (latest && latest.spec_json) || {};
    }
    const filtered = Array.isArray(spec.data && spec.data.filters) ? spec.data.filters.map((f) => String((f && f.table) || '').trim()).filter(Boolean) : [];
    const allowed = I.uniqueTables([...involved, ...I.sourceTables(spec, I.uniqueTables([...involved, ...filtered]))]);
    const outside = tables.filter((t) => !allowed.some((a) => a.toLowerCase() === t.toLowerCase()));
    if (outside.length) throw I.badRequest(`these tables are not source tables of use case ${useCaseId}, so Inspire grants none of them: ${outside.join(', ')}`, 400);
  }

  async function useCasesTables(req, warehouseId, catalog, schema, sid, useCaseIds, token = req.dbToken) {
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    const rows = await sqlRows(req.dbHost, token, warehouseId, I.useCaseTablesStatement(table, sid, useCaseIds));
    return I.uniqueTables(rows.flatMap((row) => I.useCaseTables(row)));
  }

  async function loadSession(host, token, warehouseId, catalog, schema, sid) {
    const session = await fetchInspireSessionWidgetRow(host, token, warehouseId, catalog, schema, sid);
    if (!session) {
      const err = new Error(noSessionText(sid));
      err.statusCode = 404;
      throw err;
    }
    return session;
  }

  async function loadGenieCode(req) {
    try {
      return await genieCodeCheck(req.dbHost, req.dbToken, (path, opts) => jsonOf(dbFetch, req.dbHost, req.dbToken, path, opts));
    } catch (err) {
      console.warn(`implement: the Genie Code check did not finish, so it does not block the build: ${err.message}`);
      return GC.verdictOf({ route: '', refused: [], waiting: [{ why: err.message }], listed: {} });
    }
  }

  async function loadFeatures(req) {
    const [apps, spaces, alerts, genieCode] = await Promise.all([
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/apps?page_size=1'),
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/genie/spaces?page_size=1'),
      jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/alerts?page_size=1'),
      loadGenieCode(req),
    ]);
    const appsUnchecked = !apps.ok && apps.status >= 500;
    return { apps: apps.ok || appsUnchecked, genie_spaces: spaces.ok, alerts: alerts.ok, genie_code: genieCode };
  }

  async function requireGenieCode(req) {
    const verdict = await loadGenieCode(req);
    if (verdict.available !== false) return;
    throw Object.assign(new Error(verdict.reason), { statusCode: 409, details: { genie_code: verdict } });
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
    // REQ-418: whether the person can grant the App access is read with their own sign-in (the grant authority); the App reads the rest.
    const person = P.forwardedTokenOf(req) || req.dbToken;
    // REQ-418: every build runs as the App's service principal, so the App is the builder of the result table.
    const builder = true;
    const createsSchema = I.schemaNotCreated(rows) ? await createsUseCaseSchema(req, warehouseId, table, useCaseId) : false;
    const builderName = builderLabelOf(await loadBuilderPrincipal(req));
    const access = I.outputAccess(rows, table, { builder, createsSchema, identity: builderName });
    const model = I.trainsModel(useCase)
      ? I.modelAccess(elsewhere ? modelRows : rows, modelName, { builder, createsSchema: !elsewhere && createsSchema, identity: builderName }) : null;
    const warehouse = await appWarehouseCheck(req, warehouseId, access.identity, options.warehouseName);
    const own = Boolean(options.appWarehouse) && options.appWarehouse !== warehouseId;
    const appWarehouse = own ? await appWarehouseCheck(req, options.appWarehouse, access.identity, '', true) : warehouse;
    const warnings = [...I.shareWarnings(table, rows, options.principals, { createsSchema }),
      ...I.shareWarehouseWarnings(warehouse, options.principals, options.viewed, options.warehouseName)];
    if (warnings.length) access.grant = { ...access.grant, warn: joinSentences(...warnings) };
    access.app = I.appAccessCheck(access.app, own ? null : warehouse);
    const appGaps = I.accessPlan(table, rows, '', { createsSchema }).gaps;
    if (appGaps.length && builder) {
      const offer = I.newAppsAccessOffer(table, await accessRowsOf(req, person, warehouseId, table), appGaps);
      if (offer) access.app = { ...access.app, offer };
    }
    access.app_warehouse = appWarehouse;
    // A new table is shown as a warning (visible, never blocking): the First run creates it, so the person sees the verdict.
    let safety = access.exists ? { ok: true, detail: `${access.table} holds only this use case's rows` } : { ok: true, warn: true, detail: `${access.table} is new; the First run creates it` };
    const held = I.resultTableHolderProblem(table, holder, sid, useCaseId);
    if (held) safety = { ok: false, detail: held };
    else if (access.exists && access.write.ok) {
      const columns = await I.readPickedTable(table, () => sqlRows(req.dbHost, req.dbToken, warehouseId, I.columnsStatement(table)));
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

  // REQ-478, REQ-456: a result table the identity Inspire builds as cannot write, or cannot open to the new App, moves to the
  // Inspire-managed default (the schema the installer made it own) when that one passes, so the build never stops on a permission.
  async function checkManagedOutput(req, warehouseId, table, useCaseId, needsApp, options = {}, from = table) {
    const output = await checkOutput(req, warehouseId, table, useCaseId, options);
    if (output.write.ok && (!needsApp || output.app.ok)) return { output, moved: null };
    const { inspire_database } = dbOf(req, splitInspireDatabase);
    const managed = I.defaultResultTable(inspire_database, useCaseId, sessionIdOf(req));
    if (!managed || I.sameSchema(managed, table)) return { output, moved: null };
    const there = await checkOutput(req, warehouseId, managed, useCaseId, options);
    if (!there.ok || !there.app.ok) return { output, moved: null };
    return { output: there, moved: I.managedResultMove(from, managed) };
  }

  const PREFLIGHT_RECHECK = 'Build still runs, and the build checks this again.';

  /**
   * Route 1: set generate_genie_code_instruction = 'Yes' for selected UC ids, then submit
   * notebook job with 15_operation = Generate Use Cases and 14_session_id = session.
   */
  const genieJobGuard = createGenieJobGuard();

  // REQ-409: the token of a control call. A build's run and an installed job are read or cancelled with the installed-run rule; any other
  // asset keeps the person's token.
  async function controlTokenOf(req, ctx, asset, id) {
    if (asset === 'build') return req.dbToken;
    if (asset === 'job') return req.dbToken;
    return req.dbToken;
  }

  // The session's Genie notebook run: the job named for the session, read with the App's service principal (REQ-418).
  async function latestGenieRunOf(req, sessionId) {
    return latestGenieNotebookRun((path) => jsonOf(dbFetch, req.dbHost, req.dbToken, path), sessionId);
  }

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
          error: USE_CASE_ID_SHAPE,
        });
      }

      const parsedDb = splitInspireDatabase(inspire_database);
      if (!parsedDb) {
        return res.status(400).json({ error: INSPIRE_DB_SHAPE });
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
        return res.status(404).json({ error: noSessionText(sidStr) });
      }

      const params = notebookParamsFromSessionForGenerateRun(session, sidStr);
      if (!params['02_inspire_database']) {
        params['02_inspire_database'] = inspire_database.trim();
      }
      if (!params['01_uc_metadata']) {
        return res.status(400).json({
          error:
            'This run has no saved data sources, so Inspire cannot rebuild it. Start a new run from Start to get them.',
        });
      }
      const refused = await U.runReadRefusal(dbFetch, req, { tables: await useCasesTables(req, warehouse_id, catalog, schema, sidStr, safeIds) });
      if (refused) return PM_ERROR.sendFailure(res, refused.status, refused.message, { unreadable: refused.unreadable });

      const lastRun = await latestGenieRunOf(req, sidStr);
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
          asker: req,
          jobName: genieNotebookJobName(sidStr),
          useCaseIds: safeIds,
          useCaseName: safeIds.length === 1 ? await regenUseCaseName(req, warehouse_id, catalog, schema, sidStr, safeIds[0]) : '',
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
      PM_ERROR.sendFailure(res, code, err.message);
    }
  }

  app.post('/api/inspire/generate-genie', requireToken, handleInspireGenerateGenie);
  app.post('/api/inspire/generate_genie', requireToken, handleInspireGenerateGenie);

  app.use('/api/inspire/implement', (req, res, next) => runWithQueryTags({
    dbx_inspire_ai_usecase_id: q(req, 'use_case_id'),
    dbx_inspire_ai_session_id: q(req, 'session_id'),
    dbx_inspire_ai_app_name: q(req, 'app_name'),
    dbx_inspire_ai_asset: q(req, 'asset'),
  }, next));

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
      const ownSchema = latest ? null : await useCaseSchemaOf(req, warehouseId, `${catalog}.${schema}`, sid, useCaseId, session.business_name);
      const { missing, app_unreadable: appUnreadable, policied } = await sourceVerdict(req, warehouseId, useCase, latest, q(req, 'result_table') || ownSchema?.table || '');
      const widgets = I.implementWidgets(history, useCase.genie_instruction || useCase.generate_genie_code_instruction || '');
      const assets = I.liveCarriedAssets(history);
      const goneAssets = await goneMergeAssets(req, assets);
      const family = I.executionFamily(useCase.code_structure_mandate);
      res.json({
        session_id: sid,
        use_case: useCase,
        discovery_type: canonicalDiscoveryType(session.discovery_type),
        table_scope: parseTableScopeText(session.table_scope).scopes,
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
        // REQ-418: the source tables with a row filter or column mask; only these show the per-user identity choice in the build wizard.
        app_policy_tables: policied,
        app_unreadable: displayOffer(appUnreadable, await wholeCatalogsOf(req, warehouseId, catalog, schema, sid)),
        own_schema: ownSchema,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function useCaseSchemaRows(req, warehouseId, catalog, schemas) {
    const person = req.dbToken;
    if (!person) return { rows: null, unchecked: '' };
    try {
      return { rows: await sqlRows(req.dbHost, person, warehouseId, I.useCaseSchemaStatement(catalog, schemas)), unchecked: '' };
    } catch (err) {
      return { rows: null, unchecked: String((err && err.message) || err).slice(0, 200) };
    }
  }

  async function createsUseCaseSchema(req, warehouseId, table, useCaseId) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const sid = sessionIdOf(req);
    const session = await loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid);
    const own = I.useCaseOwnSchemas(`${catalog}.${schema}`, useCaseId, sid, session.business_name);
    const asked = I.tableParts(table);
    if (!own.includes(`${asked.catalog}.${asked.schema}`.toLowerCase())) return false;
    const { rows } = await useCaseSchemaRows(req, warehouseId, catalog, [asked.schema]);
    return Boolean(rows) && I.useCaseSchemaFacts(rows).canCreate;
  }

  async function useCaseSchemaOf(req, warehouseId, inspireDatabase, sid, useCaseId, businessName) {
    let names;
    try {
      names = I.useCaseSchemaCandidates(inspireDatabase, useCaseId, sid, businessName);
    } catch {
      return null;
    }
    if (!names[0]) return null;
    const { rows, unchecked } = await useCaseSchemaRows(req, warehouseId, I.tableParts(names[0]).catalog, names.map((t) => I.tableParts(t).schema));
    return I.useCaseSchemaPlace({ inspireDatabase, useCaseId, sessionId: sid, businessName, rows, unchecked });
  }

  app.get('/api/inspire/implement/history', requireToken, async (req, res) => {
    try {
      const sid = sessionIdOf(req);
      const warehouseId = warehouseOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = q(req, 'use_case_id');
      const history = await loadHistory(
        req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId ? I.validateUseCaseId(useCaseId) : null,
      );
      const versionsByUc = {};
      for (const row of history) (versionsByUc[row.use_case_id] || (versionsByUc[row.use_case_id] = [])).push(row);
      const latest = Object.values(versionsByUc).map((rows) => {
        const live = I.liveBuiltRow(rows);
        return Object.assign(rows[0], { live_version: live ? live.spec_version : null, live_spec_json: live ? live.spec_json : null });
      });
      // REQ-323: the Jobs API reads run at most HISTORY_ROW_CONCURRENCY at a time; the run summary is one warehouse statement for all rows.
      const [notebook] = await Promise.all([
        latestGenieRunOf(req, sid).then((run) => ({ run, error: '' }), (err) => ({ run: null, error: err.message })),
        mapLimit(latest, HISTORY_ROW_CONCURRENCY, async (row) => { row.stalled = await stalledOf(req, row); }),
        latestRunsOf(req, warehouseId, latest, (id) => versionsByUc[id]),
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
      if (!parsed) throw I.badRequest(INSPIRE_DB_SHAPE);
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
    if (!catalog.ok) return PM_ERROR.sendFailure(res, 503, catalog.error);
    return res.json(catalog);
  });

  app.get('/api/inspire/implement/lakebase', requireToken, async (req, res) => {
    const catalog = appShellCatalog();
    if (!catalog.ok) return PM_ERROR.sendFailure(res, 503, catalog.error);
    let got;
    try {
      got = await fetchJsonFor(req)(C.LAKEBASE_PROBE_PATH);
    } catch (err) {
      got = { ok: false, status: 0, data: { message: err.message } };
    }
    const tables = String(q(req, 'tables') || '').split(',').map((t) => t.trim()).filter((t) => /^[^`.\s]+\.[^`.\s]+\.[^`.\s]+$/.test(t));
    const enforce = await LE.tablesEnforcement(tables.slice(0, LAKEBASE_ENFORCE_TABLES), fetchJsonFor(req));
    return res.json({ ...C.lakebaseOffer(got, catalog.backends), enforce });
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
      await refuseMetricView(req, warehouseId, table, { unknownType: true });
      const statement = I.columnsStatement(table);
      const token = appReadToken(req);
      const [rows, read, keyRows] = await I.readPickedTable(table, () => Promise.all([sqlRows(req.dbHost, token, warehouseId, statement),
        readColumnTags(req, token, warehouseId, [table]), sqlRows(req.dbHost, token, warehouseId, I.primaryKeysStatement(table))]));
      if (!rows.length) throw I.unreadableTableError(table);
      const prefix = String(table).replace(/`/g, '').toLowerCase();
      const columns = rows.map((c) => {
        const tags = read.tags[`${prefix}.${String(c.column_name).toLowerCase()}`] || {};
        return { ...c, tags, personal: personalColumn(c.column_name, tags) };
      });
      res.json({ table, columns, primary_keys: keyRows.map((r) => String(r.column_name)), tags_read: !read.error, ...(read.error ? { tags_note: TAGS_UNREAD_NOTE } : {}) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // The relationships of one picked table (REQ-362, REQ-370): its declared keys in both directions, and the name matches across the
  // picked scope (one information_schema.columns query per catalog of the scope). A metric view is named back and read no further.
  app.post('/api/relationships', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = RL.pickedTableOf(req.body?.table);
      const scope = RL.pickedTablesOf(req.body?.tables || []);
      if (!scope.some((t) => t.toLowerCase() === table.toLowerCase())) scope.push(table);
      const token = appReadToken(req);
      const looked = await tableTypeOf(req, () => token, warehouseId, table);
      if (MV.isMetricViewType(looked.type)) return res.json({ tables: {}, suggestions: [], metric_views: [table] });
      const byCatalog = new Map();
      for (const name of scope) {
        const catalog = name.split('.')[0];
        byCatalog.set(catalog, [...(byCatalog.get(catalog) || []), name]);
      }
      const catalogs = [...byCatalog.keys()];
      const reads = await I.readPickedTable(table, () => Promise.all([
        Promise.all(catalogs.map((catalog) => sqlRows(req.dbHost, token, warehouseId, RL.scopeColumnsStatement(catalog, byCatalog.get(catalog))))),
        Promise.all(catalogs.map((catalog) => sqlRows(req.dbHost, token, warehouseId, RL.scopeKeysStatement(catalog, byCatalog.get(catalog))))),
        sqlRows(req.dbHost, token, warehouseId, RL.declaredKeysStatement(table)),
        sqlRows(req.dbHost, token, warehouseId, RL.declaredIntoStatement(table)),
      ]));
      const [catalogRows, keyRows, declared, into] = reads;
      const columns = catalogRows.flatMap((rows, i) => rows.map((r) => ({
        table: `${catalogs[i]}.${r.table_schema}.${r.table_name}`, column_name: r.column_name,
      })));
      const keys = keyRows.flatMap((rows, i) => rows.filter((r) => r.table_schema).map((r) => ({
        table: `${catalogs[i]}.${r.table_schema}.${r.table_name}`, column_name: r.column_name,
      })));
      if (!columns.some((c) => c.table.toLowerCase() === table.toLowerCase())) throw I.unreadableTableError(table);
      // The other table of a link the dialog is making: its columns are sent first, so the answer can always pair them.
      const focus = Array.isArray(req.body?.focus) ? RL.pickedTablesOf(req.body.focus) : [];
      res.json({ ...RL.relationshipsOfTable(table, { columns, keys, declared, into, focus }), metric_views: [] });
    } catch (err) {
      sendError(res, err);
    }
  });

  // The Data Management column search (REQ-370): one information_schema.columns query per catalog of the picked scope, metric views
  // left out, at most COLUMN_SEARCH_LIMIT hits. An empty search reads nothing.
  app.post('/api/data-management/columns', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const q = DM.queryOf(req.body?.q);
      if (!q) return res.json({ hits: [], total: 0, shown: 0, limit: DM.COLUMN_SEARCH_LIMIT });
      const token = appReadToken(req);
      const statements = DM.columnSearchStatements(req.body?.scope || {}, q);
      const parts = await Promise.all(statements.map(async ({ catalog, statement }) => ({
        catalog, rows: await sqlRows(req.dbHost, token, warehouseId, statement),
      })));
      const { hits, total } = DM.mergeColumnHits(parts);
      res.json({ hits, total, shown: hits.length, limit: DM.COLUMN_SEARCH_LIMIT });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/swaps', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      const required = Array.isArray(req.body?.required_columns) ? req.body.required_columns : [];
      const copyOnly = q(req, 'part') === 'copy';
      const statement = copyOnly ? I.copySwapStatement(table) : I.tableSwapStatement(table, required);
      const token = req.dbToken;
      if (!token) return res.json({ table, swaps: [], why: I.IMPLEMENT_SWAPS_NO_SIGN_IN });
      const search = (async () => {
        const candidates = await sqlRows(req.dbHost, token, warehouseId, statement);
        // A metric view is never a swap: its type is read per candidate and a view is dropped before the probe. A candidate
        // whose type cannot be read is not offered (fail closed): it is listed as not usable, with the plain reason.
        const looked = await Promise.all(candidates.map((r) => tableTypeOf(req, () => token, warehouseId, candidateOf(r))));
        const rows = candidates.filter((_r, i) => looked[i].type && !MV.isMetricViewType(looked[i].type));
        const unusable = copyOnly ? [] : candidates.filter((_r, i) => !looked[i].type && !looked[i].transient)
          .map((r) => ({ table: candidateOf(r), reason: MV.UNUSABLE_REASON }));
        // A type check the workspace could not answer twice is neither a swap nor unusable: it is listed busy, to check again.
        const busy = copyOnly ? [] : candidates.filter((_r, i) => !looked[i].type && looked[i].transient)
          .map((r) => ({ table: candidateOf(r), reason: MV.TYPE_CHECK_BUSY_REASON }));
        const readable = await Promise.all(rows.map((r) => sqlRows(req.dbHost, token, warehouseId, I.tableProbeStatement(candidateOf(r)))
          .then(() => true, () => false)));
        const copies = I.builtInSampleTable(table);
        const swaps = rows.filter((_r, i) => readable[i]).map((r) => {
          const matched = Number(r.matched) || 0;
          const total = Number(r.total) || 0;
          const copy = copies && Boolean(Number(r.owned)) && total > 0 && matched === total;
          return { table: candidateOf(r), matched, total, copy };
        });
        return { swaps: copyOnly ? swaps.filter((s) => s.copy) : swaps, unusable, busy };
      })();
      const timer = new Promise((resolve) => { setTimeout(() => resolve(null), SWAP_SEARCH_LIMIT_MS).unref(); });
      const found = await Promise.race([search, timer]);
      if (found === null) return res.json({ table, swaps: [], why: I.IMPLEMENT_SWAPS_TOO_SLOW });
      const swaps = found.swaps;
      return res.json({ table, swaps: [...swaps.filter((s) => s.copy), ...swaps.filter((s) => !s.copy)],
        ...(found.unusable.length ? { unusable: found.unusable } : {}), ...(found.busy.length ? { busy: found.busy } : {}), why: '' });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/table-lookup', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      const source = q(req, 'source');
      const token = appReadToken(req);
      const { type, transient, denied } = await tableTypeOf(req, () => token, warehouseId, table);
      if (denied) throw denied;
      if (MV.isMetricViewType(type)) {
        return res.json({ table, readable: false, reason: MV.metricViewRefusal(table) });
      }
      // A busy type check is a retryable 503 with the plain line, never "not usable".
      if (!type && transient) return res.status(503).json({ error: MV.typeCheckBusyRefusal(table) });
      if (!type) return res.json({ table, readable: false, reason: MV.unknownTypeRefusal(table) });
      try {
        await sqlRows(req.dbHost, token, warehouseId, I.tableProbeStatement(table));
      } catch (err) {
        // REQ-418: the table is checked as the App, which reads every source, so the refusal names the App's read.
        const reason = I.tableAccessReason(table, err && err.message) || 'Inspire cannot read this table as the App';
        return res.json({ table, readable: false, reason: `The App can't read ${table}: ${reason}. Pick a table the App can read` });
      }
      const [row] = await sqlRows(req.dbHost, token, warehouseId, I.tableMatchStatement(source, table));
      return res.json({ table, readable: true, matched: Number(row?.matched) || 0, total: Number(row?.total) || 0 });
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
      await refuseMetricView(req, warehouseId, table, { unknownType: true });
      const statement = I.columnValuesStatement(table, q(req, 'column'), q(req, 'limit') || 200);
      const rows = await sqlRows(req.dbHost, appReadToken(req), warehouseId, statement);
      res.json({ values: rows.map((r) => r.value).filter((v) => v != null && v !== '') });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/readiness', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const table = q(req, 'table');
      await refuseMetricView(req, warehouseId, table, { unknownType: true });
      const window = req.body?.window || {};
      // A forecast (family E) is measured in periods, so its date column is counted too; the wizard's refusal reads period_count.
      const periodColumn = I.analysisFamilyOf(req.body?.technique) === 'E' ? String(window.column || '').trim() : '';
      const statement = I.readinessStatement(table, {
        columns: req.body?.columns || [],
        filters: req.body?.filters || [],
        window,
        periodColumn,
      });
      const rows = await sqlRows(req.dbHost, appReadToken(req), warehouseId, statement);
      res.json({ skipped: false, ...I.readinessFromRow(rows[0] || {}, statement.columns), minimum_rows: I.analysisMinimumRows(req.body?.technique) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/group-counts', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const top = Number(req.body?.top) || 0;
      if (top && (!Number.isInteger(top) || top > GR.GROUP_MAX_GROUPS)) {
        return res.status(400).json({ error: `top must be a whole number up to ${GR.GROUP_MAX_GROUPS}` });
      }
      await refuseMetricView(req, warehouseId, q(req, 'table'), { unknownType: true });
      const statement = I.groupCountsStatement(q(req, 'table'), req.body?.columns || [], {
        filters: req.body?.filters || [],
        window: req.body?.window || {},
        top,
      });
      if (!statement) return res.status(400).json({ error: top ? 'name one group column to list its values' : `name between 1 and ${I.GROUP_COUNT_MAX_COLUMNS} group columns to count` });
      const token = appReadToken(req);
      const rows = await sqlRows(req.dbHost, token, warehouseId, statement);
      const cap = top || I.GROUP_COUNT_LIMIT;
      const truncated = rows.length > cap;
      const kept = truncated ? rows.slice(0, cap) : rows;
      // REQ-380: an empty list says why, from one count under the same filters (only when the list is empty).
      let reason = '';
      if (!rows.length) {
        const column = String((req.body?.columns || [])[0] ?? '').trim();
        const counted = await sqlRows(req.dbHost, token, warehouseId, I.groupReasonStatement(q(req, 'table'), column, {
          filters: req.body?.filters || [], window: req.body?.window || {},
        }));
        reason = I.groupEmptyReason(counted[0], column);
      }
      res.json({ truncated, reason, groups: kept.map((r) => ({ ...r, records: Number(r.records) || 0 })) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/serving-endpoints', requireToken, async (req, res) => {
    try {
      const got = await jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.0/serving-endpoints');
      if (!got.ok) return PM_ERROR.sendFailure(res, got.status, got.data.message || got.data.error || 'serving endpoints are not available');
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
      const held = await movedResultTable(req, warehouseId, useCaseId, q(req, 'table'));
      const checked = await checkManagedOutput(req, warehouseId, held ? held.to : q(req, 'table'), useCaseId, true, {}, q(req, 'table'));
      const moved = checked.moved || held;
      res.json(moved ? { ...checked.output, result_table_moved: moved } : checked.output);
    } catch (err) {
      sendError(res, err);
    }
  });

  // REQ-408: the picked whole catalogs of this request's run, for the App read offers the build raises (empty without a readable scope).
  async function buildScopeOf(req, warehouseId) {
    try {
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      return { wholeCatalogs: await wholeCatalogsOf(req, warehouseId, catalog, schema, sessionIdOf(req)) };
    } catch {
      return {};
    }
  }

  async function sourceVerdict(req, warehouseId, useCase, latest, resultTable = '') {
    const spec = latest && latest.spec_json;
    const withOutput = I.withResultTable(spec || {}, resultTable || (spec && spec.config && spec.config.result_table) || '');
    return sourceAccess(req, warehouseId, I.checkedSourceTables(withOutput, I.useCaseTables(useCase || {})), 'build', await buildScopeOf(req, warehouseId));
  }

  const NO_READS = { refusal: null, skipped: [], uncheckedWarnings: [] };

  async function sourceCheckOf(req, warehouseId, useCase, spec, history) {
    if (!sourcesReadBy(spec, history)) return { refusal: null, reads: NO_READS, app_unreadable: null };
    // REQ-324: the App's probes and the person's read plan are independent, so they run together.
    const tables = I.sourceTables(spec, I.useCaseTables(useCase));
    const scope = await buildScopeOf(req, warehouseId);
    const [sourced, reads] = await Promise.all([sourceAccess(req, warehouseId, tables, 'build', scope), U.runReadPlan(dbFetch, req, { tables })]);
    const blocking = I.blockingMissingTables(sourced.missing, spec, useCase);
    const refusal = sourced.app_unreadable
      ? Object.assign(I.badRequest(sourced.app_unreadable.text, 409), { details: { missing_tables: sourced.missing, app_unreadable: sourced.app_unreadable } })
      : blocking.length
        ? Object.assign(I.badRequest(I.missingTablesMessage(blocking), 409), { details: { missing_tables: blocking, app_unreadable: null } })
        : unreadableOf(spec, useCase, reads);
    return { refusal, reads, app_unreadable: sourced.app_unreadable || null };
  }

  function sourcesReadBy(spec, history) {
    let refills = true;
    try {
      refills = I.planSubmission(history, spec, true).summary.refill;
    } catch {
      refills = true;
    }
    return refills || ['genie_space', 'app', 'alert'].some((name) => spec?.outputs?.[name] === true) || !I.previousBuilt(history);
  }

  function unreadableOf(spec, useCase, reads) {
    if (reads.refusal) return unreadableRefusal(reads.refusal.message, reads.refusal.status, reads.refusal.unreadable);
    const gone = new Set(reads.skipped.map((t) => t.toLowerCase()));
    const picks = I.sourcePicks(spec, I.useCaseTables(useCase)).filter((p) => gone.has(p.chosen.toLowerCase()));
    const main = picks.find((p) => p.original.toLowerCase() === I.primaryTableOf(useCase).toLowerCase());
    return main ? unreadableRefusal(`${U.runUnreadableTablesText([main.chosen])}. It is the primary table, so Inspire cannot build without it.`, 403, [main.chosen]) : null;
  }

  async function preflightOf(req, res) {
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
      // REQ-324: the output check and the use case and build record reads do not depend on each other, so they run together.
      const outputStage = (async () => {
        try {
          const viewed = [wantsDashboard && 'the dashboard', wantsGenie && 'the Genie Agent'];
          const held = await movedResultTable(req, warehouseId, useCaseId, resultTable);
          const checked = await checkManagedOutput(req, warehouseId, held ? held.to : resultTable, useCaseId, Boolean(appName || mergeApp),
            { principals, warehouseName, viewed, appWarehouse }, resultTable);
          return { output: checked.output, outputError: '', moved: checked.moved || held };
        } catch (err) {
          return { output: null, outputError: err.message || String(err), moved: null };
        }
      })();
      const [{ output, outputError, moved }, useCaseNow, historyNow] = await Promise.all([
        outputStage,
        loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
      ]);
      const outputDetail = output && (output.write.ok ? `${output.write.detail}; ${output.safety.detail}` : output.write.detail);
      const denied = !output && I.isReadDenied(outputError);
      const unchecked = denied
        ? { ok: false, detail: 'not checked, because the warehouse could not run the access check' }
        : { ok: true, detail: 'not checked yet', warn: PREFLIGHT_RECHECK };
      const checks = {
        warehouse: output
          ? { ok: true, detail: `${warehouseName} ran the access check for you` }
          : { ok: !denied, detail: `${warehouseName} could not run a statement for you: ${outputError}`, ...(denied ? {} : { warn: PREFLIGHT_RECHECK }) },
        output: output
          ? { ok: output.write.ok && output.safety.ok, ...(output.safety.warn ? { warn: true } : {}), detail: moved ? `${moved.detail}; ${outputDetail}` : outputDetail }
          : unchecked,
      };
      if (output && output.model) checks.model = output.model;
      const sent = req.body?.spec && typeof req.body.spec === 'object' ? req.body.spec : ((historyNow[0] && historyNow[0].spec_json) || {});
      const checkSpec = I.withResultTable(sent, moved ? moved.to : (resultTable || (sent.config && sent.config.result_table) || ''));
      const verdict = await sourceCheckOf(req, warehouseId, useCaseNow, checkSpec, historyNow);
      // REQ-131, REQ-260: the detail is plain words; the GRANT statements ride the check's Permission Required entry (BuildNext raises it)
      const sourcePermission = verdict.refusal?.details?.app_unreadable?.permissions?.[0];
      checks.sources = verdict.refusal
        ? { ok: false, detail: verdict.refusal.message, ...(verdict.refusal.details?.missing_tables ? { missing: true } : {}),
          ...(sourcePermission ? { permission: sourcePermission } : {}) }
        : { ok: true, detail: 'the App can read every source of this use case' };
      if (shares) checks.result_grant = I.shareCheck(output ? output.grant : null);
      if (appName) {
        const name = I.appNameCheck(appName, existingApp && existingApp.ok ? existingApp.data : null, { useCaseId, sessionId: sid });
        if (!name.ok) {
          const free = await freeAppName(dbFetch, req.dbHost, req.dbToken, appName);
          if (free) Object.assign(name, { name: appName, suggested: free });
        }
        checks.app_name = name;
        if (name.creates) checks.app_access = output ? output.app : unchecked;
        const swaps = !name.creates && I.appWarehouseMoves(existingApp && existingApp.ok ? existingApp.data : null, appWarehouse || warehouseId);
        if ((name.creates && appWarehouse && appWarehouse !== warehouseId) || swaps) {
          checks.app_warehouse = output ? output.app_warehouse : unchecked;
        }
        if (!features.apps) checks.apps = { ok: false, detail: 'this workspace cannot create Databricks Apps' };
        else checks.apps = I.appsRoomCheck(name.creates);
      } else if (mergeApp) {
        checks.app_access = output ? output.app : unchecked;
      }
      checks.genie_code = GC.genieCodeLine(features.genie_code);
      if (wantsGenie) {
        checks.genie_spaces = { ok: features.genie_spaces, detail: features.genie_spaces ? 'the App can create Genie Agents' : 'the App cannot create Genie Agents in this workspace' };
      }
      if (wantsAlert) {
        checks.alerts = { ok: features.alerts, detail: features.alerts ? 'the App can create SQL alerts' : 'the App cannot create SQL alerts in this workspace' };
      }
      res.json({
        ok: Object.values(checks).every((c) => c.ok),
        // The App's principal is the identity a build runs as; a service principal has no user name, so the label falls back to the App's name.
        identity: (output && output.identity) || builderLabelOf(await loadBuilderPrincipal(req)) || P.principalOf(principal).username,
        checks,
        ...(appName || mergeApp ? {} : { new_app: output ? output.app : unchecked }),
        features,
        ...(moved ? { result_table_moved: moved } : {}),
        app_unreadable: displayOffer(verdict.app_unreadable),
      });
    } catch (err) {
      sendError(res, err);
    }
  }
  app.get('/api/inspire/implement/preflight', requireToken, preflightOf);
  app.post('/api/inspire/implement/preflight', requireToken, preflightOf);

  app.get('/api/inspire/implement/destinations', requireToken, async (req, res) => {
    try {
      const destinations = [];
      let pageToken = '';
      for (let page = 0; page < 10; page += 1) {
        const got = await jsonOf(dbFetch, req.dbHost, req.dbToken,
          `/api/2.0/notification-destinations?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`);
        if (!got.ok) {
          return PM_ERROR.sendFailure(res, got.status, got.data.message || got.data.error || 'notification destinations are not available');
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

  async function refuseMissingSources(req, warehouseId, spec, useCase) {
    const verdict = await sourceCheckOf(req, warehouseId, useCase, spec, []);
    if (verdict.refusal) throw verdict.refusal;
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

  app.post('/api/inspire/implement/grant-access', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const kind = q(req, 'kind');
      if (!I.IMPLEMENT_GRANT_KINDS.includes(kind)) throw I.badRequest(`kind must be one of ${I.IMPLEMENT_GRANT_KINDS.join(', ')}`);
      // REQ-418: a grant is the signed-in person's own act (their GRANT right), so it runs with their sign-in, never the App's token.
      const token = P.forwardedTokenOf(req);
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
      // A request made for one use case grants only that use case's own source tables (its saved involved tables, and the swaps its
      // build chose). A request with no use case, such as the Build page's own protections, is unchanged.
      if (q(req, 'use_case_id')) await requireBuildSources(req, warehouseId, tables, req.body && req.body.spec ? (await askedSpec(req)).asked : null);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const wholeCatalogs = await wholeCatalogsOf(req, warehouseId, catalog, schema, sessionIdOf(req));
      return res.json({ kind, ...(await grantSourceAccess(req, token, warehouseId, tables, 'build', { wholeCatalogs })) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // REQ-408: a copyable grant list is shaped for display at schema level (catalog level for a whole-catalog pick). Grant still runs the exact
  // statements the route derived; this only changes the copy text the response carries.
  function displayOffer(offer, wholeCatalogs = []) {
    return offer && Array.isArray(offer.grants) ? { ...offer, grants: coarseGrants(offer.grants, { wholeCatalogs }) } : offer;
  }

  // REQ-408: the catalogs the run picked whole (its saved launch scope). Empty when the run has no readable scope, so the dialog asks per schema.
  async function wholeCatalogsOf(req, warehouseId, catalog, schema, sid) {
    try {
      const session = await loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid);
      return U.ucMetadataParts(notebookParamsFromSessionForGenerateRun(session, sid)['01_uc_metadata']).catalogs;
    } catch {
      return [];
    }
  }

  function appReadsPermissions(left, record, principals, app, wholeCatalogs = []) {
    if (record.objects) {
      // REQ-300: one plain reason per grantee; the dialog says the copy line once, so no entry repeats an ask.
      const granted = (principals || []).map((p) => {
        const statements = left.flatMap((t) => t.grants.filter((g) => I.appReadGrantFor(g, p)));
        return PM.permissionRequired({ statements, principal: p, exact: true, why: I.opensAppSentence(p, record.app_name || '') });
      }).filter(Boolean);
      // A user-authorization App reads a source table directly: its viewers get the App's views, never the raw table. The App must be
      // rebuilt to read through a view; nothing here is a grant to run, so the sentence is a plain step and never copied (REQ-300, REQ-301).
      const direct = record.mode === 'user' && (record.sources || []).length ? record.sources : [];
      const rebuild = direct.length ? [PM.permissionRequired({ principal: record.app_name || '', instructions: [
        `The App ${record.app_name || ''} reads ${direct.join(', ')} directly, so its viewers cannot see that data. `
        + 'A rebuild reads them through the App views.'] })] : [];
      return [...granted, ...rebuild].filter(Boolean);
    }
    // The same statements the card and Check again show: the live plan's grants, never a second list.
    const statements = [...new Set(left.flatMap((t) => t.grants))];
    const name = app?.name || record.app_name || '';
    const permission = PM.permissionRequired({ statements, principal: name || app?.id || record.app, wholeCatalogs,
      why: `The App ${name} cannot read ${left.map((t) => t.table).join(', ')}, so the build cannot show that data.`.replace('App  ', 'App ') });
    return permission ? [permission] : [];
  }

  app.post('/api/inspire/implement/app-reads', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = sessionIdOf(req);
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      const action = String((req.body && req.body.action) ?? 'check');
      if (!['check', 'grant'].includes(action)) throw I.badRequest('action must be check or grant');
      const record = I.appReadsRecord(await appRecordOf(req, warehouseId, catalog, schema, sid, useCaseId));
      if (!record) return res.json({ state: 'readable', tables: [], ran: [], failed: [], text: I.appReadsText([], '') });
      const { left, ran, failed, principals, app } = await appReads(req, warehouseId, record, action === 'grant');
      const was = record.tables.map((t) => `${t.table}:${t.owner}:${t.grants.join(';')}`).join('|');
      const now = left.map((t) => `${t.table}:${t.owner}:${t.grants.join(';')}`).join('|');
      // A Check only reads: the stored unread list changes on a grant, never on a check.
      if (action === 'grant' && was !== now && !record.objects) {
        const update = I.appReadsUpdateStatement(I.implementTableName(catalog, schema), record.row, left);
        await executeSql(req.dbHost, req.dbToken, warehouseId, update.sql, update.parameters);
      }
      // The App's name is the record's: the identity read for the App's service principal is named by the platform, not the App.
      const liveApp = app ? { id: app.id, name: record.app_name || app.name } : { id: record.app, name: record.app_name };
      // A Check shows what the App still needs, with its SQL, to anyone who can see the record: the person who cannot grant hands it
      // to the owner (REQ-042). Only a Grant changes access, and the route policy owns that rule.
      const wholeCatalogs = await wholeCatalogsOf(req, warehouseId, catalog, schema, sid);
      res.json({ state: left.length ? 'unreadable' : 'readable', app: liveApp.id, app_name: liveApp.name, mode: record.mode || '', objects: !!record.objects, principals,
        tables: left.map((t) => ({ ...t, grants: coarseGrants(t.grants, { wholeCatalogs }) })), ran, failed, refused: action === 'grant' && failed.length > 0, text: I.appReadsText(left, liveApp.name, failed),
        permissions: appReadsPermissions(left, record, principals, liveApp, wholeCatalogs) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/inspire/implement/create-schema', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const token = req.dbToken;
      if (!token) throw I.badRequest(I.IMPLEMENT_GRANT_NO_SIGN_IN, 401);
      const catalog = String((req.body && req.body.catalog) ?? '').trim();
      const schema = String((req.body && req.body.schema) ?? '').trim();
      const bad = G.placeNameProblem(catalog, 'catalog') || (schema ? G.placeNameProblem(schema, 'schema') : '');
      if (bad) throw I.badRequest(bad);
      const tags = schema && req.body && req.body.tags && typeof req.body.tags === 'object' ? req.body.tags : null;
      let found = {};
      if (tags) {
        const { rows } = await useCaseSchemaRows(req, warehouseId, catalog, [schema]);
        found = I.useCaseSchemaFacts(rows).schemas[schema.toLowerCase()] || {};
        const who = { inspireDatabase: dbOf(req, splitInspireDatabase).inspire_database, useCaseId: String(tags.inspire_use_case_id ?? '').trim() };
        const held = I.useCaseSchemaOwner(found, { ...who, sessionId: String(tags.inspire_session_id ?? '').trim() });
        if (held === 'foreign') throw I.badRequest(ownSchemaClashNote(schema, found, '', who), 409);
        // REQ-478: an earlier install's schema Inspire holds no right on is never reused: the Results step picks the next own schema
        if (held === 'stranded') throw I.badRequest(I.ownSchemaStrandedNote(schema, ''), 409);
      }
      const ensure = I.useCaseSchemaEnsure(found, tags);
      if (ensure.create) await executeSql(req.dbHost, token, warehouseId, G.createPlaceSql(catalog, schema));
      if (!tags) return res.json({ catalog, schema });
      const warnings = [];
      const permissions = [];
      // REQ-418 (ruling 3): the App creates the schema; the signed-in person is recorded as its requester in Inspire's own control log.
      const sid = String(tags.inspire_session_id ?? '').trim();
      const useCaseId = String(tags.inspire_use_case_id ?? '').trim();
      // Recorded only when the App creates the schema now; an existing schema was created by an earlier run, and the log says so.
      if (ensure.create && isInt64Id(sid) && I.IMPLEMENT_USE_CASE_ID_RE.test(useCaseId)) {
        const requester = (await personOf(req)).username || '';
        const { catalog: inspireCatalog, schema: inspireSchema } = dbOf(req, splitInspireDatabase);
        const logTable = C.controlLogTableName(inspireCatalog, inspireSchema);
        try {
          await executeSql(req.dbHost, token, warehouseId, C.controlLogCreateSql(logTable));
          const row = C.controlLogInsert(logTable, { sessionId: sid, useCaseId, asset: 'schema', assetId: `${catalog}.${schema}`, action: 'create',
            result: 'done', message: `Schema ${catalog}.${schema} created by the App, requested by ${requester || 'no signed-in person'}`, actedBy: requester });
          await executeSql(req.dbHost, token, warehouseId, row.sql, row.parameters);
        } catch (err) {
          warnings.push(`Inspire could not record who requested ${catalog}.${schema}: ${String((err && err.message) || err).slice(0, 200)}`);
        }
      }
      const tagged = ensure.tag ? I.useCaseSchemaTagsSql(catalog, schema, tags) : '';
      if (tagged) {
        await executeSql(req.dbHost, token, warehouseId, tagged)
          .catch((err) => warnings.push(`Inspire could not tag ${catalog}.${schema}: ${String((err && err.message) || err).slice(0, 200)}`));
      }
      {
        // REQ-418: the build runs as the App's service principal, which is the identity the use case schema is granted to.
        const builder = await loadBuilderPrincipal(req);
        const grant = I.useCaseSchemaBuilderGrant(catalog, schema, builder.applicationId || builder.userName);
        const { failed } = grant ? await runPersonGrants(req, token, warehouseId, [grant]) : { failed: ['the identity Inspire builds as could not be read'] };
        if (failed.length) {
          warnings.push(`The identity Inspire builds as may not write to ${catalog}.${schema} until your data owner grants `
            + `${I.USE_CASE_SCHEMA_BUILDER_PRIVILEGES} on it: ${failed.join('; ')}`);
          if (grant) permissions.push(PM.builderPermission(catalog, grant, builder.applicationId || builder.userName));
        }
      }
      res.json({ catalog, schema, warnings, existed: Boolean(found.exists), ...(permissions.length ? { permissions } : {}) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // REQ-323: the latest run of every row in one warehouse statement (I.latestRunsStatement). If one summary table is missing, the batch
  // fails, so each summary table is then read on its own: the use cases with a table that exists keep their runs.
  async function latestRunsOf(req, warehouseId, rows, historyOf) {
    for (const row of rows) if (row) row.older_build = I.olderBuildNote(historyOf(row.use_case_id), buildStamp());
    const withRuns = rows.filter((row) => row && I.runSummaryTable(row));
    if (!withRuns.length) return;
    const entries = withRuns.map((row) => ({ summaryTable: I.runSummaryTable(row), useCaseId: row.use_case_id }));
    const readRuns = async (group) => I.latestRunsFrom(await sqlRows(req.dbHost, req.dbToken, warehouseId, I.latestRunsStatement(group)));
    const missing = (err) => isMissingTableError(err) || I.isMissingColumnError(err);
    let byUseCase;
    try {
      byUseCase = await readRuns(entries);
    } catch (err) {
      if (!missing(err)) return;
      byUseCase = new Map();
      const tables = [...new Set(entries.map((entry) => entry.summaryTable))];
      for (const table of tables) {
        const group = entries.filter((entry) => entry.summaryTable === table);
        try {
          for (const [id, run] of await readRuns(group)) byUseCase.set(id, run);
        } catch (groupErr) {
          if (!missing(groupErr)) continue;
        }
      }
    }
    for (const row of withRuns) row.latest_run = byUseCase.get(String(row.use_case_id)) || I.latestRunFrom([]);
  }

  // REQ-231: who pressed Stop on this run, from the control log. A read that fails is no record, so the run reads as outside Inspire.
  async function stoppedByOf(req, row, runId) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    try {
      const select = C.controlLogSelect(C.controlLogTableName(catalog, schema), { sessionId: sessionIdOf(req), useCaseId: row.use_case_id, limit: 200 });
      return C.stoppedByRecord(await sqlRows(req.dbHost, req.dbToken, warehouseOf(req), select), { runId, jobId: row.job_id });
    } catch (err) {
      console.warn(`implement stop record read failed: ${err.message}`);
      return null;
    }
  }

  async function stalledOf(req, row) {
    if (!row || (!I.IMPLEMENT_ACTIVE_STATUSES.includes(row.status) && !I.implementEndedRecord(row))) return null;
    const runId = String(row.implement_run_id ?? '');
    const got = /^\d{1,19}$/.test(runId)
      ? await jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${runId}`).catch(() => null)
      : null;
    const runState = got && got.ok && got.data && got.data.state ? got.data.state : {};
    const stopper = String(runState.result_state || '') === 'CANCELED' ? await stoppedByOf(req, row, runId) : null;
    const stalled = I.implementStalled(row, got && got.ok ? got.data : null, Date.now(), stopper);
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const ended = I.implementRunEndedStatement(I.implementTableName(catalog, schema), { session_id: sessionIdOf(req), ...row }, stalled);
    if (!ended) return stalled;
    try {
      await executeSql(req.dbHost, req.dbToken, warehouseOf(req), ended.sql, ended.parameters);
      Object.assign(row, { status: 'failed', status_message: stalled.reason });
      return stalled;
    } catch (e) {
      console.warn(`implement ended-run write failed: ${e.message}`);
      return stalled;
    }
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
    const live = I.previousBuilt(history);
    const { spec: asked, errors } = I.validateImplementSpec(raw, { legacyAccess, impact, appExperience: live ? I.appExperienceOf(live.spec_json) : null });
    if (errors.length) throw I.badRequest(errors.join('; '));
    return { sid, warehouseId, inspire_database, catalog, schema, raw, history, legacyAccess, asked };
  }

  async function tableChangeOf(req, warehouseId, history, spec, useCase) {
    const before = I.previousBuilt(history);
    if (!before) return null;
    const previous = I.validateImplementSpec(before.spec_json, { legacyAccess: I.legacyAppAccess(history) }).spec;
    const changes = I.implementTableSwapChanges(previous.data, spec.data);
    const tables = I.uniqueTables(changes.flatMap((c) => [c.replaced, c.chosen]));
    const token = req.dbToken;
    if (tables.length && !token) throw I.badRequest(I.IMPLEMENT_TABLES_NO_SIGN_IN, 401);
    await refuseTableTypes(req, warehouseId, tables, { unknownType: true });
    const read = await Promise.all(tables.map((t) => I.readPickedTable(t, () => sqlRows(req.dbHost, token, warehouseId, I.columnsStatement(t)))));
    const unseen = tables.filter((_t, i) => !read[i].length);
    if (unseen.length) throw I.badRequest(I.implementTablesUnreadable(unseen), 409);
    const columnsOf = (name) => read[tables.findIndex((t) => t.toLowerCase() === name.toLowerCase())];
    const columns = Object.fromEntries(tables.map((t, i) => [t, read[i]]));
    const used = Object.fromEntries(changes.map((c) => [c.original, I.implementUsedColumns(useCase && useCase.data_evidence, c.original, columnsOf(c.replaced))]));
    return { before, previous, change: I.implementTableChange(previous.data, spec.data, used, columns) };
  }

  async function ownerTableChange(req, warehouseId, history, spec, useCase, person) {
    const before = I.previousBuilt(history);
    if (!before || I.implementSettingsOwnerRefusal(before, person.username) || !req.dbToken) return { change: null, error: '' };
    try {
      const got = await tableChangeOf(req, warehouseId, history, spec, useCase);
      return { change: got && got.change.class ? got.change : null, error: '' };
    } catch (err) {
      if (err && err.refusal) throw err;
      return { change: null, error: err.message || String(err) };
    }
  }

  async function prepareSubmission(req, { grant = false } = {}) {
    const { sid, warehouseId, inspire_database, catalog, schema, raw, history, legacyAccess, asked } = await askedSpec(req);
    const scopeIssues = I.firstRunScopeIssues(history, asked);
    if (scopeIssues.refused.length) throw I.badRequest(scopeIssues.refused.join('; '));
    const { spec: kept, warning: asksWarning } = withoutSkippedVibes(I.rollbackSpec(history, asked));
    const rolled = I.withVibePreviousDefault(history, kept);
    const useCaseId = I.validateUseCaseId(rolled.use_case_id);
    const moved = await movedResultTable(req, warehouseId, useCaseId, rolled.config.result_table, history);
    const chosen = moved ? I.withResultTable(rolled, moved.to) : rolled;
    const [session, useCase, person] = await Promise.all([
      loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid),
      loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
      personOf(req),
    ]);
    if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
    const problems = I.removedTableProblems(chosen, I.useCaseTables(useCase), I.primaryTableOf(useCase));
    if (problems.length) throw I.badRequest(problems.join('; '));
    const verdict = await sourceCheckOf(req, warehouseId, useCase, chosen, history);
    if (verdict.refusal) throw verdict.refusal;
    const { spec, warnings: readWarnings, details: readDetails } = await dropUnreadableSources(req, chosen, useCase, verdict.reads);
    const kpiIssues = I.implementKpiTargetProblems(raw, I.implementKpiOptions(useCase, history), history);
    if (kpiIssues.length) throw I.badRequest(kpiIssues.join('; '));
    const keyRef = I.resultKeyRef(spec, useCase);
    if (keyRef) {
      const read = req.dbToken
        ? await readColumnTags(req, req.dbToken, warehouseId, [keyRef.split('.').slice(0, 3).join('.')]) : { tags: {} };
      const personal = I.personalKeyOf(spec, useCase, read.tags);
      if (personal) throw I.badRequest(personal);
    }
    const assumptionIssues = I.implementAssumptionProblems(spec, I.implementSettingsModel(history));
    if (assumptionIssues.length) throw I.badRequest(`assumption values are out of range: ${assumptionIssues.join('; ')}`);
    const widgets = I.implementWidgets(history, useCase.genie_instruction || useCase.generate_genie_code_instruction || '');
    const widgetIssues = I.widgetProblems(widgets.widgets, spec.config.widgets);
    if (widgetIssues.length) throw I.badRequest(`widget values are out of range: ${widgetIssues.join('; ')}`);
    if (I.IMPLEMENT_MERGE_OUTPUTS.some((name) => spec.outputs.merge[name])) {
      const targets = await loadMergeTargets(req, warehouseId, catalog, schema, sid, useCaseId, spec.outputs.merge);
      const mergeIssues = I.mergeProblems(spec, targets, I.liveCarriedAssets(history));
      if (mergeIssues.length) throw I.badRequest(mergeIssues.join('; '));
    }
    if (spec?.money?.rate_table) await refuseTableTypes(req, warehouseId, [spec.money.rate_table.table], { unknownType: true });
    const [stalled, tables, empty, unsharedBefore] = await Promise.all([stalledOf(req, history[0]), ownerTableChange(req, warehouseId, history, spec, useCase, person),
      emptyDataWarning(req, warehouseId, spec, useCase, chosenTableScopes(spec.data, parseTableScopeText(session.table_scope).scopes)), newAppReads(req, warehouseId, spec, useCase)]);
    const { unshared, byYou, commit: grantByPerson } = await appReadsByPerson(req, warehouseId, unsharedBefore, grant);
    const plan = I.planSubmission(history, spec, stalled, { requester: person.username, tableChange: tables.change });
    if (moved) plan.summary.result_table_moved = moved;
    if (tables.change) plan.summary.table_change = tables.change;
    if (tables.error) plan.summary.table_change_error = tables.error;
    const appReadsWarning = I.newAppReadsWarning(unshared);
    const warnings = [asksWarning, ...readWarnings, empty, appReadsWarning, ...scopeIssues.carried.map((p) => `${I.FIRST_RUN_CARRIED}${p}.`)].filter(Boolean);
    const warningDetails = readDetails || [];
    if (byYou) plan.summary.app_reads_by_you = byYou;
    if (unshared.length) {
      plan.summary.app_reads = { tables: unshared.map(({ table, owner }) => ({ table, owner })), owners: I.appReadsOwners(unshared), text: appReadsWarning, ...I.appReadsBlock(unshared) };
    }
    return { sid, warehouseId, inspire_database, catalog, schema, spec: plan.spec, useCaseId, useCase, session, history, plan, person, warnings, warningDetails, grantByPerson };
  }

  function withoutSkippedVibes(spec) {
    const warning = skippedAsksText(spec);
    if (!warning) return { spec, warning: '' };
    const { vibe_previous: previous, ...kept } = withoutSkippedAsks(spec);
    return { spec: String(kept.vibes ?? '').trim() ? { ...kept, ...(previous ? { vibe_previous: previous } : {}) } : kept, warning };
  }

  function unreadableRefusal(message, status, unreadable) {
    const err = I.badRequest(message, status);
    err.details = { unreadable };
    return err;
  }

  async function refuseUnreadableSources(req, spec, useCase) {
    const refused = await U.runReadRefusal(dbFetch, req, { tables: I.sourceTables(spec, I.useCaseTables(useCase)) });
    if (refused) throw unreadableRefusal(refused.message, refused.status, refused.unreadable);
  }

  async function dropUnreadableSources(req, spec, useCase, reads) {
    const involved = I.useCaseTables(useCase);
    if (!reads.skipped.length) return { spec, warnings: reads.uncheckedWarnings, details: [] };
    const gone = new Set(reads.skipped.map((t) => t.toLowerCase()));
    const picks = I.sourcePicks(spec, involved).filter((p) => gone.has(p.chosen.toLowerCase()));
    let next = spec;
    const notes = [];
    for (const pick of picks) {
      const removed = removeTable(next, pick.original);
      next = removed.spec;
      const what = clearedText(removed.cleared);
      notes.push(what ? `${pick.chosen} (cleared ${what})` : pick.chosen);
    }
    return {
      spec: next,
      warnings: [`Building without ${notes.length === 1 ? 'a table' : `${notes.length} tables`} the App can't read.`, ...reads.uncheckedWarnings],
      details: [`Tables the App can't read: ${I.joinAnd(notes)}`],
    };
  }

  async function newAppReads(req, warehouseId, spec, useCase) {
    if (!spec.outputs.app || spec.outputs.app_access === 'user' || spec.uninstall) return []; // FX-69c: an uninstall never reads or grants on sources
    const tables = I.sourceTables(spec, I.useCaseTables(useCase)).filter((t) => !I.resultTableNameError(t, 'tables'));
    const token = await appTokenOf(req);
    const rows = await Promise.all(tables.map((t) => accessRowsOf(req, token, warehouseId, t)));
    return I.newAppReadsGaps(tables, tables.map((t, i) => (rows[i].length && !I.schemaNotCreated(rows[i]) ? I.accessPlan(t, rows[i]) : { gaps: [] })));
  }

  // REQ-478, REQ-469: sources the signed-in person owns or manages are shared with the new App with the person's own permissions:
  // the plan names them in one info line, and the submit grants Inspire MANAGE on them before the build starts, with no click.
  // Only a source neither Inspire nor the person can grant stays in the list that blocks the build.
  async function appReadsByPerson(req, warehouseId, unshared, grant) {
    const token = P.forwardedTokenOf(req);
    if (!unshared.length || !token) return { unshared, byYou: null };
    const rows = await Promise.all(unshared.map((t) => accessRowsOf(req, token, warehouseId, t.table).catch(() => [])));
    // FX-69c: a grant targets `me`, the identity Inspire runs as; when it is unknown the person cannot be counted on to cover the table.
    let mine = unshared.filter((t, i) => t.me && I.personCanGrant(t.gaps, rows[i]));
    const left = unshared.filter((t) => !mine.includes(t));
    // FX-69c: with grant on, the GRANT is not run here; `commit` runs it once every other check that can reject the submit has passed.
    const commit = grant ? async (plan) => {
      const { failed } = await runPersonGrants(req, token, warehouseId, I.appReadsByYou(mine).grant);
      const refused = mine.filter((t) => I.appReadsBlock([t]).grant.some((sql) => failed.some((f) => f.startsWith(`${sql}:`))));
      const done = mine.filter((t) => !refused.includes(t));
      const blocked = [...left, ...refused];
      if (done.length) plan.summary.app_reads_by_you = I.appReadsByYou(done, true);
      else delete plan.summary.app_reads_by_you;
      if (blocked.length) {
        plan.summary.app_reads = { tables: blocked.map(({ table, owner }) => ({ table, owner })), owners: I.appReadsOwners(blocked), text: I.newAppReadsWarning(blocked), ...I.appReadsBlock(blocked) };
      }
    } : null;
    return { unshared: left, byYou: mine.length ? I.appReadsByYou(mine, false) : null, commit: mine.length ? commit : null };
  }

  async function emptyDataWarning(req, warehouseId, spec, useCase, launchScopes = {}) {
    const scope = readinessScope(spec, useCase, launchScopes);
    if (!scope.table || !req.dbToken) return '';
    const countOf = async (table, narrowing) => {
      await refuseTableTypes(req, warehouseId, [table], { unknownType: true });
      const statement = I.readinessStatement(table, narrowing);
      const rows = await sqlRows(req.dbHost, req.dbToken, warehouseId, statement);
      return I.readinessFromRow(rows[0] || {}, statement.columns);
    };
    try {
      const counted = await countOf(scope.table, { columns: scope.columns, filters: scope.filters, window: scope.window });
      if (counted.row_count !== 0) return '';
      return await emptyScopeWarningOf(scope, I.sourceTables(spec, I.useCaseTables(useCase)), (table) => countOf(table, { columns: [], filters: [], window: {} }));
    } catch (err) {
      // A refusal (ours, or the warehouse's access denial) is never downgraded to a warning: it reaches the person as the Permission Required payload (REQ-313).
      if (err && (err.refusal || PM_ERROR.accessDenied(err))) throw err;
      console.warn(`implement row count failed for ${scope.table}: ${err.message || err}`);
      return `Inspire could not count the rows in ${scope.table}. The build checks the data itself.`;
    }
  }

  app.post('/api/inspire/implement/plan', requireToken, async (req, res) => {
    try {
      const { sid, warehouseId, catalog, schema, useCaseId, plan, warnings, warningDetails } = await prepareSubmission(req);
      const sharing = plan.summary.delete.some((name) => I.IMPLEMENT_MERGE_OUTPUTS.includes(name))
        ? await sharedOf(req, { sid, warehouseId, catalog, schema, useCaseId }) : {};
      res.json({ use_case_id: useCaseId, spec_version: plan.nextVersion, based_on_version: plan.built ? plan.built.spec_version : null,
        summary: plan.summary, unchanged: plan.unchanged, warnings, ...sharing });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function outputBeforeBuild(req, warehouseId, planned, useCaseId) {
    if (!planned.config.result_table) return { spec: planned, warnings: [] };
    let output;
    let moved = null;
    try {
      ({ output, moved } = await checkManagedOutput(req, warehouseId, planned.config.result_table, useCaseId,
        Boolean(planned.outputs && planned.outputs.app)));
    } catch (err) {
      if ((err.statusCode && err.statusCode < 500) || I.isReadDenied(err.message) || PM_ERROR.accessDenied(err)) throw err;
      console.warn(`implement output check failed for ${planned.config.result_table}: ${err.message || err}`);
      return { spec: planned, warnings: [`Inspire could not check the result table: ${err.message || err}. The build checks it again.`] };
    }
    if (!output.ok) throw I.badRequest(output.write.ok ? output.safety.detail : output.write.detail, 403);
    const target = moved ? I.withResultTable(planned, moved.to) : planned;
    if (output.grant.ok || !planned.sharing.principals.length) return { spec: target, warnings: [], moved };
    const who = 'it';
    return {
      moved,
      spec: { ...target, sharing: { ...target.sharing, principals: [] } },
      warnings: [`Built without sharing: ${output.grant.detail}. Share ${output.table} once ${who} can.`],
    };
  }

  async function startVersion(req, { sid, warehouseId, inspire_database, catalog, schema, spec: planned, useCaseId, session, plan, person, warnings: noted = [], warningDetails = [], rebuildAsIs = false, grantByPerson = null }) {
    I.refuseAppReadsBlocked(plan); // FX-52: never starts a build the App cannot read, Rebuild as is included
    if (!rebuildAsIs) I.refuseUnchanged(plan);
    const { spec, warnings: outputWarnings, moved } = await outputBeforeBuild(req, warehouseId, planned, useCaseId);
    if (moved) plan.summary.result_table_moved = moved;
    const warnings = [...noted, ...outputWarnings];
    // REQ-389: the build reads the scope the person chose on the Data step, not always the Discover run's scope.
    const sessionParams = withChosenTableScope(notebookParamsFromSessionForGenerateRun(session, sid), spec.data);
    const params = I.implementJobParams(sessionParams, useCaseId, plan.nextVersion, ownServicePrincipalId());
    const token = req.dbToken;
    // Only a rate-table read needs a credential; a build with typed or no rates never asks for one. The read is the App's (REQ-418).
    const runSql = async (sql, parameters = null) => {
      if (!token) throw I.badRequest('Inspire has no credential for its App to read the rate table with. Reload the App and try again.');
      return sqlResultToObjects(await executeSql(req.dbHost, token, warehouseOf(req), sql, parameters,
        { rowLimit: 500, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '10s' }));
    };
    const scopes = await launchScopesOf(req, warehouseId, spec.data?.table_scope);
    Object.assign(params, await JC.implementCurrencyParams(spec?.money, { runSql, scopes }));
    if (!params['02_inspire_database']) params['02_inspire_database'] = inspire_database;
    if (!sessionParams['01_uc_metadata']) {
      const err = new Error('This run has no saved data sources, so Inspire cannot rebuild it. Start a new run from Start to get them.');
      err.statusCode = 400;
      throw err;
    }
    // FX-69c: the person's grants run only now, after every check that can reject the submit, right before the build is queued.
    if (grantByPerson) {
      await grantByPerson(plan);
      I.refuseAppReadsBlocked(plan);
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
      useCaseName: spec.use_case_name,
      warehouseId,
    });
    await executeSql(req.dbHost, req.dbToken, warehouseId, insert.sql, insert.parameters);

    const version = { sessionId: sid, useCaseId, specVersion: plan.nextVersion };
    let out;
    try {
      out = await triggerInspireNotebookJob(req.dbHost, req.dbToken, {
        params,
        scopePicks: sessionParams['01_uc_metadata'],
        notebook_path: req.body?.notebook_path,
        cluster_id: req.body?.cluster_id,
        jobType: 'implement',
        asker: req,
        jobName: I.implementJobName(useCaseId, spec.use_case_name, plan.nextVersion),
        useCaseIds: [useCaseId],
        useCaseName: spec.use_case_name,
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
    const started = I.implementRunStartedStatement(table, { ...version, runId: out.run_id, message: I.IMPLEMENT_RUN_STARTED_MESSAGE });
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
      warnings: [...warnings, ...(out.warnings || [])],
      ...(warningDetails.length || out.warning_details ? { warning_details: [...warningDetails, ...(out.warning_details || [])] } : {}),
    };
  }

  const buildGuard = createGenieJobGuard();
  const BUILD_STARTING = 'Another tab or click is already starting a build of this use case, so Inspire did not start a second one. Open Build in a moment to follow it';

  async function oneBuildAtATime(req, run) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const key = [catalog, schema, sessionIdOf(req), I.validateImplementSpec(req.body?.spec || req.body).spec.use_case_id].join('|');
    if (!(await buildGuard.claim(key, () => null)).ok) throw I.badRequest(BUILD_STARTING, 409);
    try {
      return await run();
    } finally {
      buildGuard.failed(key);
    }
  }

  app.post('/api/inspire/implement/submit', requireToken, async (req, res) => {
    try {
      res.json(await oneBuildAtATime(req, async () => {
        const prepared = await prepareSubmission(req, { grant: true });
        if (GC.needsGenieCode(prepared.spec)) await requireGenieCode(req);
        const started = await startVersion(req, { ...prepared, rebuildAsIs: req.body?.rebuild_as_is === true });
        if (prepared.spec.uninstall && req.body?.uninstall_shared === true) started.shared_uninstalls = await uninstallSharingUseCases(req, prepared);
        return started;
      }));
    } catch (err) {
      sendError(res, err);
    }
  });

  // REQ-460: the person agreed that uninstalling this use case also uninstalls the use cases that share its App, so each gets its own uninstall version.
  // A holder that cannot be queued is reported on its own line; it never undoes the uninstall that already started.
  async function uninstallSharingUseCases(req, { sid, warehouseId, catalog, schema, useCaseId }) {
    const { shared, shared_error: sharedError } = await sharedOf(req, { sid, warehouseId, catalog, schema, useCaseId });
    if (sharedError) throw I.badRequest(`Inspire could not check which use cases share this App, so it did not uninstall them: ${sharedError}`, 502);
    const holders = new Map();
    for (const name of I.IMPLEMENT_MERGE_OUTPUTS) {
      for (const h of (shared && shared[name] && shared[name].use_cases) || []) holders.set(`${h.session_id}|${h.use_case_id}`, h);
    }
    const results = [];
    for (const h of holders.values()) {
      try {
        const history = await loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, h.session_id, h.use_case_id);
        const built = I.previousBuilt(history);
        if (!built) continue;
        const sub = Object.create(req);
        Object.defineProperties(sub, {
          query: { value: { ...req.query, session_id: h.session_id, use_case_id: h.use_case_id } },
          body: { value: { inspire_database: q(req, 'inspire_database'), warehouse_id: warehouseId,
            spec: { ...built.spec_json, uninstall: true, based_on_version: built.spec_version } } },
        });
        const got = await oneBuildAtATime(sub, async () => startVersion(sub, await prepareSubmission(sub, { grant: true })));
        results.push({ session_id: h.session_id, use_case_id: h.use_case_id, spec_version: got.spec_version });
      } catch (err) {
        results.push({ session_id: h.session_id, use_case_id: h.use_case_id, error: err.message });
      }
    }
    return results;
  }

  async function loadStatus(req) {
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
    const appName = I.liveCarriedAssets(history).app;
    const jobId = int64Id((history.find((r) => r.job_id) || {}).job_id);
    const held = history[0] && history[0].status === I.IMPLEMENT_VIBE_NOT_MET ? history[0].spec_version : null;
    const appUpdate = history[0] ? I.appShellUpdate(history, buildStamp()) : null;
    const builtBy = I.implementBuildRunId(history[0]);
    const uninstallRun = I.uninstallRunId(history[0]);
    // The sixth entry is the built-run read that was never bound before this change (left as it was); the seventh is the uninstall run.
    const [appInfo, runInfo, stalled, person, buildRun, , uninstallRunInfo] = await Promise.all([
      appName ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.0/apps/${encodeURIComponent(appName)}`) : null,
      jobId ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/list?job_id=${jobId}&limit=10`) : null,
      stalledOf(req, history[0]),
      held == null && !appUpdate ? null : personOf(req),
      latestRunsOf(req, warehouseId, [history[0]], () => history),
      builtBy ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${builtBy}`).catch(() => null) : null,
      uninstallRun ? jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${uninstallRun}`).catch(() => null) : null,
    ]);
    if (history[0]) {
      history[0].app_update = appUpdate && !I.appShellUpdateRefusal(history, { rollback_outputs: { app: appUpdate.version } }, person.username) ? appUpdate : null;
    }
    // REQ-354 follow-up: once the Uninstall all run is TERMINATED, its own build job is deleted; a refusal is the one line on the card.
    const selfJob = history[0] && uninstallRun ? await I.settleUninstallRunJob({
      row: history[0],
      run: uninstallRunInfo && uninstallRunInfo.ok ? uninstallRunInfo.data : null,
      remove: async (jobId) => jsonOf(dbFetch, req.dbHost, req.dbToken, '/api/2.2/jobs/delete',
        { method: 'POST', body: jsonWithInt64Ids({ job_id: jobId }, ['job_id']) }),
      cache: uninstallJobCache,
    }) : null;
    if (selfJob && selfJob.message) history[0].status_message = selfJob.message;
    const listedNone = runInfo && runInfo.ok && !(Array.isArray(runInfo.data && runInfo.data.runs) && runInfo.data.runs.length);
    const jobInfo = listedNone ? await jsonOf(dbFetch, req.dbHost, req.dbToken, `/api/2.1/jobs/get?job_id=${jobId}`) : null;
    const body = {
      latest: history[0] || null,
      stalled,
      build_run_url: (stalled && stalled.run_url) || (buildRun && buildRun.ok && String(buildRun.data?.run_page_url || '')) || null,
      history,
      steps,
      log_path: logPath,
      feed,
      rerun_widgets: I.rerunWidgets(history),
      app_status: I.appStatusFrom(appInfo, { useCaseId, sessionId: sid, history }),
      runs: I.jobRunsFrom(runInfo, jobInfo),
    };
    return { body, context: { host: req.dbHost, catalog, schema, business: session?.business_name || '', useCaseId } };
  }

  app.get('/api/inspire/implement/status', requireToken, async (req, res) => {
    try {
      res.json((await loadStatus(req)).body);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/inspire/implement/diagnostics', requireToken, async (req, res) => {
    try {
      const { body, context } = await loadStatus(req);
      res.json(await D.buildDiagnostics(body, { ...context, stamp: buildStamp() }));
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
    const names = sessions.length
      ? await sqlRows(req.dbHost, req.dbToken, warehouseId, I.useCaseUserNamesStatement(catalog, schema, sessions))
        .catch((err) => { if (isMissingTableError(err) || I.isMissingColumnError(err)) return []; throw err; })
      : [];
    return I.runPages(rows, scope, buildStamp(), names);
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
      const withheld = moneyWithheld(history[0], table);
      if (withheld) return res.json({ run: null, model: null, history: [], result_table: table, withheld });
      const statements = moneyStatements(table, useCaseId);
      const summary = (await optionalRows(req, warehouseId, statements.summary))[0] || null;
      const edits = summary && summary.value_assumptions ? await optionalRows(req, warehouseId, statements.edits) : [];
      return res.json({ ...moneyView(summary, edits), result_table: table });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // REQ-427: the read uses the App's identity (REQ-418), so a person's own grants never change what a use case row shows. The asset flags
  // come from the tracking table alone (REQ-459: no DBU read).
  async function usecaseRows(req) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    return { rows: await appRecordOf(req, warehouseOf(req), catalog, schema, sessionIdOf(req), null) };
  }

  app.get('/api/inspire/implement/usecase-assets', requireToken, async (req, res) => {
    try {
      const { rows } = await usecaseRows(req);
      res.set('Cache-Control', 'no-store').json({ use_cases: UA.assetFlagsView(rows) });
    } catch (err) {
      sendError(res, err);
    }
  });

  async function feedbackContext(req) {
    const sid = sessionIdOf(req);
    const warehouseId = warehouseOf(req);
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
    const [history, person] = await Promise.all([loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId), personOf(req)]);
    const table = String(history[0]?.spec_json?.config?.result_table || '').trim();
    const appTable = FB.appFeedbackTable({ database: `${catalog}.${schema}`, appName: I.liveAppOf(history)?.name, useCaseId });
    const before = I.previousBuilt(history);
    const refused = before ? I.implementSettingsOwnerRefusal(before, person.username) : { status: 409, message: I.IMPLEMENT_SETTINGS_NOT_BUILT };
    return { sid, warehouseId, catalog, schema, useCaseId, history, person, table, appTable, before, refused };
  }

  function feedbackTables(ctx) {
    return ctx.table ? [FB.feedbackTable(ctx.table), ctx.appTable] : [ctx.appTable];
  }

  function feedbackOwnerOnly(ctx) {
    if (ctx.refused) throw I.badRequest(ctx.refused.message, ctx.refused.status);
  }

  async function feedbackLists(req, ctx, statementOf) {
    const lists = [];
    for (const table of feedbackTables(ctx)) {
      try {
        lists.push(await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId, statementOf(table)));
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
      }
    }
    return { lists, missing: lists.length === 0 };
  }

  app.get('/api/inspire/implement/feedback', requireToken, async (req, res) => {
    try {
      const ctx = await feedbackContext(req);
      const owner = { editable: !ctx.refused, why: ctx.refused ? ctx.refused.message : '' };
      const { lists, missing } = await feedbackLists(req, ctx, (t) => FB.feedbackListStatement(t, ctx.useCaseId));
      return res.json({ ...FB.feedbackView(FB.feedbackRowsAcross(lists), owner), result_table: ctx.table || '', missing });
    } catch (err) {
      return sendError(res, err);
    }
  });

  async function oneFeedback(req, ctx, id) {
    for (const table of feedbackTables(ctx)) {
      try {
        const rows = await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId, FB.feedbackOneStatement(table, ctx.useCaseId, id));
        if (rows[0]) return { row: rows[0], table };
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
      }
    }
    throw I.badRequest(`No reported issue ${id} for ${ctx.useCaseId}.`, 404);
  }

  app.post('/api/inspire/implement/feedback/status', requireToken, async (req, res) => {
    try {
      const change = FB.feedbackStatusChange(req.body);
      const ctx = await feedbackContext(req);
      feedbackOwnerOnly(ctx);
      const { table } = await oneFeedback(req, ctx, change.feedback_id);
      await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId, FB.feedbackStatusStatement(table, ctx.useCaseId, change, ctx.person.username));
      const { lists } = await feedbackLists(req, ctx, (t) => FB.feedbackListStatement(t, ctx.useCaseId));
      return res.json({ ...FB.feedbackView(FB.feedbackRowsAcross(lists), { editable: true }), result_table: ctx.table || '', missing: false,
        changed: change.feedback_id });
    } catch (err) {
      return sendError(res, err);
    }
  });

  async function feedbackPage(req, ctx) {
    const target = I.implementSettingsTarget(ctx.history, ctx.useCaseId);
    if (!target || !I.implementAppUrlOk(target.url) || !P.forwardedTokenOf(req)) return null;
    try {
      const got = await callApp(req, target, 'GET', '/api/app');
      return got.ok ? (got.data.pages || []).find((p) => p && p.id === target.page) || null : null;
    } catch (err) {
      console.warn(`implement: the App page of ${ctx.useCaseId} could not be read for a vibe draft: ${err.message}`);
      return null;
    }
  }

  // REQ-422: (method, path, body) over the user's token, for invokeChatModel (it retries a refused databricks- name on its model service).
  const chatCall = (req, token) => (method, path, body) => jsonOf(dbFetch, req.dbHost, token, path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  // REQ-475: the first chat model the App can call (a ready serving endpoint, else a Unity Gateway model); a refusal says why none is.
  async function appModelOf(req, token, spec, cannot) {
    const got = await appChatModels(chatCall(req, token), spec);
    if (got.names.length) return got.names[0];
    if (!got.listed.ok) throw I.badRequest(`Inspire could not list the serving endpoints as the App: ${got.listed.data.message || got.listed.data.error || `HTTP ${got.listed.status}`}`, got.listed.status);
    // The refusal keeps its grant words; the empty answer keeps the wording the vibe and describe routes always gave, now naming the gateway.
    const empty = got.reason.startsWith('No chat model');
    throw I.badRequest(empty ? `no chat model the App can use is ready on this workspace, as a serving endpoint or through the AI Gateway, so Inspire cannot ${cannot}` : `${got.reason} Inspire cannot ${cannot}`, 409);
  }

  app.post('/api/inspire/implement/feedback/vibe', requireToken, async (req, res) => {
    try {
      const id = FB.feedbackId(req.body?.feedback_id);
      const ctx = await feedbackContext(req);
      feedbackOwnerOnly(ctx);
      const token = appReadToken(req);
      const { row: feedback } = await oneFeedback(req, ctx, id);
      const spec = ctx.before.spec_json || {};
      const endpoint = await appModelOf(req, token, spec, 'draft a vibe; write the vibe by hand');
      const [useCase, page] = await Promise.all([
        loadUseCase(req.dbHost, req.dbToken, ctx.warehouseId, ctx.catalog, ctx.schema, ctx.sid, ctx.useCaseId).catch(() => null),
        feedbackPage(req, ctx),
      ]);
      const statuses = Object.fromEntries(Object.entries(ctx.before.asset_status || {}).map(([k, v]) => [k, v && typeof v === 'object' ? v.state || v.status || '' : v]));
      const messages = FB.vibePrompt({ useCaseId: ctx.useCaseId, useCase, page, vibes: specVibeAsks(spec), statuses, feedback });
      const got = await invokeChatModel(chatCall(req, token), endpoint, { messages, max_tokens: FB.VIBE_MAX_TOKENS });
      if (!got.ok) throw I.badRequest(`the model ${endpoint} did not answer: ${got.data.message || got.data.error || `HTTP ${got.status}`}`, 502);
      return res.json({ ...FB.vibeDraftOf(got.data), feedback_id: id, model: endpoint });
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
    const [history, useCase] = await Promise.all([loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
      loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId)]);
    const target = I.implementSettingsTarget(history, useCaseId);
    const built = history.some((row) => I.IMPLEMENT_DONE_STATUSES.includes(row.status));
    const refusal = !built ? [409, I.IMPLEMENT_SETTINGS_NOT_BUILT] : !target ? [409, I.IMPLEMENT_SETTINGS_NO_APP]
      : !I.implementAppUrlOk(target.url) ? [409, I.IMPLEMENT_SETTINGS_NOT_APP_URL] : !P.forwardedTokenOf(req) ? [401, I.IMPLEMENT_SETTINGS_NO_SIGN_IN] : null;
    return { history, built, useCase, target: target && I.implementAppUrlOk(target.url) ? target : null, refusal };
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
        if (PM_ERROR.accessDenied(err)) throw err;
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
        if (PM_ERROR.accessDenied(err)) throw err;
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
      const sent = req.body || {};
      const custom = keys.includes('name') ? I.customSqlProblem(sent.name, sent.value) : '';
      if (custom) return res.status(400).json({ error: custom });
      const { history, target, refusal, useCase } = await settingsContext(req);
      if (refusal) return res.status(refusal[0]).json({ error: refusal[1] });
      // REQ-193: a family C use case fits one model, so a column Grouping is refused on save, before the App is asked.
      const oneModel = sent.name === GR.GROUP_BY && GR.fitsOneModel(useCase && useCase.analytics_technique, useCase && useCase.use_case_kind);
      const refused = oneModel ? GR.oneModelProblem(sent.value, true) : '';
      if (refused) return res.status(400).json({ error: refused });
      const body = { page: target.page, ...Object.fromEntries(keys.filter((key) => sent[key] !== undefined).map((key) => [key, sent[key]])) };
      let got;
      try {
        got = await callApp(req, target, 'POST', `/api/settings/${action}`, body);
      } catch (err) {
        return PM_ERROR.sendFailure(res, 502, `The App could not be reached: ${err.message}`);
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

  function sqlFailure(err, texts) {
    if (err && err.statusCode) return err;
    const message = String((err && err.message) || err);
    const submitted = /^SQL failed \((\d{3})\)/.exec(message);
    const kind = err && err.code === 'SQL_DEADLINE' ? 'deadline'
      : submitted && submitted[1] === '401' ? 'sign_in'
        : I.isReadDenied(message) || PM_ERROR.accessDenied(message) || (submitted && submitted[1] === '403') ? 'denied'
          : submitted ? 'submitted' : isMissingTableError(err) ? 'missing' : 'failed';
    const [status, text] = texts[kind](message);
    // The plain sentence stays; the warehouse's own refusal text rides along, so the response still carries the Permission Required payload.
    return Object.assign(I.badRequest(text, status), kind === 'denied' ? { denial: message } : {});
  }

  const profileFailures = (table) => ({
    deadline: () => [504, `Inspire read ${table} for Data groups for ${GP.PROFILE_MS / 1000} seconds with no answer, so it stopped; `
      + 'try again once the warehouse is running.'],
    sign_in: (m) => [401, `Databricks did not accept your sign-in to read ${table} for Data groups: ${m}`],
    denied: () => [403, `${U.runUnreadableTablesText([table])}.`],
    submitted: (m) => [502, `Databricks could not read the table for Data groups: ${m}`],
    missing: () => [403, `${U.runUnreadableTablesText([table])}.`],
    failed: (m) => [400, `Inspire could not read the table for Data groups: ${m}`],
  });

  // The Data Filters of the session the preview names: the money previews and the profile read their tables through them.
  // REQ-389: the Table Scope a wizard preview reads through. The Data step names its choice (asked); with none, the Discover run's scope.
  async function launchScopesOf(req, warehouseId, asked, sid = sessionIdOf(req)) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const session = await fetchInspireSessionWidgetRow(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid);
    if (!session) throw I.badRequest(`No Inspire session ${sid} is in this Inspire database, so Inspire cannot read its Data Filters.`, 404);
    return previewScopesOf(asked, parseTableScopeText(session.table_scope).scopes);
  }

  function builtData(history) {
    const built = I.previousBuilt(history);
    const spec = built && built.spec_json && typeof built.spec_json === 'object' ? built.spec_json : {};
    return spec.data && typeof spec.data === 'object' ? spec.data : {};
  }

  function profiledTable(useCase, data, asked = '') {
    const chosen = String(asked || '').trim();
    if (chosen) return chosen;
    const primary = I.primaryTableOf(useCase) || I.useCaseTables(useCase)[0] || '';
    const swaps = data.tables && typeof data.tables === 'object' ? data.tables : {};
    const swapped = Object.keys(swaps).find((k) => k.replace(/`/g, '').toLowerCase() === primary.replace(/`/g, '').toLowerCase());
    return swapped === undefined ? primary : String(swaps[swapped] || primary).trim();
  }

  // Request for Access (REQ-311): the Permission Required dialog checks whether a destination is set, then sends the request as the person.
  // Both routes read the signed-in person's token only; the request names no principal, so it is always the requester's own.
  const accessRequestCall = (req, token) => (path, opts) => jsonOf(dbFetch, req.dbHost, token, path, opts);
  app.post('/api/access-request/check', requireToken, async (req, res) => {
    const token = P.personTokenOf(req);
    if (!token) return res.status(401).json(RP.noPersonTokenBody(req.policyKey));
    try {
      const who = RP.forwardedPerson(req.headers || {});
      return res.json(await AR.checkAccessRequest({ call: accessRequestCall(req, token), who, statements: req.body?.statements, host: req.dbHost }));
    } catch (err) {
      return sendError(res, err);
    }
  });
  app.post('/api/access-request', requireToken, async (req, res) => {
    const token = P.personTokenOf(req);
    if (!token) return res.status(401).json(RP.noPersonTokenBody(req.policyKey));
    try {
      const who = RP.forwardedPerson(req.headers || {});
      return res.json(await AR.sendAccessRequest({ call: accessRequestCall(req, token), who, statements: req.body?.statements, host: req.dbHost }));
    } catch (err) {
      return sendError(res, err);
    }
  });

  // The three latest rates of a money rule's rate table, into its base currency, read with the App's service principal (REQ-418).
  app.post('/api/money/rate-sample', requireToken, async (req, res) => {
    const token = req.dbToken;
    try {
      const warehouseId = warehouseOf(req);
      const scopes = await launchScopesOf(req, warehouseId, req.body?.table_scope);
      const column = req.body?.rate_column;
      const made = column ? GP.rateColumnSampleSql(req.body?.table, req.body?.currency_column, column, scopes)
        : GP.rateSampleSql(req.body?.rate_table, req.body?.base, scopes);
      if (!made) throw I.badRequest('Name the rate table and its columns, or the use case table, its currency column and its rate column, to read the rates.');
      const found = await executeSql(req.dbHost, token, warehouseId, made.sql, made.parameters, { rowLimit: GP.RATE_SAMPLE_ROWS, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '10s' });
      return res.json({ rates: sqlResultToObjects(found).map((r) => ({ currency: String(r.currency ?? ''), rate: Number(r.rate) })) });
    } catch (err) {
      return sendError(res, sqlFailure(err, profileFailures(String(req.body?.rate_table?.table || 'the rate table'))));
    }
  });

  app.post('/api/money/currency-rates', requireToken, async (req, res) => {
    const token = req.dbToken;
    const asked = String(req.body?.base || '').trim().toUpperCase();
    try {
      // A table with no currency column is read for the one code its value is written in (REQ-103): no table read, the codes come from the request.
      const byColumn = String(req.body?.currency_column || '').trim() !== '';
      const codes = byColumn ? [] : (Array.isArray(req.body?.codes) ? req.body.codes : []).map((c) => String(c ?? '').trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c));
      if (!byColumn && !codes.length) throw I.badRequest('Name the currency the value is written in, as a three-letter code such as USD.');
      if (asked && !/^[A-Z]{3}$/.test(asked)) throw I.badRequest('Name the reporting currency as a three-letter code such as USD.');
      const warehouseId = byColumn ? warehouseOf(req) : '';
      let currencies = codes.map((code) => ({ code, records: null }));
      if (byColumn) {
        const scopes = await launchScopesOf(req, warehouseId, req.body?.table_scope);
        const made = GP.currencySpreadSql(req.body?.table, req.body?.currency_column, scopes);
        if (!made) throw I.badRequest('Name the use case table and its currency column, and the reporting currency as a three-letter code such as USD.');
        const found = await executeSql(req.dbHost, token, warehouseId, made.sql, made.parameters, { rowLimit: GP.CURRENCY_SPREAD_ROWS, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '10s' });
        currencies = sqlResultToObjects(found).map((r) => ({ code: String(r.currency ?? '').trim().toUpperCase(), records: Number(r.records) }));
      }
      const capped = byColumn && currencies.length >= GP.CURRENCY_SPREAD_ROWS;
      const base = asked || (currencies[0] ? currencies[0].code : 'USD');
      const rates = await FX.currencyRates({ base, codes: currencies.map((c) => c.code) });
      return res.json({ ...rates, currencies, capped });
    } catch (err) {
      return sendError(res, sqlFailure(err, profileFailures(String(req.body?.table || 'the use case table'))));
    }
  });

  app.post('/api/money/value-preview', requireToken, async (req, res) => {
    const token = req.dbToken;
    try {
      const warehouseId = warehouseOf(req);
      const scopes = await launchScopesOf(req, warehouseId, req.body?.table_scope);
      const made = GP.moneyValueSampleSql(req.body?.table, req.body?.value, scopes, req.body?.lost_filter ?? null);
      if (!made) throw I.badRequest('Name the use case table, and the value: a fixed amount, one column, or an equation over its columns, with one currency.');
      const found = await executeSql(req.dbHost, token, warehouseId, made.sql, made.parameters, { rowLimit: GP.MONEY_VALUE_ROWS, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '10s' });
      return res.json({ rows: sqlResultToObjects(found).map((r) => ({ stake: Number(r.stake), currency: String(r.currency ?? '') })) });
    } catch (err) {
      return sendError(res, sqlFailure(err, profileFailures(String(req.body?.table || 'the use case table'))));
    }
  });

  // REQ-432: the Calculate estimate. ONE statement reads a sample of the use case table; the amount counted per sampled record is scaled
  // to every eligible record and to a year (VY.extrapolate). It starts no Build and no job, and it never answers 0 for a value it could not read.
  // REQ-435: typed drivers (value that is not in the data) are added to that part, and attribution scales the total; drivers alone run no SQL.
  async function estimateYearly(req, warehouseId, table, answers) {
    const money = answers.money && typeof answers.money === 'object' ? answers.money : {};
    const hasData = !!money.value && typeof money.value === 'object';
    const driven = VDC.validate(answers, I.badRequest);
    if (!hasData && !driven) throw I.badRequest('Answer the Value at stake questions first: how much each record is worth, and in which currency.');
    const attribution = driven ? driven.attribution_pct : VDC.attributionOf(answers, I.badRequest);
    I.validateUseCaseId(q(req, 'use_case_id'));
    const withParts = (yearly, currency, data) => {
      const made = VDC.combine({ drivers: driven ? driven.drivers : {}, attribution_pct: attribution, currency, data });
      return { ...yearly, entries: [{ kind: 'money', unit: currency, amount: made.total.amount }], ...made };
    };
    if (!hasData) {
      const head = { verb: 'VALUE AT STAKE', period: VY.PERIOD, estimated: true, basis: null };
      return withParts(head, driven.currency, null);
    }
    if (!table) throw I.badRequest('Name the use case table to estimate the value on.');
    const asked = String(money.value.currency || '').trim().toUpperCase();
    if (driven && asked && asked !== driven.currency) throw I.badRequest(`The value from the data is in ${asked} but the answer currency is ${driven.currency}; use one currency for both.`);
    const scopes = await launchScopesOf(req, warehouseId, req.body?.table_scope);
    await refuseMetricView(req, warehouseId, table);
    const columns = GP.scopedColumns(await I.readPickedTable(table, () => sqlRows(req.dbHost, req.dbToken, warehouseId, I.columnsStatement(table))), scopes, table);
    const dateColumn = VY.dateColumnOf(columns);
    if (!dateColumn) throw I.badRequest('The table has no date column to scale the sample to a year, so Inspire cannot estimate a value per year.', 422);
    const made = GP.moneyYearlySampleSql(table, money.value, dateColumn, scopes, answers.lost_filter ?? null);
    if (!made) throw I.badRequest('Name the value: a fixed amount, one column, or an equation over the table columns, with one currency.');
    const found = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, made.sql, made.parameters, { rowLimit: 100, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '50s' }));
    const entries = found.map((r) => ({ kind: 'money', unit: String(r.currency ?? ''), amount: Number(r.stake) })).filter((e) => e.unit && e.amount > 0);
    const basis = found[0] || {};
    const yearly = VY.yearlyOf({ entries, sampled: basis.sampled, eligible: basis.eligible, days: basis.days, kpi: answers.kpi, rule: money.rule });
    if (!yearly) throw I.badRequest(`Inspire read a sample of ${table} and found no record that counts toward the value, so it shows no number.`, 422);
    const units = [...new Set(yearly.entries.map((e) => e.unit))];
    if (driven) {
      const other = units.find((u) => u !== driven.currency);
      if (other) throw I.badRequest(`The value from the data is in ${other} but the answer currency is ${driven.currency}; use one currency for both.`);
    } else if (attribution === 100) {
      return yearly;
    } else if (units.length !== 1) {
      throw I.badRequest('The share of this value the use case earns needs the value in one currency; the data gives more than one.');
    }
    const currency = driven ? driven.currency : units[0];
    return withParts(yearly, currency, { amount: yearly.entries.reduce((sum, e) => sum + e.amount, 0) });
  }

  const estimateFailure = (err, table) => sqlFailure(err, profileFailures(table || 'the use case table'));
  const answersOf = (req) => (req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {});

  // REQ-472 (c): the model reviews the estimate's yearly amount. The number is never changed; a review that fails gives no `review`, never an error.
  async function estimateReview(req, warehouseId, yearly) {
    try {
      const amount = yearly.total && Number.isFinite(yearly.total.amount) ? yearly.total.amount : (yearly.entries || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const useCase = await planUseCaseOf(req, warehouseId, I.validateUseCaseId(q(req, 'use_case_id')));
      const anchor = await anchorOf(req, useCase);
      const got = await reviewOf(req, useCase, anchor, amount, { drivers: [] });
      if (got.failed) return { review: { approved: false, model: null, reason: got.failed, amount: null, anchor, tuned: false } };
      const ceiling = anchor ? anchor.high : VALUE_RANGE.high;
      return { review: { approved: (got.approved || VR.agrees(got.amount, amount)) && amount <= ceiling, model: got.model, reason: got.reason, amount: got.amount, anchor, tuned: false } };
    } catch {
      return {};
    }
  }

  app.post('/api/inspire/value/estimate', requireToken, async (req, res) => {
    const table = String(req.body?.table || '').trim();
    try {
      const warehouseId = warehouseOf(req);
      const yearly = await estimateYearly(req, warehouseId, table, answersOf(req));
      return res.json({ yearly, disclaimer: VALUE_DISCLAIMER.full, ...(await estimateReview(req, warehouseId, yearly)) });
    } catch (err) {
      return sendError(res, estimateFailure(err, table));
    }
  });

  // REQ-436: the case plan. The model names the case, filter, groupings, metrics and what each driver asks; every name is checked against the
  // table. One grouped SQL reads the counts. A model that cannot answer gives the fallback plan, never a 5xx.
  // The reason a model gave no plan, in words the person can act on: a refusal names the grant, any other answer carries the model's own words.
  function modelRefusal(endpoint, got) {
    if (got.status === 401 || got.status === 403) return `The App cannot query the model ${endpoint}. Give the App's service principal Can query on that serving endpoint (or EXECUTE on its system.ai model service).`;
    const said = String((got.data && (got.data.message || got.data.error)) || '').trim().replace(/[.\s]+$/, '');
    return `The model ${endpoint} answered HTTP ${got.status || 'error'}${said ? `: ${said}` : ''}.`;
  }

  const PLAN_MODEL_TRIES = 4;
  // FX-51 (REQ-448, D50): one use case is worth 100K-100M a year. The prompt says so (it never clamps); a planned value outside it is asked once more.
  const VALUE_RANGE = { low: 100000, high: 100000000 };
  const outsideRange = (amount, range = VALUE_RANGE) => !Number.isFinite(amount) || amount < range.low || amount > range.high;
  // The range the plan is asked to land in: the anchor's when the anchor call answered, else the generic one.
  const rangeOf = (anchor) => (anchor ? { low: anchor.low, high: anchor.high } : VALUE_RANGE);
  const rangeMessages = (messages, retry, anchor = null) => {
    const { low, high } = rangeOf(anchor);
    const lead = anchor
      ? `\nThis use case is likely worth about ${anchor.typical} per year (between ${low} and ${high}) in the run's currency${anchor.reason ? `: ${anchor.reason}` : ''}. Choose the estimates so the total lands in that range and near the likely value, and say in each driver's "why" which driver moves the value into it. Never leave every driver off.`
      : `\nOne use case is usually worth ${low}-${high} per year in the run's currency: choose the estimates so the total lands in that range, and say in each driver's "why" which driver moves the value into it. Never leave every driver off.`;
    return messages.map((m, i) => (i === 0
      ? { ...m, content: `${m.content}${lead}` }
      : i === messages.length - 1 && retry
        ? { ...m, content: `${m.content}\nYour previous plan gave ${retry.amount} per year, which is ${retry.amount === 0 ? 'zero, and a use case is never worth 0' : retry.amount < low ? `below ${low}` : `above ${high}`}. Plan again so the total is between ${low} and ${high} per year.` }
        : m));
  };
  // The yearly the plan gives with its own defaults (what bulk Calculate saves), or null when the plan has no readable amount.
  const defaultYearlyOf = (plan) => {
    const got = VCP.yearlyOf(plan, { currency: 'USD' });
    return got.yearly ? got.yearly.total.amount : null;
  };

  // REQ-472: the one endpoint loop every value model call goes through (plan, anchor, review). { endpoint, got } or { reason }.
  async function askChatModel(req, messages, maxTokens) {
    try {
      const { names, listed, reason } = await appChatModels(chatCall(req, req.dbToken), {});
      if (!names.length) return { reason: listed.ok ? reason : `The list of model endpoints answered HTTP ${listed.status || 'error'}.` };
      // FX-46 (D13/D20): the first listed model may be one the App cannot query or that rejects the call; the next ready ones are tried
      // (at most PLAN_MODEL_TRIES), and a refusal of every one reports the first, which names the grant.
      let firstFailure = '';
      for (const name of names.slice(0, PLAN_MODEL_TRIES)) {
        const tried = await invokeChatModel(chatCall(req, req.dbToken), name, { messages, max_tokens: maxTokens });
        if (tried.ok) return { endpoint: name, got: tried };
        firstFailure = firstFailure || modelRefusal(name, tried);
      }
      return { reason: firstFailure };
    } catch (err) {
      return { reason: 'The model could not be reached.' };
    }
  }

  async function modelPlanOf(req, table, columns, groupBy, useCase = null, retry = null, anchor = null) {
    const without = (reason) => ({ ...VCP.fallbackPlan(columns, groupBy), model_reason: reason });
    const asked = await askChatModel(req, rangeMessages(VCP.planMessages({ table, columns, useCase }), retry, anchor), 1500);
    if (!asked.got) return without(asked.reason);
    const plan = VCP.planFrom(asked.got.data, columns, groupBy);
    const usable = plan.drivers.some((d) => d.on) || plan.metrics.length || plan.case_filter || plan.case_noun !== 'record';
    return usable ? { ...plan, model: asked.endpoint } : { ...plan, model: null, model_reason: 'The model reply was not a usable plan.' };
  }

  // REQ-472 (a): the anchor, one model call before the plan; null when the model gives none (the generic range is used then).
  async function anchorOf(req, useCase) {
    const asked = await askChatModel(req, VR.anchorMessages({ useCase, businessName: useCase.business_name, range: VALUE_RANGE }), 600);
    return asked.got ? VR.anchorFrom(asked.got.data, VALUE_RANGE) : null;
  }

  // REQ-472 (c): one review of `amount` by the model: { approved, amount, reason, model } or { failed: reason }.
  async function reviewOf(req, useCase, anchor, amount, plan) {
    const asked = await askChatModel(req, VR.reviewMessages({ useCase, businessName: useCase.business_name, anchor, amount, drivers: VR.onDriversOf(plan) }), 400);
    if (!asked.got) return { failed: asked.reason };
    const got = VR.reviewFrom(asked.got.data);
    return got ? { ...got, model: asked.endpoint } : { failed: `The model ${asked.endpoint} gave no usable review.` };
  }

  // FX-34 (D5): the use case the plan is for (name, statement, business value). Unreadable: the id alone, so the plan is still its own.
  async function planUseCaseOf(req, warehouseId, useCaseId) {
    try {
      const { catalog, schema } = dbOf(req, splitInspireDatabase);
      const row = await loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sessionIdOf(req), useCaseId);
      const business_name = await loadSession(req.dbHost, req.dbToken, warehouseId, catalog, schema, sessionIdOf(req)).then((s) => String((s && s.business_name) || ''), () => '');
      return { id: useCaseId, use_case: (row && (row.user_use_case_name || row.use_case)) || useCaseId, statement: row && row.statement, business_value: row && row.business_value, business_name };
    } catch {
      return { id: useCaseId, use_case: useCaseId, business_name: '' };
    }
  }

  // REQ-472 (c) / REQ-474: review the plan's default value; while the reviewer does not approve and names an amount, scale the money inputs to it and
  // review again (up to REVIEW_ROUNDS reviews). A reviewer that names the plan's own value (within 1%) approves it. Never approved above the cap.
  async function reviewAndTune(req, useCase, anchor, start) {
    const made = (approved, extra) => ({ approved, model: null, reason: '', amount: null, anchor, tuned: false, ...extra });
    let plan = start;
    let tuned = false;
    let last = null;
    for (let round = 0; round < VR.REVIEW_ROUNDS; round += 1) {
      const current = defaultYearlyOf(plan);
      const got = await reviewOf(req, useCase, anchor, current, plan);
      if (got.failed) return { plan, review: made(false, { reason: got.failed, tuned }) };
      last = got;
      if (got.approved || VR.agrees(got.amount, current)) {
        const ceiling = anchor ? anchor.high : VALUE_RANGE.high;
        return { plan, review: made(current <= ceiling, { model: got.model, reason: got.reason, amount: got.amount, tuned }) };
      }
      const next = got.amount > 0 ? VCP.scaleToTarget(plan, got.amount) : null;
      if (!next) break;
      plan = next;
      tuned = true;
    }
    return { plan, review: made(false, { model: last && last.model, reason: last ? last.reason : '', amount: last ? last.amount : null, tuned }) };
  }

  app.post('/api/inspire/value/case-plan', requireToken, async (req, res) => {
    const table = String(req.body?.table || '').trim();
    try {
      const warehouseId = warehouseOf(req);
      const useCaseId = I.validateUseCaseId(q(req, 'use_case_id'));
      if (!table) throw I.badRequest('Name the use case table to plan the value on.');
      const scopes = await launchScopesOf(req, warehouseId, req.body?.table_scope);
      await refuseMetricView(req, warehouseId, table);
      const columns = GP.scopedColumns(await I.readPickedTable(table, () => sqlRows(req.dbHost, req.dbToken, warehouseId, I.columnsStatement(table))), scopes, table);
      const dateColumn = VY.dateColumnOf(columns);
      if (!dateColumn) throw I.badRequest('The table has no date column to scale the counts to a year, so Inspire cannot plan a value per year.', 422);
      const useCase = await planUseCaseOf(req, warehouseId, useCaseId);
      const anchor = await anchorOf(req, useCase);
      const range = rangeOf(anchor);
      let read = null;
      const planOnce = async (retry) => {
        const plan = await modelPlanOf(req, table, columns, String(req.body?.group_by || '').trim(), useCase, retry, anchor);
        // A retry that keeps the same filter, grouping and metrics reads the same counts: they are not read twice.
        const readKey = JSON.stringify([plan.case_filter, plan.grouping, plan.metrics]);
        if (read && read.key === readKey) return { plan, counted: read.counted };
        const made = VCP.groupedSql(GP, scopes, plan, table, dateColumn);
        const rows = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, made.sql, made.parameters, { rowLimit: VCP.GROUP_MAX_GROUPS, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '50s' }));
        // The records and the days come from the whole filtered table (the C5 count), never from the grouped rows.
        const countSql = VCP.currentCountSql(GP, scopes, { ...plan, table, date_column: dateColumn });
        const population = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, countSql.sql, countSql.parameters, { rowLimit: 1, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '50s' }))[0] || {};
        read = { key: readKey, counted: VCP.groupsFrom(rows, plan, population) };
        return { plan, counted: read.counted };
      };
      let { plan, counted } = await planOnce(null);
      // FX-51: a model plan whose default value is outside the range is retried once; still outside, the plan carries value_check and is never saved as calculated.
      let valueCheck = null;
      if (plan.model && counted.days && counted.groups.length) {
        const first = defaultYearlyOf({ ...plan, groups: counted.groups });
        if (first !== null && outsideRange(first, range)) {
          const again = await planOnce({ amount: first });
          const second = again.plan.model && again.counted.days && again.counted.groups.length ? defaultYearlyOf({ ...again.plan, groups: again.counted.groups }) : null;
          if (second !== null) ({ plan, counted } = again);
          const last = second !== null ? second : first;
          if (outsideRange(last, range)) valueCheck = { amount: last, low: range.low, high: range.high };
        }
      }
      if (!counted.days || !counted.groups.length) throw I.badRequest(`Inspire found no ${plan.case_noun} in ${table} to plan a value on.`, 422);
      // REQ-472 (c): the model reviews the plan's value and tunes it (up to 3 rounds); a review that could not run, or never approved, sets value_check.
      let review = null;
      if (plan.model && defaultYearlyOf({ ...plan, groups: counted.groups }) !== null) {
        const done = await reviewAndTune(req, useCase, anchor, { ...plan, groups: counted.groups });
        ({ review } = done);
        plan = { ...plan, drivers: done.plan.drivers };
        const final = defaultYearlyOf(done.plan);
        valueCheck = !review.approved || outsideRange(final, range) ? { amount: final, low: range.low, high: range.high } : null;
      }
      const anchored = anchor ? { likely_value: { amount: anchor.typical, currency: 'USD', reason: anchor.reason }, economic_trend: anchor.economic_trend, economic_factors: anchor.economic_factors || [] } : {};
      return res.json({ plan: { ...plan, ...anchored, ...(review ? { review } : {}), table, date_column: dateColumn, days: counted.days, groups: counted.groups, use_case_id: useCaseId, basis: VCP.PLAN_BASIS, ...(valueCheck ? { value_check: valueCheck } : {}) } });
    } catch (err) {
      return sendError(res, estimateFailure(err, table));
    }
  });

  // The yearly of a shape-2 answer, from its plan and the typed numbers; a 400 names each driver that is wrong. No SQL.
  const shape2Yearly = (plan, answers) => {
    const got = VCP.yearlyOf(plan && typeof plan === 'object' ? plan : {}, answers && typeof answers === 'object' ? answers : {});
    if (got.errors) throw Object.assign(I.badRequest(Object.values(got.errors)[0]), { errorMap: got.errors });
    return got.yearly;
  };
  const sendShape2Error = (res, err) => (err && err.errorMap ? res.status(400).json({ error: err.message, errors: err.errorMap }) : sendError(res, err));

  app.post('/api/inspire/value/preview', requireToken, (req, res) => {
    try {
      return res.json({ yearly: shape2Yearly(req.body?.plan, req.body?.answers) });
    } catch (err) {
      return sendShape2Error(res, err);
    }
  });

  // REQ-435: the saved Calculate answers, one append-only version row per save in __inspire_value_answers (see lib/valueAnswers.js).
  const answersTable = (req) => {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    return `\`${catalog}\`.\`${schema}\`.\`__inspire_value_answers\``;
  };
  const savedBy = (req) => String(req.headers['x-forwarded-email'] || req.headers['x-forwarded-preferred-username'] || '').trim();
  const readAnswers = async (req, warehouseId, made) => {
    try {
      return sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, made.sql, made.parameters));
    } catch (err) {
      if (isMissingTableError(err)) return [];
      throw err;
    }
  };
  const appendAnswers = async (req, warehouseId, table, row) => {
    const made = VA.insertSql(table, row);
    await executeSql(req.dbHost, req.dbToken, warehouseId, made.sql, made.parameters);
  };
  const nextVersion = async (req, warehouseId, table, sid, useCaseId) => {
    const made = VA.latestVersionSql(table, sid, useCaseId);
    const row = (await readAnswers(req, warehouseId, made))[0];
    return (row && row.latest !== null && row.latest !== undefined ? Number(row.latest) : 0) + 1;
  };

  // REQ-436 (C5): a shape-2 entry is stale when the table's records per year under the same filter differ from the saved plan's by more than
  // 10%. One count per distinct table and filter; a count that fails, or a scope that cannot be read, is not stale.
  async function staleOf(req, warehouseId, versions) {
    const planOf = (v) => (v.answers && v.answers.shape === 2 && v.answers.plan && typeof v.answers.plan === 'object' ? v.answers.plan : null);
    if (!versions.some(planOf)) return versions.map(() => false);
    let scopes = null;
    try {
      scopes = await launchScopesOf(req, warehouseId, undefined);
    } catch {
      return versions.map(() => false);
    }
    const counted = new Map();
    const countOf = (plan) => {
      const key = JSON.stringify([plan.table, plan.date_column, plan.case_filter]);
      if (!counted.has(key)) {
        counted.set(key, (async () => {
          try {
            const made = VCP.currentCountSql(GP, scopes, plan);
            return sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, made.sql, made.parameters))[0] || null;
          } catch {
            return null;
          }
        })());
      }
      return counted.get(key);
    };
    return Promise.all(versions.map(async (v) => {
      const plan = planOf(v);
      if (!plan) return false;
      const row = await countOf(plan);
      return row ? VCP.isStale(plan, row) : false;
    }));
  }

  // REQ-480: one model call reviews the whole run once its values are saved: a realistic run total, a scale per use case and one reason. The review is saved
  // as a row of the answers table (VR.RUN_REVIEW_ID); valueTotals reads it. With no model the hard limit still applies and the row says ai_checked false.
  app.post('/api/inspire/value/run-review', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = String(sessionIdOf(req));
      const table = answersTable(req);
      const rows = (await readAnswers(req, warehouseId, VA.latestSql(table, sid))).filter((r) => String(r.use_case_id) !== VR.RUN_REVIEW_ID);
      const versions = rows.map((r) => [String(r.use_case_id), VA.versionOf(r)]).filter(([, v]) => v.yearly && v.yearly.total && Number(v.yearly.total.amount) > 0);
      if (!versions.length) return res.json({ review: null, reason: 'No use case has a saved value yet.' });
      const cases = await mapLimit(versions, 4, async ([id, v]) => {
        const uc = await planUseCaseOf(req, warehouseId, id);
        return { id, name: uc.use_case, kind: v.yearly.verb || '', amount: Number(v.yearly.total.amount), currency: v.yearly.total.unit || v.yearly.currency || '', business_name: uc.business_name };
      });
      const businessName = (cases.find((c) => c.business_name) || {}).business_name || '';
      const anchor = await anchorOf(req, { id: cases[0].id, use_case: cases[0].name, business_name: businessName });
      const review = await VR.reviewRun({ businessName, revenue: anchor ? anchor.business_revenue_estimate : 0, useCases: cases,
        ask: async (messages) => { const asked = await askChatModel(req, messages, 800); return asked.got ? asked.got.data : null; } });
      const saved = { ai_checked: review.ai_checked, reason: review.reason, scales: review.scales };
      await executeSql(req.dbHost, req.dbToken, warehouseId, VA.createSql(table));
      const version = await nextVersion(req, warehouseId, table, sid, VR.RUN_REVIEW_ID);
      await appendAnswers(req, warehouseId, table, { sessionId: sid, useCaseId: VR.RUN_REVIEW_ID, version, answers: { review: saved }, yearly: {}, savedBy: savedBy(req), note: 'run review' });
      return res.json({ review: { ...saved, counted_total: review.counted_total, limit: review.limit }, version });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/inspire/value/answers', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = String(sessionIdOf(req));
      const table = answersTable(req);
      const rows = await readAnswers(req, warehouseId, VA.latestSql(table, sid));
      const versions = rows.map((r) => [String(r.use_case_id), VA.versionOf(r)]);
      const stale = await staleOf(req, warehouseId, versions.map(([, v]) => v));
      return res.json({ answers: Object.fromEntries(versions.map(([id, v], i) => [id, { ...v, stale: stale[i] }])) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.put('/api/inspire/value/answers', requireToken, async (req, res) => {
    const asked = String(req.body?.table || '').trim();
    try {
      const warehouseId = warehouseOf(req);
      const sid = String(sessionIdOf(req));
      const table = answersTable(req);
      const useCaseId = q(req, 'use_case_id');
      const answers = answersOf(req);
      const yearly = answers.shape === 2 ? shape2Yearly(answers.plan, answers)
        : await estimateYearly(req, warehouseId, asked, answers).catch((err) => { throw estimateFailure(err, asked); });
      await executeSql(req.dbHost, req.dbToken, warehouseId, VA.createSql(table));
      const version = await nextVersion(req, warehouseId, table, sid, useCaseId);
      await appendAnswers(req, warehouseId, table, { sessionId: sid, useCaseId, version, answers, yearly, savedBy: savedBy(req), note: '' });
      return res.json({ version, yearly, disclaimer: VALUE_DISCLAIMER.full });
    } catch (err) {
      return sendShape2Error(res, err);
    }
  });

  app.get('/api/inspire/value/answers/history', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = String(sessionIdOf(req));
      const useCaseId = q(req, 'use_case_id');
      I.validateUseCaseId(useCaseId);
      const rows = await readAnswers(req, warehouseId, VA.historySql(answersTable(req), sid, useCaseId));
      return res.json({ history: rows.map((r) => ({ ...VA.versionOf(r), note: r.note ?? '' })) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/inspire/value/answers/undo', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = String(sessionIdOf(req));
      const table = answersTable(req);
      const useCaseId = q(req, 'use_case_id');
      I.validateUseCaseId(useCaseId);
      const [latest, previous] = (await readAnswers(req, warehouseId, VA.historySql(table, sid, useCaseId, 2))).map(VA.versionOf);
      if (!previous) throw I.badRequest('There is no earlier version of these answers to go back to.', 409);
      const version = latest.version + 1;
      await appendAnswers(req, warehouseId, table, { sessionId: sid, useCaseId, version, answers: previous.answers, yearly: previous.yearly, savedBy: savedBy(req), note: `undo of v${latest.version}` });
      return res.json({ version, answers: previous.answers, yearly: previous.yearly });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // REQ-433: Apply stores the refined Inspire scores on the use case rows and keeps the old score and the reason in history; Undo restores them.
  async function refineTables(req, warehouseId) {
    const { catalog, schema } = dbOf(req, splitInspireDatabase);
    const usecases = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    const history = `\`${catalog}\`.\`${schema}\`.\`__inspire_score_history\``;
    const have = I.describedColumnNames(await sqlRows(req.dbHost, req.dbToken, warehouseId, { sql: `DESCRIBE TABLE ${usecases}`, parameters: null }));
    const missing = SR.COLUMNS.filter(([name]) => !have.has(name));
    if (missing.length) await ensureTableColumns(req.dbHost, req.dbToken, warehouseId, usecases, missing);
    await executeSql(req.dbHost, req.dbToken, warehouseId, SR.historyCreateSql(history));
    return { usecases, history };
  }

  app.post('/api/inspire/score-refine', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = sessionIdOf(req);
      dbOf(req, splitInspireDatabase);
      const changes = SR.parseChanges(req.body?.changes, I.badRequest);
      const { usecases, history } = await refineTables(req, warehouseId);
      for (const change of changes) {
        const made = SR.applyStatements(usecases, history, sid, change);
        await executeSql(req.dbHost, req.dbToken, warehouseId, made.update.sql, made.update.parameters);
        await executeSql(req.dbHost, req.dbToken, warehouseId, made.record.sql, made.record.parameters);
      }
      return res.json({ applied: changes.map((c) => ({ use_case_id: c.use_case_id, score: c.score, from: c.from })) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/inspire/score-refine/undo', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = sessionIdOf(req);
      dbOf(req, splitInspireDatabase);
      const ids = SR.parseIds(req.body?.use_case_ids, I.badRequest);
      const { usecases, history } = await refineTables(req, warehouseId);
      const made = SR.undoStatements(usecases, history, sid, ids);
      await executeSql(req.dbHost, req.dbToken, warehouseId, made.record.sql, made.record.parameters);
      await executeSql(req.dbHost, req.dbToken, warehouseId, made.update.sql, made.update.parameters);
      return res.json({ restored: ids });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // REQ-432: the value each built use case measured, scaled the same way: its stake per scored record, to every eligible record of its
  // source table, to a year. A use case with no measured value, or no readable basis, is absent (never 0).
  // REQ-440: the measured per-year value of each use case of a run whose MVP measured money: {id: yearly}. One builder for
  // GET /api/inspire/value/yearly and the "measured" status of GET /api/inspire/value/totals.
  // `read` holds rows the caller already read for this run ({ledgerRows, specRows, tableRows}); the same statement is not sent again.
  async function measuredYearlyOf(req, warehouseId, sid, parsedDb, read = null) {
    const readOrEmpty = async (sql, parameters) => {
      try {
        return sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, sql, parameters));
      } catch (err) {
        if (isMissingTableError(err)) return [];
        throw err;
      }
    };
    const measured = IV.valueOfSession(read ? read.ledgerRows : await readOrEmpty(IV.valueSessionSql(IV.valueLedgerTable(parsedDb), String(sid)))).use_cases;
    const ids = Object.keys(measured).filter((id) => measured[id].measured && (measured[id].at_stake || []).length);
    if (!ids.length) return {};
    const [specRows, tableRows] = await Promise.all([
      read ? read.specRows : readOrEmpty(VE.latestSpecsSql(I.implementTableName(parsedDb.catalog, parsedDb.schema), sid)),
      read ? read.tableRows : readOrEmpty(`SELECT id, primary_table FROM ${IV.qualified(parsedDb, '__inspire_usecases')} WHERE session_id = ${sid}`),
    ]);
    const specs = new Map(specRows.map((r) => [String(r.use_case_id), VE.parseSpec(r.spec)]));
    const tables = new Map(tableRows.map((r) => [String(r.id), I.primaryTableOf({ primary_table: r.primary_table })]));
    const scopes = await launchScopesOf(req, warehouseId, undefined, sid);
    const basisOf = new Map();
    const eligibleOf = (table) => {
      if (!basisOf.has(table)) {
        basisOf.set(table, (async () => {
          const asked = I.columnsStatement(table);
          const dateColumn = VY.dateColumnOf(GP.scopedColumns(await sqlRows(req.dbHost, req.dbToken, warehouseId, asked), scopes, table));
          const made = dateColumn ? GP.eligibleSql(table, dateColumn, scopes) : null;
          return made ? (await readOrEmpty(made.sql, made.parameters))[0] || null : null;
        })().catch(() => null));
      }
      return basisOf.get(table);
    };
    const oneOf = async (id) => {
      const spec = specs.get(id);
      const resultTable = spec && spec.config && spec.config.result_table;
      const table = tables.get(id);
      if (!resultTable || I.resultTableNameError(resultTable) || !table) return null;
      const summary = (await readOrEmpty(`SELECT records, kpi_name, kpi_direction FROM ${I.quoteTable(`${resultTable}_summary`)} WHERE use_case_id = :uc `
        + 'ORDER BY updated_at DESC NULLS LAST LIMIT 1', [{ name: 'uc', value: id, type: 'STRING' }]).catch(() => []))[0];
      const eligible = summary ? await eligibleOf(table) : null;
      if (!summary || !eligible) return null;
      return VY.yearlyOf({ entries: measured[id].at_stake, sampled: summary.records, eligible: eligible.eligible, days: eligible.days,
        kpi: { name: summary.kpi_name, direction: summary.kpi_direction }, rule: spec.money && spec.money.rule });
    };
    const got = await mapLimit(ids, 4, oneOf);
    return Object.fromEntries(ids.map((id, i) => [id, got[i]]).filter(([, v]) => v));
  }

  app.get('/api/inspire/value/yearly', requireToken, async (req, res) => {
    try {
      const warehouseId = warehouseOf(req);
      const sid = sessionIdOf(req);
      const parsedDb = dbOf(req, splitInspireDatabase);
      return res.json({ use_cases: await measuredYearlyOf(req, warehouseId, sid, parsedDb), disclaimer: VALUE_DISCLAIMER.full });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/money/describe-value', requireToken, async (req, res) => {
    const token = req.dbToken;
    try {
      const text = String(req.body?.text ?? '').trim();
      const columns = Array.isArray(req.body?.columns) ? req.body.columns.map((c) => String(c)).slice(0, MD.COLUMN_LIMIT) : [];
      if (!text || text.length > MD.DESCRIBE_MAX_CHARS || !columns.length) throw I.badRequest('Describe how the value of each record works, in up to ' + MD.DESCRIBE_MAX_CHARS + ' characters, and name the table.');
      const endpoint = await appModelOf(req, token, {}, 'turn the description into a value; choose the value by hand');
      const messages = MD.describeMessages({ text, columns, currencyColumn: String(req.body?.currency_column ?? '') });
      const got = await invokeChatModel(chatCall(req, token), endpoint, { messages, max_tokens: 400 });
      if (!got.ok) throw I.badRequest(`the model ${endpoint} did not answer: ${got.data.message || got.data.error || `HTTP ${got.status}`}`, 502);
      const described = MD.parseDescription(got.data, columns);
      if (described.problems.length) return res.status(422).json({ error: joinSentences(...described.problems), problems: described.problems, model: endpoint });
      return res.json({ value: described.value, explanation: described.explanation, model: endpoint });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/grouping/profile', requireToken, async (req, res) => {
    const token = req.dbToken;
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
      const groupBy = GR.groupByColumns(req.body?.group_by ?? req.query.group_by);
      const [useCase, history, session] = await Promise.all([loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        loadHistory(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId),
        fetchInspireSessionWidgetRow(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid)]);
      if (!useCase) throw I.badRequest(`No use case ${useCaseId} in this session.`, 404);
      const data = builtData(history);
      table = profiledTable(useCase, data, req.body?.table ?? req.query.table);
      const main = G.groupingMainTable(table);
      if (!main || !/^[^`]+\.[^`]+\.[^`]+$/.test(table)) {
        throw I.badRequest(`${String(useCase.use_case ?? '').trim() || 'This use case'} names no main table as catalog.schema.table, so Inspire cannot read it for Data groups.`);
      }
      await refuseTableTypes(req, warehouseId, [table], { unknownType: true });
      // REQ-389: the profile reads through the Data step's choice when the wizard names one, else the Discover run's scope.
      const launchScopes = previewScopesOf(req.body?.table_scope ?? req.query.table_scope, parseTableScopeText(session?.table_scope).scopes);
      const options = (rowLimit) => ({ rowLimit, byteLimit: GP.PROFILE_BYTE_LIMIT, waitTimeout: '10s', signal: stop.signal });
      const rows = async (sql, parameters, rowLimit) => sqlResultToObjects(await executeSql(req.dbHost, token, warehouseId, sql, parameters, options(rowLimit)));
      let refusals = [];
      const view = await runWithRequestDeadline(async () => {
        const [cat, sch, tbl] = table.split('.');
        const columnsAsked = I.columnsStatement(table);
        const keysAsked = GP.keysStatement(cat, sch, tbl);
        const [allColumns, keyRows] = await Promise.all([I.readPickedTable(table, () => rows(columnsAsked.sql, columnsAsked.parameters, GP.PROFILE_META_ROWS)),
          rows(keysAsked.sql, keysAsked.parameters, GP.PROFILE_META_ROWS).catch((err) => {
            if (['SQL_DEADLINE', 'SQL_CANCELLED'].includes(err && err.code)) throw err;
            console.warn(`grouping profile: the declared keys of ${table} could not be read, so Data groups use no declared key: ${err.message}`);
            return [];
          })]);
        if (!allColumns.length) throw I.badRequest(`${U.runUnreadableTablesText([table])}.`, 403);
        const columns = GP.scopedColumns(allColumns, launchScopes, table);
        const scan = GP.scopedMain(main, launchScopes, table, columns.map((c) => c.column_name));
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
        const timeSource = GR.timeSourceOf(namedTime, columns, joins, refColumns);
        const timed = GP.scopedTime(timeSource, launchScopes, table);
        const time = timed.time;
        const joinSplit = GP.splitJoined(GR.joinedCandidates(linked, refColumns, tags, timeSource && timeSource.via ? timeSource.via.table : ''), launchScopes, table);
        const joined = joinSplit.joined;
        refusals = [...(timed.refusal ? [timed.refusal] : []), ...joinSplit.refusals];
        const text = [useCase.use_case, useCase.statement, useCase.solution].map((v) => (v == null ? '' : String(v))).join(' ');
        const candidates = GR.groupingCandidates(columns, roles, table, { primary: keys.primary, joined, text, time: time ? time.column : '', tags })
          .filter((name) => !name.includes(',')).slice(0, GR.GROUP_PROFILED);
        const profiledJoined = joined.filter((c) => candidates.includes(c.name));
        const statsQuery = GP.statement(launchScopes, (ctx) => GP.statsSql(scan, candidates, time, days, profiledJoined, ctx), scan.parameters);
        const sampleQuery = candidates.length ? GP.statement(launchScopes, (ctx) => GP.sampleSql(scan, candidates, profiledJoined, ctx), scan.parameters) : null;
        const [statRows, sample] = await Promise.all([rows(statsQuery.sql, statsQuery.parameters, 1),
          sampleQuery ? rows(sampleQuery.sql, sampleQuery.parameters, GP.PROFILE_META_ROWS) : []]);
        const stats = statRows[0] || {};
        const picked = GP.profiledColumns(stats, candidates);
        const valuesQuery = picked.length ? GP.statement(launchScopes, (ctx) => GP.valuesSql(scan, picked, profiledJoined, ctx), scan.parameters) : null;
        const values = valuesQuery ? await rows(valuesQuery.sql, valuesQuery.parameters, GP.PROFILE_VALUE_ROWS) : [];
        const deep = GP.deepSuggestionOf(useCase);
        const draft = (paths) => GP.profileView({ table, technique: useCase.analytics_technique, kind: useCase.use_case_kind, columns, candidates, stats, sample, values, paths,
          time, days, joined: profiledJoined, deep: deep ? deep.columns : [], groupBy, readAt: new Date().toISOString(), subject: text });
        const pick = GP.moneySampleColumns(columns);
        const example = pick ? await rows(GP.moneySampleSql(scan, pick), scan.parameters, GP.MONEY_SAMPLE_ROWS) : [];
        const moneyColumns = (columns || []).map((c) => String(c.column_name ?? '')).filter(Boolean);
        const withExample = (view) => ({ ...view, money_columns: moneyColumns, money_sample: pick ? { ...pick, rows: example } : null });
        const first = draft(null);
        const grouped = GR.groupByColumns(first.groups_for);
        if (grouped.length < 2) return withExample(first);
        const pathsQuery = GP.statement(launchScopes, (ctx) => GP.pathsSql(scan, grouped, profiledJoined, ctx), scan.parameters);
        const paths = await rows(pathsQuery.sql, pathsQuery.parameters, GP.PROFILE_PATH_ROWS);
        return withExample(draft(paths));
      }, GP.PROFILE_MS);
      return res.json({ ...view, deep_suggestion: GP.deepSuggestionOf(useCase), refusals });
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
      if (PM_ERROR.accessDenied(err)) return sendError(res, err);
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
      const token = (await appToken()) || '';
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
    const stalled = await stalledOf(req, C.newestVersions(history)[0]);
    const targets = C.controlTargets(history, stalled);
    return {
      sid, warehouseId, catalog, schema, useCaseId, history, targets,
      key: `${req.dbHost}|${catalog}.${schema}|${sid}|${useCaseId}|${targets.build || ''}`,
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
        // REQ-409: the job and its runs are the installed job's (run-as mode): read with the App's token when the job is an installed one.
        const jobTok = req.dbToken;
        const got = await Promise.all(names.map((name) => jsonOf(dbFetch, req.dbHost, name === 'job' || name === 'runs' ? jobTok : req.dbToken, paths[name])));
        let actions = [];
        if (!((missingControlLogs.get(ctx.logTable) || 0) > Date.now())) {
          try {
            actions = await sqlRows(req.dbHost, req.dbToken, ctx.warehouseId,
              C.controlLogSelect(ctx.logTable, { sessionId: ctx.sid, useCaseId: ctx.useCaseId }));
            missingControlLogs.delete(ctx.logTable);
          } catch (err) {
            if (!isMissingTableError(err)) throw err;
            missingControlLogs.set(ctx.logTable, Date.now() + C.CONTROL_LOG_MISSING_MS);
          }
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
      const rows = await I.readPickedTable(ctx.logTable, () => sqlRows(req.dbHost, req.dbToken, ctx.warehouseId, C.controlLogOwnerSql(ctx.catalog, ctx.schema)));
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
      // Who may cancel stays as it is (C.ownerProblem); only the read of a build's run takes the run token (REQ-409).
      const owner = await jsonOf(dbFetch, req.dbHost, await controlTokenOf(req, ctx, asset, id), C.ownerCheckPath(asset, id));
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
      missingControlLogs.delete(ctx.logTable);
      const ownerError = await alignControlLogOwner(req, ctx);
      const person = await personOf(req);
      if (C.isRunStop(asset, action)) {
        // REQ-231: the person is recorded before the run is cancelled. If the record cannot be written, nothing is cancelled.
        if (!String(person.username || '').trim()) throw I.badRequest(`Inspire did not ${phrase}: Inspire cannot tell who is stopping it`, 409);
        const recorded = C.controlLogInsert(ctx.logTable, { sessionId: ctx.sid, useCaseId: ctx.useCaseId, asset, assetId: id, action, result: 'requested', message: `${label} requested by ${person.username} from the Build page`, actedBy: person.username });
        try {
          await executeSql(req.dbHost, req.dbToken, ctx.warehouseId, recorded.sql, recorded.parameters);
        } catch (e) {
          throw I.badRequest(`Inspire did not ${phrase}: it could not record who stopped it in ${C.CONTROL_LOG_TABLE} (${e.message})`, 502);
        }
      }
      // REQ-409: a build's run is cancelled or read with the App's token when it is an installed job's run (run-as mode only).
      const callToken = await controlTokenOf(req, ctx, asset, id);
      const got = await jsonOf(dbFetch, req.dbHost, callToken, request.path,
        { method: request.method, ...(request.body ? { body: jsonWithInt64Ids(request.body, request.int64 || []) } : {}) });
      const failure = got.ok ? '' : String((got.data && (got.data.message || got.data.error || got.data.raw)) || `HTTP ${got.status}`);
      const message = got.ok ? `${label}: done` : `${label} failed: ${failure}`;
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
    return joinSentences(change && inspireJobEnvironmentWarning(jobId, { from: change.from, reason: reason(updated) }),
      tagged && inspireJobTestTagWarning(jobId, { ...tagged, reason: reason(updated) }));
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
      const carried = I.customSqlProblems(latest.spec_json?.config?.widgets);
      if (carried.length) throw I.badRequest(`${carried.join('; ')}. Build this use case again to re-run it.`);
      const widgets = I.rerunWidgets(history);
      const overrides = I.rerunOverrides(req.body?.overrides);
      const notebookParams = I.rerunParams(widgets.map((w) => w.name), overrides);
      const overrideIssues = I.widgetProblems(widgets, overrides);
      if (overrideIssues.length) throw I.badRequest(`widget values are out of range: ${overrideIssues.join('; ')}`);
      const useCase = await loadUseCase(req.dbHost, req.dbToken, warehouseId, catalog, schema, sid, useCaseId);
      await refuseUnreadableSources(req, latest.spec_json, useCase);
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

  return { loadHistory, measuredYearlyOf };
}

module.exports = { jsonOf, registerImplementRoutes };
