import { cap, countOf, grouped, percentOf, stakeName, stakeWords, sumOf, wholeMoney } from './format.js';
import { NOT_MEASURED, plural, shortDay } from './hub.js';
import { hasUnsetTarget, placeholderWords } from './placeholders.js';
import { DEFAULT_CHOICES, NOT_IN_RUN, choiceLabel, statusKind } from './records.js';

export const MIN_ARM = 5;
export const STATES = { left: 'Left the list', missing: NOT_IN_RUN, resolved: 'No longer flagged', flagged: 'Still flagged', unchecked: 'Not checked by a run yet' };
const FLAGGED = ['Act now', 'Review'];

const none = (how) => ({ value: NOT_MEASURED, amount: null, n: 0, how });
const missing = (entry) => (!entry ? 'Loading' : entry.error ? `Could not load: ${entry.error}` : entry.note || 'This use case does not track its records yet');

export function estimatedFigure(entry, currency, kind = '') {
  if (!entry?.tracked) return none(missing(entry));
  if (!entry.money) return none('This use case puts no amount at stake on its records');
  const n = sumOf(FLAGGED, (t) => entry.estimated?.[t]?.n);
  const amount = sumOf(FLAGGED, (t) => entry.estimated?.[t]?.money);
  const value = wholeMoney(amount, currency, kind);
  const parts = FLAGGED.map((tier) => `${tier} ${wholeMoney(countOf(entry.estimated?.[tier]?.money), currency, kind)}`);
  return { value, amount, n, how: `${stakeName(currency, kind)} on the ${plural(n, 'open record')} flagged Act now or Review, added up`,
    formula: `${parts.join(' + ')} = ${value}` };
}

export function reportedFigure(entry, currency, kind = '') {
  if (!entry?.tracked) return none(missing(entry));
  const { n, money } = entry.reported;
  const value = wholeMoney(countOf(money), currency, kind);
  return { value, amount: countOf(money), n,
    how: `Amounts people entered when they marked ${plural(n, 'record')} fixed, added up`,
    formula: `The ${plural(n, 'amount')} people entered when they marked records fixed, added up = ${value}` };
}

export function measuredFigure(entry, currency, kind = '') {
  if (!entry?.tracked) return none(missing(entry));
  if (!entry.money) return none('This use case puts no amount at stake on its records');
  const { n, money } = entry.measured;
  const still = entry.outcomes?.flagged || 0;
  const value = wholeMoney(countOf(money), currency, kind);
  return { value, amount: countOf(money), n,
    formula: `On each of the ${plural(n, 'fix', 'fixes')} a later run confirmed: ${stakeWords(currency, kind)} when fixed minus what that run still finds, added up = ${value}`,
    how: `${stakeName(currency, kind)} when fixed, less what a later run still finds, on ${plural(n, 'fix', 'fixes')} a later run confirmed`
      + (still ? `. ${plural(still, 'fix', 'fixes')} a later run still flags` : '') };
}

export function wrongFigure(entry) {
  if (!entry?.tracked) return none(missing(entry));
  const closed = sumOf(Object.values(entry.closed || {}), (c) => c.n);
  const wrong = countOf(entry.closed?.Dismissed?.n);
  if (!closed) return none('Nobody has closed a record yet');
  const share = percentOf(wrong, closed);
  return { value: `${share}%`, amount: share, n: closed, formula: `${wrong} not an issue / ${closed} closed x 100 = ${share}%`,
    how: `People marked ${grouped(wrong)} of ${plural(closed, 'closed record')} not an issue, so ${100 - share}% were right` };
}

export function figuresOf(entry, currency, kind = '') {
  return { estimated: estimatedFigure(entry, currency, kind), reported: reportedFigure(entry, currency, kind), measured: measuredFigure(entry, currency, kind),
    wrong: wrongFigure(entry) };
}

const KPI_DIRECTIONS = { increase: '\u25b2 Increase', decrease: '\u25bc Decrease', maintain: '\u25a0 Maintain' };

export function targetKpiView(run) {
  const name = String(run?.kpi_name ?? '').trim();
  if (!name) return null;
  const unit = String(run.kpi_unit ?? '').trim();
  const shown = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? ''
    : `${grouped(v, { maximumFractionDigits: 2 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`);
  const measuredNow = run.kpi_status === 'measured' && shown(run.kpi_latest);
  const reason = String(run.kpi_reason ?? '').trim();
  return {
    name, direction: KPI_DIRECTIONS[run.kpi_direction] || '',
    source: run.kpi_source === 'evaluated' ? 'Inspire chose this KPI for the use case' : 'This use case\u2019s KPI from Inspire',
    baseline: shown(run.kpi_baseline) || NOT_MEASURED, baselineOn: run.kpi_baseline_on ? shortDay(run.kpi_baseline_on) : '',
    latest: measuredNow || 'Not measured', latestOn: measuredNow && run.kpi_measured_at ? shortDay(run.kpi_measured_at) : '',
    target: shown(run.kpi_target) || (hasUnsetTarget(run.kpi_target_text) ? '' : placeholderWords(run.kpi_target_text).trim()) || 'No target set',
    note: measuredNow ? (reason ? `Baseline: ${cap(reason)}` : '') : `Not measured${reason ? `: ${cap(reason)}` : ''}`,
    baselineFlagged: !!measuredNow && !!reason,
  };
}

export function holdoutView(entry) {
  if (!entry?.tracked || !entry.holdout) return null;
  const { shown, held } = entry.holdout;
  const rate = (arm) => (arm.n ? percentOf(arm.hits, arm.n) : null);
  const line = (arm, who) => `${grouped(arm.hits)} of ${plural(arm.n, 'flagged record')} ${who} left the list or stopped being flagged${arm.n ? ` (${rate(arm)}%)` : ''}`;
  const lines = [line(shown, 'shown to people'), line(held, 'held back')];
  if (shown.n < MIN_ARM || held.n < MIN_ARM) return { lines, verdict: `Too few records to compare yet: it needs at least ${MIN_ARM} in each group` };
  const diff = rate(shown) - rate(held);
  const verdict = diff === 0 ? 'Records shown to people left the list as often as records held back'
    : `Records shown to people left the list ${Math.abs(diff)} points ${diff > 0 ? 'more' : 'less'} often than records held back`;
  return { lines, verdict, diff };
}

export function holdoutOffText(entry) {
  if (!entry?.tracked || entry.holdout) return '';
  return entry.holds
    ? 'Holdout is on, but no run has held a record back yet, so there is nothing to compare.'
    : 'Holdout is off for this use case: every flagged record is shown to people, so nothing is held back to compare against.';
}

export function heldShare(entry) {
  const current = entry?.current;
  if (!current?.records || !current.held) return '';
  return `${plural(current.held, 'record')} of ${grouped(current.records)} (${percentOf(current.held, current.records)}%) ${current.held === 1 ? 'is' : 'are'} held back now`;
}

export function promisedView(page) {
  const promised = page?.promised || {};
  const value = placeholderWords(promised.value || '').trim();
  const benefits = (promised.benefits || []).map((b) => placeholderWords(b).trim()).filter(Boolean);
  const estimate = String(promised.estimate || '').trim();
  if (!value && !benefits.length && !estimate) return null;
  return estimate ? { value, benefits, estimate } : { value, benefits };
}

export function measuredText(record, currency, kind = '') {
  if (record.measured == null) return '';
  return `${wholeMoney(record.at_close, currency, kind)} when fixed minus ${wholeMoney(record.now ?? 0, currency, kind)} now = ${wholeMoney(record.measured, currency, kind)}`;
}

export function closedRows(entry, currency, kind = '', choices = DEFAULT_CHOICES) {
  return (entry?.records || []).map((r) => ({
    key: r.key, label: r.label || r.key, outcome: choiceLabel(choices, { action_status: r.status, action_choice: r.choice }),
    state: statusKind(r.status) === 'dismissed' ? (r.reason || 'No reason given') : STATES[r.state] || '',
    measured: measuredText(r, currency, kind), reported: r.reported == null ? '' : wholeMoney(r.reported, currency, kind), note: r.note || '', closed: shortDay(r.closed),
    amounts: { measured: r.measured ?? null, reported: r.reported ?? null, closed: r.closed ?? null },
  }));
}
