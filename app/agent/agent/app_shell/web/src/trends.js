import { grouped, integer, percentOf, wholeMoney } from './format.js';
import { NOT_MEASURED, plural, shortDay } from './hub.js';
import { holdoutOffText, holdoutView } from './impact.js';
import { latestRunText, runFlag } from './freshness.js';

export const AGES = [['0-7', '0 to 7 days'], ['8-30', '8 to 30 days'], ['over_30', 'More than 30 days']];

export const hoursText = (hours) => {
  if (hours == null) return NOT_MEASURED;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${grouped(Math.round(hours * 10) / 10)} h`;
  return `${grouped(Math.round(hours / 24 * 10) / 10)} days`;
};

export const rateText = (rate) => (rate == null ? NOT_MEASURED : `${Math.round(rate * 100)}%`);

export function trendTiles(trends, { impact, latest, onFix, onRuns, onFeedback } = {}) {
  const open = trends.open;
  const alarms = trends.false_alarms;
  const first = trends.first_action;
  const lift = holdoutView(impact);
  const run = latest ? runFlag(latest.status) : null;
  return [
    { id: 'overdue', label: 'Overdue', value: integer(open.overdue), tone: open.overdue ? 'red' : '',
      sub: open.n ? `of ${plural(open.n, 'open record')} past their due date` : 'Nothing is open', formula: 'Open records whose due date is before today',
      action: onFix && open.overdue ? { label: 'Fix this', run: () => onFix({ focus: 'overdue' }) } : null },
    { id: 'unassigned', label: 'Unassigned', value: integer(open.unassigned), tone: open.unassigned ? 'amber' : '',
      sub: open.n ? `${percentOf(open.unassigned, open.n)}% of the open records have no owner` : 'Nothing is open', formula: 'Open records with no owner',
      action: onFix && open.unassigned ? { label: 'Fix this', run: () => onFix({ focus: 'unassigned' }) } : null },
    { id: 'first_action', label: 'Time to first action', value: hoursText(first.median_hours),
      sub: first.n ? `median of ${plural(first.n, 'record')}; ${plural(first.waiting, 'open record')} still waiting` : `${plural(first.waiting, 'open record')} still waiting`,
      formula: 'The median time from when a record joined the list to the first action on it, over the records that joined in the last 12 weeks',
      action: onFix && first.waiting ? { label: 'Fix this', run: () => onFix({}) } : null },
    { id: 'false_alarms', label: 'Not an issue', value: rateText(alarms.rate),
      sub: alarms.closed ? `${plural(alarms.dismissed, 'record')} of ${grouped(alarms.closed)} closed` : 'Nothing is closed yet',
      formula: 'Records closed as Not an issue, as a share of every closed record', tone: alarms.rate >= 0.3 ? 'amber' : '',
      action: onFeedback && alarms.dismissed ? { label: 'Give feedback', run: onFeedback } : null },
    { id: 'holdout', label: 'Holdout lift', value: lift?.diff != null ? `${lift.diff > 0 ? '+' : ''}${lift.diff} pts` : NOT_MEASURED,
      sub: lift ? lift.verdict : holdoutOffText(impact) || (trends.holds ? 'Reading the holdout' : 'Holdout is off for this use case'), tone: lift?.diff > 0 ? 'green' : '' },
    { id: 'run_health', label: 'Run health', value: run ? run.text : 'No run yet', tone: run?.tone === 'bad' ? 'red' : '',
      sub: latestRunText(latest), action: onRuns ? { label: 'See the runs', run: onRuns } : null },
  ];
}

const TICK = (at) => shortDay(at) || 'Not recorded';

export function backlogChart(trends) {
  return {
    chart: { id: 'trend_backlog', type: 'line', title: 'Open records per run', hint: 'How many records were open when each run finished, oldest run on the left.',
      x: { kind: 'category', label: 'Run' }, y: [{ label: 'Open', format: 'number' }] },
    result: { rows: (trends.backlog || []).map((r) => ({ x: TICK(r.at), y0: r.open })) },
  };
}

export function flowChart(trends) {
  return {
    chart: { id: 'trend_flow', type: 'bar', title: 'New and cleared per week', hint: 'Records that joined the list and records closed, each week for 12 weeks.',
      x: { kind: 'category', label: 'Week of' }, y: [{ label: 'New', format: 'number' }, { label: 'Cleared', format: 'number' }] },
    result: { rows: (trends.weeks || []).map((w) => ({ x: TICK(w.week), y0: w.new, y1: w.cleared })) },
  };
}

export function ageBars(trends, hue) {
  return AGES.map(([key, label]) => ({ key, label, hue, fix: key === 'over_30', value: trends.open.ages[key], text: integer(trends.open.ages[key]) }));
}

export function stakeBars(trends, hue, currency, kind) {
  return (trends.stake || []).map((s) => ({ key: s.reason, label: s.reason, hue, value: s.money ?? 0,
    text: s.money == null ? `${plural(s.n, 'record')}, ${NOT_MEASURED.toLowerCase()}` : `${wholeMoney(s.money, currency, kind)} on ${plural(s.n, 'record')}` }));
}

export function alarmBars(trends, hue) {
  return (trends.false_alarms?.reasons || []).map((r) => ({ key: r.reason, label: r.reason, hue, value: Math.round((r.rate || 0) * 100),
    text: `${rateText(r.rate)} of ${grouped(r.closed)}` }));
}

export const EMPTY = { open: { n: 0, overdue: 0, unassigned: 0, ages: { '0-7': 0, '8-30': 0, over_30: 0 }, money: null },
  false_alarms: { closed: 0, dismissed: 0, rate: null, reasons: [] }, first_action: { n: 0, median_hours: null, waiting: 0 }, weeks: [], backlog: [], stake: [] };
