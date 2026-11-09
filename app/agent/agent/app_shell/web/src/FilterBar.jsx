import { useEffect, useMemo, useRef, useState } from 'react';
import { GenieMark, Icon } from './icons.jsx';
import { Popover, useDebounced } from './ui.jsx';
import { getFilterOptions } from './api.js';
import { CHOICES_SHOWN, choicesHint, choosePreset, clearSelections, hasSelections, matching, searchHint, setRangeEdge, setSelection } from './filters.js';
import { DEFAULT_VIEW, OWNER_CHOICES, SHOW_CHOICES, hasReasons, setReason, viewIsDefault } from './hub.js';
import { AskGenie } from './AskGenie.jsx';

function useOptionSearch(pageId, filter, query) {
  const q = useDebounced(query.trim(), 250);
  const [found, setFound] = useState({ q: '', options: null, busy: false, error: '' });
  const seq = useRef(0);
  const which = JSON.stringify(filter.which || { filter: filter.id });
  useEffect(() => {
    const mine = ++seq.current;
    if (!filter.searchable || (!q && !filter.lazy)) {
      setFound({ q: '', options: null, busy: false, error: '' });
      return;
    }
    setFound((f) => ({ ...f, busy: true, error: '' }));
    getFilterOptions(pageId, JSON.parse(which), q)
      .then((d) => { if (mine === seq.current) setFound({ q, options: (d.options || []).map(String), busy: false, error: '' }); })
      .catch((e) => { if (mine === seq.current) setFound({ q, options: [], busy: false, error: e.message }); });
  }, [pageId, which, filter.searchable, filter.lazy, q]);
  return found;
}

export function ChoicePopover({ anchor, filter, selected, onChange, onClose, pageId }) {
  const [query, setQuery] = useState('');
  const body = useRef(null);
  const found = useOptionSearch(pageId, filter, query);
  const options = useMemo(() => {
    const local = matching(filter.options, query);
    if (!filter.searchable) return local;
    const pool = found.options && found.q === query.trim() ? found.options : local;
    return [...selected, ...pool.filter((v) => !selected.includes(v))];
  }, [filter.options, filter.searchable, query, found, selected]);
  const hint = searchHint(filter, query, found) || choicesHint(options.length);
  const shown = options.slice(0, CHOICES_SHOWN);
  const searching = (filter.options || []).length > 8 || filter.searchable;
  useEffect(() => { if (!searching) body.current?.querySelector('input')?.focus({ preventScroll: true }); }, []);
  return (
    <Popover anchor={anchor} onClose={onClose} label={filter.label} width={260}>
      <div ref={body}>
        {searching && (
          <label className="msel-search"><Icon name="search" size={13} /><input dir="auto" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${filter.label.toLowerCase()}`} aria-label={`Search ${filter.label}`} maxLength={300} /></label>
        )}
        {hint && <p className="msel-hint" role="status">{hint}</p>}
        <div className="msel-pop" role="listbox" aria-multiselectable="true" aria-label={filter.label}>
          {shown.map((v) => (
            <label key={v} className="opt">
              <input type="checkbox" checked={selected.includes(String(v))} onChange={() => onChange(selected.includes(String(v)) ? selected.filter((x) => x !== String(v)) : [...selected, String(v)])} />
              <span className="trunc">{String(v)}</span>
            </label>
          ))}
          {!options.length && <p className="msel-none">No choice matches.</p>}
        </div>
        <div className="msel-acts">
          <button className="link" onClick={() => onChange(shown.map(String))}>Select shown</button>
          <button className="link" onClick={() => onChange([])}>Clear</button>
        </div>
      </div>
    </Popover>
  );
}

function MultiSelect({ filter, selected, onChange, pageId, mark }) {
  const button = useRef(null);
  const [open, setOpen] = useState(false);
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <div className={`fld ${mark ? 'fld--ai' : ''}`}>
      <span>{mark || <Icon name="filter" size={12} />}{filter.label}</span>
      <button ref={button} className="msel" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!!filter.error && !filter.options}>
        <b>{summary}</b><Icon name="down" size={14} />
      </button>
      {filter.error && <span className="fld-err">Could not load the choices</span>}
      {open && <ChoicePopover anchor={button.current} filter={filter} selected={selected} onChange={onChange} onClose={() => setOpen(false)} pageId={pageId} />}
    </div>
  );
}

function DateRange({ filter, value, onState, state }) {
  const custom = value?.preset === 'custom';
  return (
    <>
      <label className="fld fld--range">
        <span><Icon name="calendar" size={13} />{filter.label}</span>
        <select value={value?.preset || 'all'} onChange={(e) => onState(choosePreset(state, filter, e.target.value))} disabled={!filter.presets?.length}>
          {(filter.presets || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Pick dates</option>
        </select>
        {filter.error && <span className="fld-err">Could not read the dates</span>}
      </label>
      {custom && (
        <>
          <label className="fld"><span>From</span><input type="date" value={value.from} min={filter.low || undefined} max={value.to || filter.high || undefined} onChange={(e) => e.target.value && onState(setRangeEdge(state, filter.id, 'from', e.target.value))} /></label>
          <label className="fld"><span>To</span><input type="date" value={value.to} min={value.from || filter.low || undefined} max={filter.high || undefined} onChange={(e) => e.target.value && onState(setRangeEdge(state, filter.id, 'to', e.target.value))} /></label>
        </>
      )}
    </>
  );
}

function Choice({ label, value, choices, onChange }) {
  return (
    <label className="fld fld--pick">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>{choices.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select>
    </label>
  );
}

const chosen = (values) => (values?.length ? values.join(', ') : 'All');
const picked = (choices, value) => (choices.find(([v]) => v === value) || [value, value])[1];

function controlFields(filters, now, reasons, view) {
  const fields = {};
  reasons.forEach((r) => { fields[r.label] = chosen(now.ai?.[r.name]); });
  filters.forEach((f) => {
    if (f.type === 'multi_select') fields[f.label] = chosen(now.sel[f.id]);
    else if (f.type === 'date_range') {
      const value = now.range[f.id];
      fields[f.label] = value?.preset === 'custom' ? `${value.from || '…'} to ${value.to || '…'}` : (f.presets || []).find((p) => p.id === value?.preset)?.label || 'All';
    }
  });
  if (view) Object.assign(fields, { Owner: picked(OWNER_CHOICES, view.owner), Show: picked(SHOW_CHOICES, view.show) });
  return fields;
}

export default function FilterBar({ meta, state, onState, pageId, reasons = [], view, onView }) {
  if (!meta && !view) return null;
  const filters = meta || [];
  const now = state || { range: {}, sel: {} };
  const ai = now.ai || {};
  const chips = [
    ...reasons.flatMap((r) => (ai[r.name] || []).map((v) => ({ id: r.name, label: r.label, v, drop: () => onState(setReason(now, r.name, ai[r.name].filter((x) => x !== v))) }))),
    ...filters.filter((f) => f.type === 'multi_select').flatMap((f) => (now.sel[f.id] || []).map((v) => ({
      id: f.id, label: f.label, v, drop: () => onState(setSelection(now, f.id, (now.sel[f.id] || []).filter((x) => x !== v))),
    }))),
  ];
  const dirty = hasSelections(now) || hasReasons(now) || (view && !viewIsDefault(view));
  const clear = () => {
    if (hasSelections(now) || hasReasons(now)) onState({ ...clearSelections(now), ai: {} });
    if (view) onView(DEFAULT_VIEW);
  };
  return (
    <>
      <section className="fbar" aria-label="Filters" data-tour="filters">
        {reasons.map((r) => (
          <MultiSelect key={r.name} filter={{ id: r.name, label: r.label, options: r.options }} selected={ai[r.name] || []} pageId={pageId}
            mark={<GenieMark size={12} />} onChange={(values) => onState(setReason(now, r.name, values))} />
        ))}
        {filters.filter((f) => f.type === 'date_range').map((f) => <DateRange key={f.id} filter={f} value={now.range[f.id]} state={now} onState={onState} />)}
        {filters.filter((f) => f.type === 'multi_select').map((f) => (
          <MultiSelect key={f.id} filter={f} selected={now.sel[f.id] || []} pageId={pageId} onChange={(values) => onState(setSelection(now, f.id, values))} />
        ))}
        {view && (
          <>
            <Choice label="Owner" value={view.owner} choices={OWNER_CHOICES} onChange={(owner) => onView({ ...view, owner })} />
            <Choice label="Show" value={view.show} choices={SHOW_CHOICES} onChange={(show) => onView({ ...view, show })} />
          </>
        )}
        <span className="sp" />
        {dirty && <button className="link" onClick={clear}>Clear filters</button>}
        <AskGenie kind="controls" title="Filters" context={{ fields: controlFields(filters, now, reasons, view) }} />
      </section>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={`${c.id}:${c.v}`} className="chip" onClick={c.drop} aria-label={`Remove ${c.label} ${c.v}`}>
              {c.label}: {c.v}<Icon name="x" size={12} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
