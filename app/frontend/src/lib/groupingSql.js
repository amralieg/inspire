export const GROUPING_SQL_MAX_CHARS = 20000;
export const REFUSED_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'GRANT', 'REVOKE',
  'COPY', 'REFRESH', 'OPTIMIZE', 'VACUUM', 'CALL', 'EXECUTE', 'EXEC', 'SET', 'RESET', 'USE', 'MSCK', 'REPAIR', 'CACHE', 'UNCACHE', 'ANALYZE',
  'LOAD', 'PUT', 'GET', 'REMOVE', 'LIST', 'DECLARE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TABLE']);
export const REFUSED_FUNCTIONS = new Set(['secret', 'try_secret', 'http_request', 'vector_search', 'read_files', 'read_kafka', 'read_kinesis', 'read_pubsub',
  'read_pulsar', 'read_statestore', 'remote_query', 'java_method', 'reflect', 'try_reflect', 'identifier', 'from_avro', 'to_avro',
  'from_protobuf', 'to_protobuf']);
const KEYWORD_HINTS = { REPLACE: ', such as regexp_replace', GET: ', such as element_at' };
const PUNCT = new Set(['(', ')', ',', '.', '*', '+', '-', '/', '%', '<', '>', '=', '!', '~', '^', '|', '&', ':', '[', ']', ';', '@']);
const NUMBER_SUFFIXES = ['BD', 'L', 'S', 'Y', 'D', 'F'];
const SUB_STARTS = new Set(['SELECT', 'WITH', 'FROM', 'VALUES']);
const NOT_CALLS = new Set(['IN', 'EXISTS', 'ON', 'AND', 'OR', 'NOT', 'WHERE', 'SELECT', 'FROM', 'JOIN', 'AS', 'BY', 'WHEN', 'THEN', 'ELSE', 'CASE',
  'HAVING', 'USING', 'OVER', 'VALUES', 'UNION', 'INTERSECT', 'EXCEPT', 'MINUS', 'ALL', 'DISTINCT', 'LATERAL', 'QUALIFY', 'LIMIT', 'OFFSET',
  'WINDOW', 'PIVOT', 'UNPIVOT', 'FOR', 'LIKE', 'ILIKE', 'RLIKE', 'BETWEEN', 'IS', 'WITH', 'RECURSIVE', 'END']);
const CLAUSE_WORDS = new Set([...NOT_CALLS, 'PARTITION', 'ORDER', 'GROUP', 'ESCAPE', 'TABLESAMPLE', 'FILTER']);
const FROM_ENDS = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'SORT', 'CLUSTER', 'DISTRIBUTE', 'LIMIT', 'OFFSET', 'WINDOW', 'QUALIFY', 'UNION',
  'INTERSECT', 'EXCEPT', 'MINUS', 'SELECT', 'PIVOT', 'UNPIVOT']);

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
  return new Refused('character', at, `The grouping SQL has the character ${shown(c)} at character ${at}, which Inspire refuses outside a string or a name in backticks.`);
}

function screen(cs) {
  for (let i = 0; i < cs.length; i += 1) {
    const cp = cs[i].codePointAt(0);
    if ((cp < 0x20 && cs[i] !== '\t' && cs[i] !== '\n') || cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff) || isBidi(cp)) {
      throw new Refused('character', i, `The grouping SQL has the character ${shown(cs[i])} at character ${i}, which Inspire refuses anywhere in the SQL.`);
    }
    if (cs[i] === '$' && cs[i + 1] === '{') {
      throw new Refused('substitution', i, `The grouping SQL holds \${ at character ${i}; Inspire refuses variable substitution anywhere, even inside a string.`);
    }
  }
}

function unterminated(what, at) {
  return new Refused('unterminated', at, `The grouping SQL has a ${what} that never ends, starting at character ${at}.`);
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
  return new Refused('parameter', at, `The grouping SQL uses a parameter at character ${at}; write the value itself, since Inspire runs the SQL with no parameters.`);
}

const isP = (t, raw) => Boolean(t) && t.type === 'punct' && t.raw === raw;
const isW = (t, upper) => Boolean(t) && t.type === 'word' && t.upper === upper;
const isName = (t) => Boolean(t) && (t.type === 'word' || t.type === 'quoted');
const nameOf = (t) => (t.type === 'quoted' ? t.name : t.raw);

function canonicalPart(part) {
  const lower = part.toLowerCase();
  return /^[a-z0-9_]+$/.test(lower) ? lower : `\`${lower.replace(/`/g, '``')}\``;
}

function statementCheck(sig) {
  const semis = sig.map((t, k) => (isP(t, ';') ? k : -1)).filter((k) => k >= 0);
  const extra = semis.find((k) => k !== sig.length - 1);
  if (extra !== undefined) {
    throw new Refused('statements', sig[extra].at, `The grouping SQL holds more than one statement: there is a ; at character ${sig[extra].at}. `
      + 'Write one SELECT; Inspire drops only a single ; at the very end.');
  }
  return semis.length ? sig.slice(0, -1) : sig;
}

function parameterCheck(sig) {
  sig.forEach((t, k) => {
    if (!isP(t, ':') || !isName(sig[k + 1])) return;
    const prev = sig[k - 1];
    const operand = prev && (['number', 'string', 'quoted'].includes(prev.type) || isP(prev, ')') || isP(prev, ']')
      || (prev.type === 'word' && !CLAUSE_WORDS.has(prev.upper)));
    if (!operand) throw parameter(t.at);
  });
}

function keywordCheck(sig) {
  sig.forEach((t, k) => {
    if (t.type !== 'word' || !REFUSED_KEYWORDS.has(t.upper)) return;
    if (isP(sig[k + 1], '(')) {
      throw new Refused('keyword', t.at, `The grouping SQL calls ${t.upper}() at character ${t.at}, a word Inspire refuses so the SQL can only read; `
        + `use another function${KEYWORD_HINTS[t.upper] || ''}.`);
    }
    throw new Refused('keyword', t.at, `The grouping SQL uses ${t.upper} at character ${t.at}, which Inspire refuses so the SQL can only read; `
      + 'if it is a column or table name, put it in backticks.');
  });
}

function functionCheck(sig) {
  sig.forEach((t, k) => {
    if (!isP(sig[k + 1], '(')) return;
    if (t.type === 'string') {
      throw new Refused('function', t.at, `The grouping SQL calls a quoted string as a function at character ${t.at}, which Inspire refuses.`);
    }
    if (!isName(t)) return;
    const name = nameOf(t).toLowerCase();
    if (isP(sig[k - 1], '.')) {
      let first = k;
      while (isP(sig[first - 1], '.') && isName(sig[first - 2])) first -= 2;
      const full = sig.slice(first, k + 1).filter(isName).map(nameOf).join('.');
      throw new Refused('function', sig[first].at, `The grouping SQL calls ${full} at character ${sig[first].at}; Inspire allows only built-in functions, `
        + 'called by their plain name.');
    }
    if (REFUSED_FUNCTIONS.has(name) || name.startsWith('ai_')) {
      throw new Refused('function', t.at, `The grouping SQL calls ${name} at character ${t.at}, which Inspire refuses because it reaches outside the tables you read.`);
    }
  });
}

function scriptCheck(sig) {
  sig.forEach((t, k) => {
    if (isW(t, 'USING') && sig[k + 1] && sig[k + 1].type === 'string') {
      throw new Refused('script', t.at, `The grouping SQL runs a script with USING at character ${t.at}, which Inspire refuses.`);
    }
  });
}

function unbalanced(at) {
  return new Refused('parentheses', at, `The grouping SQL's parentheses do not pair up near character ${at}; close every ( it opens, and no more.`);
}

export function head(text, size) {
  return Array.from(text).slice(0, size).join('');
}

function notATable(t) {
  const points = Array.from(t.raw).length;
  const what = t.type === 'punct' ? `'${t.raw}'` : points > 60 ? `${head(t.raw, 60)}...` : t.raw;
  return new Refused('table_name', t.at, `The grouping SQL reads from ${what} at character ${t.at}; name every table as catalog.schema.table, `
    + 'or use a name your WITH defines before this point.');
}

function targetCheck(sig) {
  const tables = new Set();
  const top = { kind: 'top', mode: null, expect: null, cte: null, cteName: null };
  const stack = [top];
  const scopes = [];
  const frame = () => stack[stack.length - 1];
  const visible = (name) => scopes.some((s) => s.names.has(name.toLowerCase()));
  for (let k = 0; k < sig.length; k += 1) {
    const t = sig[k];
    const f = frame();
    if (f.cte) {
      const step = f.cte;
      if (step.state === 'name') {
        if (isW(t, 'RECURSIVE') && step.first) {
          step.first = false;
          continue;
        }
        step.first = false;
        if (!isName(t)) throw new Refused('table_name', t.at, `The grouping SQL has a WITH with no name at character ${t.at}.`);
        step.name = nameOf(t);
        step.state = 'after_name';
        continue;
      }
      if (step.state === 'after_name' && isW(t, 'AS')) continue;
      if (step.state === 'after_body') {
        if (isP(t, ',')) {
          step.state = 'name';
          continue;
        }
        f.cte = null;
      }
    }
    if (isP(t, '(')) {
      const after = sig[k + 1];
      const prev = sig[k - 1];
      const kind = after && after.type === 'word' && SUB_STARTS.has(after.upper) ? 'sub'
        : prev && ((prev.type === 'word' && !NOT_CALLS.has(prev.upper)) || prev.type === 'quoted') ? 'call' : 'group';
      const pushed = { kind, mode: null, expect: null, cte: null, cteName: null };
      if (f.expect) {
        if (kind !== 'sub') throw notATable(t);
        f.expect = null;
      } else if (f.cte && f.cte.state === 'after_name' && kind === 'sub') {
        pushed.cteName = f.cte.name;
        f.cte.state = 'after_body';
      }
      stack.push(pushed);
      continue;
    }
    if (isP(t, ')')) {
      if (stack.length === 1) throw unbalanced(t.at);
      const closed = stack.pop();
      const depth = stack.length - 1;
      for (let s = scopes.length - 1; s >= 0; s -= 1) if (scopes[s].depth > depth) scopes.splice(s, 1);
      if (closed.cteName !== null) {
        let scope = scopes.find((s) => s.depth === depth);
        if (!scope) {
          scope = { depth, names: new Set() };
          scopes.push(scope);
        }
        scope.names.add(closed.cteName.toLowerCase());
      }
      continue;
    }
    if (f.expect) {
      if (isW(t, 'LATERAL') && isP(sig[k + 1], '(')) continue;
      if (!isName(t)) throw notATable(t);
      const parts = [nameOf(t)];
      let j = k;
      while (isP(sig[j + 1], '.')) {
        if (!isName(sig[j + 2])) throw notATable(sig[j + 2] || sig[j + 1]);
        parts.push(nameOf(sig[j + 2]));
        j += 2;
      }
      const full = sig.slice(k, j + 1).map((x) => x.raw).join('');
      if (isP(sig[j + 1], '(')) {
        throw new Refused('table_function', t.at, `The grouping SQL reads from ${full}(...) at character ${t.at}; Inspire reads only tables named `
          + 'catalog.schema.table, never a table function.');
      }
      if (parts.length === 3) tables.add(parts.map(canonicalPart).join('.'));
      else if (!(parts.length === 1 && t.type !== 'string' && visible(parts[0]))) throw notATable({ ...t, raw: full });
      f.expect = null;
      k = j;
      continue;
    }
    if (t.type === 'word') {
      if (t.upper === 'WITH') {
        f.cte = { state: 'name', name: null, first: true };
        continue;
      }
      if (t.upper === 'FROM') {
        if (f.kind !== 'call') {
          f.mode = 'from';
          f.expect = t;
        }
        continue;
      }
      if (t.upper === 'JOIN') {
        f.mode = 'from';
        f.expect = t;
        continue;
      }
      if (f.mode === 'from' && (FROM_ENDS.has(t.upper) || (t.upper === 'LATERAL' && isW(sig[k + 1], 'VIEW')))) f.mode = null;
      continue;
    }
    if (isP(t, ',') && f.mode === 'from') f.expect = t;
  }
  if (stack.length > 1) throw unbalanced(sig[sig.length - 1].at);
  const open = stack.find((s) => s.expect);
  if (open) {
    throw new Refused('table_name', open.expect.at, `The grouping SQL has a ${open.expect.raw.toUpperCase() === 'JOIN' ? 'JOIN' : open.expect.raw === ',' ? 'comma' : 'FROM'} `
      + `with no table after it at character ${open.expect.at}.`);
  }
  return [...tables].sort();
}

function normalizedText(tokens) {
  const sig = tokens.filter((t) => t.type !== 'ws' && t.type !== 'comment');
  const last = sig[sig.length - 1];
  const dropped = last && isP(last, ';') ? last : null;
  return tokens.map((t) => (t === dropped ? '' : t.type === 'comment' ? (t.line ? '' : ' ') : t.raw)).join('').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

export function checkGroupingSql(input) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n');
  const cs = Array.from(text);
  try {
    if (cs.length > GROUPING_SQL_MAX_CHARS) {
      throw new Refused('too_long', 0, `The grouping SQL is ${cs.length} characters long; Inspire takes at most ${GROUPING_SQL_MAX_CHARS} characters.`);
    }
    screen(cs);
    const tokens = tokenize(cs);
    const sig = statementCheck(tokens.filter((t) => t.type !== 'ws' && t.type !== 'comment'));
    if (!sig.length) throw new Refused('empty', 0, 'The grouping SQL is empty; write one SELECT that returns the record key columns and group_name.');
    parameterCheck(sig);
    if (!isW(sig[0], 'SELECT') && !isW(sig[0], 'WITH')) {
      throw new Refused('first_keyword', sig[0].at, `The grouping SQL must start with SELECT or WITH; it starts with ${head(sig[0].raw, 40)}.`);
    }
    keywordCheck(sig);
    functionCheck(sig);
    scriptCheck(sig);
    const tables = targetCheck(sig);
    const sql = normalizedText(tokens);
    return { ok: true, sql, tables, rule: '', at: null, text: '' };
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return { ok: false, sql: '', tables: [], rule: err.rule, at: err.at, text: err.message };
  }
}

export const quotedIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``;

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

export const GROUPING_PREVIEW_ROUTE = '/api/grouping/preview';
export const GROUPING_SAVE_ROUTE = '/api/grouping/save';

export function groupingKeysOf(profile) {
  const keys = profile?.prefill?.key_columns;
  return Array.isArray(keys) ? keys.map((k) => String(k ?? '').trim()).filter(Boolean) : [];
}

export function groupingSqlRequest(base, profile, sql, resultTable = '') {
  const body = { ...base, main_table: String(profile?.table ?? '').trim(), key_columns: groupingKeysOf(profile), sql: String(sql ?? '') };
  const result = String(resultTable ?? '').trim();
  return result ? { ...body, result_table: result } : body;
}

export function groupingSqlSchema(profile) {
  const table = groupingMainTable(profile?.table);
  if (!table) return {};
  const columns = (Array.isArray(profile.columns) ? profile.columns : []).map((c) => String(c?.name ?? '').trim()).filter(Boolean);
  return { [table.canonical]: [...new Set([...groupingKeysOf(profile), ...columns])] };
}

export function groupingPreviewFits(preview, checked) {
  return Boolean(preview && preview.ok === true && checked && checked.ok && preview.sql === checked.sql);
}
