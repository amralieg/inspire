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

export function runOutcomeOf(results, counts = null) {
  const r = results && typeof results === 'object' ? results : {};
  const bar = r.quality_bar && typeof r.quality_bar === 'object' ? r.quality_bar : null;
  const found = count(bar?.found, count(counts?.found, 0));
  const meets = count(bar?.meets, count(counts?.meets, found));
  const emptyTables = Array.isArray(bar?.empty_tables) ? bar.empty_tables.map(String).filter(Boolean) : [];
  const runMessage = outcomeMessage(r.run_message);
  const belowAll = found > 0 && meets === 0;
  const warning = r.run_status === 'warning' || belowAll || (bar != null && found === 0);
  const notes = [...new Set([outcomeMessage(r.selection_outcome), outcomeMessage(r.elite_outcome)].filter(Boolean))];
  return {
    warning,
    found,
    meets,
    below: Math.max(0, found - meets),
    mode: String(bar?.mode || ''),
    emptyTables,
    message: runMessage || outcomeMessage(bar),
    barMessage: outcomeMessage(bar),
    notes,
  };
}
