import { liveImpact, stakeAmount } from './targetKpi.js';

const lower = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

export function amountText(value, kind, currency) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  if (kind === 'percent') return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  const text = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return kind === 'money' && currency ? `${text} ${currency}` : text;
}

export const assumptionLabel = (name) => {
  const words = String(name || '').toLowerCase().replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const columnWords = (name) => String(name || '').replace(/_+/g, ' ').trim();

export const NOT_RELIABLE = 'Not reliable yet';
export const NOTHING_TO_ACT = 'Nothing to act on yet';

export function notReliableReason(run) {
  return String(run?.not_reliable || '').trim();
}

export function nothingToActText(run) {
  const unreliable = notReliableReason(run);
  if (unreliable) return `${NOT_RELIABLE}: ${unreliable}`;
  if (!run || run.records == null) return '';
  if ((run.act_now_records || 0) + (run.review_records || 0) > 0) return '';
  const reason = run.nothing_to_act || (run.records === 0 ? 'the last run wrote no records' : 'no record reached Act now or Review in the last run');
  return `${NOTHING_TO_ACT}, because ${lower(reason)}`;
}

export function capacityText(run) {
  const over = Number(run?.over_capacity_records) || 0;
  const cap = Number(run?.act_now_capacity) || 0;
  if (over <= 0 || cap <= 0) return '';
  const one = over === 1;
  return `${over.toLocaleString('en-US')} more ${one ? 'record' : 'records'} would qualify for Act now, but the team capacity of `
    + `${cap.toLocaleString('en-US')} a run holds ${one ? 'it' : 'them'} in Review.`;
}

export function tiersText(run, impact = liveImpact(run)) {
  if (run?.basis === 'measured' && run.act_now_amount != null && run.review_amount != null) {
    return `Act now from ${stakeAmount(run.act_now_amount, impact)} at stake, Review from ${stakeAmount(run.review_amount, impact)}, every other row Monitor.`;
  }
  if (run?.basis === 'predicted') {
    if (run.accepted === true) return 'A model passed this use case\u2019s acceptance check in the last run, so acceptance no longer holds its rows at Monitor.';
    if (run.accepted === false) return 'No model passed this use case\u2019s acceptance check in the last run, so no row is actionable yet.';
    return 'A row is called actionable only after a model passes this use case\u2019s acceptance check.';
  }
  return '';
}

export function previewSampleText(run) {
  const n = Number(run?.preview_sample_entities);
  if (run?.preview_sample_entities == null || !Number.isFinite(n) || n <= 0) return '';
  const sample = `a preview sample of ${n.toLocaleString('en-US')} records; the next full run trains on every record.`;
  return run.accepted == null ? `The last run trained on ${sample}` : `This use case\u2019s acceptance check ran on ${sample}`;
}

export function lastRunText(run, impact = liveImpact(run)) {
  if (!run || run.records == null) return '';
  const stake = run.value_at_stake != null ? `, with ${stakeAmount(run.value_at_stake, impact)} at stake on them` : '';
  return `The last run flagged ${run.act_now_records || 0} Act now and ${run.review_records || 0} Review of ${run.records} rows${stake}.`;
}

export function historyLines(history, currency) {
  return (history || []).map((h, i) => {
    const older = history.slice(i + 1).find((x) => x.name === h.name);
    const from = older ? ` from ${amountText(older.value, h.kind, currency)}` : '';
    return `${h.changed_by || 'Someone'} set ${assumptionLabel(h.name)}${from} to ${amountText(h.value, h.kind, currency)} in the App${h.note ? `: ${h.note}` : ''}`;
  });
}
