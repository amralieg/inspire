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
const isCode = (code) => CURRENCY_CODES.has(code);
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/;
const STATUS = /^[A-Za-z0-9_ -]{1,40}$/;
const MAX_PERIODS = 60;
const MAX_STATUSES = 20;
const RATE_TABLE_KEYS = ['table', 'currency_column', 'base_column', 'date_column', 'rate_column', 'load_column'];

export function draftOf(rule) {
  const window = rule?.window ? String(rule.window.periods) : '';
  const mode = rule?.currency === undefined ? 'per_currency' : rule.currency;
  const statuses = Array.isArray(rule?.statuses) ? rule.statuses.join(', ') : '';
  const base = {
    mode, window, statuses, statusColumn: rule?.status_column || '', rule: rule?.rule || 'losses', off: rule?.off === true, per: rule?.per || 'row', groupColumn: rule?.group_column || '',
    base: '', rates: [], rateSource: 'typed', rateColumn: '', rateTable: { table: '', currency_column: '', base_column: '', date_column: '', rate_column: '', load_column: '' },
    both: false,
  };
  if (mode !== 'convert') return base;
  const sources = [rule.rates !== undefined, rule.rate_column !== undefined, rule.rate_table !== undefined];
  const table = rule.rate_table || {};
  return {
    ...base, base: rule.base || '',
    rateSource: rule.rate_table !== undefined ? 'table' : rule.rate_column !== undefined ? 'column' : 'typed',
    rateColumn: rule.rate_column || '',
    rateTable: { table: table.table || '', currency_column: table.currency_column || '', base_column: table.base_column || '', date_column: table.date_column || '', rate_column: table.rate_column || '', load_column: table.load_column || '' },
    rates: Object.entries(rule.rates || {}).map(([code, rate]) => ({ code, rate: String(rate) })),
    both: sources.filter(Boolean).length > 1,
  };
}

export function ruleOf(draft) {
  const problems = [];
  const windowText = String(draft.window ?? '').trim();
  const window = windowText === '' ? null : Number(windowText);
  if (window !== null && (!Number.isInteger(window) || window < 1 || window > MAX_PERIODS)) {
    problems.push(`The window counts 1 to ${MAX_PERIODS} closed periods, or stays empty for every closed period.`);
  }
  const statuses = String(draft.statuses || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (statuses.length > MAX_STATUSES) problems.push(`Keep to ${MAX_STATUSES} statuses.`);
  for (const s of statuses) if (!STATUS.test(s)) problems.push(`The status "${s}" is a plain word such as used.`);
  if (draft.mode !== 'convert' && draft.mode !== 'per_currency') return { rule: null, problems: ['The money currency mode is per currency or convert.'] };
  const out = { currency: draft.mode === 'convert' ? 'convert' : 'per_currency' };
  if (window !== null && Number.isInteger(window)) out.window = { periods: window };
  if (statuses.length) {
    if (!COLUMN.test(String(draft.statusColumn || '').trim())) problems.push('Statuses need the column that holds each row status, such as status.');
    out.statuses = statuses;
    out.status_column = String(draft.statusColumn || '').trim();
  }
  if (!['losses', 'net'].includes(draft.rule)) problems.push('The money rule is losses or net.');
  if (draft.rule && draft.rule !== 'losses') out.rule = draft.rule;
  if (draft.off) out.off = true;
  if (draft.per === 'group') {
    out.per = 'group';
    if (!COLUMN.test(String(draft.groupColumn || '').trim())) problems.push('Per group needs the column that identifies each group, such as channel.');
    else out.group_column = String(draft.groupColumn).trim();
  }
  if (draft.mode !== 'convert') return { rule: out, problems };
  if (draft.both) problems.push('Converting money takes typed rates, one rate column, or a rate table, not more than one.');
  const base = String(draft.base || '').trim().toUpperCase();
  if (!isCode(base)) problems.push('The base currency is a three-letter code such as USD.');
  out.base = base;
  if (draft.rateSource === 'column') {
    const column = String(draft.rateColumn || '').trim();
    if (!COLUMN.test(column)) problems.push('The rate column is the name of a column that holds one rate per row, such as fx_rate.');
    out.rate_column = column;
    return { rule: out, problems };
  }
  if (draft.rateSource === 'table') {
    const t = draft.rateTable;
    if (!TABLE.test(String(t.table || '').trim())) problems.push('The rate table is a table name such as main.fx.rates.');
    for (const key of RATE_TABLE_KEYS.slice(1)) if (!COLUMN.test(String(t[key] || '').trim())) problems.push(`The rate table ${key.replace('_', ' ')} is a plain column name.`);
    out.rate_table = { table: String(t.table || '').trim(), currency_column: String(t.currency_column || '').trim(), base_column: String(t.base_column || '').trim(), date_column: String(t.date_column || '').trim(), rate_column: String(t.rate_column || '').trim(), load_column: String(t.load_column || '').trim() };
    return { rule: out, problems };
  }
  const rates = {};
  if (!draft.rates.length) problems.push('Add at least one rate: how much of the base currency one unit of each currency is worth.');
  for (const row of draft.rates) {
    const code = String(row.code || '').trim().toUpperCase();
    const value = Number(String(row.rate || '').trim());
    if (!isCode(code)) problems.push(`The rate's currency "${row.code || ''}" is a three-letter code such as AED.`);
    else if (code in rates) problems.push(`${code} has two rates; keep one.`);
    else if (!(value > 0)) problems.push(`The rate for ${code} must be a positive number.`);
    else rates[code] = value;
  }
  out.rates = rates;
  return { rule: out, problems };
}

export function ruleSentence(rule) {
  const periods = rule?.window?.periods;
  const window = periods ? ` over the last ${periods} closed ${periods === 1 ? 'period' : 'periods'}` : ' over every closed period';
  if (rule?.off) return 'Money is off for this use case: no money total, chart or Genie money answer is shown.';
  const counted = rule?.per === 'group' ? `Each ${rule.group_column} counts once, with its largest row. ` : '';
  const statuses = rule?.statuses ? ` Only rows whose status is ${rule.statuses.join(', ')} count.` : '';
  const losses = (rule?.rule || 'losses') === 'losses' ? 'Only losses count' : 'Gains and losses are netted';
  const tail = `${counted}${losses}.${statuses}`;
  if (rule?.currency !== 'convert') return `Each currency is totalled on its own${window}. Amounts in different currencies are never added together. ${tail}`;
  if (rule.rate_table) return `Every amount is converted to ${rule.base} at the rate in ${rule.rate_table.table} for its currency, base and date, then added up${window}. ${tail}`;
  if (rule.rate_column !== undefined) return `Every amount is converted to ${rule.base} at the rate in ${rule.rate_column} on its own row, then added up${window}. ${tail}`;
  const rates = Object.entries(rule.rates || {}).map(([code, rate]) => `1 ${code} = ${rate} ${rule.base}`).join(', ');
  return `Every amount is converted to ${rule.base} at the rates you typed in (${rates}), then added up${window}. ${tail}`;
}

const shown = (value) => (value == null ? 'no rows' : Math.round(Number(value)).toLocaleString('en-US'));

export function previewLines(preview) {
  const totals = (preview?.totals || []).map((t) => `${t.currency || ''} ${shown(t.now)}`.trim());
  const top = (preview?.top || []).map((row) => `${row.currency || preview?.rule?.base || ''} ${shown(row.amount)}`.trim());
  return { totals, top, leftOut: preview?.left_out?.text || '' };
}

export function moneyNoteLine(data) {
  return [data?.basis, data?.left_out?.text].filter(Boolean).join('. ');
}

export function formulaLine(rule) {
  const counted = rule?.statuses ? `only rows whose ${rule.status_column} is ${rule.statuses.join(', ')}` : 'every row';
  const basis = rule?.rule === 'net' ? 'the signed amount' : 'the loss on each row';
  const rate = rule?.currency !== 'convert' ? 'in its own currency'
    : rule.rate_table ? `× the rate for its currency, ${rule.base} and date`
    : rule.rate_column !== undefined ? `× the rate in ${rule.rate_column}`
    : `× the rate you typed in, to ${rule.base}`;
  return `Stake = ${basis} ${rate}, for ${counted}.`;
}

// The worked example: each sample row through the rule. sample = { amount, currency, status, rows }, the column names and the rows.
export function workedExample(rule, sample) {
  if (!sample || !Array.isArray(sample.rows)) return [];
  return sample.rows.slice(0, 3).map((row) => {
    const amount = Number(row[sample.amount]);
    const currency = String(row[sample.currency] ?? '');
    const status = sample.status ? String(row[sample.status] ?? '') : '';
    const shownAmount = `${currency} ${Math.round(amount * 100) / 100}`.trim();
    if (rule?.statuses && status && !rule.statuses.includes(status)) return `${shownAmount} with status ${status} is not counted.`;
    if (rule?.currency !== 'convert') return `${shownAmount} is counted as ${shownAmount}, in its own currency.`;
    const rate = rule.rates ? rule.rates[currency] : undefined;
    if (rate === undefined) return `${shownAmount}: its rate is read from ${rule.rate_column || rule.rate_table?.table || 'the rate source'} when the App is built.`;
    const stake = Math.round(amount * rate * 100) / 100;
    return `${shownAmount} × ${rate} = ${stake} ${rule.base}.`;
  });
}
