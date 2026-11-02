import { useEffect, useMemo, useState } from 'react';
import { GenieMark, Icon } from './icons.jsx';
import { compareValues, formatValue, isAmount, numberOf, plainText } from './format.js';
import { askGenie } from './genieAsk.js';

const NUMERIC = ['number', 'currency', 'integer', 'percent'];

export function columnOf(c, onFilter) {
  const num = NUMERIC.includes(c.format || 'number');
  return {
    key: c.column, label: c.label, num, bar: c.bar,
    render: (row) => {
      const text = formatValue(row[c.column], c.format || 'text', c.currency);
      if (c.filter && onFilter && row[c.column] != null) {
        return <button className="link" style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); onFilter(c.filter, row[c.column]); }} title={`Filter the page to ${text}`}>{text}</button>;
      }
      return text;
    },
  };
}

export function RowAsk({ about }) {
  return (
    <button type="button" className="row-ask" aria-label={`Ask Genie about ${about.label}`}
      onClick={(e) => { e.stopPropagation(); askGenie({ ...about, question: '' }); }} onKeyDown={(e) => e.stopPropagation()}>
      <GenieMark size={13} /><span>Ask Genie</span>
    </button>
  );
}

function askColumn(askAbout) {
  return {
    key: '_ask', label: 'Ask Genie', hideLabel: true, sortable: false, className: 'ask-c',
    render: (row) => {
      const about = askAbout(row);
      return about ? <RowAsk about={about} /> : null;
    },
  };
}

export default function DataTable({ columns: given, rows, initialSort, rowKey, onRow, empty = 'No row matches these filters.', label, sort: served, onSort, paged = true,
  rowClass, askAbout }) {
  const columns = askAbout ? [...given, askColumn(askAbout)] : given;
  const [own, setOwn] = useState(initialSort || null);
  const sort = onSort ? served : own;
  const [at, setAt] = useState(0);
  const [size, setSize] = useState(12);
  useEffect(() => { setAt(0); }, [rows]);
  const sorted = useMemo(() => {
    if (!sort || onSort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const value = col?.sortValue || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => compareValues(value(a), value(b)) * sort.dir);
  }, [rows, sort, columns, onSort]);
  const max = useMemo(() => Object.fromEntries(columns.filter((c) => c.bar).map((c) => [c.key, Math.max(1e-9, ...rows.map((r) => Math.abs(numberOf(r[c.key]))))])), [rows, columns]);
  const step = paged ? size : Math.max(1, sorted.length);
  const pages = Math.max(1, Math.ceil(sorted.length / step));
  const from = Math.min(at, pages - 1) * step;
  const shown = sorted.slice(from, from + step);
  const seen = new Map();
  const keys = shown.map((row, i) => {
    const base = rowKey ? String(rowKey(row)) : String(from + i);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
  const next = (s, key) => (s?.key === key ? { key, dir: -s.dir } : { key, dir: columns.find((c) => c.key === key)?.num ? -1 : 1 });
  const click = (key) => (onSort ? onSort(next(sort, key)) : setOwn((s) => next(s, key)));
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? 'num' : c.className || ''} aria-sort={sort?.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  {c.sortable === false ? <span className={c.hideLabel ? 'sr' : ''}>{c.label}</span> : <button onClick={() => click(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>}
                  {c.control}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={keys[i]} className={[onRow ? 'is-click' : '', rowClass ? rowClass(row) : ''].filter(Boolean).join(' ')} onClick={onRow ? () => onRow(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : c.className || ''}>
                    {c.bar && isAmount(row[c.key] ?? 0) && <span className="bar"><i style={{ width: `${((Math.abs(numberOf(row[c.key])) / max[c.key]) * 100).toFixed(1)}%` }} /></span>}
                    {c.render ? c.render(row) : plainText(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="more">{empty}</p>}
      {paged && rows.length > 12 && (
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
