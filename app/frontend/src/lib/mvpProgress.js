import { IMPLEMENT_OUTPUTS, IMPLEMENT_ACTIVE_STATUSES, IMPLEMENT_DONE_STATUSES, IMPLEMENT_VIBE_NOT_MET, joinWords, partLabel } from './implementWizard.js';
import { formatDuration, formatWhen } from './formatWhen.js';
import { plural } from './plural.js';
import { rowImpact } from './targetKpi.js';

export const MVP_BUILD_STAGES = [
  { id: 'Plan', label: 'Plan', working: 'Inspire is working out what this version rebuilds' },
  { id: 'Instruction', label: 'Instruction', working: 'Inspire is writing the Genie Code instruction' },
  { id: 'Genie Code', label: 'Start Genie Code', working: 'Inspire is starting Genie Code' },
  { id: 'Genie build', label: 'Genie builds the notebook', working: 'Genie is building the notebook' },
  { id: 'Preview run', label: 'Preview run', working: 'Inspire is running the notebook on a preview' },
];
const STAGE = Object.fromEntries(MVP_BUILD_STAGES.map((s) => [s.id, s]));
const VIBE_STAGE = { id: 'Vibe', label: 'Vibe', working: 'Inspire is reading your vibe to send each ask to the part it changes' };

export const MVP_BUILD_ORDER = ['genie_space', 'dashboard', 'alert', 'app'];
const OUTPUT_LABEL = Object.fromEntries(IMPLEMENT_OUTPUTS.map((o) => [o.id, o.label]));
export const DECISION_LIST_NOTES = 'decision_list';
const STAGE_NOTES = { ...Object.fromEntries(IMPLEMENT_OUTPUTS.map((o) => [o.label, [o.id, o.label]])), Done: [DECISION_LIST_NOTES, 'Decision list'] };

export function assetNotes(row, id) {
  const entry = row?.asset_status?.[id];
  const notes = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.notes : null;
  return Array.isArray(notes) ? [...new Set(notes.map((n) => String(n ?? '').trim()).filter(Boolean))] : [];
}

function versionNotes(row, id) {
  const entry = row?.asset_status?.[id];
  return entry && Number(entry.spec_version) === Number(row?.spec_version) ? assetNotes(row, id) : [];
}
const PLAN_PHASE = 'Plan';
const VIBE_PHASE = 'Vibe';
const GENIE_ACTIONS = ['build', 'rollback_built', 'rebuild'];

const EARLIER_PHASES = { genie_space: ['Genie space'] };

const FINISH_STAGE = { id: 'Done', label: 'Done', working: 'Inspire is scheduling and sharing the MVP', phases: ['Schedule', 'Sharing', 'Done'] };
export const SELF_FIX_PHASE = 'Self-fix';
const SELF_FIX_STAGE = { id: SELF_FIX_PHASE, label: 'Self-fix', working: 'Inspire is putting back what no ask targets' };

function finishWords(plan) {
  if (plan.schedule && plan.sharing) return FINISH_STAGE.working;
  if (plan.schedule) return 'Inspire is scheduling the job';
  if (plan.sharing) return 'Inspire is sharing the MVP';
  return 'Inspire is finishing this version';
}

const STEP_STATES = { started: 'running', ended_success: 'done', ended_warning: 'warning', ended_error: 'error' };
export const MVP_REPAIR_PHASE = 'Self-repair';
const WHOLE_BUILD = 'the MVP build';
const RUN_STARTING_STATES = ['PENDING', 'QUEUED', 'BLOCKED'];

function stepPayload(row) {
  const payload = row?.result_json;
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function stepPhase(row, payload) {
  const phase = String(payload.phase || '');
  if (phase) return phase;
  const named = /^Inspire is working on (.+)$/i.exec(String(row?.step_name || ''));
  return named ? named[1] : '';
}

function timeOf(value) {
  const ms = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

function stepEvents(steps) {
  return (steps || [])
    .map((row, order) => {
      const payload = stepPayload(row);
      return { row, payload, order, at: timeOf(payload.event_at) ?? timeOf(row?.last_updated) };
    })
    .sort((a, b) => ((a.at ?? Infinity) - (b.at ?? Infinity)) || a.order - b.order);
}

function sameVersion(payload, latest) {
  const ours = Number(latest?.spec_version);
  const theirs = Number(payload.spec_version);
  return !Number.isFinite(ours) || !Number.isFinite(theirs) || ours === theirs;
}

export function mvpRepairOf(steps, latest) {
  let found = null;
  for (const { row, payload, at } of stepEvents(steps)) {
    const attempt = Number(payload.attempt);
    if (stepPhase(row, payload) !== MVP_REPAIR_PHASE || !Number.isInteger(attempt) || attempt < 2 || !sameVersion(payload, latest)) continue;
    const attempts = Number(payload.attempts);
    found = {
      attempt,
      attempts: Number.isInteger(attempts) && attempts >= attempt ? attempts : null,
      step: String(payload.step || WHOLE_BUILD),
      why: String(payload.why || '').trim(),
      at,
    };
  }
  return found;
}

function repairLine(repair, status) {
  if (!repair) return '';
  const count = `${repair.attempt}${repair.attempts ? ` of ${repair.attempts}` : ''}`;
  const part = repair.step === WHOLE_BUILD ? '' : ` for ${repair.step}`;
  if (IMPLEMENT_ACTIVE_STATUSES.includes(status)) return `Attempt ${count}${part}: Inspire is fixing it${repair.why ? `: ${repair.why}` : ''}`;
  if (IMPLEMENT_DONE_STATUSES.includes(status)) return `Built on attempt ${count}${part}${repair.why ? `. What Inspire fixed: ${repair.why}` : ''}`;
  return '';
}

function roundOf(payload) {
  const round = Number(payload.round);
  if (!Number.isInteger(round) || round < 1) return null;
  return payload.failure ? round + 1 : round;
}

const isPhase = (row, payload, phase) => stepPhase(row, payload).toLowerCase() === phase.toLowerCase();
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const outputList = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter((id) => Object.hasOwn(OUTPUT_LABEL, id)))] : []);
const versionMap = (value, read) => Object.fromEntries(Object.entries(isMap(value) ? value : {})
  .map(([id, entry]) => [id, Number(read(entry))]).filter(([id, version]) => Object.hasOwn(OUTPUT_LABEL, id) && Number.isInteger(version) && version > 0));

export const PLAN_PENDING = Object.freeze({ pending: true });
export const PLAN_RELINK = 'point the weekly impact email at the new Inspire address';

function normalPlan(plan) {
  return {
    pending: false,
    classes: Array.isArray(plan.classes) ? plan.classes.map(String) : [],
    refill: plan.refill === true,
    preview: plan.preview === true,
    build: outputList(plan.build),
    refresh: outputList(plan.refresh),
    restyle: outputList(plan.restyle),
    repoint: outputList(plan.repoint),
    relink: outputList(plan.relink),
    delete: outputList(plan.delete),
    keep_unmanaged: outputList(plan.keep_unmanaged),
    rollback: versionMap(plan.rollback, (entry) => entry),
    rollback_built: versionMap(plan.rollback_built, (entry) => entry?.version),
    schedule: plan.schedule === true,
    sharing: plan.sharing === true,
  };
}

export function versionPlan(steps, latest) {
  let recorded = false;
  let vibed = false;
  let plan = null;
  for (const { row, payload } of stepEvents(steps)) {
    if (!sameVersion(payload, latest)) continue;
    if (isPhase(row, payload, VIBE_PHASE)) vibed = true;
    if (!isPhase(row, payload, PLAN_PHASE)) continue;
    recorded = true;
    if (isMap(payload.plan)) plan = normalPlan(payload.plan);
  }
  if (plan) return plan;
  if (recorded) return null;
  const status = String(latest?.status || '');
  return status === 'queued' || (status === 'failed' && vibed) ? PLAN_PENDING : null;
}

export function planActions(plan) {
  if (!plan || plan.pending) return [];
  const removed = MVP_BUILD_ORDER.filter((id) => plan.delete.includes(id)).map((id) => ({ id, action: 'delete' }));
  const changed = MVP_BUILD_ORDER.flatMap((id) => {
    if (plan.rollback[id]) return [{ id, action: 'rollback', version: plan.rollback[id] }];
    if (plan.rollback_built[id]) return [{ id, action: 'rollback_built', version: plan.rollback_built[id] }];
    if (plan.build.includes(id)) return [{ id, action: 'build' }];
    if (plan.restyle.includes(id)) return [{ id, action: 'restyle' }];
    if (plan.refresh.includes(id)) return [{ id, action: 'rebuild' }];
    if (plan.repoint.includes(id)) return [{ id, action: 'repoint' }];
    if (plan.relink.includes(id)) return [{ id, action: 'relink' }];
    return [];
  });
  return [...removed, ...changed];
}

export function planActionText(act) {
  const label = OUTPUT_LABEL[act.id];
  return {
    delete: { label: `Remove the ${label}`, working: `Inspire is removing the ${label}`, now: 'Inspire is removing it now' },
    build: { label: `Build the ${label}`, working: `Genie is building the ${label}`, now: 'Genie is building it now' },
    rollback_built: {
      label: `Build a new ${label}`, working: `Genie is building a new ${label}, because v${act.version} could not be put back`, now: 'Genie is building a new one now',
    },
    rebuild: { label: `Rebuild the ${label}`, working: `Genie is rebuilding the ${label}`, now: 'Genie is rebuilding it now' },
    restyle: { label: `Restyle the ${label}`, working: `Inspire is restyling the ${label}`, now: 'Inspire is restyling it now' },
    rollback: { label: `Roll the ${label} back to v${act.version}`, working: `Inspire is putting v${act.version} of the ${label} back`, now: `Inspire is putting v${act.version} back now` },
    repoint: { label: 'Point the App at the Genie Agent', working: 'Inspire is pointing the App at the Genie Agent', now: 'Inspire is pointing it at the Genie Agent now' },
    relink: {
      label: `${PLAN_RELINK[0].toUpperCase()}${PLAN_RELINK.slice(1)}`, working: 'Inspire is pointing the weekly impact email at the new Inspire address',
      now: 'Inspire is pointing it at the new Inspire address now',
    },
  }[act.action];
}

const vibesOf = (latest) => String(latest?.spec_json?.vibes ?? '').trim();

function legacyStages(latest) {
  const outputs = latest?.spec_json?.outputs || {};
  return [
    ...MVP_BUILD_STAGES,
    ...IMPLEMENT_OUTPUTS.filter((o) => outputs[o.id]).map((o) => ({ id: o.label, label: o.label, phases: EARLIER_PHASES[o.id] || [], working: `Genie is building the ${o.label}` })),
    FINISH_STAGE,
  ];
}

function plannedStages(plan, latest, seen) {
  const was = (id) => seen.has(id.toLowerCase());
  const head = [...(vibesOf(latest) || was(VIBE_PHASE) ? [VIBE_STAGE] : []), STAGE.Plan];
  if (plan.pending) return head;
  const acts = planActions(plan);
  const stageOf = (act) => {
    const words = planActionText(act);
    return { id: OUTPUT_LABEL[act.id], label: words.label, working: words.working, phases: EARLIER_PHASES[act.id] || [] };
  };
  const genie = plan.refill || acts.some((a) => GENIE_ACTIONS.includes(a.action) && a.id !== 'alert') || was('Genie Code');
  return [
    ...head,
    ...acts.filter((a) => a.action === 'delete').map(stageOf),
    ...(plan.refill || was('Instruction') ? [STAGE.Instruction] : []),
    ...(plan.refill && genie ? [STAGE['Genie Code']] : []),
    ...(plan.refill || was('Genie build') ? [STAGE['Genie build']] : []),
    ...(plan.preview || was('Preview run') ? [STAGE['Preview run']] : []),
    ...(!plan.refill && genie ? [STAGE['Genie Code']] : []),
    ...acts.filter((a) => a.action !== 'delete').map(stageOf),
    ...(was(SELF_FIX_PHASE) ? [SELF_FIX_STAGE] : []),
    { ...FINISH_STAGE, working: finishWords(plan) },
  ];
}

function stageList(steps, latest, since) {
  const plan = versionPlan(steps, latest);
  const head = settingsRefused(steps, latest) ? [SETTINGS_STAGE] : [];
  if (!plan) return [...head, ...legacyStages(latest)];
  const seen = new Set(stepEvents(steps)
    .filter(({ payload, at }) => sameVersion(payload, latest) && !(since !== null && at !== null && at < since))
    .map(({ row, payload }) => stepPhase(row, payload).toLowerCase()));
  return [...head, ...plannedStages(plan, latest, seen)];
}

export function stagesPlanned(stages) {
  return (stages || []).some((s) => s.id === FINISH_STAGE.id);
}

export function mvpStages(steps, latest, { now = Date.now(), stalled = null } = {}) {
  const repair = mvpRepairOf(steps, latest);
  const since = repair && repair.step === WHOLE_BUILD ? repair.at : null;
  const stages = stageList(steps, latest, since).map((stage) => ({ ...stage, state: 'waiting', started: null, ended: null, round: null, rounds: null }));
  const indexOf = (phase) => stages.findIndex((s) => s.id.toLowerCase() === phase.toLowerCase()
    || (s.phases || []).some((p) => p.toLowerCase() === phase.toLowerCase()));
  const rank = { running: 0, done: 1, warning: 2, error: 3 };
  const seenAt = new Map();
  for (const { row, payload, at } of stepEvents(steps)) {
    if (since !== null && at !== null && at < since) continue;
    const index = indexOf(stepPhase(row, payload));
    if (index < 0) continue;
    const stage = stages[index];
    const state = STEP_STATES[String(row.status || '')];
    if (!state) continue;
    if (stage.started === null || (at !== null && at < stage.started)) stage.started = at;
    if (state !== 'running' && (stage.ended === null || (at !== null && at >= stage.ended))) stage.ended = at;
    const before = seenAt.has(index) ? seenAt.get(index) : undefined;
    const newer = before === undefined || at === null || before === null || at > before;
    const tie = at !== null && at === before && rank[state] >= rank[stage.state];
    if (newer || tie) {
      stage.state = state;
      stage.round = roundOf(payload);
      stage.rounds = Number.isInteger(Number(payload.rounds)) && Number(payload.rounds) > 0 ? Number(payload.rounds) : null;
      seenAt.set(index, at);
    }
  }
  const status = String(latest?.status || '');
  const held = status === IMPLEMENT_VIBE_NOT_MET;
  const finished = IMPLEMENT_DONE_STATUSES.includes(status) || held;
  const failed = status === 'failed';
  const active = IMPLEMENT_ACTIVE_STATUSES.includes(status);
  if (active) {
    stages.forEach((s, i) => {
      const restartedAt = seenAt.get(i);
      if (s.state !== 'running' || restartedAt === undefined || restartedAt === null) return;
      stages.slice(i + 1).forEach((later, offset) => {
        const laterAt = seenAt.get(i + 1 + offset);
        if (laterAt === undefined || laterAt === null || laterAt >= restartedAt) return;
        Object.assign(later, { state: 'waiting', started: null, ended: null, round: null, rounds: null });
        seenAt.delete(i + 1 + offset);
      });
    });
  }
  const last = stages.reduce((found, s, i) => (s.state !== 'waiting' ? i : found), -1);
  stages.forEach((s, i) => { if (s.state === 'waiting' && i < last) s.state = 'skipped'; });
  const finish = stages[stages.length - 1];
  if (finished) {
    if (held && finish.state !== 'error') finish.state = 'warning';
    else if (finish.state === 'waiting' || finish.state === 'running') finish.state = status === 'ready' ? 'done' : 'warning';
    stages.forEach((s) => { if (s.state === 'waiting') s.state = 'skipped'; });
  }
  if (failed) {
    if (!stages.some((s) => s.state === 'error')) {
      const broken = stages.find((s) => s.state === 'running') || stages.find((s) => s.state === 'waiting');
      if (broken) broken.state = 'error';
    }
    stages.forEach((s) => { if (s.state === 'running') s.state = 'error'; if (s.state === 'waiting') s.state = 'not_reached'; });
  }
  if (active && stalled) {
    stages.forEach((s) => { if (s.state === 'running') s.state = 'error'; if (s.state === 'waiting') s.state = 'not_reached'; });
  } else if (active && !stages.some((s) => s.state === 'running')) {
    const next = stages.find((s) => s.state === 'waiting');
    if (next) {
      next.state = 'next';
      next.started = stages.reduce((t, s) => (s.ended !== null && s.ended > (t ?? -Infinity) ? s.ended : t), null) ?? timeOf(latest?.created_at);
    }
  }
  for (const s of stages) {
    const end = ['running', 'next'].includes(s.state) ? now : s.ended;
    s.elapsed = s.started !== null && end !== null && end >= s.started ? formatDuration(end - s.started) : '';
    const [noted, label] = STAGE_NOTES[s.id] || [];
    s.notes = ['done', 'warning'].includes(s.state) && noted ? versionNotes(latest, noted).map((note) => `${label}: ${note}`) : [];
  }
  return stages;
}

export function progressPercent(chip, summary) {
  return chip?.tone === 'success' || chip?.tone === 'warning' ? 100 : summary?.percent ?? 0;
}

export function mvpProgressSummary(stages, latest, { now = Date.now(), stalled = null, repair = null } = {}) {
  const counted = stages.filter((s) => s.state !== 'skipped');
  const settled = counted.filter((s) => ['done', 'warning'].includes(s.state)).length;
  const current = stages.find((s) => ['running', 'next'].includes(s.state)) || null;
  const created = timeOf(latest?.created_at);
  const ended = stages.reduce((t, s) => (s.ended !== null && s.ended > (t ?? -Infinity) ? s.ended : t), null);
  const status = String(latest?.status || '');
  const active = IMPLEMENT_ACTIVE_STATUSES.includes(status) && !stalled;
  const span = created === null ? '' : formatDuration((active ? now : ended ?? now) - created);
  let headline = '';
  if (active && status === 'queued' && !current?.started) headline = 'Waiting for the build job to start';
  else if (active && current) headline = `${current.working}…`;
  else if (active) headline = 'Inspire is working…';
  const round = active && current?.state === 'running' && current.round > 1 ? current.round : null;
  const rounds = round ? `Round ${round}${current.rounds ? ` of ${current.rounds}` : ''}: Genie is fixing what failed in round ${round - 1}` : '';
  const fixing = stalled ? '' : repairLine(repair, status);
  return {
    active,
    current,
    percent: stagesPlanned(stages) && counted.length ? Math.round((settled / counted.length) * 100) : 0,
    headline,
    detail: [fixing, rounds].filter(Boolean).join('. '),
    span: span ? `${active ? 'Running for' : 'Took'} ${span}` : '',
  };
}

export function stagesRecorded(stages) {
  return (stages || []).some((s) => s.id !== FINISH_STAGE.id && s.state !== 'skipped');
}

const VIBE_HEADINGS = {
  Notebook: 'notebook', 'AI reasoning': 'ai_reasoning',
  Dashboard: 'dashboard', App: 'app', 'Genie Agent': 'genie_space', Alert: 'alert',
};
const PART_HEADINGS = [[/^Dashboard chart ([A-Za-z0-9_-]{1,64})$/, 'dashboard:'], [/^App page ([A-Za-z0-9_-]{1,64})$/, 'app:page:']];
const STAKE_FORMULA_HEADING = /^[^;:\n]+ at stake formula$/;
const VIBE_SENT = 'sent to ';
const VIBE_NOTE = /; (this ask changes the [^;]+)$/;
const VIBE_ROUTE_SPLIT = /; (?=(?:Notebook|AI reasoning|[^;:\n]+ at stake formula|Dashboard chart [A-Za-z0-9_-]+|App page [A-Za-z0-9_-]+|Dashboard|App|Genie Agent|Alert): )/;
const sentence = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

function headingId(heading) {
  if (Object.hasOwn(VIBE_HEADINGS, heading)) return VIBE_HEADINGS[heading];
  if (STAKE_FORMULA_HEADING.test(heading)) return 'value_formula';
  for (const [pattern, prefix] of PART_HEADINGS) {
    const match = pattern.exec(heading);
    if (match) return `${prefix}${match[1]}`;
  }
  return '';
}

export function vibeLine(line) {
  let text = String(line ?? '').trim();
  if (!text.startsWith(VIBE_SENT)) return null;
  text = text.slice(VIBE_SENT.length);
  const noted = VIBE_NOTE.exec(text);
  if (noted) text = text.slice(0, noted.index);
  const cut = text.indexOf(': ');
  const id = cut > 0 ? headingId(text.slice(0, cut)) : '';
  const words = cut > 0 ? text.slice(cut + 2).trim() : '';
  if (!id || !words) return null;
  return { id, words, note: noted ? noted[1] : '' };
}

function messageLines(message) {
  const text = String(message ?? '');
  const at = text.search(/(?:^|: )sent to /);
  if (at < 0) return [];
  const lines = [];
  for (const piece of text.slice(at).replace(/^: /, '').split('\n')) {
    if (!lines.length || piece.startsWith(VIBE_SENT)) lines.push(piece);
    else lines[lines.length - 1] += `\n${piece}`;
  }
  return lines.flatMap((line) => line.split(VIBE_ROUTE_SPLIT).map((chunk, i) => (i ? `${VIBE_SENT}${chunk}` : chunk)));
}

export function vibeRouting(steps, latest) {
  const assets = isMap(latest?.asset_status) ? latest.asset_status : {};
  const named = (id) => String(assets[id]?.name ?? assets[id]?.title ?? '').trim();
  const route = (id, words, note = '', fallback = []) => ({ id, label: partLabel(id, named(id), rowImpact(latest)), words: String(words ?? '').trim(), note, fallback });
  const text = vibesOf(latest);
  const saved = assets.vibe;
  if (isMap(saved) && Number(saved.spec_version) === Number(latest?.spec_version)) {
    const fallback = (Array.isArray(saved.fallback) ? saved.fallback : []).filter(isMap)
      .map((item) => ({ id: String(item.asset ?? '').trim(), ask: String(item.ask ?? '').trim(), reason: String(item.reason ?? '').trim() }))
      .filter((item) => item.id && item.ask && item.reason);
    return {
      state: 'routed',
      text: String(saved.text ?? '').trim() || text,
      routes: Object.entries(isMap(saved.routes) ? saved.routes : {})
        .map(([id, words]) => route(id, words, '', fallback.filter((item) => item.id === id))).filter((r) => r.words),
    };
  }
  let last = null;
  for (const event of stepEvents(steps)) if (isPhase(event.row, event.payload, VIBE_PHASE) && sameVersion(event.payload, latest)) last = event;
  if (!last && !text) return null;
  const base = { text, routes: [] };
  const status = String(last?.row?.status || '');
  if (!last || status === 'started') return { ...base, state: 'reading' };
  if (status === 'ended_error') return { ...base, state: 'failed' };
  const parsed = (Array.isArray(last.payload.lines) ? last.payload.lines : messageLines(last.row.message)).map(vibeLine).filter(Boolean);
  return {
    ...base,
    state: 'routed',
    routes: parsed.map((p) => route(p.id, p.words, p.note)),
  };
}

export function vibeRoutingLines(routing) {
  if (!routing || routing.state !== 'routed') return [];
  return routing.routes.map((r) => {
    const notes = [r.note, ...(r.fallback || []).map((item) => `“${item.ask.replace(/[.!?]+$/, '')}” went here because ${item.reason}, so Genie tries it there`)];
    return { kind: 'route', id: r.id, text: `Sent to the ${r.label}: “${r.words}”`, note: notes.filter(Boolean).map(sentence).join(' ') };
  });
}

export function mvpScope(steps, latest) {
  const plan = versionPlan(steps, latest);
  const vibe = vibeRoutingLines(vibeRouting(steps, latest));
  if (!plan || plan.pending || plan.classes.includes('initial')) return { pending: Boolean(plan?.pending), notes: [], vibe };
  const touched = new Set(planActions(plan).map((a) => a.id));
  const outputs = latest?.spec_json?.outputs || {};
  const hasNotebook = Boolean(latest?.asset_status?.notebook || latest?.notebook_path);
  const kept = [
    ...(!plan.refill && !plan.preview && hasNotebook ? ['the notebook'] : []),
    ...IMPLEMENT_OUTPUTS.filter((o) => outputs[o.id] && !touched.has(o.id)).map((o) => `the ${o.label}`),
  ];
  const unmanaged = plan.keep_unmanaged.map((id) => `the ${OUTPUT_LABEL[id]}`);
  const notes = [
    ...(plan.refill ? [{ kind: 'refill', text: 'This change reaches the analysis, so Genie rebuilds the notebook and every part after it' }] : []),
    ...(!plan.refill && plan.preview ? [{ kind: 'rerun', text: 'Inspire runs the notebook again on a preview; the notebook itself stays as it is' }] : []),
    ...(kept.length ? [{ kind: 'kept', text: `Kept as is: ${joinWords(kept)}` }] : []),
    ...(unmanaged.length ? [{ kind: 'unmanaged', text: `Left in place and no longer refreshed: ${joinWords(unmanaged)}` }] : []),
  ];
  return { pending: false, notes, vibe };
}

export const VIBE_CHECKLIST_PHASE = 'Vibe checklist';
export const SETTINGS_REFUSED = 'settings_refused';
export const SELF_FIX_KIND = 'self_fix';
export const UNREQUESTED_KIND = 'unrequested_change';
export const NOT_DECIDED_KIND = 'not_decided';
const SETTINGS_STAGE = { id: 'Settings', label: 'Settings change', working: 'Inspire is checking who may change the settings', phases: [VIBE_CHECKLIST_PHASE] };

function settingsRefused(steps, latest) {
  const summary = isMap(latest?.asset_status) ? latest.asset_status.checklist_summary : null;
  if (isMap(summary) && Number(summary.refused) > 0) return true;
  return stepEvents(steps).some(({ row, payload }) => isPhase(row, payload, VIBE_CHECKLIST_PHASE) && sameVersion(payload, latest) && Number(payload.refused) > 0);
}
const said = (value) => String(value ?? '').trim();

function listOf(value) {
  return Array.isArray(value) ? value : null;
}

function checklistEntry(raw, i) {
  const item = isMap(raw) ? raw : { requirement: raw };
  const n = Number(item.n);
  const rounds = Number(item.rounds);
  const anyway = isMap(item.published_anyway) ? item.published_anyway : null;
  const met = said(item.status).toLowerCase() === 'met';
  return {
    refused: said(item.kind) === SETTINGS_REFUSED,
    selfFixed: said(item.kind) === SELF_FIX_KIND,
    unrequested: said(item.kind) === UNREQUESTED_KIND,
    notDecided: said(item.kind) === NOT_DECIDED_KIND || said(item.status).toLowerCase() === NOT_DECIDED_KIND,
    n: Number.isInteger(n) && n > 0 ? n : i + 1,
    requirement: said(item.requirement),
    part: said(item.part),
    where: said(item.where),
    met,
    unchecked: !met && item.unchecked === true,
    evidence: said(item.evidence),
    rounds: Number.isInteger(rounds) && rounds > 0 ? rounds : null,
    tried: (listOf(item.tried) || []).map(said).filter(Boolean),
    checks: (listOf(item.checks) || []).filter(isMap).map((c) => ({ name: said(c.name), passed: c.passed === true })).filter((c) => c.name),
    publishedAnyway: anyway ? { by: said(anyway.by), at: said(anyway.at) } : null,
  };
}

function checklistFrom(list, live, row) {
  const entries = list.filter((item) => isMap(item) || said(item)).map(checklistEntry);
  const asks = entries.filter((e) => !e.refused && !e.selfFixed && !e.notDecided);
  const open = asks.filter((e) => !e.met && !e.publishedAnyway);
  return {
    live, version: row?.spec_version ?? null, entries, met: asks.filter((e) => e.met).length, total: asks.length,
    refused: entries.filter((e) => e.refused).length, selfFixed: entries.filter((e) => e.selfFixed).length,
    notDecided: entries.filter((e) => e.notDecided).length,
    missed: open.filter((e) => !e.unchecked).length, unchecked: open.filter((e) => e.unchecked).length,
  };
}

export function vibeChecklist(steps, row) {
  const recorded = listOf(isMap(row?.asset_status) ? row.asset_status.checklist : null);
  if (recorded) return checklistFrom(recorded, false, row);
  let last = null;
  for (const event of stepEvents(steps)) {
    if (isPhase(event.row, event.payload, VIBE_CHECKLIST_PHASE) && sameVersion(event.payload, row) && listOf(event.payload.checklist)) last = event;
  }
  return last ? checklistFrom(listOf(last.payload.checklist), true, row) : null;
}

const AGENT_STEP_CHARS = 1500;

export function checklistHeadline(checklist) {
  const entries = checklist.entries || [];
  const undecided = entries.find((e) => e.notDecided);
  if (undecided) return undecided.evidence;
  const refused = entries.find((e) => e.refused);
  if (refused) return [...`0 of ${checklist.refused} settings changes applied: ${refused.evidence}`].slice(0, AGENT_STEP_CHARS).join('');
  return `${checklist.met} of ${plural(checklist.total, 'vibe requirement')} met`
    + (checklist.selfFixed ? `; Inspire put back ${plural(checklist.selfFixed, 'element')} no ask targets` : '');
}

export function checklistPlace(entry, assets = {}) {
  const named = (id) => said(assets?.[id]?.name ?? assets?.[id]?.title);
  const label = entry.part ? partLabel(entry.part, named(entry.part), rowImpact({ asset_status: assets })) : '';
  return [label && `${label.charAt(0).toUpperCase()}${label.slice(1)}`, entry.where].filter(Boolean).join(', ');
}

export function checklistState(entry) {
  if (entry.refused) return 'refused';
  if (entry.notDecided) return 'not_decided';
  if (entry.selfFixed) return 'self_fixed';
  if (entry.met) return 'met';
  if (entry.publishedAnyway) return 'anyway';
  if (entry.unrequested) return 'unrequested';
  return entry.unchecked ? 'unchecked' : 'not_met';
}

const STATE_WORDS = {
  met: 'Met', anyway: 'Not met', not_met: 'Not met', unchecked: 'Could not be checked', refused: 'Settings change refused',
  self_fixed: 'Put back by Inspire', unrequested: 'Changed with no ask', not_decided: 'Not decided',
};

export function checklistRounds(entry) {
  return entry.rounds && !entry.unrequested ? `${STATE_WORDS[checklistState(entry)]} after ${plural(entry.rounds, 'round')}` : '';
}

export function checklistStatusText(entry) {
  return checklistRounds(entry) || STATE_WORDS[checklistState(entry)];
}

export function publishedAnywayText(entry) {
  const anyway = entry.publishedAnyway;
  if (!anyway) return '';
  return `Published anyway${anyway.by ? ` by ${anyway.by}` : ''}${anyway.at ? ` on ${formatWhen(anyway.at, anyway.at)}` : ''}`;
}

export function notMetAsks(checklist) {
  return (checklist?.entries || []).filter((e) => !e.met && !e.publishedAnyway && !e.refused && !e.notDecided);
}

export function missedAsks(checklist) {
  return notMetAsks(checklist).filter((e) => !e.unchecked);
}

export function rephrasableAsks(checklist) {
  return missedAsks(checklist).filter((e) => !e.unrequested);
}

export function feedLine(item) {
  const kind = String(item?.kind || '');
  const text = String(item?.text || '');
  if (kind === 'message') return { who: 'genie', tone: 'plain', text };
  if (kind === 'stopped') return { who: 'genie', tone: 'warning', text: `Stopped: ${text}` };
  if (kind === 'error') return { who: 'genie', tone: 'error', text: `Genie hit an error: ${text}` };
  if (kind === 'turn_done') return { who: 'genie', tone: 'quiet', text: 'Genie finished its turn' };
  if (kind === 'activity') {
    const commands = Number(item.commands) || 0;
    const failed = Number(item.failed) || 0;
    const files = Array.isArray(item.files) ? item.files : [];
    const parts = [];
    if (commands) parts.push(`Ran ${plural(commands, 'command')}${failed ? ` (${failed} failed)` : ''}`);
    if (files.length) parts.push(`${parts.length ? 'edited' : 'Edited'} ${files.join(', ')}`);
    return { who: 'genie', tone: 'quiet', text: parts.join(' · ') };
  }
  if (kind === 'run') {
    const what = item.check ? 'The alert check run' : 'The preview run';
    const state = String(item.state || '');
    const result = String(item.result || '');
    const after = Number(item.seconds) > 0 ? ` (${formatDuration(Number(item.seconds) * 1000)})` : '';
    if (RUN_STARTING_STATES.includes(state)) return { who: 'inspire', tone: 'quiet', text: `${what} is starting${after}` };
    if (state === 'RUNNING' || state === 'TERMINATING') return { who: 'inspire', tone: 'quiet', text: `${what} is running${after}` };
    if (state === 'TERMINATED' && result === 'SUCCESS') return { who: 'inspire', tone: 'plain', text: `${what} finished${after}` };
    return { who: 'inspire', tone: 'error', text: `${what} ended: ${[state, result].filter(Boolean).join(' / ')}${after}` };
  }
  if (kind === 'failed') return { who: 'inspire', tone: 'error', text };
  if (kind === 'note') return { who: 'inspire', tone: 'quiet', text };
  return null;
}

export function feedKey(item) {
  return `${item?.at || ''}|${item?.kind || ''}|${String(item?.text || item?.run_id || '').slice(0, 60)}`;
}

export const FEED_WORDS_PER_SECOND = 12;

export function typedText(text, elapsedMs, wordsPerSecond = FEED_WORDS_PER_SECOND) {
  const value = String(text || '');
  const tokens = value.split(/(\s+)/);
  const words = Math.max(0, Math.floor((Math.max(0, Number(elapsedMs) || 0) / 1000) * wordsPerSecond));
  let shown = 0;
  let out = '';
  for (const token of tokens) {
    if (!/^\s+$/.test(token) && token) {
      if (shown >= words) return out.trimEnd();
      shown += 1;
    }
    out += token;
  }
  return out;
}

export function typingDone(text, elapsedMs, wordsPerSecond = FEED_WORDS_PER_SECOND) {
  return typedText(text, elapsedMs, wordsPerSecond) === String(text || '');
}

export function feedTypesOut(item) {
  return ['message', 'stopped', 'error'].includes(String(item?.kind || ''));
}

const newestOf = (feed) => feed.reduce((most, item) => {
  const at = Date.parse(item?.until || item?.at || '');
  return Number.isFinite(at) && at > most ? at : most;
}, -Infinity);

const buildOf = (status) => {
  const latest = status?.latest || {};
  return [latest.session_id, latest.use_case_id, latest.spec_version, latest.implement_run_id].map((v) => String(v ?? '')).join('|');
};

export function steadyFeed(previous, next) {
  const before = previous?.feed;
  const after = next?.feed;
  if (!next || !Array.isArray(before) || !before.length || buildOf(previous) !== buildOf(next)) return next;
  const list = Array.isArray(after) ? after : [];
  if (list.length >= before.length && newestOf(list) >= newestOf(before)) return next;
  return { ...next, feed: before };
}

export function feedArrivals(previous, feed, at) {
  const next = new Map(previous || []);
  for (const item of Array.isArray(feed) ? feed : []) {
    const key = feedKey(item);
    if (!next.has(key)) next.set(key, previous ? at : 0);
  }
  return next;
}

export function typingSchedule(feed, arrivals, wordsPerSecond = FEED_WORDS_PER_SECOND) {
  const starts = new Map();
  let end = 0;
  for (const item of Array.isArray(feed) ? feed : []) {
    const key = feedKey(item);
    const arrived = arrivals?.get(key) || 0;
    if (!arrived || !feedTypesOut(item)) continue;
    const line = feedLine(item);
    if (!line?.text) continue;
    const start = Math.max(arrived, end);
    end = start + (line.text.split(/\s+/).filter(Boolean).length / wordsPerSecond) * 1000;
    starts.set(key, start);
  }
  return { starts, end };
}
