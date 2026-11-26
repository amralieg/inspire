// FX-113 (REQ-503): wizard options and the file plan (wireframe frames 2a and 2c).
import { trackingIdOf } from '../useCaseFields.js';

export const DOC_KINDS = ['infographic', 'pptx', 'pdf', 'xlsx', 'docx'];
// C24 (RC7-B-11): Word is offered and starts unticked, so the files a run makes by default stay the four it made before.
const DEFAULT_KINDS = DOC_KINDS.filter((k) => k !== 'docx');

export const CONTENT_BLOCKS = [
  { id: 'use_case_story', label: 'Use case story', hint: 'What the use case does, in plain words' },
  { id: 'value_story', label: 'Value story', hint: 'Why the money figure makes sense' },
  { id: 'value_projection', label: 'Value projection', hint: 'Three-year low, likely and high' },
  { id: 'value_formula', label: 'Value formula', hint: 'The factors behind the figure' },
  { id: 'inspire_score', label: 'Inspire score', hint: 'The 0 to 10 score' },
  { id: 'strategy_link', label: 'Strategy link', hint: 'How it ties to the business strategy' },
  { id: 'data_used', label: 'Data used', hint: 'The tables it reads' },
  { id: 'genie_questions', label: 'Genie questions', hint: 'Questions to ask the data' },
  { id: 'build_status', label: 'Build status', hint: 'Where the build stands' },
  { id: 'next_steps', label: 'Next steps', hint: 'What to do next' },
  { id: 'sql', label: 'SQL', hint: 'The query behind it' },
  { id: 'disclaimer', label: 'Disclaimer', hint: 'Estimates are AI-generated' },
];

// C24 (REQ-503): each column belongs to exactly one group; the Excel step shows a group tick over its column ticks.
const COLUMN_GROUPS = [
  { id: 'identity', label: 'Identity', columns: [['id', 'ID'], ['name', 'Use case'], ['domain', 'Domain'], ['type', 'Type']] },
  { id: 'business', label: 'Business', columns: [['statement', 'Statement'], ['use_case_story', 'Use case story'], ['business_value', 'Business value'], ['sponsor', 'Sponsor'],
    ['beneficiary', 'Beneficiary'], ['priority_alignment', 'Priority alignment'], ['strategic_alignment', 'Strategic alignment']] },
  { id: 'value', label: 'Value', columns: [['inspire_score', 'Inspire score'], ['value', 'Value'], ['value_status', 'Value status'], ['value_story', 'Value story'],
    ['projection', 'Projection'], ['financial', 'Financial benefits'], ['non_financial', 'Non-financial benefits']] },
  { id: 'data', label: 'Data', columns: [['tables', 'Tables'], ['technique', 'Technique'], ['foundations', 'Foundations']] },
  { id: 'delivery', label: 'Delivery', columns: [['design', 'Technical design'], ['kpis', 'KPIs'], ['key_results', 'Expected key results'], ['measures', 'Measures of success']] },
];
// The flat list in the sheet order (the order the Excel had before the groups); each column names its group.
const LEGACY_ORDER = ['id', 'name', 'inspire_score', 'value', 'value_status', 'domain', 'statement', 'use_case_story', 'value_story', 'projection', 'tables', 'business_value', 'sponsor',
  'beneficiary', 'technique', 'design', 'type', 'priority_alignment', 'strategic_alignment', 'kpis', 'key_results', 'measures', 'financial', 'non_financial', 'foundations'];
const BY_ID = Object.fromEntries(COLUMN_GROUPS.flatMap((g) => g.columns.map(([id, label]) => [id, { id, label, group: g.id }])));
export const EXCEL_COLUMNS = LEGACY_ORDER.map((id) => BY_ID[id]);
export const EXCEL_GROUPS = COLUMN_GROUPS.map((g) => ({ id: g.id, label: g.label, columns: EXCEL_COLUMNS.filter((c) => c.group === g.id).map((c) => c.id) }));
// The ticked columns in the sheet order (an unknown id is dropped).
export const orderedColumns = (ids) => EXCEL_COLUMNS.map((c) => c.id).filter((id) => (ids || []).includes(id));

export function defaultDocOptions(language = 'English') {
  return {
    kinds: [...DEFAULT_KINDS],
    layout: 'one',
    languages: [language],
    blocks: ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'],
    columns: orderedColumns(['id', 'name', 'inspire_score', 'value', 'value_status', 'domain', 'statement', 'use_case_story', 'business_value', 'sponsor', 'beneficiary', 'technique', 'design', 'kpis', 'key_results', 'tables']),
    style: 'original', // REQ-526: the four designs come first; the original is the default
    palette: 'databricks',
    customColor: '',
    theme: 'light', // REQ-525: 'light' or 'dark' (PDF and PowerPoint; Excel stays light)
  };
}

const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// Infographic: always one PDF of all selected (no PNG). PowerPoint and the PDF brief follow the layout. Excel: one. Repeated per language.
export function planFiles(options, useCases) {
  const ids = (useCases || []).map((u, i) => trackingIdOf(u) || String(i + 1));
  const kinds = options.kinds || [];
  const biz = safe(options.businessName) || 'Inspire';
  const multi = (options.languages || []).length > 1;
  const out = [];
  const seen = new Set();
  const push = (kind, ext, stem, useCaseIds, language) => {
    const lang = multi ? `_${safe(language)}` : '';
    let name = `${biz}_${stem}${lang}.${ext}`;
    for (let n = 2; seen.has(name); n += 1) name = `${biz}_${stem}${lang}_${n}.${ext}`;
    seen.add(name);
    out.push({ kind, ext, name, useCaseIds, language });
  };
  for (const language of options.languages || []) {
    for (const kind of kinds) {
      if (kind === 'infographic') push(kind, 'pdf', 'infographic', ids, language);
      else if (kind === 'xlsx') push(kind, 'xlsx', 'use_cases', ids, language);
      else if (kind === 'pptx' || kind === 'pdf' || kind === 'docx') {
        const stem = kind === 'pptx' ? 'deck' : 'brief';
        if (options.layout === 'each') ids.forEach((id) => push(kind, kind, `${stem}_${safe(id)}`, [id], language));
        else push(kind, kind, stem, ids, language);
      }
    }
  }
  return out;
}
