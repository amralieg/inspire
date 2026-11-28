// c37 (REQ-582, REQ-583 U8 v2): the App labels the scope top-down before a Let Inspire Decides run (catalogs, then schemas of prod
// catalogs, then tables of prod schemas) with the cheapest gateway Claude model, and writes <inspire_db>.__inspire_table_labels.
// Nothing here ever throws into a launch: a failed call leaves its objects unlabelled and the agent classifies them.
const TABLE_BATCH = 300;
const MAX_CALLS = 16;
const MAX_COLUMNS = 40;
const INSERT_ROWS = 200;
const LISTS_AT_ONCE = 8;
const FAMILIES = ['claude-haiku', 'claude-sonnet', 'claude-opus'];
const PREFIX = 'system.ai.';

const DESCR = {
  transactional: 'Each row records one discrete business event that happened at a point in time (a sale, payment, booking, shipment, return, measurement, review). Insert-heavy, grows with business activity.',
  master: 'Each row is a business entity that exists and has attributes and a lifecycle (a person, organization, asset, product, location, contract). Updated occasionally, does not grow per event.',
  reference: 'A small, stable lookup or code set that classifies or categorizes other data (types, codes, statuses, countries, calendar). Changes rarely.',
  technical: 'IT or platform infrastructure with no business meaning: logs, audit trails, billing or usage metering of the platform, lineage, metadata catalogs, job or pipeline run history, monitoring, staging, internal system tables.',
};
const LABEL_OF = { t: 'transactional', m: 'master', r: 'reference', x: 'technical' };
const ENV_OF = { p: 'prod', d: 'dev' };
const ENV_RULE = 'prod = the real production data of the business; dev = development, test, sandbox, staging, scratch, personal or demo copies. Decide from the names and comments. This prompt is industry-agnostic. The user\'s explicit input wins over any guess, so anything the user named is already decided and is not listed here.';

const versionOf = (id) => (id.match(/\d+/g) || []).map(Number);
function newer(a, b) {
  const [x, y] = [versionOf(a), versionOf(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
}

// The cheapest Claude model listed: haiku, then sonnet, then opus; the newest of that family. null when no Claude model is listed.
function pickLabelModel(names) {
  const claude = (names || []).filter((n) => typeof n === 'string' && n.startsWith(`${PREFIX}claude-`));
  for (const family of FAMILIES) {
    const inFamily = claude.filter((n) => n.startsWith(`${PREFIX}${family}`)).sort(newer);
    if (inFamily.length) return inFamily[0];
  }
  return null;
}

function tableLine(t) {
  const cols = t.columns || [];
  const shown = cols.slice(0, MAX_COLUMNS).map((c) => `${c.name} ${c.type || c.type_text || 'string'}`).join(', ');
  const more = cols.length - MAX_COLUMNS;
  return `${t.fqn}${t.comment ? ` | comment: ${t.comment}` : ''} | columns (${cols.length}): ${shown}${more > 0 ? ` +${more} more` : ''}`;
}

function tablePrompt(batch) {
  return `Classify each database table. First its environment: p = prod, d = dev. ${ENV_RULE}\n`
    + `Then its class: ${Object.entries(DESCR).map(([k, v]) => `${k} = ${v}`).join('; ')}\n\n`
    + 'Use the comment and columns as primary evidence, the name as secondary. This prompt is industry-agnostic; the user\'s explicit input wins over any guess.\n\nTABLES:\n'
    + `${batch.map((t, i) => `${i + 1}. ${tableLine(t)}`).join('\n')}\n\n`
    + 'Output ONLY one line per table: <number>|<p|d>|<t|m|r|x> (t=transactional, m=master, r=reference, x=technical). No other text.';
}

function parseTables(text, batch) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s*\|\s*([pd])\s*\|\s*([tmrx])/.exec(line.toLowerCase());
    const t = m && batch[Number(m[1]) - 1];
    if (t && !out[t.fqn]) out[t.fqn] = { env: ENV_OF[m[2]], label: LABEL_OF[m[3]] };
  }
  return out;
}

function envPrompt(kind, items) {
  return `Classify each database ${kind} as p (prod) or d (dev). ${ENV_RULE}\n\n${kind.toUpperCase()}S:\n`
    + `${items.map((it, i) => `${i + 1}. ${it.name}${it.comment ? ` | comment: ${it.comment}` : ''}`).join('\n')}\n\n`
    + 'Output ONLY one line per item: <number>|<p|d>. No other text.';
}

function parseEnv(text, names) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s*\|\s*([pd])/.exec(line.toLowerCase());
    const name = m && names[Number(m[1]) - 1];
    if (name && !out[name]) out[name] = ENV_OF[m[2]];
  }
  return out;
}

async function pool(limit, items, run) {
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

const why = (err) => String((err && err.message) || err).slice(0, 200);

// scope: { catalogs: [{name, comment}], schemasOf(cat), tablesOf(cat, schema) }, userNamed: { catalogs: [], schemas: ['cat.schema'] }.
// Returns { rows, errors }. deadlineAt (ms epoch) stops new calls and stops waiting on calls in flight; what is already labelled is kept.
// onProgress({ done, total }) reports the tables labelled so far out of the tables sent to the classifier.
async function labelScope({ catalogs, schemasOf, tablesOf, userNamed = {}, model, callModel, deadlineAt = Infinity, onProgress = () => {} }) {
  const rows = [];
  const errors = [];
  const source = `app:${model}`;
  const namedCats = new Set(userNamed.catalogs || []);
  const namedSchemas = new Set(userNamed.schemas || []);
  const late = () => Date.now() >= deadlineAt;
  let timer;
  const expired = new Promise((_resolve, reject) => {
    if (Number.isFinite(deadlineAt)) {
      timer = setTimeout(() => reject(new Error('the labelling deadline passed')), Math.max(0, deadlineAt - Date.now()));
      timer.unref();
    }
  });
  expired.catch(() => {});
  const ask = async (prompt) => {
    if (late()) throw new Error('the labelling deadline passed');
    return Promise.race([callModel({ model, prompt }), expired]);
  };
  const decide = async (kind, items, named, fqnOf) => {
    const env = {};
    const open = items.filter((it) => !named.has(fqnOf(it)));
    if (open.length) {
      try {
        Object.assign(env, parseEnv(await ask(envPrompt(kind, open.map((it) => ({ name: fqnOf(it), comment: it.comment })))), open.map(fqnOf)));
      } catch (err) { errors.push(`${kind} environment: ${why(err)}`); }
    }
    const level = kind;
    const decided = [];
    for (const it of items) {
      const fqn = fqnOf(it);
      if (named.has(fqn)) rows.push({ level, object_fqn: fqn, env: 'prod', label: null, confidence: null, source: 'user' });
      else if (env[fqn]) rows.push({ level, object_fqn: fqn, env: env[fqn], label: null, confidence: null, source });
      else continue;
      decided.push({ it, prod: named.has(fqn) || env[fqn] === 'prod' });
    }
    return decided;
  };

  const prodCats = (await decide('catalog', catalogs, namedCats, (c) => c.name)).filter((d) => d.prod).map((d) => d.it.name);
  const schemaLists = await pool(LISTS_AT_ONCE, prodCats, async (cat) => {
    try { return { cat, items: (await schemasOf(cat)).map((s) => ({ ...s, cat })) }; } catch (err) { errors.push(`schemas of ${cat}: ${why(err)}`); return { cat, items: [] }; }
  });
  const prodSchemas = [];
  for (const { items } of schemaLists) {
    if (!items.length) continue;
    const decided = await decide('schema', items, namedSchemas, (s) => `${s.cat}.${s.name}`);
    prodSchemas.push(...decided.filter((d) => d.prod).map((d) => d.it));
  }
  const tableLists = await pool(LISTS_AT_ONCE, prodSchemas, async (s) => {
    try { return await tablesOf(s.cat, s.name); } catch (err) { errors.push(`tables of ${s.cat}.${s.name}: ${why(err)}`); return []; }
  });
  const tables = tableLists.flat();
  const batches = [];
  for (let i = 0; i < tables.length; i += TABLE_BATCH) batches.push(tables.slice(i, i + TABLE_BATCH));
  onProgress({ done: 0, total: tables.length });
  let labelled = 0;
  const parsed = await pool(MAX_CALLS, batches, async (batch) => {
    try {
      const got = parseTables(await ask(tablePrompt(batch)), batch);
      labelled += Object.keys(got).length;
      onProgress({ done: labelled, total: tables.length });
      return got;
    } catch (err) { errors.push(`tables: ${why(err)}`); return {}; }
  });
  for (const got of parsed) {
    for (const [fqn, v] of Object.entries(got)) rows.push({ level: 'table', object_fqn: fqn, env: v.env, label: v.label, confidence: null, source });
  }
  clearTimeout(timer);
  return { rows, errors };
}

const DB_RE = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

function labelsTableStatements(inspireDb, sessionId, rows) {
  const db = String(inspireDb || '').replace(/`/g, '').trim();
  if (!DB_RE.test(db)) throw new Error('the Inspire database must be catalog.schema');
  if (!/^\d+$/.test(String(sessionId))) throw new Error('the labels need a numeric Inspire session id');
  const table = `${db}.__inspire_table_labels`;
  const stmts = [{ sql: `CREATE TABLE IF NOT EXISTS ${table} (\n  session_id BIGINT,\n  level STRING,\n  object_fqn STRING,\n  env STRING,\n  label STRING,\n  confidence DOUBLE,\n  source STRING,\n  labelled_at TIMESTAMP\n)`, parameters: null }];
  for (let i = 0; i < rows.length; i += INSERT_ROWS) {
    const parameters = [{ name: 'session_id', value: String(sessionId), type: 'STRING' }];
    const values = rows.slice(i, i + INSERT_ROWS).map((r, k) => {
      const text = (key, v) => { parameters.push({ name: `${key}${k}`, value: String(v), type: 'STRING' }); return `:${key}${k}`; };
      const maybe = (key, v) => (v == null ? 'CAST(NULL AS STRING)' : text(key, v));
      const conf = r.confidence == null ? 'CAST(NULL AS DOUBLE)' : `CAST(${text('c', r.confidence)} AS DOUBLE)`;
      return `(CAST(:session_id AS BIGINT), ${text('l', r.level)}, ${text('f', r.object_fqn)}, ${text('e', r.env)}, ${maybe('b', r.label)}, ${conf}, ${text('s', r.source)}, current_timestamp())`;
    });
    stmts.push({ sql: `INSERT INTO ${table} (session_id, level, object_fqn, env, label, confidence, source, labelled_at) VALUES\n${values.join(',\n')}`, parameters });
  }
  return stmts;
}

// The launch step. deps: { listScope() -> { catalogs, schemasOf, tablesOf, userNamed }, modelNames() -> [id], callModel, run(sql, parameters), log }.
// Only for Let Inspire Decides. Never throws and never waits past budgetMs: every failure logs one line and the launch goes on.
async function labelBeforeLaunch(params, deps, { budgetMs = 60000, onProgress } = {}) {
  if (String((params || {})['04_table_election'] || '').trim() !== 'Let Inspire Decides') return { skipped: 'election' };
  const log = deps.log || (() => {});
  const startedAt = Date.now();
  let timer;
  const work = (async () => {
    const model = pickLabelModel(await deps.modelNames());
    if (!model) return { skipped: 'no Claude model' };
    const scope = await deps.listScope();
    if (!scope || !scope.catalogs || !scope.catalogs.length) return { skipped: 'no scope' };
    const out = await labelScope({ ...scope, model, callModel: deps.callModel, deadlineAt: startedAt + budgetMs - 5000, onProgress: onProgress || undefined });
    out.errors.forEach((e) => log(`table labels: ${e}`));
    if (!out.rows.length) return { skipped: 'no rows', errors: out.errors };
    for (const s of labelsTableStatements(params['02_inspire_database'], params['14_session_id'], out.rows)) await deps.run(s.sql, s.parameters);
    return { rows: out.rows.length, errors: out.errors };
  })();
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ skipped: 'deadline' }), budgetMs); });
  try {
    const done = await Promise.race([work, deadline]);
    if (done.skipped) log(`table labels: skipped (${done.skipped}); the agent classifies the tables`);
    return done;
  } catch (err) {
    log(`table labels: skipped (${why(err)}); the agent classifies the tables`);
    return { skipped: 'error' };
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
  }
}

module.exports = { pickLabelModel, tablePrompt, parseTables, envPrompt, parseEnv, labelScope, labelsTableStatements, labelBeforeLaunch, tableLine };
