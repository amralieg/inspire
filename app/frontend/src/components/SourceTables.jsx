import { Check } from 'lucide-react';
import { REMOVE_TABLE } from '../lib/implementWizard';

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export default function SourceTables({
  tables, spec, primary = '', swaps = {}, swapsWhy = {}, changing = {}, lostReason = () => '', blockerOf = () => '', readOnly = false,
  locked = false, selectClass = '', onToggle, onPick, onRestore,
}) {
  const removedTables = spec?.data?.removed_tables || [];
  return tables.map((original) => {
    const chosen = spec.data.tables[original] || original;
    const removed = removedTables.some((r) => same(r, original));
    const blocker = blockerOf(original);
    const isPrimary = same(original, primary);
    const lost = removed ? '' : lostReason(chosen);
    const options = swaps[original];
    const why = swapsWhy[original] || '';
    return (
      <div key={original} data-table={original} className={`border rounded-lg px-3 py-2.5 space-y-2 ${lost ? 'border-error/50' : 'border-border'}`}>
        <div className="flex items-center justify-between gap-3">
          <div data-table-name="" className={`flex items-center gap-2 min-w-0 ${removed ? 'opacity-60' : ''}`}>
            {!removed && <Check size={14} className="shrink-0 text-success-fg" aria-hidden="true" />}
            <span className={`font-mono text-[12px] text-text-primary truncate ${removed ? 'line-through' : ''}`}>{chosen}</span>
            {isPrimary && <span className="text-[9px] uppercase tracking-[0.18em] text-text-tertiary">Primary</span>}
            {chosen !== original && !removed && <span className="text-[10px] text-text-tertiary">instead of {original}</span>}
            {lost && <span className="text-[9px] uppercase tracking-[0.18em] text-error-fg">{lost}</span>}
          </div>
          {readOnly ? null : removed ? (
            <button type="button" disabled={locked} className="text-[11px] text-db-red-fg shrink-0 disabled:opacity-50" onClick={() => onRestore(original)}>
              Use it again
            </button>
          ) : (
            <button type="button" disabled={locked} className="text-[11px] text-db-red-fg shrink-0 disabled:opacity-50" onClick={() => onToggle(original)}>
              Change
            </button>
          )}
        </div>
        {!readOnly && !removed && changing[original] && (
          <>
            <select aria-label={`Table to use for ${original}`} disabled={locked} className={selectClass} value={chosen} onChange={(e) => onPick(original, e.target.value)}>
              <option value={original}>{original} (Inspire's pick)</option>
              {chosen !== original && !(options || []).some((s) => s.table === chosen) && <option value={chosen}>{chosen}</option>}
              {options === undefined && <option disabled value="">Finding similar tables…</option>}
              {options && options.length === 0 && !why && <option disabled value="">No similar table found</option>}
              {(options || []).filter((s) => s.table !== original).map((s) => (
                <option key={s.table} value={s.table}>{s.table} ({s.matched} of {s.total} columns match)</option>
              ))}
              <option value={REMOVE_TABLE} disabled={Boolean(blocker)}>{blocker ? `Don't use this table (${blocker})` : "Don't use this table"}</option>
            </select>
            {why && <p data-swaps-why="" className="text-[11px] text-text-secondary">{why}</p>}
          </>
        )}
      </div>
    );
  });
}
