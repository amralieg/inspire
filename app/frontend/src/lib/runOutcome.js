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
  const warning = !failed && (r.run_status === 'warning' || belowAll);
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
  };
}

export function nextStepOf(outcome) {
  const o = outcome && typeof outcome === 'object' ? outcome : {};
  const empty = Array.isArray(o.emptyTables) ? o.emptyTables.length : 0;
  if (empty > 0) {
    return `add rows to the ${empty === 1 ? 'table that has' : `${empty} tables that have`} no rows yet (the Generate data page can add sample rows), then run again.`;
  }
  return 'point the run at tables that hold your business data, or pick a lower Use Cases Quality in Setup, then run again.';
}
