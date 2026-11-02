import { stakeWords } from './targetKpi.js';

export const SETTING_ALL = 'all';
export const ASSUMPTION_BOUNDS = { percent: [0, 1, '0 to 1'], money: [0, null, 'at least 0'], number: [null, null, 'any number'] };
export const SETTING_GROUPS = ['impact', 'flagging', 'scope', 'alerts'];
export const NOT_SETTINGS = ['result_table', 'model_name', 'ai_endpoint', 'as_of_date', 'currency', 'run_profile'];
export const TIER_SETTINGS = { measured: ['act_now_amount', 'review_amount'], predicted: ['act_now_share', 'review_share'] };
export const FAMILY_FLAGGING = { A: ['min_probability'], B: ['alert_quantile', 'max_alerts_per_run'], C: ['flag_segments'], D: ['min_score', 'items_per_entity'],
  E: ['min_deviation'], F: [], G: [], H: [] };
export const ALERT_THRESHOLD_SETTING = 'alert_threshold';
export const SETTINGS_ASSUMPTIONS_LATER = 'Genie proposes the assumptions of what is at stake on each record, with their lowest and highest values, '
  + 'when the notebook first runs; you set them here after that run.';
export const SETTINGS_ON_THEIR_STEP = 'The rules that flag records and the use case\u2019s own settings are on the Settings step.';
export const SETTINGS_STEP_NOTE = 'How this use case counts what is at stake and flags records. Every value stays inside the range Genie declared, and owners change '
  + 'them later on the Build page or in the App.';
export const SETTINGS_NO_REBUILD = 'Saved as a setting, no rebuild';
export const SETTINGS_REBUILDS = 'Rebuilds the notebook';
export const SETTINGS_ALERT_REFRESH = 'Rebuilds the alert';
export const SETTINGS_NEXT_RUN = 'Stored results follow at the next run.';
export const SETTINGS_SAVED = 'Saved by an owner';
export const SETTINGS_NOTE_MAX = 300;
export const SETTINGS_NOTE_LABEL = 'Note for the settings change';
export const SETTINGS_NOTE_PLACEHOLDER = 'Why, saved with each setting this version changes (optional)';

export const SETTINGS_ROUTES = {
  read: '/api/inspire/implement/settings',
  preview: '/api/inspire/implement/settings/preview',
  save: '/api/inspire/implement/settings/save',
  run: '/api/inspire/implement/settings/run',
  runs: '/api/inspire/implement/runs',
};

export function settingsViewSaved(prev, view) {
  return { ...prev, settings: view.settings || [], history: view.history || [], editable: view.editable === true, can_run: view.can_run === true,
    why: String(view.why || '') };
}

const HIDDEN_WIDGETS = ['dbx_inspire_ai_child_run', 'refresh_requested_by'];
const SETTING_NUMBER_RE = /^-?[0-9]+(?:\.[0-9]+)?$/;
export const WIDGET_NUMBER_RE = SETTING_NUMBER_RE;
const ALLOWED_NUMBER = '(-?[0-9]+(?:\\.[0-9]+)?)';
const ALLOWED_RE = new RegExp(`^(?:(whole number)(?:, |$))?(?:${ALLOWED_NUMBER} to ${ALLOWED_NUMBER}|(at least|above|greater than|more than) ${ALLOWED_NUMBER}(?: and (at most|below|less than) ${ALLOWED_NUMBER})?|(at most|below|less than) ${ALLOWED_NUMBER})?$`);
const ALLOWED_OPEN_WORDS = ['above', 'greater than', 'more than', 'below', 'less than'];
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function allowedRule(text) {
  const value = String(text ?? '').trim();
  const match = ALLOWED_RE.exec(value.toLowerCase() === 'any' ? '' : value);
  if (!match) return null;
  const [, whole, from, to, lowWord, lowValue, highWord, highValue, onlyHighWord, onlyHighValue] = match;
  const low = from ?? lowValue;
  const high = to ?? highValue ?? onlyHighValue;
  return {
    low: low !== undefined ? Number(low) : null,
    high: high !== undefined ? Number(high) : null,
    whole: Boolean(whole),
    lowOpen: ALLOWED_OPEN_WORDS.includes(lowWord),
    highOpen: ALLOWED_OPEN_WORDS.includes(highWord ?? onlyHighWord),
  };
}

export function numberText(value) {
  return Number(value).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function allowedText(rule) {
  const { low = null, high = null, whole = false, lowOpen = false, highOpen = false } = rule || {};
  const bounds = low !== null && high !== null && !lowOpen && !highOpen
    ? `${numberText(low)} to ${numberText(high)}`
    : [
      low !== null ? `${lowOpen ? 'above' : 'at least'} ${numberText(low)}` : '',
      high !== null ? `${highOpen ? 'below' : 'at most'} ${numberText(high)}` : '',
    ].filter(Boolean).join(' and ');
  if (!whole) return bounds;
  return bounds ? `whole number, ${bounds}` : 'whole number';
}

export function widgetValueProblem(name, value, allowed) {
  const rule = allowedRule(allowed);
  if (!rule || (rule.low === null && rule.high === null && !rule.whole)) return '';
  const text = String(value ?? '').trim();
  const number = WIDGET_NUMBER_RE.test(text) && !(rule.whole && text.includes('.')) ? Number(text) : null;
  const belowLow = rule.low !== null && (rule.lowOpen ? number <= rule.low : number < rule.low);
  const aboveHigh = rule.high !== null && (rule.highOpen ? number >= rule.high : number > rule.high);
  if (number === null || belowLow || aboveHigh) {
    return `${name} is '${text}'; allowed: ${allowedText(rule)}`;
  }
  return '';
}

export function widgetSetProblems(values) {
  const number = (name) => {
    const text = String(values[name] ?? '').trim();
    return WIDGET_NUMBER_RE.test(text) ? Number(text) : null;
  };
  const problems = [];
  const act = number('act_now_share');
  const review = number('review_share');
  if (act !== null && review !== null && act + review > 1 + 1e-9) {
    problems.push(`act_now_share + review_share is ${numberText(act + review)}; allowed: at most 1`);
  }
  const actAmount = number('act_now_amount');
  const reviewAmount = number('review_amount');
  if (actAmount !== null && reviewAmount !== null && reviewAmount > actAmount) {
    problems.push(`review_amount is ${numberText(reviewAmount)}, above act_now_amount ${numberText(actAmount)}; `
      + 'a record needs at least as much at stake to act on now as to review');
  }
  for (const lowName of Object.keys(values).sort()) {
    const highName = `max_${lowName.slice(4)}`;
    if (!lowName.startsWith('min_') || !Object.prototype.hasOwnProperty.call(values, highName)) continue;
    const low = number(lowName);
    const high = number(highName);
    if (low !== null && high !== null && low > high) problems.push(`${lowName} is ${numberText(low)}, above ${highName} ${numberText(high)}`);
  }
  return problems;
}

export function settingProblem(setting, value) {
  const s = isMap(setting) ? setting : {};
  const name = String(s.name || '');
  const text = String(value == null ? '' : value).trim();
  if (s.kind === 'choice') {
    const choices = (Array.isArray(s.choices) ? s.choices : []).map(String);
    const picked = s.many ? text.split(',').map((part) => part.trim()).filter(Boolean) : [text];
    const allowed = [...choices, ...(s.many ? [SETTING_ALL] : [])];
    const wrong = picked.filter((part) => choices.length && !allowed.includes(part));
    if (!text || wrong.length) return `${name} is '${text}'; allowed: ${choices.length ? allowed.join(', ') : 'any text'}`;
    return '';
  }
  const { low = null, high = null } = s;
  const number = SETTING_NUMBER_RE.test(text) && !(s.whole && text.includes('.')) ? Number(text) : null;
  if (number === null || (low != null && (s.low_open ? number <= low : number < low)) || (high != null && (s.high_open ? number >= high : number > high))) {
    return `${name} is '${text}'; allowed: ${s.allowed || 'a number'}`;
  }
  return '';
}

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function assumptionSetting(name, kind, low = null, high = null) {
  const known = Object.prototype.hasOwnProperty.call(ASSUMPTION_BOUNDS, kind) ? kind : 'number';
  if (finiteNumber(low) && finiteNumber(high)) return { name, kind: known, low, high, allowed: `${numberText(low)} to ${numberText(high)}` };
  const [baseLow, baseHigh, allowed] = ASSUMPTION_BOUNDS[known];
  return { name, kind: known, low: baseLow, high: baseHigh, allowed };
}

export function settingsModelOf(history) {
  const rows = [...(Array.isArray(history) ? history : [])].filter(isMap).sort((a, b) => (b.spec_version || 0) - (a.spec_version || 0));
  const row = rows.find((r) => isMap(r.asset_status) && Object.prototype.hasOwnProperty.call(r.asset_status, 'settings'));
  return row && Array.isArray(row.asset_status.settings) ? row.asset_status.settings.filter(isMap) : null;
}

export const isSettingWidget = (widget) => {
  const name = String(widget?.name || '');
  return Boolean(name) && !NOT_SETTINGS.includes(name) && !HIDDEN_WIDGETS.includes(name);
};

function widgetKind(name, widget, rule) {
  if (name === 'flag_segments' || widget.type === 'dropdown') return 'choice';
  if (rule.whole) return name.endsWith('_days') ? 'days' : 'integer';
  return rule.low === 0 && rule.high === 1 && !rule.lowOpen && !rule.highOpen ? 'percent' : 'number';
}

export function wizardSettings({ model = null, widgets = [], spec = null, family = '', editing = false } = {}) {
  const list = [];
  const seen = new Set();
  const recorded = Array.isArray(model);
  for (const s of recorded ? model : []) {
    const name = String(s.name || '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const change = s.source === 'alert' ? SETTINGS_ALERT_REFRESH : SETTINGS_NO_REBUILD;
    list.push({ ...s, name, label: String(s.label || name), derived: false, change });
  }
  const flagging = new Set([...TIER_SETTINGS.measured, ...TIER_SETTINGS.predicted, ...(FAMILY_FLAGGING[family] || [])]);
  for (const widget of Array.isArray(widgets) ? widgets : []) {
    const name = String(widget?.name || '');
    if (!isSettingWidget(widget) || seen.has(name)) continue;
    seen.add(name);
    const rule = allowedRule(widget.allowed) || { low: null, high: null, whole: false, lowOpen: false, highOpen: false };
    list.push({
      name, label: String(widget.label || name), group: flagging.has(name) ? 'flagging' : 'scope', kind: widgetKind(name, widget, rule),
      low: rule.low, high: rule.high, whole: rule.whole, low_open: rule.lowOpen, high_open: rule.highOpen,
      allowed: String(widget.allowed || '').trim() || allowedText(rule) || 'any value', choices: Array.isArray(widget.choices) ? widget.choices.map(String) : [],
      many: name === 'flag_segments', default: widget.default == null ? '' : String(widget.default), source: 'widget', derived: true, unit: '',
      change: editing ? SETTINGS_REBUILDS : '',
    });
  }
  if (spec?.outputs?.alert && !list.some((s) => s.source === 'alert')) {
    list.push({ name: ALERT_THRESHOLD_SETTING, label: 'Alert threshold', group: 'alerts', kind: 'number', low: 0, high: null, allowed: 'at least 0', unit: 'records',
      source: 'alert', derived: true, default: '', change: editing ? SETTINGS_ALERT_REFRESH : '' });
  }
  const order = (s) => (SETTING_GROUPS.includes(s.group) ? SETTING_GROUPS.indexOf(s.group) : SETTING_GROUPS.length);
  return list.map((s, at) => [s, at]).sort(([a, i], [b, j]) => order(a) - order(b) || i - j).map(([s]) => s);
}

function chosenValue(spec, setting) {
  if (setting.source === 'alert') return spec?.outputs?.alert_threshold;
  const held = setting.source === 'assumption' ? spec?.config?.assumptions : spec?.config?.widgets;
  return isMap(held) && Object.prototype.hasOwnProperty.call(held, setting.name) ? held[setting.name] : undefined;
}

const shown = (value) => (value == null ? '' : typeof value === 'number' ? numberText(value) : String(value));

export function settingValueText(setting, value) {
  const text = shown(value).trim();
  if (!text) return '';
  if (setting?.kind === 'percent') return WIDGET_NUMBER_RE.test(text) ? `${numberText(Number((Number(text) * 100).toPrecision(12)))}%` : text;
  if (setting?.unit === '%') return `${text}%`;
  return setting?.unit ? `${text} ${setting.unit}` : text;
}

export function settingUnitLabel(setting) {
  return setting?.unit && setting.kind !== 'percent' ? ` (${setting.unit})` : '';
}

export function settingValue(spec, setting) {
  const chosen = chosenValue(spec, setting);
  return shown(chosen === undefined || chosen === '' ? setting.default : chosen);
}

export function withSetting(spec, setting, text) {
  if (setting.source === 'alert') return { ...spec, outputs: { ...spec.outputs, alert_threshold: text } };
  const key = setting.source === 'assumption' ? 'assumptions' : 'widgets';
  const held = { ...(isMap(spec.config?.[key]) ? spec.config[key] : {}) };
  if (String(text).trim() === '') delete held[setting.name];
  else held[setting.name] = text;
  return { ...spec, config: { ...spec.config, [key]: held } };
}

export function settingIssue(spec, setting) {
  const chosen = chosenValue(spec, setting);
  if (chosen === undefined || setting.source === 'alert') return '';
  return setting.derived ? widgetValueProblem(setting.name, chosen, setting.allowed) : settingProblem(setting, chosen);
}

export function settingsNoteOf(spec) {
  const note = isMap(spec?.config) ? spec.config.settings_note : '';
  return typeof note === 'string' ? note : '';
}

export function withSettingsNote(spec, text) {
  const note = String(text ?? '');
  if (!isMap(spec?.config)) return spec;
  if (!note.trim() && !Object.prototype.hasOwnProperty.call(spec.config, 'settings_note')) return spec;
  return { ...spec, config: { ...spec.config, settings_note: note.trim() ? note : '' } };
}

export function settingsNoteProblem(spec) {
  const length = [...settingsNoteOf(spec).trim()].length;
  return length > SETTINGS_NOTE_MAX ? `config.settings_note must be at most ${SETTINGS_NOTE_MAX} characters, not ${length}` : '';
}

export function settingsProblems(spec, settings) {
  const problems = (settings || []).map((s) => settingIssue(spec, s)).concat(settingsNoteProblem(spec)).filter(Boolean);
  const values = Object.fromEntries((settings || []).filter((s) => s.source === 'widget').map((s) => [s.name, settingValue(spec, s)]));
  return problems.concat(widgetSetProblems(values));
}

export function settingGroupTitle(group, impact) {
  return {
    impact: `How the ${stakeWords(impact)} is counted`,
    flagging: 'How records are flagged',
    scope: 'What the run reads',
    alerts: 'Alerts',
  }[group] || 'Other settings';
}

export function settingHistoryLine(entry, settings) {
  const known = (settings || []).find((s) => s.name === entry.name);
  const label = known ? known.label || entry.name : entry.name;
  const note = String(entry.note || '').trim();
  return `${entry.changed_by || 'Someone'} set ${label} to ${settingValueText(known || entry, entry.value)}${note ? `: ${note}` : ''}`;
}
