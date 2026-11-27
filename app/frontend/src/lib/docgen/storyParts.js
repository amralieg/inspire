// C27 (REQ-564): the story every document tells around its use cases (PDF, Word, infographic): the executive summary, what the catalog
// is for and the business domains list. Amr (27 Nov): "execu summey very short, not in own page, no domains list, what it is for".
// Every number and name comes from the use cases, their values and the session summary; nothing is invented.
// Input: a docModel (buildDocModel) or an agent model (buildAgentModel): { businessName, summary?, useCases | ranked }.
import { ucFacts } from './designs/ucCharts.js';
import { moneyText } from '../valueWizard.js';
import { plainBusiness } from './docText.js';

const HIGH = ['Ultra High', 'Very High', 'High'];
const listOf = (model) => (Array.isArray(model?.useCases) ? model.useCases : Array.isArray(model?.ranked) ? model.ranked : []);
const joinAnd = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const firstSentence = (t) => { const x = plainBusiness(String(t ?? '').trim()).split(/(?<=[.!?])\s/)[0].trim(); return x && !/[.!?]$/.test(x) ? `${x}.` : x; };
const statementOf = (u) => u?.statement || (Array.isArray(u?.narrative) ? (u.narrative.find((n) => n[0] === 'statement') || [])[2] : '') || '';
const byScore = (a, b) => (b.f.score ?? -1) - (a.f.score ?? -1) || (b.f.priority ?? -1) - (a.f.priority ?? -1) || a.f.id.localeCompare(b.f.id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const wordCount = (s) => s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;

// The business domains of the portfolio: domain, use case count, value, best score and one line built from its use cases.
export function domainsListOf(useCases) {
  const rows = new Map();
  for (const u of useCases || []) {
    const f = ucFacts(u); const k = f.domain || 'Other';
    if (!rows.has(k)) rows.set(k, { domain: k, count: 0, amount: 0, currency: f.currency, nWithValue: 0, bestScore: null, subs: new Map(), items: [] });
    const r = rows.get(k); r.count += 1; r.items.push({ f, u });
    if (f.amount !== null && f.currency === r.currency) { r.amount += f.amount; r.nWithValue += 1; }
    if (f.score !== null) r.bestScore = Math.max(r.bestScore ?? -Infinity, f.score);
    if (f.subdomain) r.subs.set(f.subdomain, (r.subs.get(f.subdomain) || 0) + 1);
  }
  return [...rows.values()].map((r) => {
    const lead = [...r.items].sort(byScore)[0];
    const subs = [...r.subs].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    const techniques = [...new Set(r.items.map((x) => x.f.technique).filter(Boolean))].slice(0, 2);
    const description = [subs.length ? `Covers ${joinAnd(subs)}` : '', techniques.length ? `with ${joinAnd(techniques.map((t) => t.toLowerCase()))}` : '']
      .filter(Boolean).join(' ') + (lead?.f.name ? `${subs.length || techniques.length ? '; ' : ''}leads with ${lead.f.name}.` : '.');
    return { domain: r.domain, count: r.count, value: r.nWithValue ? { amount: r.amount, currency: r.currency, text: moneyText(r.currency, r.amount), n: r.nWithValue } : null,
      bestScore: r.bestScore, description: description.replace(/^./, (c) => c.toUpperCase()) };
  }).sort((a, b) => (b.value?.amount || 0) - (a.value?.amount || 0) || b.count - a.count || (b.bestScore ?? 0) - (a.bestScore ?? 0) || a.domain.localeCompare(b.domain));
}

// The executive summary: 180 to 300 words when the portfolio has enough to say, from the session summary, counts, domains, value, top three
// and quick wins. Paragraphs are plain strings.
export function execSummaryParas(model) {
  const list = listOf(model).map((u) => ({ u, f: ucFacts(u) }));
  const n = list.length; const name = String(model?.businessName || '').trim() || 'the business';
  if (!n) return [`No use cases were found for ${name} in this run.`];
  const domains = domainsListOf(list.map((x) => x.u));
  const out = [];
  const summary = (Array.isArray(model?.summary) ? model.summary : []).map((p) => plainBusiness(String(p || '').trim())).filter(Boolean);
  const high = list.filter((x) => HIGH.includes(x.f.quality)).length;
  const techniques = [...new Set(list.map((x) => x.f.technique).filter(Boolean))];
  out.push(`${summary.length ? `${summary.join(' ')} ` : ''}Inspire found ${plural(n, 'AI use case', 'AI use cases')} for ${name} across ${plural(domains.length, 'business domain', 'business domains')}`
    + `${techniques.length ? `, using ${plural(techniques.length, 'analytics technique', 'analytics techniques')}` : ''}.${high ? ` ${high} of ${n} are rated High quality or better.` : ''}`
    + `${techniques.length > 2 ? ` The methods range from ${joinAnd(techniques.slice(0, 4).map((t) => t.toLowerCase()))} to the rest of the mix.` : ''}`
    + ` The largest domains are ${joinAnd(domains.slice(0, 3).map((d) => `${d.domain} (${d.count})`))}.`);
  const valued = list.filter((x) => x.f.amount !== null);
  if (valued.length) {
    const cur = valued[0].f.currency; const same = valued.filter((x) => x.f.currency === cur);
    const total = same.reduce((a, x) => a + x.f.amount, 0); const big = [...same].sort((a, b) => b.f.amount - a.f.amount)[0];
    const topDom = domains.find((d) => d.value);
    out.push(`The value at stake is ${moneyText(cur, total)} a year across ${plural(same.length, 'use case', 'use cases')} with a value. The largest is ${big.f.name} at ${big.f.valueText} a year`
      + `${topDom ? `, and ${topDom.domain} carries the most value of any domain (${topDom.value.text})` : ''}. These are estimates to prioritize, not promised results.`);
  } else {
    out.push(`No use case has a value yet: the yearly value is worked out with the value wizard. Until then the ranking rests on the Inspire Score, which combines quality and business priority.`);
  }
  const top = [...list].sort(byScore).slice(0, 3);
  const topLines = top.map((x, i) => `${i + 1}. ${x.f.name} (${x.f.domain || 'Other'}${x.f.score !== null ? `, Inspire Score ${fmt(x.f.score)}` : ''}${x.f.amount !== null ? `, ${x.f.valueText} a year` : ''}): ${firstSentence(statementOf(x.u))}`);
  out.push(`The top three opportunities: ${topLines.join(' ')}`);
  const feas = list.filter((x) => x.f.feasibility !== null);
  const quick = feas.length ? [...feas].sort((a, b) => b.f.feasibility - a.f.feasibility || byScore(a, b)).filter((x) => !top.includes(x)).slice(0, 3)
    : list.filter((x) => HIGH.includes(x.f.quality) && !top.includes(x)).sort(byScore).slice(0, 3);
  if (quick.length) {
    out.push(feas.length ? `Quick wins, the most feasible next: ${joinAnd(quick.map((x) => `${x.f.name} (feasibility ${fmt(x.f.feasibility)} / 5)`))}. Start with one quick win and one top opportunity, so the team learns fast while the bigger value is built.`
      : `Next in line: ${joinAnd(quick.map((x) => `${x.f.name} (${x.f.quality} quality)`))}. Start with one of the top three and one of these, so the team learns fast while the bigger value is built.`);
  }
  // Keep the summary to 300 words: the top three lose their statements first.
  if (wordCount(out.join(' ')) > 300) out[out.findIndex((p) => p.startsWith('The top three'))] = `The top three opportunities: ${top.map((x, i) => `${i + 1}. ${x.f.name} (${x.f.domain || 'Other'}${x.f.score !== null ? `, Inspire Score ${fmt(x.f.score)}` : ''}).`).join(' ')}`;
  return out;
}

// What this catalog is for and how to read it, with the portfolio's own counts.
export function purposeParas(model) {
  const list = listOf(model); const n = list.length; const name = String(model?.businessName || '').trim() || 'the business';
  const d = new Set(list.map((u) => ucFacts(u).domain || 'Other')).size;
  return [
    `This catalog lists ${plural(n, 'AI use case', 'AI use cases')} that Inspire found in the data of ${name}, grouped into ${plural(d, 'business domain', 'business domains')}. It is written for the business sponsors who choose what to build, and for the data teams who build it on Databricks.`,
    'Use it to choose. Each use case says the problem it solves, the solution, who sponsors it, the business value and how success is measured. The scores rank the portfolio on one scale, so the strongest opportunities come first.',
    'Each use case page carries two charts. The first shows the kind of result its analytics technique produces (a forecast, a risk list, a segmentation, ...); it is labeled as an illustrative shape, not measured data. The second shows its real scores, or its value by year when the value is known.',
    'A good way to start: pick one top opportunity and one quick win, confirm the data with its owners, then build the first version with Genie Code and measure the value it delivers.',
  ];
}
