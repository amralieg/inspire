export const VALUE_METHODS = ['fixed', 'column', 'equation'];
export const EQUATION_MAX_CHARS = 200;
const TOKEN = /\s*(?:([A-Za-z_][A-Za-z0-9_]{0,63})|(\d+(?:\.\d+)?)|([-+*/()]))/y;
const MAX_TOKENS = 60;
export const EQUATION_HELP = 'The equation adds, subtracts, multiplies and divides column names and numbers, with brackets, such as quantity * unit_price - discount.';

function tokenize(text) {
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    if (text.slice(at).trim() === '') break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(text);
    if (!m) return null;
    if (m[1]) tokens.push({ column: m[1] });
    else if (m[2]) tokens.push({ number: m[2] });
    else tokens.push({ op: m[3] });
    at = TOKEN.lastIndex;
    if (tokens.length > MAX_TOKENS) return null;
  }
  return tokens;
}

export function compileExpression(expression, quote = (name) => `\`${name}\``) {
  const text = String(expression ?? '').trim();
  if (!text || text.length > EQUATION_MAX_CHARS) return { problem: EQUATION_HELP };
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return { problem: EQUATION_HELP };
  const columns = [];
  let at = 0;
  const next = () => tokens[at++];
  const peekOp = (...ops) => tokens[at] && tokens[at].op && ops.includes(tokens[at].op);
  const fail = () => { throw new Error('equation'); };
  function factor() {
    const t = next();
    if (!t) return fail();
    if (t.number !== undefined) return t.number;
    if (t.column !== undefined) { if (!columns.includes(t.column)) columns.push(t.column); return quote(t.column); }
    if (t.op === '-') return `(-${factor()})`;
    if (t.op === '(') { const inner = sum(); if (!peekOp(')')) return fail(); at += 1; return `(${inner})`; }
    return fail();
  }
  function product() {
    let left = factor();
    while (peekOp('*', '/')) { const op = next().op; left = `(${left} ${op} ${factor()})`; }
    return left;
  }
  function sum() {
    let left = product();
    while (peekOp('+', '-')) { const op = next().op; left = `(${left} ${op} ${product()})`; }
    return left;
  }
  try {
    const sql = sum();
    if (at !== tokens.length) return { problem: EQUATION_HELP };
    return { sql, columns };
  } catch {
    return { problem: EQUATION_HELP };
  }
}
