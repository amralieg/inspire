import { addCounts, countOf, grouped, isAmount, isMoney, kindOf, largestFirst, numberOf, stakeWords, unitOf, wholeMoney } from './format.js';

const TRIM = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
const SHOWN = 4;

export function amountText(value, kind, currency) {
  if (!isAmount(value)) return '';
  if (kind === 'percent') return `${(numberOf(value) * 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  const text = grouped(countOf(value), TRIM);
  return kind === 'money' && currency ? `${text} ${currency}` : text;
}

export const assumptionLabel = (name) => {
  const words = String(name || '').toLowerCase().replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const columnWords = (name) => String(name || '').replace(/_+/g, ' ').trim();

function numberOrNull(text) {
  return isAmount(text) ? countOf(text) : null;
}

export function inputsOf(model, row) {
  const raw = row?._inspire_fx ?? row?.fx;
  if (model?.inputs !== 'columns' || raw == null) return null;
  const cells = String(raw).split('|');
  if (cells.length !== model.columns.length) return null;
  return Object.fromEntries(model.columns.map((c, i) => [c, numberOrNull(cells[i])]));
}

export function shownAmount(row) {
  for (const value of [row?._inspire_money, row?.money, row?.value_at_stake]) {
    if (isAmount(value)) return countOf(value);
  }
  return null;
}

export function recordFormula(model, row, amount = shownAmount(row)) {
  if (amount == null || !model) return '';
  if (model.inputs === 'said') {
    const said = String(row?._inspire_fx ?? row?.fx ?? row?.value_at_stake_formula ?? '').trim();
    return said;
  }
  const inputs = inputsOf(model, row);
  if (!inputs) return '';
  const values = Object.fromEntries((model.assumptions || []).map((a) => [a.name, a.value]));
  const pieces = [];
  for (const part of model.parts || []) {
    if (part.text != null) pieces.push(part.text);
    else if (part.column) {
      if (inputs[part.column] == null) return '';
      pieces.push(amountText(inputs[part.column], part.kind, model.currency));
    } else pieces.push(amountText(values[part.assumption], part.kind, model.currency));
  }
  return `${pieces.join('')} = ${amountText(amount, 'money', unitOf(model))}`;
}

export function moneyOf(model, row, currency = unitOf(model), kind = kindOf(model)) {
  const amount = shownAmount(row);
  return { amount, currency, text: amount == null ? '' : wholeMoney(amount, currency, kind), formula: recordFormula(model, row, amount) };
}

export function ruleText(model) {
  if (!model?.parts?.length) return '';
  const values = Object.fromEntries((model.assumptions || []).map((a) => [a.name, a.value]));
  return model.parts.map((p) => (p.text != null ? p.text : p.column ? `[${columnWords(p.column)}]` : amountText(values[p.assumption], p.kind, model.currency))).join('');
}

export function sumFormula(rows, what, currency, kind = '') {
  const priced = rows.filter((r) => shownAmount(r) != null);
  if (!priced.length) return '';
  const sums = new Map();
  priced.forEach((r) => {
    const key = JSON.stringify([r.currency ?? currency, r.kind ?? kind]);
    sums.set(key, addCounts([sums.get(key), shownAmount(r)]));
  });
  const total = [...sums.entries()].sort((a, b) => largestFirst(a[1], b[1])).map(([key, n]) => wholeMoney(n, ...JSON.parse(key))).join(' + ');
  const listed = [...priced].sort((a, b) => largestFirst(shownAmount(a), shownAmount(b))).slice(0, SHOWN)
    .map((r) => `${r.label || r.key || 'a record'} ${wholeMoney(shownAmount(r), r.currency ?? currency, r.kind ?? kind)}`);
  const more = priced.length > SHOWN ? ` + ${priced.length - SHOWN} more` : '';
  const money = isMoney(priced[0].currency ?? currency, priced[0].kind ?? kind);
  return `${what}: ${listed.join(' + ')}${more} = ${total}. Open a record to see how ${money ? 'its money is' : 'it is'} worked out.`;
}

export function savedFormula(totalText, n, since, unit = '', kind = '') {
  const when = since ? ` since ${since}` : '';
  return `The ${stakeWords(unit, kind)} each fix had when it was fixed, less what a later run still finds, added up over the ${n} ${n === 1 ? 'fix' : 'fixes'} a later run confirmed${when} = ${totalText}`;
}
