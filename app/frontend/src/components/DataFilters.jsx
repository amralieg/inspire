import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { groupLabelOf } from '../lib/implementWizard';
import { raisePermissions } from '../lib/permissionBus';
import { METRIC_VIEW_REFUSAL } from '../lib/pickProblem';
import { leftOutLine } from '../lib/tableUsability';
import {
  SCOPE_OPS, columnKindOf, filterValuesOf, isGroupRow, labelAvailable, normalizeTableScope, scopeKeyOf, scopeOpOf, scopeProblems, tableScopeOf,
} from '../lib/tableScope';
import BusyNote from './BusyNote';

const VALUE_CHIPS = 40;
const COUNT_DEBOUNCE_MS = 350;
const GROUP_TOP = 500;
const ANSWER_MS = 20000;
const SEARCH_DEBOUNCE_MS = 300;
const COLLAPSE_KEY = 'inspire-data-filter-collapse-names';
const IDLE_SEARCH = { status: 'idle', rows: [], total: 0 };
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';
const CHIP = 'inline-flex items-center gap-1 rounded-full bg-db-red-50 px-2 py-0.5 text-db-red-fg';

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
// The catalog and schema of a table: the part a row collapses to <..> (REQ-385).
const prefixOf = (table) => table.split('.').slice(0, -1).join('.');
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspire did not get an answer in time.')), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});
const browseQuery = (warehouseId, table) => `warehouse_id=${encodeURIComponent(warehouseId || '')}&table=${encodeURIComponent(table)}`;
const valueKey = (warehouseId, table, column) => `val:${warehouseId || ''}:${table}\u0000${column}`;
const groupKey = (table, column) => `${table}\u0000${column}`;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function conditionText(f) {
  const def = scopeOpOf(f.op);
  const label = def ? def.label : f.op;
  if (!def || def.values === 0) return label;
  return `${label} ${f.values.join(def.op === 'in' ? ', ' : ' and ')}`;
}

// One row of a table's filter: a condition on a column, or a row group (the values the person picked for a column).
const rowText = (f) => (isGroupRow(f) ? `groups: ${f.values.join(', ')}` : conditionText(f));

// The search hits (one row per table and column, from the column search route) as one flat list of matching columns (REQ-384).
// Exact names come first, then names that start with the text, then names that contain it; then by column name, then by table.
// `first` marks the first row of a column name, and `sameTables` lists every table that has that name (for Apply to all).
const termOf = (q) => q.replace(/\*/g, '').trim().toLowerCase();

function hitRowsOf(rows, q) {
  const term = termOf(q);
  const tablesOf = new Map();
  for (const row of rows) {
    const key = row.column.toLowerCase();
    if (!tablesOf.has(key)) tablesOf.set(key, []);
    tablesOf.get(key).push(row.table);
  }
  const rankOf = (key) => (key === term ? 0 : key.startsWith(term) ? 1 : 2);
  const hits = rows.map((row) => {
    const key = row.column.toLowerCase();
    return { column: row.column, table: row.table, type: row.data_type || '', key, rank: rankOf(key), sameTables: tablesOf.get(key) };
  }).sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
  return hits.map((hit, i) => ({ ...hit, first: i === 0 || hits[i - 1].key !== hit.key }));
}

// The matched text of a column name in bold, so the person sees why the row matched (REQ-384).
function ColumnName({ name, term }) {
  const at = term ? name.toLowerCase().indexOf(term) : -1;
  if (at < 0) return <span className="font-mono font-semibold text-text-primary">{name}</span>;
  return (
    <span className="font-mono font-semibold text-text-primary">
      {name.slice(0, at)}<mark className="rounded-sm bg-db-red-50 text-db-red-fg">{name.slice(at, at + term.length)}</mark>{name.slice(at + term.length)}
    </span>
  );
}

function AddRowFilter({ table, column, who, openLabel = 'Row filter', commitLabel = 'Add filter', suggestions, loadValues, onCommit }) {
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
    return <button type="button" aria-label={`${openLabel} on ${who || column}`} className={`${BUTTON} whitespace-nowrap`} onClick={() => setOpen(true)}>{openLabel}</button>;
  }
  return (
    <fieldset aria-label={`New row filter on ${who || column}`} className="w-full rounded-lg border border-border bg-surface p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Operator for ${who || column}`} className={FIELD} value={op} onChange={(e) => { setOp(e.target.value); setDraft([]); }}>
          {SCOPE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
        {needsValues && draft.length < max && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addValue(typed); setTyped(''); }}>
            <input dir="auto" aria-label={`Value for ${who || column}`} className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a value" />
            <button type="submit" className={BUTTON} disabled={!typed.trim()}>Add value</button>
          </form>
        )}
      </div>
      {needsValues && draft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.map((v, i) => (
            <span key={`${i}-${v}`} className={CHIP}>
              {v}
              <button type="button" aria-label={`Remove value ${v}`} onClick={() => setDraft(draft.filter((x) => x !== v))}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      {needsValues && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={`Values in ${who || column}`}>
          {suggestions.map((v, i) => (
            <button key={`${i}-${v}`} type="button" data-scope-value={v} onClick={() => addValue(v)}
              className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-text-secondary hover:text-text-primary">
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={BUTTON} disabled={!complete}
          onClick={() => { onCommit({ column, op, values: draft }); reset(); }}>{commitLabel}</button>
        <button type="button" className={BUTTON} onClick={reset}>Cancel</button>
      </div>
    </fieldset>
  );
}

// The groups of one text column. Opening "Load groups" on a row loads them; "Reload groups" appears once they are loaded.
function RowGroups({ column, picked, loaded, onLoad, onPick }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(true);
  const values = loaded?.status === 'done' ? loaded.values : [];
  const shown = values.filter((g) => !search || g.value.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = new Set(picked);
  const listing = loaded?.status === 'done' && values.length > 0 && (editing || picked.length === 0);
  return (
    <div className="space-y-2" data-row-groups={column}>
      <div className="flex flex-wrap items-center gap-2">
        {loaded && (
          <button type="button" className={BUTTON} aria-label={`Reload groups for ${column}`} disabled={loaded.status === 'loading'}
            onClick={() => { setEditing(true); onLoad(); }}>
            Reload groups
          </button>
        )}
        {loaded?.status === 'loading' && <BusyNote inline className="text-text-tertiary" text={`Loading the groups of ${column}`} />}
        {loaded?.status === 'done' && (
          <span className="text-text-tertiary">
            {plural(values.length, 'value')}{loaded.truncated ? `, the top ${GROUP_TOP} by rows` : ''}
          </span>
        )}
        {loaded?.status === 'done' && values.length > 0 && picked.length > 0 && (
          <button type="button" className={BUTTON} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Change groups'}</button>
        )}
      </div>
      {loaded?.status === 'error' && <PlainMessage role="alert" className="text-error-fg" text={loaded.error} />}
      {listing && (
        <>
          {values.length > 20 && (
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
      {loaded?.status === 'done' && values.length === 0 && (
        <p data-groups-reason={column} className="text-text-secondary">{loaded.reason || `${column} has no values in the rows in scope.`}</p>
      )}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((v, i) => (
            <span key={`${i}-${v}`} data-scope-group={column} className={CHIP}>
              <span dir="auto">{v}</span>
              <button type="button" aria-label={`Remove group ${v}`} onClick={() => onPick(picked.filter((x) => x !== v))}><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function UseCaseLabel({ scopes, tables, label, onLabel }) {
  const available = labelAvailable(scopes, tables);
  const prefill = groupLabelOf(filterValuesOf(scopes, tables));
  const shown = label.text == null ? prefill : label.text;
  return (
    <div data-use-case-label className="rounded-xl border border-border p-3 space-y-2">
      <label className="flex items-center gap-2 font-semibold text-text-primary">
        <input type="checkbox" data-use-case-label-on checked={label.on && available} disabled={!available}
          onChange={(e) => onLabel({ ...label, on: e.target.checked })} />
        Use case labeling enhanced using filters
      </label>
      <input dir="auto" type="text" aria-label="Use case label" data-use-case-label-text value={shown} disabled={!label.on || !available}
        placeholder={!available ? 'Add a row group to fill in the label' : label.on ? 'Pick row groups, then the label fills in here' : 'Tick the box above to use a label'}
        onChange={(e) => onLabel({ ...label, text: e.target.value })}
        className={`${FIELD} h-9 w-full disabled:opacity-50`} />
      {label.text != null && label.on && available && (
        <button type="button" className={BUTTON} onClick={() => onLabel({ ...label, text: null })}>Use the group values</button>
      )}
      {!available && <p data-use-case-label-reason className="text-text-secondary">Add a row group above to label your use cases.</p>}
      <p className="text-text-tertiary">
        Inspire puts this label in the name of every use case that reads a filtered table, for example
        &quot;Improve Contoso customer experience using segmentation&quot;.
      </p>
    </div>
  );
}

// One matching column in one table (REQ-384, REQ-385): one dotted name, catalog.schema.table.column with the column highlighted, then its type
// in small text, then the Read box, the filter on it (if any), Row filter, and Load groups (categorical columns only). The <..> part
// (catalog.schema) expands in place for this row when `collapsed`. `applyAll` is the Apply to all action, set on the first row of a
// column name that several tables have.
function HitRow({ hit, term, rows, read, onRead, valuesOf, loadValues, groupOf, groupState, onLoadGroups, onPickGroups, onAdd, applyAll, collapsed, onToggleName }) {
  const [groupsOpen, setGroupsOpen] = useState(false);
  const name = hit.column;
  const conditions = rows.map((f, index) => ({ f, index })).filter(({ f }) => f.column === name);
  const categorical = columnKindOf(hit.type) === 'categorical';
  return (
    <li data-column-hit={name} data-scope-row={hit.table} className="flex flex-wrap items-start gap-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
        <span data-dotted-name className="font-mono break-all" title={hit.table}>
          <button type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Show' : 'Hide'} the catalog and schema of ${name} in ${shortName(hit.table)}`}
            onClick={onToggleName} className="text-text-tertiary hover:text-text-primary">{collapsed ? '<..>' : prefixOf(hit.table)}</button>
          <span className="text-text-tertiary">.{shortName(hit.table)}.</span>
          <ColumnName name={name} term={term} />
        </span>
        <span className="text-text-tertiary">{hit.type}</span>
      </div>
      <label className="flex items-center gap-1.5 text-text-secondary">
        <input type="checkbox" aria-label={`Read ${name} in ${shortName(hit.table)}`} checked={read} onChange={(e) => onRead(e.target.checked)} />
        Read
      </label>
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {conditions.map(({ f }, i) => <span key={i} data-scope-filtered={name} className="text-text-secondary">{conditionText(f)}</span>)}
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {applyAll}
        <AddRowFilter table={hit.table} column={name} who={`${name} in ${shortName(hit.table)}`} suggestions={valuesOf(hit.table, name)}
          loadValues={loadValues} onCommit={(condition) => onAdd(hit.table, condition)} />
        {categorical && (
          <button type="button" className={BUTTON} aria-expanded={groupsOpen} aria-label={`Load groups on ${name} in ${shortName(hit.table)}`}
            onClick={() => {
              const open = !groupsOpen;
              setGroupsOpen(open);
              if (open && !groupState(hit.table, name)) onLoadGroups(hit.table, name);
            }}>Load groups</button>
        )}
      </div>
      {categorical && groupsOpen && (
        <div className="w-full">
          <RowGroups column={name} picked={groupOf(hit.table, name)} loaded={groupState(hit.table, name)}
            onLoad={() => onLoadGroups(hit.table, name)} onPick={(values) => onPickGroups(hit.table, name, values)} />
        </div>
      )}
      {!categorical && <p className="w-full text-text-tertiary">Row groups are for text columns. Use a row filter for numbers and dates.</p>}
    </li>
  );
}

export default function DataFilters({ scope, scopes, tables, listing, onScopes, label, onLabel, apiFetch, warehouseId, onProblems, onMetricViews }) {
  const [query, setQuery] = useState('');
  const [columnsOf, setColumnsOf] = useState({});
  const [valuesOf, setValuesOf] = useState({});
  const [counts, setCounts] = useState({});
  const [groupsOf, setGroupsOf] = useState({});
  const [note, setNote] = useState('');
  const [search, setSearch] = useState(IDLE_SEARCH);
  const [attempt, setAttempt] = useState(0);
  // Collapse names (REQ-385): ticked by default, remembered in this browser. nameOverrides holds the rows a click on <..> changed.
  const [collapseNames, setCollapseNames] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch { return true; }
  });
  const [nameOverrides, setNameOverrides] = useState({});
  const chooseCollapse = (next) => {
    setCollapseNames(next);
    setNameOverrides({});
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* storage off: the choice lasts this visit */ }
  };
  // A Read change waits for the column names of a table it has not read yet: the box shows the new state at once, until the write lands.
  const [pendingReads, setPendingReads] = useState({});
  const fired = useRef({});
  const requested = useRef(new Set());
  const pending = useRef({});
  // The columns of a table are read one table at a time, only for a table with a saved filter or when the person reads a column of it
  // (REQ-370): a whole-catalog pick is not read table by table. The effects below read the current lists through refs.
  const columnsRef = useRef(columnsOf);
  const scopeNow = useRef(scope);
  const savedTables = tables.filter((t) => tableScopeOf(scopes, t));
  const savedJson = JSON.stringify(savedTables);
  const savedNow = useRef(savedTables);
  useEffect(() => {
    columnsRef.current = columnsOf;
    savedNow.current = savedTables;
    scopeNow.current = scope;
  });
  const scopeJson = JSON.stringify(scope || {});
  const namesOf = (table) => (columnsOf[table]?.columns || []).map((c) => c.column_name);
  const rowsOf = (table) => normalizeTableScope(tableScopeOf(scopes, table)).rows;
  const jobs = tables
    .map((table) => ({ table, filters: rowsOf(table).filter(filterIsComplete) }))
    .filter((job) => job.filters.length)
    .map((job) => ({ ...job, key: `${warehouseId || ''}|${JSON.stringify(job.filters)}` }));
  const jobsJson = JSON.stringify(jobs);

  // The columns of one table, read once. A failure is kept on the table (a metric view is named as one, see the effect below).
  const loadColumns = (table) => {
    if (!pending.current[table]) {
      pending.current[table] = apiFetch(`/api/inspire/implement/columns?${browseQuery(warehouseId, table)}`)
        .then((d) => {
          const columns = d.columns || [];
          setColumnsOf((prev) => ({ ...prev, [table]: { columns, keys: d.primary_keys || [] } }));
          return columns.map((c) => c.column_name);
        }, (e) => {
          setColumnsOf((prev) => ({ ...prev, [table]: {
            error: e.message || 'The columns of this table could not be read.',
            refused: METRIC_VIEW_REFUSAL.test(e.message || '') ? e.message : '',
            permissions: Array.isArray(e.body?.permissions) ? e.body.permissions : [],
          } }));
          throw e;
        })
        .finally(() => { delete pending.current[table]; });
    }
    return pending.current[table];
  };
  const ensureColumns = (table) => {
    const known = columnsRef.current[table];
    return known?.columns ? Promise.resolve(known.columns.map((c) => c.column_name)) : loadColumns(table);
  };

  useEffect(() => {
    savedNow.current.forEach((table) => {
      if (columnsRef.current[table]) return;
      loadColumns(table).catch(() => {});
    });
  }, [savedJson, apiFetch, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The column search (REQ-370): one request for the whole picked scope, debounced, and empty text searches nothing.
  const searchText = query.trim();
  // Empty text shows no search at all: the answer below is derived, so clearing the box needs no state write.
  const answer = searchText ? search : IDLE_SEARCH;
  useEffect(() => {
    if (!searchText) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearch((prev) => ({ ...prev, status: 'loading' }));
      withTimeout(apiFetch(`/api/data-management/columns?warehouse_id=${encodeURIComponent(warehouseId || '')}`, {
        method: 'POST',
        body: JSON.stringify({ scope: scopeNow.current || {}, q: searchText }),
      }), ANSWER_MS)
        .then((d) => { if (!cancelled) setSearch({ status: 'done', q: searchText, rows: d.hits || [], total: Number(d.total) || 0 }); })
        .catch((e) => {
          if (cancelled) return;
          const permissions = Array.isArray(e.body?.permissions) ? e.body.permissions : [];
          setSearch({ status: 'error', rows: [], total: 0, error: e.message || 'The columns could not be searched. Try again.' });
          raisePermissions(permissions, { retry: () => setAttempt((n) => n + 1) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchText, scopeJson, apiFetch, warehouseId, attempt]);

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
    // The column names of the table are read with its values, so a row filter or a group saved on it can be written at once.
    ensureColumns(table).catch(() => {});
    apiFetch(`/api/inspire/implement/values?${browseQuery(warehouseId, table)}&column=${encodeURIComponent(column)}&limit=${VALUE_CHIPS}`)
      .then((d) => setValuesOf((prev) => ({ ...prev, [key]: d.values || [] })))
      .catch(() => setValuesOf((prev) => ({ ...prev, [key]: [] })));
  };
  const valuesFor = (table, column) => valuesOf[valueKey(warehouseId, table, column)] || [];

  const loadGroups = (table, name) => {
    const key = groupKey(table, name);
    setGroupsOf((prev) => ({ ...prev, [key]: { status: 'loading' } }));
    ensureColumns(table).catch(() => {});
    const filters = rowsOf(table).filter((f) => filterIsComplete(f) && !(isGroupRow(f) && f.column === name));
    withTimeout(apiFetch(`/api/inspire/implement/group-counts?${browseQuery(warehouseId, table)}`, {
      method: 'POST',
      body: JSON.stringify({ columns: [name], filters, window: {}, top: GROUP_TOP }),
    }), ANSWER_MS)
      .then((d) => setGroupsOf((prev) => ({
        ...prev,
        [key]: {
          status: 'done',
          truncated: Boolean(d.truncated),
          reason: String(d.reason || ''),
          values: (d.groups || []).map((g) => ({ value: String(g[name]), records: Number(g.records) || 0 })),
        },
      })))
      .catch((e) => {
        const permissions = Array.isArray(e.body?.permissions) ? e.body.permissions : [];
        setGroupsOf((prev) => ({ ...prev, [key]: { status: 'error', error: e.message || `The groups of ${name} could not be listed.`, permissions } }));
        raisePermissions(permissions, { retry: () => loadGroups(table, name) });
      });
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
  const problems = tables.map(problemsOf).flat();
  const labelProblem = label.on && labelAvailable(scopes, tables) && !(label.text ?? groupLabelOf(filterValuesOf(scopes, tables))).trim()
    ? ['Use case labeling is ticked but the label is empty: type the label or untick the box.'] : [];
  const allProblems = [...problems, ...labelProblem];
  const allKey = allProblems.join('\n');
  useEffect(() => { if (onProblems) onProblems(allProblems); }, [allKey, onProblems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change to one or more tables' filters is one write. The write is a functional update: it is applied to the scopes as they are
  // when it lands, so a change made while a column read was in flight is kept (REQ-370).
  const commitRows = (updates) => {
    const unread = updates.filter((u) => !u.columns && !tableScopeOf(scopes, u.table) && !columnsRef.current[u.table]?.columns).map((u) => u.table);
    if (!unread.length) return writeRows(updates, {});
    Promise.all(unread.map((table) => ensureColumns(table).then((names) => [table, names])))
      .then((pairs) => writeRows(updates, Object.fromEntries(pairs)), () => setNote('Inspire could not read the columns of this table. Try again.'));
    return undefined;
  };
  // The scopes after one write: the tables in updates replaced, the others kept as they are in `current`.
  const mergeScopes = (current, updates, namesFor) => {
    const changed = (name) => updates.some((u) => scopeKeyOf(u.table) === scopeKeyOf(name));
    const next = Object.fromEntries(Object.entries(current).filter(([name]) => !changed(name)));
    for (const { table, rows, columns: wanted } of updates) {
      const entry = tableScopeOf(current, table);
      const names = namesFor[table] || (columnsRef.current[table]?.columns || []).map((c) => c.column_name);
      const columns = wanted || (entry ? normalizeTableScope(entry).columns : names);
      // With no rows left and every column read, the table goes back to a plain read.
      const whole = names.length ? names.every((n) => columns.includes(n)) : !entry;
      if (!rows.length && whole) continue;
      next[table] = { columns: names.length ? names.filter((n) => columns.includes(n)) : columns, rows };
    }
    return next;
  };
  const writeRows = (updates, namesFor) => onScopes((prev) => mergeScopes(prev || {}, updates, namesFor));
  // Read for one column of one table, against the scopes given: the table's columns with the column added or left out, and the row
  // filters on a column that is no longer read are dropped (a column Inspire does not read cannot be filtered).
  const rowsIn = (current, table) => normalizeTableScope(tableScopeOf(current, table)).rows;
  const readUpdateIn = (current, table, name, read, names) => {
    const entry = tableScopeOf(current, table);
    const known = entry ? normalizeTableScope(entry).columns : names;
    const columns = read ? [...new Set([...known, name])] : known.filter((c) => c !== name);
    const rows = rowsIn(current, table);
    const kept = rows.filter((f) => columns.includes(f.column));
    const dropped = rows.filter((f) => !columns.includes(f.column)).map((f) => f.column);
    return { table, columns, rows: kept, dropped };
  };
  const droppedNote = (updates) => {
    const dropped = updates.filter((u) => u.dropped.length);
    return dropped.map((u) => `Removed ${u.dropped.length} row filter${u.dropped.length === 1 ? '' : 's'} on ${[...new Set(u.dropped)].join(', ')} in ${shortName(u.table)}: a column Inspire does not read cannot be filtered.`).join(' ');
  };
  // Read or stop reading one column in the tables given. A table read whole already reads the column, so reading it changes nothing
  // there; the column names of the other tables are read first (one table each, only when the person changes a read).
  const readKey = (table, name) => `${scopeKeyOf(table)}\u0000${name}`;
  const readOf = (table, name) => (readKey(table, name) in pendingReads ? pendingReads[readKey(table, name)] : readsColumn(table, name));
  const readColumn = (tablesToChange, name, read) => {
    const work = tablesToChange.filter((table) => !read || tableScopeOf(scopes, table));
    if (!work.length) return;
    setPendingReads((prev) => ({ ...prev, ...Object.fromEntries(work.map((table) => [readKey(table, name), read])) }));
    const settle = () => setPendingReads((prev) => {
      const next = { ...prev };
      work.forEach((table) => delete next[readKey(table, name)]);
      return next;
    });
    Promise.all(work.map((table) => ensureColumns(table).then((names) => [table, names])))
      .then((pairs) => {
        const namesFor = Object.fromEntries(pairs);
        // The write is applied to the latest scopes; the note reads the scopes as the person last saw them.
        onScopes((prev) => {
          const current = prev || {};
          return mergeScopes(current, pairs.map(([table]) => readUpdateIn(current, table, name, read, namesFor[table])), namesFor);
        });
        const note = droppedNote(pairs.map(([table]) => readUpdateIn(scopes, table, name, read, namesFor[table])));
        if (note) setNote(note);
        settle();
      }, () => { settle(); setNote('Inspire could not read the columns of these tables. Try again.'); });
  };
  const readsColumn = (table, name) => {
    const entry = tableScopeOf(scopes, table);
    return !entry || normalizeTableScope(entry).columns.includes(name);
  };
  const addRow = (table, condition) => commitRows([{ table, rows: [...rowsOf(table), condition] }]);
  const removeRow = (table, index) => commitRows([{ table, rows: rowsOf(table).filter((_, i) => i !== index) }]);
  const pickGroups = (table, name, values) => {
    const rows = rowsOf(table);
    const others = rows.filter((f) => !(isGroupRow(f) && f.column === name));
    commitRows([{ table, rows: values.length ? [...others, { column: name, op: 'in', values, group: true }] : others }]);
  };
  const groupOf = (table, name) => rowsOf(table).find((f) => isGroupRow(f) && f.column === name)?.values || [];
  const groupState = (table, name) => groupsOf[groupKey(table, name)];

  // A metric view is named once in the Data Management line (REQ-370). A saved pick that is a metric view is also dropped from the
  // scope, with a note. Idempotent: it acts only while the entry is still in the scope.
  useEffect(() => {
    const refused = Object.entries(columnsOf).filter(([, info]) => info.refused).map(([table]) => table);
    if (!refused.length) return;
    if (onMetricViews) onMetricViews(refused);
    const saved = refused.filter((table) => tableScopeOf(scopes, table));
    if (!saved.length) return;
    onScopes(Object.fromEntries(Object.entries(scopes || {}).filter(([name]) => !saved.some((t) => scopeKeyOf(t) === scopeKeyOf(name)))));
    // The note records a drop this effect has just made, so it is written here on purpose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(`Removed the saved filters on ${saved.map(shortName).join(', ')}: a metric view cannot be filtered.`);
  }, [columnsOf, scopes, onScopes, onMetricViews]);

  const hits = hitRowsOf(answer.rows, answer.q || '');
  const term = termOf(answer.q || '');
  // Every picked table that has a saved scope is listed, so a problem with it is shown where the person can fix it.
  const withFilters = tables.filter((t) => tableScopeOf(scopes, t));
  // The columns of a saved table that Inspire does not read, named as table.column (the person can see them without a search).
  const leftOutColumns = withFilters.flatMap((table) => {
    const kept = normalizeTableScope(tableScopeOf(scopes, table)).columns;
    return namesOf(table).filter((n) => !kept.includes(n)).map((n) => `${shortName(table)}.${n}`);
  });
  const countLine = (table) => {
    const job = jobs.find((j) => j.table === table);
    if (!job) return '';
    const c = counts[table];
    return !c || c.key !== job.key ? 'counting rows' : c.error ? 'rows could not be counted' : `${plural(c.rows, 'row')} match`;
  };
  const nothingPicked = !scope.entries.length;
  // Filters in use lists the row filters and row groups saved on the tables (REQ-377): the block exists only once one exists.
  const filterCount = withFilters.reduce((n, table) => n + rowsOf(table).length, 0);

  return (
    <div data-data-filters className="space-y-4 text-xs">
      {nothingPicked && <p data-data-filters-empty className="text-text-tertiary">Pick tables above to filter their columns.</p>}
      {!nothingPicked && (
        <>
          {filterCount > 0 && (
            <div data-filters-in-use className="rounded-lg border border-border p-3 space-y-2">
              <p className="font-semibold text-text-primary">Your filters ({filterCount})</p>
              <ul className="flex flex-wrap gap-1.5">
                {withFilters.flatMap((table) => rowsOf(table).map((f, index) => (
                  <li key={`${table}\u0000${index}`} data-filter-table={table} data-scope-condition={f.column} className={`${CHIP} max-w-full`}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{f.column}: {rowText(f)}</span>
                    <span className="min-w-0 text-text-tertiary [overflow-wrap:anywhere]">{shortName(table)}{countLine(table) && ` · ${countLine(table)}`}</span>
                    <button type="button" aria-label={`Remove ${f.group ? 'row group' : 'row filter'} on ${f.column} in ${shortName(table)}: ${rowText(f)}`}
                      onClick={() => removeRow(table, index)}>
                      <X size={14} />
                    </button>
                  </li>
                )))}
              </ul>
              {problems.length > 0 && (
                <ul role="alert" className="list-disc ps-4 text-error-fg">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
            </div>
          )}
          {leftOutColumns.length > 0 && (
            <div data-columns-left-out className="space-y-1 text-text-secondary">
              <p>Columns left out: {leftOutColumns.length}</p>
              <ul className="flex flex-wrap gap-1.5">
                {leftOutColumns.map((full) => <li key={full} data-left-out-column={full} className="font-mono text-text-tertiary">{full}</li>)}
              </ul>
            </div>
          )}
          {note && <p data-scope-note="dropped" role="status" className="text-text-secondary">{note}</p>}
          <div data-column-search className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input type="search" aria-label="Search column names" value={query} dir="auto" onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a column name, for example brand" className={`${FIELD} h-9 min-w-0 flex-1`} />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
                <input type="checkbox" aria-label="Collapse names" checked={collapseNames} onChange={(e) => chooseCollapse(e.target.checked)} />
                Collapse names
              </label>
            </div>
            <p data-search-syntax className="text-text-tertiary">Use * at the start or end, for example brand* or *_id.</p>
            {answer.status === 'loading' && <BusyNote data-search-loading="" className="text-text-tertiary" text="Searching the columns you picked" />}
            {answer.status === 'error' && (
              <div className="flex flex-wrap items-center gap-2">
                <PlainMessage role="alert" className="text-error-fg" text={answer.error} />
                <button type="button" className={BUTTON} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
              </div>
            )}
            {tables.length === 0 && (
              <p data-search-empty className="text-text-secondary">
                The tables you picked cannot be searched yet. Pick tables above to search their columns.
              </p>
            )}
            {!query.trim() && tables.length > 0 && (
              <p data-search-hint className="text-text-secondary">Type a column name to find it in the {plural(tables.length, 'table')} you picked.</p>
            )}
            {query.trim() && answer.status === 'done' && hits.length === 0 && (
              <p data-search-none className="text-text-secondary">No column name contains &quot;{query.trim()}&quot; in the {plural(tables.length, 'table')} you picked.</p>
            )}
            {hits.length > 0 && (
              <p className="text-text-secondary">{plural(hits.length, 'column')} in {plural(new Set(hits.map((hit) => hit.table)).size, 'table')} match.</p>
            )}
            {answer.total > answer.rows.length && (
              <p data-hits-capped className="text-text-secondary">
                Showing {answer.rows.length.toLocaleString()} of {answer.total.toLocaleString()} matches. Type more letters to narrow it down.
              </p>
            )}
            {listing.listErrors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-list-errors>
                <PlainMessage role="alert" className="text-error-fg" text={listing.listErrors[0]} />
                {listing.listErrors.length > 1 && <span className="text-text-secondary">and {listing.listErrors.length - 1} more</span>}
                <button type="button" className={BUTTON} onClick={listing.retry}>Try again</button>
              </div>
            )}
            {listing.leftOut.map((l) => <p key={`${l.schema}-${l.count}`} data-left-out="" className="text-text-secondary">{leftOutLine(l)}</p>)}
            {hits.length > 0 && (
              <ul data-column-hits className="space-y-1">
                {hits.map((hit) => (
                  <HitRow key={`${hit.key}\u0000${hit.table}`} hit={hit} term={term} rows={rowsOf(hit.table)} read={readOf(hit.table, hit.column)}
                    collapsed={nameOverrides[`${hit.table}\u0000${hit.column}`] ?? collapseNames}
                    onToggleName={() => setNameOverrides((prev) => {
                      const key = `${hit.table}\u0000${hit.column}`;
                      return { ...prev, [key]: !(prev[key] ?? collapseNames) };
                    })}
                    onRead={(next) => readColumn([hit.table], hit.column, next)} valuesOf={valuesFor} loadValues={loadValues}
                    groupOf={groupOf} groupState={groupState} onLoadGroups={loadGroups} onPickGroups={pickGroups} onAdd={addRow}
                    applyAll={hit.first && hit.sameTables.length > 1 ? (
                      <>
                        <label className="flex items-center gap-1.5 text-text-secondary">
                          <input type="checkbox" aria-label={`Read ${hit.column} in all ${hit.sameTables.length} tables`}
                            checked={hit.sameTables.every((table) => readOf(table, hit.column))}
                            onChange={(e) => readColumn(hit.sameTables, hit.column, e.target.checked)} />
                          Read in all {hit.sameTables.length} tables
                        </label>
                        <AddRowFilter table={hit.table} column={hit.column} who={`${hit.column} in ${hit.sameTables.length} tables`}
                          openLabel="Apply to all" commitLabel="Apply to all tables" suggestions={valuesFor(hit.table, hit.column)} loadValues={loadValues}
                          onCommit={(condition) => commitRows(hit.sameTables.map((table) => ({ table, rows: [...rowsOf(table), condition] })))} />
                      </>
                    ) : null} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {tables.length > 0 && <UseCaseLabel scopes={scopes} tables={tables} label={label} onLabel={onLabel} />}
    </div>
  );
}
