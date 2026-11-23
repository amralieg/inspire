// FX-113 (REQ-503): wizard options and the file plan (wireframe frames 2a and 2c).
import { trackingIdOf } from '../useCaseFields.js';

export const DOC_KINDS = ['infographic', 'pptx', 'pdf', 'xlsx'];

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

export const EXCEL_COLUMNS = [
  { id: 'name', label: 'Use case' },
  { id: 'inspire_score', label: 'Inspire score' },
  { id: 'value', label: 'Value' },
  { id: 'value_status', label: 'Value status' },
  { id: 'domain', label: 'Domain' },
  { id: 'statement', label: 'Statement' },
  { id: 'use_case_story', label: 'Use case story' },
  { id: 'value_story', label: 'Value story' },
  { id: 'projection', label: 'Projection' },
  { id: 'tables', label: 'Tables' },
];

export function defaultDocOptions(language = 'English') {
  return {
    kinds: [...DOC_KINDS],
    layout: 'one',
    languages: [language],
    blocks: ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'],
    columns: ['name', 'inspire_score', 'value', 'value_status', 'domain', 'statement'],
    style: 'midnight',
    palette: 'databricks',
    customColor: '',
  };
}

const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// Infographic: always one PNG + one PDF of all selected. PowerPoint and the PDF brief follow the layout. Excel: one. Repeated per language.
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
      if (kind === 'infographic') { push(kind, 'png', 'infographic', ids, language); push(kind, 'pdf', 'infographic', ids, language); }
      else if (kind === 'xlsx') push(kind, 'xlsx', 'use_cases', ids, language);
      else if (kind === 'pptx' || kind === 'pdf') {
        const stem = kind === 'pptx' ? 'deck' : 'brief';
        if (options.layout === 'each') ids.forEach((id) => push(kind, kind, `${stem}_${safe(id)}`, [id], language));
        else push(kind, kind, stem, ids, language);
      }
    }
  }
  return out;
}
