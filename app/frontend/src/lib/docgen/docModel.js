// FX-113 (REQ-503): the one plain model every document (SVG, PowerPoint, Excel) is drawn from.
import { aiWording, fieldOf, inspireScoreFromUc, trackingIdOf, scoreOf } from '../useCaseFields.js';
import { moneyText } from '../valueWizard.js';
import { v130View, kpiText } from '../v130UseCase.js';
import { plainDocText, foundationLabel } from './docText.js';

export const RTL_LANGUAGES = ['Arabic', 'Hebrew', 'Persian', 'Farsi', 'Urdu'];
export const isRtl = (language) => RTL_LANGUAGES.includes(language);

// REQ-529c: every text in a document (PDF, PowerPoint, Excel) goes through the wording rule, so older runs never print the retired product name.
const clean = (v) => plainDocText(aiWording(v)).trim();
const tablesOf = (uc) => clean(fieldOf(uc, 'Tables Involved', 'tables_involved')).split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

export const STORY_NOT_APPROVED = 'Story not approved yet';
const storyText = (story) => {
  if (story && typeof story === 'object') return story.approved && story.include_in_docs && clean(story.text) ? clean(story.text) : STORY_NOT_APPROVED;
  return clean(story);
};

// A saved wizard entry ({answers, yearly}) as the doc model value, or null when there is no saved value.
export function valueFromSaved(saved) {
  const total = saved?.yearly?.total;
  if (!saved || !total || !Number.isFinite(Number(total.amount))) return null;
  const a = saved.answers || {};
  return {
    amount: Number(total.amount), currency: a.currency || total.unit || 'USD', status: a.calculated ? 'calculated' : 'estimated',
    story: a.story, yearly: saved.yearly.projection?.years || [],
  };
}

function valueOf(raw) {
  if (!raw || !Number.isFinite(Number(raw.amount))) return null;
  const amount = Number(raw.amount);
  const currency = raw.currency || 'USD';
  return {
    amount, currency, status: raw.status || 'estimated', verb: clean(raw.verb), story: storyText(raw.story), text: moneyText(currency, amount),
    yearly: Array.isArray(raw.yearly) ? raw.yearly : [], factors: Array.isArray(raw.factors) ? raw.factors : [],
  };
}

// REQ-526 part E: the session's executive summary paragraphs (from reviewFigures.executiveSummaryOf), kept as clean non-empty strings.
export const summaryOf = (summary) => (Array.isArray(summary) ? summary.map((p) => clean(p)).filter(Boolean) : []);

export function buildDocModel({ businessName, useCases, values, options, summary, foundations }) {
  const opts = options || {};
  // C24 (RC7-B-12): the run's foundations by code, so a use case's "F1" prints as the foundation's name.
  const foundationNames = new Map((Array.isArray(foundations) ? foundations : []).map((f) => [String(f.id).toUpperCase(), f.name]));
  const language = (opts.languages && opts.languages[0]) || opts.language || 'English';
  const list = (useCases || []).map((uc) => {
    const id = trackingIdOf(uc);
    const score = inspireScoreFromUc(uc);
    const v = v130View(uc);
    const lines = (items) => items.map((x) => clean(x)).filter(Boolean);
    return {
      id, name: clean(fieldOf(uc, 'Name', 'name')), statement: clean(fieldOf(uc, 'Statement', 'statement')), solution: clean(fieldOf(uc, 'Solution', 'solution')),
      businessValue: clean(fieldOf(uc, 'Business Value', 'business_value')), domain: clean(fieldOf(uc, 'domain', 'Domain') || fieldOf(uc, 'Subdomain', 'subdomain')),
      score, tables: tablesOf(uc), value: valueOf(values?.[id]),
      // REQ-526: the extra real fields the document designs show (blank or null when the use case has none).
      short: clean(fieldOf(uc, 'usecase', 'short_name')), subdomain: clean(fieldOf(uc, 'Subdomain', 'subdomain')), sponsor: clean(fieldOf(uc, 'Sponsor', 'sponsor')),
      beneficiary: clean(fieldOf(uc, 'Beneficiary', 'beneficiary')), technique: clean(fieldOf(uc, 'Analytics Technique', 'analytics_technique')), quality: clean(fieldOf(uc, 'Quality', 'quality')),
      // C23: the rest of what the agent documents printed for a use case (kept in full, one string per item).
      design: clean(fieldOf(uc, 'High Level Design', 'high_level_design')), type: clean(fieldOf(uc, 'type', 'Type')),
      priorityAlignment: clean(fieldOf(uc, 'Business Priority Alignment', 'business_priority_alignment')), strategicAlignment: clean(fieldOf(uc, 'Strategic Goals Alignment', 'strategic_goals_alignment')),
      kpis: lines(v.kpis.map(kpiText)), keyResults: lines(v.keyResults.map((k) => k.statement)), measures: lines(v.measures), financial: lines(v.financial), nonFinancial: lines(v.nonFinancial),
      foundations: lines(v.foundations.flatMap((f) => (/^F\d+(\s*[,;]\s*F\d+)+$/i.test(f.trim()) ? f.split(/\s*[,;]\s*/) : [f])).map((f) => foundationLabel(f, foundationNames))),
      priorityScore: scoreOf(uc, 'priority_score', 'Priority Score', 'Priority'), feasibility: scoreOf(uc, 'feasibility', 'Feasibility'), valueScore: scoreOf(uc, 'value_score', 'Value'),
    };
  });
  const withValue = list.filter((u) => u.value);
  const currency = withValue[0]?.value.currency || 'USD';
  const same = withValue.filter((u) => u.value.currency === currency);
  const amount = same.reduce((sum, u) => sum + u.value.amount, 0);
  return {
    businessName: clean(businessName), language, rtl: isRtl(language), blocks: [...(opts.blocks || [])], summary: summaryOf(summary), useCases: list,
    total: { amount, currency, n: list.length, nWithValue: withValue.length, text: moneyText(currency, amount) },
  };
}

// C23: the detail parts of a use case beyond the statement, solution and business value, in the order the agent documents printed them.
// Each part is [label, items]; a part with nothing in it is left out. Labels are in docLabels.DOC_LABELS so a second language translates them.
export function extraParts(u) {
  const one = (v) => (v ? [v] : []);
  return [
    ['Technical design', one(u.design)], ['Type', one(u.type)], ['Priority alignment', one(u.priorityAlignment)], ['Strategic alignment', one(u.strategicAlignment)],
    ['KPIs', u.kpis || []], ['Expected key results', u.keyResults || []], ['Measures of success', u.measures || []],
    ['Financial benefits', u.financial || []], ['Non-financial benefits', u.nonFinancial || []], ['Foundations', u.foundations || []],
  ].filter(([, items]) => items.length);
}
// One text for a part: a single item as is, several as a bullet list on separate lines.
export const partLines = (items) => (items.length > 1 ? items.map((i) => `\u2022 ${i}`) : items);
