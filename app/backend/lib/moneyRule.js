// ISO 4217 codes, the same list as shell_sql.MONEY_CODES; the parity test runs the shared fixture through both.
const CURRENCY_CODES = new Set([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT',
  'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD',
  'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP',
  'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF',
  'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK',
  'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK',
  'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU',
  'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR',
  'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR',
  'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC',
  'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF', 'XPF',
  'YER', 'ZAR', 'ZMW', 'ZWG', 'ZWL'
]);
const CODE = { test: (code) => CURRENCY_CODES.has(code) };
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/;
const STATUS = /^[A-Za-z0-9_ -]{1,40}$/;
const MODES = ['per_currency', 'convert'];
const RULES = ['losses', 'net', 'gains'];
const PER = ['row', 'group'];
const MAX_PERIODS = 60;
const MAX_STATUSES = 20;
const RATE_TABLE_KEYS = ['table', 'currency_column', 'base_column', 'date_column', 'rate_column', 'load_column'];
const VALUE_METHODS = ['fixed', 'column', 'equation'];

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const { compileExpression } = require('../../agent/agent/app_shell/web/src/moneyValue.js');

function valueProblems(value) {
  if (!isPlain(value)) return ['the value of each record is an object: its method, and its amount, column or equation'];
  if (!VALUE_METHODS.includes(value.method)) return [`the value method is one of ${VALUE_METHODS.join(', ')}`];
  const problems = [];
  const byCode = value.currency !== undefined;
  const byColumn = value.currency_column !== undefined;
  if (byCode === byColumn) problems.push('the value names one currency: a code such as USD (currency), or the column that holds it (currency_column)');
  else if (byCode && !CODE.test(value.currency)) problems.push('the value currency is an ISO 4217 code such as USD');
  else if (byColumn && !COLUMN.test(value.currency_column)) problems.push('the value currency_column is a plain column name');
  if (value.method === 'fixed' && !(Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 1e12)) problems.push('a fixed value is a positive amount per record');
  if (value.method === 'column' && !(typeof value.column === 'string' && COLUMN.test(value.column))) problems.push('a column value names the plain column that holds each amount');
  if (value.method === 'equation') { const compiled = compileExpression(value.expression); if (compiled.problem) problems.push(compiled.problem); }
  return problems;
}

function valueClean(value) {
  const out = { method: value.method };
  if (value.method === 'fixed') out.amount = Number(value.amount);
  if (value.method === 'column') out.column = value.column;
  if (value.method === 'equation') out.expression = String(value.expression).trim();
  if (value.currency !== undefined) out.currency = value.currency;
  else out.currency_column = value.currency_column;
  return out;
}

function windowProblems(window) {
  if (window == null) return [];
  if (!isPlain(window)) return ['the money window is an object with periods, the number of closed periods to total'];
  const periods = window.periods;
  if (!Number.isInteger(periods) || periods < 1 || periods > MAX_PERIODS) return [`the money window counts 1 to ${MAX_PERIODS} closed periods`];
  return [];
}

function statusProblems(statuses) {
  if (statuses === undefined) return [];
  if (!Array.isArray(statuses) || statuses.length < 1 || statuses.length > MAX_STATUSES) return [`the statuses are a list of 1 to ${MAX_STATUSES} status values`];
  return statuses.filter((s) => typeof s !== 'string' || !STATUS.test(s)).map((s) => `the status ${JSON.stringify(s)} is a plain word such as used`);
}

function rateProblems(rule) {
  const problems = [];
  const hasRates = rule.rates !== undefined;
  const hasColumn = rule.rate_column !== undefined;
  const hasTable = rule.rate_table !== undefined;
  if ([hasRates, hasColumn, hasTable].filter(Boolean).length > 1) return ['converting money takes typed rates, one rate column, or a rate table, not more than one'];
  if (hasTable) {
    const table = rule.rate_table;
    if (!isPlain(table) || !RATE_TABLE_KEYS.every((k) => typeof table[k] === 'string')) return ['the rate table names its table and its columns: table, currency_column, base_column, date_column, rate_column'];
    if (!TABLE.test(table.table)) problems.push('the rate table is a table name such as main.fx.rates');
    for (const key of RATE_TABLE_KEYS.slice(1)) if (!COLUMN.test(table[key])) problems.push(`the rate table ${key} is a plain column name`);
    return problems.concat(base(rule));
  }
  if (hasColumn) {
    if (typeof rule.rate_column !== 'string' || !COLUMN.test(rule.rate_column)) problems.push('the rate column is a plain column name');
    return problems.concat(base(rule));
  }
  const rates = rule.rates;
  problems.push(...base(rule));
  if (!isPlain(rates) || Object.keys(rates).length === 0) return problems.concat(['converting money needs at least one rate, typed in as currency: units of the base currency']);
  for (const [code, rate] of Object.entries(rates)) {
    if (!CODE.test(code) || typeof rate === 'boolean' || typeof rate !== 'number' || !(rate > 0 && rate < 1e9)) {
      problems.push(`the rate for ${JSON.stringify(code)} must be an ISO 4217 code with a positive number`);
    }
  }
  return problems;
}

function base(rule) {
  return CODE.test(String(rule.base || '')) ? [] : ['the money base currency is an ISO 4217 code such as USD'];
}

function moneyRuleProblems(rule) {
  if (rule === null || rule === undefined) return [];
  if (!isPlain(rule)) return ['the money rule is an object: currency mode and, when it converts, base and rates'];
  const mode = rule.currency === undefined ? 'per_currency' : rule.currency;
  if (!MODES.includes(mode)) return [`the money currency mode is one of ${MODES.join(', ')}`];
  let problems = windowProblems(rule.window).concat(statusProblems(rule.statuses));
  if (rule.statuses !== undefined && (typeof rule.status_column !== 'string' || !COLUMN.test(rule.status_column))) problems.push('statuses need status_column, the plain column name that holds each row status');
  if (rule.rule !== undefined && !RULES.includes(rule.rule)) problems.push(`the money rule is one of ${RULES.join(', ')}`);
  if (rule.off !== undefined && typeof rule.off !== 'boolean') problems.push('off is true or false');
  const per = rule.per === undefined ? 'row' : rule.per;
  if (!PER.includes(per)) problems.push(`per is one of ${PER.join(', ')}`);
  if (per === 'group' && (typeof rule.group_column !== 'string' || !COLUMN.test(rule.group_column))) problems.push('per group needs group_column, the plain column name that identifies each group');
  if (mode === 'convert') problems = problems.concat(rateProblems(rule));
  if (rule.value !== undefined) problems = problems.concat(valueProblems(rule.value));
  return problems;
}

function moneyRuleClean(rule) {
  if (rule === null || rule === undefined) return { currency: 'per_currency' };
  const out = { currency: rule.currency || 'per_currency' };
  if (out.currency === 'convert') {
    out.base = String(rule.base);
    if (rule.rate_table !== undefined) out.rate_table = { ...rule.rate_table };
    else if (rule.rate_column !== undefined) out.rate_column = rule.rate_column;
    else out.rates = Object.fromEntries(Object.keys(rule.rates).sort().map((code) => [code, Number(rule.rates[code])]));
  }
  if (rule.window) out.window = { periods: rule.window.periods };
  if (rule.statuses !== undefined) out.statuses = [...rule.statuses];
  if (rule.rule !== undefined && rule.rule !== 'losses') out.rule = rule.rule;
  if (rule.statuses !== undefined) out.status_column = rule.status_column;
  if (rule.off === true) out.off = true;
  if (rule.per === 'group') { out.per = 'group'; out.group_column = rule.group_column; }
  if (rule.value !== undefined) out.value = valueClean(rule.value);
  return out;
}

module.exports = { moneyRuleProblems, moneyRuleClean, valueProblems };
