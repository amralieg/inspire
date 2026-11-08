import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_CHANGED, EMPTY_LOOK, lookChart } from './agentView.js';
import { getOverview, getPage } from './api.js';
import { apiTables, apiValues, clearColumnValues, clearSelections, columnValues, setColumnValue, toggleValue } from './filters.js';
import { dayLabel } from './format.js';
import { filterWords } from './explain.js';
import { hueVars } from './theme.js';
import { DEFAULT_TAB, WORK_TABS, buildHash, describeFilters, fixThis, parseHash } from './links.js';
import { Block } from './Blocks.jsx';
import { blockPlan, gridSpans, slotsOf, withBlocks } from './blocks.js';
import { GenieMark, Icon } from './icons.jsx';
import Kpis, { Story } from './Kpis.jsx';
import ChartCard from './ChartCard.jsx';
import Records from './Records.jsx';
import Runs, { runCounts, useRuns } from './Runs.jsx';
import Alerts from './Alerts.jsx';
import { ReviewLink, hubExplain, reviewItem } from './Home.jsx';
import { genieOn } from './genieAsk.js';
import PageLink, { usePageAddress } from './PageLink.jsx';
import { FreshBar, FreshDetail, useFreshness } from './Freshness.jsx';
import { backendText, lastRunText, latestRunText } from './freshness.js';
import SettingsPanel, { SettingGroup, useSettings } from './Settings.jsx';
import { paletteItems } from './Palette.jsx';
import { AdminLink } from './Admin.jsx';
import { FoldScope, useMyView } from './MyView.jsx';
import { isLaidOut, isQueue, pageSections } from './Layouts.jsx';
import { windowParams } from './prefs.js';
import { pageDecides } from './records.js';
import { GenieScope } from './AskGenie.jsx';
import { reasonFilters, useCaseState } from './hub.js';
import Dashboard, { NO_SLOTS, TableCard, chartSlots, hubChartsOnTop } from './Dashboard.jsx';
import WorkPage from './WorkPage.jsx';
import { Skeleton } from './ui.jsx';

const FeedbackButton = lazy(() => import('./Feedback.jsx').then((m) => ({ default: m.FeedbackButton })));
const FeedbackSettings = lazy(() => import('./Feedback.jsx').then((m) => ({ default: m.FeedbackSettings })));

export const SECTION_TITLES = { dashboard: 'Dashboard', work: 'Work', performance: 'Performance', runs: 'Runs', alerts: 'Alerts', settings: 'Settings' };

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
  section = 'dashboard', tab = '', chrome, onCounts }) {
  const ready = !!state;
  const [nonce, setNonce] = useState(0);
  const [queue, setQueue] = useState(null);
  const [compose, setCompose] = useState(false);
  const composed = useCallback(() => setCompose(false), []);
  const [runNonce, setRunNonce] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
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
  const work = isQueue(page);
  const sections = pageSections(app, page);
  const shown = sections.includes(section) ? section : 'dashboard';
  const hubPage = !laidOut && listed && !!(live.data?.tracked || live.data?.empty || hubEntry?.tracked || hubEntry?.empty || !live.done);
  const entry = live.data || hubEntry;
  const tabbed = work && listed && !!app.options?.decisions && pageDecides(page) && !!entry?.tracked;
  const tabNow = tabbed ? (WORK_TABS.some(([id]) => id === tab) ? tab : DEFAULT_TAB) : '';
  const [question, setQuestion] = useState('');
  const [opened, setOpened] = useState(() => parseHash(window.location.hash).rec || '');
  const [seeChanged, setSeeChanged] = useState(() => (parseHash(window.location.hash).changed ? 1 : 0));
  const runsOn = sections.includes('runs');
  const go = (to, { tab: nextTab = '', state: next = state, sort } = {}) => {
    if (next !== state) onState(next);
    if (sort) onLook?.((l) => ({ ...l, sorts: { ...l.sorts, records: sort } }));
    window.location.hash = buildHash(page.id, to, next, meta?.filters, null, meta?.columns, nextTab);
  };
  const showRuns = runsOn ? () => go('runs') : null;
  const seeWhatChanged = page.records ? () => { go(work ? 'work' : 'dashboard'); setSeeChanged((n) => n + 1); } : showRuns;
  const runs = useRuns(page.id, runOffset, `${nonce}:${runNonce}`, runsOn);
  const counted = useRef({});
  if (runs.data?.offset === 0) counted.current = runCounts(runs.data);
  const runTotal = counted.current.runs;
  useEffect(() => { onCounts?.({ page: page.id, runs: runTotal }); }, [page.id, runTotal, onCounts]);
  const unreliable = hubPage && !!useCaseState(entry, summary).unreliable;
  const loading = !data;
  const pick = (filterId, value) => onState(toggleValue(state, filterId, value));
  const filters = apiValues(state);
  const scope = { page: page.id, filters: filterWords(meta?.filters, state) };
  const runDate = meta?.filters?.find((f) => f.type === 'date_range');
  const freshness = useFreshness({ page, showThrough: !!meta && !runDate?.high, onRefreshed: () => setNonce((n) => n + 1), onRun: () => setRunNonce((n) => n + 1),
    onSeeChanged: seeWhatChanged });
  const address = usePageAddress({ page, meta, state, onState, view: shown, onView: (to) => go(to), views: sections });
  const latestRun = counted.current.latest ? latestRunText(counted.current.latest) : freshness.fresh?.last_run ? `${lastRunText(freshness.fresh.last_run).text}.`
    : runs.busy ? 'Reading the latest run.' : latestRunText(null);
  const errors = data?.errors || {};
  const alert = app.alerts?.[page.id] || app.alerts_home;
  const notify = () => { go('alerts'); setCompose(true); };
  const alertLink = hubPage && !!alert && !app.alerting?.on && !app.alerting?.reason;
  const explain = genieOn(app, page.id) && onExplain
    ? (kind, title, context) => onExplain({ kind, page: page.id, title,
      context: kind === 'chart' ? { ...context, filters: [filterWords(meta?.filters, state), context.filters].filter(Boolean).join('; ') } : context })
    : null;
  const fix = work ? (opts) => {
    const next = fixThis(page, meta?.columns?.list, state, view, opts);
    go('work', { tab: tabbed ? next.tab : '', state: next.state, sort: next.sort });
  } : null;
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
  const tableCard = (table) => (
    <TableCard key={table.id} table={table} result={data?.tables?.[table.id]} error={errors[`table:${table.id}`]} loading={loading} onFilter={pick}
      pageId={page.id} filters={meta?.columns?.tables?.[table.id]} values={columnValues(state, table.id)}
      onColumn={(column, value) => onState(setColumnValue(state, table.id, column, value))} onClear={() => onState(clearColumnValues(state, table.id))}
      sort={sorts[table.id]} onSort={sortBy(table.id)} />
  );
  const kpisOf = (kpis, main = true) => <Kpis page={{ ...page, kpis }} data={data?.kpis} errors={errors} loading={loading} plan={main ? plan : null} scope={data?.scope} />;
  const records = (extra = {}) => (page.records && !unreliable ? (
    <Records meta={page.records} app={app} pageId={page.id} filters={filters} ready={ready} nonce={nonce} onFilter={pick} history={!!page.history} onList={setQueue}
      similarBy={page.similar_by} keepsActions={hubEntry ? !!(hubEntry.tracked && hubEntry.actions) : undefined}
      onChanged={() => setNonce((n) => n + 1)} onExplain={explain} genieBusy={genieBusy} ai={state?.ai} openKey={parseHash(window.location.hash).rec}
      sort={look.sorts?.records || null} onSort={sortBy('records')}
      columnMeta={meta?.columns?.list} columnValues={columnValues(state, null)}
      onColumn={(column, value) => onState(setColumnValue(state, null, column, value))} onClearColumns={() => onState(clearColumnValues(state, null))}
      onClearFilters={() => onState(clearColumnValues({ ...clearSelections(state), ai: {} }, null))} seeChanged={seeChanged} onShowRuns={showRuns}
      onOpen={setOpened} {...extra} />
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
  const report = { section: shown, filters: describeFilters(state, meta?.filters, meta?.columns), recordKey: opened };
  const head = (
    <header className="ph">
      <div className="pg-h">
        <h1>{page.title}</h1>
        <div className="ph-tools" data-section-tools>
          <FreshBar freshness={freshness}>
            <PageLink pageId={page.id} meta={meta} state={state} view={shown} address={address} />
            {reporting && (shown === 'dashboard' || shown === 'work') && <Suspense fallback={null}><FeedbackButton pageId={page.id} context={report} sections={sections} /></Suspense>}
          </FreshBar>
        </div>
      </div>
      {shown !== 'dashboard' && <p className="ph-sec" data-section-title>{SECTION_TITLES[shown]}</p>}
      {shown === 'dashboard' && !hubPage && <p className="ph-q">{page.question}</p>}
      {shown === 'dashboard' && !hubPage && page.promised?.estimate && <p className="ph-value" data-value-estimate="">{page.promised.estimate}</p>}
      {shown === 'dashboard' && !hubPage && data && <Story page={page} data={data.kpis} />}
      {shown === 'dashboard' && app.style === 'c' && genieOn(app, page.id) && (
        <form className="ask" onSubmit={(e) => { e.preventDefault(); if (question.trim()) { onAsk(question); setQuestion(''); } }}>
          <span className="ask-ic"><GenieMark size={18} /></span>
          <input dir="auto" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Ask Genie about ${page.title.toLowerCase()}…`} aria-label="Ask Genie" maxLength={1000} />
          <button className="btn btn--pri" type="submit"><Icon name="send" size={14} />Ask</button>
        </form>
      )}
      {shown === 'dashboard' && (
        <div className="ph-meta">
          <Icon name="calendar" size={13} />
          <span>
            {[runDate?.high ? `Data through ${dayLabel(runDate.high)}` : meta ? '' : 'Reading the data range',
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
  const body = (
    <div className={`page ${busy && data ? 'is-busy' : ''}`} style={hueVars(page.hue || 'blue')} aria-busy={busy} data-page-section={shown}>
      {head}
      {shown === 'dashboard' && (
        <Dashboard app={app} page={page} meta={meta} state={state} onState={onState} view={view} onView={onView} hubPage={hubPage} laidOut={laidOut} work={work}
          hubEntry={hubEntry} live={live} summary={summary} latestRun={latestRun} onRuns={showRuns} data={data} error={error} plan={plan} topSlots={topSlots}
          moreSlots={moreSlots} more={more} kpisCard={kpisOf(page.kpis)} kpisOf={kpisOf} chartCards={chartCards} hubCharts={hubCharts} tableCard={tableCard}
          recordsCard={laidOut ? records() : null} explain={explain} genieBusy={genieBusy} nonce={nonce} onChanged={() => setNonce((n) => n + 1)} onAsk={onAsk}
          genie={genie} ready={ready} filters={filters} onPick={pick} onFix={fix} onWork={() => go('work')} />
      )}
      {shown === 'work' && (
        <WorkPage meta={meta} state={state} onState={onState} pageId={page.id} reasons={reasonFilters(entry, summary)} plan={plan} tab={tabNow}
          counts={queue?.data?.status_counts} onTab={(id) => go('work', { tab: id })}>
          {records({ ready: ready && (!listed || live.done), tab: tabNow || undefined, docked: true, section: 'records' })}
        </WorkPage>
      )}
      {shown === 'runs' && <Runs page={page} runs={runs} offset={runOffset} onOffset={setRunOffset} onExplain={hubExplain(app, onExplain, page.id)} genieBusy={genieBusy} />}
      {shown === 'alerts' && <Alerts app={app} page={page} meta={meta} compose={compose} onComposed={composed} />}
      {shown === 'settings' && (
        <SettingsPanel pageId={page.id} data={settings} onData={setSettings} onChanged={() => setNonce((n) => n + 1)} onRunStarted={() => freshness.load()}
          footer={reporting && (
            <SettingGroup id="feedback" title="App Feedback" why="Tell the owners of this use case what is wrong or what you would change. They see it on its Build page in Inspire.">
              <Suspense fallback={<Skeleton height={120} />}>
                <FeedbackSettings pageId={page.id} context={{ ...report, section: 'settings' }} sections={sections} />
              </Suspense>
            </SettingGroup>
          )}>
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
  return <GenieScope.Provider value={scope}><FoldScope pageId={page.id}>{body}</FoldScope></GenieScope.Provider>;
}
