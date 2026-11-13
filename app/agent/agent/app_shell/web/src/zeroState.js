// The zero-state panel (REQ-147, Amr decision 2A). The server sets zero_state only when the rule finds no exception in the scope,
// so the page shows one plain panel in place of flat charts. The as-of cut-off comes from the stored run summary the page already loads.
export const ZERO_TITLE = 'No matching records found in this data';

import { grouped } from './format.js';

const CUTOFF = /Reads rows dated before[^.]*\./;

export function cutoffNote(summary) {
  return summary?.run?.summary?.match(CUTOFF)?.[0] || '';
}

// The checked-row line: the rows the latest run read of its scope's table, shown only when the run wrote a whole-number count.
export function checkedNote(zero) {
  const n = zero?.rows_checked;
  return Number.isInteger(n) && n >= 0 ? `${grouped(n)} rows checked` : '';
}

// The rule in plain words: the decision-list definition the page already holds. Empty when the page holds none, so no line is shown.
export function zeroRule(page) {
  return page?.records?.hint || '';
}
