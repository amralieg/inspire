// REQ-535 (D-UX-4): turns a ranked Genie answer into five guided steps, computed from the rows and the column roles, never from a column or customer name.
import { answerLabel, integer, isKeyColumn } from './format.js';

export const GUIDE_TITLES = { look: 'Look', see: 'What you see', means: 'What it means', do: 'Do this', check: 'Then check' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numericColumn = (c, rows) => !isKeyColumn(c.name, c.type) && rows.some((r) => isNum(r[c.name])) && rows.every((r) => r[c.name] == null || isNum(r[c.name]));
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What is left of a text cell once the row's own label and its numbers are taken out.
function templateOf(text, label) {
  let t = String(text ?? '');
  if (label) t = t.replace(new RegExp(escaped(String(label)), 'gi'), ' ');
  return t.replace(/\d[\d,.]*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// A text column that reads the same on every row once the label and numbers are removed adds nothing the buttons do not say.
function repeatedColumns(columns, rows, labelName) {
  return columns.filter((c) => {
    if (c.name === labelName || rows.some((r) => isNum(r[c.name]))) return false;
    const raw = rows.map((r) => String(r[c.name] ?? ''));
    const templates = rows.map((r, i) => templateOf(raw[i], r[labelName]));
    return templates[0] !== '' && templates.every((t) => t === templates[0]) && raw.some((x, i) => x.trim().toLowerCase() !== templates[i]);
  }).map((c) => c.name);
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function listText(names) {
  const words = names.map((n, i) => (i ? lowerFirst(n) : n));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
}

export function guideOf(answer, page, { decisions = false } = {}) {
  const columns = answer?.columns || [];
  const rows = answer?.rows || [];
  if (rows.length < 2) return null;
  const numeric = columns.filter((c) => numericColumn(c, rows));
  const measure = numeric.find((c) => rows.some((r) => isNum(r[c.name]) && r[c.name] !== 0)) || numeric[0];
  if (!measure) return null;
  const label = columns.find((c) => c.name !== measure.name && !numeric.includes(c) && !isKeyColumn(c.name, c.type)) || columns.find((c) => !numeric.includes(c));
  const labelName = label?.name;
  const nameOf = (r, i) => String(labelName ? r[labelName] ?? `Row ${i + 1}` : `Row ${i + 1}`);
  const ranked = rows.map((r, i) => ({ r, label: nameOf(r, i), value: r[measure.name] })).filter((x) => isNum(x.value)).sort((a, b) => b.value - a.value);
  const top = ranked[0];
  const total = ranked.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const zero = numeric.filter((c) => c.name !== measure.name && rows.every((r) => r[c.name] === 0)).map((c) => answerLabel(c.name));
  const lead = `${top.label} is first on ${String(answerLabel(measure.name)).toLowerCase()}${total > 0 && top.value > 0 ? `, ${Math.round((top.value / total) * 100)}% of the total` : ''}`;
  const see = zero.length ? `${lead}, and ${listText(zero)} ${zero.length > 1 ? 'are' : 'is'} 0 for all ${integer(rows.length)} rows.` : `${lead}.`;
  const key = top.r.record_key;
  const has = key != null && key !== '';
  const dropped = repeatedColumns(columns, rows, labelName);
  return {
    steps: [
      { id: 'look', title: GUIDE_TITLES.look, measure: measure.name, bars: ranked.map((x) => ({ label: x.label, value: x.value })) },
      { id: 'see', title: GUIDE_TITLES.see, text: see },
      { id: 'means', title: GUIDE_TITLES.means, kind: page?.kind || null },
      { id: 'do', title: GUIDE_TITLES.do, top: { label: top.label, key: has ? key : null }, actions: !has ? [] : decisions && page?.records ? ['start', 'open'] : ['open'] },
      { id: 'check', title: GUIDE_TITLES.check, text: 'Compare the top rows with the table, and open How Genie got this to see the question it asked.' },
    ],
    dropped,
    shownColumns: columns.map((c) => c.name).filter((n) => !dropped.includes(n)),
  };
}
