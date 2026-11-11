import { useCallback, useEffect, useState } from 'react';
import { getUsage } from './api.js';
import { Icon } from './icons.jsx';
import DataTable from './DataTable.jsx';
import { PlainNote } from './ui.jsx';
import { ADMIN_ROUTE, NO_PEOPLE, USAGE_RECORDED, USAGE_UNRECORDED, usageView } from './admin.js';
import { SectionHelp } from './SectionHelp.jsx';

const REFUSED = [401, 403];

function usageColumns(first, lead, kinds) {
  return [
    { key: 'name', label: first, render: (r) => <><b>{r.name}</b>{r.errors?.map((e) => <small key={e} className="usage-err">{e}</small>)}</> },
    ...lead.map((h, i) => ({ key: `lead_${i}`, label: h.label, num: !!h.num, sortValue: (r) => r.amounts.lead[i], render: (r) => r.lead[i] })),
    ...kinds.map((k, i) => ({ key: `kind_${k.id}`, label: k.label, num: true, sortValue: (r) => r.amounts.cells[i], render: (r) => r.cells[i] })),
    { key: 'total', label: 'All', num: true, sortValue: (r) => r.amounts.total, render: (r) => <b>{r.total}</b> },
    { key: 'last', label: 'Last change', date: true, className: 'nw', sortValue: (r) => r.amounts.last, render: (r) => r.last },
  ];
}

function UsageTable({ label, first, kinds, rows, lead }) {
  return (
    <section className="card card--table" aria-label={label}>
      <header className="card-h"><div><h2>{label}</h2></div><SectionHelp title={label} steps={[{ title: label, text: "The owners' controls for this use case: who sees it and how it is set up." }]} /></header>
      <DataTable label={label} tableClass="tbl--usage" columns={usageColumns(first, lead, kinds)} rows={rows} rowKey={(r) => r.key} grid={`admin:${first}`} />
    </section>
  );
}

function Usage({ view }) {
  return (
    <>
      <p className="note"><Icon name="info" size={14} />{USAGE_RECORDED} {USAGE_UNRECORDED}</p>
      <UsageTable label="By use case" first="Use case" lead={[{ label: 'People', num: true }]} kinds={view.kinds}
        rows={view.pages.map((p) => ({ key: p.id, name: p.title, lead: [p.people], cells: p.cells, total: p.total, last: p.last, errors: p.errors, amounts: p.amounts }))} />
      {view.people.length > 0
        ? <UsageTable label="By person" first="Person" lead={[{ label: 'Use cases' }]} kinds={view.kinds}
          rows={view.people.map((p) => ({ key: p.who, name: p.who, lead: [p.pages], cells: p.cells, total: p.total, last: p.last, amounts: p.amounts }))} />
        : <p className="more">{NO_PEOPLE}</p>}
    </>
  );
}

export function AdminLink({ on }) {
  return (
    <a className={`admin-link top-ic ${on ? 'is-on' : ''}`} data-more="tight" href={`#/${ADMIN_ROUTE}`} aria-current={on ? 'page' : undefined} aria-label="Admin" title="Admin">
      <Icon name="lock" size={13} /><span>Admin</span>
    </a>
  );
}

export default function Admin() {
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => getUsage().then((data) => setState({ data, error: null })).catch((error) => setState({ data: null, error })), []);
  useEffect(() => { load(); }, [load]);
  const refused = REFUSED.includes(state.error?.status);
  const view = state.data ? usageView(state.data) : null;
  return (
    <div className="page admin">
      <div className="pg-h"><div><h1>Admin</h1><p>{view ? `${view.title}. ${view.since}` : 'How people use this App. Only its owners can open this page.'}</p></div></div>
      {!state.data && !state.error && <p className="more" role="status">Loading the usage…</p>}
      {state.error && (refused
        ? <PlainNote text={state.error.message} icon={<Icon name="lock" size={14} />} className="refused" role="alert" />
        : <PlainNote text={state.error.message} prefix="The usage could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={load} />)}
      {view && <Usage view={view} />}
    </div>
  );
}
