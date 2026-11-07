import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { GenieMark, Icon } from './icons.jsx';
import { DATE_FORMATS, cellText, compareValues, isAmount, numberOf, plainText, plainWords } from './format.js';
import { askGenieAbout } from './genieAsk.js';
import { ColumnFilterStatus, withColumnFilters } from './ColumnFilters.jsx';
import { columnFiltersOn, withValue } from './filters.js';
import { columnName, filterRows, localFilters, movableKeys, moveKey, orderColumns, sameOrder, savedOrder } from './grid.js';
import { useMyView } from './MyView.jsx';
import { columnOrder, setColumnOrder } from './prefs.js';
import { AskGenie } from './AskGenie.jsx';

const NUMERIC = ['number', 'currency', 'integer', 'percent'];
const MOVE_KEYS = { ArrowLeft: -1, ArrowRight: 1 };

export function columnOf(c, onFilter) {
  const num = NUMERIC.includes(c.format || 'number');
  return {
    key: c.column, label: plainWords(c.label), num, date: DATE_FORMATS.includes(c.format), bar: c.bar,
    render: (row) => {
      const text = cellText(row[c.column], { ...c, format: c.format || 'text' });
      if (c.filter && onFilter && row[c.column] != null) {
        return <button className="link" style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); onFilter(c.filter, row[c.column]); }} title={`Filter the page to ${text}`}>{num ? text : <bdi>{text}</bdi>}</button>;
      }
      return text;
    },
  };
}

export function RowAsk({ about }) {
  return (
    <button type="button" className="row-ask" aria-label={`Ask Genie about ${about.label}`}
      onClick={(e) => { e.stopPropagation(); askGenieAbout(about); }} onKeyDown={(e) => e.stopPropagation()}>
      <GenieMark size={13} /><span>Ask Genie</span>
    </button>
  );
}

export function RowGenie({ about, element }) {
  if (about) return <RowAsk about={about} />;
  return element ? <AskGenie kind={element.kind || 'record'} title={element.title} context={element.context} page={element.page} /> : null;
}

export function RowDetails({ title, fields, element, onClose }) {
  return (
    <div className="row-detail" role="group" aria-label={`Details of ${title}`} data-row-detail>
      <div className="mgrid">{Object.entries(fields || {}).map(([label, value]) => (
        <div key={label}><span>{label}</span><b>{value == null || value === '' ? 'Not recorded' : Array.isArray(value) ? value.join(', ') : String(value)}</b></div>
      ))}</div>
      <div className="row-detail-f"><RowGenie element={element} /><span className="sp" /><button type="button" className="link" onClick={onClose}>Close</button></div>
    </div>
  );
}

function askColumn(askAbout, askRow) {
  return {
    key: '_ask', label: 'Ask Genie', hideLabel: true, fixed: true, className: 'ask-c',
    render: (row) => <RowGenie about={askAbout?.(row)} element={askRow?.(row)} />,
  };
}

function useColumnOrder(columns, grid) {
  const { prefs, update, stored } = useMyView();
  const [session, setSession] = useState(null);
  const natural = movableKeys(columns);
  const kept = grid && stored;
  const saved = kept ? columnOrder(prefs, grid) : session;
  const order = savedOrder(natural, saved);
  const keep = (next) => {
    const chosen = sameOrder(next, natural) ? null : next;
    if (kept) update((p) => setColumnOrder(p, grid, chosen));
    else setSession(chosen);
  };
  return { ordered: orderColumns(columns, saved), order, moved: !sameOrder(order, natural), keep };
}

const isolated = (c, v) => (!c.num && typeof v === 'string' && v ? <bdi>{v}</bdi> : v);

const cellClass = (c, row) => [c.num ? 'num' : '', c.className || '', row && c.cellClass ? c.cellClass(row) : ''].filter(Boolean).join(' ') || undefined;

export default function DataTable({ columns: given, rows: all, initialSort, rowKey, onRow, empty = 'No row matches these filters.', label, sort: served, onSort, paged = true,
  rowClass, rowProps, detail, detailClass = 'tbl-detail', askAbout, askRow, grid, filtering = 'local', tableClass = '' }) {
  const base = askAbout || askRow ? [...given, askColumn(askAbout, askRow)] : given;
  const rows = all || [];
  const { ordered, order, moved, keep } = useColumnOrder(base, grid);
  const [own, setOwn] = useState(initialSort || null);
  const [picked, setPicked] = useState({});
  const [said, setSaid] = useState('');
  const [over, setOver] = useState('');
  const [focusKey, setFocusKey] = useState('');
  const drag = useRef(null);
  const head = useRef(null);
  const local = filtering === 'local';
  const sort = onSort ? served : own;
  const [at, setAt] = useState(0);
  const [size, setSize] = useState(12);
  useEffect(() => { setAt(0); }, [all, picked]);
  const filters = useMemo(() => (local ? localFilters(base, rows) : []), [local, base, rows]);
  const kept = useMemo(() => (local ? filterRows(rows, base, filters, picked) : rows), [local, rows, base, filters, picked]);
  const columns = local ? withColumnFilters(ordered, filters, picked, (column, value) => setPicked((p) => withValue(p, column, value)), null, null) : ordered;
  const sorted = useMemo(() => {
    if (!sort || onSort) return kept;
    const col = base.find((c) => c.key === sort.key);
    const value = col?.sortValue || ((r) => r[sort.key]);
    return [...kept].sort((a, b) => compareValues(value(a), value(b)) * sort.dir);
  }, [kept, sort, base, onSort]);
  useEffect(() => {
    if (!focusKey) return;
    head.current?.querySelector(`th[data-col="${CSS.escape(focusKey)}"] .th-move`)?.focus();
    setFocusKey('');
  }, [focusKey]);
  const max = useMemo(() => Object.fromEntries(columns.filter((c) => c.bar).map((c) => [c.key, Math.max(1e-9, ...rows.map((r) => Math.abs(numberOf(r[c.key]))))])), [rows, columns]);
  const step = paged ? size : Math.max(1, sorted.length);
  const pages = Math.max(1, Math.ceil(sorted.length / step));
  const from = Math.min(at, pages - 1) * step;
  const shown = sorted.slice(from, from + step);
  const seen = new Map();
  const keys = shown.map((row, i) => {
    const key = rowKey ? String(rowKey(row)) : String(from + i);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return n ? `${key}#${n}` : key;
  });
  const next = (s, key) => (s?.key === key ? { key, dir: -s.dir } : { key, dir: base.find((c) => c.key === key)?.num ? -1 : 1 });
  const click = (key) => (onSort ? onSort(next(sort, key)) : setOwn((s) => next(s, key)));
  const move = (key, to) => {
    const after = moveKey(order, key, to);
    if (sameOrder(after, order)) return;
    keep(after);
    const c = base.find((x) => x.key === key);
    setSaid(`${columnName(c)} moved to column ${after.indexOf(key) + 1} of ${after.length}.`);
    setFocusKey(key);
  };
  const reset = () => {
    keep(movableKeys(base));
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
      drag.current = key;
    },
    onPointerMove: (e) => { if (drag.current) setOver(target(e)); },
    onPointerUp: (e) => {
      const from = drag.current;
      const to = from ? target(e) : '';
      drag.current = null;
      setOver('');
      if (from && to && to !== from) move(from, order.indexOf(to));
    },
    onPointerCancel: () => { drag.current = null; setOver(''); },
  });
  const width = columns.length;
  const filtered = local && columnFiltersOn(picked) > 0;
  return (
    <>
      {(filtered || moved) && (
        <div className="tbl-tools">
          {filtered && <ColumnFilterStatus filters={filters} values={picked} onClear={() => setPicked({})} />}
          {moved && <button type="button" className="link" onClick={reset} data-reset-columns>Reset column order</button>}
        </div>
      )}
      <span className="sr" aria-live="polite" aria-atomic="true" data-moved>{said}</span>
      <div className="tbl-wrap">
        <table className={`tbl ${tableClass}`.trim()} aria-label={label}>
          <thead ref={head}>
            <tr>
              {columns.map((c) => {
                const name = columnName(c);
                const sortable = !c.fixed && c.sortable !== false;
                return (
                  <th key={c.key} data-col={c.key} className={[cellClass(c), over === c.key && drag.current !== c.key ? 'is-drop' : ''].filter(Boolean).join(' ') || undefined}
                    aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                    <span className="th-in">
                      {!c.fixed && (
                        <button type="button" className="th-move" aria-label={`Move the ${name} column`} title="Drag to move this column, or use the left and right arrow keys"
                          onKeyDown={pressed(c.key)} onClick={(e) => e.stopPropagation()} {...grab(c.key)}>
                          <Icon name="grip" size={12} />
                        </button>
                      )}
                      {sortable
                        ? <button type="button" className="th-sort" onClick={() => click(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>
                        : <span className={c.hideLabel ? 'sr' : ''}>{c.label}</span>}
                      {!c.fixed && c.control}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const more = detail ? detail(row) : null;
              return (
                <Fragment key={keys[i]}>
                  <tr className={[onRow ? 'is-click' : '', rowClass ? rowClass(row) : ''].filter(Boolean).join(' ') || undefined} onClick={onRow ? () => onRow(row) : undefined}
                    {...(rowProps ? rowProps(row) : {})}>
                    {columns.map((c) => (
                      <td key={c.key} className={cellClass(c, row)}>
                        {c.bar && isAmount(row[c.key] ?? 0) && <span className="bar"><i style={{ width: `${((Math.abs(numberOf(row[c.key])) / max[c.key]) * 100).toFixed(1)}%` }} /></span>}
                        {isolated(c, c.render ? c.render(row) : plainText(row[c.key]))}
                      </td>
                    ))}
                  </tr>
                  {more && <tr className={detailClass}><td colSpan={width}>{more}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="more">{empty}</p>}
      {rows.length > 0 && !kept.length && <p className="more">No row matches these column filters.</p>}
      {paged && sorted.length > 12 && (
        <div className="pager">
          <span>Rows per page</span>
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setAt(0); }} aria-label="Rows per page">
            {[12, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="sp" />
          <span className="pager-n">{from + 1}-{Math.min(from + size, sorted.length)} of {sorted.length.toLocaleString('en-US')}</span>
          <button className="ibtn ibtn--sm" onClick={() => setAt(Math.max(0, from / size - 1))} disabled={from === 0} aria-label="Previous page"><Icon name="left" size={15} /></button>
          <button className="ibtn ibtn--sm" onClick={() => setAt(from / size + 1)} disabled={from + size >= sorted.length} aria-label="Next page"><Icon name="right" size={15} /></button>
        </div>
      )}
    </>
  );
}
