// REQ-574 / REQ-571: the one story an infographic tells, taken only from the use case row: the problem, how it works
// (steps), the value, and who acts. No invented numbers; identifiers are reduced to business words.
import { plainBusiness } from '../../docText.js';
import { distinctIcons } from './icons.js';

const sentences = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9$])/).filter(Boolean);
const clean = (s) => plainBusiness(String(s || '')).replace(/\s+/g, ' ').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const trimEnd = (s) => s.replace(/[\s,;:.]+$/, '');

// Number facts in a sentence: { raw, value, unit ('$', '%', 'x' or ''), clause }.
export function facts(text) {
  const out = []; const re = /(\$?\d[\d,]*(?:\.\d+)?)(\s?(?:M|K|B)\b)?(%| times)?/g;
  for (const sent of sentences(text)) for (const clause of sent.split(/,\s+(?:and\s+)?|;\s+|\band\b(?=\s+(?:the|\d))/)) {
    for (const m of clause.matchAll(re)) { const raw = m[0].trim(); if (/^\d$/.test(raw) && !m[3]) continue;
      const v = Number(m[1].replace(/[$,]/g, '')) * ({ M: 1e6, K: 1e3, B: 1e9 }[String(m[2] || '').trim()] || 1);
      out.push({ raw: raw.replace(' times', 'x'), value: v, unit: m[1].startsWith('$') ? '$' : m[3] === '%' ? '%' : m[3] ? 'x' : '', clause: trimEnd(clause.trim()), sentence: sent }); } }
  return out;
}

// The steps of how it works: clauses of the method (after its "Technique:" lead), then the screen the team uses.
export function stepsOf(row, max = 4) {
  const method = clean(row.method_summary || row.Solution || ''); const body = method.includes(':') ? method.slice(method.indexOf(':') + 1).trim() : method;
  const VERB = '(?:learns|scores|gives|flags|measures|picks|builds|turns|finds|compares|splits|adjusts|rebuilds|matches|checks|ranks|sends|writes|answers|estimates|allocates)';
  const cut = new RegExp(`,\\s+and\\s+|;\\s+|,\\s+(?=(?:and\\s+)?(?:a|an|each|every|so|which|then)\\b)|(?:,\\s+(?:and\\s+)?|\\s+and\\s+)(?=${VERB}\\b)`);
  let parts = sentences(body).flatMap((s) => s.split(cut)).map(trimEnd).filter((p) => p.split(' ').length >= 3);
  parts = parts.map((p) => cap(p.replace(/^(and|then)\s+/i, '')));
  const serve = clean(row.serving_summary || ''); const screen = trimEnd(serve.split(':')[0] || '');
  const out = parts.slice(0, Math.max(1, max - 1));
  if (screen) out.push(cap(screen));
  const list = out.slice(0, max); const ic = distinctIcons(list);
  return list.map((label, i) => ({ label, icon: ic[i] }));
}

// The one story of a use case.
export function storyOf(row) {
  const st = sentences(clean(row.Statement)); const bv = clean(row['Business Value'] || '');
  const stake = (/At stake:\s*([^.]+(?:\.\d+[^.]*)?)\.?$/.exec(bv) || [])[1] || '';
  const valueWhat = trimEnd((clean(row.value_source || bv).split(':')[0]) || '');
  const kpi = (Array.isArray(row.KPIs) && row.KPIs[0]) || null;
  const serve = clean(row.serving_summary || '');
  return {
    id: String(row.No || ''), title: clean(row.Name), domain: clean(row['Business Domain']), technique: clean(row['Analytics Technique']), kind: clean(row.kind_label),
    problem: st[0] || '', insight: st.slice(1).join(' '), statement: st.join(' '), facts: facts(clean(row.Statement)),
    stake: trimEnd(stake), stakeFacts: facts(stake), valueWhat, kpi: kpi ? { name: clean(kpi.name), dir: kpi.direction } : null,
    who: clean(row.Beneficiary), sponsor: clean(row.Sponsor), cadence: clean(row['Decision Cadence']),
    screen: cap(trimEnd(serve.split(':')[0] || '')), screenDetail: cap(trimEnd((serve.split(':')[1] || '').trim())), steps: stepsOf(row),
  };
}
