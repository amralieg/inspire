import { useEffect, useRef, useState } from 'react';
import { askGenie, failureOf, getImpact, getMyWork } from './api.js';
import { genieAnswer, genieOn } from './genieAsk.js';
import { grouped } from './format.js';
import { Icon } from './icons.jsx';
import { Tiles } from './Kpis.jsx';
import { BarsCard } from './ChartCard.jsx';
import { Failure, PlainNote } from './ui.jsx';
import Fx from './Fx.jsx';
import DataTable from './DataTable.jsx';
import { RowGenie } from './DataTable.jsx';
import { AskGenie } from './AskGenie.jsx';
import { fieldsOf, tableContext } from './explain.js';
import { statusChoices, statusClass, statusLabel } from './records.js';
import { ReviewLink, hubExplain } from './Home.jsx';
import { NOT_MEASURED, dueText, pageCurrency, pageKind, plural, shortDay } from './hub.js';
import { closedRows, figuresOf, heldShare, holdoutOffText, holdoutView, promisedView, targetKpiView } from './impact.js';
import {
  CUSTOM, DEFAULT_PERIOD, PAGE_ROWS, PERIODS, activityText, aiQuestion, answerProblem, checkedAnswer, outcomeMix,
  performanceTiles, periodBody, periodProblem, scopeText, templateText, weekTrend, whenText, workFacts,
} from './mywork.js';

const SIGN_IN = 'Sign in so the App can show the work you did.';
const FIGURES = [['estimated', 'Estimated'], ['reported', 'Reported'], ['measured', 'Measured'], ['wrong', 'Said wrong']];

function Period({ choice, from, to, problem, onChoice, onFrom, onTo }) {
  return (
    <div className="tbar" data-period>
      <div className="wchips" role="group" aria-label="Period">
        {PERIODS.map(([id, text]) => (
          <button key={id} type="button" className={`pick-i ${choice === id ? 'is-on' : ''}`} aria-pressed={choice === id} onClick={() => onChoice(id)}>{text}</button>
        ))}
      </div>
      {choice === CUSTOM && (
        <span className="wchips">
          <label className="in"><span>First day</span><input type="date" name="my_work_from" value={from} onChange={(e) => onFrom(e.target.value)} /></label>
          <label className="in"><span>Last day</span><input type="date" name="my_work_to" value={to} onChange={(e) => onTo(e.target.value)} /></label>
        </span>
      )}
      {problem && choice === CUSTOM && (from || to) && <PlainNote text={problem} className="err" role="alert" />}
    </div>
  );
}

function Summary({ app, facts }) {
  const [said, setSaid] = useState({ state: 'idle', text: '', note: '' });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const target = [facts.best?.page, ...facts.rows.map((r) => r.page)].find((p) => p && genieOn(app, p.id));
  const write = async () => {
    setSaid({ state: 'running', text: '', note: '' });
    try {
      const started = await askGenie(target.id, aiQuestion(facts), '');
      const msg = await genieAnswer(target.id, started, { alive: () => alive.current });
      if (!msg) return;
      const problem = answerProblem(msg.text, facts);
      setSaid(problem ? { state: 'plain', text: '', note: `${problem}, so this is the plain summary.` }
        : { state: 'ai', text: checkedAnswer(msg.text, facts), note: 'Genie wrote this from your numbers; every number in it is one of them.' });
    } catch (error) {
      if (alive.current) setSaid({ state: 'plain', text: '', note: `Genie could not write it: ${error.message}` });
    }
  };
  return (
    <section className="card" aria-label="Summary" data-summary>
      <header className="card-h">
        <div><h2>In short</h2><p data-summary-text={said.state}>{said.text || templateText(facts)}</p>{said.note && <p className="more">{said.note}</p>}</div>
        <AskGenie kind="text" title="In short" context={{ hint: said.text || templateText(facts) }} />
        {target && facts.worked.records > 0 && (
          <div className="tbar">
            <button type="button" className="btn" onClick={write} disabled={said.state === 'running'} data-summary-ai>
              <Icon name="edit" size={14} />{said.state === 'running' ? 'Genie is writing…' : 'Write it with Genie'}
            </button>
          </div>
        )}
      </header>
    </section>
  );
}

function Outcomes({ entry, onExplain, genieBusy }) {
  const mix = outcomeMix(entry);
  return (
    <>
      <BarsCard id="outcome_mix" title="Your outcome mix" hint="How you closed the items in this period." bars={mix.closed} hue="blue"
        empty="You closed no item in this period." x="Outcome" measure="Items" onExplain={onExplain} genieBusy={genieBusy} />
      <BarsCard id="found_after" title="What a later run found on your fixes" hint="Each fix of yours that is still closed, by what the latest run found."
        bars={mix.found} hue="green" empty="You fixed no item in this period." x="Found" measure="Fixes" onExplain={onExplain} genieBusy={genieBusy} />
    </>
  );
}

const overdueFields = (item, today) => ({ Record: item.label || item.key, Due: shortDay(item.due), Late: dueText(item.due, today).text });

function Overdue({ app, entry, today, onRecord, pageId }) {
  const items = entry.overdue?.items || [];
  if (!items.length) return null;
  const hint = `Open, past their due day, earliest first: ${grouped(items.length)} of ${plural(entry.overdue.n, 'item')}`;
  return (
    <section className="card card--table" aria-label="Overdue items you own" data-overdue>
      <header className="card-h">
        <div><h2>Overdue items you own</h2><p>{hint}</p></div>
        <AskGenie kind="table" title="Overdue items you own" context={tableContext(hint, items, (item) => overdueFields(item, today), entry.overdue.n)} />
      </header>
      <div className="tbl-wrap">
        <table className="tbl tbl--work">
          <thead><tr><th>Record</th><th>Due</th><th className="ask-c"><span className="sr">Ask Genie</span></th></tr></thead>
          <tbody>
            {items.map((item) => {
              const open = () => onRecord(pageId, item.key);
              return (
                <tr key={item.key} className="is-click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                  aria-label={`Open ${item.label || item.key} in Work`} data-overdue-row={item.key}>
                  <td><b><bdi>{item.label || item.key}</bdi></b></td>
                  <td className="nw late">{`${shortDay(item.due)}, ${dueText(item.due, today).text}`}</td>
                  <td className="ask-c"><RowGenie about={genieOn(app, pageId) ? { pageId, recordKey: String(item.key), label: item.label || item.key } : null}
                    element={{ title: item.label || item.key, page: pageId, context: { hint: 'An overdue item you own.', fields: overdueFields(item, today) } }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const activityFields = (a) => ({
  When: whenText(a.at), Record: a.label || a.key, 'What you did': activityText(a), Status: a.status ? statusLabel(a.status) : '',
  ...(a.note && a.kind === 'note' ? { Note: a.note } : {}),
});

function Activity({ app, data, onMore, onRecord }) {
  return (
    <section className="card card--table" aria-label="What you did">
      <header className="card-h">
        <div><h2>What you did</h2><p>{`Every change you made, newest first: ${grouped(data.activity.length)} of ${plural(data.total, 'change')}`}</p></div>
        <AskGenie kind="table" title="What you did" context={tableContext('Every change you made, newest first.', data.activity, activityFields, data.total)} />
      </header>
      {data.activity.length === 0 ? <div className="nomatch">You changed no records in this period.</div> : (
        <div className="tbl-wrap">
          <table className="tbl tbl--work" data-activity>
            <thead><tr><th>When</th><th>Record</th><th>What you did</th><th className="c-status">Status</th><th className="ask-c"><span className="sr">Ask Genie</span></th></tr></thead>
            <tbody>
              {data.activity.map((a, i) => {
                const open = () => onRecord(a.page, a.key);
                return (
                  <tr key={`${a.key}:${a.at}:${i}`} className="is-click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                    aria-label={`Open ${a.label || a.key} in Work`}>
                    <td className="nw">{whenText(a.at)}</td>
                    <td><div className="it"><b><bdi>{a.label || a.key}</bdi></b>{a.note && a.kind === 'note' && <small><bdi>{a.note}</bdi></small>}</div></td>
                    <td>{activityText(a)}</td>
                    <td className="nw c-status">{a.status ? <span className={statusClass(a.status)}>{statusLabel(a.status)}</span> : ''}</td>
                    <td className="ask-c"><RowGenie about={genieOn(app, a.page) ? { pageId: a.page, recordKey: String(a.key), label: a.label || a.key } : null}
                      element={{ title: a.label || a.key, page: a.page, context: { hint: 'A change you made to this record.', fields: activityFields(a) } }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.activity.length < data.total && (
        <p className="more">{data.more ? 'Loading more…' : <button className="lnk" onClick={onMore} data-my-work-more>{`Show ${grouped(Math.min(PAGE_ROWS, data.total - data.activity.length))} more`}</button>}</p>
      )}
    </section>
  );
}

function Promised({ page }) {
  const promised = promisedView(page);
  return (
    <div className="imp-side imp-promised">
      <h3>Promised</h3>
      {promised ? (
        <>
          {promised.estimate && <p className="imp-estimate" data-value-estimate="">{promised.estimate}</p>}
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
  { key: 'outcome', label: 'Outcome', className: 'nw c-outcome' },
  { key: 'state', label: 'What a later run found', className: 'c-state' },
  { key: 'measured', label: 'Measured', num: true, sortValue: (r) => r.amounts.measured, render: (r) => r.measured || '\u00a0' },
  { key: 'reported', label: 'Reported', num: true, sortValue: (r) => r.amounts.reported, render: (r) => <>{r.reported}{r.note && <small>{r.note}</small>}</> },
  { key: 'closed', label: 'Closed', date: true, className: 'nw c-closed', sortValue: (r) => r.amounts.closed },
];

function Closed({ entry, currency, kind, pageId, choices }) {
  const rows = closedRows(entry, currency, kind, choices);
  if (!rows.length) return null;
  return <DataTable label="Closed records" tableClass="tbl--closed" columns={CLOSED_COLUMNS} rows={rows} rowKey={(r) => r.key} grid={`impact:${pageId}:closed`}
    askRow={(r) => ({ title: String(r.label || r.key), page: pageId, context: { hint: 'A closed record of this use case.', fields: fieldsOf(r, CLOSED_COLUMNS) } })} />;
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

function impactFields(page, entry, figures, run) {
  const kpi = targetKpiView(run);
  const fields = { Promised: promisedView(page)?.value, ...Object.fromEntries(FIGURES.map(([key, label]) => [label, figures[key].value])),
    'Shown to people and held back': holdoutView(entry)?.verdict, ...(kpi ? { [`Target KPI: ${kpi.name}`]: `${kpi.baseline} to ${kpi.latest}, target ${kpi.target}` } : {}) };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''));
}

function useImpact(page) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    if (!page.history) {
      setEntry({ tracked: false, note: 'This use case keeps no results table, so it has no impact to measure.' });
      return undefined;
    }
    let alive = true;
    setEntry(null);
    getImpact(page.id).then((data) => { if (alive) setEntry(data); }).catch((e) => { if (alive) setEntry({ tracked: false, error: e.message }); });
    return () => { alive = false; };
  }, [page.id, page.history]);
  return entry;
}

export function PromisedDelivered({ app, page, summary }) {
  const entry = useImpact(page);
  const currency = pageCurrency(page, summary);
  const kind = pageKind(page, summary);
  const figures = figuresOf(entry, currency, kind);
  const run = summary?.run || null;
  if (entry?.visible === false) return null;
  const note = !entry ? 'Loading the impact…' : entry.error ? `The impact could not load: ${entry.error}`
    : entry.tracked ? `The whole team, so far, since the first run. This quarter starts ${shortDay(entry.since)}.` : entry.note || 'This use case does not track its records yet.';
  return (
    <section className="card imp" aria-label="Promised and delivered" data-promised-delivered data-page={page.id}>
      <header className="card-h">
        <div>
          <h2>Promised and delivered</h2>
          {entry?.error ? <PlainNote text={note} className="tile-err tile-err--flat" /> : <p>{note}</p>}
          {run?.scope_text && <p className="kpi-scope" data-scope={page.id}>{run.scope_text}</p>}
        </div>
        <ReviewLink page={page} app={app} />
        <AskGenie kind="text" title={`The impact of ${page.title}`} page={page.id} context={{ hint: note, fields: impactFields(page, entry, figures, run) }} />
      </header>
      <div className="imp-grid">
        <Promised page={page} />
        <Delivered figures={figures} />
      </div>
      <TargetKpi run={run} />
      <Holdout entry={entry} meaning={app.held_meaning} />
      <Reasons entry={entry} />
      <Closed entry={entry} currency={currency} kind={kind} pageId={page.id} choices={statusChoices(page)} />
    </section>
  );
}

function BestWin({ best, onRecord }) {
  if (!best) return null;
  return (
    <p className="note" data-best>
      <Icon name="check" size={14} />Your best win is{' '}
      <button type="button" className="lnk" onClick={() => onRecord(best.page.id, best.key)}>{best.label}</button>
      {`: ${best.text} ${best.basis}.`}
    </p>
  );
}

export default function Performance({ app, page, summary, onRecord, onExplain, genieBusy }) {
  const [choice, setChoice] = useState(DEFAULT_PERIOD);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const signedIn = !!(app.user?.email || app.user?.name);
  const problem = periodProblem(choice, from, to);
  const asked = problem ? '' : JSON.stringify({ page: page.id, ...periodBody(choice, from, to) });
  const seq = useRef(0);
  useEffect(() => {
    if (!signedIn || !asked) return;
    const mine = ++seq.current;
    setData(null);
    setFailure(null);
    getMyWork(JSON.parse(asked)).then((d) => { if (mine === seq.current) setData(d); })
      .catch((e) => { if (mine === seq.current) setFailure(failureOf(e)); });
  }, [asked, signedIn]);
  const more = () => {
    const mine = seq.current;
    setData((d) => ({ ...d, more: true }));
    getMyWork({ ...JSON.parse(asked), offset: data.activity.length })
      .then((d) => { if (mine === seq.current) setData((x) => ({ ...x, more: false, activity: [...x.activity, ...d.activity] })); })
      .catch((e) => { if (mine === seq.current) { setData((x) => ({ ...x, more: false })); setFailure(failureOf(e)); } });
  };
  const summaries = { [page.id]: summary };
  const entry = data?.pages?.[page.id];
  const facts = entry?.tracked ? workFacts(data, [page], summaries) : null;
  const explain = hubExplain(app, onExplain, page.id);
  const problemText = data?.errors?.[page.id];
  const today = data?.period?.today || new Date().toISOString().slice(0, 10);
  return (
    <div className="page hub perf" data-performance data-page={page.id} data-page-section="performance">
      <div className="pg-h">
        <div><h1>Performance</h1><p>{`What you did yourself in ${page.title}, read from its change history, next to what the whole team did.`}</p></div>
      </div>
      <Period choice={choice} from={from} to={to} problem={problem} onChoice={setChoice} onFrom={setFrom} onTo={setTo} />
      {!signedIn && <div className="nomatch">{SIGN_IN}</div>}
      <Failure failure={failure} className="tile-err">{failure?.text}</Failure>
      {problemText && <PlainNote text={problemText} prefix={`${page.title} could not load: `} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" />}
      {signedIn && !data && !failure && !problem && <p className="more">Loading your work…</p>}
      {entry && !entry.tracked && <p className="more" data-quiet={page.id}>{entry.note}</p>}
      {facts && (
        <>
          <p className="note" data-scope><Icon name="info" size={14} />{scopeText(facts)}</p>
          <Tiles tiles={performanceTiles(facts, entry)} loading={false} label="Your numbers" />
          <Summary key={asked} app={app} facts={facts} />
          <BestWin best={facts.best} onRecord={onRecord} />
          <section className="charts">
            <BarsCard id="weekly_closed" title="Items you closed, by week" hint="Weeks start on Monday. Only closes that still stand count." vertical hue="blue"
              bars={weekTrend(entry.weeks)} empty="You closed no item in this period." x="Week" measure="Items" onExplain={explain} genieBusy={genieBusy} />
            <Outcomes entry={entry} onExplain={explain} genieBusy={genieBusy} />
          </section>
          <Overdue app={app} entry={entry} today={today} onRecord={onRecord} pageId={page.id} />
          <Activity app={app} data={data} onMore={more} onRecord={onRecord} />
        </>
      )}
      {app.screens?.impact !== false && <PromisedDelivered app={app} page={page} summary={summary} />}
    </div>
  );
}
