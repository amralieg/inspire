const util = require('node:util');

const SECRET_HEADER_RE = /(["']?)\b(authorization|proxy-authorization|cookie|set-cookie|x-forwarded-access-token|x-databricks-[a-z0-9-]+)\1(\s*[:=]\s*)(?:\[[^\]\r\n]*\]|(["'`])[^\r\n"'`]*\4|[^\r\n]*)/gi;
const SECRET_PATTERNS = [
  /\bBearer\s+\S+/gi,
  /\bdapi[0-9a-f]{16,}\b/gi,
  /\bdose[0-9a-f]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}/g,
  /\b(token|secret|password|client_secret|access_token)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
];

function redactSecrets(text, extra = []) {
  let out = String(text ?? '').replace(SECRET_HEADER_RE, (_m, quote, name, joint) => `${quote}${name}${quote}${joint}[redacted]`);
  for (const pattern of [...SECRET_PATTERNS, ...extra]) {
    out = out.replace(pattern, (match, key, joint) => (typeof key === 'string' && typeof joint === 'string' ? `${key}${joint}[redacted]` : '[redacted]'));
  }
  return out;
}

const redactedText = (...args) => redactSecrets(util.format(...args));

const DATABRICKS_HOST_SUFFIX = /\.(?:cloud\.databricks\.com|(?:azure)?databricks\.net|gcp\.databricks\.com|databricks\.com|databricksapps\.com)/;
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/;
const URL_RE = /\b(?:https?|wss?|s3a?|abfss?|gs):\/\/[^\s"'`<>]+/gi;
const HOST_NAME_RE = new RegExp(`\\b[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*${DATABRICKS_HOST_SUFFIX.source}\\b`, 'gi');
const PATH_ROOTS = 'Workspace|Volumes|Users|Repos|home|dbfs|Shared|tmp|local_disk0|databricks|mnt';
const PATH_RE = new RegExp(`(?<![\\w.:/])\\/(${PATH_ROOTS})(?=[/\\s"'\`,;)\\]]|$)(?:\\/[^\\s"'\`<>,;)\\]]*)?`, 'g');
const NAME_PART = '(?:`(?:[^`\\n]|``)+`|[A-Za-z_][A-Za-z0-9_]*)';
const NAME_CHAIN_RE = new RegExp(`(?<![\\w.\`])${NAME_PART}(?:\\.${NAME_PART})+(?![\\w\`])`, 'g');
const QUOTED_NAME_RE = /`((?:[^`\n]|``)+)`/g;
const SINGLE_QUOTED_RE = /(?<![A-Za-z0-9])'(?:[^'\n\\]|\\.){0,400}'(?![A-Za-z0-9])/g;
const DOUBLE_QUOTED_RE = /"(?:[^"\n\\]|\\.){0,400}"/g;
const SQL_IN_LIST_RE = /\bIN\s*\([^()\n]*\)/gi;
const SQL_NUMBER_RE = /((?:<>|!=|<=|>=|==|=|<|>|\bLIKE\b|\bBETWEEN\b|\bAND\b)\s*)[-+]?\d[\d.,:eE+-]*/gi;
const DECIMAL_RE = /(?<![\w.:])[-+]?\d+\.\d+(?![\w.]*\d)/g;
const SAID_NUMBER_RE = /\b(values?|equals?|equal to|was|were)(\s+)[-+]?\d[\d,]*(?:\.\d+)?\b/gi;
const SQL_TEXT_RE = /\b(?:SELECT|WHERE|GROUP\s+BY|ORDER\s+BY)\b/;
const SQL_KEYWORDS = new Set(['select', 'distinct', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'between', 'as', 'on', 'join', 'left', 'right',
  'inner', 'outer', 'full', 'cross', 'group', 'order', 'by', 'partition', 'having', 'limit', 'offset', 'asc', 'desc', 'case', 'when', 'then', 'else', 'end', 'true', 'false',
  'union', 'all', 'with', 'over', 'cast', 'interval', 'date', 'timestamp', 'string', 'int', 'bigint', 'double', 'decimal', 'boolean', 'nulls', 'first', 'last', 'exists', 'sql']);
const SQL_IDENT_RE = /(?<![\w\[.`])[A-Za-z_][A-Za-z0-9_]*(?![\w\].`(])/g;
const SQL_COMPARED_RE = /(?<![\w\[.`])[A-Za-z_][A-Za-z0-9_]*(?=\s*(?:<>|!=|<=|>=|==|=|<|>|\bNOT\s+IN\s*\(|\bNOT\s+LIKE\b|\bIN\s*\(|\bLIKE\b|\bIS\b|\bBETWEEN\b))/g;
const SQL_SELECT_LIST_RE = /(\bSELECT\s+)([\s\S]*?)(\s+FROM\b)/g;
const SQL_BY_LIST_RE = /(\b(?:GROUP|ORDER|PARTITION)\s+BY\s+)([A-Za-z_][\w\s,]*?)(?=\s+(?:HAVING|LIMIT|ORDER|WINDOW|ROWS|RANGE)\b|[);.\n]|$)/g;
const LABEL_RE = /^(?:catalog|schema|table|column|business|app)_\d+$/;
const ERROR_CLASS_PART = /^[A-Z0-9_]+$/;
const NAME_KINDS = ['catalog', 'schema', 'table', 'column'];

function nameLabels() {
  const seen = new Map();
  const counts = {};
  return (kind, name) => {
    const key = `${kind}:${String(name).replace(/^`|`$/g, '').replace(/``/g, '`').toLowerCase()}`;
    if (!seen.has(key)) {
      counts[kind] = (counts[kind] || 0) + 1;
      seen.set(key, `${kind}_${counts[kind]}`);
    }
    return seen.get(key);
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function knownNamesRe(known) {
  const kindOf = new Map();
  for (const [kind, names] of Object.entries(known || {})) {
    for (const raw of names || []) {
      const name = String(raw ?? '').trim();
      if (name.length < 2 || kindOf.has(name)) continue;
      kindOf.set(name, kind);
    }
  }
  if (!kindOf.size) return null;
  const names = [...kindOf.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  return { kindOf, re: new RegExp(`(?<![\\w\\[])(?:${names.join('|')})(?![\\w\\]])`, 'g') };
}

function chainLabel(chain, label) {
  const parts = chain.match(new RegExp(NAME_PART, 'g'));
  const quoted = parts.some((p) => p.startsWith('`'));
  if (parts.every((p) => ERROR_CLASS_PART.test(p))) return chain;
  if (parts.length === 2 && !quoted) return chain;
  const kinds = parts.length === 2 ? ['schema', 'table'] : [...NAME_KINDS.slice(0, 3), ...parts.slice(3).map(() => 'column')];
  return parts.map((p, i) => label(kinds[i], p)).join('.');
}

function sqlColumns(text, label) {
  if (!SQL_TEXT_RE.test(text)) return text;
  const column = (name) => (SQL_KEYWORDS.has(name.toLowerCase()) || LABEL_RE.test(name) ? name : label('column', name));
  const list = (items) => items.replace(SQL_IDENT_RE, column);
  return text
    .replace(SQL_SELECT_LIST_RE, (_m, head, items, tail) => `${head}${list(items)}${tail}`)
    .replace(SQL_BY_LIST_RE, (_m, head, items) => `${head}${list(items)}`)
    .replace(SQL_COMPARED_RE, column);
}

function maskPrivate(text, { label = nameLabels(), known = {}, hosts = [] } = {}) {
  const { value: valueNames = [], ...names } = known || {};
  const named = knownNamesRe(names);
  const values = knownNamesRe({ value: valueNames });
  let out = redactSecrets(text);
  out = out.replace(URL_RE, '[link]');
  out = out.replace(PATH_RE, (_m, root) => `/${root}/[path]`);
  out = out.replace(new RegExp(EMAIL_RE.source, 'g'), '[email]');
  for (const host of hosts.map((h) => String(h || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')).filter(Boolean)) {
    out = out.replace(new RegExp(escapeRe(host), 'gi'), '[workspace]');
  }
  out = out.replace(HOST_NAME_RE, '[workspace]');
  out = out.replace(SINGLE_QUOTED_RE, "'[value]'").replace(DOUBLE_QUOTED_RE, '"[value]"');
  if (values) out = out.replace(values.re, '[value]');
  out = out.replace(SQL_IN_LIST_RE, 'IN ([values])');
  out = out.replace(NAME_CHAIN_RE, (chain) => chainLabel(chain, label));
  out = out.replace(QUOTED_NAME_RE, (_m, name) => label('column', name));
  if (named) out = out.replace(named.re, (m) => label(named.kindOf.get(m), m));
  out = sqlColumns(out, label);
  out = out.replace(SQL_NUMBER_RE, '$1[value]').replace(SAID_NUMBER_RE, '$1$2[value]').replace(DECIMAL_RE, '[value]');
  return out;
}

const TEXT = '<text>';
const ALLOWED_TOKEN_RE = new RegExp([
  '(?<![\\w.])[A-Z][A-Z0-9]*_[A-Z0-9_]*(?:\\.[A-Z0-9_]+)*(?![\\w])',
  '(?<![\\w.])(?:catalog|schema|table|column|business|app)_\\d+(?:\\.(?:schema|table|column)_\\d+)*(?![\\w])',
  '\\[(?:email|link|workspace|value|values|redacted)\\]',
  `/(?:${PATH_ROOTS})/\\[path\\]`,
].join('|'), 'g');
const SLOT_RE = /\{(phase|n|text)\}/g;
const SLOT_VALUE = { phase: '(.+?)', n: '(\\d+)', text: '(.+)' };
const NO_TEMPLATES = { list: [], words: new Set() };

function allowTemplates(patterns, words = []) {
  const list = patterns.map((pattern) => {
    const slots = [...pattern.matchAll(SLOT_RE)].map((m) => m[1]);
    const fixed = pattern.split(SLOT_RE).filter((_p, i) => i % 2 === 0);
    const re = new RegExp(`^${fixed.map(escapeRe).map((f, i) => (i < slots.length ? `${f}${SLOT_VALUE[slots[i]]}` : f)).join('')}$`);
    return { fixed, slots, re };
  });
  return { list, words: new Set(words.map((w) => String(w).trim().toLowerCase()).filter(Boolean)) };
}

function allowedSpans(text) {
  const gap = (part) => part.replace(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u, (m, lead, mid, tail) => (mid ? `${lead}${TEXT}${tail}` : m));
  let out = '';
  let at = 0;
  for (const m of text.matchAll(ALLOWED_TOKEN_RE)) {
    out += gap(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  out += gap(text.slice(at));
  return out.replace(new RegExp(`${TEXT}(?:\\s*${TEXT})+`, 'g'), TEXT).replace(/\s+/g, ' ').trim();
}

function allowText(text, templates = NO_TEMPLATES) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (templates.words.has(value.toLowerCase())) return value;
  for (const { fixed, slots, re } of templates.list) {
    const m = re.exec(value);
    if (!m) continue;
    const parts = slots.map((slot, i) => (slot === 'text' ? allowText(m[i + 1], templates) : m[i + 1]));
    if (slots.some((slot, i) => slot === 'phase' && !templates.words.has(m[i + 1].toLowerCase()))) continue;
    return fixed.map((f, i) => (i < parts.length ? `${f}${parts[i]}` : f)).join('');
  }
  const split = value.indexOf(': ');
  if (split > 0) {
    const head = value.slice(0, split);
    const kept = allowText(head, templates);
    if (kept === head) return `${head}: ${allowText(value.slice(split + 2), templates)}`;
  }
  return allowedSpans(value);
}

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const REDACTED = Symbol.for('inspire.redacted');

function redactConsole(target = console) {
  if (target[REDACTED]) return target;
  for (const level of CONSOLE_LEVELS) {
    const real = target[level].bind(target);
    target[level] = (...args) => real(redactedText(...args));
  }
  target[REDACTED] = true;
  return target;
}

function redactCrashes(proc = process, out = (text) => proc.stderr.write(`${text}\n`)) {
  const fail = (err) => {
    out(redactedText(err));
    proc.exit(1);
  };
  proc.on('uncaughtException', fail);
  proc.on('unhandledRejection', fail);
}

function redactOutput(proc = process) {
  redactConsole();
  redactCrashes(proc);
}

module.exports = {
  DATABRICKS_HOST_SUFFIX, EMAIL_RE, SECRET_HEADER_RE, SECRET_PATTERNS, allowTemplates, allowText, maskPrivate, nameLabels, redactConsole, redactCrashes, redactOutput, redactSecrets, redactedText,
};
