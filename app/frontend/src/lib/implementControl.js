import {
  BUILT_ASSET_STATES, GENIE_FOR_APP_NOTE, IMPLEMENT_DONE_STATUSES, IMPLEMENT_OUTPUTS, IMPLEMENT_UNINSTALLED, IMPLEMENT_VIBE_NOT_MET, assetLabel, builtVersion, heldAsks,
  holderNames, holdersText, holdoutText, joinWords, partAsks, partLabel, partOf, rebuildableOutputs, statusChip, versionActive, vibesKey, VIBE_NOT_MET_FIRST,
  APP_INSIDE_PLACEMENT, VIBE_FEATURES_LABEL, insideInspire, mvpFilterMatches, nextSpecFrom, openVibeAsks, withCollectedVibes,
} from './implementWizard.js';
import { formatWhen } from './formatWhen.js';
import { plural } from './plural.js';
import { assetNotes, planActionText, planActions, rephrasableAsks } from './mvpProgress.js';
import { rowImpact, stakeLabel, stakeWords } from './targetKpi.js';

export const CONTROL_REFRESH_MS = 15000;

export const ASSET_TILES = [
  { id: 'app', label: 'App' }, { id: 'dashboard', label: 'Dashboard' }, { id: 'genie_space', label: 'Genie Agent' },
  { id: 'alert', label: 'Alerts' }, { id: 'notebook', label: 'Notebook' }, { id: 'job', label: 'Job' },
];

const APP_STATES = {
  ACTIVE: { label: 'Running', tone: 'success', actions: [['stop', 'Stop the App']] },
  STOPPED: { label: 'Stopped', tone: 'idle', actions: [['start', 'Start the App']] },
  ERROR: { label: 'Compute failed', tone: 'error', actions: [['start', 'Start the App']] },
  STARTING: { label: 'Starting', tone: 'busy', actions: [] },
  STOPPING: { label: 'Stopping', tone: 'busy', actions: [] },
  UPDATING: { label: 'Updating', tone: 'busy', actions: [] },
  DELETING: { label: 'Deleting', tone: 'busy', actions: [] },
};

const action = (asset, name, label, danger = false) => ({ asset, action: name, label, danger });

function unreadable(entry) {
  return { state: { label: 'Cannot read', tone: 'error' }, detail: entry?.error || 'Inspire has not read it yet', actions: [] };
}

export const INSIDE_ROW_DETAIL = 'Inspire runs this App page in its Run tab, only for testing; give it its own App for real use';

function insideRow(entry) {
  if (!entry?.ok) return { ...unreadable(entry), run: null };
  return {
    state: { label: APP_INSIDE_PLACEMENT.label, tone: 'success' },
    detail: `v${entry.version} is live. ${INSIDE_ROW_DETAIL}`,
    run: { id: entry.id, page: entry.page },
    actions: [],
  };
}

function appRow(entry) {
  if (!entry?.ok) return unreadable(entry);
  const known = APP_STATES[entry.compute_state] || { label: entry.compute_state || 'Unknown', tone: 'warning', actions: [] };
  const actions = known.actions.map(([name, label]) => action('app', name, label, name === 'stop'));
  if (entry.compute_state === 'ACTIVE' && entry.app_state && entry.app_state !== 'RUNNING') {
    return { state: { label: `App ${entry.app_state.toLowerCase()}`, tone: 'error' }, detail: entry.app_message || 'The compute is on but the App is not running', actions };
  }
  const quiet = entry.compute_state === 'ACTIVE' && entry.app_state === 'RUNNING';
  return { state: { label: known.label, tone: known.tone }, detail: quiet ? '' : entry.app_message || '', actions };
}

function dashboardRow(entry) {
  if (!entry?.ok) return unreadable(entry);
  if (entry.trashed) return { state: { label: 'In the trash', tone: 'error' }, detail: '', actions: [] };
  const when = entry.published_at ? `Published ${formatWhen(entry.published_at, entry.published_at)}` : 'Published';
  if (entry.published && entry.embedded) {
    return {
      state: { label: 'Shares its publisher’s access', tone: 'warning' },
      detail: `${when} with the publisher’s credentials, so anyone who can open it reads the data as the publisher. Publish again so each viewer reads it with their own access`,
      actions: [action('dashboard', 'publish', 'Publish again'), action('dashboard', 'unpublish', 'Unpublish', true)],
    };
  }
  return entry.published
    ? { state: { label: 'Published', tone: 'success' }, detail: entry.published_at ? when : '', actions: [action('dashboard', 'unpublish', 'Unpublish', true)] }
    : { state: { label: 'Not published', tone: 'idle' }, detail: 'People with access cannot open the published view', actions: [action('dashboard', 'publish', 'Publish')] };
}

function genieRow(entry) {
  return entry?.ok ? { state: { label: 'Live', tone: 'success' }, detail: '', actions: [] } : unreadable(entry);
}

function alertRow(entry) {
  if (!entry?.ok) return unreadable(entry);
  if (entry.trashed) return { state: { label: 'In the trash', tone: 'error' }, detail: '', actions: [] };
  const when = entry.checked_at ? ` (checked ${formatWhen(entry.checked_at, entry.checked_at)})` : '';
  if (entry.state === 'TRIGGERED') return { state: { label: 'Triggered', tone: 'warning' }, detail: `The latest check found rows to act on${when}`, actions: [] };
  if (entry.state === 'OK') return { state: { label: 'OK', tone: 'success' }, detail: `The latest check found nothing to act on${when}`, actions: [] };
  if (entry.state === 'ERROR') return { state: { label: 'Check failed', tone: 'error' }, detail: `The alert query failed on its latest check${when}; open the alert to see why`, actions: [] };
  if (entry.state && entry.state !== 'UNKNOWN') return { state: { label: entry.state, tone: 'warning' }, detail: when.trim(), actions: [] };
  return { state: { label: 'Not checked yet', tone: 'idle' }, detail: 'It checks after each run of the job', actions: [] };
}

const OUTPUT_ROWS = { dashboard: dashboardRow, genie_space: genieRow, app: appRow, alert: alertRow };
const OUTPUT_URLS = { dashboard: 'dashboard_url', genie_space: 'genie_space_url', app: 'app_url', alert: 'alert_url' };
const OUTPUT_IDS = { dashboard: 'dashboard_id', genie_space: 'genie_space_id', app: 'app_name', alert: 'alert_id' };
const OUTPUT_NAMES = { dashboard: (a) => a?.name, genie_space: (a) => a?.title, app: (a) => a?.name, alert: (a) => a?.name };

function jobRow(entry, spec) {
  const scheduled = Boolean(spec?.schedule?.enabled);
  const schedule = { label: scheduled ? 'Pause the schedule' : 'Resume the schedule', on: scheduled };
  const withHoldout = (detail) => [detail, holdoutText(spec)].filter(Boolean).join('. ');
  if (!entry?.ok) {
    const row = unreadable(entry);
    return { ...row, detail: withHoldout(row.detail), schedule };
  }
  const plan = withHoldout(entry.schedule
    ? `${entry.schedule.paused ? 'Schedule paused' : 'Scheduled'}: ${entry.schedule.cron} (${entry.schedule.timezone})`
    : 'No schedule');
  const runs = entry.active_runs;
  if (runs == null) {
    return { state: { label: 'Runs unknown', tone: 'error' }, detail: `${plan}. Inspire cannot read its runs: ${entry.runs_error || 'no answer'}`, actions: [], schedule };
  }
  if (!runs.length) return { state: { label: 'Idle', tone: 'idle' }, detail: plan, actions: [], schedule };
  return {
    state: { label: `${runs.length} running`, tone: 'busy' }, detail: plan, schedule, url: runs[0].url || '',
    actions: [action('job', 'cancel', 'Stop the running job', true)],
  };
}

function builtWarnings(latest, id) {
  const warnings = latest?.asset_status?.[id]?.warnings;
  return Array.isArray(warnings) ? warnings.map((w) => String(w ?? '').trim()).filter(Boolean) : [];
}

export const APP_BACKEND_FACTS = {
  lakebase: 'Reads Lakebase: pages load instantly',
  delta: 'Reads Delta tables: pages take a few seconds to load',
};

export function appBackendFacts(latest) {
  const asset = latest?.asset_status?.app || {};
  const built = asset.backend == null && BUILT_ASSET_STATES.includes(asset.state) ? 'delta' : asset.backend;
  if (!Object.prototype.hasOwnProperty.call(APP_BACKEND_FACTS, built)) return { backend: '', lakebaseSwitch: false };
  const outputs = latest?.spec_json?.outputs || {};
  const wanted = outputs.app_backend === 'lakebase' && outputs.app_access === 'sp' && !outputs.merge?.app;
  return { backend: APP_BACKEND_FACTS[built], lakebaseSwitch: built === 'delta' && wanted };
}

export function controlRows(live, latest) {
  const assets = live?.assets || {};
  const targets = live?.targets || {};
  const spec = latest?.spec_json || {};
  const rows = [];
  if (targets.build) {
    rows.push({ id: 'build', label: 'Build', name: `spec v${latest?.spec_version ?? ''}`, removable: false,
      state: { label: 'Building', tone: 'busy' }, detail: latest?.status || '', actions: [action('build', 'cancel', 'Stop the build', true)] });
  }
  if (targets.job) rows.push({ id: 'job', label: 'Job', name: `job ${targets.job}`, removable: false, ...jobRow(assets.job, spec) });
  for (const output of IMPLEMENT_OUTPUTS) {
    if (output.id === 'app' && !targets.app && targets.inside) {
      rows.push({ id: 'app', label: output.label, name: APP_INSIDE_PLACEMENT.label, url: '', removable: false, warnings: builtWarnings(latest, 'app'),
        notes: assetNotes(latest, 'app'), ...insideRow(assets.inside) });
      continue;
    }
    if (!targets[output.id]) continue;
    const entry = assets[output.id];
    rows.push({
      id: output.id,
      label: output.label,
      name: OUTPUT_NAMES[output.id](entry) || String(targets[output.id]),
      url: latest?.[OUTPUT_URLS[output.id]] || entry?.url || '',
      removable: true,
      warnings: builtWarnings(latest, output.id),
      notes: assetNotes(latest, output.id),
      ...(output.id === 'app' ? appBackendFacts(latest) : {}),
      ...OUTPUT_ROWS[output.id](entry),
    });
  }
  return rows;
}

const DELIVERED_WORDS = { dashboard: ['dashboard', 'dashboards'], genie_space: ['Genie Agent', 'Genie Agents'], app: ['App', 'Apps'], alert: ['alert', 'alerts'] };

export function deliveredOutputs(latest) {
  return IMPLEMENT_OUTPUTS.filter((output) => latest?.[OUTPUT_URLS[output.id]]).map((output) => output.id);
}

export function buildSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const mvps = list.filter((item) => item.state?.kind === 'mvp');
  const inGroup = (group) => mvps.filter((item) => item.state.group === group);
  const delivered = IMPLEMENT_OUTPUTS
    .map((output) => {
      const count = mvps.filter((item) => deliveredOutputs(item.latest).includes(output.id)).length;
      return { id: output.id, count, text: `${count} ${DELIVERED_WORDS[output.id][count === 1 ? 0 : 1]}` };
    })
    .filter((entry) => entry.count > 0);
  return {
    mvps: mvps.length,
    building: inGroup('in_progress'),
    ready: inGroup('ready').length,
    held: inGroup('held').length,
    unmet: inGroup('unmet').length,
    failed: inGroup('failed').length,
    notebooks: list.filter((item) => item.state?.kind === 'notebook' && item.notebook?.state === 'ready').length,
    notStarted: list.filter((item) => item.state?.group === 'not_started').length,
    delivered,
  };
}

const STAGE_PENDING = ['running', 'next', 'waiting'];

function plannedWork(plan, stages, building) {
  const acts = new Map(planActions(plan).map((a) => [a.id, a]));
  return (output) => {
    const act = acts.get(output.id);
    if (!act) return null;
    const stage = (stages || []).find((s) => s.id === output.label) || null;
    if (stage && !STAGE_PENDING.includes(stage.state)) return { settled: true };
    return { now: building.has(output.id), doing: planActionText(act).now };
  };
}

export function controlTiles(live, latest, { active = false, building: now = new Set(), plan = null, stages = null } = {}) {
  const rows = controlRows(live, latest);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chosen = latest?.spec_json?.outputs || {};
  const assets = latest?.asset_status || {};
  const work = active && plan && !plan.pending ? plannedWork(plan, stages, now) : null;
  return {
    strips: rows.filter((row) => row.id === 'build' || row.id === 'job'),
    tiles: IMPLEMENT_OUTPUTS.map((output) => {
      const row = byId.get(output.id);
      const planned = work ? work(output) : null;
      const building = planned && !planned.settled ? planned : null;
      if (row) return { output, kind: 'live', row, ...(building ? { building } : {}) };
      if (!chosen[output.id]) {
        const note = takenOutText(assets[output.id], output.id);
        return { output, kind: 'off', ...(note ? { note } : {}) };
      }
      if (active && plan?.pending) return { output, kind: 'planning' };
      if (active && !plan) return { output, kind: 'building', now: now.has(output.id) };
      if (building) return { output, kind: 'building', ...building };
      if (assets[output.id]?.state === 'failed') return { output, kind: 'failed', error: String(assets[output.id].error || '') };
      if (latest?.status === IMPLEMENT_VIBE_NOT_MET) return { output, kind: 'held', note: VIBE_NOT_MET_FIRST };
      if (!live || planned?.settled) return { output, kind: 'checking' };
      return { output, kind: 'missing' };
    }),
  };
}

const SHARED_PART_WORDS = { app: 'pages', dashboard: 'pages', genie_space: 'tables, instructions and sample questions' };
const SHARED_CONTROL_WORDS = { stop: ['stops', 'stop'], start: ['starts', 'start'], unpublish: ['unpublishes', 'are unpublished'], publish: ['publishes', 'are published'] };
const SHARED_CONTROL_ASSETS = ['app', 'dashboard'];

export function sharedControlAsks(a, uninstall) {
  return Boolean(uninstall) && SHARED_CONTROL_ASSETS.includes(a.asset) && Object.hasOwn(SHARED_CONTROL_WORDS, a.action)
    && (uninstall.others.length > 0 || uninstall.unknown);
}

export function sharedControlText(a, uninstall) {
  const [does, effect] = SHARED_CONTROL_WORDS[a.action];
  const part = SHARED_PART_WORDS[a.asset];
  const names = holderNames(uninstall.others);
  if (!names.length) return `Inspire could not check whether other use cases hold ${part} in ${uninstall.target}. If one does, its ${part} ${effect} with it too.`;
  return `Inspire ${does} ${uninstall.target} for every use case in it: the ${part} of ${holdersText(names)} ${effect} with this use case's ${part}.`;
}

export function insideMoveNote(spec, heldApp, { shared = null, joinedBefore = '', sessionId = '', useCaseId = '' } = {}) {
  if (!insideInspire(spec) || !heldApp) return '';
  const part = SHARED_PART_WORDS.app;
  const mine = (u) => String(u?.use_case_id ?? '') === String(useCaseId) && String(u?.session_id ?? '') === String(sessionId);
  const names = holderNames((shared?.app?.use_cases || []).filter((u) => !mine(u)));
  if (names.length || joinedBefore) {
    const who = names.length ? ` also holds the ${part} of ${holdersText(names)}, so it` : ' is shared with other use cases, so it';
    return `${heldApp}${who} keeps what Inspire built there for this use case; Inspire no longer refreshes this use case's ${part} in it and `
      + 'runs them in its Run tab instead.';
  }
  return `${heldApp} is left as it is and no longer refreshed; Inspire runs this use case's page in its Run tab instead and deletes nothing.`;
}

export function sharedNote(id, uninstall, builtBy) {
  if (!uninstall || !SHARED_CONTROL_ASSETS.includes(id)) return '';
  const part = SHARED_PART_WORDS[id];
  if (builtBy) {
    const rest = holderNames((uninstall.others || []).filter((u) => !(String(u?.use_case_id) === String(builtBy.use_case_id)
      && String(u?.session_id) === String(builtBy.session_id))));
    return `This use case's ${part} are part of ${uninstall.target}, which ${builtBy.name || builtBy.use_case_id} built.${
      rest.length ? ` It also holds the ${part} of ${holdersText(rest)}.` : ''}`;
  }
  const names = holderNames(uninstall.others);
  return names.length ? `${uninstall.target} also holds the ${part} of ${holdersText(names)}.` : '';
}

export function takenOutText(entry, id) {
  const target = String(entry?.taken_out_of ?? '').trim();
  if (entry?.state !== 'released' || !target) return '';
  const who = (Array.isArray(entry.stays_for) ? entry.stays_for : []).map((u) => String(u ?? '').trim()).filter(Boolean);
  return `This use case's ${SHARED_PART_WORDS[id] || 'part'} were taken out of ${target}${who.length ? `, which stays for ${holdersText(who)}` : ''}.`;
}

export function assetUninstall(id, latest, live, name = '') {
  const outputs = latest?.spec_json?.outputs || {};
  const shared = live?.shared?.[id] || null;
  const others = Array.isArray(shared?.use_cases) ? shared.use_cases : [];
  const target = String(name || shared?.id || '').trim();
  return {
    label: others.length && target ? `Remove from ${target}` : 'Uninstall',
    others,
    target,
    blocked: id === 'genie_space' && outputs.app ? `${GENIE_FOR_APP_NOTE} Uninstall the App first.` : '',
    unknown: Boolean(live) && !live.shared,
  };
}

export function uninstallText(output, row, uninstall) {
  const name = String(row?.name || uninstall?.target || '').trim();
  const who = holderNames(uninstall?.others);
  if (who.length) {
    return `Inspire takes this use case's ${SHARED_PART_WORDS[output.id] || 'part'} out of ${name} in a new version of this MVP and keeps the other outputs. `
      + `${name} stays for ${holdersText(who)}. If no other use case holds it by the time the job runs, Inspire deletes it instead.`;
  }
  const shareable = Object.hasOwn(SHARED_PART_WORDS, output.id);
  const check = !shareable ? ''
    : uninstall?.unknown
      ? ' Inspire could not check whether other use cases share it, so it checks again first: if one does, it takes out only this use case\'s part.'
      : ` Inspire checks again when the job runs: if another use case shares it by then, Inspire takes out only this use case's ${SHARED_PART_WORDS[output.id]} and keeps it for them.`;
  return `Inspire deletes the ${output.label} ${name} in a new version of this MVP and keeps the other outputs. You can add it back from its tile.${check}`;
}

export function removeChanges(latest, output) {
  const spec = latest?.spec_json || {};
  return {
    outputs: { ...(spec.outputs || {}), [output]: false },
    removed_outputs: { ...(spec.removed_outputs || {}), [output]: 'delete' },
  };
}

const DONE = IMPLEMENT_DONE_STATUSES;
const BUILD_STEP = { queued: 0, checking: 2 };
const WARNING_START = /; (?=[A-Z][A-Za-z ]{0,40}: )/;
const savedVibes = (row, id) => String(row?.spec_json?.outputs?.[vibesKey(id)] ?? '').trim();
const messageParts = (row) => String(row?.status_message || '').split(WARNING_START);

export function statusWarnings(row) {
  if (String(row?.status || '') !== 'ready_with_warnings') return [];
  return [...new Set(messageParts(row).map((w) => w.trim()).filter(Boolean))];
}

export function vibeWarnings(row, id) {
  const label = IMPLEMENT_OUTPUTS.find((o) => o.id === id)?.label || id;
  const lead = `${label} vibe not done: `;
  const listed = [...messageParts(row), ...builtWarnings(row, id)];
  return [...new Set(listed.filter((w) => w.includes(lead)).map((w) => w.slice(w.indexOf(lead)).trim()))];
}

const PART_STATES = [...BUILT_ASSET_STATES, 'failed'];
const ASSET_WHAT = {
  notebook: 'The Genie Code notebook that finds the rows to act on',
  ai_reasoning: 'Why each row is flagged, what to do, and how sure',
  app_page: 'A page of the App',
  dashboard_chart: 'A chart on the dashboard',
  dashboard: 'The whole dashboard',
  genie_space: 'How Genie answers questions on this use case',
  app: 'The whole App',
  alert: 'Emails people when the latest run has rows to act on',
};
const ASSET_NOUNS = { app_page: 'page', dashboard_chart: 'chart', ai_reasoning: 'part', value_formula: 'part', notebook: 'notebook', dashboard: 'dashboard', genie_space: 'Genie Agent', app: 'App', alert: 'alert' };
const ASSET_PILLS = {
  ready: { label: 'Ready', tone: 'success' },
  ready_with_warnings: { label: 'Ready with warnings', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  rebuilding: { label: 'Rebuilding', tone: 'busy' },
};
const ALL_ASSETS = 'all';
const OPTION_PREFIXES = { dashboard: ['dashboard_', 'inspire_url'], genie_space: ['genie_space_', 'genie_questions'], app: ['app_', 'inspire_url'], alert: ['alert_'] };

export function vibeChecks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((check) => check && typeof check === 'object' && String(check.ask ?? '').trim()).map((check) => ({
    ask: String(check.ask).trim(),
    done: String(check.status ?? '').trim().toLowerCase() === 'done',
    evidence: String(check.evidence ?? '').trim(),
  }));
}

export function checksSummary(checks) {
  const done = checks.filter((check) => check.done).length;
  return `You asked for ${checks.length} ${checks.length === 1 ? 'thing' : 'things'}. Done: ${done} of ${checks.length}.`;
}

export function missingAsks(checks) {
  return checks.filter((check) => !check.done).map((check) => check.ask);
}

export function askCount(text) {
  return String(text ?? '').split(/\n+|;|\.(?:\s+|$)|,\s*and\s+|\s+and\s+|,\s+/).map((s) => s.trim()).filter((s) => s.length > 3).length;
}

function builtChecks(rows, version, id) {
  const output = partOf(id)?.output || id;
  let row = rows.find((r) => r.spec_version === version);
  let back = Number(row?.spec_json?.rollback_outputs?.[output]);
  while (row && Number.isInteger(back) && back < row.spec_version) {
    row = rows.find((r) => r.spec_version === back);
    back = Number(row?.spec_json?.rollback_outputs?.[output]);
  }
  return { checks: vibeChecks(row?.asset_status?.[id]?.vibes_checks), checkedOn: row?.spec_version ?? null };
}

function assetPill(entry, checks, rebuilding) {
  if (rebuilding) return ASSET_PILLS.rebuilding;
  const state = entry?.state || 'ready';
  if (state === 'ready' && checks.some((check) => !check.done)) return ASSET_PILLS.ready_with_warnings;
  return ASSET_PILLS[state] || statusChip(state);
}

function legacyRebuildTargets(latest, base) {
  if (String(latest?.change_classes || '').split(',').some((c) => ['initial', 'data', 'config'].includes(c.trim()))) return ALL_ASSETS;
  const spec = latest?.spec_json || {};
  const ids = new Set([...(spec.retry_outputs || []), ...Object.keys(spec.rollback_outputs || {})]);
  const before = base?.spec_json?.outputs || {};
  const after = spec.outputs || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key.endsWith('_vibes') && String(before[key] ?? '').trim() !== String(after[key] ?? '').trim()) ids.add(key.slice(0, -'_vibes'.length));
  }
  for (const [output, prefixes] of Object.entries(OPTION_PREFIXES)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
    const moved = JSON.stringify(before.merge?.[output] ?? '') !== JSON.stringify(after.merge?.[output] ?? '');
    if (moved || keys.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))) ids.add(output);
  }
  if (String(base?.spec_json?.data?.notes ?? '').trim() !== String(spec.data?.notes ?? '').trim()) ids.add('notebook');
  return ids;
}

function legacyRebuild(latest, base) {
  const targets = legacyRebuildTargets(latest, base);
  const rolling = latest.spec_json?.rollback_outputs || {};
  return (id, output, gone) => (targets === ALL_ASSETS || targets.has(id) || targets.has(output) ? { rollback: gone ? null : Number(rolling[output]) || null } : null);
}

const NOTEBOOK_REBUILDS = { notebook: (plan) => plan.refill, value_formula: (plan) => plan.refill, ai_reasoning: (plan) => plan.refill || plan.preview };
const CARD_ACTIONS = ['build', 'rollback_built', 'rebuild', 'restyle', 'rollback'];
const cardActions = (plan) => planActions(plan).filter((a) => CARD_ACTIONS.includes(a.action));

function plannedRebuild(plan, latest) {
  const acts = new Map(cardActions(plan).map((a) => [a.id, a]));
  const retry = (Array.isArray(latest.spec_json?.retry_outputs) ? latest.spec_json.retry_outputs : []).map(String);
  return (id, output) => {
    if (output === 'notebook') return NOTEBOOK_REBUILDS[id]?.(plan) ? { rollback: null } : null;
    const act = acts.get(output);
    if (!act) return null;
    const parts = retry.filter((r) => partOf(r)?.output === output);
    if (act.action === 'rebuild' && parts.length && !retry.includes(output) && !parts.includes(id)) return null;
    return { rollback: act.action === 'rollback' ? act.version : null };
  };
}

function planReach(plan) {
  const removed = planActions(plan).filter((a) => a.action === 'delete').map((a) => a.id);
  return new Set([...cardActions(plan).map((a) => a.id), ...removed, ...(plan.refill || plan.preview ? ['notebook'] : [])]);
}

function markAlone(cards, plan) {
  const busy = cards.filter((c) => c.building);
  const reach = plan ? planReach(plan) : new Set(busy.map((c) => c.output));
  for (const c of busy) {
    c.building.alone = reach.size === 1 && reach.has(c.output) && (c.id === c.output || busy.filter((b) => b.output === c.output).length === 1);
  }
  return cards;
}

export function rebuildingText(card) {
  const alone = Boolean(card?.building?.alone);
  const rest = alone ? 'Nothing else changes.' : 'This version changes other parts too.';
  if (card.appFollows) return `Rebuilding the ${card.label}, then pointing the App page at it. ${rest}`;
  return alone ? `Rebuilding the ${card.label} only. ${rest}` : `Rebuilding the ${card.label}. ${rest}`;
}

export function rollingBackText(card) {
  return `Putting version ${card.building.rollback} live again. Genie is not called${card.building.alone ? ' and nothing else changes' : ' for it'}.`;
}

export function waitingAsks(open, id, output, vibes) {
  const mine = (open || []).filter((entry) => entry.part === id || entry.part === output || partOf(entry.part)?.output === output);
  const lines = heldAsks(vibes);
  const matched = lines.flatMap((ask) => {
    const hit = mine.find((entry) => sameText(entry.requirement, ask));
    return hit ? [{ ask, evidence: hit.evidence, listed: true }] : [];
  });
  const extra = mine.filter((entry) => entry.part === id && !lines.some((ask) => sameText(entry.requirement, ask)))
    .map((entry) => ({ ask: entry.requirement, evidence: entry.evidence, listed: false }));
  return [...matched, ...extra];
}

export function vibeCards(history, latest, stalled = null, notebookUrl = '', plan = null) {
  const rows = [...(history || [])].sort((a, b) => (b.spec_version || 0) - (a.spec_version || 0));
  const active = versionActive(latest, stalled);
  const held = latest?.status === IMPLEMENT_VIBE_NOT_MET;
  const live = builtVersion(rows);
  const base = active || held ? rows.find((r) => r.spec_version === live) : latest;
  if (!base || !DONE.includes(String(base.status))) return [];
  const shown = held ? base : latest;
  const chosen = shown.spec_json?.outputs || {};
  const built = rebuildableOutputs(base).map((o) => o.id);
  const planned = active && plan && !plan.pending ? plan : null;
  const rebuildOf = !active || plan?.pending ? () => null : planned ? plannedRebuild(planned, latest) : legacyRebuild(latest, base);
  const asking = shown.spec_json?.retry_asks || {};
  const at = (row) => String(row?.updated_at || row?.created_at || '');
  const liveAt = (version) => (version == null ? null : { version, at: at(rows.find((r) => r.spec_version === version)) });
  const urlOf = (output) => (output === 'notebook' ? String(notebookUrl || '') : String(base[OUTPUT_URLS[output]] || latest[OUTPUT_URLS[output]] || ''));
  const impact = rowImpact(base);
  const open = openVibeAsks(base);
  const card = (id, output, entry, version, fields) => {
    const kind = partOf(id)?.kind || id;
    const what = kind === 'value_formula' ? `How the ${stakeWords(impact)} on each row is counted` : String(entry?.what ?? entry?.description ?? '').trim() || ASSET_WHAT[kind];
    const { checks, checkedOn } = builtChecks(rows, version, id);
    const gone = Object.hasOwn(OUTPUT_IDS, output) && !base[OUTPUT_IDS[output]];
    const doing = rebuildOf(id, output, gone);
    const rollback = doing?.rollback ?? null;
    const asks = rollback ? 0 : Array.isArray(asking[id]) ? asking[id].length : askCount(fields.vibes);
    return {
      id, output, name: '', versions: [], warnings: [], ...fields, gone, live: liveAt(version), url: urlOf(output), impact,
      what, noun: ASSET_NOUNS[kind],
      checks, checkedOn, state: assetPill(entry, checks, Boolean(doing)), building: doing ? { step: BUILD_STEP[latest.status] ?? 1, asks, rollback, alone: false } : null,
      waiting: waitingAsks(open, id, output, fields.vibes),
    };
  };
  const parts = (output) => Object.entries(base.asset_status || {})
    .filter(([id, entry]) => partOf(id)?.output === output && PART_STATES.includes(entry?.state))
    .map(([id, entry]) => {
      const name = String(entry.name ?? entry.title ?? '').trim();
      const version = BUILT_ASSET_STATES.includes(entry.state) ? (entry.spec_version ?? base.spec_version ?? null) : null;
      const label = partLabel(id, name, impact);
      return card(id, output, entry, version, { label, name, vibes: String(chosen[vibesKey(id)] ?? ''), rebuild: true });
    });
  const notebookEntry = base.asset_status?.notebook;
  const notebookVersion = notebookEntry?.spec_version ?? null;
  const notebook = notebookVersion == null ? []
    : [card('notebook', 'notebook', notebookEntry, notebookVersion, { label: 'notebook', vibes: String(shown.spec_json?.data?.notes ?? '').trim(), rebuild: true })];
  return markAlone([...notebook, ...parts('notebook'), ...IMPLEMENT_OUTPUTS.filter((o) => chosen[o.id]).flatMap((o) => {
    const entry = base.asset_status?.[o.id];
    const liveVersion = BUILT_ASSET_STATES.includes(entry?.state) ? (entry.spec_version ?? base.spec_version ?? null) : null;
    const versions = rows.filter((r) => {
      const saved = r.asset_status?.[o.id];
      return saved?.snapshot === true && r.spec_version !== liveVersion && (saved.spec_version ?? r.spec_version) === r.spec_version;
    }).map((r) => ({
      version: r.spec_version, at: at(r), status: String(r.status || ''), vibes: savedVibes(r, o.id), checks: builtChecks(rows, r.spec_version, o.id).checks,
    }));
    const whole = card(o.id, o.id, entry, liveVersion, {
      label: o.label, blurb: o.blurb, vibes: String(chosen[vibesKey(o.id)] ?? '').trim(), rebuild: built.includes(o.id), versions,
      appFollows: o.id === 'genie_space' && (planned ? planned.repoint.includes('app') : built.includes('app')),
    });
    whole.warnings = whole.checks.length ? [] : vibeWarnings(base, o.id);
    return [whole, ...parts(o.id)];
  }).filter((c) => c.rebuild || c.versions.length)], planned);
}

const PICK_GROUPS = [['notebook', 'Genie Code notebook'], ['results', 'Results'], ['app', 'App'], ['dashboard', 'Dashboard'], ['genie_space', 'Genie Agent'], ['alert', 'Alert']];
const pickGroup = (card) => (card.output === 'notebook' && card.id !== 'notebook' ? 'results' : card.output);

function pickTitle(card, liveName) {
  const part = partOf(card.id);
  if (part?.kind === 'app_page') return `Page: ${card.name || part.key}`;
  if (part?.kind === 'dashboard_chart') return `Chart: ${card.name || part.key}`;
  return {
    notebook: 'Notebook', ai_reasoning: 'AI reasoning', value_formula: stakeLabel(card.impact || null), genie_space: 'Instructions',
    alert: liveName ? `Alert: ${liveName}` : 'Alert', app: 'The whole App', dashboard: 'The whole dashboard',
  }[card.id];
}

export function assetGroups(cards, rows = []) {
  const names = new Map((rows || []).map((row) => [row.id, String(row.name || '')]));
  const list = cards || [];
  return PICK_GROUPS.map(([key, label]) => {
    const own = list.filter((c) => pickGroup(c) === key);
    return {
      key,
      label,
      assets: own.map((c) => ({
        ...c, group: label, title: pickTitle(c, names.get(c.id)), name: c.name || names.get(c.id) || '', parent: c.id === c.output ? null : list.find((p) => p.id === c.output) || null,
      })),
    };
  }).filter((group) => group.assets.length);
}

export function tryAgainChanges(id, asks) {
  return { retry_outputs: [id], retry_asks: { [id]: [...asks] } };
}

export const MVP_VIBES_ID = 'mvp';
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const assetName = (assets, id) => String(assets?.[id]?.name ?? assets?.[id]?.title ?? '').trim();

export function heldVersion(latest, history) {
  if (latest?.status !== IMPLEMENT_VIBE_NOT_MET) return null;
  const assets = isMap(latest.asset_status) ? latest.asset_status : {};
  const held = isMap(assets.held) ? assets.held : {};
  const ids = [...new Set((Array.isArray(held.parts) ? held.parts : []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  return {
    version: latest.spec_version,
    before: Array.isArray(history) ? builtVersion(history) : undefined,
    parts: ids.map((id) => partLabel(id, assetName(assets, id), rowImpact(latest))),
    reason: String(held.reason ?? '').trim(),
  };
}

export function heldPartsText(held) {
  return held.parts.length ? `Held: ${joinWords(held.parts.map((label) => `the ${label}`))}.` : '';
}

export function rephraseOf(checklist, latest) {
  const spec = latest?.spec_json || {};
  const assets = isMap(latest?.asset_status) ? latest.asset_status : {};
  const lines = [];
  const replaces = [];
  const holds = (text, words) => heldAsks(text).some((ask) => sameText(ask, words));
  for (const entry of rephrasableAsks(checklist)) {
    const words = entry.requirement;
    if (!words) continue;
    if (!lines.some((line) => sameText(line, words))) lines.push(words);
    const inPart = entry.part && partAsks(spec, entry.part).some((ask) => sameText(ask, words));
    const out = inPart ? { id: entry.part, label: partLabel(entry.part, assetName(assets, entry.part), rowImpact(latest)) }
      : holds(spec.vibes, words) ? { id: MVP_VIBES_ID, label: `vibe of v${latest.spec_version}` } : null;
    if (out && !replaces.some((r) => r.id === out.id && sameText(r.text, words))) replaces.push({ ...out, text: words });
  }
  return { text: lines.join('\n'), replaces };
}

export function rephrasedAsk(text, replaces) {
  const kept = heldAsks(text);
  return (replaces || []).filter((r) => !kept.some((line) => sameText(line, r.text)));
}

export function publishHeldText(held) {
  const what = held.parts.length ? `the ${joinWords(held.parts)} of v${held.version}` : `v${held.version}`;
  const place = held.before === undefined ? '' : held.before ? ` in place of v${held.before}` : ' for the first time';
  return `Inspire puts ${what} live${place}, with no Genie round, and marks each ask above as published anyway by you.`;
}

export function canPublishHeld(status) {
  return status?.can_publish_held === true;
}

export const COLLECTED_VIBES_KEY = 'inspire.collected_vibes.v1';

export function collectedScope(host, database, sessionId, useCaseId) {
  return [host, database, sessionId, useCaseId].map((part) => String(part ?? '').trim()).join('|');
}

function readCollected(storage) {
  try {
    const all = JSON.parse(storage?.getItem(COLLECTED_VIBES_KEY) || '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

const asked = (text) => ({ kind: 'ask', text });
const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

function collectedEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = String(entry.text ?? '').trim();
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!text) return null;
  if (entry.kind === 'ask') return asked(text);
  if (entry.kind === 'remove') return id ? { kind: 'remove', id, label: String(entry.label ?? '').trim(), text } : null;
  if (entry.kind !== undefined || !id) return null;
  const name = String(entry.label ?? '').trim() || assetLabel(id);
  return asked(`${name.charAt(0).toUpperCase()}${name.slice(1)}: ${text}`);
}

export function loadCollectedVibes(scope, storage = globalThis.localStorage) {
  const entries = readCollected(storage)[scope];
  return (Array.isArray(entries) ? entries : []).map(collectedEntry).filter(Boolean);
}

export function saveCollectedVibes(scope, entries, storage = globalThis.localStorage) {
  const all = readCollected(storage);
  const kept = (entries || []).filter((entry) => String(entry?.text ?? '').trim());
  if (kept.length) all[scope] = kept;
  else delete all[scope];
  try {
    storage.setItem(COLLECTED_VIBES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function collectAsk(entries, text) {
  const list = entries || [];
  const next = String(text ?? '').trim();
  if (!next || list.some((entry) => entry.kind === 'ask' && sameText(entry.text, next))) return list;
  return [...list, asked(next)];
}

export function collectRemoval(entries, id, label, text) {
  const list = entries || [];
  const ask = String(text ?? '').trim();
  if (!ask || !id || list.some((entry) => entry.kind === 'remove' && entry.id === id && sameText(entry.text, ask))) return list;
  return [...list, { kind: 'remove', id, label: String(label ?? '').trim(), text: ask }];
}

export function dropCollected(entries, dropped) {
  return (entries || []).filter((entry) => !(entry.kind === dropped?.kind && (entry.id || '') === (dropped?.id || '') && sameText(entry.text, dropped?.text)));
}

export function removingAsk(entries, id, ask) {
  return (entries || []).find((entry) => entry.kind === 'remove' && entry.id === id && sameText(entry.text, ask)) || null;
}

export function rebuildLabel(entries) {
  const count = (entries || []).length;
  return count ? `Rebuild with ${plural(count, 'vibe')}` : 'Rebuild';
}

export function vibeFeaturesLabel(entries) {
  return `${VIBE_FEATURES_LABEL} (${(entries || []).length})`;
}

export const REBUILD_WAITS = 'A build is running. Vibes you add wait for the next build.';
export const REBUILD_NOTHING = 'Add a vibe or take one out first: nothing changed since the last build.';

export function rebuildSpec(latest, entries, built = null, previous = '') {
  const { vibe_previous: _previous, ...spec } = withCollectedVibes(nextSpecFrom(latest, {}), entries).spec;
  return String(spec.vibes ?? '').trim() && built != null && previous ? { ...spec, vibe_previous: previous } : spec;
}

export const RAIL_WIDTH = { min: 240, max: 520, start: 320, step: 16 };
const RAIL_WIDTH_KEY = 'inspire.implement_rail_width';

export function railWidth(value) {
  const n = value === null || value === undefined || value === '' ? NaN : Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, n)) : RAIL_WIDTH.start;
}

export function loadRailWidth(storage = globalThis.localStorage) {
  try {
    return railWidth(storage?.getItem(RAIL_WIDTH_KEY));
  } catch {
    return RAIL_WIDTH.start;
  }
}

export function saveRailWidth(width, storage = globalThis.localStorage) {
  try {
    storage.setItem(RAIL_WIDTH_KEY, String(railWidth(width)));
    return true;
  } catch {
    return false;
  }
}

export function rollbackChanges(latest, id, version, vibes) {
  return { rollback_outputs: { [id]: version }, outputs: { ...(latest?.spec_json?.outputs || {}), [vibesKey(id)]: String(vibes ?? '').trim() } };
}

export function removeConfirmed(typed, useCaseId) {
  return Boolean(useCaseId) && String(typed ?? '').trim() === String(useCaseId);
}

export function controlActionText(entry) {
  const who = entry?.acted_by ? ` by ${entry.acted_by}` : '';
  const when = entry?.acted_at ? `, ${formatWhen(entry.acted_at, entry.acted_at)}` : '';
  return `${entry?.message || `${entry?.asset} ${entry?.action}`}${who}${when}`;
}

const newestFirst = (history) => [...(history || [])].sort((a, b) => (b.spec_version || 0) - (a.spec_version || 0));

export function liveVersion(history) {
  return newestFirst(history).find((row) => DONE.includes(String(row?.status)))?.spec_version ?? null;
}

export function removeKeptChanges(version) {
  return { remove_kept: [Number(version)] };
}

export function uninstallChanges() {
  return { uninstall: true };
}

export function keptVersions(history) {
  const row = newestFirst(history).find((r) => r?.asset_status?.kept && typeof r.asset_status.kept === 'object');
  const byVersion = new Map();
  for (const entry of Array.isArray(row?.asset_status?.kept?.assets) ? row.asset_status.kept.assets : []) {
    const output = IMPLEMENT_OUTPUTS.find((o) => o.id === entry?.output);
    const version = Number(entry?.version);
    if (!output || !String(entry.id ?? '').trim() || !Number.isInteger(version) || version < 1) continue;
    if (!byVersion.has(version)) byVersion.set(version, { version, keptIn: Number(entry.kept_in) || null, assets: [] });
    byVersion.get(version).assets.push({ output: output.id, label: output.label, id: String(entry.id), url: String(entry.url || ''), title: String(entry.title || '') });
  }
  return [...byVersion.values()].sort((a, b) => b.version - a.version);
}

export const ASSET_FILTERS = [['notebook', 'Notebook'], ['app', 'App'], ['dashboard', 'Dashboard'], ['genie_space', 'Genie Agent'], ['alert', 'Alert']];

export function itemAssets(item) {
  const gone = item?.latest?.status === IMPLEMENT_UNINSTALLED;
  const have = new Set(gone ? [] : deliveredOutputs(item?.latest));
  if (item?.notebook?.state === 'ready' || (!gone && item?.latest?.notebook_path)) have.add('notebook');
  return have;
}

export function assetFilterCounts(items) {
  const list = (items || []).map(itemAssets);
  return ASSET_FILTERS.map(([id, label]) => ({ id, label, count: list.filter((have) => have.has(id)).length }));
}

export function filterByAsset(groups, asset) {
  if (!asset) return groups;
  return (groups || []).map((group) => ({ ...group, items: group.items.filter((item) => itemAssets(item).has(asset)) }));
}

export function filterByMvp(groups, mvp) {
  if (!mvp) return groups;
  return (groups || []).map((group) => ({ ...group, items: group.items.filter((item) => mvpFilterMatches(mvp, item.state)) }));
}
