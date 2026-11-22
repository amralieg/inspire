import { amountText, countText, moneyText } from './valueWizard.js';

// REQ-475/476: the formula of one driver as one line of words, from its own inputs: "8,352 times a year × 1 person × 1.8 hours saved × $104 an hour".
// No arithmetic of value lives here: the amount after "=" is the server's. One phrase per input id; an input without one reads "<number> <label>".
const plural = (n, one, many) => `${amountText(n)} ${Number(n) === 1 ? one : many}`;
const PHRASES = {
  events_per_year: (n) => `${countText(n)} times a year`,
  people: (n) => plural(n, 'person', 'people'),
  hours_saved: (n) => plural(n, 'hour saved', 'hours saved'),
  cost_per_hour: (n, c) => `${moneyText(c, n)} an hour`,
  headcount: (n) => plural(n, 'person', 'people'),
  cost_per_person_year: (n, c) => `${moneyText(c, n)} per person a year`,
  gain_pct: (n) => `${amountText(n)}% of their time back`,
  base_revenue_per_year: (n, c) => `${moneyText(c, n)} of revenue a year`,
  uplift_pct: (n) => `${amountText(n)}% uplift`,
  spend_per_year: (n, c) => `${moneyText(c, n)} of spend a year`,
  cut_pct: (n) => `${amountText(n)}% cut`,
  incidents_per_year: (n) => `${countText(n)} incidents a year`,
  cost_per_incident: (n, c) => `${moneyText(c, n)} per incident`,
  reduction_pct: (n) => `${amountText(n)}% avoided`,
};
export const TAKES_LONGER = 'The use case takes longer than today, so no time is saved.';

// An input's number: the typed one for an estimate, else the server's figure for a data input (last known).
const valueOf = (ask, typed, part) => {
  const v = ask.source === 'data' ? part?.inputs?.find((i) => i.id === ask.id)?.value : typed?.[ask.id];
  return v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
};

// { text, longer }: text is the line before "="; longer is true when hours today are below hours with the use case.
export function formulaOf(driver, inputs, part, currency) {
  const nums = Object.fromEntries((driver?.asks || []).map((a) => [a.id, valueOf(a, inputs, part)]));
  if (driver?.id === 'time_saved' && nums.hours_saved === undefined && nums.hours_before !== undefined && nums.hours_after !== undefined) {
    if (nums.hours_before !== null && nums.hours_after !== null && nums.hours_after > nums.hours_before) return { text: TAKES_LONGER, longer: true };
    nums.hours_saved = nums.hours_before === null || nums.hours_after === null ? null : nums.hours_before - nums.hours_after;
  }
  const parts = [];
  for (const a of driver?.asks || []) {
    if (a.id === 'hours_before' || a.id === 'hours_after') continue;
    parts.push(nums[a.id] === null ? null : (PHRASES[a.id] ? PHRASES[a.id](nums[a.id], currency) : `${amountText(nums[a.id])} ${a.label}`));
  }
  if (nums.hours_saved !== undefined && !(driver.asks || []).some((a) => a.id === 'hours_saved')) {
    const at = (driver.asks || []).findIndex((a) => a.id === 'hours_before');
    parts.splice(Math.max(0, at), 0, nums.hours_saved === null ? null : PHRASES.hours_saved(nums.hours_saved));
  }
  return parts.includes(null) ? { text: '', longer: false } : { text: parts.join(' × '), longer: false };
}
