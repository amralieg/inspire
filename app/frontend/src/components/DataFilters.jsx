import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Table2, X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { groupLabelOf } from '../lib/implementWizard';
import {
  SCOPE_OPS, columnKindOf, filterValuesOf, filteredTablesOf, isGroupRow, normalizeTableScope, pickedTableNames, scopeKeyOf,
  scopeOpOf, scopeProblems, tableBrowseQuery, tableScopeOf,
} from '../lib/tableScope';

const VALUE_CHIPS = 40;
const COUNT_DEBOUNCE_MS = 350;
const ALL_READ = 'All columns, all rows';
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';
const ITEM = 'flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer hover:bg-bg-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red-fg/60';

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
const SPLIT_MIN = 20;
const SPLIT_MAX = 80;
const SPLIT_DEFAULT = 50;
const SPLIT_KEY = 'inspire.dataFilters.split';
const GROUP_TOP = 500;
const ANSWER_MS = 20000;
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspire did not get an answer in time.')), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});
const GROUP_SEARCH_MIN = 20;
const clampSplit = (value) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
const readSplit = () => {
  const saved = Number(window.sessionStorage.getItem(SPLIT_KEY));
  return Number.isFinite(saved) && saved >= SPLIT_MIN && saved <= SPLIT_MAX ? saved : SPLIT_DEFAULT;
};
const writeSplit = (value) => window.sessionStorage.setItem(SPLIT_KEY, String(value));
const byName = (a, b) => a.name.localeCompare(b.name);
const browseQuery = (warehouseId, table) => `warehouse_id=${encodeURIComponent(warehouseId || '')}&table=${encodeURIComponent(table)}`;
const columnsKey = (warehouseId, table) => `cols:${warehouseId || ''}:${table}`;
const valueKey = (warehouseId, table, column) => `val:${warehouseId || ''}:${table}\u0000${column}`;

function conditionText(f) {
  const def = scopeOpOf(f.op);
  const label = def ? def.label : f.op;
  if (!def || def.values === 0) return label;
  return `${label} ${f.values.join(def.op === 'in' ? ', ' : ' and ')}`;
}

function buildTree(picks, tables) {
  const catalogs = new Map();
  const catalogOf = (name) => {
    const key = scopeKeyOf(name);
    if (!catalogs.has(key)) catalogs.set(key, { name, picked: false, schemas: new Map() });
    return catalogs.get(key);
  };
  const schemaOf = (catalog, schema) => {
    const cat = catalogOf(catalog);
    const key = scopeKeyOf(schema);
    if (!cat.schemas.has(key)) cat.schemas.set(key, { name: schema, picked: false, tables: new Map() });
    return cat.schemas.get(key);
  };
  picks.catalogs.forEach((c) => { catalogOf(c).picked = true; });
  picks.schemas.forEach((s) => { const [c, sc] = s.split('.'); schemaOf(c, sc).picked = true; });
  tables.forEach((t) => { const [c, sc] = t.split('.'); schemaOf(c, sc).tables.set(scopeKeyOf(t), t); });
  return [...catalogs.values()].map((c) => ({
    name: c.name,
    picked: c.picked,
    schemas: [...c.schemas.values()].map((s) => ({ name: s.name, picked: s.picked, tables: [...s.tables.values()] })).sort(byName),
  })).sort(byName);
}

function treeKey(e, { hasChildren, open, setOpen, activate }) {
  const item = e.currentTarget;
  const all = () => Array.from(item.closest('[role="tree"]').querySelectorAll('[role="treeitem"]'));
  const at = () => all().indexOf(item);
  if (e.key === 'ArrowDown') all()[at() + 1]?.focus();
  else if (e.key === 'ArrowUp') all()[at() - 1]?.focus();
  else if (e.key === 'Home') all()[0]?.focus();
  else if (e.key === 'End') all().at(-1)?.focus();
  else if (e.key === 'ArrowRight') { if (hasChildren && !open) setOpen(true); else if (hasChildren) all()[at() + 1]?.focus(); }
  else if (e.key === 'ArrowLeft') {
    if (hasChildren && open) setOpen(false);
    else item.closest('[role="group"]')?.parentElement?.querySelector(':scope > [role="treeitem"]')?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') activate();
  else return;
  e.preventDefault();
}

function Branch({ level, label, dataKey, name, open, setOpen, count, error, children }) {
  return (
    <li role="none" className="space-y-1" {...{ [dataKey]: name }}>
      <div role="treeitem" aria-level={level} aria-expanded={open} tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => treeKey(e, { hasChildren: true, open, setOpen, activate: () => setOpen(!open) })}
        className={`${ITEM} text-xs`}>
        {open ? <ChevronDown size={12} className="shrink-0 text-text-tertiary" /> : <ChevronRight size={12} className="shrink-0 text-text-tertiary" />}
        <span className="font-mono text-text-primary">{label}</span>
        <span className="ms-auto text-text-tertiary">{count}</span>
      </div>
      {open && (
        <ul role="group" className="ps-4 space-y-1">
          {error && <li role="none"><PlainMessage role="alert" className="text-error-fg" text={error} /></li>}
          {children}
        </ul>
      )}
    </li>
  );
}

function TableLeaf({ level, table, summary, selected, onSelect }) {
  return (
    <li role="none">
      <div role="treeitem" aria-level={level} aria-selected={selected} tabIndex={0} data-scope-table={table}
        onClick={onSelect}
        onKeyDown={(e) => treeKey(e, { hasChildren: false, open: false, setOpen: () => {}, activate: onSelect })}
        className={`${ITEM} flex-wrap text-xs ${selected ? 'bg-surface ring-1 ring-db-red-fg/60' : ''}`}>
        <Table2 size={12} className="shrink-0 text-text-tertiary" />
        <span className="font-mono text-text-primary">{shortName(table)}</span>
        <span data-scope-summary={table} className="ms-auto text-text-secondary">{summary}</span>
      </div>
    </li>
  );
}

function SchemaNode({ catalog, schema, listable, tableNames, apiFetch, warehouseId, renderTable }) {
  const [manual, setOpen] = useState(null);
  const open = manual ?? tableNames.length > 0;
  const [listed, setListed] = useState(null);
  const name = `${catalog}.${schema}`;
  useEffect(() => {
    if (!open || !listable || listed) return undefined;
    let cancelled = false;
    apiFetch(`/api/tables/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}${tableBrowseQuery(warehouseId)}`)
      .then((d) => { if (!cancelled) setListed({ tables: (d.tables || []).map((t) => t.full_name || `${name}.${t.name}`) }); })
      .catch((e) => { if (!cancelled) setListed({ error: e.message || `Inspire could not list the tables of ${name}.` }); });
    return () => { cancelled = true; };
  }, [open, listable, listed, apiFetch, warehouseId, catalog, schema, name]);
  const seen = new Set();
  const names = [...(listed?.tables || []), ...tableNames].filter((t) => (seen.has(scopeKeyOf(t)) ? false : seen.add(scopeKeyOf(t))));
  names.sort();
  const count = listed?.tables ? `${listed.tables.length} table${listed.tables.length === 1 ? '' : 's'}`
    : tableNames.length ? `${tableNames.length} picked` : '';
  return (
    <Branch level={2} label={schema} dataKey="data-schema-group" name={name} open={open} setOpen={setOpen} count={count}
      error={open ? listed?.error : ''}>
      {open && listable && !listed && <li role="none" className="px-2 text-text-tertiary">Listing the tables of {name}</li>}
      {open && listed?.tables && listed.tables.length === 0 && <li role="none" className="px-2 text-text-secondary">{name} has no tables.</li>}
      {names.map(renderTable)}
    </Branch>
  );
}

function CatalogNode({ catalog, picked, schemas, apiFetch, warehouseId, renderSchema }) {
  const [manual, setOpen] = useState(null);
  const open = manual ?? schemas.length > 0;
  const [listed, setListed] = useState(null);
  useEffect(() => {
    if (!open || !picked || listed) return undefined;
    let cancelled = false;
    apiFetch(`/api/catalogs/${encodeURIComponent(catalog)}/schemas${tableBrowseQuery(warehouseId)}`)
      .then((d) => { if (!cancelled) setListed({ schemas: (d.schemas || []).map((s) => s.name) }); })
      .catch((e) => { if (!cancelled) setListed({ error: e.message || `Inspire could not list the schemas of ${catalog}.` }); });
    return () => { cancelled = true; };
  }, [open, picked, listed, apiFetch, warehouseId, catalog]);
  const merged = new Map();
  (listed?.schemas || []).forEach((name) => merged.set(scopeKeyOf(name), { name, picked: false, tables: [] }));
  schemas.forEach((s) => merged.set(scopeKeyOf(s.name), s));
  const children = [...merged.values()].sort(byName);
  const count = listed?.schemas ? `${listed.schemas.length} schema${listed.schemas.length === 1 ? '' : 's'}`
    : schemas.length ? `${schemas.length} picked` : '';
  return (
    <Branch level={1} label={catalog} dataKey="data-catalog-group" name={catalog} open={open} setOpen={setOpen} count={count}
      error={open ? listed?.error : ''}>
      {open && picked && !listed && <li role="none" className="px-2 text-text-tertiary">Listing the schemas of {catalog}</li>}
      {children.map((s) => renderSchema(catalog, s, picked))}
    </Branch>
  );
}

function AddRowFilter({ table, column, suggestions, loadValues, onCommit }) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState('=');
  const [draft, setDraft] = useState([]);
  const [typed, setTyped] = useState('');
  const def = scopeOpOf(op);
  const max = maxValues(op);
  const needsValues = def.values !== 0;
  const complete = def.values === 'many' ? draft.length > 0 : draft.length === def.values;
  useEffect(() => { if (open) loadValues(table, column); }, [open, table, column, loadValues]);
  const reset = () => { setOpen(false); setOp('='); setDraft([]); setTyped(''); };
  const addValue = (value) => {
    const text = String(value ?? '').trim();
    if (!text || draft.includes(text)) return;
    setDraft(max === 1 ? [text] : [...draft, text].slice(0, max));
  };
  if (!open) {
    return <button type="button" aria-label={`Add row filter on ${column}`} className={`${BUTTON} whitespace-nowrap`} onClick={() => setOpen(true)}>Add row filter</button>;
  }
  return (
    <fieldset aria-label={`New row filter on ${column}`} className="rounded-lg border border-border bg-surface p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Operator for ${column}`} className={FIELD} value={op} onChange={(e) => { setOp(e.target.value); setDraft([]); }}>
          {SCOPE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
        {needsValues && draft.length < max && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addValue(typed); setTyped(''); }}>
            <input dir="auto" aria-label={`Value for ${column}`} className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a value" />
            <button type="submit" className={BUTTON} disabled={!typed.trim()}>Add value</button>
          </form>
        )}
      </div>
      {needsValues && draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg">
              {v}
              <button type="button" aria-label={`Remove value ${v}`} onClick={() => setDraft(draft.filter((x) => x !== v))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {needsValues && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={`Values in ${column}`}>
          {suggestions.map((v) => (
            <button key={v} type="button" data-scope-value={v} onClick={() => addValue(v)}
              className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-text-secondary hover:text-text-primary">
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={BUTTON} disabled={!complete}
          onClick={() => { onCommit({ column, op, values: draft }); reset(); }}>Add filter</button>
        <button type="button" className={BUTTON} onClick={reset}>Cancel</button>
      </div>
    </fieldset>
  );
}

function RowGroups({ column, ticked, picked, loaded, onLoad, onPick }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(true);
  if (!ticked) return <p className="text-text-tertiary">Tick {column} to pick its groups.</p>;
  const values = loaded?.status === 'done' ? loaded.values : [];
  const shown = values.filter((g) => !search || g.value.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = new Set(picked);
  const listing = loaded?.status === 'done' && values.length > 0 && (editing || picked.length === 0);
  return (
    <div className="space-y-2" data-row-groups={column}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} aria-label={`Load groups for ${column}`} disabled={loaded?.status === 'loading'}
          onClick={() => { setEditing(true); onLoad(); }}>
          {loaded ? 'Reload groups' : 'Load groups'}
        </button>
        {loaded?.status === 'loading' && <span className="text-text-tertiary">Loading the groups of {column}</span>}
        {loaded?.status === 'done' && (
          <span className="text-text-tertiary">
            {values.length.toLocaleString()} value{values.length === 1 ? '' : 's'}{loaded.truncated ? `, the top ${GROUP_TOP} by rows` : ''}
          </span>
        )}
        {loaded?.status === 'done' && values.length > 0 && picked.length > 0 && (
          <button type="button" className={BUTTON} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Change groups'}</button>
        )}
      </div>
      {loaded?.status === 'error' && <PlainMessage role="alert" className="text-error-fg" text={loaded.error} />}
      {listing && (
        <>
          {values.length > GROUP_SEARCH_MIN && (
            <input type="search" aria-label={`Search the groups of ${column}`} value={search} placeholder="Search groups" dir="auto"
              onChange={(e) => setSearch(e.target.value)} className={`${FIELD} w-full`} />
          )}
          <div className="flex gap-2">
            <button type="button" className={BUTTON} onClick={() => onPick(values.map((g) => g.value))}>Select all</button>
            <button type="button" className={BUTTON} onClick={() => onPick([])}>Clear</button>
          </div>
          <ul aria-label={`Groups of ${column}`} className="grid gap-1 max-h-56 overflow-y-auto">
            {shown.map((g) => (
              <li key={g.value}>
                <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
                  <input type="checkbox" data-group-value={g.value} checked={chosen.has(g.value)}
                    onChange={() => onPick(chosen.has(g.value) ? picked.filter((v) => v !== g.value) : [...picked, g.value])} />
                  <span dir="auto" className="text-text-primary">{g.value}</span>
                  <span className="ms-auto text-text-tertiary">{g.records.toLocaleString()}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {loaded?.status === 'done' && values.length === 0 && <p className="text-text-secondary">{column} has no values in the rows in scope.</p>}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((v) => (
            <span key={v} data-scope-group={column} className="inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg">
              <span dir="auto">{v}</span>
              <button type="button" aria-label={`Remove group ${v}`} onClick={() => onPick(picked.filter((x) => x !== v))}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnGrid({ table, entry, meta, problems, onEntry, valuesOf, loadValues, apiFetch, warehouseId }) {
  const [note, setNote] = useState('');
  const [groupsOf, setGroupsOf] = useState({});
  if (meta?.error) return <PlainMessage role="alert" className="text-error-fg" text={meta.error} />;
  if (!meta) return <p className="text-text-tertiary">Reading the columns of {table}</p>;
  const names = meta.columns.map((c) => c.column_name);
  const typeOf = new Map(meta.columns.map((c) => [c.column_name, c.data_type || '']));
  const scope = normalizeTableScope(entry);
  const shown = entry ? scope.columns : names;
  const rows = scope.rows;
  const write = (nextColumns, nextRows) => {
    const dropped = nextRows.filter((f) => !nextColumns.includes(f.column));
    const kept = nextRows.filter((f) => nextColumns.includes(f.column));
    setNote(dropped.length
      ? `Removed ${dropped.length} row filter${dropped.length === 1 ? '' : 's'} on ${[...new Set(dropped.map((f) => f.column))].join(', ')}: a column Inspire does not read cannot be filtered.`
      : '');
    const everyColumn = names.length > 0 && names.every((n) => nextColumns.includes(n));
    if (!kept.length && everyColumn) return onEntry(table, null);
    return onEntry(table, { columns: names.length ? names.filter((n) => nextColumns.includes(n)) : nextColumns, rows: kept });
  };
  const toggle = (name) => write(shown.includes(name) ? shown.filter((n) => n !== name) : [...shown, name], rows);
  const keyNotes = (meta.keys || []).filter((k) => !shown.includes(k));
  const groupOf = (name) => rows.find((f) => isGroupRow(f) && f.column === name)?.values || [];
  const pickGroups = (name, values) => {
    const others = rows.filter((f) => !(isGroupRow(f) && f.column === name));
    write(shown, values.length ? [...others, { column: name, op: 'in', values, group: true }] : others);
  };
  const loadGroups = (name) => {
    setGroupsOf((prev) => ({ ...prev, [name]: { status: 'loading' } }));
    const filters = rows.filter((f) => filterIsComplete(f) && !(isGroupRow(f) && f.column === name));
    withTimeout(apiFetch(`/api/inspire/implement/group-counts?${browseQuery(warehouseId, table)}`, {
      method: 'POST',
      body: JSON.stringify({ columns: [name], filters, window: {}, top: GROUP_TOP }),
    }), ANSWER_MS)
      .then((d) => setGroupsOf((prev) => ({
        ...prev,
        [name]: {
          status: 'done',
          truncated: Boolean(d.truncated),
          values: (d.groups || []).map((g) => ({ value: String(g[name]), records: Number(g.records) || 0 })),
        },
      })))
      .catch((e) => setGroupsOf((prev) => ({ ...prev, [name]: { status: 'error', error: e.message || `The groups of ${name} could not be listed.` } })));
  };
  return (
    <section aria-label={`Columns of ${table}`} data-column-grid={table} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-text-primary">{table}</h3>
        <span className="text-text-tertiary">{shown.length} of {names.length} columns ticked</span>
        <button type="button" className={`${BUTTON} ms-auto`} onClick={() => write(names, rows)}>Select all</button>
        <button type="button" className={BUTTON} onClick={() => write([], rows)}>Unselect all</button>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc ps-4 text-error-fg">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {note && <p data-scope-note="dropped" role="status" className="text-text-secondary">{note}</p>}
      {keyNotes.length > 0 && (
        <p data-key-note="removed" className="text-warning-fg">
          Key columns {keyNotes.join(', ')} are not ticked. Inspire then identifies each row by its own row key.
        </p>
      )}
      <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Columns of {table}: tick the columns Inspire reads, add row filters, and pick row groups.</caption>
        <thead>
          <tr className="text-text-tertiary">
            <th scope="col" className="w-[30%] px-2 py-1 text-start font-semibold">Column</th>
            <th scope="col" className="w-[28%] px-2 py-1 text-start font-semibold">Row filters</th>
            <th scope="col" className="w-[42%] px-2 py-1 text-start font-semibold">Row Groups</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const ticked = shown.includes(name);
            const conditions = rows.map((f, index) => ({ f, index })).filter(({ f }) => f.column === name && !isGroupRow(f));
            return (
              <tr key={name} data-scope-row={name} className="border-t border-border align-top">
                <td className="break-words px-2 py-1.5">
                  <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <input type="checkbox" data-scope-column={name} checked={ticked} onChange={() => toggle(name)} />
                    <span className="font-mono text-text-primary">{name}</span>
                    {typeOf.get(name) && <span className="text-text-tertiary">{typeOf.get(name)}</span>}
                  </label>
                </td>
                <td className="break-words px-2 py-1.5 space-y-2">
                  {conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {conditions.map(({ f, index }) => (
                        <span key={index} data-scope-condition={name} className="inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg">
                          {conditionText(f)}
                          <button type="button" aria-label={`Remove row filter on ${name}: ${conditionText(f)}`}
                            onClick={() => write(shown, rows.filter((_, i) => i !== index))}>
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {ticked ? (
                    <AddRowFilter table={table} column={name} suggestions={valuesOf(name)} loadValues={loadValues}
                      onCommit={(condition) => write(shown, [...rows, condition])} />
                  ) : (
                    <>
                      <button type="button" disabled aria-label={`Add row filter on ${name}`} className={`${BUTTON} whitespace-nowrap`}>Add row filter</button>
                      <p className="text-text-tertiary">Tick {name} to add a row filter to it.</p>
                    </>
                  )}
                </td>
                <td className="break-words px-2 py-1.5">
                  {columnKindOf(typeOf.get(name)) === 'categorical' ? (
                    <RowGroups column={name} ticked={ticked} picked={groupOf(name)} loaded={groupsOf[name]}
                      onLoad={() => loadGroups(name)} onPick={(values) => pickGroups(name, values)} />
                  ) : (
                    <p className="text-text-tertiary">Use Row filters for numbers and dates.</p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function UseCaseLabel({ scopes, tables, label, onLabel }) {
  const filtered = filteredTablesOf(scopes, tables);
  const prefill = groupLabelOf(filterValuesOf(scopes, tables));
  const shown = label.text == null ? prefill : label.text;
  return (
    <div data-use-case-label className="rounded-xl border border-border p-3 space-y-2">
      <label className="flex items-center gap-2 font-semibold text-text-primary">
        <input type="checkbox" data-use-case-label-on checked={label.on} onChange={(e) => onLabel({ ...label, on: e.target.checked })} />
        Use case labeling enhanced using filters
      </label>
      <input dir="auto" type="text" aria-label="Use case label" data-use-case-label-text value={shown} disabled={!label.on}
        placeholder={label.on ? 'Pick row groups, then the label fills in here' : 'Tick the box above to use a label'}
        onChange={(e) => onLabel({ ...label, text: e.target.value })}
        className={`${FIELD} h-9 w-full disabled:opacity-50`} />
      {label.text != null && label.on && (
        <button type="button" className={BUTTON} onClick={() => onLabel({ ...label, text: null })}>Use the group values</button>
      )}
      <p className="text-text-tertiary">
        Inspire puts this label in the name of every use case that reads a filtered table, for example
        &quot;Improve Contoso customer experience using segmentation&quot;.
        {label.on && !filtered.length && ' Pick row groups first: the label has nothing to name yet.'}
      </p>
    </div>
  );
}

export default function DataFilters({ picks, scopes, onScopes, label, onLabel, apiFetch, warehouseId, onProblems }) {
  const [split, setSplit] = useState(readSplit);
  const rootRef = useRef(null);
  useEffect(() => { writeSplit(split); }, [split]);
  const [openTable, setOpenTable] = useState(null);
  const [columnsOf, setColumnsOf] = useState({});
  const [valuesOf, setValuesOf] = useState({});
  const [counts, setCounts] = useState({});
  const requested = useRef(new Set());
  const fired = useRef({});

  const tables = pickedTableNames(scopes, picks);
  const coveredBy = (table) => {
    const key = scopeKeyOf(table);
    return tables.some((t) => scopeKeyOf(t) === key)
      || picks.schemas.some((s) => key.startsWith(`${scopeKeyOf(s)}.`))
      || picks.catalogs.some((c) => key.startsWith(`${scopeKeyOf(c)}.`));
  };
  const shownTable = openTable && coveredBy(openTable) ? openTable : null;
  const tree = buildTree(picks, tables);
  const jobs = tables
    .map((table) => ({ table, filters: normalizeTableScope(tableScopeOf(scopes, table)).rows.filter(filterIsComplete) }))
    .filter((job) => job.filters.length)
    .map((job) => ({ ...job, key: `${warehouseId || ''}|${JSON.stringify(job.filters)}` }));
  const jobsJson = JSON.stringify(jobs);
  const wantedKey = [...new Set([...tables.filter((t) => tableScopeOf(scopes, t)), ...(shownTable ? [shownTable] : [])])].join('\n');

  useEffect(() => {
    wantedKey.split('\n').filter(Boolean).forEach((table) => {
      const key = columnsKey(warehouseId, table);
      if (requested.current.has(key)) return;
      requested.current.add(key);
      apiFetch(`/api/inspire/implement/columns?${browseQuery(warehouseId, table)}`)
        .then((d) => setColumnsOf((prev) => ({ ...prev, [table]: { columns: d.columns || [], keys: d.primary_keys || [] } })))
        .catch((e) => setColumnsOf((prev) => ({ ...prev, [table]: { error: e.message || 'The columns of this table could not be read.' } })));
    });
  }, [wantedKey, apiFetch, warehouseId]);

  const latestJobs = useRef(jobs);
  useEffect(() => { latestJobs.current = jobs; });
  useEffect(() => {
    const timer = setTimeout(() => {
      latestJobs.current.forEach(({ table, key, filters }) => {
        if (fired.current[table] === key) return;
        fired.current[table] = key;
        withTimeout(apiFetch(`/api/inspire/implement/readiness?${browseQuery(warehouseId, table)}`, {
          method: 'POST',
          body: JSON.stringify({ table, columns: [], filters, window: {} }),
        }), ANSWER_MS)
          .then((d) => setCounts((prev) => ({ ...prev, [table]: { key, rows: Number(d.row_count) || 0 } })))
          .catch((e) => setCounts((prev) => ({ ...prev, [table]: { key, error: e.message || 'The rows could not be counted.' } })));
      });
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [jobsJson, apiFetch, warehouseId]);

  const loadValues = (table, column) => {
    const key = valueKey(warehouseId, table, column);
    if (!column || requested.current.has(key)) return;
    requested.current.add(key);
    apiFetch(`/api/inspire/implement/values?${browseQuery(warehouseId, table)}&column=${encodeURIComponent(column)}&limit=${VALUE_CHIPS}`)
      .then((d) => setValuesOf((prev) => ({ ...prev, [key]: d.values || [] })))
      .catch(() => setValuesOf((prev) => ({ ...prev, [key]: [] })));
  };

  const problemsOf = (table) => {
    const entry = tableScopeOf(scopes, table);
    if (!entry) return [];
    const short = shortName(table);
    const meta = columnsOf[table];
    const list = scopeProblems(entry, meta?.columns ? meta.columns.map((c) => c.column_name) : null).map((p) => `${short}: ${p}`);
    const job = jobs.find((j) => j.table === table);
    const count = counts[table];
    if (job && count && count.key === job.key && count.rows === 0) {
      list.push(`${short}: its row filters keep 0 rows, so Inspire will not run them. Change a filter.`);
    }
    return list;
  };
  const tableProblems = tables.map(problemsOf);
  const problems = tableProblems.flat();
  const labelProblem = label.on && filteredTablesOf(scopes, tables).length && !(label.text ?? groupLabelOf(filterValuesOf(scopes, tables))).trim()
    ? ['Use case labeling is ticked but the label is empty: type the label or untick the box.'] : [];
  const allProblems = [...problems, ...labelProblem];
  const allKey = allProblems.join('\n');
  useEffect(() => { if (onProblems) onProblems(allProblems); }, [allKey, onProblems]); // eslint-disable-line react-hooks/exhaustive-deps

  const summaryOf = (table) => {
    const entry = tableScopeOf(scopes, table);
    if (!entry) return ALL_READ;
    const scope = normalizeTableScope(entry);
    const total = columnsOf[table]?.columns?.length || 0;
    const ticked = scope.columns.length;
    const parts = [];
    if (total && ticked === total) parts.push('All columns');
    else parts.push(total ? `${ticked} of ${total} columns` : `${ticked} column${ticked === 1 ? '' : 's'}`);
    const filters = scope.rows.filter((r) => !isGroupRow(r)).length;
    const groups = scope.rows.length - filters;
    if (filters) parts.push(`${filters} row filter${filters === 1 ? '' : 's'}`);
    if (groups) parts.push(`${groups} row group${groups === 1 ? '' : 's'}`);
    const job = jobs.find((j) => j.table === table);
    if (job) {
      const c = counts[table];
      parts.push(!c || c.key !== job.key ? 'counting rows' : c.error ? 'rows could not be counted' : `${c.rows.toLocaleString()} rows match`);
    }
    if (problemsOf(table).length) parts.push('needs a fix');
    return parts.join(', ');
  };

  const setEntry = (table, entry) => {
    const next = Object.fromEntries(Object.entries(scopes || {}).filter(([name]) => scopeKeyOf(name) !== scopeKeyOf(table)));
    if (entry) next[table] = entry;
    onScopes(next);
  };

  const renderTable = (table) => (
    <TableLeaf key={table} level={3} table={table} summary={summaryOf(table)} selected={table === shownTable}
      onSelect={() => setOpenTable(table)} />
  );
  const renderSchema = (catalog, s, catalogPicked) => (
    <SchemaNode key={`${catalog}.${s.name}`} catalog={catalog} schema={s.name}
      listable={catalogPicked || s.picked} tableNames={s.tables} apiFetch={apiFetch} warehouseId={warehouseId} renderTable={renderTable} />
  );
  const nothingPicked = !picks.tables.length && !picks.schemas.length && !picks.catalogs.length;

  return (
    <div data-data-filters className="space-y-4 text-xs">
      <p className="text-text-secondary">
        A table with no filters is read whole: every column, every row. Pick a table on the left to tick its columns and add row filters.
        Picked schemas and catalogs open to their tables.
      </p>
      {nothingPicked && <p data-data-filters-empty className="text-text-tertiary">Pick tables, schemas or catalogs under Unity Catalog Metadata to filter them.</p>}
      {!nothingPicked && (
        <div ref={rootRef} data-filters-layout className="grid grid-cols-1 gap-4 min-[1440px]:[grid-template-columns:var(--dfl)_0.5rem_var(--dfr)]"
          style={{ '--dfl': `minmax(0,${split}fr)`, '--dfr': `minmax(0,${100 - split}fr)` }}>
          <div data-filters-tree className="min-w-0 max-h-[28rem] overflow-y-auto">
            <ul role="tree" aria-label="Tables you picked, by catalog, schema and table" className="space-y-1">
              {tree.map((c) => (
                <CatalogNode key={c.name} catalog={c.name} picked={c.picked} schemas={c.schemas} apiFetch={apiFetch}
                  warehouseId={warehouseId} renderSchema={renderSchema} />
              ))}
            </ul>
          </div>
          <div role="separator" aria-orientation="vertical" aria-label="Resize the table list and the column grid" aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX} aria-valuenow={split} tabIndex={0} data-filters-splitter
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const box = rootRef.current.getBoundingClientRect();
              setSplit(clampSplit(((e.clientX - box.left) / box.width) * 100));
            }}
            onKeyDown={(e) => {
              const next = { ArrowLeft: split - 2, ArrowRight: split + 2, Home: SPLIT_MIN, End: SPLIT_MAX }[e.key];
              if (next === undefined) return;
              e.preventDefault();
              setSplit(clampSplit(next));
            }}
            className="hidden min-[1440px]:flex cursor-col-resize justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red-fg/60">
            <span className="w-px bg-border" />
          </div>
          <div data-filters-grid-pane className="min-w-0">
            {shownTable ? (
              <ColumnGrid key={shownTable} table={shownTable} entry={tableScopeOf(scopes, shownTable)} meta={columnsOf[shownTable]}
                problems={problemsOf(shownTable)} onEntry={setEntry} apiFetch={apiFetch} warehouseId={warehouseId}
                valuesOf={(column) => valuesOf[valueKey(warehouseId, shownTable, column)] || []} loadValues={loadValues} />
            ) : (
              <p data-grid-empty className="text-text-tertiary">Click a table on the left to see its columns.</p>
            )}
          </div>
        </div>
      )}
      {tables.length > 0 && <UseCaseLabel scopes={scopes} tables={tables} label={label} onLabel={onLabel} />}
    </div>
  );
}
