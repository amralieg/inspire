import { useEffect, useState } from 'react';
import { BarsCard } from './ChartCard.jsx';
import { Tiles } from './Kpis.jsx';
import { HubExplainNote, ReviewLink, UseCaseName, hubExplain, weekCard } from './Home.jsx';
import { wholeMoney } from './format.js';
import { Icon } from './icons.jsx';
import Fx from './Fx.jsx';
import DataTable from './DataTable.jsx';
import { getImpact } from './api.js';
import { NOT_MEASURED, pageCurrency, pageKind, shortDay, visiblePages } from './hub.js';
import { closedRows, figuresOf, heldShare, holdoutOffText, holdoutView, impactTiles, promisedView, targetKpiView } from './impact.js';

const FIGURES = [['estimated', 'Estimated'], ['reported', 'Reported'], ['measured', 'Measured'], ['wrong', 'Said wrong']];

function useImpacts(pages) {
  const [impacts, setImpacts] = useState({});
  useEffect(() => {
    pages.filter((p) => p.history).forEach((p) => {
      getImpact(p.id).then((data) => setImpacts((x) => ({ ...x, [p.id]: data })))
        .catch((e) => setImpacts((x) => ({ ...x, [p.id]: { tracked: false, error: e.message } })));
    });
  }, [pages]);
  return impacts;
}

function Promised({ page }) {
  const promised = promisedView(page);
  return (
    <div className="imp-side imp-promised">
      <h3>Promised</h3>
      {promised ? (
        <>
          {promised.value && <p>{promised.value}</p>}
          {promised.benefits.length > 0 && <ul>{promised.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
        </>
      ) : <p className="faint">The Inspire catalog gave no business value for this use case.</p>}
    </div>
  );
}

function Delivered({ figures }) {
  return (
    <div className="imp-side imp-delivered">
      <h3>Delivered</h3>
      <dl className="imp-figs">
        {FIGURES.map(([key, label]) => (
          <div key={key} data-figure={key}>
            <dt>{label}</dt>
            <dd><b className={figures[key].value === NOT_MEASURED ? 'faint' : ''}>{figures[key].formula ? <Fx formula={figures[key].formula}>{figures[key].value}</Fx> : figures[key].value}</b><small>{figures[key].how}</small></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Holdout({ entry, meaning }) {
  const view = holdoutView(entry);
  if (!view) {
    const off = holdoutOffText(entry);
    return off ? <p className="faint imp-hold-off">{off}</p> : null;
  }
  const share = heldShare(entry);
  return (
    <div className="imp-block imp-hold" aria-label="Shown to people and held back">
      <h3>Shown to people and held back</h3>
      {meaning && <p className="faint imp-why">{meaning}</p>}
      {share && <p>{share}</p>}
      <ul>{view.lines.map((line) => <li key={line}>{line}</li>)}</ul>
      <p className="imp-verdict">{view.verdict}</p>
    </div>
  );
}

function Reasons({ entry }) {
  const reasons = entry?.reasons || [];
  if (!reasons.length) return null;
  return (
    <div className="imp-block imp-reasons" aria-label="Why people said it was wrong">
      <h3>Why people said it was wrong</h3>
      <ul>{reasons.map((r) => <li key={r.reason}><span>{r.reason}</span><b>{r.n}</b></li>)}</ul>
    </div>
  );
}

const CLOSED_COLUMNS = [
  { key: 'label', label: 'Record' },
  { key: 'outcome', label: 'Outcome', className: 'nw' },
  { key: 'state', label: 'What a later run found' },
  { key: 'measured', label: 'Measured', num: true, sortValue: (r) => r.amounts.measured, render: (r) => r.measured || '\u00a0' },
  { key: 'reported', label: 'Reported', num: true, sortValue: (r) => r.amounts.reported, render: (r) => <>{r.reported}{r.note && <small>{r.note}</small>}</> },
  { key: 'closed', label: 'Closed', date: true, className: 'nw', sortValue: (r) => r.amounts.closed },
];

function Closed({ entry, currency, kind, pageId }) {
  const rows = closedRows(entry, currency, kind);
  if (!rows.length) return null;
  return <DataTable label="Closed records" tableClass="tbl--closed" columns={CLOSED_COLUMNS} rows={rows} rowKey={(r) => r.key} grid={`impact:${pageId}:closed`} />;
}

function TargetKpi({ run }) {
  const kpi = targetKpiView(run);
  if (!kpi) return null;
  return (
    <div className="imp-kpi" aria-label="Target KPI">
      <h3>Target KPI: {kpi.name}{kpi.direction && <span className="imp-kpi-dir">{kpi.direction}</span>}</h3>
      <p className="imp-why">{kpi.source}</p>
      <dl>
        <div><dt>Baseline</dt><dd className={kpi.baselineFlagged ? 'is-flagged' : undefined}>{kpi.baseline}{kpi.baselineOn && <small>Measured {kpi.baselineOn}</small>}</dd></div>
        <div><dt>Latest</dt><dd>{kpi.latest}{kpi.latestOn && <small>Measured {kpi.latestOn}</small>}</dd></div>
        <div><dt>Target</dt><dd>{kpi.target}</dd></div>
      </dl>
      {kpi.note && <p className="imp-kpi-note">{kpi.note}</p>}
    </div>
  );
}

function UseCaseImpact({ app, page, entry, currency, kind, figures, meaning, onOpen, run }) {
  const note = !entry ? 'Loading the impact…' : entry.error ? `The impact could not load: ${entry.error}`
    : entry.tracked ? `So far, since the first run. This quarter starts ${shortDay(entry.since)}.` : entry.note || 'This use case does not track its records yet.';
  return (
    <section className="card imp" aria-label={page.title} data-page={page.id}>
      <header className="card-h">
        <div>
          <h2><button type="button" className="lnk" onClick={() => onOpen(page.id)}><UseCaseName page={page} /></button></h2>
          <p className={entry?.error ? 'tile-err tile-err--flat' : ''}>{note}</p>
        </div>
        <ReviewLink page={page} app={app} />
      </header>
      <div className="imp-grid">
        <Promised page={page} />
        <Delivered figures={figures} />
      </div>
      <TargetKpi run={run} />
      <Holdout entry={entry} meaning={meaning} />
      <Reasons entry={entry} />
      <Closed entry={entry} currency={currency} kind={kind} pageId={page.id} />
    </section>
  );
}

export default function Impact({ app, hub, hubError, summaries, onOpen, onExplain, genieBusy }) {
  const explain = hubExplain(app, onExplain, 'impact');
  const impacts = useImpacts(app.pages);
  const pages = visiblePages(app.pages, hub).filter((p) => impacts[p.id]?.visible !== false);
  const rows = pages.map((page) => {
    const entry = page.history ? impacts[page.id] : { tracked: false, note: 'This use case keeps no results table, so it has no impact to measure.' };
    const currency = pageCurrency(page, summaries?.[page.id]);
    const kind = pageKind(page, summaries?.[page.id]);
    return { page, entry, currency, kind, figures: figuresOf(entry, currency, kind), run: summaries?.[page.id]?.run || null };
  });
  const loading = pages.some((p) => p.history && !impacts[p.id]);
  const pairs = pages.filter((p) => hub?.pages?.[p.id]).map((p) => [p.id, hub.pages[p.id]]);
  const bars = rows.filter((r) => r.figures.measured.amount > 0)
    .map((r) => ({ key: r.page.id, label: r.page.title, hue: r.page.hue || 'blue', value: r.figures.measured.amount, text: wholeMoney(r.figures.measured.amount, r.currency, r.kind),
      formula: r.figures.measured.formula }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="page hub imp-page">
      <div className="pg-h"><div><h1>Impact</h1><p>What the use cases delivered. Estimated, reported and measured amounts stay apart and are never added together.</p></div></div>
      {hubError && <p className="tile-err" role="alert"><Icon name="info" size={14} />The weekly impact could not load: {hubError}</p>}
      <Tiles tiles={impactTiles(rows)} loading={loading} label="Impact" />
      <section className="charts">
        <BarsCard {...weekCard(pairs, pages, summaries, !hub && !hubError, 'Measured on fixes a later run confirmed, by week')} onExplain={explain} genieBusy={genieBusy} />
        <BarsCard id="measured_by_use_case" title="Measured, by use case" hint="So far." action="Click a bar to open the use case." loading={loading} onPick={onOpen}
          bars={bars} empty={rows.some((r) => r.figures.measured.amount != null) ? 'No fix was confirmed by a later run yet.' : NOT_MEASURED}
          x="Use case" measure="Measured" onExplain={explain} genieBusy={genieBusy} />
      </section>
      <HubExplainNote app={app} />
      {rows.map((r) => <UseCaseImpact key={r.page.id} {...r} app={app} meaning={app.held_meaning} onOpen={onOpen} />)}
    </div>
  );
}
