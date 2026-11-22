import { money, wholeMoney } from './format.js';

// FX-84: the words of the value counter. The server prices each resolved case; nothing here makes a number up.
export const STREAK_FROM = 2;
// A case worth under a hundred keeps its cents: whole-number rounding would turn 0.40 into 0.
const perCase = (n, cur) => (n < 100 ? money(n, cur, 2) : wholeMoney(n, cur));

export function counterLines(data) {
  if (!data || !data.shown) return null;
  const cur = data.currency;
  return {
    mine: data.mine ? { text: `Value saved by you: ${wholeMoney(data.mine.value, cur)}` } : null,
    team: { text: `Team total: ${wholeMoney(data.team.value, cur)}` },
    streak: data.streak_weeks >= STREAK_FROM ? `${data.streak_weeks}-week streak` : '',
    badges: (data.badges || []).map((b) => b.label),
    next: data.next_badge
      ? (data.next_badge.unit === 'case' ? `${data.next_badge.remaining} ${data.case_noun} to go` : `${wholeMoney(data.next_badge.remaining, cur)} to go`)
      : '',
  };
}

export function counterTitle(data) {
  const cur = data.currency;
  const cases = Number(data.cases_per_year).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${data.disclaimer.full} Based on ${data.status} value of ${wholeMoney(data.amount, cur)} a year over ${cases} ${data.case_noun}s `
    + `(${data.cases_from}), so ${perCase(data.per_case, cur)} per ${data.case_noun} resolved; saved in Inspire on ${data.saved_at}.`;
}
