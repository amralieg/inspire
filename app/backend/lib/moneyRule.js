const CODE = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MODES = ['per_currency', 'convert'];
const MAX_PERIODS = 60;

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function windowProblems(window) {
  if (window == null) return [];
  if (!isPlain(window)) return ['the money window is an object with periods, the number of closed periods to total'];
  const periods = window.periods;
  if (!Number.isInteger(periods) || periods < 1 || periods > MAX_PERIODS) return [`the money window counts 1 to ${MAX_PERIODS} closed periods`];
  return [];
}

function rateProblems(rule) {
  const problems = [];
  const hasRates = rule.rates !== undefined;
  const hasColumn = rule.rate_column !== undefined;
  if (hasRates && hasColumn) return ['converting money takes typed rates or one rate column, not both'];
  if (hasColumn) {
    if (typeof rule.rate_column !== 'string' || !COLUMN.test(rule.rate_column)) problems.push('the rate column is a plain column name');
    return problems;
  }
  const base = String(rule.base || '');
  if (!CODE.test(base)) problems.push('the money base currency is an ISO 4217 code such as USD');
  const rates = rule.rates;
  if (!isPlain(rates) || Object.keys(rates).length === 0) return problems.concat(['converting money needs at least one rate, typed in as currency: units of the base currency']);
  for (const [code, rate] of Object.entries(rates)) {
    if (!CODE.test(code) || typeof rate === 'boolean' || typeof rate !== 'number' || !(rate > 0 && rate < 1e9)) {
      problems.push(`the rate for ${JSON.stringify(code)} must be an ISO 4217 code with a positive number`);
    }
  }
  return problems;
}

function moneyRuleProblems(rule) {
  if (rule === null || rule === undefined) return [];
  if (!isPlain(rule)) return ['the money rule is an object: currency mode and, when it converts, base and rates'];
  const mode = rule.currency === undefined ? 'per_currency' : rule.currency;
  if (!MODES.includes(mode)) return [`the money currency mode is one of ${MODES.join(', ')}`];
  const problems = windowProblems(rule.window);
  if (mode === 'convert') return problems.concat(rateProblems(rule));
  return problems;
}

function moneyRuleClean(rule) {
  if (rule === null || rule === undefined || (rule.currency || 'per_currency') === 'per_currency') {
    const window = rule && rule.window ? { window: { periods: rule.window.periods } } : {};
    return { currency: 'per_currency', ...window };
  }
  const out = { currency: 'convert', base: String(rule.base) };
  if (rule.rate_column !== undefined) out.rate_column = rule.rate_column;
  else out.rates = Object.fromEntries(Object.keys(rule.rates).sort().map((code) => [code, Number(rule.rates[code])]));
  if (rule.window) out.window = { periods: rule.window.periods };
  return out;
}

module.exports = { moneyRuleProblems, moneyRuleClean };
