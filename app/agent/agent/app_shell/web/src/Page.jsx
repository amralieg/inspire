import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_CHANGED, EMPTY_LOOK, lookChart } from './agentView.js';
import { WAITING_FOR_ACCESS_CODE, getOverview, getPage } from './api.js';
import { ADMIN_ROUTE } from './admin.js';
import { apiTables, apiValues, clearColumnValues, clearColumnValuesIn, clearSelections, columnValuesIn, groupAliases, setColumnValueIn, toggleValue } from './filters.js';
import { dayLabel } from './format.js';
import { filterWords } from './explain.js';
import { hueVars } from './theme.js';
import { DEFAULT_TAB, buildHash, describeFilters, fixThis, parseHash, sectionHash, workTabs } from './links.js';
import { Block } from './Blocks.jsx';
import { blockPlan, gridSpans, slotsOf, withBlocks } from './blocks.js';
import { Icon } from './icons.jsx';
import Kpis, { Story } from './Kpis.jsx';
import ChartCard from './ChartCard.jsx';
import { ReviewLink, hubExplain, reviewItem } from './Home.jsx';
import { genieOn } from './genieAsk.js';
import PageLink, { usePageAddress } from './PageLink.jsx';
import { FreshBar, FreshDetail, runCounts, useFreshness, useRuns, useTrends } from './Freshness.jsx';
import { backendText, dataThroughText, lastRunText, latestRunText } from './freshness.js';
import SettingsPanel, { SettingGroup, useSettings } from './Settings.jsx';
import { paletteItems } from './Palette.jsx';
import { FoldScope, useMyView } from './MyView.jsx';
import { isLaidOut, isQueue, pageSections } from './Layouts.jsx';
import { feedbackSectionOf } from './feedback.js';
import { windowParams } from './prefs.js';
import { pageDecides, statusChoices } from './records.js';
import { GenieScope } from './AskGenie.jsx';
import { SharedFailureScope } from './PageFailure.jsx';
import { pageFailures } from './failures.js';
import { FIX_TIERS, hubView, reasonFilters, useCaseState } from './hub.js';
import { inboxOn } from './inbox.js';
import { useInbox } from './Inbox.jsx';
import Dashboard, { NO_SLOTS, TableCard, chartSlots, hubChartsOnTop } from './Dashboard.jsx';
import { RetryProvider, Skeleton } from './ui.jsx';
import ModeView from './ModeView.jsx';
import { pageMode, sectionTitle } from './modes.js';
import { tourFacts } from './tourStart.js';
import { KPI_TARGET, MEASURES, kpiGap, kpiGapText, promisedView, valueLine } from './impact.js';

const FeedbackButton = lazy(() => import('./Feedback.jsx').then((m) => ({ default: m.FeedbackButton })));
const FeedbackSettings = lazy(() => import('./Feedback.jsx').then((m) => ({ default: m.FeedbackSettings })));
const PromisedDelivered = lazy(() => import('./Performance.jsx').then((m) => ({ default: m.PromisedDelivered })));
const InboxSection = lazy(() => import('./InboxSection.jsx'));
const WaitingForAccess = lazy(() => import('./WaitingForAccess.jsx'));
const WorkPage = lazy(() => import('./WorkPage.jsx'));
const Records = lazy(() => import('./Records.jsx'));
const MoneyRule = lazy(() => import('./MoneyRule.jsx').then((m) => ({ default: m.MoneyRule })));
const Runs = lazy(() => import('./Runs.jsx'));
const ValueStrip = lazy(() => import('./ValueStrip.jsx'));
const Alerts = lazy(() => import('./Alerts.jsx'));
const TrendCards = lazy(() => import('./Trends.jsx'));
const Waiting = ({ height = 180 }) => <section className="card" role="status" aria-label="Loading"><Skeleton height={height} /></section>;

export function usePageData(pageId, state, ready, nonce = 0, sorts = null, searches = {}) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(null);
  const seq = useRef(0);
  const key = JSON.stringify({ filters: apiValues(state), tables: apiTables(state), sorts: sorts || {}, searches });
  useEffect(() => {
    if (!ready) return undefined;
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      const asked = JSON.parse(key);
      getPage(pageId, asked.filters, asked.tables, asked.sorts, asked.searches)
        .then((d) => { if (mine === seq.current) { setData(d); setError(''); setWaiting(null); } })
        .catch((e) => {
          if (mine !== seq.current) return;
          if (e.code === WAITING_FOR_ACCESS_CODE) setWaiting(e.detail || { message: e.message, tables: [] });
          else setError(e.message);
        })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 120);
    return () => clearTimeout(timer);
  }, [pageId, key, ready, nonce]);
  return { data, busy, error, waiting, recheck: () => setWaiting(null) };
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

function radioKeys(e) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const all = [...e.currentTarget.querySelectorAll('[role="radio"]')];
  const next = all[(all.indexOf(document.activeElement) + step + all.length) % all.length];
  next.focus();
  next.click();
}

export default function Page({ app, page, meta, state, onState, look = EMPTY_LOOK, onLook, themeKey, onAsk, onExplain, genieBusy, hubEntry, summary, view, onView, genie,
  section = 'dashboard', tab = '', focus = '', chrome, onCounts, onRecord, onRetryMeta = null, onRetrySummary = null, onTour, onTourFacts }) {
  const ready = !!state;
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const [queue, setQueue] = useState(null);
  const [compose, setCompose] = useState(false);
  const composed = useCallback(() => setCompose(false), []);
  const [runNonce, setRunNonce] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [settings, setSettings, settingsError] = useSettings(page.id, nonce);
  const listed = !!(page.history && page.records);
  const sorts = useMemo(() => Object.fromEntries(Object.entries(look.sorts || {}).filter(([id]) => id !== 'records')), [look]);
  const sortBy = (target) => (s) => onLook?.((l) => ({ ...l, sorts: { ...l.sorts, [target]: s } }));
  useEffect(() => {
    const changed = (e) => { if (e.detail?.pageId === page.id) setNonce((n) => n + 1); };
    window.addEventListener(AGENT_CHANGED, changed);
    return () => window.removeEventListener(AGENT_CHANGED, changed);
  }, [page.id]);
  const [searches, setSearches] = useState({});
  const { data, busy, error, waiting: waitingFor, recheck } = usePageData(page.id, state, ready, nonce, sorts, searches);
  useEffect(() => { onTourFacts?.(page.id, tourFacts(page, data?.kpis, queue?.data)); }, [page, data?.kpis, queue?.data]);
  const live = usePageHub(page.id, state, ready, nonce, listed);
  const laidOut = isLaidOut(page);
  const work = isQueue(page);
  const mode = pageMode(page);
  const sections = pageSections(app, page);
  const inboxHere = inboxOn(app, page);
  const views = inboxHere ? [...sections, 'inbox'] : sections;
  const shown = views.includes(section) ? section : 'dashboard';
  const hubPage = !laidOut && listed && !!(live.data?.tracked || live.data?.empty || hubEntry?.tracked || hubEntry?.empty || !live.done);
  const entry = live.data || hubEntry;
  const tabbed = work && listed && !!app.options?.decisions && pageDecides(page) && !!entry?.tracked;
  const choices = statusChoices(page);
  const tabNow = tabbed ? (workTabs(choices).some(([id]) => id === tab) ? tab : DEFAULT_TAB) : '';
  useEffect(() => {
    if (!tabbed || !tab || tabNow === tab || shown !== 'work') return;
    const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
    query.set('tab', tabNow);
    window.history.replaceState(window.history.state, '', sectionHash(page.id, 'work', query));
  }, [tabbed, tab, tabNow, shown, page.id]);
  const [opened, setOpened] = useState(() => parseHash(window.location.hash).rec || '');
  const [seeChanged, setSeeChanged] = useState(() => (parseHash(window.location.hash).changed ? 1 : 0));
  const runsOn = sections.includes('runs');
  const go = (to, { tab: nextTab = '', state: next = state, sort, focus: only = '' } = {}) => {
    if (next !== state) onState(next);
    if (sort) onLook?.((l) => ({ ...l, sorts: { ...l.sorts, records: sort } }));
    window.location.hash = buildHash(page.id, to, next, meta?.filters, null, meta?.columns, nextTab, only);
  };
  const showRuns = runsOn ? () => go('runs') : null;
  const seeWhatChanged = page.records ? () => { go(work ? 'work' : 'dashboard'); setSeeChanged((n) => n + 1); } : showRuns;
  const runs = useRuns(page.id, runOffset, `${nonce}:${runNonce}`, runsOn);
  const trendsOn = listed && !!app.options?.decisions && pageDecides(page) && ['dashboard', 'runs'].includes(shown);
  const trends = useTrends(page.id, `${nonce}:${runNonce}`, trendsOn);
  const focused = tabbed ? focus : '';
  const counted = useRef({});
  const firstRuns = useRef(null);
  if (runs.data?.offset === 0) {
    counted.current = runCounts(runs.data);
    firstRuns.current = runs.data;
  }
  const runTotal = counted.current.runs;
  const [runOpen, setRunOpen] = useState('');
  const fixCount = work && entry?.tracked ? hubView(page, entry, summary, view, app.user).fix.length : null;
  const inboxRuns = !runsOn || runs.error ? { runs: [], can_run: false } : firstRuns.current;
  const inbox = useInbox({ app, page, fix: fixCount, runs: inboxRuns, nonce, on: inboxHere });
  const inboxCount = inbox?.ready && !inbox.off ? inbox.count : undefined;
  const inboxOff = !!inbox?.off;
  useEffect(() => { onCounts?.({ page: page.id, runs: runTotal, inbox: inboxCount, inboxOff }); }, [page.id, runTotal, inboxCount, inboxOff, onCounts]);
  const unreliable = hubPage && !!useCaseState(entry, summary).unreliable;
  const failures = pageFailures(page, data, error);
  const loading = !data && !failures.whole;
  const pick = (filterId, value) => onState(toggleValue(state, filterId, value));
  const filters = apiValues(state);
  const scope = { page: page.id, filters: filterWords(meta?.filters, state) };
  const runDate = meta?.filters?.find((f) => f.type === 'date_range');
  const freshness = useFreshness({ page, showThrough: !!meta && !runDate?.high, onRefreshed: () => setNonce((n) => n + 1), onRun: () => setRunNonce((n) => n + 1),
    onSeeChanged: seeWhatChanged });
  const address = usePageAddress({ page, meta, state, onState, view: shown, onView: (to) => go(to), views });
  const latestRun = counted.current.latest ? latestRunText(counted.current.latest) : freshness.fresh?.last_run ? `${lastRunText(freshness.fresh.last_run).text}.`
    : runs.busy ? 'Reading the latest run.' : latestRunText(null);
  const { errors } = failures;
  const alert = app.alerts?.[page.id] || app.alerts_home;
  const notify = () => { go('alerts'); setCompose(true); };
  const alertLink = hubPage && !!alert && !app.alerting?.on && !app.alerting?.reason;
  const explain = genieOn(app, page.id) && onExplain
    ? (kind, title, context) => onExplain({ kind, page: page.id, title,
      context: kind === 'chart' ? { ...context, filters: [filterWords(meta?.filters, state), context.filters].filter(Boolean).join('; ') } : context })
    : null;
  const fix = work ? (opts) => {
    const next = fixThis(page, meta?.columns?.list, state, view, opts);
    go('work', { tab: tabbed ? next.tab : '', state: next.state, sort: next.sort, focus: tabbed ? next.focus : '' });
  } : null;
  const openInbox = (item) => {
    if (item.kind === 'fix') fix?.({ tiers: FIX_TIERS });
    else if (item.kind === 'run') {
      setRunOpen(item.run);
      go('runs');
    } else if (item.kind === 'report') go('settings');
    else onRecord?.(page.id, item.key);
  };
  const trendChart = page.charts.find((c) => c.x?.kind === 'time') || page.charts[0];
  const onTop = hubPage && hubChartsOnTop(hubEntry, live, summary);
  const more = onTop ? page.charts.filter((c) => c !== trendChart) : page.charts;
  const kpiIds = page.kpis.map((k) => k.id);
  const placed = (page.blocks || []).map((b) => (hubPage && kpiIds.includes(b.place?.of) ? { ...b, place: { ...b.place, of: 'kpis' } } : b));
  const charted = hubPage ? [...(onTop && trendChart ? [trendChart] : []), ...more] : page.charts;
  const waiting = hubPage && useCaseState(entry, summary).kind === 'wait';
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
    const entries = [...lead, ...withBlocks(charts, plan).map((e) => (narrow && e.item ? { ...e, span: 1 } : e))];
    const spans = gridSpans(entries);
    return entries.map((e, i) => (e.block ? <Block key={e.key} block={e.block} tile wide={spans[i] === 2} />
      : e.node || chartCard(e.item, spans[i] === 2)));
  };
  const aliases = groupAliases(meta);
  const tableCard = (table) => (
    <TableCard key={table.id} table={table} result={data?.tables?.[table.id]} error={errors[`table:${table.id}`]} loading={loading} onFilter={pick}
      pageId={page.id} filters={meta?.columns?.tables?.[table.id]} values={columnValuesIn(state, table.id, aliases)}
      onColumn={(column, value) => onState(setColumnValueIn(state, table.id, column, value, aliases))} onClear={() => onState(clearColumnValuesIn(state, table.id, aliases))}
      sort={sorts[table.id]} onSort={sortBy(table.id)} search={searches[table.id] || ''} onSearch={(text) => setSearches((s) => ({ ...s, [table.id]: text }))} />
  );
  const kpisOf = (kpis, main = true, label) => <Kpis page={{ ...page, kpis }} data={data?.kpis} errors={errors} loading={loading} plan={main ? plan : null} scope={data?.scope} label={label} />;
  const records = (extra = {}) => (page.records && !unreliable ? (
    <Suspense fallback={<Skeleton height={160} />}><Records meta={page.records} app={app} pageId={page.id} filters={filters} ready={ready} nonce={nonce} onFilter={pick} history={!!page.history} onList={setQueue}
      similarBy={page.similar_by} keepsActions={hubEntry ? !!(hubEntry.tracked && hubEntry.actions) : undefined}
      onChanged={() => setNonce((n) => n + 1)} onExplain={explain} genieBusy={genieBusy} ai={state?.ai} openKey={parseHash(window.location.hash).rec}
      sort={look.sorts?.records || null} onSort={sortBy('records')}
      columnMeta={meta?.columns?.list} columnValues={columnValuesIn(state, null, aliases)}
      onColumn={(column, value) => onState(setColumnValueIn(state, null, column, value, aliases))} onClearColumns={() => onState(clearColumnValuesIn(state, null, aliases))}
      onClearFilters={() => onState(clearColumnValues({ ...clearSelections(state), ai: {} }, null))} seeChanged={seeChanged} onShowRuns={showRuns}
      onOpen={setOpened} {...extra} /></Suspense>
  ) : null);
  const hubCharts = (bars) => chartCards(trendChart ? [trendChart] : [], [{ key: 'by_reason', item: { id: 'by_reason' }, span: 1, node: bars }], true);
  const review = reviewItem(page, app);
  const notifyButton = app.alerting?.on
    ? <button type="button" className="btn notify" onClick={notify} title="Set up an email alert on this use case" data-notify><Icon name="bell" size={15} /><span>Notify me</span></button>
    : alertLink ? (
      <a className="btn notify" href={alert} target="_blank" rel="noopener noreferrer" data-notify
        title={app.alerts?.[page.id] ? 'Opens this use case\u2019s alert in Databricks, where you can subscribe to it' : 'Opens the alerts in Databricks, where you can subscribe to this use case\u2019s alert'}>
        <Icon name="bell" size={15} /><span>Notify me</span>
      </a>
    ) : null;
  const colors = paletteItems(chrome?.palette, chrome?.built, chrome?.theme, chrome?.onPalette || (() => {}));
  const reporting = !!page.history;
  const promised = promisedView(page);
  const kpiRun = summary?.run;
  const kpiTargetSetting = settings?.settings?.find((s) => s.name === KPI_TARGET);
  const kpiTarget = kpiTargetSetting?.value ?? '';
  const kpiGapLine = kpiRun?.kpi_name ? `${kpiRun.kpi_name}: ${kpiGapText(kpiGap({ latest: kpiRun.kpi_latest, target: kpiTarget, direction: kpiRun.kpi_direction }), kpiRun.kpi_unit)}` : '';
  const report = { section: feedbackSectionOf(shown), filters: describeFilters(state, meta?.filters, meta?.columns), recordKey: opened };
  const head = (
    <header className="ph" data-tour="decision">
      <div className={freshness.busy ? 'pg-h is-refreshing' : 'pg-h'}>
        <h1>{page.title}</h1>
        <div className="ph-tools" data-section-tools>
          <FreshBar freshness={freshness}>
            {shown !== 'settings' && <PageLink pageId={page.id} meta={meta} state={state} view={shown} address={address} />}
            <details className="head-more" data-head-more>
              <summary className="btn top-ic" aria-label="More actions"><Icon name="dots" size={14} /><span>More</span></summary>
              <div className="head-more-menu"><Suspense fallback={null}><FeedbackButton pageId={page.id} context={report} sections={sections} reports={page.reports} /></Suspense></div>
            </details>
          </FreshBar>
        </div>
      </div>
      {!hubPage && <Suspense fallback={null}><ValueStrip page={page} data={data} app={app} /></Suspense>}
      {shown !== 'dashboard' && <p className="ph-sec" data-section-title>{sectionTitle(page, shown)}</p>}
      {shown === 'dashboard' && !hubPage && <p className="ph-q">{page.question}</p>}
      {shown === 'dashboard' && !hubPage && page.promised?.estimate && (
        <p className="ph-value ph-chip" data-value-estimate="">{valueLine(page.promised.estimate)} <button type="button" className="link" onClick={() => go('settings')}>How it is measured in Settings</button></p>
      )}
      {shown === 'dashboard' && !hubPage && data && <Story page={page} data={data.kpis} />}
      {shown === 'dashboard' && (
        <div className="ph-meta">
          <Icon name="calendar" size={13} />
          <span>
            {[runDate?.high ? dataThroughText(runDate.high, new Date().toISOString().slice(0, 10)) : meta ? '' : 'Reading the data range',
              page.sponsor ? `sponsor ${page.sponsor}` : '', app.built_at ? `built ${dayLabel(app.built_at.slice(0, 10))}` : '',
              backendText(app.backend)]
              .filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      <FreshDetail freshness={freshness} />
      <p className="print-only print-filters">Filters: {describeFilters(state, meta?.filters, meta?.columns)}</p>
    </header>
  );
  if (waitingFor) {
    return <Suspense fallback={null}><WaitingForAccess waiting={waitingFor} onCheck={() => { recheck(); setNonce((n) => n + 1); }} /></Suspense>;
  }
  const body = (
    <div className={`page ${busy && data ? 'is-busy' : ''}`} style={hueVars(page.hue || 'blue')} aria-busy={busy} data-page-section={shown}>
      {head}
      {shown === 'dashboard' && (
        <Dashboard app={app} page={page} meta={meta} state={state} onState={onState} view={view} onView={onView} hubPage={hubPage} laidOut={laidOut} work={work}
          onRetry={retry} onRetryMeta={onRetryMeta} onRetrySummary={onRetrySummary}
          hubEntry={hubEntry} live={live} summary={summary} latestRun={latestRun} onRuns={showRuns} data={data} error={error} failures={failures} plan={plan} topSlots={topSlots}
          moreSlots={moreSlots} more={more} kpisCard={kpisOf(page.kpis)} kpisOf={kpisOf} chartCards={chartCards} hubCharts={hubCharts} tableCard={tableCard}
          recordsCard={laidOut ? records() : null} explain={explain} genieBusy={genieBusy} nonce={nonce} onChanged={() => setNonce((n) => n + 1)} onAsk={onAsk}
          genie={genie} ready={ready} filters={filters} onPick={pick} onFix={fix} onWork={() => go('work')} onRun={freshness.ask} running={freshness.busy}
          trends={hubPage && trendsOn ? (
            <Suspense fallback={<Waiting />}>
              <TrendCards trends={trends.data} impact={trends.impact} error={trends.error} latest={counted.current.latest} page={page} app={app} themeKey={themeKey}
                onFix={tabbed ? fix : null} onRuns={showRuns} onFeedback={() => go('settings')}
                onExplain={explain} genieBusy={genieBusy} />
            </Suspense>
          ) : null} />
      )}
      {shown === 'inbox' && <Suspense fallback={<Waiting />}><InboxSection page={page} inbox={inbox} onOpen={openInbox} /></Suspense>}
      {shown === 'work' && !mode.queue && (
        <ModeView mode={mode.id} part="Work" app={app} page={page} meta={meta} state={state} onState={onState} ready={ready} tableCard={tableCard} genie={genie}
          views={<PageLink pageId={page.id} meta={meta} state={state} view={shown} address={address} />} notify={notifyButton} onGo={(to) => go(to)}
          onRun={freshness.ask} running={freshness.busy} />
      )}
      {shown === 'work' && mode.queue && (
        <Suspense fallback={<Waiting />}>        <WorkPage meta={meta} state={state} onState={onState} onRetryMeta={onRetryMeta} pageId={page.id} reasons={reasonFilters(entry, summary)} plan={plan} tab={tabNow} choices={choices}
          counts={queue?.data?.status_counts} onTab={(id) => go('work', { tab: id, focus: focused })} focus={focused} onClearFocus={() => go('work', { tab: tabNow })}>
          {records({ ready: ready && (!listed || live.done), tab: tabNow || undefined, focus: focused || undefined, docked: true, section: 'records' })}
        </WorkPage></Suspense>
      )}
      {shown === 'runs' && (
        <Suspense fallback={<Waiting />}>
          <Runs page={page} runs={runs} offset={runOffset} onOffset={setRunOffset} onExplain={hubExplain(app, onExplain, page.id)} genieBusy={genieBusy}
            trends={trends.data} themeKey={themeKey} app={app} onRun={freshness.ask} running={freshness.busy} opened={runOpen} />
          {app.alerting?.on && <Alerts app={app} page={page} meta={meta} compose={false} onComposed={composed} />}
        </Suspense>
      )}
      {shown === 'alerts' && <Suspense fallback={<Waiting />}><Alerts app={app} page={page} meta={meta} compose={compose} onComposed={composed} /></Suspense>}
      {shown === 'impact' && <Suspense fallback={<Waiting />}><PromisedDelivered app={app} page={page} summary={summary} /></Suspense>}
      {shown === 'settings' && (
        <SettingsPanel pageId={page.id} data={settings} error={settingsError} onData={setSettings} onChanged={() => setNonce((n) => n + 1)} onRun={freshness.ask} running={freshness.busy}
          footer={app.screens?.feedback !== false ? (
            <Suspense fallback={<Skeleton height={120} />}>
              <FeedbackSettings pageId={page.id} context={{ ...report, section: 'settings' }} sections={sections} reports={page.reports} owner={page.is_owner === true} />
            </Suspense>
          ) : null}>
          <SettingGroup id="look" title="Look" why="Only you see these, in this browser.">
            <div className="set-row" role="radiogroup" aria-label="Colors" onKeyDown={radioKeys}>
              {colors.map((item, i) => (
                <button key={item.label} type="button" role="radio" aria-checked={!!item.checked} className={`btn set-pal ${item.checked ? 'is-on' : ''}`} onClick={item.run}
                  tabIndex={item.checked || (i === 0 && !colors.some((c) => c.checked)) ? 0 : -1}>
                  {item.icon}<span>{item.label}</span>{item.note && <small>{item.note}</small>}
                </button>
              ))}
            </div>
            {chrome?.onTheme && (
              <button type="button" className="btn" onClick={chrome.onTheme} data-theme-toggle>
                <Icon name={chrome.theme === 'dark' ? 'sun' : 'moon'} size={15} />Switch to {chrome.theme === 'dark' ? 'light' : 'dark'} theme
              </button>
            )}
          </SettingGroup>
          <SettingGroup id="measurement" title="Measurement" why="How the value of this use case is measured, the target it should reach and how each number is worked out.">
            {kpiGapLine && <p data-kpi-gap>{kpiGapLine}.</p>}
            {promised?.estimate && <p data-measure-estimate>{promised.estimate}</p>}
            {promised?.value && <p>{promised.value}</p>}
            {promised?.benefits.length > 0 && <ul>{promised.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
            <Suspense fallback={null}><MoneyRule pageId={page.id} /></Suspense>
            {app.screens?.impact !== false && <dl className="measure-formulas">{MEASURES.map((m) => <div key={m.label}><dt>{m.label}</dt><dd>{m.formula}</dd></div>)}</dl>}
          </SettingGroup>
          {onTour && (
            <SettingGroup id="help" title="Help" why="A short walk through this page: what it helps you decide, its numbers, where to start and how to act.">
              <button type="button" className="btn" onClick={onTour} data-take-tour><Icon name="info" size={15} />Take the tour</button>
            </SettingGroup>
          )}
          <SettingGroup id="share" title="Share and follow" why="Copy a link to what you see, save a view, open the use case in Inspire Review, or get an alert.">
            <PageLink pageId={page.id} meta={meta} state={state} view={shown} address={address} />
            {review && <ReviewLink page={page} app={app} />}
            {notifyButton}
          </SettingGroup>
          <SettingGroup id="access" title="Access">
            {app.auth === 'user'
              ? <p className="auth" data-auth="user"><Icon name="lock" size={13} /><b>Your view.</b> Each person sees only the rows and columns their Unity Catalog grants allow. The App queries as you.</p>
              : <p className="auth" data-auth="app"><Icon name="users" size={13} /><b>Shared view.</b> Everyone sees the same data. The App reads it with its own service principal.</p>}
            {app.is_owner === true && <AdminLink />}
          </SettingGroup>
        </SettingsPanel>
      )}
    </div>
  );
  return <GenieScope.Provider value={scope}><RetryProvider value={retry}><SharedFailureScope value={shown === 'dashboard' ? failures.shared : ''}><FoldScope pageId={page.id}>{body}</FoldScope></SharedFailureScope></RetryProvider></GenieScope.Provider>;
}

function AdminLink({ on }) {
  return (
    <a className={`admin-link top-ic ${on ? 'is-on' : ''}`} data-more="tight" href={`#/${ADMIN_ROUTE}`} aria-current={on ? 'page' : undefined} aria-label="Admin" title="Admin">
      <Icon name="lock" size={13} /><span>Admin</span>
    </a>
  );
}
