const { holdsManage, implementOwners } = require('./inspireImplement');
const { permissionRequired } = require('./permissions');
const { splitInspireDatabase } = require('./sqlInputs');
const { isInt64Id } = require('./int64Id');

const CHANGING_METHODS = ['post', 'put', 'patch', 'delete', 'all'];
const USE_CASE_ID_RE = /^[a-zA-Z0-9_.-]+$/;

const RULES = {
  any: 'any person who can use this App',
  managers: 'an App manager',
  launcher: 'the person who launched it, or an App manager',
  owners: 'an owner of the use case, or an App manager',
  delegated: 'the hosted MVP page, which checks the person itself',
  recorded: 'a run Inspire launched and recorded in its own database',
  writer: 'write access, with your own sign-in, to the output folder a run writes to',
};

const str = (v) => (v == null ? '' : String(v).trim());
const NO_USER_TOKEN = 'the Databricks Apps proxy sent no user token; re-run the Inspire installer, which turns on user authorization with the apps scope';
const NO_APPS_SCOPE = "the App's user token lacks the apps scope; re-run the Inspire installer, which adds it";

function aclReadOutcome(acl) {
  if (acl && acl.ok) return { readable: true };
  const d = (acl && acl.data) || {};
  const said = oneLine(d.message || d.error || `HTTP ${acl ? acl.status : 0}`);
  if (/required scopes/i.test(said)) return { readable: false, unreadable: NO_APPS_SCOPE };
  if (acl && acl.status === 403 && (d.error_code === 'PERMISSION_DENIED' || /apps\.ruleSets\/get/.test(said))) return { readable: false, notManager: true };
  return { readable: false, unreadable: said };
}
const norm = (v) => str(v).toLowerCase();
const caseName = ({ id, row }) => (row && row.spec_json && typeof row.spec_json === 'object' ? str(row.spec_json.use_case_name) : '') || id;
const oneLine = (text) => str(text).replace(/\s+/g, ' ').replace(/[.\s]+$/, '');

function field(req, key) {
  const fromQuery = req.query && req.query[key];
  return str(fromQuery != null && fromQuery !== '' ? fromQuery : (req.body || {})[key]);
}

function specOf(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return body.spec && typeof body.spec === 'object' ? body.spec : body;
}

// The action a route body names (app-reads: check or grant). A missing action is the read-only check, as the route itself reads it.
function requestAction(req) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  return String(body.action ?? 'check');
}

function useCaseTarget(req) {
  const named = field(req, 'use_case_id') || str(specOf(req).use_case_id);
  return { inspireDatabase: field(req, 'inspire_database'), sessionId: field(req, 'session_id'), useCaseIds: named ? [named] : [] };
}

function genieTarget(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ids = Array.isArray(body.use_case_ids) ? body.use_case_ids.map(str).filter(Boolean) : [];
  return { inspireDatabase: str(body.inspire_database), sessionId: str(body.session_id), useCaseIds: ids };
}

function asksUninstall(req) {
  const value = specOf(req).uninstall;
  return value != null && value !== false;
}

const IDENTITIES = {
  person: "the signed-in person's own token, so Inspire reads only what that person can read",
  app: "the App's own token",
};
const MANAGER_SCOPES = ['apps'];
// The one user scope a run's output needs: the person's own folder is shared with the App's principal with the person's sign-in.
const OUTPUT_WRITE_SCOPES = ['workspace.workspace'];
const NO_PERSON_TOKEN = 'Inspire needs your own sign-in for this, and the Databricks Apps proxy sent none, so it cannot act as you; '
  + 'ask an App manager to re-run the Inspire installer, which turns on user authorization with the scopes Inspire needs';
const GATED = 'an action this table already limits to the people its rule names';
const TRACKED = 'reads or writes the Inspire tracking tables in the App database, which every App user sees through the App';
const BUNDLED = 'serves what ships inside the App and reads nothing from the workspace';
const BUILD_CHECK = 'checks what a build, which runs as the App, can read, write and create';

const managers = (action) => ({ rule: 'managers', action, identity: 'app', why: GATED });
const anyone = (action, why) => ({ rule: 'any', action, identity: 'app', why });
const tracked = (action, why = TRACKED) => ({ ...anyone(action, why), appDatabase: true });
const yours = (action, scopes, extra = {}) => ({ rule: 'any', action, identity: 'person', scopes, ...extra });
// D-SL-10B (REQ-418): every data read, check and launch uses the App's service principal, so a person's own grants never decide what Inspire
// reads. Only who-did-what actions (sending a Request for Access, creating a schema or granting read access as the person) keep `yours`.
const SP_READS = "reads with the App service principal, the same for every person, so a person's own grants never decide what Inspire reads";
// SEC-02 (REQ-518): a read of data or metadata the caller names (a table, a column, a path, a catalog, a schema) runs as the signed-in person.
// The person's own token decides what they see; with no token the route answers 401 and never falls back to the App.
const personReads = (action, scopes, extra = {}) => yours(action, scopes, extra);
const reads = (action, extra = {}) => ({ rule: 'any', action, identity: 'app', why: SP_READS, ...extra });
const owners = (action, extra = {}) => ({ rule: 'owners', action, target: useCaseTarget, identity: 'app', why: GATED, ...extra });
const builders = (action, extra = {}) => owners(action, { firstBuildOpen: true, ...extra });
// A run target names the run by its id. An empty id is refused with a 400 before any rule runs (decide), so the label never reads "run ".
const runTarget = (req) => {
  const runId = str(req.params && req.params.runId);
  return { kind: 'run', runId, label: runId ? `run ${runId}` : 'this run' };
};
const sessionTarget = (req) => ({ kind: 'session', inspireDatabase: field(req, 'inspire_database'), sessionId: field(req, 'session_id'), label: `session ${field(req, 'session_id') || '(none named)'}` });
const recorded = (action, why) => ({ rule: 'recorded', action, target: runTarget, identity: 'app', why });

const ROUTE_POLICY = {
  'ALL /run/:id/{*rest}': { rule: 'delegated', action: 'use a hosted MVP page', identity: 'app', why: 'serves an MVP page Inspire hosts from files the App wrote, and the page checks the person itself' },
  'GET /run/:id': anyone('open a hosted MVP page', 'redirects to the hosted page and reads nothing'),
  'GET /api-docs': anyone('read the API description page', BUNDLED),
  'GET /api/openapi.json': anyone('read the API description', BUNDLED),
  'GET {*path}': anyone('load the App page', BUNDLED),
  'GET /api/showcase': anyone('list the showcase', BUNDLED),
  'GET /showcase/:id/mvp/:mvp': anyone('open a showcase page', BUNDLED),
  'GET /showcase/:id/mvp/:mvp/*rest': anyone('open a showcase page', BUNDLED),
  'ALL /showcase/:id/mvp/:mvp/api/*rest': anyone('read a showcase answer', BUNDLED),
  'GET /api/dbc/info': anyone('describe the bundled notebook', BUNDLED),
  'GET /api/demo-data/templates': anyone('list the demo data templates', BUNDLED),
  'GET /api/inspire/implement/app-look': anyone('read the App looks a build offers', BUNDLED),
  'POST /api/auth/sp-token': anyone('trade the service principal credentials it sends for a token', 'uses only the credentials the caller sends and adds no token of the App'),
  'GET /api/health': anyone('read the App health', "reports the App's own health and settings"),
  'GET /api/defaults': anyone('read the installer defaults', 'returns the settings the installer gave the App'),
  'GET /api/connection-test': anyone('test the server token', "checks that the server's own token from its environment reaches the workspace"),
  'GET /api/me': anyone('read who is signed in', "names the person the proxy forwards and the App's own principal"),
  'POST /api/setup/verify': { ...managers('check the setup'), why: 'checks what the App itself reaches for its own setup: its sign-in, its warehouse and its Inspire database' },
  'GET /api/notebook': anyone('find the agent notebook', "checks the agent notebook at the App's own fixed path, which every run uses"),
  'POST /api/setup/create-database': managers('create the Inspire database'),
  'POST /api/notebook/republish': managers('republish the agent notebook'),
  'POST /api/publish': managers('publish the agent notebook to a workspace path'),
  'POST /api/publish/upload': managers('upload and publish a notebook'),
  'POST /api/demo-data/start': managers('start a demo data run'),
  'GET /api/workspace/list': personReads('list a workspace or volume folder', ['files', 'workspace.workspace:read']),
  'GET /api/workspace/export': personReads('download a workspace or volume file', ['files', 'workspace.workspace:read']),
  'GET /api/workspace/status': personReads('check a workspace path', ['files', 'workspace.workspace:read']),
  'GET /api/catalogs': personReads('list catalogs', ['catalog.catalogs:read']),
  'GET /api/catalogs/:catalog/schemas': personReads('list schemas', ['catalog.schemas:read']),
  'GET /api/tables/:catalog/:schema': personReads('list tables', ['catalog.tables:read']),
  'GET /api/warehouses': reads('list SQL warehouses'),
  'GET /api/inspire/implement/columns': personReads('read the columns of a table', ['sql', 'catalog.tables:read']),
  'GET /api/inspire/implement/table-lookup': personReads('look up one table and its column match', ['sql', 'catalog.tables:read']),
  'GET /api/inspire/implement/values': personReads('read the values of a column', ['sql']),
  'POST /api/relationships': personReads('find the relationships between the picked tables', ['sql', 'catalog.tables:read']),
  'POST /api/data-management/columns': personReads('search the columns of the picked tables', ['sql', 'catalog.tables:read']),
  'POST /api/inspire/implement/swaps': personReads('look up table swaps', ['sql', 'catalog.tables:read']),
  'POST /api/inspire/implement/readiness': personReads('check data readiness', ['sql', 'catalog.tables:read']),
  'POST /api/inspire/implement/group-counts': personReads('count the rows of each group in scope', ['sql']),
  'POST /api/inspire/samples/copy': reads('copy samples tables into a schema the App creates'),
  // A grant on a build's source tables changes what the App's principal can read, so it needs the build's owner (or the session's
  // launcher before the first build) or an App manager. UC still enforces the person's own GRANT rights on each object.
  'POST /api/inspire/implement/grant-access': { ...yours('grant read access with your own sign-in', ['sql']), rule: 'owners',
    target: useCaseTarget, launcherOwnsUnbuilt: true, permissionRequired: true, why: GATED },
  // Check reads what a viewer still needs for anyone who can see the record; Grant changes read access, so it needs the same
  // owner-or-manager rule as the build and control routes (the action is in the body, read by ruleWhen).
  'POST /api/inspire/implement/app-reads': { ...reads('check the read access an App Inspire built has'),
    ruleWhen: (req) => (requestAction(req) === 'grant' ? { rule: 'owners', action: 'grant read access to the App its build made', target: useCaseTarget,
      permissionRequired: true, why: GATED } : null) },
  // REQ-418 (D-SL-10B): the App's service principal creates the schema; the requester is recorded in Inspire's own records.
  'POST /api/inspire/implement/create-schema': reads('create a catalog or schema the App owns for the use case'),
  'GET /api/inspire/implement/serving-endpoints': reads('list serving endpoints'),
  'POST /api/run/check': reads('check the grants a run needs before it starts'),
  'POST /api/run': anyone('launch a run', 'launches the run as the App, which owns the job and its tracking tables'),
  // The App writes the output; this check also shares the person's own folder with the App, with the person's sign-in (OUTPUT_WRITE_SCOPES).
  'POST /api/output-folder/check': reads('check that the App can write to an output folder', { outputWrite: true, scopes: OUTPUT_WRITE_SCOPES }),
  'GET /api/run/:runId': recorded('read a run', 'reads the state of a run the App launched and recorded in its own database'),
  'GET /api/run/:runId/output': recorded('read a run output', 'reads the output of a run the App launched and recorded in its own database'),
  'GET /api/run/:runId/cancel': anyone('read the cancel verdict', 'answers the cancel route verdict, changes nothing and reads nothing from the workspace'),
  'POST /api/run/:runId/cancel': { rule: 'launcher', action: 'cancel it', target: runTarget, identity: 'app', why: GATED },
  'POST /api/run/:runId/again': { rule: 'launcher', action: 'run it again', target: runTarget, identity: 'app', why: GATED },
  'GET /api/run/pages': anyone('list the hosted pages', 'lists the MVP pages Inspire hosts'),
  'GET /api/inspire/session': tracked('read a session'),
  'GET /api/inspire/value': tracked('read the value at stake and saved of a run'),
  'GET /api/inspire/value/estimates': tracked('read the estimated value of the use cases with no measured value, from their money rules'),
  'GET /api/inspire/value/totals': tracked('read the value per year of every use case of a run, or of every run, including the values saved through Calculate'),
  'GET /api/inspire/value/yearly': tracked('read the measured value of each built use case, scaled to every eligible record and to a year'),
  'POST /api/inspire/value/estimate': personReads('estimate the value per year of one use case from a sample of its table and the Value at stake answers', ['sql'], { appDatabase: true }),
  'POST /api/inspire/value/case-plan': personReads('plan the value of one use case: its case, filter, groups and what each driver asks, with the counts per group', ['sql'], { appDatabase: true }),
  'POST /api/inspire/value/scope': personReads('count the records of a use case table and the range of its dates, before any value is worked out', ['sql'], { appDatabase: true }),
  'POST /api/inspire/value/filter': personReads('turn a plain-English description of the records to keep into a checked filter and count the records it keeps', ['sql'], { appDatabase: true }),
  'GET /api/inspire/macro/sources': anyone('list the public economic data sources', 'lists the fixed set of sources Inspire can read; fetches nothing'),
  'GET /api/inspire/macro/series': tracked('read a public economic series, from the 7-day cache in the Inspire database or fetched from an allowed host, with its citation and optional factor',
    'fetches from a fixed host allowlist and caches in the Inspire database with the signed-in person\'s token'),
  'POST /api/inspire/value/run-review': tracked('have the model review the value of a whole run, so its total is realistic next to the size of the business',
    'calls a chat model and saves the review as one row of the Calculate value answers'),
  'POST /api/inspire/value/preview': tracked('work out the value per year of a case plan and typed answers, with no data read',
    'reads nothing: pure arithmetic on the plan and answers it is sent'),
  'GET /api/inspire/value/answers': tracked('read the saved Calculate value answers of a session'),
  'PUT /api/inspire/value/answers': personReads('save the Calculate value answers of one use case as a new version, with its estimate', ['sql'], { appDatabase: true }),
  'GET /api/inspire/value/answers/history': tracked('read the saved versions of the Calculate value answers of one use case'),
  'POST /api/inspire/value/answers/undo': tracked('go back to the previous version of the Calculate value answers of one use case',
    'writes the answers table with the App\'s service principal'),
  'POST /api/inspire/score-refine': tracked('refine the Inspire scores of use cases so the order follows the value, keeping the old score and reason in history',
    'writes the refined score with the App\'s service principal'),
  'POST /api/inspire/score-refine/undo': tracked('restore the first Inspire scores of refined use cases and record the undo in history',
    'writes the restored score with the App\'s service principal'),
  'GET /api/inspire/sessions': tracked('list sessions'),
  'GET /api/inspire/profiles': tracked('list the business profiles'),
  'GET /api/inspire/profiles/:profileId': tracked('read a business profile'),
  'POST /api/inspire/profiles': tracked('save a business profile'),
  'GET /api/inspire/steps': tracked('read the steps of a session'),
  'GET /api/inspire/step-results': tracked('read the step results of a session'),
  'GET /api/inspire/usecases': tracked('read the use cases of a session'),
  'GET /api/inspire/results': tracked('read the results of a session'),
  'GET /api/inspire/genie-progress': tracked('read the Genie progress of a session'),
  'GET /api/inspire/feedback': tracked('read feedback'),
  'POST /api/inspire/ack': tracked('acknowledge a step'),
  'POST /api/inspire/feedback': tracked('send feedback'),
  'POST /api/inspire/docs/save': tracked("save a document the Generate docs wizard made into the run's Assets folder"),
  'POST /api/inspire/docs/translate': tracked('translate the selected use case texts for a document language'),
  'POST /api/inspire/sync-genie-flags': managers('change the Genie flags of use cases'),
  'POST /api/inspire/usecase-name': managers('rename a use case'),
  'DELETE /api/inspire/session': { rule: 'launcher', action: 'delete it', target: sessionTarget, identity: 'app', why: GATED },
  'GET /api/inspire/log': { rule: 'launcher', action: 'read its run log', target: sessionTarget, identity: 'app', why: GATED },
  'POST /api/inspire/generate-genie': owners('add a Genie Code instruction', { target: genieTarget, launcherOwnsUnbuilt: true }),
  'POST /api/inspire/generate_genie': owners('add a Genie Code instruction', { target: genieTarget, launcherOwnsUnbuilt: true }),
  'GET /api/inspire/implement/context': tracked('read the build context of a use case'),
  'GET /api/inspire/implement/history': tracked('read the build history of a use case'),
  'GET /api/inspire/implement/merge-targets': tracked('list what a build can join'),
  'GET /api/inspire/implement/status': tracked('read the build status of a use case'),
  'GET /api/inspire/implement/diagnostics': tracked('read the build diagnostics of a use case'),
  'GET /api/inspire/implement/money': tracked('read the cost of a build'),
  'GET /api/inspire/implement/usecase-assets': tracked('read which assets each use case has'),
  'GET /api/inspire/implement/feedback': tracked('read the issues people reported in its App'),
  'GET /api/inspire/implement/live': tracked('read what a build runs now'),
  'GET /api/inspire/portfolio': tracked('read the portfolio of a database'),
  'GET /api/inspire/implement/tables': tracked('read whether its tables can change'),
  'GET /api/inspire/implement/settings': tracked('read the settings of its App'),
  'GET /api/inspire/implement/runs': tracked('read the last runs of its App'),
  'GET /api/inspire/implement/alerts': tracked('read its alerts'),
  'GET /api/inspire/implement/output-check': { ...builders('check the output table of a build'), why: BUILD_CHECK, appDatabase: true },
  'GET /api/inspire/implement/preflight': { ...builders('check a build before it starts'), why: BUILD_CHECK, appDatabase: true },
  'POST /api/inspire/implement/preflight': { ...builders('check a build before it starts'), why: BUILD_CHECK, appDatabase: true },
  'GET /api/inspire/implement/lakebase': anyone('check Lakebase for a build', BUILD_CHECK),
  'GET /api/inspire/implement/principals': personReads('search people and groups', ['iam.access-control:read']),
  'GET /api/inspire/implement/destinations': anyone('list notification destinations', 'lists the notification destinations every workspace user can pick for an alert'),
  'POST /api/inspire/implement/plan': tracked('preview a build plan'),
  'POST /api/inspire/implement/submit': builders('build a new version of it', { managersWhen: asksUninstall, managersAction: 'uninstall an MVP' }),
  'POST /api/inspire/implement/control': owners('stop, start, publish or cancel what Inspire built for it'),
  'POST /api/inspire/implement/rerun': owners('re-run its build'),
  'POST /api/inspire/implement/settings/preview': tracked('preview a settings change'),
  'POST /api/inspire/implement/settings/save': owners('change its settings'),
  'POST /api/inspire/implement/settings/run': owners('refresh its App'),
  'POST /api/inspire/implement/alerts/preview': tracked('preview an alert'),
  'POST /api/inspire/implement/alerts/save': owners('set up its alert'),
  'POST /api/inspire/implement/alerts/pause': owners('pause its alert'),
  'POST /api/inspire/implement/alerts/delete': owners('delete its alert'),
  'POST /api/inspire/implement/table-change': owners('change its tables'),
  'POST /api/inspire/implement/feedback/status': owners('change the status of an issue reported in its App'),
  'POST /api/inspire/implement/feedback/vibe': owners('draft a vibe from an issue reported in its App'),
  'POST /api/money/currency-rates': personReads('read the currencies of the use case table and their rates to the reporting currency', ['sql'], { appDatabase: true }),
  'POST /api/money/describe-value': tracked('turn a description of a money value into a value rule with a chat model',
    'calls the chat model with the App\'s service principal and reads nothing else'),
  'POST /api/money/value-preview': personReads('read three rows of the use case table through the value a money rule names', ['sql'], { appDatabase: true }),
  'POST /api/money/rate-sample': personReads('read the rates of the rate table a money rule names', ['sql'], { appDatabase: true }),
  'POST /api/access-request/check': yours('check whether Request for Access is offered for the grants you need', ['catalog.catalogs:read']),
  'POST /api/access-request': yours('send a Request for Access to the owner of the data, as you', ['catalog.catalogs:read']),
  'POST /api/grouping/profile': personReads('read the main table of a use case for its Data groups', ['sql'], { appDatabase: true }),
};

function routeKey(method, path) {
  return `${method === 'all' ? 'ALL' : String(method).toUpperCase()} ${path}`;
}

function routesInSource(text) {
  const out = [];
  const re = /\bapp\.(get|post|put|patch|delete|all)\(\s*(['"`])((?:(?!\2)[^\n])*)\2/g;
  for (const m of String(text).matchAll(re)) out.push({ key: routeKey(m[1], m[3]), dynamic: m[2] === '`' && m[3].includes('${') });
  return out;
}

function changingRoutesInSource(text) {
  return routesInSource(text).filter((r) => !r.key.startsWith('GET '));
}

// REQ-418: the App's service principal for every route it declares 'app'; the signed-in person's token only for the routes that act as
// the person (a Request for Access, creating a schema, granting read access), which declare 'person'. Unknown routes are refused by the gate.
function identityFor(key) {
  const entry = Object.hasOwn(ROUTE_POLICY, String(key)) ? ROUTE_POLICY[key] : null;
  return entry && entry.identity === 'app' ? 'app' : 'person';
}

function undeclaredIdentity(keys, table = ROUTE_POLICY) {
  return [...keys].filter((key) => {
    const entry = Object.hasOwn(table, key) ? table[key] : null;
    if (!entry || !Object.hasOwn(IDENTITIES, entry.identity)) return true;
    if (entry.identity === 'app') return !/^[a-z][^\n]{10,}$/.test(str(entry.why));
    return !Array.isArray(entry.scopes) || !entry.scopes.length;
  }).sort();
}

function canonicalPath(input) {
  const raw = str(input);
  if (!raw.startsWith('/')) return '';
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  if (parts[0] === 'Workspace') parts.shift();
  if (parts[0] === 'Volumes') for (let i = 1; i < Math.min(parts.length, 4); i += 1) parts[i] = parts[i].toLowerCase();
  return `/${parts.join('/')}`;
}

function outputFolderOf(generationPath, notebookPath) {
  const gp = str(generationPath);
  if (!gp) return '';
  if (gp.startsWith('/')) return canonicalPath(gp);
  const notebook = canonicalPath(notebookPath);
  if (!notebook || notebook === '/') return '';
  return canonicalPath(`${notebook.replace(/\/[^/]+$/, '')}/${gp}`);
}

// REQ-418: the routes that answer 401 without the person's sign-in are the ones that read with the person's token. App-identity routes
// (including the App-database and output-write ones) never need the person's sign-in to answer.
function personSignInRoutes(table = ROUTE_POLICY) {
  return Object.keys(table).filter((key) => (table[key] || {}).identity === 'person').sort();
}

const READ_ONLY = ':read';

function scopeCovers(scopes, scope) {
  return scopes.includes(scope) || (scope.endsWith(READ_ONLY) && scopes.includes(scope.slice(0, -READ_ONLY.length)));
}

function appUserScopes(table = ROUTE_POLICY) {
  const scopes = Object.values(table).filter((e) => e.identity === 'person' || e.outputWrite === true).flatMap((e) => e.scopes || []);
  const all = [...new Set([...MANAGER_SCOPES, ...scopes])];
  return all.filter((s) => !(s.endsWith(READ_ONLY) && all.includes(s.slice(0, -READ_ONLY.length)))).sort();
}

function noPersonTokenBody(key) {
  return { error: NO_PERSON_TOKEN, policy: { route: String(key || ''), identity: 'person', needs: IDENTITIES.person } };
}

function templateRegex(key) {
  const parts = key.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('[^/ ]+')}$`);
}

function missingFromPolicy(routes, table = ROUTE_POLICY) {
  const keys = Object.keys(table);
  return routes.filter((r) => (r.dynamic ? !keys.some((k) => templateRegex(r.key).test(k)) : !Object.hasOwn(table, r.key)));
}

function registers(routes, key) {
  return routes.some((r) => (r.dynamic ? templateRegex(r.key).test(key) : r.key === key));
}

function staleEntries(routes, laneRoutes, table = ROUTE_POLICY) {
  const stale = [];
  for (const [key, entry] of Object.entries(table)) {
    if (registers(routes, key)) {
      if (entry.pendingMerge) stale.push({ key, why: `the App registers it now, so drop pendingMerge ${entry.pendingMerge.branch}` });
    } else if (!entry.pendingMerge) {
      stale.push({ key, why: 'no route registers it' });
    } else if (!registers(laneRoutes(entry.pendingMerge.commit), key)) {
      stale.push({ key, why: `${entry.pendingMerge.branch} ${entry.pendingMerge.commit} does not register it either` });
    }
  }
  return stale;
}

function refusalBody(key, rule, message, permissions = null) {
  return { error: message, policy: { route: key, rule, needs: RULES[rule] || 'an access rule for this route' },
    ...(permissions && permissions.length ? { permissions } : {}) };
}

function refusal(res, key, rule, message, permissions = null, status = 403) {
  return res.status(status).json(refusalBody(key, rule, message, permissions));
}

// A refused mutation says what the person must have, as a Permission Required entry with no SQL: nothing is shown to someone who
// may not run it.
function permissionRefusal(message) {
  return [permissionRequired({ instructions: [message] })].filter(Boolean);
}

function createRoutePolicy(deps) {
  async function attempt(fn) {
    try {
      return await fn();
    } catch (err) {
      return { ok: false, status: 0, data: { message: err.message } };
    }
  }

  async function managerVerdict(req, person) {
    const appName = str(deps.appName());
    if (!appName) return { manager: false, unreadable: 'Inspire does not know the name of its own App' };
    const personToken = str(deps.personToken(req));
    if (!personToken) return { manager: false, unreadable: NO_USER_TOKEN };
    const acl = await attempt(() => deps.readAcl(req, personToken));
    const outcome = aclReadOutcome(acl);
    if (outcome.notManager) return { manager: false };
    if (!outcome.readable) return { manager: false, unreadable: outcome.unreadable };
    const me = await attempt(() => deps.readMe(req, personToken));
    const meData = me && me.ok && me.data ? me.data : {};
    const sameIdentity = [meData.userName, meData.applicationId].map(norm).includes(person);
    const groups = sameIdentity ? (meData.groups || []).map((g) => g && (g.display || g.value)) : [];
    return { manager: holdsManage(acl.data, [person], groups) };
  }

  function managersOnly(verdict, action, appName) {
    if (verdict.unreadable) {
      return `Inspire could not read who manages the ${appName || 'Inspire'} App (${verdict.unreadable}), so it cannot let you ${action}; ask an App manager.`;
    }
    return `Only an App manager can ${action}. You need CAN MANAGE on the ${appName} App, so ask one of its managers.`;
  }

  // A failed read throws (the owners rule answers 503 and tries again); only a read that finds no record returns ''.
  async function sessionLauncher(req, target) {
    return norm(await deps.readLauncher(req, { kind: 'session', inspireDatabase: target.inspireDatabase, sessionId: target.sessionId,
      label: `session ${target.sessionId}` }));
  }

  async function ownersVerdict(req, person, target, entry = {}) {
    const appDb = norm(deps.appDatabase());
    const ids = target.useCaseIds;
    if (!ids.length || !ids.every((id) => USE_CASE_ID_RE.test(id))) return { owner: false, unbuilt: false, why: 'the request names no valid use case' };
    if (!appDb || !splitInspireDatabase(appDb) || norm(target.inspireDatabase) !== appDb) {
      return { owner: false, unbuilt: false, why: `Inspire reads use case owners only from its own database ${appDb || '(not set)'}` };
    }
    if (!isInt64Id(target.sessionId)) return { owner: false, unbuilt: false, why: 'the request names no valid session' };
    const history = await deps.readHistory(req, target.sessionId);
    const latest = (id) => (history || []).filter((r) => str(r.use_case_id) === id)
      .sort((a, b) => (Number(b.spec_version) || 0) - (Number(a.spec_version) || 0))[0] || null;
    const rows = ids.map((id) => ({ id, row: latest(id) }));
    const launcher = entry.launcherOwnsUnbuilt && rows.some(({ row }) => !row) ? await sessionLauncher(req, target) : '';
    const ownersOf = ({ row }) => (row ? implementOwners(row) : (launcher ? [launcher] : []));
    const notOwned = rows.find((r) => !ownersOf(r).includes(person));
    const unbuiltWhy = !entry.launcherOwnsUnbuilt ? 'has no build to own yet'
      : launcher ? `has no build, and session ${target.sessionId} was launched by ${launcher}`
        : `has no build, and Inspire has no record of who launched session ${target.sessionId}`;
    return {
      owner: !notOwned,
      unbuilt: rows.every(({ row }) => !row),
      name: rows.length === 1 ? caseName(rows[0]) : '',
      why: notOwned ? `${caseName(notOwned)} ${notOwned.row ? `is owned by ${implementOwners(notOwned.row).join(', ') || 'nobody'}` : unbuiltWhy}` : '',
    };
  }

  async function decide(key, entry, req) {
    const appName = str(deps.appName());
    const person = norm(deps.personOf(req));
    const named = entry.target && entry.target(req);
    if (named && named.kind === 'run' && !named.runId) {
      return { allowed: false, rule: entry.rule, status: 400, message: 'Inspire needs the id of the run in the address to check it, so it refuses the request' };
    }
    const managersWhen = entry.managersWhen && entry.managersWhen(req);
    const rule = managersWhen ? 'managers' : entry.rule;
    const action = managersWhen ? entry.managersAction : entry.action;
    if (!person) {
      return { allowed: false, rule, message: `Inspire could not tell who you are, because the Databricks Apps proxy sent no signed-in person, so it cannot let you ${action}.` };
    }
    if (rule === 'managers') {
      const verdict = await managerVerdict(req, person);
      return verdict.manager ? { allowed: true } : { allowed: false, rule, message: managersOnly(verdict, action, appName) };
    }
    if (rule === 'launcher') {
      const target = entry.target(req);
      let launcher = '';
      try {
        launcher = norm(await deps.readLauncher(req, target));
      } catch (err) {
        // A failed read is not a missing record: it answers 503 so the caller tries again, never "no record" as a permanent refusal.
        console.warn(`route policy: the launch record for ${target.label} could not be read: ${err.message}`);
        return { allowed: false, rule, status: 503, message: `Inspire could not read the launch record of ${target.label} just now (${oneLine(err.message)}), so it cannot tell who launched it; try again` };
      }
      if (launcher && launcher === person) return { allowed: true };
      const verdict = await managerVerdict(req, person);
      if (verdict.manager) return { allowed: true };
      const known = launcher ? `${launcher} launched it` : 'Inspire has no record of who launched it';
      const extra = verdict.unreadable ? `, and Inspire could not read who manages the App (${verdict.unreadable})` : '';
      return { allowed: false, rule, message: `Only the person who launched ${target.label}, or an App manager, can ${action}. ${known}${extra}; ask them or an App manager.` };
    }
    if (rule === 'recorded') {
      const target = entry.target(req);
      let known = false;
      try {
        known = Boolean(await deps.runRecorded(req, target.runId));
      } catch (err) {
        console.warn(`route policy: the launch record for ${target.label} could not be read: ${err.message}`);
        return { allowed: false, rule, status: 503, message: `Inspire could not check its record of ${target.label} just now (${oneLine(err.message)}); try again` };
      }
      if (known) return { allowed: true };
      return { allowed: false, rule, message: `Inspire shows only runs it launched and recorded in its own database, and it has no record of ${target.label}, so it does not read it.` };
    }
    if (rule === 'owners') {
      const target = entry.target(req);
      let owned;
      try {
        owned = await ownersVerdict(req, person, target, entry);
      } catch (err) {
        owned = { owner: false, unbuilt: false, why: `Inspire could not read the owners of the use case (${oneLine(err.message)})`, unreadable: true };
      }
      if (owned.owner || (entry.firstBuildOpen && owned.unbuilt)) return { allowed: true };
      const verdict = await managerVerdict(req, person);
      if (verdict.manager) return { allowed: true };
      const named = target.useCaseIds.length === 1 ? owned.name || 'this use case' : 'these use cases';
      const extra = verdict.unreadable ? `; Inspire also could not read who manages the App (${verdict.unreadable})` : '';
      if (owned.unreadable) return { allowed: false, rule, status: 503, message: `Only an owner of ${named}, or an App manager, can ${action}: ${owned.why}${extra}. Try again` };
      return { allowed: false, rule, message: `Only an owner of ${named}, or an App manager, can ${action}: ${owned.why}${extra}.` };
    }
    return { allowed: false, rule, message: `Inspire has no access rule named ${rule} for ${key}, so it refuses it.` };
  }

  async function verdictFor(key, req) {
    const base = Object.hasOwn(ROUTE_POLICY, key) ? ROUTE_POLICY[key] : null;
    if (!base) return { allowed: false, rule: 'none', message: `Inspire has no access rule for ${key}, so it refuses it.` };
    const entry = base.ruleWhen ? { ...base, ...(base.ruleWhen(req) || {}) } : base;
    if (!deps.enforce() || entry.rule === 'any' || entry.rule === 'delegated') return { allowed: true };
    try {
      const verdict = await decide(key, entry, req);
      return verdict.allowed ? verdict : { ...verdict, permissionRequired: Boolean(entry.permissionRequired) };
    } catch (err) {
      return { allowed: false, rule: entry.rule, message: `Inspire could not check that you may ${entry.action}: ${oneLine(err.message)}.` };
    }
  }

  function gate(key) {
    return async function routePolicyGate(req, res, next) {
      const verdict = await verdictFor(key, req);
      if (verdict.allowed) return next();
      if (verdict.status === 400) return res.status(400).json({ error: verdict.message });
      return refusal(res, key, verdict.rule, verdict.message, verdict.permissionRequired ? permissionRefusal(verdict.message) : null, verdict.status || 403);
    };
  }

  const managerOf = (req) => managerVerdict(req, norm(deps.personOf(req)));

  return { gate, decide, verdictFor, managerOf };
}

function enforceRoutePolicy(app, policy) {
  const registered = new Set();
  for (const method of ['get', ...CHANGING_METHODS]) {
    const register = app[method].bind(app);
    app[method] = function registerWithPolicy(path, ...handlers) {
      if (!handlers.length) return register(path);
      const key = routeKey(method, path);
      const named = (req, _res, next) => { req.policyKey = key; next(); };
      if (method === 'get') {
        if (!Object.hasOwn(ROUTE_POLICY, key)) console.error(`route policy: ${key} has no entry in lib/routePolicy.js, so it reads only with the person's own token`);
        const gated = Object.hasOwn(ROUTE_POLICY, key) && !['any', 'delegated'].includes(ROUTE_POLICY[key].rule);
        return register(path, named, ...(gated ? [policy.gate(key)] : []), ...handlers);
      }
      registered.add(key);
      if (!Object.hasOwn(ROUTE_POLICY, key)) console.error(`route policy: ${key} has no entry in lib/routePolicy.js, so every request to it is refused`);
      return register(path, named, policy.gate(key), ...handlers);
    };
  }
  return { registered: () => [...registered].sort() };
}

function forwardedPerson(headers) {
  return norm((headers || {})['x-forwarded-email'] || (headers || {})['x-forwarded-preferred-username']);
}

module.exports = {
  CHANGING_METHODS,
  RULES,
  IDENTITIES,
  MANAGER_SCOPES,
  OUTPUT_WRITE_SCOPES,
  NO_PERSON_TOKEN,
  ROUTE_POLICY,
  routeKey,
  routesInSource,
  changingRoutesInSource,
  missingFromPolicy,
  registers,
  staleEntries,
  identityFor,
  canonicalPath,
  outputFolderOf,
  undeclaredIdentity,
  personSignInRoutes,
  scopeCovers,
  appUserScopes,
  noPersonTokenBody,
  refusalBody,
  createRoutePolicy,
  enforceRoutePolicy,
  forwardedPerson,
};
