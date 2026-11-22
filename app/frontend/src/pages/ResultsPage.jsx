import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Loader2,
  AlertCircle,
  Search,
  ChevronRight,
  FileText,
  BarChart3,
  Target,
  Filter,
  Download,
  Database,
  Server,
  RefreshCw,
  Heart,
  Calendar,
  Building2,
  Layers,
  CheckCircle2,
  Copy,
  Check,
  FolderOpen,
  Eye,
  EyeOff,
  ExternalLink,
  Users,
  Crown,
  Wrench,
  LayoutGrid,
  Sparkles,
  Compass,
  Flag,
  Star,
  ShieldAlert,
  Boxes,
  AlertTriangle,
  XCircle,
  Archive,
} from 'lucide-react';
import GlassCard from '../components/GlassCard';
import DomainSunburst from '../components/DomainSunburst';
import PriorityHeatmap from '../components/PriorityHeatmap';
import { SkeletonCard, SkeletonStats } from '../components/SkeletonLoader';
import { DataAccessBadge, InsightsGrid, SidebarFilterPanel } from '../components/ResultsInsights';
import { usePortfolio } from '../components/PortfolioCards';
import UseCaseCard from '../components/UseCaseCard';
import ValueBadge from '../components/ValueBadge';
import { EstimateTotals } from '../components/ValueEstimateLine';
import { RunValuePanel } from '../components/ValueTotalsPanel';
import { valueQuery } from '../lib/valueLedger';
import { useValueRead } from '../lib/useValueLedger';
import LatestRunBadge from '../components/LatestRunBadge';
import { executiveSummaryOf, runBusiness, runDate, runFigureParts, runFiguresOf, runsNewestFirst, latestRunId } from '../lib/reviewFigures';
import {
  NOT_ALIGNED_FILTER,
  compareBestOfBestFirst,
  knownPriorities,
  kpiFilterOptions,
  KPI_FROM_STRATEGY,
  latestFeedbackMap,
  matchesKpiFilter,
  matchesStrategyFilter,
  priorityMatches,
  strategyContext,
  strategyFilterOptions,
  strategyLevelFilters,
  STRATEGY_NOT_TIED,
} from '../lib/v130UseCase';
import {
  FAVORITES_STORAGE_KEY,
  PRIORITY_ORDER,
  priorityRank,
  beneficiaryFromUc,
  cardTitlesOfUseCase,
  computeHighPriorityCount,
  isHighPriority,
  priorityTierOf,
  displayCleanText,
  expandWorkspaceListCandidates,
  inspireScoreFromUc,
  loadFavoritesMap,
  favoriteCount,
  favoriteKeyOf,
  fieldOf,
  hasGenieInstruction,
  sponsorFromUc,
  trackingIdOf,
  compareMeetsQualityBarFirst,
  qualityBarCountsOf,
  qualityBarFilterMatches,
  nameOfUseCase,
} from '../lib/useCaseFields';
import { runOutcomeOf } from '../lib/runOutcome';
import { stepBarStagesOf } from '../lib/runStepBar';
import { liveCountText } from '../lib/liveUseCases';
import { saveBlob } from '../lib/download';
import { EXCEL_OLD_FORMAT, EXCEL_UNREADABLE, csvPreview, fileExtension, fileProblemText, sheetPreview, textPreview, visibleArtifactFiles } from '../lib/artifactFiles';
import FilePreview from '../components/FilePreview';
import DocumentActions from '../components/DocumentActions';
import { generationFolder, workspaceNotebookUrl } from '../lib/workspaceLinks';
import ImplementWizard from './ImplementWizard';
import CalculateValueDialog from '../components/CalculateValueDialog';
import ValueBulkPanel, { ValueBulkBar, ValueBulkProgress } from '../components/ValueBulkPanel';
import { useValueBulkRun } from '../lib/valueBulkRun';
import { SKIP_HAS_VALUE, SKIP_NO_TABLE, valueWorker } from '../lib/valueBulk';
import { saveAnswers, tableOfUseCase, useCalculatedValues } from '../lib/calculatedValue';
import { kindFilterLabel, kindFilterOptions, matchesKindFilter } from '../lib/useCaseKind';
import { MVP_FILTERS, START_MVP_LABEL, implementState, mvpFilterMatches, notebookRunEnded, notebookStatus, versionActive } from '../lib/implementWizard';
import { buildUseCaseList } from '../lib/useCaseList';
import { useScoreRefine } from '../lib/useScoreRefine';
import RefineBanner from '../components/RefineBanner';
import { cardAssetLinks, liveAppRenameStale, renameRestyleSpec, trackBuildSubmit } from '../lib/implementControl';
import { ARCHIVE_VIEWS, archiveKeyOf, inArchiveView, loadArchiveMap, toggledArchive } from '../lib/useCaseArchive';
import QualityGateDrops from '../components/QualityGateDrops';
import { makeApiFetch, makeApiPostJson, makeApiPutJson, requestHeaders, responseError } from '../lib/apiClient';
import { INSPIRE_ENTRY, RESULTS_PENDING_TEXT, noResultsText, resultsReadFailure, reviewLinkText } from '../lib/runPages';
import ResultsNav from '../components/results/ResultsNav';
import { DEFAULT_RESULTS_VIEW, searchWithView, viewOfSearch } from '../lib/resultsView';
import ResultsBusiness from '../components/results/ResultsBusiness';
import ResultsAssets from '../components/results/ResultsAssets';
import { sessionFailed, sessionFinished, sessionSucceeded } from '../lib/monitorState';
import { placeholderWords } from '../lib/placeholderWords';
import { reducedMotion } from '../lib/motion';
import { PlainMessage } from '../components/TechnicalDetails';

/* ── Date formatter for session display ── */
function formatSessionDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 16);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return dateStr.slice(0, 16); }
}

/* ── Pipeline stages for execution summary ── */
const PIPELINE_STAGES = [
  'Setup',
  'Business Understanding',
  'Use Case Design',
  'Domain Mapping',
  'Prioritization',
  'Implementation',
  'Executive Readout',
];

import { BuildNextPanel } from '../components/BuildNext';

export default function ResultsPage({
  settings,
  sessionId: propSessionId,
  embedded = false,
  onOpenImplement,
  onSessionChange,
  link = null,
  notice = '',
}) {
  const {
    databricksHost,
    token,
    warehouseId: settingsWarehouseId,
    inspireDatabase: settingsInspireDb,
    notebookPath: settingsNotebookPath,
    serverEnvHasPat,
    showcase = '',
  } = settings;

  // Track settings — update when they arrive from bootstrap
  const [inspireDb, setInspireDb] = useState(settingsInspireDb || '');
  const [warehouseId, setWarehouseId] = useState(settingsWarehouseId || '');
  useEffect(() => { if (settingsInspireDb && !inspireDb) setInspireDb(settingsInspireDb); }, [settingsInspireDb]);
  useEffect(() => { if (settingsWarehouseId && !warehouseId) setWarehouseId(settingsWarehouseId); }, [settingsWarehouseId]);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const latestId = useMemo(() => latestRunId(sessions), [sessions]);
  const [results, setResults] = useState(null);
  // REQ-126: the steps the run recorded, the same rows the Monitor reads; the Review step bar is built from them.
  const [runSteps, setRunSteps] = useState({ session: '', steps: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isProgressive, setIsProgressive] = useState(false);
  const [usecases, setUsecases] = useState(null);
  const linkRef = useRef(link);
  const pendingUseCase = useRef('');
  const [linkNote, setLinkNote] = useState('');

  /** Re-run artifact list when session or resolved generation folder changes (not blocked by empty prior list). */
  const lastArtifactsLoadKeyRef = useRef('');

  // Filters & sort
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDomain, setFilterDomain] = useState('all');
  const [filterSubdomain, setFilterSubdomain] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterTechnique, setFilterTechnique] = useState('all');
  const [filterKind, setFilterKind] = useState('all');
  const [filterQuality, setFilterQuality] = useState('all');
  const [filterBeneficiary, setFilterBeneficiary] = useState('all');
  const [filterSponsor, setFilterSponsor] = useState('all');
  /** `all` | `yes` | `no` — filter by presence of Genie Code instruction on the use case. */
  const [filterHasGenie, setFilterHasGenie] = useState('all');
  const [filterQualityBar, setFilterQualityBar] = useState('all');
  const [filterMvp, setFilterMvp] = useState('all');
  const [filterStrategy, setFilterStrategy] = useState('all');
  const [filterBizPriority, setFilterBizPriority] = useState('all');
  const [filterLevels, setFilterLevels] = useState({});
  const [filterKpi, setFilterKpi] = useState('all');
  const [sortBy, setSortBy] = useState('inspire');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showBestOfBestOnly, setShowBestOfBestOnly] = useState(false);

  // Favorites — browser localStorage, keyed by content fingerprint (works across sessions)
  const [favorites, setFavorites] = useState(loadFavoritesMap);
  const toggleFavorite = useCallback((uc) => {
    const id = favoriteKeyOf(uc);
    if (!id) return;
    setFavorites((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      } catch { /* quota / private mode */ }
      return next;
    });
  }, []);

  // Archive: browser localStorage, keyed by run and use case id; archived use cases leave the Active list
  const [archiveView, setArchiveView] = useState('active');
  const [archived, setArchived] = useState(loadArchiveMap);
  const toggleArchive = useCallback((key) => setArchived((prev) => toggledArchive(prev, key)), []);

  const [feedbackState, setFeedbackState] = useState({ available: null, latest: [], message: '' });
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  const [feedbackBusyKey, setFeedbackBusyKey] = useState('');
  const [feedbackError, setFeedbackError] = useState({ key: '', message: '' });

  // Artifacts state — tree-based with expandable folders
  const [artifactTree, setArtifactTree] = useState({}); // { [path]: { files: [], loading, error } }
  const [artifactsRootFiles, setArtifactsRootFiles] = useState(null);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);
  /** Quick Access — Genie notebooks list: collapsed by default to save vertical space */
  const [genieQuickAccessExpanded, setGenieQuickAccessExpanded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState({});
  // All notebook file paths discovered from the artifacts tree (for "Open in Databricks" links)
  const [allNotebookFiles, setAllNotebookFiles] = useState([]);
  // File preview state
  const [previewFile, setPreviewFile] = useState(null); // path of currently previewed file
  const [previewFrom, setPreviewFrom] = useState(null);
  const [previewData, setPreviewData] = useState(null); // { type: 'pdf'|'csv', url?, rows?, headers? }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileProblem, setFileProblem] = useState('');
  // Subdomain expansion state
  const [expandedDomains, setExpandedDomains] = useState({});
  // REQ-444: the Domains tree is open by default, on a narrow screen too (there it is a fold above the list).
  const [domainPanelOpen, setDomainPanelOpen] = useState(true);
  // The view (Use cases, Business, Assets) lives in the URL query, so Back, a reload and a shared link land on the same view.
  const [view, setView] = useState(() => viewOfSearch(typeof window !== 'undefined' ? window.location.search : ''));
  const showView = useCallback((next) => {
    setView(next);
    // REQ-444: a view switch lands at the top of the new view, not mid-page where the old one was scrolled.
    window.scrollTo(0, 0);
    const search = searchWithView(window.location.search, next);
    if (search === window.location.search) return;
    const state = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.pushState({ ...state, [INSPIRE_ENTRY]: true }, '', `${window.location.pathname}${search}${window.location.hash}`);
  }, []);
  useEffect(() => {
    const onPop = () => setView(viewOfSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Leaving Results leaves its view behind: ?view= belongs to this page only.
      const search = searchWithView(window.location.search, DEFAULT_RESULTS_VIEW);
      if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    };
  }, []);
  const [beneficiaryPanelOpen, setBeneficiaryPanelOpen] = useState(false);
  const [sponsorPanelOpen, setSponsorPanelOpen] = useState(false);
  const [strategyPanelOpen, setStrategyPanelOpen] = useState(false);
  const [bizPriorityPanelOpen, setBizPriorityPanelOpen] = useState(false);
  const [levelPanelOpen, setLevelPanelOpen] = useState({});
  const [kpiPanelOpen, setKpiPanelOpen] = useState(false);
  // Only one card expanded at a time
  const [expandedUseCase, setExpandedUseCase] = useState(null);
  const [implementUc, setImplementUc] = useState(null);
  const [implementFocus, setImplementFocus] = useState(null);
  const [implementView, setImplementView] = useState({ latest: [], notebook_run: null });
  const [implementRefresh, setImplementRefresh] = useState(0);
  const lastNotebookRun = useRef(null);

  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const apiPostJson = useMemo(() => makeApiPostJson({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const apiPutJson = useMemo(() => makeApiPutJson({ token, databricksHost, showcase }), [token, databricksHost, showcase]);

  const [portfolioTick, setPortfolioTick] = useState(0);
  const { portfolio } = usePortfolio(apiFetch, inspireDb, warehouseId, portfolioTick);
  const runValueUrl = selectedSessionId && inspireDb && warehouseId && !showcase
    ? `/api/inspire/value?${valueQuery(inspireDb, warehouseId, { session_id: String(selectedSessionId) })}`
    : '';
  const runValue = useValueRead(apiFetch, runValueUrl, implementRefresh);
  const estimateUrl = runValueUrl ? runValueUrl.replace('/api/inspire/value?', '/api/inspire/value/estimates?') : '';
  const estimates = useValueRead(apiFetch, estimateUrl, implementRefresh);
  const yearlyUrl = runValueUrl ? runValueUrl.replace('/api/inspire/value?', '/api/inspire/value/yearly?') : '';
  const measuredYearly = useValueRead(apiFetch, yearlyUrl, implementRefresh);
  // REQ-438/439: one read for the card statuses and the run panel; a saved value bumps valueTick so both refresh.
  const [valueTick, setValueTick] = useState(0);
  const totalsUrl = runValueUrl ? runValueUrl.replace('/api/inspire/value?', '/api/inspire/value/totals?') : '';
  const valueTotals = useValueRead(apiFetch, totalsUrl, implementRefresh * 1000 + valueTick);

  const resultsDiscoveryType = results?.discovery_type || '';
  const feedbackBusiness = useMemo(() => {
    return runBusiness(sessions.find((s) => String(s.session_id) === String(selectedSessionId)));
  }, [sessions, selectedSessionId]);
  useEffect(() => {
    const business = feedbackBusiness;
    if (!resultsDiscoveryType || !inspireDb || !warehouseId || !business) {
      setFeedbackState({ available: null, latest: [], message: '' });
      return undefined;
    }
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDb, warehouse_id: warehouseId, business_name: business });
    apiFetch(`/api/inspire/feedback?${q}`)
      .then((data) => {
        if (!cancelled) setFeedbackState({ available: !!data.available, latest: data.latest || [], message: data.message || '' });
      })
      .catch(() => {
        if (!cancelled) setFeedbackState({ available: null, latest: [], message: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [resultsDiscoveryType, feedbackBusiness, inspireDb, warehouseId, apiFetch, feedbackRefresh]);

  const submitFeedback = useCallback(
    async (uc, info, status, reason) => {
      if (!selectedSessionId || !inspireDb || !warehouseId || !info?.useCaseKey) return;
      setFeedbackBusyKey(info.useCaseKey);
      setFeedbackError({ key: '', message: '' });
      try {
        await apiPostJson('/api/inspire/feedback', {
          inspire_database: inspireDb,
          warehouse_id: warehouseId,
          session_id: String(selectedSessionId),
          use_case_key: info.useCaseKey,
          use_case_id: String(uc?.catalog_no || uc?.No || ''),
          use_case_title: nameOfUseCase(uc),
          status,
          reason,
        });
        setFeedbackRefresh((n) => n + 1);
      } catch (err) {
        const message = String(err?.message || err);
        if (err?.status === 409) setFeedbackState((prev) => ({ ...prev, available: false }));
        setFeedbackError({ key: info.useCaseKey, message, note: Boolean(err?.showcase) });
      } finally {
        setFeedbackBusyKey('');
      }
    },
    [selectedSessionId, inspireDb, warehouseId, apiPostJson]
  );

  /** Re-fetch `__inspire_usecases` rows (e.g. after Genie generation) without reloading results/artifacts. */
  const refreshUsecasesForSession = useCallback(
    async (sid) => {
      if (!sid || !inspireDb || !warehouseId) return;
      const q = new URLSearchParams({
        inspire_database: inspireDb,
        warehouse_id: warehouseId,
        session_id: String(sid),
      });
      try {
        const ucData = await apiFetch(`/api/inspire/usecases?${q}`);
        setUsecases(ucData.usecases?.length > 0 ? ucData.usecases : null);
      } catch {
        /* silent — optional manual refresh still available */
      }
    },
    [apiFetch, inspireDb, warehouseId]
  );

  const updateLiveApp = useCallback(
    async (uc) => {
      const id = String(uc?.No ?? '');
      const q = new URLSearchParams({ inspire_database: inspireDb, warehouse_id: warehouseId, session_id: String(selectedSessionId), use_case_id: id });
      const data = await apiFetch(`/api/inspire/implement/history?${q}`);
      const spec = renameRestyleSpec(data.history, id, nameOfUseCase(uc));
      if (!spec) throw new Error('This use case has no built App to update.');
      await trackBuildSubmit(spec, () => apiPostJson('/api/inspire/implement/submit', { spec }));
      setImplementRefresh((n) => n + 1);
    },
    [apiFetch, apiPostJson, inspireDb, warehouseId, selectedSessionId]
  );

  const renameUseCase = useCallback(
    async (uc, name) => {
      await apiPostJson('/api/inspire/usecase-name', {
        inspire_database: inspireDb,
        warehouse_id: warehouseId,
        session_id: String(selectedSessionId),
        use_case_id: String(uc?.No ?? ''),
        name,
      });
      await refreshUsecasesForSession(selectedSessionId);
    },
    [apiPostJson, inspireDb, warehouseId, selectedSessionId, refreshUsecasesForSession]
  );

  const refreshResultsJsonForSession = useCallback(
    async (sid) => {
      if (!sid || !inspireDb || !warehouseId) return;
      const q = new URLSearchParams({
        inspire_database: inspireDb,
        warehouse_id: warehouseId,
        session_id: String(sid),
      });
      try {
        const data = await apiFetch(`/api/inspire/results?${q}`);
        if (!data?.results || typeof data.results !== 'object') return;
        setResults(data.results);
      } catch {
        /* ignore */
      }
    },
    [apiFetch, inspireDb, warehouseId]
  );

  const implementRunning = implementView.notebook_run?.state === 'running'
    || implementView.latest.some((row) => versionActive(row, row.stalled));
  useEffect(() => {
    if (!selectedSessionId || !inspireDb || !warehouseId) {
      setImplementView({ latest: [], notebook_run: null });
      return undefined;
    }
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDb, warehouse_id: warehouseId, session_id: String(selectedSessionId) });
    const load = () => apiFetch(`/api/inspire/implement/history?${q}`)
      .then((data) => { if (!cancelled) setImplementView({ latest: data.latest || [], notebook_run: data.notebook_run || null }); })
      .catch(() => {});
    load();
    const timer = implementRunning ? setInterval(load, 15000) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [selectedSessionId, inspireDb, warehouseId, apiFetch, implementRefresh, implementRunning]);

  useEffect(() => {
    const run = implementView.notebook_run;
    const prev = lastNotebookRun.current;
    lastNotebookRun.current = run;
    if (!selectedSessionId || !notebookRunEnded(prev, run)) return;
    void refreshResultsJsonForSession(selectedSessionId).then(() => refreshUsecasesForSession(selectedSessionId));
  }, [implementView.notebook_run, selectedSessionId, refreshResultsJsonForSession, refreshUsecasesForSession]);

  useEffect(() => {
    if (selectedSessionId) onSessionChange?.(String(selectedSessionId));
  }, [selectedSessionId, onSessionChange]);

  // REQ-427: which assets each use case has (from the tracking rows) and its DBUs (a separate read, so the flags never wait on billing).
  const [assetFlags, setAssetFlags] = useState(null);
  const [dbuRead, setDbuRead] = useState(null);
  useEffect(() => {
    setAssetFlags(null);
    setDbuRead(null);
    // The demo has no tracking table and no billing rows (scripts/showcaseRoutes.mjs NOT_IN_DEMO), so it sends neither read.
    if (!selectedSessionId || !inspireDb || !warehouseId || showcase) return undefined;
    let cancelled = false;
    const q = new URLSearchParams({ inspire_database: inspireDb, warehouse_id: warehouseId, session_id: String(selectedSessionId) });
    apiFetch(`/api/inspire/implement/usecase-assets?${q}`).then((data) => { if (!cancelled) setAssetFlags(data.use_cases || {}); }).catch(() => {});
    apiFetch(`/api/inspire/implement/usecase-dbus?${q}`).then((data) => { if (!cancelled) setDbuRead(data); })
      .catch(() => { if (!cancelled) setDbuRead({ state: 'error', use_cases: {} }); });
    return () => { cancelled = true; };
  }, [selectedSessionId, inspireDb, warehouseId, apiFetch, implementRefresh, showcase]);

  const implementLatestById = useMemo(
    () => Object.fromEntries(implementView.latest.map((row) => [String(row.use_case_id), row])),
    [implementView.latest],
  );
  const mvpStateOf = (uc) => {
    const tid = trackingIdOf(uc);
    return tid ? implementState(implementLatestById[tid] || null) : null;
  };

  // ── Auto-load sessions when settings are available ──
  const [autoLoaded, setAutoLoaded] = useState(false);
  useEffect(() => {
    if (autoLoaded || !inspireDb || !warehouseId) return;
    setAutoLoaded(true);
    handleLoadSessions(true);
    if (linkRef.current) openLinkedRun(linkRef.current);
  }, [inspireDb, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLinkedRun = async (linked) => {
    if (!linked.valid) {
      setLinkNote(reviewLinkText(linked, inspireDb));
      return;
    }
    setSelectedSessionId(linked.sessionId);
    pendingUseCase.current = linked.useCaseId;
    const outcome = await loadResults(linked.sessionId);
    if (outcome !== 'found') pendingUseCase.current = '';
    if (outcome === 'missing' || outcome === 'denied') setSelectedSessionId(null);
  };

  const handleLoadSessions = async (autoLoad = false) => {
    if (!inspireDb || !warehouseId) return;
    if (!autoLoad) setPortfolioTick((n) => n + 1);
    setSessionsLoading(true);
    setSessionsError('');
    try {
      const q = new URLSearchParams({
        inspire_database: inspireDb,
        warehouse_id: warehouseId,
        all: '1', // REQ-444: the same list Start counts, not its first 20
      });
      const data = await apiFetch(`/api/inspire/sessions?${q}`);
      const loadedSessions = data.sessions || [];
      setSessions(loadedSessions);
      setSessionsLoaded(true);

      if (loadedSessions.length === 0) return; // show "no sessions" message

      // Auto-select & auto-load results ONLY on mount auto-load
      if (autoLoad && !linkRef.current) {
        const completed = loadedSessions.find(sessionSucceeded);
        const target = propSessionId
          ? loadedSessions.find((s) => String(s.session_id) === String(propSessionId))
          : completed;
        if (target) {
          setSelectedSessionId(target.session_id);
          // Don't await — let it run and update loading/results independently
          loadResults(target.session_id, target);
        }
      }
    } catch (err) {
      setSessionsError(err.message || 'Inspire could not load the runs.');
      console.warn('Failed to load sessions:', err.message);
    } finally {
      setSessionsLoading(false);
    }
  };

  const loadResults = async (sid, run = sessions.find((s) => String(s.session_id) === String(sid))) => {
    setLoading(true);
    setError('');
    setResults(null);
    setUsecases(null);
    setIsProgressive(false);
    setArtifactsRootFiles(null);
    setArtifactTree({});
    setAllNotebookFiles([]);
    setPreviewFile(null);
    setPreviewFrom(null);
    setPreviewData(null);
    setArtifactsExpanded(false);
    setFilterStrategy('all');
    setFilterBizPriority('all');
    lastArtifactsLoadKeyRef.current = '';
    try {
      const q = new URLSearchParams({
        inspire_database: inspireDb,
        warehouse_id: warehouseId,
      });
      if (sid) q.set('session_id', sid);
      if (sid) {
        const stepSession = String(sid);
        apiFetch(`/api/inspire/steps?${q}`)
          .then((d) => setRunSteps({ session: stepSession, steps: Array.isArray(d?.steps) ? d.steps : [] }))
          .catch(() => setRunSteps({ session: stepSession, steps: [] }));
      }

      // Try final results_json first
      const data = await apiFetch(`/api/inspire/results?${q}`);
      if (data.results) {
        // Await usecases before committing results so the first paint includes notebook_path / genie fields from __inspire_usecases when present.
        let loadedUsecases = null;
        try {
          const ucData = await apiFetch(`/api/inspire/usecases?${q}`);
          if (ucData.usecases?.length > 0) loadedUsecases = ucData.usecases;
        } catch { /* silent */ }
        setResults(data.results);
        setUsecases(loadedUsecases);
        return 'found';
      }
      if (sid && data.found === false) {
        setError(reviewLinkText({ sessionId: String(sid), valid: true }, inspireDb, 'missing'));
        return 'missing';
      }

      // No final results — try progressive results from __inspire_step
      const stepData = await apiFetch(`/api/inspire/step-results?${q}`);
      if (stepData.results && stepData.results._use_case_count > 0) {
        let loadedUsecases = null;
        try {
          const ucData = await apiFetch(`/api/inspire/usecases?${q}`);
          if (ucData.usecases?.length > 0) loadedUsecases = ucData.usecases;
        } catch { /* silent */ }
        setResults(stepData.results);
        setUsecases(loadedUsecases);
        setIsProgressive(true);
        return 'found';
      }

      setError(noResultsText(run, { inMonitor: embedded }));
      return 'pending';
    } catch (err) {
      const failure = resultsReadFailure(err, { sid, inspireDb });
      setError(failure.message);
      return failure.outcome;
    } finally {
      setLoading(false);
    }
  };

  // ── Extract use cases (defensive — guard against non-array shapes) ──
  const builtUseCases = useMemo(() => buildUseCaseList(results, usecases), [results, usecases]);
  const [calcFor, setCalcFor] = useState(null);
  const [bulkPicked, setBulkPicked] = useState(() => new Set());
  const bulkRun = useValueBulkRun();
  const calculated = useCalculatedValues({ apiFetch: showcase ? null : apiFetch, apiPostJson, apiPutJson, inspireDatabase: inspireDb, warehouseId, sessionId: selectedSessionId });
  const valuesForDialog = useMemo(() => ({
    ...calculated,
    run: async (...a) => { const got = await calculated.run(...a); setValueTick((n) => n + 1); return got; },
    undo: async (...a) => { const got = await calculated.undo(...a); setValueTick((n) => n + 1); return got; },
  }), [calculated]);
  // REQ-443: a row of the run for this session that turns done puts its reply into the cards, once per reply; on remount the replies are put in again.
  const absorbed = useRef(new WeakSet());
  const bulkHere = bulkRun.run && bulkRun.run.sessionId === String(selectedSessionId ?? '') ? bulkRun.run : null;
  useEffect(() => {
    if (!bulkHere) return;
    let any = false;
    for (const r of bulkHere.rows) {
      const got = r.state === 'done' ? bulkHere.gots[r.id] : null;
      if (got && !absorbed.current.has(got)) { absorbed.current.add(got); calculated.absorb(r.id, got); any = true; }
    }
    if (any) setValueTick((n) => n + 1);
  }, [bulkHere, calculated.absorb]); // eslint-disable-line react-hooks/exhaustive-deps
  const { hide: hideBulk } = bulkRun;
  useEffect(() => () => hideBulk(), [hideBulk]);
  const scrollToCard = useCallback((id) => {
    const el = document.querySelector(`[data-use-case-no="${String(id).replace(/"/g, '')}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    el.setAttribute('data-value-pulse', 'on');
    el.animate?.([{ boxShadow: '0 0 0 0 rgba(217,46,27,.5)' }, { boxShadow: '0 0 0 16px rgba(217,46,27,0)' }], { duration: 1400 });
    setTimeout(() => el.removeAttribute('data-value-pulse'), 1400);
  }, []);
  // A row of the run's value leads to its card, which only exists in the Use cases view.
  const onRunValueRow = (id) => {
    showView('usecases');
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToCard(id)));
  };
  const yearlyOf = useCallback((id) => {
    const y = calculated.byId[id]?.yearly || measuredYearly?.use_cases?.[id] || null;
    // A shape-2 value carries its total, not entries; the score refine reads entries.
    return y && !y.entries && y.total ? { ...y, entries: [{ kind: 'money', unit: y.total.unit, amount: y.total.amount }] } : y;
  }, [calculated.byId, measuredYearly]);
  const { list: allUseCases, banner: refineBanner, undoCard: undoRefinedCard } = useScoreRefine({ useCases: builtUseCases, yearlyOf, apiPostJson, host: settings?.databricksHost,
    inspireDatabase: inspireDb, warehouseId, sessionId: selectedSessionId });
  const qualityBarCounts = useMemo(() => qualityBarCountsOf(allUseCases), [allUseCases]);
  const runOutcome = runOutcomeOf(results, qualityBarCounts);
  const reviewBarStages = useMemo(() => stepBarStagesOf(PIPELINE_STAGES,
    runSteps.session === String(selectedSessionId ?? '') ? runSteps.steps : []), [runSteps, selectedSessionId]);
  const noneMeetsBar = qualityBarCounts.found > 0 && qualityBarCounts.meets === 0;
  const bizPriorities = useMemo(() => knownPriorities(results), [results]);
  const strategy = useMemo(() => strategyContext(results), [results]);

  // ── Resolve table from registry ──
  const tableRegistry = results?.table_registry;
  const resolveTable = useCallback((id) => {
    if (!tableRegistry || !id) return id;
    return tableRegistry[id] || id;
  }, [tableRegistry]);

  // ── Filter & sort ──
  let filteredUseCases = [];
  try {
    filteredUseCases = allUseCases
      .filter((uc) => {
        if (!uc || typeof uc !== 'object') return false;
        if (filterDomain !== 'all' && uc._domain !== filterDomain) return false;
        if (filterSubdomain !== 'all' && String(uc.Subdomain || '') !== filterSubdomain) return false;
        if (filterPriority !== 'all' && priorityTierOf(uc) !== filterPriority)
          return false;
        if (filterType !== 'all' && uc.type !== filterType) return false;
        if (filterTechnique !== 'all' && String(fieldOf(uc, 'Analytics Technique', 'analytics_technique') || '') !== filterTechnique) return false;
        if (!matchesKindFilter(uc._v130?.kind, filterKind)) return false;
        if (filterQuality !== 'all' && String(uc.Quality || '') !== filterQuality) return false;
        if (filterBeneficiary !== 'all' && beneficiaryFromUc(uc) !== filterBeneficiary) return false;
        if (filterSponsor !== 'all' && sponsorFromUc(uc) !== filterSponsor) return false;
        if (filterStrategy !== 'all' && !matchesStrategyFilter(uc._v130, filterStrategy)) return false;
        if (!Object.values(filterLevels).every((value) => matchesStrategyFilter(uc._v130, value))) return false;
        if (!matchesKpiFilter(uc._v130, filterKpi)) return false;
        if (filterBizPriority !== 'all' && !priorityMatches(uc._v130?.priorityText, bizPriorities).includes(filterBizPriority)) return false;
        if (filterHasGenie === 'yes' && !hasGenieInstruction(uc)) return false;
        if (filterHasGenie === 'no' && hasGenieInstruction(uc)) return false;
        if (!qualityBarFilterMatches(filterQualityBar, uc)) return false;
        if (!mvpFilterMatches(filterMvp, mvpStateOf(uc))) return false;
        if (searchQuery) {
          const q = searchQuery.trim().toLowerCase();
          const shown = cardTitlesOfUseCase(uc);
          return [uc.Name, shown.title, shown.subtitle, uc.Statement, uc.Solution, fieldOf(uc, 'Business Value', 'business_value'),
            beneficiaryFromUc(uc), sponsorFromUc(uc), uc._domain, uc.Subdomain, fieldOf(uc, 'Analytics Technique', 'analytics_technique')]
            .some((text) => String(text || '').toLowerCase().includes(q));
        }
        return true;
      })
      .sort((a, b) => {
        const chosen = sortBy === 'domain' ? String(a._domain || '').localeCompare(String(b._domain || ''))
          : sortBy === 'name' ? nameOfUseCase(a).localeCompare(nameOfUseCase(b))
            : sortBy === 'priority' ? priorityRank(priorityTierOf(a)) - priorityRank(priorityTierOf(b)) : 0;
        if (chosen !== 0) return chosen;
        const meetsFirst = compareMeetsQualityBarFirst(a, b);
        if (meetsFirst !== 0) return meetsFirst;
        const starred = compareBestOfBestFirst(a._v130, b._v130);
        if (starred !== 0) return starred;
        const sa = inspireScoreFromUc(a) ?? -Infinity;
        const sb = inspireScoreFromUc(b) ?? -Infinity;
        if (sb !== sa) return sb - sa;
        return nameOfUseCase(a).localeCompare(nameOfUseCase(b));
      });
  } catch (err) {
    console.error('Error filtering/sorting use cases:', err);
    filteredUseCases = allUseCases;
  }

  if (showBestOfBestOnly) {
    filteredUseCases = filteredUseCases.filter((uc) => uc?._v130?.bestOfBest);
  }
  const starredCount = allUseCases.filter((uc) => uc?._v130?.bestOfBest).length;

  const isArchivedUc = (uc) => Boolean(archived[archiveKeyOf(selectedSessionId, uc)]);
  const archivedCount = allUseCases.filter(isArchivedUc).length;
  const archiveCounts = { active: allUseCases.length - archivedCount, archived: archivedCount };
  filteredUseCases = filteredUseCases.filter((uc) => inArchiveView(archiveView, isArchivedUc(uc)));

  // Apply favorites filter
  if (showFavoritesOnly) {
    filteredUseCases = filteredUseCases.filter((uc) => {
      const k = favoriteKeyOf(uc);
      return k && favorites[k];
    });
  }
  // REQ-441: pick cards and calculate their value from the defaults. Not in the demo (no ledger) and not without a database and warehouse.
  const bulkOn = !showcase && Boolean(inspireDb && warehouseId && selectedSessionId);
  // REQ-444: a selection belongs to the run it was made in; changing the run clears it, so a bulk action never sends another run's ids.
  useEffect(() => { setBulkPicked(new Set()); }, [selectedSessionId]);
  const bulkIds = filteredUseCases.map((uc) => trackingIdOf(uc)).filter((id) => id && bulkPicked.has(id));
  const setBulkPick = (id, on) => setBulkPicked((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const startBulk = () => {
    const picked = new Set(bulkIds);
    const items = filteredUseCases.filter((uc) => picked.has(trackingIdOf(uc))).map((uc) => {
      const id = trackingIdOf(uc);
      const table = tableOfUseCase(uc);
      return { id, name: nameOfUseCase(uc), table, skip: calculated.byId[id] ? SKIP_HAS_VALUE : !table ? SKIP_NO_TABLE : '' };
    });
    const where = { inspireDatabase: inspireDb, warehouseId, sessionId: selectedSessionId };
    bulkRun.start({ sessionId: selectedSessionId, items, worker: valueWorker({ apiPostJson, ...where, save: (id, table, answers) => saveAnswers(apiPutJson, where, id, table, answers) }) });
  };
  const cardKeys = new Map();
  const usedCardKeys = new Set();
  for (const [idx, uc] of filteredUseCases.entries()) {
    const base = cardKeyOf(uc, idx);
    const key = usedCardKeys.has(base) ? `${base}#${idx}` : base;
    usedCardKeys.add(key);
    cardKeys.set(uc, key);
  }

  const domains = [
    ...new Set(allUseCases.map((uc) => uc?._domain).filter(Boolean)),
  ];
  const priorities = [
    ...new Set(allUseCases.map(priorityTierOf).filter(Boolean)),
  ];
  const types = [
    ...new Set(allUseCases.map((uc) => uc?.type).filter(Boolean)),
  ];
  const techniques = [
    ...new Set(allUseCases.map((uc) => fieldOf(uc, 'Analytics Technique', 'analytics_technique')).filter(Boolean)),
  ];
  const kindOptions = kindFilterOptions(allUseCases.map((uc) => uc?._v130?.kind));
  const qualities = [
    ...new Set(allUseCases.map((uc) => uc?.Quality).filter(Boolean)),
  ];

  const beneficiaries = [
    ...new Set(allUseCases.map(beneficiaryFromUc).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const sponsors = [
    ...new Set(allUseCases.map(sponsorFromUc).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  const beneficiaryCounts = {};
  for (const uc of allUseCases) {
    const b = beneficiaryFromUc(uc);
    if (b) beneficiaryCounts[b] = (beneficiaryCounts[b] || 0) + 1;
  }
  const sponsorCounts = {};
  for (const uc of allUseCases) {
    const s = sponsorFromUc(uc);
    if (s) sponsorCounts[s] = (sponsorCounts[s] || 0) + 1;
  }

  const v130Session = !!(results && (results.discovery_type || results.strategy_coverage));
  const strategyFilter = strategyFilterOptions(allUseCases.map((uc) => uc?._v130), results?.strategy_coverage?.entries);
  const strategyOptions = strategyFilter.notAligned > 0 && strategy.hasEntries
    ? [...strategyFilter.options, { value: NOT_ALIGNED_FILTER, label: STRATEGY_NOT_TIED, count: strategyFilter.notAligned, depth: 0 }]
    : strategyFilter.options;
  const levelFilters = strategyLevelFilters(allUseCases.map((uc) => uc?._v130), results?.strategy_coverage?.entries, strategy);
  if (levelFilters.length && strategyFilter.notAligned > 0 && strategy.hasEntries) {
    levelFilters[0].options.push({ value: NOT_ALIGNED_FILTER, label: STRATEGY_NOT_TIED, count: strategyFilter.notAligned, depth: 0 });
  }
  const kpiOptions = strategy.levelNames.length ? kpiFilterOptions(allUseCases.map((uc) => uc?._v130)) : [];
  const bizPriorityCounts = {};
  let bizPriorityUseCases = 0;
  for (const uc of allUseCases) {
    const matched = priorityMatches(uc?._v130?.priorityText, bizPriorities);
    if (matched.length) bizPriorityUseCases += 1;
    for (const bp of matched) bizPriorityCounts[bp] = (bizPriorityCounts[bp] || 0) + 1;
  }
  const bizPriorityOptions = bizPriorities
    .filter((bp) => bizPriorityCounts[bp])
    .map((bp) => ({ value: bp, label: placeholderWords(bp), count: bizPriorityCounts[bp] }));
  const foundationsList = results?.foundations;
  const foundationsById = useMemo(
    () => new Map((Array.isArray(foundationsList) ? foundationsList : []).map((f) => [String(f.id), f])),
    [foundationsList],
  );
  const useCaseById = new Map();
  for (const uc of allUseCases) {
    for (const id of [uc?.catalog_no, uc?.No, uc?.id]) {
      if (id != null && String(id).trim() && !useCaseById.has(String(id).trim())) useCaseById.set(String(id).trim(), uc);
    }
  }
  const describeUseCase = (id) => {
    const uc = useCaseById.get(String(id ?? '').trim());
    return uc
      ? { name: nameOfUseCase(uc) || id, domain: String(uc._domain || ''), score: inspireScoreFromUc(uc), useCase: uc.No ? uc : null }
      : null;
  };
  const feedbackLatest = useMemo(() => latestFeedbackMap(feedbackState.latest), [feedbackState.latest]);

  // Compute subdomain counts by domain
  const subdomainsByDomain = {};
  for (const uc of allUseCases) {
    const d = uc?._domain || 'Unknown';
    const sd = String(uc?.Subdomain || '');
    if (!sd) continue;
    if (!subdomainsByDomain[d]) subdomainsByDomain[d] = {};
    subdomainsByDomain[d][sd] = (subdomainsByDomain[d][sd] || 0) + 1;
  }

  const techniqueCount = techniques.length;
  const uniqueSubdomainCount = new Set(allUseCases.map((uc) => String(uc?.Subdomain || '').trim()).filter(Boolean)).size;

  let _scoreSum = 0;
  let _scoreN = 0;
  for (const uc of allUseCases) {
    const sc = inspireScoreFromUc(uc);
    if (sc != null && Number.isFinite(sc)) {
      _scoreSum += sc;
      _scoreN += 1;
    }
  }
  const avgInspireScore = _scoreN > 0 ? _scoreSum / _scoreN : null;

  // Compute domain counts for sidebar
  const domainCounts = {};
  for (const uc of allUseCases) {
    const d = uc?._domain || 'Unknown';
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }

  const hasActiveFilters =
    searchQuery ||
    filterDomain !== 'all' ||
    filterSubdomain !== 'all' ||
    filterPriority !== 'all' ||
    filterType !== 'all' ||
    filterTechnique !== 'all' ||
    filterKind !== 'all' ||
    filterQuality !== 'all' ||
    filterBeneficiary !== 'all' ||
    filterSponsor !== 'all' ||
    filterStrategy !== 'all' ||
    filterBizPriority !== 'all' ||
    Object.keys(filterLevels).length > 0 ||
    filterKpi !== 'all' ||
    filterHasGenie !== 'all' ||
    filterQualityBar !== 'all' ||
    filterMvp !== 'all' ||
    showBestOfBestOnly ||
    showFavoritesOnly;

  const clearAllFilters = () => {
    setSearchQuery(''); setFilterDomain('all'); setFilterSubdomain('all');
    setFilterPriority('all'); setFilterType('all'); setFilterTechnique('all'); setFilterKind('all');
    setFilterQuality('all');
    setFilterBeneficiary('all'); setFilterSponsor('all');
    setFilterStrategy('all'); setFilterBizPriority('all');
    setFilterLevels({}); setFilterKpi('all');
    setFilterHasGenie('all');
    setFilterQualityBar('all');
    setFilterMvp('all');
    setShowBestOfBestOnly(false);
    setShowFavoritesOnly(false);
  };

  const openUseCase = (uc) => {
    const no = String(uc?.No ?? '').trim();
    if (!no) return;
    clearAllFilters();
    showView('usecases');
    setArchiveView(isArchivedUc(uc) ? 'archived' : 'active');
    setShowFavoritesOnly(false);
    setExpandedUseCase(cardKeyOf(uc));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('[data-use-case-no]')].find((el) => el.getAttribute('data-use-case-no') === no);
      if (card) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }));
  };

  useEffect(() => {
    const want = pendingUseCase.current;
    if (!want || !results || loading) return;
    pendingUseCase.current = '';
    const uc = allUseCases.find((u) => trackingIdOf(u) === want);
    if (uc) openUseCase(uc);
    else setLinkNote(reviewLinkText(linkRef.current, inspireDb, 'no_use_case'));
  }, [results, loading, allUseCases]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load generation artifacts — tries multiple path variations
  const artifactHeaders = useCallback(() => requestHeaders(token, databricksHost, {}, showcase), [token, databricksHost, showcase]);

  // Recursively scan a folder to discover all file paths (notebooks, PDFs, CSVs, etc.)
  const deepScanFolder = useCallback(async (folderPath) => {
    if (!folderPath) return;
    const headers = artifactHeaders();
    const discovered = [];
    const scan = async (dir) => {
      try {
        const resp = await fetch(`/api/workspace/list?path=${encodeURIComponent(dir)}`, { headers });
        if (!resp.ok) { await responseError(resp); return; }
        const data = await resp.json();
        const files = visibleArtifactFiles(data.files);
        setArtifactTree(prev => ({ ...prev, [dir]: { files, loading: false, error: null } }));
        for (const f of files) {
          if (f.is_directory) {
            await scan(f.path);
          } else {
            discovered.push(f.path);
          }
        }
      } catch { /* silent */ }
    };
    await scan(folderPath);
    // Accumulate — don't replace
    setAllNotebookFiles(prev => [...new Set([...prev, ...discovered])]);
  }, [token, artifactHeaders]);

  const loadArtifacts = useCallback(async (genPath) => {
    if (!genPath) return;
    setArtifactsLoading(true);
    setArtifactsRootFiles(null);
    const headers = artifactHeaders();

    for (const path of expandWorkspaceListCandidates(genPath)) {
      try {
        const resp = await fetch(`/api/workspace/list?path=${encodeURIComponent(path)}`, { headers });
        if (!resp.ok) await responseError(resp.clone());
        if (resp.ok) {
          const data = await resp.json();
          if (data.files && data.files.length > 0) {
            setArtifactsRootFiles(visibleArtifactFiles(data.files));
            setArtifactsExpanded(true);
            setArtifactsLoading(false);
            // Auto-scan ALL subfolders to discover notebook paths and previewable files
            for (const f of data.files) {
              if (f.is_directory) deepScanFolder(f.path);
            }
            return;
          }
        }
      } catch { /* try next */ }
    }
    setArtifactsRootFiles([]);
    setArtifactsLoading(false);
  }, [token, databricksHost, artifactHeaders, deepScanFolder]);

  const loadFolder = useCallback(async (folderPath) => {
    if (!folderPath) return;
    setArtifactTree(prev => ({ ...prev, [folderPath]: { files: [], loading: true, error: null } }));
    const headers = artifactHeaders();
    try {
      const resp = await fetch(`/api/workspace/list?path=${encodeURIComponent(folderPath)}`, { headers });
      const refused = resp.ok ? null : await responseError(resp.clone());
      if (resp.ok) {
        const data = await resp.json();
        setArtifactTree(prev => ({ ...prev, [folderPath]: { files: visibleArtifactFiles(data.files), loading: false, error: null } }));
      } else {
        setArtifactTree(prev => ({ ...prev, [folderPath]: { files: [], loading: false, error: refused.dialog ? null : 'Could not list folder' } }));
      }
    } catch {
      setArtifactTree(prev => ({ ...prev, [folderPath]: { files: [], loading: false, error: 'Network error' } }));
    }
  }, [token, artifactHeaders]);

  const toggleFolder = useCallback((folderPath) => {
    setExpandedFolders(prev => {
      const next = { ...prev, [folderPath]: !prev[folderPath] };
      // Load folder contents if expanding and not yet loaded
      if (next[folderPath] && !artifactTree[folderPath]) {
        loadFolder(folderPath);
      }
      return next;
    });
  }, [artifactTree, loadFolder]);

  const exportedFile = useCallback(async (filePath, fileName, action) => {
    setFileProblem('');
    const resp = await fetch(`/api/workspace/export?path=${encodeURIComponent(filePath)}`, { headers: artifactHeaders() }).catch(() => null);
    const refused = resp && !resp.ok ? await responseError(resp.clone()) : null;
    const blob = resp?.ok ? await resp.blob().catch(() => null) : null;
    if (blob) return blob;
    if (!refused?.dialog) setFileProblem(await fileProblemText(action, fileName, resp?.ok ? null : resp));
    return null;
  }, [artifactHeaders]);

  const downloadFile = useCallback(async (filePath, fileName) => {
    const blob = await exportedFile(filePath, fileName, 'download');
    if (blob) saveBlob(blob, fileName);
  }, [exportedFile]);

  const openFileInTab = useCallback(async (filePath, fileName) => {
    const tab = window.open('', '_blank');
    const blob = await exportedFile(filePath, fileName, 'open');
    if (!blob) {
      tab?.close();
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
  }, [exportedFile]);

  // Toggle inline preview for a file
  const togglePreview = useCallback(async (filePath, fileName, from) => {
    if (previewFile === filePath && previewFrom !== from) {
      setPreviewFrom(from);
      return;
    }
    // Toggle off if same file
    if (previewFile === filePath) {
      if (previewData?.url) URL.revokeObjectURL(previewData.url);
      setPreviewFile(null);
      setPreviewFrom(null);
      setPreviewData(null);
      return;
    }
    setPreviewFile(filePath);
    setPreviewFrom(from);
    setPreviewData(null);
    setPreviewLoading(true);
    const headers = artifactHeaders();
    let resp = null;
    let refusal = null;
    try {
      resp = await fetch(`/api/workspace/export?path=${encodeURIComponent(filePath)}`, { headers });
      if (!resp.ok) { refusal = await responseError(resp.clone()); throw new Error('fetch failed'); }
      const ext = fileExtension({ name: fileName });
      if (ext === 'pdf') {
        const blob = new Blob([await resp.blob()], { type: 'application/pdf' });
        setPreviewData({ type: 'pdf', url: URL.createObjectURL(blob) });
      } else if (ext === 'csv') {
        setPreviewData({ type: 'csv', ...csvPreview(await resp.text()) });
      } else if (ext === 'xlsx') {
        const buf = await resp.arrayBuffer();
        try {
          const { readSheet } = await import('read-excel-file/browser');
          setPreviewData({ type: 'csv', ...sheetPreview(await readSheet(buf)) });
        } catch {
          setPreviewData({ type: 'error', message: EXCEL_UNREADABLE });
        }
      } else if (ext === 'xls') {
        setPreviewData({ type: 'error', message: EXCEL_OLD_FORMAT });
      } else if (ext === 'md' || ext === 'json') {
        setPreviewData(textPreview(ext, await resp.text()));
      }
    } catch {
      if (refusal?.dialog) setPreviewData(null); else setPreviewData({ type: 'error', message: resp?.ok ? `Inspire could not preview ${fileName}: the file could not be read.` : await fileProblemText('preview', fileName, resp) });
    }
    setPreviewLoading(false);
  }, [previewFile, previewFrom, previewData, artifactHeaders]);

  // Find generation path from selected session
  const selectedSession = sessions.find(s => String(s.session_id) === String(selectedSessionId));
  const generationPath = generationFolder({
    generationPath: selectedSession?.generation_path || selectedSession?.widget_values?.generation_path || '',
    notebookPath: settings?.notebookPath || '',
    businessName: runBusiness(selectedSession),
  });

  /** Run heading: the catalog title the agent wrote (`results.title`), else “{business} Use Cases Catalog”. */
  const resultsPageTitle = (() => {
    if (!results) return null;
    if (typeof results.title === 'string' && results.title.trim()) {
      const cleaned = displayCleanText(results.title);
      return cleaned || 'Use Cases Catalog';
    }
    const biz = runBusiness(selectedSession);
    const b = biz ? displayCleanText(biz) : '';
    if (b) return `${b} Use Cases Catalog`;
    return 'Use Cases Catalog';
  })();
  const summaryParagraphs = executiveSummaryOf(results);
  const domainsSummary = typeof results?.domains_summary === 'string' ? results.domains_summary.trim() : '';

  // Auto-load artifacts to discover notebook paths and document previews (server PAT counts as auth)
  useEffect(() => {
    if (!generationPath || showcase) return;
    if (!token && !serverEnvHasPat) return;
    const k = `${selectedSessionId}|${generationPath}`;
    if (lastArtifactsLoadKeyRef.current === k) return;
    lastArtifactsLoadKeyRef.current = k;
    setArtifactTree({});
    setAllNotebookFiles([]);
    console.log('[Inspire] Auto-loading artifacts from:', generationPath);
    loadArtifacts(generationPath);
  }, [generationPath, selectedSessionId, token, serverEnvHasPat, loadArtifacts, showcase]);

  const highPriorityCount = computeHighPriorityCount(allUseCases);
  const hasMvpData = !!(selectedSessionId && inspireDb && warehouseId);
  const canImplement = !showcase && hasMvpData && !isProgressive;
  const selectedFigures = selectedSessionId ? portfolio?.sessions?.[String(selectedSessionId)] || null : null;
  const startImplement = (uc) => { setImplementFocus(null); setImplementUc(uc); };
  const feedbackCurrentFor = (uc) => (uc?._v130?.useCaseKey ? feedbackLatest[uc._v130.useCaseKey] : undefined);
  const detailPropsFor = (uc) => {
    const key = uc?._v130?.useCaseKey;
    return {
      resolveTable,
      databricksHost,
      allNotebookFiles,
      knownPriorities: bizPriorities,
      strategy,
      foundationsById,
      feedbackAvailable: feedbackState.available,
      feedbackBusy: !!key && feedbackBusyKey === key,
      feedbackError: key && feedbackError.key === key ? feedbackError.message : '',
      feedbackNote: Boolean(key && feedbackError.key === key && feedbackError.note),
      feedbackReadOnly: Boolean(showcase),
      onFeedback: (status, reason) => submitFeedback(uc, uc._v130, status, reason),
    };
  };

  return (
    <div
      className={
        embedded
          ? 'px-4 py-4'
          : results
            ? 'max-w-7xl mx-auto px-0 py-2 sm:py-3'
            : 'max-w-7xl mx-auto px-6 py-8'
      }
    >
      {/* Page header — tighter when results are shown so executive summary stays above the fold */}
      {!embedded && (
        <div className={`flex items-center justify-between gap-3 ${results ? 'mb-3' : 'mb-8'}`}>
          <div className={`flex items-center min-w-0 flex-1 ${results ? 'gap-3' : 'gap-4'}`}>
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-surface shadow-sm ${
                results ? 'h-10 w-10' : 'h-12 w-12'
              }`}
            >
              <BarChart3
                size={results ? 20 : 24}
                className="text-db-red-fg"
                strokeWidth={1.75}
                aria-hidden
              />
            </div>
            <div className="min-w-0">
              <h1
                className={`font-bold tracking-[-0.02em] bg-gradient-to-br from-text-primary via-text-primary to-db-red bg-clip-text text-transparent ${
                  results ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'
                }`}
              >
                Review
              </h1>
              {!results && (
                <p className="mt-1 text-sm text-text-secondary sm:text-base">
                  Read the use cases Inspire found for your business.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {!embedded && (notice || linkNote) && (
        <div className="mb-3 space-y-2">
          {notice && <p role="note" data-review-left-demo="" className="text-[12px] text-text-secondary">{notice}</p>}
          {linkNote && <p role="alert" data-review-link-note="" className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-[12px] font-medium text-warning-fg">{linkNote}</p>}
        </div>
      )}
      {!embedded && results && (
        <section aria-label="This run" data-run-heading="" className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">This run</p>
            <h2 className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-text-primary break-words" title={resultsPageTitle || undefined}>
              {resultsPageTitle}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-secondary">
              <span data-run-business="">{runBusiness(selectedSession) || displayCleanText(results.business_name) || 'No business name'}</span>
              {runDate(selectedSession) && <span>· Updated {formatSessionDate(runDate(selectedSession))}</span>}
              <LatestRunBadge session={selectedSession} latest={String(selectedSessionId) === latestId} />
            </p>
            {runValue?.run && (
              <ValueBadge
                atStake={runValue.run.at_stake}
                saved={runValue.run.saved}
                measured={Number(runValue.run.mvps_measured) > 0}
                mvps={Number(runValue.run.mvps_measured) || 0}
                className="mt-2"
              />
            )}
            {!valueTotals?.run && estimates?.totals && <EstimateTotals totals={estimates.totals} className="mt-1" />}
          </div>
          <button
            type="button"
            onClick={() => {
              setResults(null);
              setUsecases(null);
              setError('');
              setExpandedUseCase(null);
              setSelectedSessionId(null);
              setSessionsLoaded(false);
              setIsProgressive(false);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-bg-subtle transition-smooth"
          >
            <RefreshCw size={12} />
            Change run
          </button>
        </section>
      )}
      {!embedded && results && selectedSessionId && inspireDb && warehouseId && (
        <div className="mb-3">
          <BuildNextPanel apiFetch={apiFetch} inspireDatabase={inspireDb} warehouseId={warehouseId} sessionId={selectedSessionId} showcase={Boolean(showcase)}
            onStart={onOpenImplement ? (useCaseId) => onOpenImplement(String(selectedSessionId), useCaseId) : undefined}
            onMeasure={onOpenImplement ? (useCaseId) => onOpenImplement(String(selectedSessionId), useCaseId, 'measure') : undefined} />
        </div>
      )}
      {embedded && filteredUseCases.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={18} className="text-db-red-fg shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="text-sm font-bold text-text-primary">
            {allUseCases.length} Use Cases Generated
          </span>
          <span className="text-xs text-text-tertiary">
            across {domains.length} domain{domains.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* ═══ Loading / Empty state — sessions auto-load from settings ═══ */}
      {!embedded && !results && !loading && (
        <div className="mb-6">
          {/* Loading sessions — animated pipeline illustration */}
          {sessionsLoading && (
            <div className="bg-surface border border-border rounded-xl p-10 text-center">
              <div className="flex items-center justify-center gap-3 mb-6">
                {['Connecting', 'Scanning', 'Loading'].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center animate-pulse"
                        style={{ backgroundColor: 'rgba(255,54,33,0.1)', animationDelay: `${i * 400}ms` }}
                      >
                        {i === 0 && <Database size={18} className="text-db-red-fg" />}
                        {i === 1 && <Search size={18} className="text-db-red-fg" />}
                        {i === 2 && <FileText size={18} className="text-db-red-fg" />}
                      </div>
                      <span className="text-[10px] font-medium text-text-tertiary">{step}</span>
                    </div>
                    {i < 2 && (
                      <div className="w-8 h-px bg-border relative overflow-hidden mb-5">
                        <div className="absolute inset-y-0 start-0 w-1/2 bg-db-red/40 animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ animationDelay: `${i * 500}ms` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-sm font-medium text-text-primary">Fetching your Inspire runs</p>
              <p className="text-xs text-text-tertiary mt-1.5">Connecting to your workspace...</p>
            </div>
          )}

          {/* Error */}
          {!sessionsLoading && sessionsError && (
            <div className="bg-surface border border-error/20 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center shrink-0">
                  <AlertCircle size={20} className="text-error-fg" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text-primary mb-1">Could not load the runs</p>
                  <PlainMessage text={sessionsError} className="text-xs text-text-secondary mb-3" />
                  <button onClick={() => handleLoadSessions(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-db-red-fg bg-db-red-50 border border-db-red/20 rounded-lg hover:bg-db-red/10 transition-smooth">
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No sessions found */}
          {!sessionsLoading && sessionsLoaded && sessions.length === 0 && !sessionsError && (
            <div className="bg-surface border border-border rounded-xl p-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-bg-subtle flex items-center justify-center mx-auto mb-4">
                <FileText size={24} className="text-text-tertiary" />
              </div>
              <p className="text-sm font-semibold text-text-primary">No runs yet</p>
              <p className="text-xs text-text-tertiary mt-1.5 max-w-xs mx-auto">
                Go to Start and point Inspire at your catalog to find use cases in your data.
              </p>
            </div>
          )}

            {/* Session list (button-style) */}
            {sessions.length > 0 && (
              <div className="space-y-2" role="group" aria-label="Runs">
                <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-[0.18em]">
                  Runs ({sessions.length})
                </h2>
                {runsNewestFirst(sessions).map((s) => {
                  const selected =
                    String(selectedSessionId) === String(s.session_id);
                  const isFailed = sessionFailed(s);
                  const isDone = sessionFinished(s);
                  const figures = runFigureParts(runFiguresOf(s, portfolio));
                  return (
                    <button
                      key={s.session_id}
                      data-run={String(s.session_id)}
                      onClick={() => {
                        setSelectedSessionId(s.session_id);
                        loadResults(s.session_id, s);
                      }}
                      className={`
                        w-full text-start p-3.5 rounded-lg border transition-smooth flex items-center justify-between gap-3
                        ${
                          selected
                            ? 'bg-db-red-50 border-db-red/20 glow-active'
                            : 'bg-surface border-border hover:border-border-strong glow-hover'
                        }
                      `}
                    >
                      <div className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text-primary">
                            {runBusiness(s) || 'Session'}
                          </span>
                          <LatestRunBadge session={s} latest={String(s.session_id) === latestId} />
                        </span>
                        <div className="text-[11px] text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar size={10} aria-hidden />{' '}
                            {formatSessionDate(runDate(s))}
                          </span>
                          {figures.length > 0 && <span data-run-figures="">{figures.join(' · ')}</span>}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border tabular-nums ${
                          isFailed
                            ? 'bg-error-bg text-error-fg border-error/20'
                            : isDone
                            ? 'bg-success-bg text-success-fg border-success/20'
                            : 'bg-warning-bg text-warning-fg border-warning/20'
                        }`}
                      >
                        {isFailed
                          ? `Failed at ${Math.round(s.completed_percent)}%`
                          : isDone
                          ? 'Complete'
                          : `${Math.round(s.completed_percent)}% · Preview`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* Loading results — skeleton with progress message */}
      {loading && (
        <div className="space-y-6">
          {/* Loading header */}
          <div className="flex items-center gap-3 px-1">
            <div className="w-8 h-8 rounded-lg bg-db-red/10 flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-db-red-fg" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Analyzing results...</p>
              <p className="text-xs text-text-tertiary">Hydrating use cases, domains, and scores</p>
            </div>
          </div>

          {/* Skeleton KPI cards */}
          <SkeletonStats count={3} />

          {/* Skeleton charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border p-5 space-y-3">
              <div className="skeleton h-3 w-32 rounded" />
              <div className="skeleton rounded-lg h-[220px]" />
            </div>
            <div className="rounded-xl border border-border p-5 space-y-3">
              <div className="skeleton h-3 w-40 rounded" />
              <div className="skeleton rounded-lg h-[220px]" />
            </div>
          </div>

          {/* Skeleton use case cards */}
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div data-results-error="" data-tone={error === RESULTS_PENDING_TEXT ? 'info' : 'error'} className={`flex items-center gap-2 p-3 border rounded-lg mb-6 ${error === RESULTS_PENDING_TEXT ? 'bg-bg-subtle border-border' : 'bg-error-bg border-error/20'}`}>
          {error === RESULTS_PENDING_TEXT ? <Loader2 size={14} className="text-text-tertiary shrink-0 animate-spin" /> : <AlertCircle size={14} className="text-error-fg shrink-0" />}
          <PlainMessage text={error} as="span" className={`text-sm ${error === RESULTS_PENDING_TEXT ? 'text-text-secondary' : 'text-error-fg'}`} />
        </div>
      )}

      {/* ═══ Results content ═══ */}
      {results && (
        <>
          {/* Progressive results banner */}
          {isProgressive && (
            <div className="flex items-center gap-3 p-3 bg-warning-bg border border-warning/20 rounded-lg mb-3">
              <Loader2 size={14} className="animate-spin text-warning-fg shrink-0" />
              <div className="flex-1">
                <span className="text-sm font-semibold text-warning-fg">Live Preview</span>
                <span className="text-xs text-text-secondary ms-2">
                  <span data-testid="live-use-case-count">{liveCountText(allUseCases.length)}</span>, the same count as Monitor.
                  The final catalog keeps the ones that pass every check. Results will be enriched as the pipeline progresses. {START_MVP_LABEL} opens on each use case once the run has saved it.
                </span>
              </div>
              <button
                onClick={() => loadResults(selectedSessionId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-warning-fg border border-warning/30 rounded-md hover:bg-warning/10 transition-smooth"
              >
                <RefreshCw size={11} />
                Refresh
              </button>
            </div>
          )}




          {/* ═══ Two-Column: sticky sidebar rail; use-case list scrolls independently in the right column ═══ */}
          <div data-browse={view === 'usecases' ? '' : undefined} className="flex flex-col md:flex-row md:items-stretch gap-5 min-h-0">
            {/* ── Left Sidebar: stays fixed in viewport while the card list scrolls (sticky + max height) ── */}
            <ResultsNav view={view} onView={showView} useCaseCount={allUseCases.length}
              stickyClass={embedded ? 'top-4 md:max-h-[min(32rem,72vh)]' : 'top-20 md:max-h-[calc(100dvh-5rem)]'}>
              <div role="group" aria-label="Show active or archived use cases" data-archive-views="" className="flex shrink-0 gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm">
                {ARCHIVE_VIEWS.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setArchiveView(view.id)}
                    aria-pressed={archiveView === view.id}
                    data-archive-view={view.id}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-smooth ${
                      archiveView === view.id ? 'bg-db-red-50 text-db-red-fg border border-db-red/20' : 'text-text-secondary border border-transparent hover:bg-bg-subtle'
                    }`}
                  >
                    {view.id === 'archived' && <Archive size={12} />}
                    {view.label}
                    <span className="text-[10px] font-medium">{archiveCounts[view.id]}</span>
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                <button
                  type="button"
                  onClick={() => setDomainPanelOpen((o) => !o)}
                  aria-expanded={domainPanelOpen}
                  className="flex w-full shrink-0 items-start gap-2 border-b border-border bg-gradient-to-b from-db-red-50 to-surface px-3 py-3 text-start transition-smooth hover:from-db-red-50/80"
                >
                  <ChevronRight
                    size={14}
                    className={`mt-0.5 shrink-0 text-text-tertiary transition-transform duration-200 ${domainPanelOpen ? 'rotate-90' : ''}`}
                  />
                  <Layers size={14} className="mt-0.5 shrink-0 text-db-red-fg" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-text-primary">Domains</span>
                    <p className="text-[10px] text-text-tertiary mt-0.5">
                      {domains.length} domain{domains.length !== 1 ? 's' : ''} &middot; {allUseCases.length} use cases
                    </p>
                    {!domainPanelOpen && (filterDomain !== 'all' || filterSubdomain !== 'all') && (
                      <p
                        className="mt-1 truncate text-[10px] font-medium text-db-red-fg"
                        title={filterSubdomain !== 'all' ? `${filterDomain} › ${filterSubdomain}` : filterDomain}
                      >
                        Filter:{' '}
                        <bdi>{filterDomain}</bdi>
                        {filterSubdomain !== 'all' && <> › <bdi>{filterSubdomain}</bdi></>}
                      </p>
                    )}
                  </div>
                </button>

                {/* Domain list — shown when panel expanded */}
                {domainPanelOpen && (
                <div className="p-1.5 space-y-0.5">
                  {/* All domains */}
                  <button
                    onClick={() => setFilterDomain('all')}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-smooth ${
                      filterDomain === 'all'
                        ? 'bg-db-red-50 border border-db-red/20'
                        : 'hover:bg-bg-subtle border border-transparent'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      filterDomain === 'all' ? 'bg-db-red/10' : 'bg-bg-subtle'
                    }`}>
                      <Layers size={10} className={filterDomain === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'} />
                    </div>
                    <span className={`text-[11px] font-semibold flex-1 ${
                      filterDomain === 'all' ? 'text-db-red-fg' : 'text-text-primary'
                    }`}>
                      All Domains
                    </span>
                    <span className={`text-[10px] font-mono tabular-nums ${filterDomain === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'}`}>
                      {allUseCases.length}
                    </span>
                  </button>

                  {/* Individual domains with expandable subdomains */}
                  {domains.map((d) => {
                    const count = domainCounts[d] || 0;
                    const active = filterDomain === d;
                    const highPriCount = allUseCases.filter(
                      (uc) => uc._domain === d && isHighPriority(uc)
                    ).length;
                    const subs = subdomainsByDomain[d] || {};
                    const hasSubs = Object.keys(subs).length > 0;
                    const isExpanded = !!expandedDomains[d];

                    return (
                      <div key={d}>
                        <div className="flex items-center">
                          {hasSubs && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedDomains(prev => ({ ...prev, [d]: !prev[d] })); }}
                              aria-label={`Subdomains of ${d}`}
                              aria-expanded={!!isExpanded}
                              className="p-0.5 me-0.5 rounded hover:bg-bg-subtle transition-smooth"
                            >
                              <ChevronRight size={10} className={`text-text-tertiary transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          )}
                          <button
                            onClick={() => { setFilterDomain(active ? 'all' : d); setFilterSubdomain('all'); }}
                            className={`flex-1 flex items-start gap-2 px-2 py-2 rounded-lg text-start transition-smooth ${
                              active
                                ? 'bg-db-red-50 border border-db-red/20'
                                : 'hover:bg-bg-subtle border border-transparent'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              active ? 'bg-db-red/10' : 'bg-bg-subtle'
                            }`}>
                              <Building2 size={10} className={active ? 'text-db-red-fg' : 'text-text-tertiary'} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span dir="auto" className={`text-[11px] font-semibold block truncate ${
                                active ? 'text-db-red-fg' : 'text-text-primary'
                              }`}>
                                {d}
                              </span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[9px] text-text-tertiary font-mono tabular-nums">{count} use case{count !== 1 ? 's' : ''}</span>
                                {highPriCount > 0 && (
                                  <span className="text-[9px] text-db-red-fg font-medium">{highPriCount} high pri</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </div>
                        {/* Subdomain list */}
                        {isExpanded && hasSubs && (
                          <div className="ms-7 mt-0.5 space-y-0.5">
                            {Object.entries(subs).map(([sd, sdCount]) => {
                              const sdActive = filterSubdomain === sd && filterDomain === d;
                              return (
                                <button
                                  key={sd}
                                  onClick={() => {
                                    setFilterDomain(d);
                                    setFilterSubdomain(sdActive ? 'all' : sd);
                                  }}
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-start transition-smooth ${
                                    sdActive
                                      ? 'bg-db-red-50/70 text-db-red-fg'
                                      : 'text-text-secondary hover:bg-bg-subtle'
                                  }`}
                                >
                                  <span dir="auto" className={`text-[10px] font-medium truncate flex-1 ${sdActive ? 'text-db-red-fg' : ''}`}>{sd}</span>
                                  <span className={`text-[9px] font-mono ${sdActive ? 'text-db-red-fg' : 'text-text-tertiary'}`}>{sdCount}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>

              {levelFilters.map(({ level, options }) => (
                <SidebarFilterPanel
                  key={`level-${level}`}
                  title={level}
                  subtitle={`${options.filter((o) => o.value !== NOT_ALIGNED_FILTER && o.count > 0).length} in use \u00b7 your strategy`}
                  icon={Compass}
                  open={!!levelPanelOpen[level]}
                  onToggle={() => setLevelPanelOpen((o) => ({ ...o, [level]: !o[level] }))}
                  allLabel="All use cases"
                  allCount={allUseCases.length}
                  options={options}
                  value={filterLevels[level] || 'all'}
                  onChange={(value) => setFilterLevels((f) => {
                    const next = { ...f };
                    if (value === 'all') delete next[level];
                    else next[level] = value;
                    return next;
                  })}
                />
              ))}

              {kpiOptions.length > 0 && (
                <SidebarFilterPanel
                  title="KPIs"
                  subtitle={`${kpiOptions.filter((o) => o.origin === KPI_FROM_STRATEGY).length} from your strategy \u00b7 ${kpiOptions.filter((o) => o.origin !== KPI_FROM_STRATEGY).length} proposed`}
                  icon={Target}
                  open={kpiPanelOpen}
                  onToggle={() => setKpiPanelOpen((o) => !o)}
                  allLabel="All KPIs"
                  allCount={allUseCases.filter((uc) => uc?._v130?.kpis?.length).length}
                  options={kpiOptions}
                  value={filterKpi}
                  onChange={setFilterKpi}
                />
              )}

              {levelFilters.length === 0 && strategyOptions.length > 0 && (
                <SidebarFilterPanel
                  title="Strategy"
                  subtitle={`${strategyFilter.withData - strategyFilter.notAligned} tied to a goal \u00b7 ${strategyFilter.notAligned} not tied`}
                  icon={Compass}
                  open={strategyPanelOpen}
                  onToggle={() => setStrategyPanelOpen((o) => !o)}
                  allLabel="All use cases"
                  allCount={allUseCases.length}
                  options={strategyOptions}
                  value={filterStrategy}
                  onChange={setFilterStrategy}
                />
              )}

              {bizPriorityOptions.length > 0 && (
                <SidebarFilterPanel
                  title="Business priorities"
                  subtitle={`${bizPriorityOptions.length} of ${bizPriorities.length} priorities in use`}
                  icon={Flag}
                  open={bizPriorityPanelOpen}
                  onToggle={() => setBizPriorityPanelOpen((o) => !o)}
                  allLabel="All priorities"
                  allCount={bizPriorityUseCases}
                  options={bizPriorityOptions}
                  value={filterBizPriority}
                  onChange={setFilterBizPriority}
                />
              )}

              {beneficiaries.length > 0 && (
                <SidebarFilterPanel
                  title="Beneficiaries"
                  subtitle={`${beneficiaries.length} role${beneficiaries.length !== 1 ? 's' : ''} \u00b7 who benefits`}
                  icon={Users}
                  open={beneficiaryPanelOpen}
                  onToggle={() => setBeneficiaryPanelOpen((o) => !o)}
                  allLabel="All beneficiaries"
                  allCount={allUseCases.filter((uc) => beneficiaryFromUc(uc)).length}
                  options={beneficiaries.map((b) => ({ value: b, label: b, count: beneficiaryCounts[b] || 0 }))}
                  value={filterBeneficiary}
                  onChange={setFilterBeneficiary}
                />
              )}

              {sponsors.length > 0 && (
                <SidebarFilterPanel
                  title="Sponsors"
                  subtitle={`${sponsors.length} sponsor${sponsors.length !== 1 ? 's' : ''} \u00b7 executive / owner`}
                  icon={Crown}
                  open={sponsorPanelOpen}
                  onToggle={() => setSponsorPanelOpen((o) => !o)}
                  allLabel="All sponsors"
                  allCount={allUseCases.filter((uc) => sponsorFromUc(uc)).length}
                  options={sponsors.map((sp) => ({ value: sp, label: sp, count: sponsorCounts[sp] || 0 }))}
                  value={filterSponsor}
                  onChange={setFilterSponsor}
                />
              )}
            </ResultsNav>

            {/* ── Right Panel: filters stay put; use case cards scroll in a bounded pane ── */}
            {view === 'usecases' && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
              {/* Filter toolbar */}
              <div className="mb-4 shrink-0 bg-surface border border-border/70 rounded-xl shadow-elevated overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  {/* Search */}
                  <div className="relative min-w-[14rem] flex-1">
                    <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input dir="auto"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search use cases..."
                      aria-label="Search use cases"
                      className="w-full ps-9 pe-3 py-1.5 text-xs border border-border rounded-lg bg-bg text-text-primary placeholder:text-text-tertiary focus:border-db-red/30 transition-smooth"
                    />
                  </div>

                  {/* Favorites toggle */}
                  <button
                    type="button"
                    onClick={() => setShowFavoritesOnly(p => !p)}
                    aria-pressed={showFavoritesOnly}
                    aria-label={showFavoritesOnly ? 'Show all use cases' : 'Show favorites only'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-smooth ${
                      showFavoritesOnly
                        ? 'bg-db-red-50 text-db-red-fg border-db-red/20'
                        : 'bg-bg text-text-secondary border-border hover:border-border-strong'
                    }`}
                    title={showFavoritesOnly ? 'Show all use cases' : 'Show favorites only'}
                  >
                    <Heart size={13} className={showFavoritesOnly ? 'fill-current' : ''} />
                    {favoriteCount(favorites) > 0 && (
                      <span className="text-[10px]">{favoriteCount(favorites)}</span>
                    )}
                  </button>

                  {starredCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowBestOfBestOnly(!showBestOfBestOnly)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-smooth ${
                        showBestOfBestOnly
                          ? 'bg-warning-bg text-warning-fg border-warning/35'
                          : 'bg-bg text-text-secondary border-border hover:border-border-strong'
                      }`}
                      title={showBestOfBestOnly ? 'Show all use cases' : 'Show Best of Best use cases only'}
                      aria-pressed={showBestOfBestOnly}
                    >
                      <Star size={13} className={showBestOfBestOnly ? 'fill-current' : ''} />
                      Best of Best
                      <span className="text-[10px]">{starredCount}</span>
                    </button>
                  )}

                  {/* Priority pills */}
                  {priorities.length > 0 && (
                    <div className="flex items-center gap-1">
                      {PRIORITY_ORDER.filter((p) => priorities.includes(p)).map((p) => {
                        const active = filterPriority === p;
                        const cnt = allUseCases.filter((uc) => priorityTierOf(uc) === p).length;
                        return (
                          <button
                            key={p}
                            onClick={() => setFilterPriority(active ? 'all' : p)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-smooth border ${
                              active
                                ? 'border-db-red/30 bg-db-red-50 text-db-red-fg'
                                : 'border-transparent text-text-secondary hover:bg-bg-subtle'
                            }`}
                          >
                            {p.replace('Ultra ', 'U-').replace('Very ', 'V-')}
                            <span className={`font-mono ${active ? 'text-db-red-fg' : 'text-text-tertiary'}`}>{cnt}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Type filter */}
                  {types.length > 0 && (
                    <select
                      aria-label="Type"
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth"
                    >
                      <option value="all">All Types</option>
                      {types.map((t) => (
                        <option dir="auto" key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}

                  {/* Technique filter */}
                  {techniques.length > 0 && (
                    <select
                      aria-label="Technique"
                      value={filterTechnique}
                      onChange={(e) => setFilterTechnique(e.target.value)}
                      className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth"
                    >
                      <option value="all">All Techniques</option>
                      {techniques.map((t) => (
                        <option dir="auto" key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}

                  {kindOptions.length > 0 && (
                    <select
                      aria-label="Kind"
                      value={filterKind}
                      onChange={(e) => setFilterKind(e.target.value)}
                      className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth"
                    >
                      <option value="all">All Kinds</option>
                      {kindOptions.map((family) => (
                        <optgroup key={family.value} label={family.label}>
                          <option value={family.value}>{`All ${family.label} (${family.count})`}</option>
                          {family.kinds.map((k) => (
                            <option key={k.value} value={k.value}>{`${k.label} (${k.count})`}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}

                  {/* Quality filter */}
                  {qualities.length > 0 && (
                    <select
                      aria-label="Quality"
                      value={filterQuality}
                      onChange={(e) => setFilterQuality(e.target.value)}
                      className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth"
                    >
                      <option value="all">All Quality</option>
                      {qualities.map((q) => (
                        <option dir="auto" key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  )}

                  {/* Genie Code instruction (has / no) */}
                  <select
                    aria-label="Genie Code instruction"
                    value={filterHasGenie}
                    onChange={(e) => setFilterHasGenie(e.target.value)}
                    title="Filter by whether the use case has a Genie Code instruction"
                    className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth min-w-[10.5rem]"
                  >
                    <option value="all">Genie Code instruction: Any</option>
                    <option value="yes">Genie Code instruction: Yes</option>
                    <option value="no">Genie Code instruction: No</option>
                  </select>

                  {qualityBarCounts.below > 0 && (
                    <select
                      data-testid="quality-bar-filter"
                      aria-label="Quality bar"
                      value={filterQualityBar}
                      onChange={(e) => setFilterQualityBar(e.target.value)}
                      title="Filter by whether the use case meets your quality bar"
                      className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth min-w-[10.5rem]"
                    >
                      <option value="all">Quality bar: Any ({qualityBarCounts.found})</option>
                      <option value="meets">Meets the quality bar ({qualityBarCounts.meets})</option>
                      <option value="below">Below the quality bar ({qualityBarCounts.below})</option>
                    </select>
                  )}

                  <select
                    value={filterMvp}
                    onChange={(e) => setFilterMvp(e.target.value)}
                    aria-label="MVP"
                    title="Filter by the use case's MVP"
                    className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth min-w-[9rem]"
                  >
                    {MVP_FILTERS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>

                  {/* Sort */}
                  <select
                    aria-label="Sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="px-2 py-1.5 text-[11px] border border-border rounded-lg bg-bg text-text-primary focus:border-db-red/30 transition-smooth"
                  >
                    <option value="inspire">Sort: Inspire score (high → low)</option>
                    <option value="priority">Sort: Priority tier</option>
                    <option value="domain">Sort: Domain</option>
                    <option value="name">Sort: Name</option>
                  </select>

                  {hasActiveFilters && (
                    <button
                      onClick={clearAllFilters}
                      className="text-[11px] text-db-red-fg hover:underline font-medium shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Active filter chips */}
                {hasActiveFilters && (
                  <div className="px-4 py-2 bg-db-red-50/50 border-t border-border flex items-center gap-2 flex-wrap">
                    <Filter size={12} className="text-db-red-fg shrink-0" />
                    <span className="text-[11px] text-text-secondary">
                      <span className="font-semibold text-text-primary tabular-nums">{filteredUseCases.length}</span> of{' '}
                      <span className="font-semibold text-text-primary tabular-nums">{allUseCases.length}</span> use cases
                    </span>
                    {filterDomain !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {filterDomain}
                        <button onClick={() => { setFilterDomain('all'); setFilterSubdomain('all'); }} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterSubdomain !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        Sub: {filterSubdomain}
                        <button onClick={() => setFilterSubdomain('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterPriority !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {filterPriority}
                        <button onClick={() => setFilterPriority('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterType !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {filterType}
                        <button onClick={() => setFilterType('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterTechnique !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {filterTechnique}
                        <button onClick={() => setFilterTechnique('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterKind !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {kindFilterLabel(filterKind, kindOptions)}
                        <button onClick={() => setFilterKind('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterQuality !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        Q: {filterQuality}
                        <button onClick={() => setFilterQuality('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterQualityBar !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {filterQualityBar === 'meets' ? 'Meets the quality bar' : 'Below the quality bar'}
                        <button type="button" onClick={() => setFilterQualityBar('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterHasGenie !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        Genie Code instruction: {filterHasGenie === 'yes' ? 'Yes' : 'No'}
                        <button type="button" onClick={() => setFilterHasGenie('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {filterMvp !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        {MVP_FILTERS.find((f) => f.id === filterMvp)?.label}
                        <button type="button" aria-label="Clear the MVP filter" onClick={() => setFilterMvp('all')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {showFavoritesOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        Favorites only
                        <button type="button" aria-label="Show all use cases, not only favorites" onClick={() => setShowFavoritesOnly(false)} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {showBestOfBestOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        Best of Best only
                        <button type="button" aria-label="Show all use cases, not only Best of Best" onClick={() => setShowBestOfBestOnly(false)} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                    {searchQuery && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                        "{searchQuery}"
                        <button onClick={() => setSearchQuery('')} className="hover:text-db-red-fg">&times;</button>
                      </span>
                    )}
                  </div>
                )}
              </div>

              <RefineBanner {...refineBanner} />
              {bulkOn && bulkHere && <ValueBulkProgress />}
              {bulkOn && filteredUseCases.length > 0 && (
                <ValueBulkBar shown={filteredUseCases.filter((uc) => trackingIdOf(uc)).length} selected={bulkIds.length} onCalculate={startBulk} busy={Boolean(bulkRun.run?.running)}
                  onSelectAll={(on) => setBulkPicked(on ? new Set(filteredUseCases.map((uc) => trackingIdOf(uc)).filter(Boolean)) : new Set())} />
              )}

              {/* Use case cards — only this region scrolls; sidebar + filter bar stay visible */}
              <div
                className={`overflow-y-auto pe-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong/70 [&::-webkit-scrollbar-track]:bg-transparent ${
                  embedded
                    ? 'h-[min(28rem,60vh)]'
                    : 'h-[min(calc(100dvh-12rem),56rem)]'
                }`}
                role="region"
                aria-label="Use case list"
              >
                {filteredUseCases.length > 0 ? (
                  <div className="space-y-3 pb-2">
                    {filteredUseCases.map((uc, idx) => {
                      const favKey = favoriteKeyOf(uc);
                      const tid = trackingIdOf(uc);
                      return (
                      <div key={cardKeys.get(uc)} data-use-case-no={uc.No != null ? String(uc.No) : undefined} className="scroll-mt-2">
                      <UseCaseCard
                        uc={uc}
                        index={idx}
                        expanded={expandedUseCase === cardKeys.get(uc)}
                        onToggle={() => setExpandedUseCase(expandedUseCase === cardKeys.get(uc) ? null : cardKeys.get(uc))}
                        isFavorite={!!(favKey && favorites[favKey])}
                        onToggleFavorite={() => toggleFavorite(uc)}
                        onRename={inspireDb && warehouseId && selectedSessionId ? (name) => renameUseCase(uc, name) : undefined}
                        liveAppStale={liveAppRenameStale(implementLatestById[trackingIdOf(uc)], nameOfUseCase(uc)) && cardAssetLinks(implementLatestById[trackingIdOf(uc)]).some((l) => l.id === 'app')}
                        onUpdateLiveApp={inspireDb && warehouseId && selectedSessionId ? () => updateLiveApp(uc) : undefined}
                        selection={bulkOn && tid ? { checked: bulkPicked.has(tid), onChange: (on) => setBulkPick(tid, on) } : null}
                        v130={uc._v130}
                        feedbackCurrent={feedbackCurrentFor(uc)}
                        useCaseValue={runValue?.use_cases?.[trackingIdOf(uc)] ?? null}
                        estimate={estimates?.use_cases?.[trackingIdOf(uc)] ?? null}
                        yearly={calculated.byId[tid]?.yearly || measuredYearly?.use_cases?.[tid] || null}
                        valueSummary={valueTotals?.use_cases?.[tid] ?? null}
                        canCalculate={Boolean(runValueUrl && tid)}
                        onCalculate={() => setCalcFor(uc)}
                        onEdit={runValueUrl && tid ? () => setCalcFor(uc) : undefined}
                        onSetRule={canImplement ? () => startImplement(uc) : undefined}
                        onUndoRefine={tid ? () => undoRefinedCard(tid) : undefined}
                        implementStatus={tid ? implementState(implementLatestById[tid] || null, notebookStatus(uc, implementView.notebook_run)) : null}
                        onImplement={canImplement ? () => startImplement(uc) : undefined}
                        onOpenMvp={onOpenImplement && tid && selectedSessionId ? () => onOpenImplement(String(selectedSessionId), tid) : undefined}
                        notebookUrl={workspaceNotebookUrl(databricksHost, uc.notebook_path || '')}
                        assetLinks={tid ? cardAssetLinks(implementLatestById[tid] || null) : []}
                        assetUseCaseId={tid || ''}
                        assetFlags={assetFlags && tid ? (assetFlags[tid] || {}) : null}
                        dbuRead={dbuRead}
                        isArchived={isArchivedUc(uc)}
                        onToggleArchive={selectedSessionId && archiveKeyOf(selectedSessionId, uc) ? () => toggleArchive(archiveKeyOf(selectedSessionId, uc)) : undefined}
                        {...detailPropsFor(uc)}
                      />
                      </div>
                      );
                    })}
                  </div>
                ) : allUseCases.length > 0 && archiveCounts[archiveView] === 0 ? (
                  <div data-archive-empty={archiveView} className="bg-surface border border-border/70 rounded-xl p-10 text-center shadow-elevated">
                    <Archive size={20} className="text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm text-text-secondary">
                      {archiveView === 'archived' ? 'No archived use cases. Archive one from its card to move it here.' : 'Every use case of this run is archived.'}
                    </p>
                    <button type="button" onClick={() => setArchiveView(archiveView === 'archived' ? 'active' : 'archived')} className="text-xs text-db-red-fg hover:underline mt-2 font-medium">
                      {archiveView === 'archived' ? 'Show active use cases' : 'Show archived use cases'}
                    </button>
                  </div>
                ) : allUseCases.length > 0 ? (
                  <div className="bg-surface border border-border/70 rounded-xl p-10 text-center shadow-elevated">
                    <Search size={20} className="text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm text-text-secondary">No use cases match your filters.</p>
                    <button
                      onClick={clearAllFilters}
                      className="text-xs text-db-red-fg hover:underline mt-2 font-medium"
                    >
                      Clear all filters
                    </button>
                  </div>
                ) : null}
              </div>
              <QualityGateDrops results={results} />
            </div>
            )}
            {view === 'business' && (
              <div className="min-w-0 flex-1">
              <ResultsBusiness
                allUseCases={allUseCases}
                avgInspireScore={avgInspireScore}
                describeUseCase={describeUseCase}
                domains={domains}
                domainsSummary={domainsSummary}
                feedbackState={feedbackState}
                filterMvp={filterMvp}
                hasMvpData={hasMvpData}
                highPriorityCount={highPriorityCount}
                mvpStateOf={mvpStateOf}
                noneMeetsBar={noneMeetsBar}
                onRunValueRow={onRunValueRow}
                onShowUseCases={() => showView('usecases')}
                openUseCase={openUseCase}
                results={results}
                selectedFigures={selectedFigures}
                setFilterMvp={setFilterMvp}
                showRunValue={!embedded}
                starredCount={starredCount}
                summaryParagraphs={summaryParagraphs}
                techniqueCount={techniqueCount}
                uniqueSubdomainCount={uniqueSubdomainCount}
                v130Session={v130Session}
                valueTotals={valueTotals}
              />
              </div>
            )}
            {view === 'assets' && (
              <div className="min-w-0 flex-1">
              <ResultsAssets
                allUseCases={allUseCases}
                apiFetch={apiFetch}
                apiPostJson={apiPostJson}
                artifactTree={artifactTree}
                artifactsExpanded={artifactsExpanded}
                artifactsLoading={artifactsLoading}
                artifactsRootFiles={artifactsRootFiles}
                databricksHost={databricksHost}
                downloadFile={downloadFile}
                error={error}
                expandedFolders={expandedFolders}
                generationPath={generationPath}
                genieQuickAccessExpanded={genieQuickAccessExpanded}
                inspireDb={inspireDb}
                isProgressive={isProgressive}
                lastArtifactsLoadKeyRef={lastArtifactsLoadKeyRef}
                loadArtifacts={loadArtifacts}
                loadFolder={loadFolder}
                loading={loading}
                noneMeetsBar={noneMeetsBar}
                openFileInTab={openFileInTab}
                previewData={previewData}
                previewFile={previewFile}
                previewFrom={previewFrom}
                previewLoading={previewLoading}
                qualityBarCounts={qualityBarCounts}
                reviewBarStages={reviewBarStages}
                runOutcome={runOutcome}
                selectedSession={selectedSession}
                selectedSessionId={selectedSessionId}
                setArtifactsExpanded={setArtifactsExpanded}
                setGenieQuickAccessExpanded={setGenieQuickAccessExpanded}
                settings={settings}
                settingsNotebookPath={settingsNotebookPath}
                showcase={showcase}
                toggleFolder={toggleFolder}
                togglePreview={togglePreview}
              />
              </div>
            )}
          </div>
        </>
      )}

      {fileProblem && (
        <div role="alert" data-file-problem="" className="fixed bottom-4 inset-x-4 z-50 mx-auto flex max-w-xl items-start gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-xs text-error-fg shadow-elevated">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div dir="auto" className="min-w-0 flex-1 break-words"><PlainMessage text={fileProblem} as="span" /></div>
          <button type="button" aria-label="Dismiss" onClick={() => setFileProblem('')} className="shrink-0 font-bold hover:opacity-80">&times;</button>
        </div>
      )}

        {calcFor && (
          <CalculateValueDialog key={trackingIdOf(calcFor)} uc={calcFor} table={tableOfUseCase(calcFor)} apiPostJson={apiPostJson} inspireDatabase={inspireDb} warehouseId={warehouseId}
            sessionId={selectedSessionId} saved={calculated.byId[trackingIdOf(calcFor)]?.answers || null} version={calculated.byId[trackingIdOf(calcFor)]?.version || null}
            values={valuesForDialog} onClose={() => setCalcFor(null)} />
        )}
      {bulkHere?.open && <ValueBulkPanel />}
      {implementUc && selectedSessionId && inspireDb && warehouseId && (
        <ImplementWizard
          uc={implementUc}
          sessionId={selectedSessionId}
          settings={{ ...settings, warehouseId, inspireDatabase: inspireDb, notebookPath: settingsNotebookPath }}
          discoveryType={resultsDiscoveryType}
          apiFetch={apiFetch}
          apiPostJson={apiPostJson}
          focus={implementFocus}
          onClose={() => { setImplementUc(null); setImplementFocus(null); }}
          onImplemented={(data) => {
            setImplementUc(null);
            setImplementFocus(null);
            setImplementRefresh((n) => n + 1);
            onOpenImplement?.(String(selectedSessionId), data.use_case_id);
          }}
          onOpenBuild={onOpenImplement ? (useCaseId) => {
            setImplementUc(null);
            setImplementFocus(null);
            onOpenImplement(String(selectedSessionId), useCaseId);
          } : null}
        />
      )}

    </div>
  );
}

/* ── Stat Card ── */
function cardKeyOf(uc, idx = '') {
  const tid = trackingIdOf(uc);
  return tid ? `genie-uc-${tid}` : favoriteKeyOf(uc) || String(uc?.No ?? idx);
}

