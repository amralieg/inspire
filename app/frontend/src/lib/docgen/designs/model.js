// REQ-526: the document designs. toDesignModel maps the App's doc model (docModel.buildDocModel) onto the shape the four styles read.
// Real fields only: a use case with no value is left out of every value chart and total; a part with no data (verbs, quality, summary) stays empty.
import { moneyText } from '../../valueWizard.js';
import { iconName } from './core.js';
import a_original from './styles/a_original.js';
import b_editorial from './styles/b_editorial.js';
import c_bold from './styles/c_bold.js';
import d_consulting from './styles/d_consulting.js';

// The four App style ids. `editorial` is an older style, so the editorial design is `editorial_ink`.
export const DESIGNS = { original: a_original, editorial_ink: b_editorial, bold: c_bold, consulting: d_consulting };
export const designOf = (styleId) => (Object.prototype.hasOwnProperty.call(DESIGNS, styleId) ? DESIGNS[styleId] : null);

// Per design: the labels, which design tokens give the page, card, text and muted colours, the three accents shown on the wizard card,
// and the primary accent token(s) a palette or a custom brand colour replaces.
export const DESIGN_STYLES = [
  { id: 'original', label: 'Inspire original', bg: 'page', surface: 'card', ink: 'ink', muted: 'muted', accents: ['teal', 'coral', 'gold'], primary: ['teal', 'tealMid'] },
  { id: 'editorial_ink', label: 'Editorial ink', bg: 'paper', surface: 'paper', ink: 'ink', muted: 'grey', accents: ['accent', 'ink', 'grey'], primary: ['accent', 'accentText'] },
  { id: 'bold', label: 'Bold data', bg: 'canvas', surface: 'card', ink: 'ink', muted: 'muted', accents: ['#FF3621', '#2272B4', '#00A972'], primary: ['heroAccent', 'accentText'] },
  { id: 'consulting', label: 'Board pack', bg: 'page', surface: 'panel', ink: 'ink', muted: 'slate', accents: ['blue', 'navy', 'green'], primary: ['blue', 'blueText', 'navy'] },
];

const QUALITY_ORDER = ['Ultra High', 'Very High', 'High', 'Medium', 'Low'];
const median = (nums) => [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)];

export function toDesignModel(doc) {
  const cur = doc.total.currency;
  // Valued and scored use cases in the total's currency: the ones every chart can place.
  const own = doc.useCases.filter((u) => u.value && u.value.currency === cur && Number.isFinite(u.score));
  const useCases = own.map((u) => ({
    id: u.id, name: u.name, short: u.short || u.name, domain: u.domain || 'Other', subdomain: u.subdomain, statement: u.statement, solution: u.solution,
    businessValue: u.businessValue, beneficiary: u.beneficiary, sponsor: u.sponsor, technique: u.technique, quality: u.quality, score: u.score,
    priorityScore: u.priorityScore, feasibility: u.feasibility, valueScore: u.valueScore, verb: u.value.verb || '', tables: u.tables,
    value: { amount: u.value.amount, currency: u.value.currency, text: u.value.text, yearText: `${u.value.text} a year`, status: u.value.status },
  }));
  const ranked = [...useCases].sort((a, b) => b.value.amount - a.value.amount);

  const byDomain = new Map();
  for (const u of useCases) {
    const d = byDomain.get(u.domain) || { name: u.domain, n: 0, value: 0, best: u.score, summary: '' };
    d.n += 1; d.value += u.value.amount; d.best = Math.max(d.best, u.score); byDomain.set(u.domain, d);
  }
  const domains = [...byDomain.values()].map((d) => ({ ...d, text: moneyText(cur, d.value), icon: iconName(d.name) })).sort((a, b) => b.value - a.value);

  const byVerb = new Map();
  for (const u of useCases) if (u.verb) { const v = byVerb.get(u.verb) || { name: u.verb, n: 0, value: 0 }; v.n += 1; v.value += u.value.amount; byVerb.set(u.verb, v); }
  const verbs = [...byVerb.values()].sort((a, b) => b.value - a.value);

  const counts = new Map();
  for (const u of useCases) if (u.quality) counts.set(u.quality, (counts.get(u.quality) || 0) + 1);
  const known = QUALITY_ORDER.filter((q) => counts.has(q)); const other = [...counts.keys()].filter((q) => !QUALITY_ORDER.includes(q));
  const quality = [...known, ...other].map((name) => ({ name, n: counts.get(name) }));

  return {
    businessName: doc.businessName, language: doc.language, rtl: doc.rtl, blocks: [...doc.blocks], executiveSummary: '',
    useCases, ranked, domains, verbs, quality,
    total: { amount: doc.total.amount, currency: cur, text: doc.total.text, yearText: `${doc.total.text} a year`, n: doc.total.n, nWithValue: doc.total.nWithValue, nDomains: domains.length },
    median: useCases.length ? { score: median(useCases.map((u) => u.score)), value: median(useCases.map((u) => u.value.amount)) } : null,
  };
}
