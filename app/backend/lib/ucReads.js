const crypto = require('node:crypto');
const I = require('./inspireImplement');
const P = require('./requestPerson');
const RP = require('./routePolicy');
const { DEFAULT_GENERATION_PATH } = require('./inspireJobParams');

const RUN_NO_SIGN_IN = 'Inspire checks with your own sign-in that you can read every table and file a run reads, and this request carries none, '
  + 'so it starts no run';
const UNREADABLE_SHOWN = 10;
const SCHEMAS_AT_ONCE = 8;
const SYSTEM_SCHEMA = 'information_schema';
const UC = '/api/2.1/unity-catalog';
const WRITE_NO_SIGN_IN = 'Inspire checks with your own sign-in that you can write to the output folder a run writes to, and this request carries none, '
  + 'so it starts no run';
const PROBE_PREFIX = '.inspire_write_check_';
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
  const all = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const qs = new URLSearchParams(params);
    if (pageToken) qs.set('page_token', pageToken);
    const response = await dbFetch(host, token, `${path}?${qs}`);
    const data = await bodyOf(response);
    if (!response.ok) throw failed({ status: response.status, data });
    all.push(...(Array.isArray(data[key]) ? data[key] : []));
    pageToken = data.next_page_token || '';
    if (!pageToken) break;
  }
  return all;
}

function listCatalogs(dbFetch, host, token) {
  return pages(dbFetch, host, token, `${UC}/catalogs`, [['max_results', '200']], 'catalogs', 40);
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
    return canRead(dbFetch, host, token, `/api/2.0/fs/files${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD' });
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

async function schemaUnreadable(dbFetch, host, tokens, catalog, schema) {
  let run;
  try {
    run = await listTables(dbFetch, host, tokens.app, catalog, schema, { browse: true });
  } catch (err) {
    if (unseen(err)) return [];
    throw err;
  }
  let readable = [];
  try {
    readable = await listTables(dbFetch, host, tokens.person, catalog, schema);
  } catch (err) {
    if (!unseen(err)) throw err;
  }
  const own = new Set(readable.map((t) => fullName(catalog, schema, t).toLowerCase()));
  return run.map((t) => fullName(catalog, schema, t)).filter((name) => !own.has(name.toLowerCase()));
}

async function catalogUnreadable(dbFetch, host, tokens, catalog) {
  let schemas;
  try {
    schemas = await listSchemas(dbFetch, host, tokens.app, catalog);
  } catch (err) {
    if (unseen(err)) return [];
    throw err;
  }
  const names = schemas.map((s) => String(s.name || '')).filter((name) => name && name.toLowerCase() !== SYSTEM_SCHEMA);
  return (await atMost(SCHEMAS_AT_ONCE, names, (name) => schemaUnreadable(dbFetch, host, tokens, catalog, name))).flat();
}

async function unreadableReads(dbFetch, host, tokens, reads) {
  const tables = await atMost(SCHEMAS_AT_ONCE, reads.tables || [], async (t) => ((await tableReadable(dbFetch, host, tokens.person, t)) ? [] : [t]));
  const files = await atMost(SCHEMAS_AT_ONCE, reads.files || [], async (f) => ((await fileReadable(dbFetch, host, tokens.person, f)) ? [] : [f]));
  const schemas = await atMost(SCHEMAS_AT_ONCE, reads.schemas || [], (s) => {
    const [catalog, schema] = s.split('.');
    return schemaUnreadable(dbFetch, host, tokens, catalog, schema);
  });
  const catalogs = await atMost(SCHEMAS_AT_ONCE, reads.catalogs || [], (c) => catalogUnreadable(dbFetch, host, tokens, c));
  return I.uniqueTables([...tables, ...schemas, ...catalogs].flat()).concat(files.flat());
}

function runUnreadableText(names) {
  const shown = names.slice(0, UNREADABLE_SHOWN);
  const more = names.length - shown.length;
  return `You cannot read ${I.joinAnd(more ? [...shown, `${more} more`] : shown)} with your own sign-in, and Inspire never reads for you what you `
    + 'cannot read: choose only tables and files you can read, or ask their owner for access';
}

async function runReadRefusal(dbFetch, req, reads) {
  const asked = ['tables', 'schemas', 'catalogs', 'files'].some((key) => (reads[key] || []).length);
  if (!asked) return null;
  const person = P.personTokenOf(req);
  if (!person) return { status: 401, message: RUN_NO_SIGN_IN, unreadable: [] };
  let names;
  try {
    names = await unreadableReads(dbFetch, req.dbHost, { person, app: req.dbToken }, reads);
  } catch (err) {
    return { status: 502, message: `Inspire could not check that you can read every table and file this run reads, so it starts no run: ${err.message}`, unreadable: [] };
  }
  return names.length ? { status: 403, message: runUnreadableText(names), unreadable: names } : null;
}

const scopeMissing = (got) => SCOPE_RE.test(String(got.data.message || got.data.error || ''));
const probeName = () => `${PROBE_PREFIX}${crypto.randomUUID().replace(/-/g, '')}`;
const leftover = (entry) => entry.directory && String(entry.path || '').split('/').pop().startsWith(PROBE_PREFIX);
const json = (method, body) => ({ method, body: JSON.stringify(body) });
const fsDirectory = (path) => `/api/2.0/fs/directories${path.split('/').map(encodeURIComponent).join('/')}`;

function discoverWrites(params, notebookPath) {
  const values = params && typeof params === 'object' ? params : {};
  const asked = String(values['11_generation_path'] == null ? '' : values['11_generation_path']).trim() || DEFAULT_GENERATION_PATH;
  const folder = /^[a-z][a-z0-9+.-]*:/i.test(asked) ? '' : RP.outputFolderOf(asked, notebookPath);
  return { folders: [folder || asked] };
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

async function runWriteRefusal(dbFetch, req, writes) {
  const folders = ((writes && writes.folders) || []).filter(Boolean);
  if (!folders.length) return null;
  const token = P.personTokenOf(req);
  if (!token) return { status: 401, message: WRITE_NO_SIGN_IN, unwritable: [] };
  const unwritable = [];
  try {
    for (const folder of folders) {
      const verdict = await folderVerdict(dbFetch, req.dbHost, token, folder);
      if (verdict) unwritable.push({ folder, ...verdict });
    }
  } catch (err) {
    return { status: 502, message: `Inspire could not check that you can write to ${I.joinAnd(folders)}, so it starts no run: ${err.message}`, unwritable: [] };
  }
  return unwritable.length ? { status: 403, message: runUnwritableText(unwritable), unwritable: unwritable.map((u) => u.folder) } : null;
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
  tableReadable,
  fileReadable,
  ucMetadataParts,
  discoverReads,
  unreadableReads,
  runUnreadableText,
  runReadRefusal,
  discoverWrites,
  folderVerdict,
  runUnwritableText,
  runWriteRefusal,
  writeRefusalBody,
};
