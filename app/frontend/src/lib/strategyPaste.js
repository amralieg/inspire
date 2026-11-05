import { KPI_DIRECTIONS, STRATEGY_MAX_DEPTH, countEntries, emptyEntry } from './strategyContext.js';

const text = (value) => String(value ?? '').trim();
const fold = (value) => text(value).toLowerCase();
const BULLET_RE = /^(?:[-*+\u2022\u25aa\u25e6\u2023\u2043]|\d{1,3}[.)]|[a-zA-Z][.)](?=\s))\s*/u;
const TAGGED_RE = /^(kpi|kpis|measure|metric|key\s*result|kr|okr|sponsor|owner)\s*[:\-\u2013]\s*(.+)$/iu;
const KPI_HEADERS = ['kpi', 'kpis', 'measure', 'metric'];
const KEY_RESULT_HEADERS = ['key result', 'key results', 'kr', 'okr'];
const SPONSOR_HEADERS = ['sponsor', 'owner', 'executive owner'];
const REPORTS_TO_HEADERS = ['reports to', 'reporting to', 'reports_to'];
const UNIT_HEADERS = ['unit'];
const DIRECTION_HEADERS = ['direction'];

function indentWidth(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

export function parseKpiText(raw) {
  const value = text(raw);
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/u.exec(value);
  const kpi = { name: value, definition: '', unit: '', direction: '' };
  if (!match || !text(match[1])) return kpi;
  kpi.name = text(match[1]);
  const extras = [];
  for (const part of match[2].split(',').map(text).filter(Boolean)) {
    if (KPI_DIRECTIONS.includes(part.toLowerCase()) && !kpi.direction) kpi.direction = part.toLowerCase();
    else if (!kpi.unit && part.length <= 12) kpi.unit = part;
    else extras.push(part);
  }
  kpi.definition = extras.join(', ');
  return kpi;
}

export function parseSponsorText(raw) {
  const [first, ...rest] = text(raw).split(/\s*[|;]\s*/u);
  const sponsor = { role: text(first), name: '', reports_to: '', owns: [] };
  const comma = /^(.*?),\s*(.+)$/u.exec(sponsor.role);
  if (comma && !/reports\s+to|owns/i.test(comma[2])) {
    sponsor.role = text(comma[1]);
    sponsor.name = text(comma[2]);
  }
  for (const part of rest) {
    const reports = /^reports?\s+to\s*:?\s*(.+)$/iu.exec(part);
    const owns = /^owns?\s*:?\s*(.+)$/iu.exec(part);
    const name = /^name\s*:?\s*(.+)$/iu.exec(part);
    if (reports) sponsor.reports_to = text(reports[1]);
    else if (owns) sponsor.owns = owns[1].split(',').map(text).filter(Boolean);
    else if (name) sponsor.name = text(name[1]);
  }
  return sponsor;
}

function linkKeyResult(entry, statement) {
  const kpi = (entry.kpis || []).find((k) => k.name && fold(statement).includes(fold(k.name)));
  return { statement: text(statement), kpi: kpi ? kpi.name : '' };
}

function addSponsor(sponsors, sponsor, owned) {
  if (!text(sponsor.role)) return;
  const existing = sponsors.find((s) => fold(s.role) === fold(sponsor.role));
  const target = existing || { role: sponsor.role, name: sponsor.name, reports_to: sponsor.reports_to, owns: [] };
  if (!existing) sponsors.push(target);
  if (!target.name && sponsor.name) target.name = sponsor.name;
  if (!target.reports_to && sponsor.reports_to) target.reports_to = sponsor.reports_to;
  for (const own of [...sponsor.owns, ...(owned ? [owned] : [])]) {
    if (own && !target.owns.some((o) => fold(o) === fold(own))) target.owns.push(own);
  }
}

function childNamed(list, name) {
  let entry = list.find((e) => fold(e.name) === fold(name));
  if (!entry) {
    entry = emptyEntry(text(name));
    list.push(entry);
  }
  return entry;
}

function splitRow(line, separator) {
  if (separator === '|') return line.replace(/^\s*\|/u, '').replace(/\|\s*$/u, '').split('|').map(text);
  return line.split(separator).map(text);
}

function tableSeparator(lines) {
  if (lines.every((line) => line.includes('\t'))) return '\t';
  if (lines.every((line) => line.trim().startsWith('|') || line.includes(' | '))) return '|';
  return null;
}

function parseTable(lines, separator, levels) {
  const rows = lines.map((line) => splitRow(line, separator)).filter((cells) => !cells.every((c) => /^:?-{2,}:?$/u.test(c) || !c));
  const header = rows[0].map(fold);
  const levelIndex = new Map(levels.map((level, index) => [fold(level), index]));
  const role = (cell) => {
    if (levelIndex.has(cell)) return { kind: 'level', depth: levelIndex.get(cell) };
    if (KPI_HEADERS.includes(cell)) return { kind: 'kpi' };
    if (KEY_RESULT_HEADERS.includes(cell)) return { kind: 'key_result' };
    if (SPONSOR_HEADERS.includes(cell)) return { kind: 'sponsor' };
    if (REPORTS_TO_HEADERS.includes(cell)) return { kind: 'reports_to' };
    if (UNIT_HEADERS.includes(cell)) return { kind: 'unit' };
    if (DIRECTION_HEADERS.includes(cell)) return { kind: 'direction' };
    return null;
  };
  const roles = header.map(role);
  const hasHeader = roles.some((r) => r && r.kind === 'level');
  const columns = hasHeader ? roles : rows[0].map((_, index) => (index < STRATEGY_MAX_DEPTH ? { kind: 'level', depth: index } : null));
  const ignored = hasHeader ? rows[0].filter((_, index) => !roles[index]) : [];
  const strategy = [];
  const sponsors = [];
  const previous = [];
  for (const cells of hasHeader ? rows.slice(1) : rows) {
    const path = [];
    let deepestGiven = -1;
    columns.forEach((column, index) => {
      if (column && column.kind === 'level' && text(cells[index])) deepestGiven = Math.max(deepestGiven, column.depth);
    });
    if (deepestGiven < 0) continue;
    for (let depth = 0; depth <= deepestGiven; depth += 1) {
      const index = columns.findIndex((c) => c && c.kind === 'level' && c.depth === depth);
      const name = index >= 0 ? text(cells[index]) : '';
      path[depth] = name || previous[depth] || '';
    }
    if (path.some((name) => !name)) continue;
    previous.length = 0;
    previous.push(...path);
    let list = strategy;
    let entry = null;
    for (const name of path) {
      entry = childNamed(list, name);
      list = entry.children;
    }
    const cell = (kind) => {
      const index = columns.findIndex((c) => c && c.kind === kind);
      return index >= 0 ? text(cells[index]) : '';
    };
    if (cell('kpi')) {
      const kpi = parseKpiText(cell('kpi'));
      if (cell('unit')) kpi.unit = cell('unit');
      if (KPI_DIRECTIONS.includes(fold(cell('direction')))) kpi.direction = fold(cell('direction'));
      if (!entry.kpis.some((k) => fold(k.name) === fold(kpi.name))) entry.kpis.push(kpi);
    }
    if (cell('key_result') && !entry.key_results.some((r) => fold(r.statement) === fold(cell('key_result')))) {
      entry.key_results.push(linkKeyResult(entry, cell('key_result')));
    }
    if (cell('sponsor')) {
      const sponsor = parseSponsorText(cell('sponsor'));
      if (cell('reports_to')) sponsor.reports_to = cell('reports_to');
      addSponsor(sponsors, sponsor, sponsor.owns.length ? '' : entry.name);
    }
  }
  return { strategy, sponsors, ignored, notes: [] };
}

function parseOutline(lines, levels) {
  const strategy = [];
  const sponsors = [];
  const stack = [];
  const ignored = [];
  const notes = [];
  const levelIndex = new Map(levels.map((level, index) => [fold(level), index]));
  for (const rawLine of lines) {
    const indent = indentWidth(rawLine);
    let body = text(rawLine).replace(BULLET_RE, '');
    if (!body) continue;
    const tagged = TAGGED_RE.exec(body);
    if (tagged) {
      const tag = tagged[1].toLowerCase().replace(/\s+/gu, ' ');
      const value = text(tagged[2]);
      const enclosing = stack.filter((frame) => frame.indent < indent);
      const nested = enclosing.length ? enclosing[enclosing.length - 1].entry : null;
      const owner = nested || (stack.length ? stack[stack.length - 1].entry : null);
      if (tag === 'sponsor' || tag === 'owner') {
        const sponsor = parseSponsorText(value);
        addSponsor(sponsors, sponsor, nested && !sponsor.owns.length ? nested.name : '');
      } else if (!owner) {
        ignored.push(body);
      } else if (KPI_HEADERS.includes(tag)) {
        for (const part of tag === 'kpis' ? value.split(/\s*;\s*/u) : [value]) {
          const kpi = parseKpiText(part);
          if (kpi.name && !owner.kpis.some((k) => fold(k.name) === fold(kpi.name))) owner.kpis.push(kpi);
        }
      } else if (!owner.key_results.some((r) => fold(r.statement) === fold(value))) {
        owner.key_results.push(linkKeyResult(owner, value));
      }
      continue;
    }
    let depth = null;
    const named = /^([^:]{1,60}):\s*(.+)$/u.exec(body);
    if (named && levelIndex.has(fold(named[1]))) {
      depth = levelIndex.get(fold(named[1]));
      body = text(named[2]);
    }
    while (stack.length && (depth !== null ? stack[stack.length - 1].depth >= depth : stack[stack.length - 1].indent >= indent)) stack.pop();
    if (depth === null) depth = stack.length;
    if (depth > stack.length) {
      notes.push(`"${body.slice(0, 60)}" is named a ${levels[depth]} but sits right under a ${levels[stack.length - 1] || 'top level'}, `
        + `so it becomes a ${levels[stack.length] || `level ${stack.length + 1}`}.`);
      depth = stack.length;
    }
    const siblings = stack.length ? stack[stack.length - 1].entry.children : strategy;
    const entry = childNamed(siblings, body);
    stack.push({ entry, indent, depth });
  }
  return { strategy, sponsors, ignored, notes };
}

export function parseStrategyPaste(pasted, levels) {
  const lines = String(pasted ?? '').replace(/\r\n?/gu, '\n').split('\n').filter((line) => text(line));
  if (!lines.length) return { strategy: [], sponsors: [], ignored: [], notes: [], entries: 0, kpis: 0, keyResults: 0 };
  const separator = tableSeparator(lines);
  const parsed = separator ? parseTable(lines, separator, levels || []) : parseOutline(lines, levels || []);
  const all = [];
  const walk = (entries) => entries.forEach((entry) => { all.push(entry); walk(entry.children); });
  walk(parsed.strategy);
  return {
    ...parsed,
    entries: countEntries(parsed.strategy),
    kpis: all.reduce((sum, entry) => sum + entry.kpis.length, 0),
    keyResults: all.reduce((sum, entry) => sum + entry.key_results.length, 0),
  };
}
