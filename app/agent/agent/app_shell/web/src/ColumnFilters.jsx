import { useCallback, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Popover } from './ui.jsx';
import { ChoicePopover } from './FilterBar.jsx';
import { RANGE_EDGES, columnFilterOn, columnFilterText, columnFiltersOn, rangeProblem, rangeValue } from './filters.js';

const inputText = (v) => (v == null ? '' : String(v));

function RangePopover({ anchor, filter, value, onChange, onClose }) {
  const [lo, hi] = RANGE_EDGES[filter.type];
  const [form, setForm] = useState({ low: inputText(value?.[lo]), high: inputText(value?.[hi]) });
  const dates = filter.type === 'date_range';
  const problem = rangeProblem(filter.type, form.low, form.high);
  const field = (edge, label) => (
    <label className="in"><span>{label}</span>
      <input type={dates ? 'date' : 'number'} step={dates ? undefined : 'any'} inputMode={dates ? undefined : 'decimal'} value={form[edge]}
        autoFocus={edge === 'low'} aria-invalid={problem ? true : undefined} onChange={(e) => setForm((f) => ({ ...f, [edge]: e.target.value }))} />
    </label>
  );
  const submit = (e) => {
    e.preventDefault();
    if (problem) return;
    onChange(rangeValue(filter.type, form.low, form.high));
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Filter ${filter.label}`} width={240}>
      <form className="cf-form" onSubmit={submit} noValidate>
        {field('low', 'From')}
        {field('high', 'To')}
        {problem && <small className="in-err" role="alert">{problem}</small>}
        <div className="cf-acts">
          <button type="button" className="link" onClick={() => { onChange(null); onClose(); }}>Clear</button>
          <button type="submit" className="btn btn--pri" disabled={!!problem}>Apply</button>
        </div>
      </form>
    </Popover>
  );
}

function ColumnFilter({ filter, value, onChange, pageId, which, named = false }) {
  const button = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const on = columnFilterOn(value);
  const said = on ? `, ${columnFilterText(filter, value)}` : '';
  const toggle = (e) => { e.stopPropagation(); setOpen(!open); };
  return (
    <>
      <button ref={button} type="button" className={`cf-b ${on ? 'is-on' : ''} ${named ? 'cf-b--named' : ''}`} aria-haspopup="dialog"
        aria-expanded={open} aria-label={`Filter ${filter.label}${said}`} title={`Filter ${filter.label}${said}`} onClick={toggle}>
        {named && <span>{filter.label}</span>}<Icon name="filter" size={12} />
      </button>
      {open && filter.type === 'multi_select' && (
        <ChoicePopover anchor={button.current} filter={{ ...filter, id: filter.column, which }} selected={Array.isArray(value) ? value : []}
          onChange={onChange} onClose={close} pageId={pageId} />
      )}
      {open && filter.type !== 'multi_select' && <RangePopover anchor={button.current} filter={filter} value={value} onChange={onChange} onClose={close} />}
    </>
  );
}

export function withColumnFilters(columns, filters, values, onChange, pageId, table, hosted = {}) {
  if (!filters?.length) return columns;
  const by = new Map(filters.map((f) => [f.column, f]));
  const which = (column) => (table == null ? { column } : { table, column });
  const control = (column, named = false) => {
    const f = by.get(column);
    return f ? <ColumnFilter key={column} filter={f} value={values?.[column]} onChange={(v) => onChange(column, v)} pageId={pageId} which={which(column)} named={named} /> : null;
  };
  return columns.map((c) => {
    const extra = (hosted[c.key] || []).filter((column) => by.has(column));
    if (!by.has(c.key) && !extra.length) return c;
    return { ...c, control: <>{control(c.key)}{extra.map((column) => control(column, true))}</> };
  });
}

export function ColumnFilterStatus({ filters, values, onClear }) {
  if (!filters?.length) return null;
  const n = columnFiltersOn(values);
  return (
    <>
      <span className="cf-n" role="status">{n ? `${n} ${n === 1 ? 'column filter' : 'column filters'} on` : ''}</span>
      {n > 0 && <button type="button" className="link" onClick={onClear}>Clear filters</button>}
    </>
  );
}
