const PUNCT = new Set(['(', ')', ',', '.', '*', '+', '-', '/', '%', '<', '>', '=', '!', '~', '^', '|', '&', ':', '[', ']', ';', '@']);
const NUMBER_SUFFIXES = ['BD', 'L', 'S', 'Y', 'D', 'F'];

const isDigit = (c) => c >= '0' && c <= '9';
const isWordStart = (c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
const isWordChar = (c) => isWordStart(c) || isDigit(c);
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';
const isBidi = (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);

class Refused extends Error {
  constructor(rule, at, text) {
    super(text);
    this.rule = rule;
    this.at = at;
  }
}

function shown(c) {
  const cp = c.codePointAt(0);
  return cp >= 0x21 && cp <= 0x7e ? `'${c}'` : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function badCharacter(c, at) {
  return new Refused('character', at, `The table name has the character ${shown(c)} at character ${at}, which Inspire refuses outside a string or a name in backticks.`);
}

function screen(cs) {
  for (let i = 0; i < cs.length; i += 1) {
    const cp = cs[i].codePointAt(0);
    if ((cp < 0x20 && cs[i] !== '\t' && cs[i] !== '\n') || cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff) || isBidi(cp)) {
      throw new Refused('character', i, `The table name has the character ${shown(cs[i])} at character ${i}, which Inspire refuses anywhere in the SQL.`);
    }
    if (cs[i] === '$' && cs[i + 1] === '{') {
      throw new Refused('substitution', i, `The table name holds \${ at character ${i}; Inspire refuses variable substitution anywhere, even inside a string.`);
    }
  }
}

function unterminated(what, at) {
  return new Refused('unterminated', at, `The table name has a ${what} that never ends, starting at character ${at}.`);
}

function tokenize(cs) {
  const tokens = [];
  const n = cs.length;
  let i = 0;
  const push = (type, start, end, extra = {}) => tokens.push({ type, at: start, raw: cs.slice(start, end).join(''), ...extra });
  while (i < n) {
    const c = cs[i];
    const next = cs[i + 1];
    if (isSpace(c)) {
      let j = i;
      while (j < n && isSpace(cs[j])) j += 1;
      push('ws', i, j);
      i = j;
    } else if (c === '-' && next === '-') {
      let j = i;
      while (j < n && cs[j] !== '\n') j += 1;
      push('comment', i, j, { line: true });
      i = j;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (cs[j] === '/' && cs[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (cs[j] === '*' && cs[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) throw unterminated('comment', i);
      push('comment', i, j, { line: false });
      i = j;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && cs[j] !== c) j += cs[j] === '\\' ? 2 : 1;
      if (j >= n) throw unterminated('string', i);
      push('string', i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      const name = [];
      for (;;) {
        if (j >= n) throw unterminated('name in backticks', i);
        if (cs[j] === '`') {
          if (cs[j + 1] !== '`') break;
          name.push('`');
          j += 2;
        } else {
          name.push(cs[j]);
          j += 1;
        }
      }
      push('quoted', i, j + 1, { name: name.join('') });
      i = j + 1;
    } else if (isWordStart(c)) {
      let j = i;
      while (j < n && isWordChar(cs[j])) j += 1;
      const word = cs.slice(i, j).join('');
      if ((word === 'r' || word === 'R') && (cs[j] === "'" || cs[j] === '"')) {
        let k = j + 1;
        while (k < n && cs[k] !== cs[j]) k += 1;
        if (k >= n) throw unterminated('string', i);
        push('string', i, k + 1);
        i = k + 1;
      } else {
        push('word', i, j, { upper: word.toUpperCase() });
        i = j;
      }
    } else if (isDigit(c) || (c === '.' && isDigit(next || ''))) {
      let j = i;
      while (j < n && isDigit(cs[j])) j += 1;
      if (cs[j] === '.') {
        j += 1;
        while (j < n && isDigit(cs[j])) j += 1;
      }
      if ((cs[j] === 'e' || cs[j] === 'E') && (isDigit(cs[j + 1] || '') || ((cs[j + 1] === '+' || cs[j + 1] === '-') && isDigit(cs[j + 2] || '')))) {
        j += 2;
        while (j < n && isDigit(cs[j])) j += 1;
      }
      const suffix = NUMBER_SUFFIXES.find((s) => {
        const piece = cs.slice(j, j + s.length);
        return piece.length === s.length && piece.every(isWordStart) && piece.join('').toUpperCase() === s;
      });
      if (suffix) j += suffix.length;
      if (j < n && isWordChar(cs[j])) {
        throw new Refused('number', i, `The number at character ${i} runs into the word after it; put a space between them, or put a name that starts with a digit in backticks.`);
      }
      push('number', i, j);
      i = j;
    } else if (c === ':' && next === ':') {
      push('punct', i, i + 2);
      i += 2;
    } else if (PUNCT.has(c)) {
      push('punct', i, i + 1);
      i += 1;
    } else if (c === '?') {
      throw parameter(i);
    } else {
      throw badCharacter(c, i);
    }
  }
  return tokens;
}

function parameter(at) {
  return new Refused('parameter', at, `The table name uses a parameter at character ${at}; write the value itself, since Inspire runs the SQL with no parameters.`);
}

const isP = (t, raw) => Boolean(t) && t.type === 'punct' && t.raw === raw;
const isName = (t) => Boolean(t) && (t.type === 'word' || t.type === 'quoted');
const nameOf = (t) => (t.type === 'quoted' ? t.name : t.raw);

function canonicalPart(part) {
  const lower = part.toLowerCase();
  return /^[a-z0-9_]+$/.test(lower) ? lower : `\`${lower.replace(/`/g, '``')}\``;
}

export const quotedIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``;

export const PLACE_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const PLACE_RIGHTS = { catalog: 'CREATE CATALOG on the metastore', schema: 'CREATE SCHEMA on the catalog' };

export function placeNameProblem(name, kind) {
  return PLACE_NAME_RE.test(String(name ?? '').trim()) ? '' : `the ${kind} name can only use letters, digits, _ and -`;
}

export function createPlaceSql(catalog, schema = '') {
  return schema ? `CREATE SCHEMA IF NOT EXISTS ${quotedIdent(catalog)}.${quotedIdent(schema)}` : `CREATE CATALOG IF NOT EXISTS ${quotedIdent(catalog)}`;
}

export function groupingMainTable(name) {
  const cs = Array.from(String(name ?? '').trim());
  let tokens;
  try {
    screen(cs);
    tokens = tokenize(cs);
  } catch (err) {
    if (err instanceof Refused) return null;
    throw err;
  }
  const ok = tokens.length === 5 && [0, 2, 4].every((k) => isName(tokens[k])) && [1, 3].every((k) => isP(tokens[k], '.'));
  if (!ok) return null;
  const parts = [0, 2, 4].map((k) => nameOf(tokens[k]));
  return { canonical: parts.map(canonicalPart).join('.'), sql: parts.map(quotedIdent).join('.') };
}
