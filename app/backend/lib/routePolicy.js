const { holdsManage, implementOwners } = require('./inspireImplement');
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
const OUTPUT_WRITE_SCOPES = ['workspace.workspace', 'files'];
const NO_PERSON_TOKEN = 'Inspire reads this with your own sign-in, and the Databricks Apps proxy sent none, so it reads nothing for you; '
  + 'ask an App manager to re-run the Inspire installer, which turns on user authorization with the scopes Inspire needs';
const GATED = 'an action this table already limits to the people its rule names';
const TRACKED = 'reads or writes the Inspire tracking tables in the App database, which every App user sees through the App';
const BUNDLED = 'serves what ships inside the App and reads nothing from the workspace';
const BUILD_CHECK = 'checks what a build, which runs as the App, can read, write and create';
const SESSION_OUTPUT = 'reads inside the recorded output folder of a session in the App database, which is output the App produced';

const managers = (action) => ({ rule: 'managers', action, identity: 'app', why: GATED });
const anyone = (action, why) => ({ rule: 'any', action, identity: 'app', why });
const tracked = (action, why = TRACKED) => ({ ...anyone(action, why), appDatabase: true });
const yours = (action, scopes, extra = {}) => ({ rule: 'any', action, identity: 'person', scopes, ...extra });
const owners = (action, extra = {}) => ({ rule: 'owners', action, target: useCaseTarget, identity: 'app', why: GATED, ...extra });
const builders = (action, extra = {}) => owners(action, { firstBuildOpen: true, ...extra });
const runTarget = (req) => ({ kind: 'run', runId: str(req.params.runId), label: `run ${str(req.params.runId)}` });
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
  'POST /api/demo-data/start': { ...managers('start a demo data run'), outputWrite: true, scopes: OUTPUT_WRITE_SCOPES },
  'GET /api/workspace/list': yours('list a workspace or volume folder', ['workspace.workspace:read', 'files'], { sessionOutput: SESSION_OUTPUT }),
  'GET /api/workspace/export': yours('download a workspace or volume file', ['workspace.workspace:read', 'files'], { sessionOutput: SESSION_OUTPUT }),
  'GET /api/workspace/status': yours('check a workspace path', ['workspace.workspace:read']),
  'GET /api/catalogs': yours('list catalogs', ['catalog.catalogs:read', 'sql']),
  'GET /api/catalogs/:catalog/schemas': yours('list schemas', ['catalog.schemas:read', 'sql']),
  'GET /api/tables/:catalog/:schema': yours('list tables', ['catalog.tables:read', 'sql']),
  'GET /api/warehouses': yours('list SQL warehouses', ['sql']),
  'GET /api/inspire/implement/columns': yours('read the columns of a table', ['sql']),
  'GET /api/inspire/implement/values': yours('read the values of a column', ['sql']),
  'POST /api/inspire/implement/swaps': yours('look up table swaps', ['sql']),
  'POST /api/inspire/implement/readiness': yours('check data readiness', ['sql']),
  'POST /api/inspire/implement/grant-access': yours('grant read access with your own sign-in', ['sql']),
  'POST /api/inspire/implement/app-reads': yours('give an App Inspire built read access with your own sign-in', ['sql']),
  'POST /api/inspire/implement/create-schema': yours('create a catalog or schema with your own sign-in', ['sql']),
  'GET /api/inspire/implement/serving-endpoints': yours('list serving endpoints', ['model-serving']),
  'POST /api/run': { ...anyone('launch a run', 'launches the run as the App, which owns the job and its tracking tables'), outputWrite: true, scopes: OUTPUT_WRITE_SCOPES },
  'POST /api/output-folder/check': yours('check that you can write to an output folder', OUTPUT_WRITE_SCOPES, { outputWrite: true }),
  'GET /api/run/:runId': recorded('read a run', 'reads the state of a run the App launched and recorded in its own database'),
  'GET /api/run/:runId/output': recorded('read a run output', 'reads the output of a run the App launched and recorded in its own database'),
  'GET /api/run/:runId/cancel': anyone('read the cancel verdict', 'answers the cancel route verdict, changes nothing and reads nothing from the workspace'),
  'POST /api/run/:runId/cancel': { rule: 'launcher', action: 'cancel it', target: runTarget, identity: 'app', why: GATED },
  'POST /api/run/:runId/again': { rule: 'launcher', action: 'run it again', target: runTarget, identity: 'app', why: GATED, outputWrite: true, scopes: OUTPUT_WRITE_SCOPES },
  'GET /api/run/pages': anyone('list the hosted pages', 'lists the MVP pages Inspire hosts'),
  'GET /api/inspire/session': tracked('read a session'),
  'GET /api/inspire/sessions': tracked('list sessions'),
  'GET /api/inspire/steps': tracked('read the steps of a session'),
  'GET /api/inspire/step-results': tracked('read the step results of a session'),
  'GET /api/inspire/usecases': tracked('read the use cases of a session'),
  'GET /api/inspire/results': tracked('read the results of a session'),
  'GET /api/inspire/genie-progress': tracked('read the Genie progress of a session'),
  'GET /api/inspire/feedback': tracked('read feedback'),
  'POST /api/inspire/ack': tracked('acknowledge a step'),
  'POST /api/inspire/feedback': tracked('send feedback'),
  'POST /api/inspire/sync-genie-flags': managers('change the Genie flags of use cases'),
  'POST /api/inspire/usecase-name': tracked('rename a use case'),
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
  'GET /api/inspire/implement/feedback': tracked('read the issues people reported in its App'),
  'GET /api/inspire/implement/live': tracked('read what a build runs now'),
  'GET /api/inspire/portfolio': tracked('read the portfolio of a database'),
  'GET /api/inspire/implement/tables': tracked('read whether its tables can change'),
  'GET /api/inspire/implement/settings': tracked('read the settings of its App'),
  'GET /api/inspire/implement/runs': tracked('read the last runs of its App'),
  'GET /api/inspire/implement/alerts': tracked('read its alerts'),
  'GET /api/inspire/implement/output-check': { ...builders('check the output table of a build'), why: BUILD_CHECK, appDatabase: true },
  'GET /api/inspire/implement/preflight': { ...builders('check a build before it starts'), why: BUILD_CHECK, appDatabase: true },
  'GET /api/inspire/implement/lakebase': anyone('check Lakebase for a build', BUILD_CHECK),
  'GET /api/inspire/implement/principals': anyone('search people and groups', 'searches the workspace directory, which every workspace user can read'),
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
  'POST /api/money/rate-sample': tracked('read the rates of the rate table a money rule names',
    'reads the rate table with your own sign-in'),
  'POST /api/grouping/profile': tracked('read the main table of a use case for its Data groups',
    'reads the use case record from the Inspire tracking tables in the App database, and reads the use case table only with your own sign-in'),
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

function identityFor(key, req, appDatabase) {
  const entry = Object.hasOwn(ROUTE_POLICY, String(key)) ? ROUTE_POLICY[key] : null;
  if (!entry || entry.identity !== 'app') return 'person';
  if (entry.appDatabase && (!norm(appDatabase) || norm(field(req, 'inspire_database')) !== norm(appDatabase))) return 'person';
  return 'app';
}

function undeclaredIdentity(keys, table = ROUTE_POLICY) {
  return [...keys].filter((key) => {
    const entry = Object.hasOwn(table, key) ? table[key] : null;
    if (!entry || !Object.hasOwn(IDENTITIES, entry.identity)) return true;
    if (entry.identity === 'app') return !/^[a-z][^\n]{10,}$/.test(str(entry.why));
    if (entry.sessionOutput != null && !/^[a-z][^\n]{10,}$/.test(str(entry.sessionOutput))) return true;
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

function insideFolder(path, folder) {
  const at = canonicalPath(path);
  const root = canonicalPath(folder);
  if (!at || !root || root.split('/').length < 3) return false;
  return at === root || at.startsWith(`${root}/`);
}

async function resolveIdentity(key, req, { appDatabase, outputFolders }) {
  const identity = identityFor(key, req, appDatabase);
  const entry = Object.hasOwn(ROUTE_POLICY, String(key)) ? ROUTE_POLICY[key] : null;
  if (identity !== 'person' || !entry || !entry.sessionOutput) return identity;
  const path = field(req, 'path');
  if (!canonicalPath(path)) return identity;
  let folders = [];
  try {
    folders = await outputFolders();
  } catch (err) {
    console.warn(`route policy: the session output folders could not be read, so ${key} reads with the person's token: ${oneLine(err.message)}`);
  }
  return (folders || []).some((folder) => insideFolder(path, folder)) ? 'app' : 'person';
}

function personSignInRoutes(table = ROUTE_POLICY) {
  return Object.keys(table).filter((key) => {
    const entry = table[key] || {};
    return entry.identity === 'person' || entry.appDatabase === true || entry.outputWrite === true;
  }).sort();
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

function refusalBody(key, rule, message) {
  return { error: message, policy: { route: key, rule, needs: RULES[rule] || 'an access rule for this route' } };
}

function refusal(res, key, rule, message) {
  return res.status(403).json(refusalBody(key, rule, message));
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

  async function sessionLauncher(req, target) {
    try {
      return norm(await deps.readLauncher(req, { kind: 'session', inspireDatabase: target.inspireDatabase, sessionId: target.sessionId,
        label: `session ${target.sessionId}` }));
    } catch (err) {
      console.warn(`route policy: the launch record for session ${target.sessionId} could not be read: ${err.message}`);
      return '';
    }
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
        console.warn(`route policy: the launch record for ${target.label} could not be read: ${err.message}`);
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
        owned = { owner: false, unbuilt: false, why: `Inspire could not read the owners of the use case (${oneLine(err.message)})` };
      }
      if (owned.owner || (entry.firstBuildOpen && owned.unbuilt)) return { allowed: true };
      const verdict = await managerVerdict(req, person);
      if (verdict.manager) return { allowed: true };
      const named = target.useCaseIds.length === 1 ? owned.name || 'this use case' : 'these use cases';
      const extra = verdict.unreadable ? `; Inspire also could not read who manages the App (${verdict.unreadable})` : '';
      return { allowed: false, rule, message: `Only an owner of ${named}, or an App manager, can ${action}: ${owned.why}${extra}.` };
    }
    return { allowed: false, rule, message: `Inspire has no access rule named ${rule} for ${key}, so it refuses it.` };
  }

  async function verdictFor(key, req) {
    const entry = Object.hasOwn(ROUTE_POLICY, key) ? ROUTE_POLICY[key] : null;
    if (!entry) return { allowed: false, rule: 'none', message: `Inspire has no access rule for ${key}, so it refuses it.` };
    if (!deps.enforce() || entry.rule === 'any' || entry.rule === 'delegated') return { allowed: true };
    try {
      return await decide(key, entry, req);
    } catch (err) {
      return { allowed: false, rule: entry.rule, message: `Inspire could not check that you may ${entry.action}: ${oneLine(err.message)}.` };
    }
  }

  function gate(key) {
    return async function routePolicyGate(req, res, next) {
      const verdict = await verdictFor(key, req);
      if (verdict.allowed) return next();
      return refusal(res, key, verdict.rule, verdict.message);
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
  resolveIdentity,
  canonicalPath,
  outputFolderOf,
  insideFolder,
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
