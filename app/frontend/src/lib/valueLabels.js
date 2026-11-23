import { valueChips } from './valueLedger.js';
import disclaimer from '../../../backend/lib/valueDisclaimer.json' with { type: 'json' };

// REQ-434: one text shared with the backend answers (backend/lib/valueDisclaimer.json); no copy of the words lives here.
export const VALUE_DISCLAIMER = disclaimer.full;
export const VALUE_DISCLAIMER_SHORT = disclaimer.short;

// REQ-432: the words of the value line on a use case card. The App shows English labels; every label of the line lives here, so one
// translation hook covers them all.
export const VALUE_LABELS = {
  calculate: 'Calculate',
  perYear: 'Per Year',
  calculating: 'Calculating',
  retry: 'Retry',
};

// REQ-497: the two words a value's status shows. Internal status keys ('estimated', 'calculated') and API fields stay as they are.
// A value saved without the accept tick (Calculate now) is a Provisional estimate; one saved with "Accept and save" is a Reviewed calculation.
export const STATUS_LABELS = { estimated: 'Provisional estimate', calculated: 'Reviewed calculation' };
export const statusLabel = (calculated) => (calculated ? STATUS_LABELS.calculated : STATUS_LABELS.estimated);
export const statusLabelOf = (key) => STATUS_LABELS[key] || key;
// "3 reviewed calculations · 2 provisional estimates"
export const statusCounts = (nCalculated, nEstimated) => `${nCalculated} ${STATUS_LABELS.calculated.toLowerCase()}${Number(nCalculated) === 1 ? '' : 's'} · ${nEstimated} ${STATUS_LABELS.estimated.toLowerCase()}${Number(nEstimated) === 1 ? '' : 's'}`;

// REQ-472 (e): the dialog title names the use case it values.
export const dialogTitleFor = (name) => `Calculating Value at Stake for ${name}`;

const count = (n) => Number(n).toLocaleString('en-US');

// "$15M (Provisional estimate)": the largest amount in its own currency or unit, with how many other currencies or units follow.
// An estimate carries three significant digits at most: $405,556 reads "$406K".
export const threeDigits = (n) => (Number.isFinite(n) && n !== 0 ? Number(n.toPrecision(3)) : n);

export function yearlyHeadline(yearly) {
  const entries = Array.isArray(yearly?.entries) ? yearly.entries.map((e) => ({ ...e, amount: threeDigits(Number(e.amount)) })) : [];
  const { shown, more } = valueChips(entries, 1);
  return shown.length ? { text: `${shown[0].text} (${statusLabel(yearly?.calculated)})`, more } : null;
}

// One plain sentence that says what the number rests on.
export function yearlyBasis(yearly) {
  const b = yearly?.basis;
  if (!b) return '';
  const days = Number(b.days);
  const span = days >= 45 ? `${Math.round(days / 30)} months` : `${days} ${days === 1 ? 'day' : 'days'}`;
  return `Measured on ${count(b.sampled_records)} of ${count(b.eligible_records)} records, scaled to all of them, and to a year from ${span} of data.`;
}
