// RC6-B-11: every fixed label the document renderers print (brief, infographic, PowerPoint). A document in another language translates
// this set once with the other texts (generateDocs.textsToTranslate) and the renderers print the translation through LB(), so no
// renderer prints its own English. A label with {0}, {1} is a template: the number or money in its place is carried over.
// Product and brand names (Databricks Inspire AI) are not labels. Texts that carry data (use case names, stories, domain lists in a
// sentence) are not labels either; they are translated as data.
import disclaimer from '../../../../backend/lib/valueDisclaimer.json' with { type: 'json' };

export const NOT_YET = 'not calculated yet';

export const DOC_LABELS = [
  // brief page 1 and use case page
  'Use case brief', 'Where data and AI pay back first', 'Prepared for', 'a year, estimated', 'use cases', 'domains', 'Executive summary', 'Summary',
  'Where to start', 'Start here', 'Value by domain', 'Start with these three', 'estimated a year', 'estimated', 'calculated', 'Inspire score', 'What it does',
  'The use case', 'The solution', 'Business value', 'Value story', 'Three-year projection', 'Sponsor', 'Beneficiary', 'Technique',
  'Type', 'Priority alignment', 'Strategic alignment', 'KPIs', 'Expected key results', 'Measures of success', 'Financial benefits', 'Non-financial benefits', 'Foundations',
  'Low', 'Likely', 'High', 'Total', 'Other', 'Quality', 'Value verb', 'Statement', 'Solution', 'Use case', 'Score', 'Value',
  NOT_YET, 'Value not calculated yet', 'Projection not calculated yet', 'Calculate value to add the projection', 'Yearly value',
  'Page {0}', 'Year {0}', 'Score {0}', 'score {0}', 'of {0}', '{0} a year', 'Use case {0}', 'FIGURE {0}', 'EXHIBIT {0}', 'Numbers match Figure {0}',
  'Domain {0} of {1}', 'Top {0} by value', '{0} of {1} use cases have a calculated value.', '{0} use cases', '{0} use cases | {1} with a calculated value',
  // infographic
  'Use case portfolio', 'Value at a glance', 'Total yearly value', 'Use cases', 'Domains', 'Top Inspire score', 'Where the value sits', 'Yearly value by domain',
  'What the value does', 'Inspire score against yearly value', 'Dot color = value verb', 'High value, lower score', 'Do first', 'Park', 'Quick wins',
  'Top use cases', 'numbered as on the chart above, by yearly value', 'How to read', 'The Use Case Brief', 'Best Inspire score',
  'Tile area = estimated yearly value. Red = the leading domain.', 'Where the yearly value sits, by domain', 'Score against value', 'The top use cases',
  'How to read.', 'a year', 'Where the value is', 'top score', 'Tile area = value', 'Score vs value', 'Bubble = value', 'Top use cases by value', 'Numbers match the chart',
  'Domain values build to the total', 'Top seven use cases by value', 'Value a year', 'estimated value a year', 'use cases scored', 'business domains',
  'Most value sits right of the median score', 'Strategic bets', 'Deprioritise', 'All use cases', 'Score at or above median', 'Value above median too',
  'The top use cases by estimated value', 'Lever', 'Total value', 'Calculated', 'Value per use case', 'Three-year projection',
  // C28 (REQ-564): the chart texts (designs/ucCharts.js, designs/scoreInfographic.js)
  'Forecast with its range', 'Survival with action', 'Risk: who to act on first', 'Readiness gauge', 'Today against optimized', 'From today to the target',
  'Segments in the data', 'Clusters by size', 'Ranked recommendations', 'Outliers to review', 'Hubs and their links', 'Impact of the change', 'What drives the change',
  'Against its peers', 'Location heat map', 'Where work drops off', 'Ask, reason, answer', 'Score profile', 'Scores as rings', 'Value by year', 'Scores',
  'The portfolio by business domain', 'Quality mix', 'Top opportunities by Inspire Score', 'Priority against readiness', 'Priority against feasibility', 'Priority against quality score',
  'Analytics techniques', 'Every use case at a glance', 'Use cases by domain', 'Value at stake by business domain', 'Use cases by business domain',
  'Illustrative shape', 'History', 'Forecast', 'With action', 'Without action', 'Act on these', 'Low risk', 'High risk', 'Inspire Score', 'Today', 'Optimized', 'Improvements', 'Target',
  'Flagged', 'Intervention', 'Actual', 'Without the change', 'Peer median', 'This unit', 'Question', 'Agent', 'Answer', 'Not scored yet', 'Not scored', 'Priority', 'Feasibility', 'Quality score',
  'Quick wins', 'Priority score', 'Readiness', 'Total', 'Value at stake', 'Likely value a year', 'in total', 'quality', 'business domains',
  'Segment {0}', '{0} segments', 'Cluster {0}', 'Driver {0}', 'Step {0}',
  // PowerPoint
  'Value roll-up', 'Domain', 'Portfolio', 'Value by use case', 'Yearly value by use case', 'Estimated yearly value', 'Inspire score by use case', 'Inspire score of 10', 'Open the notebook', 'Use case review', 'Use case portfolio review', 'Data and AI use cases, ranked by value',
  'Estimates are AI-generated from your data and strategy. Treat them as a starting point.',
  'Estimated value, not a promised value. Your business value team must validate it.',
  disclaimer.full,
];

const unique = (a) => [...new Set(a)];
export const labelKeys = () => unique(DOC_LABELS);
export const LABEL_PREFIX = 'label|';
const holes = (s) => unique(String(s).match(/\{\d+\}/g) || []).sort().join('');

// The translations the model returned (keys "label|<English>") as an English -> translated map; a translation that lost a {0} is dropped.
export function labelsFrom(translated) {
  const out = {};
  for (const k of labelKeys()) {
    const v = translated?.[LABEL_PREFIX + k];
    if (typeof v === 'string' && v.trim() && v !== k && holes(v) === holes(k)) out[k] = v;
  }
  return out;
}
export const labelTexts = () => Object.fromEntries(labelKeys().map((k) => [LABEL_PREFIX + k, k]));

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
function compile(labels) {
  const exact = new Map(); const tpl = [];
  for (const [en, tr] of Object.entries(labels || {})) {
    if (!/\{\d+\}/.test(en)) { exact.set(en.toLowerCase(), tr); continue; }
    const names = [];
    const re = new RegExp(`^${en.split(/(\{\d+\})/).map((p) => (/^\{\d+\}$/.test(p) ? (names.push(Number(p.slice(1, -1))), '(\\S+)') : esc(p))).join('')}$`, 'i');
    tpl.push({ re, names, tr });
  }
  tpl.sort((a, b) => b.re.source.length - a.re.source.length);
  return { exact, tpl };
}

let CURRENT = null;
// Run fn with the labels in force (a document being drawn); the renderers read them through LB().
export function withLabels(labels, fn) {
  const prev = CURRENT;
  CURRENT = labels && Object.keys(labels).length ? compile(labels) : null;
  try { return fn(); } finally { CURRENT = prev; }
}
export function LB(s) {
  if (!CURRENT || typeof s !== 'string') return s;
  const key = s.trim().toLowerCase();
  if (CURRENT.exact.has(key)) return CURRENT.exact.get(key);
  for (const t of CURRENT.tpl) {
    const m = t.re.exec(s.trim());
    if (m) return t.tr.replace(/\{(\d+)\}/g, (_, n) => { const at = t.names.indexOf(Number(n)); return at >= 0 ? m[at + 1] : ''; });
  }
  return s;
}
