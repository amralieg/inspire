const CODE = /^[A-Z]{3}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_PERIODS = 60;

export function draftOf(rule) {
  const window = rule?.window ? String(rule.window.periods) : '';
  const mode = rule?.currency === undefined ? 'per_currency' : rule.currency;
  if (mode !== 'convert') return { mode, base: '', rates: [], rateColumn: '', rateSource: 'typed', window, both: false };
  const column = rule.rate_column !== undefined;
  return {
    mode, base: rule.base || '', rateSource: column ? 'column' : 'typed', rateColumn: rule.rate_column || '', both: column && rule.rates !== undefined,
    rates: Object.entries(rule.rates || {}).map(([code, rate]) => ({ code, rate: String(rate) })), window,
  };
}

export function ruleOf(draft) {
  const problems = [];
  const windowText = String(draft.window ?? '').trim();
  const window = windowText === '' ? null : Number(windowText);
  if (window !== null && (!Number.isInteger(window) || window < 1 || window > MAX_PERIODS)) {
    problems.push(`The window counts 1 to ${MAX_PERIODS} closed periods, or stays empty for every closed period.`);
  }
  const withWindow = (rule) => (window === null || !Number.isInteger(window) ? rule : { ...rule, window: { periods: window } });
  if (draft.mode !== 'convert' && draft.mode !== 'per_currency') {
    return { rule: null, problems: ['The money currency mode is per currency or convert.'] };
  }
  if (draft.mode !== 'convert') return { rule: withWindow({ currency: 'per_currency' }), problems };
  if (draft.both) problems.push('Converting money takes typed rates or one rate column, not both.');
  const base = String(draft.base || '').trim().toUpperCase();
  if (!CODE.test(base)) problems.push('The base currency is a three-letter code such as USD.');
  if (draft.rateSource === 'column') {
    const column = String(draft.rateColumn || '').trim();
    if (!COLUMN.test(column)) problems.push('The rate column is the name of a column that holds one rate per row, such as fx_rate.');
    return { rule: withWindow({ currency: 'convert', base, rate_column: column }), problems };
  }
  const rates = {};
  if (!draft.rates.length) problems.push('Add at least one rate: how much of the base currency one unit of each currency is worth.');
  for (const row of draft.rates) {
    const code = String(row.code || '').trim().toUpperCase();
    const value = Number(String(row.rate || '').trim());
    if (!CODE.test(code)) problems.push(`The rate's currency "${row.code || ''}" is a three-letter code such as AED.`);
    else if (code in rates) problems.push(`${code} has two rates; keep one.`);
    else if (!(value > 0)) problems.push(`The rate for ${code} must be a positive number.`);
    else rates[code] = value;
  }
  return { rule: withWindow({ currency: 'convert', base, rates }), problems };
}

export function ruleSentence(rule) {
  const window = rule?.window?.periods
    ? ` over the last ${rule.window.periods} closed ${rule.window.periods === 1 ? 'period' : 'periods'}`
    : ' over every closed period';
  if (rule?.currency !== 'convert') {
    return `Each currency is totalled on its own${window}. Amounts in different currencies are never added together.`;
  }
  if (rule.rate_column !== undefined) {
    return `Every amount is converted to ${rule.base} at the rate in ${rule.rate_column} on its own row, then added up${window}.`;
  }
  const rates = Object.entries(rule.rates || {}).map(([code, rate]) => `1 ${code} = ${rate} ${rule.base}`).join(', ');
  return `Every amount is converted to ${rule.base} at the rates you typed in (${rates}), then added up${window}.`;
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

