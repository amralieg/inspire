import { useEffect, useState } from 'react';
import { getUsage } from './api.js';
import { Icon } from './icons.jsx';
import { ADMIN_ROUTE, NO_PEOPLE, USAGE_RECORDED, USAGE_UNRECORDED, usageView } from './admin.js';

const REFUSED = [401, 403];

function UsageTable({ label, first, kinds, rows, lead }) {
  return (
    <section className="card card--table" aria-label={label}>
      <header className="card-h"><div><h2>{label}</h2></div></header>
      <div className="tbl-wrap">
        <table className="tbl tbl--usage">
          <thead>
            <tr><th>{first}</th>{lead.map((h) => <th key={h}>{h}</th>)}{kinds.map((k) => <th key={k.id} className="num">{k.label}</th>)}<th className="num">All</th><th>Last change</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><b>{r.name}</b>{r.errors?.map((e) => <small key={e} className="usage-err">{e}</small>)}</td>
                {r.lead.map((v, i) => <td key={lead[i]}>{v}</td>)}
                {r.cells.map((v, i) => <td key={kinds[i].id} className="num">{v}</td>)}
                <td className="num"><b>{r.total}</b></td>
                <td className="nw">{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Usage({ view }) {
  return (
    <>
      <p className="note"><Icon name="info" size={14} />{USAGE_RECORDED} {USAGE_UNRECORDED}</p>
      <UsageTable label="By use case" first="Use case" lead={['People']} kinds={view.kinds}
        rows={view.pages.map((p) => ({ key: p.id, name: p.title, lead: [p.people], cells: p.cells, total: p.total, last: p.last, errors: p.errors }))} />
      {view.people.length > 0
        ? <UsageTable label="By person" first="Person" lead={['Use cases']} kinds={view.kinds}
          rows={view.people.map((p) => ({ key: p.who, name: p.who, lead: [p.pages], cells: p.cells, total: p.total, last: p.last }))} />
        : <p className="more">{NO_PEOPLE}</p>}
    </>
  );
}

export function AdminLink({ on }) {
  return (
    <a className={`admin-link ${on ? 'is-on' : ''}`} href={`#/${ADMIN_ROUTE}`} aria-current={on ? 'page' : undefined}>
      <Icon name="lock" size={13} />Admin
    </a>
  );
}

export default function Admin() {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    getUsage().then((data) => setState({ data, error: null })).catch((error) => setState({ data: null, error }));
  }, []);
  const refused = REFUSED.includes(state.error?.status);
  const view = state.data ? usageView(state.data) : null;
  return (
    <div className="page admin">
      <div className="pg-h"><div><h1>Admin</h1><p>{view ? `${view.title}. ${view.since}` : 'How people use this App. Only its owners can open this page.'}</p></div></div>
      {!state.data && !state.error && <p className="more" role="status">Loading the usage…</p>}
      {state.error && (
        <p className={refused ? 'refused' : 'tile-err'} role="alert">
          <Icon name={refused ? 'lock' : 'info'} size={14} />{refused ? state.error.message : `The usage could not load: ${state.error.message}`}
        </p>
      )}
      {view && <Usage view={view} />}
    </div>
  );
}
