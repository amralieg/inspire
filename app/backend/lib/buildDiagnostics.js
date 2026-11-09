const { maskPrivate, nameLabels } = require('./redact');
const { parseExactJson } = require('./exactJson');
const { mvpFailureOf, mvpStages, MVP_REPAIR_PHASE } = require('../../frontend/src/lib/mvpProgress.js');
const { statusWarnings } = require('../../frontend/src/lib/implementControl.js');
const { splitTechnical } = require('../../frontend/src/lib/plainText.js');
const STEP_LIMIT = 200;
const FEED_NOTE_LIMIT = 60;
const HISTORY_LIMIT = 10;
const ISSUE_ERROR_LIMIT = 600;
const STEP_FIELDS = ['phase', 'round', 'rounds', 'attempt', 'attempts', 'repair', 'terminal', 'failure', 'spec_version', 'status', 'error_code', 'error_class', 'code', 'sqlstate'];
const STEP_TEXT_FIELDS = ['error', 'reason', 'why'];
const COLUMN_KEY = /(?:^|_)(?:column|columns|col|cols|field|fields|measure|dimension|dimensions|group_by|order_by|partition_by)$/i;
const TABLE_KEY = /(?:^|_)(?:table|tables|view|views|source|sources|result_table)$/i;
const VALUE_KEY = /^(?:value|values|samples?|sample_values|examples?|top_values|distinct_values|min|max|target|targets|default|defaults)$/i;
const NAME_MAP_KEY = /^(?:tables|columns|swaps|profiles|data_profiles)$/i;
const IDENT = /^[A-Za-z_][A-Za-z0-9_$-]*$/;
const TABLE_NAME = /^`?[^`.\s]+`?\.`?[^`.\s]+`?\.`?[^`.\s]+`?$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*$/;
const CLOUDS = [[/\.(?:azure)?databricks\.net$/i, 'Azure'], [/\.gcp\.databricks\.com$/i, 'GCP'], [/\.(?:cloud\.)?databricks\.com$/i, 'AWS']];

const str = (v) => (v == null ? '' : String(v));
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function cloudOf(host) {
  let name = str(host).trim();
  try { name = new URL(/^[a-z]+:\/\//i.test(name) ? name : `https://${name}`).hostname; } catch { return 'unknown'; }
  const hit = CLOUDS.find(([re]) => re.test(name));
  return hit ? hit[1] : 'unknown';
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return value;
  try { return parseExactJson(t); } catch { return value; }
}

function harvestNames(status, ctx) {
  const business = str(ctx.business).trim();
  const known = { catalog: [ctx.catalog], schema: [ctx.schema], table: [], column: [], business: [business, business.replace(/[^A-Za-z0-9._-]+/g, '_')], app: [], value: [] };
  const addTable = (name) => {
    const parts = str(name).replace(/`/g, '').split('.');
    if (parts.length === 3) {
      known.catalog.push(parts[0]);
      known.schema.push(parts[1]);
      known.table.push(parts[2]);
    } else if (parts.length === 1 && IDENT.test(parts[0])) known.table.push(parts[0]);
  };
  const addColumn = (name) => { if (IDENT.test(str(name))) known.column.push(str(name)); };
  const walk = (value, key, depth) => {
    if (depth > 12 || value == null) return;
    const v = parsed(value);
    if (VALUE_KEY.test(key) && (typeof v === 'string' || typeof v === 'number')) {
      if (str(v).trim()) known.value.push(str(v).trim());
      return;
    }
    if (typeof v === 'string') {
      if (TABLE_NAME.test(v.trim())) addTable(v.trim());
      else if (COLUMN_KEY.test(key)) addColumn(v.trim());
      else if (TABLE_KEY.test(key)) addTable(v.trim());
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, key, depth + 1));
      return;
    }
    if (!isMap(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (TABLE_NAME.test(k)) addTable(k);
      else if (NAME_MAP_KEY.test(key) && IDENT.test(k)) (COLUMN_KEY.test(key) ? addColumn : addTable)(k);
      walk(x, k, depth + 1);
    }
  };
  for (const row of status.history || []) {
    walk(row.spec_json, 'spec_json', 0);
    walk(row.data_profiles, 'data_profiles', 0);
    walk(row.genie_widgets, 'genie_widgets', 0);
    walk(row.asset_status, 'asset_status', 0);
    if (row.app_name) known.app.push(str(row.app_name));
  }
  if (status.app_status && status.app_status.name) known.app.push(str(status.app_status.name));
  return known;
}

function timeOf(value) {
  const at = Date.parse(str(value));
  return Number.isFinite(at) ? at : null;
}

function lastMoment(status) {
  const times = [
    ...(status.steps || []).map((s) => timeOf(s.last_updated)),
    ...(status.feed || []).map((f) => timeOf(f.until || f.at)),
    timeOf(status.latest && status.latest.updated_at),
    timeOf(status.latest && status.latest.created_at),
  ].filter((t) => t !== null);
  return times.length ? Math.max(...times) : 0;
}

function payloadOf(row) {
  const p = parsed(row && row.result_json);
  return isMap(p) ? p : {};
}

function failingStage(stages) {
  return stages.find((s) => s.state === 'error')
    || stages.find((s) => s.state === 'running' || s.state === 'next')
    || [...stages].reverse().find((s) => !['waiting', 'skipped', 'not_reached'].includes(s.state))
    || null;
}

function plainError(status, stage) {
  const latest = status.latest || {};
  const raw = (stage && stage.state === 'error' && stage.message)
    || (status.stalled && status.stalled.reason)
    || (latest.status === 'failed' ? latest.status_message : '')
    || '';
  const { plain, details } = splitTechnical(raw);
  return { plain, codes: [...new Set(details.filter((d) => ERROR_CODE.test(d)))] };
}

function buildDiagnostics(status, ctx = {}) {
  const label = nameLabels();
  const known = harvestNames(status, ctx);
  const mask = (text) => maskPrivate(str(text).replace(/\s+/g, ' ').trim(), { label, known, hosts: [ctx.host] });
  const latest = status.latest || null;
  const stamp = ctx.stamp || {};
  const now = lastMoment(status);
  const stages = latest ? mvpStages(status.steps || [], latest, { now, stalled: status.stalled || null }) : [];
  const failure = latest ? mvpFailureOf(status.steps || [], latest) : null;
  const stage = failingStage(stages);
  const shownError = plainError(status, stage);
  const error = mask(shownError.plain);
  const codes = shownError.codes.join(', ');
  const version = str(stamp.version) || 'unknown';
  const lines = [];
  const add = (...items) => lines.push(...items);
  const section = (title) => add('', title);

  add('Inspire build diagnostics');
  add(`App and agent version: ${version}`);
  add(`App build: ${str(stamp.shell).slice(0, 16) || 'unknown'}`);
  add(`Cloud: ${cloudOf(ctx.host)}`);
  add(`Use case: ${mask(ctx.useCaseId) || 'unknown'}`);
  if (!latest) add('Build: Inspire has no build of this use case yet.');
  if (latest) {
    add(`Build version: v${str(latest.spec_version)}${latest.based_on_version != null && latest.based_on_version !== '' ? ` (based on v${str(latest.based_on_version)})` : ''}`);
    add(`Build status: ${mask(latest.status) || 'unknown'}`);
    if (latest.change_classes) add(`Change: ${mask(latest.change_classes)}`);
    add(`Created: ${str(latest.created_at) || 'unknown'}`);
    add(`Updated: ${str(latest.updated_at) || 'unknown'}`);
    add(`Job id: ${str(latest.job_id) || 'none'}`);
    add(`Build run id: ${str(latest.implement_run_id) || 'none'}`);
    add(`Preview run id: ${str(latest.last_preview_run_id) || 'none'}`);
    if (latest.result_rows != null && latest.result_rows !== '') add(`Result rows: ${str(latest.result_rows)}`);
    if (latest.status_message) add(`Status message: ${mask(latest.status_message)}`);
  }
  if (status.stalled) {
    add(`Stalled: ${status.stalled.ended ? 'the build run ended' : 'no update for a while'}${status.stalled.run_id ? `, run id ${str(status.stalled.run_id)}` : ''}`);
    if (status.stalled.reason) add(`Stalled reason: ${mask(status.stalled.reason)}`);
  }
  if (error) add(`Error: ${error}`);
  if (codes) add(`Error code: ${codes}`);

  section(`Stages (${stages.length})`);
  if (!stages.length) add('- none recorded');
  for (const s of stages) {
    const rounds = s.round ? `, round ${s.round}${s.rounds ? ` of ${s.rounds}` : ''}` : '';
    add(`- ${mask(s.label)}: ${s.state}${s.elapsed ? `, ${s.elapsed}` : ''}${rounds}${s.message ? `: ${mask(s.message)}` : ''}`);
  }

  const steps = status.steps || [];
  const shownSteps = steps.slice(-STEP_LIMIT);
  section(`Steps (${steps.length}${steps.length > shownSteps.length ? `, last ${shownSteps.length} shown` : ''})`);
  if (!steps.length) add('- none recorded');
  for (const row of shownSteps) {
    const payload = payloadOf(row);
    const facts = STEP_FIELDS.filter((k) => payload[k] != null && payload[k] !== '' && !isMap(payload[k]) && !Array.isArray(payload[k]))
      .map((k) => `${k} ${mask(payload[k])}`);
    const texts = STEP_TEXT_FIELDS.filter((k) => typeof payload[k] === 'string' && payload[k].trim()).map((k) => `${k}: ${mask(payload[k])}`);
    const head = [str(row.last_updated), mask(row.step_name), mask(row.sub_step_name), mask(row.status)].filter(Boolean).join(' | ');
    add(`- ${head}${facts.length ? ` | ${facts.join(', ')}` : ''}`);
    if (row.message) add(`  message: ${mask(row.message)}`);
    for (const t of texts) add(`  ${t}`);
  }

  if (failure && failure.rounds.length) {
    section(`${MVP_REPAIR_PHASE} rounds (${failure.rounds.length}${failure.terminal ? ', stopped' : ''})`);
    for (const r of failure.rounds) {
      add(`- attempt ${r.attempt}: ${mask(r.repair)}${r.error ? `; error: ${mask(r.error)}` : ''}${r.why ? `; why: ${mask(r.why)}` : ''}`);
    }
  }

  const warnings = statusWarnings(latest);
  section(`Warnings (${warnings.length})`);
  if (!warnings.length) add('- none');
  for (const w of warnings) add(`- ${mask(w)}`);

  const assets = latest ? parsed(latest.asset_status) : null;
  if (isMap(assets) && Object.keys(assets).length) {
    section(`Parts (${Object.keys(assets).length})`);
    const partNo = {};
    for (const [key, raw] of Object.entries(assets)) {
      const a = isMap(raw) ? raw : {};
      const kind = key.includes(':') ? key.split(':')[0] : key;
      partNo[kind] = (partNo[kind] || 0) + (key.includes(':') ? 1 : 0);
      const name = key.includes(':') ? `${mask(kind)} part ${partNo[kind]}` : mask(key);
      const checks = Array.isArray(a.vibes_checks) ? a.vibes_checks : [];
      const missing = checks.filter((c) => isMap(c) && c.status !== 'done').length;
      const facts = [a.state ? mask(a.state) : '', a.spec_version != null ? `v${str(a.spec_version)}` : '', checks.length ? `${checks.length - missing} of ${checks.length} vibe checks done` : ''].filter(Boolean);
      add(`- ${name}: ${facts.join(', ') || 'no state'}${a.reason ? `: ${mask(a.reason)}` : ''}`);
    }
  }

  const runs = status.runs || null;
  section(`Job runs (${runs && Array.isArray(runs.runs) ? runs.runs.length : 0})`);
  if (runs && !runs.ok) add(`- Inspire could not list the runs: ${mask(runs.error)}`);
  if (!runs) add('- none');
  for (const r of (runs && runs.runs) || []) {
    const facts = [r.state ? mask(r.state) : '', r.started ? `started ${str(r.started)}` : '', r.duration_s ? `${str(r.duration_s)}s` : '', r.trigger ? `trigger ${mask(r.trigger)}` : '', r.profile ? `profile ${mask(r.profile)}` : ''].filter(Boolean);
    add(`- run ${str(r.run_id)}: ${facts.join(', ')}${r.message ? `: ${mask(r.message)}` : ''}`);
  }

  const app = status.app_status;
  if (app) {
    section('App');
    if (!app.ok) add(`- ${mask(app.error)}`);
    else {
      add(`- state ${mask(app.app_state) || 'unknown'}, compute ${mask(app.compute_state) || 'unknown'}, deployment ${mask(app.deployment_state) || 'unknown'}${app.deployed_at ? `, deployed ${str(app.deployed_at)}` : ''}`);
      if (app.app_message) add(`  app message: ${mask(app.app_message)}`);
      if (app.deployment_message) add(`  deployment message: ${mask(app.deployment_message)}`);
    }
  }

  const feed = status.feed || [];
  const said = feed.filter((f) => f.kind === 'message' || (f.text && !['error', 'note'].includes(f.kind)));
  const activity = feed.filter((f) => f.kind === 'activity');
  const turns = feed.filter((f) => f.kind === 'turn_done').length;
  const feedRuns = feed.filter((f) => f.kind === 'run');
  const feedErrors = feed.filter((f) => f.kind === 'error');
  const notes = feed.filter((f) => f.kind === 'note');
  section(`Genie and relay rounds (${feed.length} entries)`);
  add(`- Genie turns completed: ${turns}`);
  add(`- Genie messages: ${said.length} (their text is left out)`);
  add(`- Genie commands: ${activity.reduce((n, f) => n + (Number(f.commands) || 0), 0)}, failed: ${activity.reduce((n, f) => n + (Number(f.failed) || 0), 0)}, files edited: ${new Set(activity.flatMap((f) => f.files || [])).size}`);
  for (const r of feedRuns) add(`- ${str(r.at)} run ${str(r.run_id)}${r.check ? ' (alert check)' : ''}: ${mask(r.state)}${r.result ? ` / ${mask(r.result)}` : ''} after ${str(r.seconds)}s`);
  for (const f of feedErrors) add(`- ${str(f.at)} Genie error${f.phase ? ` in ${mask(f.phase)}` : ''}: ${mask(f.text)}`);
  const shownNotes = notes.slice(-FEED_NOTE_LIMIT);
  if (notes.length > shownNotes.length) add(`- ${notes.length - shownNotes.length} earlier relay notes left out`);
  for (const f of shownNotes) add(`- ${str(f.at)} relay: ${mask(f.text)}`);

  const earlier = (status.history || []).slice(1, 1 + HISTORY_LIMIT);
  if (earlier.length) {
    section(`Earlier versions (${(status.history || []).length - 1})`);
    for (const row of earlier) {
      add(`- v${str(row.spec_version)}: ${mask(row.status) || 'unknown'}, updated ${str(row.updated_at) || 'unknown'}${row.status_message ? `: ${mask(row.status_message)}` : ''}`);
    }
  }

  const text = `${lines.join('\n')}\n`;
  const where = stage ? `${mask(stage.label)} (${stage.state})` : 'not started';
  const title = `Build ${latest ? mask(latest.status) || 'issue' : 'issue'} at ${stage ? mask(stage.label) : 'start'} in Inspire ${version}`;
  const body = [
    `Inspire version: ${version}`,
    `Cloud: ${cloudOf(ctx.host)}`,
    `Build step: ${where}`,
    `Error: ${error.slice(0, ISSUE_ERROR_LIMIT) || 'none shown'}`,
    ...(codes ? [`Error code: ${codes}`] : []),
    '',
    'What I did before it happened:',
    '',
  ].join('\n');
  const id = str(ctx.useCaseId).replace(/[^A-Za-z0-9_-]+/g, '_') || 'build';
  return {
    text,
    filename: `inspire-diagnostics-${id}${latest ? `-v${str(latest.spec_version)}` : ''}.txt`,
    issue: { title, body },
  };
}

module.exports = { buildDiagnostics, cloudOf, harvestNames };
