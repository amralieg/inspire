import OUTPUT_LABELS from '../../../backend/lib/implementOutputLabels.json' with { type: 'json' };
import Button from '../components/ui/Button';
import UiPageHeader from '../components/ui/PageHeader';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newIssueUrl } from '../lib/issues';
import { FRAME } from '../lib/layout';
import {
  AlertTriangle, AppWindow, ArrowRight, BellRing, CheckCircle2, ChevronDown, CircleDashed, ExternalLink, Hammer, History, LayoutDashboard, Loader2,
  NotebookPen, Pencil, RefreshCw, Rocket, RotateCcw, Search, Settings2, Sparkles, Square, Trash2, XCircle,
} from 'lucide-react';
import {
  statusChip, statusReason, statusDetails, nextSpecFrom, retryableOutputs, lostTables, lostTablesText, genieQuestions, appStatusRows, editedNotebook,
  runProfileText, runStopped, cancelledByUser, versionActive, historyStatus, implementGroups, notebookRunEnded, notebookStatus, START_MVP_LABEL, IMPLEMENT_ACTIVE_STATUSES, IMPLEMENT_UNINSTALLED,
  vibesPreview, canBuildAgain, buildAgainChanges, buildAgainHint, resultTableMoveNote, IMPLEMENT_DONE_STATUSES, builtVersion, vibePreviousChoices, liveVersionForVibes, appVersionLines,
  vibesProblems, OPEN_ALL_SETTINGS, VIBE_FEATURES_LABEL, CHANGE_CHOICES_LABEL, DATA_STOP_HINT, dataStopped, shownStatusMessage,
  swapParts,
  failureChoices, stoppedChoices, genieNotebookRequest, FAILURE_CHOICES_HEADING, FAILURE_ROUNDS_HEADING, TERMINAL_STOP_HINT, TERMINAL_NEEDS_CHANGE,
  unreliableHold, olderBuildNote, appReadsName, UNRELIABLE_REBUILD_NOTE, isAppUpdate, APP_UPDATED_TEXT, appReadsOf, appObjectsOf, appReadsChoices, appReadsText, appReadsOwners, viewerRows, tableRows, APP_READS_HEADING, APP_READS_CLEARED, protectionStopOf, protectionChoices, abacGrantText, grantGapPermissions, grantFailurePermissions, liveSourceNow, liveProtection, liveReads,
} from '../lib/implementWizard';
import { makeApiFetch, makeApiPostJson, makeApiPutJson } from '../lib/apiClient';
import { buildUseCaseList } from '../lib/useCaseList';
import { workspaceJobUrl, workspaceNotebookUrl } from '../lib/workspaceLinks';
import { reducedMotion } from '../lib/motion';
import { formatWhen } from '../lib/formatWhen';
import { plural, shown } from '../lib/plural';
import ImplementStatusBadge from '../components/ImplementStatusBadge';
import ImplementWizard from './ImplementWizard';
import { AssetPanel, AssetTile, BuildControls, ConfirmDialog, NotebookPanel } from '../components/ImplementControlTower';
import MoreMenu from '../components/ui/MoreMenu';
import UseCaseDrawer from '../components/UseCaseDrawer';
import TechnicalDetails, { PlainMessage } from '../components/TechnicalDetails';
import QualityBarChip from '../components/QualityBarChip';
import UseCaseDetailBody from '../components/UseCaseDetailBody';
import Celebration from '../components/Celebration';
import { RUN_STATE_UNKNOWN, runStateText } from '../lib/runState';
import GenieLogo from '../components/GenieLogo';
import DrawerShell from '../components/DrawerShell';
import VibeFeatures from '../components/VibeFeatures';
import ReportedIssues, { useReportedIssues } from '../components/ReportedIssues';
import VibeChecklist from '../components/VibeChecklist';
import TabStrip, { tabPanel } from '../components/TabStrip';
import { Counter, CounterDivider, IconChip, PANEL_CLASS, SectionTitle } from '../components/BuildUi';
import { catalogRow } from '../lib/useCaseFacets';
import { fieldOf } from '../lib/useCaseFields';
import {
  ASSET_TILES, CONTROL_REFRESH_MS, REBUILD_NOTHING, appUpdateChanges, assetFilterCounts, assetGroups, assetUninstall, buildSummary, buildSummaryLines, checksSummary, collectAsk,
  assetFiltersFrom, collectRemoval, collectedScope, controlRows, controlTiles, deliveredOutputs, dropCollected, filterByAssets, filterByMvp, heldVersion,
  keptVersions, loadAssetFilters, saveAssetFilters,
  loadCollectedVibes, missingAsks, notDoneLines, rebuildSpec, rebuildingText, rephrasedAsk, removeChanges, removeKeptChanges, rollbackChanges, rollingBackText,
  saveCollectedVibes, sharedUseCases, statusWarnings, tryAgainChanges, uninstallChanges, vibeCards, vibeFeaturesLabel,
  carriedStart, trackBuildSubmit, withPendingBuilds,
} from '../lib/implementControl';
import {
  buildingAssets, mvpScope, mvpStages, mvpProgressSummary, typicalBuildText, mvpRepairOf, feedArrivals, railProgress, sortedTo, statusProgress, steadyFeed, versionPlan, vibeChecklist,
  genieChangesOf, GENIE_CHANGES_HEADING, mvpFailureOf,
} from '../lib/mvpProgress';
import PaneResizer from '../components/PaneResizer';
import { RAIL_WIDTH, loadPaneWidth, paneWidth, savePaneWidth } from '../lib/paneWidth';
import MvpProgress, { ProgressDock, ProgressLine, ScopeNotes, StageNotes } from '../components/MvpProgress';
import useBuildDiagnostics from '../components/useBuildDiagnostics';
import ChoiceList from '../components/ChoiceList';
import { useProgressView } from '../lib/progressView';
import GenieFeed from '../components/GenieFeed';
import MoneyReview, { NothingToActCard } from '../components/MoneyReview';
import TargetKpiCard from '../components/TargetKpiCard';
import UseCaseSettings from '../components/UseCaseSettings';
import { useScopeProfiles } from '../lib/groupingProfile';
import { GROUP_BY, isScopeSetting, runScopeFacts } from '../lib/runScope';
import { SETTINGS_ROUTES, settingsViewSaved } from '../lib/useCaseSettings';
import UseCaseAlerts from '../components/UseCaseAlerts';
import UseCaseTables from '../components/UseCaseTables';
import { liveImpact, rowImpact, targetKpiView, trackedKpiOf } from '../lib/targetKpi';
import { SHOWCASE_ALERT_NOTE, SHOWCASE_DASHBOARD_NOTE, SHOWCASE_GENIE_NOTE, SHOWCASE_NO_MVP, SHOWCASE_OPEN_APP, readOnlyReason } from '../lib/showcase';
import { buildFilterText } from '../lib/reviewFigures';
import ValueEstimateLine from '../components/ValueEstimateLine';
import ValueDisclaimer from '../components/ValueDisclaimer';
import { anyValued } from '../lib/valueFooter';
import { useValueRead } from '../lib/useValueLedger';
import { BuildNextStep, RunValue } from '../components/BuildNext';
import CalculateValueDialog from '../components/CalculateValueDialog';
import { tableOfUseCase, useCalculatedValues } from '../lib/calculatedValue';
import { trackingIdOf } from '../lib/useCaseFields';
import { valuedLine } from '../lib/buildNext';
import { raisePermissions } from '../lib/permissionBus';
import BusyNote from '../components/BusyNote';

const OUTPUT_ICONS = { notebook: NotebookPen, dashboard: LayoutDashboard, genie_space: GenieLogo, app: AppWindow, alert: BellRing };
const OUTPUT_NAMES = OUTPUT_LABELS;
const NO_RAIL = { latest: [], notebook_run: null, notebook_run_error: '' };
const NO_NOTEBOOK = { label: 'No Databricks AI notebook', tone: 'idle' };
const NO_JOB = { label: 'No job yet', tone: 'idle' };
const CHECKING = { label: 'Checking', tone: 'idle' };
const ERROR_BOX = 'text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2';
const NOTE_BOX = 'text-xs text-info-fg bg-info-bg border border-info/20 rounded-lg px-3 py-2';
// Header actions (REQ-545): one row at the reading edge under the name that wraps when it does not fit; More is last.
const HEADER_ACTIONS = 'flex w-full flex-wrap items-center justify-start gap-1.5';
const OUTLINE_BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const LINK = 'text-sm font-semibold text-db-red-fg inline-flex items-center gap-1 hover:underline';
const DANGER_BUTTON = `${OUTLINE_BUTTON} border-error/40 text-error-fg`;
const COLLECT_LOST = `This browser does not keep the vibes you add, so they are lost if you leave this page. Rebuild them in ${VIBE_FEATURES_LABEL} first.`;

const GROUP_LOOK = {
  in_progress: { icon: Loader2, tone: 'red', hint: 'Genie is working on these' },
  attention: { icon: AlertTriangle, tone: 'error', hint: 'Failed, or held because a vibe was not met' },
  ready: { icon: CheckCircle2, tone: 'success', hint: 'Built and ready to use' },
  not_started: { icon: CircleDashed, tone: 'idle', hint: 'Pick one' },
};

function PageHeader({ summary, loading, query, onQuery }) {
  // REQ-510: the counters below the header already show the MVP, notebook and not-started counts, so the subtitle does not repeat them.
  const subtitle = 'Every use case of this session.';
  return (
    <UiPageHeader icon={Hammer} title="Build" subtitle={subtitle}
      actions={(
        <label className="relative">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <input dir="auto"
            type="search"
            aria-label="Search use cases"
            placeholder="Search by name, id or domain"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="w-72 ps-9 pe-3 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary shadow-sm glow-focus"
          />
        </label>
      )} />
  );
}

function SummaryBanner({ summary }) {
  const { building } = summary;
  let mark = { icon: Sparkles, tone: 'idle' };
  let title = 'No MVP started yet';
  let line = 'Pick any use case in the list to start its MVP.';
  if (building.length) {
    mark = { icon: Rocket, tone: 'red', live: true };
    // REQ-355: a build the server has only queued (no run yet) reads queued here too, as on its card.
    const onlyQueued = building.every((item) => item.latest?.status === 'queued');
    title = `${plural(building.length, 'MVP')} ${onlyQueued ? 'queued' : 'building now'}`;
    line = building.map((item) => `${item.name}${shownStatusMessage(item.latest) ? `: ${shownStatusMessage(item.latest)}` : ''}`).join(' · ');
  } else if (summary.mvps) {
    mark = summary.failed || summary.held || summary.unmet ? { icon: AlertTriangle, tone: 'warning' } : { icon: CheckCircle2, tone: 'success' };
    title = `${shown(summary.ready)} of ${plural(summary.mvps, 'MVP')} ready`;
    const open = buildSummaryLines(summary);
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
          {summary.vibeHeld > 0 && (
            <>
              <CounterDivider />
              <Counter value={summary.vibeHeld} label="Vibes not met" tone="warning" />
            </>
          )}
          {summary.untrusted > 0 && (
            <>
              <CounterDivider />
              <Counter value={summary.untrusted} label="Results not trusted" tone="warning" />
            </>
          )}
          {summary.failed > 0 && (
            <>
              <CounterDivider />
              <Counter value={summary.failed} label="Failed" tone="error" />
            </>
          )}
          <CounterDivider />
          <Counter value={summary.notebooks} label="Databricks AI notebooks" />
          <CounterDivider />
          <Counter value={summary.notStarted} label="Not started" />
        </div>
      </div>
      {summary.delivered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-t border-border bg-bg-subtle/60">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary me-1">Delivered so far</span>
          {summary.delivered.map((entry) => {
            const Icon = OUTPUT_ICONS[entry.id];
            return (
              <span key={entry.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success-bg text-success-fg text-xs font-medium">
                <Icon size={14} aria-hidden /> {entry.text}
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
            <Icon size={14} />
          </span>
        );
      })}
      <span className="sr-only">Delivered: {ids.map((id) => OUTPUT_NAMES[id]).join(', ')}</span>
    </span>
  );
}

const FILTER_ICONS = { notebook: NotebookPen, ...OUTPUT_ICONS };

function AssetFilters({ counts, assets, onToggle }) {
  const total = counts.reduce((most, entry) => Math.max(most, entry.count), 0);
  if (!total && !assets.length) return null;
  const chip = (on) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-smooth has-disabled:cursor-not-allowed has-disabled:border-dashed ${
    on ? 'border-db-red/40 bg-db-red-50 text-db-red-fg' : 'border-border bg-surface text-text-primary hover:bg-bg-subtle'}`;
  return (
    <div role="group" aria-label="Show use cases with" className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">Show use cases with</p>
      <div className="flex flex-wrap gap-1.5">
        {counts.map((entry) => {
          const Icon = FILTER_ICONS[entry.id];
          const on = assets.includes(entry.id);
          return (
            <label key={entry.id} className={chip(on)}>
              <input type="checkbox" data-asset-filter={entry.id} checked={on} disabled={!entry.count && !on} onChange={() => onToggle(entry.id)} className="accent-db-red" />
              <Icon size={14} aria-hidden /> {entry.label} <span className="font-mono text-text-secondary">{entry.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RailProgress({ item, progress }) {
  const step = progress?.step || shownStatusMessage(item.latest);
  const percent = progress?.percent;
  return (
    <div data-rail-progress={percent ?? ''} className="mt-1.5 space-y-1">
      <div className="relative h-1.5 rounded-full bg-bg-subtle overflow-hidden" aria-hidden>
        {percent == null
          ? <span className="absolute inset-y-0 start-0 w-1/3 rounded-full bg-db-red motion-safe:animate-[shimmer_1.8s_ease-in-out_infinite]" />
          : <span className="absolute inset-y-0 start-0 rounded-full bg-linear-to-r from-primary-solid to-db-red transition-[width] duration-700" style={{ width: `${Math.max(percent, 4)}%` }} />}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
        {percent != null && <span className="shrink-0 font-mono font-bold tabular-nums text-text-primary">{percent}%</span>}
        {step && <span className="truncate" title={step}>{step}</span>}
      </p>
    </div>
  );
}

function Rail({ groups, listLoading, query, assets = [], mvp = '', assetLabels = [], shownId, progress = {}, estimates = null, valued = null, onSelect }) {
  const mvpWords = mvp === 'live' ? 'a live MVP' : 'an MVP';
  const assetWords = assetLabels.map((label) => `${/^[AEIOU]/.test(label) ? 'an' : 'a'} ${label}`).join(' or ');
  return (
    <nav aria-label="Use cases" className="relative flex-1 min-h-32 space-y-3 overflow-y-auto pe-1">
      {listLoading && (
        <p className="flex items-center gap-2 px-1 text-[12px] text-text-secondary"><Loader2 size={14} className="animate-spin" /> Loading the use cases…</p>
      )}
      {!listLoading && (query.trim() || assets.length || mvp) && groups.every((group) => group.items.length === 0) && (
        <p className="px-1 text-[12px] text-text-secondary">
          {assets.length ? `No use case${query.trim() ? ` matching "${query.trim()}"` : ''} has ${assetWords} yet.`
            : mvp ? `No use case${query.trim() ? ` matching "${query.trim()}"` : ''} has ${mvpWords} yet.`
              : <>No use case matches &quot;{query.trim()}&quot;.</>}
        </p>
      )}
      {!listLoading && groups.filter((group) => group.items.length > 0).map((group) => {
        const look = GROUP_LOOK[group.id] || GROUP_LOOK.not_started;
        return (
          <section key={group.id} aria-label={group.label} className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border bg-linear-to-b from-db-red-50 to-surface">
              <IconChip icon={look.icon} tone={look.tone} size="sm" />
              <div className="flex-1 min-w-0">
                <h2 className="text-xs font-bold text-text-primary">{group.label}<span className="sr-only"> ({group.items.length})</span></h2>
                <p className="text-xs text-text-secondary">{look.hint}</p>
              </div>
              <span className="text-xs font-mono font-semibold text-text-secondary bg-bg-subtle rounded-md px-1.5 py-0.5" aria-hidden>{group.items.length}</span>
            </div>
            <div className="p-1.5 space-y-0.5">
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
                    className={`w-full text-start px-3 py-2.5 rounded-lg border transition-smooth ${on ? 'bg-db-red-50 border-db-red/25' : 'border-transparent hover:bg-bg-subtle'} ${
                      building ? 'rail-building' : ''}`}
                  >
                    <div className={`text-[12.5px] font-semibold leading-snug line-clamp-2 ${on ? 'text-db-red-fg' : 'text-text-primary'}`}>{item.name}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <ImplementStatusBadge state={item.state} />
                        <QualityBarChip uc={item.uc} />
                      </span>
                      <OutputIcons latest={item.latest} />
                    </div>
                    {item.uc && (valuedLine(valued?.[item.id])
                      ? <RunValue row={{ id: item.id, value: valued[item.id] }} />
                      : <ValueEstimateLine uc={item.uc} estimate={estimates?.use_cases?.[item.id] ?? null} className="mt-1 line-clamp-2 text-xs" />)}
                    {building && <RailProgress item={item} progress={progress[item.id]} />}
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

function BuildFilterStrip({ filter, sessionId, onPickRun, onClear }) {
  return (
    <section aria-label="Filter from Start" data-build-filter={filter.key} className="rounded-xl border border-db-red/30 bg-db-red-50 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="min-w-0 text-[12px] font-medium text-db-red-fg">{buildFilterText(filter, sessionId)}</p>
        <button type="button" onClick={onClear}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-db-red/30 bg-surface px-2 py-1 text-xs font-semibold text-db-red-fg hover:bg-db-red-50">
          <XCircle size={14} aria-hidden /> Clear
        </button>
      </div>
      {filter.runs.length > 1 && (
        <div role="group" aria-label={`Runs with ${filter.many}`} className="flex flex-wrap gap-1.5">
          {filter.runs.map((run) => {
            const on = run.session_id === String(sessionId);
            return (
              <button key={run.session_id} type="button" data-build-run={run.session_id} aria-pressed={on} onClick={() => { if (!on) onPickRun(run.session_id); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
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

export default function ImplementPage({ settings, sessionId, focusId = null, focusStep = null, onStepOpened = null, onFocus, onOpenRun = null, demoMvps = null, filter = null, onPickRun, onClearFilter }) {
  const { token, databricksHost, showcase = '' } = settings;
  const readOnly = Boolean(showcase);
  // FX-39b (W16 D37): the first 401 closes this gate; every later read fails at once without a request, so no poller keeps asking, and Reload shows.
  const [gate, setGate] = useState(null);
  const { apiFetch, signIn } = useMemo(() => {
    const read = makeApiFetch({ token, databricksHost, showcase });
    const state = { expired: null };
    const fetchGated = async (url, opts) => {
      if (state.expired) throw state.expired;
      try {
        return await read(url, opts);
      } catch (e) {
        if (e?.status === 401 && !showcase) {
          state.expired = e;
          setGate(state);
        }
        throw e;
      }
    };
    return { apiFetch: fetchGated, signIn: state };
  }, [token, databricksHost, showcase]);
  const signedOut = gate === signIn;
  const apiPostJson = useMemo(() => makeApiPostJson({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const apiPutJson = useMemo(() => makeApiPutJson({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const [useCases, setUseCases] = useState([]);
  const [discoveryType, setDiscoveryType] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [buildNotes, setBuildNotes] = useState([]);
  const [buildDetails, setBuildDetails] = useState([]);
  // REQ-323: a build submitted before this page mounted (the wizard hands over to it) still shows as queued.
  const [rail, setRail] = useState(() => ({ ...NO_RAIL, latest: withPendingBuilds([]) }));
  const [railError, setRailError] = useState('');
  const [query, setQuery] = useState('');
  const [assetFilters, setAssetFilters] = useState(() => (filter ? assetFiltersFrom(filter.asset) : loadAssetFilters()));
  useEffect(() => { saveAssetFilters(assetFilters); }, [assetFilters]);
  const [mvpFilter, setMvpFilter] = useState(filter?.mvp || '');
  const [chosenId, setChosenId] = useState(focusId);
  const [wizard, setWizard] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const lastNotebookRun = useRef(null);
  // REQ-323: reads are applied in the order they were sent, so an older read never overwrites a newer one.
  const railSeq = useRef({ sent: 0, applied: 0 });
  const [progress, setProgress] = useState({});
  const reportProgress = useCallback((id, value) => setProgress((prev) => (
    prev[id]?.percent === value.percent && prev[id]?.step === value.step ? prev : { ...prev, [id]: value })), []);
  const [railPx, setRailPx] = useState(() => loadPaneWidth(RAIL_WIDTH));
  useEffect(() => { savePaneWidth(RAIL_WIDTH, railPx); }, [railPx]);
  const scopeOf = (id) => collectedScope(databricksHost || globalThis.location?.host || '', settings.inspireDatabase, sessionId, id);

  const qBase = useMemo(() => new URLSearchParams({
    inspire_database: settings.inspireDatabase,
    warehouse_id: settings.warehouseId,
    session_id: String(sessionId),
  }).toString(), [settings.inspireDatabase, settings.warehouseId, sessionId]);
  // REQ-078: each card reads its rule estimate here, the same route Review and Build next read. A measured figure is never replaced.
  // A showcase or demo run makes no workspace call: its read is skipped, as ChoosePage and ResultsPage skip theirs.
  const estimates = useValueRead(apiFetch, readOnly ? '' : `/api/inspire/value/estimates?${qBase}`, refreshKey);
  // FX-39b (W16 D27): the value totals are what Review's card and Build next read; the list and the detail show that amount first.
  const totals = useValueRead(apiFetch, readOnly ? '' : `/api/inspire/value/totals?${qBase}`, refreshKey);
  const valued = totals?.use_cases || null;
  const [calcFor, setCalcFor] = useState(null);
  const calculated = useCalculatedValues({ apiFetch: readOnly ? null : apiFetch, apiPostJson, apiPutJson, inspireDatabase: settings.inspireDatabase, warehouseId: settings.warehouseId, sessionId });
  const valuesForDialog = useMemo(() => ({
    ...calculated,
    run: async (...a) => { const got = await calculated.run(...a); setRefreshKey((n) => n + 1); return got; },
    undo: async (...a) => { const got = await calculated.undo(...a); setRefreshKey((n) => n + 1); return got; },
  }), [calculated]);

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
    const seq = ++railSeq.current.sent;
    const data = await apiFetch(`/api/inspire/implement/history?${qBase}`);
    if (seq < railSeq.current.applied) return;
    railSeq.current.applied = seq;
    const run = data.notebook_run || null;
    const prev = lastNotebookRun.current;
    lastNotebookRun.current = run;
    if (notebookRunEnded(prev, run)) setListVersion((n) => n + 1);
    const latest = withPendingBuilds(data.latest || []);
    setRail({ latest, notebook_run: run, notebook_run_error: data.notebook_run_error || '' });
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
  const groups = useMemo(() => filterByMvp(filterByAssets(searched, assetFilters), mvpFilter), [searched, assetFilters, mvpFilter]);
  const clearFilter = () => {
    setAssetFilters([]);
    setMvpFilter('');
    onClearFilter?.();
  };
  const toggleAsset = (asset) => {
    if (filter) {
      setMvpFilter('');
      onClearFilter?.();
    }
    setAssetFilters((prev) => (prev.includes(asset) ? prev.filter((id) => id !== asset) : [...prev, asset]));
  };
  const allItems = useMemo(() => implementGroups(useCases, rail.latest, rail.notebook_run).flatMap((g) => g.items), [useCases, rail.latest, rail.notebook_run]);
  const summary = useMemo(() => buildSummary(allItems), [allItems]);
  const shownId = chosenId || groups.flatMap((g) => g.items)[0]?.id || allItems[0]?.id || null;
  const selected = allItems.find((item) => item.id === shownId) || null;
  const openedStep = useRef('');
  useEffect(() => {
    if (!focusStep || !selected?.uc || openedStep.current === `${focusStep}:${selected.id}`) return;
    openedStep.current = `${focusStep}:${selected.id}`;
    // REQ-457 (FX-39b): Review's Build next sends 'measure'; the Build wizard has no Measure step, so the value wizard opens.
    if (focusStep === 'measure') setCalcFor(selected.uc);
    else setWizard({ uc: selected.uc, focus: { step: focusStep }, live: false });
    onStepOpened?.();
  }, [focusStep, selected]);
  const paneRef = useRef(null);
  useLayoutEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [shownId]);

  const othersBuilding = allItems.filter((item) => item.state?.group === 'in_progress' && item.id !== shownId).map((item) => item.id).join(',');
  useEffect(() => {
    if (!othersBuilding) return undefined;
    let live = true;
    const tick = () => othersBuilding.split(',').forEach((id) => {
      apiFetch(`/api/inspire/implement/status?${qBase}&use_case_id=${encodeURIComponent(id)}`)
        .then((data) => { if (live) reportProgress(id, statusProgress(data)); })
        .catch(() => {});
    });
    tick();
    const timer = setInterval(tick, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [othersBuilding, apiFetch, qBase, reportProgress]);

  const select = (id) => {
    setChosenId(id);
    onFocus?.(id);
  };

  // REQ-457 (FX-39b): a use case with no value yet asks to calculate it and opens the value wizard, the one MvpValuePanel's Calculate value opens.
  // It never opens the Build wizard.
  const openMeasure = (id) => {
    select(id);
    const item = allItems.find((i) => i.id === id);
    if (item?.uc) setCalcFor(item.uc);
  };

  // REQ-323: a build submitted from a use case's detail (Rebuild, Try again, Change choices) shows as queued at once.
  const showQueuedBuild = () => {
    setRail((prev) => ({ ...prev, latest: withPendingBuilds(prev.latest || []) }));
    loadRail().catch((e) => setRailError(e.message));
  };
  // REQ-386: a build queued from a card or the detail (Try again, Rebuild, Build next) closes the Start Use Case MVP dialog open over it, so the
  // progress panel is in view. The wizard's own submit keeps the dialog until the server answers (its onImplemented closes it), so its errors show.
  const buildQueued = () => {
    setWizard(null);
    showQueuedBuild();
  };
  const onImplemented = (data) => {
    setBuildNotes(Array.isArray(data?.warnings) ? data.warnings : []);
    setBuildDetails(Array.isArray(data?.warning_details) ? data.warning_details : []);
    if (wizard?.focus?.collected?.length && data?.use_case_id) saveCollectedVibes(scopeOf(data.use_case_id), []);
    setWizard(null);
    if (data?.use_case_id) select(data.use_case_id);
    setRefreshKey((n) => n + 1);
    if (data?.mode === 'notebook') setListVersion((n) => n + 1);
    if (data?.use_case_id && data?.mode !== 'notebook') setRail((prev) => ({ ...prev, latest: withPendingBuilds(prev.latest || []) }));
    loadRail().catch((e) => setRailError(e.message));
  };
  const [progressDock, setProgressDock] = useState(null);

  return (
    <div className={`${FRAME} py-6 space-y-4 md:flex md:flex-col md:[&>:not(:last-child)]:shrink-0 md:max-h-[calc(100dvh-3.5rem-1px)] md:has-[[data-progress-open=true]]:h-[calc(100dvh-3.5rem-1px)]`} data-implement-page="">
      <PageHeader summary={summary} loading={listLoading} query={query} onQuery={setQuery} />
      {!listLoading && !listError && <SummaryBanner summary={summary} />}
      {filter && <BuildFilterStrip filter={filter} sessionId={sessionId} onPickRun={onPickRun} onClear={clearFilter} />}
      {listError && !signedOut && <PlainMessage text={listError} className={ERROR_BOX} onRetry={() => setListVersion((n) => n + 1)} copy />}
      {buildNotes.length > 0 && (
        <ul role="note" aria-label="What Inspire changed to start this build" data-build-notes=""
          className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 space-y-0.5 text-xs text-warning-fg">
          {buildNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      {buildNotes.length > 0 && buildDetails.length > 0 && <TechnicalDetails items={buildDetails} />}
      {signedOut && (
        <div role="alert" data-signed-out="" className={`${ERROR_BOX} flex flex-wrap items-center gap-3`}>
          <span>Your Databricks sign-in has expired, so Inspire stopped checking. Reload the page to sign in again.</span>
          <button type="button" onClick={() => globalThis.location.reload()} className="rounded-md border border-error/40 bg-surface px-3 py-1 text-xs font-semibold text-error-fg hover:bg-bg-subtle">Reload</button>
        </div>
      )}
      {railError && !signedOut && <PlainMessage text={railError} className={ERROR_BOX} onRetry={() => loadRail().catch((e) => setRailError(e.message))} copy />}
      <ProgressDock.Provider value={progressDock}>
      <div className="flex flex-col md:flex-row gap-4 md:gap-2 md:flex-1 md:min-h-0">
        <div data-implement-rail="" style={{ '--rail-w': `${railPx}px` }}
          className="w-full md:w-(--rail-w) shrink-0 flex flex-col gap-3 max-h-[50dvh] overflow-y-auto md:max-h-none md:min-h-0">
          {!listLoading && <AssetFilters counts={assetCounts} assets={assetFilters} onToggle={toggleAsset} />}
          <Rail groups={groups} listLoading={listLoading} query={query} assets={assetFilters} mvp={mvpFilter}
            assetLabels={assetCounts.filter((entry) => assetFilters.includes(entry.id)).map((entry) => entry.label)}
            shownId={shownId} progress={progress} estimates={estimates} valued={valued} onSelect={select} />
        </div>
        <PaneResizer width={railPx} onWidth={(width) => setRailPx(paneWidth(RAIL_WIDTH, width))} limits={RAIL_WIDTH} label="Resize the use case list" data-rail-resizer="" className="self-stretch" />
        <section ref={paneRef} aria-label="Use case" className="relative flex-1 min-w-0 space-y-4 md:self-stretch md:min-h-0 md:overflow-y-auto">
          {selected && (
            <BuildNextStep showcase={readOnly} apiFetch={apiFetch} apiPostJson={apiPostJson} inspireDatabase={settings.inspireDatabase} warehouseId={settings.warehouseId} sessionId={sessionId} refreshKey={refreshKey}
              notebookPath={settings.notebookPath} focusId={selected.id} live={IMPLEMENT_DONE_STATUSES.includes(String(selected.latest?.status || ''))}
              caseOf={(id) => allItems.find((item) => item.id === id)?.uc}
              onBuilt={readOnly ? undefined : onImplemented} onQueued={readOnly ? undefined : buildQueued} onBuildCustom={readOnly ? undefined : (uc) => setWizard({ uc, focus: null, live: false })}
              onMeasure={readOnly ? undefined : openMeasure} />
          )}
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
              valueEstimate={estimates?.use_cases?.[selected.id] ?? null}
              valueTotal={valued?.[selected.id] ?? null}
              builds={rail.latest}
              onSetRule={readOnly ? undefined : () => openMeasure(selected.id)}
              collectedKey={scopeOf(selected.id)}
              onProgress={reportProgress}
              onEdit={readOnly ? undefined : (focus, live) => setWizard({ uc: selected.uc, focus, live })}
              onOpenRun={onOpenRun}
              onBuildQueued={buildQueued}
              onOpenDemoMvp={readOnly && demoMvps?.ids.includes(selected.id) ? () => demoMvps.open(selected.id) : null}
              readOnly={readOnly}
            />
          ) : (
            !listLoading && !listError && <p className={`${PANEL_CLASS} p-6 text-[12px] text-text-secondary`}>This session has no use cases yet.</p>
          )}
        </section>
      <div ref={setProgressDock} data-progress-dock="" className="hidden empty:hidden md:flex md:fixed md:top-14 md:end-0 md:z-30 md:h-[calc(100dvh-3.5rem)]" />
      </div>
      </ProgressDock.Provider>
      {anyValued(valued) && <ValueDisclaimer footer />}
      {calcFor && !readOnly && (
        <CalculateValueDialog key={trackingIdOf(calcFor)} uc={calcFor} table={tableOfUseCase(calcFor)} apiPostJson={apiPostJson} apiFetch={apiFetch} inspireDatabase={settings.inspireDatabase} warehouseId={settings.warehouseId}
          sessionId={sessionId} saved={calculated.byId[trackingIdOf(calcFor)]?.answers || null} version={calculated.byId[trackingIdOf(calcFor)]?.version || null}
          values={valuesForDialog} onClose={() => { setCalcFor(null); setRefreshKey((n) => n + 1); }} />
      )}
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
          onQueued={showQueuedBuild}
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
        <span className="rounded-full border border-border px-1.5 py-px text-xs text-text-secondary">{statusChip(version.status, null, version).label}</span>
        <button type="button" disabled={locked || confirming} title={lockedReason || undefined} onClick={onAsk} aria-label={`Roll back to ${name}`} className={`ms-auto ${OUTLINE_BUTTON}`}>
          <History size={14} /> Roll back
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
            <Button type="button" disabled={locked} onClick={onConfirm} size="sm">
              {pending ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />} Roll back
            </Button>
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
              <span aria-hidden className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${look.node}`}>
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
          <Button type="button" disabled={locked || pending} title={lockedReason || undefined} onClick={() => onTryAgain(missing)} size="sm">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Try again with the {missing.length === 1 ? 'missing thing' : `${missing.length} missing things`}
          </Button>
          <span className="text-xs text-text-secondary">Only what is missing is rebuilt.</span>
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
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-px text-xs font-bold ring-1 ring-inset ${PILL_TONE[state?.tone] || 'bg-bg-subtle text-text-secondary ring-border'}`}>
      {children || state?.label}
    </span>
  );
}

function AssetVersions({ asset, locked, lockedReason, onRollback }) {
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const owner = asset.id === asset.output ? asset : asset.parent;
  const versions = owner?.versions || [];
  if (!asset.live && !asset.side && !versions.length) return null;
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
            <span className="ms-auto"><AssetPill state={{ tone: 'success' }}>Live</AssetPill></span>
            <p className="w-full truncate text-text-secondary" title={asset.vibes || undefined}>{asset.vibes ? `“${vibesPreview(asset.vibes)}”` : 'no vibes'}</p>
          </li>
        )}
        {asset.side && (
          <li data-version={asset.side.version} data-side-version="" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
            <span className="font-semibold text-text-primary">Version {asset.side.version}</span>
            {asset.side.at && <span className="text-text-secondary">· {formatWhen(asset.side.at, asset.side.at)}</span>}
            <span className="ms-auto"><AssetPill state={{ tone: 'warning' }}>Side App (not live yet)</AssetPill></span>
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

function AssetCard({ asset, locked, lockedReason, active, error, money = null, moneyError = '', scope = null, onTryAgain, onRollback }) {
  const [pending, setPending] = useState('');
  const busy = asset.building;
  const send = async (kind, run) => {
    setPending(kind);
    await run();
    setPending('');
  };
  // busy-ok: the step in progress shows a spinning icon in the list below
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
            <History size={14} aria-hidden />
            {asset.live ? `Version ${asset.live.version}, built ${formatWhen(asset.live.at, asset.live.at) || 'on an earlier run'}` : 'Its last build failed, so no version of it is live'}
          </p>
          {active && !busy && <p className="font-medium text-text-primary">A version is building now; roll backs apply after it finishes.</p>}
          {asset.id === 'value_formula' && <MoneyReview money={money} error={moneyError} impact={asset.impact} scope={scope} />}
          {busy?.rollback && (
            <p data-rolling-back="" className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <Loader2 size={14} className="motion-safe:animate-spin text-info-fg" aria-hidden />
              {rollingBackText(asset)}
            </p>
          )}
          {busy && !busy.rollback && (
            <ol aria-label={`Rebuilding the ${asset.label}`} className="space-y-2 text-[13px]">
              {steps.map((step, k) => {
                const state = k < busy.step ? 'done' : k === busy.step ? 'now' : 'next';
                return (
                  <li key={step} data-step={state} className={`flex items-center gap-2.5 ${state === 'next' ? 'text-text-secondary' : 'text-text-primary'} ${state === 'now' ? 'font-semibold' : ''}`}>
                    <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${
                      state === 'done' ? 'bg-success-bg text-success-fg ring-success/30' : state === 'now' ? 'bg-info-bg text-info-fg ring-info/30' : 'bg-surface text-text-secondary ring-border'}`}>
                      {state === 'done' ? '✓' : k + 1}
                    </span>
                    {step}
                    {state === 'now' && <Loader2 size={14} className="shrink-0 motion-safe:animate-spin text-db-red-fg" aria-hidden data-step-spinner="" />}
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
              {asset.warnings.map((w) => <li key={w} className="flex items-start gap-1.5 text-xs text-warning-fg"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />{w}</li>)}
            </ul>
          )}
          {error && <PlainMessage text={error} role="alert" className={ERROR_BOX} copy />}
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

// REQ-355: the steps a queued build reads: none, so the superseded run's steps never show under the queued row.
const NO_STEPS = [];

function UseCaseDetail({ item, builds = [], sessionId, settings, qBase, apiFetch, apiPostJson, databricksHost, notebookRunError, refreshKey, collectedKey, valueEstimate = null, valueTotal = null, onSetRule = null,
  onEdit, onOpenRun = null, onBuildQueued = null, onOpenDemoMvp = null, onProgress = null, readOnly = false }) {
  const useCaseId = item.id;
  const yearlyRead = useValueRead(apiFetch, readOnly ? '' : `/api/inspire/value/yearly?${qBase}`, refreshKey);
  const hasMvp = Boolean(item.latest);
  const viewId = useId();
  const logRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [features, setFeatures] = useState(null);
  const [previous, setPrevious] = useState('');
  const [rebuildError, setRebuildError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [writingNotebook, setWritingNotebook] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [live, setLive] = useState(null);
  const [liveError, setLiveError] = useState('');
  const [statusError, setStatusError] = useState('');
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
    const lastStatus = useRef(null);

  const [arrivals, setArrivals] = useState(null);

  const loadStatus = useCallback(async () => {
    const data = await apiFetch(`/api/inspire/implement/status?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`);
    setStatusError('');
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
    loadStatus().catch((e) => setStatusError(e.message));
    const id = setInterval(() => { loadStatus().catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [hasMvp, loadStatus, refreshKey]);

  // REQ-355: a queued build (pending overlay on the card) shows as queued here too. The status read still holds the old failed version until the server answers,
  // so the detail takes the queued row and no steps of the superseded run.
  const pending = Boolean(item.latest?.pending);
  // REQ-395: the status read's row times from the click of its queued build, so the timer does not move back when the server answers.
  const latest = useMemo(() => (pending ? item.latest : carriedStart(status ? status.latest : item.latest, useCaseId)), [pending, item.latest, status, useCaseId]);
  const stepsNow = pending ? NO_STEPS : status?.steps;
  const stalled = (status ? status.stalled : item.latest?.stalled) || null;
  const uninstalled = latest?.status === IMPLEMENT_UNINSTALLED;
  const built = hasMvp && !uninstalled;
  // REQ-406: the build's own entries (scope-view grants, the Lakebase database grant) show as an inline note; Permission Required opens only on a click.
  const buildPermissions = latest?.asset_status?.permissions || [];
  const moneyKey = `${latest?.spec_version ?? ''}:${latest?.status ?? ''}`;
  const issues = useReportedIssues({ apiFetch, apiPostJson, qBase, useCaseId, on: built && !readOnly, refreshKey: `${moneyKey}:${refreshKey}` });
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
  const scopeProfile = useScopeProfiles({
    apiPostJson, inspireDatabase: settings.inspireDatabase, sessionId, useCaseId, warehouseId: settings.warehouseId,
    enabled: !readOnly && Boolean(settingsView?.settings?.some(isScopeSetting)),
    groupBy: String(settingsView?.settings?.find((s) => s?.name === GROUP_BY)?.value ?? ''),
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
  const tableSwaps = useCallback((table, onPart) => swapParts((part, body) => apiPostJson(
    `/api/inspire/implement/swaps?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}${part ? `&part=${part}` : ''}`, body), table, onPart),
  [apiPostJson, qBase, useCaseId]);
  const tableChange = useCallback((next) => apiPostJson(`/api/inspire/implement/table-change?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`,
    { spec: next }), [apiPostJson, qBase, useCaseId]);
  const chip = statusChip(latest?.status, stalled, latest);
  const [readsResult, setReadsResult] = useState(null);
  // A user-authorization App: the people who may open it and the scope views they cannot read yet (from the last check or grant).
  const [viewerReads, setViewerReads] = useState(null);
  const [readsBusy, setReadsBusy] = useState('');
  const [protectionCopy, setProtectionCopy] = useState('');
  const [protectionFailed, setProtectionFailed] = useState([]);
  const [grantingAccess, setGrantingAccess] = useState(false);
  const tracked = trackedKpiOf(status?.history, latest);
  const kpiView = targetKpiView(tracked?.record, money?.run, liveImpact(money?.run, tracked?.impact || rowImpact(latest)));
  const spec = latest?.spec_json || {};
  const widgets = Array.isArray(status?.rerun_widgets) ? status.rerun_widgets : [];
  const active = versionActive(latest, stalled);
  // REQ-273: a built MVP whose latest build is not published (failed, stopped, held) gets Change choices and build again; a published MVP keeps its card.
  const unpublished = built && !active && !IMPLEMENT_DONE_STATUSES.includes(String(latest?.status || ''));
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
  const stages = useMemo(() => mvpStages(stepsNow, latest, { now, stalled }), [stepsNow, latest, now, stalled]);
  const diagnostics = useBuildDiagnostics({
    apiFetch, query: `${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`, enabled: built && !readOnly,
    refreshKey: `${latest?.spec_version ?? ''}|${latest?.status ?? ''}|${stages.map((s) => s.state).join(',')}`,
  });
  const repair = useMemo(() => mvpRepairOf(stepsNow, latest), [stepsNow, latest]);
  const plan = useMemo(() => versionPlan(stepsNow, latest), [stepsNow, latest]);
  const scope = useMemo(() => mvpScope(stepsNow, latest), [stepsNow, latest]);
  const sorted = useMemo(() => sortedTo(stepsNow, latest), [stepsNow, latest]);
  const progress = mvpProgressSummary(stages, latest, { now, stalled, repair });
  const row = useMemo(() => (item.uc ? catalogRow(item.uc, 0, { statusOf: () => item.state }) : null), [item.uc, item.state]);
  const { percent: shownPercent, step: shownStep } = railProgress(chip, progress);
  useEffect(() => {
    if (status && progress.active) onProgress?.(useCaseId, { percent: shownPercent, step: shownStep });
  }, [status, progress.active, shownPercent, shownStep, useCaseId, onProgress]);

  useEffect(() => {
    const current = latest?.status || null;
    const was = lastStatus.current;
    lastStatus.current = current;
    if (was && IMPLEMENT_ACTIVE_STATUSES.includes(was) && IMPLEMENT_DONE_STATUSES.includes(current) && !reducedMotion()) setCelebrations((n) => n + 1);
  }, [latest?.status]);

  const keepCollected = (next) => {
    setCollected({ at: refreshKey, entries: next });
    setCollectError(saveCollectedVibes(collectedKey, next) ? '' : COLLECT_LOST);
  };
  const addAsk = (text, replaces = []) => keepCollected(rephrasedAsk(text, replaces)
    .reduce((list, out) => collectRemoval(list, out.id, out.label, out.text), collectAsk(vibes, text)));
  const removeAsk = (asset, ask) => keepCollected(collectRemoval(vibes, asset.id, asset.label, ask));
  const dropAsk = (entry) => keepCollected(dropCollected(vibes, entry));
  const openFeatures = (seed = null) => {
    setRebuildError('');
    setFeatures((prev) => ({ at: (prev?.at || 0) + 1, seed }));
  };
  const addFeature = (text, replaces) => {
    addAsk(text, replaces);
    const reported = features?.seed?.feedback;
    if (!reported) return;
    setFeatures((prev) => (prev ? { ...prev, seed: { ...prev.seed, feedback: null } } : prev));
    issues.setStatus(reported, 'vibe', text.trim()).catch((e) => setError(`The vibe is added, but Inspire could not mark the reported issue: ${e.message}`));
  };
  const closeFeatures = () => setFeatures(null);
  const openSettings = () => {
    setFeatures(null);
    onEdit({ step: 'vibes', collected: vibes }, live);
  };
  const openDrawer = (id) => {
    setCardFailed(false);
    setDrawer(id);
  };
  const showBuild = () => progressView.show();

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
      const data = await trackBuildSubmit(body.spec, () => apiPostJson(path, body), onBuildQueued);
      onBuildQueued?.();
      // Every build starts here (Try again, roll back, Rebuild, App and notebook changes). A drawer that started it closes, so the docked
      // Build progress panel that opens is in view and its Close is reachable. A rejected submit keeps the drawer for its error.
      setDrawer(null);
      setFeatures(null);
      setNotice([resultTableMoveNote(data?.summary), ...(Array.isArray(data?.warnings) ? data.warnings : [])].filter(Boolean).join(' '));
      await loadStatus();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSubmitBusy(false);
    }
  };
  const submitSpec = (next, path = '/api/inspire/implement/submit', extra = {}) => startVersion(path, {
    ...extra,
    inspire_database: settings.inspireDatabase,
    warehouse_id: settings.warehouseId,
    session_id: String(sessionId),
    notebook_path: settings.notebookPath,
    spec: next,
  });
  const submitNext = (changes, extra) => submitSpec(nextSpecFrom(latest, changes), undefined, extra);

  const toggleSchedule = () => submitNext({ schedule: { ...(spec.schedule || {}), enabled: !spec.schedule?.enabled } });
  const retryOutput = (name) => submitNext({ retry_outputs: [name] });
  const removeOutput = (name) => submitNext(removeChanges(latest, name));
  const rollbackOutput = (name, version) => submitNext(rollbackChanges(latest, name, version.version, version.vibes));
  const tryAgain = (name, asks) => submitNext(tryAgainChanges(name, asks));
  const removeKept = (version) => submitNext(removeKeptChanges(version));
  const sharingUseCases = sharedUseCases(live);
  const uninstallAll = async () => {
    // REQ-460: confirming the dialog is the agreement to uninstall the use cases that share this App as well.
    if (!(await submitNext(uninstallChanges(), sharingUseCases.length ? { uninstall_shared: true } : undefined))) return;
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
  const building = buildingAssets(stages, progress.active);
  const { strips, tiles } = controlTiles(live, latest, { active, building, plan, stages });
  const stopAction = strips.find((entry) => entry.id === 'build')?.actions?.[0] || null;
  const jobRow = strips.find((entry) => entry.id === 'job') || null;
  const fromCard = (send) => async (...args) => {
    const ok = await send(...args);
    setCardFailed(!ok);
    return ok;
  };
  const history = status?.history || [];
  const kept = keptVersions(history);
  const checklist = useMemo(() => vibeChecklist(stepsNow, latest), [stepsNow, latest]);
  const held = heldVersion(latest, status?.history ?? null);
  const progressView = useProgressView(useCaseId, progress.active);
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
  const stopped = runStopped(latest?.status, stalled);
  const versionCount = status?.history?.length ?? 0;
  const runCount = status?.runs?.ok === false ? null : status?.runs?.runs?.length ?? 0;
  const historyHint = status
    ? `${plural(versionCount, 'spec version')} · ${runCount === null ? 'job runs unknown' : plural(runCount, 'job run')}`
    : <BusyNote inline text="Loading…" />;

  const builtOn = builtVersion(history);
  // RC6-D-05: the uninstall row is the newest version; the version it uninstalled is the newest built one before it.
  const builtBefore = uninstalled ? ([...history].sort((a, b) => (b?.spec_version || 0) - (a?.spec_version || 0)).find((r) => IMPLEMENT_DONE_STATUSES.includes(String(r?.status)))?.spec_version ?? null) : null;
  const nextSpec = built && latest ? rebuildSpec(latest, vibes) : null;
  const choices = builtOn != null && String(nextSpec?.vibes ?? '').trim()
    ? vibePreviousChoices(liveVersionForVibes(history), (latest?.spec_version ?? 0) + 1, Boolean(nextSpec.outputs?.alert)) : [];
  const versionLines = appVersionLines(history);
  const buildAgain = canBuildAgain(latest, { edited, missing });
  const sendsAgain = buildAgain && !IMPLEMENT_DONE_STATUSES.includes(String(latest?.status || ''));
  const rebuildBlocked = !vibes.length && !sendsAgain ? REBUILD_NOTHING : '';
  const submitChecked = async (next) => {
    const problems = vibesProblems(next, builtOn);
    if (!problems.length) return submitSpec(next);
    if (!features) openFeatures();
    setRebuildError(`Rebuild needs one more thing: ${problems.join('; ')}.`);
    return false;
  };
  const failure = mvpFailureOf(stepsNow, latest);
  const terminal = Boolean(failure?.terminal) && latest?.status === 'failed';
  const sendAgain = async () => {
    if (!terminal) return submitChecked(nextSpecFrom(latest, buildAgainChanges(latest)));
    openFeatures();
    setRebuildError(TERMINAL_NEEDS_CHANGE);
    return false;
  };
  const rebuild = async () => {
    setRebuildError('');
    if (!vibes.length) {
      if (await sendAgain()) setFeatures(null);
      return;
    }
    const sent = vibes;
    keepCollected([]);
    if (!(await submitChecked(rebuildSpec(latest, vibes, builtOn, previous)))) {
      keepCollected(sent);
      return;
    }
    setPrevious('');
    setFeatures(null);
  };

  const detailsBody = (id) => {
    if (id === 'dashboard') {
      if (!latest?.dashboard_url || !readOnly) return null;
      return (
        <>
          <p className="text-text-secondary">{SHOWCASE_DASHBOARD_NOTE}</p>
          <a className={LINK} href={latest.dashboard_url} target="_blank" rel="noreferrer">{SHOWCASE_OPEN_APP} <ExternalLink size={14} /></a>
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
              <a className={LINK} href={latest.genie_space_url} target="_blank" rel="noreferrer">{SHOWCASE_OPEN_APP} <ExternalLink size={14} /></a>
            </>
          )}
          {genie.questions.length > 0 && (
            <div>
              <p className="font-medium text-text-primary">{genie.source === 'space' ? 'Sample questions in the Genie Agent' : 'Questions you asked for'}</p>
              <ul className="list-disc ps-5">{genie.questions.map((question, i) => (
                <li key={question}>
                  <span>{question}</span>
                  {genie.notes[i] && <p className="text-text-secondary">{genie.notes[i]}</p>}
                </li>
              ))}</ul>
            </div>
          )}
          {genieAsset.check_question && <p>Inspire checked the Genie Agent with: {genieAsset.check_question}</p>}
          {genieAsset.check_sql && <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap border border-border rounded-lg bg-bg-subtle p-2">{genieAsset.check_sql}</pre>}
        </>
      );
    }
    if (id === 'app') {
      if (!latest?.app_url) return null;
      return (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          {appStatusRows(status?.app_status, latest?.asset_status?.app).map(([label, value]) => (
            <div key={label} className="contents"><dt className="text-text-secondary">{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      );
    }
    if (id !== 'alert') return null;
    if (!latest?.alert_url && !alertAsset.trigger) return <p className="text-text-secondary">No alert on this version.</p>;
    return (
      <>
        {readOnly && <p data-showcase-alert-note="" className="text-text-secondary">{SHOWCASE_ALERT_NOTE}</p>}
        <p>Fires when: {alertAsset.trigger || 'not recorded'}</p>
        {alertAsset.condition_sql && <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap border border-border rounded-lg bg-bg-subtle p-2">{alertAsset.condition_sql}</pre>}
        <p>Notifies: {spec.outputs?.alert_recipients?.join(', ') || 'no email recipients'}
          {(spec.outputs?.alert_destinations || []).length ? `; ${spec.outputs.alert_destinations.map((d) => d.name || d.id).join(', ')}` : ''}
        </p>
        <p>Subscribers on the job task: {alertAsset.subscribers ?? 'not recorded'}</p>
        <p>Last check: {alertAsset.check_state || 'not checked yet'}</p>
        <p className="text-text-secondary">It runs after each scheduled or full run of the job and notifies once per run, only when the condition holds. Preview re-runs never send it.</p>
      </>
    );
  };

  const buildRunUrl = stalled?.run_url || status?.build_run_url || '';
  const dataStop = !readOnly && dataStopped(latest);
  const genieChanges = genieChangesOf(stepsNow, latest);
  const [sourceNow, setSourceNow] = useState({ loaded: false, unreadable: null, canGrant: false });
  useEffect(() => {
    if (readOnly || !latest) return undefined;
    let live = true;
    apiFetch(`/api/inspire/implement/context?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`).then((data) => { if (live) setSourceNow(liveSourceNow(data)); }).catch((e) => { if (live) setSourceNow({ loaded: false, unreadable: null, canGrant: false, error: e.message }); });
    return () => { live = false; };
  }, [qBase, latest?.session_id, latest?.spec_version, readOnly]);
  const protection = readOnly ? null : liveProtection(sourceNow, protectionStopOf(latest));
  const userCancel = cancelledByUser(latest);
  const choicesNow = protection ? protectionChoices(protection)
    : buildAgain && !dataStop && latest?.status === 'failed' && !userCancel ? (stopped
      ? stoppedChoices(latest, { notebookUrl: notebook?.href || '', issueUrl: newIssueUrl })
      : failureChoices(latest, { technique: fieldOf(item.uc || {}, 'Analytics Technique', 'analytics_technique'), notebookUrl: notebook?.href || '' })) : [];
  const writeNotebook = async () => {
    setWritingNotebook(true);
    setError('');
    try {
      const data = await apiPostJson('/api/inspire/generate-genie', genieNotebookRequest({
        inspireDatabase: settings.inspireDatabase, warehouseId: settings.warehouseId, sessionId, useCaseId, notebookPath: settings.notebookPath,
      }));
      setNotice(`Inspire is writing the notebook${data?.job_run_url ? `: ${data.job_run_url}` : ''}. Open it from Notebook when it is ready, and run it yourself.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setWritingNotebook(false);
    }
  };
  const recheckSources = async (before = '') => {
    setProtectionFailed([]);
    try {
      const data = await apiFetch(`/api/inspire/implement/context?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`);
      setSourceNow(liveSourceNow(data));
      const now = data.app_unreadable?.text
        || 'Inspire checked the sources again: the App can read them. Start the build once more to continue.';
      setProtectionCopy([before, now].filter(Boolean).join('. '));
    } catch (e) {
      setProtectionCopy([before, `Inspire could not check the sources again: ${e.message}`].filter(Boolean).join('. '));
    }
    return undefined;
  };
  const grantSourceRead = async () => {
    setGrantingAccess(true);
    setProtectionCopy('');
    setProtectionFailed([]);
    try {
      const got = await apiPostJson(`/api/inspire/implement/grant-access?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}&kind=source_tables`, { tables: protection.tables });
      setProtectionFailed(got.failed || []);
      raisePermissions([...grantGapPermissions(got), ...grantFailurePermissions(got)], {}, { explicit: true });
      return recheckSources(abacGrantText(got));
    } catch (e) {
      setProtectionCopy(`Your grant was refused: ${e.message}`);
    } finally {
      setGrantingAccess(false);
    }
    return undefined;
  };
  const pickChoice = async (choice) => {
    if (choice.id === 'copy' && choice.sql) {
      try {
        await navigator.clipboard.writeText(choice.sql);
        setProtectionCopy('The SQL is copied. Send it to your data owner.');
      } catch (e) {
        setProtectionCopy(`The SQL could not be copied: ${e.message}. Select it above and copy it.`);
      }
      return undefined;
    }
    if (choice.id === 'scope') return openSettings();
    if (protection && choice.id === 'check') return recheckSources();
    if (protection && choice.id === 'grant') return grantSourceRead();
    if (protection && choice.id === 'access') return onEdit?.({ step: 'app_access' }, live);
    if (choice.changes) return submitChecked(nextSpecFrom(latest, { ...buildAgainChanges(latest), ...choice.changes }));
    if (choice.seed) return openFeatures(choice.seed.text ? choice.seed : null);
    return writeNotebook();
  };
  const failureBanner = hasMvp && chip.tone === 'error' && !held && !checklist?.notDecided && (
    <section aria-label="Build failed" className="rounded-lg border border-error/30 bg-error-bg px-3.5 py-3 text-[12px] space-y-2.5">
      <div className="flex items-start gap-2.5">
        <XCircle size={16} className="mt-px shrink-0 text-error-fg" aria-hidden />
        <div className="min-w-0 space-y-0.5 text-error-fg">
          <p className="text-[13px] font-semibold">{stopped ? 'The build stopped' : 'The build failed'}</p>
          {failedStage && <p>Step: <span className="font-semibold">{failedStage.label}</span></p>}
          {(protection?.reason || reason) && <PlainMessage text={protection?.reason || reason} />}
          {(protection?.details || protection?.sql.length > 0) && (
            <details data-protection-details="" className="text-xs text-error-fg">
              <summary className="cursor-pointer">Details</summary>
              {protection.details && <p className="mt-1 font-mono break-all">{protection.details}</p>}
              {protection.sql.length > 0 && (
                <pre aria-label="SQL to run" data-protection-sql="" className="mt-1 p-2 rounded bg-bg font-mono text-xs text-text-primary whitespace-pre-wrap break-all">
                  {protection.sql.join('\n')}
                </pre>
              )}
            </details>
          )}
        </div>
      </div>
      <StageNotes stages={[{ id: 'Notebook', notes: genieChanges }]} label={GENIE_CHANGES_HEADING} heading={GENIE_CHANGES_HEADING} />
      {failure?.rounds?.length > 0 && (
        <div aria-label={FAILURE_ROUNDS_HEADING} className="space-y-1 text-error-fg">
          <p className="font-semibold">{FAILURE_ROUNDS_HEADING}</p>
          <ol className="list-decimal ps-5 space-y-1">
            {failure.rounds.map((round) => (
              <li key={round.attempt}>
                <PlainMessage as="span" text={`Attempt ${round.attempt}${round.error ? ` failed: ${round.error}` : ' failed'}.`} />{' '}
                <span>Inspire {round.tried}{round.why ? `: ${round.why}` : ''}.</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {protectionCopy && <PlainMessage text={protectionCopy} role="status" data-protection-copy="" className="text-text-primary" />}
      {protectionFailed.length > 0 && (
        <details data-protection-failed="" className="text-xs text-error-fg">
          <summary className="cursor-pointer">Details</summary>
          <ul className="mt-1 space-y-0.5">{protectionFailed.map((line, i) => <li key={`${i}-${line}`} className="font-mono break-all">{line}</li>)}</ul>
        </details>
      )}
      {buildAgain && !protection && <p className="text-error-fg">{dataStop ? DATA_STOP_HINT : terminal ? TERMINAL_STOP_HINT : buildAgainHint(latest)}</p>}
      <ChoiceList heading={FAILURE_CHOICES_HEADING} choices={choicesNow} mark="data-failure-choice" tone="text-error-fg" disabled={locked || writingNotebook}
        title={lockedReason} busy={writingNotebook ? 'notebook' : ''} onPick={pickChoice} />
      {(buildAgain || onEdit || buildRunUrl) && (
        <div className="flex flex-wrap gap-2">
          {buildAgain && !dataStop && !terminal && (
            <Button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => sendAgain()} size="sm">
              {submitBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Try again
            </Button>
          )}
          {buildAgain && dataStop && (
            <Button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => openFeatures()} size="sm">
              <Sparkles size={14} /> {VIBE_FEATURES_LABEL}
            </Button>
          )}
          {onEdit && (
            <Button type="button" size="sm" variant={buildAgain ? 'secondary' : 'primary'} onClick={openSettings}>
              <Settings2 size={14} /> {OPEN_ALL_SETTINGS}
            </Button>
          )}
          {buildRunUrl && (
            <a data-run-link="" className={OUTLINE_BUTTON} href={buildRunUrl} target="_blank" rel="noreferrer">
              {stopped ? 'Open the run that stopped' : 'Open the run'} <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}
    </section>
  );

  const reads = readOnly ? null : liveReads(sourceNow);
  const grantedAll = !readOnly && !reads && readsResult?.version === latest?.spec_version && (readsResult?.action === 'grant' || readsResult?.action === 'check')
    && !readsResult?.refused && !readsResult?.error;
  const viewerNow = viewerReads && viewerReads.version === latest?.spec_version ? viewerReads : null;
  const readsLeft = reads || (viewerNow ? { tables: viewerNow.tables, canGrant: viewerNow.tables.some((t) => t.grants?.length > 0), viewers: viewerNow.user === true } : null)
    || (grantedAll ? { tables: [], canGrant: false } : null);
  // REQ-406: a person who cannot grant the App's reads sees the inline card below; See the grant opens Permission Required with the owner's exact GRANT statements.
  const refreshSourceNow = async () => {
    const fresh = await apiFetch(`/api/inspire/implement/context?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`);
    setSourceNow(liveSourceNow(fresh));
  };
  const runReads = async (action, { auto = false } = {}) => {
    setReadsBusy(action);
    try {
      // A user-authorization build grants its viewers' scope views through app-reads; only the source tables take this path.
      if (action === 'grant' && sourceNow.loaded && !appObjectsOf(latest)) {
        const tables = (sourceNow.unreadable?.tables || []);
        const got = await apiPostJson(`/api/inspire/implement/grant-access?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}&kind=source_tables`, { tables });
        const failed = [...(got.failed || []), ...(got.abac_gaps || []).flatMap((g) => g.grants.map((sql) => `${sql}: not yours to grant`))];
        if (!auto) raisePermissions([...grantGapPermissions(got), ...grantFailurePermissions(got)], {}, { explicit: true });
        setReadsResult({ text: abacGrantText(got), failed, refused: failed.length > 0, version: latest?.spec_version, action });
        await refreshSourceNow();
        return;
      }
      // REQ-406: a check shows its refusal inline (Check again, See the grant) and never opens Permission Required; only a grant action raises.
      const got = await apiPostJson(`/api/inspire/implement/app-reads?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`, { action }, { raise: action === 'grant' });
      setReadsResult({ ...got, version: latest?.spec_version, action });
      if (got.objects) setViewerReads({ version: latest?.spec_version, tables: got.tables || [], user: got.mode === 'user', permissions: got.permissions || [] });
      if (action === 'grant' && !auto) raisePermissions(got.permissions, { retry: () => recheckSources() }, { explicit: true });
      if (action === 'check' || action === 'grant') await refreshSourceNow();
    } catch (e) {
      setReadsResult({ error: e.message, version: latest?.spec_version, action });
    } finally {
      setReadsBusy('');
    }
  };
  const pickReads = async (choice) => {
    // REQ-131, REQ-260: the owner's grant commands open in Permission Required; there is no separate copy path for GRANT SQL
    if (choice.id !== 'copy') return runReads(choice.id);
    // A viewer check's own grant list (the exact SQL each viewer still needs) is what See the grant opens, as the check found it.
    raisePermissions(readsLeft?.viewers && viewerNow?.permissions?.length ? viewerNow.permissions : (choice.permissions || []), {}, { explicit: true });
  };
  const autoReads = useRef({});
  const autoViewerChecks = useRef({});
  useEffect(() => {
    // A build that persisted its App objects (views) is checked once per build version, the same set the backend reads (no grant runs).
    if (readOnly || !latest || !appObjectsOf(latest)) return;
    const key = `${latest.session_id ?? ''}:${latest.spec_version}`;
    if (autoViewerChecks.current[key]) return;
    autoViewerChecks.current[key] = true;
    runReads('check');
  }, [readOnly, latest?.session_id, latest?.spec_version]);
  useEffect(() => {
    if (!reads || readOnly || !latest || !reads.canGrant) return;
    const key = `${latest.session_id ?? ''}:${latest.spec_version}`;
    if (autoReads.current[key]) return;
    autoReads.current[key] = true;
    runReads('grant', { auto: true });
  }, [reads, readOnly, latest?.session_id, latest?.spec_version]);
  // REQ-131, REQ-260, REQ-406: the grants a failed build's lost tables need (the build status carries them) are an inline note, not an automatic dialog.
  const lostPermissions = latest?.status === 'failed' ? latest?.asset_status?.data?.permissions : null;
  const noteGrants = [...buildPermissions, ...(lostPermissions || [])];
  const permissionNote = noteGrants.length > 0 && (
    <section aria-label="Permission needed" data-permission-note="" className="rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-3 text-[12px] space-y-2">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-px shrink-0 text-warning-fg" aria-hidden />
        <div className="min-w-0 space-y-1 text-warning-fg">
          <p className="text-[13px] font-semibold">Permission needed</p>
          {[...new Set(noteGrants.map((g) => g?.why).filter(Boolean))].map((why) => <p key={why}>{why}</p>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-permission-see="" onClick={() => raisePermissions(noteGrants, { retry: () => loadStatus().catch(() => {}) }, { explicit: true })}
          className="inline-flex h-8 items-center justify-center px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle">See the grant</button>
        <button type="button" data-permission-request="" onClick={() => raisePermissions(noteGrants, { retry: () => loadStatus().catch(() => {}) }, { explicit: true })}
          className="text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary">Request permission</button>
      </div>
    </section>
  );
  const readsCard = readsLeft && (
    <section aria-label={readsLeft.tables.length ? APP_READS_HEADING : APP_READS_CLEARED} data-app-reads="" className="rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-3 text-[12px] space-y-2.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-px shrink-0 text-warning-fg" aria-hidden />
        <div className="min-w-0 space-y-1 text-warning-fg">
          <p className="text-[13px] font-semibold">{readsLeft.tables.length ? APP_READS_HEADING : APP_READS_CLEARED}</p>
          {readsLeft.tables.length > 0 && !readsLeft.viewers && <p>{appReadsText(readsLeft, latest?.app_name || '')}</p>}
          {readsLeft.tables.length > 0 && <p>{`Ask ${appReadsOwners(readsLeft)} to grant access. The exact commands are in Permission Required.`}</p>}
          {readsLeft.tables.length > 0 && readsLeft.viewers && (
            <ul aria-label="Viewers who still need access" data-viewer-rows="" className="list-disc ps-5 space-y-0.5">
              {viewerRows(readsLeft).map((r) => <li key={`${r.viewer}|${r.table}`} data-viewer-row={r.viewer}>{`Ask your admin to grant ${r.viewer} access to ${appReadsName(r.table)}`}</li>)}
            </ul>
          )}
          {readsLeft.tables.length > 0 && !readsLeft.viewers && (
            <ul aria-label="Tables the App cannot read" data-table-rows="" className="list-disc ps-5 space-y-0.5">
              {tableRows(readsLeft).map((r) => <li key={r.table} data-table-row={r.table}>{appReadsName(r.table)}</li>)}
            </ul>
          )}
        </div>
      </div>
      {readsResult && readsResult.version === latest?.spec_version && (
        <div role="status" aria-label="Grant result" data-app-reads-result={readsResult.refused || readsResult.error ? 'refused' : readsResult.action} className="space-y-0.5 text-text-primary">
          {readsResult.error && <p>Your grant could not be made. The error is under Details.</p>}
          {readsResult.error && <details data-app-reads-error="" className="text-xs"><summary className="cursor-pointer">Details</summary><PlainMessage text={readsResult.error} /></details>}
          {!readsResult.error && readsResult.action !== 'copy' && readsResult.text && <p>{readsResult.text}</p>}
          {!readsResult.error && readsResult.failed?.length > 0 && (
            <details data-app-reads-failed="" className="text-xs">
              <summary className="cursor-pointer">Details</summary>
              <ul className="space-y-0.5 mt-1">{readsResult.failed.map((line, i) => <li key={`${i}-${line}`} className="font-mono break-all">{line}</li>)}</ul>
            </details>
          )}
          {readsResult.copied && <p>The grant SQL is copied. Send it to {readsLeft.tables.map((t) => t.owner).filter(Boolean)[0] || 'the table owner'}.</p>}
          {readsResult.copyError && <PlainMessage text={`The grant SQL could not be copied: ${readsResult.copyError}`} after="Select it above and copy it." />}
        </div>
      )}
      {grantedAll && latest?.asset_status?.app?.state === 'failed' && (
        <button type="button" data-app-publish="" onClick={rerun} disabled={rerunBusy}
          className="rounded-md border border-warning/40 px-2.5 py-1 text-[12px] font-medium text-warning-fg hover:bg-warning-bg/70 disabled:opacity-60">Publish now</button>
      )}
      {readsLeft.tables.length > 0 && (() => {
        // REQ-082: one primary action that fits the person's rights (Grant access, else See the grant in Permission Required); Check again stays quiet.
        const choices = appReadsChoices(readsLeft);
        const primary = choices.find((c) => c.id === (readsLeft.canGrant === true ? 'grant' : 'copy'));
        const check = choices.find((c) => c.id === 'check');
        return (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" data-app-reads-primary={primary.id} disabled={readsBusy !== ''} onClick={() => pickReads(primary)}
              className="inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50">
              {readsBusy === primary.id ? <Loader2 size={14} className="animate-spin" /> : null} {primary.label}
            </button>
            <button type="button" data-app-reads-choice={check.id} disabled={readsBusy !== ''} onClick={() => pickReads(check)}
              className="text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary disabled:opacity-50">
              {check.label}
            </button>
            {primary.id === 'grant' && (
              <button type="button" data-app-reads-choice="copy" disabled={readsBusy !== ''} onClick={() => pickReads(choices.find((c) => c.id === 'copy'))}
                className="text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary disabled:opacity-50">
                {choices.find((c) => c.id === 'copy').label}
              </button>
            )}
          </div>
        );
      })()}
    </section>
  );

  const partCards = (id) => {
    const assets = pickable.filter((asset) => asset.output === id);
    const card = assets.find((asset) => asset.id === pickedParts[id]) || assets[0] || null;
    if (!card) return null;
    return (
      <>
        <PartTabs assets={assets} picked={card.id} onPick={(picked) => { setPickedParts((prev) => ({ ...prev, [id]: picked })); setCardFailed(false); }} />
        <div {...(assets.length > 1 ? tabPanel(PART_TABS, card.id, card.id) : {})}>
          <AssetCard
            key={card.id}
            asset={card}
            locked={locked}
            lockedReason={lockedReason}
            active={active}
            error={cardFailed ? error : ''}
            money={money}
            moneyError={moneyError}
            scope={scopeFacts}
            onTryAgain={fromCard(tryAgain)}
            onRollback={fromCard(rollbackOutput)}
          />
        </div>
      </>
    );
  };

  const jobBody = () => (
    <>
      <BuildControls kept={kept} live={live} liveError={liveError} latest={latest} useCaseId={useCaseId} active={active}
        actionBusy={actionBusy} submitBusy={submitBusy} readOnly={readOnly} onAction={runControl} onRemoveKept={removeKept} onToggleSchedule={toggleSchedule} onRefresh={loadLive}
        onOpenRun={onOpenRun} />
      {stalled?.run_url && (
        <a className="text-[12px] font-semibold text-db-red-fg inline-flex items-center gap-1" href={stalled.run_url} target="_blank" rel="noreferrer">
          Open the run that stopped <ExternalLink size={14} />
        </a>
      )}
      <section aria-label="Run and schedule" className={PANEL_CLASS}>
        <SectionTitle icon={RefreshCw} title="Run and schedule" hint="Schedule and retry build a new version; a preview re-run does not" />
        <div className="p-4 grid gap-5 md:grid-cols-2 text-[12px]">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary mb-1">Quick re-run</div>
            {widgets.map((w) => (
              <label key={w.name} className="block text-xs mb-1">
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
                  <input dir="auto"
                    className="mt-0.5 w-full px-2 py-1 border border-border rounded-lg bg-surface"
                    disabled={readOnly}
                    title={lockedReason || undefined}
                    value={overrides[w.name] ?? ''}
                    placeholder={w.default == null ? '' : String(w.default)}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [w.name]: e.target.value }))}
                  />
                )}
                {w.allowed && <span className="block text-xs text-text-secondary">{w.allowed}</span>}
              </label>
            ))}
            {widgets.length === 0 && <p className="text-xs text-text-secondary">No widgets to change; the re-run uses the job&apos;s values.</p>}
            <p className="text-xs text-text-secondary">A preview of the notebook only. Blank fields keep the job&apos;s values, and the alert never fires on a preview.</p>
            <Button
              type="button"
              disabled={readOnly || rerunBusy || !latest?.job_id}
              title={lockedReason || undefined}
              onClick={rerun}
              size="sm" className="mt-2 w-full">
              {rerunBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Preview re-run
            </Button>
          </div>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={!!spec.schedule?.enabled} disabled={locked || !latest} title={lockedReason || undefined} onChange={toggleSchedule} />
              Schedule on
            </label>
            {failedOutputs.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">Failed outputs</div>
                {failedOutputs.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={locked}
                    onClick={() => retryOutput(o.id)}
                    title={lockedReason || o.error}
                    className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-error/40 bg-surface text-error-fg disabled:opacity-50"
                  >
                    <RotateCcw size={14} /> Retry the {o.label}
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
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-start bg-linear-to-r from-db-red-50 to-surface"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <IconChip icon={History} size="sm" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-db-red-fg">History</span>
                <span className="block text-xs text-text-secondary">{historyHint}</span>
                {versionLines.live && <span className="block text-xs font-semibold text-text-primary" data-app-live>{versionLines.live}</span>}
                {versionLines.side && <span className="block text-xs text-text-secondary" data-app-side>{versionLines.side}</span>}
              </span>
            </span>
            <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${historyOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </h3>
        <div id={`${viewId}-history`} hidden={!historyOpen} className="p-4 space-y-3 text-[12px] border-t border-border">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">Spec versions</div>
          {!status && <BusyNote className="text-[12px] text-text-secondary" text="Loading the versions and job runs…" />}
          {history.map((entry) => (
            <div key={entry.spec_version} data-history-version={entry.spec_version} className="border border-border rounded-lg bg-surface px-3 py-2 text-[12px]">
              <div>v{entry.spec_version} · {historyStatus(entry, latest, stalled)} · {isAppUpdate(history, entry) ? APP_UPDATED_TEXT : entry.change_classes || 'initial'}</div>
              <div className="text-text-secondary">{entry.created_by} · {entry.updated_at}</div>
              <VibeChecklist compact checklist={vibeChecklist(null, entry)} assets={entry.asset_status} />
              {notDoneLines(entry).map((line, i) => <p key={`${i}-${line}`} data-not-done-line="" className="text-error-fg">{line}</p>)}
            </div>
          ))}
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary pt-2">Job runs</div>
          {status?.runs?.ok === false && <PlainMessage as="p" text={status.runs.error} securable="workspace" className="text-[12px] text-error-fg" />}
          {(status?.runs?.runs || []).map((run) => (
            <div key={run.run_id} className="border border-border rounded-lg bg-surface px-3 py-2 text-[12px]">
              <div>{runStateText(run.state) || RUN_STATE_UNKNOWN} · {runProfileText(run.profile)} · {run.trigger === 'PERIODIC' ? 'scheduled' : 'started by hand'}</div>
              <div className="text-text-secondary">
                {run.started} · {run.duration_s}s
                {run.url && <> · <a className="text-db-red-fg" href={run.url} target="_blank" rel="noreferrer">Open run</a></>}
              </div>
              {run.message && <PlainMessage as="div" text={run.message} className="text-text-secondary" />}
            </div>
          ))}
          {status?.runs?.ok && status.runs.runs.length === 0 && <p className="text-[12px] text-text-secondary">No job runs yet.</p>}
          {status && !status.runs && <p className="text-[12px] text-text-secondary">This use case has no job yet.</p>}
        </div>
      </section>
    </>
  );

  const notebookBody = () => (
    <>
      {notebook ? (
        <NotebookPanel notebook={notebook} kpi={kpiView}>
          {!readOnly && (
            <button type="button" disabled={active || submitBusy} onClick={() => setUninstalling(true)} className={DANGER_BUTTON}>
              <Trash2 size={14} /> Uninstall
            </button>
          )}
        </NotebookPanel>
      ) : (
        <p className={`${PANEL_CLASS} p-4 text-[12px] text-text-secondary`}>This version has no Databricks AI notebook.</p>
      )}
      {notebook && !readOnly && (
        <p className="text-xs text-text-secondary">Every output reads the notebook&apos;s result tables, so uninstalling the notebook uninstalls the whole MVP.</p>
      )}
      <TargetKpiCard view={kpiView} readOnly={readOnly} builtBefore={builtOn != null} scope={scopeFacts} />
      <UseCaseSettings view={settingsView} error={settingsError} readOnly={readOnly} impact={liveImpact(money?.run, tracked?.impact || rowImpact(latest))} scope={scopeProfile}
        onPreview={previewSetting} onSave={saveSetting} onRun={runSettings} onEdit={onEdit ? () => onEdit({ step: 'settings' }, live) : undefined}>
        <UseCaseTables key={String(latest?.spec_version ?? '')} uc={item.uc} latest={latest} view={tablesView} readOnly={readOnly} locked={locked}
          onSwaps={tableSwaps} onClassify={tableChange} onSave={submitSpec} />
      </UseCaseSettings>
      {partCards('notebook')}
    </>
  );

  const outputBody = (id) => {
    const tile = tiles.find((entry) => entry.output.id === id) || null;
    const facts = tile && tile.kind !== 'off' ? detailsBody(id) : null;
    const alertTab = id === 'alert';
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
            failed={failedOutputs.find((o) => o.id === id) || null}
            uninstall={readOnly ? null : assetUninstall(id, latest, live, tile.row?.name || '')}
            builtBy={live?.assets?.[id]?.built_by || null}
            useCaseId={useCaseId}
            onAction={runControl}
            onToggleSchedule={toggleSchedule}
            onRetry={retryOutput}
            onRemove={removeOutput}
            onAddOutput={onEdit && !alertTab ? () => onEdit({ step: 'delivery' }, live) : undefined}
            onOpenRun={onOpenRun}
          />
        )}
        {facts && <div data-asset-facts={id} className={`${CARD} p-4 space-y-2 text-[12px]`}>{facts}</div>}
        {partCards(id)}
        {alertTab && (
          <UseCaseAlerts apiFetch={apiFetch} apiPostJson={apiPostJson} qBase={qBase} useCaseId={useCaseId} refreshKey={refreshKey} readOnly={readOnly}
            onEditMvp={onEdit ? () => onEdit({ step: 'delivery' }, live) : null} />
        )}
      </>
    );
  };

  const drawerTile = ASSET_TILES.find((entry) => entry.id === drawer) || null;
  const drawerBody = () => {
    if (drawer === 'job') return jobBody();
    if (drawer === 'notebook') return notebookBody();
    return outputBody(drawer);
  };

  const tileProps = {
    active, actionBusy, submitBusy, readOnly, useCaseId, onAction: runControl, onToggleSchedule: toggleSchedule, onRetry: retryOutput, onRemove: removeOutput,
    onShowBuild: showBuild, onOpenRun,
  };

  const tileRow = (
    <ul aria-label="Assets" data-asset-tiles="" className="shrink-0 grid grid-cols-1 @[18rem]:grid-cols-2 @[30rem]:grid-cols-3 @[46rem]:grid-cols-6 auto-rows-fr gap-2">
      {ASSET_TILES.map(({ id, label }) => {
        if (id === 'notebook') {
          return (
            <AssetTile key={id} id={id} label={label} {...tileProps} building={building.has(id)} state={notebook?.state || NO_NOTEBOOK} href={notebook?.href || notebook?.runUrl || ''} reason={notebook?.state?.detail || ''}
              removeLabel="Uninstall" onUninstall={readOnly || !notebook ? null : () => setUninstalling(true)} onVersions={() => openDrawer(id)} />
          );
        }
        if (id === 'job') {
          return <AssetTile key={id} id={id} label={label} {...tileProps} building={building.has(id)} row={jobRow} state={jobRow?.state || (live ? NO_JOB : CHECKING)}
            href={workspaceJobUrl(databricksHost, live?.targets?.job)} reason={jobRow?.detail || ''} onVersions={() => openDrawer(id)} />;
        }
        const tile = tiles.find((entry) => entry.output.id === id);
        const failedOne = failedOutputs.find((o) => o.id === id) || null;
        return (
          <AssetTile key={id} id={id} label={label} {...tileProps} building={building.has(id)} tile={tile} reason={tile.error || failedOne?.error || tile.note || ''}
            failed={failedOne} uninstall={readOnly ? null : assetUninstall(id, latest, live, tile.row?.name || '')}
            onAdd={readOnly ? null : id === 'alert' ? () => openDrawer(id) : onEdit ? () => onEdit({ step: 'delivery' }, live) : null} onVersions={() => openDrawer(id)} />
        );
      })}
    </ul>
  );

  const unreliableNow = hasMvp && !failureBanner && !held && IMPLEMENT_DONE_STATUSES.includes(latest?.status) && Boolean(unreliableHold(latest));
  const olderNote = hasMvp && !active ? olderBuildNote(latest) : '';
  const appUpdate = appUpdateChanges(latest, history);
  const appNote = hasMvp && !active && appUpdate ? String(latest?.app_update?.text || '') : '';
  const rebuildBanner = (unreliableNow || olderNote || appNote) && (
    <section aria-label="Rebuild" data-rebuild-note="" className="rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-3 text-[12px] space-y-2">
      {unreliableNow && <p className="text-warning-fg">{UNRELIABLE_REBUILD_NOTE}</p>}
      {olderNote && <p className="text-warning-fg" data-older-build="">{olderNote}</p>}
      {appNote && <p className="text-warning-fg" data-app-update="">{appNote}</p>}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {appNote && (
            <Button type="button" data-app-update-button="" disabled={locked} title={lockedReason || undefined} onClick={() => submitNext(appUpdate)} size="sm">
              {submitBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Update the App
            </Button>
          )}
          {(unreliableNow || olderNote) && (
            <Button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => openFeatures()} size="sm">
              <Sparkles size={14} /> {VIBE_FEATURES_LABEL}
            </Button>
          )}
        </div>
      )}
    </section>
  );

  const attention = (
    <>
      {failureBanner}
      {readsCard}
      {rebuildBanner}
      {missing.length > 0 && (
        <div className="border border-error/30 bg-error-bg rounded-lg px-3 py-2 text-[12px] space-y-2">
          <p className="text-error-fg">{lostTablesText(missing)}</p>
          {onEdit && (
            <Button type="button" disabled={active} onClick={() => onEdit({ step: 'data', missingTables: missing }, live)} size="sm">
              <Pencil size={14} /> Edit the Data step
            </Button>
          )}
        </div>
      )}
      {edited && (
        <div className="border border-error/30 bg-error-bg rounded-lg px-3 py-2 text-[12px] space-y-2">
          <p className="text-error-fg">
            {statusReason(latest) || 'The notebook was edited after Inspire last built it, so this version did not rebuild it.'}
          </p>
          <Button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => submitNext({ confirm_notebook_overwrite: true })} size="sm">
            {submitBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Rebuild and overwrite the edits
          </Button>
        </div>
      )}
    </>
  );
  const needsAttention = Boolean(failureBanner) || Boolean(readsCard) || Boolean(rebuildBanner) || missing.length > 0 || Boolean(edited) || Boolean(held);

  const stop = stopAction && (
    <button type="button" data-stop-build="" disabled={readOnly || actionBusy !== ''} title={lockedReason || undefined} onClick={() => runControl(stopAction)} className={DANGER_BUTTON}>
      {actionBusy === `${stopAction.asset}:${stopAction.action}` ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />} {stopAction.label}
    </button>
  );

  return (
    <>
    <div data-use-case-pane="" className={`@container flex flex-col gap-3 ${built ? 'md:h-full md:min-h-0' : ''}`}>
      {celebrations > 0 && <Celebration key={celebrations} trigger />}
      <header data-pinned-name="" className={`${PANEL_CLASS} shrink-0 px-4 py-3 space-y-2.5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 break-words text-lg font-bold text-text-primary" title={item.name}>{item.name}</h2>
            <div data-use-case-meta="" className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
              {row?.domain && <span className="whitespace-nowrap"><bdi>{row.domain}</bdi>{row.subdomain && <> › <bdi>{row.subdomain}</bdi></>}</span>}
              {latest?.spec_version != null && <span className="whitespace-nowrap font-mono">· v{latest.spec_version}</span>}
              <ImplementStatusBadge state={item.state} />
              {row?.inspire != null && <span data-score-inline="" title="Inspire composite score" className="whitespace-nowrap">· Score {row.inspire.toFixed(1)}</span>}
              {uninstalled && builtBefore != null && <span data-uninstalled-version="" className="whitespace-nowrap font-mono">v{builtBefore} uninstalled</span>}
            </div>
          </div>
        </div>
        <div className={HEADER_ACTIONS}>
          {readOnly ? (built && onOpenDemoMvp && (
            <Button type="button" data-demo-open-mvp={useCaseId} onClick={onOpenDemoMvp} size="sm">
              <ArrowRight size={14} /> Open MVP
            </Button>
          )) : built ? (
            <>
              <Button type="button" size="sm" variant={vibes.length ? 'primary' : 'secondary'} data-vibe-features="" data-collected={vibes.length} onClick={() => openFeatures()}
                className={vibes.length > 0 && !active ? 'edit-mvp-invite' : ''}>
                <Pencil size={14} /> {vibeFeaturesLabel(vibes)}
              </Button>
              {unpublished && (
                <Button type="button" data-change-choices="" onClick={() => onEdit(null, live)} size="sm">
                  <Sparkles size={14} /> {CHANGE_CHOICES_LABEL}
                </Button>
              )}
              <button type="button" disabled={active || submitBusy} title={active ? 'Wait for this run to finish' : undefined} onClick={() => setUninstalling(true)} className={DANGER_BUTTON}>
                <Trash2 size={14} /> Uninstall this use case
              </button>
            </>
          ) : (
            <Button type="button" onClick={() => onEdit(null, live)} size="sm">
              <Sparkles size={14} /> {START_MVP_LABEL}
            </Button>
          )}
          {item.uc && (
            <MoreMenu items={[{ label: 'Use case details', onSelect: () => setDetailsOpen(true) }]} />
          )}
        </div>
        {item.uc && (valuedLine(valueTotal)
          ? <RunValue row={{ id: item.id, value: valueTotal }} />
          : <ValueEstimateLine uc={item.uc} estimate={valueEstimate} onSetRule={onSetRule} />)}
        {built && progress.active && <ProgressLine chip={chip} summary={progress} typical={typicalBuildText(builds)} />}
        {!hasMvp && (
          <p className="text-[12px] text-text-secondary">
            {readOnly ? SHOWCASE_NO_MVP : `Not built yet. Press ${START_MVP_LABEL} to build it.`}
          </p>
        )}
        {uninstalled && (
          <p data-uninstalled="" className="text-[12px] text-text-secondary">
            Uninstalled in v{latest.spec_version}. {latest.status_message ? `Not removed: ${latest.status_message}. ` : ''}The result tables and the history are kept. {START_MVP_LABEL} builds it again.
          </p>
        )}
      </header>
      {permissionNote}
      {detailsOpen && row && (
        <UseCaseDrawer row={row} yearly={yearlyRead?.use_cases?.[useCaseId] || null} onClose={() => setDetailsOpen(false)}>
          <UseCaseDetailBody uc={item.uc} v130={item.uc._v130 || null} valueEstimate={valueEstimate} databricksHost={databricksHost} />
        </UseCaseDrawer>
      )}
      {!built && notebook && <NotebookPanel notebook={notebook} />}
      {uninstalling && (
        <ConfirmDialog title={`Uninstall everything ${item.name || useCaseId} built`} confirmLabel={`Uninstall ${item.name || useCaseId}`} useCaseId={useCaseId} busy={submitBusy}
          onCancel={() => setUninstalling(false)} onConfirm={uninstallAll}>
          <p>
            Inspire deletes the MVP notebook, its job, the build jobs of every version, the dashboard, the Genie Agent, the App, the alert, the App&apos;s Lakebase copy and every version kept live, in a new version of this MVP. A build job that is still running stays until its run ends, and Inspire says so.
          </p>
          <p>The result tables, the history and any notebook Discover wrote for this use case stay. An App, dashboard or Genie Agent that other use cases share stays for them, and Inspire takes this use case&apos;s part out of it.</p>
          {sharingUseCases.length > 0 && (
            <div data-uninstall-shared="" className="space-y-1">
              <p className="font-semibold">Uninstalling this use case also uninstalls the use cases that share its App:</p>
              <ul className="list-disc ps-5">{sharingUseCases.map((u) => <li key={`${u.session_id}|${u.use_case_id}`}>{u.name || u.use_case_id}</li>)}</ul>
              <p>Confirming uninstalls all of them.</p>
            </div>
          )}
        </ConfirmDialog>
      )}
      {statusError && (
        <PlainMessage text={`Inspire could not read how this build is going: ${statusError}`} role="alert" data-status-error="" className={`${ERROR_BOX} shrink-0`}
          onRetry={() => loadStatus().catch((e) => setStatusError(e.message))} copy actions={diagnostics?.actions} />
      )}
      {error && !built && <PlainMessage text={error} className={ERROR_BOX} copy />}
      {notice && <p role="status" className={`${NOTE_BOX} shrink-0`}>{notice}</p>}
      {built && (
        <>
          {error && !cardFailed && !features && !drawerTile && <PlainMessage text={error} className={`${ERROR_BOX} shrink-0`} copy actions={diagnostics?.actions} />}
          {collectError && <PlainMessage text={collectError} className={`${ERROR_BOX} shrink-0`} />}
          {tileRow}
          {!readOnly && <ReportedIssues issues={issues} locked={locked ? lockedReason || 'Wait for this run to finish' : ''} onDraft={openFeatures} />}
          <MvpProgress useCaseId={useCaseId} stages={stages} summary={progress} chip={chip} reason={reason} reasonDetails={missing.length || edited ? '' : statusDetails(latest)} toneClass={toneClass} version={latest?.spec_version} sorted={sorted}
            stop={stop} logRef={logRef} view={progressView} warnings={statusWarnings(latest).length} attention={needsAttention ? attention : null}
            diagnostics={diagnostics}>
            <VibeChecklist checklist={checklist} assets={latest?.asset_status} readOnly={readOnly} locked={locked} lockedReason={lockedReason} busy={submitBusy}
              onSendAgain={buildAgain && !terminal ? () => sendAgain() : undefined} onEdit={onEdit ? () => openFeatures() : undefined} />
            <StageNotes stages={stages} />
            <ScopeNotes scope={scope} />
            <NothingToActCard run={money?.run} />
            <section aria-label="Genie's build messages">
              <GenieFeed feed={status ? status.feed || [] : null} arrivals={arrivals} active={progress.active} working={progress.headline} scroller={logRef} />
            </section>
          </MvpProgress>
        </>
      )}
      {drawerTile && built && (
        <DrawerShell label={`${drawerTile.label}: ${item.name}`} closeLabel={`Close the ${drawerTile.label}`} onClose={() => setDrawer(null)} data-mvp-panel={drawer}
          title={(
            <>
              <h2 className="text-base font-bold text-text-primary">{drawerTile.label}</h2>
              <p className="text-[12px] text-text-secondary">{item.name} · versions, settings and controls</p>
            </>
          )}>
          <div className="space-y-4">
            {error && !cardFailed && <PlainMessage text={error} className={ERROR_BOX} copy actions={diagnostics?.actions} />}
            {drawerBody()}
          </div>
        </DrawerShell>
      )}
      {features && !readOnly && built && (
        <VibeFeatures key={features.at} name={item.name} entries={vibes} assets={pickable} seed={features.seed} active={active} busy={submitBusy}
          error={rebuildError || error} built={builtOn} choices={choices} previous={previous} blocked={rebuildBlocked}
          onPrevious={setPrevious} onAdd={addFeature} onDrop={dropAsk} onRemoveAsk={removeAsk} onRebuild={rebuild} onOpenSettings={onEdit ? openSettings : null} onClose={closeFeatures} />
      )}
    </div>
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
