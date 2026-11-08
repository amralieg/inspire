const crypto = require('node:crypto');
const I = require('./inspireImplement');
const P = require('./requestPerson');
const RP = require('./routePolicy');
const { DEFAULT_GENERATION_PATH } = require('./inspireJobParams');
const { fsApiPath } = require('./workspacePaths');

const RUN_NO_SIGN_IN = "Inspire needs your sign-in to check what you can read. Reload the App and try again.";
const UNREADABLE_SHOWN = 10;
const SCHEMAS_AT_ONCE = 8;
const SYSTEM_SCHEMA = 'information_schema';
const UC = '/api/2.1/unity-catalog';
const WRITE_NO_SIGN_IN = "Inspire needs your sign-in to check the output folder. Reload the App and try again.";
const PROBE_PREFIX = '.inspire_write_check_';
const FALLBACK_FOLDER = 'inspire_output';
const SWEEP_LIMIT = 20;
const SCOPE_RE = /does not have required scopes|required scope/i;
const SCOPE_VERDICT = {
  reason: "Inspire's sign-in for you lacks a scope this check needs",
  fix: 'ask an App manager to re-run the Inspire installer, which adds the scopes Inspire needs',
};


async function bodyOf(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function failed(got) {
  return Object.assign(new Error(String(got.data.message || got.data.error || got.data.raw || `HTTP ${got.status}`)), { status: got.status });
}

async function answer(dbFetch, host, token, path, options) {
  let response;
  try {
    response = await dbFetch(host, token, path, options);
  } catch (err) {
    throw Object.assign(new Error(err.message || String(err)), { status: 502 });
  }
  const data = await bodyOf(response);
  return { ok: response.ok, status: Number(response.status), data: data && typeof data === 'object' ? data : {} };
}

async function pages(dbFetch, host, token, path, params, key, maxPages) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const qs = new URLSearchParams(params);
    if (pageToken) qs.set('page_token', pageToken);
    const response = await dbFetch(host, token, `${path}?${qs}`);
    const data = await bodyOf(response);
    if (!response.ok) throw failed({ status: response.status, data });
    items.push(...(Array.isArray(data[key]) ? data[key] : []));
    pageToken = data.next_page_token || '';
    if (!pageToken) return { items, truncated: false };
  }
  return { items, truncated: true };
}

function cutText(what, listed, noun) {
  return `${what} holds more ${noun} than the ${listed.toLocaleString('en-US')} Inspire can list`;
}

function whole(listed, what, noun) {
  if (!listed.truncated) return listed.items;
  throw Object.assign(new Error(cutText(what, listed.items.length, noun)), { status: 502, cut: true });
}

function listCatalogs(dbFetch, host, token) {
  return pages(dbFetch, host, token, `${UC}/catalogs`, [['max_results', '1000']], 'catalogs', 40);
}

function listSchemas(dbFetch, host, token, catalog) {
  return pages(dbFetch, host, token, `${UC}/schemas`, [['catalog_name', catalog], ['max_results', '500']], 'schemas', 100);
}

function listTables(dbFetch, host, token, catalog, schema, { browse = false } = {}) {
  const params = [['catalog_name', catalog], ['schema_name', schema], ['max_results', '500'], ...(browse ? [['include_browse', 'true']] : [])];
  return pages(dbFetch, host, token, `${UC}/tables`, params, 'tables', 200);
}

const unseen = (err) => [403, 404].includes(Number(err && err.status));

async function canRead(dbFetch, host, token, path, options) {
  const got = await answer(dbFetch, host, token, path, options);
  if (got.ok) return true;
  if (unseen(got)) return false;
  throw failed(got);
}

function tableReadable(dbFetch, host, token, table) {
  return canRead(dbFetch, host, token, `${UC}/tables/${encodeURIComponent(table)}`);
}

function fileReadable(dbFetch, host, token, path) {
  if (path.startsWith('/Volumes/')) {
    return canRead(dbFetch, host, token, fsApiPath('files', path), { method: 'HEAD' });
  }
  const asked = path.startsWith('/Workspace/') ? path.slice('/Workspace'.length) : path;
  return canRead(dbFetch, host, token, `/api/2.0/workspace/get-status?path=${encodeURIComponent(asked)}`);
}

function ucMetadataParts(text) {
  const raw = I.pythonStrip(text);
  const parts = { path: '', catalogs: [], schemas: [], tables: [] };
  if (!raw) return parts;
  if (raw.startsWith('/')) return { ...parts, path: raw };
  for (const piece of raw.split(',')) {
    const item = I.pythonStrip(piece);
    if (!item) continue;
    const dots = item.split('.').length - 1;
    if (dots === 2) parts.tables.push(item);
    else if (dots === 1) parts.schemas.push(item);
    else if (dots === 0) parts.catalogs.push(item);
  }
  return parts;
}

function discoverReads(params) {
  const values = params && typeof params === 'object' ? params : {};
  const { path, catalogs, schemas, tables } = ucMetadataParts(values['01_uc_metadata']);
  const strategy = I.pythonStrip(values['10_strategic_context']);
  return { catalogs, schemas, tables, files: [path, strategy.startsWith('/') ? strategy : ''].filter(Boolean) };
}

async function atMost(limit, items, run) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const fullName = (catalog, schema, table) => String(table.full_name || `${catalog}.${schema}.${table.name}`);

const kept = (entry) => ({ entries: [entry], unreadable: [], unchecked: [] });
const unsure = (entry, why) => ({ entries: [entry], unreadable: [], unchecked: [`${entry} (${why})`] });
const whyOf = (err) => String((err && err.message) || err);

async function schemaPlan(dbFetch, host, tokens, catalog, schema) {
  const name = `${catalog}.${schema}`;
  let run;
  try {
    run = whole(await listTables(dbFetch, host, tokens.app, catalog, schema, { browse: true }), name, 'tables');
  } catch (err) {
    return unseen(err) ? kept(name) : unsure(name, whyOf(err));
  }
  let readable = [];
  try {
    readable = whole(await listTables(dbFetch, host, tokens.person, catalog, schema), name, 'tables');
  } catch (err) {
    if (!unseen(err)) return unsure(name, whyOf(err));
  }
  const own = new Set(readable.map((t) => fullName(catalog, schema, t).toLowerCase()));
  const all = run.map((t) => fullName(catalog, schema, t));
  const unreadable = all.filter((t) => !own.has(t.toLowerCase()));
  return { entries: unreadable.length ? all.filter((t) => own.has(t.toLowerCase())) : [name], unreadable, unchecked: [] };
}

function merged(plans) {
  return { entries: plans.flatMap((p) => p.entries), unreadable: plans.flatMap((p) => p.unreadable), unchecked: plans.flatMap((p) => p.unchecked) };
}

async function catalogPlan(dbFetch, host, tokens, catalog) {
  let schemas;
  try {
    schemas = whole(await listSchemas(dbFetch, host, tokens.app, catalog), catalog, 'schemas');
  } catch (err) {
    return unseen(err) ? kept(catalog) : unsure(catalog, whyOf(err));
  }
  const names = schemas.map((s) => String(s.name || '')).filter((name) => name && name.toLowerCase() !== SYSTEM_SCHEMA);
  const plan = merged(await atMost(SCHEMAS_AT_ONCE, names, (name) => schemaPlan(dbFetch, host, tokens, catalog, name)));
  return plan.unreadable.length ? plan : { ...plan, entries: [catalog] };
}

async function onePlan(entry, check) {
  try {
    return (await check()) ? kept(entry) : { entries: [], unreadable: [entry], unchecked: [] };
  } catch (err) {
    return unsure(entry, whyOf(err));
  }
}

async function readPlan(dbFetch, host, tokens, reads) {
  const tables = await atMost(SCHEMAS_AT_ONCE, reads.tables || [], (t) => onePlan(t, () => tableReadable(dbFetch, host, tokens.person, t)));
  const schemas = await atMost(SCHEMAS_AT_ONCE, reads.schemas || [], (s) => {
    const [catalog, schema] = s.split('.');
    return schemaPlan(dbFetch, host, tokens, catalog, schema);
  });
  const catalogs = await atMost(SCHEMAS_AT_ONCE, reads.catalogs || [], (c) => catalogPlan(dbFetch, host, tokens, c));
  const files = merged(await atMost(SCHEMAS_AT_ONCE, reads.files || [], (f) => onePlan(f, () => fileReadable(dbFetch, host, tokens.person, f))));
  const scope = merged([...catalogs, ...schemas, ...tables]);
  return {
    entries: I.uniqueTables(scope.entries),
    unreadable: I.uniqueTables(scope.unreadable),
    files: files.unreadable,
    unchecked: [...scope.unchecked, ...files.unchecked],
  };
}

const APP_READ_PROBES = 100;

async function scopeTables(dbFetch, host, token, entries, limit = APP_READ_PROBES) {
  const tables = [];
  let more = false;
  for (const entry of entries) {
    const [catalog, schema, table] = entry.split('.');
    if (table) {
      tables.push(entry);
      continue;
    }
    const schemas = schema ? [schema] : (await listSchemas(dbFetch, host, token, catalog)).items
      .map((s) => String(s.name || '')).filter((name) => name && name.toLowerCase() !== SYSTEM_SCHEMA);
    for (const name of schemas) {
      if (tables.length >= limit) break;
      const listed = await listTables(dbFetch, host, token, catalog, name);
      more = more || listed.truncated;
      tables.push(...listed.items.map((t) => fullName(catalog, name, t)));
    }
  }
  const unique = I.uniqueTables(tables);
  return { tables: unique.slice(0, limit), more: more || unique.length > limit };
}

async function unreadableReads(dbFetch, host, tokens, reads) {
  const plan = await readPlan(dbFetch, host, tokens, reads);
  return plan.unreadable.concat(plan.files);
}

function shownNames(names) {
  const shown = names.slice(0, UNREADABLE_SHOWN);
  const more = names.length - shown.length;
  return I.joinAnd(more ? [...shown, `${more} more`] : shown);
}

function runUnreadableText(names) {
  return `You can't read ${shownNames(names)}. Pick tables and files you can read, or ask their owner for access`;
}

function skippedTablesText(names) {
  return `Skipped ${names.length} ${names.length === 1 ? 'table' : 'tables'} you can't read: ${shownNames(names)}.`;
}

function uncheckedText(items) {
  return `Inspire could not check that you can read ${shownNames(items)}, so the run reads ${items.length === 1 ? 'it' : 'them'} as picked.`;
}

async function runReadPlan(dbFetch, req, reads) {
  const none = { refusal: null, skipped: [], unchecked: [], scope: null, warnings: [], uncheckedWarnings: [] };
  const asked = ['tables', 'schemas', 'catalogs', 'files'].some((key) => (reads[key] || []).length);
  if (!asked) return none;
  const person = P.personTokenOf(req);
  if (!person) return { ...none, refusal: { status: 401, message: RUN_NO_SIGN_IN, unreadable: [] } };
  const plan = await readPlan(dbFetch, req.dbHost, { person, app: req.dbToken }, reads);
  if (plan.unchecked.length) console.warn(`run read check: not checked: ${plan.unchecked.join('; ')}`);
  const warnings = plan.unchecked.length ? [uncheckedText(plan.unchecked)] : [];
  if (plan.files.length) return { ...none, refusal: { status: 403, message: runUnreadableText(plan.files), unreadable: plan.files } };
  if (plan.unreadable.length && !plan.entries.length) {
    return { ...none, refusal: { status: 403, message: runUnreadableText(plan.unreadable), unreadable: plan.unreadable } };
  }
  if (!plan.unreadable.length) return { ...none, unchecked: plan.unchecked, warnings, uncheckedWarnings: warnings };
  return {
    refusal: null,
    skipped: plan.unreadable,
    unchecked: plan.unchecked,
    scope: plan.entries.join(','),
    warnings: [skippedTablesText(plan.unreadable), ...warnings],
    uncheckedWarnings: warnings,
  };
}

async function runReadRefusal(dbFetch, req, reads) {
  const plan = await runReadPlan(dbFetch, req, reads);
  if (plan.refusal) return plan.refusal;
  return plan.skipped.length ? { status: 403, message: runUnreadableText(plan.skipped), unreadable: plan.skipped } : null;
}

const scopeMissing = (got) => SCOPE_RE.test(String(got.data.message || got.data.error || ''));
const probeName = () => `${PROBE_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`;
const leftover = (entry) => entry.directory && String(entry.path || '').split('/').pop().startsWith(PROBE_PREFIX);
const json = (method, body) => ({ method, body: JSON.stringify(body) });
const fsDirectory = (path) => fsApiPath('directories', path);

function discoverWrites(params, notebookPath) {
  const values = params && typeof params === 'object' ? params : {};
  const asked = String(values['11_generation_path'] == null ? '' : values['11_generation_path']).trim() || DEFAULT_GENERATION_PATH;
  const folder = /^[a-z][a-z0-9+.-]*:/i.test(asked) ? '' : RP.outputFolderOf(asked, notebookPath);
  return { folders: [folder || asked], defaulted: asked === DEFAULT_GENERATION_PATH };
}

async function removeProbe(remove, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const gone = await remove(path).catch(() => ({ ok: false, status: 502, data: {} }));
    if (gone.ok || gone.status === 404) return true;
  }
  console.warn(`output write check: ${path} could not be deleted; the next check in that folder deletes it`);
  return false;
}

async function sweep(list, remove) {
  const paths = (await list().catch(() => [])).filter(leftover).map((e) => e.path).slice(0, SWEEP_LIMIT);
  for (const path of paths) await removeProbe(remove, path);
}

async function nearestExisting(exists, path, top) {
  let at = path;
  for (;;) {
    const got = await exists(at);
    if (got.ok) return { at, got };
    if (got.status !== 404 || at === top) return { at, got };
    at = at.replace(/\/[^/]+$/, '') || '/';
  }
}

async function probeIn({ at, make, remove, list, denied }) {
  await sweep(list, remove);
  const probe = `${at === '/' ? '' : at}/${probeName()}`;
  const made = await make(probe);
  if (!made.ok) {
    if (scopeMissing(made)) return SCOPE_VERDICT;
    if ([401, 403].includes(made.status)) return denied;
    throw failed(made);
  }
  await removeProbe(remove, probe);
  return null;
}

async function workspaceVerdict(dbFetch, host, token, path) {
  const fix = 'choose a folder you can manage, such as one under your own user folder, or ask its owner for CAN MANAGE on it, '
    + 'which Databricks needs before anyone can create something in a folder';
  const call = (p, options) => answer(dbFetch, host, token, p, options);
  const { at, got } = await nearestExisting((p) => call(`/api/2.0/workspace/get-status?path=${encodeURIComponent(p)}`), path, '/');
  if (!got.ok) {
    if (scopeMissing(got)) return SCOPE_VERDICT;
    if ([403, 404].includes(got.status)) return { reason: `you cannot see ${at}`, fix };
    throw failed(got);
  }
  if (String(got.data.object_type || '').toUpperCase() !== 'DIRECTORY') return { reason: `${at} is not a folder`, fix };
  return probeIn({
    at,
    make: (probe) => call('/api/2.0/workspace/mkdirs', json('POST', { path: probe })),
    remove: (probe) => call('/api/2.0/workspace/delete', json('POST', { path: probe, recursive: false })),
    list: async () => {
      const listed = await call(`/api/2.0/workspace/list?path=${encodeURIComponent(at)}`);
      return listed.ok && Array.isArray(listed.data.objects)
        ? listed.data.objects.filter(Boolean).map((o) => ({ path: o.path, directory: String(o.object_type || '').toUpperCase() === 'DIRECTORY' })) : [];
    },
    denied: { reason: `you cannot create anything in ${at}`, fix },
  });
}

async function volumeVerdict(dbFetch, host, token, path) {
  const [, , catalog, schema, volume] = path.split('/');
  if (!catalog || !schema || !volume) return { reason: 'it names no Unity Catalog volume', fix: 'choose a folder inside a volume, /Volumes/<catalog>/<schema>/<volume>/...' };
  const full = `${catalog}.${schema}.${volume}`;
  const root = `/Volumes/${catalog}/${schema}/${volume}`;
  const fix = `ask an owner of the volume ${full} for WRITE VOLUME on it`;
  const call = (p, options) => answer(dbFetch, host, token, p, options);
  const { at, got } = await nearestExisting((p) => call(fsDirectory(p), { method: 'HEAD' }), path, root);
  if (!got.ok) {
    if (scopeMissing(got)) return SCOPE_VERDICT;
    if ([403, 404].includes(got.status)) return { reason: at === root ? `the volume ${full} does not exist or you cannot see it` : `you cannot see ${at}`, fix };
    throw failed(got);
  }
  return probeIn({
    at,
    make: (probe) => call(fsDirectory(probe), { method: 'PUT' }),
    remove: (probe) => call(fsDirectory(probe), { method: 'DELETE' }),
    list: async () => {
      const listed = await call(fsDirectory(at));
      return listed.ok && Array.isArray(listed.data.contents)
        ? listed.data.contents.filter(Boolean).map((c) => ({ path: c.path, directory: c.is_directory === true })) : [];
    },
    denied: { reason: `you hold no WRITE VOLUME on the volume ${full}`, fix },
  });
}

function folderVerdict(dbFetch, host, token, folder) {
  const path = RP.canonicalPath(folder);
  if (!path) {
    return Promise.resolve({ reason: 'it is not a workspace folder or a volume path Inspire can resolve', fix: 'give an absolute folder, such as one under your own user folder' });
  }
  return path.startsWith('/Volumes/') ? volumeVerdict(dbFetch, host, token, path) : workspaceVerdict(dbFetch, host, token, path);
}

function runUnwritableText(unwritable) {
  const named = unwritable.map((u) => `${u.folder} (${u.reason})`);
  const fixes = [...new Set(unwritable.map((u) => u.fix))];
  return `You cannot write to ${I.joinAnd(named)} with your own sign-in, and Inspire never writes for you where you cannot write: ${fixes.join('; ')}.`;
}

async function personWrites(dbFetch, req, folder) {
  const token = P.personTokenOf(req);
  if (!token) return { refused: { status: 401, message: WRITE_NO_SIGN_IN, unwritable: [] }, unchecked: '' };
  try {
    const verdict = await folderVerdict(dbFetch, req.dbHost, token, folder);
    return { refused: verdict ? { status: 403, message: runUnwritableText([{ folder, ...verdict }]), unwritable: [folder] } : null, unchecked: '' };
  } catch (err) {
    return { refused: null, unchecked: whyOf(err) };
  }
}

async function appWrites(dbFetch, req, folder, appToken) {
  if (!appToken || appToken === P.personTokenOf(req)) return { verdict: null, unchecked: '' };
  try {
    return { verdict: await folderVerdict(dbFetch, req.dbHost, appToken, folder), unchecked: '' };
  } catch (err) {
    return { verdict: null, unchecked: whyOf(err) };
  }
}

async function folderPlan(dbFetch, req, folder, { manager, appToken }) {
  const person = manager ? { refused: null, unchecked: '' } : await personWrites(dbFetch, req, folder);
  if (person.refused) return { folder, refused: person.refused, personUnchecked: '', app: { verdict: null, unchecked: '' } };
  return { folder, refused: null, personUnchecked: person.unchecked, app: await appWrites(dbFetch, req, folder, appToken) };
}

const folderScore = (plan) => (plan.refused ? 0 : plan.app.verdict ? 1 : 2);

function folderWarnings(plan) {
  const out = [];
  if (plan.personUnchecked) {
    console.warn(`output write check: not checked for the person on ${plan.folder}: ${plan.personUnchecked}`);
    out.push(`Inspire could not check that you can write to ${plan.folder}. The run tries anyway.`);
  }
  if (plan.app.verdict) out.push(`The Inspire App can't write to ${plan.folder}, so the run saves no files there. Ask an App manager to give the App CAN MANAGE on it.`);
  if (plan.app.unchecked) {
    console.warn(`output write check: not checked for the App on ${plan.folder}: ${plan.app.unchecked}`);
    out.push(`Inspire could not check that the App can write to ${plan.folder}. The run tries anyway.`);
  }
  return out;
}

const planVerdict = (plan, extra = []) => (plan.refused
  ? { refused: plan.refused, folder: plan.folder, generationPath: '', warnings: [] }
  : { refused: null, folder: plan.folder, generationPath: '', warnings: [...extra, ...folderWarnings(plan)] });

async function outputPlan(dbFetch, req, writes, { manager = false, appToken = '' } = {}) {
  const folders = ((writes && writes.folders) || []).filter(Boolean);
  if (!folders.length) return { refused: null, folder: '', generationPath: '', warnings: [] };
  const me = RP.forwardedPerson(req.headers);
  if (!writes.defaulted || !me) return planVerdict(await folderPlan(dbFetch, req, folders[0], { manager, appToken }));
  const home = `/Users/${me}/${FALLBACK_FOLDER}`;
  const inHome = (plan, extra) => ({ ...planVerdict(plan, extra), generationPath: plan.refused ? '' : `/Workspace${home}` });
  const own = await folderPlan(dbFetch, req, home, { manager, appToken });
  if (folderScore(own) === 2 || own.refused?.status === 401) return inHome(own);
  const shared = await folderPlan(dbFetch, req, folders[0], { manager, appToken });
  if (shared.refused) return own.refused ? planVerdict(shared) : inHome(own);
  if (folderScore(shared) <= folderScore(own)) return inHome(own);
  const why = own.refused ? 'you cannot write there' : 'the Inspire App cannot write there; give the App CAN MANAGE on it to keep your runs private';
  return planVerdict(shared, [`Inspire cannot save to your folder ${home} (${why}), so it saves to ${shared.folder}, which everyone in the workspace can read.`]);
}

function writeRefusalBody(key, refused) {
  if (refused.status === 401) return { error: refused.message, policy: { route: String(key), identity: 'person', needs: RP.IDENTITIES.person }, unwritable: [] };
  if (refused.status === 403) return { ...RP.refusalBody(String(key), 'writer', refused.message), unwritable: refused.unwritable };
  return { error: refused.message, unwritable: refused.unwritable };
}

module.exports = {
  RUN_NO_SIGN_IN,
  UNREADABLE_SHOWN,
  WRITE_NO_SIGN_IN,
  PROBE_PREFIX,
  listCatalogs,
  listSchemas,
  listTables,
  APP_READ_PROBES,
  scopeTables,
  tableReadable,
  fileReadable,
  ucMetadataParts,
  discoverReads,
  unreadableReads,
  runUnreadableText,
  skippedTablesText,
  runReadPlan,
  runReadRefusal,
  discoverWrites,
  folderVerdict,
  runUnwritableText,
  outputPlan,
  writeRefusalBody,
};
