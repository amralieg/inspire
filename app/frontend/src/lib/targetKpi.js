import { formatDay } from './formatWhen.js';
import { isFilterMismatchReason } from './kpiFilter.js';
import { pyCasefold, pySpaced, pyTruthy } from './pythonText.js';
import { v130View } from './v130UseCase.js';

export const KPI_TARGET_MAX = 200;
export const KPI_INSPIRE_PICKS = 'Let Inspire pick';
export const IMPACT_KINDS = ['money', 'count', 'hours', 'percent', 'number'];
export const KPI_STATUSES = ['measured', 'not_measured', 'failed'];
export const KPI_NOT_MEASURED = 'Not measured';
export const KPI_PICK_RULE = 'Inspire picks it when it builds: your strategy\u2019s KPI, else the first it can compute. Records count in its unit, and in money only for a money KPI.';
export const KPI_NONE_YET = 'This use case has no Inspire KPI yet, so Inspire evaluates the best KPIs for it from its tables when it builds. '
  + 'After the build you can pick one of them here.';
export const KPI_CHANGE_NOTE = 'A new target KPI rebuilds the notebook, so every run counts records in the new KPI\u2019s unit.';

const DIRECTIONS = { increase: 'Increase', decrease: 'Decrease', maintain: 'Maintain' };
const SYMBOLS = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', AED: 'AED ', SAR: 'SAR ', JPY: '\u00a5', INR: '\u20b9' };

const spaced = pySpaced;
const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const lower = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const sentence = (text) => capital(/[.!?]$/.test(text) ? text : `${text}.`);
const finite = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

export const kpiKey = (name) => pyCasefold(spaced(name));

const newestFirst = (rows) => [...(Array.isArray(rows) ? rows : [])].filter(isMap).sort((a, b) => (b.spec_version || 0) - (a.spec_version || 0));

function recordedRow(history) {
  return newestFirst(history).find((row) => isMap(row.asset_status) && isMap(row.asset_status.target_kpi)) || null;
}

export function trackedKpiOf(history, latest = null) {
  const row = recordedRow([...(latest ? [latest] : []), ...(Array.isArray(history) ? history : [])]);
  const record = row ? row.asset_status.target_kpi : null;
  return record && spaced(record.name) ? { record: { ...record, spec_version: row.spec_version ?? null }, impact: rowImpact(row) } : null;
}

function namedList(list) {
  const out = [];
  for (const item of list) {
    const name = spaced(item?.name);
    if (name && !out.some((o) => kpiKey(o.name) === kpiKey(name))) out.push({ name, unit: spaced(item.unit), direction: spaced(item.direction).toLowerCase() });
  }
  return out;
}

export function kpiTargetOptions(uc, history = []) {
  const own = namedList(v130View(uc).kpis);
  if (own.length) return own;
  const row = recordedRow(history);
  const recorded = row ? row.asset_status.target_kpi : null;
  if (!recorded || recorded.source !== 'evaluated') return [];
  const evaluated = Array.isArray(recorded.evaluated) ? recorded.evaluated.filter(isMap) : [];
  const names = Array.isArray(recorded.options) ? recorded.options : evaluated.map((k) => k.name);
  return namedList(names.map((name) => evaluated.find((k) => kpiKey(k.name) === kpiKey(name)) || { name }));
}

export function kpiTargetOf(spec) {
  return isMap(spec?.kpi) && typeof spec.kpi.target === 'string' ? spec.kpi.target.trim() : '';
}

export function withKpiTarget(spec, name) {
  const target = String(name ?? '').trim();
  const { kpi: _kpi, ...rest } = spec || {};
  return target ? { ...rest, kpi: { target } } : rest;
}

export function kpiTargetProblems(spec, options = []) {
  const target = kpiTargetOf(spec);
  if (!target) return [];
  const size = [...target].length;
  if (size > KPI_TARGET_MAX) return [`the target KPI name is ${size} characters; at most ${KPI_TARGET_MAX} are allowed`];
  if (options.some((o) => kpiKey(o.name) === kpiKey(target))) return [];
  if (!options.length) return [`this use case has no KPI to pick yet, so choose ${KPI_INSPIRE_PICKS}: Inspire evaluates the best KPIs for it when it builds`];
  return [`'${target}' is not one of this use case\u2019s KPIs, so pick one from the list or ${KPI_INSPIRE_PICKS}`];
}

export function kpiOptionLabel(option) {
  return option.unit ? `${option.name} (${option.unit})` : option.name;
}

export function impactOf(source) {
  if (!isMap(source)) return null;
  const kind = spaced(source.impact_kind ?? source.kind).toLowerCase();
  if (IMPACT_KINDS.includes(kind) && kind !== 'money') return { kind, unit: spaced(source.impact_unit ?? source.unit) };
  return { kind: 'money', unit: (kind === 'money' ? spaced(source.impact_unit ?? source.unit) : '') || spaced(source.currency) };
}

export function rowImpact(row) {
  if (!isMap(row)) return null;
  const notebook = isMap(row.asset_status) ? row.asset_status.notebook : null;
  return impactOf(isMap(notebook?.impact) ? notebook.impact : {});
}

export function liveImpact(run, fallback = null) {
  if (spaced(run?.impact_kind) || (isMap(run) && (!fallback || fallback.kind === 'money'))) return impactOf(run);
  return fallback;
}

export function stakeLabel(impact) {
  if (!impact) return 'At stake';
  return impact.kind === 'money' ? 'Money at stake' : `${capital(impact.unit || impact.kind)} at stake`;
}

export function stakeWords(impact) {
  if (!isMap(impact)) return 'amount at stake';
  const kind = spaced(pyTruthy(impact.kind) ? String(impact.kind) : 'money').toLowerCase();
  if (kind === 'money') return 'money at stake';
  if (!IMPACT_KINDS.includes(kind)) return 'amount at stake';
  return `${spaced(pyTruthy(impact.unit) ? String(impact.unit) : '') || kind} at stake`;
}

export function stakeCurrency(impact) {
  return impact?.kind === 'money' ? impact.unit : '';
}

export function stakeAmount(value, impact) {
  const n = finite(value);
  if (n == null) return '';
  const text = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return impact?.unit ? `${text} ${impact.unit}` : text;
}

function compactNumber(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${sign}${a % 1 ? a.toFixed(2) : String(a)}`;
}

export function stakeShort(value, impact) {
  const n = finite(value);
  if (n == null) return '';
  const symbol = impact?.kind === 'money' ? SYMBOLS[impact.unit] : '';
  if (symbol) return `${n < 0 ? '-' : ''}${symbol}${compactNumber(Math.abs(n))}`;
  return impact?.unit ? `${compactNumber(n)} ${impact.unit}` : compactNumber(n);
}

export function kpiValue(value, unit) {
  const n = finite(value);
  if (n == null) return '';
  const text = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit === '%' ? `${text}%` : unit ? `${text} ${unit}` : text;
}

export function kpiPickText(record) {
  if (!record) return '';
  if (record.picked_by === 'user') return 'You picked it.';
  if (record.source === 'evaluated') {
    return 'Inspire picked it: this use case has no Inspire KPI, so Inspire evaluated the KPIs that best measure it from its tables and tracks the first.';
  }
  if (record.kpi_id) return 'Inspire picked it: your strategy links it to this use case.';
  return record.computable
    ? 'Inspire picked it: it is the first KPI of this use case Inspire can compute from its tables.'
    : 'Inspire picked it: it is the first KPI of this use case Inspire could compute, or its first KPI when Inspire could compute none.';
}

export function impactText(impact) {
  if (!impact) return '';
  return impact.kind === 'money' ? 'Each record is counted in money at stake.' : `Each record is counted in ${stakeWords(impact)}, not money.`;
}

export function trackedKpiText(record, impact) {
  if (!record) return '';
  const unit = spaced(record.unit);
  const version = record.spec_version == null ? 'The built version' : `v${record.spec_version}`;
  return `${version} tracks ${spaced(record.name)}${unit ? `, in ${unit},` : ''} and counts each record in ${stakeWords(impact)}. ${kpiPickText(record)}`;
}

function pendingNote(record, measured) {
  if (!record.computable) return `${KPI_NOT_MEASURED}: ${spaced(record.reason) || 'Inspire has no query for it'}`;
  if (measured) return `Not measured yet: the notebook has not run since Inspire started tracking ${spaced(record.name)}`;
  return 'Not measured yet: the notebook has not run since this version was built';
}

export function summaryRowIsKpi(record, reported) {
  if (!isMap(reported)) return false;
  if (!isMap(record) || !Object.prototype.hasOwnProperty.call(record, 'prior_rows')) return true;
  const rowQuery = spaced(reported.query);
  const own = spaced(record.query);
  if (rowQuery) return rowQuery === own;
  if (reported.status !== 'measured') return !own;
  return record.prior_rows === true && spaced(reported.unit) === spaced(record.unit);
}

export function targetKpiView(record, run, impact = null) {
  const recorded = isMap(record) && spaced(record.name) ? record : null;
  const reported = isMap(run?.kpi) && spaced(run.kpi.name) ? run.kpi : null;
  if (!recorded && !reported) return null;
  const name = spaced(recorded ? recorded.name : reported.name);
  const measured = reported && kpiKey(reported.name) === kpiKey(name) && summaryRowIsKpi(recorded, reported) ? reported : null;
  const mismatch = isFilterMismatchReason(recorded && !recorded.computable ? recorded.reason : '') || isFilterMismatchReason(measured?.reason);
  const unit = spaced(recorded?.unit || measured?.unit);
  const status = measured ? (KPI_STATUSES.includes(measured.status) ? measured.status : 'not_measured') : 'pending';
  const latest = status === 'measured' && !mismatch ? finite(measured.latest) : null;
  const baseline = mismatch ? null : finite(measured?.baseline ?? recorded?.baseline);
  const target = mismatch ? null : finite(measured?.target ?? recorded?.target);
  const targetText = spaced(measured?.target_text || recorded?.target_text);
  const reason = (mismatch && recorded && !recorded.computable ? spaced(recorded.reason) : '') || spaced(measured?.reason);
  let note = '';
  if (status === 'pending') note = pendingNote(recorded, Boolean(reported));
  else if (mismatch || status !== 'measured' || latest == null) note = `${KPI_NOT_MEASURED}: ${reason || 'Inspire has no query for it'}`;
  const direction = spaced(recorded?.direction || measured?.direction).toLowerCase();
  const flag = mismatch || status === 'not_measured' || status === 'failed' ? ''
    : spaced(recorded?.baseline_reason) || (status === 'measured' ? spaced(measured.reason) : '');
  return {
    name, unit, status, note, tone: status === 'failed' ? 'error' : 'warning',
    baselineFlag: flag ? `Baseline: ${sentence(flag)}` : '',
    direction: DIRECTIONS[direction] || '',
    why: kpiPickText(recorded),
    baseline: kpiValue(baseline, unit) || KPI_NOT_MEASURED,
    baselineOn: baseline == null ? '' : formatDay(measured?.baseline_on || recorded?.baseline_on),
    latest: latest == null ? KPI_NOT_MEASURED : kpiValue(latest, unit),
    latestOn: latest == null ? '' : formatDay(measured.measured_at),
    target: kpiValue(target, unit) || targetText || 'No target set',
    hasTarget: target != null,
    targetText,
    impact,
    version: recorded?.spec_version ?? null,
  };
}

export function kpiLine(view) {
  if (!view) return '';
  if (view.note) return `Target KPI: ${view.name}, ${lower(view.note)}.`;
  const goal = view.hasTarget ? `against a target of ${view.target}` : view.targetText ? `against the target \u201c${view.targetText}\u201d` : 'with no target set';
  const from = view.baseline !== KPI_NOT_MEASURED ? `, from a baseline of ${view.baseline}` : '';
  return `Target KPI: ${view.name}, ${view.latest} ${goal}${from}.${view.baselineFlag ? ` ${view.baselineFlag}` : ''}`;
}
