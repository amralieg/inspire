import { joinWords } from './implementWizard.js';

const MESSAGE_KEYS = ['message', 'text', 'reason', 'summary', 'label'];

export function outcomeMessage(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(outcomeMessage).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    for (const key of MESSAGE_KEYS) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
  }
  return '';
}

const count = (value, fallback) => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) ? n : fallback;
};

export const NO_USE_CASES_MESSAGE = 'The run produced no use cases. Open the run log to see which step failed, then run again.';
export const RUN_FAILED_MESSAGE = 'The run failed. Open the run log to see why.';

const FAILURE_TITLES = {
  no_model: 'No AI model available',
  no_tables: 'Nothing to read',
  no_use_cases: 'No use cases produced',
};

const domainUseCases = (r) => (Array.isArray(r.domains)
  ? r.domains.reduce((sum, d) => sum + (Array.isArray(d?.use_cases) ? d.use_cases.length : 0), 0)
  : null);

const DOCUMENT_WORDS = {
  'Markdown Catalog': 'Markdown readme',
  'CSV Catalog': 'CSV',
  'Use Case Excel': 'Excel',
  'PDF Catalog': 'PDF',
  Presentation: 'slides',
  'JSON Catalog': 'JSON',
  'Language Pack': 'translation',
};

export function missingDocumentsOf(results) {
  const r = results && typeof results === 'object' ? results : {};
  const byLanguage = new Map();
  const add = (language, what) => {
    const key = String(language || '').trim();
    if (!byLanguage.has(key)) byLanguage.set(key, { notWritten: [], englishOnly: [] });
    return byLanguage.get(key)[what];
  };
  for (const f of Array.isArray(r.failed_steps) ? r.failed_steps : []) {
    const step = String(f?.step || '').trim();
    if (!step) continue;
    const words = DOCUMENT_WORDS[step] || step;
    const into = add(f.language, 'notWritten');
    if (!into.includes(words)) into.push(words);
  }
  const gaps = r.translation_gaps && typeof r.translation_gaps === 'object' ? r.translation_gaps : {};
  for (const [language, gap] of Object.entries(gaps)) {
    for (const artifact of Array.isArray(gap?.artifacts_in_english) ? gap.artifacts_in_english : []) {
      const into = add(language, 'englishOnly');
      if (String(artifact).trim() && !into.includes(String(artifact).trim())) into.push(String(artifact).trim());
    }
  }
  const lines = [];
  for (const [language, { notWritten, englishOnly }] of byLanguage) {
    if (notWritten.length) lines.push(language ? `Not written in ${language}: ${joinWords(notWritten)}.` : `Not written: ${joinWords(notWritten)}.`);
    if (englishOnly.length && language) lines.push(`Written in English only, not in ${language}: ${joinWords(englishOnly)}.`);
  }
  return lines;
}

export function runOutcomeOf(results, counts = null) {
  const r = results && typeof results === 'object' ? results : {};
  const bar = r.quality_bar && typeof r.quality_bar === 'object' ? r.quality_bar : null;
  const known = count(bar?.found, count(counts?.found, domainUseCases(r)));
  const found = known ?? 0;
  const meets = count(bar?.meets, count(counts?.meets, found));
  const emptyTables = Array.isArray(bar?.empty_tables) ? bar.empty_tables.map(String).filter(Boolean) : [];
  const runMessage = outcomeMessage(r.run_message);
  const empty = known === 0 && Object.keys(r).length > 0;
  const failed = r.run_status === 'failed' || empty;
  const failureKind = failed ? String(r.run_failure_kind || (empty ? 'no_use_cases' : 'error')) : '';
  const belowAll = found > 0 && meets === 0;
  const missingDocuments = missingDocumentsOf(r);
  const warning = !failed && (r.run_status === 'warning' || belowAll || missingDocuments.length > 0);
  const notes = [...new Set([outcomeMessage(r.selection_outcome), outcomeMessage(r.elite_outcome)].filter(Boolean))];
  return {
    failed,
    failureKind,
    failureTitle: failed ? (FAILURE_TITLES[failureKind] || 'Run failed') : '',
    warning,
    found,
    meets,
    below: Math.max(0, found - meets),
    mode: String(bar?.mode || ''),
    emptyTables,
    allTablesEmpty: emptyTables.length > 0 && bar?.all_tables_empty === true,
    message: runMessage || outcomeMessage(bar) || (empty ? NO_USE_CASES_MESSAGE : failed ? RUN_FAILED_MESSAGE : ''),
    barMessage: outcomeMessage(bar),
    notes,
    missingDocuments,
  };
}

export function nextStepOf(outcome) {
  const o = outcome && typeof outcome === 'object' ? outcome : {};
  const empty = Array.isArray(o.emptyTables) ? o.emptyTables.length : 0;
  if (empty > 0) {
    return `add rows to the ${empty === 1 ? 'table that has' : `${empty} tables that have`} no rows yet (the Generate data page can add sample rows), then run again.`;
  }
  return 'point the run at tables that hold your business data, or pick a lower Use Cases Quality under Advanced Settings when you start it, then run again.';
}
