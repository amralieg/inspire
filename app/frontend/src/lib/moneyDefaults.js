import { CURRENCY_CODES } from '../../../agent/agent/app_shell/web/src/moneyRule.js';

// The codes a business meets most often lead the picker; every other ISO 4217 code follows, sorted.
const COMMON_CODES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'EGP', 'JPY', 'INR', 'CNY', 'CHF', 'CAD', 'AUD'];
export const MONEY_CURRENCY_CHOICES = [...COMMON_CODES, ...[...CURRENCY_CODES].filter((code) => !COMMON_CODES.includes(code)).sort()];
export const DEFAULT_CURRENCY = 'USD';
export const WINDOW_CHOICES = ['3', '6', '12', '24'];
export const ALL_PERIODS = 'All closed periods';

export const METHOD_NAMES = { rule: 'The amount the rule computes', fixed: 'A fixed amount for each record', column: 'A value from a data column', equation: 'An equation over columns', describe: 'Described in words' };
export const DIRECTION_NAMES = { losses: 'Losses only', gains: 'Gains only', net: 'Losses and gains, netted' };

// The one place the default money rule is picked. A use case that states its own value (the rule's amount for each flagged record)
// keeps that amount: the rule saves no value, so the build counts the amount the rule computes. Only a use case with no such amount
// falls back to the amount column of its table, else each record once at 1 USD. The wizard shows the choice in a sentence
// (moneySummaryOf) and the person can change it there.
export function defaultMoneyRule(profile, ruleComputes = false) {
  if (ruleComputes) return { currency: 'per_currency' };
  const sample = profile?.money_sample || null;
  const currency = sample?.currency ? { currency_column: sample.currency } : { currency: DEFAULT_CURRENCY };
  const value = sample?.amount ? { method: 'column', column: sample.amount, ...currency } : { method: 'fixed', amount: 1, ...currency };
  return { currency: 'per_currency', value };
}

export function valueTextOf(value) {
  if (!value) return '';
  const where = value.currency_column !== undefined ? `in the currency of ${value.currency_column}` : `in ${value.currency}`;
  if (value.method === 'fixed') return `${value.amount} ${where}, for each record`;
  if (value.method === 'column') return `the amount in ${value.column}, ${where}`;
  return `${value.expression}, ${where}`;
}

export function windowText(window) {
  return window?.periods ? `the last ${window.periods} closed ${window.periods === 1 ? 'period' : 'periods'}` : 'every closed period';
}

// One line that says what a folded section holds. Empty when the section has nothing set.
export function moneySummaryOf(money, part) {
  if (!money) return 'Not set yet';
  if (part === 'method') return money.value ? `${METHOD_NAMES[money.value.method] || 'Value'}: ${valueTextOf(money.value)}` : `${METHOD_NAMES.rule}: each flagged record counts the amount its own rule works out`;
  if (part === 'direction') return DIRECTION_NAMES[money.rule || 'losses'];
  if (part === 'currency') {
    const values = money.value?.currency_column !== undefined ? `each record in ${money.value.currency_column}` : money.value ? money.value.currency : 'USD';
    return money.currency === 'convert' ? `${values}, converted to ${money.base}` : `${values}, each currency on its own`;
  }
  if (part === 'window') {
    const statuses = money.statuses?.length ? `statuses ${money.statuses.join(', ')}` : 'every status';
    return `${windowText(money.window)}, ${statuses}`;
  }
  if (part === 'off') return money.off ? 'Off: no money total is shown' : 'On';
  return '';
}

export const windowLabelOf = (window) => (window === '' || window == null ? '' : String(window));
