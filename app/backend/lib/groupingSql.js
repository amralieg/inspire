const crypto = require('node:crypto');

const GROUPING_SQL_MAX_CHARS = 20000;
const REFUSED_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'GRANT', 'REVOKE',
  'COPY', 'REFRESH', 'OPTIMIZE', 'VACUUM', 'CALL', 'EXECUTE', 'EXEC', 'SET', 'RESET', 'USE', 'MSCK', 'REPAIR', 'CACHE', 'UNCACHE', 'ANALYZE',
  'LOAD', 'PUT', 'GET', 'REMOVE', 'LIST', 'DECLARE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TABLE']);
const REFUSED_FUNCTIONS = new Set(['secret', 'try_secret', 'http_request', 'vector_search', 'read_files', 'read_kafka', 'read_kinesis', 'read_pubsub',
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

function head(text, size) {
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

function checkGroupingSql(input) {
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
    return { ok: true, sql, tables, hash: crypto.createHash('sha256').update(sql, 'utf8').digest('hex'), rule: '', at: null, text: '' };
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    return { ok: false, sql: '', tables: [], hash: '', rule: err.rule, at: err.at, text: err.message };
  }
}

function wrapGroupingSql(sql) {
  return `(${sql}\n)`;
}

const GROUPING_TOP = 10;
const GROUPING_MIN_GROUPS = 2;
const GROUPING_MAX_GROUPS = 500;
const GROUPING_MIN_RECORDS = 30;
const GROUPING_MAX_KEYS = 8;
const GROUPING_NAME_CHARS = 200;
const GROUPING_PREVIEW_MS = 120000;
const GROUPING_ROW_LIMIT = 100;
const GROUPING_BYTE_LIMIT = 1048576;
const GROUPING_SETTINGS = ['group_sql', 'group_sql_tables', 'group_sql_hash', 'group_sql_checked_by', 'group_sql_checked_at'];
const GROUPING_ASSUMPTIONS_SUFFIX = '_assumptions';
const GROUPING_ASSUMPTION_COLUMNS = [['use_case_id', 'STRING'], ['name', 'STRING'], ['value', 'DOUBLE'], ['changed_by', 'STRING'], ['changed_at', 'TIMESTAMP'],
  ['note', 'STRING'], ['text_value', 'STRING']];
const GROUPING_SAVED_NOTE = 'Custom grouping SQL checked and saved in Inspire';
const GROUPING_NO_SIGN_IN = 'Inspire runs a custom grouping with your own sign-in, and this request carries none, so it ran nothing; '
  + 'ask an App manager to re-run the Inspire installer, which turns on user authorization with the sql scope';
const GROUPING_DENIED = 'You cannot read every table this grouping SQL reads with your own sign-in, so Inspire ran nothing and saved nothing';

const quotedIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``;

function groupingMainTable(name) {
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

function groupingKeyColumns(raw) {
  const keys = Array.isArray(raw) ? raw.map((k) => String(k ?? '').trim()) : [];
  if (!keys.length || keys.length > GROUPING_MAX_KEYS) return null;
  const plain = (k) => k.length > 0 && k.length <= 255 && Array.from(k).every((c) => c.codePointAt(0) >= 0x20 && c !== '\u007f');
  if (!keys.every(plain) || new Set(keys.map((k) => k.toLowerCase())).size !== keys.length || keys.some((k) => k.toLowerCase() === 'group_name')) return null;
  return keys;
}

function groupingShapeSql(sql) {
  return `SELECT * FROM ${wrapGroupingSql(sql)} LIMIT 0`;
}

function groupingTopSql(sql) {
  return `SELECT group_name, COUNT(*) AS records FROM ${wrapGroupingSql(sql)} GROUP BY 1 ORDER BY 2 DESC LIMIT ${GROUPING_TOP}`;
}

function groupingTotalsSql(sql, main, keys) {
  const k = keys.map(quotedIdent);
  const match = k.map((c) => `g.${c} <=> m.${c}`).join(' AND ');
  return `WITH inspire_grouping AS (SELECT * FROM ${wrapGroupingSql(sql)}), `
    + 'inspire_groups AS (SELECT group_name, COUNT(*) AS records FROM inspire_grouping WHERE group_name IS NOT NULL GROUP BY group_name) '
    + 'SELECT (SELECT COUNT(*) FROM inspire_grouping) AS row_count, '
    + `(SELECT COUNT(DISTINCT ${k.join(', ')}) FROM inspire_grouping) AS record_keys, `
    + '(SELECT COUNT(*) FROM inspire_groups) AS group_count, '
    + '(SELECT MIN(records) FROM inspire_groups) AS smallest_group, '
    + `(SELECT COUNT(*) FROM inspire_groups WHERE records < ${GROUPING_MIN_RECORDS}) AS small_groups, `
    + '(SELECT COUNT(*) FROM inspire_grouping WHERE group_name IS NULL) AS null_groups, '
    + `(SELECT COUNT(*) FROM ${main.sql} m WHERE NOT EXISTS (SELECT 1 FROM inspire_grouping g WHERE ${match})) AS no_group`;
}

function shapeProblem(columns, keys) {
  const have = new Set(columns.map((c) => String(c).toLowerCase()));
  const missing = ['group_name', ...keys].filter((c) => !have.has(c.toLowerCase()));
  if (!missing.length) return '';
  return `The grouping SQL returns no column named ${missing.join(', ')}; return one row per record with the record key `
    + `${keys.length === 1 ? 'column' : 'columns'} ${keys.join(', ')} and group_name.`;
}

const count = (v) => (v == null || v === '' ? 0 : Number(v));

function groupingPreviewView(top, totalsRow) {
  const totals = {
    rows: count(totalsRow.row_count),
    record_keys: count(totalsRow.record_keys),
    groups: count(totalsRow.group_count),
    smallest_group: totalsRow.smallest_group == null ? null : Number(totalsRow.smallest_group),
    small_groups: count(totalsRow.small_groups),
    null_groups: count(totalsRow.null_groups),
    no_group: count(totalsRow.no_group),
  };
  const one = totals.rows === totals.record_keys;
  const range = totals.groups >= GROUPING_MIN_GROUPS && totals.groups <= GROUPING_MAX_GROUPS;
  const rules = [
    { id: 'one_row_per_record', ok: one, text: one ? `Each of the ${totals.record_keys} records has one row.`
      : `The SQL returns ${totals.rows} rows for ${totals.record_keys} records; return exactly one row per record.` },
    { id: 'group_count', ok: range, text: `${totals.groups} ${totals.groups === 1 ? 'group' : 'groups'}; a grouping needs ${GROUPING_MIN_GROUPS} to ${GROUPING_MAX_GROUPS}.` },
    { id: 'small_groups', ok: true, text: totals.small_groups
      ? `${totals.small_groups} ${totals.small_groups === 1 ? 'group has' : 'groups have'} fewer than ${GROUPING_MIN_RECORDS} records and combine into Other groups.`
      : `Every group has at least ${GROUPING_MIN_RECORDS} records.` },
    { id: 'no_group', ok: true, text: totals.null_groups + totals.no_group
      ? `${totals.null_groups + totals.no_group} records fall in No group: ${totals.null_groups} with no group_name and ${totals.no_group} with no row.`
      : 'Every record has a group.' },
  ];
  const shown = (top || []).slice(0, GROUPING_TOP).map((r) => {
    const name = r.group_name == null ? null : String(r.group_name);
    const cut = name !== null && Array.from(name).length > GROUPING_NAME_CHARS;
    return { group_name: cut ? `${head(name, GROUPING_NAME_CHARS)}...` : name, records: count(r.records), cut };
  });
  const text = totals.groups > GROUPING_TOP ? `Showing the ${GROUPING_TOP} largest of ${totals.groups} groups.`
    : totals.groups === 1 ? 'Showing the one group.' : `Showing all ${totals.groups} groups.`;
  return { ok: one && range, top: shown, totals, rules, text };
}

function groupingSettingsTable(resultTable) {
  const table = groupingMainTable(resultTable);
  if (!table) return null;
  return { sql: `${table.sql.slice(0, -1)}${GROUPING_ASSUMPTIONS_SUFFIX}\`` };
}

function groupingSettingsCreateSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table.sql} (${GROUPING_ASSUMPTION_COLUMNS.map(([name, kind]) => `${name} ${kind}`).join(', ')})`;
}

function groupingSettingsInsert(table, row) {
  const values = [row.sql, JSON.stringify(row.tables), row.hash, row.checkedBy, String(row.checkedAt)];
  return {
    sql: `INSERT INTO ${table.sql} (use_case_id, name, value, changed_by, changed_at, note, text_value) VALUES `
      + GROUPING_SETTINGS.map((name, i) => `(:use_case_id, '${name}', NULL, :changed_by, :changed_at, :note, :v${i})`).join(', '),
    parameters: [{ name: 'use_case_id', value: String(row.useCaseId), type: 'STRING' }, { name: 'changed_by', value: String(row.checkedBy), type: 'STRING' },
      { name: 'changed_at', value: String(row.checkedAt), type: 'TIMESTAMP' }, { name: 'note', value: GROUPING_SAVED_NOTE, type: 'STRING' },
      ...values.map((value, i) => ({ name: `v${i}`, value: String(value), type: 'STRING' }))],
  };
}

module.exports = {
  GROUPING_SQL_MAX_CHARS,
  REFUSED_KEYWORDS,
  REFUSED_FUNCTIONS,
  GROUPING_TOP,
  GROUPING_MIN_GROUPS,
  GROUPING_MAX_GROUPS,
  GROUPING_MIN_RECORDS,
  GROUPING_PREVIEW_MS,
  GROUPING_ROW_LIMIT,
  GROUPING_BYTE_LIMIT,
  GROUPING_SETTINGS,
  GROUPING_ASSUMPTION_COLUMNS,
  GROUPING_SAVED_NOTE,
  GROUPING_NO_SIGN_IN,
  GROUPING_DENIED,
  checkGroupingSql,
  wrapGroupingSql,
  quotedIdent,
  groupingMainTable,
  groupingKeyColumns,
  groupingShapeSql,
  groupingTopSql,
  groupingTotalsSql,
  shapeProblem,
  groupingPreviewView,
  groupingSettingsTable,
  groupingSettingsCreateSql,
  groupingSettingsInsert,
};
