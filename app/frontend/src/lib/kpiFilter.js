import {
  PYTHON_DIGIT as DIGIT, PYTHON_SPACE as SPACE, PYTHON_WORD as WORD, fixedDigits, pyCasefold, pyDecimal, pyIgnoreCase, pyRepr, pySpaced,
  pySqlLiteral, pyStr, pyStrip, pyTruthy,
} from './pythonText.js';

export const KPI_FILTER_OPERATORS = ['=', '!=', '<', '<=', '>', '>='];
export const KPI_FILTER_COMPARISONS = ['<', '<=', '>', '>='];
export const KPI_FILTER_KINDS = ['decimal', 'integer', 'date', 'timestamp', 'boolean', 'text'];
export const KPI_FILTER_MISMATCH_LEAD = 'its filter does not match its name: ';
export const KPI_FILTER_MISMATCH_TEXT = 'not measured, because its filter does not match its name';
export const KPI_BASELINE_MISMATCH = '[BASELINE: not measured, because the KPI\'s filter does not match its name]';

const ORDERED_KINDS = ['decimal', 'integer', 'date', 'timestamp'];
const LONGEST_LITERAL = 4096;
const DATE_RE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u;
const TIMESTAMP_RE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}(?:[ T]\p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2}(?:\.\p{Nd}{1,6})?)?)?$/u;
const LETTER = '[a-zA-Z\\u0130\\u0131\\u017f\\u212a]';
const words = (body) => new RegExp(`(?<!${WORD})(${pyIgnoreCase(body)})(?!${WORD})`, 'giu');
const COMPARISON_WORDS = [
  ['<', words('negative|below|beneath|under|less than|fewer than|lower than|smaller than|at most|no more than')],
  ['>', words('positive|above|over|beyond|exceed|exceeds|exceeded|exceeding|more than|greater than|higher than|larger than|at least|'
    + 'no less than|late|overdue|past due|delayed')],
];
const SIGN_WORDS = { negative: '<', positive: '>' };
const FLIPPED = { '<': '>', '>': '<' };
const TREATMENT_TOKENS = ['ab', 'arm', 'campaign', 'coupon', 'experiment', 'holdout', 'offer', 'promo', 'promotion', 'treatment', 'variant'];
const NOT_COMPARISON_RE = new RegExp([
  `over${SPACE}+time`,
  `over${SPACE}+(?:the${SPACE}+)?(?:last|past|next|previous|prior|coming|following)`,
  `(?:over|within|during|in)${SPACE}+(?:(?:the|a|an|each|every|last|past|next|previous|prior|coming|following|rolling|trailing)${SPACE}+)*`
    + `(?:${DIGIT}+(?:\\.${DIGIT}+)?${SPACE}*-?${SPACE}*)?(?:(?:business|calendar|working)${SPACE}+)?`
    + `(?:day|week|month|quarter|year|period|window|horizon|season)s?(?:${SPACE}+(?:window|period|horizon))?`,
  'over[- ]the[- ]counter',
  `under${SPACE}+(?:(?:a|an|the|its|their|this|that)${SPACE}+)?(?:management|review|contract|warranty|construction|investigation|`
    + `${TREATMENT_TOKENS.join('|')})s?`,
].map((body) => `(?<!${WORD})${pyIgnoreCase(body)}(?!${WORD})`).concat(
  `(?<!${WORD})${pyIgnoreCase(`at${SPACE}+least${SPACE}+(?:one|a|an|1|a${SPACE}+single)`)}(?!${WORD})`
    + `(?![.,]${DIGIT}|${SPACE}*(?:%|${pyIgnoreCase('percent')}|${pyIgnoreCase(`per${SPACE}*cent`)}|`
    + `${pyIgnoreCase('(?:half|third|quarter|fifth|tenth)s?')}(?!${WORD})))`,
).join('|'), 'giu');
const SIGN_JOINED_RE = new RegExp(`(?<!${WORD})${pyIgnoreCase('non')}(?=${pyIgnoreCase('(?:positive|negative)')}(?!${WORD}))`, 'giu');
const NEGATION_BEFORE_RE = new RegExp(`(?:(?<!${WORD})${pyIgnoreCase('(?:not|non|never|no)')}|${pyIgnoreCase("n't")})(?:${SPACE}|-)+`
  + `(?:${pyIgnoreCase('be')}${SPACE}+)?$`, 'u');
const IDIOM_THE_RE = new RegExp(`(?<!${WORD})(?:over|under|above|below|beyond)-the-${LETTER}+(?!${WORD})`, 'iuy');
const IDIOM_SAME_RE = new RegExp(`(?<!${WORD})(${LETTER}+)-over-`, 'iuy');
const IDIOM_LATE_RE = new RegExp(`(?<!${WORD})${pyIgnoreCase(
  'late-(?:night|evening|afternoon|morning|day|week|weekend|month|quarter|year|season|stage|shift)s?')}(?!${WORD})`, 'iuy');
const WORD_ENDS_RE = new RegExp(`(?!${WORD})`, 'uy');
const HYPHEN_RE = new RegExp(`(?<=${LETTER})-(?=${LETTER})`, 'gu');
const STATE_WORDS = ['unpaid', 'overdue', 'outstanding', 'open', 'pending', 'in transit', 'idle', 'inactive', 'late', 'delayed', 'aged',
  'unresolved', 'unanswered', 'unassigned', 'unshipped', 'unbilled', 'uncollected', 'dormant', 'stalled', 'stuck', 'waiting', 'on hold',
  'past due', 'backordered'];
const STATE_OVER_RE = new RegExp(pyIgnoreCase(`(?<!${WORD})(${STATE_WORDS.map((word) => word.replace(' ', `${SPACE}+`)).join('|')})`
  + `${SPACE}+(?:for${SPACE}+)?over${SPACE}+${DIGIT}+(?:\\.${DIGIT}+)?${SPACE}*-?${SPACE}*(?:(?:business|calendar|working)${SPACE}+)?`
  + `(?:day|week|month|quarter|year)s?(?!${WORD})`), 'giu');
const FLAG_TOKENS = new Set(['flag', 'flagged', 'is', 'has', 'ind', 'indicator', 'bool', 'yn']);

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const tokens = (value) => new Set((pyTruthy(value) ? pyStr(value) : '').toLowerCase().split(/[^a-z0-9]+/));

function isWhole({ digits, exponent }) {
  return exponent >= 0 || /^0*$/.test(digits.slice(digits.length + exponent));
}

function wholeText({ negative, digits, exponent }) {
  if (exponent > LONGEST_LITERAL) return null;
  const kept = exponent >= 0 ? `${digits}${'0'.repeat(exponent)}` : digits.slice(0, Math.max(0, digits.length + exponent));
  const text = kept.replace(/^0+/, '') || '0';
  return negative && text !== '0' ? `-${text}` : text;
}

function numberLiteral(parsed) {
  if (isWhole(parsed)) return wholeText(parsed);
  const number = Number(`${parsed.negative ? '-' : ''}${parsed.digits || '0'}e${parsed.exponent}`) + 0;
  const [mantissa, power] = Math.abs(number).toExponential().split('e');
  const text = `${number < 0 ? '-' : ''}${fixedDigits(mantissa.replace('.', ''), Number(power))}`;
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function typedValue(kind, value) {
  if (kind === 'decimal' || kind === 'integer') {
    const parsed = typeof value === 'boolean' ? null : pyDecimal(pyStr(value));
    const literal = parsed ? numberLiteral(parsed) : null;
    return literal == null ? [null, 'is not a number'] : [literal, ''];
  }
  const text = typeof value === 'string' ? pyStrip(value) : '';
  if (kind === 'date') return DATE_RE.test(text) ? [text, ''] : [null, 'is not a date written YYYY-MM-DD'];
  if (kind === 'timestamp') return TIMESTAMP_RE.test(text) ? [text, ''] : [null, 'is not a date and time written YYYY-MM-DD HH:MM:SS'];
  if (kind === 'boolean') {
    if (typeof value === 'boolean') return [value, ''];
    const folded = pyCasefold(text);
    return folded === 'true' || folded === 'false' ? [folded === 'true', ''] : [null, 'is not true or false'];
  }
  if (kind === 'text') return typeof value === 'string' || typeof value === 'number' ? [pyStr(value), ''] : [null, 'is not text'];
  return [null, 'cannot be filtered'];
}

export function kpiFilterClause(part) {
  const entry = isMap(part) ? part : {};
  const column = pyTruthy(entry.filter_column) ? pyStr(entry.filter_column) : '';
  const value = entry.filter_value;
  if (!pyStrip(column) || value == null) return null;
  const op = pyStrip(pyTruthy(entry.filter_op) ? pyStr(entry.filter_op) : '=');
  const kind = entry.filter_type;
  if (!KPI_FILTER_OPERATORS.includes(op)) throw new Error(`KPI filter operator ${pyRepr(op)} is not one of ${KPI_FILTER_OPERATORS.join(', ')}`);
  if (kind == null) {
    if (op !== '=') throw new Error(`the KPI filter ${column} ${op} names no filter_type, so Inspire cannot type its value`);
    return [column, op, pySqlLiteral(value)];
  }
  if (typeof kind !== 'string' || !KPI_FILTER_KINDS.includes(kind)) {
    throw new Error(`KPI filter type ${pyRepr(kind)} is not one of ${KPI_FILTER_KINDS.join(', ')}`);
  }
  if (KPI_FILTER_COMPARISONS.includes(op) && !ORDERED_KINDS.includes(kind)) {
    throw new Error(`the KPI filter ${column} ${op} compares a ${kind} column; only number and date columns take <, <=, > or >=`);
  }
  const [typed, problem] = typedValue(kind, value);
  if (problem) throw new Error(`the KPI filter value ${pyRepr(value)} of ${column} ${problem}`);
  if (kind === 'decimal' || kind === 'integer') return [column, op, typed];
  if (kind === 'date' || kind === 'timestamp') return [column, op, `${kind.toUpperCase()} ${pySqlLiteral(typed)}`];
  if (kind === 'boolean') return [column, op, typed ? 'TRUE' : 'FALSE'];
  return [column, op, pySqlLiteral(typed)];
}

export function kpiFilterText(part) {
  const clause = kpiFilterClause(part);
  return clause ? clause.join(' ') : '';
}

export function kpiFilterShown(part) {
  try {
    return { text: kpiFilterText(part), problem: '' };
  } catch (error) {
    return { text: '', problem: error.message };
  }
}

function isCategory(part, distinct) {
  let kind = part.filter_type;
  if (kind == null) kind = typedValue('decimal', part.filter_value)[1] ? 'text' : 'decimal';
  if (kind === 'text' || kind === 'boolean') return true;
  if (kind === 'decimal' || kind === 'integer') {
    const few = (typeof distinct === 'number' || typeof distinct === 'boolean') && distinct > 0 && distinct <= 2;
    return [...tokens(part.filter_column)].some((t) => FLAG_TOKENS.has(t)) || few;
  }
  return false;
}

function stickyEnd(pattern, text, at) {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return match ? at + match[0].length : -1;
}

const letterLower = (text) => [...text].map((ch) => (ch === '\u0130' ? 'i' : ch.toLowerCase())).join('');

function sameOverEnd(text, at) {
  IDIOM_SAME_RE.lastIndex = at;
  const match = IDIOM_SAME_RE.exec(text);
  if (!match) return -1;
  const start = at + match[0].length;
  const end = start + match[1].length;
  WORD_ENDS_RE.lastIndex = end;
  return end <= text.length && letterLower(text.slice(start, end)) === letterLower(match[1]) && WORD_ENDS_RE.test(text) ? end : -1;
}

function withoutIdioms(text) {
  let out = '';
  let kept = 0;
  let at = 0;
  while (at < text.length) {
    let end = stickyEnd(IDIOM_THE_RE, text, at);
    if (end < 0) end = sameOverEnd(text, at);
    if (end < 0) end = stickyEnd(IDIOM_LATE_RE, text, at);
    if (end < 0) {
      at += text.codePointAt(at) > 0xffff ? 2 : 1;
    } else {
      out += `${text.slice(kept, at)} `;
      kept = end;
      at = end;
    }
  }
  return out + text.slice(kept);
}

export function kpiComparisonProblem(spec, definition = '', distinct = null) {
  const entry = isMap(spec) ? spec : {};
  if (pyTruthy(entry.metric_view)) return '';
  const name = pyTruthy(entry.name) ? pyStr(entry.name) : '';
  const said = withoutIdioms(pySpaced(`${name} ${pyTruthy(definition) ? pyStr(definition) : ''}`)).replace(HYPHEN_RE, ' ')
    .replace(STATE_OVER_RE, (_match, word) => `${word} over`).replace(NOT_COMPARISON_RE, ' ').replace(SIGN_JOINED_RE, 'non ');
  const measured = tokens(entry.column);
  const found = new Map();
  for (const [direction, pattern] of COMPARISON_WORDS) {
    for (const match of said.matchAll(pattern)) {
      const word = match[1].toLowerCase();
      if (pySpaced(word).split(' ').every((w) => measured.has(w))) continue;
      const negation = NEGATION_BEFORE_RE.exec(said.slice(0, match.index));
      const phrase = negation ? pySpaced(said.slice(negation.index, match.index + match[0].length).toLowerCase()) : word;
      if (!found.has(phrase)) found.set(phrase, { direction: negation ? FLIPPED[direction] : direction, word, negated: Boolean(negation) });
    }
  }
  if (!found.size) return '';
  let clause;
  try {
    clause = kpiFilterClause(entry);
  } catch {
    return '';
  }
  const listed = [...found.keys()].join(', ');
  if (clause === null) return `${KPI_FILTER_MISMATCH_LEAD}the name says ${listed}, a comparison, but no filter compares a value, so it measures every row`;
  const [column, op, literal] = clause;
  const shown = clause.join(' ');
  if (KPI_FILTER_COMPARISONS.includes(op)) {
    const wrong = [...found].filter(([, { direction }]) => direction !== op[0]).map(([phrase]) => phrase);
    if (wrong.length) {
      return `${KPI_FILTER_MISMATCH_LEAD}the name says ${wrong.join(', ')}, but the filter ${shown} keeps the rows ${op[0] === '<' ? 'below' : 'above'} ${literal}`;
    }
    const raw = entry.filter_type === 'decimal' || entry.filter_type === 'integer' ? entry.filter_value : null;
    const number = typeof raw === 'number' ? raw : null;
    for (const [phrase, { direction, word, negated }] of found) {
      if (!Object.hasOwn(SIGN_WORDS, word)) continue;
      const exact = number !== null
        && { '<': number <= 0, '<=': negated ? number <= 0 : number < 0, '>': number >= 0, '>=': negated ? number >= 0 : number > 0 }[op];
      if (!exact) {
        return `${KPI_FILTER_MISMATCH_LEAD}the name says ${phrase}, but the filter ${shown} does not keep exactly the ${phrase} values; `
          + `${phrase} needs ${column} ${direction}${negated ? '=' : ''} 0`;
      }
    }
    return '';
  }
  if (isCategory(entry, distinct)) return '';
  const [, { direction, word, negated }] = [...found][0];
  const hint = Object.hasOwn(SIGN_WORDS, word) ? `${column} ${direction}${negated ? '=' : ''} 0` : `${column} ${direction} a threshold`;
  return `${KPI_FILTER_MISMATCH_LEAD}the name says ${listed}, a comparison, but the filter ${shown} keeps the rows where ${column} `
    + `${op === '=' ? 'equals' : 'differs from'} one value; compare with ${hint} instead`;
}

export function kpiFilterMismatch(spec) {
  return isMap(spec) && pyTruthy(spec.computable) ? kpiComparisonProblem(spec) : '';
}

export function isFilterMismatchReason(reason) {
  return String(reason ?? '').trim().startsWith(KPI_FILTER_MISMATCH_LEAD);
}
