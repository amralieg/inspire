import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, AppWindow, BellRing, CheckCircle2, ChevronDown, CircleDashed, ExternalLink, FileText, Hammer, History, LayoutDashboard, Loader2,
  NotebookPen, Pencil, RefreshCw, Rocket, RotateCcw, Search, Sparkles, Trash2, Wand2, XCircle,
} from 'lucide-react';
import {
  statusChip, statusReason, nextSpecFrom, retryableOutputs, lostTables, lostTablesText, genieQuestions, appStatusRows, editedNotebook,
  runProfileText, versionActive, historyStatus, implementGroups, notebookRunEnded, notebookStatus, START_MVP_LABEL, IMPLEMENT_ACTIVE_STATUSES, IMPLEMENT_UNINSTALLED,
  vibesPreview, heldAsks, canBuildAgain, buildAgainChanges, buildAgainHint, resultTableMoveNote, IMPLEMENT_DONE_STATUSES, specFromHeld,
} from '../lib/implementWizard';
import { makeApiFetch, makeApiPostJson } from '../lib/apiClient';
import { buildUseCaseList } from '../lib/useCaseList';
import { workspaceNotebookUrl } from '../lib/workspaceLinks';
import { subtitleOfUseCase } from '../lib/useCaseFields';
import { reducedMotion } from '../lib/motion';
import { formatWhen } from '../lib/formatWhen';
import { plural } from '../lib/plural';
import ImplementStatusBadge from '../components/ImplementStatusBadge';
import ImplementWizard from './ImplementWizard';
import { AssetPanel, BuildControls, ConfirmDialog, NotebookPanel } from '../components/ImplementControlTower';
import UseCaseDrawer from '../components/UseCaseDrawer';
import UseCaseDetailBody from '../components/UseCaseDetailBody';
import InspireScoreBadge from '../components/InspireScoreBadge';
import Celebration from '../components/Celebration';
import GenieLogo from '../components/GenieLogo';
import GlobalVibe from '../components/GlobalVibe';
import VibeChecklist, { HeldVersion } from '../components/VibeChecklist';
import TabStrip, { tabPanel } from '../components/TabStrip';
import { Counter, CounterDivider, IconChip, PANEL_CLASS, SectionTitle } from '../components/BuildUi';
import { catalogRow } from '../lib/useCaseFacets';
import {
  BUILD_TAB, CONTROL_REFRESH_MS, MVP_TABS, RAIL_WIDTH, assetFilterCounts, assetGroups, assetUninstall, buildSummary, canPublishHeld, checksSummary, collectAsk, collectRemoval,
  collectedNoteText, collectedScope, controlRows, controlTiles, deliveredOutputs, dropCollected, filterByAsset, filterByMvp, heldVersion, idleMvpTab, implementDefaultTab, keptVersions,
  loadCollectedVibes, loadRailWidth, missingAsks, railWidth, rebuildingText, rephraseOf, rephrasedAsk, removeChanges, removeKeptChanges, removingAsk, rollbackChanges, rollingBackText,
  saveCollectedVibes, saveRailWidth, tryAgainChanges, uninstallChanges, vibeCards,
} from '../lib/implementControl';
import { mvpScope, mvpStages, mvpProgressSummary, mvpRepairOf, feedArrivals, progressPercent, steadyFeed, versionPlan, vibeChecklist } from '../lib/mvpProgress';
import MvpProgress from '../components/MvpProgress';
import GenieFeed from '../components/GenieFeed';
import MoneyReview, { NothingToActCard } from '../components/MoneyReview';
import TargetKpiCard from '../components/TargetKpiCard';
import UseCaseSettings from '../components/UseCaseSettings';
import { useGroupingProfile } from '../lib/groupingProfile';
import { isScopeSetting, runScopeFacts } from '../lib/runScope';
import { SETTINGS_ROUTES, settingsViewSaved } from '../lib/useCaseSettings';
import UseCaseAlerts from '../components/UseCaseAlerts';
import UseCaseTables from '../components/UseCaseTables';
import { liveImpact, rowImpact, targetKpiView, trackedKpiOf } from '../lib/targetKpi';
import { SHOWCASE_DASHBOARD_NOTE, SHOWCASE_GENIE_NOTE, SHOWCASE_NO_MVP, SHOWCASE_OPEN_APP, readOnlyReason } from '../lib/showcase';
import { buildFilterText } from '../lib/reviewFigures';

const OUTPUT_ICONS = { notebook: NotebookPen, dashboard: LayoutDashboard, genie_space: GenieLogo, app: AppWindow, alert: BellRing };
const OUTPUT_NAMES = { dashboard: 'Dashboard', genie_space: 'Genie Agent', app: 'App', alert: 'Alert' };
const NO_RAIL = { latest: [], notebook_run: null, notebook_run_error: '' };
const ERROR_BOX = 'text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2';
const NOTE_BOX = 'text-xs text-info-fg bg-info-bg border border-info/20 rounded-lg px-3 py-2';
const OUTLINE_BUTTON = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:bg-db-red-solid-hover shadow-sm shadow-db-red/20 disabled:opacity-50';
const LINK = 'text-sm font-semibold text-db-red-fg inline-flex items-center gap-1 hover:underline';
const DANGER_BUTTON = `${OUTLINE_BUTTON} border-error/40 text-error-fg`;
const TAB_ICONS = { build: Hammer, app: AppWindow, dashboard: LayoutDashboard, alert: BellRing, genie_space: GenieLogo, notebook: NotebookPen };
const COLLECT_LOST = 'This browser does not keep the vibes you add, so they are lost if you leave this page. Build them with Edit MVP first.';

const GROUP_LOOK = {
  in_progress: { icon: Loader2, tone: 'red', hint: 'Genie is working on these' },
  ready: { icon: CheckCircle2, tone: 'success', hint: 'Built and ready to use' },
  held: { icon: AlertTriangle, tone: 'warning', hint: 'Not published, because a vibe was not met' },
  failed: { icon: XCircle, tone: 'error', hint: 'Open one to see why' },
  not_started: { icon: CircleDashed, tone: 'idle', hint: 'Start an MVP with Genie' },
};

function PageHeader({ summary, loading, query, onQuery }) {
  const subtitle = loading
    ? 'Every use case of this session: what has an MVP or a Genie Code notebook, what is running, and what has not started.'
    : `Every use case of this session: ${plural(summary.mvps, 'MVP')}, ${plural(summary.notebooks, 'Genie Code notebook')}, ${summary.notStarted} not started yet.`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface shadow-sm">
          <Hammer size={20} className="text-db-red-fg" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] bg-gradient-to-br from-text-primary via-text-primary to-db-red bg-clip-text text-transparent">Build</h1>
          <p className="text-sm text-text-secondary">{subtitle}</p>
        </div>
      </div>
      <label className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <input
          type="search"
          aria-label="Search use cases"
          placeholder="Search by name, id or domain"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="w-72 pl-9 pr-3 py-2.5 text-sm border border-border rounded-xl bg-surface text-text-primary shadow-sm glow-focus"
        />
      </label>
    </div>
  );
}

function SummaryBanner({ summary }) {
  const { building } = summary;
  let mark = { icon: Sparkles, tone: 'idle' };
  let title = 'No MVP started yet';
  let line = 'Pick a use case on the left and start one with Genie.';
  if (building.length) {
    mark = { icon: Rocket, tone: 'red', live: true };
    title = `${plural(building.length, 'MVP')} building now`;
    line = building.map((item) => `${item.id}${item.latest?.status_message ? `: ${item.latest.status_message}` : ''}`).join(' · ');
  } else if (summary.mvps) {
    mark = summary.failed || summary.held ? { icon: AlertTriangle, tone: 'warning' } : { icon: CheckCircle2, tone: 'success' };
    title = `${summary.ready} of ${plural(summary.mvps, 'MVP')} ready`;
    const open = [
      summary.failed ? `${summary.failed} failed or stopped. Open one to see why.` : '',
      summary.held ? `${summary.held} not published, because a vibe was not met. Open one to rephrase, try again or publish anyway.` : '',
    ].filter(Boolean);
    line = open.length ? open.join(' ') : 'Every MVP of this session has finished building.';
  }
  return (
    <section aria-label="Build summary" className={PANEL_CLASS}>
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
            {mark.live && <span className="absolute inset-0 rounded-xl bg-db-red/25 motion-safe:animate-ping" aria-hidden />}
            <span className="relative"><IconChip icon={mark.icon} tone={mark.tone} size="lg" /></span>
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-text-primary tracking-tight">{title}</h2>
            <p className="text-[12px] text-text-secondary line-clamp-1">{line}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Counter value={summary.mvps} label="MVPs" />
          <CounterDivider />
          <Counter value={building.length} label="Building" tone="red" />
          <CounterDivider />
          <Counter value={summary.ready} label="Ready" tone="success" />
          {summary.held > 0 && (
            <>
              <CounterDivider />
              <Counter value={summary.held} label="Vibes not met" tone="warning" />
            </>
          )}
          {summary.failed > 0 && (
            <>
              <CounterDivider />
              <Counter value={summary.failed} label="Failed" tone="error" />
            </>
          )}
          <CounterDivider />
          <Counter value={summary.notebooks} label="Notebooks" />
          <CounterDivider />
          <Counter value={summary.notStarted} label="Not started" />
        </div>
      </div>
      {summary.delivered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-t border-border bg-bg-subtle/60">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary mr-1">Delivered so far</span>
          {summary.delivered.map((entry) => {
            const Icon = OUTPUT_ICONS[entry.id];
            return (
              <span key={entry.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success-bg text-success-fg text-[11px] font-medium">
                <Icon size={12} aria-hidden /> {entry.text}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OutputIcons({ latest }) {
  const ids = deliveredOutputs(latest);
  if (!ids.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {ids.map((id) => {
        const Icon = OUTPUT_ICONS[id];
        return (
          <span key={id} className="h-5 w-5 rounded-md bg-bg-subtle text-text-secondary flex items-center justify-center" aria-hidden>
            <Icon size={11} />
          </span>
        );
      })}
      <span className="sr-only">Delivered: {ids.map((id) => OUTPUT_NAMES[id]).join(', ')}</span>
    </span>
  );
}

const FILTER_ICONS = { notebook: NotebookPen, ...OUTPUT_ICONS };

function AssetFilters({ counts, asset, onAsset }) {
  const total = counts.reduce((most, entry) => Math.max(most, entry.count), 0);
  if (!total && !asset) return null;
  const chip = (on) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-smooth disabled:opacity-40 ${
    on ? 'border-db-red/40 bg-db-red-50 text-db-red-fg' : 'border-border bg-surface text-text-primary hover:bg-bg-subtle'}`;
  return (
    <div role="group" aria-label="Show use cases with" className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Show use cases with</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!asset} onClick={() => onAsset('')} className={chip(!asset)}>All</button>
        {counts.map((entry) => {
          const Icon = FILTER_ICONS[entry.id];
          const on = asset === entry.id;
          return (
            <button key={entry.id} type="button" data-asset-filter={entry.id} aria-pressed={on} disabled={!entry.count && !on} onClick={() => onAsset(on ? '' : entry.id)} className={chip(on)}>
              <Icon size={11} aria-hidden /> {entry.label} <span className="font-mono text-text-secondary">{entry.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Rail({ groups, listLoading, query, asset, mvp = '', assetLabel, shownId, onSelect }) {
  const mvpWords = mvp === 'live' ? 'a live MVP' : 'an MVP';
  return (
    <nav aria-label="Use cases" className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
      {listLoading && (
        <p className="flex items-center gap-2 px-1 text-[12px] text-text-secondary"><Loader2 size={14} className="animate-spin" /> Loading the use cases…</p>
      )}
      {!listLoading && (query.trim() || asset || mvp) && groups.every((group) => group.items.length === 0) && (
        <p className="px-1 text-[12px] text-text-secondary">
          {asset ? `No use case${query.trim() ? ` matching "${query.trim()}"` : ''} has ${/^[AEIOU]/.test(assetLabel) ? 'an' : 'a'} ${assetLabel} yet.`
            : mvp ? `No use case${query.trim() ? ` matching "${query.trim()}"` : ''} has ${mvpWords} yet.`
              : <>No use case matches &quot;{query.trim()}&quot;.</>}
        </p>
      )}
      {!listLoading && groups.map((group) => {
        const look = GROUP_LOOK[group.id] || GROUP_LOOK.not_started;
        return (
          <section key={group.id} aria-label={group.label} className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border bg-gradient-to-b from-db-red-50 to-surface">
              <IconChip icon={look.icon} tone={look.tone} size="sm" />
              <div className="flex-1 min-w-0">
                <h2 className="text-xs font-bold text-text-primary">{group.label}<span className="sr-only"> ({group.items.length})</span></h2>
                <p className="text-[10px] text-text-secondary">{look.hint}</p>
              </div>
              <span className="text-[11px] font-mono font-semibold text-text-secondary bg-bg-subtle rounded-md px-1.5 py-0.5" aria-hidden>{group.items.length}</span>
            </div>
            <div className="p-1.5 space-y-0.5">
              {group.items.length === 0 && <p className="px-3 py-2 text-[11px] text-text-secondary">None</p>}
              {group.items.map((item) => {
                const on = item.id === shownId;
                const building = group.id === 'in_progress';
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    data-building={building ? '' : undefined}
                    onClick={() => onSelect(item.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-smooth ${on ? 'bg-db-red-50 border-db-red/25' : 'border-transparent hover:bg-bg-subtle'} ${
                      building ? 'rail-building' : ''}`}
                  >
                    <div className={`text-[12.5px] font-semibold leading-snug line-clamp-2 ${on ? 'text-db-red-fg' : 'text-text-primary'}`}>{item.name}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] text-text-secondary">{item.id}</span>
                        <ImplementStatusBadge state={item.state} />
                      </span>
                      <OutputIcons latest={item.latest} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

function RailResizer({ width, onWidth }) {
  const drag = useRef(null);
  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (drag.current) onWidth(drag.current.width + e.clientX - drag.current.x);
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e) => {
    const to = { ArrowLeft: width - RAIL_WIDTH.step, ArrowRight: width + RAIL_WIDTH.step, Home: RAIL_WIDTH.min, End: RAIL_WIDTH.max }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onWidth(to);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the use case list"
      aria-valuemin={RAIL_WIDTH.min}
      aria-valuemax={RAIL_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      data-rail-resizer=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="group hidden md:flex sticky top-[4.5rem] self-start h-[calc(100dvh-5.5rem)] w-3 shrink-0 cursor-col-resize touch-none justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40"
    >
      <span aria-hidden className="h-full w-px bg-border transition-smooth group-hover:w-0.5 group-hover:bg-db-red/60" />
    </div>
  );
}

function BuildFilterStrip({ filter, sessionId, onPickRun, onClear }) {
  return (
    <section aria-label="Filter from Start" data-build-filter={filter.key} className="rounded-xl border border-db-red/30 bg-db-red-50 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="min-w-0 text-[12px] font-medium text-db-red-fg">{buildFilterText(filter, sessionId)}</p>
        <button type="button" onClick={onClear}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-db-red/30 bg-surface px-2 py-1 text-[11px] font-semibold text-db-red-fg hover:bg-db-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red">
          <XCircle size={11} aria-hidden /> Clear
        </button>
      </div>
      {filter.runs.length > 1 && (
        <div role="group" aria-label={`Runs with ${filter.many}`} className="flex flex-wrap gap-1.5">
          {filter.runs.map((run) => {
            const on = run.session_id === String(sessionId);
            return (
              <button key={run.session_id} type="button" data-build-run={run.session_id} aria-pressed={on} onClick={() => { if (!on) onPickRun(run.session_id); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red ${
                  on ? 'border-db-red/50 bg-surface text-db-red-fg' : 'border-border bg-surface text-text-primary hover:bg-bg-subtle'}`}>
                {run.name} <span className="font-mono text-text-secondary">{run.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ImplementPage({ settings, sessionId, focusId = null, onFocus, onOpenRun = null, filter = null, onPickRun, onClearFilter }) {
  const { token, databricksHost, showcase = '' } = settings;
  const readOnly = Boolean(showcase);
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const apiPostJson = useMemo(() => makeApiPostJson({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const [useCases, setUseCases] = useState([]);
  const [discoveryType, setDiscoveryType] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [rail, setRail] = useState(NO_RAIL);
  const [railError, setRailError] = useState('');
  const [query, setQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState(filter?.asset || '');
  const [mvpFilter, setMvpFilter] = useState(filter?.mvp || '');
  const [chosenId, setChosenId] = useState(focusId);
  const [wizard, setWizard] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const lastNotebookRun = useRef(null);
  const [views, setViews] = useState({});
  const rememberView = useCallback((id, view) => setViews((prev) => (prev[id] === view ? prev : { ...prev, [id]: view })), []);
  const [railPx, setRailPx] = useState(() => loadRailWidth());
  useEffect(() => { saveRailWidth(railPx); }, [railPx]);
  const scopeOf = (id) => collectedScope(databricksHost || globalThis.location?.host || '', settings.inspireDatabase, sessionId, id);

  const qBase = useMemo(() => new URLSearchParams({
    inspire_database: settings.inspireDatabase,
    warehouse_id: settings.warehouseId,
    session_id: String(sessionId),
  }).toString(), [settings.inspireDatabase, settings.warehouseId, sessionId]);

  const fetchUseCases = useCallback(async () => {
    const [res, rows] = await Promise.allSettled([
      apiFetch(`/api/inspire/results?${qBase}`),
      apiFetch(`/api/inspire/usecases?${qBase}`),
    ]);
    const results = res.status === 'fulfilled' ? res.value?.results || null : null;
    const tracked = rows.status === 'fulfilled' ? rows.value?.usecases || null : null;
    if (!results && !tracked?.length) {
      const failed = [res, rows].find((r) => r.status === 'rejected');
      throw new Error(failed ? failed.reason.message : 'This session has no use cases yet.');
    }
    return { discoveryType: results?.discovery_type || '', list: buildUseCaseList(results, tracked) };
  }, [apiFetch, qBase]);

  const loadRail = useCallback(async () => {
    const data = await apiFetch(`/api/inspire/implement/history?${qBase}`);
    const run = data.notebook_run || null;
    const prev = lastNotebookRun.current;
    lastNotebookRun.current = run;
    if (notebookRunEnded(prev, run)) setListVersion((n) => n + 1);
    setRail({ latest: data.latest || [], notebook_run: run, notebook_run_error: data.notebook_run_error || '' });
    setRailError('');
  }, [apiFetch, qBase]);

  useEffect(() => {
    let cancelled = false;
    fetchUseCases()
      .then((got) => {
        if (cancelled) return;
        setDiscoveryType(got.discoveryType);
        setUseCases(got.list);
        setListError('');
      })
      .catch((e) => { if (!cancelled) setListError(e.message); })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [fetchUseCases, listVersion]);

  useEffect(() => {
    const tick = () => loadRail().catch((e) => setRailError(e.message));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [loadRail]);

  const searched = useMemo(() => implementGroups(useCases, rail.latest, rail.notebook_run, query), [useCases, rail.latest, rail.notebook_run, query]);
  const assetCounts = useMemo(() => assetFilterCounts(searched.flatMap((g) => g.items)), [searched]);
  const groups = useMemo(() => filterByMvp(filterByAsset(searched, assetFilter), mvpFilter), [searched, assetFilter, mvpFilter]);
  const clearFilter = () => {
    setAssetFilter('');
    setMvpFilter('');
    onClearFilter?.();
  };
  const pickAsset = (asset) => {
    if (filter) {
      setMvpFilter('');
      onClearFilter?.();
    }
    setAssetFilter(asset);
  };
  const allItems = useMemo(() => implementGroups(useCases, rail.latest, rail.notebook_run).flatMap((g) => g.items), [useCases, rail.latest, rail.notebook_run]);
  const summary = useMemo(() => buildSummary(allItems), [allItems]);
  const shownId = chosenId || groups.flatMap((g) => g.items)[0]?.id || allItems[0]?.id || null;
  const selected = allItems.find((item) => item.id === shownId) || null;

  const select = (id) => {
    setChosenId(id);
    onFocus?.(id);
  };

  const onImplemented = (data) => {
    if (wizard?.focus?.collected?.length && data?.use_case_id) saveCollectedVibes(scopeOf(data.use_case_id), []);
    setWizard(null);
    if (data?.use_case_id) select(data.use_case_id);
    setRefreshKey((n) => n + 1);
    if (data?.mode === 'notebook') setListVersion((n) => n + 1);
    loadRail().catch((e) => setRailError(e.message));
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4" data-implement-page="">
      <PageHeader summary={summary} loading={listLoading} query={query} onQuery={setQuery} />
      {!listLoading && !listError && <SummaryBanner summary={summary} />}
      {filter && <BuildFilterStrip filter={filter} sessionId={sessionId} onPickRun={onPickRun} onClear={clearFilter} />}
      {listError && <p className={ERROR_BOX}>{listError}</p>}
      {railError && <p className={ERROR_BOX}>{railError}</p>}
      <div className="flex flex-col md:flex-row gap-4 md:gap-2 md:items-start">
        <div data-implement-rail="" style={{ '--rail-w': `${railPx}px` }}
          className="w-full md:w-(--rail-w) shrink-0 md:sticky md:top-[4.5rem] md:self-start flex flex-col gap-3 max-h-[50dvh] md:max-h-[calc(100dvh-5.5rem)]">
          {!listLoading && <AssetFilters counts={assetCounts} asset={assetFilter} onAsset={pickAsset} />}
          <Rail groups={groups} listLoading={listLoading} query={query} asset={assetFilter} mvp={mvpFilter}
            assetLabel={assetCounts.find((entry) => entry.id === assetFilter)?.label || ''} shownId={shownId} onSelect={select} />
        </div>
        <RailResizer width={railPx} onWidth={(width) => setRailPx(railWidth(width))} />
        <section aria-label="Use case" className="flex-1 min-w-0 space-y-4">
          {selected ? (
            <UseCaseDetail
              key={selected.id}
              item={selected}
              sessionId={sessionId}
              settings={settings}
              qBase={qBase}
              apiFetch={apiFetch}
              apiPostJson={apiPostJson}
              databricksHost={databricksHost}
              notebookRunError={rail.notebook_run_error}
              refreshKey={refreshKey}
              savedView={views[selected.id] || null}
              openTab={filter?.asset || ''}
              collectedKey={scopeOf(selected.id)}
              onView={(view) => rememberView(selected.id, view)}
              onEdit={readOnly ? undefined : (focus, live) => setWizard({ uc: selected.uc, focus, live })}
              onOpenRun={onOpenRun}
              readOnly={readOnly}
            />
          ) : (
            !listLoading && !listError && <p className={`${PANEL_CLASS} p-6 text-[12px] text-text-secondary`}>This session has no use cases yet.</p>
          )}
        </section>
      </div>
      {wizard && !readOnly && (
        <ImplementWizard
          uc={wizard.uc}
          sessionId={sessionId}
          settings={settings}
          discoveryType={discoveryType}
          apiFetch={apiFetch}
          apiPostJson={apiPostJson}
          focus={wizard.focus}
          live={wizard.live}
          onClose={() => setWizard(null)}
          onImplemented={onImplemented}
          onOpenBuild={() => setWizard(null)}
        />
      )}
    </div>
  );
}

function VersionRow({ card, version, locked, lockedReason, pending, confirming, onAsk, onCancel, onConfirm }) {
  const confirmRef = useRef(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [confirming]);
  const name = `version ${version.version}`;
  return (
    <li data-version={version.version} className="py-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-text-primary">Version {version.version}</span>
        {version.at && <span className="text-text-secondary">· {formatWhen(version.at, version.at)}</span>}
        <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-text-secondary">{statusChip(version.status).label}</span>
        <button type="button" disabled={locked || confirming} title={lockedReason || undefined} onClick={onAsk} aria-label={`Roll back to ${name}`} className={`ml-auto ${OUTLINE_BUTTON}`}>
          <History size={12} /> Roll back
        </button>
      </div>
      <p className="truncate text-text-secondary" title={version.vibes || undefined}>
        {version.vibes ? `“${vibesPreview(version.vibes)}”` : 'no vibes'}
      </p>
      {version.checks?.length > 0 && <p data-version-checks="" className="text-text-secondary">{checksSummary(version.checks)}</p>}
      {confirming && (
        <div ref={confirmRef} role="group" aria-label={`Confirm the roll back to ${name}`}
          className="rounded-lg border border-border-strong bg-bg-subtle px-3 py-2 space-y-2 motion-safe:animate-terminal-line">
          <p className="text-text-primary">
            {card.gone
              ? `Roll back the ${card.label} to ${name}? The ${card.label} no longer exists, so Genie builds a new one from the vibes of ${name}.`
              : `Roll back the ${card.label} to ${name}? This replaces the live ${card.label}; Genie is not called.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={locked} onClick={onConfirm} className={PRIMARY_BUTTON}>
              {pending ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />} Roll back
            </button>
            <button type="button" onClick={onCancel} className={OUTLINE_BUTTON}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

const CHECK_LOOK = {
  done: { mark: '✓', said: 'Done: ', border: 'border-border', node: 'bg-success-bg text-success-fg ring-success/30' },
  missing: { mark: '!', said: 'Not done yet: ', border: 'border-error/40', node: 'bg-error-bg text-error-fg ring-error/30' },
};

function checkLine(check, card) {
  if (check.done) return `${sentence(check.evidence || 'Checked')} Version ${card.checkedOn}.`;
  return `Not done yet. ${check.evidence ? sentence(check.evidence) : `Inspire could not find this in version ${card.checkedOn}.`} This ${card.noun} is marked ready with warnings.`;
}

function AskChecklist({ card, locked, lockedReason, pending, onTryAgain }) {
  const missing = missingAsks(card.checks);
  return (
    <div data-checks="" className="space-y-2">
      <p className={`text-[14px] font-bold ${missing.length ? 'text-error-fg' : 'text-success-fg'}`}>{checksSummary(card.checks)}</p>
      <ul aria-label={`What you asked for on the ${card.label}`} className="space-y-1.5">
        {card.checks.map((check, i) => {
          const state = check.done ? 'done' : 'missing';
          const look = CHECK_LOOK[state];
          return (
            <li key={`${i}-${check.ask}`} data-check={state} className={`flex items-start gap-2.5 rounded-lg border bg-surface px-3 py-2 text-[12px] ${look.border}`}>
              <span aria-hidden className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${look.node}`}>
                {look.mark}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-text-primary"><span className="sr-only">{look.said}</span>{check.ask}</p>
                <p className="text-text-secondary">{checkLine(check, card)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && card.rebuild && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button type="button" disabled={locked || pending} title={lockedReason || undefined} onClick={() => onTryAgain(missing)} className={PRIMARY_BUTTON}>
            {pending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Try again with the {missing.length === 1 ? 'missing thing' : `${missing.length} missing things`}
          </button>
          <span className="text-[11px] text-text-secondary">Only what is missing is rebuilt.</span>
        </div>
      )}
    </div>
  );
}

const PILL_TONE = {
  success: 'bg-success-bg text-success-fg ring-success/30',
  warning: 'bg-warning-bg text-warning-fg ring-warning/30',
  busy: 'bg-info-bg text-info-fg ring-info/30',
  error: 'bg-error-bg text-error-fg ring-error/30',
};
const CARD = 'rounded-xl border border-border bg-surface shadow-sm';

function AssetPill({ state, children }) {
  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-bold ring-1 ring-inset ${PILL_TONE[state?.tone] || 'bg-bg-subtle text-text-secondary ring-border'}`}>
      {children || state?.label}
    </span>
  );
}

function AssetVersions({ asset, locked, lockedReason, onRollback }) {
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const owner = asset.id === asset.output ? asset : asset.parent;
  const versions = owner?.versions || [];
  if (!asset.live && !versions.length) return null;
  const rollback = async (version) => {
    setPending(version.version);
    const ok = await onRollback(owner.id, version);
    setPending(null);
    if (ok) setConfirming(null);
  };
  return (
    <section aria-label="Versions" className={CARD}>
      <div className="px-4 pt-3.5">
        <h4 className="text-[15px] font-semibold text-text-primary">Versions</h4>
        <p className="text-[12px] text-text-secondary">
          {owner === asset ? 'Roll back puts an earlier version live again' : `Roll back puts the whole ${owner?.label} of an earlier version live again`}
        </p>
      </div>
      <ul aria-label={`Versions of the ${asset.label}`} className="px-4 pb-2 divide-y divide-border text-[12px]">
        {asset.live && (
          <li data-version={asset.live.version} data-live-version="" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
            <span className="font-semibold text-text-primary">Version {asset.live.version}</span>
            {asset.live.at && <span className="text-text-secondary">· {formatWhen(asset.live.at, asset.live.at)}</span>}
            <span className="ml-auto"><AssetPill state={{ tone: 'success' }}>Live</AssetPill></span>
            <p className="w-full truncate text-text-secondary" title={asset.vibes || undefined}>{asset.vibes ? `“${vibesPreview(asset.vibes)}”` : 'no vibes'}</p>
          </li>
        )}
        {versions.map((version) => (
          <VersionRow
            key={version.version}
            card={owner}
            version={version}
            locked={locked || pending !== null}
            lockedReason={lockedReason}
            pending={pending === version.version}
            confirming={confirming === version.version}
            onAsk={() => setConfirming(version.version)}
            onCancel={() => setConfirming(null)}
            onConfirm={() => rollback(version)}
          />
        ))}
      </ul>
    </section>
  );
}

function HeldAsks({ asset, collected, readOnly, onRemove, onKeep }) {
  const asks = heldAsks(asset.vibes);
  if (!asks.length) return null;
  const removing = asks.map((ask) => removingAsk(collected, asset.id, ask));
  return (
    <div data-built-with="" className="space-y-1.5">
      <p className="text-[12px] font-semibold text-text-primary">Built with</p>
      <ul aria-label={`Asks the ${asset.label} holds`} className="space-y-1">
        {asks.map((ask, i) => (
          <li key={`${i}-${ask}`} data-held-ask={removing[i] ? 'removing' : 'held'}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-subtle/60 px-3 py-1.5 text-[12px]">
            <span className={`min-w-0 ${removing[i] ? 'line-through text-text-secondary' : 'text-text-primary'}`}>
              “{ask}”{removing[i] && <span className="sr-only">, taken out when Edit MVP builds</span>}
            </span>
            {!readOnly && (
              <button type="button" onClick={() => (removing[i] ? onKeep(removing[i]) : onRemove(asset, ask))} aria-label={`${removing[i] ? 'Keep' : 'Remove'} “${ask}”`}
                className={`shrink-0 ${OUTLINE_BUTTON}`}>
                {removing[i] ? <RotateCcw size={12} /> : <Trash2 size={12} />} {removing[i] ? 'Keep it' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {removing.some(Boolean) && <p className="text-[11px] text-text-secondary">Edit MVP builds the next version without the asks you remove.</p>}
    </div>
  );
}

function AssetCard({ asset, collected, locked, lockedReason, readOnly, active, error, money = null, moneyError = '', scope = null, onRemoveAsk, onKeepAsk, onTryAgain, onRollback }) {
  const [pending, setPending] = useState('');
  const busy = asset.building;
  const send = async (kind, run) => {
    setPending(kind);
    await run();
    setPending('');
  };
  const steps = busy ? [
    busy.asks ? `Reading what you asked: ${busy.asks} ${busy.asks === 1 ? 'thing' : 'things'}` : 'Reading what you asked',
    rebuildingText(asset),
    'Checking each thing you asked for',
  ] : [];
  return (
    <div className="min-w-0 space-y-4">
      <article data-vibe-card={asset.id} aria-label={asset.title} className={CARD}>
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="min-w-0">
            <h4 className="text-[15px] font-semibold text-text-primary">{asset.title}</h4>
            <p className="text-[12px] text-text-secondary">{asset.group}</p>
          </div>
          <AssetPill state={asset.state} />
        </header>
        <div className="px-4 pb-4 pt-2 space-y-3 text-[12px]">
          <p className="text-[13px] text-text-secondary">{asset.what}</p>
          <p data-live="" className="flex items-center gap-1.5 text-text-secondary">
            <History size={13} aria-hidden />
            {asset.live ? `Version ${asset.live.version}, built ${formatWhen(asset.live.at, asset.live.at) || 'on an earlier run'}` : 'Its last build failed, so no version of it is live'}
          </p>
          {active && !busy && <p className="font-medium text-text-primary">A version is building now; roll backs apply after it finishes, and the asks you add or remove wait for Edit MVP.</p>}
          {asset.id === 'value_formula' && <MoneyReview money={money} error={moneyError} impact={asset.impact} scope={scope} />}
          {asset.rebuild && <HeldAsks asset={asset} collected={collected} readOnly={readOnly} onRemove={onRemoveAsk} onKeep={onKeepAsk} />}
          {busy?.rollback && (
            <p data-rolling-back="" className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <Loader2 size={13} className="motion-safe:animate-spin text-info-fg" aria-hidden />
              {rollingBackText(asset)}
            </p>
          )}
          {busy && !busy.rollback && (
            <ol aria-label={`Rebuilding the ${asset.label}`} className="space-y-2 text-[13px]">
              {steps.map((step, k) => {
                const state = k < busy.step ? 'done' : k === busy.step ? 'now' : 'next';
                return (
                  <li key={step} data-step={state} className={`flex items-center gap-2.5 ${state === 'next' ? 'text-text-secondary' : 'text-text-primary'} ${state === 'now' ? 'font-semibold' : ''}`}>
                    <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${
                      state === 'done' ? 'bg-success-bg text-success-fg ring-success/30' : state === 'now' ? 'bg-info-bg text-info-fg ring-info/30' : 'bg-surface text-text-secondary ring-border'}`}>
                      {state === 'done' ? '✓' : k + 1}
                    </span>
                    {step}
                  </li>
                );
              })}
            </ol>
          )}
          {!busy && asset.checks.length > 0 && (
            <AskChecklist card={asset} locked={locked || Boolean(pending)} lockedReason={lockedReason} pending={pending === 'retry'} onTryAgain={(asks) => send('retry', () => onTryAgain(asset.id, asks))} />
          )}
          {!busy && asset.warnings.length > 0 && (
            <ul aria-label={`Vibes Genie could not do on the ${asset.label}`} className="space-y-0.5">
              {asset.warnings.map((w) => <li key={w} className="flex items-start gap-1.5 text-[11px] text-warning-fg"><AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />{w}</li>)}
            </ul>
          )}
          {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
        </div>
      </article>
      <AssetVersions asset={asset} locked={locked} lockedReason={lockedReason} onRollback={onRollback} />
    </div>
  );
}

const PART_TABS = 'vibe-part';

function PartTabs({ assets, picked, onPick }) {
  if (assets.length < 2) return null;
  const tabs = assets.map((asset) => ({ id: asset.id, label: asset.title, ariaLabel: `${asset.title}, ${asset.state?.label || ''}`, mark: <AssetPill state={asset.state} /> }));
  return <TabStrip label="Pick a part" idBase={PART_TABS} tabs={tabs} current={picked} onPick={onPick} />;
}

function UseCaseDetail({ item, sessionId, settings, qBase, apiFetch, apiPostJson, databricksHost, notebookRunError, refreshKey, savedView, collectedKey,
  onView, onEdit, onOpenRun = null, readOnly = false, openTab = '' }) {
  const useCaseId = item.id;
  const hasMvp = Boolean(item.latest);
  const viewId = useId();
  const tabRefs = useRef({});
  const [status, setStatus] = useState(null);
  const [view, setView] = useState(savedView || (openTab ? implementDefaultTab(null, false, openTab) : null));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overrides, setOverrides] = useState({});
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [live, setLive] = useState(null);
  const [liveError, setLiveError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [celebrations, setCelebrations] = useState(0);
  const [pickedParts, setPickedParts] = useState({});
  const [cardFailed, setCardFailed] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [money, setMoney] = useState(null);
  const [settingsView, setSettingsView] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  const [moneyError, setMoneyError] = useState('');
  const [collected, setCollected] = useState(() => ({ at: refreshKey, entries: loadCollectedVibes(collectedKey) }));
  if (collected.at !== refreshKey) setCollected({ at: refreshKey, entries: loadCollectedVibes(collectedKey) });
  const vibes = collected.entries;
  const [collectError, setCollectError] = useState('');
  const [rephrase, setRephrase] = useState(null);
  const [heldBusy, setHeldBusy] = useState('');
  const lastStatus = useRef(null);

  const [arrivals, setArrivals] = useState(null);

  const loadStatus = useCallback(async () => {
    const data = await apiFetch(`/api/inspire/implement/status?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`);
    setStatus((prev) => steadyFeed(prev, data));
    setArrivals((prev) => feedArrivals(prev, data.feed, Date.now()));
  }, [apiFetch, qBase, useCaseId]);

  const loadLive = useCallback(async () => {
    try {
      setLive(await apiFetch(`/api/inspire/implement/live?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`));
      setLiveError('');
    } catch (e) {
      setLiveError(e.message);
    }
  }, [apiFetch, qBase, useCaseId]);

  useEffect(() => {
    if (!hasMvp) return undefined;
    loadLive();
    const id = setInterval(loadLive, CONTROL_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasMvp, loadLive, refreshKey]);

  useEffect(() => {
    if (!hasMvp) return undefined;
    loadStatus().catch((e) => setError(e.message));
    const id = setInterval(() => { loadStatus().catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [hasMvp, loadStatus, refreshKey]);

  const latest = status ? status.latest : item.latest;
  const stalled = (status ? status.stalled : item.latest?.stalled) || null;
  const uninstalled = latest?.status === IMPLEMENT_UNINSTALLED;
  const built = hasMvp && !uninstalled;
  const moneyKey = `${latest?.spec_version ?? ''}:${latest?.status ?? ''}`;
  useEffect(() => {
    if (!hasMvp) return undefined;
    let live = true;
    apiFetch(`/api/inspire/implement/money?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`)
      .then((data) => { if (live) { setMoney(data); setMoneyError(''); } })
      .catch((e) => { if (live) setMoneyError(e.message); });
    return () => { live = false; };
  }, [hasMvp, apiFetch, qBase, useCaseId, moneyKey, refreshKey]);
  useEffect(() => {
    if (!hasMvp) return undefined;
    let live = true;
    apiFetch(`${SETTINGS_ROUTES.read}?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`)
      .then((data) => { if (live) { setSettingsView(data); setSettingsError(''); } })
      .catch((e) => { if (live) setSettingsError(e.message); });
    return () => { live = false; };
  }, [hasMvp, apiFetch, qBase, useCaseId, moneyKey, refreshKey]);
  const [runsView, setRunsView] = useState(null);
  useEffect(() => {
    if (!hasMvp || readOnly) return undefined;
    let live = true;
    apiFetch(`${SETTINGS_ROUTES.runs}?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`)
      .then((data) => { if (live) setRunsView(data); })
      .catch((e) => { if (live) setRunsView({ runs: [], error: e.message }); });
    return () => { live = false; };
  }, [hasMvp, readOnly, apiFetch, qBase, useCaseId, moneyKey, refreshKey]);
  const scopeFacts = useMemo(() => (runsView?.error ? { error: runsView.error } : runScopeFacts(runsView?.runs)), [runsView]);
  const settingsPost = useCallback((action, body) => apiPostJson(`${SETTINGS_ROUTES[action]}?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`, body),
    [apiPostJson, qBase, useCaseId]);
  const previewSetting = useCallback((name, value) => settingsPost('preview', { name, value }), [settingsPost]);
  const saveSetting = useCallback(async (name, value, was, note) => {
    const view = await settingsPost('save', { name, value, was, note });
    setSettingsView((prev) => settingsViewSaved(prev, view));
  }, [settingsPost]);
  const runSettings = useCallback(() => settingsPost('run', {}), [settingsPost]);
  const scopeProfile = useGroupingProfile({
    apiPostJson, inspireDatabase: settings.inspireDatabase, sessionId, useCaseId, warehouseId: settings.warehouseId,
    enabled: !readOnly && Boolean(settingsView?.settings?.some(isScopeSetting)),
  });
  const [tablesView, setTablesView] = useState(null);
  useEffect(() => {
    if (!hasMvp) return undefined;
    let live = true;
    apiFetch(`/api/inspire/implement/tables?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`)
      .then((data) => { if (live) setTablesView(data); })
      .catch((e) => { if (live) setTablesView({ editable: false, why: `Inspire could not tell who may change the tables: ${e.message}` }); });
    return () => { live = false; };
  }, [hasMvp, apiFetch, qBase, useCaseId, moneyKey, refreshKey]);
  const tableSwaps = useCallback((table) => apiPostJson(`/api/inspire/implement/swaps?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`,
    { table, required_columns: [] }).then((data) => ({ swaps: data.swaps || [], why: data.why || '' })), [apiPostJson, qBase, useCaseId]);
  const tableChange = useCallback((next) => apiPostJson(`/api/inspire/implement/table-change?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`,
    { spec: next }), [apiPostJson, qBase, useCaseId]);
  const chip = statusChip(latest?.status, stalled);
  const tracked = trackedKpiOf(status?.history, latest);
  const kpiView = targetKpiView(tracked?.record, money?.run, liveImpact(money?.run, tracked?.impact || rowImpact(latest)));
  const spec = latest?.spec_json || {};
  const widgets = Array.isArray(status?.rerun_widgets) ? status.rerun_widgets : [];
  const active = versionActive(latest, stalled);
  const missing = lostTables(latest, rerunError);
  const edited = latest?.status === 'failed' ? editedNotebook(latest) : null;
  const reason = missing.length || edited ? '' : statusReason(latest, stalled);
  const genie = genieQuestions(latest);
  const genieAsset = latest?.asset_status?.genie_space || {};
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  const stages = useMemo(() => mvpStages(status?.steps, latest, { now, stalled }), [status?.steps, latest, now, stalled]);
  const repair = useMemo(() => mvpRepairOf(status?.steps, latest), [status?.steps, latest]);
  const plan = useMemo(() => versionPlan(status?.steps, latest), [status?.steps, latest]);
  const scope = useMemo(() => mvpScope(status?.steps, latest), [status?.steps, latest]);
  const progress = mvpProgressSummary(stages, latest, { now, stalled, repair });
  const row = useMemo(() => (item.uc ? catalogRow(item.uc, 0, { statusOf: () => item.state }) : null), [item.uc, item.state]);
  const subtitle = item.uc ? subtitleOfUseCase(item.uc, item.name) : '';

  const idleTab = idleMvpTab(latest);
  const shown = implementDefaultTab(view, active, null, idleTab);
  if (shown !== view) setView(shown);
  const tab = shown.tab;
  useEffect(() => {
    if (view) onView?.(view);
  }, [view, onView]);

  useEffect(() => {
    const current = latest?.status || null;
    const was = lastStatus.current;
    lastStatus.current = current;
    if (was && IMPLEMENT_ACTIVE_STATUSES.includes(was) && IMPLEMENT_DONE_STATUSES.includes(current) && !reducedMotion()) setCelebrations((n) => n + 1);
  }, [latest?.status]);

  const showTab = (name) => {
    setView(implementDefaultTab(shown, active, name, idleTab));
    setCardFailed(false);
  };
  const onTabKey = (e) => {
    const at = MVP_TABS.findIndex((entry) => entry.id === tab);
    const last = MVP_TABS.length - 1;
    const next = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const { id } = MVP_TABS[next];
    showTab(id);
    tabRefs.current[id]?.focus();
  };

  const keepCollected = (next) => {
    setCollected({ at: refreshKey, entries: next });
    setCollectError(saveCollectedVibes(collectedKey, next) ? '' : COLLECT_LOST);
  };
  const addAsk = (text, replaces = []) => keepCollected(rephrasedAsk(text, replaces)
    .reduce((list, out) => collectRemoval(list, out.id, out.label, out.text), collectAsk(vibes, text)));
  const removeAsk = (asset, ask) => keepCollected(collectRemoval(vibes, asset.id, asset.label, ask));
  const dropAsk = (entry) => keepCollected(dropCollected(vibes, entry));
  const editMvp = () => onEdit(vibes.length ? { step: 'vibes', collected: vibes } : null, live);

  const rerun = async () => {
    setRerunBusy(true);
    setError('');
    setNotice('');
    setRerunError(null);
    try {
      const data = await apiPostJson(`/api/inspire/implement/rerun?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`, { overrides });
      setNotice(data?.warning || '');
      await loadStatus();
    } catch (e) {
      setError(e.message);
      setRerunError(e.body || null);
    } finally {
      setRerunBusy(false);
    }
  };

  const startVersion = async (path, body) => {
    if (!latest || active || submitBusy) return false;
    setSubmitBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await apiPostJson(path, body);
      setNotice(resultTableMoveNote(data?.summary));
      await loadStatus();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSubmitBusy(false);
    }
  };
  const submitSpec = (next, path = '/api/inspire/implement/submit') => startVersion(path, {
    inspire_database: settings.inspireDatabase,
    warehouse_id: settings.warehouseId,
    session_id: String(sessionId),
    notebook_path: settings.notebookPath,
    spec: next,
  });
  const submitNext = (changes) => submitSpec(nextSpecFrom(latest, changes));
  const publishHeld = () => submitSpec(specFromHeld(latest, { publish: true }), `/api/inspire/implement/publish?use_case_id=${encodeURIComponent(useCaseId)}`);

  const toggleSchedule = () => submitNext({ schedule: { ...(spec.schedule || {}), enabled: !spec.schedule?.enabled } });
  const retryOutput = (name) => submitNext({ retry_outputs: [name] });
  const removeOutput = (name) => submitNext(removeChanges(latest, name));
  const rollbackOutput = (name, version) => submitNext(rollbackChanges(latest, name, version.version, version.vibes));
  const tryAgain = (name, asks) => submitNext(tryAgainChanges(name, asks));
  const removeKept = (version) => submitNext(removeKeptChanges(version));
  const uninstallAll = async () => {
    if (!(await submitNext(uninstallChanges()))) return;
    setUninstalling(false);
    setCollected({ at: refreshKey, entries: [] });
    saveCollectedVibes(collectedKey, []);
  };

  const runControl = async (a, { confirmShared = false } = {}) => {
    setActionBusy(`${a.asset}:${a.action}`);
    setError('');
    try {
      const got = await apiPostJson(`/api/inspire/implement/control?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`,
        { asset: a.asset, action: a.action, ...(confirmShared ? { confirm_shared: true } : {}) });
      if (got.audit_error) setError(got.audit_error);
      await loadStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      await loadLive();
      setActionBusy('');
    }
  };
  const failedOutputs = retryableOutputs(latest);
  const locked = readOnly || active || submitBusy;
  const lockedReason = readOnlyReason(readOnly);
  const notebookPath = item.uc?.notebook_path || '';
  const vibeTargets = vibeCards(status?.history, latest, stalled, workspaceNotebookUrl(databricksHost, notebookPath), plan);
  const pickable = assetGroups(vibeTargets, controlRows(live, latest)).flatMap((group) => group.assets);
  const buildingNow = progress.current?.state === 'running' ? progress.current.id : '';
  const tile = controlTiles(live, latest, { active, buildingNow, plan, stages }).tiles.find((entry) => entry.output.id === tab) || null;
  const tabAssets = pickable.filter((asset) => asset.output === tab);
  const card = tabAssets.find((asset) => asset.id === pickedParts[tab]) || tabAssets[0] || null;
  const fromCard = (send) => async (...args) => {
    const ok = await send(...args);
    setCardFailed(!ok);
    return ok;
  };
  const history = status?.history || [];
  const kept = keptVersions(history);
  const checklist = useMemo(() => vibeChecklist(status?.steps, latest), [status?.steps, latest]);
  const held = heldVersion(latest, status?.history ?? null);
  const heldAction = (kind, run) => async () => {
    setHeldBusy(kind);
    const ok = await run();
    setHeldBusy('');
    return ok;
  };
  const rephraseHeld = () => setRephrase((prev) => ({ at: (prev?.at || 0) + 1, ...rephraseOf(checklist, latest) }));
  const tryHeldAgain = heldAction('retry', () => submitSpec(specFromHeld(latest)));
  const publishHeldAnyway = heldAction('publish', publishHeld);
  const alertAsset = latest?.asset_status?.alert || {};
  const notebookState = uninstalled ? item.notebook || null : item.notebook || (vibeTargets.some((c) => c.id === 'notebook') ? notebookStatus({ has_genie_code: 'Y' }, null) : null);
  const notebook = notebookState && {
    state: notebookState,
    path: notebookPath,
    href: notebookState.state === 'ready' ? workspaceNotebookUrl(databricksHost, notebookPath) : '',
    runUrl: notebookState.url || '',
    runError: notebookRunError || '',
  };
  const failedStage = stages.find((s) => s.state === 'error') || null;
  const stopped = Boolean(stalled) && IMPLEMENT_ACTIVE_STATUSES.includes(String(latest?.status || ''));
  const versionCount = status?.history?.length ?? 0;
  const runCount = status?.runs?.ok === false ? null : status?.runs?.runs?.length ?? 0;
  const historyHint = status
    ? `${plural(versionCount, 'spec version')} · ${runCount === null ? 'job runs unknown' : plural(runCount, 'job run')}`
    : 'Loading…';
  const percent = progressPercent(chip, progress);

  const detailsBody = (id) => {
    if (id === 'dashboard') {
      if (!latest?.dashboard_url || !readOnly) return null;
      return (
        <>
          <p className="text-text-secondary">{SHOWCASE_DASHBOARD_NOTE}</p>
          <a className={LINK} href={latest.dashboard_url} target="_blank" rel="noreferrer">{SHOWCASE_OPEN_APP} <ExternalLink size={12} /></a>
        </>
      );
    }
    if (id === 'genie_space') {
      if (!latest?.genie_space_url) return null;
      return (
        <>
          {readOnly && (
            <>
              <p className="text-text-secondary">{SHOWCASE_GENIE_NOTE}</p>
              <a className={LINK} href={latest.genie_space_url} target="_blank" rel="noreferrer">{SHOWCASE_OPEN_APP} <ExternalLink size={12} /></a>
            </>
          )}
          {genie.questions.length > 0 && (
            <div>
              <p className="font-medium text-text-primary">{genie.source === 'space' ? 'Sample questions in the Genie Agent' : 'Questions you asked for'}</p>
              <ul className="list-disc pl-5">{genie.questions.map((question, i) => (
                <li key={question}>
                  <span>{question}</span>
                  {genie.notes[i] && <p className="text-text-secondary">{genie.notes[i]}</p>}
                </li>
              ))}</ul>
            </div>
          )}
          {genieAsset.check_question && <p>Inspire checked the Genie Agent with: {genieAsset.check_question}</p>}
          {genieAsset.check_sql && <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap border border-border rounded-lg bg-bg-subtle p-2">{genieAsset.check_sql}</pre>}
        </>
      );
    }
    if (id === 'app') {
      if (!latest?.app_url) return null;
      return (
        <table className="text-[12px]">
          <tbody>
            {appStatusRows(status?.app_status, latest?.asset_status?.app).map(([label, value]) => (
              <tr key={label}><td className="pr-3 py-0.5 text-text-secondary">{label}</td><td>{value}</td></tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (id !== 'alert') return null;
    if (!latest?.alert_url && !alertAsset.trigger) return <p className="text-text-secondary">No alert on this version.</p>;
    return (
      <>
        <p>Fires when: {alertAsset.trigger || 'not recorded'}</p>
        {alertAsset.condition_sql && <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap border border-border rounded-lg bg-bg-subtle p-2">{alertAsset.condition_sql}</pre>}
        <p>Notifies: {spec.outputs?.alert_recipients?.join(', ') || 'no email recipients'}
          {(spec.outputs?.alert_destinations || []).length ? `; ${spec.outputs.alert_destinations.map((d) => d.name || d.id).join(', ')}` : ''}
        </p>
        <p>Subscribers on the job task: {alertAsset.subscribers ?? 'not recorded'}</p>
        <p>Last check: {alertAsset.check_state || 'not checked yet'}</p>
        <p className="text-text-secondary">It runs after each scheduled or full run of the job and notifies once per run, only when the condition holds. Preview re-runs never send it.</p>
      </>
    );
  };

  const buildAgain = canBuildAgain(latest, { edited, missing });
  const failureBanner = hasMvp && chip.tone === 'error' && !held && !checklist?.notDecided && (
    <section aria-label="Build failed" className="rounded-lg border border-error/30 bg-error-bg px-3.5 py-3 text-[12px] space-y-2.5">
      <div className="flex items-start gap-2.5">
        <XCircle size={16} className="mt-px shrink-0 text-error-fg" aria-hidden />
        <div className="min-w-0 space-y-0.5 text-error-fg">
          <p className="text-[13px] font-semibold">{stopped ? 'The build stopped' : 'The build failed'}</p>
          {failedStage && <p>Step: <span className="font-semibold">{failedStage.label}</span></p>}
          {reason && <p>{reason}</p>}
        </div>
      </div>
      {buildAgain && <p className="text-error-fg">{buildAgainHint(latest)}</p>}
      {(buildAgain || onEdit) && (
        <div className="flex flex-wrap gap-2">
          {buildAgain && (
            <button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => submitNext(buildAgainChanges(latest))} className={PRIMARY_BUTTON}>
              {submitBusy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Build again
            </button>
          )}
          {onEdit && (
            <button type="button" onClick={editMvp} className={buildAgain ? OUTLINE_BUTTON : PRIMARY_BUTTON}>
              <Pencil size={12} /> Edit MVP
            </button>
          )}
        </div>
      )}
    </section>
  );

  const partCards = tabAssets.length > 0 && (
    <>
      <PartTabs assets={tabAssets} picked={card?.id} onPick={(id) => { setPickedParts((prev) => ({ ...prev, [tab]: id })); setCardFailed(false); }} />
      {card && (
        <div {...(tabAssets.length > 1 ? tabPanel(PART_TABS, card.id, card.id) : {})}>
          <AssetCard
            key={card.id}
            asset={card}
            collected={vibes}
            onRemoveAsk={removeAsk}
            onKeepAsk={dropAsk}
            locked={locked}
            lockedReason={lockedReason}
            readOnly={readOnly}
            active={active}
            error={cardFailed ? error : ''}
            money={money}
            moneyError={moneyError}
            scope={scopeFacts}
            onTryAgain={fromCard(tryAgain)}
            onRollback={fromCard(rollbackOutput)}
          />
        </div>
      )}
    </>
  );
  const tabBody = () => {
    if (tab === BUILD_TAB) {
      return (
        <>
          {failureBanner}
          {held && (
            <HeldVersion held={held} checklist={checklist} canPublish={canPublishHeld(status)} readOnly={readOnly} locked={locked} lockedReason={lockedReason}
              busy={heldBusy} onRephrase={rephraseHeld} onTryAgain={tryHeldAgain} onPublish={publishHeldAnyway} />
          )}
          <VibeChecklist checklist={checklist} assets={latest?.asset_status} readOnly={readOnly} locked={locked} lockedReason={lockedReason} busy={submitBusy}
            onSendAgain={buildAgain ? () => submitNext(buildAgainChanges(latest)) : undefined} onEdit={onEdit ? editMvp : undefined} />
          <TargetKpiCard view={kpiView} readOnly={readOnly} builtBefore={IMPLEMENT_DONE_STATUSES.includes(String(latest?.status || ''))} scope={scopeFacts} />
          <UseCaseSettings view={settingsView} error={settingsError} readOnly={readOnly} impact={liveImpact(money?.run, tracked?.impact || rowImpact(latest))} scope={scopeProfile}
            onPreview={previewSetting} onSave={saveSetting} onRun={runSettings} onEdit={onEdit ? () => onEdit({ step: 'settings' }, live) : undefined}>
            <UseCaseTables key={String(latest?.spec_version ?? '')} uc={item.uc} latest={latest} view={tablesView} readOnly={readOnly} locked={locked}
              onSwaps={tableSwaps} onClassify={tableChange} onSave={submitSpec} />
          </UseCaseSettings>
          <BuildControls kept={kept} live={live} liveError={liveError} latest={latest} useCaseId={useCaseId} active={active} buildingNow={buildingNow}
            actionBusy={actionBusy} submitBusy={submitBusy} readOnly={readOnly} onAction={runControl} onRemoveKept={removeKept} onToggleSchedule={toggleSchedule} onRefresh={loadLive}
            onOpenRun={onOpenRun} />
          <section aria-label="Genie's build messages" className={PANEL_CLASS}>
            <GenieFeed feed={status ? status.feed || [] : null} arrivals={arrivals} active={progress.active} working={progress.headline} />
          </section>
          {stalled?.run_url && (
            <a className="text-[12px] font-semibold text-db-red-fg inline-flex items-center gap-1" href={stalled.run_url} target="_blank" rel="noreferrer">
              Open the run that stopped <ExternalLink size={12} />
            </a>
          )}
          <section aria-label="Run and schedule" className={PANEL_CLASS}>
            <SectionTitle icon={RefreshCw} title="Run and schedule" hint="Schedule and retry build a new version; a preview re-run does not" />
            <div className="p-4 grid gap-5 md:grid-cols-2 text-[12px]">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary mb-1">Quick re-run</div>
                {widgets.map((w) => (
                  <label key={w.name} className="block text-[11px] mb-1">
                    {w.label || w.name}
                    {Array.isArray(w.choices) && w.choices.length > 0 ? (
                      <select
                        className="mt-0.5 w-full px-2 py-1 border border-border rounded-lg bg-surface"
                        disabled={readOnly}
                        title={lockedReason || undefined}
                        value={overrides[w.name] ?? ''}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [w.name]: e.target.value }))}
                      >
                        <option value="">{w.default ? `Keep ${w.default}` : 'Keep the job value'}</option>
                        {w.choices.map((choice) => <option key={String(choice)} value={String(choice)}>{String(choice)}</option>)}
                      </select>
                    ) : (
                      <input
                        className="mt-0.5 w-full px-2 py-1 border border-border rounded-lg bg-surface"
                        disabled={readOnly}
                        title={lockedReason || undefined}
                        value={overrides[w.name] ?? ''}
                        placeholder={w.default == null ? '' : String(w.default)}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [w.name]: e.target.value }))}
                      />
                    )}
                    {w.allowed && <span className="block text-[10px] text-text-secondary">{w.allowed}</span>}
                  </label>
                ))}
                {widgets.length === 0 && <p className="text-[11px] text-text-secondary">No widgets to change; the re-run uses the job&apos;s values.</p>}
                <p className="text-[10px] text-text-secondary">A preview of the notebook only. Blank fields keep the job&apos;s values, and the alert never fires on a preview.</p>
                <button
                  type="button"
                  disabled={readOnly || rerunBusy || !latest?.job_id}
                  title={lockedReason || undefined}
                  onClick={rerun}
                  className={`mt-2 w-full justify-center ${PRIMARY_BUTTON}`}
                >
                  {rerunBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Preview re-run
                </button>
              </div>
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-[12px]">
                  <input type="checkbox" checked={!!spec.schedule?.enabled} disabled={locked || !latest} title={lockedReason || undefined} onChange={toggleSchedule} />
                  Schedule on
                </label>
                {failedOutputs.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Failed outputs</div>
                    {failedOutputs.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        disabled={locked}
                        onClick={() => retryOutput(o.id)}
                        title={lockedReason || o.error}
                        className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-error/40 bg-surface text-error-fg disabled:opacity-50"
                      >
                        <RotateCcw size={12} /> Retry the {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
          <section aria-label="History" className={PANEL_CLASS}>
            <h3>
              <button
                type="button"
                aria-expanded={historyOpen}
                aria-controls={`${viewId}-history`}
                onClick={() => setHistoryOpen((open) => !open)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-gradient-to-r from-db-red-50 to-surface"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <IconChip icon={History} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-db-red-fg">History</span>
                    <span className="block text-[11px] text-text-secondary">{historyHint}</span>
                  </span>
                </span>
                <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${historyOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            </h3>
            <div id={`${viewId}-history`} hidden={!historyOpen} className="p-4 space-y-3 text-[12px] border-t border-border">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Spec versions</div>
              {!status && <p className="text-[12px] text-text-secondary">Loading the versions and job runs…</p>}
              {history.map((entry) => (
                <div key={entry.spec_version} data-history-version={entry.spec_version} className="border border-border rounded-lg bg-surface px-3 py-2 text-[12px]">
                  <div>v{entry.spec_version} · {historyStatus(entry, latest, stalled)} · {entry.change_classes || 'initial'}</div>
                  <div className="text-text-secondary">{entry.created_by} · {entry.updated_at}</div>
                  <VibeChecklist compact checklist={vibeChecklist(null, entry)} assets={entry.asset_status} />
                </div>
              ))}
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary pt-2">Job runs</div>
              {status?.runs?.ok === false && <p className="text-[12px] text-error-fg">{status.runs.error}</p>}
              {(status?.runs?.runs || []).map((run) => (
                <div key={run.run_id} className="border border-border rounded-lg bg-surface px-3 py-2 text-[12px]">
                  <div>{run.state || 'unknown'} · {runProfileText(run.profile)} · {run.trigger === 'PERIODIC' ? 'scheduled' : 'started by hand'}</div>
                  <div className="text-text-secondary">
                    {run.started} · {run.duration_s}s
                    {run.url && <> · <a className="text-db-red-fg" href={run.url} target="_blank" rel="noreferrer">Open run</a></>}
                  </div>
                  {run.message && <div className="text-text-secondary">{run.message}</div>}
                </div>
              ))}
              {status?.runs?.ok && status.runs.runs.length === 0 && <p className="text-[12px] text-text-secondary">No job runs yet.</p>}
              {status && !status.runs && <p className="text-[12px] text-text-secondary">This use case has no job yet.</p>}
            </div>
          </section>
        </>
      );
    }
    if (tab === 'notebook') {
      return (
        <>
          {notebook ? (
            <NotebookPanel notebook={notebook} kpi={kpiView}>
              {!readOnly && (
                <button type="button" disabled={active || submitBusy} onClick={() => setUninstalling(true)} className={DANGER_BUTTON}>
                  <Trash2 size={12} /> Uninstall
                </button>
              )}
            </NotebookPanel>
          ) : (
            <p className={`${PANEL_CLASS} p-4 text-[12px] text-text-secondary`}>This version has no Genie Code notebook.</p>
          )}
          {notebook && !readOnly && (
            <p className="text-[11px] text-text-secondary">Every output reads the notebook&apos;s result tables, so uninstalling the notebook uninstalls the whole MVP.</p>
          )}
          {partCards}
        </>
      );
    }
    const facts = tile && tile.kind !== 'off' ? detailsBody(tab) : null;
    const alertTab = tab === 'alert';
    return (
      <>
        {tile && (
          <AssetPanel
            tile={tile}
            liveError={liveError}
            active={active}
            actionBusy={actionBusy}
            submitBusy={submitBusy}
            readOnly={readOnly}
            failed={failedOutputs.find((o) => o.id === tab) || null}
            uninstall={readOnly ? null : assetUninstall(tab, latest, live, tile.row?.name || '')}
            builtBy={live?.assets?.[tab]?.built_by || null}
            useCaseId={useCaseId}
            onAction={runControl}
            onToggleSchedule={toggleSchedule}
            onRetry={retryOutput}
            onRemove={removeOutput}
            onAddOutput={onEdit && !alertTab ? () => onEdit({ step: 'delivery' }, live) : undefined}
            onOpenRun={onOpenRun}
          />
        )}
        {facts && <div data-asset-facts={tab} className={`${CARD} p-4 space-y-2 text-[12px]`}>{facts}</div>}
        {partCards}
        {alertTab && (
          <UseCaseAlerts apiFetch={apiFetch} apiPostJson={apiPostJson} qBase={qBase} useCaseId={useCaseId} refreshKey={refreshKey} readOnly={readOnly}
            onEditMvp={onEdit ? () => onEdit({ step: 'delivery' }, live) : null} />
        )}
      </>
    );
  };

  const collectedNote = collectedNoteText(vibes, active);

  return (
    <>
      {celebrations > 0 && <Celebration key={celebrations} trigger />}
      <div data-pinned-name="" className="sticky top-14 z-30 -mx-2 px-2 h-12 flex items-center gap-3 bg-bg border-b border-border">
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-text-primary" title={item.name}>{item.name}</h2>
        {built && (
          <span data-pinned-percent="" className={`shrink-0 font-mono text-sm font-bold tabular-nums ${toneClass(chip.tone)}`}>
            {percent}%<span className="sr-only"> built</span>
          </span>
        )}
        <ImplementStatusBadge state={item.state} />
        {latest?.spec_version != null && <span className="shrink-0 font-mono text-[11px] text-text-secondary">v{latest.spec_version}</span>}
      </div>
      {built && <MvpProgress stages={stages} summary={progress} chip={chip} reason={reason} toneClass={toneClass} version={latest?.spec_version} scope={scope} />}
      <div className={PANEL_CLASS}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-border bg-gradient-to-r from-db-red-50 to-surface">
          {row?.domain && <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-db-red-fg">{row.domain}</span>}
          {row?.domain && row?.subdomain && <span className="text-text-secondary text-[11px]" aria-hidden>›</span>}
          {row?.subdomain && <span className="text-[11px] text-text-secondary">{row.subdomain}</span>}
          <span className="font-mono text-[11px] text-text-secondary">{item.id}</span>
        </div>
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {subtitle && <p className="text-sm text-text-secondary leading-snug line-clamp-2">{subtitle}</p>}
            <div className={`${subtitle ? 'mt-3 ' : ''}flex flex-wrap gap-2`}>
              {item.uc && (
                <button type="button" onClick={() => setDetailsOpen(true)} className={OUTLINE_BUTTON}>
                  <FileText size={13} /> Use case details
                </button>
              )}
              {readOnly ? null : built ? (
                <>
                  <button
                    type="button"
                    disabled={active}
                    title={active ? 'Edit MVP applies after this run' : undefined}
                    onClick={editMvp}
                    data-edit-mvp=""
                    data-collected={vibes.length || undefined}
                    aria-label={vibes.length ? `Edit MVP, ${plural(vibes.length, 'ask')} waiting` : undefined}
                    className={`${vibes.length ? PRIMARY_BUTTON : OUTLINE_BUTTON} ${vibes.length > 0 && !active ? 'edit-mvp-invite' : ''}`}
                  >
                    <Pencil size={13} /> Edit MVP
                    {vibes.length > 0 && (
                      <span aria-hidden className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold tabular-nums text-db-red-fg">
                        {vibes.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={active || submitBusy}
                    title={active ? 'Wait for this run to finish' : undefined}
                    onClick={() => setUninstalling(true)}
                    className={DANGER_BUTTON}
                  >
                    <Trash2 size={13} /> Uninstall all
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => onEdit(null, live)} className={PRIMARY_BUTTON}>
                  <Sparkles size={13} /> {START_MVP_LABEL}
                </button>
              )}
            </div>
            {built && collectedNote && <p data-collected-note="" className="mt-2 text-[11px] text-text-secondary">{collectedNote}</p>}
          </div>
          {row && <InspireScoreBadge score={row.inspire} />}
        </div>
        {!hasMvp && (
          <p className="px-5 pb-5 text-[12px] text-text-secondary">
            {readOnly
              ? SHOWCASE_NO_MVP
              : `No MVP yet. ${START_MVP_LABEL} builds one, or writes only the Genie Code notebook when you choose Notebook only.`}
          </p>
        )}
        {uninstalled && (
          <p data-uninstalled="" className="px-5 pb-5 text-[12px] text-text-secondary">
            Uninstalled in v{latest.spec_version}. {latest.status_message ? `Not removed: ${latest.status_message}. ` : ''}The result tables and the history are kept. {START_MVP_LABEL} builds it again.
          </p>
        )}
      </div>
      {detailsOpen && row && (
        <UseCaseDrawer row={row} onClose={() => setDetailsOpen(false)}>
          <UseCaseDetailBody uc={item.uc} v130={item.uc._v130 || null} token={settings.token} databricksHost={databricksHost} showcase={settings.showcase || ''} />
        </UseCaseDrawer>
      )}
      {!built && notebook && <NotebookPanel notebook={notebook} />}
      {uninstalling && (
        <ConfirmDialog title={`Uninstall everything ${useCaseId} built`} confirmLabel="Uninstall all" useCaseId={useCaseId} busy={submitBusy}
          onCancel={() => setUninstalling(false)} onConfirm={uninstallAll}>
          <p>
            Inspire deletes the MVP notebook, its job, the dashboard, the Genie Agent, the App, the alert, the App&apos;s Lakebase copy and every version kept live, in a new version of this MVP.
          </p>
          <p>The result tables, the history and any notebook Discover wrote for this use case stay. An App, dashboard or Genie Agent that other use cases share stays for them, and Inspire takes this use case&apos;s part out of it.</p>
        </ConfirmDialog>
      )}
      {error && !built && <p className={ERROR_BOX}>{error}</p>}
      {notice && <p role="status" className={NOTE_BOX}>{notice}</p>}
      {built && (
        <>
          {failedOutputs.length > 0 && (
            <p className={`${ERROR_BOX} flex flex-wrap items-center gap-x-3 gap-y-1`}>
              {failedOutputs.map((o) => `The ${o.label}`).join(', ')} failed.
              {failedOutputs.map((o) => (
                <button key={o.id} type="button" className="underline font-semibold" onClick={() => showTab(o.id)}>
                  Open the {MVP_TABS.find((entry) => entry.id === o.id)?.label || o.label} tab
                </button>
              ))}
            </p>
          )}
          {error && !cardFailed && <p className={ERROR_BOX}>{error}</p>}
          {missing.length > 0 && (
            <div className="border border-error/30 bg-error-bg rounded-lg px-3 py-2 text-[12px] space-y-2">
              <p className="text-error-fg">{lostTablesText(missing)}</p>
              {onEdit && (
                <button type="button" disabled={active} onClick={() => onEdit({ step: 'data', missingTables: missing }, live)} className={PRIMARY_BUTTON}>
                  <Pencil size={12} /> Edit the Data step
                </button>
              )}
            </div>
          )}
          {edited && (
            <div className="border border-error/30 bg-error-bg rounded-lg px-3 py-2 text-[12px] space-y-2">
              <p className="text-error-fg">
                {statusReason(latest) || 'The notebook was edited after Inspire last built it, so this version did not rebuild it.'}
              </p>
              <button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => submitNext({ confirm_notebook_overwrite: true })} className={PRIMARY_BUTTON}>
                {submitBusy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Rebuild and overwrite the edits
              </button>
            </div>
          )}
          <NothingToActCard run={money?.run} />
          {!readOnly && <GlobalVibe entries={vibes} active={active} error={collectError} seed={rephrase} onAdd={addAsk} onDrop={dropAsk} />}
          <div data-pinned-tabs="" className="sticky top-[6.5rem] z-20 -mx-2 px-2 py-2 bg-bg">
            <div role="tablist" aria-label="MVP views" className="flex flex-wrap gap-1 p-1 rounded-xl bg-bg-subtle border border-border">
              {MVP_TABS.map(({ id, label }) => {
                const TabIcon = TAB_ICONS[id];
                return (
                  <button
                    key={id}
                    ref={(node) => { tabRefs.current[id] = node; }}
                    type="button"
                    role="tab"
                    id={`${viewId}-tab-${id}`}
                    data-mvp-tab={id}
                    aria-selected={tab === id}
                    aria-controls={tab === id ? `${viewId}-panel-${id}` : undefined}
                    tabIndex={tab === id ? 0 : -1}
                    onClick={() => showTab(id)}
                    onKeyDown={onTabKey}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-smooth ${
                      tab === id ? 'bg-surface text-db-red-fg shadow-sm ring-1 ring-inset ring-db-red/20' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <TabIcon size={13} aria-hidden />{label}
                  </button>
                );
              })}
            </div>
          </div>
          <div role="tabpanel" id={`${viewId}-panel-${tab}`} aria-labelledby={`${viewId}-tab-${tab}`} data-mvp-panel={tab} className="space-y-4">
            {tabBody()}
          </div>
        </>
      )}
    </>
  );
}

function toneClass(tone) {
  if (tone === 'success') return 'text-success-fg';
  if (tone === 'warning') return 'text-warning-fg';
  if (tone === 'error') return 'text-error-fg';
  if (tone === 'busy') return 'text-db-red-fg';
  return 'text-text-tertiary';
}
