const express = require('express');
const VALUE_DISCLAIMER = require('./lib/valueDisclaimer.json');
const IMPLEMENT_OUTPUT_LABELS = require('./lib/implementOutputLabels.json');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { APP_DIR, BACKEND_DIR } = require('./lib/appPaths');
const { redactConsole, redactCrashes } = require('./lib/redact');
const { installerDataCatalogs } = require('./lib/installerDataCatalogs');

redactConsole();
// Load backend/.env then app/ then repo root — later files only fill keys not already set.
// Never overrides process.env so Databricks App runtime–injected vars always win.
dotenv.config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });
dotenv.config({ path: path.join(APP_DIR, '.env'), quiet: true });
dotenv.config({ path: path.join(APP_DIR, '..', '.env'), quiet: true });
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { stripAiDemoDisclaimerHtml, stripDisclaimerDeep } = require('./stripAiDisclaimer');
const { TEMPLATE_META } = require('./lib/demoDataService');
const { triggerDemoDataPipeline } = require('./lib/demoDataPipeline');
const { unreachableMessage } = require('./lib/unreachable');
const { resolveInspireAppServicePrincipalId } = require('./lib/inspireSpGrants');
const {
  inspireReleaseLabel,
  inspireJobEnvironments,
  inspireJobTags,
  inspireTaskCompute,
  inspireTagCloud,
  loadInspireTagCloud,
  normalizeUseCasesQualityParams,
  sanitizeInspireNotebookJobParams,
  normalizeV130UseCaseFields,
} = require('./lib/inspireJobParams');
const JC = require('./lib/jobCurrency');
const { notebookParamsFromSessionForGenerateRun } = require('./lib/inspireSessionParams');
const { INSPIRE_DB_SHAPE, USE_CASE_ID_SHAPE, splitInspireDatabase, isTimestampText, stepsStatement } = require('./lib/sqlInputs');
const { valueLedgerTable, valueSessionSql, valueOfSession, qualified: qualifiedInspireTable } = require('./lib/inspireValue');
const VE = require('./lib/valueEstimate');
const VT = require('./lib/valueTotals');
const VA_ANSWERS = require('./lib/valueAnswers');
const VR_REVIEW = require('./lib/valueReview');
const { normalizeUseCaseName, renameStatement } = require('./lib/useCaseName');
const { createExecuteSql, lookupWithRetry, runWithRequestDeadline } = require('./lib/sqlStatements');
const { raceLaunchCheck } = require('./lib/launchDeadline');
const { answerMs, fetchWithin } = require('./lib/answerWithin');
const { plural } = require('./lib/plural');
const { jsonOf, registerImplementRoutes } = require('./implementRoutes');
const {
  APP_TOKEN, FROM_FORWARDED_TOKEN, FROM_HEADERS, FROM_REQUEST_TOKEN, PERSON_TOKEN, SCIM_ME_PATH, forwardedTokenOf, meResponse, personTokenOf, requestPerson,
} = require('./lib/requestPerson');
const {
  discoverReads, discoverWrites, listCatalogs, listSchemas, listTables, outputPlan, runReadPlan, scopeTables, skippedTablesDetail, ucMetadataParts,
  writeRefusalBody,
} = require('./lib/ucReads');
const { isMetricViewType, metricViewSkipLine, probeTableTypes, tableTypeOfDescribe, tableTypeUnknownLine, TYPE_CHECK_BUSY_REASON, UNUSABLE_REASON } = require('./lib/metricViews');
const { createSourceAccess } = require('./lib/sourceAccess');
const { withBusyRetry } = require('./lib/busyRetry');
const { registerShowcaseRoutes, showcaseWriteGuard } = require('./lib/showcase');
const { registerMacroRoutes } = require('./macroRoutes');
const { loadSessionList, loadSessionOverviews, sessionListCap, SESSION_LIST_CAP } = require('./lib/reviewFigures');
const { LIVE_STEP_STATUSES, liveDomainsOf, liveUseCasesOf } = require('../frontend/src/lib/liveUseCases.js');
const { isInspireOwnName, isInspireOwnSchema } = require('../frontend/src/lib/inspireOwnObjects.js');
const { executiveSummaryOf, parseResultsJson, runResultsStatement } = require('./lib/runSummary');
const { appReadPermissions, permissionRequired, readStatementsFor } = require('./lib/permissions');
const { spGrantedCatalogs, grantedCatalogList, inspireStateOf, schemaInspireStates, PICKER_PROBE_CAP, partialPermission, droppedCatalogs, pickableRows, heldWrites } = require('./lib/spCatalogs');
const { planModelAccess, selfCheckRecord, MODEL_CHECK_ROUTE } = require('./lib/modelAccess');
const PM_ERROR = require('./lib/permissionError');
const { apiRefusalText, logApiBody } = require('./lib/apiRefusal');
const { tableProbeStatement, tableAccessReason, isReadDenied, liveLogPath, implementTableName, parseImplementRow, builtTableScopeOf, builtFramingOf, builtTextOf, latestBuiltRowsSql, resultTableNameError, quoteTable } = require('./lib/inspireImplement');
const { keepLongInteger, parseExactJson } = require('./lib/exactJson');
const { int64Id, isInt64Id, jsonWithInt64Ids } = require('./lib/int64Id');
const { dataFiltersOf, scopesOfSessions } = require('./lib/dataFilters');
const {
  FEEDBACK_NOT_AVAILABLE,
  isMissingTableError,
  validateFeedbackBody,
  feedbackInsertStatement,
  sessionBusinessStatement,
  feedbackHistoryStatement,
  latestFeedbackByKey,
} = require('./lib/inspireFeedback');
const { createHostedRun, workspaceFiles } = require('./lib/hostedRun');
const RP = require('./lib/routePolicy');
const LC = require('./lib/launchChoice');
const { crossSiteGuard } = require('./lib/crossSite');
const L = require('./lib/launchLedger');
const BP = require('./lib/businessProfiles');
const { workspacePathProblem, rejectUnsafeQueryPath, fsApiPath, attachmentHeader } = require('./lib/workspacePaths');
const { CACHE_REVALIDATE, compressedStatic, staticHeaders } = require('./lib/assetTypes');
const { grantJobViewer, rememberViewer, viewerNoteOf } = require('./lib/jobViewer');
const { discoveryTypeOf } = require('../frontend/src/lib/discoveryType.js');
const { generationFolder } = require('../frontend/src/lib/workspaceLinks.js');
const { createPlaceSql, quotedIdent } = require('../frontend/src/lib/tableName.js');

const app = express();
app.use(crossSiteGuard);
const routePolicy = RP.createRoutePolicy({
  enforce: () => policyEnforced(),
  appName: () => String(process.env.DATABRICKS_APP_NAME || '').trim(),
  appDatabase: () => DEFAULT_INSPIRE_DB,
  personOf: (req) => RP.forwardedPerson(req.headers),
  personToken: (req) => forwardedTokenOf(req),
  readAcl: async (req, token) => jsonOf(dbFetch, resolveHost(req), token,
    `/api/2.0/permissions/apps/${encodeURIComponent(String(process.env.DATABRICKS_APP_NAME || '').trim())}`),
  readMe: (req, token) => jsonOf(dbFetch, resolveHost(req), token, '/api/2.0/preview/scim/v2/Me'),
  readLauncher: (req, target) => readLaunchRecord(req, target),
  runRecorded: (req, runId) => runIsRecorded(req, runId),
  readHistory: (req, sessionId) => readAppDatabaseHistory(req, sessionId),
});
const routePolicyRoutes = RP.enforceRoutePolicy(app, routePolicy);
const hostedRun = createHostedRun({ files: workspaceFiles((...args) => dbFetch(...args)) });
hostedRun.useSessionCheck((req, sessionId, opts) => sessionHidden(req, sessionId, opts));
app.all('/run/:id/{*rest}', hostedRun.viewerGate, (req, res, next) => requireToken(req, res, next), hostedRun.proxy);
app.get('/run/:id', hostedRun.redirect);
app.use(showcaseWriteGuard);
app.use(express.json({ limit: '50mb', reviver: keepLongInteger }));

// SEC-07 (c23): the Inspire database (tracking tables) is the App's own. A request that names another one (query, body or launch params) gets the
// default instead, unless the caller manages the App. This runs before every route and its policy gate, so no route reads a caller's choice.
app.use('/api', async (req, res, next) => {
  try {
    if (!policyEnforced() || !String(DEFAULT_INSPIRE_DB || '').trim()) return next();
    const own = String(DEFAULT_INSPIRE_DB).trim();
    const asked = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== own;
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    const params = body && body.params && typeof body.params === 'object' ? body.params : null;
    const named = asked(req.query && req.query.inspire_database) || (body && asked(body.inspire_database)) || (params && asked(params['02_inspire_database']));
    if (!named || await isManager(req)) return next();
    if (asked(req.query.inspire_database)) {
      const query = { ...req.query, inspire_database: own };
      Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
    }
    if (body && asked(body.inspire_database)) body.inspire_database = own;
    if (params && asked(params['02_inspire_database'])) params['02_inspire_database'] = own;
    next();
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  Environment Configuration (generic — no defaults)
// ═══════════════════════════════════════════════════

// DATABRICKS_HOST: required — set by the Databricks App runtime or by the admin.
// No hardcoded workspace URL — the app is customer-agnostic.
const DATABRICKS_HOST = (process.env.DATABRICKS_HOST || '').trim();
const DEFAULT_NOTEBOOK_PATH = process.env.NOTEBOOK_PATH || '';

// Installer-injected defaults — pre-fill the Setup Wizard so users skip manual config.
const DEFAULT_WAREHOUSE_ID = process.env.INSPIRE_WAREHOUSE_ID || '';
const DEFAULT_INSPIRE_DB = process.env.INSPIRE_DATABASE || '';
// The catalogs the installer picked for the App to read (REQ-359). Null means every catalog the person can see.
const INSTALLER_DATA_CATALOGS = installerDataCatalogs(process.env.INSPIRE_DATA_CATALOGS);

// Static token (legacy / manual config) — trim so pasted PATs with trailing newlines are accepted
let SERVICE_TOKEN = (process.env.DATABRICKS_TOKEN || '').trim();

// SP OAuth credentials — Databricks App runtime injects these automatically
// when a service principal resource is declared in app.yaml.
// Fallback: installer may also set these via SP_CLIENT_ID/SP_CLIENT_SECRET env vars.
const LAUNCHER_UNKNOWN = 'unknown';
const SP_CLIENT_ID = process.env.DATABRICKS_CLIENT_ID || process.env.SP_CLIENT_ID || '';
const SP_CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET || process.env.SP_CLIENT_SECRET || '';
let spTokenCache = '';    // cached OAuth token
let spTokenExpiry = 0;    // epoch ms when cached token expires
/** In-flight OIDC fetch — concurrent callers await the same promise (singleflight). */
let spRefreshInFlight = null;
/** One chained refresh timer; cleared before rescheduling so bursts don’t stack timers. */
let spScheduledRefreshTimer = null;
const DEBUG_SP_AUTH = process.env.DEBUG_SP_AUTH === '1' || process.env.INSPIRE_DEBUG_SP_AUTH === '1';

function spOAuthTokenStillFresh() {
  if (!spTokenCache) return false;
  if (!spTokenExpiry) return true;
  return Date.now() < spTokenExpiry - 120000; // 2 min skew before expiry
}

/** True when the process has App / installer–style auth (not “host only” from a dev .env). */
function hasDatabricksPlatformAuth() {
  return !!(SERVICE_TOKEN || (SP_CLIENT_ID && SP_CLIENT_SECRET));
}

// Path to the bundled notebook file — try several candidate locations
// v47: switched from DBC archive to direct JUPYTER (.ipynb) format
const { NOTEBOOK_BUNDLE_FILE, NOTEBOOK_CANDIDATES } = require('./lib/appShell');
let BUNDLED_NOTEBOOK_PATH = NOTEBOOK_CANDIDATES.find(p => fs.existsSync(p)) || '';
const IS_IPYNB = BUNDLED_NOTEBOOK_PATH.endsWith('.ipynb');

// If no physical notebook found, try to materialize from embedded base64 bundle
if (!BUNDLED_NOTEBOOK_PATH) {
  try {
    const b64 = require(NOTEBOOK_BUNDLE_FILE);
    const materializedPath = path.join(BACKEND_DIR, 'dbx_inspire_ai_agent.ipynb');
    fs.writeFileSync(materializedPath, Buffer.from(b64, 'base64'));
    BUNDLED_NOTEBOOK_PATH = materializedPath;
    console.log('Notebook materialized from embedded bundle.');
  } catch (_) {
    BUNDLED_NOTEBOOK_PATH = NOTEBOOK_CANDIDATES[0]; // fallback path (will show "not found")
  }
}

// ═══════════════════════════════════════════════════
//  Middleware
// ═══════════════════════════════════════════════════

// CORS — only needed in dev (separate Vite server);
// in production the backend serves the static frontend.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

// Frontend build dir — `express.static` is mounted AFTER all `/api/*` routes (see SPA block below)
// so API POST/PUT never hit static file middleware first.
const STATIC_DIR = path.join(APP_DIR, 'frontend', 'dist');

/** Inspect deployed UI bundle — used to confirm "No data yet" / demo-data flow shipped. */
function getFrontendBuildInfo() {
  const indexPath = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return { ok: false, reason: 'frontend/dist/index.html missing. Run: cd frontend && npm run build' };
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  const m = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
  const jsBundle = m ? `index-${m[1]}.js` : null;
  const jsPath = jsBundle ? path.join(STATIC_DIR, 'assets', jsBundle) : null;
  let hasDemoDataUi = false;
  if (jsPath && fs.existsSync(jsPath)) {
    try {
      hasDemoDataUi = fs.readFileSync(jsPath, 'utf8').includes('No data yet');
    } catch { /* ignore */ }
  }
  return {
    ok: true,
    jsBundle,
    hasDemoDataUi,
    builtAt: jsPath ? fs.statSync(jsPath).mtime.toISOString() : null,
  };
}

// OpenAPI / API Docs
const openapiSpec = yaml.load(fs.readFileSync(path.join(BACKEND_DIR, 'openapi.yaml'), 'utf8'));
const apiDocsHtml = fs.readFileSync(path.join(BACKEND_DIR, 'api-docs.html'), 'utf8');
app.get('/api-docs', (req, res) => res.type('html').send(apiDocsHtml));
const SWAGGER_UI_DIR = [path.join(BACKEND_DIR, 'build', 'swagger-ui'), path.join(BACKEND_DIR, 'node_modules', 'swagger-ui-dist')]
  .find((dir) => fs.existsSync(path.join(dir, 'swagger-ui-bundle.js')));
app.use('/api-docs', SWAGGER_UI_DIR
  ? express.static(SWAGGER_UI_DIR, { index: false, redirect: false, setHeaders: staticHeaders })
  : (req, res) => res.status(404).type('text').send('Swagger UI is not in this App build: run app/scripts/package-for-workspace.sh, or npm ci in app/backend for local development.'));
app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));

// Request logger
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });
  }
  next();
});

registerShowcaseRoutes(app);

// Multer for file uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════

// ── SP Token Management ──
// Refresh token using client_credentials OAuth2 flow.
// Singleflight: parallel callers share one OIDC request. One scheduled timer for proactive refresh.
function scheduleSpTokenRefresh(delayMs) {
  if (spScheduledRefreshTimer) clearTimeout(spScheduledRefreshTimer);
  spScheduledRefreshTimer = setTimeout(() => {
    spScheduledRefreshTimer = null;
    refreshSpToken().catch((e) => console.error('🔑 Scheduled SP refresh failed:', e.message));
  }, delayMs);
  spScheduledRefreshTimer.unref?.();
}

async function refreshSpToken() {
  if (!SP_CLIENT_ID || !SP_CLIENT_SECRET) return;
  if (spRefreshInFlight) return spRefreshInFlight;

  const run = async () => {
    let host = DATABRICKS_HOST || '';
    if (host && !host.startsWith('http')) host = `https://${host}`;
    if (!host) return;

    if (DEBUG_SP_AUTH) console.log('🔑 SP OAuth: fetching token…');
    try {
      const resp = await fetchWithin(`${host}/oidc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: SP_CLIENT_ID,
          client_secret: SP_CLIENT_SECRET,
          scope: 'all-apis',
        }),
      }, { label: 'The sign-in token request' });
      if (resp.ok) {
        const data = await resp.json();
        spTokenCache = data.access_token || '';
        const expiresIn = data.expires_in || 3600;
        spTokenExpiry = Date.now() + expiresIn * 1000;
        if (DEBUG_SP_AUTH) console.log(`🔑 SP OAuth: cached (expires_in=${expiresIn}s)`);
        const refreshIn = Math.max((expiresIn - 300) * 1000, 60000);
        scheduleSpTokenRefresh(refreshIn);
      } else {
        const errText = await resp.text();
        console.error(`🔑 SP token refresh failed (${resp.status}): ${errText.slice(0, 300)}`);
        scheduleSpTokenRefresh(30000);
      }
    } catch (err) {
      console.error('🔑 SP token refresh error:', err.message);
      scheduleSpTokenRefresh(30000);
    }
  };

  spRefreshInFlight = run();
  try {
    await spRefreshInFlight;
  } finally {
    spRefreshInFlight = null;
  }
}

function resolveHost(req) {
  // In a deployed Databricks App with platform auth, always use the runtime-injected host.
  // A stale X-Databricks-Host from browser localStorage can point at another workspace and
  // make Unity Catalog calls use the wrong realm while the token is still the app SP.
  if (process.env.NODE_ENV === 'production' && DATABRICKS_HOST && hasDatabricksPlatformAuth()) {
    let h = String(DATABRICKS_HOST).replace(/\/+$/, '');
    if (h && !h.startsWith('http')) h = `https://${h}`;
    return h || null;
  }
  let host = req.headers['x-databricks-host'] || DATABRICKS_HOST || '';
  host = host.replace(/\/+$/, '');
  if (host && !host.startsWith('http')) host = `https://${host}`;
  return host || null;
}

async function dbFetch(host, token, apiPath, options = {}) {
  if (!host) throw new Error('Databricks host not configured.');
  const url = `${host}${apiPath}`;
  const { idempotent = false, ...init } = options;
  const method = init.method || 'GET';
  const ms = answerMs();
  let resp;
  try {
    resp = await withBusyRetry(() => fetchWithin(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    }, { ms, label: `Databricks ${method} ${apiPath.split('?')[0]}` }), { method, signal: init.signal, retryNetwork: idempotent || method === 'GET' });
  } catch (e) {
    if (e && e.timedOut) throw e;
    throw new Error(unreachableMessage(host, e, policyEnforced()));
  }
  return resp;
}

/** SQL warehouse fallback when REST catalog list is empty (SP often sees catalogs here first). */
async function listCatalogNamesSql(host, token, warehouseId) {
  if (!warehouseId) return [];
  try {
    const result = await executeSql(host, token, warehouseId, 'SHOW CATALOGS');
    const rows = sqlResultToObjects(result);
    const names = [];
    for (const row of rows) {
      const n =
        row.catalog ??
        row.CATALOG ??
        row.catalog_name ??
        row.namespace ??
        (typeof row.database === 'string' ? row.database : null);
      if (n && typeof n === 'string' && !n.startsWith('__')) names.push(n);
    }
    return [...new Set(names)].sort();
  } catch (err) {
    console.warn(`   ⚠️ SHOW CATALOGS fallback failed: ${err.message}`);
    return [];
  }
}

async function listSchemasSql(host, token, warehouseId, catalog) {
  if (!warehouseId || !catalog) return [];
  try {
    const stmt = `SHOW SCHEMAS IN ${quotedIdent(catalog)}`;
    const result = await executeSql(host, token, warehouseId, stmt);
    const rows = sqlResultToObjects(result);
    const out = [];
    for (const row of rows) {
      const name =
        row.databaseName ??
        row.database_name ??
        row.namespace ??
        row.schemaName ??
        row.name;
      if (!name || typeof name !== 'string') continue;
      const full = `${catalog}.${name}`;
      out.push({ name, full_name: full, comment: '' });
    }
    return out;
  } catch (err) {
    console.warn(`   ⚠️ SHOW SCHEMAS fallback failed for ${catalog}: ${err.message}`);
    return [];
  }
}

// One table's type from DESCRIBE TABLE EXTENDED ... AS JSON, its documented "type" field (METRIC_VIEW for a metric view).
// Null when it cannot be read; the caller keeps such a table listed.
// { type } from DESCRIBE ... AS JSON, or { type: null, transient } when the lookup failed; a transient failure is retried once.
async function tableTypeByDescribe(host, token, warehouseId, catalog, schema, name) {
  const got = await lookupWithRetry(() => executeSql(host, token, warehouseId,
    `DESCRIBE TABLE EXTENDED ${quotedIdent(catalog)}.${quotedIdent(schema)}.${quotedIdent(name)} AS JSON`));
  if (got.error) return { type: null, transient: got.transient };
  return { type: tableTypeOfDescribe(got.value.result?.data_array?.[0]?.[0]), transient: false };
}

// `known` holds the full names the REST listing already typed (and the metric views it hid); only the other names are probed.
async function listTablesSql(host, token, warehouseId, catalog, schema, known = new Set()) {
  if (!warehouseId || !catalog || !schema) return { rows: [], leftOut: 0, metricViews: [] };
  try {
    const stmt = `SHOW TABLES IN ${quotedIdent(catalog)}.${quotedIdent(schema)}`;
    const result = await executeSql(host, token, warehouseId, stmt);
    const rows = sqlResultToObjects(result);
    // SHOW TABLES does not say which names are metric views, so the catalog's own table types decide. When information_schema
    // cannot be read, each name the REST listing did not type is read with DESCRIBE TABLE EXTENDED ... AS JSON instead.
    const metricViewNames = new Set();
    const unknownNames = new Set();
    // A name whose type check the workspace could not answer twice: listed as busy, neither usable nor not usable.
    const busyNames = new Set();
    const leftOutNames = new Set();
    let leftOut = 0;
    const probedTypes = new Map();
    try {
      const typed = await executeSql(host, token, warehouseId,
        `SELECT table_name FROM ${quotedIdent(catalog)}.information_schema.tables WHERE table_schema = '${escapeSqlStringLiteral(schema)}' `
        + `AND table_type IN ('METRIC_VIEW', 'METRIC VIEW')`);
      for (const row of sqlResultToObjects(typed)) if (row.table_name) metricViewNames.add(row.table_name);
    } catch (err) {
      console.warn(`   ⚠️ metric view check failed for ${catalog}.${schema}: ${err.message}`);
      const names = rows.map((r) => r.tableName ?? r.table_name ?? r.name)
        .filter((n) => typeof n === 'string' && n && !known.has(`${catalog}.${schema}.${n}`));
      const { types, beyond } = await probeTableTypes(names,
        (name) => tableTypeByDescribe(host, token, warehouseId, catalog, schema, name));
      for (const [name, { type, transient }] of types) {
        if (type) {
          if (isMetricViewType(type)) metricViewNames.add(name);
          else probedTypes.set(name, type);
        } else if (transient) busyNames.add(name);
        else unknownNames.add(name);
      }
      // Names beyond the probe cap are not typed and not shown: they are counted, and the picker says so.
      for (const name of beyond) leftOutNames.add(name);
      leftOut = beyond.length;
      if (unknownNames.size) console.log(tableTypeUnknownLine(unknownNames.size, `${catalog}.${schema}`));
    }
    if (metricViewNames.size) console.log(metricViewSkipLine([...metricViewNames]));
    const out = [];
    for (const row of rows) {
      const tname = row.tableName ?? row.table_name ?? row.name;
      if (!tname || typeof tname !== 'string' || metricViewNames.has(tname) || leftOutNames.has(tname)) continue;
      out.push({
        name: tname,
        full_name: `${catalog}.${schema}.${tname}`,
        catalog_name: catalog,
        schema_name: schema,
        table_type: busyNames.has(tname) ? '' : (probedTypes.get(tname) || 'MANAGED'),
        data_source_format: '',
        updated_at: null,
        created_at: null,
        comment: '',
        owner: '',
        columns: 0,
        // Fail closed: a table whose type cannot be read is shown as not usable, with the plain reason.
        ...(unknownNames.has(tname) ? { usable: false, unusable_reason: UNUSABLE_REASON } : {}),
        ...(busyNames.has(tname) ? { type_check: 'busy', unusable_reason: TYPE_CHECK_BUSY_REASON } : {}),
      });
    }
    return { rows: out, leftOut, metricViews: [...metricViewNames] };
  } catch (err) {
    console.warn(`   ⚠️ SHOW TABLES fallback failed for ${catalog}.${schema}: ${err.message}`);
    return { rows: [], leftOut: 0, metricViews: [] };
  }
}

// The App's own credentials as this process sees them now. getToken reads them through this seam, so a test can pass others.
function currentAppTokens() {
  return {
    production: process.env.NODE_ENV === 'production',
    serviceToken: SERVICE_TOKEN,
    spCredentials: Boolean(SP_CLIENT_ID && SP_CLIENT_SECRET),
    spTokenFresh: spOAuthTokenStillFresh(),
    spTokenCached: spTokenCache,
  };
}

// Synchronous token resolution — uses pre-warmed cached token.
function getToken(req) {
  return tokenFor(req, currentAppTokens());
}

function tokenFor(req, app) {
  // Local dev: PAT from .env wins over browser headers so rotating DATABRICKS_TOKEN works without clearing localStorage.
  if (!app.production && app.serviceToken) {
    return app.serviceToken;
  }

  // REQ-418: in a Databricks App the reads use the App's service principal only. A token the browser sends (a pasted PAT or a Bearer
  // header) is a person's token, so it is ignored there.
  if (!app.production) {
    // 1) Explicit PAT from frontend header
    const pat = req.headers['x-db-pat-token'];
    if (pat) return String(pat).trim();

    // 2) Authorization Bearer header
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const bearer = auth.slice(7).trim();
      if (bearer) return bearer;
    }
  }

  const forwardedClean = forwardedTokenOf(req);

  // 3–5) Databricks App (production + SP): prefer static / SP token over x-forwarded-access-token.
  // Delegated user tokens expire; Inspire Results/SQL should keep working on the app service principal.
  const spBackedApp = app.production && app.spCredentials;
  if (spBackedApp) {
    if (app.serviceToken) return app.serviceToken;
    if (app.spTokenFresh) return app.spTokenCached;
    if (app.spTokenCached) return app.spTokenCached;
    return null;
  }
  if (app.production) return app.serviceToken || app.spTokenCached || null;

  if (forwardedClean) return forwardedClean;
  if (app.serviceToken) return app.serviceToken;
  if (app.spTokenCached) return app.spTokenCached;

  return null;
}

function tokenKindOf(token) {
  if (spTokenCache && token === spTokenCache) return APP_TOKEN;
  if (SERVICE_TOKEN && token === SERVICE_TOKEN && process.env.NODE_ENV === 'production') return APP_TOKEN;
  return PERSON_TOKEN;
}

const personOf = (req) => requestPerson(req, (token) => jsonOf(dbFetch, req.dbHost, token, SCIM_ME_PATH));
const ME_SOURCES = { [FROM_HEADERS]: 'proxy', [FROM_FORWARDED_TOKEN]: 'proxy', [FROM_REQUEST_TOKEN]: 'token' };

async function refreshSpTokenIfStale() {
  if (SP_CLIENT_ID && SP_CLIENT_SECRET) {
    const needRefresh = !spTokenCache || !spTokenExpiry || Date.now() >= spTokenExpiry - 120000;
    if (needRefresh) await refreshSpToken();
  }
}

// REQ-418: every read, check and launch runs as the App's service principal, so this is the token for all of them.
async function appOwnToken() {
  await refreshSpTokenIfStale();
  return SERVICE_TOKEN || spTokenCache || null;
}


async function currentManagerCheck(req) {
  if (!policyEnforced()) return { check: 'not needed: Inspire runs outside a Databricks App, so every request uses the developer token', manager: null };
  const verdict = await routePolicy.managerOf(req);
  if (verdict.unreadable) return { check: `Inspire cannot tell who manages this App, so every manager action is refused: ${verdict.unreadable}`, manager: null };
  return { check: 'ok', manager: verdict.manager };
}

function policyEnforced() {
  return process.env.NODE_ENV === 'production' || Boolean(String(process.env.DATABRICKS_APP_NAME || '').trim());
}

async function requireToken(req, res, next) {
  try {
    await refreshSpTokenIfStale();
    const token = getToken(req);
    req.dbToken = token || '';
    req.dbTokenKind = tokenKindOf(token);
    if (RP.identityFor(req.policyKey) === 'person') {
      req.dbToken = personTokenOf(req);
      req.dbTokenKind = PERSON_TOKEN;
      if (!req.dbToken) return res.status(401).json(RP.noPersonTokenBody(req.policyKey));
    } else if (!token) {
      console.error(`🔒 No token for ${req.method} ${req.path} | forwarded=${!!forwardedTokenOf(req)} spCache=${!!spTokenCache} serviceToken=${!!SERVICE_TOKEN}`);
      return res.status(401).json({ error: 'No authentication token available.' });
    }
    req.dbHost = resolveHost(req);
    if (!req.dbHost) {
      return res.status(400).json({ error: 'Databricks host not configured.' });
    }
    runWithRequestDeadline(next);
  } catch (err) {
    console.error(`🔒 requireToken error: ${err.message}`);
    next(err);
  }
}

// SEC-14 (c23): inside a Databricks App these routes need the App's token like every other route; local development has no host or token to ask for.
function appRequiresToken(req, res, next) {
  return policyEnforced() ? requireToken(req, res, next) : next();
}

const executeSql = createExecuteSql(dbFetch);

// Helper: convert SQL result to array of objects
function sqlResultToObjects(result) {
  const columns = result.manifest?.schema?.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    console.warn('sqlResultToObjects: missing or empty manifest.schema.columns; treating as 0 rows.');
    return [];
  }
  const colNames = columns.map(c => c.name);
  const rows = result.result?.data_array || [];
  return rows.map(row => {
    const obj = {};
    colNames.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

/** inspire_database must be exactly `catalog_name`.`schema_name` (one dot). */
function invalidSessionId(sessionId) {
  return sessionId != null && String(sessionId).trim() !== '' && !isInt64Id(sessionId);
}

function escapeSqlStringLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

/** True if ALTER TABLE ADD COLUMN failed only because the column is already present. */
function isAlterAddColumnAlreadyExistsError(message) {
  const m = String(message || '');
  return (
    /already exists|ALREADY_EXISTS|DUPLICATE_COLUMN|FIELD_ALREADY_EXISTS|already present|already defined|is already a column|Cannot add column.*already|nested column.*already exists|Column.*already exists|duplicate column name|field.*already exists|Duplicate field/i.test(
      m,
    )
  );
}

async function ensureTableColumns(host, token, warehouseId, table, columns) {
  const tryAddColumn = async (colName, colType) => {
    const colSql = `${colName} ${colType}`;
    const variants = [
      `ALTER TABLE ${table} ADD COLUMN ${colSql}`,
      `ALTER TABLE ${table} ADD COLUMNS (${colSql})`,
    ];
    for (let i = 0; i < variants.length; i++) {
      const sql = variants[i];
      try {
        await executeSql(host, token, warehouseId, sql);
        console.log(`   📌 Added column ${colName} (${i === 0 ? 'ADD COLUMN' : 'ADD COLUMNS'})`);
        return;
      } catch (e) {
        const msg = e.message || String(e);
        if (isAlterAddColumnAlreadyExistsError(msg)) {
          return;
        }
        const tryNext =
          i < variants.length - 1 &&
          /PARSE_SYNTAX_ERROR|ParseException|syntax error|near `ADD`|Unsupported operation|ParsingException|INVALID_SYNTAX|unexpected/i.test(
            msg,
          );
        if (tryNext) {
          console.warn(`   ⚠️ ${colName}: trying alternate ALTER syntax (${msg.substring(0, 140)})`);
          continue;
        }
        throw e;
      }
    }
  };
  for (const [colName, colType] of columns) await tryAddColumn(colName, colType);
}

/**
 * Older __inspire_usecases Delta tables lack Route-1 Genie columns; add them before UPDATE.
 * Tries `ADD COLUMN` (Spark/Inspire notebook style), then `ADD COLUMNS (...)` if the warehouse
 * rejects the first form. Ignores "already exists" so this is safe to repeat.
 */
async function ensureUsecasesGenieRoute1Columns(host, token, warehouseId, ucTable) {
  await ensureTableColumns(host, token, warehouseId, ucTable, [
    ['generate_genie_code_instruction', 'STRING'],
    ['has_genie_code', 'STRING'],
  ]);
}

function workspaceOriginFromHost(host) {
  const h = String(host || '').trim().replace(/\/$/, '');
  if (!h) return '';
  return h.startsWith('http') ? h : `https://${h}`;
}

/** Deep link to a one-off job run in the Databricks workspace UI. */
function databricksJobRunUrl(host, jobId, runId) {
  const origin = workspaceOriginFromHost(host);
  if (!origin || jobId == null || runId == null) return null;
  return `${origin}/#job/${encodeURIComponent(String(jobId))}/run/${encodeURIComponent(String(runId))}`;
}

/**
 * Route 1: one UPDATE per request (fewer Delta commits than reset+mark) + retries on row conflicts.
 * Selected ids → generate_genie_code_instruction Yes + has_genie_code N; others in session → flag No; has_genie unchanged.
 * Empty safeIds → only reset generate_genie_code_instruction to No for the session.
 */
async function runRoute1GenieFlagUpdates(host, token, warehouseId, catalog, schema, sidStr, safeIds) {
  const ucTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
  const inList =
    safeIds.length > 0 ? safeIds.map((id) => `'${escapeSqlStringLiteral(id)}'`).join(',') : '';
  const flagSql =
    safeIds.length === 0
      ? `UPDATE ${ucTable} SET generate_genie_code_instruction = 'No' WHERE session_id = ${sidStr}`
      : `UPDATE ${ucTable} SET
          generate_genie_code_instruction = CASE WHEN id IN (${inList}) THEN 'Yes' ELSE 'No' END,
          has_genie_code = CASE WHEN id IN (${inList}) THEN 'N' ELSE has_genie_code END
        WHERE session_id = ${sidStr}`;

  const runOnce = async () => {
    await executeSql(host, token, warehouseId, flagSql);
  };

  await ensureUsecasesGenieRoute1Columns(host, token, warehouseId, ucTable);
  try {
    await runOnce();
  } catch (e) {
    const m = e.message || String(e);
    if (
      !/UNRESOLVED_COLUMN|42703|cannot be resolved.*generate_genie_code_instruction|generate_genie_code_instruction.*cannot be resolved/i.test(
        m,
      )
    ) {
      throw e;
    }
    console.warn('   🔄 Route1 flags: column unresolved; re-running schema ensure and retry.');
    await ensureUsecasesGenieRoute1Columns(host, token, warehouseId, ucTable);
    await runOnce();
  }
}

async function fetchInspireSessionWidgetRow(host, token, warehouseId, catalog, schema, sessionIdStr) {
  const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;
  const widgetColsBase = `business_name, inspire_database_name, operation_mode, table_election_mode, use_cases_quality, strategic_goals, business_priorities, business_domains, catalogs, schemas_str, tables_str, generate_choices, generation_path, output_language, sql_generation_per_domain, technical_exclusion_strategy, json_file_path`;
  const widgetColsV08 = `${widgetColsBase}, enriched_business_context, enriched_strategic_goals, enriched_business_priorities, enriched_strategic_initiative, enriched_value_chain, enriched_revenue_model, generation_instructions_section`;
  const widgetColsV13 = `${widgetColsV08}, discovery_type, strategic_context`;
  const widgetColsV14 = `${widgetColsV13}, table_scope`;
  const baseCols = `session_id, processing_status, completed_percent, create_at, last_updated, completed_on, inspire_json, results_json`;
  const columnSets = [widgetColsV14, widgetColsV13, widgetColsV08, widgetColsBase];
  for (let i = 0; i < columnSets.length; i++) {
    const sql = `SELECT ${baseCols}, ${columnSets[i]} FROM ${table} WHERE session_id = ${sessionIdStr} LIMIT 1`;
    try {
      const result = await executeSql(host, token, warehouseId, sql);
      const rows = sqlResultToObjects(result);
      return rows[0] || null;
    } catch (e1) {
      const msg = String(e1.message || e1);
      const missingColumn = /discovery_type|strategic_context|table_scope|enriched_|generation_instructions_section|UNRESOLVED_COLUMN|FIELD_NOT_FOUND|cannot resolve/i.test(msg);
      if (!missingColumn || i === columnSets.length - 1) throw e1;
    }
  }
  return null;
}

/**
 * Resolve a workspace path to a NOTEBOOK path Jobs can execute (not a bare folder).
 * Tries DIRECTORY listing and /Users/... vs /Workspace/Users/... when get-status fails on legacy paths.
 * @returns {Promise<string|null>}
 */
async function resolveWorkspaceNotebookObjectPath(host, token, candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  const trimmed = candidatePath.trim();
  if (!trimmed) return null;

  const tryPath = async (basePath) => {
    const statusResp = await dbFetch(host, token, `/api/2.0/workspace/get-status?path=${encodeURIComponent(basePath)}`);
    if (!statusResp.ok) return null;
    let statusData;
    try {
      statusData = await statusResp.json();
    } catch {
      return null;
    }
    const type = statusData.object_type;
    if (type === 'NOTEBOOK') return basePath;
    if (type === 'DIRECTORY') {
      const listResp = await dbFetch(host, token, `/api/2.0/workspace/list?path=${encodeURIComponent(basePath)}`);
      if (!listResp.ok) return null;
      let listData;
      try {
        listData = await listResp.json();
      } catch {
        return null;
      }
      const notebook = (listData.objects || []).find((o) => o.object_type === 'NOTEBOOK');
      return notebook && notebook.path ? notebook.path : null;
    }
    return null;
  };

  let found = await tryPath(trimmed);
  if (found) return found;
  if (trimmed.startsWith('/Users/') && !trimmed.startsWith('/Workspace/')) {
    found = await tryPath(`/Workspace${trimmed}`);
    if (found) return found;
  }
  return null;
}

/**
 * Create a one-off job and trigger run-now (shared by /api/run and /api/inspire/generate-genie).
 * @param {object} opts
 * @param {Record<string,string>} opts.params notebook base_parameters
 * @param {string} [opts.notebook_path]
 * @param {string} [opts.cluster_id]
 * @param {'discovery'|'genie_regen'|'implement'} [opts.jobType]
 * @param {string} [opts.jobName]
 */
let launchTableReady = false;

async function launchSql(host, statement, token) {
  return sqlResultToObjects(await executeSql(host, token, DEFAULT_WAREHOUSE_ID, statement.sql, statement.parameters));
}

// The route-policy gate runs BEFORE requireToken, so req.dbToken and req.dbHost are not set yet when a policy reader runs (the live
// read sent no credential: "Credential was not sent" 401, then 403 "no record"). These readers take the App's own credential from the
// same source requireToken uses for an app-identity route (getToken), which is the credential recordLaunch INSERTed with. A missing
// credential throws, so the route answers 503 and tries again, never a permanent "no record".
async function policyReadToken(req) {
  await refreshSpTokenIfStale();
  const token = getToken(req);
  if (!token) throw new Error('Inspire has no credential of its own to read its launch record with');
  return token;
}

async function readLaunchRecord(req, target) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  if (!table || !DEFAULT_WAREHOUSE_ID) return null;
  const statement = target.kind === 'run'
    ? L.runLauncherStatement(table, target.runId)
    : L.sessionLauncherStatement(table, target.inspireDatabase, target.sessionId);
  if (!statement) return null;
  const token = await policyReadToken(req);
  try {
    return L.launcherOf(await launchSql(resolveHost(req), statement, token));
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function runIsRecorded(req, runId) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  const statement = table && DEFAULT_WAREHOUSE_ID ? L.runLauncherStatement(table, runId) : null;
  if (!statement) return false;
  const token = await policyReadToken(req);
  try {
    return (await launchSql(resolveHost(req), statement, token)).length > 0;
  } catch (err) {
    if (isMissingTableError(err)) return false;
    throw err;
  }
}

async function readAppDatabaseHistory(req, sessionId) {
  const parsed = splitInspireDatabase(DEFAULT_INSPIRE_DB);
  if (!parsed || !DEFAULT_WAREHOUSE_ID) return [];
  const token = await policyReadToken(req);
  return implementApi.loadHistory(resolveHost(req), token, DEFAULT_WAREHOUSE_ID, parsed.catalog, parsed.schema, sessionId, null);
}

// A read that fails is not a new session: a strict caller (the launch check) gets the error and answers 503; the others treat it as not new.
async function sessionIsNew(host, token, inspireDatabase, sessionId, { strict = false } = {}) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  const statements = DEFAULT_WAREHOUSE_ID ? L.sessionKnownStatements(table || '', inspireDatabase, sessionId) : null;
  if (!statements) return false;
  for (const statement of table ? [statements.ledger, statements.session] : [statements.session]) {
    try {
      if ((await launchSql(host, statement, token)).length) return false;
    } catch (err) {
      if (!isMissingTableError(err)) {
        if (strict) throw err;
        return false;
      }
    }
  }
  return true;
}

function launchRecordUnreadable(label, err) {
  return Object.assign(new Error(`Inspire could not read the launch record of ${label} just now (${String(err.message).replace(/\s+/g, ' ')}), so it cannot tell whether this may be launched; try again`), { statusCode: 503 });
}

async function isManager(req) {
  if (!policyEnforced()) return true;
  if (!req) return false;
  return Boolean((await routePolicy.managerOf(req).catch(() => ({ manager: false }))).manager);
}

async function launchChoiceOf(req, notebookPath, clusterId) {
  const asked = { notebookPath, clusterId };
  const own = { notebooks: [DEFAULT_NOTEBOOK_PATH, NOTEBOOK_DEST, cachedNotebookPath],
    clusters: [process.env.INSPIRE_CLUSTER_ID, process.env.INSPIRE_DEPLOY_CLUSTER_ID] };
  const plain = LC.ownLaunch(asked, own);
  if (!plain.warnings.length) return plain;
  return (await isManager(req)) ? LC.ownLaunch(asked, { ...own, chooses: true }) : plain;
}

async function launchSessionProblem(req, params) {
  const sessionId = String(params['14_session_id'] || '').trim();
  const inspireDatabase = String(params['02_inspire_database'] || '').trim();
  if (!policyEnforced() || !sessionId || !splitInspireDatabase(inspireDatabase)) return '';
  if (!isInt64Id(sessionId)) return 'The session id must be a numeric Inspire session id';
  const host = resolveHost(req);
  let fresh;
  let launcher;
  try {
    fresh = await sessionIsNew(host, req.dbToken, inspireDatabase, sessionId, { strict: true });
    if (fresh) return '';
    launcher = String(await readLaunchRecord(req, { kind: 'session', inspireDatabase, sessionId }) || '').trim().toLowerCase();
  } catch (err) {
    throw launchRecordUnreadable(`session ${sessionId}`, err);
  }
  const person = RP.forwardedPerson(req.headers);
  const owns = Boolean(launcher) && launcher === person;
  return LC.sessionLaunchProblem(sessionId, { fresh, launcher, person, manager: owns ? false : await isManager(req) });
}

async function startingSessions(req, inspireDatabase, warehouseId, listed) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  const statement = table && DEFAULT_WAREHOUSE_ID ? L.startingLaunchStatement(table, inspireDatabase) : null;
  if (!statement) return [];
  try {
    const host = resolveHost(req);
    const shown = new Set(listed.map((s) => int64Id(s.session_id)).filter(Boolean));
    let launches = (await launchSql(host, statement, req.dbToken)).filter((l) => isInt64Id(l.session_id) && !shown.has(int64Id(l.session_id)));
    const seen = L.sessionsSeenStatement(inspireDatabase, launches.map((l) => l.session_id));
    if (!seen) return [];
    const known = new Set(sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, seen.sql, seen.parameters)).map((r) => String(r.session_id)));
    launches = launches.filter((l) => !known.has(String(l.session_id)));
    if (!launches.length) return [];
    const token = req.dbToken;
    const rows = await Promise.all(launches.map(async (launch) => {
      const resp = await dbFetch(host, token, `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(launch.run_id)}`);
      return resp.ok ? L.startingSessionRow(launch, parseExactJson(await resp.text()), inspireDatabase) : null;
    }));
    return rows.filter(Boolean);
  } catch (err) {
    if (!isMissingTableError(err)) console.warn(`[sessions] the runs that are still starting could not be read, so Start lists only runs that wrote their first row: ${err.message}`);
    return [];
  }
}

// The record write has a bound: a warehouse that never leaves PENDING must not hold the launch open (executeSql has no deadline of its own).
const LAUNCH_RECORD_MS = 60000;

// Whether the ledger holds a row for the run: true or false when it could read, null when it could not say.
async function launchRecordedFor(host, token, runId) {
  const stmt = L.runLauncherStatement(L.launchTableName(DEFAULT_INSPIRE_DB), runId);
  if (!stmt || !DEFAULT_WAREHOUSE_ID) return null;
  try {
    const got = await executeSql(host, token, DEFAULT_WAREHOUSE_ID, stmt.sql, stmt.parameters, { signal: AbortSignal.timeout(LAUNCH_RECORD_MS) });
    return (got?.result?.data_array || []).length > 0;
  } catch (err) {
    return isMissingTableError(err) ? false : null;
  }
}

async function recordLaunch(host, token, record) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  if (!table || !DEFAULT_WAREHOUSE_ID) {
    return { recorded: false, note: 'Inspire has no database of its own set, so it did not record who launched this run, and only App managers can cancel it' };
  }
  try {
    if (!launchTableReady) {
      await executeSql(host, token, DEFAULT_WAREHOUSE_ID, L.launchCreateSql(table));
      launchTableReady = true;
    }
    const insert = L.launchInsertStatement(table, record);
    await executeSql(host, token, DEFAULT_WAREHOUSE_ID, insert.sql, insert.parameters, { signal: AbortSignal.timeout(LAUNCH_RECORD_MS) });
    return { recorded: true };
  } catch (err) {
    console.warn(`launch record write failed for run ${record.runId}: ${err.message}`);
    // An answer the warehouse gave (a refused or failed statement) means the insert did not land. Only a write whose answer was lost
    // (the bound fired and the statement was cancelled, or the network dropped) may have landed.
    const ambiguous = err.code === 'SQL_CANCELLED' || /^Cannot reach/.test(String(err.message || ''));
    return { recorded: false, failed: true, ambiguous, note: `Inspire could not record who launched this run (${err.message}), so only App managers can cancel it` };
  }
}

// The run is already submitted when its record is written, so a write that fails twice must not leave a run nobody can cancel.
// The write is retried once. If it still fails, the run is stopped (the same credential that submitted it asks Databricks to cancel it)
// and the launch answers 503. Only when that stop also fails does the run stay, and then the launch carries a warning naming it.
async function recordLaunchOrStop(host, token, record, cancelToken = token) {
  let launch = await recordLaunch(host, token, record);
  if (launch.recorded || !launch.failed) return launch;
  launch = await recordLaunch(host, token, record);
  if (launch.recorded || !launch.failed) return launch;
  // Only a write whose answer was lost may have landed (see recordLaunch). Then the ledger decides: a row, or a lookup that cannot answer, keeps the run.
  if (launch.ambiguous && (await launchRecordedFor(host, token, record.runId)) !== false) {
    return { ...launch, warning: `Inspire started run ${record.runId} but could not confirm its record, so it did not stop the run. Cancel it from the App managers if it is not wanted` };
  }
  const stopped = await dbFetch(host, cancelToken, '/api/2.1/jobs/runs/cancel', {
    method: 'POST',
    body: jsonWithInt64Ids({ run_id: record.runId }, ['run_id']),
  }).then((r) => r.ok, () => false);
  if (stopped) {
    throw Object.assign(new Error(`Inspire could not record run ${record.runId}, so it asked Databricks to stop the run. Start it again.`), { statusCode: 503 });
  }
  return { ...launch, warning: `Inspire started run ${record.runId} but could not record it, so Cancel and Run again may refuse it` };
}

async function triggerInspireNotebookJob(host, token, { params, notebook_path, cluster_id: askedClusterId, jobType = 'discovery', jobName: requestedJobName = '', useCaseIds = [], useCaseName = '', launchedBy = '', writeCheck = null, asker = null, scopePicks = undefined }) {
  normalizeUseCasesQualityParams(params);
  // Discover has no Measure rule yet: it sends the reporting currency and today's rates (or the saved averages offline).
  // Implement sends its own rule's currency and rates from startVersion, so this only fills a Discover launch.
  if (jobType !== 'implement' && !('currency_rates' in params)) Object.assign(params, await JC.discoverCurrencyParams(params));
  const sanitized = sanitizeInspireNotebookJobParams(params, { scopePicks });
  for (const k of Object.keys(params)) delete params[k];
  Object.assign(params, sanitized);

  const choice = await launchChoiceOf(asker, notebook_path, askedClusterId);
  const cluster_id = choice.clusterId;
  let resolvedPath = String(choice.notebookPath || DEFAULT_NOTEBOOK_PATH || '').trim();
  console.log(`📓 Notebook resolution: frontend="${notebook_path || ''}", env="${DEFAULT_NOTEBOOK_PATH}", resolved="${resolvedPath}"`);

  if (resolvedPath) {
    try {
      const verified = await resolveWorkspaceNotebookObjectPath(host, token, resolvedPath);
      if (verified) {
        resolvedPath = verified;
        console.log(`📓 Resolved configured path to runnable notebook: ${resolvedPath}`);
      } else {
        console.warn(
          `⚠️ Notebook path missing, no permission, or folder has no .ipynb: "${resolvedPath}". Using ${NOTEBOOK_DEST} (auto-publish).`,
        );
        resolvedPath = '';
      }
    } catch (e) {
      console.warn(`⚠️ Notebook path verify error: ${e.message || e}`);
      resolvedPath = '';
    }
  }

  if (!resolvedPath) {
    try {
      const pub = await ensureNotebookPublished(host, token);
      resolvedPath = pub.path;
      console.log(
        pub.republished
          ? `📓 Notebook re-published to workspace: ${resolvedPath}`
          : `📓 Using workspace notebook: ${resolvedPath}`,
      );
    } catch (pubErr) {
      const err = new Error(`Could not auto-publish notebook: ${pubErr.message}`);
      err.statusCode = 400;
      throw err;
    }
  }

  try {
    const verified = await resolveWorkspaceNotebookObjectPath(host, token, resolvedPath);
    if (verified) resolvedPath = verified;
  } catch (_) {}

  const writes = writeCheck ? discoverWrites(params, resolvedPath) : null;
  let outputChecked = '';
  let outputFolder = writes ? writes.folders[0] : '';
  const warnings = [...choice.warnings];
  const warningDetails = [];
  if (writes) {
    const verdict = await writeCheck(writes);
    if (verdict.refused) throw Object.assign(new Error(verdict.refused.message), { statusCode: verdict.refused.status, writeRefusal: verdict.refused });
    outputChecked = verdict.checked;
    if (verdict.generationPath) params['11_generation_path'] = verdict.generationPath;
    if (verdict.folder) outputFolder = verdict.folder;
    warnings.push(...verdict.warnings);
    warningDetails.push(...(verdict.details || []));
  }

  const businessName = params['00_business_name'] || 'Run';
  const jobName = requestedJobName || `Inspire AI - ${businessName} - ${new Date().toISOString().slice(0, 19)}`;
  const notebookFilename = resolvedPath.split('/').pop() || 'inspire_notebook';
  const inspireRunType = jobType === 'genie_regen' ? 'genie_regen' : (jobType === 'implement' ? 'implement' : 'discovery');
  const launchSession = String(params['14_session_id'] || '').trim();
  const launchDatabase = String(params['02_inspire_database'] || '').trim();
  const openedSession = Boolean(launchedBy) && inspireRunType === 'discovery' && await sessionIsNew(host, token, launchDatabase, launchSession);

  const createPayload = {
    name: jobName,
    tags: inspireJobTags({ runType: inspireRunType, params, businessName, notebookFilename, useCaseIds, useCaseName }),
    tasks: [{
      task_key: 'inspire_notebook',
      notebook_task: {
        notebook_path: resolvedPath,
        base_parameters: params,
        source: 'WORKSPACE',
      },
      ...inspireTaskCompute(cluster_id),
    }],
    ...inspireJobEnvironments(cluster_id),
    max_concurrent_runs: 1,
  };

  let job_id;
  console.log(`📋 Creating job: ${resolvedPath}`);
  const createResp = await dbFetch(host, token, '/api/2.1/jobs/create', {
    method: 'POST',
    body: JSON.stringify(createPayload),
  });

  if (!createResp.ok) {
    const refusalBody = await createResp.text();
    logApiBody('Job create', createResp.status, refusalBody);
    const err = new Error(apiRefusalText('create the job for this run', createResp.status, refusalBody));
    err.statusCode = createResp.status;
    throw err;
  }

  const created = parseExactJson(await createResp.text());
  job_id = int64Id(created.job_id) ?? String(created.job_id);
  console.log(`✅ Job created: ${job_id}`);
  const viewer = await grantJobViewer(dbFetch, host, token, job_id, launchedBy);
  if (viewer.note) console.warn(`⚠️ ${viewer.note}`);

  const response = await dbFetch(host, token, '/api/2.1/jobs/run-now', {
    method: 'POST',
    body: jsonWithInt64Ids({ job_id }, ['job_id']),
  });

  if (!response.ok) {
    const refusalBody = await response.text();
    logApiBody('Job run', response.status, refusalBody);
    const err = new Error(apiRefusalText('start the run', response.status, refusalBody));
    err.statusCode = response.status;
    throw err;
  }

  const data = parseExactJson(await response.text());
  const runId = int64Id(data.run_id) ?? String(data.run_id);
  rememberViewer(runId, viewer);
  const jobRunUrl = databricksJobRunUrl(host, job_id, runId);
  console.log(`✅ Run submitted: ${runId}, job_id=${job_id}, notebook: ${resolvedPath}`);
  // Every launch is recorded. With no signed-in person the launcher is recorded as unknown, which no person matches, so only App managers can stop it.
  const launch = await recordLaunchOrStop(host, token, { runId, jobId: job_id, runType: inspireRunType, inspireDatabase: launchDatabase, sessionId: launchSession,
    openedSession, launchedBy: launchedBy || LAUNCHER_UNKNOWN, outputFolder, outputChecked }, token);
  if (!launchedBy) launch.note = 'no signed-in person launched this run, so the launcher is recorded as unknown and only App managers can cancel it';
  if (launch.warning) warnings.push(launch.warning);
  return {
    run_id: runId,
    job_id,
    notebook_path: resolvedPath,
    job_run_url: jobRunUrl,
    launcher_recorded: launch.recorded,
    ...(launch.note ? { launcher_note: launch.note } : {}),
    viewer_granted: viewer.granted,
    ...(viewer.note ? { viewer_note: viewer.note } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(warningDetails.length ? { warning_details: warningDetails } : {}),
  };
}

/**
 * Attach compact per-session use case stats from __inspire_usecases (sessions list omits results_json).
 */
async function attachSessionUsecaseOverviews(host, token, warehouseId, catalog, schema, sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return;
  const ucTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
  const safeIds = [...new Set(sessions.map((s) => int64Id(s.session_id)).filter(Boolean))];
  if (safeIds.length === 0) return;
  try {
    const bySid = await loadSessionOverviews(
      async (statement) => sqlResultToObjects(await executeSql(host, token, warehouseId, statement.sql, statement.parameters)),
      ucTable,
      safeIds,
    );
    for (const s of sessions) {
      const sid = int64Id(s.session_id);
      if (sid) s.usecase_overview = bySid[sid];
    }
  } catch (e) {
    const why = String(e.message || e);
    console.warn('attachSessionUsecaseOverviews:', why);
    for (const s of sessions) {
      if (int64Id(s.session_id)) s.usecase_overview = { error: why };
    }
  }
}

// ═══════════════════════════════════════════════════
//  Auto-publish — seamless notebook deployment
// ═══════════════════════════════════════════════════

const NOTEBOOK_DEST = (process.env.NOTEBOOK_PATH || '/Shared/inspire-ai/dbx_inspire_ai_agent').trim();
/** SHA-256 of last successfully imported bundled notebook — triggers re-import when the file on disk changes. */
const NOTEBOOK_PUBLISH_SIG_FILE = path.join(BACKEND_DIR, '.notebook_publish_sig');
let cachedNotebookPath = DEFAULT_NOTEBOOK_PATH || '';

function getBundledNotebookFingerprint() {
  try {
    if (!BUNDLED_NOTEBOOK_PATH || !fs.existsSync(BUNDLED_NOTEBOOK_PATH)) return '';
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(BUNDLED_NOTEBOOK_PATH));
    return h.digest('hex');
  } catch {
    return '';
  }
}

async function findPublishedNotebook(host, token) {
  // 1. If we already know the notebook path, verify it still exists
  if (cachedNotebookPath) {
    try {
      const check = await dbFetch(host, token, `/api/2.0/workspace/get-status?path=${encodeURIComponent(cachedNotebookPath)}`);
      if (check.ok) return cachedNotebookPath;
    } catch (_) {}
    // Path gone — re-publish
    cachedNotebookPath = '';
  }

  // 2. Check if notebook already exists at the destination
  try {
    const check = await dbFetch(host, token, `/api/2.0/workspace/get-status?path=${encodeURIComponent(NOTEBOOK_DEST)}`);
    if (check.ok) {
      const data = await check.json();
      if (data.object_type === 'NOTEBOOK') {
        cachedNotebookPath = NOTEBOOK_DEST;
        console.log(`📓 Notebook already exists: ${cachedNotebookPath}`);
        return cachedNotebookPath;
      }
      if (data.object_type === 'DIRECTORY') {
        const listResp = await dbFetch(host, token, `/api/2.0/workspace/list?path=${encodeURIComponent(NOTEBOOK_DEST)}`);
        if (listResp.ok) {
          const listData = await listResp.json();
          const nb = (listData.objects || []).find(o => o.object_type === 'NOTEBOOK');
          if (nb) {
            cachedNotebookPath = nb.path;
            console.log(`📓 Notebook found in folder: ${cachedNotebookPath}`);
            return cachedNotebookPath;
          }
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Ensure the workspace has the bundled notebook. Re-imports automatically when the local
 * `dbx_inspire_ai_agent.ipynb` bytes change (signature in `.notebook_publish_sig`).
 * @returns {{ path: string, republished: boolean }}
 */
async function ensureNotebookPublished(host, token, force = false) {
  const fp = getBundledNotebookFingerprint();
  if (fp) {
    try {
      const prev = fs.existsSync(NOTEBOOK_PUBLISH_SIG_FILE)
        ? fs.readFileSync(NOTEBOOK_PUBLISH_SIG_FILE, 'utf8').trim()
        : '';
      if (prev !== fp) {
        console.log(
          prev
            ? '📓 Bundled Inspire notebook changed since last workspace publish, re-importing.'
            : '📓 Publishing bundled notebook to workspace (new or unsigned bundle).',
        );
        force = true;
        cachedNotebookPath = '';
      }
    } catch (_) {}
  }

  if (!force) {
    const found = await findPublishedNotebook(host, token);
    if (found) return { path: found, republished: false };
  } else {
    console.log('🔄 Re-publishing notebook, overwriting workspace path...');
  }

  // 3. Publish the bundled notebook
  if (!BUNDLED_NOTEBOOK_PATH || !fs.existsSync(BUNDLED_NOTEBOOK_PATH)) {
    throw new Error('No bundled notebook file available to publish.');
  }

  const isIpynb = BUNDLED_NOTEBOOK_PATH.endsWith('.ipynb');
  const importFormat = isIpynb ? 'JUPYTER' : 'DBC';
  console.log(`📦 Auto-publishing notebook (${importFormat}) to ${NOTEBOOK_DEST}...`);
  const fileBuffer = fs.readFileSync(BUNDLED_NOTEBOOK_PATH);
  const base64Content = fileBuffer.toString('base64');

  // Delete old if exists
  try {
    await dbFetch(host, token, '/api/2.0/workspace/delete', {
      method: 'POST',
      body: JSON.stringify({ path: NOTEBOOK_DEST, recursive: true }),
    });
  } catch (_) {}

  const importPath = isIpynb ? NOTEBOOK_DEST : NOTEBOOK_DEST;
  const resp = await dbFetch(host, token, '/api/2.0/workspace/import', {
    method: 'POST',
    body: JSON.stringify({
      path: importPath,
      format: importFormat,
      content: base64Content,
      language: isIpynb ? 'PYTHON' : undefined,
      overwrite: true,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Publish failed: ${err}`);
  }

  if (isIpynb) {
    // JUPYTER import creates the notebook directly at the path
    cachedNotebookPath = NOTEBOOK_DEST;
  } else {
    // DBC imports as a folder — find the actual notebook inside
    cachedNotebookPath = NOTEBOOK_DEST;
    try {
      const listResp = await dbFetch(host, token, `/api/2.0/workspace/list?path=${encodeURIComponent(NOTEBOOK_DEST)}`);
      if (listResp.ok) {
        const listData = await listResp.json();
        const nb = (listData.objects || []).find(o => o.object_type === 'NOTEBOOK');
        if (nb) cachedNotebookPath = nb.path;
      }
    } catch (_) {}
  }

  const newFp = getBundledNotebookFingerprint();
  if (newFp) {
    try {
      fs.writeFileSync(NOTEBOOK_PUBLISH_SIG_FILE, newFp, 'utf8');
    } catch (e) {
      console.warn('Could not write notebook publish signature:', e.message || e);
    }
  }

  console.log(`✅ Notebook published: ${cachedNotebookPath}`);
  return { path: cachedNotebookPath, republished: true };
}

// ═══════════════════════════════════════════════════
//  Service Principal OAuth2 Token
// ═══════════════════════════════════════════════════

// SEC-15 (c23): a local-development helper. A Databricks App (policy enforced) does not register it at all.
if (!policyEnforced()) {
app.post('/api/auth/sp-token', async (req, res) => {
  try {
    const { client_id, client_secret, tenant_id, databricks_host } = req.body;
    if (!client_id || !client_secret || !tenant_id || !databricks_host) {
      return res.status(400).json({ error: 'client_id, client_secret, tenant_id, and databricks_host required.' });
    }

    // Azure AD OAuth2 client credentials flow
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(String(tenant_id))}/oauth2/v2.0/token`;
    // The scope for Databricks is the host + /.default
    const scope = `${databricks_host.replace(/\/$/, '')}/.default`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id,
      client_secret,
      scope,
    });

    const resp = await fetchWithin(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }, { label: 'The Azure sign-in token request' });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`SP token failed (${resp.status})`); // SEC-15 (c23): never the error body, it can echo the caller's credentials
      return res.status(resp.status).json({ error: apiRefusalText('get a sign-in token', resp.status, errText) });
    }

    const data = await resp.json();
    console.log('✅ SP token obtained successfully');
    res.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});
}

// ═══════════════════════════════════════════════════
//  Workspace File Operations (list & download artifacts)
// ═══════════════════════════════════════════════════

function normalizeWorkspaceApiPath(input) {
  if (!input || typeof input !== 'string') return '';
  const segments = input.trim().split('/').filter(Boolean);
  return segments.length ? `/${segments.join('/')}` : '/';
}

/**
 * Databricks workspace REST expects repo paths under /Workspace/... for GCP/AWS.
 * Try normalized path, then /Workspace{path} when path is /Shared, /Users, /Repos, /demos, etc.
 */
function workspaceApiPathCandidates(input) {
  const n = normalizeWorkspaceApiPath(input);
  const out = [];
  const add = (x) => {
    const y = normalizeWorkspaceApiPath(x);
    if (y && !out.includes(y)) out.push(y);
  };
  add(n);
  if (n.startsWith('/Volumes/')) return out;
  if (!n.startsWith('/Workspace')) add(`/Workspace${n}`);
  if (n.startsWith('/Workspace/')) {
    const stripped = n.slice('/Workspace'.length) || '/';
    add(stripped);
  }
  return out;
}

app.get('/api/workspace/list', rejectUnsafeQueryPath, requireToken, async (req, res) => {
  try {
    const rawPath = req.query.path;
    const candidates = workspaceApiPathCandidates(rawPath);
    let lastErr = 'not found';
    let lastStatus = 404;

    for (const wsPath of candidates) {
      // Handle Volumes paths via Files API
      if (wsPath.startsWith('/Volumes/')) {
        const response = await dbFetch(req.dbHost, req.dbToken, fsApiPath('directories', wsPath));
        if (!response.ok) {
          lastStatus = response.status;
          const refusalBody = await response.text();
          logApiBody('List folder', response.status, refusalBody);
          lastErr = apiRefusalText('list that folder', response.status, refusalBody);
          continue;
        }
        const data = await response.json();
        const contents = (data.contents || []).map(f => ({
          path: f.path,
          name: f.name || f.path.split('/').pop(),
          is_directory: f.is_directory || false,
          file_size: f.file_size || 0,
        }));
        return res.json({ files: contents, resolved_path: wsPath });
      }

      const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.0/workspace/list?path=${encodeURIComponent(wsPath)}`);
      if (!response.ok) {
        lastStatus = response.status;
        const refusalBody = await response.text();
        logApiBody('List folder', response.status, refusalBody);
        lastErr = apiRefusalText('list that folder', response.status, refusalBody);
        continue;
      }
      const data = await response.json();
      const files = (data.objects || []).map(o => ({
        path: o.path,
        name: o.path.split('/').pop(),
        is_directory: o.object_type === 'DIRECTORY',
        object_type: o.object_type,
        file_size: o.size || 0,
      }));
      return res.json({ files, resolved_path: wsPath });
    }

    return PM_ERROR.sendFailure(res, lastStatus, lastErr, { tried: candidates });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/workspace/export', rejectUnsafeQueryPath, requireToken, async (req, res) => {
  try {
    const rawPath = req.query.path;
    const candidates = workspaceApiPathCandidates(rawPath);
    const baseName = (normalizeWorkspaceApiPath(rawPath).split('/').pop() || 'file');
    let lastErr = 'not found';
    let lastStatus = 404;

    for (const wsPath of candidates) {
      if (wsPath.startsWith('/Volumes/')) {
        const response = await dbFetch(req.dbHost, req.dbToken, fsApiPath('files', wsPath));
        if (!response.ok) {
          lastStatus = response.status;
          const refusalBody = await response.text();
          logApiBody('Read file', response.status, refusalBody);
          lastErr = apiRefusalText('read that file', response.status, refusalBody);
          continue;
        }
        res.setHeader('Content-Disposition', attachmentHeader(baseName));
        return res.send(Buffer.from(await response.arrayBuffer()));
      }

      const fileName = wsPath.split('/').pop() || baseName;

      const resp1 = await dbFetch(req.dbHost, req.dbToken, `/api/2.0/workspace/export?path=${encodeURIComponent(wsPath)}&format=AUTO`);
      if (resp1.ok) {
        const contentType = resp1.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp1.json();
          if (data.content) {
            const buffer = Buffer.from(data.content, 'base64');
            res.setHeader('Content-Disposition', attachmentHeader(fileName));
            return res.send(buffer);
          }
        }
        const buffer = Buffer.from(await resp1.arrayBuffer());
        res.setHeader('Content-Disposition', attachmentHeader(fileName));
        return res.send(buffer);
      }

      const resp2 = await dbFetch(req.dbHost, req.dbToken, `/api/2.0/workspace/export?path=${encodeURIComponent(wsPath)}&direct_download=true`);
      if (resp2.ok) {
        res.setHeader('Content-Disposition', attachmentHeader(fileName));
        return res.send(Buffer.from(await resp2.arrayBuffer()));
      }
      lastStatus = resp2.status;
      const refusalBody = await resp2.text();
      logApiBody('Read file', resp2.status, refusalBody);
      lastErr = apiRefusalText('read that file', resp2.status, refusalBody);
    }

    return PM_ERROR.sendFailure(res, lastStatus, lastErr, { tried: candidates });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Basic endpoints
// ═══════════════════════════════════════════════════

// SEC-14 (c23): inside a Databricks App the platform probe has no sign-in, so a request with no signed-in person gets a bare ok and no settings.
app.get('/api/health', async (req, res) => {
  if (policyEnforced() && !RP.forwardedPerson(req.headers)) return res.json({ ok: true, status: 'ok' });
  const managerCheckNow = await currentManagerCheck(req).catch((err) => ({ check: `Inspire could not check who manages its ${IMPLEMENT_OUTPUT_LABELS.app}: ${err.message}`, manager: null }));
  const hasBundledNotebook = fs.existsSync(BUNDLED_NOTEBOOK_PATH);
  const host = resolveHost(req);
  const forwardedToken = forwardedTokenOf(req);
  const syncToken = getToken(req);
  const platformAuth = hasDatabricksPlatformAuth();
  res.json({
    status: 'ok',
    agentVersion: inspireReleaseLabel(),
    host: host ? host.replace(/https?:\/\//, '').split('.')[0] + '...' : 'not configured',
    hostFull: host || 'NOT SET',
    hostConfigured: !!host,
    hasBundledDbc: hasBundledNotebook,
    hasServiceToken: !!SERVICE_TOKEN,
    /** True when env has DATABRICKS_TOKEN and/or SP OAuth creds (Databricks App service principal). */
    hasPlatformAuth: platformAuth,
    /** Present when the Apps proxy attaches a user access token (delegated auth). */
    hasUserToken: !!forwardedToken,
    // Do not treat “DATABRICKS_HOST in local .env” as a Databricks App — that skips the PAT wizard incorrectly.
    isDatabricksApp:
      !!forwardedToken ||
      (!!DATABRICKS_HOST && hasDatabricksPlatformAuth() && process.env.NODE_ENV === 'production'),
    hasForwardedToken: !!forwardedToken,
    resolvedTokenSource: syncToken === SERVICE_TOKEN && SERVICE_TOKEN ? 'DATABRICKS_TOKEN' : syncToken === spTokenCache && spTokenCache ? 'SP_OAUTH' : forwardedToken && syncToken ? 'x-forwarded-access-token' : syncToken ? 'header' : 'NONE',
    hasSpCredentials: !!(SP_CLIENT_ID && SP_CLIENT_SECRET),
    spTokenCached: spOAuthTokenStillFresh(),
    /** Confirms this server build exposes the Route-1 Genie regen API (POST). */
    hasGenerateGenieEndpoint: true,
    manager_check: managerCheckNow.check,
    manager: managerCheckNow.manager,
    envVars: {
      DATABRICKS_HOST: DATABRICKS_HOST ? 'set' : 'NOT SET',
      DATABRICKS_TOKEN: SERVICE_TOKEN ? 'set' : 'NOT SET',
      DATABRICKS_CLIENT_ID: process.env.DATABRICKS_CLIENT_ID ? 'set (runtime)' : 'NOT SET',
      DATABRICKS_CLIENT_SECRET: process.env.DATABRICKS_CLIENT_SECRET ? 'set (runtime)' : 'NOT SET',
      SP_CLIENT_ID_resolved: SP_CLIENT_ID ? 'set' : 'NOT SET',
      SP_CLIENT_SECRET_resolved: SP_CLIENT_SECRET ? 'set' : 'NOT SET',
      INSPIRE_WAREHOUSE_ID: DEFAULT_WAREHOUSE_ID || 'NOT SET',
      INSPIRE_DATABASE: DEFAULT_INSPIRE_DB || 'NOT SET',
      NOTEBOOK_PATH: DEFAULT_NOTEBOOK_PATH || 'NOT SET',
    },
  });
});

/** Quick workspace reachability check (runs as the App's own identity: the static token or the service principal). */
app.get('/api/connection-test', appRequiresToken, async (req, res) => {
  let host = String(DATABRICKS_HOST || '').replace(/\/+$/, '');
  if (host && !host.startsWith('http')) host = `https://${host}`;
  const token = await appOwnToken();
  if (!host || !token) {
    return res.json({
      ok: false,
      error: 'Set DATABRICKS_HOST and either DATABRICKS_TOKEN or the service principal (SP_CLIENT_ID and SP_CLIENT_SECRET) in .env',
    });
  }
  try {
    const whResp = await dbFetch(host, token, '/api/2.0/sql/warehouses');
    const whJson = await whResp.json();
    if (!whResp.ok) {
      return res.json({
        ok: false,
        error: whJson.message || `HTTP ${whResp.status}`,
        hint: 'Regenerate your PAT or check workspace URL',
      });
    }
    const warehouses = whJson.warehouses || [];
    const configured = DEFAULT_WAREHOUSE_ID;
    const match = warehouses.find(
      (w) => w.id === configured || String(w.id).replace(/-/g, '') === String(configured).replace(/-/g, ''),
    );
    return res.json({
      ok: true,
      warehouse_count: warehouses.length,
      configured_warehouse_id: configured || null,
      configured_warehouse_valid: configured ? !!match : null,
      configured_warehouse_name: match?.name || null,
      sample_warehouses: warehouses.slice(0, 5).map((w) => ({ id: w.id, name: w.name, state: w.state })),
    });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// Pre-configured defaults (injected by the installer notebook via app.yaml env vars)
app.get('/api/defaults', appRequiresToken, async (req, res) => {
  const host = resolveHost(req);
  // SEC-14 (c23): the installer's data catalogs go to App managers only.
  const manager = await isManager(req);
  // In Databricks Apps, DATABRICKS_HOST may be just the hostname — normalize
  let fullHost = host;
  if (fullHost && !fullHost.startsWith('http')) fullHost = `https://${fullHost}`;
  const platformAuth = hasDatabricksPlatformAuth();
  // Local dev / App: skip Setup Wizard when server has platform auth + host + warehouse + tracking DB.
  const envSkipsSetupWizard = !!(platformAuth && fullHost && DEFAULT_WAREHOUSE_ID && DEFAULT_INSPIRE_DB);
  res.json({
    agentVersion: inspireReleaseLabel(),
    databricksHost: fullHost || '',
    warehouseId: DEFAULT_WAREHOUSE_ID,
    inspireDatabase: DEFAULT_INSPIRE_DB,
    ...(manager ? { installerDataCatalogs: INSTALLER_DATA_CATALOGS } : {}),
    notebookPath: DEFAULT_NOTEBOOK_PATH,
    isDatabricksApp:
      !!DATABRICKS_HOST && platformAuth && process.env.NODE_ENV === 'production',
    autoSetup: process.env.INSPIRE_AUTO_SETUP === 'true',
    /** Literal DATABRICKS_TOKEN in env (optional when SP OAuth creds are used instead). */
    hasServiceToken: !!SERVICE_TOKEN,
    /** True when the Node server can call Databricks APIs without a browser PAT (token or SP OAuth). */
    hasServerPlatformAuth: platformAuth,
    envSkipsSetupWizard,
    [MODEL_CHECK_ROUTE.field]: modelAccessRecord,
    features: {
      demoDataApi: true,
      demoDataUi: getFrontendBuildInfo().hasDemoDataUi,
    },
    frontendBuild: getFrontendBuildInfo(),
  });
});

// ═══════════════════════════════════════════════════
//  Setup Verification — validates all prerequisites
// ═══════════════════════════════════════════════════
app.post('/api/setup/verify', async (req, res) => {
  if (SP_CLIENT_ID && SP_CLIENT_SECRET && (!spTokenCache || Date.now() >= spTokenExpiry - 120000)) {
    try {
      await refreshSpToken();
    } catch { /* ignore */ }
  }
  const token = getToken(req);
  const host = resolveHost(req);
  const { warehouse_id, inspire_database } = req.body || {};

  const checks = {
    workspace: { ok: false, message: '' },
    auth: { ok: false, message: '' },
    warehouse: { ok: false, message: '' },
    catalog: { ok: false, message: '' },
    notebook: { ok: false, message: '' },
  };

  // 1. Workspace connectivity
  try {
    if (!host) throw new Error('No Databricks host configured');
    const resp = await fetchWithin(`${host}/api/2.0/clusters/spark-versions`, {
      headers: { Authorization: `Bearer ${token || 'invalid'}` },
    }, { label: `The workspace ${host}` });
    checks.workspace = { ok: resp.status !== 0, message: resp.ok ? host : `Host reachable but returned ${resp.status}` };
  } catch (err) {
    checks.workspace = { ok: false, message: `Cannot reach ${host || 'no host'}: ${err.message}` };
  }

  // 2. Authentication
  if (token && host) {
    try {
      const resp = await dbFetch(host, token, SCIM_ME_PATH);
      if (resp.ok) {
        const me = await resp.json();
        checks.auth = { ok: true, message: `The Inspire App connects as ${me.displayName || me.userName || 'its service principal'}` };
      } else {
        checks.auth = { ok: false, message: `Token invalid (${resp.status})` };
      }
    } catch (err) {
      checks.auth = { ok: false, message: err.message };
    }
  } else {
    checks.auth = { ok: false, message: token ? 'No host configured' : 'No token provided' };
  }

  // 3. Warehouse access
  if (checks.auth.ok && warehouse_id) {
    try {
      const resp = await dbFetch(host, token, `/api/2.0/sql/warehouses/${encodeURIComponent(String(warehouse_id))}`);
      if (resp.ok) {
        const wh = await resp.json();
        checks.warehouse = { ok: true, message: `${wh.name} (${wh.state})`, state: wh.state };
      } else {
        checks.warehouse = { ok: false, message: `Cannot access warehouse ${warehouse_id}` };
      }
    } catch (err) {
      checks.warehouse = { ok: false, message: err.message };
    }
  } else if (!warehouse_id) {
    checks.warehouse = { ok: false, message: 'No warehouse selected' };
  }

  // 4. Catalog/database access
  if (checks.auth.ok && inspire_database) {
    try {
      const parts = inspire_database.split('.');
      if (parts.length !== 2) throw new Error('Format must be catalog.schema');
      const [catalog, schema] = parts;
      // Test catalog access
      const catResp = await dbFetch(host, token, `/api/2.1/unity-catalog/catalogs/${encodeURIComponent(catalog)}`);
      if (!catResp.ok) throw new Error(`Cannot access catalog "${catalog}"`);
      // Test schema access or creation
      const schResp = await dbFetch(host, token, `/api/2.1/unity-catalog/schemas/${encodeURIComponent(catalog)}.${encodeURIComponent(schema)}`);
      if (schResp.ok) {
        checks.catalog = { ok: true, message: `${inspire_database} exists and accessible` };
      } else {
        // Schema doesn't exist — check if we can create it
        checks.catalog = { ok: true, message: `Catalog "${catalog}" accessible. Schema "${schema}" will be created on first run.` };
      }
    } catch (err) {
      checks.catalog = { ok: false, message: err.message };
    }
  } else if (!inspire_database) {
    checks.catalog = { ok: false, message: 'No inspire database specified' };
  }

  // 5. Notebook bundle
  const hasNotebook = fs.existsSync(BUNDLED_NOTEBOOK_PATH);
  checks.notebook = { ok: hasNotebook, message: hasNotebook ? 'Notebook bundle found' : 'Notebook file not found, so notebook publish will fail' };

  const allOk = Object.values(checks).every(c => c.ok);
  res.json({ ok: allOk, checks });
});

// Create inspire database schema if it doesn't exist
app.post('/api/setup/create-database', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id } = req.body;
    if (!inspire_database || !warehouse_id) return res.status(400).json({ error: 'inspire_database and warehouse_id required' });
    const parts = inspire_database.split('.');
    if (parts.length !== 2) return res.status(400).json({ error: 'Format: catalog.schema' });
    const [catalog, schema] = parts;

    await executeSql(req.dbHost, req.dbToken, warehouse_id, createPlaceSql(catalog, schema));
    res.json({ ok: true, message: `Schema ${inspire_database} ready` });
  } catch (err) {
    res.status(PM_ERROR.failureStatus(err)).json({ ok: false, ...PM_ERROR.failureBody(res, err.message) });
  }
});

// Auto-publish and return the notebook path
app.get('/api/notebook', requireToken, async (req, res) => {
  try {
    const found = await findPublishedNotebook(req.dbHost, req.dbToken);
    res.json({ path: found || '', published: Boolean(found) });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.post('/api/notebook/republish', requireToken, async (req, res) => {
  try {
    cachedNotebookPath = '';
    const { path: nbPath, republished } = await ensureNotebookPublished(req.dbHost, req.dbToken, true);
    res.json({ path: nbPath, republished });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/me', requireToken, async (req, res) => {
  try {
    const own = await jsonOf(dbFetch, req.dbHost, (await appOwnToken()) || req.dbToken, SCIM_ME_PATH);
    const appIdentity = {
      username: String(own.data.userName || own.data.applicationId || '').trim(),
      displayName: String(own.data.displayName || '').trim(),
      about: 'the identity the Inspire App uses to call Databricks',
    };
    const person = await personOf(req);
    if (person.error) return PM_ERROR.sendFailure(res, person.error.status || 502, person.error.message, { source: ME_SOURCES[person.source] || person.source });
    if (!person.username && policyEnforced()) {
      return res.status(401).json({ error: 'The Databricks Apps proxy sent no signed-in person, so Inspire cannot tell who you are.' });
    }
    res.json({ person: { ...meResponse(person), source: ME_SOURCES[person.source] || person.source }, app: appIdentity });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Unity Catalog browsing
// ═══════════════════════════════════════════════════

const truncatedByRest = (restCut, byName, countAfterRest) => restCut && byName.size === countAfterRest;

// REQ-420: the catalogs the App's service principal can read right now, or null when it cannot be asked. `listing` is the catalog
// list the person's own token read, the only list the App checks.
async function appCatalogGrants(req, listing = null) {
  const token = await appOwnToken();
  if (!token) return null;
  // SEC-02 (F5): the App never lists catalogs for a person's pick; a listing the person's own token produced is the one that is checked.
  return spGrantedCatalogs(dbFetch, req.dbHost, token, SP_CLIENT_ID, listing);
}

// REQ-521: "Show everything" also lists the objects the person may only browse, each marked readable:false.
const wantsUnreadable = (req) => ['1', 'true'].includes(String(req.query.include_unreadable || '').toLowerCase());

app.get('/api/catalogs', requireToken, async (req, res) => {
  try {
    const token = req.dbToken;
    const warehouseId = String(req.query.warehouse_id || '').trim();
    const showUnreadable = wantsUnreadable(req);
    let raw = [];
    let restCut = false;
    let restErr = null;
    try {
      ({ items: raw, truncated: restCut } = await listCatalogs(dbFetch, req.dbHost, token, { browse: showUnreadable }));
    } catch (e) {
      restErr = e.message || String(e);
      console.warn(`   ⚠️ UC REST catalogs failed: ${restErr}`);
    }
    const byName = new Map();
    for (const c of raw) {
      if (c && c.name && !String(c.name).startsWith('__')) {
        byName.set(c.name, {
          name: c.name,
          comment: c.comment || '',
          owner: c.owner || '',
          ...(showUnreadable ? { readable: c.browse_only !== true } : {}),
        });
      }
    }
    const countAfterRest = byName.size;
    if (warehouseId && (restErr || restCut || !raw.length)) {
      const sqlNames = await listCatalogNamesSql(req.dbHost, token, warehouseId);
      for (const name of sqlNames) {
        if (!byName.has(name) && !String(name).startsWith('__')) {
          byName.set(name, { name, comment: '', owner: '', ...(showUnreadable ? { readable: true } : {}) });
        }
      }
    }
    const allCatalogs = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    // REQ-521: an unreadable catalog skips the App-grant check (the person must get access first) and carries no `partial`.
    const catalogs = showUnreadable ? allCatalogs.filter((c) => c.readable) : allCatalogs;
    const unreadableCatalogs = showUnreadable ? allCatalogs.filter((c) => !c.readable) : [];
    const withUnreadable = (list) => (unreadableCatalogs.length ? [...list, ...unreadableCatalogs].sort((a, b) => a.name.localeCompare(b.name)) : list);
    let source = 'none';
    if (raw.length > 0 && byName.size > countAfterRest) source = 'rest+sql';
    else if (raw.length > 0) source = 'rest';
    else if (catalogs.length > 0) source = 'sql';
    console.log(`   📚 catalogs: REST=${raw.length} merged=${catalogs.length} warehouse=${warehouseId ? 'yes' : 'no'} (${source})`);
    // REQ-420: the App reads as its own service principal, so the list is the catalogs the person sees that the principal can read now.
    // REQ-522: the browse-only catalogs are checked too, for their App state only.
    const granted = await appCatalogGrants(req, { items: allCatalogs, truncated: restCut });
    if (granted) {
      const offered = grantedCatalogList(catalogs, granted);
      const permission = partialPermission(offered, SP_CLIENT_ID);
      const browseOnly = unreadableCatalogs.map((c) => inspireStateOf(c, granted));
      return res.json({ catalogs: [...offered, ...browseOnly].sort((a, b) => a.name.localeCompare(b.name)), source, spGrants: true, truncated: truncatedByRest(restCut, byName, countAfterRest),
        ...(permission ? { permissions: [permission] } : {}) });
    }
    res.json({
      catalogs: withUnreadable(catalogs).map((c) => ({ ...c, inspire_readable: null })),
      source,
      truncated: restCut && byName.size === countAfterRest,
      restError: restErr && catalogs.length === 0 ? restErr : undefined,
    });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

const restFailureStatus = (err) => ([401, 403, 404, 429].includes(Number(err && err.status)) ? Number(err.status) : 502);

app.get('/api/catalogs/:catalog/schemas', requireToken, async (req, res) => {
  try {
    const { catalog } = req.params;
    const token = req.dbToken;
    const warehouseId = String(req.query.warehouse_id || '').trim();
    const showUnreadable = wantsUnreadable(req);
    let raw = [];
    let restCut = false;
    let restErr = null;
    let restStatus = 502;
    try {
      ({ items: raw, truncated: restCut } = await listSchemas(dbFetch, req.dbHost, token, catalog, { browse: showUnreadable }));
    } catch (e) {
      restErr = e.message || String(e);
      restStatus = restFailureStatus(e);
      console.warn(`   ⚠️ UC REST schemas failed for ${catalog}: ${restErr}`);
    }
    const byKey = new Map();
    for (const s of raw) {
      if (!s) continue;
      const full = s.full_name || `${catalog}.${s.name}`;
      byKey.set(full, {
        name: s.name,
        full_name: full,
        comment: s.comment || '',
        ...(showUnreadable ? { readable: s.browse_only !== true } : {}),
      });
    }
    const countAfterRest = byKey.size;
    if (warehouseId) {
      const sqlRows = await listSchemasSql(req.dbHost, token, warehouseId, catalog);
      for (const row of sqlRows) {
        const k = row.full_name || `${catalog}.${row.name}`;
        if (!byKey.has(k)) byKey.set(k, showUnreadable ? { ...row, readable: true } : row);
      }
    }
    // A use case's own result schema (`_inspire_<business>_<use case>`) is not the person's data (REQ-387): the one rule, inspireOwnObjects.js.
    const schemas = [...byKey.values()].filter((s) => !isInspireOwnSchema(s.full_name)).sort((a, b) => a.full_name.localeCompare(b.full_name));
    console.log(`   📂 schemas ${catalog}: REST=${raw.length} merged=${schemas.length}`);
    if (raw.length === 0 && schemas.length === 0 && restErr) {
      return PM_ERROR.sendFailure(res, restStatus, restErr);
    }
    const states = await schemaInspireStates(dbFetch, req.dbHost, await appOwnToken().catch(() => ''), SP_CLIENT_ID, catalog, schemas, PICKER_PROBE_CAP);
    const withState = schemas.map((s) => ({ ...s, inspire_readable: states.has(s.full_name) ? states.get(s.full_name) : null }));
    res.json({ schemas: withState, count: withState.length, truncated: restCut && byKey.size === countAfterRest });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/tables/:catalog/:schema', requireToken, async (req, res) => {
  try {
    const { catalog, schema } = req.params;
    // SEC-01 (W4): the person's own sign-in lists the tables, so the person sees only what they can see.
    // SEC-02 (F5): a person route, so req.dbToken is the person's token (401 without one); there is no fallback to the App's token.
    const personToken = req.dbToken;
    const token = personToken;
    const warehouseId = String(req.query.warehouse_id || '').trim();
    const showUnreadable = wantsUnreadable(req);
    let raw = [];
    let restCut = false;
    let restErr = null;
    let restStatus = 502;
    let hiddenMetricViews = [];
    try {
      ({ items: raw, truncated: restCut, metricViews: hiddenMetricViews } = await listTables(dbFetch, req.dbHost, token, catalog, schema, { browse: showUnreadable }));
    } catch (e) {
      restErr = e.message || String(e);
      restStatus = restFailureStatus(e);
      console.warn(`   ⚠️ UC REST tables failed for ${catalog}.${schema}: ${restErr}`);
    }
    const mapRow = (t) => ({
      name: t.name,
      full_name: t.full_name || `${catalog}.${schema}.${t.name}`,
      catalog_name: t.catalog_name || catalog,
      schema_name: t.schema_name || schema,
      table_type: t.table_type,
      data_source_format: t.data_source_format || '',
      updated_at: t.updated_at ? new Date(t.updated_at).toISOString() : null,
      created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
      comment: t.comment || '',
      owner: t.owner || '',
      columns: (t.columns || []).length,
      ...(showUnreadable ? { readable: t.browse_only !== true } : {}),
    });
    const byKey = new Map();
    for (const t of raw) {
      if (!t || !t.name) continue;
      const row = mapRow(t);
      byKey.set(row.full_name, row);
    }
    const countAfterRest = byKey.size;
    let leftOut = 0;
    // The metric views left out of this list, by full name (Data Management names them in one line; they cannot be filtered).
    const metricViews = new Set(hiddenMetricViews);
    if (warehouseId) {
      const listed = await listTablesSql(req.dbHost, token, warehouseId, catalog, schema,
        new Set([...byKey.keys(), ...hiddenMetricViews]));
      leftOut = listed.leftOut;
      for (const name of listed.metricViews) metricViews.add(`${catalog}.${schema}.${name}`);
      const hidden = new Set(hiddenMetricViews);
      for (const row of listed.rows) {
        if (!byKey.has(row.full_name) && !hidden.has(row.full_name)) byKey.set(row.full_name, showUnreadable ? { ...row, readable: true } : row);
      }
    }
    // Inspire's own tables and views are not the person's data (REQ-387): the one rule, inspireOwnObjects.js.
    const allTables = [...byKey.values()].filter((t) => !isInspireOwnName(t.full_name)).sort((a, b) => a.full_name.localeCompare(b.full_name));
    // REQ-521: a browse-only table is never probed (the person cannot read it); it is listed after the probe as readable:false.
    const unreadableTables = allTables.filter((t) => t.readable === false);
    let tables = showUnreadable ? allTables.filter((t) => t.readable !== false) : allTables;
    const probeWarehouse = warehouseId || DEFAULT_WAREHOUSE_ID;
    const spToken = await appOwnToken().catch(() => '');
    const probeTable = async (tok, name) => {
      try {
        const probe = tableProbeStatement(name);
        await executeSql(req.dbHost, tok, probeWarehouse, probe.sql, probe.parameters);
        return true;
      } catch (err) {
        return tableAccessReason(name, err && err.message) !== 'no read access';
      }
    };
    if (personToken && probeWarehouse && tables.length) {
      tables = await pickableRows(tables, { personToken, spToken, readable: probeTable });
    }
    // REQ-522: a browse-only table is probed with the App token only (never the person's), inside the same cap.
    const spared = Math.max(0, PICKER_PROBE_CAP - tables.length);
    const browseOnlyTables = await Promise.all(unreadableTables.map(async (t, i) => ({ ...t,
      inspire_readable: spToken && probeWarehouse && i < spared ? await probeTable(spToken, t.full_name) : null })));
    tables = tables.map((t) => ('inspire_readable' in t ? t : { ...t, inspire_readable: null }));
    if (browseOnlyTables.length) tables = [...tables, ...browseOnlyTables].sort((a, b) => a.full_name.localeCompare(b.full_name));
    console.log(`   📋 tables ${catalog}.${schema}: REST=${raw.length} merged=${tables.length}`);
    if (raw.length === 0 && tables.length === 0 && restErr) {
      return PM_ERROR.sendFailure(res, restStatus, restErr);
    }
    // Tables past the probe cap are not listed: the count says how many, so the picker can name them (nothing is lost silently).
    res.json({ tables, count: tables.length, truncated: restCut && byKey.size === countAfterRest,
      metric_views: [...metricViews].sort(),
      ...(leftOut ? { left_out: { count: leftOut, schema: `${catalog}.${schema}` } } : {}) });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  SQL Warehouses & Clusters
// ═══════════════════════════════════════════════════

app.get('/api/warehouses', requireToken, async (req, res) => {
  try {
    const response = await dbFetch(req.dbHost, req.dbToken, '/api/2.0/sql/warehouses');
    if (!response.ok) {
      const action = 'list the SQL warehouses';
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }
    const data = await response.json();
    const warehouses = (data.warehouses || []).map(w => ({
      id: w.id,
      name: w.name,
      state: w.state,
      cluster_size: w.cluster_size,
    }));
    res.json({ warehouses });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Publish notebook (DBC upload)
// ═══════════════════════════════════════════════════

app.post('/api/publish', requireToken, async (req, res) => {
  try {
    const { destination_path } = req.body;
    const problem = workspacePathProblem('destination_path', destination_path);
    if (problem) return res.status(400).json({ error: problem });

    if (!fs.existsSync(BUNDLED_NOTEBOOK_PATH)) {
      return res.status(404).json({ error: 'Bundled notebook file not found on server.' });
    }

    const fileBuffer = fs.readFileSync(BUNDLED_NOTEBOOK_PATH);
    const base64Content = fileBuffer.toString('base64');
    const isIpynb = BUNDLED_NOTEBOOK_PATH.endsWith('.ipynb');
    const importFormat = isIpynb ? 'JUPYTER' : 'DBC';

    // Delete old if exists
    try {
      await dbFetch(req.dbHost, req.dbToken, '/api/2.0/workspace/delete', {
        method: 'POST',
        body: JSON.stringify({ path: destination_path, recursive: true }),
      });
    } catch (_) {}

    const response = await dbFetch(req.dbHost, req.dbToken, '/api/2.0/workspace/import', {
      method: 'POST',
      body: JSON.stringify({
        path: destination_path,
        format: importFormat,
        content: base64Content,
        language: isIpynb ? 'PYTHON' : undefined,
        overwrite: true,
      }),
    });

    if (!response.ok) {
      const action = 'publish the notebook';
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }

    let notebookPath = destination_path;
    if (!isIpynb) {
      // DBC imports as a folder — find the actual notebook inside
      try {
        const listResp = await dbFetch(req.dbHost, req.dbToken, `/api/2.0/workspace/list?path=${encodeURIComponent(destination_path)}`);
        if (listResp.ok) {
          const listData = await listResp.json();
          const notebook = (listData.objects || []).find(o => o.object_type === 'NOTEBOOK');
          if (notebook) notebookPath = notebook.path;
        }
      } catch (_) {}
    }

    console.log(`✅ Published notebook to: ${destination_path}, notebook: ${notebookPath}`);
    res.json({ success: true, path: notebookPath, folder_path: destination_path });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.post('/api/publish/upload', requireToken, upload.single('file'), async (req, res) => {
  try {
    const { destination_path } = req.body;
    const problem = workspacePathProblem('destination_path', destination_path);
    if (problem) return res.status(400).json({ error: problem });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const base64Content = req.file.buffer.toString('base64');
    const ext = path.extname(req.file.originalname).toLowerCase();
    let format = 'DBC';
    if (ext === '.py') format = 'SOURCE';
    else if (ext === '.ipynb') format = 'JUPYTER';

    if (format === 'DBC') {
      try {
        await dbFetch(req.dbHost, req.dbToken, '/api/2.0/workspace/delete', {
          method: 'POST',
          body: JSON.stringify({ path: destination_path, recursive: true }),
        });
      } catch (_) {}
    }

    const response = await dbFetch(req.dbHost, req.dbToken, '/api/2.0/workspace/import', {
      method: 'POST',
      body: JSON.stringify({
        path: destination_path,
        format,
        content: base64Content,
        ...(format !== 'DBC' ? { overwrite: true } : {}),
        ...(format === 'SOURCE' ? { language: 'PYTHON' } : {}),
      }),
    });

    if (!response.ok) {
      const action = 'publish the notebook';
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }

    res.json({ success: true, path: destination_path });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  DBC Notebook Extraction (preview contents)
// ═══════════════════════════════════════════════════

app.get('/api/dbc/info', (req, res) => {
  try {
    if (!fs.existsSync(BUNDLED_NOTEBOOK_PATH)) {
      return res.status(404).json({ error: 'Bundled notebook file not found.' });
    }

    const isIpynb = BUNDLED_NOTEBOOK_PATH.endsWith('.ipynb');

    if (isIpynb) {
      // JUPYTER notebook — parse ipynb JSON
      const content = fs.readFileSync(BUNDLED_NOTEBOOK_PATH, 'utf8');
      const nb = JSON.parse(content);
      const cells = nb.cells || [];
      res.json({
        file: path.basename(BUNDLED_NOTEBOOK_PATH),
        size: fs.statSync(BUNDLED_NOTEBOOK_PATH).size,
        format: 'JUPYTER',
        notebooks: [{
          name: path.basename(BUNDLED_NOTEBOOK_PATH),
          language: nb.metadata?.kernelspec?.language || 'python',
          cell_count: cells.length,
          code_cells: cells.filter(c => c.cell_type === 'code').length,
          markdown_cells: cells.filter(c => c.cell_type === 'markdown').length,
        }],
        entry_count: 1,
      });
    } else {
      // Legacy DBC archive
      const zip = new AdmZip(BUNDLED_NOTEBOOK_PATH);
      const entries = zip.getEntries();
      const notebooks = [];

      for (const entry of entries) {
        if (entry.entryName.endsWith('.python') || entry.entryName.endsWith('.sql') || entry.entryName.endsWith('.scala')) {
          try {
            const content = entry.getData().toString('utf8');
            const data = JSON.parse(content);
            const commands = data.commands || [];
            notebooks.push({
              name: entry.entryName,
              language: data.language || 'python',
              command_count: commands.length,
              version: data.version || 'unknown',
            });
          } catch {
            notebooks.push({ name: entry.entryName, error: 'Could not parse' });
          }
        }
      }

      res.json({
        file: path.basename(BUNDLED_NOTEBOOK_PATH),
        size: fs.statSync(BUNDLED_NOTEBOOK_PATH).size,
        format: 'DBC',
        notebooks,
        entry_count: entries.length,
      });
    }
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Demo data — "I don't have data" flow
// ═══════════════════════════════════════════════════

app.get('/api/demo-data/templates', (_req, res) => {
  res.json({
    templates: Object.entries(TEMPLATE_META).map(([id, meta]) => ({
      id,
      label: meta.label,
      tables: meta.tables,
    })),
  });
});

/**
 * Two-step Databricks pipeline: generate demo UC tables → run Inspire discovery.
 * Body: { description, business_name, inspire_database?, cluster_id?, session_id?, plant_kind_signals? }
 */
app.post('/api/demo-data/start', requireToken, async (req, res) => {
  try {
    const {
      description = '',
      business_name = '',
      inspire_database: bodyInspireDb,
      cluster_id,
      session_id: bodySessionId,
      discovery_type: discoveryType = '',
      demo_schema: demoSchema = '',
      generation_path: askedGenerationPath = '',
    } = req.body || {};

    const businessName = String(business_name || '').trim();
    if (!businessName) {
      return res.status(400).json({ error: 'business_name is required' });
    }
    const desc = String(description || '').trim();
    if (!desc) {
      return res.status(400).json({ error: 'description is required: describe the data you want to simulate' });
    }

    const inspireDb = String(bodyInspireDb || DEFAULT_INSPIRE_DB || '').trim();
    if (!inspireDb || !inspireDb.includes('.')) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const [catalog] = inspireDb.split('.');

    const sessionId =
      String(bodySessionId || '').trim() ||
      `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    console.log(`\n📦 Demo pipeline (Genie generator → Inspire): tracking ${inspireDb}`);

    const writes = discoverWrites({ '11_generation_path': String(askedGenerationPath || '') }, cachedNotebookPath || DEFAULT_NOTEBOOK_PATH);
    const output = await outputWriteVerdict(req, writes);
    if (output.refused) return res.status(output.refused.status).json(writeRefusalBody(req.policyKey, output.refused));

    const pipelineClusterId =
      String(cluster_id || process.env.INSPIRE_CLUSTER_ID || process.env.INSPIRE_DEPLOY_CLUSTER_ID || '').trim() ||
      undefined;

    const pipelineWarehouseId =
      String(req.body?.warehouse_id || DEFAULT_WAREHOUSE_ID || '').trim() || undefined;

    const appSpApplicationId = resolveInspireAppServicePrincipalId();
    if (!appSpApplicationId) {
      console.warn(
        '⚠️ Demo pipeline: inspire-ai service principal not resolved, so step 1 may skip SP grants',
      );
    }

    const pipelineRun = await triggerDemoDataPipeline(
      dbFetch,
      databricksJobRunUrl,
      req.dbHost,
      req.dbToken,
      {
        description: desc,
        businessName,
        inspireDatabase: inspireDb,
        sessionId,
        cluster_id: pipelineClusterId,
        warehouse_id: pipelineWarehouseId,
        app_sp_application_id: appSpApplicationId,
        plantKindSignals: req.body?.plant_kind_signals !== false,
        discoveryType: String(discoveryType || ''),
        demoSchema: String(demoSchema || ''),
        generationPath: output.generationPath || String(askedGenerationPath || '').trim(),
        ensureInspireNotebookPublished: ensureNotebookPublished,
        resolveWorkspaceNotebookObjectPath,
        launchedBy: RP.forwardedPerson(req.headers),
      },
    );

    res.json({
      ok: true,
      session_id: pipelineRun.session_id,
      pipeline: pipelineRun.pipeline,
      inspire_run_id: pipelineRun.run_id,
      inspire_job_id: pipelineRun.job_id,
      job_run_url: pipelineRun.job_run_url,
      viewer_granted: pipelineRun.viewer_granted,
      ...(pipelineRun.viewer_note ? { viewer_note: pipelineRun.viewer_note } : {}),
      ...(output.warnings && output.warnings.length ? { warnings: output.warnings } : {}),
      steps: [
        { key: 'generate_demo_data', label: 'Generate & store demo data', notebook: pipelineRun.pipeline.step1_notebook },
        {
          key: 'inspire_discovery',
          label: 'Run Inspire discovery',
          notebook: pipelineRun.pipeline.inspire_agent_notebook,
        },
      ],
    });
  } catch (err) {
    const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    console.error('demo-data/start failed:', err.message);
    PM_ERROR.sendFailure(res, code, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Submit notebook run
// ═══════════════════════════════════════════════════

app.post('/api/run/check', requireToken, async (req, res) => {
  try {
    const params = (req.body && req.body.params && typeof req.body.params === 'object') ? { ...req.body.params } : {};
    const { reads, access, model } = await checkLaunchReads(req, params);
    if (reads.refusal) return PM_ERROR.sendFailure(res, reads.refusal.status, reads.refusal.message, refusalExtra(reads.refusal));
    res.json({ permissions: [...model, ...access.permissions], warnings: access.warnings });
  } catch (err) {
    const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    PM_ERROR.sendFailure(res, code, err.message);
  }
});

app.post('/api/run', requireToken, async (req, res) => {
  const { cluster_id, notebook_path } = req.body;
  const params = (req.body.params && typeof req.body.params === 'object') ? { ...req.body.params } : {};
  const profileId = String(req.body.profile_id || '').trim();
  if (profileId && !BP.isProfileId(profileId)) return res.status(400).json({ error: 'profile_id must be a profile id Inspire gave out' });
  return launchDiscover(req, res, { params, notebook_path, cluster_id, profileId });
});

// The job a recorded run belongs to, from Inspire's own launch record (App database). Null when it is not recorded.
async function runJobIdOf(req, runId) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  const statement = table && DEFAULT_WAREHOUSE_ID ? L.runJobStatement(table, runId) : null;
  if (!statement) return null;
  try {
    return L.jobIdOf(await launchSql(resolveHost(req), statement, req.dbToken));
  } catch (err) {
    console.warn(`run again: the job of run ${runId} could not be read from the launch record: ${err.message}`);
    return null;
  }
}

// Databricks refused the person's read of the run. A permission refusal names the job and the grant to ask for; the raw body never reaches the person.
async function refuseRunAgain(req, res, response) {
  const runId = req.params.runId;
  const action = `read run ${runId} to run it again`;
  const refusalBody = await response.text();
  logApiBody(action, response.status, refusalBody);
  if (response.status !== 403) return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
  const jobId = await runJobIdOf(req, runId);
  // REQ-418: Inspire reads the run as the App's service principal, so the grant is named for the App, never for the person.
  const app = SP_CLIENT_ID;
  const job = jobId ? `job ${jobId}` : 'the job of this run';
  const message = `Inspire could not read run ${runId} to run it again: the App needs CAN VIEW (or CAN MANAGE RUN) on ${job} in Databricks. `
    + "Ask an App manager or the job's owner to grant it, then try again.";
  const steps = jobId
    ? [`In Databricks, open job ${jobId} > Permissions, and add the App's service principal ${app} with Can view`,
      `databricks api patch /api/2.0/permissions/jobs/${jobId} --json '{"access_control_list":[{"service_principal_name":"${app}","permission_level":"CAN_VIEW"}]}'`]
    : [`In Databricks, find the job of run ${runId} and give the App's service principal ${app} Can view on it`];
  const permission = permissionRequired({ steps, principal: app,
    why: `Inspire reads run ${runId} as the App, and the App cannot view its job.` });
  return PM_ERROR.sendFailure(res, 403, message, { permissions: [permission] });
}

// REQ-418: the old run is read as the App's service principal, the same identity every launch uses, so the run is read and run again the same way for everyone.
app.post('/api/run/:runId/again', requireToken, async (req, res) => {
  const sessionId = String((req.body || {}).session_id || '').trim();
  if (!isInt64Id(sessionId)) return res.status(400).json({ error: 'session_id must be a numeric Inspire session id' });
  try {
    const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${req.params.runId}`);
    if (!response.ok) return await refuseRunAgain(req, res, response);
    const again = LC.runAgainOf(parseExactJson(await response.text()), req.params.runId, sessionId);
    if (again.problem) return res.status(409).json({ error: `${again.problem}.` });
    return launchDiscover(req, res, again);
  } catch (err) {
    const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    return PM_ERROR.sendFailure(res, code, err.message);
  }
});

// The read and access checks a launch or a check runs before any job exists. Both are bounded (raceLaunchCheck), so a
// schema pick whose tables the warehouse never lists ends with a reason, not a request held open forever.
// REQ-405: the identity a run uses (the App's service principal, REQ-418) must be able to query a chat model.
// The check is lib/modelAccess.js; the App does not wait for the agent to fail with no_model.
const MODEL_ACCESS_BLOCK = 'Inspire cannot start a run yet: the identity the run uses cannot query a chat model. '
  + 'Ask a workspace admin for the permission in Permission Required, then run again.';

// REQ-424: what the App's own model check last found, served on MODEL_CHECK_ROUTE for the installer and for anyone who asks. It is
// pending until the first check, and every check (startup, each launch check) replaces it.
let modelAccessRecord = { state: 'pending' };

const modelCall = (host, token) => (method, path, body) => jsonOf(dbFetch, host, token, path,
  body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function checkModelAccess(host, token, principal) {
  const plan = await planModelAccess({ call: modelCall(host, token), principal });
  modelAccessRecord = selfCheckRecord(plan, principal);
  return plan.permission ? [plan.permission] : [];
}

async function discoverModelAccess(req) {
  const token = await appOwnToken();
  const principal = SP_CLIENT_ID;
  if (!token || !principal) return [];
  try {
    return await checkModelAccess(req.dbHost, token, principal);
  } catch (err) {
    console.warn(`model access check: ${err.message || err}`);
    return [];
  }
}

// D-UGW-4A: on startup the App checks, with its own service principal token, that it can call a chat model, and records the result.
async function selfCheckModelAccess() {
  const host = resolveHost({ headers: {} });
  // REQ-418 (D-SL-10B): every run uses the App's service principal, so the App is always the identity checked.
  const token = await appOwnToken();
  if (!host || !token || !SP_CLIENT_ID) {
    modelAccessRecord = { state: 'unchecked', reason: 'The App has no service principal token to call a model with.' };
    return;
  }
  try {
    await checkModelAccess(host, token, SP_CLIENT_ID);
  } catch (err) {
    console.warn(`model access self-check: ${err.message || err}`);
    modelAccessRecord = { state: 'error', reason: `The check failed: ${String(err.message || err).slice(0, 160)}` };
  }
}

// REQ-420: a run never starts on a catalog the App can no longer read (the installer was run again without it, or its grant was removed).
async function droppedCatalogRefusal(req, params) {
  const { catalogs, schemas, tables } = ucMetadataParts(params['01_uc_metadata']);
  const named = [...catalogs, ...[...schemas, ...tables].map((n) => n.split('.')[0])];
  if (!named.length) return null;
  const granted = await appCatalogGrants(req);
  const dropped = granted ? droppedCatalogs(named, granted) : [];
  if (!dropped.length) return null;
  return { status: 403, message: `Inspire can no longer read ${dropped.length === 1 ? 'the catalog' : 'the catalogs'} ${dropped.join(', ')}, so the run did not start. `
    + `Take ${dropped.length === 1 ? 'it' : 'them'} off your selection, or ask whoever installed Inspire to run the installer again with ${dropped.length === 1 ? 'it' : 'them'}.`,
  unreadable: dropped };
}

// SEC-01 (W5), SEC-02 (F7): the launcher's own read is checked again right before a job starts, and a session is opened by a colleague only
// when the same check passes. The probe is a LIMIT 0 read with the person's sign-in, on every table of the scope. Nothing is granted: the
// refusal names a table-level SELECT. The check fails closed: a scope that cannot be probed in full (no warehouse, no App token to list it,
// more tables than SCOPE_PROBE_CEILING, a listing or a probe that fails for any reason) is a refusal, and only a successful probe counts as readable.
const SCOPE_PROBE_CEILING = 500;
const SCOPE_PROBE_BATCH = 8;
const UNCHECKED_SCOPE = { status: 403, request: 'person', permissions: [], unreadable: [] };
// SEC-02 (c23): the check fails closed for a launch as well as for a session. A launch with no sign-in token of the person, a scope that cannot be
// listed or probed in full, or a probe that fails for any reason other than a plain denial is a refusal with a clear reason. Outside a Databricks
// App (local development, no proxy) there is no person token to probe with, so the check is skipped there only.
const UNCHECKED_MESSAGE = 'Inspire could not check that you can read every table of this scope, so it is not shown. Try again, or ask the person who launched it.';
const LAUNCH_UNCHECKED_MESSAGE = 'Inspire could not check that you can read every table of this scope, so the run did not start. Try again, or take some tables off your selection.';

// SEC-03 (c23): the App lists a scope with its own token, so a table name from that list is shown to a person only when the person's own token can
// get that table (list it). The rest is a count. A name the person's token cannot get is never in a message, a GRANT or an `unreadable` list.
const NAME_CHECK_CEILING = 50;
async function listableNames(req, names) {
  const person = forwardedTokenOf(req);
  if (!person || !names.length) return [];
  const checked = names.slice(0, NAME_CHECK_CEILING);
  const seen = await Promise.all(checked.map(async (name) => {
    try {
      const resp = await dbFetch(req.dbHost, person, `/api/2.1/unity-catalog/tables/${encodeURIComponent(name)}`);
      return resp.ok;
    } catch {
      return false;
    }
  }));
  return checked.filter((_n, i) => seen[i]);
}

function countText(n) {
  return `${n} table${n === 1 ? '' : 's'}`;
}

// The refusal for tables the person cannot read: names the ones the person can list, counts the others. `lead(subject, list)` words the sentence.
async function lostTablesRefusal(req, lost, { why, message }) {
  const email = RP.forwardedPerson(req.headers);
  const all = [...lost].sort();
  const shown = await listableNames(req, all);
  const hiddenCount = all.length - shown.length;
  const permission = shown.length ? permissionRequired({ statements: readStatementsFor(shown, email || 'you'), principal: email || 'you', why: why(shown) }) : null;
  return { status: 403, request: 'person', permissions: permission ? [permission] : [], message: message(shown, hiddenCount), unreadable: shown,
    ...(hiddenCount ? { unreadable_hidden: hiddenCount } : {}) };
}

async function launcherReadRefusal(req, scope, { emptyScopeRefuses = false, launch = false } = {}) {
  const person = forwardedTokenOf(req);
  const { catalogs, schemas, tables: picked } = ucMetadataParts(scope);
  const entries = [...picked, ...schemas, ...catalogs];
  const unchecked = { ...UNCHECKED_SCOPE, message: launch ? LAUNCH_UNCHECKED_MESSAGE : UNCHECKED_MESSAGE };
  if (!person) return policyEnforced() && entries.length ? unchecked : null;
  if (!entries.length) return emptyScopeRefuses ? unchecked : null;
  const warehouseId = requestedInspireDb(req).warehouseId;
  const lost = [];
  let notChecked = !warehouseId;
  if (!notChecked) {
    try {
      const token = await appOwnToken();
      if (!token) throw new Error('no App token to list the scope');
      const { tables, more } = await scopeTables(dbFetch, req.dbHost, token, entries, SCOPE_PROBE_CEILING);
      if (more) notChecked = true; // an empty listing is nothing to read, not a probe that failed
      for (let i = 0; i < tables.length; i += SCOPE_PROBE_BATCH) {
        await Promise.all(tables.slice(i, i + SCOPE_PROBE_BATCH).map(async (table) => {
          try {
            const probe = tableProbeStatement(table);
            await executeSql(req.dbHost, person, warehouseId, probe.sql, probe.parameters);
          } catch (err) {
            const why = tableAccessReason(table, err && err.message);
            if (why === 'no read access' || why === 'not found') lost.push(table); else notChecked = true;
          }
        }));
      }
    } catch {
      notChecked = true;
    }
  }
  if (!lost.length && !notChecked) return null;
  if (!lost.length) return unchecked;
  return lostTablesRefusal(req, lost, {
    why: (names) => `Discover starts only while you can read ${names.join(', ')}, and you can no longer read ${names.length === 1 ? 'it' : 'them'}.`,
    message: (names, hidden) => (names.length
      ? `You can no longer read ${names.join(', ')}${hidden ? ` and ${countText(hidden)} more of this scope` : ''}, so the run did not start. Ask for access to ${names.length === 1 && !hidden ? 'it' : 'them'}, or take ${names.length === 1 && !hidden ? 'it' : 'them'} off your selection.`
      : `You can no longer read ${countText(hidden)} of this scope, so the run did not start. Take the tables you cannot read off your selection, or ask whoever owns them for access.`) });
}

// SEC-01 (W7): a session is shown only to its launcher (launchLedger launched_by) or to a person who can read every table in its scope with their
// own token. `scope` is { catalogs, schemas_str, tables_str } as __inspire_session stores it. Returns null when the person may see it, else the
// refusal of launcherReadRefusal (request 'person', a table-level SELECT). With no signed-in person there is nothing to check.
function sessionScopeText(scope) {
  return [scope && scope.catalogs, scope && scope.schemas_str, scope && scope.tables_str].map((v) => String(v || '').trim()).filter(Boolean).join(',');
}

// SEC-08 (c23): `tables` are the tables a hosted page really reads; when there are any they are checked in place of the session scope.
function scopeTextOf(scope, tables) {
  const named = (Array.isArray(tables) ? tables : []).map((t) => String(t || '').trim()).filter(Boolean);
  return named.length ? named.join(',') : sessionScopeText(scope);
}

async function sessionHiddenFrom(req, sessionId, scope, { tables } = {}) {
  const person = RP.forwardedPerson(req.headers);
  // Fail closed: with no person nothing is shown; with no sign-in token only the person's own launches are (their reads cannot be probed).
  if (!person) return { status: 403, request: 'person', permissions: [], unreadable: [] };
  const launcher = await readLaunchRecord(req, { kind: 'session', inspireDatabase: requestedInspireDb(req).inspireDatabase, sessionId: String(sessionId) }).catch(() => null);
  if (launcher && launcher === String(person).trim().toLowerCase()) return null;
  if (!forwardedTokenOf(req)) { // no sign-in token to probe reads with: only the launcher sees it
    // SEC-03 (c23): with no sign-in token the person's own listing cannot be asked, so no table name is shown.
    return { status: 403, request: 'person', permissions: [], unreadable: [] };
  }
  return launcherReadRefusal(req, scopeTextOf(scope, tables), { emptyScopeRefuses: true });
}

async function visibleSessions(req, warehouseId, parsedDb, sessions) {
  const person = RP.forwardedPerson(req.headers);
  if (!person) return [];
  if (!sessions.length) return sessions;
  const ids = [...new Set(sessions.map((s) => String(s.session_id)).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return [];
  const scopeRows = sqlResultToObjects(await executeSql(req.dbHost, await appOwnToken(), warehouseId,
    `SELECT session_id, catalogs, schemas_str, tables_str FROM \`${parsedDb.catalog}\`.\`${parsedDb.schema}\`.\`__inspire_session\` WHERE session_id IN (${ids.join(', ')})`));
  const scopes = new Map(scopeRows.map((r) => [String(r.session_id), r]));
  const verdicts = await Promise.all(sessions.map(async (s) => {
    const scope = scopes.get(String(s.session_id)) || {};
    try {
      return !(await sessionHiddenFrom(req, s.session_id, scope));
    } catch {
      return false; // a check that cannot finish shows nothing
    }
  }));
  return sessions.filter((_s, i) => verdicts[i]);
}

// SEC-02 (F4, REQ-518): the one session check every route and every implement handler calls before it reads anything. The scope is read
// with the App token (tracking table). Any failure to read it (no App token, no warehouse, bad id, read error) fails closed: the scope is
// treated as empty, which hides the session from everyone except its launcher. Returns null (may see) or the refusal.
function requestedInspireDb(req) {
  const asked = String((req.query && req.query.inspire_database) || (req.body && req.body.inspire_database) || '').trim();
  const warehouse = String((req.query && req.query.warehouse_id) || (req.body && req.body.warehouse_id) || DEFAULT_WAREHOUSE_ID || '').trim();
  return { inspireDatabase: asked || DEFAULT_INSPIRE_DB, warehouseId: warehouse };
}

async function sessionHidden(req, sessionId, { tables } = {}) {
  const sid = String(sessionId == null ? '' : sessionId).trim();
  let scope = null;
  try {
    const { inspireDatabase, warehouseId } = requestedInspireDb(req);
    const parsed = splitInspireDatabase(inspireDatabase);
    const token = await appOwnToken();
    if (isInt64Id(sid) && parsed && warehouseId && token) {
      const rows = sqlResultToObjects(await executeSql(req.dbHost, token, warehouseId,
        `SELECT session_id, catalogs, schemas_str, tables_str FROM \`${parsed.catalog}\`.\`${parsed.schema}\`.\`__inspire_session\` WHERE session_id = ${sid} LIMIT 1`));
      scope = rows[0] || null;
    }
  } catch {
    scope = null;
  }
  try {
    return await sessionHiddenFrom(req, sid, scope || {}, { tables });
  } catch {
    return { status: 403, request: 'person', permissions: [], unreadable: [] };
  }
}

// Cross-session lists: keeps the sessions the person may see. Same inspire database and warehouse as the request.
async function visibleSessionsOf(req, sessions) {
  const { inspireDatabase, warehouseId } = requestedInspireDb(req);
  const parsed = splitInspireDatabase(inspireDatabase);
  if (!parsed || !warehouseId) return [];
  try {
    return await visibleSessions(req, warehouseId, parsed, sessions);
  } catch {
    return [];
  }
}

// SEC-02 (F4): the newest sessions (the list the Start page shows) that this person may see. Cross-session reads start from this list.
async function visibleSessionList(req, warehouse_id, parsedDb, cap = SESSION_LIST_CAP) {
  const table = qualifiedInspireTable(parsedDb, '__inspire_session');
  const { sessions, truncated } = await loadSessionList(
    async (statement) => sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id, statement.sql, statement.parameters)), table, cap);
  return { rows: await visibleSessionsOf(req, sessions), truncated };
}

const SESSION_REFUSAL = 'You cannot open this session: you did not launch it and you cannot read every table it covers. Ask for access to the tables below.';
// SEC-02 (F4): answers 403 {request:'person'} and returns true when the session is hidden from this person. Every route that names a session
// calls it before it reads anything of that session.
async function refuseHiddenSession(req, res, sessionId) {
  const hidden = await sessionHidden(req, sessionId);
  if (!hidden) return false;
  PM_ERROR.sendFailure(res, 403, SESSION_REFUSAL, { request: 'person', permissions: hidden.permissions || [], unreadable: hidden.unreadable || [] });
  return true;
}

// SEC-01 (W2): Inspire's principal must hold no write privilege on a source. Unity Catalog's effective permissions decide, so a grant made
// higher up or through a group counts. Inspire's own catalog and schema are not sources and are left out.
const WRITE_GUARD_LIMIT = 50;
async function writeGuardRefusal(req, scope) {
  const token = await appOwnToken();
  const principal = SP_CLIENT_ID;
  const { catalogs, schemas, tables: picked } = ucMetadataParts(scope);
  const entries = [...picked, ...schemas, ...catalogs];
  if (!token || !principal || !entries.length) return null;
  const { tables } = await scopeTables(dbFetch, req.dbHost, token, entries);
  const own = splitInspireDatabase(DEFAULT_INSPIRE_DB);
  const ownKey = own ? `${own.catalog}.${own.schema}`.toLowerCase() : '';
  const skip = (type, name) => {
    const n = name.toLowerCase();
    return Boolean(ownKey) && (type === 'catalog' ? n === own.catalog.toLowerCase() : n === ownKey || n.startsWith(`${ownKey}.`));
  };
  const held = await heldWrites(dbFetch, req.dbHost, token, principal, tables.slice(0, WRITE_GUARD_LIMIT), skip);
  if (!held.length) return null;
  const lines = held.map((h) => `${h.privilege.replace(/_/g, ' ')} on ${h.type} ${h.name}: ${h.fix}`);
  return { status: 409, unreadable: [],
    message: `Inspire's service principal holds a write privilege on your source data, so the run did not start. Inspire only reads customer data. Remove it, then start again. ${lines.join('; ')}.` };
}

function refusalExtra(refusal) {
  return { unreadable: refusal.unreadable, ...(refusal.request ? { request: refusal.request } : {}), ...(refusal.permissions ? { permissions: refusal.permissions } : {}) };
}

async function policiedRefusal(req, policied) {
  const shown = await listableNames(req, policied);
  const hidden = policied.length - shown.length;
  const which = shown.length ? `${shown.join(', ')}${hidden ? ` and ${countText(hidden)} more` : ''}` : countText(hidden);
  return { status: 403, request: 'person', permissions: [], unreadable: shown, ...(hidden ? { unreadable_hidden: hidden } : {}),
    message: `Discover reads as the App, and ${which} of this scope ${policied.length === 1 ? 'has' : 'have'} a row filter or a column mask that the App's read does not apply to you, `
      + 'so the run did not start. Take them off your selection.' };
}

async function checkLaunchReads(req, params) {
  return raceLaunchCheck((async () => {
    const dropped = await droppedCatalogRefusal(req, params);
    if (dropped) return { reads: { refusal: dropped, skipped: [], warnings: [] }, access: { permissions: [], warnings: [] }, model: [] };
    const reads = await runReadPlan(dbFetch, req, discoverReads(params));
    if (!reads.refusal) {
      const lost = await launcherReadRefusal(req, reads.scope || params['01_uc_metadata'], { launch: true }).catch((err) => {
        console.warn(`launcher read check: ${err.message || err}`);
        return { ...UNCHECKED_SCOPE, message: LAUNCH_UNCHECKED_MESSAGE };
      });
      if (lost) return { reads: { ...reads, refusal: lost }, access: { permissions: [], warnings: [] }, model: [] };
    }
    if (!reads.refusal) {
      const writes = await writeGuardRefusal(req, reads.scope || params['01_uc_metadata']).catch((err) => {
        console.warn(`write guard: ${err.message || err}`);
        return null;
      });
      if (writes) return { reads: { ...reads, refusal: writes }, access: { permissions: [], warnings: [] }, model: [] };
    }
    const access = reads.refusal ? { permissions: [], warnings: [] } : await discoverAppAccess(req, reads.scope || params['01_uc_metadata']);
    // SEC-06 (c23): Discover reads as the App, which a person's row filter or column mask does not bind. Such a table stops the launch.
    if (access.policied && access.policied.length) {
      const refusal = await policiedRefusal(req, access.policied);
      return { reads: { ...reads, refusal }, access: { permissions: [], warnings: [] }, model: [] };
    }
    const model = await discoverModelAccess(req);
    return { reads, access, model };
  })());
}

async function launchDiscover(req, res, { params, notebook_path, cluster_id, profileId = '' }) {
  try {
    const refused = LC.launchParamsProblem(params) || await launchSessionProblem(req, params);
    if (refused) return res.status(403).json(RP.refusalBody(req.policyKey, 'launcher', `${refused}.`));
    const { reads, access, model } = await checkLaunchReads(req, params);
    if (reads.refusal) return PM_ERROR.sendFailure(res, reads.refusal.status, reads.refusal.message, refusalExtra(reads.refusal));
    if (model.length) return PM_ERROR.sendFailure(res, 403, MODEL_ACCESS_BLOCK, { permissions: model });
    if (reads.scope) params['01_uc_metadata'] = reads.scope;
    const out = await triggerInspireNotebookJob(req.dbHost, req.dbToken, {
      params,
      notebook_path,
      cluster_id,
      jobType: 'discovery',
      launchedBy: RP.forwardedPerson(req.headers),
      writeCheck: (writes) => outputWriteVerdict(req, writes),
      asker: req,
    });
    const profileWarning = profileId ? await linkProfileToRun(req, { profileId, sessionId: params['14_session_id'], inspireDatabase: params['02_inspire_database'] }) : '';
    const warnings = [...reads.warnings, ...access.warnings, ...(out.warnings || []), ...(profileWarning ? [profileWarning] : [])];
    const details = [...(reads.skipped.length ? [skippedTablesDetail(reads.skipped)] : []), ...(out.warning_details || [])];
    res.json({ ...out, ...(warnings.length ? { warnings } : {}), ...(access.permissions.length ? { permissions: access.permissions } : {}), ...(details.length ? { warning_details: details } : {}), ...(reads.skipped.length ? { skipped_tables: reads.skipped } : {}) });
  } catch (err) {
    if (err.writeRefusal) return res.status(err.writeRefusal.status).json(writeRefusalBody(req.policyKey, err.writeRefusal));
    const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    PM_ERROR.sendFailure(res, code, err.message);
  }
}

const discoverAccess = createSourceAccess({ executeSql, sqlResultToObjects, dbFetch, appToken: appOwnToken });

async function discoverAppAccess(req, scope) {
  // REQ-418: Discover reads the picked tables as the App's service principal. A person's own grants never decide what it reads.
  const token = await appOwnToken();
  const { catalogs, schemas, tables: picked } = ucMetadataParts(scope);
  const entries = [...picked, ...schemas, ...catalogs];
  const none = { warnings: [], permissions: [] };
  if (!entries.length || !token || !DEFAULT_WAREHOUSE_ID) return none;
  try {
    const { tables, more } = await scopeTables(dbFetch, req.dbHost, token, entries);
    if (!tables.length) return none;
    const found = await discoverAccess.sourceAccess(req, DEFAULT_WAREHOUSE_ID, tables, 'discover', { wholeCatalogs: catalogs });
    const warnings = [];
    const permissions = [];
    // SEC-01 (W1): the App's principal needs the grant, and its owner runs it. Discover never runs a grant with the launcher's sign-in: the
    // grant is named once as a Permission Required for the App's service principal.
    const read = appReadPermissions(found, SP_CLIENT_ID, { wholeCatalogs: catalogs });
    warnings.push(...read.warnings);
    permissions.push(...read.permissions);
    if (more) console.log(`Discover: checked the App read access of the first ${tables.length} tables only`);
    return { warnings, permissions, policied: found.policied || [] };
  } catch (err) {
    console.warn(`discover read check: ${err.message || err}`);
    return { permissions: [], warnings: [`Inspire could not check that the App can read the tables you picked (${String(err.message || err).slice(0, 200)}), so Discover reads them as picked`] };
  }
}

// The token the App's write check runs with: the App's service principal, the identity that writes the output (REQ-418).
async function appWriteTokenOf() {
  return (await appOwnToken()) || '';
}

async function outputWriteVerdict(req, writes, { preview = false } = {}) {
  const plan = await outputPlan(dbFetch, req, writes, { appToken: await appWriteTokenOf(), appId: SP_CLIENT_ID, preview });
  return { ...plan, checked: 'passed' };
}

app.post('/api/output-folder/check', requireToken, async (req, res) => {
  const writes = discoverWrites({ '11_generation_path': String((req.body || {}).generation_path || '') }, cachedNotebookPath || DEFAULT_NOTEBOOK_PATH);
  const verdict = await outputWriteVerdict(req, writes, { preview: true });
  if (verdict.refused) return res.status(verdict.refused.status).json(writeRefusalBody(req.policyKey, verdict.refused));
  res.json({ allowed: true, folder: verdict.folder || writes.folders[0], checked: verdict.checked, warnings: verdict.warnings,
    ...(verdict.details.length ? { warning_details: verdict.details } : {}),
    ...(verdict.generationPath ? { generation_path: verdict.generationPath } : {}) });
});

// ═══════════════════════════════════════════════════
//  Run status & output
// ═══════════════════════════════════════════════════

app.param('runId', (req, res, next, runId) => (isInt64Id(runId) ? next() : next('route')));

async function taskErrorOf(req, taskRunId) {
  try {
    const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get-output?run_id=${encodeURIComponent(taskRunId)}`);
    if (!response.ok) return '';
    const data = await response.json();
    return String(data.error || '').replace(/^[A-Za-z_.]*(Error|Exception):\s*/, '').trim().slice(0, 1200);
  } catch (_) {
    return '';
  }
}

app.get('/api/run/:runId', requireToken, async (req, res) => {
  try {
    // SEC-02 (F6 class, REQ-518): the run state and its tasks' error text belong to the run's session, so the same check as the output runs first.
    if (await refuseHiddenRun(req, res, req.params.runId)) return;
    const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get?run_id=${req.params.runId}`);
    if (!response.ok) {
      const action = `read run ${req.params.runId}`;
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }
    const data = parseExactJson(await response.text());
    const state = data.state || {};
    const tasks = await Promise.all((data.tasks || []).map(async (t) => ({
      task_key: t.task_key,
      life_cycle_state: t.state?.life_cycle_state || 'UNKNOWN',
      result_state: t.state?.result_state || null,
      state_message: t.state?.state_message || '',
      notebook_path: t.notebook_task?.notebook_path || null,
      run_id: t.run_id || null,
      ...(t.state?.result_state === 'FAILED' && t.run_id ? { error: await taskErrorOf(req, t.run_id) } : {}),
    })));
    res.json({
      run_id: data.run_id,
      life_cycle_state: state.life_cycle_state || 'UNKNOWN',
      result_state: state.result_state || null,
      state_message: state.state_message || '',
      start_time: data.start_time,
      end_time: data.end_time,
      setup_duration: data.setup_duration,
      execution_duration: data.execution_duration,
      cleanup_duration: data.cleanup_duration,
      run_duration: data.run_duration,
      run_page_url: data.run_page_url,
      run_name: data.run_name,
      tasks,
      ...(viewerNoteOf(req.params.runId) ? { viewer_note: viewerNoteOf(req.params.runId) } : {}),
    });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// SEC-02 (F6): the session a run made, from the launch ledger (the App's own tracking table). Null when the ledger has no row for the run.
async function launchOfRun(req, runId) {
  const table = L.launchTableName(DEFAULT_INSPIRE_DB);
  if (!table || !DEFAULT_WAREHOUSE_ID || !isInt64Id(runId)) return null;
  const rows = await launchSql(resolveHost(req), {
    sql: `SELECT run_id, session_id, launched_by FROM ${table} WHERE run_id = :run_id LIMIT 1`,
    parameters: [{ name: 'run_id', value: String(runId), type: 'BIGINT' }],
  }, await policyReadToken(req));
  return rows[0] || null;
}

// A run's output is the output of its session: the launcher, or a person who may see the session, reads it. A run the ledger cannot place is refused.
async function refuseHiddenRun(req, res, runId) {
  let launch = null;
  try { launch = await launchOfRun(req, runId); } catch { launch = null; }
  const person = String(RP.forwardedPerson(req.headers) || '').trim().toLowerCase();
  if (launch && person && String(launch.launched_by || '').trim().toLowerCase() === person) return false;
  if (launch && isInt64Id(String(launch.session_id || ''))) return refuseHiddenSession(req, res, launch.session_id);
  PM_ERROR.sendFailure(res, 403, SESSION_REFUSAL, { request: 'person', permissions: [], unreadable: [] });
  return true;
}

app.get('/api/run/:runId/output', requireToken, async (req, res) => {
  try {
    if (await refuseHiddenRun(req, res, req.params.runId)) return;
    const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.1/jobs/runs/get-output?run_id=${req.params.runId}`);
    if (!response.ok) {
      const action = `read the output of run ${req.params.runId}`;
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }
    const data = await response.json();
    res.json({
      notebook_output: data.notebook_output,
      metadata: data.metadata,
      error: data.error,
      error_trace: data.error_trace,
    });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/run/:runId/cancel', async (req, res) => {
  const key = 'POST /api/run/:runId/cancel';
  const verdict = await routePolicy.verdictFor(key, req);
  res.json(verdict.allowed ? { allowed: true } : { allowed: false, ...RP.refusalBody(key, verdict.rule, verdict.message) });
});

app.post('/api/run/:runId/cancel', requireToken, async (req, res) => {
  try {
    const response = await dbFetch(req.dbHost, req.dbToken, '/api/2.1/jobs/runs/cancel', {
      method: 'POST',
      body: jsonWithInt64Ids({ run_id: req.params.runId }, ['run_id']),
    });
    if (!response.ok) {
      const action = `cancel run ${req.params.runId}`;
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }
    res.json({ success: true });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  V43 Session & Step Tracking (READY/DONE Protocol)
// ═══════════════════════════════════════════════════

// Poll session status
app.get('/api/inspire/session', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }

    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;

    // Notebook uses individual widget columns (not a single widget_values VARIANT)
    const widgetColsBase = `business_name, inspire_database_name, operation_mode, table_election_mode, use_cases_quality, strategic_goals, business_priorities, business_domains, catalogs, schemas_str, tables_str, generate_choices, generation_path, output_language, sql_generation_per_domain, technical_exclusion_strategy, json_file_path`;
    const widgetColsV08 = `${widgetColsBase}, enriched_business_context, enriched_strategic_goals, enriched_business_priorities, enriched_strategic_initiative, enriched_value_chain, enriched_revenue_model, generation_instructions_section`;
    const widgetColsV13 = `${widgetColsV08}, discovery_type, strategic_context`;
    const widgetColsV14 = `${widgetColsV13}, table_scope`;
    const baseCols = `session_id, processing_status, completed_percent, create_at, last_updated, completed_on, inspire_json, results_json`;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    const where = session_id ? `WHERE session_id = ${String(session_id).trim()} LIMIT 1` : 'ORDER BY create_at DESC LIMIT 1';

    let result;
    const columnSets = [widgetColsV14, widgetColsV13, widgetColsV08, widgetColsBase];
    for (let i = 0; i < columnSets.length; i++) {
      try {
        result = await executeSql(req.dbHost, req.dbToken, warehouse_id, `SELECT ${baseCols}, ${columnSets[i]} FROM ${table} ${where}`);
        break;
      } catch (e1) {
        const msg = String(e1.message || e1);
        const missingColumn = /discovery_type|strategic_context|table_scope|enriched_|generation_instructions_section|UNRESOLVED_COLUMN|FIELD_NOT_FOUND|cannot resolve/i.test(msg);
        if (!missingColumn || i === columnSets.length - 1) throw e1;
      }
    }
    const rows = sqlResultToObjects(result);

    if (rows.length === 0) {
      return res.json({ session: null, message: 'No session found. The notebook may still be initializing.' });
    }

    const session = rows[0];

    // SEC-01 (W7): a session whose scope the person cannot read is not opened: 403, no session content, a table-level SELECT to ask for.
    const hidden = await sessionHiddenFrom(req, session.session_id, session);
    if (hidden) {
      return PM_ERROR.sendFailure(res, 403, 'You cannot open this session: you did not launch it and you cannot read every table it covers. Ask for access to the tables below.',
        { request: 'person', permissions: hidden.permissions, unreadable: hidden.unreadable });
    }

    // Reconstruct widget_values from individual columns for frontend compatibility
    session.widget_values = {
      business: session.business_name || '',
      '00_business_name': session.business_name || '',
      inspire_database: session.inspire_database_name || '',
      operation_mode: session.operation_mode || '',
      '15_operation': session.operation_mode || '',
      table_election_mode: session.table_election_mode || '',
      use_cases_quality: session.use_cases_quality || '',
      strategic_goals: session.strategic_goals || '',
      business_priorities: session.business_priorities || '',
      business_domains: session.business_domains || '',
      catalogs: session.catalogs || '',
      schemas: session.schemas_str || '',
      tables: session.tables_str || '',
      generate: session.generate_choices || '',
      generation_path: session.generation_path || '',
      output_language: session.output_language || '',
      enriched_business_context: session.enriched_business_context || '',
      enriched_strategic_goals: session.enriched_strategic_goals || '',
      enriched_business_priorities: session.enriched_business_priorities || '',
      enriched_strategic_initiative: session.enriched_strategic_initiative || '',
      enriched_value_chain: session.enriched_value_chain || '',
      enriched_revenue_model: session.enriched_revenue_model || '',
      generation_instructions_section: session.generation_instructions_section || '',
      discovery_type: discoveryTypeOf(session.discovery_type) ?? session.discovery_type,
      '03_discovery_type': discoveryTypeOf(session.discovery_type) ?? session.discovery_type,
      strategic_context: session.strategic_context || '',
      '10_strategic_context': session.strategic_context || '',
    };

    // Parse VARIANT fields (may come as object or string)
    for (const field of ['inspire_json', 'results_json']) {
      if (session[field] && typeof session[field] === 'string') {
        try { session[field] = parseExactJson(session[field]); } catch { session[field] = null; }
      } else if (!session[field]) {
        session[field] = null;
      }
    }

    // Parse numeric fields
    session.completed_percent = parseFloat(session.completed_percent) || 0;

    res.json({ session });
  } catch (err) {
    // Table might not exist yet — return null session
    if (isMissingTableError(err)) {
      return res.json({ session: null, message: 'Inspire is getting ready...' });
    }
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

async function readValueRows(req, warehouse_id, sql, parameters) {
  try {
    return sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id, sql, parameters));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

// REQ-078: the estimate for each use case that has no measured value, and the totals kept apart from measured money.
// With a session_id it answers that run; without one it answers every run (runs by session id) and the total over them.
// `read` holds rows already read for this run ({useCases, specRows, ledgerRows}); without it the run reads its own.
async function estimatesOfSession(req, warehouse_id, parsedDb, sid, read = null) {
  const useCases = read ? read.useCases : await readValueRows(req, warehouse_id, VE.useCasesSql(qualifiedInspireTable(parsedDb, '__inspire_usecases'), sid));
  const specRows = read ? read.specRows : await readValueRows(req, warehouse_id, VE.latestSpecsSql(implementTableName(parsedDb.catalog, parsedDb.schema), sid));
  const specs = new Map(specRows.map((row) => [String(row.use_case_id), VE.parseSpec(row.spec)]));
  const measured = valueOfSession(read ? read.ledgerRows : await readValueRows(req, warehouse_id, valueSessionSql(valueLedgerTable(parsedDb), sid))).use_cases;
  const baselineOf = async (resultTable, useCaseId) => {
    if (resultTableNameError(resultTable)) return null;
    try {
      const found = await executeSql(req.dbHost, req.dbToken, warehouse_id, VE.baselineSql(quoteTable(`${resultTable}_summary`)),
        [{ name: 'uc', value: useCaseId, type: 'STRING' }]);
      const row = sqlResultToObjects(found)[0];
      const baseline = row ? Number(row.kpi_baseline) : NaN;
      return Number.isFinite(baseline) ? baseline : null;
    } catch (err) {
      if (isMissingTableError(err)) return null;
      throw err;
    }
  };
  return VE.estimatesFor({ useCases, specs, measured, baselineOf });
}

app.get('/api/inspire/value/estimates', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    if (session_id === undefined || session_id === '') {
      // The same runs the Start list shows: the latest SESSION_LIST_CAP, newest first.
      const { rows, truncated } = await visibleSessionList(req, warehouse_id, parsedDb);
      const sids = rows.slice(0, SESSION_LIST_CAP).map((row) => String(row.session_id)).filter((sid) => !invalidSessionId(sid));
      const answers = await Promise.all(sids.map((sid) => estimatesOfSession(req, warehouse_id, parsedDb, sid)));
      const runs = Object.fromEntries(sids.map((sid, i) => [sid, answers[i]]));
      const { all, byRun } = await runValuesOf(req, warehouse_id, parsedDb);
      return res.json({ runs, totals: VE.mergeTotals(answers.map((answer) => answer.totals)), run_value: all, run_values: byRun, truncated, cap: SESSION_LIST_CAP, disclaimer: VALUE_DISCLAIMER.full });
    }
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (await refuseHiddenSession(req, res, session_id)) return;
    const sid = String(session_id).trim();
    const read = await valueRowsOf(req, warehouse_id, parsedDb, sid);
    const one = await totalsOfSession(req, warehouse_id, parsedDb, sid, read);
    res.json({ ...one.estimates, run_value: VT.runValueOf(one.use_cases, one.review), disclaimer: VALUE_DISCLAIMER.full });
  } catch (err) {
    PM_ERROR.sendFailure(res, PM_ERROR.failureStatus(err), err.message);
  }
});

app.get('/api/inspire/value', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id and session_id required.' });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (await refuseHiddenSession(req, res, session_id)) return;
    res.json({ ...valueOfSession(await readValueRows(req, warehouse_id, valueSessionSql(valueLedgerTable(parsedDb), String(session_id).trim()))), disclaimer: VALUE_DISCLAIMER.full });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// REQ-439: run and all-runs totals that include the values saved through Calculate (see lib/valueTotals.js).
// Every per-session statement is sent once. ids is one run id, or the list of runs of the all-runs read: the list form reads every run
// in one statement and the rows carry session_id, which splitBySession uses to hand each run its own rows.
async function valueRowsOf(req, warehouse_id, parsedDb, ids) {
  const latest = VT.answersSql(qualifiedInspireTable(parsedDb, '__inspire_value_answers'), ids);
  const [answerRows, tables, useCases, specRows, ledgerRows] = await Promise.all([
    readValueRows(req, warehouse_id, latest.sql, latest.parameters),
    readValueRows(req, warehouse_id, VT.tablesSql(qualifiedInspireTable(parsedDb, '__inspire_usecases'), ids)),
    readValueRows(req, warehouse_id, VE.useCasesSql(qualifiedInspireTable(parsedDb, '__inspire_usecases'), ids)),
    readValueRows(req, warehouse_id, VE.latestSpecsSql(implementTableName(parsedDb.catalog, parsedDb.schema), ids)),
    readValueRows(req, warehouse_id, valueSessionSql(valueLedgerTable(parsedDb), ids)),
  ]);
  return { answerRows, tables, useCases, specRows, ledgerRows };
}
const splitBySession = (rows, sid) => Object.fromEntries(Object.entries(rows).map(([kind, list]) => [kind, list.filter((row) => String(row.session_id) === sid)]));

async function totalsOfSession(req, warehouse_id, parsedDb, sid, rows = null) {
  const read = rows || await valueRowsOf(req, warehouse_id, parsedDb, sid);
  const saved = new Map(read.answerRows.map((row) => [String(row.use_case_id), VA_ANSWERS.versionOf(row)]));
  const noTable = new Set(read.tables.filter((row) => !String(row.primary_table || '').trim()).map((row) => String(row.id)));
  const estimated = await estimatesOfSession(req, warehouse_id, parsedDb, sid, read);
  const estimates = estimated.use_cases;
  const measured = await implementApi.measuredYearlyOf(req, warehouse_id, sid, parsedDb, { ledgerRows: read.ledgerRows, specRows: read.specRows, tableRows: read.tables });
  const tables = Object.fromEntries(read.tables.map((row) => [String(row.id), String(row.primary_table || '')]));
  const review = VR_REVIEW.savedReviewOf(read.answerRows, VA_ANSWERS.versionOf);
  return { ...VT.runOf({ ids: read.tables.map((row) => String(row.id)), saved, estimates, measured, noTable, tables, ledger: valueOfSession(read.ledgerRows).use_cases, review }), estimates: estimated };
}

// FX-34 (W16 D2/D3/D9): the run value of every run the Start list shows and of all of them, computed once by valueTotals. /value/totals,
// /value/estimates answers from here too, so the Start banner, bars and cards never disagree.
async function runValuesOf(req, warehouse_id, parsedDb) {
  const { rows, truncated } = await visibleSessionList(req, warehouse_id, parsedDb);
  const sessions = rows.slice(0, SESSION_LIST_CAP).filter((row) => !invalidSessionId(row.session_id));
  const sids = sessions.map((row) => String(row.session_id));
  const read = sids.length ? await valueRowsOf(req, warehouse_id, parsedDb, sids) : null;
  const answers = await Promise.all(sids.map((sid) => totalsOfSession(req, warehouse_id, parsedDb, sid, splitBySession(read, sid))));
  const values = answers.map((a) => VT.runValueOf(a.use_cases, a.review));
  const runs = sessions.map((row, i) => ({ session_id: String(row.session_id), name: row.business_name || '', created_at: row.create_at ?? null,
    ...values[i], run_value: values[i] }));
  return { runs, all: VT.mergedRunValueOf(answers.map((a) => a.use_cases)), truncated, byRun: Object.fromEntries(sids.map((sid, i) => [sid, values[i]])), answers, sids };
}

app.get('/api/inspire/value/totals', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    if (session_id === undefined || session_id === '') {
      const { runs, all, truncated } = await runValuesOf(req, warehouse_id, parsedDb);
      return res.json({ runs, all, truncated, cap: SESSION_LIST_CAP, disclaimer: VALUE_DISCLAIMER.full });
    }
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (await refuseHiddenSession(req, res, session_id)) return;
    const { estimates: _estimates, ...one } = await totalsOfSession(req, warehouse_id, parsedDb, String(session_id).trim());
    res.json({ ...one, run_value: VT.runValueOf(one.use_cases, one.review), disclaimer: VALUE_DISCLAIMER.full });
  } catch (err) {
    PM_ERROR.sendFailure(res, PM_ERROR.failureStatus(err), err.message);
  }
});

// Get step delta (new steps since last poll)
app.get('/api/inspire/steps', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id, since } = req.query;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }

    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_step\``;
    if (since && !isTimestampText(since)) {
      return res.status(400).json({ error: 'since must be a timestamp such as 2026-01-31T12:00:00.000Z.' });
    }
    if (await refuseHiddenSession(req, res, session_id)) return;
    const statement = stepsStatement(table, session_id, since);
    const result = await executeSql(req.dbHost, req.dbToken, warehouse_id, statement.sql, statement.parameters);
    const steps = sqlResultToObjects(result);

    // Parse result_json and progress_increment for each step
    for (const step of steps) {
      try { step.result_json = parseExactJson(step.result_json); } catch { step.result_json = null; }
      step.progress_increment = parseFloat(step.progress_increment) || 0;
    }

    res.json({ steps, count: steps.length });
  } catch (err) {
    if (isMissingTableError(err)) {
      return res.json({ steps: [], count: 0, message: 'Step table not yet created.' });
    }
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// Build progressive results from __inspire_step result_json (no need to wait for final results_json)
app.get('/api/inspire/step-results', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id, and session_id required.' });
    }

    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const stepTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_step\``;
    const sessionTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;
    if (await refuseHiddenSession(req, res, session_id)) return;

    // Fetch all ended_success steps that carry payload data
    const sql = `SELECT step_id, stage_name, step_name, status, result_json FROM ${stepTable} WHERE session_id = ${session_id} AND status IN (${LIVE_STEP_STATUSES.map((st) => `'${escapeSqlStringLiteral(st)}'`).join(', ')}) ORDER BY last_updated, step_id`;
    const runResults = runResultsStatement(sessionTable, session_id);

    const [result, sessionRows] = await Promise.all([
      executeSql(req.dbHost, req.dbToken, warehouse_id, sql),
      executeSql(req.dbHost, req.dbToken, warehouse_id, runResults.sql, runResults.parameters).then(sqlResultToObjects),
    ]);
    const steps = sqlResultToObjects(result);
    const executiveSummary = executiveSummaryOf(parseResultsJson(sessionRows[0]?.results_json));

    // Parse result_json for each step
    for (const step of steps) {
      try {
        if (step.result_json && typeof step.result_json === 'string') {
          step.result_json = parseExactJson(step.result_json);
        }
      } catch { step.result_json = null; }
    }

    const allUcs = liveUseCasesOf(steps);
    const domains = liveDomainsOf(allUcs);

    const progressiveResults = {
      executive_summary: executiveSummary,
      domains_summary: domains.map(d => `${d.domain_name}: ${d.use_cases.length} use cases`).join(', '),
      domains,
      table_registry: {},
      column_registry: {},
      _progressive: true,
      _use_case_count: allUcs.length,
      _step_count: steps.length,
    };

    console.log(`   📊 step-results: ${plural(allUcs.length, 'use case')} from ${plural(steps.length, 'step')}, ${plural(domains.length, 'domain')}`);
    res.json({ results: progressiveResults, session_id });
  } catch (err) {
    if (isMissingTableError(err)) {
      return res.json({ results: null, message: 'Step table not yet created.' });
    }
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// The Table Scope of each session the use-case rows belong to, read from __inspire_session with the person's sign-in. A session whose
// Table Scope cannot be read maps to no entry, so its use cases show that the Data Filters could not be read, never that there are none.
async function tableScopesOfRows(req, warehouseId, catalog, schema, rows) {
  const ids = [...new Set(rows.map((r) => int64Id(r.session_id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const sql = `SELECT CAST(session_id AS STRING) AS session_id, table_scope FROM \`${catalog}\`.\`${schema}\`.\`__inspire_session\` WHERE session_id IN (${ids.join(', ')})`;
  try {
    const result = await executeSql(req.dbHost, req.dbToken, warehouseId, sql);
    return scopesOfSessions(sqlResultToObjects(result).map((r) => [r.session_id, r.table_scope]));
  } catch (err) {
    console.warn(`usecases: the Data Filters of the sessions could not be read, so their use cases say so: ${err.message}`);
    return new Map();
  }
}

// REQ-389: the Table Scope each use case's latest built version read, keyed by session and use case. A build that chose its own scope on
// the Data step has it in its spec; a use case no build chose for has no entry, so its Discover run's scope is shown. When the build record
// cannot be read, no entry is known: those use cases show the Discover run's scope and carry unread, so the App says so.
async function builtScopesOfRows(req, warehouseId, catalog, schema, rows) {
  const sids = [...new Set(rows.map((r) => int64Id(r.session_id)).filter(Boolean))];
  const built = new Map();
  const framings = new Map();
  if (!sids.length) return { built, framings, unread: false };
  try {
    const history = new Map();
    const sql = latestBuiltRowsSql(implementTableName(catalog, schema), sids);
    for (const row of sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouseId, sql)).map(parseImplementRow)) {
      const key = `${row.session_id}|${row.use_case_id}`;
      history.set(key, [...(history.get(key) || []), row]);
    }
    for (const [key, versions] of history) {
      const scope = builtTableScopeOf(versions);
      if (scope !== undefined) built.set(key, scope);
      const framing = builtFramingOf(versions);
      if (framing !== undefined) framings.set(key, framing);
    }
    return { built, framings, unread: false };
  } catch (err) {
    console.warn(`usecases: the scope the latest build read could not be read, so the Discover run's Data Filters are shown: ${err.message}`);
    return { built, framings, unread: true };
  }
}

// Get use cases from __inspire_usecases table (final polished data)
app.get('/api/inspire/usecases', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id, all_sessions, limit: limitRaw } = req.query;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }
    const listAll =
      String(all_sessions || '').toLowerCase() === '1' ||
      String(all_sessions || '').toLowerCase() === 'true';
    if (!listAll && (session_id == null || String(session_id).trim() === '')) {
      return res.status(400).json({
        error: 'session_id required, or pass all_sessions=1 to list use cases from every session.',
      });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    if (!listAll && await refuseHiddenSession(req, res, session_id)) return;
    let sql;
    if (listAll) {
      const lim = Math.min(Math.max(parseInt(String(limitRaw || '300'), 10) || 300, 1), 1000);
      // SEC-02 (F4): only the sessions this person may see are read.
      const shownIds = (await visibleSessionList(req, warehouse_id, parsedDb, sessionListCap(true))).rows.map((r) => String(r.session_id)).filter((id) => /^\d+$/.test(id));
      if (!shownIds.length) return res.json({ usecases: [], count: 0, all_sessions: true });
      sql = `SELECT * FROM ${table} WHERE session_id IN (${shownIds.join(', ')}) ORDER BY session_id DESC, id LIMIT ${lim}`;
    } else {
      sql = `SELECT * FROM ${table} WHERE session_id = ${session_id} ORDER BY id`;
    }
    const result = await executeSql(req.dbHost, req.dbToken, warehouse_id, sql);
    const rows = sqlResultToObjects(result);
    // Normalize tracking table snake_case → frontend Title Case
    for (const row of rows) {
      row.No = row.id || '';
      row.original_name = row.use_case || row.Name || '';
      row.Name = row.user_use_case_name || row.original_name;
      row.docs_generated_at = row.docs_generated_at || null;
      row.short_name = row.short_name || row.use_case || '';
      row['Business Domain'] = row.business_domain || '';
      row.Subdomain = row.subdomain || '';
      row.Statement = row.statement || row.description || '';
      row.Solution = row.solution || '';
      row['Business Value'] = row.business_value || '';
      row.Beneficiary = row.beneficiary || '';
      row.Sponsor = row.sponsor || '';
      row.Priority = row.priority_score ? (row.priority_score >= 4 ? 'Very High' : row.priority_score >= 3 ? 'High' : row.priority_score >= 2 ? 'Medium' : 'Low') : '';
      row.Quality = row.quality_score ? (row.quality_score >= 4 ? 'Very High' : row.quality_score >= 3 ? 'High' : row.quality_score >= 2 ? 'Medium' : 'Low') : '';
      row.type = row.type || '';
      row['Analytics Technique'] = row.analytics_technique || '';
      row['Business Priority Alignment'] = row.business_priority_alignment || '';
      row['Tables Involved'] = row.tables_involved || '';
      row['Primary Table'] = row.primary_table || '';
      row.notebook_path = row.notebook_path || row.NOTEBOOK_PATH || row.Notebook_Path || '';
      row.genie_instruction = stripAiDemoDisclaimerHtml(
        row.genie_instruction || row.GENIE_INSTRUCTION || row.Genie_Instruction || '',
      );
      row['Technical Design'] = row.high_level_design || '';
      row._domain = row.business_domain || '';
      row['Idea Theme'] = row.idea_theme || '';
      row['BoB Score'] = row.bob_score != null && row.bob_score !== '' ? row.bob_score : '';
      row['BoB Technical'] = row.bob_tier1_score != null && row.bob_tier1_score !== '' ? row.bob_tier1_score : '';
      row['BoB Business'] = row.bob_tier2_score != null && row.bob_tier2_score !== '' ? row.bob_tier2_score : '';
      row['BoB PBA'] = row.bob_tier3_score != null && row.bob_tier3_score !== '' ? row.bob_tier3_score : '';
      const hgc = (row.has_genie_code || '').toString().trim();
      row.has_genie_code_flag = hgc === 'Y' || hgc === 'Yes';
      row.generate_genie_code_instruction = row.generate_genie_code_instruction || '';
      // v1.2.0 tracking columns — nullable on older sessions.
      row.quality = row.quality ?? null;
      row.quality_mode = row.quality_mode ?? null;
      row.elite_status = row.elite_status ?? null;
      row.elite_score = row.elite_score ?? null;
      row.elite_assessment = row.elite_assessment ?? null;
      row.selection_flags = row.selection_flags ?? null;
      normalizeV130UseCaseFields(row);
    }
    console.log(
      listAll
        ? `   📋 usecases: ${plural(rows.length, 'row')} (all_sessions, limit applied)`
        : `   📋 usecases: ${plural(rows.length, 'row')} for session ${session_id}`
    );
    // REQ-171: each use case carries the Data Filters of its session's Table Scope, so the App shows them on the use case.
    const sessionScopes = await tableScopesOfRows(req, warehouse_id, catalog, schema, rows);
    const builtScopes = await builtScopesOfRows(req, warehouse_id, catalog, schema, rows);
    for (const row of rows) {
      const chosen = builtScopes.built.get(`${row.session_id}|${row.id}`);
      const scopes = chosen !== undefined ? chosen : sessionScopes.get(String(row.session_id));
      row.data_filters = scopes === undefined ? null : dataFiltersOf(row, scopes);
      row.build_scope_unread = builtScopes.unread;
      // REQ-389 (R49): the App's use case text is the text the latest build carried; a use case no build framed keeps its Discover statement.
      Object.assign(row, builtTextOf(builtScopes.framings.get(`${row.session_id}|${row.id}`)));
    }
    res.json({ usecases: rows, count: rows.length, all_sessions: listAll });
  } catch (err) {
    if (isMissingTableError(err)) {
      return res.json({ usecases: [], count: 0, message: 'Usecases table not found.' });
    }
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.post('/api/inspire/usecase-name', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id, use_case_id, name: rawName } = req.body || {};
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id are required.' });
    }
    const sidStr = int64Id(session_id);
    if (!sidStr) return res.status(400).json({ error: 'session_id must be a numeric Inspire session id.' });
    const id = String(use_case_id ?? '').trim();
    if (!/^[a-zA-Z0-9_.\-]+$/.test(id)) return res.status(400).json({ error: USE_CASE_ID_SHAPE });
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    const { name, error } = normalizeUseCaseName(rawName);
    if (error) return res.status(400).json({ error });
    const table = `\`${parsedDb.catalog}\`.\`${parsedDb.schema}\`.\`__inspire_usecases\``;
    await ensureTableColumns(req.dbHost, req.dbToken, warehouse_id, table, [['user_use_case_name', 'STRING']]);
    const stmt = renameStatement(table, sidStr, id, name);
    await executeSql(req.dbHost, req.dbToken, warehouse_id, stmt.sql, stmt.parameters);
    console.log(`   ✏️ use case name: session=${sidStr}, use_case=${id}, ${name ? 'renamed' : 'cleared'}`);
    res.json({ success: true, session_id: sidStr, use_case_id: id, name });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ACK: set processing_status = 'done'
app.post('/api/inspire/ack', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.body;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id, and session_id required.' });
    }

    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    // SEC-10 (c23): only a person who may see the session acknowledges it; the database is the App's own (the SEC-07 middleware).
    if (await refuseHiddenSession(req, res, session_id)) return;
    const { catalog, schema } = parsedDb;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;
    const sql = `UPDATE ${table} SET processing_status = 'done' WHERE session_id = ${session_id} AND processing_status = 'ready'`;

    await executeSql(req.dbHost, req.dbToken, warehouse_id, sql);
    console.log(`   ✅ ACK sent for session ${session_id}`);
    res.json({ success: true });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

function feedbackTables(inspire_database) {
  const parsedDb = splitInspireDatabase(inspire_database);
  if (!parsedDb) return null;
  const prefix = `\`${parsedDb.catalog}\`.\`${parsedDb.schema}\``;
  return { feedback: `${prefix}.\`__inspire_feedback\``, session: `${prefix}.\`__inspire_session\`` };
}

app.post('/api/inspire/feedback', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id } = req.body || {};
    const tables = feedbackTables(inspire_database);
    if (!tables || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database (catalog.schema) and warehouse_id required.' });
    }
    const values = validateFeedbackBody(req.body);
    // SEC-13 (c23): the visibility check comes first, so a hidden session and one that does not exist answer the same 403 and nothing is written.
    if (await refuseHiddenSession(req, res, values.sessionId)) return;
    const lookup = sessionBusinessStatement(tables.session, values.sessionId);
    const sessionRows = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id, lookup.sql, lookup.parameters));
    if (!sessionRows.length) return res.status(404).json({ error: `Session ${values.sessionId} not found.` });
    const insert = feedbackInsertStatement(tables.feedback, values, sessionRows[0].business_name, (await personOf(req)).username);
    await executeSql(req.dbHost, req.dbToken, warehouse_id, insert.sql, insert.parameters);
    res.json({ success: true, available: true, status: values.status, use_case_key: values.useCaseKey });
  } catch (err) {
    if (err.statusCode === 400) return PM_ERROR.sendFailure(res, 400, err.message);
    if (isMissingTableError(err)) return res.status(409).json({ available: false, error: FEEDBACK_NOT_AVAILABLE });
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/inspire/feedback', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, business_name } = req.query;
    const tables = feedbackTables(inspire_database);
    if (!tables || !warehouse_id || !String(business_name || '').trim()) {
      return res.status(400).json({ error: 'inspire_database (catalog.schema), warehouse_id and business_name required.' });
    }
    // SEC-02 (F4): feedback on a session this person may not see is left out, so the business's sessions are checked first.
    const business = String(business_name).trim().toLowerCase();
    const parsedDb = splitInspireDatabase(inspire_database);
    const listed = parsedDb ? (await visibleSessionList(req, warehouse_id, parsedDb, sessionListCap(true))).rows : [];
    const shown = new Set(listed.filter((r) => String(r.business_name || '').trim().toLowerCase() === business).map((r) => String(r.session_id)));
    if (!shown.size) return res.json({ available: true, history: [], latest: [] });
    const query = feedbackHistoryStatement(tables.feedback, business_name);
    const history = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id, query.sql, query.parameters))
      .filter((r) => shown.has(String(r.session_id)));
    res.json({ available: true, history, latest: latestFeedbackByKey(history) });
  } catch (err) {
    if (isMissingTableError(err)) return res.json({ available: false, history: [], latest: [], message: FEEDBACK_NOT_AVAILABLE });
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});


const implementApi = registerImplementRoutes(app, {
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
  hostedRun,
  runDefaults: () => ({ inspireDatabase: DEFAULT_INSPIRE_DB, warehouseId: DEFAULT_WAREHOUSE_ID }),
  appToken: appOwnToken,
  appId: SP_CLIENT_ID,
  sessionHidden,
  visibleSessions: visibleSessionsOf,
});

registerMacroRoutes(app, { requireToken, executeSql, sqlResultToObjects, fetchImpl: fetch, now: () => new Date() });

/**
 * Sync Route 1 flags to Delta while selecting (debounced in UI). Same SQL as generate-genie minus the job.
 * use_case_ids may be empty → only clears generate_genie_code_instruction to 'No' for the session.
 */
app.post('/api/inspire/sync-genie-flags', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id, use_case_ids: useCaseIdsRaw } = req.body || {};
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
    if (use_case_ids.length > 50) {
      return res.status(400).json({ error: 'At most 50 use cases per sync.' });
    }
    const safeIds = use_case_ids.filter((id) => /^[a-zA-Z0-9_.\-]+$/.test(id));
    if (safeIds.length !== use_case_ids.length && use_case_ids.length > 0) {
      return res.status(400).json({
        error: USE_CASE_ID_SHAPE,
      });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    await runRoute1GenieFlagUpdates(req.dbHost, req.dbToken, warehouse_id, catalog, schema, sidStr, safeIds);
    console.log(`   🧞 sync-genie-flags: session=${sidStr}, flagged=${safeIds.length}`);
    res.json({ success: true, session_id: sidStr, flagged_use_case_ids: safeIds });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

/**
 * Progress for Genie regen on selected use cases only: rows still flagged generate_genie_code_instruction=Yes.
 * (Using "not Yes" as "done" wrongly showed 100% for already-finished rows before a new run.)
 * Optional run_id adds Jobs API life_cycle_state for the notebook run.
 */
app.get('/api/inspire/genie-progress', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id, use_case_ids, run_id } = req.query;
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id, and session_id required.' });
    }
    const sidStr = int64Id(session_id);
    if (!sidStr) {
      return res.status(400).json({ error: 'session_id must be numeric.' });
    }
    const ids = String(use_case_ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'use_case_ids required (comma-separated tracking ids).' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'At most 50 ids.' });
    }
    const safeIds = ids.filter((id) => /^[a-zA-Z0-9_.\-]+$/.test(id));
    if (safeIds.length !== ids.length) {
      return res.status(400).json({ error: 'Invalid use_case_ids.' });
    }
    const parsedDb = splitInspireDatabase(String(inspire_database));
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const ucTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_usecases\``;
    if (await refuseHiddenSession(req, res, sidStr)) return;
    const inList = safeIds.map((id) => `'${escapeSqlStringLiteral(id)}'`).join(',');
    const sql = `SELECT
        CAST(COUNT(*) AS INT) AS selected_total,
        CAST(SUM(CASE WHEN UPPER(TRIM(COALESCE(generate_genie_code_instruction, 'No'))) = 'YES' THEN 1 ELSE 0 END) AS INT) AS remaining_yes
      FROM ${ucTable}
      WHERE session_id = ${sidStr} AND id IN (${inList})`;
    const result = await executeSql(req.dbHost, req.dbToken, warehouse_id, sql);
    const rows = sqlResultToObjects(result);
    const row = rows[0] || {};
    const total = Number(row.selected_total) || 0;
    const remainingYes = Number(row.remaining_yes) || 0;
    const done = Math.max(0, total - remainingYes);
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

    let run_life_cycle_state = null;
    let run_result_state = null;
    if (run_id && String(run_id).trim()) {
      const jr = await dbFetch(
        req.dbHost,
        req.dbToken,
        `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(String(run_id).trim())}`,
      );
      if (jr.ok) {
        try {
          const j = await jr.json();
          run_life_cycle_state = j.state?.life_cycle_state ?? null;
          run_result_state = j.state?.result_state ?? j.status?.state ?? null;
        } catch { /* ignore */ }
      }
    }

    res.json({
      session_id: sidStr,
      selected_total: total,
      remaining_yes: remainingYes,
      /** Rows among selected that are no longer flagged Yes (same as done count). */
      cleared: done,
      percent,
      run_life_cycle_state,
      run_result_state,
    });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// Get results_json for completed session
app.get('/api/inspire/results', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }

    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;

    let sql;
    if (session_id) {
      if (await refuseHiddenSession(req, res, session_id)) return;
      sql = `SELECT results_json, completed_on, session_id FROM ${table} WHERE session_id = ${session_id} LIMIT 1`;
    } else {
      // Get the latest completed session this person may see (SEC-02 F4): the newest ones are checked in order.
      const latest = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id,
        `SELECT session_id FROM ${table} WHERE results_json IS NOT NULL AND completed_on IS NOT NULL AND COALESCE(LOWER(processing_status), '') <> 'failed' ORDER BY completed_on DESC LIMIT 20`));
      const visible = await visibleSessionsOf(req, latest);
      if (!visible.length) return res.json({ results: null, found: false, message: 'No completed session found.' });
      sql = `SELECT results_json, completed_on, session_id FROM ${table} WHERE session_id = ${String(visible[0].session_id).replace(/\D/g, '')} LIMIT 1`;
    }

    const result = await executeSql(req.dbHost, req.dbToken, warehouse_id, sql);
    const rows = sqlResultToObjects(result);

    if (rows.length === 0) {
      return res.json({ results: null, found: false, message: session_id ? `No run ${session_id} in this Inspire Database.` : 'No completed session found.' });
    }
    if (!rows[0].completed_on) {
      return res.json({ results: null, found: true, message: 'The run has not completed yet.' });
    }

    const raw = rows[0].results_json;
    let results = parseResultsJson(raw);
    console.log('   📊 results_json type:', typeof raw, '| domains:', Array.isArray(results?.domains) ? results.domains.length : 'N/A', '| has use_cases:', !!results?.use_cases);

    if (results) {
      const cleaned = stripDisclaimerDeep(results);
      results = { ...cleaned, executive_summary: executiveSummaryOf(cleaned) };
    }

    res.json({
      results,
      found: true,
      session_id: rows[0].session_id,
      completed_on: rows[0].completed_on,
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      // No results yet for a fresh workspace: the normal first-run state. The App shows nothing scary.
      return res.json({ results: null, found: false, first_run: true });
    }
    if (isReadDenied(err.message)) return PM_ERROR.sendFailure(res, 403, err.message);
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Business profiles (REQ-364 to REQ-366): named copies of the Start form, shared by everyone on the App.
//  Stored in the App's own database with the App's token, like the launch record. A run started with one is linked to it by session.
// ═══════════════════════════════════════════════════

const PROFILE_NO_DATABASE = 'Inspire has no database of its own set, so it has no business profiles';
let profileTablesReady = false;

function profileTableNames() {
  const profiles = BP.profilesTable(DEFAULT_INSPIRE_DB);
  const links = BP.linksTable(DEFAULT_INSPIRE_DB);
  return profiles && links && DEFAULT_WAREHOUSE_ID ? { profiles, links } : null;
}

// Both profile tables must exist before any read of them. Checked on each read, so a list never sends a read that Databricks fails.
async function profileTablesPresent(req) {
  const statement = BP.presentTablesStatement(DEFAULT_INSPIRE_DB);
  return BP.profilesPresent(await launchSql(req.dbHost, statement, req.dbToken));
}

async function ensureProfileTables(host, token, names) {
  if (profileTablesReady) return;
  await executeSql(host, token, DEFAULT_WAREHOUSE_ID, BP.createProfileSql(names.profiles));
  await executeSql(host, token, DEFAULT_WAREHOUSE_ID, BP.createLinkSql(names.links));
  profileTablesReady = true;
}

app.get('/api/inspire/profiles', requireToken, async (req, res) => {
  const names = profileTableNames();
  if (!names) return res.status(503).json({ error: PROFILE_NO_DATABASE });
  try {
    if (!(await profileTablesPresent(req))) return res.json({ profiles: [] });
    const rows = await launchSql(req.dbHost, BP.listStatement(names.profiles, req.query.business_name), req.dbToken);
    res.json({ profiles: rows.map(BP.profileSummary) });
  } catch (err) {
    if (isMissingTableError(err)) return res.json({ profiles: [] });
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

app.get('/api/inspire/profiles/:profileId', requireToken, async (req, res) => {
  const names = profileTableNames();
  if (!names) return res.status(503).json({ error: PROFILE_NO_DATABASE });
  const statement = BP.getStatement(names.profiles, req.params.profileId);
  if (!statement) return res.status(400).json({ error: 'profile_id must be a profile id Inspire gave out' });
  try {
    if (!(await profileTablesPresent(req))) return res.status(404).json({ error: 'That business profile was not found' });
    const [row] = await launchSql(req.dbHost, statement, req.dbToken);
    if (!row) return res.status(404).json({ error: 'That business profile was not found' });
    res.json({ profile: BP.profileDetail(row) });
  } catch (err) {
    if (isMissingTableError(err)) return res.status(404).json({ error: 'That business profile was not found' });
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// Saves a profile under its name. A name that is taken answers 409 unless the save says overwrite, so the page asks first.
app.post('/api/inspire/profiles', requireToken, async (req, res) => {
  const saved = BP.profileToSave(req.body);
  if (saved.error) return res.status(400).json({ error: saved.error });
  const names = profileTableNames();
  if (!names) return res.status(503).json({ error: PROFILE_NO_DATABASE });
  const by = RP.forwardedPerson(req.headers);
  try {
    await ensureProfileTables(req.dbHost, req.dbToken, names);
    const [existing] = await launchSql(req.dbHost, BP.findByNameStatement(names.profiles, saved.name), req.dbToken);
    // SEC-11 (c23): a profile feeds later runs' prompts, so only the person who last updated it, or an App manager, replaces it.
    if (existing && saved.overwrite) {
      const [current] = await launchSql(req.dbHost, BP.getStatement(names.profiles, String(existing.profile_id)), req.dbToken);
      const owner = String((current && current.updated_by) || '').trim().toLowerCase();
      if (!(owner && by && owner === String(by).trim().toLowerCase()) && !(await isManager(req))) {
        return res.status(403).json({ error: `The business profile "${saved.name}" was last updated by someone else. Only that person or an App manager can replace it; save yours under another name.` });
      }
    }
    if (existing && !saved.overwrite) {
      return res.status(409).json({ error: `A business profile named "${saved.name}" already exists. Save it again to replace it.`, exists: true, profile_id: String(existing.profile_id) });
    }
    const profileId = existing ? String(existing.profile_id) : crypto.randomUUID();
    const write = existing ? BP.overwriteStatement : BP.insertStatement;
    const statement = write(names.profiles, { profileId, name: saved.name, businessName: saved.businessName, specJson: saved.specJson, by });
    await executeSql(req.dbHost, req.dbToken, DEFAULT_WAREHOUSE_ID, statement.sql, statement.parameters);
    res.json({ profile: BP.profileSummary({ profile_id: profileId, name: saved.name, business_name: saved.businessName, updated_by: by, updated_at: new Date().toISOString() }) });
  } catch (err) {
    const code = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
    PM_ERROR.sendFailure(res, code, err.message);
  }
});

// The run is already submitted, so a link that fails is a warning on the launch, never a failed launch.
async function linkProfileToRun(req, { profileId, sessionId, inspireDatabase }) {
  const names = profileTableNames();
  if (!names) return 'Inspire has no database of its own set, so this run is not linked to its business profile';
  try {
    await ensureProfileTables(req.dbHost, req.dbToken, names);
    const [row] = await launchSql(req.dbHost, BP.getStatement(names.profiles, profileId), req.dbToken);
    if (!row) return 'The business profile of this run was not found, so the run is not linked to it';
    const link = BP.linkInsertStatement(names.links, { inspireDatabase, sessionId, profileId, by: RP.forwardedPerson(req.headers) });
    await executeSql(req.dbHost, req.dbToken, DEFAULT_WAREHOUSE_ID, link.sql, link.parameters);
    return '';
  } catch (err) {
    console.warn(`business profile link for session ${sessionId} failed: ${err.message}`);
    return `Inspire started the run but could not link it to its business profile (${String(err.message).slice(0, 200)})`;
  }
}

async function attachSessionProfiles(req, inspireDatabase, sessions) {
  const names = profileTableNames();
  const statement = names ? BP.linksOfSessionsStatement(names.links, names.profiles, inspireDatabase, sessions.map((s) => s.session_id)) : null;
  if (!statement) return;
  try {
    if (!(await profileTablesPresent(req))) return;
    BP.withProfiles(sessions, await launchSql(req.dbHost, statement, req.dbToken));
  } catch (err) {
    if (!isMissingTableError(err)) console.warn(`[sessions] the business profiles of the runs could not be read: ${err.message}`);
  }
}

// List all sessions (for results page - pick which session to view)
app.get('/api/inspire/sessions', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id } = req.query;
    if (!inspire_database || !warehouse_id) {
      return res.status(400).json({ error: 'inspire_database and warehouse_id required.' });
    }

    const parsed = splitInspireDatabase(inspire_database);
    if (!parsed) {
      return res.status(400).json({
        error: INSPIRE_DB_SHAPE,
      });
    }
    const { catalog, schema } = parsed;
    const table = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;
    // Omit results_json — payloads can exceed SQL Statement API INLINE (~25MB) limit for LIMIT 20.
    // Full results load per session via GET /api/inspire/results.
    const { sessions, truncated } = await loadSessionList(
      async (statement) => sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id, statement.sql, statement.parameters)),
      table,
      sessionListCap(req.query.all === '1'),
    );
    sessions.unshift(...await startingSessions(req, inspire_database, warehouse_id, sessions));
    // SEC-01 (W7): sessions the person did not launch and cannot read the scope of are not listed.
    const shown = await visibleSessions(req, warehouse_id, parsed, sessions);
    sessions.splice(0, sessions.length, ...shown);

    for (const s of sessions) {
      // Reconstruct widget_values from individual columns
      s.widget_values = {
        business: s.business_name || '',
        '00_business_name': s.business_name || '',
        inspire_database: s.inspire_database_name || '',
        operation_mode: s.operation_mode || '',
        generation_path: s.generation_path || '',
      };
      s.completed_percent = parseFloat(s.completed_percent) || 0;
    }

    await attachSessionUsecaseOverviews(
      req.dbHost,
      req.dbToken,
      warehouse_id,
      catalog,
      schema,
      sessions
    );
    await attachSessionProfiles(req, inspire_database, sessions);

    res.json({ sessions, truncated });
  } catch (err) {
    const msg = err.message || String(err);
    if (isMissingTableError(msg)) {
      // A fresh workspace has no runs yet: that is the normal first-run state, not an error. The App shows its empty state.
      return res.json({ sessions: [], first_run: true });
    }
    // Non-fatal: allow "New experiment" when workspace is unreachable or not yet provisioned
    if (
      msg.includes('Cannot reach Databricks') ||
      msg.includes('fetch failed') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT')
    ) {
      console.warn('[sessions] connection failed:', msg);
      return res.json({
        sessions: [],
        connection_error: msg,
        message: 'Could not reach Databricks. You can still start a new experiment.',
      });
    }
    PM_ERROR.sendFailure(res, 500, msg);
  }
});

// Delete a session by session_id
app.delete('/api/inspire/session', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id, and session_id required.' });
    }
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) {
      return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    }
    const { catalog, schema } = parsedDb;
    const sessionTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_session\``;
    const stepTable = `\`${catalog}\`.\`${schema}\`.\`__inspire_step\``;

    // Delete from step tracking table first (may not exist)
    try {
      await executeSql(req.dbHost, req.dbToken, warehouse_id,
        `DELETE FROM ${stepTable} WHERE session_id = ${session_id}`);
    } catch { /* step table may not exist */ }

    // Delete from session table
    await executeSql(req.dbHost, req.dbToken, warehouse_id,
      `DELETE FROM ${sessionTable} WHERE session_id = ${session_id}`);

    res.json({ success: true, message: `Session ${session_id} deleted.` });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

const RUN_LOG_TAIL_BYTES = 512 * 1024;

async function readLogTail(host, token, logPath, maxBytes = RUN_LOG_TAIL_BYTES) {
  const apiPath = fsApiPath('files', logPath);
  const head = await dbFetch(host, token, apiPath, { method: 'HEAD' });
  if (!head.ok) return { status: head.status };
  const size = Number(head.headers.get('content-length')) || 0;
  const from = size > maxBytes ? size - maxBytes : 0;
  const resp = await dbFetch(host, token, apiPath, from ? { headers: { Range: `bytes=${from}-` } } : {});
  if (!resp.ok) return { status: resp.status };
  const text = await resp.text();
  const cut = from > 0 && resp.status === 206;
  const tail = cut ? text.slice(text.indexOf('\n') + 1) : text.slice(-maxBytes);
  return { status: 200, size, truncated: from > 0, text: tail };
}

app.get('/api/inspire/log', requireToken, async (req, res) => {
  try {
    const { inspire_database, warehouse_id, session_id } = req.query;
    if (!inspire_database || !warehouse_id || !session_id) {
      return res.status(400).json({ error: 'inspire_database, warehouse_id, and session_id required.' });
    }
    if (invalidSessionId(session_id)) return res.status(400).json({ error: 'session_id must be numeric.' });
    const parsedDb = splitInspireDatabase(inspire_database);
    if (!parsedDb) return res.status(400).json({ error: INSPIRE_DB_SHAPE });
    const { catalog, schema } = parsedDb;
    const rows = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse_id,
      `SELECT business_name FROM \`${catalog}\`.\`${schema}\`.\`__inspire_session\` WHERE session_id = ${session_id} LIMIT 1`));
    if (!rows.length) return res.status(404).json({ error: `Session ${session_id} is not in ${catalog}.${schema}.` });
    // run_id reads the build-stage log of one implement run (log_implement_<run_id>.log); without it the session's live log.
    const runId = req.query.run_id === undefined ? '' : String(req.query.run_id);
    if (runId && !/^\d{1,19}$/.test(runId)) return res.status(400).json({ error: 'run_id must be numeric.' });
    const logPath = liveLogPath(`${catalog}.${schema}`, rows[0].business_name, session_id, runId);
    const got = await readLogTail(req.dbHost, req.dbToken, logPath);
    if (got.status === 404) return res.json({ log_path: logPath, found: false, text: '', truncated: false, size: 0 });
    if (got.status !== 200) {
      return res.status(502).json({ error: `Inspire could not read the run log at ${logPath} (HTTP ${got.status}).`, log_path: logPath });
    }
    res.json({ log_path: logPath, found: true, text: got.text, truncated: got.truncated, size: got.size });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Workspace status check
// ═══════════════════════════════════════════════════

app.get('/api/workspace/status', rejectUnsafeQueryPath, requireToken, async (req, res) => {
  try {
    const notebookPath = req.query.path.trim();
    const response = await dbFetch(req.dbHost, req.dbToken, `/api/2.0/workspace/get-status?path=${encodeURIComponent(notebookPath)}`);
    if (!response.ok) {
      if (response.status === 404) return res.json({ exists: false });
      const action = 'check the notebook';
      const refusalBody = await response.text();
      logApiBody(action, response.status, refusalBody);
      return PM_ERROR.sendFailure(res, response.status, apiRefusalText(action, response.status, refusalBody));
    }
    const data = await response.json();
    res.json({ exists: true, object_type: data.object_type, path: data.path, language: data.language });
  } catch (err) {
    PM_ERROR.sendFailure(res, 500, err.message);
  }
});

// ═══════════════════════════════════════════════════
//  Static frontend + SPA fallback (must run after all API routes)
// ═══════════════════════════════════════════════════

app.use('/api', (req, res) => res.status(404).json({ error: `Inspire has no API route ${req.method} ${req.originalUrl.split('?')[0]}.` }));

if (fs.existsSync(STATIC_DIR)) {
  app.use(compressedStatic(STATIC_DIR));
  app.use(express.static(STATIC_DIR, { setHeaders: staticHeaders }));

  // When running as a Databricks App with installer-injected config,
  // inject a script that auto-completes the Setup Wizard so users
  // don't need to manually enter a PAT (the app proxy provides auth).
  const indexHtmlRaw = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8');
  const AUTO_SETUP = process.env.INSPIRE_AUTO_SETUP === 'true';
  const autoSetupSnippet = `<script>
(function(){
  if(localStorage.getItem('db_setup_complete'))return;
  fetch('/api/defaults').then(function(r){return r.json()}).then(function(d){
    if(!d.isDatabricksApp&&!d.autoSetup)return;
    fetch('/api/health').then(function(r){return r.json()}).then(function(h){
      if(!h.hasUserToken&&!h.hasPlatformAuth&&!d.autoSetup)return;
      if(d.databricksHost)localStorage.setItem('db_databricks_host',d.databricksHost);
      if(d.warehouseId)localStorage.setItem('db_warehouse_id',d.warehouseId);
      if(d.inspireDatabase)localStorage.setItem('db_inspire_database',d.inspireDatabase);
      // Auto-publish notebook in background
      fetch('/api/notebook').then(function(r){return r.json()}).then(function(nb){
        if(nb.path)localStorage.setItem('db_notebook_path',nb.path);
      }).catch(function(){});
      if(d.databricksHost&&d.warehouseId&&d.inspireDatabase){
        localStorage.setItem('db_setup_complete','1');
        localStorage.setItem('db_auth_mode','pat');
        location.reload();
      }
    });
  });
})();
</script>`;
  const isDatabricksAppEnv =
    AUTO_SETUP ||
    (!!DATABRICKS_HOST && hasDatabricksPlatformAuth() && process.env.NODE_ENV === 'production');
  const indexHtml = isDatabricksAppEnv
    ? indexHtmlRaw.replace('</head>', autoSetupSnippet + '</head>')
    : indexHtmlRaw;

  app.get('{*path}', (req, res) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': CACHE_REVALIDATE }).type('html').send(indexHtml);
  });
}

// ═══════════════════════════════════════════════════
//  Start server
// ═══════════════════════════════════════════════════

// ── Start server ──
// Pre-warm SP token BEFORE listening so the first request already has a valid token.
const PORT = process.env.PORT || 8080;

module.exports = { app, registeredRoutes: routePolicyRoutes.registered, getToken, tokenFor, appOwnToken, appWriteTokenOf, sessionHidden };

if (require.main === module) (async () => {
  redactCrashes();
  // Pre-warm SP OAuth token before accepting any requests
  if (SP_CLIENT_ID && SP_CLIENT_SECRET && !SERVICE_TOKEN) {
    await refreshSpToken();
  }
  await loadInspireTagCloud(DATABRICKS_HOST);

  hostedRun.installLifecycle();
  const server = app.listen(PORT, (err) => {
    if (err) {
      console.error(`Inspire AI cannot listen on port ${PORT}: ${err.message}`);
      process.exit(1);
    }
    const hasNotebook = fs.existsSync(BUNDLED_NOTEBOOK_PATH);
    const servingStatic = fs.existsSync(STATIC_DIR);
    console.log(`\n🚀 Inspire AI running on http://localhost:${server.address().port}`);
    console.log(`   Databricks Host: ${DATABRICKS_HOST || '⚠️  Not configured'}`);
    console.log(`   Auth:            ${spTokenCache ? '✅ SP OAuth token ready' : SERVICE_TOKEN ? '✅ Static token' : '⚠️  No token (user auth required)'}`);
    console.log(`   SP Credentials:  ${SP_CLIENT_ID ? '✅ Set' : '⚠️  Not configured'}`);
    console.log(`   Notebook:        ${hasNotebook ? '✅ Found' : '❌ Not found'}`);
    console.log(`   Frontend:        ${servingStatic ? '✅ ' + STATIC_DIR : '(dev proxy mode)'}`);
    console.log(`   Warehouse:       ${DEFAULT_WAREHOUSE_ID || '⚠️  Not configured'}`);
    console.log(`   Database:        ${DEFAULT_INSPIRE_DB || '⚠️  Not configured'}`);
    console.log(`   Cloud:           ${inspireTagCloud() || '⚠️  unknown (job tag values capped at 63)'}\n`);
    selfCheckModelAccess().catch((err) => console.warn(`model access self-check: ${err.message || err}`));
  });
})();
