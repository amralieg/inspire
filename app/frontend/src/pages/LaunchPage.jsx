import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TABLE_ELECTION_BY_PLAN } from '../lib/startWizard';
import {
  Play,
  Loader2,
  AlertCircle,
  Building2,
  Database,
  Target,
  Layers,
  FileText,
  Search,
  CheckCircle2,
  ChevronDown,
  Sliders,
  Settings2,
  Zap,
  Bot,
  Table2,
  ShoppingCart,
  X,
  TrendingUp,
  DollarSign,
  Cog,
  Shield,
  Users,
  Star,
  Rocket,
  Leaf,
  Lock,
  Crosshair,
  Eye,
  Calendar,
  ExternalLink,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import MoreMenu from '../components/ui/MoreMenu';
import Button from '../components/ui/Button';
import StrategyEditor from '../components/StrategyEditor';
import { parseStrategicContext, splitPriorities, validateStrategicContextText, withPriorities } from '../lib/strategyContext';
import UcPermissionErrorHelp from '../components/UcPermissionErrorHelp';
import DataManagement from '../components/DataManagement';
import { groupLabelOf, warehouseLabel } from '../lib/implementWizard';
import RequestAccessBar from '../components/RequestAccessBar';
import { leftOutLine, typeCheckBusyOf, unusableReasonOf } from '../lib/tableUsability';
import TypeCheckBusyTryAgain from '../components/TypeCheckBusyTryAgain';
import ModalDialog from '../components/ModalDialog';
import { sameSettings } from '../lib/businessProfiles';
import { scopesFromObject, launchTableScopeText, filterValuesOf, labelAvailable, pickedTableNames, tableBrowseQuery, accessNeedOf, accessNeedText, INSPIRE_NEED_TITLE, MAX_ACCESS_OBJECTS, tableScopeOf, tableScopeSummary, usableRows } from '../lib/tableScope';
import { launchRelationshipsText, restoredRelationshipList } from '../lib/tableRelationships';
import { PlainMessage } from '../components/TechnicalDetails';
import LatestRunBadge from '../components/LatestRunBadge';
import { runBusiness } from '../lib/reviewFigures';
import OutputFolderCheck from '../components/OutputFolderCheck';
import DiscoveryPromise from '../components/DiscoveryPromise';
import { useOutputFolderCheck } from '../lib/outputFolderCheck';
import { DRAFT_BACK_NOTE, DRAFT_START_OVER, START_DRAFT_STAMP, START_DRAFT_STEP, clearWizardDraft, readWizardDraft, startDraftKey, writeWizardDraft } from '../lib/wizardDraft';
import { newSessionId } from '../lib/runState';
import { interpretUcPermissionError, parseApiErrorMessage } from '../lib/ucPermissionErrors';
import { formatWhen, utcDate } from '../lib/formatWhen';
import { sessionFailed, sessionFinished, sessionStatus } from '../lib/monitorState';
import { responseError } from '../lib/apiClient';
import { placeholderWords } from '../lib/placeholderWords';
import { inspireScoreFromUc, nameOfUseCase } from '../lib/useCaseFields';
import { counted } from '../lib/plural';
import { catalogListNote, droppedCatalogNames, pickedScope, scopeSummary, typedCatalog, wholeCatalogsWithoutPicks } from '../lib/catalogList';
import { DISCOVERY_AI_ENHANCED, DISCOVERY_MODE_TEXT, DISCOVERY_BADGE, DISCOVERY_PRIVACY, DISCOVERY_RECOMMENDED, DISCOVERY_STANDARD, discoveryTypeOf } from '../lib/discoveryType';
import { WIZARD } from '../lib/layout';
import { raisePermissions, grantOfCatalog } from '../lib/permissionBus';
import { withStartDeadline } from '../lib/startDeadline';

/* ─── Constants — notebook v1.2.0 widget `05_use_cases_quality` ─── */
const QUALITY_OPTIONS = ['Good', 'High', 'Ultra High'];

const DISCOVERY_OPTIONS = [
  {
    key: DISCOVERY_AI_ENHANCED,
    icon: Sparkles,
    desc: DISCOVERY_MODE_TEXT[DISCOVERY_AI_ENHANCED],
  },
  {
    key: DISCOVERY_STANDARD,
    icon: Lock,
    desc: DISCOVERY_MODE_TEXT[DISCOVERY_STANDARD],
  },
].map((opt) => (opt.key === DISCOVERY_RECOMMENDED ? { ...opt, badge: DISCOVERY_BADGE } : opt));
const DISCOVERY_PANEL = [
  {
    key: 'why',
    icon: Search,
    title: 'Both modes check your data',
    text: 'Before Inspire keeps a use case, it counts what the use case needs: the rows in each table, the dates each table covers, how empty each column is, whether joins really match, how many records each group holds and how many past examples of the outcome there are. A use case the data cannot support is dropped with its reason.',
  },
  {
    key: 'quality',
    icon: Target,
    title: 'Use cases you can build',
    text: 'You get fewer use cases built on empty or thin tables, broken joins or the wrong dates. A use case you asked for is always kept, and it shows why the data may be thin.',
  },
  {
    key: 'privacy',
    icon: Shield,
    title: 'Your data stays private',
    text: DISCOVERY_PRIVACY,
  },
];
const TABLE_ELECTION = ['Let Inspire Decides', 'All Tables', 'Transactional Only'];
/** Show guidance when explicit table selection exceeds this count. */
const TABLE_SELECTION_WARN_THRESHOLD = 10;
/** Documented sweet spot for discovery quality and runtime. */
const TABLE_SELECTION_IDEAL_MAX = 25;
const BUSINESS_PRIORITIES = [
  { key: 'Increase Revenue', icon: TrendingUp },
  { key: 'Reduce Cost', icon: DollarSign },
  { key: 'Optimize Operations', icon: Cog },
  { key: 'Mitigate Risk', icon: Shield },
  { key: 'Empower Talent', icon: Users },
  { key: 'Enhance Experience', icon: Star },
  { key: 'Drive Innovation', icon: Rocket },
  { key: 'Achieve ESG', icon: Leaf },
  { key: 'Protect Revenue', icon: Lock },
  { key: 'Execute Strategy', icon: Crosshair },
];

function flattenPreviewFromResults(results) {
  const out = [];
  if (!results?.domains || !Array.isArray(results.domains)) return out;
  for (const domain of results.domains) {
    const ucs = Array.isArray(domain?.use_cases) ? domain.use_cases : [];
    for (const uc of ucs) {
      out.push({
        ...uc,
        _domain: domain.domain_name || '',
        Name: uc.Name || uc.use_case_name || uc.name || '',
        Statement: uc.Statement || uc.description || uc.problem_statement || '',
      });
    }
  }
  return out;
}

function keyOfUseCase(uc) {
  return uc.Name || uc.use_case_name || uc.name || 'Use case';
}

function blurbOfUseCase(uc) {
  return placeholderWords(uc.Statement || uc.description || uc.problem_statement || uc.Solution || '');
}

/** Optional warehouse_id improves UC browsing for service principals (SQL SHOW … fallback). */
function pickerReadFailure(what, parent, err) {
  return `Inspire could not list the ${what} of ${parent}: ${parseApiErrorMessage(err?.message || String(err))}`;
}

function prefillNoteOf(session) {
  const started = formatWhen(utcDate(session.create_at));
  return started ? `Prefilled from this business's last run, started ${started}.` : "Prefilled from this business's last run.";
}

const defaultParams = (inspireDatabase) => ({
  '15_operation': 'Discover Use Cases',
  '00_business_name': '',
  '01_uc_metadata': '',
  '02_inspire_database': inspireDatabase || '',
  '03_discovery_type': DISCOVERY_RECOMMENDED,
  '04_table_election': 'Let Inspire Decides',
  '05_use_cases_quality': 'Good',
  '06_business_domains': '',
  '07_business_priorities': '',
  '08_generation_instructions': '',
  '10_strategic_context': '',
  '11_generation_path': '',
  '13_generate_genie_code_for': '0',
  '14_session_id': '',
  '16_best_of_best_count': '',
});
const DRAFT_PARAMS = ['00_business_name', '03_discovery_type', '04_table_election', '05_use_cases_quality', '06_business_domains', '08_generation_instructions',
  '11_generation_path', '13_generate_genie_code_for', '16_best_of_best_count'];
const FORM_DEFAULTS = {
  priorityChecks: {}, customPriorities: [], strategyBase: '',
  selectedCatalogs: [], wholeCatalogs: [], selectedSchemas: [], selectedTables: [], tableScopes: {}, dataFilterLabel: { on: false, text: null }, relationships: [],
  electionTouched: false, discoveryTouched: false, strategyTouched: false, prioritiesTouched: false,
};
const FLAGS = ['electionTouched', 'discoveryTouched', 'strategyTouched', 'prioritiesTouched'];
const LISTS = ['customPriorities', 'selectedCatalogs', 'selectedSchemas', 'selectedTables'];

function draftFormOf(params, form) {
  const priorityChecks = Object.fromEntries(Object.entries(form.priorityChecks).filter(([, on]) => on === true));
  return { ...form, priorityChecks, tableScopes: form.tableScopes, params: Object.fromEntries(DRAFT_PARAMS.map((key) => [key, params[key]])) };
}

const PRISTINE_FORM = JSON.stringify(draftFormOf(defaultParams(''), FORM_DEFAULTS));

function restoredForm(draft) {
  const spec = draft && draft.step === START_DRAFT_STEP ? draft.spec : null;
  if (!spec || typeof spec !== 'object') return null;
  const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const checks = (v, fallback) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, on]) => typeof on === 'boolean')) : fallback);
  const saved = spec.params && typeof spec.params === 'object' ? spec.params : {};
  return {
    params: Object.fromEntries(DRAFT_PARAMS.filter((key) => ['string', 'number'].includes(typeof saved[key])).map((key) => [key, String(saved[key])])),
    priorityChecks: checks(spec.priorityChecks, {}),
    strategyBase: typeof spec.strategyBase === 'string' ? spec.strategyBase : '',
    ...Object.fromEntries(LISTS.map((key) => [key, Array.isArray(spec[key]) ? spec[key].filter((x) => typeof x === 'string') : []])),
    // A draft saved before wholeCatalogs existed took every listed catalog as whole, so it restores that way. A catalog with a picked
    // schema or table under it is not whole (REQ-388), so a profile saved before that fix restores without the stale flag.
    wholeCatalogs: wholeCatalogsWithoutPicks(
      (Array.isArray(spec.wholeCatalogs) ? spec.wholeCatalogs : Array.isArray(spec.selectedCatalogs) ? spec.selectedCatalogs : [])
        .filter((x) => typeof x === 'string'),
      listOf(spec.selectedSchemas), listOf(spec.selectedTables)),
    tableScopes: scopesFromObject(spec.tableScopes).scopes,
    dataFilterLabel: restoredLabel(spec.dataFilterLabel),
    relationships: restoredRelationshipList(spec.relationships),
    ...Object.fromEntries(FLAGS.map((key) => [key, spec[key] === true])),
    // The profile the draft was loaded from (REQ-364): a reload keeps the link, so an unchanged profile still runs without the question.
    profile: draft && draft.profile ? draft.profile : null,
  };
}

function restoredLabel(value) {
  const on = !!(value && typeof value === 'object' && value.on === true);
  const text = value && typeof value === 'object' && typeof value.text === 'string' ? value.text : null;
  return { on, text };
}

// REQ-577: with a `step`, LaunchPage renders only that Start New Discovery step's part of the form, into wiz.slot, and the shell drives it
// through the wiz controller { slot, findPath, api, onState }. Without a step it is the full form.
const WIZ_PARAM_KEY = /^(0[2-9]|1[0-3]|16)_/;
const NOOP = () => {};

export default function LaunchPage({ settings, update = NOOP, onLaunched, onOpenResults, step, wiz }) {
  const wizMode = Boolean(step);
  const { databricksHost, token, notebookPath, warehouseId, inspireDatabase, serverEnvHasPat } = settings;
  const canUseUcApi = !!(databricksHost && (token || serverEnvHasPat));

  const draftKey = useMemo(() => startDraftKey({ host: databricksHost }), [databricksHost]);
  const [draft] = useState(() => (wizMode ? null : restoredForm(readWizardDraft(draftKey, START_DRAFT_STAMP))));
  const [draftBack, setDraftBack] = useState(Boolean(draft));
  const start = draft || FORM_DEFAULTS;
  // The profile the form was loaded from, with its saved settings (REQ-364). Declared before the draft effect, which saves it.
  const [loadedProfile, setLoadedProfile] = useState(start.profile || null);

  // ── Widget params (must match notebook widget names exactly) ──
  const [params, setParams] = useState(() => ({ ...defaultParams(inspireDatabase), ...(draft ? draft.params : {}) }));

  // ── Catalog/Schema pickers ──
  const [catalogs, setCatalogs] = useState([]);
  // REQ-521: "Show everything" lists what the person cannot read too, each with a box to request access; requestPicks are those boxes.
  const [showEverything, setShowEverything] = useState(false);
  const [requestPicks, setRequestPicks] = useState([]);
  const [catalogsCut, setCatalogsCut] = useState(false);
  const [schemas, setSchemas] = useState([]);
  const [selectedCatalogs, setSelectedCatalogs] = useState(start.selectedCatalogs);
  // The catalogs picked whole. A selected catalog that is not here only lists its schemas (browse); nothing under it is read.
  const [wholeCatalogs, setWholeCatalogs] = useState(start.wholeCatalogs);
  const [selectedSchemas, setSelectedSchemas] = useState(start.selectedSchemas);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  // REQ-420: the Permission Required entries for the catalogs the App can read only in part, and the notice for a saved pick the App can no longer read.
  const [catalogPermissions, setCatalogPermissions] = useState([]);
  const [grantsListed, setGrantsListed] = useState(false);
  const [droppedNote, setDroppedNote] = useState('');
  const [schemaSearch, setSchemaSearch] = useState('');

  // ── Table state ──
  const [tables, setTables] = useState([]);
  // The load of the picked schemas' tables in flight. Its cancel flag is the page's request pattern for schema loads: a selection change
  // ends it, and Try again checks the flag before it lists a schema, so a late answer for a schema no longer picked is dropped.
  const tablesLoad = useRef(null);
  const [selectedTables, setSelectedTables] = useState(start.selectedTables);
  const [tableScopes, setTableScopes] = useState(start.tableScopes);
  const [dataFilterLabel, setDataFilterLabel] = useState(start.dataFilterLabel);
  const [relationships, setRelationships] = useState(start.relationships);
  const [showDataFilters, setShowDataFilters] = useState(false);
  const [dataFilterProblems, setDataFilterProblems] = useState([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableSearch, setTableSearch] = useState('');

  // ── Launch state ──
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [labelProgress, setLabelProgress] = useState(null); // REQ-585 9: { done, total } of the tables the App has labelled for the launch
  const [catalogBrowseError, setCatalogBrowseError] = useState('');
  const [schemasReadError, setSchemasReadError] = useState('');
  const [tablesReadError, setTablesReadError] = useState('');
  const [tablesLeftOut, setTablesLeftOut] = useState([]);
  const [catalogsWhy, setCatalogsWhy] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [discoveryTouched, setDiscoveryTouched] = useState(start.discoveryTouched);
  const [electionTouched, setElectionTouched] = useState(start.electionTouched);
  const [strategyTouched, setStrategyTouched] = useState(start.strategyTouched);
  const [prefillNote, setPrefillNote] = useState('');

  const [sessionsList, setSessionsList] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [allCreatedUcs, setAllCreatedUcs] = useState([]);
  const [allCreatedError, setAllCreatedError] = useState('');
  const [quickViewSid, setQuickViewSid] = useState(null);
  const [quickViewCache, setQuickViewCache] = useState({});
  const [quickViewLoading, setQuickViewLoading] = useState(null);
  /** Experiments list + quick view — collapsed by default to keep Get Started above the fold */
  const [experimentsOverviewExpanded, setExperimentsOverviewExpanded] = useState(false);
  // Page More: the past-runs overview and the privacy note stay off the form until picked (REQ-510 L3).
  const [showRecentRuns, setShowRecentRuns] = useState(false);
  const [showPrivacyNote, setShowPrivacyNote] = useState(false);

  // ── Metadata picker state ──
  const [pickerExpanded, setPickerExpanded] = useState(true);
  const [metadataPreviewExpanded, setMetadataPreviewExpanded] = useState(false);

  // ── Multiselects ──
  const [priorityChecks, setPriorityChecks] = useState(start.priorityChecks);
  const [customPriorities, setCustomPriorities] = useState(start.customPriorities);
  const [customPriorityDraft, setCustomPriorityDraft] = useState('');
  const [strategyBase, setStrategyBase] = useState(start.strategyBase);


  // In Databricks App mode, the proxy injects x-forwarded-access-token automatically.
  // Only send explicit auth headers when the user has configured a PAT token locally.
  const apiFetch = useCallback(
    async (url, { raise = true, ...opts } = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...opts.headers,
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-DB-PAT-Token'] = token;
      }
      if (databricksHost) headers['X-Databricks-Host'] = databricksHost;
      const resp = await fetch(url, { ...opts, headers });
      if (!resp.ok) throw await responseError(resp, { raise });
      return resp.json();
    },
    [token, databricksHost]
  );
  const outputCheck = useOutputFolderCheck(apiFetch, params['11_generation_path']);

  // RC7-C-04: the footer names the SQL warehouse; until the list answers (or when it fails) the label falls back to "SQL warehouse <id>".
  const [warehouses, setWarehouses] = useState([]);
  useEffect(() => {
    if (!warehouseId) return undefined;
    let cancelled = false;
    apiFetch('/api/warehouses')
      .then((data) => { if (!cancelled) setWarehouses(data.warehouses || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [warehouseId, apiFetch]);

  // Sync inspire database from settings
  useEffect(() => {
    if (inspireDatabase) {
      setParams((p) => ({ ...p, '02_inspire_database': inspireDatabase }));
    }
  }, [inspireDatabase]);

  const previewDb = inspireDatabase || params['02_inspire_database'];

  // Experiments list + all use cases (for per-session counts) when opening Get Started.
  useEffect(() => {
    if (!databricksHost || !(token || serverEnvHasPat) || !warehouseId || !previewDb) {
      setSessionsList([]);
      setAllCreatedUcs([]);
      setOverviewLoading(false);
      setOverviewError('');
      setAllCreatedError('');
      setQuickViewSid(null);
      setQuickViewCache({});
      setQuickViewLoading(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      setOverviewError('');
      setAllCreatedError('');
      setQuickViewSid(null);
      setQuickViewCache({});
      try {
        const qSessions = new URLSearchParams({
          inspire_database: previewDb,
          warehouse_id: warehouseId,
        });
        const qAll = new URLSearchParams({
          inspire_database: previewDb,
          warehouse_id: warehouseId,
          all_sessions: '1',
          limit: '400',
        });
        const [sessionPayload, allUcPayload] = await Promise.all([
          apiFetch(`/api/inspire/sessions?${qSessions}`),
          apiFetch(`/api/inspire/usecases?${qAll}`).catch((e) => ({
            usecases: [],
            _err: e.message || 'Could not load use cases',
          })),
        ]);
        if (cancelled) return;
        setSessionsList(sessionPayload.sessions || []);
        if (sessionPayload.connection_error) setOverviewError(sessionPayload.connection_error);
        if (allUcPayload._err) setAllCreatedError(allUcPayload._err);
        else setAllCreatedUcs(allUcPayload.usecases || []);
      } catch (e) {
        if (!cancelled) {
          setOverviewError(e.message || 'Could not load runs');
          setSessionsList([]);
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [databricksHost, token, serverEnvHasPat, warehouseId, previewDb, apiFetch]);

  const useCaseCountBySession = useMemo(() => {
    const m = new Map();
    for (const uc of allCreatedUcs) {
      const k = String(uc.session_id ?? '');
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [allCreatedUcs]);

  const fetchUseCasesForSession = useCallback(
    async (sid) => {
      const q = new URLSearchParams({
        inspire_database: previewDb,
        warehouse_id: warehouseId,
        session_id: String(sid),
      });
      let ucs = [];
      try {
        const ucData = await apiFetch(`/api/inspire/usecases?${q}`);
        if (ucData.usecases?.length) ucs = ucData.usecases;
      } catch { /* fall through */ }
      if (ucs.length === 0) {
        try {
          const resData = await apiFetch(`/api/inspire/results?${q}`);
          if (resData.results) ucs = flattenPreviewFromResults(resData.results);
        } catch { /* ignore */ }
      }
      if (ucs.length === 0) {
        try {
          const step = await apiFetch(`/api/inspire/step-results?${q}`);
          if (step.results) ucs = flattenPreviewFromResults(step.results);
        } catch { /* ignore */ }
      }
      return ucs;
    },
    [previewDb, warehouseId, apiFetch]
  );

  const getUcsForSession = useCallback(
    (sid) => {
      const id = String(sid);
      const fromTable = allCreatedUcs.filter((uc) => String(uc.session_id) === id);
      if (fromTable.length > 0) return fromTable;
      if (Object.prototype.hasOwnProperty.call(quickViewCache, id)) return quickViewCache[id];
      return null;
    },
    [allCreatedUcs, quickViewCache]
  );

  const onQuickViewToggle = useCallback(
    async (sid) => {
      const id = String(sid);
      if (quickViewSid === id) {
        setQuickViewSid(null);
        return;
      }
      setQuickViewSid(id);
      const fromTable = allCreatedUcs.filter((uc) => String(uc.session_id) === id);
      if (fromTable.length > 0) return;
      if (Object.prototype.hasOwnProperty.call(quickViewCache, id)) return;
      setQuickViewLoading(id);
      try {
        const ucs = await fetchUseCasesForSession(id);
        setQuickViewCache((prev) => ({ ...prev, [id]: ucs }));
      } catch {
        setQuickViewCache((prev) => ({ ...prev, [id]: [] }));
      } finally {
        setQuickViewLoading((cur) => (cur === id ? null : cur));
      }
    },
    [quickViewSid, allCreatedUcs, quickViewCache, fetchUseCasesForSession]
  );

  // "More > Recent runs" opens the list with the latest run's Quick view already showing (REQ-510 L3).
  const autoQuickViewDone = useRef(false);
  useEffect(() => {
    if (!showRecentRuns || autoQuickViewDone.current || sessionsList.length === 0) return;
    autoQuickViewDone.current = true;
    onQuickViewToggle(sessionsList[0].session_id);
  }, [showRecentRuns, sessionsList, onQuickViewToggle]);

  // Sync business priorities
  useEffect(() => {
    const sel = Object.entries(priorityChecks).filter(([, v]) => v).map(([k]) => k);
    setParams((p) => ({ ...p, '07_business_priorities': sel.join(',') }));
  }, [priorityChecks]);

  // REQ-522: a catalog or schema Inspire cannot read opens to browse but is never read whole (a run reads as Inspire).
  const inspireBlocked = useMemo(() => new Set([
    ...catalogs.filter((c) => accessNeedOf(c).includes('inspire')).map((c) => c.name),
    ...schemas.filter((s) => accessNeedOf(s).includes('inspire')).map((s) => s.full_name),
  ]), [catalogs, schemas]);
  const scope = useMemo(() => pickedScope(selectedCatalogs, selectedSchemas.filter((s) => !inspireBlocked.has(s)), selectedTables, wholeCatalogs.filter((c) => !inspireBlocked.has(c))),
    [selectedCatalogs, selectedSchemas, selectedTables, wholeCatalogs, inspireBlocked]);
  const scopeTables = useMemo(() => pickedTableNames(tableScopes, scope), [tableScopes, scope]);
  // The label is off whenever no picked table has a Row Group. The state follows that rule, and the typed text is kept for when a group comes back.
  useEffect(() => {
    if (dataFilterLabel.on && !labelAvailable(tableScopes, scopeTables)) setDataFilterLabel((l) => ({ ...l, on: false }));
  }, [dataFilterLabel.on, tableScopes, scopeTables]);
  // RC7-B-07: the basket and the footer count what the person picked; `scope` is what the run reads (a schema Inspire cannot read yet is left out of it).
  const pickedAll = useMemo(() => pickedScope(selectedCatalogs, selectedSchemas, selectedTables, wholeCatalogs.filter((c) => !inspireBlocked.has(c))),
    [selectedCatalogs, selectedSchemas, selectedTables, wholeCatalogs, inspireBlocked]);
  const scopeText = scopeSummary(pickedAll);
  const leftOutCount = pickedAll.schemas.length - scope.schemas.length;

  useEffect(() => {
    setParams((p) => ({
      ...p,
      '01_uc_metadata': scope.entries.join(','),
      ...(electionTouched ? {} : { '04_table_election': scope.tables.length ? 'All Tables' : 'Let Inspire Decides' }),
    }));
  }, [scope, electionTouched]);

  // Load catalogs — host required; browser PAT optional when server has SP OAuth / DATABRICKS_TOKEN.
  useEffect(() => {
    if (!canUseUcApi) {
      setCatalogs([]);
      setCatalogsCut(false);
      setGrantsListed(false);
      setLoadingCatalogs(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingCatalogs(true);
      setCatalogBrowseError('');
      setCatalogsWhy('');
      let lastError = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const data = await apiFetch(`/api/catalogs${tableBrowseQuery(warehouseId, showEverything)}`);
          const cats = data.catalogs || [];
          console.log(`[catalogs] loaded ${cats.length}:`, cats.map(c => c.name));
          if (!cancelled) {
            setCatalogs(cats);
            setCatalogsCut(Boolean(data.truncated));
            setCatalogPermissions(Array.isArray(data.permissions) ? data.permissions : []);
            setGrantsListed(data.spGrants === true && !data.truncated);
            if (cats.length === 0 && data.restError) {
              setCatalogBrowseError(data.restError);
            }
            setLoadingCatalogs(false);
          }
          return;
        } catch (err) {
          lastError = err.message || String(err);
          if (err.status) {
            if (!cancelled) {
              setCatalogs([]);
              setCatalogsCut(false);
              if (err.status === 401) setCatalogsWhy(lastError);
              else setCatalogBrowseError(lastError);
              setLoadingCatalogs(false);
            }
            return;
          }
          console.warn(`[catalogs] attempt ${attempt} error:`, lastError);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (!cancelled) {
        setCatalogBrowseError(lastError || 'Could not load Unity Catalog metadata.');
        setLoadingCatalogs(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [canUseUcApi, apiFetch, warehouseId, showEverything]);

  // REQ-420: a saved draft or profile that holds a catalog the App can no longer read loses it, with one line saying so. Only a list read
  // from the App's own grants decides this; a failed or cut list never drops anything.
  useEffect(() => {
    if (!grantsListed) return;
    const dropped = droppedCatalogNames(catalogs, [...selectedCatalogs, ...wholeCatalogs, ...selectedSchemas, ...selectedTables]);
    if (!dropped.length) return;
    const gone = (name) => dropped.includes(String(name).split('.')[0]);
    setSelectedCatalogs((p) => p.filter((n) => !gone(n)));
    setWholeCatalogs((p) => p.filter((n) => !gone(n)));
    setSelectedSchemas((p) => p.filter((n) => !gone(n)));
    setSelectedTables((p) => p.filter((n) => !gone(n)));
    setTableScopes((p) => Object.fromEntries(Object.entries(p || {}).filter(([n]) => !gone(n))));
    setDroppedNote(`Inspire can no longer read ${dropped.join(', ')}, so ${dropped.length === 1 ? 'it was' : 'they were'} taken off your selection.`);
  }, [grantsListed, catalogs, selectedCatalogs, wholeCatalogs, selectedSchemas, selectedTables]);

  // Load schemas when catalogs selected
  useEffect(() => {
    setSchemasReadError('');
    if (selectedCatalogs.length === 0) { setSchemas([]); setLoadingSchemas(false); return; }
    if (!canUseUcApi) { setSchemas([]); setLoadingSchemas(false); return; }
    let cancelled = false;
    setLoadingSchemas(true);
    const failed = [];
    Promise.all(
      selectedCatalogs.map((cat) =>
        apiFetch(`/api/catalogs/${encodeURIComponent(cat)}/schemas${tableBrowseQuery(warehouseId, showEverything)}`)
          .then(d => d.schemas || [])
          .catch((err) => { failed.push(pickerReadFailure('schemas', cat, err)); return []; })
      )
    ).then((r) => {
      if (!cancelled) {
        const all = r.flat();
        console.log(`[schemas] loaded ${all.length} for ${selectedCatalogs.join(',')}`);
        setSchemas(all);
        setSchemasReadError(failed.join('\n'));
      }
    }).finally(() => { if (!cancelled) setLoadingSchemas(false); });
    return () => { cancelled = true; };
  }, [selectedCatalogs, canUseUcApi, apiFetch, warehouseId, showEverything]);

  // Load tables when schemas selected
  useEffect(() => {
    setTablesReadError('');
    setTablesLeftOut([]);
    // A listing the effect left behind (a pick removed while it loaded) never reports back, so the flag is cleared here, not by its finally.
    if (selectedSchemas.length === 0) { setTables([]); setLoadingTables(false); return; }
    if (!canUseUcApi) { setTables([]); setLoadingTables(false); return; }
    const load = { cancelled: false };
    tablesLoad.current = load;
    setLoadingTables(true);
    const failed = [];
    const leftOutNotes = [];
    Promise.all(
      selectedSchemas.map((schemaFullName) => listSchemaTables(schemaFullName, apiFetch, warehouseId, showEverything)
        .then(({ rows, leftOut }) => { if (leftOut) leftOutNotes.push(leftOut); return rows; })
        .catch((err) => { failed.push(pickerReadFailure('tables', schemaFullName, err)); return []; }))
    ).then((r) => {
      if (!load.cancelled) {
        const allTables = r.flat();
        console.log(`[tables] loaded ${allTables.length} for ${selectedSchemas.join(',')}`);
        setTables(allTables);
        setTablesReadError(failed.join('\n'));
        setTablesLeftOut(leftOutNotes.filter(Boolean));
      }
    }).finally(() => { if (!load.cancelled) setLoadingTables(false); });
    return () => { load.cancelled = true; };
  }, [selectedSchemas, canUseUcApi, apiFetch, warehouseId, showEverything]);

  // Try again on a table whose type check was busy: list its schema again and replace that schema's rows.
  const tryAgainTables = (item) => {
    const schemaFullName = item.full_name.split('.').slice(0, 2).join('.');
    const load = tablesLoad.current;
    // A selection change after this click ends the load it belongs to, so its answer is dropped (the schemas are listed again).
    const live = () => Boolean(load) && !load.cancelled;
    listSchemaTables(schemaFullName, apiFetch, warehouseId, showEverything)
      .then(({ rows }) => {
        if (!live()) return;
        const prefix = `${schemaFullName}.`;
        setTables((prev) => [...prev.filter((t) => !String(t.full_name).startsWith(prefix)), ...rows]);
      })
      .catch((err) => {
        if (live()) setTablesReadError((prev) => [prev, pickerReadFailure('tables', schemaFullName, err)].filter(Boolean).join('\n'));
      });
  };

  // Auto-populate inspire database when first catalog is selected
  useEffect(() => {
    if (selectedCatalogs.length === 1 && selectedCatalogs[0] !== 'samples' && !params['02_inspire_database']) {
      const autoVal = `${selectedCatalogs[0]}._inspire`;
      setParams((p) => ({ ...p, '02_inspire_database': autoVal }));
      update('inspireDatabase', autoVal);
    }
  }, [selectedCatalogs]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateParam = (key, val) => {
    setParams((p) => ({ ...p, [key]: val }));
    if (key === '04_table_election') setElectionTouched(true);
    if (key === '02_inspire_database') {
      update('inspireDatabase', val);
    }
  };

  const strategicContextText = params['10_strategic_context'];
  const strategyBaseRef = useRef(strategyBase);
  useEffect(() => {
    strategyBaseRef.current = strategyBase;
  }, [strategyBase]);
  const [strategyEditorKey, setStrategyEditorKey] = useState(0);
  const [prioritiesTouched, setPrioritiesTouched] = useState(start.prioritiesTouched);

  const draftForm = useMemo(() => draftFormOf(params, {
    priorityChecks, customPriorities, strategyBase, selectedCatalogs, wholeCatalogs, selectedSchemas, selectedTables, tableScopes, dataFilterLabel, relationships,
    electionTouched, discoveryTouched, strategyTouched, prioritiesTouched,
  }), [params, priorityChecks, customPriorities, strategyBase, selectedCatalogs, wholeCatalogs, selectedSchemas, selectedTables, tableScopes, dataFilterLabel, relationships,
    electionTouched, discoveryTouched, strategyTouched, prioritiesTouched]);
  useEffect(() => {
    if (wizMode) return;
    if (JSON.stringify(draftForm) === PRISTINE_FORM && !loadedProfile) clearWizardDraft(draftKey);
    else writeWizardDraft(draftKey, { stamp: START_DRAFT_STAMP, spec: draftForm, step: START_DRAFT_STEP, profile: loadedProfile });
  }, [draftKey, draftForm, loadedProfile]);

  // One code path sets the whole form: Start over sets the defaults, and a picked profile sets its saved settings.
  const applyForm = (form) => {
    setParams(form.params);
    setPriorityChecks(form.priorityChecks);
    setCustomPriorities(form.customPriorities);
    setStrategyBase(form.strategyBase);
    setSelectedCatalogs(form.selectedCatalogs);
    setWholeCatalogs(form.wholeCatalogs);
    setSelectedSchemas(form.selectedSchemas);
    setSelectedTables(form.selectedTables);
    setTableScopes(form.tableScopes);
    setDataFilterLabel(form.dataFilterLabel);
    setRelationships(form.relationships || []);
    setElectionTouched(form.electionTouched);
    setDiscoveryTouched(form.discoveryTouched);
    setStrategyTouched(form.strategyTouched);
    setPrioritiesTouched(form.prioritiesTouched);
    setPrefillNote('');
    setStrategyEditorKey((k) => k + 1);
  };

  const startOver = () => {
    clearWizardDraft(draftKey);
    setDraftBack(false);
    setLoadedProfile(null);
    applyForm({ ...FORM_DEFAULTS, params: defaultParams(inspireDatabase) });
  };

  const handleStrategyChange = useCallback((value) => {
    if (strategyBaseRef.current === value) return;
    strategyBaseRef.current = value;
    setStrategyTouched(true);
    setStrategyBase(value);
  }, []);

  const selectedBuiltInPriorities = useMemo(
    () => BUSINESS_PRIORITIES.map((bp) => bp.key).filter((key) => priorityChecks[key]),
    [priorityChecks],
  );

  useEffect(() => {
    const merged = customPriorities.length ? [...selectedBuiltInPriorities, ...customPriorities] : [];
    const value = withPriorities(strategyBase, merged);
    setParams((p) => (p['10_strategic_context'] === value ? p : { ...p, '10_strategic_context': value }));
  }, [strategyBase, selectedBuiltInPriorities, customPriorities]);

  const toggleBuiltInPriority = (key) => {
    setPrioritiesTouched(true);
    setPriorityChecks((p) => ({ ...p, [key]: !p[key] }));
  };

  const addCustomPriority = () => {
    const name = customPriorityDraft.trim();
    if (!name) return;
    setPrioritiesTouched(true);
    const builtIn = BUSINESS_PRIORITIES.find((bp) => bp.key.toLowerCase() === name.toLowerCase());
    if (builtIn) setPriorityChecks((p) => ({ ...p, [builtIn.key]: true }));
    else setCustomPriorities((c) => (c.some((x) => x.toLowerCase() === name.toLowerCase()) ? c : [...c, name]));
    setCustomPriorityDraft('');
  };

  const removeCustomPriority = (name) => {
    setPrioritiesTouched(true);
    setCustomPriorities((c) => c.filter((x) => x !== name));
  };

  useEffect(() => {
    const name = String(params['00_business_name'] || '').trim().toLowerCase();
    if (!name || !warehouseId || !previewDb || (discoveryTouched && strategyTouched)) return undefined;
    const match = sessionsList.find((s) => !s.starting && String(s.business_name || '').trim().toLowerCase() === name);
    if (!match) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ inspire_database: previewDb, warehouse_id: warehouseId, session_id: String(match.session_id) });
        const data = await apiFetch(`/api/inspire/session?${q}`);
        if (cancelled) return;
        const wv = data?.session?.widget_values || {};
        const next = {};
        const storedDiscovery = discoveryTypeOf(wv.discovery_type);
        if (!discoveryTouched && storedDiscovery) {
          next['03_discovery_type'] = storedDiscovery;
        }
        const savedStrategy = !strategyTouched && wv.strategic_context ? String(wv.strategic_context) : '';
        const prefillStrategy = savedStrategy && !validateStrategicContextText(savedStrategy).length ? savedStrategy : '';
        if (Object.keys(next).length || prefillStrategy) {
          if (Object.keys(next).length) setParams((p) => ({ ...p, ...next }));
          if (prefillStrategy) {
            const saved = splitPriorities(parseStrategicContext(prefillStrategy).model.priorities, BUSINESS_PRIORITIES.map((bp) => bp.key));
            if (!prioritiesTouched && (saved.builtIn.length || saved.custom.length)) {
              setPriorityChecks(Object.fromEntries(saved.builtIn.map((key) => [key, true])));
              setCustomPriorities(saved.custom);
            }
            setStrategyBase(withPriorities(prefillStrategy, []));
            setStrategyEditorKey((k) => k + 1);
          }
          setPrefillNote(prefillNoteOf(match));
        }
      } catch {
        if (!cancelled) setPrefillNote('');
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params['00_business_name'], sessionsList, warehouseId, previewDb, discoveryTouched, strategyTouched, prioritiesTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const strategyProblems = useMemo(() => [
    ...validateStrategicContextText(strategicContextText),
    ...(customPriorities.length && parseStrategicContext(strategyBase).mode === 'path'
      ? ['Your own business priorities cannot be added to a strategy that comes from a file. Remove them or clear the strategy.']
      : []),
  ], [strategicContextText, customPriorities, strategyBase]);

  // ── Business profiles (REQ-364, REQ-365): named copies of this form, shared by everyone on the App ──
  const [profiles, setProfiles] = useState([]);
  const [profilesError, setProfilesError] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  // The save dialog: null when closed, else { name, confirmReplace } of the profile it would save. A listed name needs a second confirm.
  const [saveAsk, setSaveAsk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const loadProfiles = useCallback(async () => {
    if (!canUseUcApi) return;
    try {
      const data = await apiFetch('/api/inspire/profiles');
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setProfilesError('');
    } catch (err) {
      setProfilesError(parseApiErrorMessage(err.message));
    }
  }, [apiFetch, canUseUcApi]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  // A picked profile sets the whole form through applyForm, from its saved settings (restoredForm is the draft's own reader).
  // Every touch flag is set, so the last run's prefill never overwrites a value the profile saved.
  const pickProfile = async (profileId) => {
    if (!profileId) return setLoadedProfile(null);
    setProfileBusy(true);
    setProfilesError('');
    try {
      const data = await apiFetch(`/api/inspire/profiles/${encodeURIComponent(profileId)}`);
      const { profile: _drafted, ...form } = restoredForm({ step: START_DRAFT_STEP, spec: data.profile.spec });
      const applied = {
        ...form,
        params: { ...defaultParams(inspireDatabase), ...form.params },
        electionTouched: true,
        discoveryTouched: true,
        strategyTouched: true,
        prioritiesTouched: true,
      };
      applyForm(applied);
      // Compare later edits against the form as it was loaded, not the stored spec: a profile saved before a form key
      // existed (for example relationships) restores that key to its default, and that is not a change.
      setLoadedProfile({ profile_id: data.profile.profile_id, name: data.profile.name, spec: draftFormOf(applied.params, applied) });
    } catch (err) {
      setProfilesError(parseApiErrorMessage(err.message));
    } finally {
      setProfileBusy(false);
    }
  };

  const profileLabel = (p) => `${p.name}: updated by ${p.updated_by || 'someone'} on ${formatWhen(p.updated_at, 'an unknown date')}`;
  const profileNamed = (name) => profiles.find((p) => String(p.name).trim().toLowerCase() === String(name || '').trim().toLowerCase()) || null;

  const saveAndRun = async () => {
    const name = saveAsk.name.trim();
    const replacing = profileNamed(name);
    if (replacing && !saveAsk.confirmReplace) return setSaveAsk({ name: saveAsk.name, confirmReplace: true });
    setSaving(true);
    setSaveError('');
    try {
      const data = await apiFetch('/api/inspire/profiles', {
        method: 'POST',
        body: JSON.stringify({ name, business_name: params['00_business_name'], spec: draftForm, overwrite: Boolean(replacing) }),
      });
      setSaveAsk(null);
      setLoadedProfile({ profile_id: data.profile.profile_id, name: data.profile.name, spec: draftForm });
      loadProfiles();
      launchNow(data.profile.profile_id);
    } catch (err) {
      setSaveError(parseApiErrorMessage(err.message));
    } finally {
      setSaving(false);
    }
  };

  const runWithoutSaving = () => {
    setSaveAsk(null);
    launchNow('');
  };

  // The launch itself: the grant check, then the run. A profile id links the run to its profile once it is submitted.
  const launchNow = async (profileId = '') => {
    setLaunching(true);
    setLaunchError('');
    const finalParams = { ...params };
    // Always auto-generate session ID
    finalParams['14_session_id'] = newSessionId();
    const tableScopeText = launchTableScopeText(tableScopes, scope,
      dataFilterLabel.on ? (dataFilterLabel.text ?? groupLabelOf(filterValuesOf(tableScopes, scopeTables))) : '');
    if (tableScopeText) finalParams['17_table_scope'] = tableScopeText;
    // REQ-373: the joins the person drew between the tables the run reads; sent only when one applies.
    const relationshipText = launchRelationshipsText(relationships, scopeTables);
    if (relationshipText) finalParams['18_table_relationships'] = relationshipText;

    const startRun = async () => {
      // REQ-585 9: while the launch request is pending, ask how many tables the App has labelled so far.
      const sessionId = finalParams['14_session_id'];
      const poll = () => apiFetch(`/api/inspire/labels/progress?session_id=${encodeURIComponent(sessionId)}`, { raise: false })
        .then((got) => { if (got && got.total > 0) setLabelProgress({ done: got.done, total: got.total }); }).catch(() => {});
      poll();
      const pollTimer = setInterval(poll, 1000);
      try {
        const data = await withStartDeadline((signal) => apiFetch('/api/run', {
          method: 'POST',
          signal,
          body: JSON.stringify({
            notebook_path: notebookPath,
            params: finalParams,
            warehouse_id: warehouseId,
            profile_id: profileId || undefined,
          }),
        }), { label: 'The launch' });
        clearWizardDraft(draftKey);
        update('inspireDatabase', finalParams['02_inspire_database']);
        onLaunched?.(finalParams['14_session_id'], data.run_id, Array.isArray(data.warnings) ? data.warnings : [],
          Array.isArray(data.warning_details) ? data.warning_details : []);
      } catch (err) {
        setLaunchError(parseApiErrorMessage(err.message));
      } finally {
        clearInterval(pollTimer);
        setLabelProgress(null);
        setLaunching(false);
      }
    };
    try {
      const check = await withStartDeadline((signal) => apiFetch('/api/run/check', {
        raise: false,
        method: 'POST',
        signal,
        body: JSON.stringify({ params: finalParams, warehouse_id: warehouseId }),
      }), { label: 'The launch check' });
      if (Array.isArray(check.permissions) && check.permissions.length) {
        setLaunching(false);
        raisePermissions(check.permissions, { onStart: () => { setLaunching(true); startRun(); } }, { explicit: true });
        return;
      }
    } catch (err) {
      setLaunchError(parseApiErrorMessage(err.message));
      setLaunching(false);
      return;
    }
    await startRun();
  };

  // The wizard shell's handle on this form: the notebook params it holds, the start (no save-profile question) and the finish.
  const profileToStart = loadedProfile && sameSettings(draftForm, loadedProfile.spec) ? loadedProfile.profile_id : '';
  const launchParams = () => {
    const out = {};
    Object.entries(params).forEach(([key, value]) => {
      if (WIZ_PARAM_KEY.test(key) && (key !== '04_table_election' || !wiz?.findPath)) out[key] = value;
    });
    if (!wiz?.findPath) out['01_uc_metadata'] = params['01_uc_metadata'];
    out['15_operation'] = 'Discover Use Cases'; // REQ-578: the Discover path of the wizard has no Operation choice
    return out;
  };
  const wizStart = async () => {
    if (launchBlock) { setLaunchError(launchBlock); return false; }
    if (!outputCheck.ready) { setLaunchError(outputCheck.text || 'Wait until Inspire has checked that you can write to the output folder.'); return false; }
    await launchNow(profileToStart);
    return true;
  };
  if (wiz && wiz.api) {
    Object.assign(wiz.api, {
      launchParams, start: wizStart, profileId: profileToStart, setRelationships, setBusinessName: (value) => updateParam('00_business_name', value),
      finish: () => { clearWizardDraft(draftKey); update('inspireDatabase', params['02_inspire_database']); },
    });
  }
  const wizBusiness = params['00_business_name'];
  const wizHasData = Boolean(params['01_uc_metadata']);
  const wizProfile = loadedProfile ? loadedProfile.profile_id : '';
  const wizOnState = wiz?.onState;
  useEffect(() => {
    wizOnState?.({ business: wizBusiness, hasData: wizHasData, profileId: wizProfile, launching, launchError, labelProgress,
      summary: { quality: params['05_use_cases_quality'], discovery: params['03_discovery_type'], scope: params['01_uc_metadata'] }, tables: scopeTables });
  }, [wizOnState, scopeTables, wizBusiness, wizHasData, wizProfile, launching, launchError, labelProgress, params['05_use_cases_quality'], params['03_discovery_type'], params['01_uc_metadata']]);

  // Get Started asks to save the settings as a profile. A loaded profile whose settings are unchanged runs without asking.
  const handleLaunch = () => {
    if (launchBlock) return setLaunchError(launchBlock);
    if (!outputCheck.ready)
      return setLaunchError(outputCheck.text || 'Wait until Inspire has checked that you can write to the output folder.');
    if (loadedProfile && sameSettings(draftForm, loadedProfile.spec)) return launchNow(loadedProfile.profile_id);
    setSaveError('');
    return setSaveAsk({ name: String(params['00_business_name'] || '').trim(), confirmReplace: false });
  };

  // Derived
  const typedCatalogItem = typedCatalog(catalogs, catalogsCut, catalogSearch);
  const shownCatalogs = usableRows(catalogs, showEverything, selectedCatalogs, (c) => c.name);
  const filteredCatalogs = [
    ...shownCatalogs.filter((c) => !catalogSearch || c.name.toLowerCase().includes(catalogSearch.toLowerCase())),
    ...(typedCatalogItem ? [typedCatalogItem] : []),
  ];
  const filteredSchemas = usableRows(schemas, showEverything, selectedSchemas).filter(
    (s) => !schemaSearch || s.full_name.toLowerCase().includes(schemaSearch.toLowerCase())
  );
  const filteredTables = tables.filter(
    (t) => !tableSearch || t.full_name.toLowerCase().includes(tableSearch.toLowerCase())
  );

  // Every change to the picked schemas or tables goes through here: a catalog with a picked child is not whole (REQ-388).
  const setPickedChildren = (nextSchemas, nextTables) => {
    setWholeCatalogs((p) => wholeCatalogsWithoutPicks(p, nextSchemas, nextTables));
    setSelectedSchemas(nextSchemas);
    setSelectedTables(nextTables);
  };

  // Table select all / deselect all
  const pickableTables = filteredTables.filter((t) => accessNeedOf(t).length === 0);
  const allTablesSelected = pickableTables.length > 0 && pickableTables.every((t) => selectedTables.includes(t.full_name));
  const toggleAllTables = () => {
    if (allTablesSelected) {
      const filteredNames = new Set(filteredTables.map((t) => t.full_name));
      setPickedChildren(selectedSchemas, selectedTables.filter((t) => !filteredNames.has(t)));
    } else {
      const newNames = pickableTables.map((t) => t.full_name);
      setPickedChildren(selectedSchemas, [...new Set([...selectedTables, ...newNames])]);
    }
  };

  const togglePick = (type) => (item) => {
    const full = type === 'CATALOG' ? item.name : item.full_name;
    setRequestPicks((p) => (p.some((x) => x.full_name === full) ? p.filter((x) => x.full_name !== full) : [...p, { type, full_name: full, ...(accessNeedOf(item).includes('inspire') ? { need: accessNeedOf(item) } : {}) }]));
  };
  const requestOf = (type) => ({
    full: (item) => (type === 'CATALOG' ? item.name : item.full_name),
    picked: requestPicks.map((x) => x.full_name),
    onToggle: togglePick(type),
    full_up: requestPicks.length >= MAX_ACCESS_OBJECTS,
    openable: type !== 'TABLE',
  });
  const changeShowEverything = (on) => {
    setShowEverything(on);
    if (!on) setRequestPicks([]);
  };

  // Validation state
  const effectiveDb = params['02_inspire_database'] || inspireDatabase;
  const bestOfBestText = String(params['16_best_of_best_count'] ?? '').trim();
  const bestOfBestInvalid = bestOfBestText !== '' && (!/^\d{1,3}$/.test(bestOfBestText) || Number(bestOfBestText) > 100);
  const launchBlock = !params['00_business_name'] ? 'Enter a Business Name to get started.'
    : !effectiveDb ? 'Set the Inspire Database in Advanced Settings to get started.'
      : !params['01_uc_metadata'] ? 'Pick at least one catalog, schema or table under Unity Catalog Metadata to get started.'
        : strategyProblems.length ? `Fix the strategy first, in Advanced Settings under Strategy (optional): ${strategyProblems[0]}`
          : dataFilterProblems.length ? `Fix the data filters first, in Advanced Settings under Data Management (optional): ${dataFilterProblems[0]}`
          : bestOfBestInvalid ? 'Best of Best stars takes a whole number from 0 to 100. Fix it in Advanced Settings.' : '';
  const canLaunch = !launchBlock;
  const liveRunNote = useMemo(() => {
    const name = String(params['00_business_name'] || '').trim().toLowerCase();
    const at = Date.now();
    const live = name && sessionsList.find((s) => runBusiness(s).toLowerCase() === name && sessionStatus(s, at) === 'running');
    if (!live) return '';
    const percent = Number(live.completed_percent) > 0 ? ` (${Math.round(Number(live.completed_percent))}% done)` : '';
    const started = formatWhen(utcDate(live.create_at));
    return `${runBusiness(live)} already has a run going${percent}${started ? `, started ${started}` : ''}. Get Started starts a second run next to it, and each run keeps its own use cases.`;
  }, [params['00_business_name'], sessionsList]); // eslint-disable-line react-hooks/exhaustive-deps
  const advancedProblem = !effectiveDb ? 'Set the Inspire Database.'
    : strategyProblems.length ? `Fix the strategy: ${strategyProblems[0]}`
      : dataFilterProblems.length ? `Fix the data filters: ${dataFilterProblems[0]}`
      : bestOfBestInvalid ? 'Fix Best of Best stars: use a whole number from 0 to 100, or leave it empty.'
        : ['refused', 'error'].includes(outputCheck.state) ? 'Change the Generation Path: Inspire cannot write to it.' : '';
  useEffect(() => {
    if (advancedProblem) setShowAdvanced(true);
  }, [advancedProblem]);

  // A failed launch shows its reason at the top of the page; the Get Started button is at the bottom, so bring the reason into view.
  useEffect(() => {
    if (launchError) document.getElementById('launch-error')?.scrollIntoView?.({ block: 'center' });
  }, [launchError]);

  const launchErrorGuidance = useMemo(
    () => (launchError
      ? interpretUcPermissionError(launchError, {
        context: 'launch',
        inspireDatabase: effectiveDb,
        catalogs: selectedCatalogs,
        warehouseId,
      })
      : null),
    [launchError, effectiveDb, selectedCatalogs, warehouseId],
  );

  const catalogBrowseGuidance = useMemo(
    () => (catalogBrowseError
      ? interpretUcPermissionError(catalogBrowseError, {
        context: 'catalog_browse',
        inspireDatabase: effectiveDb,
        catalogs: selectedCatalogs,
        warehouseId,
      })
      : null),
    [catalogBrowseError, effectiveDb, selectedCatalogs, warehouseId],
  );
  const pickerReadError = [schemasReadError, tablesReadError].filter(Boolean).join('\n');
  const pickerReadGuidance = useMemo(
    () => (pickerReadError
      ? interpretUcPermissionError(pickerReadError, { context: 'catalog_browse', inspireDatabase: effectiveDb, catalogs: selectedCatalogs, warehouseId })
      : null),
    [pickerReadError, effectiveDb, selectedCatalogs, warehouseId],
  );

  const tableSelectionWarning = useMemo(() => {
    const longer = 'so this run will likely take longer.';
    if (scope.tables.length > TABLE_SELECTION_WARN_THRESHOLD) {
      return {
        show: true,
        heading: `You selected ${scope.tables.length} tables, ${longer}`,
        tableCount: scope.tables.length,
        scope: 'tables',
      };
    }
    if (scope.catalogs.length > 0) {
      const names = scope.catalogs.join(', ');
      return {
        show: true,
        heading: scope.catalogs.length === 1
          ? `The whole catalog ${names} is in scope, with all its schemas and tables, ${longer}`
          : `The ${scope.catalogs.length} whole catalogs ${names} are in scope, with all their schemas and tables, ${longer}`,
        tableCount: null,
        scope: 'catalogs',
      };
    }
    if (scope.schemas.length > 0) {
      const held = tables.filter((t) => scope.schemas.some((schema) => String(t.full_name).startsWith(`${schema}.`))).length;
      if (loadingTables || held <= TABLE_SELECTION_WARN_THRESHOLD) return { show: false };
      const names = scope.schemas.join(', ');
      return {
        show: true,
        heading: scope.schemas.length === 1
          ? `The schema ${names} holds ${counted(held, 'table')}, ${longer}`
          : `The ${scope.schemas.length} schemas ${names} hold ${counted(held, 'table')} in total, ${longer}`,
        tableCount: held,
        scope: 'schemas',
      };
    }
    return { show: false };
  }, [scope, tables, loadingTables]);

  /** Shown in the page `<h1>` — updates after a short typing pause or immediately on blur (“finished writing”). */
  const [headlineBusiness, setHeadlineBusiness] = useState('');
  useEffect(() => {
    const raw = (params['00_business_name'] || '').trim();
    if (!raw) {
      setHeadlineBusiness('');
      return undefined;
    }
    const id = setTimeout(() => setHeadlineBusiness(raw), 400);
    return () => clearTimeout(id);
  }, [params['00_business_name']]);

  const launchPageHeading = headlineBusiness
    ? `Discovering use cases for ${headlineBusiness}`
    : 'Get Started';

  const nameField = (
            <Field label="Business Name" required icon={Building2} hint="The company or business unit to analyze">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input dir="auto"
                  type="text"
                  placeholder="e.g. Contoso, Acme Corp, Retail Division"
                  value={params['00_business_name']}
                  onChange={(e) => updateParam('00_business_name', e.target.value)}
                  onBlur={(e) => setHeadlineBusiness((e.target.value || '').trim())}
                  className="min-w-0 flex-1 w-full ps-10 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth"
                />
                <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-text-primary">
                  <span className="whitespace-nowrap">{wizMode ? 'Load a saved profile' : 'Profile'}</span>
                  <select data-launch-profile="" aria-label="Business profile"
                    value={loadedProfile?.profile_id || ''}
                    disabled={profileBusy || launching}
                    onChange={(e) => pickProfile(e.target.value)}
                    className="min-w-0 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-primary glow-focus sm:w-80">
                    <option value="">No profile</option>
                    {/* The loaded profile is its own option, so the picker shows its name even when the list below does not carry it (REQ-390). */}
                    {loadedProfile && (
                      <option value={loadedProfile.profile_id}>
                        {sameSettings(draftForm, loadedProfile.spec) ? loadedProfile.name : `${loadedProfile.name} (changed)`}
                      </option>
                    )}
                    {profiles.filter((p) => p.profile_id !== loadedProfile?.profile_id).map((p) => <option key={p.profile_id} value={p.profile_id}>{profileLabel(p)}</option>)}
                  </select>
                </label>
              </div>
              {loadedProfile && (
                <p data-launch-profile-note="" role="status" className="mt-2 text-xs text-text-secondary">
                  {sameSettings(draftForm, loadedProfile.spec)
                    ? `This run uses the profile ${loadedProfile.name}.`
                    : `You changed the profile ${loadedProfile.name}. Get Started asks whether to save these settings.`}
                </p>
              )}
              {profilesError && <PlainMessage text={profilesError} role="alert" data-launch-profile-error="" className="mt-2 text-xs text-error-fg" />}
            </Field>
  );
  const ucField = (
            <Field label="Unity Catalog Metadata" required icon={Database} hint="Pick the catalogs, schemas or tables that hold your business data">
                {catalogBrowseGuidance && <UcPermissionErrorHelp guidance={catalogBrowseGuidance} />}
                {pickerReadGuidance && <UcPermissionErrorHelp guidance={pickerReadGuidance} />}
                {catalogsWhy && <PlainMessage text={catalogsWhy} role="note" data-uc-why="" className="mb-3 text-xs text-text-secondary" />}
                {/* Selected Metadata Basket — always visible */}
                {pickedAll.entries.length === 0 && (
                  <p data-scope-empty="" className="mb-3 text-xs text-text-tertiary">Nothing picked yet</p>
                )}
                {pickedAll.entries.length > 0 && (
                  <div className="mb-3 rounded-lg border border-db-red/20 bg-db-red-50/50 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <ShoppingCart size={14} className="text-db-red-fg" />
                      <span className="text-xs font-bold text-db-red-fg">Selected Metadata</span>
                      <span className="text-xs text-text-tertiary ms-auto">
                        {scopeText}
                      </span>
                    </div>
                    {leftOutCount > 0 && (
                      <p data-scope-unread="" className="mb-2 text-xs text-warning-fg">
                        {leftOutCount} of these need Inspire access and are left out of the run until Inspire can read them.
                      </p>
                    )}
                    <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1">
                      {selectedTables.map((t, i) => (
                        <span key={`${i}-${t}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-xs font-medium border border-db-red/20">
                          <Table2 size={14} />
                          {t.split('.').pop()}
                          <button aria-label={`Remove ${t}`} onClick={() => setPickedChildren(selectedSchemas, selectedTables.filter((x) => x !== t))} className="hover:text-db-red-fg ms-0.5"><X size={14} /></button>
                          {tableScopeOf(tableScopes, t) && (
                            <span data-table-scope-summary={t} className="text-text-secondary ms-0.5">{tableScopeSummary(tableScopeOf(tableScopes, t))}</span>
                          )}
                        </span>
                      ))}
                      {selectedSchemas.map((s, i) => (
                        <span key={`${i}-${s}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-xs font-medium border border-border">
                          {s}
                          <button aria-label={`Remove ${s}`} onClick={() => setPickedChildren(selectedSchemas.filter((x) => x !== s), selectedTables)} className="hover:text-db-red-fg ms-0.5"><X size={14} /></button>
                        </span>
                      ))}
                      {selectedCatalogs.filter((c) => !inspireBlocked.has(c)).map((c, i) => (
                        <span key={`${i}-${c}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-xs font-medium border border-border">
                          <Database size={14} />
                          {c}
                          <button aria-label={`Remove ${c}`} onClick={() => { setSelectedCatalogs((p) => p.filter((x) => x !== c)); setWholeCatalogs((p) => p.filter((x) => x !== c)); setSelectedSchemas((p) => p.filter((x) => !x.startsWith(c + '.'))); }} className="hover:text-db-red-fg ms-0.5"><X size={14} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {tableSelectionWarning.show && (
                  <TableSelectionGuidanceWarning
                    heading={tableSelectionWarning.heading}
                    tableCount={tableSelectionWarning.tableCount}
                    scope={tableSelectionWarning.scope}
                    idealMax={TABLE_SELECTION_IDEAL_MAX}
                  />
                )}

                {/* Collapsible picker toggle */}
                <button
                  type="button"
                  onClick={() => setPickerExpanded(!pickerExpanded)}
                  className="flex items-center gap-2 mb-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-smooth"
                >
                  <div className={`transition-transform duration-200 ${pickerExpanded ? 'rotate-180' : ''}`}>
                    <ChevronDown size={14} />
                  </div>
                  {pickerExpanded ? 'Hide catalog browser' : 'Browse catalogs'}
                  {!pickerExpanded && pickedAll.entries.length > 0 && (
                    <span className="text-xs text-db-red-fg font-medium ms-1">
                      ({scopeText} selected)
                    </span>
                  )}
                </button>

                {pickerExpanded && (
                  <label className="flex items-center gap-2 mb-2 text-xs text-text-secondary">
                    <input type="checkbox" checked={showEverything} onChange={(e) => changeShowEverything(e.target.checked)} />
                    Show everything
                  </label>
                )}
                {pickerExpanded && (
                  <RequestAccessBar
                    objects={requestPicks}
                    onSent={(sent) => setRequestPicks((p) => p.filter((x) => !sent.includes(x.full_name)))}
                  />
                )}

                {pickerExpanded && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Catalogs */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs font-semibold text-text-secondary">Catalogs</span>
                        {loadingCatalogs && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
                      </div>
                      {droppedNote && <p data-dropped-catalogs="" className="mb-2 text-xs text-warning-fg">{droppedNote}</p>}
                      <PickerList
                        items={filteredCatalogs}
                        selected={selectedCatalogs}
                        onToggle={(name) => {
                          if (selectedCatalogs.includes(name)) {
                            setSelectedCatalogs((p) => p.filter((x) => x !== name));
                            setWholeCatalogs((p) => p.filter((x) => x !== name));
                            setSelectedSchemas((p) => p.filter((x) => !x.startsWith(name + '.')));
                          } else {
                            setSelectedCatalogs((p) => [...p, name]);
                            setWholeCatalogs((p) => wholeCatalogsWithoutPicks([...p, name], selectedSchemas, selectedTables));
                          }
                        }}
                        getKey={(c) => c.name}
                        request={requestOf('CATALOG')}
                        getLabel={(c) => c.name}
                        extraOf={(c) => (
                          <>
                            {inspireBlocked.has(c.name) && selectedCatalogs.includes(c.name) && (
                              <p data-inspire-access-help={c.name} className="px-2.5 pb-1.5 text-xs text-warning-fg">
                                Inspire cannot read this catalog yet, so it is not a source for the run. Pick a schema or table Inspire can read, or tick the box to request access.
                              </p>
                            )}
                            {c.partial ? (
                              <div data-catalog-partial={c.name} className="px-2.5 pb-1.5 text-xs text-warning-fg">
                                Inspire can read only part of this catalog.{' '}
                                <button type="button" className="font-semibold underline" onClick={() => raisePermissions(grantOfCatalog(catalogPermissions, c))}>Show the missing grant</button>
                              </div>
                            ) : null}
                          </>
                        )}
                        searchValue={catalogSearch}
                        onSearch={setCatalogSearch}
                        searchPlaceholder="Search catalogs..."
                        emptyText={
                          !databricksHost
                            ? 'Connect a workspace first in Workspace setup'
                            : !token && !serverEnvHasPat
                              ? 'Inspire cannot sign in to the workspace. Ask whoever installed Inspire to run inspire_installer.py again.'
                              : loadingCatalogs
                                // busy-ok: the label above this list shows a spinning Loader2 while it loads
                                ? 'Loading...'
                                : catalogBrowseError || catalogsWhy
                                  ? 'Inspire could not list the catalogs. The message above says why.'
                                  : !showEverything && shownCatalogs.length === 0 && (catalogs.length > 0 || !grantsListed)
                                    ? 'You can read no catalog yet. Tick Show everything to ask for access.'
                                  : grantsListed && catalogs.length === 0
                                    ? 'Inspire can read no catalog yet. Ask whoever installed Inspire to run the installer again with the catalogs you need.'
                                    : 'No catalogs found'
                        }
                      />
                      {catalogsCut && (
                        <p data-catalog-note="" className="mt-1 text-xs text-text-tertiary">{catalogListNote(catalogs, true, typedCatalogItem ? catalogSearch : '')}</p>
                      )}
                    </div>

                    {/* Schemas */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs font-semibold text-text-secondary">Schemas</span>
                        {loadingSchemas && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
                      </div>
                      <PickerList
                        items={filteredSchemas}
                        selected={selectedSchemas}
                        onToggle={(name) => {
                          if (selectedSchemas.includes(name)) {
                            setPickedChildren(selectedSchemas.filter((x) => x !== name), selectedTables);
                          } else {
                            setPickedChildren([...selectedSchemas, name], selectedTables);
                          }
                        }}
                        getKey={(s) => s.full_name}
                        request={requestOf('SCHEMA')}
                        getLabel={(s) => selectedCatalogs.filter((c) => !inspireBlocked.has(c)).length > 1 ? s.full_name : s.name}
                        searchValue={schemaSearch}
                        onSearch={setSchemaSearch}
                        searchPlaceholder="Search schemas..."
                        // busy-ok: the label above this list shows a spinning Loader2 while it loads
                        emptyText={selectedCatalogs.length === 0 ? 'Select catalogs first' : loadingSchemas ? 'Loading...' : schemasReadError ? 'Inspire could not list the schemas. The message above says why.' : `No schemas you can see in ${selectedCatalogs.join(', ')}`}
                      />
                    </div>

                    {/* Tables */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs font-semibold text-text-secondary">Tables</span>
                        <span className="text-xs text-text-tertiary">primary selection</span>
                        {loadingTables && <Loader2 data-tables-loading="" size={14} className="animate-spin text-text-tertiary" />}
                      </div>
                      {pickableTables.length > 0 && (
                        <button
                          type="button"
                          onClick={toggleAllTables}
                          className="mb-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-smooth border border-border hover:border-border-strong text-text-secondary hover:text-db-red-fg"
                        >
                          {allTablesSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      )}
                      <PickerList
                        items={filteredTables}
                        selected={selectedTables}
                        onToggle={(name) => {
                          if (selectedTables.includes(name)) setPickedChildren(selectedSchemas, selectedTables.filter((x) => x !== name));
                          else setPickedChildren(selectedSchemas, [...selectedTables, name]);
                        }}
                        getKey={(t) => t.full_name}
                        request={requestOf('TABLE')}
                        disabledReasonOf={unusableReasonOf}
                        onTryAgain={tryAgainTables}
                        getLabel={(t) => selectedSchemas.length > 1 ? `${t.schema_name}.${t.name}` : t.name}
                        searchValue={tableSearch}
                        onSearch={setTableSearch}
                        searchPlaceholder="Search tables..."
                        // busy-ok: the label above this list shows a spinning Loader2 while it loads
                        emptyText={selectedSchemas.length === 0 ? 'Select schemas first' : loadingTables ? 'Loading...' : tablesReadError ? 'Inspire could not list the tables. The message above says why.' : `No tables you can see in ${selectedSchemas.join(', ')}`}
                      />
                      {tablesLeftOut.map((line) => (
                        <p key={line} data-tables-left-out="" className="text-xs text-text-secondary px-1 pt-1">{line}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* UC Metadata preview — collapsible & scrollable */}
                {params['01_uc_metadata'] && (
                  <div className="mt-3 rounded-lg border border-success/20 bg-success-bg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMetadataPreviewExpanded(!metadataPreviewExpanded)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-start hover:bg-success/5 transition-smooth"
                    >
                      <CheckCircle2 size={14} className="text-success-fg shrink-0" />
                      <p className="text-xs text-success-fg font-semibold uppercase tracking-wider flex-1">Metadata Selected</p>
                      <span className="text-xs text-success-fg font-mono">
                        {scopeText}
                      </span>
                      <ChevronDown size={14} className={`text-success-fg transition-transform duration-200 ${metadataPreviewExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {metadataPreviewExpanded && (
                      <div className="px-4 pb-3 max-h-32 overflow-y-auto">
                        <p className="text-xs text-text-primary font-mono break-all leading-relaxed">{params['01_uc_metadata']}</p>
                      </div>
                    )}
                  </div>
                )}
              </Field>
  );
  const instructionsField = (
            <FieldSection label="Generation Instructions" hint="Optional. What the business does, what it wants this year, and anything Inspire should focus on or leave out">
              <div className="relative">
                <Target size={14} className="absolute start-3 top-3 text-text-tertiary" />
                <textarea dir="auto"
                  rows={4}
                  placeholder="Focus on fraud detection, join orders with customers on customer_id, exclude staging tables..."
                  value={params['08_generation_instructions']}
                  onChange={(e) => updateParam('08_generation_instructions', e.target.value)}
                  className="w-full ps-9 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth resize-none"
                />
              </div>
            </FieldSection>
  );
  const discoveryField = (
            <FieldSection label="Discovery Type" hint="Both modes count your data; only AI Enhanced Discovery shows the counts to the AI">
              <div className="grid grid-cols-1 gap-2.5">
                {DISCOVERY_OPTIONS.map((opt) => {
                  const active = params['03_discovery_type'] === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-discovery-option={opt.key}
                      aria-pressed={active}
                      onClick={() => {
                        setDiscoveryTouched(true);
                        updateParam('03_discovery_type', opt.key);
                      }}
                      className={`relative p-3 rounded-xl text-start transition-smooth border ${
                        active ? 'border-success bg-success-bg shadow-sm ring-1 ring-inset ring-success/40' : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <span className={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-success-fg' : 'text-text-primary'}`}>
                        <Icon size={14} className={active ? 'text-success-fg' : 'text-text-tertiary'} />
                        {opt.key}
                        {opt.key === DISCOVERY_RECOMMENDED && <span className="text-xs font-normal text-text-tertiary">(default)</span>}
                        {opt.badge && (
                          <span data-discovery-badge={opt.key} className="ms-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
                            {opt.badge}
                          </span>
                        )}
                      </span>
                      <p className="text-xs text-text-tertiary leading-snug mt-1">{opt.desc}</p>
                      {active && <CheckCircle2 size={14} className="absolute top-2.5 end-2.5 text-success-fg" />}
                    </button>
                  );
                })}
              </div>
              <div data-discovery-panel className="mt-2.5 rounded-xl border border-success/30 bg-success-bg p-3.5">
                <DiscoveryPromise className="text-xs max-w-[75ch]" />
                <details data-discovery-more="" open={showPrivacyNote} onToggle={(e) => setShowPrivacyNote(e.currentTarget.open)} className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-success-fg">Privacy details</summary>
                <div className="mt-2 grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  {DISCOVERY_PANEL.map((part) => {
                    const PartIcon = part.icon;
                    return (
                      <div key={part.key} data-discovery-panel-part={part.key} className="rounded-lg bg-surface/70 p-2.5">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                          <PartIcon size={14} className="text-success-fg" />
                          {part.title}
                        </p>
                        <p className="mt-1 text-xs leading-snug text-text-secondary">{part.text}</p>
                      </div>
                    );
                  })}
                </div>
                </details>
              </div>
              {prefillNote && <p className="text-xs text-text-tertiary mt-1.5">{prefillNote}</p>}
            </FieldSection>
  );
  const prioritiesField = (
              <FieldSection label="Business Priorities" hint="Pick what matters most, or add your own">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {BUSINESS_PRIORITIES.map((bp) => {
                    const active = !!priorityChecks[bp.key];
                    return (
                      <button
                        key={bp.key}
                        type="button"
                        onClick={() => toggleBuiltInPriority(bp.key)}
                        className={`relative px-3 py-2 rounded-lg text-xs font-medium text-start transition-smooth border ${
                          active
                            ? 'border-db-red/30 bg-db-red-50 text-db-red-fg'
                            : 'border-border text-text-secondary hover:border-border-strong'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <bp.icon size={13} className={active ? 'text-db-red-fg' : 'text-text-tertiary'} />
                          <span className="truncate">{bp.key}</span>
                        </span>
                        {active && <CheckCircle2 size={14} className="absolute top-1.5 end-1.5 text-db-red-fg" />}
                      </button>
                    );
                  })}
                  {customPriorities.map((name) => (
                    <span
                      key={name}
                      className="relative px-3 py-2 rounded-lg text-xs font-medium border border-db-red/30 bg-db-red-50 text-db-red-fg flex items-center gap-1.5"
                    >
                      <Target size={14} className="text-db-red-fg shrink-0" />
                      <span className="truncate" title={name}>{name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={() => removeCustomPriority(name)}
                        className="ms-auto shrink-0 text-db-red-fg hover:text-text-primary transition-smooth"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input dir="auto"
                    type="text"
                    value={customPriorityDraft}
                    onChange={(e) => setCustomPriorityDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomPriority();
                      }
                    }}
                    placeholder="Add your own priority, for example Improve on-time delivery"
                    aria-label="Add your own business priority"
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth"
                  />
                  <button
                    type="button"
                    onClick={addCustomPriority}
                    disabled={!customPriorityDraft.trim()}
                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-border text-text-secondary hover:border-border-strong disabled:opacity-40 transition-smooth"
                  >
                    Add
                  </button>
                </div>
              </FieldSection>
  );
  const domainsField = (
              <FieldSection label="Business Domains" hint="Leave empty to auto-infer from data">
                <div className="relative">
                  <Layers size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input dir="auto"
                    type="text"
                    placeholder="Sales, Marketing, Finance, Operations, Supply Chain..."
                    value={params['06_business_domains']}
                    onChange={(e) => updateParam('06_business_domains', e.target.value)}
                    className="w-full ps-9 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth"
                  />
                </div>
              </FieldSection>
  );
  const strategyBlock = (
              <div className="border border-border rounded-xl overflow-hidden" data-testid="launch-strategy">
                <button
                  type="button"
                  onClick={() => setShowStrategy(!showStrategy)}
                  aria-expanded={showStrategy}
                  className="w-full flex items-start gap-2 px-4 py-3 text-start hover:bg-bg-subtle/50 transition-smooth"
                >
                  <Target size={14} className="text-text-tertiary mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-text-primary">Strategy (optional)</span>
                    <span className="block text-xs text-text-tertiary">
                      Your levels, KPIs and sponsors. When you set them, every use case is aligned to them, measured by your KPIs
                      and sponsored by one of your roles. For example: Customer › Win loyalty, measured by Repeat purchase rate,
                      sponsored by the Chief Customer Officer.
                    </span>
                  </span>
                  {(strategyBase || strategyProblems.length > 0) && (
                    <span className={`ms-auto text-xs font-semibold ${strategyProblems.length ? 'text-db-red-fg' : 'text-success-fg'}`}>
                      {strategyProblems.length ? `${strategyProblems.length} problem${strategyProblems.length > 1 ? 's' : ''}` : 'Set'}
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-text-tertiary transition-transform duration-200 ${strategyBase || strategyProblems.length > 0 ? '' : 'ms-auto'} ${showStrategy ? 'rotate-180' : ''}`}
                  />
                </button>
                {showStrategy && (
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    <StrategyEditor
                      key={strategyEditorKey}
                      value={strategyBase}
                      onChange={handleStrategyChange}
                      domains={String(params['06_business_domains'] || '').split(',').map((d) => d.trim()).filter(Boolean)}
                    />
                  </div>
                )}
              </div>
  );
  const dataFilterBlock = (
              <div className="border border-border rounded-xl overflow-hidden" data-testid="launch-data-filters">
                <button
                  type="button"
                  onClick={() => setShowDataFilters(!showDataFilters)}
                  aria-expanded={showDataFilters}
                  className="w-full flex items-start gap-2 px-4 py-3 text-start hover:bg-bg-subtle/50 transition-smooth"
                >
                  <Table2 size={14} className="text-text-tertiary mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-text-primary">Data Management (optional)</span>
                    <span className="block text-xs text-text-tertiary">
                      The columns Inspire reads and the rows it keeps, per table you picked. Leave it empty to read every column and every row.
                    </span>
                  </span>
                  {dataFilterProblems.length > 0 && (
                    <span className="ms-auto text-xs font-semibold text-db-red-fg">
                      {`${dataFilterProblems.length} problem${dataFilterProblems.length > 1 ? 's' : ''}`}
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-text-tertiary transition-transform duration-200 ${dataFilterProblems.length > 0 ? '' : 'ms-auto'} ${showDataFilters ? 'rotate-180' : ''}`}
                  />
                </button>
                {showDataFilters && (
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    <DataManagement
                      scope={scope}
                      scopes={tableScopes}
                      onScopes={setTableScopes}
                      label={dataFilterLabel}
                      onLabel={setDataFilterLabel}
                      relationships={relationships}
                      onRelationships={setRelationships}
                      apiFetch={apiFetch}
                      warehouseId={warehouseId}
                      onProblems={setDataFilterProblems}
                    />
                  </div>
                )}
              </div>
  );
  const dbField = (
              <Field label="Inspire Database" icon={Database} hint="catalog.schema format: where Inspire keeps its record of each run">
                <input dir="auto"
                  type="text"
                  placeholder="e.g. my_catalog._inspire"
                  value={params['02_inspire_database']}
                  onChange={(e) => updateParam('02_inspire_database', e.target.value)}
                  className="w-full ps-10 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-tertiary glow-focus transition-smooth font-mono"
                />
              </Field>
  );
  const pathField = (
              <Field label="Generation Path" icon={FileText} hint="Where to write output artifacts">
                <input dir="auto"
                  type="text"
                  value={params['11_generation_path']}
                  onChange={(e) => updateParam('11_generation_path', e.target.value)}
                  placeholder="Your own folder: /Users/<you>/inspire_output"
                  aria-label="Generation Path"
                  aria-describedby="output-folder-check-field"
                  className="w-full ps-10 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary glow-focus transition-smooth font-mono"
                />
                <OutputFolderCheck check={outputCheck} id="output-folder-check-field" />
              </Field>
  );
  const qualityField = (
                <FieldSection label="Use Cases Quality">
                  <div className="flex gap-1.5">
                    {QUALITY_OPTIONS.map((q) => {
                      const active = params['05_use_cases_quality'] === q;
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => updateParam('05_use_cases_quality', q)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-smooth border ${
                            active
                              ? 'border-db-red/30 bg-db-red-50 text-db-red-fg'
                              : 'border-border text-text-secondary hover:border-border-strong'
                          }`}
                        >
                          {q.replace(' Quality', '')}
                        </button>
                      );
                    })}
                  </div>
                </FieldSection>
  );
  const genieRow = (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Field
                  label="Auto-Genie scope"
                  icon={Bot}
                  hint="In Discover, 0 (the default) writes outline notebooks only; all, or a number such as 5, also writes full Databricks AI instructions for that many top use cases."
                >
                  <input dir="auto"
                    type="text"
                    value={params['13_generate_genie_code_for']}
                    onChange={(e) => updateParam('13_generate_genie_code_for', e.target.value)}
                    placeholder="0"
                    className="w-full ps-10 pe-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary glow-focus transition-smooth font-mono"
                  />
                </Field>
                <Field
                  label="Best of Best stars"
                  icon={Star}
                  hint="How many use cases to star, 0 to 100. Empty uses the number in your generation instructions, or 20. Stars never add, remove or reorder a use case."
                >
                  <input dir="auto"
                    type="text"
                    inputMode="numeric"
                    value={params['16_best_of_best_count']}
                    onChange={(e) => updateParam('16_best_of_best_count', e.target.value)}
                    placeholder="20"
                    aria-invalid={bestOfBestInvalid}
                    className={`w-full ps-10 pe-4 py-2.5 text-sm border rounded-lg bg-surface text-text-primary glow-focus transition-smooth font-mono ${bestOfBestInvalid ? 'border-error' : 'border-border'}`}
                  />
                  {bestOfBestInvalid && (
                    <p className="mt-1.5 text-xs text-error-fg">Use a whole number from 0 to 100, or leave it empty for 20.</p>
                  )}
                </Field>
              </div>
  );
  const electionField = wiz?.findPath ? (
    <FieldSection label="Table Election">
      <p data-launch-election-by-plan="" className="text-sm text-text-primary">{TABLE_ELECTION_BY_PLAN}</p>
    </FieldSection>
  ) : (
                <FieldSection label="Table Election">
                  <GlowSelect
                    value={params['04_table_election']}
                    onChange={(v) => updateParam('04_table_election', v)}
                    options={TABLE_ELECTION}
                  />
                  <p className="text-xs text-text-tertiary mt-1">Which of the tables you picked Inspire reads</p>
                </FieldSection>
  );

  const selectionWarning = tableSelectionWarning.show ? (
    <TableSelectionGuidanceWarning
      heading={tableSelectionWarning.heading}
      tableCount={tableSelectionWarning.tableCount}
      scope={tableSelectionWarning.scope}
      idealMax={TABLE_SELECTION_IDEAL_MAX}
      compact
    />
  ) : null;
  const wizParts = {
    business: nameField,
    data: <>{ucField}{selectionWarning}</>,
    goals: <>{instructionsField}{prioritiesField}{domainsField}{strategyBlock}</>,
    settings: (
      <>
        {discoveryField}
        <button type="button" data-wiz-more-settings="" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}
          className="text-sm font-semibold text-primary-fg hover:underline">
          More settings
        </button>
        {showMore && (
          <div className="space-y-6">
            {dbField}
            {pathField}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">{electionField}{qualityField}</div>
            {genieRow}
            {!wiz?.findPath && dataFilterBlock}
          </div>
        )}
      </>
    ),
  };
  if (step) {
    const part = wizParts[step];
    return <>{part && wiz?.slot ? createPortal(<div className="space-y-6">{part}</div>, wiz.slot) : null}</>;
  }

  return (
    <>
    <div className={`${WIZARD} py-8`}>
      {/* Page Header */}
      <div className="mb-8">
        <PageHeader className="mb-2" icon={Rocket}
          title={<span className="block line-clamp-2 wrap-break-word" title={headlineBusiness ? launchPageHeading : undefined} aria-live="polite">{launchPageHeading}</span>}
          actions={<MoreMenu items={[
            { label: 'Recent runs', onSelect: () => { setShowRecentRuns(true); setExperimentsOverviewExpanded(true); } },
            { label: 'How Inspire keeps your data private', onSelect: () => setShowPrivacyNote(true) },
          ]} />} />
        {draftBack && (
          <div role="note" aria-label="Your draft" data-launch-draft="" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-[12px] text-text-primary">
            <span>{DRAFT_BACK_NOTE}</span>
            <button type="button" data-launch-start-over="" onClick={startOver} className="text-[12px] font-medium text-db-red-fg underline-offset-2 hover:underline glow-focus">{DRAFT_START_OVER}</button>
          </div>
        )}
      </div>


      {showRecentRuns && (token || serverEnvHasPat) && warehouseId && previewDb && (
        <section
          className="mb-8 rounded-xl border border-border bg-surface/80 backdrop-blur-sm shadow-sm overflow-hidden"
          aria-label="Discovery Overview"
        >
          <button
            type="button"
            onClick={() => setExperimentsOverviewExpanded((v) => !v)}
            className="flex w-full items-center gap-3 px-5 py-3 border-b border-border bg-bg-subtle/50 text-start transition-colors hover:bg-bg-subtle/80"
            aria-expanded={experimentsOverviewExpanded}
          >
            <Layers size={16} className="text-db-red-fg shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-text-primary">Discovery Overview</h2>
              <p className="text-xs text-text-secondary truncate">
                {overviewLoading
                  // busy-ok: the list below this subtitle shows a spinning Loader2 while overviewLoading
                  ? 'Loading your recent runs…'
                  : overviewError
                    ? 'Inspire could not read your runs, see the message below'
                    : sessionsList.length > 0
                    ? `${sessionsList.length} run${sessionsList.length === 1 ? '' : 's'} · use Quick view to see the use cases each run found`
                    : 'No runs yet. Start one to see it listed here.'}
              </p>
            </div>
            <ChevronDown
              size={16}
              className={`shrink-0 text-text-tertiary transition-transform duration-200 ${experimentsOverviewExpanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
          {(overviewError || allCreatedError) && (
            <div className="space-y-2 border-b border-border bg-surface/60 px-5 py-2.5">
              {overviewError && (
                <div role="alert" data-overview-error="" className="flex items-start gap-1.5 text-xs text-error-fg">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1"><PlainMessage text={overviewError} /></div>
                </div>
              )}
              {allCreatedError && !overviewError && (
                <div role="alert" className="flex items-start gap-1.5 text-xs text-warning-fg">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1"><PlainMessage text={`Inspire could not count the use cases of your runs: ${allCreatedError}`} /></div>
                </div>
              )}
            </div>
          )}
          {experimentsOverviewExpanded && (
          <div className="px-5 py-4">
            {overviewLoading && !overviewError && (
              <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
                <Loader2 size={16} className="animate-spin text-db-red-fg" />
                Loading runs…
              </div>
            )}
            {!overviewLoading && !overviewError && sessionsList.length === 0 && (
              <p className="text-sm text-text-secondary py-1">
                No runs yet. The use cases of a run show under Quick view once it saves them.
              </p>
            )}
            {!overviewLoading && sessionsList.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border bg-bg-subtle/30 overflow-hidden">
                {sessionsList.map((s) => {
                  const sidStr = String(s.session_id);
                  const expanded = quickViewSid === sidStr;
                  const count = useCaseCountBySession.get(sidStr) ?? 0;
                  const ucs = expanded ? getUcsForSession(s.session_id) : null;
                  const loadingUc = quickViewLoading === sidStr;
                  const business = runBusiness(s) || 'No business name';
                  const pct = Number(s.completed_percent) || 0;
                  return (
                    <li key={sidStr} data-run={sidStr} className="bg-surface/60">
                      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-text-primary truncate">{business}</span>
                            <LatestRunBadge session={s} />
                            <span className="text-xs font-mono text-text-tertiary bg-bg-subtle px-1.5 py-0.5 rounded border border-border shrink-0">
                              {sidStr}
                            </span>
                            {sessionFailed(s) ? (
                              <span className="text-xs font-medium text-error-fg bg-error-bg px-1.5 py-0.5 rounded border border-error/20">
                                Failed at {Math.round(pct)}%
                              </span>
                            ) : sessionFinished(s) ? (
                              <span className="text-xs font-medium text-success-fg bg-success-bg px-1.5 py-0.5 rounded border border-success/20">
                                Complete
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-text-secondary bg-bg-subtle px-1.5 py-0.5 rounded border border-border">
                                {Math.round(pct)}% done
                              </span>
                            )}
                            <span className="text-xs text-text-tertiary">
                              {count > 0 ? `${count} in table` : 'none in table yet'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                            <Calendar size={14} className="shrink-0 text-text-tertiary" aria-hidden />
                            <span>{formatWhen(s.create_at, 'Date unknown')}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onQuickViewToggle(s.session_id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                              expanded
                                ? 'border-db-red bg-db-red-50 text-db-red-fg'
                                : 'border-border bg-surface text-text-primary hover:border-db-red/40 hover:text-db-red-fg'
                            }`}
                            aria-expanded={expanded}
                          >
                            <Eye size={14} aria-hidden />
                            Quick view
                            <ChevronDown
                              size={14}
                              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                          </button>
                          {typeof onOpenResults === 'function' && (
                            <button
                              type="button"
                              onClick={() => onOpenResults(sidStr)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:border-db-red/40 hover:text-db-red-fg transition-colors"
                            >
                              <ExternalLink size={14} aria-hidden />
                              Open in Review
                            </button>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-border bg-bg-subtle/50 px-4 py-3">
                          {loadingUc && (
                            <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
                              <Loader2 size={14} className="animate-spin text-db-red-fg" />
                              Loading use cases for this session…
                            </div>
                          )}
                          {!loadingUc && Array.isArray(ucs) && ucs.length === 0 && (
                            <p className="text-sm text-text-secondary py-1">
                              No use cases found for this session in the catalog or results yet.
                            </p>
                          )}
                          {!loadingUc && Array.isArray(ucs) && ucs.length > 0 && (
                            <ul className="max-h-72 overflow-y-auto space-y-2 pe-1">
                              {ucs.map((uc, i) => {
                                const title = nameOfUseCase(uc) || 'Use case';
                                const blurb = blurbOfUseCase(uc);
                                const score = inspireScoreFromUc(uc);
                                return (
                                  <li
                                    key={`qv-${sidStr}-${uc.id ?? uc.No ?? i}-${keyOfUseCase(uc)}`}
                                    className="rounded-lg border border-border bg-surface/80 px-3 py-2"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="text-xs font-semibold text-text-primary line-clamp-2 leading-snug">
                                        {title}
                                      </span>
                                      {score != null && Number.isFinite(score) && (
                                        <span className="shrink-0 text-xs font-bold tabular-nums text-db-red-fg bg-db-red-50 border border-db-red/20 px-1.5 py-0.5 rounded">
                                          {score.toFixed(1)}
                                        </span>
                                      )}
                                    </div>
                                    {(uc._domain || uc['Business Domain'] || uc.domain) && (
                                      <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                        {uc._domain || uc['Business Domain'] || uc.domain}
                                      </p>
                                    )}
                                    {blurb && (
                                      <p className="text-xs text-text-secondary mt-1 line-clamp-2 leading-relaxed">
                                        {blurb}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          )}
        </section>
      )}

      {/* Error banner */}
      {launchErrorGuidance && <div id="launch-error"><UcPermissionErrorHelp guidance={launchErrorGuidance} /></div>}

      <div className="space-y-6">

        {/* ═══════════════════════════════════════════════
            SECTION 1: ESSENTIALS
           ═══════════════════════════════════════════════ */}
        <section className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-surface">
            <div className="w-8 h-8 rounded-lg bg-db-red flex items-center justify-center shadow-sm">
              <Zap size={16} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-text-primary">Essentials</h2>
            </div>
            <span className="text-xs font-semibold text-db-red-fg bg-db-red-50 border border-db-red/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
              Required
            </span>
          </div>

          <div className="px-6 py-6 space-y-6">
            {/* Business Name */}
            {nameField}

            {/* UC Metadata — Catalog/Schema/Table pickers with shopping basket */}
            {ucField}

            {/* Generation Instructions — optional */}
            {instructionsField}

            {/* Discovery Type — v1.3.0 widget 03_discovery_type */}
            {discoveryField}

          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            SECTION 2: ADVANCED (Collapsible)
           ═══════════════════════════════════════════════ */}
        <section className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            data-launch-advanced-toggle=""
            className="w-full flex items-center gap-3 px-6 py-4 text-start hover:bg-bg-subtle/50 transition-smooth"
          >
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center">
              <Settings2 size={16} className="text-text-secondary" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-text-primary">Advanced Settings</h2>
              <p className="max-w-[75ch] text-xs text-text-secondary">
                Business priorities, domains and strategy, where Inspire keeps its tables and files, run mode, documents and quality
              </p>
              {!showAdvanced && advancedProblem && (
                <p data-launch-advanced-problem="" className="mt-1 text-xs text-error-fg">{advancedProblem}</p>
              )}
            </div>
            <div className={`transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}>
              <ChevronDown size={16} className="text-text-tertiary" />
            </div>
          </button>

          {showAdvanced && (
            <div className="px-6 pb-6 pt-2 border-t border-border space-y-6">

              {prioritiesField}

              {/* Business Domains */}
              {domainsField}

              {strategyBlock}

              {dataFilterBlock}

              {/* Inspire Database */}
              {dbField}


              {/* Generation Path */}
              {pathField}

              {/* Row: Table Election + Quality */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {electionField}
                {qualityField}
              </div>

              {genieRow}
            </div>
          )}
        </section>
      </div>

      {/* Launch Footer */}
      <div className="mt-8 pt-6 border-t border-border">
        {/* Summary chips */}
        {tableSelectionWarning.show && (
          <div className="mb-5">
            <TableSelectionGuidanceWarning
              heading={tableSelectionWarning.heading}
              tableCount={tableSelectionWarning.tableCount}
              scope={tableSelectionWarning.scope}
              idealMax={TABLE_SELECTION_IDEAL_MAX}
              compact
            />
          </div>
        )}

        {canLaunch && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <Chip icon={<Building2 size={14} />}>{params['00_business_name']}</Chip>
            <Chip icon={<Database size={14} />}>{params['02_inspire_database']}</Chip>
            {scope.tables.length > 0 && <Chip icon={<Table2 size={14} />}>{counted(scope.tables.length, 'table')}</Chip>}
            {pickedAll.schemas.length > 0 && <Chip icon={<Layers size={14} />}>{counted(pickedAll.schemas.length, 'schema')}</Chip>}
            {pickedAll.catalogs.length > 0 && <Chip icon={<Database size={14} />}>{counted(pickedAll.catalogs.length, 'catalog')}</Chip>}
            <Chip icon={<Sliders size={14} />}>{params['05_use_cases_quality']}</Chip>
            <Chip icon={params['03_discovery_type'] === DISCOVERY_AI_ENHANCED ? <Sparkles size={14} /> : <Lock size={14} />}>
              {params['03_discovery_type'] || DISCOVERY_RECOMMENDED}
            </Chip>
            {strategyBase && <Chip icon={<Target size={14} />}>Strategy set</Chip>}
            <Chip icon={<Star size={14} />}>
              Stars: {bestOfBestText === '0' ? 'off' : bestOfBestText || '20'}
            </Chip>
            <Chip icon={<Bot size={14} />}>
              Genie:{' '}
              {['', '0'].includes(String(params['13_generate_genie_code_for'] || '').trim())
                ? 'off'
                : params['13_generate_genie_code_for']}
            </Chip>
          </div>
        )}

        {!outputCheck.ready && (
          <div className="mb-4">
            <OutputFolderCheck check={outputCheck} id="output-folder-check-launch"
              where={showAdvanced ? 'Change Generation Path in Advanced Settings above' : 'Change it in Advanced Settings, Generation Path'} />
          </div>
        )}

        {liveRunNote && (
          <p role="note" data-testid="launch-live-run" className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0 break-words">{liveRunNote}</span>
          </p>
        )}
        <div className="flex justify-end">
          <Button size="md" className="w-full sm:w-auto sm:min-w-[16rem] py-3.5 font-bold"
            onClick={handleLaunch}
            disabled={launching || !canLaunch || !outputCheck.ready}
            aria-describedby={launchBlock ? 'launch-block' : outputCheck.ready ? undefined : 'output-folder-check-launch'}
          >
            {launching ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting the run…
              </>
            ) : (
              <>
                <Play size={16} />
                Get Started
              </>
            )}
          </Button>
        </div>
        {launchBlock && !launching && <p id="launch-block" data-launch-block="" role="status" className="text-xs text-text-secondary mt-2 text-center">{launchBlock}</p>}
        {saveAsk && (
          <ModalDialog titleId="launch-save-profile-title" title="Save these settings as a business profile?"
            onClose={() => { if (!saving) setSaveAsk(null); }} widthClass="max-w-md"
            dialogAttrs={{ 'data-launch-save-profile': '' }}
            footer={(
              <>
                <Button variant="secondary" data-launch-run-unsaved="" onClick={runWithoutSaving} disabled={saving}>
                  Run without saving
                </Button>
                <Button data-launch-save-run="" onClick={saveAndRun} disabled={saving || !saveAsk.name.trim()}>
                  {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Saving…</> : profileNamed(saveAsk.name) && saveAsk.confirmReplace ? 'Replace and run' : 'Save and run'}
                </Button>
              </>
            )}>
            <label className="block text-xs font-semibold text-text-primary">
              Profile name
              <input data-launch-profile-name="" dir="auto" type="text" value={saveAsk.name} disabled={saving}
                onChange={(e) => setSaveAsk({ name: e.target.value, confirmReplace: false })}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary glow-focus" />
            </label>
            {profileNamed(saveAsk.name) && !saveAsk.confirmReplace && (
              <p data-launch-profile-replace="" className="text-xs text-warning-fg">
                A profile named {profileNamed(saveAsk.name).name} already exists. Saving replaces it.
              </p>
            )}
            {profileNamed(saveAsk.name) && saveAsk.confirmReplace && (
              <p data-launch-profile-replace-confirm="" role="alert" className="text-xs font-semibold text-warning-fg">
                Replace the profile {profileNamed(saveAsk.name).name} saved by {profileNamed(saveAsk.name).updated_by || 'someone'} on {formatWhen(profileNamed(saveAsk.name).updated_at, 'an unknown date')}?
              </p>
            )}
            {saveError && <PlainMessage text={saveError} role="alert" data-launch-profile-error="" className="text-xs text-error-fg" />}
            <p className="text-xs text-text-secondary">Everyone on this App can load a saved profile. The list shows who saved it and when.</p>
          </ModalDialog>
        )}

        <p data-admin-footer="" className="text-xs text-text-tertiary mt-3 text-center">
          Notebook: <span className="font-mono text-text-secondary">{notebookPath || 'not set'}</span>
          {warehouseId && <> &middot; Warehouse: <span className="text-text-secondary">{warehouseLabel(warehouses, warehouseId)}</span></>}
        </p>
      </div>
    </div>
    </>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Reusable form primitives
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function Field({ label, required, icon: Icon, hint, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {Icon && (
          <div className="w-5 h-5 rounded flex items-center justify-center bg-bg-subtle">
            <Icon size={14} className="text-text-tertiary" />
          </div>
        )}
        <span className="text-xs font-bold text-text-primary" title={hint}>
          {label}
          {required && <span className="text-db-red-fg ms-0.5">*</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

function FieldSection({ label, required, hint, children }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xs font-semibold text-text-primary" title={hint}>
          {label}
          {required && <span className="text-db-red-fg ms-0.5">*</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

function GlowSelect({ value, onChange, options }) {
  return (
    <select
      className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-surface text-text-primary glow-focus transition-smooth"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// One schema's tables for the picker, named catalog.schema.table, with the note for any the listing left out. The effect and Try again
// both list through this, so a schema is read the same way on the first load and on a retry.
function listSchemaTables(schemaFullName, apiFetch, warehouseId, showEverything = false) {
  const [catalog, schema] = schemaFullName.split('.');
  return apiFetch(`/api/tables/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}${tableBrowseQuery(warehouseId, showEverything)}`)
    .then((d) => ({
      rows: (d.tables || []).map((t) => ({ ...t, full_name: t.full_name || `${catalog}.${schema}.${t.name}` })),
      leftOut: d.left_out ? leftOutLine(d.left_out) : '',
    }));
}

function PickerList({ items, selected, onToggle, getKey, getLabel, extraOf = () => null, disabledReasonOf = () => '', request = null, onTryAgain, searchValue, onSearch, searchPlaceholder, emptyText }) {
  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden flex flex-col min-h-0">
      {(items.length > 0 || searchValue) && (
      <div className="relative shrink-0">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input dir="auto"
          type="text"
          className="w-full bg-transparent border-b border-border ps-8 pe-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      )}
      {items.length > 0 && (
        <p title="Scroll the list to see all of them" className="text-xs text-text-tertiary px-2 py-1 border-b border-border bg-bg-subtle/40 shrink-0">
          {items.length} item{items.length === 1 ? '' : 's'}
        </p>
      )}
      <div className="max-h-[min(22rem,55vh)] overflow-y-auto p-1.5 min-h-0">
        {items.length === 0 ? (
          <p className="text-xs text-text-tertiary p-2 text-center">{emptyText}</p>
        ) : (
          items.map((item) => {
            const key = getKey(item);
            const label = getLabel(item);
            const active = selected.includes(key);
            // REQ-521/522: a row the person cannot read, or a table Inspire cannot read, is never opened or picked as a source; it only
            // carries a box to request access. A catalog or schema only Inspire cannot read still opens (see below).
            const need = request ? accessNeedOf(item) : [];
            const marker = need.length ? (
              <span data-access-need={request.full(item)} title={need.includes('inspire') ? INSPIRE_NEED_TITLE : undefined} className="text-xs text-text-tertiary leading-snug">{accessNeedText(need)}</span>
            ) : null;
            const requestBox = need.length ? (() => {
              const full = request.full(item);
              const on = request.picked.includes(full);
              const capped = !on && request.full_up;
              return <input type="checkbox" aria-label={`Request access to ${full}`} checked={on} disabled={capped} title={capped ? 'At most 50 objects per request.' : undefined} onChange={() => request.onToggle(item)} className="mt-2.5 shrink-0" />;
            })() : null;
            if (need.length && (need.includes('person') || !request.openable)) {
              return (
                <label key={key} className="w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-xs text-text-secondary">
                  {requestBox}
                  <span className="font-mono break-all leading-snug">{label}</span>
                  {marker}
                </label>
              );
            }
            // A busy type check is not a verdict on the item: it is listed with Try again, which checks it again.
            if (onTryAgain && typeCheckBusyOf(item)) {
              return (
                <div key={key} role="none" data-type-check-busy={key} className="w-full flex flex-wrap items-start gap-2 px-2.5 py-2 text-xs text-warning-fg">
                  <TypeCheckBusyTryAgain name={label} onTryAgain={() => onTryAgain(item)} />
                </div>
              );
            }
            // Fail closed: an item that cannot be used is shown with its plain reason and cannot be picked.
            const reason = disabledReasonOf(item);
            return (
              <div key={key} className={need.length ? 'flex items-start' : undefined}>
              {requestBox}
              <div className={need.length ? 'min-w-0 flex-1' : undefined}>
              <button
                type="button"
                title={label}
                disabled={Boolean(reason)}
                aria-disabled={reason ? 'true' : undefined}
                onClick={() => { if (!reason) onToggle(key); }}
                className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-xs text-start transition-smooth ${
                  active
                    ? 'bg-db-red-50 text-db-red-fg border border-db-red/20'
                    : 'text-text-primary hover:bg-bg-subtle border border-transparent'
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                  active ? 'bg-db-red border-db-red' : 'border-border-strong'
                }`}>
                  {active && <CheckCircle2 size={14} className="text-white" />}
                </div>
                <span className="font-mono break-all leading-snug">{label}</span>
                {reason && <span data-unusable-reason="" className="text-xs text-error-fg leading-snug">{reason}</span>}
                {marker}
              </button>
              {extraOf(item)}
              </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Chip({ children, icon }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-db-red/20 bg-db-red-50 text-db-red-fg">
      {icon} {children}
    </span>
  );
}

function TableSelectionGuidanceWarning({
  heading,
  tableCount,
  scope = 'tables',
  idealMax,
  compact = false,
}) {
  const overIdeal = tableCount != null && tableCount >= idealMax;
  const isBroadScope = scope === 'schemas' || scope === 'catalogs';

  return (
    <div
      className={`rounded-lg border border-warning/35 bg-warning-bg ${compact ? 'p-3' : 'p-4 mb-3'}`}
      role="status"
    >
      <div className="flex gap-2.5">
        <AlertCircle size={compact ? 16 : 18} className="text-warning-fg shrink-0 mt-0.5" />
        <div className="min-w-0 space-y-2 text-sm text-text-secondary leading-relaxed">
          <p className="font-semibold text-warning-fg">
            {heading}
          </p>
          {isBroadScope && (
            <p className="text-xs text-text-primary">
              You selected a {scope === 'catalogs' ? 'whole catalog' : 'whole schema'} without naming individual
              tables. Inspire will scan everything in scope. For faster, higher-quality discovery, open the table
              list and pick a focused set instead.
            </p>
          )}
          <p>
            For the best outcomes, select a <strong className="text-text-primary">small set of tables</strong>{' '}
            (ideally fewer than {idealMax}) in <strong className="text-text-primary">one business domain</strong>{' '}
            (for example, all sales-related tables).
          </p>
          <ul className="list-disc ps-4 space-y-1 text-xs sm:text-sm">
            <li>
              Prefer <strong className="text-text-primary">transactional</strong> tables that change often with new
              data (for example <span className="font-mono text-xs">sales_transactions</span>).
            </li>
            <li>
              Static reference tables add little value (for example{' '}
              <span className="font-mono text-xs">store_location</span>).
            </li>
            <li>
              If relationships are not visible in metadata (no primary/foreign keys), describe joins in{' '}
              <strong className="text-text-primary">Generation Instructions</strong> below.
            </li>
          </ul>
          {overIdeal && (
            <p className="text-xs font-medium text-warning-fg">
              You are at or above {idealMax} tables. Consider narrowing to the transactional tables of a single domain
              before launching.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
