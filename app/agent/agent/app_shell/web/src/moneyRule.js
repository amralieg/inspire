const CODE = /^[A-Z]{3}$/;

export function draftOf(rule) {
  if (rule?.currency !== 'convert') return { mode: 'per_currency', base: '', rates: [] };
  return { mode: 'convert', base: rule.base || '', rates: Object.entries(rule.rates || {}).map(([code, rate]) => ({ code, rate: String(rate) })) };
}

export function ruleOf(draft) {
  if (draft.mode !== 'convert') return { rule: { currency: 'per_currency' }, problems: [] };
  const problems = [];
  const base = String(draft.base || '').trim().toUpperCase();
  if (!CODE.test(base)) problems.push('The base currency is a three-letter code such as USD.');
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
  return { rule: { currency: 'convert', base, rates }, problems };
}

export function ruleSentence(rule) {
  if (rule?.currency !== 'convert') {
    return 'Each currency is totalled on its own. Amounts in different currencies are never added together.';
  }
  const rates = Object.entries(rule.rates || {}).map(([code, rate]) => `1 ${code} = ${rate} ${rule.base}`).join(', ');
  return `Every amount is converted to ${rule.base} at the rates you typed in (${rates}), then added up.`;
}
