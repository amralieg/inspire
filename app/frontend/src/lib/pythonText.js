export const PYTHON_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
export const PYTHON_SPACE_RE = new RegExp(`${PYTHON_SPACE}+`);
export const PYTHON_WORD = '[\\p{L}\\p{N}_]';
export const PYTHON_DIGIT = '\\p{Nd}';
export const pySpaced = (value) => String(value ?? '').split(PYTHON_SPACE_RE).filter(Boolean).join(' ');
export const pyIgnoreCase = (source) => source.replace(/[iI\u0130\u0131]/g, '[i\\u0130\\u0131]');
export const pyRegexLiteral = (text) => pyIgnoreCase(String(text).replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'));
const EDGE_SPACE_RE = new RegExp(`^(?:${PYTHON_SPACE_RE.source})|(?:${PYTHON_SPACE_RE.source})$`, 'g');
const NOT_PRINTABLE_RE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;
const DECIMAL_DIGIT_RE = /^\p{Nd}$/u;
const SAFE_INTEGER = 2 ** 53;

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hex = (code, width) => code.toString(16).padStart(width, '0');

export function pyStrip(text) {
  return String(text).replace(EDGE_SPACE_RE, '');
}

export function pyCasefold(text) {
  return [...String(text)].map((c) => (c === '\u0131' ? c : c.toUpperCase().toLowerCase().toUpperCase().toLowerCase())).join('');
}

export function pyTruthy(value) {
  if (value == null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isMap(value)) return Object.keys(value).length > 0;
  return true;
}

function expanded(number) {
  const [mantissa, power] = number.toExponential().split('e');
  return { digits: mantissa.replace('-', '').replace('.', ''), exponent: Number(power) };
}

export function fixedDigits(digits, exponent) {
  if (exponent >= 0) {
    const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
    return `${whole}.${digits.slice(exponent + 1) || '0'}`;
  }
  return `0.${'0'.repeat(-exponent - 1)}${digits}`;
}

function pyFloatRepr(number) {
  if (Number.isNaN(number)) return 'nan';
  if (!Number.isFinite(number)) return number < 0 ? '-inf' : 'inf';
  const sign = number < 0 || Object.is(number, -0) ? '-' : '';
  const { digits, exponent } = expanded(Math.abs(number));
  if (exponent >= -4 && exponent < 16) return `${sign}${fixedDigits(digits, exponent)}`;
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

function pyNumberStr(number) {
  if (Number.isInteger(number) && Math.abs(number) < SAFE_INTEGER) return String(number === 0 ? 0 : number);
  return pyFloatRepr(number);
}

function pyStrRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NOT_PRINTABLE_RE.test(ch)) out += code < 0x100 ? `\\x${hex(code, 2)}` : code < 0x10000 ? `\\u${hex(code, 4)}` : `\\U${hex(code, 8)}`;
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

export function pyRepr(value) {
  return typeof value === 'string' ? pyStrRepr(value) : pyStr(value);
}

export function pyStr(value) {
  if (typeof value === 'string') return value;
  if (value == null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return pyNumberStr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (isMap(value)) return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
  return String(value);
}

export function pySqlLiteral(value) {
  return `'${pyStr(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function decimalDigit(ch) {
  let start = ch.codePointAt(0);
  while (start > 0 && DECIMAL_DIGIT_RE.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((ch.codePointAt(0) - start) % 10);
}

const DECIMAL_RE = /^([+-])?(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/;
const FLOAT_RE = /^[+-]?(?:(?:[0-9](?:_?[0-9])*)?\.[0-9](?:_?[0-9])*|[0-9](?:_?[0-9])*\.?)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const FLOAT_WORD_RE = /^([+-]?)(?:(inf|infinity)|nan)$/i;

export function pyFloat(value) {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  let ascii = '';
  for (const ch of pyStrip(value)) ascii += DECIMAL_DIGIT_RE.test(ch) ? decimalDigit(ch) : ch;
  const word = FLOAT_WORD_RE.exec(ascii);
  if (word) return word[2] ? (word[1] === '-' ? -Infinity : Infinity) : NaN;
  return FLOAT_RE.test(ascii) ? Number(ascii.replace(/_/g, '')) : null;
}

export function pyDecimal(text) {
  let ascii = '';
  for (const ch of pyStrip(text)) {
    if (DECIMAL_DIGIT_RE.test(ch)) ascii += decimalDigit(ch);
    else if (ch === '_') continue;
    else if (ch.codePointAt(0) < 128) ascii += ch;
    else return null;
  }
  const match = DECIMAL_RE.exec(ascii);
  if (!match) return null;
  const [, sign, whole, fraction, onlyFraction, power] = match;
  const before = whole ?? '';
  const after = onlyFraction ?? fraction ?? '';
  return { negative: sign === '-', digits: `${before}${after}`, exponent: Number(power ?? 0) - after.length };
}
