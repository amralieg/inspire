// C29 (REQ-571, REQ-574): the content one concept draws. The AI pick (validated by backend/lib/infographicPick.mjs) fills the fields; every
// field it leaves out is read from the use case itself (storyOf): the stake, the stated facts, the method steps and the screen. Nothing is
// invented: a field with no source in the use case is left empty and the drawing leaves its part out. No industry words, only sentence shapes.
import { displayId } from '../../../../../../shared/useCaseId.mjs';
import { storyOf, facts as factsIn } from './story.js';
import { splitStake } from './common.js';
import { distinctIcons } from './icons.js';
import { LIMITS } from '../../../../../../backend/lib/infographicPick.mjs';
import { phrase } from './text.js';

const TIME = /^(hours?|days?|weeks?|months?|minutes?|years?|times|points?)\b/i;
const NEG = /\b(took|lost|loses?|fell|falls?|cut|cuts|missed|down|drops?|dropped|costs?|below|minus|takes?)\b/i;
const POS = /\b(added|adds?|gained|gains?|saved|saves?|rose|rises?|up|grew|grows?|plus|earns?)\b/i;
const FILLER = /(?<![\w-])(and|the|of|a|an|by|took|lost|fell|added|adds|gained|saved|moved|is|are|was|were|with|this|that|at|in|for|to|its|it)(?![\w-])/gi;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lines = (a) => (Array.isArray(a) && a.length ? a.map((x) => (x && typeof x === 'object' ? str(x.title || x.label || x.text) : str(x))).filter(Boolean) : null);
const words = (s, n) => String(s || '').split(/\s+/).filter(Boolean).slice(0, n).join(' ');
// A phrase that cannot stand alone as a label: it starts with a preposition or a link word ("of that value", "of it").
const FRAGMENT = /^(of|to|for|with|by|from|in|on|at|into|over|under|between|within|without|than|per|about|across|and|or|but|that|which|who)\b/i;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A fact as the reader sees it: the number with a time unit when one follows ("14.6 hours").
function shown(f) {
  const after = f.clause.slice(f.clause.indexOf(f.raw) + f.raw.length).trim(); const m = TIME.exec(after);
  return m && !f.unit ? `${f.raw} ${m[1]}` : f.raw;
}
// The words in front of a number in its clause, since the previous number ("Volume took $0.21M and price $0.12M" -> "Volume", "price").
function phraseOf(f, all) {
  const at = f.clause.indexOf(f.raw); let from = 0;
  for (const g of all) if (g !== f && g.clause === f.clause) { const j = f.clause.indexOf(g.raw); if (j >= 0 && j < at) from = Math.max(from, j + g.raw.length); }
  const seg = f.clause.slice(from, at); const near = seg.split(/[:;,]/).map((x) => x.trim()).filter(Boolean).pop() || seg; const p = near.replace(/[^\w\s'-]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return { label: cap(words(p, 3)), sign: NEG.test(seg) ? -1 : POS.test(seg) ? 1 : 0 };
}
const uniq = (list, key = (x) => x) => { const seen = new Set(); return list.filter((x) => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const fmtMoney = (v, like) => { const m = /\$?(\d[\d,]*(?:\.(\d+))?)\s?([MKB])?/.exec(like) || []; const k = { M: 1e6, K: 1e3, B: 1e9 }[m[3]] || 1; const d = (m[2] || '').length;
  return `${v < 0 ? '-' : '+'}$${(Math.abs(v) / k).toFixed(d)}${m[3] || ''}`; };

// The common story every concept tells, plus the facts the concept fields are read from.
export function baseContent(row, pick = null) {
  const s = storyOf(row && typeof row === 'object' ? row : {}); const p = pick && typeof pick === 'object' ? pick : {};
  const st = splitStake(s.stake); const facts = s.facts;
  let hero = p.hero && p.hero.value ? { value: str(p.hero.value), label: str(p.hero.label) } : null;
  if (!hero && st.num && /\d/.test(st.num)) hero = { value: st.num, label: [st.lead, st.rest].filter(Boolean).join(' ') };
  if (!hero) { const f = facts.find((x) => x.unit === '$') || facts.find((x) => x.unit === '%') || facts[0]; if (f) hero = { value: shown(f), label: '' }; }
  // No "At stake" and no number in the statement: the business value's own money figure ("Saves $2.4M a year").
  if (!hero) { const f = factsIn(str(row && row['Business Value'])).find((x) => x.unit === '$'); if (f) hero = { value: f.raw, label: '' }; }
  let steps = Array.isArray(p.steps) && p.steps.length >= 2 ? p.steps.map((t) => str(typeof t === 'object' && t ? t.title || t.label : t)).filter(Boolean) : s.steps.map((x) => x.label);
  if (steps.length < 3) steps = uniq([...steps, ...String(s.screenDetail || '').split(/,\s+|;\s+/).map((t) => cap(t.trim())).filter((t) => t.split(' ').length >= 3), s.valueWhat]).slice(0, Math.max(3, steps.length));
  // Every picture lays out three or more stages: a use case that states fewer gets the plain generic ones for the rest (never a topic claim).
  for (const g of ['Bring the data together', 'Find the pattern', 'Show the answer']) if (steps.length < 3 && !steps.includes(g)) steps.push(g);
  const icons = distinctIcons(steps);
  return {
    no: displayId(row && row.No), title: str(p.title) || s.title || 'Use case', technique: s.technique || s.kind, problem: str(p.problem) || s.problem,
    hero, heroNote: s.valueWhat, who: str(p.who) || s.who, cadence: str(p.cadence) || s.cadence, sponsor: s.sponsor, screen: s.screen,
    steps: steps.slice(0, 5).map((label, i) => ({ label, icon: icons[i] })), facts, story: s,
  };
}

// The facts that are not the hero number (the rest of the story).
const others = (c) => c.facts.filter((f) => !c.hero || (f.raw !== c.hero.value && shown(f) !== c.hero.value));
const clauses = (c) => uniq(others(c).map((f) => f.clause));
const stepLabels = (c) => c.steps.map((x) => x.label);
const isMoneyLike = (t) => /\$|value|cash|spend|cost|revenue|margin|profit|sales/i.test(t);

// Each concept's own fields: the pick's when it gave them, else read from the use case.
const FIELDS = {
  journey: (c, p) => ({ pain: p.pain || (() => { const f = others(c).find((x) => shown(x) !== x.raw) || others(c)[0]; return f ? { value: shown(f), label: f.clause } : null; })() }),
  cycle: (c, p) => ({ hub: p.hub || (() => { const f = c.facts.find((x) => x.unit === 'x') || others(c).find((x) => x.unit === '%'); return f ? { value: f.raw, label: f.clause } : c.hero; })() }),
  isometric: (c) => { const f = c.facts.find((x) => x.unit === '%'); return { ring: f ? { value: Math.min(100, f.value), label: f.clause, raw: f.raw } : null }; },
  pictogram: (c, p) => {
    if (p.share) return { share: { value: p.share.value, label: p.share.label, unit: isMoneyLike(p.share.label) ? 'coin' : 'square' } };
    const f = others(c).find((x) => x.unit === '%');
    if (f) return { share: { value: Math.max(1, Math.min(100, Math.round(f.value))), label: f.clause, unit: isMoneyLike(f.clause) ? 'coin' : 'square' } };
    const m = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/.exec(c.story.statement || '');
    if (m && Number(m[2].replace(/,/g, '')) > 0) { const v = Math.round((100 * Number(m[1].replace(/,/g, ''))) / Number(m[2].replace(/,/g, ''))); if (v > 0 && v <= 100) return { share: { value: v, label: m[0], unit: 'square', ratio: true } }; }
    return { share: null };
  },
  // A listed line given as a card ({ title, text }) reads as its title (never "[object Object]").
  beforeafter: (c, p) => ({
    before: lines(p.before) || (clauses(c).length ? clauses(c).slice(0, 3) : [c.problem].filter(Boolean)),
    after: lines(p.after) || uniq([c.screen, c.story.screenDetail, c.heroNote]).slice(0, 3),
  }),
  timeline: (c, p) => ({ trend: p.trend || (() => { const f = others(c).find((x) => x.unit === '%') || others(c)[0]; return f ? { value: shown(f), label: f.clause } : null; })() }),
  funnel: (c, p) => {
    if (p.stages) return { stages: p.stages };
    const o = others(c); const plain = o.filter((f) => f.unit !== '$'); const list = uniq(plain.length >= 2 ? plain : o, (f) => f.raw).slice(0, 4);
    // Two numbers of one sentence: the later one is labelled by the words after it ("12 stores and 40 depots" -> "Depots"). A tier
    // label reads as a whole phrase alone, so a later number whose words after it start with a preposition or a link word ("41% of that value") gets no tier of its own; the stage list is padded from the method steps instead.
    const used = new Set(); const stages = list.map((f) => { if (!used.has(f.clause)) { used.add(f.clause); return { value: shown(f), label: f.clause }; }
      const after = f.clause.slice(f.clause.indexOf(f.raw) + f.raw.length).split(/\d/)[0].replace(/^[\s%]+|[\s,;:.]+$/g, '');
      if (FRAGMENT.test(after)) return null; return { value: shown(f), label: cap(after) || f.clause }; }).filter(Boolean);
    for (const t of stepLabels(c)) { if (stages.length >= 3) break; stages.push({ value: '', label: t }); }
    return { stages };
  },
  // The first step is the question the person asks (drawn in the bubble), so the spokes start from the second.
  hub: (c, p) => ({ center: p.center || c.screen || c.technique, spokes: p.spokes || uniq([...stepLabels(c).slice(1).filter((t) => t !== c.screen), ...clauses(c)]).slice(0, 5) }),
  map: (c, p) => ({ places: p.places || uniq([...clauses(c), ...stepLabels(c)]).slice(0, 4) }),
  network: (c, p) => ({ groups: p.groups || uniq([...clauses(c), ...stepLabels(c)]).slice(0, 4), count: p.count || (others(c).find((f) => !f.unit) || {}).raw || '' }),
  waterfall: (c, p) => {
    if (p.bars) return { bars: p.bars.map((b) => ({ label: b.label, value: b.value })), total: p.total || (c.hero ? { label: c.hero.label, value: c.hero.value } : null) };
    const money = c.facts.filter((f) => f.unit === '$');
    if (money.length >= 3) {
      const [t, ...rest] = money; const tp = phraseOf(t, money); const ts = tp.sign || -1;
      const bars = rest.slice(0, 4).map((f) => { const ph = phraseOf(f, money); const sg = ph.sign || (rest.indexOf(f) === 0 ? ts : ph.sign) || ts; return { label: ph.label || phrase(f.clause, 48), value: `${sg < 0 ? '-' : '+'}${f.raw}`, n: sg * f.value }; });
      const sum = bars.reduce((a, b) => a + b.n, 0); const diff = ts * t.value - sum;
      if (Math.abs(diff) > Math.abs(t.value) * 0.01 && bars.length < 5) bars.push({ label: 'The rest', value: fmtMoney(diff, t.raw), n: diff });
      return { bars, total: { label: tp.label || 'Total', value: `${ts < 0 ? '-' : '+'}${t.raw}` } };
    }
    const bars = uniq(others(c), (f) => f.raw).slice(0, 4).map((f) => ({ label: phrase(f.clause, 48), value: shown(f) }));
    for (const t of stepLabels(c)) { if (bars.length >= 3) break; bars.push({ label: phrase(t, 48), value: '' }); }
    return { bars, total: c.hero ? { label: c.hero.label, value: c.hero.value } : null };
  },
  balance: (c, p) => {
    if (p.options) return { options: p.options };
    const o = others(c); const money = o.filter((f) => f.unit === '$');
    const list = (money.length >= 2 ? money : o).slice(0, 3).map((f) => { const ph = phraseOf(f, o); return { label: ph.label || f.clause, value: `${ph.sign < 0 ? '-' : ph.sign > 0 ? '+' : ''}${shown(f)}`, sign: ph.sign }; });
    for (const t of stepLabels(c)) { if (list.length >= 2) break; list.push({ label: t, value: '', sign: 0 }); }
    return { options: list };
  },
};

// Every text slot holds a short whole phrase: a longer text is cut at its last clause (or whole word), never mid-thought and never with an ellipsis.
// The caps are the ones the AI pick must keep (LIMITS), so the drawing of a pick and of the use case itself read the same.
const CAP = { title: LIMITS.title, problem: LIMITS.problem, who: LIMITS.who, cadence: LIMITS.cadence, sponsor: LIMITS.who, screen: LIMITS.step, heroNote: LIMITS.label, technique: 40, label: LIMITS.label, center: LIMITS.center };
const LIST_CAP = { before: LIMITS.line, after: LIMITS.line, places: LIMITS.line, spokes: LIMITS.spoke, groups: LIMITS.group };
const SKIP = new Set(['facts', 'story', 'icon', 'value', 'raw', 'count']);
function fit(v, key, listCap) {
  if (typeof v === 'string') return listCap ? phrase(v, listCap) : CAP[key] ? phrase(v, CAP[key]) : v;
  if (Array.isArray(v)) return v.map((x) => fit(x, key, key === 'steps' ? 0 : LIST_CAP[key]));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SKIP.has(k) ? x : fit(x, k, 0)]));
  return v;
}

// The full content of one concept for one use case.
export function contentFor(row, concept, pick = null) {
  const p = pick && typeof pick === 'object' && !Array.isArray(pick) ? pick : {};
  const c = baseContent(row, p);
  return fit({ ...c, concept, ...(FIELDS[concept] ? FIELDS[concept](c, p) : {}) }, '', 0);
}
