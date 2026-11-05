import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_CHANGED, EMPTY_LOOK, lookChart } from './agentView.js';
import { getOverview, getPage } from './api.js';
import { apiTables, apiValues, clearColumnValues, clearSelections, columnValues, setColumnValue, toggleValue } from './filters.js';
import { ColumnFilterStatus, withColumnFilters } from './ColumnFilters.jsx';
import { addCounts, cap, dayLabel, integer, largestFirst, savedVerb, wholeMoney } from './format.js';
import { ITEM_KINDS, fieldsOf, filterWords, rowTitle, tableContext } from './explain.js';
import { hueVars } from './theme.js';
import { describeFilters, parseHash } from './links.js';
import { Block, Placed } from './Blocks.jsx';
import { blockPlan, gridSpans, slotsOf, withBlocks } from './blocks.js';
import { GenieMark, Icon } from './icons.jsx';
import FilterBar from './FilterBar.jsx';
import Kpis, { Story, Tiles } from './Kpis.jsx';
import ChartCard, { BarsCard } from './ChartCard.jsx';
import DataTable, { columnOf } from './DataTable.jsx';
import Records from './Records.jsx';
import Runs, { runCounts, useRuns } from './Runs.jsx';
import Alerts from './Alerts.jsx';
import { ReviewLink, hubExplain, reviewItem } from './Home.jsx';
import { genieOn } from './genieAsk.js';
import PageLink, { usePageAddress } from './PageLink.jsx';
import { FreshBar, FreshDetail, useFreshness } from './Freshness.jsx';
import { backendNotes, backendText, lastRunText, latestRunText } from './freshness.js';
import { TopTools } from './TopBar.jsx';
import { Skeleton, SoWhat } from './ui.jsx';
import MoneyCard from './Money.jsx';
import SettingsPanel, { SettingsButton, useSettings } from './Settings.jsx';
import { ownerSettings } from './settings.js';
import { FoldScope, useMyView } from './MyView.jsx';
import { LayoutSections, TodoNow, isLaidOut, tabLabel } from './Layouts.jsx';
import { windowParams } from './prefs.js';
import { AskGenie, GenieScope } from './AskGenie.jsx';
import {
  NOT_MEASURED, capacityText, couldSaveFormula, couldSaveText, isMine, moneyText, nothingReason, nothingText, pageCurrency, pageKind, pickReason,
  reasonFilters, reliableText, savedTile, shortDay, totals, useCaseState, viewRows, viewWords,
} from './hub.js';

const VIEWS = [['overview', 'Things to fix'], ['runs', 'Runs'], ['alerts', 'Alerts']];
const OVERVIEW_LABEL = VIEWS[0][1];
const UNFILTERED = ['runs', 'alerts'];
const pageViews = (app) => VIEWS.filter(([id]) => (id !== 'alerts' || !!app.alerting?.on) && (id !== 'runs' || app.screens?.runs !== false));

export function usePageData(pageId, state, ready, nonce = 0, sorts = null) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const key = JSON.stringify({ filters: apiValues(state), tables: apiTables(state), sorts: sorts || {} });
  useEffect(() => {
    if (!ready) return undefined;
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      const asked = JSON.parse(key);
      getPage(pageId, asked.filters, asked.tables, asked.sorts)
        .then((d) => { if (mine === seq.current) { setData(d); setError(''); } })
        .catch((e) => { if (mine === seq.current) setError(e.message); })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 120);
    return () => clearTimeout(timer);
  }, [pageId, key, ready, nonce]);
  return { data, busy, error };
}

function usePageHub(pageId, state, ready, nonce, on) {
  const [out, setOut] = useState({ data: null, error: '', done: !on });
  const seq = useRef(0);
  const { prefs } = useMyView();
  const key = JSON.stringify({ filters: apiValues(state), ai: state?.ai || {}, ...windowParams(prefs) });
  useEffect(() => {
    if (!ready || !on) return undefined;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      getOverview({ page: pageId, ...JSON.parse(key) })
        .then((d) => { if (mine === seq.current) setOut({ data: d.pages?.[pageId] || null, error: '', done: true }); })
        .catch((e) => { if (mine === seq.current) setOut((o) => ({ data: o.data, error: e.message, done: true })); });
    }, 120);
    return () => clearTimeout(timer);
  }, [pageId, key, ready, nonce, on]);
  return out;
}

function TableCard({ table, result, error, loading, onFilter, pageId, filters, values, onColumn, onClear, sort, onSort }) {
  const columns = withColumnFilters(table.columns.map((c) => columnOf(c, onFilter)), filters, values, onColumn, pageId, table.id);
  const cut = !!result?.truncated;
  const served = cut || !!sort ? { sort: sort ? { key: sort.key, dir: sort.dir === 'desc' ? -1 : 1 } : null, onSort: (s) => onSort({ key: s.key, dir: s.dir > 0 ? 'asc' : 'desc' }) } : {};
  return (
    <section className="card card--table" aria-label={table.title}>
      <header className="card-h">
        <div><h2>{table.title}</h2>{table.hint && <p>{table.hint}</p>}<SoWhat text={table.so_what} /></div>
        {filters?.length > 0 && <div className="tbar"><ColumnFilterStatus filters={filters} values={values} onClear={onClear} /></div>}
        <AskGenie kind="table" title={table.title} context={tableContext(table.hint || '', result?.rows || [], (row) => fieldsOf(row, columns))} />
      </header>
      {loading && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2, 3].map((i) => <Skeleton key={i} height={22} />)}</div>}
      {error && <p className="tile-err"><Icon name="info" size={14} />This table could not load: {error}</p>}
      {!loading && !error && <DataTable label={table.title} columns={columns} rows={result?.rows || []} filtering="server" grid={`page:${pageId}:table:${table.id}`} {...served}
        askRow={(row) => ({ kind: ITEM_KINDS[table.section], title: rowTitle(row, columns), context: { hint: `A row of the table "${table.title}".`, fields: fieldsOf(row, columns) } })} />}
      {!loading && !error && cut && <p className="more" data-cut>Showing the first {integer(result.rows.length)} rows. Sorting and the column filters use every row.</p>}
    </section>
  );
}

function hubTiles(page, entry, summary, fix, user, stale) {
  const done = entry?.done || {};
  const mine = fix.filter((i) => isMine(i.owner, user)).length;
  const tiles = [
    { id: 'fix', label: 'To fix', value: integer(fix.length), sub: fix.length ? `${mine} of them ${mine === 1 ? 'is' : 'are'} yours` : 'Nothing to fix right now' },
    { id: 'save', label: 'Could save', value: entry?.money ? moneyText(totals(fix)) : NOT_MEASURED,
      sub: entry?.money ? couldSaveText(fix) : 'This use case puts no amount at stake on its records yet', tone: entry?.money ? 'green' : '',
      formula: entry?.money ? couldSaveFormula(fix) : '' },
    { id: 'fixed', label: 'Fixed so far', value: entry?.tracked ? integer(done.fixed) : NOT_MEASURED,
      sub: !entry?.tracked ? 'This use case keeps no fixes yet' : done.first_fixed ? `since ${shortDay(done.first_fixed)}` : 'Nobody marked one done yet' },
    { id: 'saved', label: `${cap(savedVerb(pageCurrency(page, summary), pageKind(page, summary)))} so far`,
      ...savedTile(entry ? [[page.id, entry]] : [], [page], { [page.id]: summary }, 'saved', null) },
  ];
  return stale ? tiles.slice(2) : tiles;
}

function reasonBars(rows, page) {
  const by = new Map();
  rows.forEach((r) => {
    const at = by.get(r.reason) || { key: r.reason, label: r.reason, hue: page.hue || 'blue', value: 0, currency: r.currency, kind: r.kind };
    at.value = addCounts([at.value, r.money]);
    by.set(r.reason, at);
  });
  return [...by.values()].sort((a, b) => largestFirst(a.value, b.value)).map((b) => ({
    ...b, text: wholeMoney(b.value, b.currency, b.kind), formula: couldSaveFormula(rows.filter((r) => r.reason === b.key), ` the AI groups as ${b.label}`),
  }));
}

function hubView(page, current, summary, view, user) {
  const currency = pageCurrency(page, summary);
  const kind = pageKind(page, summary);
  const items = current?.tracked ? current.items.map((i) => ({ ...i, page, currency, kind, model: current.money_model || null })) : [];
  return viewRows(items, view, user);
}

function NothingToFix({ reason, latest, onRuns }) {
  return (
    <section className="card nothing-fix" role="status" data-nothing-fix="">
      <h2>Nothing to fix</h2>
      {reason && <p data-nothing="">{nothingText(reason)}</p>}
      <p className="nothing-run" data-latest-run="">{latest}</p>
      {onRuns && <button type="button" className="lnk" onClick={onRuns}>See the runs</button>}
    </section>
  );
}

function ViewBack({ onBack, label }) {
  return (
    <div className="view-back">
      <button type="button" className="lnk" onClick={onBack}><Icon name="left" size={14} />Back to {label.toLowerCase()}</button>
    </div>
  );
}

function RunsButton({ on, count, onClick, back }) {
  const label = count != null ? `Runs (${integer(count)})` : 'Runs';
  return (
    <button type="button" className={`btn top-runs top-ic2 ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on} aria-label={label} title={on ? `Back to ${back.toLowerCase()}` : 'See the runs of this use case'}>
      <Icon name="history" size={14} /><span>Runs</span>{count != null && <small>{integer(count)}</small>}
    </button>
  );
}

function HubTop({ entry, live, summary, latest, onRuns, fixing }) {
  const status = useCaseState(entry || live.data, summary);
  const run = summary?.run;
  if (status.kind === 'wait') {
    const said = status.unreliable ? <b>{reliableText(status.reason)}</b> : <><b>{status.title}</b>{nothingText(status.reason)}</>;
    return <div className="uc-status is-wait" role="status" data-unreliable={status.unreliable ? '' : undefined}>{said}{status.next ? ` It is checked again on ${shortDay(status.next)}.` : ''}</div>;
  }
  const nothing = nothingReason(entry || live.data, summary);
  const capacity = status.kind !== 'stale' ? capacityText(run) : '';
  return (
    <>
      {status.kind === 'stale' && <div className="uc-status is-bad" role="status"><b>{status.title}</b>{status.reason}</div>}
      {status.kind !== 'stale' && run?.summary && (
        <div className="sum"><span className="ai-badge"><GenieMark size={12} />AI summary</span><p>{run.summary}</p>
          <AskGenie kind="text" title="AI summary" context={{ hint: run.summary }} /></div>
      )}
      {status.kind !== 'stale' && summary && !summary.error && !run?.summary && (
        <p className="note no-sum" role="status"><Icon name="info" size={14} />{run ? 'The last run wrote no AI summary.' : 'No run has written an AI summary yet.'}</p>
      )}
      {fixing && status.kind !== 'stale' && nothing && <NothingToFix reason={nothing} latest={latest} onRuns={onRuns} />}
      {capacity && <p className="note" role="status" data-capacity=""><Icon name="info" size={14} />{capacity}</p>}
      {summary?.error && <p className="note" role="status"><Icon name="info" size={14} />The AI summary could not load: {summary.error}</p>}
      {live.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The things to fix could not load: {live.error}</p>}
    </>
  );
}

function Drivers({ drivers, cards }) {
  if (!drivers || !cards.length) return null;
  return (
    <section className="drivers" aria-label={drivers.title} data-drivers>
      <header className="drivers-h"><h2>{drivers.title}</h2><p>{drivers.guide}</p></header>
      <div className="charts">{cards}</div>
    </section>
  );
}

function hubChartsOnTop(entry, live, summary) {
  return !['wait', 'stale'].includes(useCaseState(entry || live.data, summary).kind);
}

const NO_SLOTS = { before: [], after: [], left: [], right: [] };

function chartSlots(plan, top, more) {
  const slots = slotsOf(plan, 'charts');
  if (top && more) return [{ ...slots, after: [] }, { ...NO_SLOTS, after: slots.after }];
  return [top ? slots : NO_SLOTS, more ? slots : NO_SLOTS];
}

function HubBody({ app, page, entry, live, summary, state, onState, view, onView, meta, pageId, shown, charts, explain, genieBusy, nonce,
  onChanged, plan, topSlots }) {
  const status = useCaseState(entry || live.data, summary);
  const waiting = status.kind === 'wait';
  const current = live.data || entry;
  const { fix, shown: rows } = hubView(page, current, summary, view, app.user);
  const reasons = reasonFilters(entry || live.data, summary);
  const first = reasons[0];
  const picked = first && state?.ai?.[first.name]?.length === 1 ? state.ai[first.name][0] : null;
  const loading = !current;
  return (
    <>
      {shown === 'overview' && slotsOf(plan, '@top').after.map((b) => <Block key={b.id} block={b} />)}
      {!waiting && shown === 'overview' && (
        <Placed slots={slotsOf(plan, 'kpis')}><Tiles tiles={hubTiles(page, current, summary, fix, app.user, status.kind === 'stale')} loading={loading} /></Placed>
      )}
      {!waiting && shown === 'overview' && current?.money && <MoneyCard pageId={pageId} nonce={nonce} onChanged={onChanged} />}
      {!waiting && current?.truncated && shown === 'overview' && <p className="more">These numbers count the {integer(current.items.length)} biggest of {current.total_more ? 'at least ' : ''}{integer(current.total)} open records.</p>}
      {!UNFILTERED.includes(shown) && !meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      {!UNFILTERED.includes(shown) && (
        <Placed slots={shown === 'overview' ? slotsOf(plan, 'filters') : NO_SLOTS}>
          <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={pageId} reasons={reasons} view={view} onView={onView} />
        </Placed>
      )}
      {shown === 'overview' && hubChartsOnTop(entry, live, summary) && (
        <Placed slots={topSlots}>
          <section className="charts">
            {charts(
              <BarsCard id="by_reason" title="Could save, by reason" hint="The AI groups each item by reason." action="Click a bar to filter." loading={loading}
                bars={first && current?.money ? reasonBars(rows, page) : []} picked={first ? picked : undefined} onPick={first ? (value) => onState(pickReason(state, first.name, value)) : undefined}
                empty={!first ? 'The AI gives no reasons for this use case yet.' : !current?.money ? NOT_MEASURED : 'Nothing to fix for these filters.'}
                x={first?.label} measure="Could save" filters={viewWords(view, reasons, state)} onExplain={explain} genieBusy={genieBusy} />,
            )}
          </section>
        </Placed>
      )}
    </>
  );
}

export default function Page({ app, page, meta, state, onState, look = EMPTY_LOOK, onLook, themeKey, onAsk, onExplain, genieBusy, hubEntry, summary, view, onView, genie }) {
  const ready = !!state;
  const [nonce, setNonce] = useState(0);
  const [queue, setQueue] = useState(null);
  const [tab, setTab] = useState('overview');
  const [compose, setCompose] = useState(false);
  const composed = useCallback(() => setCompose(false), []);
  const [runNonce, setRunNonce] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useSettings(page.id, nonce);
  const listed = !!(page.history && page.records);
  const sorts = useMemo(() => Object.fromEntries(Object.entries(look.sorts || {}).filter(([id]) => id !== 'records')), [look]);
  const sortBy = (target) => (s) => onLook?.((l) => ({ ...l, sorts: { ...l.sorts, [target]: s } }));
  useEffect(() => {
    const changed = (e) => { if (e.detail?.pageId === page.id) setNonce((n) => n + 1); };
    window.addEventListener(AGENT_CHANGED, changed);
    return () => window.removeEventListener(AGENT_CHANGED, changed);
  }, [page.id]);
  const { data, busy, error } = usePageData(page.id, state, ready, nonce, sorts);
  const live = usePageHub(page.id, state, ready, nonce, listed);
  const laidOut = isLaidOut(page);
  const hubPage = !laidOut && listed && !!(live.data?.tracked || live.data?.empty || hubEntry?.tracked || hubEntry?.empty || !live.done);
  const [question, setQuestion] = useState('');
  const [openKey] = useState(() => parseHash(window.location.hash).rec);
  const [seeChanged, setSeeChanged] = useState(() => (parseHash(window.location.hash).changed ? 1 : 0));
  const tabs = pageViews(app);
  const showRuns = tabs.some(([id]) => id === 'runs') ? () => setTab('runs') : null;
  const seeWhatChanged = page.records ? () => { setTab('overview'); setSeeChanged((n) => n + 1); } : showRuns;
  const runs = useRuns(page.id, runOffset, `${nonce}:${runNonce}`, tabs.some(([id]) => id === 'runs'));
  const counted = useRef({});
  if (runs.data?.offset === 0) counted.current = runCounts(runs.data);
  const unreliable = hubPage && !!useCaseState(hubEntry || live.data, summary).unreliable;
  const shown = tabs.some(([id]) => id === tab) ? tab : 'overview';
  const runsOn = tabs.some(([id]) => id === 'runs');
  const toggleView = (id) => setTab((now) => (now === id ? 'overview' : id));
  const loading = !data;
  const pick = (filterId, value) => onState(toggleValue(state, filterId, value));
  const filters = apiValues(state);
  const scope = { page: page.id, filters: filterWords(meta?.filters, state) };
  const runDate = meta?.filters?.find((f) => f.type === 'date_range');
  const freshness = useFreshness({ page, showThrough: !!meta && !runDate?.high, onRefreshed: () => setNonce((n) => n + 1), onRun: () => setRunNonce((n) => n + 1),
    onSeeChanged: seeWhatChanged });
  const address = usePageAddress({ page, meta, state, onState, view: shown, onView: setTab, views: tabs.map(([id]) => id) });
  const latestRun = counted.current.latest ? latestRunText(counted.current.latest) : freshness.fresh?.last_run ? `${lastRunText(freshness.fresh.last_run).text}.`
    : runs.busy ? 'Reading the latest run.' : latestRunText(null);
  const errors = data?.errors || {};
  const alert = app.alerts?.[page.id] || app.alerts_home;
  const notify = () => { setTab('alerts'); setCompose(true); };
  const alertLink = hubPage && !!alert && !app.alerting?.on && !app.alerting?.reason;
  const review = reviewItem(page, app);
  const topMore = [
    ...(review ? [{ ...review, more: 'tight' }] : []),
    { label: 'Settings', icon: <Icon name="sliders" size={14} />, run: () => setSettingsOpen((o) => !o), more: 'narrow' },
    ...(app.alerting?.on ? [{ label: 'Notify me', icon: <Icon name="bell" size={14} />, run: notify, more: 'tight' }] : []),
    ...(alertLink ? [{ label: 'Notify me', icon: <Icon name="bell" size={14} />, run: () => window.open(alert, '_blank', 'noopener,noreferrer'), more: 'tight' }] : []),
  ];
  const explain = genieOn(app, page.id) && onExplain
    ? (kind, title, context) => onExplain({ kind, page: page.id, title,
      context: kind === 'chart' ? { ...context, filters: [filterWords(meta?.filters, state), context.filters].filter(Boolean).join('; ') } : context })
    : null;
  const trendChart = page.charts.find((c) => c.x?.kind === 'time') || page.charts[0];
  const onTop = hubPage && hubChartsOnTop(hubEntry, live, summary);
  const more = onTop ? page.charts.filter((c) => c !== trendChart) : page.charts;
  const kpiIds = page.kpis.map((k) => k.id);
  const placed = (page.blocks || []).map((b) => (hubPage && kpiIds.includes(b.place?.of) ? { ...b, place: { ...b.place, of: 'kpis' } } : b));
  const charted = hubPage ? [...(onTop && trendChart ? [trendChart] : []), ...more] : page.charts;
  const waiting = hubPage && useCaseState(hubEntry || live.data, summary).kind === 'wait';
  const plan = blockPlan(placed, new Set([
    'filters', ...(waiting ? [] : ['kpis']), ...(hubPage ? [] : kpiIds), ...(charted.length || !hubPage ? ['charts'] : []), ...charted.map((c) => c.id),
    ...page.tables.map((t) => t.id), ...(page.records && !unreliable ? ['records'] : [])]));
  const [topSlots, moreSlots] = hubPage ? chartSlots(plan, onTop, more.length > 0) : [NO_SLOTS, slotsOf(plan, 'charts')];
  const chartCard = (given, wide) => {
    const { chart, result } = lookChart(given, data?.charts?.[given.id], look.charts?.[given.id]);
    return (
      <ChartCard key={chart.id} chart={chart} wide={wide} result={result} error={errors[`chart:${chart.id}`]} loading={loading} themeKey={themeKey}
        app={app} pageId={page.id} onPick={pick} onExplain={explain} genieBusy={genieBusy} />
    );
  };
  const chartCards = (charts, lead = [], narrow = false) => {
    const entries = [...lead, ...withBlocks(charts, plan).map((entry) => (narrow && entry.item ? { ...entry, span: 1 } : entry))];
    const spans = gridSpans(entries);
    return entries.map((entry, i) => (entry.block ? <Block key={entry.key} block={entry.block} tile wide={spans[i] === 2} />
      : entry.node || chartCard(entry.item, spans[i] === 2)));
  };
  const tableCard = (table) => (
    <TableCard key={table.id} table={table} result={data?.tables?.[table.id]} error={errors[`table:${table.id}`]} loading={loading} onFilter={pick}
      pageId={page.id} filters={meta?.columns?.tables?.[table.id]} values={columnValues(state, table.id)}
      onColumn={(column, value) => onState(setColumnValue(state, table.id, column, value))} onClear={() => onState(clearColumnValues(state, table.id))}
      sort={sorts[table.id]} onSort={sortBy(table.id)} />
  );
  const kpisOf = (kpis, main = true) => <Kpis page={{ ...page, kpis }} data={data?.kpis} errors={errors} loading={loading} plan={main ? plan : null} scope={data?.scope} />;
  const kpisCard = kpisOf(page.kpis);
  const recordsCard = page.records && !unreliable ? (
    <Records meta={page.records} app={app} pageId={page.id} filters={filters} ready={ready} nonce={nonce} onFilter={pick} history={!!page.history} onList={setQueue} section={laidOut ? undefined : 'records'}
      similarBy={page.similar_by} keepsActions={hubEntry ? !!(hubEntry.tracked && hubEntry.actions) : undefined}
      onChanged={() => setNonce((n) => n + 1)} onExplain={explain} genieBusy={genieBusy} ai={state?.ai} openKey={openKey}
      sort={look.sorts?.records || null} onSort={sortBy('records')}
      columnMeta={meta?.columns?.list} columnValues={columnValues(state, null)}
      onColumn={(column, value) => onState(setColumnValue(state, null, column, value))} onClearColumns={() => onState(clearColumnValues(state, null))}
      onClearFilters={() => onState(clearColumnValues({ ...clearSelections(state), ai: {} }, null))} seeChanged={seeChanged} onShowRuns={showRuns} />
  ) : null;
  const hubCharts = (bars) => chartCards(trendChart ? [trendChart] : [], [{ key: 'by_reason', item: { id: 'by_reason' }, span: 1, node: bars }], true);
  const body = (
    <div className={`page ${busy && data ? 'is-busy' : ''}`} style={hueVars(page.hue || 'blue')} aria-busy={busy}>
      <TopTools more={topMore}>
        <FreshBar freshness={freshness}>
          {runsOn && <RunsButton on={shown === 'runs'} count={counted.current.runs} onClick={() => toggleView('runs')} back={tabLabel(page, OVERVIEW_LABEL)} />}
          <PageLink pageId={page.id} meta={meta} state={state} view={shown} address={address} />
        </FreshBar>
        <ReviewLink page={page} app={app} />
        <SettingsButton open={settingsOpen} onOpen={setSettingsOpen} owned={ownerSettings(settings)} />
        {app.alerting?.on && (
          <button className="btn notify top-ic" data-more="tight" onClick={notify} title="Set up an email alert on this use case" aria-label="Notify me">
            <Icon name="bell" size={15} /><span>Notify me</span>
          </button>
        )}
        {alertLink && (
          <a className="btn notify top-ic" data-more="tight" href={alert} target="_blank" rel="noopener noreferrer" aria-label="Notify me"
            title={app.alerts?.[page.id] ? 'Opens this use case\u2019s alert in Databricks, where you can subscribe to it' : 'Opens the alerts in Databricks, where you can subscribe to this use case\u2019s alert'}>
            <Icon name="bell" size={15} /><span>Notify me</span>
          </a>
        )}
      </TopTools>
      <header className="ph">
        <div className="pg-h"><h1>{page.title}</h1></div>
        {!hubPage && <p className="ph-q">{page.question}</p>}
        {!hubPage && page.promised?.estimate && <p className="ph-value" data-value-estimate="">{page.promised.estimate}</p>}
        {!hubPage && data && <Story page={page} data={data.kpis} />}
        {app.style === 'c' && genieOn(app, page.id) && (
          <form className="ask" onSubmit={(e) => { e.preventDefault(); if (question.trim()) { onAsk(question); setQuestion(''); } }}>
            <span className="ask-ic"><GenieMark size={18} /></span>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Ask Genie about ${page.title.toLowerCase()}…`} aria-label="Ask Genie" maxLength={1000} />
            <button className="btn btn--pri" type="submit"><Icon name="send" size={14} />Ask</button>
          </form>
        )}
        <div className="ph-meta">
          <Icon name="calendar" size={13} />
          <span>
            {[runDate?.high ? `Data through ${dayLabel(runDate.high)}` : meta ? '' : 'Reading the data range',
              page.sponsor ? `sponsor ${page.sponsor}` : '', app.built_at ? `built ${dayLabel(app.built_at.slice(0, 10))}` : '',
              backendText(app.backend)]
              .filter(Boolean).join(' · ')}
          </span>
        </div>
        <FreshDetail freshness={freshness} />
        <p className="print-only print-filters">Filters: {describeFilters(state, meta?.filters, meta?.columns)}</p>
      </header>
      {settingsOpen && (
        <SettingsPanel pageId={page.id} data={settings} onData={setSettings} onChanged={() => setNonce((n) => n + 1)}
          onRunStarted={() => freshness.load()} onClose={() => setSettingsOpen(false)} />
      )}
      {backendNotes(app.backend, data).map((n) => <p key={n} className="note" role="status" data-backend-note><Icon name="info" size={14} />{n}</p>)}
      {hubPage && <HubTop entry={hubEntry} live={live} summary={summary} latest={latestRun} onRuns={showRuns} fixing={shown === 'overview'} />}
      {shown !== 'overview' && <ViewBack onBack={() => setTab('overview')} label={tabLabel(page, OVERVIEW_LABEL)} />}
      {!laidOut && shown === 'overview' && recordsCard && <TodoNow page={page} app={app} ready={ready} nonce={nonce} onAsk={onAsk} shared={queue} />}
      {hubPage && (
        <HubBody app={app} page={page} entry={hubEntry} live={live} summary={summary} state={state} onState={onState} view={view} onView={onView} meta={meta}
          pageId={page.id} shown={shown} charts={hubCharts} explain={explain} genieBusy={genieBusy} nonce={nonce}
          onChanged={() => setNonce((n) => n + 1)} plan={plan} topSlots={topSlots} />
      )}
      {!hubPage && shown === 'overview' && slotsOf(plan, '@top').after.map((b) => <Block key={b.id} block={b} />)}
      {!hubPage && !UNFILTERED.includes(shown) && !meta && <section className="fbar"><Skeleton height={34} width="70%" /></section>}
      {!hubPage && !UNFILTERED.includes(shown) && (
        <Placed slots={shown === 'overview' ? slotsOf(plan, 'filters') : NO_SLOTS}>
          <FilterBar meta={meta?.filters} state={state || { range: {}, sel: {} }} onState={onState} pageId={page.id} />
        </Placed>
      )}
      {!UNFILTERED.includes(shown) && meta?.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The filters could not load, so the page shows all its data: {meta.error}</p>}
      {shown === 'runs' && <Runs page={page} runs={runs} offset={runOffset} onOffset={setRunOffset} onExplain={hubExplain(app, onExplain, page.id)} genieBusy={genieBusy} />}
      {shown === 'alerts' && <Alerts app={app} page={page} meta={meta} compose={compose} onComposed={composed} />}
      {shown === 'overview' && (
        <>
          {error && <p className="tile-err" role="alert"><Icon name="info" size={14} />{error}</p>}
          {laidOut && (
            <LayoutSections page={page} app={app} ready={ready} nonce={nonce} filters={filters} onChanged={() => setNonce((n) => n + 1)} onAsk={onAsk}
              kpisOf={kpisOf} records={recordsCard} chartCards={(charts) => chartCards(charts)} tableCard={tableCard} data={data} onPick={pick} genie={genie} />
          )}
          {!hubPage && !laidOut && (
            <Placed slots={slotsOf(plan, 'kpis')}>
              {kpisCard}
            </Placed>
          )}
          {!hubPage && !laidOut && <Placed slots={moreSlots}><section className="charts">{chartCards(page.charts.filter((c) => !c.driver))}</section></Placed>}
          {hubPage && more.some((c) => !c.driver) && (
            <Placed slots={moreSlots}><section className="charts charts--more" aria-label="More charts">{chartCards(more.filter((c) => !c.driver))}</section></Placed>
          )}
          {!laidOut && <Drivers drivers={page.drivers} cards={chartCards((hubPage ? more : page.charts).filter((c) => c.driver))} />}
          {!laidOut && page.tables.map((table) => (
            <Placed key={table.id} slots={slotsOf(plan, table.id)}>
              {tableCard(table)}
            </Placed>
          ))}
          {!laidOut && recordsCard && (
            <Placed slots={slotsOf(plan, 'records')}>
              {recordsCard}
            </Placed>
          )}
          {slotsOf(plan, '@bottom').after.map((b) => <Block key={b.id} block={b} />)}
        </>
      )}
    </div>
  );
  return <GenieScope.Provider value={scope}><FoldScope pageId={page.id}>{body}</FoldScope></GenieScope.Provider>;
}
