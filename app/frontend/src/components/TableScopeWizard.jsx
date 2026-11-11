import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import DrawerShell from './DrawerShell';
import { PlainMessage } from './TechnicalDetails';
import { SCOPE_OPS, normalizeTableScope, scopeOpOf, scopeProblems } from '../lib/tableScope';

const VALUE_CHIPS = 40;
const COUNT_DEBOUNCE_MS = 350;
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const PRIMARY = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold bg-db-red-solid hover:bg-db-red-solid-hover text-white disabled:opacity-50';
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';

const maxValues = (op) => {
  const def = scopeOpOf(op);
  if (!def) return 0;
  return def.values === 'many' ? Infinity : def.values;
};

function filterIsComplete(f) {
  const def = scopeOpOf(f.op);
  if (!def || !f.column) return false;
  if (def.values === 'many') return f.values.length > 0;
  return f.values.length === def.values;
}

export default function TableScopeWizard({ table, entry = null, apiFetch, warehouseId, onSave, onClose }) {
  const [columns, setColumns] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState(() => normalizeTableScope(entry).columns);
  const [filters, setFilters] = useState(() => normalizeTableScope(entry).rows);
  const [topValues, setTopValues] = useState({});
  const [counted, setCounted] = useState({ key: '', rows: null, error: '' });
  const requested = useRef(new Set());

  const q = `warehouse_id=${encodeURIComponent(warehouseId || '')}&table=${encodeURIComponent(table)}`;
  const names = useMemo(() => (columns || []).map((c) => c.column_name), [columns]);
  const scope = useMemo(() => ({ columns: picked, rows: filters }), [picked, filters]);
  const problems = useMemo(() => (columns ? scopeProblems(scope, names) : []), [columns, scope, names]);

  const countFilters = useMemo(() => filters.filter(filterIsComplete), [filters]);
  const countKey = JSON.stringify(countFilters);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/inspire/implement/columns?${q}`)
      .then((data) => { if (!cancelled) setColumns(data.columns || []); })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'The columns of this table could not be read.'); });
    return () => { cancelled = true; };
  }, [apiFetch, q]);

  useEffect(() => {
    if (!columns || step !== 2) return undefined;
    const timer = setTimeout(() => {
      apiFetch(`/api/inspire/implement/readiness?${q}`, {
        method: 'POST',
        body: JSON.stringify({ table, columns: [], filters: countFilters, window: {} }),
      })
        .then((data) => setCounted({ key: countKey, rows: Number(data.row_count) || 0, error: '' }))
        .catch((e) => setCounted({ key: countKey, rows: null, error: e.message || 'The rows could not be counted.' }));
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [countKey, countFilters, step, columns, apiFetch, q, table]);

  const count = counted.key !== countKey ? { state: 'counting', rows: null, error: '' }
    : counted.error ? { state: 'failed', rows: null, error: counted.error } : { state: 'done', rows: counted.rows, error: '' };

  const loadValues = useCallback((column) => {
    if (!column || requested.current.has(column)) return;
    requested.current.add(column);
    apiFetch(`/api/inspire/implement/values?${q}&column=${encodeURIComponent(column)}&limit=${VALUE_CHIPS}`)
      .then((data) => setTopValues((prev) => ({ ...prev, [column]: data.values || [] })))
      .catch(() => setTopValues((prev) => ({ ...prev, [column]: [] })));
  }, [apiFetch, q]);

  const togglePicked = (name) => setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  const patchFilter = (index, patch) => setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const addValue = (index, value) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    setFilters((prev) => prev.map((f, i) => {
      if (i !== index || f.values.includes(text)) return f;
      const max = maxValues(f.op);
      return { ...f, values: max === 1 ? [text] : [...f.values, text].slice(0, max) };
    }));
  };
  const removeValue = (index, value) => patchFilter(index, { values: filters[index].values.filter((v) => v !== value) });

  const canSave = step === 2 && problems.length === 0 && count.state === 'done' && count.rows > 0;
  const save = () => {
    if (canSave) onSave(normalizeTableScope(scope));
  };

  const footer = (
    <div className="flex flex-col gap-2 w-full">
      <p aria-live="polite" data-scope-count className="text-xs text-text-secondary">
        {step === 1 && `${picked.length} of ${names.length} columns picked.`}
        {step === 2 && count.state === 'counting' && 'Counting the rows this scope reads.'}
        {step === 2 && count.state === 'done' && count.rows > 0 && `${count.rows.toLocaleString()} rows match this scope.`}
        {step === 2 && count.state === 'done' && count.rows === 0 && 'This scope has 0 rows, so Inspire will not save it. Change a filter.'}
      </p>
      {step === 2 && count.state === 'failed' && <PlainMessage role="alert" className="text-error-fg" text={`The rows could not be counted: ${count.error}`} />}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={BUTTON} onClick={onClose}>Cancel</button>
        <div className="flex gap-2">
          {step === 2 && <button type="button" className={BUTTON} onClick={() => setStep(1)}>Back</button>}
          {step === 1 && <button type="button" className={PRIMARY} disabled={!picked.length} onClick={() => setStep(2)}>Next: row filters</button>}
          {step === 2 && <button type="button" className={PRIMARY} disabled={!canSave} onClick={save}>Save scope</button>}
        </div>
      </div>
    </div>
  );

  return (
    <DrawerShell label={`Filter ${table}`} closeLabel="Close table filter" onClose={onClose} center footer={footer}
      title={`Filter ${table.split('.').pop()}`} focusKey={step}>
      <div data-table-scope-wizard={step} className="space-y-3 text-xs">
        <p className="text-text-secondary">
          {step === 1
            ? 'Step 1 of 2. Which columns should Inspire read? Inspire reads only these columns from this table.'
            : 'Step 2 of 2. Which rows should Inspire use? A row must match every filter.'}
        </p>
        {loadError && <PlainMessage role="alert" className="text-error-fg" text={loadError} />}
        {!columns && !loadError && <p className="text-text-tertiary">Reading the columns of {table}</p>}
        {columns && step === 1 && (
          <Step1 names={names} columns={columns} picked={picked} onToggle={togglePicked}
            onAll={() => setPicked(names)} onNone={() => setPicked([])} />
        )}
        {columns && step === 2 && (
          <Step2 names={names} filters={filters} topValues={topValues} onColumn={loadValues}
            onPatch={patchFilter} onAdd={addValue} onRemove={removeValue}
            onNew={() => setFilters((prev) => [...prev, { column: names[0] || '', op: '=', values: [] }])}
            onDelete={(index) => setFilters((prev) => prev.filter((_, i) => i !== index))} />
        )}
        {problems.length > 0 && step === 2 && (
          <ul role="alert" className="list-disc ps-4 text-error-fg">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </div>
    </DrawerShell>
  );
}

function Step1({ names, columns, picked, onToggle, onAll, onNone }) {
  const typeOf = (name) => (columns.find((c) => c.column_name === name) || {}).data_type || '';
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" className={BUTTON} onClick={onAll}>Select all</button>
        <button type="button" className={BUTTON} onClick={onNone}>Clear</button>
      </div>
      <ul aria-label="Columns of this table" className="grid gap-1 sm:grid-cols-2 max-h-64 overflow-y-auto">
        {names.map((name) => (
          <li key={name}>
            <label className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-2 py-1.5">
              <input type="checkbox" data-scope-column={name} checked={picked.includes(name)} onChange={() => onToggle(name)} />
              <span className="font-mono text-text-primary">{name}</span>
              <span className="ms-auto text-text-tertiary">{typeOf(name)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step2({ names, filters, topValues, onColumn, onPatch, onAdd, onRemove, onNew, onDelete }) {
  return (
    <div className="space-y-3">
      {filters.length === 0 && <p className="text-text-secondary">No row filter: every row of the table is used.</p>}
      {filters.map((f, index) => (
        <FilterRow key={index} index={index} filter={f} names={names} values={topValues[f.column] || []}
          onColumn={onColumn} onPatch={onPatch} onAdd={onAdd} onRemove={onRemove} onDelete={onDelete} />
      ))}
      <button type="button" className={BUTTON} onClick={onNew}>Add a row filter</button>
    </div>
  );
}

function FilterRow({ index, filter, names, values, onColumn, onPatch, onAdd, onRemove, onDelete }) {
  const n = index + 1;
  const def = scopeOpOf(filter.op);
  const max = maxValues(filter.op);
  const [typed, setTyped] = useState('');
  useEffect(() => { onColumn(filter.column); }, [filter.column, onColumn]);
  return (
    <fieldset data-scope-filter={n} className="rounded-lg border border-border p-2 space-y-2">
      <legend className="px-1 text-text-secondary">Filter {n}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Filter ${n} column`} className={FIELD} value={filter.column} onChange={(e) => onPatch(index, { column: e.target.value, values: [] })}>
          <option value="">Pick a column</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label={`Filter ${n} operator`} className={FIELD} value={filter.op} onChange={(e) => onPatch(index, { op: e.target.value, values: [] })}>
          {SCOPE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
        <button type="button" className={BUTTON} onClick={() => onDelete(index)}>Remove</button>
      </div>
      {def && def.values !== 0 && filter.column && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" data-scope-values={n}>
            {filter.values.map((v) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg">
                {v}
                <button type="button" aria-label={`Remove value ${v}`} onClick={() => onRemove(index, v)}><X size={10} /></button>
              </span>
            ))}
          </div>
          {filter.values.length < max && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onAdd(index, typed); setTyped(''); }}>
              <input dir="auto" aria-label={`Filter ${n} value`} className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a value" />
              <button type="submit" className={BUTTON} disabled={!typed.trim()}>Add value</button>
            </form>
          )}
          {values.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label={`Values in ${filter.column}`}>
              {values.map((v) => (
                <button key={v} type="button" data-scope-value={v} onClick={() => onAdd(index, v)}
                  className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-text-secondary hover:text-text-primary">
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
