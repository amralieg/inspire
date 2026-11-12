import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { joinWords } from '../lib/implementWizard';
import {
  SCOPE_OPS, filterValuesOf, filteredTablesOf, normalizeTableScope, pickedTableNames, scopeKeyOf, scopeOpOf, scopeProblems,
  tableBrowseQuery, tableScopeOf,
} from '../lib/tableScope';

const VALUE_CHIPS = 40;
const COUNT_DEBOUNCE_MS = 350;
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
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

const shortName = (table) => table.split('.').pop();

// One table in the Data Filters section: its columns on the left, its row filters on the right.
// A table with no entry is read whole, so the column boxes show every column until the person changes one.
function TableFilterCard({ table, entry, onEntry, apiFetch, warehouseId, onReport }) {
  const [columns, setColumns] = useState(null);
  const [keys, setKeys] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [topValues, setTopValues] = useState({});
  const [counted, setCounted] = useState({ key: '', rows: null, error: '' });
  const requested = useRef(new Set());

  const q = `warehouse_id=${encodeURIComponent(warehouseId || '')}&table=${encodeURIComponent(table)}`;
  const names = useMemo(() => (columns || []).map((c) => c.column_name), [columns]);
  const scope = useMemo(() => normalizeTableScope(entry), [entry]);
  const shownColumns = entry ? scope.columns : names;
  const rows = scope.rows;
  const countFilters = useMemo(() => rows.filter(filterIsComplete), [rows]);
  const countKey = JSON.stringify(countFilters);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/inspire/implement/columns?${q}`)
      .then((data) => {
        if (cancelled) return;
        setColumns(data.columns || []);
        setKeys(data.primary_keys || []);
      })
      .catch((e) => { if (!cancelled) setLoadError(e.message || 'The columns of this table could not be read.'); });
    return () => { cancelled = true; };
  }, [apiFetch, q]);

  useEffect(() => {
    if (!columns || !countFilters.length) return undefined;
    const timer = setTimeout(() => {
      apiFetch(`/api/inspire/implement/readiness?${q}`, {
        method: 'POST',
        body: JSON.stringify({ table, columns: [], filters: countFilters, window: {} }),
      })
        .then((data) => setCounted({ key: countKey, rows: Number(data.row_count) || 0, error: '' }))
        .catch((e) => setCounted({ key: countKey, rows: null, error: e.message || 'The rows could not be counted.' }));
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [countKey, countFilters, columns, apiFetch, q, table]);

  const count = !countFilters.length ? { state: 'none' }
    : counted.key !== countKey ? { state: 'counting' }
      : counted.error ? { state: 'failed', error: counted.error } : { state: 'done', rows: counted.rows };

  const loadValues = useCallback((column) => {
    if (!column || requested.current.has(column)) return;
    requested.current.add(column);
    apiFetch(`/api/inspire/implement/values?${q}&column=${encodeURIComponent(column)}&limit=${VALUE_CHIPS}`)
      .then((data) => setTopValues((prev) => ({ ...prev, [column]: data.values || [] })))
      .catch(() => setTopValues((prev) => ({ ...prev, [column]: [] })));
  }, [apiFetch, q]);

  // Every change goes through here: an entry that reads every column with no row filter is removed, so "no entry" means read whole.
  const write = (nextColumns, nextRows) => {
    const everyColumn = names.length > 0 && names.every((n) => nextColumns.includes(n));
    if (!nextRows.length && everyColumn) return onEntry(table, null);
    return onEntry(table, { columns: names.length ? names.filter((n) => nextColumns.includes(n)) : nextColumns, rows: nextRows });
  };
  const toggleColumn = (name) => write(shownColumns.includes(name) ? shownColumns.filter((n) => n !== name) : [...shownColumns, name], rows);
  const addRow = () => write(shownColumns, [...rows, { column: names[0] || '', op: '=', values: [] }]);
  const patchRow = (index, patch) => write(shownColumns, rows.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const deleteRow = (index) => write(shownColumns, rows.filter((_, i) => i !== index));
  const addValue = (index, value) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    const max = maxValues(rows[index].op);
    if (rows[index].values.includes(text)) return;
    patchRow(index, { values: max === 1 ? [text] : [...rows[index].values, text].slice(0, max) });
  };
  const removeValue = (index, value) => patchRow(index, { values: rows[index].values.filter((v) => v !== value) });

  const problems = useMemo(() => {
    if (!entry || !columns) return [];
    const list = scopeProblems(entry, names).map((p) => `${shortName(table)}: ${p}`);
    if (count.state === 'done' && count.rows === 0) list.push(`${shortName(table)}: its row filters keep 0 rows, so Inspire will not run them. Change a filter.`);
    return list;
  }, [entry, columns, names, count.state, count.rows, table]);
  const problemKey = problems.join('\n');
  useEffect(() => { onReport(table, problems); }, [table, problemKey, onReport]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onReport(table, []), [table, onReport]);

  return (
    <div data-scope-table={table} className="rounded-xl border border-border bg-bg-subtle/40 p-3 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-text-primary">{table}</span>
        <span data-scope-summary={table} className="ms-auto text-text-secondary">
          {!entry ? 'All columns, all rows'
            : count.state === 'counting' ? 'Counting the rows this table keeps'
              : count.state === 'done' ? `${count.rows.toLocaleString()} rows match`
                : count.state === 'failed' ? `The rows could not be counted: ${count.error}`
                  : `${shownColumns.length} of ${names.length || '…'} columns`}
        </span>
      </div>
      {loadError && <PlainMessage role="alert" className="text-error-fg" text={loadError} />}
      {problems.length > 0 && (
        <ul role="alert" className="list-disc ps-4 text-error-fg">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {!columns && !loadError && <p className="text-text-tertiary">Reading the columns of {table}</p>}
      {columns && (
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label={`Column filters for ${table}`} className="space-y-2">
            <h3 className="font-semibold text-text-primary">Column filters</h3>
            <p className="text-text-tertiary">Inspire reads only the columns you tick.</p>
            {keys.length > 0 && keys.some((k) => !shownColumns.includes(k)) && (
              <p data-key-note="removed" className="text-warning-fg">
                Key columns {keys.filter((k) => !shownColumns.includes(k)).join(', ')} are not ticked. Inspire then identifies each row by its own row key.
              </p>
            )}
            <ul aria-label={`Columns of ${table}`} className="grid gap-1 max-h-56 overflow-y-auto">
              {names.map((name) => (
                <li key={name}>
                  <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
                    <input type="checkbox" data-scope-column={name} checked={shownColumns.includes(name)} onChange={() => toggleColumn(name)} />
                    <span className="font-mono text-text-primary">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label={`Row filters for ${table}`} className="space-y-2">
            <h3 className="font-semibold text-text-primary">Row filters</h3>
            <p className="text-text-tertiary">Keep only the rows that match every filter.</p>
            {rows.length === 0 && <p className="text-text-secondary">No row filter: every row is read.</p>}
            {rows.map((f, index) => (
              <FilterRow key={index} index={index} filter={f} names={names} values={topValues[f.column] || []}
                onColumn={loadValues} onPatch={patchRow} onAdd={addValue} onRemove={removeValue} onDelete={deleteRow} />
            ))}
            <button type="button" className={BUTTON} disabled={!names.length} onClick={addRow}>Add a row filter</button>
          </section>
        </div>
      )}
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
    <fieldset data-scope-filter={n} className="rounded-lg border border-border bg-surface p-2 space-y-2">
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

// The label block: prefilled from the row filters until the person types, then kept as typed.
function UseCaseLabel({ scopes, tables, label, onLabel }) {
  const filtered = filteredTablesOf(scopes, tables);
  const prefill = joinWords(filterValuesOf(scopes, tables));
  const shown = label.text == null ? prefill : label.text;
  return (
    <div data-use-case-label className="rounded-xl border border-border p-3 space-y-2">
      <label className="flex items-center gap-2 font-semibold text-text-primary">
        <input type="checkbox" data-use-case-label-on checked={label.on} onChange={(e) => onLabel({ ...label, on: e.target.checked })} />
        Use case labeling enhanced using filters
      </label>
      <input dir="auto" type="text" aria-label="Use case label" data-use-case-label-text value={shown} disabled={!label.on}
        placeholder={label.on ? 'Add a row filter, then the label fills in here' : 'Tick the box above to use a label'}
        onChange={(e) => onLabel({ ...label, text: e.target.value })}
        className={`${FIELD} h-9 w-full disabled:opacity-50`} />
      {label.text != null && label.on && (
        <button type="button" className={BUTTON} onClick={() => onLabel({ ...label, text: null })}>Use the filter values</button>
      )}
      <p className="text-text-tertiary">
        Inspire puts this label in the name of every use case that reads a filtered table, for example
        &quot;Improve Contoso customer experience using segmentation&quot;.
        {label.on && !filtered.length && ' Add a row filter to a table first: the label has nothing to name yet.'}
      </p>
    </div>
  );
}

// A picked schema, collapsed. Its tables are listed the first time it is opened, through the same table-list call the
// picker uses, and each table gets the same filter card as a table picked one by one.
function SchemaGroup({ catalog, schema, skip, apiFetch, warehouseId, renderTable }) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(null);
  const name = `${catalog}.${schema}`;
  useEffect(() => {
    if (!open || listed) return undefined;
    let cancelled = false;
    apiFetch(`/api/tables/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}${tableBrowseQuery(warehouseId)}`)
      .then((d) => { if (!cancelled) setListed({ tables: (d.tables || []).map((t) => t.full_name || `${name}.${t.name}`) }); })
      .catch((e) => { if (!cancelled) setListed({ error: e.message || `Inspire could not list the tables of ${name}.` }); });
    return () => { cancelled = true; };
  }, [open, listed, apiFetch, warehouseId, catalog, schema, name]);
  const shown = listed?.tables ? listed.tables.filter((t) => !skip.has(scopeKeyOf(t))) : [];
  return (
    <div data-schema-group={name} className="rounded-xl border border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-bg-subtle/50">
        <span className="font-mono text-text-primary">{name}</span>
        <span className="ms-auto text-text-tertiary">
          {listed?.tables ? `${listed.tables.length} table${listed.tables.length === 1 ? '' : 's'}` : open ? 'Listing its tables' : 'Open to list its tables'}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {listed?.error && <PlainMessage role="alert" className="text-error-fg" text={listed.error} />}
          {open && !listed && <p className="text-text-tertiary">Listing the tables of {name}</p>}
          {listed?.tables && listed.tables.length === 0 && <p className="text-text-secondary">{name} has no tables.</p>}
          {shown.map(renderTable)}
        </div>
      )}
    </div>
  );
}

// A picked catalog, collapsed. Opening it lists its schemas; each schema opens the same way as a picked schema.
function CatalogGroup({ catalog, pickedSchemas, apiFetch, warehouseId, renderSchema }) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(null);
  useEffect(() => {
    if (!open || listed) return undefined;
    let cancelled = false;
    apiFetch(`/api/catalogs/${encodeURIComponent(catalog)}/schemas${tableBrowseQuery(warehouseId)}`)
      .then((d) => { if (!cancelled) setListed({ schemas: (d.schemas || []).map((s) => s.name) }); })
      .catch((e) => { if (!cancelled) setListed({ error: e.message || `Inspire could not list the schemas of ${catalog}.` }); });
    return () => { cancelled = true; };
  }, [open, listed, apiFetch, warehouseId, catalog]);
  const picked = new Set(pickedSchemas.map(scopeKeyOf));
  return (
    <div data-catalog-group={catalog} className="rounded-xl border border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-bg-subtle/50">
        <span className="font-mono text-text-primary">{catalog}</span>
        <span className="ms-auto text-text-tertiary">{listed?.schemas ? `${listed.schemas.length} schemas` : open ? 'Listing its schemas' : 'Open to list its schemas'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {listed?.error && <PlainMessage role="alert" className="text-error-fg" text={listed.error} />}
          {open && !listed && <p className="text-text-tertiary">Listing the schemas of {catalog}</p>}
          {listed?.schemas && listed.schemas.filter((s) => !picked.has(scopeKeyOf(`${catalog}.${s}`)))
            .map((schema) => renderSchema(catalog, schema))}
        </div>
      )}
    </div>
  );
}

// Advanced Settings > Data Filters. The one place filters are set: tables picked one by one, then each picked schema
// and catalog as a collapsed group that lists its tables when opened. Every filter lands in the same catalog.schema.table key.
export default function DataFilters({ picks, scopes, onScopes, label, onLabel, apiFetch, warehouseId, onProblems }) {
  const [reports, setReports] = useState({});
  const onReport = useCallback((table, list) => {
    setReports((prev) => (prev[table] && prev[table].join('\n') === list.join('\n') ? prev : { ...prev, [table]: list }));
  }, []);

  const direct = picks.tables || [];
  const shownKeys = useMemo(() => new Set(direct.map(scopeKeyOf)), [direct]);
  const labelTables = pickedTableNames(scopes, picks);
  const problems = Object.values(reports).flat();
  const labelProblem = label.on && filteredTablesOf(scopes, labelTables).length && !(label.text ?? joinWords(filterValuesOf(scopes, labelTables))).trim()
    ? ['Use case labeling is ticked but the label is empty: type the label or untick the box.'] : [];
  const allProblems = [...problems, ...labelProblem];
  const allKey = allProblems.join('\n');
  useEffect(() => { if (onProblems) onProblems(allProblems); }, [allKey, onProblems]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEntry = (table, entry) => {
    const next = Object.fromEntries(Object.entries(scopes || {}).filter(([name]) => scopeKeyOf(name) !== scopeKeyOf(table)));
    if (entry) next[table] = entry;
    onScopes(next);
  };
  const renderTable = (table) => (
    <TableFilterCard key={table} table={table} entry={tableScopeOf(scopes, table)} onEntry={setEntry}
      apiFetch={apiFetch} warehouseId={warehouseId} onReport={onReport} />
  );
  const renderSchema = (catalog, schema) => (
    <SchemaGroup key={`${catalog}.${schema}`} catalog={catalog} schema={schema} skip={shownKeys}
      apiFetch={apiFetch} warehouseId={warehouseId} renderTable={renderTable} />
  );
  const nothingPicked = !direct.length && !picks.schemas.length && !picks.catalogs.length;

  return (
    <div data-data-filters className="space-y-4 text-xs">
      <p className="text-text-secondary">
        A table with no filters is read whole: every column, every row. Filters apply to the tables you picked, and to the tables
        inside the schemas and catalogs you picked: open a schema to list and filter its tables.
      </p>
      {nothingPicked && <p data-data-filters-empty className="text-text-tertiary">Pick tables, schemas or catalogs under Unity Catalog Metadata to filter them.</p>}
      {direct.map(renderTable)}
      {picks.schemas.map((s) => {
        const [catalog, schema] = s.split('.');
        return renderSchema(catalog, schema);
      })}
      {picks.catalogs.map((catalog) => (
        <CatalogGroup key={catalog} catalog={catalog} pickedSchemas={picks.schemas} apiFetch={apiFetch} warehouseId={warehouseId}
          renderSchema={renderSchema} />
      ))}
      {labelTables.length > 0 && <UseCaseLabel scopes={scopes} tables={labelTables} label={label} onLabel={onLabel} />}
    </div>
  );
}
