import { CURRENCY_CODES } from '../../../agent/agent/app_shell/web/src/moneyRule.js';

// The codes a business meets most often lead the picker; every other ISO 4217 code follows, sorted.
const COMMON_CODES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'EGP', 'JPY', 'INR', 'CNY', 'CHF', 'CAD', 'AUD'];
export const MONEY_CURRENCY_CHOICES = [...COMMON_CODES, ...[...CURRENCY_CODES].filter((code) => !COMMON_CODES.includes(code)).sort()];
export const DEFAULT_CURRENCY = 'USD';
export const WINDOW_CHOICES = ['3', '6', '12', '24'];
export const ALL_PERIODS = 'All closed periods';

export const METHOD_NAMES = { fixed: 'A fixed amount for each record', column: 'A value from a data column', equation: 'An equation over columns', describe: 'Described in words' };
export const DIRECTION_NAMES = { losses: 'Losses only', gains: 'Gains only', net: 'Losses and gains, netted' };

const VALUE_WORDS = ['amount', 'price', 'total', 'value', 'revenue', 'cost'];

// The column the use case's own value text names: an exact column name in the text, else a value word in the text
// with the table column that carries it. Empty when the text names no column of the table.
export function valueColumnFromText(text, columns) {
  const words = String(text || '').toLowerCase();
  const names = (columns || []).filter(Boolean);
  if (!words || !names.length) return '';
  const escaped = (name) => name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = names.find((name) => new RegExp(`(^|[^a-z0-9_])${escaped(name)}([^a-z0-9_]|$)`).test(words));
  if (exact) return exact;
  const word = VALUE_WORDS.find((w) => words.includes(w));
  return word ? names.find((name) => name.toLowerCase().includes(word)) || '' : '';
}

// The rule the wizard writes on its own when a use case has none. It counts the column its own value text names, when the
// table has one; else the amount column of the table; else each record once. The currency is the currency column when the
// table has one, else USD. With no amount column, each record counts 1 USD, which counts records.
export function defaultMoneyRule(profile, valueText = '') {
  const sample = profile?.money_sample || null;
  const currency = sample?.currency ? { currency_column: sample.currency } : { currency: DEFAULT_CURRENCY };
  const named = valueColumnFromText(valueText, profile?.money_columns || []);
  if (named) return { currency: 'per_currency', value: { method: 'column', column: named, ...currency } };
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
  if (part === 'method') return money.value ? `${METHOD_NAMES[money.value.method] || 'Value'}: ${valueTextOf(money.value)}` : 'Not set';
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
