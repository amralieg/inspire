import { fieldOf, isBlankField } from './useCaseFields.js';
import { KPI_BASELINE_MISMATCH, KPI_FILTER_MISMATCH_TEXT, kpiFilterMismatch, kpiFilterShown } from './kpiFilter.js';
import { placeholderWords } from './placeholderWords.js';
import { useCaseKindView } from './useCaseKind.js';
import {
  PYTHON_DIGIT as DIGIT, PYTHON_SPACE as SPACE, PYTHON_WORD as WORD, pyFloat, pyRegexLiteral, pySpaced, pyStr, pyStrip, pyTruthy,
} from './pythonText.js';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const STRATEGY_NOT_ALIGNED = 'Not aligned';
export const STRATEGY_BUILTIN_NO_MATCH = 'General Improvement';
export const STRATEGY_PATH_SEPARATOR = ' > ';
export const NOT_ALIGNED_FILTER = '__not_aligned__';
export const STRATEGY_NOT_TIED = 'Not tied to your strategy';
export const STRATEGY_BUILTIN_NOTE = 'No strategy was given, so Inspire used its built-in goals.';
export const FEEDBACK_STATUSES = ['accepted', 'planned', 'implemented', 'rejected'];
export const FEEDBACK_LABELS = { accepted: 'Accepted', planned: 'Planned', implemented: 'Implemented', rejected: 'Rejected' };
export const FEEDBACK_OFF_TEXT = 'Feedback turns on after the next Inspire run in this Inspire Database; then mark each use case Accepted, Planned, Implemented or Reject on its card.';
export const FEEDBACK_EMPTY_TEXT = 'No feedback yet: open a use case, mark it Accepted, Planned, Implemented or Reject, and it shows here.';

export const V130_TRACKING_FIELDS = [
  'strategy_alignment', 'strategy_path', 'kpis', 'expected_key_results', 'measures_of_success',
  'financial_benefits', 'non_financial_benefits', 'data_evidence', 'foundation_ids', 'use_case_key',
  'best_of_best', 'best_of_best_rank', 'best_of_best_score', 'best_of_best_reason',
  'use_case_kind', 'kind_family', 'app_layout', 'serving_summary', 'method_summary', 'value_source', 'selection_basis',
  'selection_replaced', 'selection_score_gap', 'name_with_technique', 'suggested_group_by', 'record_level',
  'value_estimate', 'value_estimate_text',
];

const KPI_UP = /\b(increase|increasing|up|higher|maximi[sz]e|raise|grow|growth)\b/i;
const KPI_DOWN = /\b(decrease|decreasing|down|lower|minimi[sz]e|reduce|reduction|cut|decline)\b/i;

export function parseJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '[' && text[0] !== '{')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function textList(value) {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (typeof parsed === 'string') return parsed.split('\n').map((item) => item.trim()).filter(Boolean);
  return [];
}

function objectList(value) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
}

function bestOfBestOf(u) {
  if (String(u.best_of_best ?? '').trim().toUpperCase() !== 'Y') return null;
  const rank = Number.parseInt(String(u.best_of_best_rank ?? ''), 10);
  const score = Number.parseFloat(String(u.best_of_best_score ?? ''));
  return {
    rank: Number.isFinite(rank) ? rank : null,
    score: Number.isFinite(score) ? score : null,
    reason: String(u.best_of_best_reason ?? '').trim(),
  };
}

export function compareBestOfBestFirst(a, b) {
  const rank = (view) => (view?.bestOfBest ? view.bestOfBest.rank ?? Number.MAX_SAFE_INTEGER : null);
  const ra = rank(a);
  const rb = rank(b);
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return ra - rb;
}

export function bestOfBestLabel(star) {
  if (!star) return '';
  const rank = star.rank ? ` #${star.rank}` : '';
  const score = star.score != null ? ` \u00b7 elite score ${star.score.toFixed(1)}/10` : '';
  return `Best of Best${rank}${score}`;
}

export function copyV130TrackingFields(uc, row) {
  if (!uc || !row) return uc;
  for (const field of V130_TRACKING_FIELDS) {
    if (!isBlankField(row[field]) && isBlankField(uc[field])) uc[field] = row[field];
  }
  return uc;
}

const DATA_SIGNAL_LABELS = {
  passed: { tone: 'passed', label: 'Data check passed', prefix: '' },
  no_signal: { tone: 'warning', label: 'The data shows no signal', prefix: 'The data shows no signal: ' },
  failed: { tone: 'warning', label: 'The data shows no signal', prefix: 'The data shows no signal: ' },
  not_checked: { tone: 'neutral', label: 'Data not checked', prefix: 'Not checked: ' },
};

function dataSignalOf(evidence) {
  const signal = evidence && evidence.signal;
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) return null;
  const status = String(signal.status ?? '').trim();
  if (!DATA_SIGNAL_LABELS[status]) return null;
  return {
    status,
    check: String(signal.check ?? '').trim(),
    table: String(signal.table ?? '').trim(),
    columns: signal.columns && typeof signal.columns === 'object' && !Array.isArray(signal.columns) ? signal.columns : {},
    reason: String(signal.reason ?? '').trim(),
  };
}

export function dataSignalLine(signal) {
  const kind = signal && DATA_SIGNAL_LABELS[signal.status];
  if (!kind) return null;
  let text = signal.reason || '';
  if (kind.prefix && text.toLowerCase().startsWith(kind.prefix.toLowerCase())) text = text.slice(kind.prefix.length);
  return { tone: kind.tone, label: kind.label, text: text.trim() };
}

export function valueEstimateOf(uc) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const parsed = parseJson(fieldOf(u, 'Value Estimate', 'value_estimate'));
  const estimate = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const text = String(u.value_estimate_text || estimate.text || '').trim();
  return text ? { text, measured: estimate.status === 'measured', currency: estimate.currency || null } : null;
}

export function v130View(uc) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const alignments = objectList(fieldOf(u, 'Strategy Alignment', 'strategy_alignment'))
    .map((a) => ({ id: String(a.id ?? '').trim(), path: String(a.path ?? '').trim(), evidence: String(a.evidence ?? '').trim() }))
    .filter((a) => a.path);
  const pathText = String(fieldOf(u, 'Strategy Path', 'strategy_path') ?? '').trim();
  let paths = alignments.map((a) => a.path);
  if (!paths.length && pathText && pathText !== STRATEGY_NOT_ALIGNED) {
    paths = pathText.split('; ').map((p) => p.trim()).filter(Boolean);
  }
  const hasStrategyData =
    alignments.length > 0 || !!pathText ||
    Array.isArray(parseJson(u['Strategy Alignment'])) || Array.isArray(parseJson(u.strategy_alignment));
  const storedKpis = objectList(fieldOf(u, 'KPIs', 'kpis')).filter((k) => String(k.name ?? '').trim());
  const clear = (text) => placeholderWords(kpiWithoutStaleBaselines(text, storedKpis));
  const kpis = storedKpis.map((k) => ({ ...k, baseline: kpiBaselineShown(k.baseline, k) }));
  const keyResults = objectList(fieldOf(u, 'Expected Key Results', 'expected_key_results'))
    .map((kr) => ({ ...kr, statement: clear(String(kr.statement ?? '').trim()), source: kr.source === 'strategy' ? 'strategy' : 'proposed' }))
    .filter((kr) => kr.statement);
  const measures = textList(fieldOf(u, 'Measures of Success', 'measures_of_success')).map(clear);
  const financial = textList(fieldOf(u, 'Financial Benefits', 'financial_benefits')).map(clear);
  const nonFinancial = textList(fieldOf(u, 'Non-Financial Benefits', 'non_financial_benefits')).map(clear);
  const evidence = parseJson(fieldOf(u, 'Data Evidence', 'data_evidence'));
  const evidenceTables = evidence && typeof evidence === 'object' && !Array.isArray(evidence) && evidence.tables && typeof evidence.tables === 'object'
    ? evidence.tables : {};
  const evidenceJoins = evidence && Array.isArray(evidence.joins) ? evidence.joins : [];
  const evidenceSignal = dataSignalOf(evidence);
  const valueEstimate = valueEstimateOf(u);
  return {
    alignments,
    paths,
    hasStrategyData,
    notAligned: hasStrategyData && paths.length === 0,
    priorityText: String(u['Business Priority Alignment'] ?? '').trim(),
    valueEstimate,
    kpis,
    keyResults,
    measures,
    financial,
    nonFinancial,
    dataEvidence: Object.keys(evidenceTables).length || evidenceJoins.length || evidenceSignal
      ? { tables: evidenceTables, joins: evidenceJoins, signal: evidenceSignal } : null,
    foundations: textList(fieldOf(u, 'Foundations', 'foundation_ids')),
    useCaseKey: String(u.use_case_key ?? '').trim(),
    feedbackStatus: String(u['Feedback Status'] ?? '').trim().toLowerCase(),
    bestOfBest: bestOfBestOf(u),
    notStarredReason: String(u.best_of_best ?? '').trim().toUpperCase() === 'N' ? String(u.best_of_best_reason ?? '').trim() : '',
    hasValue: (valueEstimate ? 1 : 0) + kpis.length + keyResults.length + measures.length + financial.length + nonFinancial.length > 0,
    kind: useCaseKindView(u),
  };
}

export function strategyPathPrefixes(path) {
  const parts = String(path || '').split(STRATEGY_PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join(STRATEGY_PATH_SEPARATOR));
}

export function matchesStrategyFilter(info, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === NOT_ALIGNED_FILTER) return !!info?.notAligned;
  return (info?.paths || []).some((p) => p === filter || p.startsWith(filter + STRATEGY_PATH_SEPARATOR));
}

export function strategyFilterOptions(infos, coverageEntries) {
  const counts = new Map();
  let notAligned = 0;
  let withData = 0;
  for (const info of infos || []) {
    if (!info?.hasStrategyData) continue;
    withData += 1;
    if (info.notAligned) {
      notAligned += 1;
      continue;
    }
    for (const prefix of new Set(info.paths.flatMap(strategyPathPrefixes))) counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  const order = [];
  const seen = new Set();
  for (const entry of coverageEntries || []) {
    const path = String(entry?.path ?? '').trim();
    if (path && counts.has(path) && !seen.has(path)) {
      seen.add(path);
      order.push(path);
    }
  }
  for (const path of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
    if (!seen.has(path)) {
      seen.add(path);
      order.push(path);
    }
  }
  const options = order.map((path) => {
    const parts = path.split(STRATEGY_PATH_SEPARATOR);
    return { value: path, label: parts[parts.length - 1], title: path, depth: parts.length - 1, count: counts.get(path) };
  });
  return { options, notAligned, withData };
}

export function strategyContext(results) {
  const coverage = isMap(results?.strategy_coverage) ? results.strategy_coverage : null;
  const entries = coverage && Array.isArray(coverage.entries) ? coverage.entries : null;
  const depthLevels = coverage && Array.isArray(coverage.levels) ? coverage.levels.map((l) => String(l ?? '').trim()) : [];
  const levels = new Map();
  for (const e of entries || []) {
    const path = String(e?.path ?? '').trim();
    if (!path) continue;
    const level = String(e.level ?? '').trim() || depthLevels[path.split(STRATEGY_PATH_SEPARATOR).length - 1] || '';
    if (level) levels.set(path, level);
  }
  return { builtIn: !!coverage && coverage.source !== 'customer', hasEntries: entries ? entries.length > 0 : true, levels };
}

export function strategyGoals(info, context) {
  const items = info?.alignments?.length ? info.alignments : (info?.paths || []).map((path) => ({ id: '', path, evidence: '' }));
  return items.map((a) => {
    const parts = a.path.split(STRATEGY_PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    return {
      path: a.path,
      name: parts[parts.length - 1] || a.path,
      under: parts.slice(0, -1).join(STRATEGY_PATH_SEPARATOR),
      level: context?.levels?.get(a.path) || '',
      evidence: a.evidence || '',
    };
  });
}

export function showsNotTied(info, context) {
  return !!info?.notAligned && (context ? context.hasEntries : true);
}

export function knownPriorities(results) {
  const fromCoverage = (results?.strategy_coverage?.priorities || [])
    .map((p) => String(p?.priority ?? '').trim()).filter(Boolean);
  if (fromCoverage.length) return fromCoverage;
  return (results?.strategic_context?.priorities || []).map((p) => String(p ?? '').trim()).filter(Boolean);
}

export function priorityMatches(text, known) {
  const value = String(text || '').trim();
  if (!value || value === STRATEGY_BUILTIN_NO_MATCH || !known?.length) return [];
  const padded = `, ${value}, `;
  return known.filter((p) => padded.includes(`, ${p}, `));
}

export function kpiDirectionArrow(direction) {
  const text = String(direction ?? '').trim();
  if (!text) return '';
  const up = KPI_UP.test(text);
  const down = KPI_DOWN.test(text);
  if (up && !down) return '↑';
  if (down && !up) return '↓';
  return text;
}

const WHOLE_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, roundingMode: 'halfEven' });
const DECIMAL_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: 'halfEven' });

export function formatBaseline(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) || Math.abs(v) >= 1000 ? WHOLE_FORMAT.format(v) : DECIMAL_FORMAT.format(v);
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const v = Number(value);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export const KPI_WINDOW_ANCHOR = 'newest data';
export const KPI_BASELINE_PENDING = '[BASELINE: measured by the KPI query]';

export const KPI_FILTER_UNREADABLE = 'its filter cannot be read: ';
export const KPI_TRACKING_NOT_MEASURED = 'Not measured';

export function kpiBaselineShown(baseline, spec = null) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || !Object.keys(baseline).length) return null;
  if (spec !== null && kpiFilterMismatch(spec)) return null;
  if (pyFloat(baseline.value) === 0 && pyTruthy(baseline.window_days) && baseline.window_anchor !== KPI_WINDOW_ANCHOR) return null;
  return baseline;
}

export function trackedKpiValue(entry) {
  if (entry?.status === 'not_measured') return { baseline: null, change: null };
  const baseline = kpiBaselineShown(entry?.baseline);
  const change = baseline ? finiteNumber(entry.change) : null;
  return { baseline, change };
}

export function trackedKpiNote(entry) {
  if (entry?.status !== 'not_measured') return '';
  const reason = String(entry.reason ?? '').trim();
  return reason ? `${KPI_TRACKING_NOT_MEASURED}: ${reason}` : KPI_TRACKING_NOT_MEASURED;
}

function baselineWindow(baseline) {
  if (!baseline.window_days) return 'all data';
  return `last ${baseline.window_days} days${baseline.window_anchor === KPI_WINDOW_ANCHOR ? ' to the newest data' : ''}`;
}

export function kpiWithoutStaleBaselines(text, specs) {
  let out = pyTruthy(text) ? pyStr(text) : '';
  for (const spec of Array.isArray(specs) ? specs : []) {
    const baseline = isMap(spec) ? spec.baseline : null;
    const name = isMap(spec) ? pySpaced(pyTruthy(spec.name) ? pyStr(spec.name) : '') : '';
    if (!(name && isMap(baseline) && pyTruthy(baseline.measured_on)) || kpiBaselineShown(baseline, spec) !== null) continue;
    const note = new RegExp(`-?${DIGIT}[${DIGIT},]*(?:\\.${DIGIT}+)?${SPACE}*\\(${SPACE}*${name.split(' ').map(pyRegexLiteral).join(`${SPACE}+`)}`
      + `${SPACE}*,[^()]*?(?<!${WORD})measured${SPACE}+${pyRegexLiteral(pyStrip(pyStr(baseline.measured_on)))}${SPACE}*\\)`, 'giu');
    const shown = kpiFilterMismatch(spec) ? KPI_BASELINE_MISMATCH : KPI_BASELINE_PENDING;
    out = out.replace(note, () => shown);
  }
  return out;
}

export function kpiText(spec) {
  const name = String(spec?.name ?? '').trim();
  if (!name) return '';
  const details = [kpiDirectionArrow(spec.direction), String(spec.unit ?? '').trim()].filter(Boolean).join(' ');
  const text = details ? `${name} (${details})` : name;
  if (kpiFilterMismatch(spec)) return `${text}: ${KPI_FILTER_MISMATCH_TEXT}`;
  const baseline = kpiBaselineShown(spec.baseline);
  const value = baseline ? finiteNumber(baseline.value) : null;
  if (value == null) return text;
  return `${text}: baseline ${formatBaseline(value)}, ${baselineWindow(baseline)}, measured ${String(baseline.measured_on ?? '')}`;
}

function kpiFilterWords(part) {
  const { text, problem } = kpiFilterShown(part);
  if (problem) return ` (${KPI_FILTER_UNREADABLE}${problem})`;
  return text ? ` where ${text}` : '';
}

function kpiPart(part) {
  const aggregation = String(part.aggregation || 'count').toLowerCase();
  return `${aggregation} of ${part.column || 'rows'}${kpiFilterWords(part)}`;
}

export function kpiSource(spec) {
  if (!spec || typeof spec !== 'object') return '';
  if (spec.metric_view) return `metric view ${spec.metric_view}${spec.measure ? `, measure ${spec.measure}` : ''}`;
  if (spec.denominator && typeof spec.denominator === 'object' && spec.table) {
    return `${kpiPart(spec)} / ${kpiPart(spec.denominator)}, on ${spec.table}`;
  }
  const target = spec.table && spec.column ? `${spec.table}.${spec.column}` : String(spec.table || '');
  if (!target) return '';
  return `${spec.aggregation ? `${target} (${String(spec.aggregation).toLowerCase()})` : target}${kpiFilterWords(spec)}`;
}

export function matchRateText(rate) {
  const v = finiteNumber(rate);
  return v == null ? '' : `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
}

export function feedbackLabel(status) {
  return FEEDBACK_LABELS[String(status || '').toLowerCase()] || '';
}

export function excludedFeedbackText(entry) {
  const title = String(entry?.title || entry?.use_case_key || '').trim();
  const reason = String(entry?.reason || '').trim();
  const proposed = String(entry?.proposed_title || '').trim();
  const text = reason ? `${title}: ${reason}` : title;
  if (entry?.match === 'reworded' && proposed && proposed.toLowerCase() !== title.toLowerCase()) {
    return `${text} (proposed again as “${proposed}”)`;
  }
  return text;
}

export function latestFeedbackMap(latest) {
  const map = {};
  for (const row of latest || []) {
    const key = String(row?.use_case_key ?? '').trim();
    if (key && !map[key]) map[key] = row;
  }
  return map;
}

export function dataAccessSummary(results) {
  const type = String(results?.discovery_type || '').trim();
  if (!type) return null;
  const access = results?.data_access && typeof results.data_access === 'object' ? results.data_access : {};
  const tables = Array.isArray(access.tables_read) ? access.tables_read : [];
  return {
    type,
    deep: type === 'Deep',
    tablesRead: tables,
    tablesReadCount: finiteNumber(access.tables_read_count) ?? tables.length,
    statements: finiteNumber(access.statements) ?? 0,
    piiColumnsExcluded: finiteNumber(access.pii_columns_excluded) ?? 0,
    tablesSkipped: access.tables_skipped && typeof access.tables_skipped === 'object' ? access.tables_skipped : {},
    rowsSentToAi: finiteNumber(access.rows_sent_to_ai) ?? 0,
  };
}
