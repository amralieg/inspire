const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const I = require('./inspireImplement');
const { appShellPayload, bundledAppShellText } = require('./appShell');
const { pythonFor, runPythonJson } = require('./hostedRun');
const { forwardedTokenOf } = require('./requestPerson');
const ALERT_RULE_FILES = ['shell_alerts.py', 'shell_sql.py', 'shell_facts.py', 'shell_db.py', 'shell_redact.py'];
const ALERT_RULES_VERSION = 1;
const ALERT_RULES_SCRIPT = 'import sys; sys.path.insert(0, sys.argv[1]); import shell_alerts; sys.exit(shell_alerts.cli())';
const ALERT_RULES_TIMEOUT_MS = 30000;
const ALERT_RULES_MAX_BYTES = 8 * 1024 * 1024;
const ALERT_RULES_TMP = path.join(os.tmpdir(), 'inspire_alert_rules');
const ALERT_PYTHON_CHECK = 'import json, math, re, uuid, html.parser';
const ALERT_STEP_TEXT = { stopped: 'Inspire stopped planning the alert', step: 'the alert step', purpose: 'to plan the alert' };
const ALERT_LIST_CAP = 100;
const ALERTS_DIR = 'alerts';
const ALERT_SAVE_KEYS = ['id', 'name', 'watch', 'schedule', 'emails', 'paused', 'notify_on_ok'];
const ALERT_TEXT = {
  noSignIn: 'Inspire saves alerts as you, and this request carries no sign-in of yours. A workspace admin turns on user authorization for the Inspire App, then you open Inspire again.',
  noEmail: 'Inspire cannot tell who you are from this request, so it cannot record who set up the alert. Open Inspire from Databricks again.',
  noRules: 'This Inspire App carries an agent notebook that cannot plan alerts yet. Update the Inspire App to the latest version.',
  noPython: 'Inspire found no Python 3 to plan the alert with.',
  notBuilt: 'Nothing of this MVP is built yet, so it has no results to alert on. Build the MVP first.',
  noTable: 'This MVP names no result table, so it has nothing to alert on.',
  noWarehouse: `This MVP names no SQL warehouse, so an alert cannot run. Pick one in ${I.IMPLEMENT_ALL_SETTINGS}.`,
  noFolder: 'Inspire cannot tell which workspace folder keeps the files of this MVP, so it cannot keep alerts for it. Build the MVP again.',
  scope: 'Inspire saves alerts as you, and your sign-in to Inspire does not allow Databricks SQL. Ask a workspace admin to add the sql scope to the user authorization of the Inspire App, then open Inspire again.',
  off: 'Alerts are not turned on in this workspace, so Inspire cannot save the alert. A workspace admin turns on Databricks SQL alerts.',
};

function coded(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function str(value) {
  return value == null ? '' : String(value);
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function canRunRules(file) {
  return new Promise((resolve) => {
    childProcess.execFile(file, ['-c', ALERT_PYTHON_CHECK], { timeout: 30000, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }, (err) => resolve(!err));
  });
}

function bundledRuleFiles() {
  return appShellPayload(bundledAppShellText()).files;
}

function createAlertRules(options = {}) {
  const {
    files = bundledRuleFiles,
    pickPython = () => pythonFor(process.env.PATH, process.cwd(), canRunRules),
    spawn = childProcess.spawn,
    tmpRoot = ALERT_RULES_TMP,
    env = process.env,
    timeoutMs = ALERT_RULES_TIMEOUT_MS,
  } = options;
  let ready = null;

  async function prepare() {
    let shell;
    try {
      shell = files() || {};
    } catch (err) {
      throw coded(503, `${ALERT_TEXT.noRules} (${err.message})`);
    }
    const missing = ALERT_RULE_FILES.filter((name) => typeof shell[name] !== 'string');
    if (missing.length || !/^def cli\(/m.test(shell['shell_alerts.py'])) throw coded(503, ALERT_TEXT.noRules);
    const digest = crypto.createHash('sha256');
    for (const name of ALERT_RULE_FILES) digest.update(`${name}\0${shell[name]}\0`);
    const dir = path.join(tmpRoot, digest.digest('hex').slice(0, 16));
    if (!fs.existsSync(path.join(dir, '.ready'))) {
      const stage = `${dir}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.partial`;
      fs.mkdirSync(stage, { recursive: true });
      for (const name of ALERT_RULE_FILES) fs.writeFileSync(path.join(stage, name), shell[name]);
      fs.writeFileSync(path.join(stage, '.ready'), '');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(stage, dir);
    }
    const python = await pickPython();
    if (!python) throw coded(503, ALERT_TEXT.noPython);
    return { dir, python };
  }

  function call(python, dir, request) {
    return runPythonJson(spawn, python, {
      script: ALERT_RULES_SCRIPT, args: [dir], cwd: dir, env: { PATH: str(env.PATH), LANG: 'C.UTF-8' }, input: request, timeoutMs,
      maxBytes: ALERT_RULES_MAX_BYTES, text: ALERT_STEP_TEXT,
    });
  }

  async function run(op, args) {
    if (!ready) ready = prepare().catch((err) => { ready = null; throw err; });
    const { dir, python } = await ready;
    const answer = await call(python, dir, JSON.stringify({ v: ALERT_RULES_VERSION, op, args }));
    if (!isObject(answer) || answer.ok !== true) {
      throw coded(Number(answer && answer.status) || 500, str(answer && answer.error) || 'the alert step failed');
    }
    return answer.result;
  }

  return { run };
}

function personOf(req) {
  return { token: forwardedTokenOf(req), email: str(req && req.headers ? req.headers['x-forwarded-email'] : '').trim() };
}

function requirePerson(who) {
  if (!who.token) throw coded(401, ALERT_TEXT.noSignIn);
  if (!who.email) throw coded(401, ALERT_TEXT.noEmail);
}

function inspireLink(headers) {
  const host = str(headers['x-forwarded-host']).split(',')[0].trim();
  return /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(host) ? `https://${host}/` : '';
}

function mvpDir(row, hosted) {
  const notebook = /^(\/.+)\/v\d+\/[^/]+$/.exec(str(row && row.notebook_path).trim());
  if (notebook) return notebook[1];
  const page = hosted && /^(\/.+)\/apps\/[^/]+\/v\d+$/.exec(str(hosted.source));
  return page ? page[1] : '';
}

function alertBase(history, useCaseId) {
  const rows = [...(history || [])].sort((a, b) => (b.spec_version || 0) - (a.spec_version || 0));
  const live = I.previousBuilt(rows);
  if (!live) throw coded(409, ALERT_TEXT.notBuilt);
  const spec = isObject(live.spec_json) ? live.spec_json : {};
  const config = isObject(spec.config) ? spec.config : {};
  const outputs = isObject(spec.outputs) ? spec.outputs : {};
  const table = str(config.result_table).trim();
  if (!table) throw coded(409, ALERT_TEXT.noTable);
  const hosted = I.hostedRecord(live);
  const carried = I.carriedAssets(rows);
  const target = !hosted && carried.app ? I.implementSettingsTarget(rows, useCaseId) : null;
  const builtRow = carried.alert ? rows.find((r) => str(r.alert_id) === str(carried.alert)) || {} : {};
  const builtAsset = isObject(builtRow.asset_status) && isObject(builtRow.asset_status.alert) ? builtRow.asset_status.alert : {};
  const roles = isObject(spec.data) && isObject(spec.data.column_roles) ? spec.data.column_roles : {};
  const segment = str(roles.segment).split('.').pop().replace(/`/g, '');
  const urlOf = (column) => str((rows.find((r) => str(r[column]).trim()) || {})[column]).trim();
  return {
    useCaseId,
    table,
    title: str(spec.use_case_name).trim() || useCaseId,
    warehouse: str(outputs.app_warehouse_id).trim() || str(config.warehouse_id).trim(),
    hosted,
    app: target ? { name: str(carried.app), url: target.url, page: target.page } : null,
    built: carried.alert ? { id: str(carried.alert), url: str(builtRow.alert_url).trim(), name: str(outputs.alert_name).trim(),
      trigger: str(builtAsset.trigger).trim() } : null,
    segments: segment ? [segment] : [],
    links: { dashboard: urlOf('dashboard_url'), genie: urlOf('genie_space_url') },
    owners: I.implementOwners(live),
    mvp: mvpDir(live, hosted),
  };
}

function appAlertFolder(settings) {
  return isObject(settings) && isObject(settings.options) && settings.options.alerts === true && typeof settings.alert_folder === 'string'
    ? settings.alert_folder : '';
}

function answerText(got) {
  const data = isObject(got && got.data) ? got.data : {};
  return str(data.message || data.error || data.raw || `HTTP ${got ? got.status : 0}`).trim();
}

function folderOf(base, name) {
  if (!base.mvp) throw coded(409, ALERT_TEXT.noFolder);
  return `${base.mvp}/${ALERTS_DIR}/${name}`;
}

function unavailableListing(err) {
  return {
    on: false, reason: '', built: '', alerts: [], unread: 0, caps: null, schedules: [], operators: [], baseline_operators: [], operator_words: {},
    measures: [], admin: false, filters: [], built_alert: null, person: '', can_add: false, unavailable: true,
    why: str(err && err.message) || 'Inspire could not read the alerts of this use case.',
  };
}

function createUseCaseAlerts({ rules = createAlertRules(), listCap = ALERT_LIST_CAP } = {}) {
  async function readJson(io, file) {
    const got = await io.sp(`/api/2.0/workspace/export?path=${encodeURIComponent(file)}&direct_download=true`);
    if (!got.ok || !isObject(got.data) || Object.prototype.hasOwnProperty.call(got.data, 'raw')) {
      throw coded(502, `Inspire could not read ${file}, which says what the page shows: ${answerText(got)}`);
    }
    return got.data;
  }

  async function pageFrom(io, source, pageId) {
    const [settings, page] = await Promise.all([readJson(io, `${source}/inspire_app.json`), readJson(io, `${source}/pages/${pageId}.json`)]);
    return { settings, page };
  }

  async function schema(io, table, warehouse) {
    if (!io.sql) return { manifest: null, error: ALERT_TEXT.noSignIn };
    try {
      const out = await io.sql(warehouse || io.warehouse, `SELECT * FROM ${I.quoteTable(table)} LIMIT 0`, null);
      return { manifest: isObject(out && out.manifest) ? out.manifest : null, error: '' };
    } catch (err) {
      return { manifest: null, error: str(err.message) };
    }
  }

  async function resolve(history, useCaseId, io) {
    const base = alertBase(history, useCaseId);
    if (base.hosted) {
      const { settings, page } = await pageFrom(io, base.hosted.source, base.hosted.page);
      return { ...base, settings, page, source: 'inside', folder: appAlertFolder(settings) || folderOf(base, base.hosted.id), link: io.link };
    }
    if (base.app) {
      const got = await io.sp(`/api/2.0/apps/${encodeURIComponent(base.app.name)}`);
      const deployed = isObject(got.data) && isObject(got.data.active_deployment) ? got.data.active_deployment : {};
      const source = str(deployed.source_code_path || (isObject(got.data) ? got.data.default_source_code_path : '')).replace(/\/+$/, '');
      if (!got.ok || !source) throw coded(502, `Inspire could not read where the App ${base.app.name} keeps its pages: ${got.ok ? 'it has no deployment' : answerText(got)}`);
      const { settings, page } = await pageFrom(io, source, base.app.page);
      return { ...base, settings, page, source: 'app', folder: appAlertFolder(settings) || folderOf(base, base.app.page),
        link: base.app.url ? `${base.app.url}/#/${base.app.page}` : io.link };
    }
    const table = await schema(io, base.table, base.warehouse);
    if (!table.manifest) throw coded(table.error === ALERT_TEXT.noSignIn ? 401 : 409, table.error === ALERT_TEXT.noSignIn ? table.error : `Inspire could not read the result table ${base.table} as you: ${table.error}`);
    const useCase = io.useCase ? await io.useCase().catch((err) => {
      console.warn(`[alerts] ${useCaseId}: the alert steps go without the use case solution, which could not be read: ${err.message}`);
      return null;
    }) : null;
    const page = await rules.run('page', { table: base.table, manifest: table.manifest, page_id: I.implementAppPageId(useCaseId), title: base.title,
      segments: base.segments, use_case: useCase, dashboard: base.links.dashboard, genie: base.links.genie });
    return { ...base, settings: null, page, source: 'result', folder: folderOf(base, page.id), link: io.link, manifest: table.manifest };
  }

  async function stored(ctx, io) {
    const listed = await io.sp(`/api/2.0/workspace/list?path=${encodeURIComponent(ctx.folder)}`);
    if (!listed.ok) {
      const code = isObject(listed.data) ? str(listed.data.error_code) : '';
      if (listed.status === 404 || code === 'RESOURCE_DOES_NOT_EXIST') return { alerts: [], unread: 0 };
      throw coded(503, `Inspire cannot read the alerts folder ${ctx.folder}: ${answerText(listed)}`);
    }
    const objects = isObject(listed.data) && Array.isArray(listed.data.objects) ? listed.data.objects : [];
    const ids = objects.filter((o) => o && o.object_type === 'ALERT' && o.object_id).map((o) => str(o.object_id)).slice(0, listCap);
    const got = await Promise.all(ids.map((id) => io.sp(`/api/2.0/alerts/${encodeURIComponent(id)}`)
      .catch((err) => ({ ok: false, status: 0, data: { message: err.message } }))));
    return { alerts: got.filter((g) => g.ok && isObject(g.data)).map((g) => g.data), unread: got.filter((g) => !g.ok).length };
  }

  function isAdmin(ctx, email) {
    const who = str(email).trim().toLowerCase();
    return Boolean(who) && (ctx.owners.includes(who) || str(ctx.settings && ctx.settings.admin).trim().toLowerCase() === who);
  }

  async function names(ctx, io, wanted) {
    if (!wanted) return null;
    if (ctx.manifest) return ctx.manifest;
    return (await schema(io, ctx.page.result_table || ctx.table, ctx.warehouse)).manifest;
  }

  function requireWarehouse(ctx) {
    if (!ctx.warehouse) throw coded(409, ALERT_TEXT.noWarehouse);
  }

  function apiError(got, ctx, action) {
    const data = isObject(got.data) ? got.data : {};
    const text = answerText(got);
    const code = str(data.error_code);
    const user = /Failed to get user id for email:?\s*([^\s,;]+)/i.exec(text);
    if (user) return coded(400, `${user[1]} is not a user of this workspace; alerts go only to workspace users`);
    if (/required scope|oauth scope|scopes? (are|is) (missing|required)/i.test(text)) return coded(403, ALERT_TEXT.scope);
    if (code === 'FEATURE_DISABLED' || code === 'ENDPOINT_NOT_FOUND' || /not enabled|is disabled|not available in this workspace/i.test(text)) {
      return coded(409, ALERT_TEXT.off);
    }
    if (/warehouse/i.test(text) && [400, 403, 404].includes(got.status)) {
      return coded(409, `Databricks did not ${action} because of the SQL warehouse ${ctx.warehouse}: ${text}. You need Can Use on it, and it must still exist.`);
    }
    if (got.status === 403 || code === 'PERMISSION_DENIED') {
      return coded(403, `Databricks did not let you ${action}: ${text}. Ask the owner of the MVP or a workspace admin for Can Edit on the alerts folder ${ctx.folder}, or for Can Manage on the alert.`);
    }
    if (got.status === 404) return coded(404, `Databricks has no such alert any more: ${text}. Refresh the list.`);
    return coded(got.status >= 400 && got.status < 500 ? got.status : 502, `Databricks did not ${action}: ${text}`);
  }

  function sqlError(err, ctx) {
    const text = str(err && err.message);
    if (/required scope|oauth scope/i.test(text)) return coded(403, ALERT_TEXT.scope);
    if (/SQL failed \((403|404)\)/.test(text) || /warehouse/i.test(text)) {
      return coded(409, `Inspire could not check the value on the SQL warehouse ${ctx.warehouse} as you: ${text}. You need Can Use on it.`);
    }
    if (/PERMISSION_DENIED|INSUFFICIENT_PERMISSIONS|privilege/i.test(text)) return coded(403, `You cannot read ${ctx.page.result_table || ctx.table}: ${text}`);
    return coded(502, `The check of the current value failed: ${text}`);
  }

  async function person(io, ctx, planned, action) {
    const query = planned.params && Object.keys(planned.params).length ? `?${new URLSearchParams(planned.params)}` : '';
    const got = await io.person(`${planned.path}${query}`, { method: planned.method, ...(planned.body ? { body: JSON.stringify(planned.body) } : {}) });
    if (!got.ok) throw apiError(got, ctx, action);
    return got.data;
  }

  async function saved(ctx, io, who, alert, meta) {
    return rules.run('saved', { alert, meta, person: who.email, admin: isAdmin(ctx, who.email), host: io.host, page: ctx.page });
  }

  async function builtAlert(ctx, io) {
    if (!ctx.built) return null;
    const got = await io.sp(`/api/2.0/alerts/${encodeURIComponent(ctx.built.id)}`).catch((err) => ({ ok: false, status: 0, data: { message: err.message } }));
    const alert = got.ok && isObject(got.data) ? got.data : {};
    const evaluation = isObject(alert.evaluation) ? alert.evaluation : {};
    const paused = str(isObject(alert.schedule) ? alert.schedule.pause_status : '').toUpperCase() === 'PAUSED';
    return {
      ...ctx.built,
      name: str(alert.display_name).trim() || ctx.built.name || ctx.built.id,
      url: ctx.built.url || (io.host ? `${io.host}/sql/alerts-v2/${ctx.built.id}` : ''),
      state: got.ok ? (paused ? 'paused' : str(evaluation.state).toLowerCase() || 'unknown') : 'unread',
      checked: evaluation.last_evaluated_at || null,
      notify_on_ok: got.ok ? (isObject(evaluation.notification) ? evaluation.notification : {}).notify_on_ok === true : null,
      error: got.ok ? '' : answerText(got),
    };
  }

  async function listing(history, useCaseId, io, who) {
    const ctx = await resolve(history, useCaseId, io);
    const [folder, table, built] = await Promise.all([stored(ctx, io), ctx.manifest ? { manifest: ctx.manifest, error: '' }
      : schema(io, ctx.page.result_table || ctx.table, ctx.warehouse), builtAlert(ctx, io)]);
    const out = await rules.run('listing', { page: ctx.page, alerts: folder.alerts, person: who.email, admin: isAdmin(ctx, who.email), host: io.host,
      built: built ? built.url : '', unread: folder.unread, manifest: table.manifest, unreadable: table.error });
    const filters = await Promise.all((out.filters || []).map(async (f) => {
      if (!io.sql) return { id: f.id, label: f.label, options: [], error: ALERT_TEXT.noSignIn };
      try {
        const got = await io.sql(ctx.warehouse || io.warehouse, f.sql, Array.isArray(f.params) && f.params.length ? f.params : null);
        const rows = (got && got.result && Array.isArray(got.result.data_array)) ? got.result.data_array : [];
        return { id: f.id, label: f.label, options: rows.map((row) => row[0]).filter((v) => v != null).map(String), error: '' };
      } catch (err) {
        return { id: f.id, label: f.label, options: [], error: str(err.message) };
      }
    }));
    const why = who.token ? (who.email ? '' : ALERT_TEXT.noEmail) : ALERT_TEXT.noSignIn;
    return {
      ...out.listing, filters, built_alert: built, person: who.email, can_add: !why && Boolean(ctx.warehouse), why: why || (ctx.warehouse ? '' : ALERT_TEXT.noWarehouse),
      page: { id: ctx.page.id, title: str(ctx.page.title) }, source: ctx.source, folder: ctx.folder,
    };
  }

  async function preview(history, useCaseId, io, who, body) {
    requirePerson(who);
    const ctx = await resolve(history, useCaseId, io);
    requireWarehouse(ctx);
    const watch = isObject(body) ? body.watch : null;
    const planned = await rules.run('query', { page: ctx.page, watch, manifest: await names(ctx, io, isObject(watch) && watch.basis === 'baseline') });
    let result;
    try {
      result = await io.sql(ctx.warehouse, planned.query.query, null);
    } catch (err) {
      throw sqlError(err, ctx);
    }
    return rules.run('preview', { watch: planned.watch, result });
  }

  async function save(history, useCaseId, io, who, body) {
    requirePerson(who);
    const ctx = await resolve(history, useCaseId, io);
    requireWarehouse(ctx);
    const sent = isObject(body) ? body : {};
    const data = Object.fromEntries(ALERT_SAVE_KEYS.filter((key) => sent[key] !== undefined).map((key) => [key, sent[key]]));
    const [folder, manifest] = await Promise.all([stored(ctx, io), names(ctx, io, isObject(data.watch) && data.watch.basis === 'baseline')]);
    const planned = await rules.run('save', { page: ctx.page, data, person: who.email, admin: isAdmin(ctx, who.email), alerts: folder.alerts,
      warehouse: ctx.warehouse, link: ctx.link, manifest, folder: ctx.folder, name_from_rule: true });
    if (planned.method === 'POST') {
      const made = await io.sp('/api/2.0/workspace/mkdirs', { method: 'POST', body: JSON.stringify({ path: ctx.folder }) });
      if (!made.ok) throw coded(503, `Inspire could not make the alerts folder ${ctx.folder}: ${answerText(made)}`);
    }
    const alert = await person(io, ctx, planned, planned.method === 'POST' ? 'create the alert' : 'save the alert');
    return { alert: await saved(ctx, io, who, alert, planned.meta) };
  }

  async function pause(history, useCaseId, io, who, body) {
    requirePerson(who);
    const ctx = await resolve(history, useCaseId, io);
    const folder = await stored(ctx, io);
    const sent = isObject(body) ? body : {};
    const planned = await rules.run('pause', { alerts: folder.alerts, id: sent.id, paused: sent.paused, person: who.email, admin: isAdmin(ctx, who.email) });
    const alert = await person(io, ctx, planned, sent.paused ? 'pause the alert' : 'resume the alert');
    return { alert: await saved(ctx, io, who, alert, planned.meta) };
  }

  async function remove(history, useCaseId, io, who, body) {
    requirePerson(who);
    const ctx = await resolve(history, useCaseId, io);
    const folder = await stored(ctx, io);
    const sent = isObject(body) ? body : {};
    const planned = await rules.run('delete', { alerts: folder.alerts, id: sent.id, person: who.email, admin: isAdmin(ctx, who.email) });
    await person(io, ctx, planned, 'delete the alert');
    return { deleted: planned.id };
  }

  return { listing, preview, save, pause, delete: remove };
}

module.exports = {
  ALERT_RULE_FILES,
  ALERT_RULES_SCRIPT,
  ALERT_TEXT,
  ALERTS_DIR,
  alertBase,
  appAlertFolder,
  createAlertRules,
  createUseCaseAlerts,
  inspireLink,
  mvpDir,
  personOf,
  requirePerson,
  unavailableListing,
};
