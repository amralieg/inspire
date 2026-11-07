import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Funnel, GripVertical } from 'lucide-react';
import BodyPortal from './BodyPortal';
import {
  cellOf, choicesHint, choicesOf, columnKind, columnName, numericColumn, filterOn, filterRows, filterText, filterable, filtersOn, loadColumnOrder, movableKeys, moveKey,
  narrowChoices, nextSort, orderColumns, present, sameOrder, saveColumnOrder, savedOrder, sortRows, toggleChoice,
} from '../lib/dataGrid';

const MOVE_KEYS = { ArrowLeft: -1, ArrowRight: 1 };
const PANEL_WIDTH = 264;
const LINK = 'text-[11px] font-medium text-info-fg hover:underline';
const FIELD = 'w-full rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-primary';

function useColumnOrder(columns, grid) {
  const natural = movableKeys(columns);
  const [state, setState] = useState(() => ({ grid, saved: grid ? loadColumnOrder(grid) : null }));
  const saved = state.grid === grid ? state.saved : (grid ? loadColumnOrder(grid) : null);
  const order = savedOrder(natural, saved);
  const keep = (next) => {
    const chosen = sameOrder(next, natural) ? null : next;
    setState({ grid, saved: chosen });
    if (grid) saveColumnOrder(grid, chosen);
  };
  return { ordered: orderColumns(columns, order), order, moved: !sameOrder(order, natural), keep };
}

function FilterPanel({ column, kind, choices, picked, onChange, onClose, at }) {
  const name = columnName(column);
  const [query, setQuery] = useState('');
  const panel = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!panel.current?.contains(e.target) && !e.target.closest?.(`[data-grid-filter="${CSS.escape(column.key)}"]`)) onClose(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [column.key, onClose]);
  const [lo, hi] = kind === 'number' ? ['min', 'max'] : ['from', 'to'];
  const edge = (side) => (e) => onChange({ ...(Array.isArray(picked?.values) ? {} : picked), [side]: e.target.value });
  const { shown, count } = narrowChoices(choices, query);
  const hint = choicesHint(count);
  return (
    <div ref={panel} role="dialog" aria-label={`Filter ${name}`} data-grid-panel={column.key}
      className="fixed z-50 space-y-2 rounded-lg border border-border bg-surface p-3 text-[12px] text-text-primary shadow-elevated"
      style={{ top: at.top, left: at.left, width: PANEL_WIDTH }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(true); } }}>
      <p className="font-semibold">{name}</p>
      {kind === 'text' ? (
        <>
          <input dir="auto" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search the ${name} choices`} placeholder="Type to search" className={FIELD} />
          {hint && <p data-grid-hint="" className="text-[11px] text-text-secondary">{hint}</p>}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {shown.map((choice) => (
              <li key={choice}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-bg-subtle">
                  <input type="checkbox" className="mt-0.5" checked={Boolean(picked?.values?.includes(choice))} onChange={() => onChange(toggleChoice(picked, choice))} />
                  <span className="min-w-0 break-words">{choice}</span>
                </label>
              </li>
            ))}
          </ul>
          {!count && <p className="text-[11px] text-text-secondary">No choice matches.</p>}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {[[lo, 'From'], [hi, 'To']].map(([side, word]) => (
            <label key={side} className="space-y-0.5">
              <span className="block text-[11px] text-text-secondary">{word}</span>
              <input dir="auto" type={kind === 'number' ? 'number' : 'date'} value={picked?.[side] ?? ''} onChange={edge(side)} aria-label={`${name} ${word.toLowerCase()}`} className={FIELD} />
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <button type="button" className={LINK} onClick={() => onChange(null)} disabled={!filterOn(picked)}>Clear</button>
        <button type="button" className={LINK} onClick={() => onClose(true)}>Done</button>
      </div>
    </div>
  );
}

function FilterButton({ column, kind, choices, picked, onChange }) {
  const [at, setAt] = useState(null);
  const button = useRef(null);
  const name = columnName(column);
  const on = filterOn(picked);
  const close = (focus) => {
    setAt(null);
    if (focus) button.current?.focus();
  };
  const toggle = (e) => {
    e.stopPropagation();
    if (at) { close(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8)) });
  };
  return (
    <>
      <button ref={button} type="button" data-grid-filter={column.key} aria-label={`Filter ${name}${on ? ', on' : ''}`} title={`Filter ${name}`}
        aria-haspopup="dialog" aria-expanded={Boolean(at)} onClick={toggle}
        className={`inline-flex shrink-0 items-center rounded p-0.5 hover:bg-bg-subtle ${on ? 'text-db-red-fg' : 'text-text-tertiary hover:text-text-primary'}`}>
        <Funnel size={10} aria-hidden fill={on ? 'currentColor' : 'none'} />
      </button>
      {at && (
        <BodyPortal>
          <FilterPanel column={column} kind={kind} choices={choices} picked={picked} onChange={onChange} onClose={close} at={at} />
        </BodyPortal>
      )}
    </>
  );
}

export default function DataGrid({
  columns: given, rows: all, rowKey, label, grid, pageSize = 0, empty = '', scrollClassName = 'overflow-x-auto', tableClassName = 'w-full',
  theadClassName = '', headRowClassName = '', headClassName = '', cellClassName = '', rowClassName, rowProps, initialSort = null,
}) {
  const rows = useMemo(() => all || [], [all]);
  const { ordered, order, moved, keep } = useColumnOrder(given, grid);
  const [sort, setSort] = useState(initialSort);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  const [said, setSaid] = useState('');
  const [drag, setDrag] = useState('');
  const [over, setOver] = useState('');
  const focusKey = useRef('');
  const head = useRef(null);
  const kinds = useMemo(() => Object.fromEntries(given.map((c) => [c.key, columnKind(c, rows)])), [given, rows]);
  const nums = useMemo(() => Object.fromEntries(given.map((c) => [c.key, !c.render && numericColumn(c, rows, kinds[c.key])])), [given, rows, kinds]);
  const choices = useMemo(() => Object.fromEntries(given.filter((c) => filterable(c) && kinds[c.key] === 'text').map((c) => [c.key, choicesOf(rows, c)])), [given, rows, kinds]);
  const kept = useMemo(() => filterRows(rows, given, kinds, filters), [rows, given, kinds, filters]);
  const sorted = useMemo(() => {
    const column = sort && given.find((c) => c.key === sort.key);
    return column ? sortRows(kept, column, sort.dir, kinds[column.key]) : kept;
  }, [kept, sort, given, kinds]);
  useEffect(() => {
    if (!focusKey.current) return;
    head.current?.querySelector(`th[data-col="${CSS.escape(focusKey.current)}"] [data-grid-move]`)?.focus();
    focusKey.current = '';
  });
  const step = pageSize > 0 ? pageSize : Math.max(1, sorted.length);
  const pages = Math.max(1, Math.ceil(sorted.length / step));
  const from = Math.min(page, pages - 1) * step;
  const shown = sorted.slice(from, from + step);
  const setFilter = (key, value) => {
    setFilters((f) => {
      const next = { ...f };
      if (filterOn(value)) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(0);
  };
  const clearFilters = () => { setFilters({}); setPage(0); };
  const move = (key, to) => {
    const after = moveKey(order, key, to);
    if (sameOrder(after, order)) return;
    keep(after);
    setSaid(`${columnName(given.find((c) => c.key === key))} moved to column ${after.indexOf(key) + 1} of ${after.length}.`);
    focusKey.current = key;
  };
  const reset = () => {
    keep(movableKeys(given));
    setSaid('The columns are back in their first order.');
  };
  const pressed = (key) => (e) => {
    const by = MOVE_KEYS[e.key];
    const to = by ? order.indexOf(key) + by : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    move(key, to);
  };
  const target = (e) => {
    const th = document.elementFromPoint(e.clientX, e.clientY)?.closest('th[data-col]');
    const key = th && head.current?.contains(th) ? th.dataset.col : '';
    return order.includes(key) ? key : '';
  };
  const grab = (key) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag(key);
    },
    onPointerMove: (e) => { if (drag) setOver(target(e)); },
    onPointerUp: (e) => {
      const to = drag ? target(e) : '';
      const was = drag;
      setDrag('');
      setOver('');
      if (was && to && to !== was) move(was, order.indexOf(to));
    },
    onPointerCancel: () => { setDrag(''); setOver(''); },
  });
  const on = filtersOn(filters);
  const texts = ordered.map((c) => filterText(c, kinds[c.key], filters[c.key])).filter(Boolean);
  const seen = new Map();
  const keys = shown.map((row, i) => {
    const key = rowKey ? String(rowKey(row, from + i)) : String(from + i);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return n ? `${key}#${n}` : key;
  });
  return (
    <div data-grid={grid || ''}>
      {(on > 0 || moved) && (
        <div data-grid-tools="" className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary">
          {on > 0 && <span data-grid-filters="">{on === 1 ? '1 column filter on' : `${on} column filters on`}: {texts.join('; ')}</span>}
          {on > 0 && <button type="button" className={LINK} onClick={clearFilters}>Clear column filters</button>}
          {moved && <button type="button" className={LINK} onClick={reset} data-grid-reset="">Reset column order</button>}
        </div>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-grid-moved="">{said}</span>
      <div className={scrollClassName}>
        <table className={tableClassName} aria-label={label}>
          <thead ref={head} className={theadClassName || undefined}>
            <tr className={headRowClassName || undefined}>
              {ordered.map((c) => {
                const name = columnName(c);
                const sortable = !c.fixed && c.sortable !== false;
                const canFilter = filterable(c) && (kinds[c.key] !== 'text' || choices[c.key]?.length > 0);
                const dir = sort?.key === c.key ? sort.dir : 0;
                return (
                  <th key={c.key} data-col={c.key} data-num={nums[c.key] ? '' : undefined} scope="col" aria-sort={dir ? (dir > 0 ? 'ascending' : 'descending') : undefined}
                    className={`${c.headClassName ?? headClassName} ${over === c.key && drag !== c.key ? 'bg-db-red-50' : ''}`.trim()}>
                    <span className="inline-flex max-w-full flex-wrap items-center gap-0.5 align-middle">
                      {!c.fixed && (
                        <button type="button" data-grid-move="" aria-label={`Move the ${name} column`} title="Drag to move this column, or use the left and right arrow keys"
                          onKeyDown={pressed(c.key)} onClick={(e) => e.stopPropagation()} {...grab(c.key)}
                          className="inline-flex shrink-0 cursor-grab touch-none items-center rounded p-0.5 text-text-tertiary hover:bg-bg-subtle hover:text-text-primary active:cursor-grabbing">
                          <GripVertical size={10} aria-hidden />
                        </button>
                      )}
                      {sortable ? (
                        <button type="button" data-grid-sort="" className="inline-flex items-center gap-0.5 text-start hover:text-text-primary"
                          onClick={() => { setSort((s) => nextSort(s, c.key, kinds[c.key])); setPage(0); }}>
                          {c.label}
                          {dir > 0 && <ArrowUp size={10} aria-hidden />}
                          {dir < 0 && <ArrowDown size={10} aria-hidden />}
                        </button>
                      ) : <span className={c.hideLabel ? 'sr-only' : ''}>{c.label}</span>}
                      {canFilter && <FilterButton column={c} kind={kinds[c.key]} choices={choices[c.key] || []} picked={filters[c.key]} onChange={(v) => setFilter(c.key, v)} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const extra = rowProps ? rowProps(row) : {};
              const classes = [rowClassName ? rowClassName(row, from + i) : '', extra.className || ''].filter(Boolean).join(' ') || undefined;
              return (
                <tr key={keys[i]} {...extra} className={classes}>
                  {ordered.map((c) => {
                    const value = cellOf(c)(row);
                    return (
                      <td key={c.key} data-num={nums[c.key] ? '' : undefined} className={typeof c.className === 'function' ? c.className(row) : (c.className ?? cellClassName)}>
                        {c.render ? c.render(row) : !present(value) ? '' : nums[c.key] ? String(value) : <bdi>{String(value)}</bdi>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && empty && <p className="py-2 text-[11px] text-text-secondary">{empty}</p>}
      {rows.length > 0 && !kept.length && (
        <p data-grid-none="" className="py-2 text-[11px] text-text-secondary">
          No row matches these column filters. <button type="button" className={LINK} onClick={clearFilters}>Clear column filters</button>
        </p>
      )}
      {pageSize > 0 && sorted.length > pageSize && (
        <div data-grid-pager="" className="flex items-center justify-end gap-2 py-1.5 text-[11px] text-text-secondary">
          <span>Rows {(from + 1).toLocaleString('en-US')}-{Math.min(from + step, sorted.length).toLocaleString('en-US')} of {sorted.length.toLocaleString('en-US')}</span>
          <button type="button" className={LINK} onClick={() => setPage(from / step - 1)} disabled={from === 0}>Previous</button>
          <button type="button" className={LINK} onClick={() => setPage(from / step + 1)} disabled={from + step >= sorted.length}>Next</button>
        </div>
      )}
    </div>
  );
}
