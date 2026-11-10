import { useEffect, useState } from 'react';
import { getAlerts } from './api.js';
import { readViews } from './links.js';
import { integer } from './format.js';
import { Icon } from './icons.jsx';
import FilterBar from './FilterBar.jsx';
import { ModeEmpty } from './ModeParts.jsx';
import { PlainNote } from './ui.jsx';
import { USAGE_UNRECORDED } from './admin.js';

export const NO_LIST = 'This page only shows results. It has no list to act on, so it has no row or bulk actions. Its tables are below.';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

function Work({ page, meta, state, onState, tableCard, views, notify }) {
  const tables = page.tables || [];
  return (
    <div className="mode-work mode-explore" data-mode-work="explore">
      <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={page.id} />
      <div className="mode-tools" data-explore-tools>
        {views}
        {notify}
      </div>
      {!page.records && <p className="note" data-no-list><Icon name="info" size={14} />{NO_LIST}</p>}
      {tables.length ? tables.map((t) => tableCard(t)) : <ModeEmpty>This use case shows no tables. Its charts and figures are on the Dashboard.</ModeEmpty>}
    </div>
  );
}

function Performance({ app, page }) {
  const [saved] = useState(() => readViews(browserStorage())[page.id] || []);
  const [alerts, setAlerts] = useState({ mine: null, error: '' });
  const [again, setAgain] = useState(0);
  const alerting = !!app.alerting?.on;
  useEffect(() => {
    if (!alerting) return undefined;
    let live = true;
    getAlerts(page.id).then((d) => { if (live) setAlerts({ mine: d?.caps?.mine ?? 0, error: '' }); })
      .catch((e) => { if (live) setAlerts({ mine: null, error: e.message }); });
    return () => { live = false; };
  }, [page.id, alerting, again]);
  return (
    <section className="card mode-usage" data-mode-performance="explore" aria-label="Usage">
      <header className="card-h"><div><h2>Usage</h2><p>How you use {page.title}, in this browser.</p></div></header>
      <div className="mode-stats">
        <div className="mode-stat" data-stat="views"><small>Saved views</small><b>{integer(saved.length)}</b></div>
        {alerting && <div className="mode-stat" data-stat="alerts"><small>Your alerts</small><b>{alerts.mine == null ? '…' : integer(alerts.mine)}</b></div>}
      </div>
      {alerts.error && <PlainNote text={alerts.error} prefix="Your alerts could not load: " icon={<Icon name="info" size={12} />} className="tile-err" role="alert" onRetry={() => setAgain((n) => n + 1)} />}
      {saved.length > 0 && (
        <ul className="mode-list" aria-label="Your saved views">
          {saved.map((v) => <li key={v.name}><Icon name="bookmark" size={13} /><span>{v.name}</span></li>)}
        </ul>
      )}
      <p className="note"><Icon name="info" size={14} />{USAGE_UNRECORDED}</p>
    </section>
  );
}

export default { Work, Performance };
