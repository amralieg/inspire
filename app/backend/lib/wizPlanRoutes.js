// c33 (REQ-577) "Find suitable data for me": the plan routes.
//   POST /api/inspire/plan/sort    { warehouse_id, catalogs[], business_name }
//        Reads information_schema only (table names, columns, comments; never a data row), asks the model to sort the tables
//        into ordered runs of at most PLAN_RUN_MAX (25) tables, and answers { catalogs, read_tables, runs, left_out } (the Plan shape in
//        app/frontend/src/lib/startWizard.js).
//        Model contract (JSON only): { runs: [{ name, why, tables: [{ table, why }] }], left_out: [{ table, reason }] } with table = "catalog.schema.table"
//        and reason one of LEFT_OUT_REASONS. The route drops tables the model invented, places every real table once and splits runs over 25.
//   POST /api/inspire/plan/start   { inspire_database, warehouse_id, business_name, plan, params, profile_id }
//        Stores every run in <inspire_db>.__inspire_plan (append-only: plan_id, run_no, name, tables, params_json, session_id, run_id, status,
//        event_at) and launches run 1 only, through deps.launchRun. Answers { plan_id, runs: [{ run_no, name, session_id, run_id, status }] }.
//   POST /api/inspire/plan/advance { inspire_database, warehouse_id }
//        Launches the next waiting run of each plan whose running run ended (deps.readRun). Idempotent. Answers { started: [...] }.
// deps: { requireToken, executeSql, sqlResultToObjects, chatModel(req, messages, maxTokens) -> { endpoint, got } | { reason },
//         launchRun(req, body) -> { status, body, params }, readRun(req, runId) -> { ok, data }, now() }
const crypto = require('node:crypto');
const { replyContent } = require('./appFeedback');

const PLAN_RUN_MAX = 25;
const PLAN_TABLE = '__inspire_plan';
const PROMPT_TABLE_MAX = 400;
const PROMPT_COLUMN_MAX = 8;
const MODEL_TOKENS = 8000;
const ENDED = new Set(['TERMINATED', 'INTERNAL_ERROR', 'SKIPPED']);
const LEFT_OUT_REASONS = {
  copy: 'Copies of other tables',
  technical: 'Technical tables',
  empty: 'Tables with no useful columns',
  other: 'Not placed in a run',
};
const NAME_PART = /^[A-Za-z0-9_-]+$/;
const advancing = new Set();

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });
const text = (v) => String(v == null ? '' : v).trim();
const bt = (name) => `\`${name}\``;

function planTable(inspireDatabase) {
  const parts = text(inspireDatabase).split('.');
  if (parts.length !== 2 || !parts.every((p) => NAME_PART.test(p))) throw fail(400, 'inspire_database must be catalog.schema.');
  return `${bt(parts[0])}.${bt(parts[1])}.${bt(PLAN_TABLE)}`;
}

function sendFailure(res, err) {
  const status = err && err.statusCode ? err.statusCode : 500;
  if (!err || !err.statusCode) console.warn(`   plan route failed: ${String(err && err.message).slice(0, 300)}`);
  res.status(status).json({ error: err && err.statusCode ? err.message : 'The plan could not be built. Try again.' });
}

// ---- sort ------------------------------------------------------------------------------------------------------------------------

async function readMetadata(deps, req, warehouseId, catalogs) {
  const tables = new Map();
  for (const catalog of catalogs) {
    if (!NAME_PART.test(catalog)) throw fail(400, `"${catalog}" is not a catalog name.`);
    const tableRows = deps.sqlResultToObjects(await deps.executeSql(req.dbHost, req.dbToken, warehouseId,
      `SELECT table_catalog, table_schema, table_name, table_type, comment FROM ${bt(catalog)}.information_schema.tables WHERE table_schema <> 'information_schema'`));
    for (const r of tableRows) {
      const name = `${r.table_catalog || catalog}.${r.table_schema}.${r.table_name}`;
      tables.set(name, { table: name, comment: text(r.comment), columns: [] });
    }
    const columnRows = deps.sqlResultToObjects(await deps.executeSql(req.dbHost, req.dbToken, warehouseId,
      `SELECT table_catalog, table_schema, table_name, column_name, data_type, comment FROM ${bt(catalog)}.information_schema.columns WHERE table_schema <> 'information_schema'`));
    for (const r of columnRows) {
      const t = tables.get(`${r.table_catalog || catalog}.${r.table_schema}.${r.table_name}`);
      if (t) t.columns.push({ name: text(r.column_name), type: text(r.data_type), comment: text(r.comment) });
    }
  }
  return [...tables.values()];
}

function sortMessages(business, tables) {
  const lines = tables.map((t) => {
    const cols = t.columns.slice(0, PROMPT_COLUMN_MAX).map((c) => (c.comment ? `${c.name} (${c.comment})` : c.name)).join(', ');
    return `${t.table} | ${t.comment.slice(0, 160)} | ${cols}`;
  });
  const system = [
    'You sort Unity Catalog tables into ordered discovery runs. You see table names, column names and comments only, never data rows.',
    `Rules: each run holds tables that belong together by business area and join with each other, at most ${PLAN_RUN_MAX} tables per run.`,
    'Order the runs so the most central business area comes first. Put each table in at most one run.',
    `Leave a table out when it is a copy of another table (reason "copy"), a technical table such as a log or a scratch table (reason "technical"), or has no useful columns (reason "empty").`,
    'Use only table names from the list. The business name and the user input below always win over any guess of yours.',
    'Answer with JSON only, no other text, in this shape:',
    '{"runs":[{"name":"short run name","why":"one sentence on why these tables belong together","tables":[{"table":"catalog.schema.table","why":"short reason"}]}],"left_out":[{"table":"catalog.schema.table","reason":"copy|technical|empty"}]}',
  ].join('\n');
  const user = `Business: ${business}\n\nTables (name | comment | columns):\n${lines.join('\n')}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseModelPlan(raw) {
  const body = text(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  let got = null;
  if (start >= 0 && end > start) {
    try { got = JSON.parse(body.slice(start, end + 1)); } catch { got = null; }
  }
  if (!got || typeof got !== 'object' || !Array.isArray(got.runs)) throw fail(502, 'The model did not return a plan. Try again.');
  return got;
}

// Places each real table once, splits runs over PLAN_RUN_MAX, numbers the runs, groups what is left out.
function buildPlan(model, real, catalogs, readCount) {
  const known = new Set(real.map((t) => t.table));
  const placed = new Set();
  const runs = [];
  for (const run of model.runs) {
    const picked = [];
    for (const t of Array.isArray(run && run.tables) ? run.tables : []) {
      const table = text(t && typeof t === 'object' ? t.table : t);
      if (!known.has(table) || placed.has(table)) continue;
      placed.add(table);
      picked.push({ table, why: text(t.why) });
    }
    const name = text(run && run.name) || 'Tables';
    const why = text(run && run.why);
    for (let i = 0; i < picked.length; i += PLAN_RUN_MAX) {
      const part = Math.floor(i / PLAN_RUN_MAX);
      runs.push({ name: part ? `${name} (${part + 1})` : name, why, tables: picked.slice(i, i + PLAN_RUN_MAX) });
    }
  }
  if (!runs.length) throw fail(502, 'The model did not place any table in a run. Try again.');
  const groups = new Map();
  const leave = (table, reason) => {
    const key = Object.hasOwn(LEFT_OUT_REASONS, reason) ? reason : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(table);
  };
  for (const l of Array.isArray(model.left_out) ? model.left_out : []) {
    const table = text(l && l.table);
    if (known.has(table) && !placed.has(table)) { placed.add(table); leave(table, text(l.reason)); }
  }
  for (const t of real) if (!placed.has(t.table)) { placed.add(t.table); leave(t.table, 'other'); }
  const left_out = [...groups.entries()].map(([reason, tables]) => ({ reason, label: LEFT_OUT_REASONS[reason], count: tables.length, example: tables[0], tables }));
  return { catalogs, read_tables: readCount, runs: runs.map((r, i) => ({ run_no: i + 1, ...r })), left_out };
}

async function sort(deps, req) {
  const body = req.body || {};
  const catalogs = [...new Set((Array.isArray(body.catalogs) ? body.catalogs : []).map(text).filter(Boolean))];
  if (!catalogs.length) throw fail(400, 'Pick at least one catalog.');
  const warehouseId = text(body.warehouse_id);
  if (!warehouseId) throw fail(400, 'warehouse_id is required.');
  const business = text(body.business_name);
  let all;
  try {
    all = await readMetadata(deps, req, warehouseId, catalogs);
  } catch (err) {
    if (err.statusCode) throw err;
    console.warn(`   plan sort: reading metadata failed: ${String(err.message).slice(0, 300)}`);
    throw fail(502, 'Inspire could not read the table names of these catalogs. Check that the App can read them and try again.');
  }
  if (!all.length) throw fail(400, 'These catalogs hold no tables Inspire can read.');
  const shown = all.slice(0, PROMPT_TABLE_MAX);
  const answer = await deps.chatModel(req, sortMessages(business, shown), MODEL_TOKENS);
  if (!answer || !answer.got || answer.got.ok === false) throw fail(502, 'The model did not answer. Try again.');
  const plan = buildPlan(parseModelPlan(replyContent(answer.got.data)), all, catalogs, all.length);
  return plan;
}

// ---- store -----------------------------------------------------------------------------------------------------------------------

async function ensurePlanTable(deps, req, warehouseId, table) {
  await deps.executeSql(req.dbHost, req.dbToken, warehouseId,
    `CREATE TABLE IF NOT EXISTS ${table} (plan_id STRING, run_no INT, name STRING, tables STRING, params_json STRING, session_id STRING, run_id STRING, status STRING, event_at TIMESTAMP)`);
}

async function appendRows(deps, req, warehouseId, table, rows) {
  if (!rows.length) return;
  const parameters = [];
  const values = rows.map((r, i) => {
    const add = (key, value, type = 'STRING') => { parameters.push({ name: `${key}${i}`, value: value == null ? null : String(value), type }); return `:${key}${i}`; };
    return `(${add('plan_id', r.plan_id)}, ${add('run_no', r.run_no, 'INT')}, ${add('name', r.name)}, ${add('tables', r.tables)}, ${add('params_json', r.params_json)}, ${add('session_id', r.session_id)}, ${add('run_id', r.run_id)}, ${add('status', r.status)}, CAST(${add('event_at', deps.now().toISOString())} AS TIMESTAMP))`;
  });
  await deps.executeSql(req.dbHost, req.dbToken, warehouseId,
    `INSERT INTO ${table} (plan_id, run_no, name, tables, params_json, session_id, run_id, status, event_at) VALUES ${values.join(', ')}`, parameters);
}

const newSessionId = () => String(Date.now()) + String(Math.floor(Math.random() * 1e6));

// One launch of a plan run: the run's tables, the plan's other params. Answers { ok, session_id, run_id } or { ok: false, status, body }.
async function launch(deps, req, { name, tables, params, profileId }) {
  const sessionId = newSessionId();
  const sent = { ...params, '00_business_name': name, '01_uc_metadata': tables.join(','), '04_table_election': 'All Tables',
    '15_operation': 'Discover Use Cases', '14_session_id': sessionId };
  const got = await deps.launchRun(req, { params: sent, notebook_path: req.body && req.body.notebook_path, cluster_id: req.body && req.body.cluster_id, profile_id: profileId });
  if (got.status >= 400 || !got.body || got.body.run_id == null) return { ok: false, status: got.status >= 400 ? got.status : 502, body: got.body, session_id: sessionId };
  return { ok: true, session_id: sessionId, run_id: String(got.body.run_id) };
}

async function start(deps, req) {
  const body = req.body || {};
  const warehouseId = text(body.warehouse_id);
  if (!warehouseId) throw fail(400, 'warehouse_id is required.');
  const table = planTable(body.inspire_database);
  const business = text(body.business_name);
  const runs = body.plan && Array.isArray(body.plan.runs) ? body.plan.runs : [];
  if (!runs.length) throw fail(400, 'The plan has no runs.');
  const sorted = [...runs].sort((a, b) => Number(a.run_no) - Number(b.run_no)).map((r) => ({
    name: text(r.name), tables: (Array.isArray(r.tables) ? r.tables : []).map((t) => text(t && typeof t === 'object' ? t.table : t)).filter(Boolean) }));
  for (const r of sorted) {
    if (!r.tables.length) throw fail(400, `Run "${r.name}" has no tables.`);
    if (r.tables.length > PLAN_RUN_MAX) throw fail(400, `Run "${r.name}" has ${r.tables.length} tables. A run holds at most ${PLAN_RUN_MAX}.`);
  }
  const params = { ...(body.params && typeof body.params === 'object' ? body.params : {}) };
  delete params['14_session_id'];
  const paramsJson = JSON.stringify(params);
  const planId = crypto.randomUUID();
  const rows = sorted.map((r, i) => ({ plan_id: planId, run_no: i + 1, name: `${business}: ${r.name}`, tables: r.tables.join(','), params_json: paramsJson,
    session_id: null, run_id: null, status: 'waiting' }));
  await ensurePlanTable(deps, req, warehouseId, table);
  await appendRows(deps, req, warehouseId, table, rows);
  const first = await launch(deps, req, { name: rows[0].name, tables: sorted[0].tables, params, profileId: text(body.profile_id) });
  if (!first.ok) {
    await appendRows(deps, req, warehouseId, table, [{ ...rows[0], session_id: first.session_id, status: 'failed' }]);
    return { status: first.status, body: first.body || { error: 'The first run did not start.' } };
  }
  await appendRows(deps, req, warehouseId, table, [{ ...rows[0], session_id: first.session_id, run_id: first.run_id, status: 'running' }]);
  return { status: 200, body: { plan_id: planId, runs: rows.map((r, i) => (i === 0
    ? { run_no: 1, name: sorted[0].name, session_id: first.session_id, run_id: first.run_id, status: 'running' }
    : { run_no: r.run_no, name: sorted[i].name, session_id: null, run_id: null, status: 'waiting' })) } };
}

// ---- advance ---------------------------------------------------------------------------------------------------------------------

const atOf = (r) => { const t = Date.parse(r.event_at); return Number.isNaN(t) ? 0 : t; };

async function advance(deps, req) {
  const body = req.body || {};
  const warehouseId = text(body.warehouse_id);
  if (!warehouseId) throw fail(400, 'warehouse_id is required.');
  const table = planTable(body.inspire_database);
  let rows;
  try {
    rows = deps.sqlResultToObjects(await deps.executeSql(req.dbHost, req.dbToken, warehouseId,
      `SELECT plan_id, run_no, name, tables, params_json, session_id, run_id, status, event_at FROM ${table}`));
  } catch (err) {
    if (/TABLE_OR_VIEW_NOT_FOUND|does not exist/i.test(String(err && err.message))) return { started: [] };
    throw err;
  }
  const latest = new Map();
  rows.forEach((r, i) => {
    const key = `${r.plan_id}\u0000${Number(r.run_no)}`;
    const old = latest.get(key);
    if (!old || atOf(r) > atOf(old.row) || (atOf(r) === atOf(old.row) && i > old.i)) latest.set(key, { row: r, i });
  });
  const plans = new Map();
  for (const { row } of latest.values()) {
    if (!plans.has(row.plan_id)) plans.set(row.plan_id, []);
    plans.get(row.plan_id).push({ ...row, run_no: Number(row.run_no) });
  }
  const started = [];
  for (const [planId, list] of plans) {
    if (advancing.has(planId)) continue;
    advancing.add(planId);
    try {
      list.sort((a, b) => a.run_no - b.run_no);
      for (const run of list.filter((r) => r.status === 'running')) {
        const read = run.run_id ? await deps.readRun(req, run.run_id) : null;
        const state = read && read.ok && read.data && read.data.state ? read.data.state.life_cycle_state : '';
        if (!ENDED.has(state)) continue;
        await appendRows(deps, req, warehouseId, table, [{ ...run, status: 'done' }]);
        run.status = 'done';
      }
      if (list.some((r) => r.status === 'running')) continue;
      const next = list.find((r) => r.status === 'waiting');
      if (!next || !list.filter((r) => r.run_no < next.run_no).every((r) => r.status === 'done')) continue;
      let params = {};
      try { params = JSON.parse(next.params_json || '{}'); } catch { params = {}; }
      const tables = text(next.tables).split(',').map(text).filter(Boolean);
      const got = await launch(deps, req, { name: next.name, tables, params, profileId: '' });
      if (!got.ok) {
        await appendRows(deps, req, warehouseId, table, [{ ...next, session_id: got.session_id, status: 'failed' }]);
        continue;
      }
      await appendRows(deps, req, warehouseId, table, [{ ...next, session_id: got.session_id, run_id: got.run_id, status: 'running' }]);
      started.push({ plan_id: planId, run_no: next.run_no, name: next.name, session_id: got.session_id, run_id: got.run_id });
    } finally {
      advancing.delete(planId);
    }
  }
  return { started };
}

function registerWizPlanRoutes(app, deps) {
  const { requireToken } = deps;
  app.post('/api/inspire/plan/sort', requireToken, async (req, res) => {
    try { res.json(await sort(deps, req)); } catch (err) { sendFailure(res, err); }
  });
  app.post('/api/inspire/plan/start', requireToken, async (req, res) => {
    try { const out = await start(deps, req); res.status(out.status).json(out.body); } catch (err) { sendFailure(res, err); }
  });
  app.post('/api/inspire/plan/advance', requireToken, async (req, res) => {
    try { res.json(await advance(deps, req)); } catch (err) { sendFailure(res, err); }
  });
}

module.exports = { registerWizPlanRoutes };
