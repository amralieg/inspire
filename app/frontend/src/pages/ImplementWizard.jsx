import { splitTechnical } from '../lib/plainText';
import { nameOfUseCase } from '../lib/useCaseFields';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MONEY_PARTS } from '../lib/moneyParts.js';
import { Check, Loader2, NotebookPen, X, ChevronLeft, ChevronRight, LayoutDashboard, Sparkles, AppWindow, Bell, Lock, UserRound, KeyRound } from 'lucide-react';
import BodyPortal from '../components/BodyPortal';
import VibesEditor, { VibePrevious } from '../components/VibesEditor';
import { MoneyRuleEditor } from '../components/MoneyRuleEditor.jsx';
import SourceTables from '../components/SourceTables';
import TabStrip, { tabPanel } from '../components/TabStrip';
import AppSample, { paletteVars, pv } from '../components/AppSample';
import { generationFolder, sharedFolderWarning } from '../lib/workspaceLinks';
import { catalogRow } from '../lib/useCaseFacets';
import { insideMoveNote } from '../lib/implementControl';
import {
  GENIE_CODE_OFF_TITLE,
  genieCodeOff,
  wizardSteps,
  APP_STORAGE_STEP,
  contextSettings,
  IMPLEMENT_OUTPUTS,
  ALERT_TIER_HELP,
  ALERT_TIER_OPTIONS,
  ALERT_OPERATORS,
  ALERT_OPERATOR_WORDS,
  ALERT_THRESHOLD_BASES,
  ALERT_BASELINE_DIRECTIONS,
  baselineOperatorOk,
  FRESHNESS_OPTIONS,
  defaultResultTable,
  inspireSchemaResultTable,
  nameOrEmpty,
  RESULT_PLACES,
  resultPlaceOf,
  useCaseSchemaTags as schemaTagsOf,
  ownSchemaFallbackNote,
  defaultSpecFromUseCase,
  specFromLatest,
  tablesOf,
  primaryTableOf,
  restoreTable,
  pickedTable,
  revertLostSwaps,
  revertedSwapsText,
  removalBlocker,
  filterValues,
  setFilterValues,
  readinessScope,
  readinessText,
  countedFor,
  tooFewRowsText,
  columnsReadOf,
  filterTablesOutside,
  withoutTableFilters,
  groupPartColumns,
  scopeNarrowing,
  emptyScopeWarningOf,
  planLines,
  sharedHolding,
  sharedSource,
  takeOutText,
  editedNotebook,
  tableOfRef as refTable,
  columnOfRef as refColumn,
  VALUE_LIMIT,
  withDecisionOwner,
  cronInWords,
  cronProblem,
  alertTriggerText,
  sectionErrors,
  stepErrors,
  advancedWithErrors,
  freshnessOf,
  withFreshness,
  nextAppName,
  appRenamedText,
  widgetValueProblem,
  profileFieldProblem,
  initialStepId,
  stepIndexOf,
  lostTablesText,
  SOURCE_REFUSED_REASON,
  ACCESS_CHECKING,
  ACCESS_UNKNOWN,
  accessVerdictOf,
  NEW_APPS_ACCESS_ACTION,
  appGrantText,
  profileEstimate,
  costHint,
  PREFLIGHT_LABELS,
  checksFor,
  PROFILE_FIELDS,
  APP_NAME_RE,
  START_MVP_LABEL,
  RESET_ROLES_LABEL,
  BUILD_STEP_IDS,
  pickedSummary,
  APP_ACCESS_CHOICES,
  APP_ACCESS_NOTE,
  APP_BACKEND_CHOICES,
  LAKEBASE_CHECKING,
  appBackendOf,
  appBackendBlocks,
  LAKEBASE_UNCHECKED,
  sentSpec,
  editedWidgets,
  withFirstRunSaved,
  withAppBackend,
  appWarehouseLabel,
  appWarehouseOf,
  withAppWarehouse,
  warehouseText,
  warehouseOptions,
  warehouseOptionText,
  warehouseStateNote,
  warehouseListNote,
  buildWarehouseNote,
  joinedWarehouseText,
  APP_OPTIONS,
  APP_NO_DOWNLOADS,
  APP_REFRESH_NOTE,
  REPLACE_EDITS_QUESTION,
  REPLACE_EDITS_CHOICES,
  PER_USER_REASON,
  APP_STYLES,
  APP_LAYOUTS,
  APP_THEMES,
  joinedAppText,
  joinsApp,
  APP_NEXT_NOTE,
  lookLabel,
  lookText,
  APP_LOOK_TABS,
  APP_SAMPLE_NOTE,
  APP_CHARTS_NOTE,
  APP_CHARTS_MIN,
  APP_CHARTS_MIN_NOTE,
  APP_CHARTS_RESET,
  APP_CHART_KINDS,
  APP_TREND_NO_DATE,
  APP_PAGES_NOTE,
  APP_ALWAYS_ON,
  appInputDates,
  appChartsOf,
  appChartsPicked,
  appChartPickText,
  appScreensOf,
  withAppChart,
  withInspireCharts,
  withAppPage,
  appPagesOf,
  LAKEVIEW_STYLE_NOTE,
  GENIE_FOR_APP_NOTE,
  RESULT_TABLE_MOVE_NOTE,
  MERGE_OUTPUTS,
  resultTableParts,
  withResultTable,
  withOutput,
  withAppAccess,
  withAppOption,
  withAppLook,
  appOptionShown,
  mergeTargetOf,
  withMergeTarget,
  withPlacementDefault,
  withNewApp,
  newAppPlacementBlock,
  appPlacementChoices,
  placementMemoryText,
  APP_OWN_PLACEMENTS,
  APP_INSIDE,
  APP_INSIDE_PLACEMENT,
  APP_PLACE_WAITING,
  INSIDE_ACCESS_REASON,
  INSIDE_WAREHOUSE_LABEL,
  INSIDE_WAREHOUSE_TOGGLE,
  INSIDE_WAREHOUSE_PROBLEM,
  insideInspire,
  withHeldApp,
  APP_PLACEMENT_DEFAULT,
  domainOf,
  caseAppNameOf,
  heldAssets,
  goneAssetText,
  mergeTargetText,
  withCollectedVibes,
  collectedVibesText,
  vibesProblem,
  vibePreviousProblem,
  vibePreviousChoices,
  builtVersion,
  VIBES_STEP_TITLE,
  VIBES_STEP_NOTE,
  vibesSkippedText,
  modelNameOf,
  preflightParams,
  splitList,
  APP_OWNERS_LABEL,
  APP_OWNERS_HELP,
  HOLDOUT_LABEL,
  HOLDOUT_BLURB,
  HOLDOUT_MIN_PERCENT,
  HOLDOUT_MAX_PERCENT,
  holdoutOf,
  holdoutPercentText,
  holdoutProblems,
  withHoldout,
  withHoldoutPercent,
  outputBlocks,
  droppedOutputs,
  withoutUnavailableOutputs,
  FRESH_HELP,
  FRESH_LABEL,
  withClears,
  withDigest,
  grainCheck,
  entityKeyOptions,
  withEntityKey,
  keptDefaultsText,
  genieNotebookRequest,
  checkCallRefused,
  skippedAsksText,
  withAppLookDefaults,
  withoutMissingRoles,
  uncountedReadiness,
  outputUncheckedText,
  DELIVERY_LABEL,
  NOTEBOOK_CARD,
  RUN_IT_TITLE,
  APP_ACCESS_QUESTION,
  USE_CASE_DETAILS_LABEL,
  BUILD_NOW_LABEL,
  CHANGE_LABEL,
  builtSentence,
  DELIVERY_QUESTION,
  resultTableProblems,
  dataFilterProblems,
  REBUILD_AS_IS_NOTE,
  rebuildNeedsChoice,
  APP_BACKEND_GUIDE,
  PER_USER_GUIDE,
  MEASURE_LABEL,
  withMoneyRule,
  BUILD_IT_LABEL,
  mergeSwaps,
  swapParts,
  BACK_TO_SUMMARY,
  SUMMARY_STEP,
  nextStepAfter,
  APP_LOOK_DEFAULT,
} from '../lib/implementWizard';
import {
  bestAppAccess, bestAppBackend, bestHeldApp, bestAppOption, bestAppPolicy, bestAppTarget, bestFreshness, bestHoldout, bestKpi, bestLook,
  bestOutput, bestReplaceEdits, isBest,
  bestResultPlace, oneBestPerStep, resultPlaceBlocks,
} from '../lib/recommended';
import Recommended, { BestOf } from '../components/Recommended';
import { counted } from '../lib/plural';
import { personalColumn } from '../lib/personalColumns';
import { PLACE_RIGHTS, placeNameProblem } from '../lib/tableName';
import { BlockedReason, ClearsChoice, DigestChoice, RowSubjectCheck } from '../components/WizardStickParts';
import TechnicalDetails, { PlainMessage } from '../components/TechnicalDetails';
import { AppReadAccess, GrantList } from '../components/AppReadAccess';
import { placeholderWords } from '../lib/placeholderWords';
import {
  KPI_CHANGE_NOTE, KPI_INSPIRE_PICKS, KPI_NONE_YET, KPI_PICK_RULE, kpiKey, kpiOptionLabel, kpiTargetOf, kpiTargetOptions, kpiTargetProblems, trackedKpiOf,
  stakeWords, trackedKpiText, withKpiTarget,
} from '../lib/targetKpi';
import {
  SETTINGS_ON_THEIR_STEP, isSettingWidget, settingsModelOf, withSetting,
} from '../lib/useCaseSettings';
import ScopeSettings, { GroupingChosen } from '../components/ScopeSettings';
import CatalogPicker from '../components/CatalogPicker';
import { PROFILE_WAITING, useScopeProfiles } from '../lib/groupingProfile';
import { fieldOf } from '../lib/useCaseFields.js';
import { tableScopeSummary } from '../lib/tableScope';
import { DRAFT_BACK_NOTE, DRAFT_START_OVER, clearWizardDraft, readWizardDraft, draftStampOf, wizardDraftKey, writeWizardDraft } from '../lib/wizardDraft';
import {
  FIRST_RUN_TITLE, GROUPING_EXAMPLE, GROUPING_PICK, GROUPING_TITLE, RUN_SCOPE_UNRECORDED_HIDDEN, builtFirstRunOf, deepGrouping, groupingChosenBy, isFirstRunSetting, isGroupingSetting, isScopeSetting,
  latestRunScope, scopeChanges, scopeStepsOf, scopeValues,
  withGroupingDefault, withScopeDefaults, GROUP_BY, groupingChoices, groupingCount, groupingCountText, groupingOf, firstRunSummaryText,
  withScopedRows,
  scopedGroupRows,
} from '../lib/runScope';

const ICONS = { notebook: NotebookPen, dashboard: LayoutDashboard, genie_space: Sparkles, app: AppWindow, alert: Bell };
const ASSET_NOUNS = { dashboard: 'a dashboard', genie_space: 'a Genie Agent', app: 'an App', alert: 'an alert' };
const ACCESS_ICONS = { user: UserRound, sp: KeyRound };
const NO_WIDGET_GROUPS = { business: [], model: [], ai: [], extras: [], extras_kept_default: [] };
const COLUMN_ROLES = ['entity_id', 'event_date', 'measure', 'label', 'segment'];
const ALL_FEATURES = { apps: true, genie_spaces: true, alerts: true };
const TILE_CHECKS = { app: ['app_access', 'apps'], genie_space: ['genie_spaces'], alert: ['alerts'] };
const PLACE_CHECKS = ['app_name'];
const CHOOSE_CHECKS = ['genie_code'];

function withProfileDefaults(spec, profile, defaults = withScopeDefaults) {
  const read = scopeValues((name) => spec.config.widgets?.[name]);
  const before = deepGrouping(profile).length ? withGroupingDefault(read, profile, spec.config.widgets?.[GROUP_BY]) : read;
  const after = defaults(before, profile);
  return scopeChanges(before, after).reduce((next, name) => withSetting(next, { name, source: 'widget' }, after[name]), spec);
}
const ACCESS_CHECKS = ['app_warehouse'];
const TILE_CHECK_KEYS = [...Object.values(TILE_CHECKS).flat(), ...PLACE_CHECKS, ...ACCESS_CHECKS];

const rowWithCard = (card, row) => ({ ...(card || {}), ...(row || {}) });

const failureReasonOf = (error) => {
  const plain = splitTechnical(error?.message).plain.replace(/[.\s]+$/, '');
  return plain ? `Reason: ${plain}.` : '';
};

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}

const inputFrame = 'border border-border rounded-md bg-surface text-text-primary glow-focus';
const inputBase = `px-2.5 py-2 text-sm ${inputFrame}`;
const inputCls = `w-full ${inputBase}`;

function ListInput({ value, separator, onChange, multiline = false, ...props }) {
  const list = Array.isArray(value) ? value : [];
  const joined = list.join(separator === ',' ? ', ' : separator);
  const [text, setText] = useState(joined);
  const shown = JSON.stringify(splitList(text, separator)) === JSON.stringify(list) ? text : joined;
  const change = (e) => {
    setText(e.target.value);
    onChange(splitList(e.target.value, separator));
  };
  return multiline ? <textarea dir="auto" {...props} value={shown} onChange={change} /> : <input dir="auto" {...props} value={shown} onChange={change} />;
}

function ProfileInput({ spec, path, onChange }) {
  const [section, name] = path.split('.');
  const value = spec.config.profiles[section]?.[name] ?? '';
  const problem = profileFieldProblem(path, value);
  return (
    <Field label={`${PROFILE_FIELDS[path].label} (${PROFILE_FIELDS[path].allowed})`}>
      <input dir="auto" className={inputCls} value={value} onChange={(e) => onChange(section, { ...spec.config.profiles[section], [name]: e.target.value })} />
      {problem && <p className="text-[11px] text-error-fg">{problem}</p>}
    </Field>
  );
}

function WidgetInput({ widget, value, endpoints, onChange }) {
  const problem = value === undefined ? '' : widgetValueProblem(widget.name, value, widget.allowed);
  const allowed = widget.allowed || (widget.type === 'dropdown' ? 'one of the listed choices' : 'any value');
  let input;
  if (widget.name === 'ai_endpoint') {
    input = (
      <select className={inputCls} value={value ?? widget.default ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value={widget.default || ''}>{widget.default || 'Pick an endpoint'}</option>
        {endpoints.filter((e) => e.name !== widget.default).map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
      </select>
    );
  } else if (widget.type === 'dropdown' && (widget.choices || []).length) {
    input = (
      <select className={inputCls} value={value ?? widget.default ?? ''} onChange={(e) => onChange(e.target.value === widget.default ? '' : e.target.value)}>
        {widget.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    );
  } else {
    input = <input dir="auto" className={inputCls} value={value ?? ''} placeholder={widget.default ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-mono text-[11px] text-text-primary">{widget.name}</span>
        <span className="text-[10px] text-text-tertiary">
          default {widget.default === '' || widget.default == null ? 'empty' : widget.default} · allowed {allowed}
        </span>
      </div>
      {input}
      {widget.label && <p className="text-[11px] text-text-secondary">Used for: {widget.label}</p>}
      {problem && <p className="text-[11px] text-error-fg">{problem}</p>}
    </div>
  );
}

function FoldLine({ label, what, summary, onOpen }) {
  return (
    <div className="border-t border-border pt-3 flex items-start justify-between gap-3">
      <p data-fold-line={label} className="text-[12px] text-text-secondary min-w-0"><span className="font-semibold text-text-primary">{label}: </span>{summary}</p>
      <button type="button" aria-expanded={false} aria-label={`${CHANGE_LABEL} ${what}`} onClick={onOpen}
        className="shrink-0 text-xs font-medium text-db-red-fg hover:underline glow-focus">
        {CHANGE_LABEL}
      </button>
    </div>
  );
}

function Advanced({ open, onToggle, children, summary = '', what = 'settings' }) {
  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-text-secondary min-w-0">{summary}</p>
        <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : CHANGE_LABEL} ${what}`} onClick={onToggle}
          className="shrink-0 text-xs font-medium text-db-red-fg hover:underline glow-focus">
          {open ? 'Close' : CHANGE_LABEL}
        </button>
      </div>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  );
}

function SettingRow({ label, value, children, changeLabel = label, help = '', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-setting={label} className="border-t border-border pt-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-text-secondary min-w-0"><span className="text-text-tertiary">{label}:</span> <span className="text-text-primary">{value}</span>{help && <span className="block text-[11px] text-text-tertiary">{help}</span>}</p>
        <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : CHANGE_LABEL} ${changeLabel}`} onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs font-medium text-db-red-fg hover:underline glow-focus">
          {open ? 'Close' : CHANGE_LABEL}
        </button>
      </div>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

function CheckLine({ check, label }) {
  return (
    <div className={`text-[11px] ${check.ok ? 'text-success-fg' : 'text-error-fg'}`}>
      <PlainMessage text={`${label}: ${check.detail}`} className="text-[11px]" />
      {check.warn && <span className="block text-warning-fg">{check.warn}</span>}
    </div>
  );
}

const MONEY_PART_LABEL = { method: 'How it is found', direction: 'Which movement counts', currency: 'Currency', window: 'Periods and statuses', off: 'Turn it off' };

export default function ImplementWizard({
  uc,
  sessionId,
  settings,
  discoveryType,
  apiFetch,
  apiPostJson,
  onClose,
  onImplemented,
  onOpenBuild = null,
  focus = null,
  live = null,
}) {
  const warehouseId = settings.warehouseId;
  const inspireDatabase = settings.inspireDatabase;
  const [mode, setMode] = useState('mvp');
  const [step, setStep] = useState(() => initialStepId(focus));
  const [backToSummary, setBackToSummary] = useState(false);
  const [visited, setVisited] = useState([]);
  const [spec, setSpec] = useState(() => defaultSpecFromUseCase(uc, { warehouseId, inspireDatabase, sessionId }));
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [attempted, setAttempted] = useState({ data: false, delivery: false });
  const [checking, setChecking] = useState('');
  const [advanced, setAdvanced] = useState({ data: false, results: false, fresh: false, delivery: false, app_place: false, app_access: false, app_options: false, app_pages: false, summary: false });
  const [details, setDetails] = useState(false);
  const [moneyPart, setMoneyPart] = useState(0);
  const [lookView, setLookView] = useState({ tab: 'style', page: 'fix' });
  const toggleAdvanced = (id) => setAdvanced((prev) => ({ ...prev, [id]: !prev[id] }));
  const [columnsByTable, setColumnsByTable] = useState({});
  const [tagNotes, setTagNotes] = useState({});
  const [columnsErrors, setColumnsErrors] = useState({});
  const [preflight, setPreflight] = useState(null);
  const [preflightError, setPreflightError] = useState('');
  const [checksBusy, setChecksBusy] = useState(false);
  const [outputCheck, setOutputCheck] = useState(null);
  const [dropped, setDropped] = useState([]);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState('');
  const [appUnreadable, setAppUnreadable] = useState(null);
  const [appGrant, setAppGrant] = useState(null);
  const [granting, setGranting] = useState(false);
  const [grantRound, setGrantRound] = useState(0);
  const [newAppsGrant, setNewAppsGrant] = useState(null);
  const [planShared, setPlanShared] = useState(null);
  const notebookFolder = generationFolder({
    generationPath: context?.generation_path, notebookPath: settings.notebookPath, businessName: context?.business_name,
  });
  const folderWarning = sharedFolderWarning(notebookFolder);
  const [notice, setNotice] = useState(() => lostTablesText(focus?.missingTables));
  const [collectedNote, setCollectedNote] = useState('');
  const [missingTables, setMissingTables] = useState(() => focus?.missingTables || []);
  const lostReason = (table) => missingTables.find((m) => String(m.table).toLowerCase() === table.toLowerCase())?.reason;
  const [changing, setChanging] = useState({});
  const [swaps, setSwaps] = useState({});
  const [swapsWhy, setSwapsWhy] = useState({});
  const [values, setValues] = useState({});
  const [readiness, setReadiness] = useState(null);
  const [checkNotes, setCheckNotes] = useState({});
  const [principalQ, setPrincipalQ] = useState('');
  const [principals, setPrincipals] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [destinations, setDestinations] = useState(null);
  const [destinationsError, setDestinationsError] = useState('');
  const [targets, setTargets] = useState(null);
  const [targetsError, setTargetsError] = useState('');
  const [look, setLook] = useState(null);
  const [lookError, setLookError] = useState('');
  const [lakebase, setLakebase] = useState(null);
  const [rebuildAsIs, setRebuildAsIs] = useState(false);
  const [warehouses, setWarehouses] = useState(null);
  const [warehousesError, setWarehousesError] = useState('');
  const [catalogs, setCatalogs] = useState(null);
  const [catalogsCut, setCatalogsCut] = useState(false);
  const [catalogsError, setCatalogsError] = useState('');
  const [schemas, setSchemas] = useState({});
  const onTargetsRetry = () => { setTargetsError(''); setTargets(null); };
  const onWarehousesRetry = () => { setWarehousesError(''); setWarehouses(null); };
  const onLookRetry = () => { setLookError(''); setLook(null); };
  const onDestinationsRetry = () => { setDestinationsError(''); setDestinations(null); };
  const onCatalogsRetry = () => { setCatalogsError(''); setCatalogs(null); };
  const onSchemasRetry = (catalog) => setSchemas((prev) => {
    const { [catalog]: _dropped, ...rest } = prev;
    return rest;
  });
  const [ownSchema, setOwnSchema] = useState(null);
  const [schemaJob, setSchemaJob] = useState(null);
  const [placeNote, setPlaceNote] = useState('');
  const bodyRef = useRef(null);
  const groupingDefaulted = useRef(false);
  const accessDefaulted = useRef(false);
  const appNameTyped = useRef(false);
  const [appRenamed, setAppRenamed] = useState(null);
  const [lastNameShown, setLastNameShown] = useState(false);
  const [appNameRefusal, setAppNameRefusal] = useState(null);
  const [placeSet, setPlaceSet] = useState('');
  const [draftBack, setDraftBack] = useState(false);
  const [dataChoice, setDataChoice] = useState(null);
  const draftStamp = useRef('');
  const touched = useRef(false);
  const loadedSpec = useRef(null);
  const draftKey = useMemo(() => wizardDraftKey({ host: settings.databricksHost, inspireDatabase, sessionId, useCaseId: spec.use_case_id }),
    [settings.databricksHost, inspireDatabase, sessionId, spec.use_case_id]);
  const settingsModel = useMemo(() => settingsModelOf(context?.history), [context?.history]);
  const alertOn = Boolean(spec.outputs.alert);
  const everySetting = useMemo(() => contextSettings(context, { outputs: { alert: alertOn } }), [context, alertOn]);
  const ucRow = useMemo(() => rowWithCard(uc, context?.use_case), [uc, context?.use_case]);
  const primaryOriginal = primaryTableOf(ucRow);
  const primaryChosen = spec.data.tables[primaryOriginal] || primaryOriginal;
  const scopeProfile = useScopeProfiles({ apiPostJson, inspireDatabase, sessionId, useCaseId: spec.use_case_id, warehouseId, enabled: mode === 'mvp',
    groupBy: spec.config.widgets?.[GROUP_BY], defaultGrouping: true, table: primaryChosen });
  const builtFirstRun = builtFirstRunOf(settingsModel);
  const firstRunUnrecorded = useMemo(() => latestRunScope(context?.latest).unrecorded, [context?.latest]);
  const ranBefore = builtFirstRun || Boolean(context?.latest && context.latest.status !== 'failed');
  const scopeSteps = scopeStepsOf(scopeProfile.state, scopeProfile.profile, ranBefore);
  const scopeSettingList = useMemo(() => everySetting.filter(isScopeSetting), [everySetting]);
  const settingsFor = useCallback((scope, read) => everySetting.filter((s) => !(isGroupingSetting(s) && (scope.grouping || read))
    && !(isFirstRunSetting(s) && scope.firstRun)), [everySetting]);
  const profileRead = scopeProfile.state === 'ready';
  const settingsList = useMemo(() => settingsFor(scopeSteps, profileRead), [settingsFor, scopeSteps.grouping, scopeSteps.firstRun, profileRead]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepScope = useMemo(() => ({ ...scopeSteps, settings: settingsList.length > 0 }), [scopeSteps.grouping, scopeSteps.firstRun, settingsList.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = wizardSteps(mode, spec, stepScope);
  const stepIndex = stepIndexOf(steps, step);
  const stepId = steps[stepIndex].id;
  const shows = (panel) => steps[stepIndex].panels.includes(panel);
  const moneyParts = spec.money?.off ? ['off'] : [...MONEY_PARTS.filter((p) => p !== 'off'), 'off'];
  const moneyActive = Math.min(moneyPart, moneyParts.length - 1);
  useEffect(() => { if (steps[stepIndex].id === 'stake') setMoneyPart(0); }, [stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultsOn = shows('results');
  useEffect(() => {
    if (!context || !scopeSteps.grouping || context.latest || groupingDefaulted.current) return;
    groupingDefaulted.current = true;
    setSpec((prev) => withProfileDefaults(prev, scopeProfile.profile, withGroupingDefault));
  }, [scopeSteps.grouping, context, scopeProfile.profile]);
  const lastStep = stepIndex === steps.length - 1;
  const scopeReady = scopeProfile.state !== 'loading';
  const scopeNow = readinessScope(spec, ucRow);
  const scopeKey = JSON.stringify(scopeNow);
  const readCounted = countedFor(readiness, scopeNow);
  const scopeCounted = Boolean(readCounted);
  const narrowed = scopeNarrowing(scopeNow).length > 0;
  const scopeCount = scopeCounted ? Number(readCounted.row_count) : null;
  const scopeGroups = scopeCounted ? readCounted.groups || null : null;
  const scopedProfile = narrowed ? withScopedRows(scopeProfile.profile, scopeCount, scopeGroups) : scopeProfile.profile;
  const scopedFirstRun = narrowed && scopeProfile.firstRun ? { ...scopeProfile.firstRun, profile: withScopedRows(scopeProfile.firstRun.profile, scopeCount, scopeGroups) } : scopeProfile.firstRun;
  const tooFewRows = tooFewRowsText(readCounted);
  const totalSteps = useMemo(() => steps.length, [scopeReady, Boolean(spec.outputs.app)]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useMemo(() => {
    const p = new URLSearchParams({
      inspire_database: inspireDatabase,
      warehouse_id: warehouseId,
      session_id: String(sessionId),
      use_case_id: spec.use_case_id,
    });
    return p.toString();
  }, [inspireDatabase, warehouseId, sessionId, spec.use_case_id]);

  // The result table is the build's own output: the context verdict must skip it, so the wizard names it.
  const contextQ = `${q}&result_table=${encodeURIComponent(spec.config?.result_table || '')}`;

  const patch = (path, value) => {
    setSpec((prev) => {
      const next = { ...prev };
      const parts = path.split('.');
      let cur = next;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        cur[key] = Array.isArray(cur[key]) ? [...cur[key]] : { ...(cur[key] || {}) };
        cur = cur[key];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const loadSwaps = useCallback(async (table) => {
    const post = (part, body) => apiPostJson(`/api/inspire/implement/swaps?${q}${part ? `&part=${part}` : ''}`, body);
    try {
      await swapParts(post, table, (list, why) => {
        setSwaps((prev) => ({ ...prev, [table]: mergeSwaps(prev[table], list) }));
        if (why !== null) setSwapsWhy((prev) => ({ ...prev, [table]: why }));
      });
    } catch (e) {
      setSwaps((prev) => ({ ...prev, [table]: prev[table] || [] }));
      setErrors([e.message]);
    }
  }, [apiPostJson, q]);

  const searchTable = useCallback(async (original, table) => {
    const data = await apiFetch(`/api/inspire/implement/table-lookup?${q}&source=${encodeURIComponent(original)}&table=${encodeURIComponent(table)}`);
    return data;
  }, [apiFetch, q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/inspire/implement/context?${contextQ}`);
        if (cancelled) return;
        setContext(data);
        if (genieCodeOff(data.features)) setMode('notebook');
        setAppUnreadable(data.app_unreadable || null);
        const row = rowWithCard(uc, data.use_case);
        const fallback = defaultSpecFromUseCase(row, {
          warehouseId,
          inspireDatabase,
          sessionId,
          owner: data.me?.username,
          businessName: data.business_name,
        });
        if (data.own_schema?.table) fallback.config.result_table = data.own_schema.table;
        setOwnSchema(data.own_schema || null);
        if (data.own_schema?.place === 'own' && !data.own_schema.create && data.own_schema.table) {
          const own = resultTableParts(data.own_schema.table);
          apiPostJson(`/api/inspire/implement/create-schema?${q}`, {
            catalog: own.catalog, schema: own.schema, tags: schemaTagsOf({ sessionId, useCaseId: fallback.use_case_id, businessName: data.business_name, inspireDatabase }),
          }).then((made) => {
            if (cancelled) return;
            if ((made.warnings || []).length) setPlaceNote((made.warnings || []).join(' '));
            setGrantRound((n) => n + 1);
          }).catch(() => {});
        }
        setPlaceNote(data.latest ? '' : data.own_schema?.note || '');
        const missing = [...(focus?.missingTables || []), ...(data.missing_tables || [])]
          .filter((m, i, all) => all.findIndex((o) => String(o.table).toLowerCase() === String(m.table).toLowerCase()) === i);
        const { spec: kept, reverted } = revertLostSwaps(specFromLatest(data.latest, fallback, data.assets), row, missing);
        const collected = withCollectedVibes(kept, focus?.collected);
        const next = collected.spec;
        if (!next.config.warehouse_id) next.config.warehouse_id = warehouseId;
        setSpec(next);
        setMissingTables(missing);
        if (['review', 'summary', 'vibes', 'settings', 'app', 'app_pages', 'app_place', 'app_access', 'app_features', 'app_storage', 'app_look', 'run', 'measure', 'fresh'].includes(focus?.step)) setStep(initialStepId(focus, 'mvp', next));
        loadedSpec.current = next;
        draftStamp.current = draftStampOf(data.use_case, data.latest);
        const draft = readWizardDraft(draftKey, draftStamp.current);
        if (draft) {
          groupingDefaulted.current = true;
          accessDefaulted.current = true;
          setSpec(draft.spec);
          if (draft.spec.outputs?.app) setPlaceSet('person');
          if (!focus?.step) setStep(draft.step);
          setVisited(draft.visited);
          setDraftBack(true);
        }
        const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
        const chosenOf = (t) => ((next.data.removed_tables || []).some((r) => same(r, t)) ? ''
          : next.data.tables[Object.keys(next.data.tables).find((k) => same(k, t))] || t);
        const lost = tablesOf(row).filter((t) => chosenOf(t) && missing.some((m) => same(m.table, chosenOf(t))));
        const stillLost = missing.filter((m) => lost.some((t) => same(chosenOf(t), m.table)))
          .map((m) => (same(chosenOf(primaryTableOf(row)), m.table) ? { ...m, primary: true } : m));
        setNotice([revertedSwapsText(reverted), lostTablesText(stillLost)].filter(Boolean).join(' '));
        setCollectedNote(collectedVibesText(collected));
        if (lost.length) {
          setChanging(Object.fromEntries(lost.map((t) => [t, true])));
          lost.forEach((t) => { loadSwaps(t); });
        }
      } catch (e) {
        if (!cancelled) setErrors([e.message]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeScope = useMemo(() => ({ business: context?.business_name || '', domain: domainOf(ucRow), useCaseAppName: caseAppNameOf(ucRow) }),
    [context?.business_name, ucRow]);
  const notebookEdit = editedNotebook(context?.latest);
  const editing = Boolean(context?.latest);
  const trainsModel = context?.trains_model !== false;
  const sourceTables = useMemo(() => {
    const removed = spec.data.removed_tables || [];
    return tablesOf(ucRow)
      .filter((t) => !removed.some((r) => r.toLowerCase() === t.toLowerCase()))
      .map((t) => spec.data.tables[t] || t);
  }, [ucRow, spec.data.tables, spec.data.removed_tables]);

  const loadColumns = useCallback(async (table) => {
    if (!table || columnsByTable[table]) return;
    try {
      const data = await apiFetch(`/api/inspire/implement/columns?${q}&table=${encodeURIComponent(table)}`);
      setColumnsByTable((prev) => ({ ...prev, [table]: data.columns || [] }));
      setTagNotes((prev) => ({ ...prev, [table]: data.tags_read === false ? data.tags_note || '' : '' }));
      setColumnsErrors((prev) => ({ ...prev, [table]: '' }));
    } catch (e) {
      setColumnsErrors((prev) => ({ ...prev, [table]: e.message }));
    }
  }, [apiFetch, q, columnsByTable]);

  useEffect(() => {
    if (!context) return;
    sourceTables.forEach((t) => { loadColumns(t); });
  }, [context, sourceTables.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loading || !touched.current || !draftStamp.current) return;
    writeWizardDraft(draftKey, { stamp: draftStamp.current, spec, step, visited });
  }, [loading, draftKey, spec, step, visited]);

  useEffect(() => {
    bodyRef.current?.scrollTo?.(0, 0);
    setVisited((prev) => (prev.includes(step) ? prev : [...prev, step]));
    if (step === SUMMARY_STEP.id) setBackToSummary(false);
  }, [step]);

  useEffect(() => {
    if (!firstRunUnrecorded || scopeProfile.state === 'loading') return;
    setSpec((prev) => withProfileDefaults(prev, scopeProfile.profile));
  }, [firstRunUnrecorded, scopeProfile.state, scopeProfile.profile]);

  const groups = context?.widget_groups || NO_WIDGET_GROUPS;
  const built = builtVersion(context?.history);
  const kpiOptions = useMemo(() => kpiTargetOptions(ucRow, context?.history), [ucRow, context?.history]);
  const scopeShown = withGroupingDefault(scopeValues((name) => spec.config.widgets?.[name]), scopeProfile.profile, spec.config.widgets?.[GROUP_BY]);
  const trackedKpi = trackedKpiOf(context?.history);
  const chosenKpi = kpiTargetOf(spec);
  const sampleStake = trackedKpi && (!chosenKpi || kpiKey(chosenKpi) === kpiKey(trackedKpi.record.name)) ? trackedKpi.impact : null;
  const placeSettled = !spec.outputs.app || (targets !== null && (placeSet === 'default' || placeSet === 'person'));
  const features = preflight?.features || context?.features || ALL_FEATURES;
  const blocks = useMemo(() => outputBlocks(features, outputCheck, context?.assets, preflight), [features, outputCheck, context?.assets, preflight]);
  const extras = { columnsByTable, widgets: context?.widgets || [], trainsModel, mergeTargets: targets, held: context?.assets || {}, appLook: look, built, placeSettled,
    lakebase, warehouses, kpiOptions, settings: settingsList, sourceTables, scopeSteps: stepScope, scopeProfile: scopeProfile.profile, outputBlocks: blocks };
  const chartDates = appInputDates(columnsByTable, sourceTables);
  const ownErrors = stepErrors(stepId, spec, extras, mode);
  const resultAuto = advanced.results || Boolean(placeNote) || outputCheck?.write?.ok === false;
  const errorBlock = stepId !== 'data' ? null : dataFilterProblems(spec).length ? 'filters' : resultTableProblems(spec.config.result_table).length ? 'results' : null;
  const dataFolded = errorBlock ?? dataChoice ?? (resultAuto ? 'results' : null);
  const resultsShown = dataFolded === 'results';
  const sourcesShown = dataFolded === null || dataFolded === 'sources';
  const filtersShown = dataFolded === null || dataFolded === 'filters';
  const reach = steps.map((s, i) => i <= stepIndex || steps.slice(0, i).every((p) => !stepErrors(p.id, spec, extras, mode).length));
  const done = steps.map((s, i) => i < stepIndex && !stepErrors(s.id, spec, extras, mode).length);
  const goTo = (id) => { setErrors([]); setStep(id); };

  const eventRef = spec.data.column_roles.event_date || '';
  const estimate = (windowDays, more = {}) => profileEstimate({
    evidence: context?.evidence,
    table: primaryChosen,
    dateColumn: eventRef && refTable(eventRef).toLowerCase() === primaryChosen.toLowerCase() ? refColumn(eventRef) : '',
    windowDays,
    dataWindow: spec.data.window,
    ...more,
  }).text;

  const setProfile = (section, value) => patch(`config.profiles.${section}`, value);

  const setWidget = (name, value) => setSpec((prev) => {
    const widgets = { ...prev.config.widgets };
    if (value === '') delete widgets[name];
    else widgets[name] = value;
    const config = { ...prev.config, widgets };
    if (name === 'ai_endpoint') config.ai_endpoint = value;
    return { ...prev, config };
  });

  const blockedBy = (id) => {
    setAttempted((prev) => ({ ...prev, [id]: true }));
    if (!stepErrors(id, spec, extras, mode).length) return false;
    const hidden = advancedWithErrors(id, spec, extras, mode);
    if (hidden.length) setAdvanced((prev) => ({ ...prev, ...Object.fromEntries(hidden.map((section) => [section, true])) }));
    if (id === 'data' && (!String(spec.use_case.goal || '').trim() || !String(spec.use_case.decision_owner || '').trim())) setDetails(true);
    if (id === SUMMARY_STEP.id) {
      const where = vibesProblem('mvp', spec.vibes, 'MVP') ? '[data-vibes="mvp"] textarea' : vibePreviousProblem(spec, built) ? '[data-vibe-previous] input' : '';
      if (where) bodyRef.current?.querySelector(where)?.focus();
    }
    return true;
  };

  const outputCheckPath = () => `/api/inspire/implement/output-check?${q}&${new URLSearchParams({
    table: spec.config.result_table, model_name: modelNameOf(spec) }).toString()}`;

  const grantNewApps = async () => {
    setGranting(true);
    try {
      const got = await apiPostJson(`/api/inspire/implement/grant-access?${q}&${new URLSearchParams({ kind: 'new_apps', table: spec.config.result_table }).toString()}`, {});
      setOutputCheck(await apiFetch(outputCheckPath()));
      setGrantRound((n) => n + 1);
      setNewAppsGrant({ text: got.detail, ran: got.ran || [] });
    } catch (e) {
      setNewAppsGrant({ text: e.message, ran: [] });
    } finally {
      setGranting(false);
    }
  };

  const countScope = async (scope) => {
    const counted = await apiPostJson(`/api/inspire/implement/readiness?${q}`, {
      table: scope.table,
      discovery_type: discoveryType,
      technique: fieldOf(ucRow, 'Analytics Technique', 'analytics_technique'),
      columns: scope.columns,
      filters: scope.filters,
      window: scope.window,
    }).catch((e) => {
      if (checkCallRefused(e)) throw e;
      return uncountedReadiness(scope);
    });
    setCheckNotes((prev) => ({ ...prev, data: counted.unchecked || '' }));
    let warning = '';
    if (!counted.skipped && Number(counted.row_count) === 0) {
      warning = await emptyScopeWarningOf(scope, sourceTables, (table) => apiPostJson(`/api/inspire/implement/readiness?${q}`, {
        table, discovery_type: discoveryType, columns: [], filters: [], window: {},
      }));
    }
    const groupColumns = scopeNarrowing(scope).length ? groupPartColumns(scopeProfile.profile) : [];
    const groups = groupColumns.length && !counted.skipped
      ? await apiPostJson(`/api/inspire/implement/group-counts?${q}`, { table: scope.table, columns: groupColumns, filters: scope.filters, window: scope.window })
        .then(scopedGroupRows).catch(() => null)
      : null;
    return { ...counted, scope, warning, groups };
  };

  useEffect(() => {
    if (mode !== 'mvp' || !narrowed || scopeCounted || !shows('first_run') || !scopeNow.table) return undefined;
    let live = true;
    countScope(scopeNow).then((got) => { if (live) setReadiness(got); }).catch(() => {});
    return () => { live = false; };
  }, [scopeKey, stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = async () => {
    setErrors([]);
    if (stepId === 'stake' && moneyActive < moneyParts.length - 1) { setMoneyPart(moneyActive + 1); return; }
    if (mode === 'notebook') {
      setStep(steps[stepIndex + 1].id);
      return;
    }
    if (blockedBy(stepId)) return;
    try {
      if (stepId === 'data') {
        const scope = readinessScope(spec, ucRow);
        if (scope.table) {
          setChecking('Checking the data');
          setReadiness(await countScope(scope));
        }
      }
      if (resultsOn && resultPlace === 'own') {
        const own = resultTableParts(ownTable);
        setSchemaJob({ state: 'running', text: `Creating the use case schema ${own.catalog}.${own.schema} in the background. You can keep going; Build waits for it.` });
        apiPostJson(`/api/inspire/implement/create-schema?${q}`, {
          catalog: own.catalog, schema: own.schema, tags: schemaTagsOf({ sessionId, useCaseId: spec.use_case_id, businessName: context?.business_name, inspireDatabase }),
        }).then(async (made) => {
          setOwnSchema((prev) => ({ ...(prev || {}), own_table: ownTable, table: ownTable, place: 'own', create: false }));
          setPlaceNote((made.warnings || []).join(' '));
          const check = await apiFetch(outputCheckPath()).catch((e) => (checkCallRefused(e) ? { ok: false, detail: e.message } : { ok: true, unchecked: outputUncheckedText(spec.config.result_table, e) }));
          setOutputCheck(check.unchecked ? null : check);
          const failed = [check.write, check.safety, check.model].find((c) => c && !c.ok);
          setSchemaJob(failed ? { state: 'failed', text: failed.detail } : { state: 'done', text: '' });
        }).catch((e) => {
          setSpec((prev) => withResultTable(prev, resultTableParts(inspireTable)));
          setOwnSchema((prev) => ({ ...(prev || {}), place: 'inspire', create: false }));
          setPlaceNote(`${ownSchemaFallbackNote(own.catalog, context?.me?.username)} ${failureReasonOf(e)}`);
          setOutputCheck(null);
          setSchemaJob({ state: 'failed', text: `${ownSchemaFallbackNote(own.catalog, context?.me?.username)} ${failureReasonOf(e)}` });
        });
      } else if (resultsOn) {
        setChecking('Checking you can write the result table');
        const check = await apiFetch(outputCheckPath()).catch((e) => {
          if (checkCallRefused(e)) throw e;
          return { ok: true, unchecked: outputUncheckedText(spec.config.result_table, e) };
        });
        setOutputCheck(check.unchecked ? null : check);
        setCheckNotes((prev) => ({ ...prev, results: check.unchecked || '' }));
        if (!check.ok) {
          const failed = [check.write, check.safety, check.model].find((c) => c && !c.ok);
          setErrors([failed?.detail].filter(Boolean));
          return;
        }
      }
      let list = steps;
      let profile = scopeProfile.profile;
      if (stepId === 'data' && scopeProfile.state === 'loading') {
        setChecking(PROFILE_WAITING);
        const done = await scopeProfile.wait();
        const doneSteps = scopeStepsOf(done.state, done.profile, ranBefore);
        list = wizardSteps(mode, spec, { ...doneSteps, settings: settingsFor(doneSteps, done.state === 'ready').length > 0 });
        profile = done.profile;
      }
      const next = list[stepIndexOf(list, nextStepAfter(list, stepId, { backToSummary, visited }))];
      if (next.id === 'first_run') setSpec((prev) => withProfileDefaults(prev, profile));
      setStep(next.id);
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setChecking('');
    }
  };

  const edited = useMemo(() => editedWidgets(context?.latest), [context?.latest]);
  const sent = useMemo(() => sentSpec(spec, lakebase, built, targets, placeScope, edited), [spec, lakebase, built, targets, placeScope, edited]);
  const runs = withFirstRunSaved(spec).config.widgets;
  const sentScope = withGroupingDefault(scopeValues((name) => runs?.[name]), scopeProfile.profile, runs?.[GROUP_BY]);
  const specKey = JSON.stringify(sent);
  const ownErrorsKey = ownErrors.join('|');
  const buildStep = mode === 'mvp';
  const appBlocked = Boolean(appUnreadable);
  const planReady = steps.filter((s) => BUILD_STEP_IDS.includes(s.id)).every((s) => !stepErrors(s.id, spec, extras, mode).length);
  useEffect(() => {
    if (!buildStep || resultTableProblems(spec.config.result_table).length) return undefined;
    let cancelled = false;
    setChecksBusy(true);
    // The verdict of the previous spec is dropped now, so no check result shows while this one runs.
    setPreflight(null);
    setPreflightError('');
    const timer = setTimeout(async () => {
      const planNow = lastStep && !ownErrorsKey && planReady && !appBlocked;
      const checks = preflightParams(spec);
      const [pre, planned] = await Promise.allSettled([
        apiPostJson(`/api/inspire/implement/preflight?${q}&${checks.toString()}`, { spec: sent }),
        planNow
          ? apiPostJson('/api/inspire/implement/plan', { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), spec: sent })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setPreflight(pre.status === 'fulfilled' ? pre.value : null);
      setPreflightError(pre.status === 'fulfilled' ? '' : (pre.reason?.message || 'Could not check access'));
      if (pre.status === 'fulfilled' && pre.value?.checks?.app_name?.ok === false) {
        setAppNameRefusal({ name: spec.outputs.app_name, check: pre.value.checks.app_name });
      }
      if (pre.status === 'fulfilled') setAppUnreadable(pre.value.app_unreadable || null);
      setPlan(planned.status === 'fulfilled' ? planned.value : null);
      setPlanError(planned.status === 'fulfilled' ? '' : planned.reason.message);
      if (planned.status === 'rejected' && planned.reason.body?.app_unreadable) setAppUnreadable(planned.reason.body.app_unreadable);
      if (planned.status === 'fulfilled' && sharedSource(planned.value?.shared, null)) setPlanShared(planned.value.shared);
      setChecksBusy(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [buildStep, specKey, ownErrorsKey, planReady, q, grantRound, appBlocked, lastStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameApp = (value) => {
    appNameTyped.current = true;
    setAppRenamed(null);
    setPlaceSet('person');
    patch('outputs.app_name', value);
  };
  const appNameCheck = spec.outputs.app && !spec.outputs.merge?.app ? preflight?.checks?.app_name || null : null;
  const appNameShown = appNameCheck || (appNameRefusal?.name === spec.outputs.app_name ? appNameRefusal.check : null);
  useEffect(() => {
    const check = appNameCheck;
    if (!check || check.ok !== false || !check.suggested || appNameTyped.current || check.name !== spec.outputs.app_name) return;
    setAppRenamed({ to: check.suggested, text: appRenamedText(check.name, check.suggested) });
    patch('outputs.app_name', check.suggested);
  }, [appNameCheck, spec.outputs.app_name]);
  useEffect(() => {
    if (lastStep && appNameCheck?.ok === false && (!appNameCheck.suggested || appNameTyped.current)) setLastNameShown(true);
  }, [lastStep, appNameCheck]);

  const grantAppRead = async () => {
    if (!appUnreadable) return;
    setGranting(true);
    try {
      const got = await apiPostJson(`/api/inspire/implement/grant-access?${q}&kind=source_tables`, { tables: appUnreadable.tables });
      const data = await apiFetch(`/api/inspire/implement/context?${contextQ}`);
      setContext(data);
      setAppGrant({ ...got, text: appGrantText(got) });
      setAppUnreadable(data.app_unreadable || got.app_unreadable || null);
      setGrantRound((n) => n + 1);
    } catch (e) {
      setAppGrant({ ran: [], failed: [], error: e.message });
      if (e.body?.app_unreadable) setAppUnreadable(e.body.app_unreadable);
    } finally {
      setGranting(false);
    }
  };

  const held = useMemo(() => heldAssets(context?.assets, context?.gone_assets), [context]);
  const [ownLive, setOwnLive] = useState(null);
  useEffect(() => {
    if (live || !spec.use_case_id) return undefined;
    let on = true;
    apiFetch(`/api/inspire/implement/live?${q}`).then((data) => { if (on) setOwnLive(data); }).catch(() => {});
    return () => { on = false; };
  }, [live, q, apiFetch]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveCheck = live || ownLive;
  const shared = sharedSource(planShared, liveCheck);
  const savedOutputs = context?.latest?.spec_json?.outputs || {};
  const moveNote = insideMoveNote(spec, held.app || '', { shared, joinedBefore: savedOutputs.merge?.app || '', sessionId, useCaseId: spec.use_case_id });
  useEffect(() => {
    if (!targets || !context || !spec.outputs.app || placeSet === 'default' || placeSet === 'person') return;
    if (placeSet === 'waiting') {
      setSpec((prev) => (joinsApp(prev) || insideInspire(prev) ? prev : withNewApp(prev, prev.outputs.app_placement, targets, placeScope)));
      setPlaceSet('person');
      return;
    }
    const saved = context.latest?.spec_json?.outputs || {};
    const savedApp = Boolean(saved.app) && !(context.gone_assets || []).includes('app');
    setSpec((prev) => withPlacementDefault(prev, targets, { held, saved: saved.app_placement, savedApp, ...placeScope }));
    setPlaceSet('default');
  }, [targets, context, held, placeScope, spec.outputs.app, placeSet]);

  useEffect(() => {
    if (!buildStep || targets !== null) return undefined;
    let cancelled = false;
    apiFetch(`/api/inspire/implement/merge-targets?${q}`)
      .then((data) => { if (!cancelled) setTargets(data.targets || {}); })
      .catch((e) => {
        if (cancelled) return;
        setTargets({});
        setTargetsError(e.message);
      });
    return () => { cancelled = true; };
  }, [buildStep, targets, apiFetch, q]);

  useEffect(() => {
    if (!spec.outputs.app || look !== null || lookError) return undefined;
    let cancelled = false;
    apiFetch('/api/inspire/implement/app-look')
      .then((data) => { if (!cancelled) setLook(data); })
      .catch((e) => { if (!cancelled) setLookError(e.message); });
    return () => { cancelled = true; };
  }, [spec.outputs.app, look, lookError, apiFetch]);

  useEffect(() => {
    if (look) setSpec((prev) => withAppLookDefaults(prev, look));
  }, [look, spec.outputs.app, spec.outputs.app_look]);

  useEffect(() => {
    const dropped = withoutMissingRoles(spec, columnsByTable);
    if (!dropped.note) return;
    setSpec((prev) => withoutMissingRoles(prev, columnsByTable).spec);
    setNotice((prev) => [prev, dropped.note].filter(Boolean).join(' '));
  }, [columnsByTable, spec]);

  useEffect(() => {
    const wanted = stepId === 'data' || (spec.outputs.app && (stepId === 'delivery' || stepId === 'where' || stepId === 'app' || stepId === APP_STORAGE_STEP.id));
    if (!wanted || warehouses !== null || warehousesError) return undefined;
    let cancelled = false;
    apiFetch('/api/warehouses')
      .then((data) => { if (!cancelled) setWarehouses(data.warehouses || []); })
      .catch((e) => { if (!cancelled) setWarehousesError(e.message); });
    return () => { cancelled = true; };
  }, [spec.outputs.app, stepId, warehouses, warehousesError, apiFetch]);

  const sourceTablesParam = sourceTables.join(',');
  useEffect(() => {
    if (!spec.outputs.app || lakebase !== null) return undefined;
    let cancelled = false;
    apiFetch(`/api/inspire/implement/lakebase?tables=${encodeURIComponent(sourceTablesParam)}`)
      .then((data) => { if (!cancelled) setLakebase(data); })
      .catch((e) => { if (!cancelled) setLakebase({ state: 'unknown', detail: e.message }); });
    return () => { cancelled = true; };
  }, [spec.outputs.app, lakebase, apiFetch, sourceTablesParam]);

  const resultParts = resultTableParts(spec.config.result_table);
  const ownTable = ownSchema?.own_table ?? nameOrEmpty(() => defaultResultTable(inspireDatabase, spec.use_case_id, sessionId, context?.business_name));
  const inspireTable = inspireSchemaResultTable(inspireDatabase, spec.use_case_id, sessionId);
  const resultPlace = resultPlaceOf(spec.config.result_table, ownTable, inspireTable);
  const placeBlocks = resultPlaceBlocks(ownSchema, ownTable, inspireTable, ownSchema?.catalog || resultTableParts(ownTable).catalog);
  useEffect(() => {
    if (!resultsOn || catalogs !== null) return undefined;
    let cancelled = false;
    apiFetch(`/api/catalogs?warehouse_id=${encodeURIComponent(warehouseId || '')}`)
      .then((data) => {
        if (cancelled) return;
        setCatalogs((data.catalogs || []).map((c) => c.name).filter(Boolean));
        setCatalogsCut(Boolean(data.truncated));
      })
      .catch((e) => {
        if (cancelled) return;
        setCatalogs([]);
        setCatalogsError(e.message);
      });
    return () => { cancelled = true; };
  }, [stepId, resultsOn, catalogs, apiFetch, warehouseId]);

  useEffect(() => {
    const catalog = resultParts.catalog;
    if (!resultsOn || !catalog || schemas[catalog] || catalogsError) return undefined;
    let cancelled = false;
    apiFetch(`/api/catalogs/${encodeURIComponent(catalog)}/schemas?warehouse_id=${encodeURIComponent(warehouseId || '')}`)
      .then((data) => {
        if (cancelled) return;
        const names = (data.schemas || []).map((s) => s.name).filter(Boolean);
        setSchemas((prev) => ({ ...prev, [catalog]: { names } }));
      })
      .catch((e) => { if (!cancelled) setSchemas((prev) => ({ ...prev, [catalog]: { names: [], error: e.message } })); });
    return () => { cancelled = true; };
  }, [stepId, resultParts.catalog, schemas, catalogsError, apiFetch, warehouseId]);

  const createPlace = async (kind, name) => {
    const catalog = kind === 'catalog' ? name : resultParts.catalog;
    await apiPostJson(`/api/inspire/implement/create-schema?${q}`, kind === 'catalog' ? { catalog } : { catalog, schema: name });
    if (kind === 'catalog') setCatalogs((prev) => [...new Set([...(prev || []), name])].sort((a, b) => a.localeCompare(b)));
    else setSchemas((prev) => (prev[catalog] ? { ...prev, [catalog]: { ...prev[catalog], names: [...new Set([...(prev[catalog].names || []), name])] } } : prev));
    setSpec((prev) => withResultTable(prev, { ...resultTableParts(prev.config.result_table), catalog, schema: kind === 'catalog' ? '' : name }));
    setOutputCheck(null);
  };

  const cancel = () => {
    clearWizardDraft(draftKey);
    onClose();
  };

  const markTouched = (e) => {
    if (e.target?.closest?.('input, select, textarea, [data-option], [data-draft-change]')) touched.current = true;
  };

  const startOver = () => {
    clearWizardDraft(draftKey);
    touched.current = false;
    groupingDefaulted.current = false;
    accessDefaulted.current = false;
    setDraftBack(false);
    setPlaceSet('');
    setVisited([]);
    if (loadedSpec.current) setSpec(loadedSpec.current);
    setStep(initialStepId(focus, 'mvp', loadedSpec.current));
  };

  const submit = async () => {
    setErrors([]);
    if (blockedBy(stepId)) return;
    setBusy(true);
    try {
      const data = await apiPostJson('/api/inspire/implement/submit', {
        inspire_database: inspireDatabase,
        warehouse_id: warehouseId,
        session_id: String(sessionId),
        notebook_path: settings.notebookPath,
        spec: sent,
        rebuild_as_is: rebuildAsIs,
      });
      clearWizardDraft(draftKey);
      onImplemented(data);
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setBusy(false);
    }
  };

  const generateNotebook = async () => {
    setErrors([]);
    setBusy(true);
    try {
      const data = await apiPostJson('/api/inspire/generate-genie', genieNotebookRequest({
        inspireDatabase, warehouseId, sessionId, useCaseId: spec.use_case_id, notebookPath: settings.notebookPath,
      }));
      clearWizardDraft(draftKey);
      onImplemented({ mode: 'notebook', use_case_id: spec.use_case_id, run_id: data.run_id, job_run_url: data.job_run_url });
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setBusy(false);
    }
  };

  const loadValues = async (table, column) => {
    const key = `${table}.${column}`;
    if (values[key]) return;
    try {
      const data = await apiFetch(`/api/inspire/implement/values?${q}&table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}&limit=${VALUE_LIMIT}`);
      setValues((prev) => ({ ...prev, [key]: data.values || [] }));
    } catch (e) {
      setErrors([e.message]);
    }
  };

  useEffect(() => {
    if (stepId !== 'data' || !advanced.data) return undefined;
    let cancelled = false;
    apiFetch(`/api/inspire/implement/serving-endpoints?${q}`)
      .then((data) => { if (!cancelled) setEndpoints(data.endpoints || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stepId, advanced.data, apiFetch, q]);

  useEffect(() => {
    if (stepId !== 'delivery' || !spec.outputs.alert || destinations !== null) return undefined;
    let cancelled = false;
    apiFetch('/api/inspire/implement/destinations')
      .then((data) => { if (!cancelled) setDestinations(data.destinations || []); })
      .catch((e) => {
        if (cancelled) return;
        setDestinations([]);
        setDestinationsError(e.message);
      });
    return () => { cancelled = true; };
  }, [stepId, spec.outputs.alert, destinations, apiFetch]);

  useEffect(() => {
    if (principalQ.length < 2) {
      setPrincipals([]);
      return undefined;
    }
    const t = setTimeout(() => {
      apiFetch(`/api/inspire/implement/principals?${q}&q=${encodeURIComponent(principalQ)}`)
        .then((data) => setPrincipals(data.principals || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [principalQ, apiFetch, q]);

  const title = nameOfUseCase(ucRow) || spec.use_case_name || spec.use_case_id;
  const genieOff = genieCodeOff(features);
  const unavailable = Object.keys(blocks);
  const unavailableKey = unavailable.join(',');

  useEffect(() => {
    if (loading || !unavailableKey || stepId !== 'delivery') return;
    const off = unavailableKey.split(',');
    setSpec((prev) => {
      const next = withoutUnavailableOutputs(prev, off, context?.assets);
      const top = bestOutput(blocks);
      const kept = top && !IMPLEMENT_OUTPUTS.some((o) => next.outputs[o.id]) ? withOutput(next, top.id, true, context?.assets) : next;
      const lost = droppedOutputs(prev, kept, blocks);
      if (lost.length) setDropped((was) => [...was.filter((d) => !lost.some((l) => l.id === d.id)), ...lost]);
      return kept;
    });
  }, [loading, unavailableKey, context?.assets, stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  const personal = sourceTables.flatMap((t) => columnsByTable[t] || []).find((c) => personalColumn(c?.name, c?.tags))?.name || '';
  useEffect(() => {
    if (loading || !personal || context?.latest || accessDefaulted.current) return;
    accessDefaulted.current = true;
    setSpec((prev) => (prev.outputs.app_access === 'user' ? prev : withAppAccess(prev, 'user')));
  }, [loading, personal, context?.latest]);

  if (loading) {
    return (
      <Overlay title={title} uc={uc} steps={steps} total={totalSteps} step={stepIndex} onClose={cancel}>
        <div className="flex items-center gap-2 p-8 text-sm text-text-secondary">
          <Loader2 size={16} className="animate-spin" /> Loading the use case…
        </div>
      </Overlay>
    );
  }

  const dataSummary = [
    spec.data.window?.start || spec.data.window?.end ? `Window ${spec.data.window.start || 'open'} to ${spec.data.window.end || 'open'}` : 'No date window',
    spec.data.column_roles && Object.values(spec.data.column_roles).some(Boolean) ? 'Column roles set by you' : "Column roles chosen by Inspire",
    spec.config.warehouse_id ? `SQL warehouse ${spec.config.warehouse_id}` : 'No SQL warehouse picked',
  ].join(' · ');
  const chosenDestinations = spec.outputs.alert_destinations || [];
  const checkEntries = checksFor(preflight?.checks, spec.outputs);
  const generalChecks = checkEntries.filter(([k]) => !TILE_CHECK_KEYS.includes(k));
  const freshness = freshnessOf(spec.schedule);
  const checkStepOf = (k) => {
    if (PLACE_CHECKS.includes(k)) return 'where';
    if (ACCESS_CHECKS.includes(k)) return insideInspire(spec) || joinsApp(spec) ? 'where' : APP_STORAGE_STEP.id;
    return CHOOSE_CHECKS.includes(k) || TILE_CHECK_KEYS.includes(k) ? 'delivery' : SUMMARY_STEP.id;
  };
  const checkStepLabel = (k) => steps.find((s) => s.id === checkStepOf(k))?.label || SUMMARY_STEP.label;
  const deliveryChecks = buildStep
    ? checkEntries.filter(([k, v]) => !v.ok && checkStepOf(k) !== stepId && (lastStep || steps.findIndex((s) => s.id === checkStepOf(k)) < stepIndex))
      .map(([k, v]) => `${PREFLIGHT_LABELS[k] || k.replace(/_/g, ' ')}: ${v.detail} (fix it on ${checkStepLabel(k)})`)
    : [];
  const earlierGaps = buildStep && lastStep
    ? steps.filter((s) => BUILD_STEP_IDS.includes(s.id) && s.id !== stepId)
      .flatMap((s) => stepErrors(s.id, spec, extras, mode).filter((e) => e !== APP_PLACE_WAITING).map((e) => `${e} (fix it on ${s.label})`))
    : [];
  const footerErrors = [...new Set([
    ...(attempted[stepId] ? ownErrors : []),
    ...errors,
    ...(stepId === 'data' ? Object.values(columnsErrors) : []),
    ...(buildStep ? [lastStep ? planError : '', lastStep ? '' : preflightError, ...deliveryChecks, ...earlierGaps] : []),
  ].filter(Boolean))];
  const checkAgain = async () => {
    try {
      const data = await apiFetch(`/api/inspire/implement/context?${contextQ}`);
      setContext(data);
      setAppUnreadable(data.app_unreadable || null);
    } catch (e) {
      setErrors([e.message]);
    }
    setGrantRound((n) => n + 1);
  };
  const footerRetry = new Map([
    ...Object.entries(columnsErrors).map(([table, e]) => [e, () => loadColumns(table)]),
    [planError, checkAgain],
    [preflightError, checkAgain],
  ].filter(([e]) => e));
  const accessVerdict = accessVerdictOf({ preflight, error: preflightError, busy: checksBusy, unread: appUnreadable });
  const unchanged = lastStep && accessVerdict === 'ok' && Boolean(plan?.unchanged);
  const sourceRefused = accessVerdict === 'refused';
  const sourceAccessRefused = sourceRefused && !preflight?.checks?.sources?.missing;
  const implementBlocked = busy || checksBusy || !placeSettled || schemaJob?.state === 'running' || schemaJob?.state === 'failed' || rebuildNeedsChoice(plan, rebuildAsIs) || sourceRefused
    || (!ownErrors.length && (!preflight || !checkEntries.every(([, c]) => c.ok) || (lastStep && (!plan || Boolean(planError)))))
    || (lastStep && accessVerdict !== 'ok' && accessVerdict !== 'refused');
  const palette = (look?.palette_colors || []).find((p) => p.id === spec.outputs.app_look.palette) || null;
  const best = oneBestPerStep({
    output: bestOutput(blocks),
    result: bestResultPlace(placeBlocks, ownSchema?.catalog || resultTableParts(ownTable).catalog),
    freshness: bestFreshness(spec),
    holdout: bestHoldout(),
    kpi: bestKpi(kpiOptions, trackedKpi),
    appTarget: bestAppTarget(spec, targets, placeScope),
    heldApp: bestHeldApp(held.app || ''),
    appPolicy: bestAppPolicy(spec, targets, placeScope),
    appAccess: bestAppAccess({ inside: insideInspire(spec), personal }),
    appBackend: bestAppBackend(spec, lakebase),
    appOption: bestAppOption(),
    replaceEdits: bestReplaceEdits(),
    layout: bestLook('layout', spec),
  });
  const groupingNow = spec.config.widgets?.[GROUP_BY] || scopeShown[GROUP_BY];
  const groupingPicked = groupingOf(scopeProfile.profile, groupingNow);
  const summaryRows = pickedSummary(spec, sourceTables, {
    grouping: scopeSteps.grouping && groupingPicked ? `${groupingPicked.label} · ${groupingCountText(groupingCount(groupingPicked, scopedFirstRun?.profile || scopedProfile))}` : '',
    firstRun: scopeSteps.firstRun ? firstRunSummaryText(scopedFirstRun?.state === 'ready' ? scopedFirstRun.profile : scopedProfile, sentScope) : '',
    settings: settingsList.length ? counted(settingsList.length, 'setting') : '',
    dropped: dropped.filter((d) => !spec.outputs[d.id]),
  }).filter((row) => steps.some((s) => s.id === row.step));
  const changeStep = (id) => { setErrors([]); setBackToSummary(true); setStep(id); };
  const nextIsSummary = backToSummary && nextStepAfter(steps, stepId, { backToSummary, visited }) === SUMMARY_STEP.id;

  const pickTable = (original, value) => {
    const picked = pickedTable(spec, original, value);
    setSpec(picked.spec);
    if (picked.notice !== null) setNotice(picked.notice);
    setChanging((prev) => ({ ...prev, [original]: false }));
  };

  const toggleOutput = (id, checked) => setSpec((prev) => withOutput(prev, id, checked, context?.assets));

  return (
    <Overlay title={title} uc={uc} steps={steps} total={totalSteps} step={stepIndex} reach={reach} done={done} onGo={goTo} onDetails={() => setDetails(true)}
      onClose={cancel} onTouch={markTouched}>
      {details && <UseCaseDrawer title={title} ucRow={ucRow} spec={spec} patch={patch} onOwner={(owner) => setSpec((prev) => withDecisionOwner(prev, owner))} onClose={() => setDetails(false)} />}
      <div ref={bodyRef} data-wizard-body="" className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
        {draftBack && (
          <div role="note" aria-label="Your draft" data-wizard-draft="" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-info/20 bg-info-bg px-3 py-2 text-[12px] text-text-primary">
            <span>{DRAFT_BACK_NOTE}</span>
            <button type="button" data-wizard-start-over="" onClick={startOver} className="text-[12px] font-medium text-db-red-fg underline-offset-2 hover:underline glow-focus">{DRAFT_START_OVER}</button>
          </div>
        )}
        {stepIndex === 0 && (
          <>
            {genieOff && (
              <div role="note" aria-label={GENIE_CODE_OFF_TITLE} className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-[12px] space-y-1">
                <p className="font-semibold text-text-primary">{GENIE_CODE_OFF_TITLE}</p>
                <p className="text-text-secondary">{genieOff.reason}</p>
                {genieOff.fix && <p className="text-text-secondary">Admin fix: {genieOff.fix}</p>}
              </div>
            )}
          </>
        )}

        {stepId === 'data' && mode === 'notebook' && (
          <section className="space-y-3" aria-label="Tables the notebook uses">
            <h3 className="text-sm font-semibold text-text-primary">Tables the notebook uses</h3>
            <p className="text-[12px] text-text-secondary">
              Inspire writes the notebook over the tables this use case was discovered with.
            </p>
            <ul className="space-y-1.5">
              {tablesOf(ucRow).map((t) => (
                <li key={t} className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2 text-[12px]">
                  <span className="font-mono text-text-primary truncate">{t}</span>
                  {t === primaryOriginal && <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-tertiary">primary</span>}
                </li>
              ))}
            </ul>
            {tablesOf(ucRow).length === 0 && (
              <p className="text-[12px] text-text-tertiary">This use case names no tables, so the notebook works from its description alone.</p>
            )}
          </section>
        )}

        {stepId === 'notebook' && (
          <section className="space-y-3 text-[12px] text-text-secondary" aria-label="Notebook">
            <h3 className="text-sm font-semibold text-text-primary">Write the Genie Code notebook</h3>
            <p>
              Inspire runs Generate Use Cases for this session with only {spec.use_case_id} selected. It writes the Genie Code instruction for this use case
              and saves it as the use case notebook{notebookFolder ? ` under ${notebookFolder}` : ''}. Nothing else is built, and no other use case changes.
            </p>
            {ucRow.notebook_path && (
              <p>
                The current notebook, <span className="font-mono text-text-primary">{ucRow.notebook_path}</span>, is replaced.
                If you edited it, Inspire keeps it and writes the new notebook beside it.
              </p>
            )}
            {editing && <p>Your MVP (v{context.latest.spec_version}) is not changed.</p>}
            <p>The run takes a few minutes. Follow it on the Build page.</p>
          </section>
        )}

        {(appUnreadable || appGrant) && <AppReadAccess offer={appUnreadable} result={appGrant} busy={granting} onGrant={grantAppRead} />}

        {stepId === 'data' && mode === 'mvp' && (
          <>
            {!sourcesShown && <FoldLine label="Source tables" what="Source tables" summary={`${sourceTables.length} ${sourceTables.length === 1 ? 'table' : 'tables'}: ${sourceTables.join(', ')}`} onOpen={() => setDataChoice('sources')} />}
            {sourcesShown && <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Source tables</h3>
                <p className="text-[11px] text-text-tertiary">Inspire picked these for this use case. Genie builds on them unless you change one.</p>
              </div>
              {notice && <p className="text-[11px] text-text-secondary bg-bg border border-border rounded-md px-3 py-2">{notice}</p>}
              <SourceTables
                tables={tablesOf(ucRow)}
                spec={spec}
                primary={primaryOriginal}
                swaps={swaps}
                swapsWhy={swapsWhy}
                changing={changing}
                lostReason={lostReason}
                blockerOf={(original) => removalBlocker(ucRow, spec, original)}
                selectClass={inputCls}
                onToggle={(original) => {
                  const open = !changing[original];
                  setChanging((prev) => ({ ...prev, [original]: open }));
                  if (open && swaps[original] === undefined) loadSwaps(original);
                }}
                onPick={pickTable}
                onSearch={searchTable}
                onRestore={(original) => { setSpec((prev) => restoreTable(prev, original)); setNotice(''); }}
              />
            </section>}

            {!filtersShown && <FoldLine label="Table filters" what="Table filters" summary={`${(spec.data.filters || []).length} filter${(spec.data.filters || []).length === 1 ? '' : 's'} on ${sourceTables.length} ${sourceTables.length === 1 ? 'table' : 'tables'}`} onOpen={() => setDataChoice('filters')} />}
            {filtersShown && <SourceTableBlocks tables={sourceTables} spec={spec} columnsByTable={columnsByTable} values={values} setSpec={setSpec} loadValues={loadValues} />}

            <Advanced open={advanced.data} onToggle={() => toggleAdvanced('data')} what="data settings" summary={dataSummary}>
              <RowSubjectCheck
                check={grainCheck(spec, ucRow, columnsByTable, sourceTables)}
                options={entityKeyOptions(columnsByTable, sourceTables)}
                chosen={spec.data.column_roles.entity_id || ''}
                tagNotes={sourceTables.filter((t) => tagNotes[t]).map((t) => `${tagNotes[t]}: ${t}.`)}
                inputClass={inputBase}
                onPick={(ref) => setSpec((prev) => withEntityKey(prev, ref))}
              />
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] text-text-secondary">
                  Column roles: Inspire&apos;s choice uses the columns the use case&apos;s Genie Code instruction names. Pick a column
                  only to override it.
                </p>
                {Object.values(spec.data.column_roles).some(Boolean) && (
                  <button type="button" data-draft-change="" className="text-[11px] text-db-red-fg shrink-0" onClick={() => patch('data.column_roles', {})}>
                    {RESET_ROLES_LABEL}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {COLUMN_ROLES.filter((role) => trainsModel || role !== 'label').map((role) => (
                  <Field key={role} label={role.replace('_', ' ')}>
                    <select
                      className={inputCls}
                      value={spec.data.column_roles[role] || ''}
                      onChange={(e) => patch('data.column_roles', { ...spec.data.column_roles, [role]: e.target.value })}
                    >
                      <option value="">Inspire&apos;s choice</option>
                      {sourceTables.flatMap((table) => (columnsByTable[table] || []).map((c) => (
                        <option key={`${table}.${c.column_name}`} value={`${table}.${c.column_name}`}>
                          {table}.{c.column_name}
                        </option>
                      )))}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Window start">
                  <input type="date" className={inputCls} value={spec.data.window.start} onChange={(e) => patch('data.window', { ...spec.data.window, start: e.target.value })} />
                </Field>
                <Field label="Window end">
                  <input type="date" className={inputCls} value={spec.data.window.end} onChange={(e) => patch('data.window', { ...spec.data.window, end: e.target.value })} />
                </Field>
              </div>
              <p className="text-[11px] text-text-tertiary">
                Next counts the rows to work with before Genie starts.
              </p>
              {mode === 'mvp' && <p data-settings-pointer="" className="text-[11px] text-text-secondary">{SETTINGS_ON_THEIR_STEP}</p>}
              {[['Business rules', groups.business], ['Model', groups.model], ['AI', groups.ai], ['Use-case extras', groups.extras]]
                .map(([label, list]) => [label, mode === 'mvp' ? (list || []).filter((w) => !isSettingWidget(w)) : list])
                .filter(([, list]) => mode !== 'mvp' || list.length > 0)
                .map(([label, list]) => (
                <div key={label} className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">{label}</h4>
                  {(list || []).length === 0 && <p className="text-[11px] text-text-tertiary">None on this instruction yet. Genie will fill them on the first build.</p>}
                  {(list || []).map((w) => (
                    <WidgetInput
                      key={w.name}
                      widget={w}
                      value={spec.config.widgets[w.name] ?? (w.name === 'ai_endpoint' && spec.config.ai_endpoint ? spec.config.ai_endpoint : undefined)}
                      endpoints={endpoints}
                      onChange={(value) => setWidget(w.name, value)}
                    />
                  ))}
                  {mode !== 'mvp' && label === 'Use-case extras' && (groups.extras_kept_default || []).length > 0 && (
                    <p className="text-[11px] text-text-tertiary">{keptDefaultsText(groups.extras_kept_default)}</p>
                  )}
                </div>
              ))}
              <BuildWarehouseField value={spec.config.warehouse_id} warehouses={warehouses} warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry}
                onChange={(value) => patch('config.warehouse_id', value)} />
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Run profiles</h4>
                <div className="space-y-1">
                  <ProfileInput spec={spec} path="preview.entity_cap" onChange={setProfile} />
                  <p className="text-[11px] text-text-tertiary">Preview reads {estimate(spec.config.profiles.full_load.window_days, { entityCap: spec.config.profiles.preview.entity_cap })}.</p>
                </div>
                {trainsModel && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      <ProfileInput spec={spec} path="training.window_days" onChange={setProfile} />
                      <ProfileInput spec={spec} path="training.sample_entities" onChange={setProfile} />
                    </div>
                    <p className="text-[11px] text-text-tertiary">Training reads {estimate(spec.config.profiles.training.window_days, { sampleEntities: spec.config.profiles.training.sample_entities })}.</p>
                  </div>
                )}
                <div className="space-y-1">
                  <ProfileInput spec={spec} path="full_load.window_days" onChange={setProfile} />
                  <p className="text-[11px] text-text-tertiary">Each full run reads {estimate(spec.config.profiles.full_load.window_days)}.</p>
                </div>
                {!trainsModel && <p className="text-[11px] text-text-tertiary">This use case does not train a model, so it has no training profile.</p>}
              </div>
            </Advanced>
          </>
        )}

        {((shows('grouping') && mode === 'mvp' && (scopeSteps.grouping || scopeProfile.state === 'loading')) || shows('first_run')) && (
          <section aria-label={shows('first_run') ? FIRST_RUN_TITLE : GROUPING_TITLE} data-scope-step={shows('first_run') ? 'first_run' : 'grouping'} className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">{shows('first_run') ? FIRST_RUN_TITLE : GROUPING_TITLE}</h3>
            {shows('grouping') && <p data-grouping-example-plain="" className="text-[12px] text-text-secondary">{GROUPING_EXAMPLE}{groupingChoices(scopeProfile.profile).length > 1 ? ` ${GROUPING_PICK}` : ''}</p>}
            {shows('first_run') && <GroupingChosen values={scopeShown} profile={scopedFirstRun?.profile || scopedProfile} />}
            <ScopeSettings part={shows('first_run') ? 'first_run' : 'grouping'} values={scopeShown} profile={scopedProfile} profileState={scopeProfile.state} profileError={scopeProfile.error}
              groups={scopedFirstRun} settings={scopeSettingList} onChange={(name, value) => setSpec((prev) => withSetting(prev, { name, source: 'widget' }, value))}
              unrecorded={firstRunUnrecorded}
              groupingChosenBy={groupingChosenBy(spec.config.widgets?.[GROUP_BY], scopeProfile.profile)} />
          </section>
        )}

        {resultsOn && (
          <Advanced open={resultsShown} onToggle={() => { if (resultsShown) { setAdvanced((prev) => ({ ...prev, results: false })); setDataChoice(null); } else setDataChoice('results'); }} what="result table"
            summary={`Result table: ${spec.config.result_table || 'not set yet'}`}>
            <ResultTableStep
              table={spec.config.result_table}
              ownTable={ownTable}
              inspireTable={inspireTable}
              place={resultPlace}
              note={placeNote}
              outputCheck={outputCheck}
              onChange={(parts) => { setSpec((prev) => withResultTable(prev, parts)); setOutputCheck(null); }}
              best={best.result}
              blocks={placeBlocks}
            >
              <ResultPlaceFields
                parts={resultParts}
                catalogs={catalogs}
                catalogsCut={catalogsCut}
                catalogsError={catalogsError}
                onCatalogsRetry={onCatalogsRetry}
                schemas={schemas[resultParts.catalog]}
                onSchemasRetry={() => onSchemasRetry(resultParts.catalog)}
                onChange={(parts) => { setSpec((prev) => withResultTable(prev, parts)); setOutputCheck(null); }}
                onCreate={createPlace}
              />
            </ResultTableStep>
          </Advanced>
        )}

        {shows('fresh') && (
          <section className="space-y-2" aria-label={FRESH_LABEL}>
            <Advanced open={advanced.fresh || sectionErrors('schedule', spec, extras).length > 0} onToggle={() => toggleAdvanced('fresh')} what={FRESH_LABEL}
              summary={freshness === 'off' ? 'Keep it fresh: off, it runs once now' : `Keep it fresh: runs ${cronInWords(spec.schedule.cron, spec.schedule.timezone)}`}>
              <p className="text-[11px] text-text-secondary">{FRESH_HELP}</p>
              <p data-run-it="" className="text-[12px] text-text-secondary">{RUN_IT_TITLE}</p>
              <div data-choice="freshness" className="space-y-2">
              <div role="group" aria-label="Keep it fresh" className="inline-flex rounded-lg border border-border overflow-hidden">
                {[...FRESHNESS_OPTIONS, ...(freshness === 'custom' ? [{ id: 'custom', label: 'Custom' }] : [])].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    data-option={option.id}
                    aria-pressed={freshness === option.id}
                    disabled={option.id === 'custom'}
                    onClick={() => setSpec((prev) => withFreshness(prev, option.id))}
                    className={`px-4 py-1.5 text-xs font-medium border-e border-border last:border-e-0 ${freshness === option.id ? 'bg-db-red-solid text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <BestOf best={best.freshness} label={FRESHNESS_OPTIONS.find((o) => o.id === best.freshness.id)?.label} />
              </div>
              <p className="text-[11px] text-text-tertiary">
                {freshness === 'off'
                  ? 'It runs once now. Turn this on later to keep the results current.'
                  : `Runs ${cronInWords(spec.schedule.cron, spec.schedule.timezone)}, after the first run works. Cost: ${costHint(spec, { scheduleSaid: true })}`}
              </p>
            </Advanced>
          </section>
        )}

        {shows('measure') && (
          <>
            <HoldoutSetting spec={spec} best={best.holdout} onEnabled={(on) => setSpec((prev) => withHoldout(prev, on))}>
              <KpiTargetSetting
                spec={spec}
                best={best.kpi}
                options={kpiOptions}
                tracked={trackedKpi}
                before={context?.latest ? kpiTargetOf(context.latest.spec_json) : null}
                onPick={(name) => setSpec((prev) => withKpiTarget(prev, name))}
              />
            </HoldoutSetting>
            <div className="space-y-3">
              <SettingRow label="Hold back" value={holdoutOf(spec).enabled ? `${holdoutPercentText(spec) || '10'}% of records` : 'off'} changeLabel="hold back share">
                <HoldoutPercent spec={spec} onPercent={(text) => setSpec((prev) => withHoldoutPercent(prev, text))} />
              </SettingRow>
              <SettingRow label="Schedule (Quartz cron)" value={cronInWords(spec.schedule.cron, spec.schedule.timezone)} changeLabel="schedule">
                <Field label="Cron (Quartz)">
                  <input dir="auto" className={inputCls} value={spec.schedule.cron} onChange={(e) => patch('schedule.cron', e.target.value)} />
                  {String(spec.schedule.cron || '').trim() && cronProblem(spec.schedule.cron) ? (
                    <p className="text-[11px] text-error-fg">Not a valid Quartz cron: {cronProblem(spec.schedule.cron)}</p>
                  ) : (
                    <p className="text-[11px] text-text-tertiary">Runs {cronInWords(spec.schedule.cron, spec.schedule.timezone)}{spec.schedule.enabled ? '' : ' once Keep it fresh is on'}</p>
                  )}
                </Field>
              </SettingRow>
              {trainsModel && (
                <SettingRow label="Retrain" value={spec.config.profiles?.retrain?.every_runs ? `every ${spec.config.profiles.retrain.every_runs} runs` : 'Inspire sets it'} changeLabel="retrain">
                  <div className="grid grid-cols-2 gap-2">
                    <ProfileInput spec={spec} path="retrain.every_runs" onChange={setProfile} />
                    <ProfileInput spec={spec} path="retrain.drift_threshold" onChange={setProfile} />
                  </div>
                </SettingRow>
              )}
            </div>
          </>
        )}

        {stepId === 'delivery' && mode === 'mvp' && (
          <>
            <section className="space-y-2" aria-label={DELIVERY_LABEL}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-sm font-semibold text-text-primary">{DELIVERY_QUESTION}</h3>
                <p className="text-[11px] text-text-tertiary">Pick one or more. Genie builds each one for you.</p>
              </div>
              <div data-choice="outputs" data-choice-multi="" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div data-output={NOTEBOOK_CARD.id} className="border rounded-lg p-3 border-db-red/50 bg-db-red-50/40">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" value={NOTEBOOK_CARD.id} className="mt-0.5" checked disabled readOnly />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                        {NOTEBOOK_CARD.label} <Lock size={12} className="text-text-tertiary" aria-hidden="true" />
                      </span>
                      <span className="block text-[11px] mt-1 text-text-secondary">{NOTEBOOK_CARD.blurb}</span>
                    </span>
                  </label>
                </div>
                {IMPLEMENT_OUTPUTS.map((item) => {
                  const Icon = ICONS[item.id];
                  const on = spec.outputs[item.id];
                  const noAppAccess = item.id === 'app' && !context?.assets?.app && outputCheck?.app?.ok === false;
                  const block = blocks[item.id];
                  const cannot = Boolean(block);
                  const tileChecks = (TILE_CHECKS[item.id] || []).map((k) => [k, preflight?.checks?.[k]])
                    .filter(([, v]) => v && !v.ok && on);
                  const locked = item.id === 'genie_space' && spec.outputs.app;
                  const mergeable = on && item.id !== 'app' && MERGE_OUTPUTS.includes(item.id) && !held[item.id];
                  const gone = on && (context?.gone_assets || []).includes(item.id);
                  const holding = sharedHolding(item.id, shared, liveCheck);
                  return (
                    <div key={item.id} data-output={item.id} data-blocked={cannot ? '' : undefined} className={`border rounded-lg p-3 space-y-2 ${on ? 'border-db-red/50 bg-db-red-50/40' : 'border-border'} ${cannot && !on ? 'border-dashed bg-bg cursor-not-allowed' : ''}`}>
                      <div className="relative">
                        <label className={`flex items-start gap-3 ${locked ? '' : 'cursor-pointer'}`}>
                          <input type="checkbox" value={item.id} className="mt-0.5" checked={on} disabled={(cannot && !on) || locked} onChange={(e) => toggleOutput(item.id, e.target.checked)} />
                          <span className="flex-1">
                            <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                              <Icon size={14} /> {item.label}
                              {locked && <Lock size={12} className="text-text-tertiary" aria-hidden="true" />}
                            </span>
                            <span className="block text-[11px] mt-1 text-text-secondary">
                              {locked ? GENIE_FOR_APP_NOTE : item.blurb}
                              {!cannot && item.id === 'app' && ` ${APP_NEXT_NOTE}`}
                            </span>
                            {cannot && on && <span className="block text-[11px] mt-1 text-error-fg">It cannot be built, so turn it off.</span>}
                            <span className="block mt-1"><Recommended best={best.output} id={item.id} /></span>
                          </span>
                        </label>
                      </div>
                      {cannot && <div className="ps-7"><BlockedReason block={block} id={item.id} /></div>}
                      {noAppAccess && outputCheck.app.offer && (
                        <div className="ps-7 space-y-1.5 text-[11px]">
                          <GrantList label="Grant Inspire can run for new Apps" items={outputCheck.app.offer.grants} />
                          <button type="button" disabled={granting} onClick={grantNewApps}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-70">
                            {granting ? 'Granting with your sign-in' : NEW_APPS_ACCESS_ACTION}
                          </button>
                        </div>
                      )}
                      {item.id === 'app' && newAppsGrant && (
                        <div role="status" aria-label="New Apps access result" className="ps-7 space-y-1 text-[11px] text-text-secondary">
                          <p>{newAppsGrant.text}</p>
                          <GrantList label="Grants Inspire ran for new Apps" items={newAppsGrant.ran} />
                        </div>
                      )}
                      {gone && <p className="ps-7 text-[11px] text-text-secondary">{goneAssetText(item.label, context.assets[item.id])}</p>}
                      {mergeable && (
                        <MergeChoice
                          name={item.id}
                          label={item.label}
                          chosen={spec.outputs.merge[item.id]}
                          targets={targets}
                          targetsError={targetsError} onTargetsRetry={onTargetsRetry}
                          onPick={(target) => setSpec((prev) => withMergeTarget(prev, item.id, target))}
                        />
                      )}
                      {on && item.id === 'alert' && (
                        <p className="ps-7 text-[11px] text-text-secondary">
                          {(spec.outputs.alert_recipients || []).length
                            ? `Emails ${spec.outputs.alert_recipients.join(', ')} when ${alertTriggerText(spec.outputs)}.`
                            : 'Nobody gets it yet: add an email under Change delivery settings.'}
                        </p>
                      )}
                      {on && item.id === 'alert' && <DigestChoice outputs={spec.outputs} onChange={(checked) => setSpec((prev) => withDigest(prev, checked))} />}
                      {tileChecks.map(([k, v]) => <div key={k} className="ps-7"><CheckLine check={v} label={PREFLIGHT_LABELS[k] || k} /></div>)}
                      {!on && context?.assets?.[item.id] && (
                        <div className="ps-7 space-y-1 text-[11px]">
                          <p className="text-text-secondary">This use case already has {ASSET_NOUNS[item.id]}. What should happen to it?</p>
                          <div data-choice={`removed-${item.id}`} className="flex flex-wrap items-baseline gap-3">
                            <label><input type="radio" value="delete" checked={spec.removed_outputs[item.id] === 'delete'} onChange={() => patch('removed_outputs', { ...spec.removed_outputs, [item.id]: 'delete' })} /> {holding ? takeOutText(holding) : 'Delete it'}</label>
                            <label><input type="radio" value="keep" checked={spec.removed_outputs[item.id] !== 'delete'} onChange={() => patch('removed_outputs', { ...spec.removed_outputs, [item.id]: 'keep' })} /> Keep it unmanaged</label>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>


            {['dashboard', 'genie_space', 'app', 'alert'].some((o) => spec.outputs[o]) && (
              <Advanced open={advanced.delivery} onToggle={() => toggleAdvanced('delivery')} what="delivery settings" summary="Dashboard name and filters, Genie Agent, App and alert recipients">
                {spec.outputs.dashboard && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Dashboard</h4>
                    <input dir="auto" className={inputCls} placeholder="Dashboard name" value={spec.outputs.dashboard_name} onChange={(e) => patch('outputs.dashboard_name', e.target.value)} />
                    <ListInput className={inputCls} placeholder="Filter widgets, comma separated" separator="," value={spec.outputs.dashboard_filters} onChange={(list) => patch('outputs.dashboard_filters', list)} />
                  </div>
                )}
                {spec.outputs.genie_space && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Genie Agent</h4>
                    <input dir="auto" className={inputCls} placeholder="Agent name" value={spec.outputs.genie_space_name} onChange={(e) => patch('outputs.genie_space_name', e.target.value)} />
                    <ListInput multiline className={inputCls} rows={4} placeholder="Up to 5 questions, one per line" separator={'\n'} value={spec.outputs.genie_questions} onChange={(list) => patch('outputs.genie_questions', list.slice(0, 5))} />
                  </div>
                )}
                {spec.outputs.app && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">App</h4>
                    <textarea dir="auto" className={inputCls} rows={3} placeholder="What the App should let people do" value={spec.outputs.app_purpose} onChange={(e) => patch('outputs.app_purpose', e.target.value)} />
                    {!joinsApp(spec) && (
                      <>
                        <Field label={APP_OWNERS_LABEL}>
                          <ListInput className={inputCls} separator="," value={spec.outputs.app_owners} onChange={(list) => patch('outputs.app_owners', list)} />
                        </Field>
                        <p className="text-[11px] text-text-tertiary">{APP_OWNERS_HELP}</p>
                      </>
                    )}
                  </div>
                )}
                {spec.outputs.alert && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Alert</h4>
                    <input dir="auto" className={inputCls} placeholder="Alert name" value={spec.outputs.alert_name} onChange={(e) => patch('outputs.alert_name', e.target.value)} />
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
                      <span>Fire when</span>
                      <select className={`${inputBase} w-auto`} value={spec.outputs.alert_tiers} onChange={(e) => patch('outputs.alert_tiers', e.target.value)}>
                        {ALERT_TIER_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                      <span>rows in the latest run are</span>
                      <select className={`${inputBase} w-auto`} value={spec.outputs.alert_operator} onChange={(e) => patch('outputs.alert_operator', e.target.value)}>
                        {(spec.outputs.alert_threshold_basis === 'baseline' ? Object.keys(ALERT_BASELINE_DIRECTIONS) : ALERT_OPERATORS).map((op) => <option key={op} value={op}>{ALERT_OPERATOR_WORDS[op]}</option>)}
                      </select>
                      <input type="number" min="0" step="1" className={`${inputBase} w-24`} value={spec.outputs.alert_threshold} onChange={(e) => patch('outputs.alert_threshold', e.target.value)} />
                      <span>compared with</span>
                      <select
                        className={`${inputBase} w-auto`}
                        value={spec.outputs.alert_threshold_basis || 'fixed'}
                        onChange={(e) => {
                          patch('outputs.alert_threshold_basis', e.target.value);
                          if (e.target.value === 'baseline' && !baselineOperatorOk(spec.outputs.alert_operator)) {
                            patch('outputs.alert_operator', '>=');
                          }
                        }}
                      >
                        {ALERT_THRESHOLD_BASES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                      </select>
                    </div>
                    <p className="text-[11px] text-text-tertiary">Fires when {alertTriggerText(spec.outputs)}. {ALERT_TIER_HELP}</p>
                    <textarea dir="auto"
                      className={inputCls}
                      rows={2}
                      placeholder="Optional: also fire when ... (plain words, for example 'refunds above 10 today'). Genie turns it into SQL that reads only this use case's tables."
                      value={spec.outputs.alert_condition_text}
                      onChange={(e) => patch('outputs.alert_condition_text', e.target.value)}
                    />
                    <Field label="Email recipients (comma separated)">
                      <ListInput className={inputCls} separator="," value={spec.outputs.alert_recipients} onChange={(list) => patch('outputs.alert_recipients', list)} />
                    </Field>
                    <ClearsChoice outputs={spec.outputs} onChange={(checked) => setSpec((prev) => withClears(prev, checked))} />
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Slack, Teams and other destinations</span>
                      {destinations === null && <p className="text-[11px] text-text-tertiary"><Loader2 size={11} className="inline animate-spin" /> Loading destinations…</p>}
                      {destinationsError && <PlainMessage text={`Inspire could not list the notification destinations: ${destinationsError}`} after="Use email recipients." onRetry={onDestinationsRetry} copy data-destinations-error="" className="text-[11px] text-text-tertiary" />}
                      {destinations && !destinationsError && destinations.length === 0 && (
                        <p className="text-[11px] text-text-tertiary">This workspace has no notification destinations. A workspace admin can add Slack or Teams ones.</p>
                      )}
                      {(destinations || []).map((d) => {
                        const picked = chosenDestinations.some((x) => x.id === d.id);
                        return (
                          <label key={d.id} className="flex items-center gap-2 text-[12px]">
                            <input
                              type="checkbox"
                              checked={picked}
                              onChange={() => patch('outputs.alert_destinations', picked
                                ? chosenDestinations.filter((x) => x.id !== d.id)
                                : [...chosenDestinations, { id: d.id, name: d.name }])}
                            />
                            {d.name} <span className="text-text-tertiary">{d.type.replace(/_/g, ' ')}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-text-tertiary">
                      It checks the result after each scheduled or full run and notifies only when the condition holds, once per run. Preview runs never send it. Groups cannot get alert emails: add their members or a destination.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Field label="Share with">
                    <input dir="auto" className={inputCls} placeholder="Search users and groups" value={principalQ} onChange={(e) => setPrincipalQ(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {(spec.sharing.principals || []).map((p) => (
                      <button data-draft-change=""
                        key={`${p.type}:${p.name}`}
                        type="button"
                        className="text-[11px] border border-border rounded-full px-2 py-0.5"
                        onClick={() => patch('sharing.principals', spec.sharing.principals.filter((x) => x.name !== p.name))}
                      >
                        {p.name} ×
                      </button>
                    ))}
                  </div>
                  {principals.map((p) => (
                    <button data-draft-change=""
                      key={`${p.type}:${p.name}`}
                      type="button"
                      className="block text-[11px] text-text-secondary hover:text-db-red-fg"
                      onClick={() => {
                        if (spec.sharing.principals.some((x) => x.name === p.name && x.type === p.type)) return;
                        patch('sharing.principals', [...spec.sharing.principals, { type: p.type, name: p.name }]);
                      }}
                    >
                      {p.display} ({p.type})
                    </button>
                  ))}
                </div>
              </Advanced>
            )}
          </>
        )}

        {shows('stake') && (
          <section className="space-y-3" aria-label={MEASURE_LABEL}>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Money at stake</h3>
              <p className="text-[11px] text-text-secondary">{`Each record is counted in the ${stakeWords(sampleStake)}. Choose how the money totals are worked out.`}</p>
            </div>
            <ol aria-label="Money decisions" className="flex flex-wrap gap-x-1 gap-y-1 text-[11px]">
              {moneyParts.map((p, i) => (
                <li key={p} data-money-current={i === moneyActive ? '' : undefined}
                  className={`rounded-full ${i === moneyActive ? 'bg-db-red-50 text-db-red-fg font-semibold' : i < moneyActive ? 'text-text-primary' : 'text-text-tertiary'}`}>
                  <button type="button" data-money-part={p} disabled={i > moneyActive} onClick={() => setMoneyPart(i)} className="px-2 py-1 glow-focus disabled:cursor-default">{i + 1}. {MONEY_PART_LABEL[p]}</button>
                </li>
              ))}
            </ol>
            <MoneyRuleEditor part={moneyParts[moneyActive]} value={spec.money} sample={scopeProfile.profile?.money_sample || null} table={scopeProfile.profile?.table || ''} columns={scopeProfile.profile?.money_columns || []} api={{ currencies: (body) => apiPostJson('/api/money/currency-rates', body), preview: (body) => apiPostJson('/api/money/value-preview', body), describe: (body) => apiPostJson('/api/money/describe-value', body) }} onChange={(money) => setSpec((prev) => withMoneyRule(prev, money))} />
            <div className="flex items-center justify-between pt-1">
              {moneyActive > 0 ? <button type="button" data-money-back="" onClick={() => setMoneyPart(moneyActive - 1)} className="text-xs text-text-secondary">Previous decision</button> : <span />}
              {moneyActive < moneyParts.length - 1 && <button type="button" data-money-next="" onClick={() => setMoneyPart(moneyActive + 1)} className="text-xs font-medium text-db-red-fg">Following decision</button>}
            </div>
          </section>
        )}

        {shows('app_place') && spec.outputs.app && (
          <AppPlacementStep
            spec={spec}
            targets={targets}
            targetsError={targetsError} onTargetsRetry={onTargetsRetry}
            heldApp={held.app || ''}
            scope={placeScope}
            warehouses={warehouses}
            warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry}
            warehouseCheck={preflight?.checks?.app_warehouse || null}
            lakebase={lakebase}
            nameCheck={preflight?.checks?.app_name || null}
            placeSet={placeSet}
            onJoin={(target) => { setPlaceSet('person'); setSpec((prev) => withMergeTarget(prev, 'app', target)); }}
            onNew={(placement) => {
              setPlaceSet(targets === null && placement !== APP_INSIDE ? 'waiting' : 'person');
              setSpec((prev) => withNewApp(prev, placement, targets, placeScope));
            }}
            onName={nameApp}
            onWarehouse={(id) => setSpec((prev) => withAppWarehouse(prev, id))}
            warehouseOpen={advanced.app}
            onWarehouseToggle={() => toggleAdvanced('app')}
            moveNote={moveNote}
            onKeep={() => { setPlaceSet('person'); setSpec((prev) => withHeldApp(prev, savedOutputs)); }}
            best={{ target: best.appTarget, policy: best.appPolicy, held: best.heldApp }}
          />
        )}

        {shows('app_access') && (
          <AppAccessStep
            spec={spec}
            onAccess={(access) => setSpec((prev) => withAppAccess(prev, access))}
            best={{ access: best.appAccess }}
          />
        )}

        {shows('app_storage') && (
          <AppStorageStep
            spec={spec}
            lakebase={lakebase}
            warehouses={warehouses}
            warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry}
            warehouseCheck={preflight?.checks?.app_warehouse || null}
            onBackend={(backend) => setSpec((prev) => withAppBackend(prev, backend))}
            onWarehouse={(id) => setSpec((prev) => withAppWarehouse(prev, id))}
            best={{ backend: best.appBackend }}
          />
        )}

        {shows('app_features') && (
          <Advanced open={advanced.app_options} onToggle={() => toggleAdvanced('app_options')} what="what people can do in the App"
            summary={`What people can do: ${APP_OPTIONS.filter((o) => spec.outputs.app_options[o.id]).map((o) => o.label).join(', ') || 'nothing'}`}>
            <AppFeaturesStep
              spec={spec}
              onOption={(key, value) => setSpec((prev) => withAppOption(prev, key, value))}
              best={{ option: best.appOption, replace: best.replaceEdits }}
            />
          </Advanced>
        )}

        {shows('app_pages') && (
          <AppPagesStep spec={spec} look={look} view={lookView} onView={setLookView} open={advanced.app_pages} onToggle={() => toggleAdvanced('app_pages')}
            onPage={(id, on) => setSpec((prev) => withAppPage(prev, id, on))} />
        )}

        {shows('app_look') && (
          <AppLookStep
            spec={spec}
            look={look}
            lookError={lookError}
            onLookRetry={onLookRetry}
            palette={palette}
            title={title}
            stake={sampleStake}
            onLook={(key, value) => setSpec((prev) => withAppLook(prev, key, value))}
            dates={chartDates}
            onChart={(id, on) => setSpec((prev) => withAppChart(prev, id, on, look, chartDates))}
            onInspireCharts={() => setSpec((prev) => withInspireCharts(prev))}
            best={{ layout: best.layout }}
            view={lookView}
            onView={setLookView}
          />
        )}

        {stepId === SUMMARY_STEP.id && (
          <>
            {readinessText(readiness, readiness?.scope) && (
              <p className="text-[11px] text-text-secondary">{readinessText(readiness, readiness.scope)}</p>
            )}
            <p data-built-sentence="" className="text-sm font-semibold text-text-primary">{builtSentence(spec)}</p>
            {shows('vibes') && (
              <VibesPanel spec={spec} built={built} next={(context?.latest?.spec_version ?? 0) + 1} blocks={blocks} onChange={(value) => patch('vibes', value)}
                onPrevious={(choice) => patch('vibe_previous', choice)} />
            )}
            <section aria-label="What Inspire picked" data-picked-summary="" className="bg-bg border border-border rounded-lg p-4 space-y-3 h-48 overflow-y-auto">
              <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-x-4 gap-y-2 text-[12px]">
                {summaryRows.map((row) => (
                  <div key={row.id} data-picked-row={row.id} className="contents">
                    <dt className="text-text-tertiary">{row.label}</dt>
                    <dd data-picked-value="" className="text-text-primary break-words">{row.value}</dd>
                    <dd>
                      {row.step !== SUMMARY_STEP.id && <button type="button" data-picked-change={row.step} className="text-[11px] font-medium text-db-red-fg hover:underline glow-focus"
                        aria-label={`Change ${row.label}`} onClick={() => changeStep(row.step)}>Change</button>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="space-y-2" aria-label="Settings you rarely change">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">Rarely changed</h4>
              <SettingRow label="Timezone" value={spec.schedule.timezone || 'UTC'} changeLabel="timezone">
                <Field label="Timezone">
                  <input dir="auto" className={inputCls} value={spec.schedule.timezone} onChange={(e) => patch('schedule.timezone', e.target.value)} />
                </Field>
              </SettingRow>
              <SettingRow label="Failure emails" value={(spec.schedule.failure_emails || []).join(', ') || 'the decision owner'} changeLabel="failure emails">
                <Field label="Failure emails (comma separated; default: the decision owner)">
                  <ListInput className={inputCls} separator="," value={spec.schedule.failure_emails} onChange={(list) => patch('schedule.failure_emails', list)} />
                </Field>
              </SettingRow>
            </section>
            {notebookEdit && (
              <label className="flex items-start gap-2 text-[12px] border border-warning/40 rounded-lg p-3">
                <input type="checkbox" className="mt-0.5" checked={Boolean(spec.confirm_notebook_overwrite)} onChange={(e) => patch('confirm_notebook_overwrite', e.target.checked)} />
                <span>
                  Overwrite the edits made to the notebook
                  {notebookEdit.edited_at ? ` on ${new Date(notebookEdit.edited_at).toLocaleString()}` : ''}
                  <span className="block text-text-tertiary">Leave it off to keep them: then change only the outputs or the schedule.</span>
                  {plan?.summary?.refill && !spec.confirm_notebook_overwrite && (
                    <span className="block text-warning-fg">This version rebuilds the notebook, so it stops and asks again unless you tick this.</span>
                  )}
                </span>
              </label>
            )}

            {folderWarning && <p role="note" aria-label="Where Inspire saves the MVP" className="text-[11px] text-warning-fg">{folderWarning}</p>}
            {plan?.summary?.app_reads?.text && <p role="note" aria-label="Data the new App cannot read" data-app-reads-warning="" className="text-[11px] text-warning-fg">{plan.summary.app_reads.text}</p>}

            {generalChecks.some(([, v]) => !v.ok || v.warn) && (
              <section className="space-y-1" aria-label="Access checks">
                {generalChecks.filter(([, v]) => !v.ok || v.warn).map(([k, v]) => <CheckLine key={k} check={v} label={PREFLIGHT_LABELS[k] || k.replace(/_/g, ' ')} />)}
              </section>
            )}

            <Advanced open={advanced.summary} onToggle={() => toggleAdvanced('summary')} what="checks and plan" summary="Version plan, permission checks and cost hint">
              {plan && (
                <div className="space-y-1">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">
                    {plan.based_on_version ? `Version ${plan.spec_version}, edited from version ${plan.based_on_version}` : `Version ${plan.spec_version}`}
                  </h4>
                  {planLines(plan.summary, { shared, live: liveCheck }).map((line) => <p key={line} className="text-[12px] text-text-secondary">{line}</p>)}
                  {(plan.warnings || []).map((line) => <p key={line} data-plan-warning="" className="text-[12px] text-warning-fg">{line}</p>)}
                </div>
              )}
              {checkEntries.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">
                    Permission checks{preflight.identity ? `, run live as ${preflight.identity}` : ''}
                  </h4>
                  {checkEntries.map(([k, v]) => <CheckLine key={k} check={v} label={PREFLIGHT_LABELS[k] || k.replace(/_/g, ' ')} />)}
                </div>
              )}
              <p className="text-[11px] text-text-tertiary">Cost hint: {costHint(spec)}</p>
            </Advanced>
          </>
        )}
        {shows('vibes') && collectedNote && (
          <p role="status" data-collected-vibes="" className="mb-3 text-[11px] text-text-secondary bg-bg border border-border rounded-md px-3 py-2">{collectedNote}</p>
        )}
        {shows('vibes') && firstRunUnrecorded && !scopeSteps.firstRun && scopeProfile.state !== 'loading' && (
          <p role="note" data-first-run-unrecorded="" className="mb-3 text-[11px] text-text-secondary bg-bg border border-border rounded-md px-3 py-2">
            {RUN_SCOPE_UNRECORDED_HIDDEN}
          </p>
        )}
      </div>

      <footer className="border-t border-border px-6 py-3 space-y-2">
        {unchanged && (
          <div role="note" aria-label="Nothing to build" className="bg-bg-subtle border border-border rounded-md px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-text-secondary">
              Nothing changed since version {plan.based_on_version}, so there is nothing new to build. Change a choice in any step to
              build version {plan.spec_version}, or go to the Build page to rebuild an output or preview a re-run.
            </p>
            <label className="flex items-start gap-2 text-xs text-text-primary">
              <input type="checkbox" className="mt-0.5" data-rebuild-as-is="" checked={rebuildAsIs} onChange={(e) => setRebuildAsIs(e.target.checked)} />
              <span>{REBUILD_AS_IS_NOTE}</span>
            </label>
            {onOpenBuild && (
              <button type="button" className="shrink-0 text-xs font-semibold text-db-red-fg hover:underline" onClick={() => onOpenBuild(plan.use_case_id)}>
                Go to the Build page
              </button>
            )}
          </div>
        )}
        {appRenamed?.to === spec.outputs.app_name && buildStep && (
          <p role="note" data-app-renamed="" className="text-xs text-text-secondary">{appRenamed.text}</p>
        )}
        {lastStep && lastNameShown && spec.outputs.app && !spec.outputs.merge?.app && (
          <div data-last-app-name="" className="bg-bg-subtle border border-border rounded-md px-3 py-2">
            <AppNameField name={spec.outputs.app_name || ''} nameCheck={appNameShown} onName={nameApp} />
          </div>
        )}
        {lastStep && moveNote && (
          <p role="note" aria-label="Before you start" data-plan-move-note=""
            className="bg-warning-bg border border-warning/30 rounded-md px-3 py-2 text-xs font-medium text-warning-fg">{moveNote}</p>
        )}
        {stepId === 'data' && Object.keys(context?.table_scope || {}).length > 0 && (
          <div aria-label="Table scope" data-table-scope-notes="" className="bg-bg-subtle border border-border rounded-md px-3 py-2 text-xs text-text-secondary space-y-1">
            <p className="font-semibold text-text-primary">Inspire reads only the scope of these tables</p>
            <ul className="list-disc ps-4">
              {Object.entries(context.table_scope).map(([table, entry]) => (
                <li key={table} data-scope-table={table}>{table}: {tableScopeSummary(entry)}</li>
              ))}
            </ul>
          </div>
        )}
        {readiness?.warning && (
          <p role="note" aria-label="Rows to work with" data-empty-table-warning=""
            className="bg-warning-bg border border-warning/30 rounded-md px-3 py-2 text-xs font-medium text-warning-fg">{readiness.warning}</p>
        )}
        {tooFewRows && (
          <p role="note" data-too-few-rows="" className="bg-warning-bg border border-warning/30 rounded-md px-3 py-2 text-xs font-medium text-warning-fg">{tooFewRows}</p>
        )}
        {schemaJob?.text && stepIndex > steps.findIndex((x) => x.id === 'data') && (
          <p role="status" data-schema-job={schemaJob.state} className="bg-bg-subtle border border-border rounded-md px-3 py-2 text-xs text-text-secondary">{schemaJob.text}</p>
        )}
        {Object.values(checkNotes).filter(Boolean).map((note) => (
          <p key={note} role="note" data-check-note="" className="bg-warning-bg border border-warning/30 rounded-md px-3 py-2 text-xs text-warning-fg">{note}</p>
        ))}
        {lastStep && accessVerdict === 'pending' && (
          <p role="status" data-access-verdict="pending" className="text-xs text-text-secondary">{ACCESS_CHECKING}</p>
        )}
        {lastStep && (accessVerdict === 'error' || accessVerdict === 'unknown') && (
          <div role="alert" data-access-verdict={accessVerdict} className="flex items-center justify-between gap-3 bg-error-bg border border-error/20 rounded-md px-3 py-2 text-xs text-error-fg">
            <span>{ACCESS_UNKNOWN}</span>
            <button type="button" data-access-retry="" className="font-semibold underline" onClick={checkAgain}>Try again</button>
          </div>
        )}
        {footerErrors.length > 0 && (
          <div role="alert" className="bg-error-bg border border-error/20 rounded-md px-3 py-2 space-y-0.5">
            {footerErrors.map((e) => <PlainMessage key={e} text={e} onRetry={footerRetry.get(e) || null} copy={footerRetry.has(e)} className="text-xs text-error-fg" />)}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className={`inline-flex items-center gap-1 text-xs text-text-secondary ${stepIndex === 0 ? 'invisible' : ''}`}
            disabled={stepIndex === 0 || busy}
            onClick={() => { setErrors([]); if (stepId === 'stake' && moneyActive > 0) setMoneyPart(moneyActive - 1); else setStep(steps[stepIndex - 1].id); }}
          >
            <ChevronLeft size={14} /> Back
          </button>
          <div className="flex items-center gap-2">
            {mode === 'mvp' && stepIndex > 0 && !lastStep && sourceAccessRefused && (
              <p data-source-refused="" className="text-[11px] text-warning-fg">{SOURCE_REFUSED_REASON}</p>
            )}
            {mode === 'mvp' && stepIndex > 0 && !lastStep && !sourceAccessRefused && (
              <button type="button" data-build-now="" disabled={implementBlocked || steps.some((x) => stepErrors(x.id, spec, extras, mode).length > 0)} onClick={submit}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-db-red-fg border border-db-red/50 disabled:opacity-50">
                {BUILD_NOW_LABEL}
              </button>
            )}
            {stepId !== 'notebook' && !lastStep ? (
              <button
                type="button"
                disabled={Boolean(checking)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-70"
                onClick={goNext}
              >
                {checking ? <><Loader2 size={14} className="animate-spin" /> {checking}…</> : <>{nextIsSummary ? BACK_TO_SUMMARY : 'Next'} <ChevronRight size={14} /></>}
              </button>
            ) : stepId === 'notebook' ? (
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-50"
                onClick={generateNotebook}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? 'Starting…' : 'Generate notebook'}
              </button>
            ) : sourceAccessRefused ? (
              <p data-source-refused="" className="text-[11px] text-warning-fg">{SOURCE_REFUSED_REASON}</p>
            ) : (
              <button
                type="button"
                disabled={implementBlocked}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-50"
                onClick={submit}
              >
                {(busy || checksBusy || !placeSettled) && <Loader2 size={14} className="animate-spin" />}
                {busy ? 'Starting…' : !placeSettled ? 'Listing the Apps…' : checksBusy ? 'Checking access…' : BUILD_IT_LABEL}
              </button>
            )}
          </div>
        </div>
      </footer>
    </Overlay>
  );
}

const LEGEND = 'text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary';
const ACCESS_SHORT = { user: 'each person sees only their own rows', sp: 'everyone sees the same rows' };

function SegmentButton({ on, disabled = false, onClick, option, children }) {
  return (
    <button
      type="button"
      data-option={option}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1 text-[11px] font-medium border-e border-border last:border-e-0 disabled:cursor-not-allowed ${on ? 'bg-db-red-solid text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
    >
      {children}
    </button>
  );
}

function VibesPanel({ spec, built, next, blocks, onChange, onPrevious }) {
  const asked = String(spec.vibes ?? '').trim() !== '';
  const choices = built != null && asked ? vibePreviousChoices(built, next, Boolean(spec.outputs?.alert)) : [];
  const skipped = vibesSkippedText(spec, blocks);
  const skippedAsks = skippedAsksText(spec);
  return (
    <section aria-label="Vibes" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{VIBES_STEP_TITLE}</h3>
        <p className="text-[11px] text-text-secondary">{VIBES_STEP_NOTE}</p>
      </div>
      <div data-vibes="mvp">
        <VibesEditor id="mvp" label="MVP" value={spec.vibes ?? ''} onChange={onChange} autoFocus />
      </div>
      <VibePrevious built={built} choices={choices} value={spec.vibe_previous} onPick={onPrevious} />
      {skipped && <p data-vibes-skipped="" className="text-[11px] text-text-secondary">{skipped}</p>}
      {skippedAsks && <p role="note" data-vibes-skipped-asks="" className="text-[11px] text-warning-fg">{skippedAsks}</p>}
    </section>
  );
}

const APP_LIST_HEIGHT = 'h-32';
const placeCard = (on) => `border rounded-lg p-3 space-y-2 ${on ? 'border-db-red/50 bg-db-red-50/40' : 'border-border'}`;

function AppNameField({ name, nameCheck, onName }) {
  return (
    <div className="space-y-1">
      <Field label="App name">
        <input dir="auto" className={inputCls} value={name} onChange={(e) => onName(e.target.value.toLowerCase())} />
      </Field>
      {name && !APP_NAME_RE.test(name) ? (
        <p className="text-[11px] text-error-fg">3-30 lowercase letters, digits and dashes, starting with a letter</p>
      ) : nameCheck?.ok === false ? (
        <p className="text-[11px] text-error-fg">
          {nameCheck.detail}.{' '}
          <button data-draft-change="" type="button" className="text-db-red-fg underline" onClick={() => onName(nameCheck.suggested || nextAppName(name))}>Use {nameCheck.suggested || nextAppName(name)}</button>
        </p>
      ) : (
        <p className="text-[11px] text-text-tertiary">{nameCheck?.ok ? nameCheck.detail : 'Up to 30 lowercase letters, digits and dashes.'}</p>
      )}
    </div>
  );
}

function joinListText(targets, choices, open) {
  if (targets === null) return 'Finding the Apps Inspire built';
  if (!choices.length) return 'Inspire has built none yet.';
  if (!open.length) return 'None can take a per-user use case.';
  return `${choices.length} App${choices.length === 1 ? '' : 's'} Inspire built, the best fit first.`;
}

function JoinedWarehouse({ target, warehouses }) {
  if (!target?.warehouse_id) return null;
  return (
    <div data-app-warehouse="locked" className="ps-7 space-y-1">
      <Field label="SQL warehouse">
        <select className={inputCls} value={target.warehouse_id} disabled>
          <option value={target.warehouse_id}>{warehouseText(warehouses, target.warehouse_id)}</option>
        </select>
      </Field>
      <p className="text-[11px] text-text-tertiary">{joinedWarehouseText(target)}</p>
      <TechnicalDetails items={target.built_by?.use_case_id ? `Built by use case ${target.built_by.use_case_id}` : ''} />
    </div>
  );
}

function scrollChosenIntoList(list) {
  const item = list?.querySelector('input[name="app-target"]:checked')?.closest('li');
  if (!item) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function InsideInspireCard({ spec, on, lakebase, warehouses, warehousesError, onWarehousesRetry, warehouseCheck, onPick, onWarehouse, note = '', warehouseOpen = false, onWarehouseToggle }) {
  const missing = !String(spec.outputs.app_warehouse_id || '').trim();
  return (
    <div data-app-place="inspire" className={on ? placeCard(true) : 'border border-border rounded-lg px-3 py-2'}>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="radio" name="app-place" value={APP_INSIDE} className="mt-0.5" checked={on} onChange={onPick} />
        <span className="space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">{APP_INSIDE_PLACEMENT.label}</span>
            <span className="text-[11px] text-text-tertiary">{APP_INSIDE_PLACEMENT.note}</span>
          </span>
          {on && <span data-placement-blurb="" className="block text-[11px] text-text-secondary">{APP_INSIDE_PLACEMENT.blurb}</span>}
        </span>
      </label>
      {on && (
        <div className="ps-7 space-y-1">
          {missing && <p data-inside-warehouse-missing="" className="text-[11px] text-error-fg">{INSIDE_WAREHOUSE_PROBLEM}</p>}
          <Advanced open={warehouseOpen || missing} onToggle={onWarehouseToggle} what={INSIDE_WAREHOUSE_TOGGLE} summary={`SQL warehouse: ${spec.outputs.app_warehouse_id || 'not picked'}`}>
            <AppWarehouseField spec={spec} lakebase={lakebase} warehouses={warehouses} warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry} check={warehouseCheck}
              label={INSIDE_WAREHOUSE_LABEL} onWarehouse={onWarehouse} />
          </Advanced>
          {note && <p role="note" aria-label="What happens to the App it has now" data-inside-move-note="" className="text-[11px] text-warning-fg">{note}</p>}
        </div>
      )}
    </div>
  );
}

function AppPlacementStep({ spec, targets, targetsError, onTargetsRetry, heldApp, scope, warehouses, warehousesError, onWarehousesRetry, warehouseCheck, lakebase, nameCheck,
  moveNote = '', placeSet = '', onJoin, onNew, onName, onWarehouse, onKeep, warehouseOpen = false, onWarehouseToggle, best = null }) {
  const joined = joinsApp(spec) ? spec.outputs.merge.app : '';
  const inside = !joined && insideInspire(spec);
  const listing = targets === null && !targetsError;
  const fresh = !joined && !inside && placeSet !== '';
  const choices = targetsError ? [] : appPlacementChoices(spec, targets, scope);
  const open = choices.filter((c) => !c.block);
  const chosen = choices.find((c) => c.target.id === joined) || null;
  const placement = spec.outputs.app_placement;
  const memory = placementMemoryText(targets, scope.business);
  const name = spec.outputs.app_name || '';
  const listRef = useRef(null);
  useEffect(() => { scrollChosenIntoList(listRef.current); }, [joined, choices.length]);
  if (heldApp) {
    return (
      <section className="space-y-4" aria-label="App placement">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Where does the App of this use case go?</h3>
          <p className="text-[11px] text-text-tertiary">
            {inside ? `This use case already has its App, ${heldApp}. Its page moves Inside Inspire instead.`
              : `This use case already has its App, ${heldApp}, so Genie rebuilds it there.`}
          </p>
        </div>
        <div role="radiogroup" aria-label="Where the App goes" data-choice="app-place" className="space-y-3">
          <div data-app-place="held" className={placeCard(!inside)}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="radio" name="app-place" value="held" className="mt-0.5" checked={!inside} onChange={onKeep} />
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold text-text-primary">Keep it in {heldApp}</span>
                <Recommended best={best?.held} id="held" />
              </span>
            </label>
            {!inside && !joined && <div className="ps-7"><AppNameField name={name} nameCheck={nameCheck} onName={onName} /></div>}
            {!inside && joined && <JoinedWarehouse target={chosen?.target} warehouses={warehouses} />}
          </div>
          <InsideInspireCard spec={spec} on={inside} lakebase={lakebase} warehouses={warehouses} warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry}
            warehouseCheck={warehouseCheck} onPick={() => onNew(APP_INSIDE)} onWarehouse={onWarehouse} note={moveNote}
            warehouseOpen={warehouseOpen} onWarehouseToggle={onWarehouseToggle} />
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-4" aria-label="App placement">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Where does the App of this use case go?</h3>
        <p className="text-[11px] text-text-tertiary">Add it to an App Inspire built, or create a new one.{memory && ` ${memory}`}</p>
      </div>
      <div role="radiogroup" aria-label="Where the App goes" aria-busy={listing} data-choice="app-place" className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {(joined || choices.length > 0 || targets === null || targetsError) && <div data-app-place="join" className={placeCard(Boolean(joined))}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="app-place" value="join" className="mt-0.5" checked={Boolean(joined)} disabled={!joined && !open.length}
              onChange={() => onJoin(open[0].target)} />
            <span>
              <span className="block text-sm font-semibold text-text-primary">Add to an existing App</span>
              <span className="block text-[11px] text-text-secondary">
                {targets === null && !targetsError && <Loader2 size={11} className="inline animate-spin me-1" aria-hidden="true" />}
                {!targetsError && joinListText(targets, choices, open)}
              </span>
              {targetsError && <PlainMessage as="span" text={`Inspire could not list the Apps it built: ${targetsError}`} after="Genie creates a new one."
                onRetry={onTargetsRetry} copy data-app-targets-error="" className="block text-[11px] text-text-secondary" />}
            </span>
          </label>
          {choices.length > 0 && !inside && (
            <ul ref={listRef} aria-label="Apps Inspire built" data-app-list="" data-choice="app-target"
              className={`relative ms-7 space-y-1.5 overflow-y-auto rounded-md border border-border bg-surface px-2 py-1.5 ${APP_LIST_HEIGHT}`}>
              {choices.map((c) => (
                <li key={c.target.id} data-app-target={c.target.id}>
                  <label className={`flex items-start gap-2 ${c.block && joined !== c.target.id ? '' : 'cursor-pointer'}`}>
                    <input type="radio" name="app-target" value={c.target.id} className="mt-0.5" checked={joined === c.target.id}
                      disabled={Boolean(c.block) && joined !== c.target.id} onChange={() => onJoin(c.target)} />
                    <span className="space-y-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span data-fit={c.fit} className="text-[12px] font-medium text-text-primary">{c.target.name}</span>
                        <Recommended best={best?.target} id={c.target.id} />
                      </span>
                      <span className="block text-[11px] text-text-secondary">Holds {mergeTargetText(c.target)} · {ACCESS_SHORT[c.target.access]}</span>
                      {c.reason && <span className="block text-[11px] text-text-secondary">{c.reason}</span>}
                      {c.block && <span className="block text-[11px] text-error-fg">{c.block}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {chosen && !chosen.block && (
            <p role="note" aria-label="The App this use case joins" className="ps-7 text-[11px] text-text-secondary">{joinedAppText(chosen.target)}</p>
          )}
          {chosen && !chosen.block && <JoinedWarehouse target={chosen.target} warehouses={warehouses} />}
          {joined && !chosen && targets !== null && (
            <p className="ps-7 text-[11px] text-error-fg">{joined} is not one Inspire built that you can open: pick another, or create a new App.</p>
          )}
        </div>}
        <div data-app-place="new" className={placeCard(fresh)}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="app-place" value="new" className="mt-0.5" checked={fresh}
              onChange={() => onNew(inside ? APP_PLACEMENT_DEFAULT : placement)} />
            <span className="space-y-0.5">
              <span className="block text-sm font-semibold text-text-primary">Create a new App</span>
            </span>
          </label>
          {fresh && listing && (
            <p data-app-new-waiting="" className="ps-7 text-[11px] text-text-secondary">
              <Loader2 size={11} className="inline animate-spin me-1" aria-hidden="true" />
              A new App it is. Inspire names it once it has listed the Apps it built, so the name never takes one of theirs.
            </p>
          )}
          {fresh && !listing && (
            <div className="ps-7 space-y-3">
              <div role="radiogroup" aria-label="How Inspire organizes Apps" data-choice="app-policy" className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {APP_OWN_PLACEMENTS.map((p) => {
                  const off = newAppPlacementBlock(spec, targets, scope, p.id);
                  return (
                    <label key={p.id} className={`flex items-start gap-2 ${off ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input type="radio" name="app-policy" value={p.id} className="mt-0.5" checked={placement === p.id} disabled={Boolean(off)}
                        onChange={() => onNew(p.id)} />
                      <span className="text-[11px] text-text-secondary">
                        <span className="text-[12px] font-medium text-text-primary">{p.label}</span>{placement === p.id && `. ${p.blurb}`}
                        <span className="block"><Recommended best={best?.policy} id={p.id} /></span>
                        {off && <span data-placement-off={p.id} className="block">{off}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              <AppNameField name={name} nameCheck={nameCheck} onName={onName} />
            </div>
          )}
        </div>
        <InsideInspireCard spec={spec} on={inside} lakebase={lakebase} warehouses={warehouses} warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry}
          warehouseCheck={warehouseCheck} onPick={() => onNew(APP_INSIDE)} onWarehouse={onWarehouse}
          warehouseOpen={warehouseOpen} onWarehouseToggle={onWarehouseToggle} />
      </div>
    </section>
  );
}

function MergeChoice({ name, label, chosen, targets, targetsError, onTargetsRetry, onPick }) {
  const list = (targets && targets[name]) || [];
  const target = mergeTargetOf(targets, name, chosen);
  const open = list[0] || null;
  const optionText = (t) => `${t.name} · holds ${mergeTargetText(t)}`;
  return (
    <div className="ps-7 space-y-1.5" data-merge={name}>
      <div className="flex flex-wrap items-center gap-2">
        {(chosen || open) && (
          <div data-choice={`merge-${name}`} className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={`Where Genie builds the ${label}`} className="inline-flex rounded-md border border-border overflow-hidden">
              <SegmentButton option="" on={!chosen} onClick={() => onPick(null)}>Create new</SegmentButton>
              <SegmentButton option="existing" on={Boolean(chosen)} onClick={() => { if (!chosen) onPick(open); }}>Add to an existing one</SegmentButton>
            </div>
          </div>
        )}
        {!chosen && targets === null && <span className="text-[11px] text-text-tertiary"><Loader2 size={11} className="inline animate-spin" /> Finding the ones Inspire built</span>}
        {!chosen && targets !== null && !targetsError && !list.length && <span className="text-[11px] text-text-tertiary">Genie creates a new one, since Inspire has built none yet</span>}
      </div>
      {targetsError && <PlainMessage text={`Inspire could not list the ${label}s it built: ${targetsError}`} after="Genie creates a new one." onRetry={onTargetsRetry} copy className="text-[11px] text-text-tertiary" />}
      {chosen && (
        <>
          <select aria-label={`${label} to add this use case to`} className={inputCls} value={chosen} onChange={(e) => onPick(mergeTargetOf(targets, name, e.target.value))}>
            {!target && <option value={chosen}>{chosen}</option>}
            {list.map((t) => <option key={t.id} value={t.id}>{optionText(t)}</option>)}
          </select>
          {!target && targets !== null && <p className="text-[11px] text-error-fg">{chosen} is not one Inspire built that you can open: pick another, or choose Create new.</p>}
        </>
      )}
    </div>
  );
}

function resultPartSetter(parts, onChange) {
  return (key, value) => onChange({ ...parts, [key]: value, ...(key === 'catalog' && value !== parts.catalog ? { schema: '' } : {}) });
}

function ResultPlaceFields({ parts, catalogs, catalogsCut = false, catalogsError, onCatalogsRetry, schemas, onSchemasRetry, onChange, onCreate = null }) {
  const set = resultPartSetter(parts, onChange);
  const schemaOptions = [...new Set([parts.schema, ...((schemas && schemas.names) || [])].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const typeCatalog = Boolean(catalogsError);
  const typeSchema = typeCatalog || Boolean(schemas && schemas.error);
  return (
    <>
      <div className="space-y-2" aria-label="Result table catalog and schema" role="group">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Catalog">
            {typeCatalog ? (
              <input dir="auto" className={inputCls} value={parts.catalog} onChange={(e) => set('catalog', e.target.value.trim())} />
            ) : (
              <CatalogPicker id="implement-result-table" value={parts.catalog} onChange={(name) => set('catalog', name)} catalogs={catalogs || []}
                truncated={catalogsCut} loading={catalogs === null} className={inputCls} />
            )}
          </Field>
          <Field label="Schema">
            {typeSchema ? (
              <input dir="auto" className={inputCls} value={parts.schema} onChange={(e) => set('schema', e.target.value.trim())} />
            ) : (
              <select className={inputCls} value={parts.schema} disabled={!parts.catalog} onChange={(e) => set('schema', e.target.value)}>
                {!parts.schema && <option value="">{parts.catalog ? 'Pick a schema' : 'Pick a catalog first'}</option>}
                {schemaOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                {parts.catalog && !schemas && <option disabled value="__loading__">Loading schemas…</option>}
              </select>
            )}
          </Field>
          <Field label="Table name">
            <input dir="auto" className={inputCls} value={parts.table} onChange={(e) => set('table', e.target.value.trim())} />
          </Field>
        </div>
        {(catalogsError || (schemas && schemas.error)) && (
          <PlainMessage text={`Inspire could not list the ${catalogsError ? 'catalogs' : 'schemas'}: ${catalogsError || schemas.error}`} after="Type the name instead."
            onRetry={catalogsError ? onCatalogsRetry : onSchemasRetry} copy data-place-list-error="" className="text-[11px] text-text-secondary" />
        )}
      </div>
      {onCreate && <NewPlace catalog={parts.catalog} onCreate={onCreate} />}
    </>
  );
}

function NewPlace({ catalog, onCreate }) {
  const [kind, setKind] = useState(catalog ? 'schema' : 'catalog');
  const [name, setName] = useState('');
  const [state, setState] = useState({ busy: false, error: '', done: '' });
  const want = kind === 'schema' && !catalog ? 'catalog' : kind;
  const problem = name.trim() ? placeNameProblem(name, want) : '';
  const create = async () => {
    setState({ busy: true, error: '', done: '' });
    try {
      await onCreate(want, name.trim());
      setState({ busy: false, error: '', done: `Created ${want === 'schema' ? `${catalog}.${name.trim()}` : name.trim()}.` });
      setName('');
    } catch (e) {
      setState({ busy: false, error: `Inspire could not create it: ${e.message}`, done: '' });
    }
  };
  return (
    <div role="group" aria-label="New catalog or schema" data-new-place="" className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
        <span>New</span>
        <select aria-label="What to create" className={`${inputBase} w-auto py-1`} value={want} onChange={(e) => setKind(e.target.value)}>
          <option value="catalog">catalog</option>
          <option value="schema" disabled={!catalog}>{catalog ? `schema in ${catalog}` : 'schema (pick a catalog first)'}</option>
        </select>
        <input dir="auto" aria-label={`New ${want} name`} placeholder={`${want} name`} className={`${inputBase} w-48 py-1`} value={name}
          onChange={(e) => setName(e.target.value)} />
        <button type="button" disabled={!name.trim() || Boolean(problem) || state.busy} onClick={create}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-text-primary disabled:opacity-50">
          {state.busy && <Loader2 size={12} className="animate-spin" />}Create
        </button>
        <span className="text-[11px] text-text-tertiary">Needs {PLACE_RIGHTS[want]}.</span>
      </div>
      {problem && <p className="text-[11px] text-error-fg">{problem}</p>}
      {state.error && <PlainMessage text={state.error} role="alert" copy data-new-place-error="" className="text-[11px] text-error-fg" />}
      {state.done && <p role="status" className="text-[11px] text-success-fg">{state.done}</p>}
    </div>
  );
}

function ResultTableStep({ table, ownTable, inspireTable, place, note = '', outputCheck, onChange, best = null, blocks = {}, children = null }) {
  const named = { own: ownTable, inspire: inspireTable };
  return (
    <section className="space-y-2" aria-label="Where the result table lives">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Where should the result table live?</h3>
        <p className="text-[11px] text-text-tertiary">Genie writes this MVP&apos;s results to this table, and Inspire writes nowhere else. Next checks live that you can create or write it.</p>
      </div>
      <div role="radiogroup" aria-label="Where the tables go" data-choice="result-table" className="flex flex-wrap gap-x-5 gap-y-1">
        {RESULT_PLACES.filter((option) => !blocks[option.id] && (option.id === 'pick' || named[option.id])).map((option) => (
          <div key={option.id} data-option={option.id}>
            <label className="flex items-baseline gap-x-1.5 text-[12px] text-text-primary">
              <input type="radio" name="result-place" value={option.id} checked={place === option.id}
                onChange={() => onChange(named[option.id] ? resultTableParts(named[option.id]) : { ...resultTableParts(table), schema: '' })} />
              <span className="font-medium">{option.label}</span>
              <Recommended best={best} id={option.id} />
            </label>
          </div>
        ))}
      </div>
      {note ? (
        <div role="note" aria-label="Where the tables go note" data-place-note="" className="text-[11px] text-text-secondary"><PlainMessage text={note} /></div>
      ) : <BlockedReason block={blocks.own} id="own" />}
      {children}
      <p className="text-[11px] text-text-secondary" role="group" aria-label="Result table" data-result-table={table}>
        Main table: <span className="font-mono text-[12px] text-text-primary break-all">{table || 'catalog.schema.table'}</span>
      </p>
      {outputCheck && (
        <div className="text-[11px] space-y-0.5" aria-label="Result table check">
          <PlainMessage text={outputCheck.write?.detail} className={outputCheck.write?.ok ? 'text-success-fg' : 'text-error-fg'} />
          {outputCheck.write?.ok && <PlainMessage text={outputCheck.safety?.detail} className={outputCheck.safety?.ok ? 'text-success-fg' : 'text-error-fg'} />}
          {outputCheck.model && <PlainMessage text={outputCheck.model.detail} className={outputCheck.model.ok ? 'text-success-fg' : 'text-error-fg'} />}
          {outputCheck.write?.ok && outputCheck.safety?.ok && <PlainMessage text={`Sharing: ${outputCheck.grant?.detail || ''}`} className="text-text-tertiary" />}
          {outputCheck.identity && <p className="text-text-tertiary">Checked live as {outputCheck.identity}.</p>}
        </div>
      )}
      <p role="note" aria-label="Moving the result table" className="text-[11px] text-text-secondary">{RESULT_TABLE_MOVE_NOTE}</p>
    </section>
  );
}

function KpiTargetSetting({ spec, options, tracked, before, onPick, best = null }) {
  const value = kpiTargetOf(spec);
  const listed = options.find((o) => kpiKey(o.name) === kpiKey(value));
  const problem = kpiTargetProblems(spec, options)[0] || '';
  const changed = before != null && kpiKey(value) !== kpiKey(before);
  const shown = tracked ? trackedKpiText(tracked.record, tracked.impact) : options.length ? KPI_PICK_RULE : KPI_NONE_YET;
  return (
    <div role="group" aria-label="Target KPI" data-choice="kpi" className="space-y-1.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <span className="shrink-0 text-[12px] font-medium text-text-primary sm:w-20 sm:pt-2">Target KPI</span>
        <select aria-label="Target KPI" className={`${inputBase} w-full sm:w-56 shrink-0`} value={listed ? listed.name : value} onChange={(e) => onPick(e.target.value)}>
          <option value="">{KPI_INSPIRE_PICKS}</option>
          {options.map((o) => <option key={o.name} value={o.name}>{kpiOptionLabel(o)}</option>)}
          {value && !listed && <option value={value}>{value}</option>}
        </select>
        <p data-kpi-tracked="" className="text-[11px] text-text-secondary">{shown}</p>
      </div>
      <BestOf best={best} label={best?.id} />
      {changed && <p data-kpi-change="" className="text-[11px] text-text-primary">{KPI_CHANGE_NOTE}</p>}
      {problem && <p className="text-[11px] text-error-fg">{problem}</p>}
    </div>
  );
}

function HoldoutPercent({ spec, onPercent }) {
  if (!holdoutOf(spec).enabled) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
      Hold back
      <input
        type="number"
        inputMode="numeric"
        min={HOLDOUT_MIN_PERCENT}
        max={HOLDOUT_MAX_PERCENT}
        step="1"
        aria-label="Share of records held back, in percent"
        className={`${inputBase} w-20`}
        value={holdoutPercentText(spec)}
        onChange={(e) => onPercent(e.target.value)}
      />
      % of the records ({HOLDOUT_MIN_PERCENT} to {HOLDOUT_MAX_PERCENT}), picked at random and kept the same on every run
    </label>
  );
}

function HoldoutSetting({ spec, onEnabled, children = null, best = null }) {
  const { enabled } = holdoutOf(spec);
  const problem = holdoutProblems(spec)[0] || '';
  return (
    <fieldset className="space-y-2" aria-label="Measure impact">
      <legend className="text-sm font-semibold text-text-primary">Measure impact</legend>
      {children}
      <label data-choice="holdout" className="flex items-start gap-2.5 cursor-pointer pt-1">
        <input type="checkbox" value="true" className="mt-0.5" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        <span className="text-[11px] text-text-secondary">
          <span className="text-[12px] font-medium text-text-primary">{HOLDOUT_LABEL}</span>. {HOLDOUT_BLURB}
          <span className="block mt-1"><Recommended best={best} id /></span>
        </span>
      </label>
      {problem && <p className="ms-6 text-[11px] text-error-fg">{problem}</p>}
    </fieldset>
  );
}

function AppBackendChoice({ spec, lakebase, onBackend, children = null, best = null }) {
  const backend = appBackendOf(spec, lakebase);
  const blocks = appBackendBlocks(spec, lakebase);
  const absent = lakebase?.state === 'absent';
  const loading = lakebase === null && !blocks.lakebase;
  const chosen = loading ? null : APP_BACKEND_CHOICES.find((choice) => choice.id === backend);
  return (
    <fieldset data-app-speed="" className="space-y-1.5 ps-3 border-s-2 border-border">
      <legend className="text-[12px] font-medium text-text-primary">How fast do the App's pages open?</legend>
      {absent ? (
        <BlockedReason block={blocks.lakebase} id="app-backend" />
      ) : (
        <>
          <div data-choice="app-backend" className="flex flex-wrap gap-x-6 gap-y-1.5 pt-1">
            {APP_BACKEND_CHOICES.map((choice) => {
              const off = loading || Boolean(blocks[choice.id]);
              const checked = !loading && backend === choice.id;
              return (
                <label
                  key={choice.id}
                  aria-disabled={off ? 'true' : undefined}
                  className={`inline-flex items-center gap-2 text-sm glow-focus ${off ? 'cursor-not-allowed text-text-secondary' : 'cursor-pointer text-text-primary'}`}
                >
                  <input type="radio" name="app-backend" value={choice.id} checked={checked} disabled={off} onChange={() => onBackend(choice.id)} />
                  <span className={checked ? 'font-semibold' : 'font-medium'}>{choice.label}</span>
                  <Recommended best={best} id={choice.id} why={false} />
                </label>
              );
            })}
          </div>
          {(spec.outputs.app_access === 'user' ? [PER_USER_GUIDE] : APP_BACKEND_GUIDE).map((line) => <p key={line} className="text-[11px] text-text-secondary">{line}</p>)}
          {chosen?.blurb && <p className="text-[12px] text-text-secondary">{chosen.blurb}</p>}
          {!loading && best?.reason && lakebase?.state !== 'unknown' && <p data-recommended-why="" className="text-[11px] text-text-secondary">{best.reason}</p>}
          {loading && <p className="text-[11px] text-text-tertiary" role="status">{LAKEBASE_CHECKING}…</p>}
          <BlockedReason block={blocks.lakebase} id="app-backend" />
          {lakebase?.state === 'unknown' && !blocks.lakebase && (
            <div role="note" aria-label="Fast pages not checked" className="text-[11px] text-text-secondary">
              <p>{LAKEBASE_UNCHECKED}</p>
              <TechnicalDetails items={lakebase.detail} />
            </div>
          )}
        </>
      )}
      {children}
    </fieldset>
  );
}

function BuildWarehouseField({ value, warehouses, warehousesError, onWarehousesRetry, onChange }) {
  const id = String(value || '');
  const note = warehousesError ? '' : warehouseListNote(warehouses);
  const typed = Boolean(warehousesError) || (Array.isArray(warehouses) && !warehouses.length);
  const state = warehouseStateNote(warehouses, id);
  return (
    <div data-build-warehouse={typed ? 'typed' : 'pick'} className="space-y-1">
      {typed ? (
        <Field label="SQL warehouse id">
          <input dir="auto" className={inputCls} value={id} onChange={(e) => onChange(e.target.value.trim())} />
        </Field>
      ) : (
        <Field label="SQL warehouse">
          <select className={inputCls} value={id} disabled={warehouses === null} onChange={(e) => onChange(e.target.value)}>
            {!id && <option value="">Pick a SQL warehouse</option>}
            {warehouseOptions(warehouses, [id]).map((w) => (
              <option key={w.id} value={w.id}>{warehouseOptionText(warehouses, w)}</option>
            ))}
          </select>
        </Field>
      )}
      {note && <p data-build-warehouse-note="" className="text-[11px] text-warning-fg">{note}</p>}
      {warehousesError && <PlainMessage text={`Inspire could not list the SQL warehouses: ${warehousesError}`} after="Type the warehouse id instead."
        onRetry={onWarehousesRetry} copy data-build-warehouse-error="" className="text-[11px] text-warning-fg" />}
      {!note && !warehousesError && state && <p data-build-warehouse-state="" className="text-[11px] text-text-tertiary">{state}</p>}
    </div>
  );
}

function AppWarehouseField({ spec, lakebase, warehouses, warehousesError, onWarehousesRetry, check, onWarehouse, label = '' }) {
  const build = String(spec.config.warehouse_id || '');
  const chosen = appWarehouseOf(spec);
  const listed = warehouses || [];
  const options = warehouseOptions(listed, [build, chosen]);
  return (
    <div data-app-warehouse="pick" className="space-y-0.5">
      <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[12px] font-medium text-text-primary">{label || appWarehouseLabel(appBackendOf(spec, lakebase))}</span>
        <select className="max-w-[16rem] px-2 py-1 text-[12px] border border-border rounded-md bg-surface text-text-primary glow-focus"
          value={chosen} disabled={warehouses === null && !warehousesError}
          onChange={(e) => onWarehouse(e.target.value)}>
          {options.map((w) => (
            <option key={w.id} value={w.id}>{warehouseText(listed, w.id)}{w.id === build ? ' · used for the build' : ''}</option>
          ))}
        </select>
      </label>
      {warehousesError && <PlainMessage text={`Inspire could not list the SQL warehouses: ${warehousesError}`} after={buildWarehouseNote(listed, build)}
        onRetry={onWarehousesRetry} copy data-app-warehouse-error="" className="text-[11px] text-text-tertiary" />}
      {chosen !== build && !warehousesError && <p className="text-[11px] text-text-tertiary">{buildWarehouseNote(listed, build)}</p>}
      {check && !check.ok && <p data-app-warehouse-check="" className="text-[11px] text-error-fg">{check.detail}</p>}
    </div>
  );
}

function AppAccessStep({ spec, onAccess, best = {} }) {
  const access = spec.outputs.app_access;
  const inside = insideInspire(spec);
  return (
    <section className="space-y-4" aria-label="App access">
      <fieldset data-choice="app-access" className="space-y-2">
        <legend className="text-sm font-semibold text-text-primary">{APP_ACCESS_QUESTION}</legend>
        <p className="text-[11px] text-text-tertiary" {...(inside ? { role: 'note', 'aria-label': 'Why each person signs in as themselves' } : {})}>
          {inside ? `${INSIDE_ACCESS_REASON}.` : APP_ACCESS_NOTE}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {APP_ACCESS_CHOICES.map((choice) => {
            const Icon = ACCESS_ICONS[choice.id];
            const checked = access === choice.id;
            const locked = inside && choice.id !== 'user';
            return (
              <label
                key={choice.id}
                aria-disabled={locked ? 'true' : undefined}
                className={`flex items-start gap-2.5 border rounded-lg p-3 glow-focus ${locked ? 'cursor-not-allowed bg-bg-subtle' : 'cursor-pointer'} ${checked ? 'border-db-red bg-db-red-50' : 'border-border hover:border-border-strong'}`}
              >
                <input type="radio" name="app-access" value={choice.id} checked={checked} disabled={locked} onChange={() => onAccess(choice.id)} className="mt-0.5" />
                <span className="space-y-1">
                  <span className="flex items-start gap-1.5 text-sm font-semibold text-text-primary"><Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{choice.label}</span>
                  <span className="block text-[12px] text-text-secondary">{choice.blurb}</span>
                  <Recommended best={best.access} id={choice.id} />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

function AppStorageStep({ spec, lakebase, warehouses, warehousesError, onWarehousesRetry, warehouseCheck, onBackend, onWarehouse, best = {} }) {
  const inside = insideInspire(spec);
  return (
    <section className="space-y-4" aria-label={APP_STORAGE_STEP.label}>
      <AppBackendChoice spec={spec} lakebase={lakebase} onBackend={onBackend} best={best.backend}>
        {inside ? (
          <p data-inside-warehouse="" className="text-[11px] text-text-secondary">
            Each viewer reads with {warehouseText(warehouses, appWarehouseOf(spec))}, picked on Where it lives.
          </p>
        ) : (
          <SettingRow label="SQL warehouse" value={spec.outputs.app_warehouse_id || 'not picked'} changeLabel="App SQL warehouse" defaultOpen={warehouseCheck?.ok === false}>
            <AppWarehouseField spec={spec} lakebase={lakebase} warehouses={warehouses} warehousesError={warehousesError} onWarehousesRetry={onWarehousesRetry} check={warehouseCheck}
              onWarehouse={onWarehouse} />
          </SettingRow>
        )}
      </AppBackendChoice>
    </section>
  );
}

function AppFeaturesStep({ spec, onOption, best = {} }) {
  const access = spec.outputs.app_access;
  const options = spec.outputs.app_options;
  return (
    <section className="space-y-4" aria-label="App features">
      <fieldset className="space-y-2">
        <legend className={LEGEND}>
          What people can do in the App<span className="ms-2 normal-case tracking-normal font-normal text-[11px]">Record decisions starts on; the others stay off unless you turn them on.</span>
        </legend>
        <div data-choice="app-options" data-choice-multi="" className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
          {APP_OPTIONS.filter((o) => appOptionShown(spec, o.id)).map((o) => (
            <div key={o.id}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" value={o.id} className="mt-0.5" checked={Boolean(options[o.id])} onChange={(e) => onOption(o.id, e.target.checked)} />
                <span className="text-[11px] text-text-secondary">
                  <span className="text-[12px] font-medium text-text-primary">{o.label}</span>. {o.blurb} <Recommended best={best.option} id={o.id} />
                </span>
              </label>
              {o.id === 'modify' && appOptionShown(spec, 'replace_edits') && (
                <div role="radiogroup" aria-label={REPLACE_EDITS_QUESTION} data-choice="replace-edits" className="ms-6 mt-2 border-s-2 border-border ps-3 space-y-1">
                  <p className="text-[12px] font-medium text-text-primary">{REPLACE_EDITS_QUESTION}</p>
                  {REPLACE_EDITS_CHOICES.map((c) => (
                    <label key={String(c.id)} className="flex items-start gap-2 text-[11px] cursor-pointer">
                      <input type="radio" name="replace-edits" value={String(c.id)} className="mt-0.5" checked={Boolean(options.replace_edits) === c.id} onChange={() => onOption('replace_edits', c.id)} />
                      <span>
                        <span className="font-medium text-text-primary">{c.label}</span>
                        <span className="text-text-secondary">: {c.blurb}</span> <Recommended best={best.replace} id={c.id} />
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <details className="text-[11px] text-text-secondary">
          <summary className="cursor-pointer select-none font-medium">What every App offers</summary>
          <div className="mt-1 space-y-1">
            {access === 'user' && <p role="note" aria-label="Why some options are hidden">{PER_USER_REASON}</p>}
            <p role="note" aria-label="What every App offers"><span>{APP_REFRESH_NOTE}</span> <span>{APP_NO_DOWNLOADS}</span></p>
          </div>
        </details>
      </fieldset>
    </section>
  );
}

const BARS = [45, 70, 55, 90, 65, 80];

function PreviewBars({ hue = 0 }) {
  return BARS.map((h, i) => <span key={i} className="block flex-1 rounded-t-[1px]" style={{ height: `${h}%`, background: pv(`h${(hue + i) % 3}-line`) }} />);
}

function StylePreview({ style, palette, theme }) {
  const vars = paletteVars(palette, theme);
  if (!vars) return <span aria-hidden="true" className="block h-[68px] rounded-md bg-bg-subtle animate-pulse" />;
  const card = { background: pv('card'), border: `1px solid ${pv('line')}` };
  if (style === 'b') {
    return (
      <span aria-hidden="true" data-preview="style-b" className="flex h-[68px] flex-col gap-1 overflow-hidden rounded-md p-1.5" style={{ ...vars, background: pv('bg') }}>
        <span className="flex items-center justify-between rounded-[6px] px-1.5 py-[3px]" style={{ background: pv('h0-bg'), border: `1px solid ${pv('line')}` }}>
          <span className="text-[9px] font-semibold leading-none" style={{ color: pv('h0-ink') }}>Aa</span>
          <span className="block h-[6px] w-5 rounded-full" style={{ border: `1px solid ${pv('line-strong')}`, background: pv('card') }} />
        </span>
        <span className="grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => <span key={i} className="block h-[12px] rounded-[4px]" style={{ background: pv(`h${i}-bg`), border: `1px solid ${pv('line')}`, borderInlineStart: `3px solid ${pv(`h${i}-line`)}` }} />)}
        </span>
        <span className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px]" style={card}>
          <span className="block h-[5px] shrink-0" style={{ background: pv('h0-bg'), borderBottom: `1px solid ${pv('line')}` }} />
          <span className="flex flex-1 items-end gap-[3px] px-1.5 pb-1"><PreviewBars /></span>
        </span>
      </span>
    );
  }
  if (style === 'c') {
    return (
      <span aria-hidden="true" data-preview="style-c" className="flex h-[68px] flex-col gap-1 overflow-hidden rounded-md p-1.5" style={{ ...vars, background: pv('card'), border: `1px solid ${pv('line')}` }}>
        <span className="text-[13px] font-semibold leading-none" style={{ color: pv('ink'), fontFamily: 'Georgia, "Times New Roman", serif' }}>Aa</span>
        <span className="grid grid-cols-3" style={{ borderTop: `1px solid ${pv('line')}`, borderBottom: `1px solid ${pv('line')}` }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex h-[12px] items-center px-1" style={i ? { borderInlineStart: `1px solid ${pv('line')}` } : undefined}>
              <span className="block h-[5px] w-3/5 rounded-sm" style={{ background: pv(`h${i}-ink`) }} />
            </span>
          ))}
        </span>
        <span className="flex min-h-0 flex-1 items-end gap-[3px] rounded-[6px] px-1.5 pb-1 pt-1" style={{ background: pv('well') }}><PreviewBars /></span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-preview="style-a" className="flex h-[68px] flex-col gap-1 overflow-hidden rounded-md p-1.5" style={{ ...vars, background: pv('bg') }}>
      <span className="text-[9px] font-semibold leading-none" style={{ color: pv('ink') }}>Aa</span>
      <span className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="relative block h-[12px] overflow-hidden rounded-[3px]" style={{ ...card, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
            <span className="absolute left-1 top-[3px] block h-[3px] w-1/2 rounded-sm" style={{ background: pv('muted') }} />
            <span className="absolute bottom-0 left-1 right-1 block h-[2px] rounded-t-sm" style={{ background: pv(`h${i}-line`) }} />
          </span>
        ))}
      </span>
      <span className="flex min-h-0 flex-1 items-end gap-[3px] rounded-[3px] px-1.5 pb-1 pt-1" style={card}><PreviewBars /></span>
    </span>
  );
}

function LayoutPreview({ layout, palette, theme }) {
  const vars = paletteVars(palette, theme);
  if (!vars) return <span aria-hidden="true" className="block h-[52px] rounded-md bg-bg-subtle animate-pulse" />;
  const card = (i) => <span key={i} className="block min-h-0 flex-1 rounded-[3px]" style={{ background: pv('card'), border: `1px solid ${pv('line')}` }} />;
  const frame = { ...vars, background: pv('bg'), border: `1px solid ${pv('line')}` };
  if (layout === 'tabs') {
    return (
      <span aria-hidden="true" data-preview="layout-tabs" className="flex h-[52px] flex-col overflow-hidden rounded-md" style={frame}>
        <span className="flex items-end gap-1.5 px-1.5 pt-1.5" style={{ background: pv('card'), borderBottom: `1px solid ${pv('line')}` }}>
          {[0, 1, 2].map((i) => <span key={i} className="block h-[7px] w-5" style={{ borderBottom: `2px solid ${i ? 'transparent' : pv('brand')}` }}><span className="block h-[3px] w-full rounded-sm" style={{ background: i ? pv('faint') : pv('ink') }} /></span>)}
        </span>
        <span className="flex flex-1 gap-1 p-1.5">{[0, 1].map(card)}</span>
      </span>
    );
  }
  if (layout === 'home') {
    return (
      <span aria-hidden="true" data-preview="layout-home" className="flex h-[52px] flex-col gap-1 overflow-hidden rounded-md p-1.5" style={frame}>
        <span className="block h-[4px] w-1/3 rounded-sm" style={{ background: pv('ink') }} />
        <span className="grid flex-1 grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => <span key={i} className="block rounded-[3px]" style={{ background: pv('card'), border: `1px solid ${pv('line')}`, borderTop: `2px solid ${pv(`h${i}-line`)}` }} />)}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" data-preview="layout-sidebar" className="flex h-[52px] overflow-hidden rounded-md" style={frame}>
      <span className="flex w-[30%] flex-col gap-1 p-1.5" style={{ background: pv('panel'), borderInlineEnd: `1px solid ${pv('line')}` }}>
        {[0, 1, 2].map((i) => <span key={i} className="block h-[5px] rounded-sm" style={i ? { background: pv('line-strong') } : { background: pv('brand-wash'), borderInlineStart: `2px solid ${pv('brand')}` }} />)}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="block h-[4px] w-1/2 rounded-sm" style={{ background: pv('ink') }} />
        <span className="flex flex-1 gap-1">{[0, 1].map(card)}</span>
      </span>
    </span>
  );
}

function LookCard({ name, value, checked, onChange, label, best = null, blurb = '', children }) {
  return (
    <label className={`block border rounded-lg p-2 space-y-1.5 glow-focus cursor-pointer ${checked ? 'border-db-red bg-db-red-50' : 'border-border hover:border-border-strong'}`}>
      {children}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
        <span className="text-[12px] font-semibold text-text-primary">{label}</span>
        <Recommended best={best} id={value} why={false} />
      </span>
      {(blurb || (isBest(best, value) && best.reason)) && (
        <span className="block text-[11px] leading-snug text-text-secondary">{[blurb, isBest(best, value) ? best.reason : ''].filter(Boolean).join(' ')}</span>
      )}
    </label>
  );
}

function AppPagesStep({ spec, look, onPage, view: lookView, onView, open = false, onToggle = null }) {
  const pages = appPagesOf(spec);
  const onPages = pages.filter((p) => p.on).map((p) => p.label);
  const pageId = lookView.page;
  const shownPage = pages.some((p) => p.id === pageId && p.on) ? pageId : 'fix';
  const setPageId = (next) => onView({ ...lookView, page: next });
  const pickable = Array.isArray(look?.chart_kinds) && Array.isArray(look?.screens);
  const perUserAlerts = pages.find((p) => p.id === 'alerts')?.off;
  return (
    <section className="space-y-2" aria-label="App pages">
      <Advanced open={open} onToggle={onToggle} what="App pages" summary={`${onPages.length} pages on: ${onPages.join(', ')}`}>
        <fieldset className="space-y-2">
          <legend className={LEGEND}>Pages</legend>
          <p className="text-[11px] text-text-secondary">{APP_PAGES_NOTE} Pick a page to see it in the App look sample.</p>
          <div role="group" aria-label="Pages of the App" className="grid grid-cols-5 gap-2">
            {pages.map((p) => {
              const locked = Boolean(p.off) || (!pickable && !p.option);
              return (
                <div key={p.id} data-app-page={p.id} className={`rounded-lg border p-2 ${shownPage === p.id ? 'border-db-red bg-db-red-50' : 'border-border'}`}>
                  <button type="button" aria-pressed={shownPage === p.id} disabled={!p.on} onClick={() => setPageId(p.id)}
                    className="block w-full text-start text-[12px] font-semibold text-text-primary disabled:text-text-tertiary glow-focus">
                    {p.label}
                  </button>
                  {p.fixed ? <p className="mt-1 text-[11px] text-text-tertiary">{APP_ALWAYS_ON}</p> : (
                    <label className={`mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary ${locked ? '' : 'cursor-pointer'}`}>
                      <input type="checkbox" role="switch" checked={p.on} disabled={locked} aria-label={`${p.label} page`}
                        onChange={(e) => onPage(p.id, e.target.checked)} />
                      {p.on ? 'On' : 'Off'}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <p data-page-blurb="" className="text-[11px] leading-snug text-text-secondary">{pages.find((p) => p.id === shownPage).blurb}</p>
          {perUserAlerts && <p className="text-[11px] leading-snug text-text-tertiary">Alerts are off: {PER_USER_REASON}</p>}
        </fieldset>
      </Advanced>
    </section>
  );
}

function AppLookStep({ spec, look, lookError, onLookRetry, palette, title, stake, dates = null, onLook, onChart, onInspireCharts, best = {}, view: lookView, onView }) {
  const chosen = spec.outputs.app_look;
  const palettes = look?.palette_colors || [];
  const tab = lookView.tab;
  const setTab = (next) => onView({ ...lookView, tab: next });
  const pageId = lookView.page;
  const pages = appPagesOf(spec);
  const shownPage = pages.some((p) => p.id === pageId && p.on) ? pageId : 'fix';
  const charts = appChartsOf(spec, look, dates);
  const picked = appChartsPicked(spec);
  const pickable = Array.isArray(look?.chart_kinds) && Array.isArray(look?.screens);
  const view = tab === 'charts' ? 'charts' : shownPage;
  const named = (list, id) => list.find((x) => x.id === id)?.label || id;
  const viewLabel = view === 'charts' ? 'Charts' : named(pages, view);
  const sampleLabel = `Sample App page: ${viewLabel}, in ${lookText(chosen)}`;
  const panel = (id) => tabPanel('app-look', id, tab);
  return (
    <section className="space-y-2" aria-label="App look">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">How should the App look?</h3>
        <p className="text-[11px] text-text-tertiary">Each preview draws with the palette and the mode you pick.</p>
        {lookError && <PlainMessage text={`Inspire could not read the App looks from its agent notebook: ${lookError}`} onRetry={onLookRetry} copy data-look-error="" className="text-[11px] text-error-fg" />}
      </div>
      <TabStrip label="App look sections" idBase="app-look" tabs={APP_LOOK_TABS} current={tab} onPick={setTab} />
      <div {...panel('style')}>
        <fieldset className="space-y-2">
          <legend className={LEGEND}>Style</legend>
          <div data-choice="app-style" className="grid grid-cols-3 gap-3 pt-1">
            {APP_STYLES.map((s) => (
              <LookCard key={s.id} name="app-style" value={s.id} checked={chosen.style === s.id} onChange={() => onLook('style', s.id)}
                label={s.label} blurb={s.blurb}>
                <StylePreview style={s.id} palette={palette} theme={chosen.theme} />
              </LookCard>
            ))}
          </div>
          <p className="text-[11px] text-text-secondary">{LAKEVIEW_STYLE_NOTE}</p>
        </fieldset>
      </div>
      <div {...panel('palette')}>
        <div className="grid grid-cols-[1fr_auto] items-start gap-5">
          <fieldset data-choice="app-palette" className="space-y-2">
            <legend className={LEGEND}>Palette</legend>
            <div className="grid grid-cols-7 gap-1.5 pt-1">
              {(palettes.length ? palettes : (look?.palettes || [])).map((p) => {
                const id = typeof p === 'string' ? p : p.id;
                const colors = typeof p === 'string' ? null : p[chosen.theme === 'dark' ? 'dark' : 'light'];
                const checked = chosen.palette === id;
                return (
                  <label key={id} className={`block rounded-md p-1 glow-focus cursor-pointer ${checked ? 'bg-db-red-50 ring-2 ring-db-red' : 'hover:bg-bg-subtle'}`}>
                    <input type="radio" name="app-palette" value={id} className="sr-only" checked={checked} onChange={() => onLook('palette', id)} />
                    <span aria-hidden="true" data-swatch={id} className="flex h-6 gap-px overflow-hidden rounded p-[3px]"
                      style={colors ? { background: colors.base.bg, border: `1px solid ${colors.base['line-strong'] || colors.base.line}` } : undefined}>
                      {colors && Object.values(colors.hues).map((hue, i) => <span key={i} className="block flex-1 rounded-[1px]" style={{ background: hue.line }} />)}
                    </span>
                    <span className="mt-1 block text-center text-[10px] text-text-secondary">{lookLabel('palette', id)}</span>
                  </label>
                );
              })}
              {!look && !lookError && Array.from({ length: 13 }, (_, i) => <span key={i} aria-hidden="true" className="block h-[46px] rounded-md bg-bg-subtle animate-pulse" />)}
            </div>
          </fieldset>
          <fieldset data-choice="app-theme" className="space-y-2">
            <legend className={LEGEND}>Mode</legend>
            <div role="group" aria-label="Light or dark" className="inline-flex rounded-lg border border-border overflow-hidden mt-1">
              {APP_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-option={t.id}
                  aria-pressed={chosen.theme === t.id}
                  onClick={() => onLook('theme', t.id)}
                  className={`px-4 py-1.5 text-xs font-medium border-e border-border last:border-e-0 ${chosen.theme === t.id ? 'bg-db-red-solid text-white' : 'bg-surface text-text-secondary hover:text-text-primary'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      <div {...panel('layout')}>
        <fieldset className="space-y-2">
          <legend className={LEGEND}>Layout</legend>
          <div data-choice="app-layout" className="grid grid-cols-3 gap-3 pt-1">
            {APP_LAYOUTS.map((l) => (
              <LookCard key={l.id} name="app-layout" value={l.id} checked={chosen.layout === l.id} onChange={() => onLook('layout', l.id)} label={l.label} best={best.layout} blurb={l.blurb}>
                <LayoutPreview layout={l.id} palette={palette} theme={chosen.theme} />
              </LookCard>
            ))}
          </div>
        </fieldset>
      </div>
      <div {...panel('charts')}>
        <fieldset className="space-y-2">
          <legend className={LEGEND}>Kinds of chart</legend>
          <p className="text-[11px] text-text-secondary">{APP_CHARTS_NOTE}</p>
          <div className="grid grid-cols-5 gap-2">
            {APP_CHART_KINDS.map((k) => {
              const on = charts.includes(k.id);
              const locked = !pickable || (on && charts.length <= APP_CHARTS_MIN) || (k.id === 'trend' && dates === false);
              return (
                <label key={k.id} data-chart-kind={k.id} className={`block rounded-lg border p-2 ${on ? 'border-db-red bg-db-red-50' : 'border-border'} ${locked ? '' : 'cursor-pointer hover:border-border-strong'}`}>
                  <span className="flex items-start gap-1.5">
                    <input type="checkbox" className="mt-0.5" checked={on} disabled={locked} aria-describedby="app-charts-min"
                      onChange={(e) => onChart(k.id, e.target.checked)} />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-text-primary">{k.label}</span>
                      <span className="block text-[11px] leading-snug text-text-secondary">{k.blurb}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {dates === false && <p data-chart-trend-off="" className="text-[11px] text-text-secondary">{APP_TREND_NO_DATE}</p>}
          <div className="flex items-center gap-3">
            <p id="app-charts-min" className="text-[11px] text-text-tertiary">{picked ? APP_CHARTS_MIN_NOTE : appChartPickText(look, dates)}</p>
            {picked && <button data-draft-change="" type="button" className="text-[11px] font-medium text-db-red-fg glow-focus" onClick={onInspireCharts}>{APP_CHARTS_RESET}</button>}
          </div>
        </fieldset>
      </div>
      <AppSample palette={palette} look={chosen} appName={spec.outputs.app_name || 'Your App'} title={title}
        view={view} shared={spec.outputs.app_access !== 'user'} label={sampleLabel} charts={charts} impact={appScreensOf(spec).impact} stake={stake} />
      <p className="text-[11px] text-text-tertiary">{APP_SAMPLE_NOTE}</p>
    </section>
  );
}

function ValuePicker({ label, values, selected, onLoad, onChange }) {
  const shown = values ? [...new Set([...selected, ...values])] : selected;
  const toggle = (value) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-secondary">{label}</span>
        {!values && <button type="button" className="text-[11px] text-db-red-fg" onClick={onLoad}>Load values</button>}
      </div>
      {values && values.length === 0 && <p className="text-[11px] text-text-tertiary">No values found in this column.</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-40 overflow-y-auto">
        {shown.map((value) => (
          <label key={value} className="flex items-center gap-1 text-[11px]">
            <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
            {value}
          </label>
        ))}
      </div>
      {values && values.length >= VALUE_LIMIT && <p className="text-[11px] text-text-tertiary">Showing the first {VALUE_LIMIT} values.</p>}
    </div>
  );
}

function SourceTableBlocks({ tables, spec, columnsByTable, values, setSpec, loadValues }) {
  const [picked, setPicked] = useState({});
  return (
    <section className="space-y-3" aria-label="Table filters">
      {tables.map((table) => {
        const columns = columnsByTable[table] || [];
        const first = (spec.data.filters || []).find((f) => f.table === table);
        const column = Object.prototype.hasOwnProperty.call(picked, table) ? picked[table] : (first?.column || '');
        const reads = columnsReadOf(spec, table);
        return (
          <div key={table} data-source-table={table} className="border border-border rounded-lg p-3 space-y-3">
            <p className="text-[12px] font-semibold text-text-primary">{table}</p>
            <p data-table-columns="" className="text-[11px] text-text-secondary">
              Columns Inspire reads: {reads.length ? reads.join(', ') : 'Inspire\'s choice, from the use case\'s Genie Code instruction'}
            </p>
            <Field label="Filter rows by column">
              <select aria-label={`Filter rows of ${table} by column`} className={inputCls} value={column}
                onChange={(e) => setPicked((prev) => ({ ...prev, [table]: e.target.value }))}>
                <option value="">Pick a column</option>
                {columns.map((c) => <option key={c.column_name} value={c.column_name}>{c.column_name}</option>)}
              </select>
            </Field>
            {column && (
              <>
                <ValuePicker label="Keep only these values" values={values[`${table}.${column}`]}
                  selected={filterValues(spec, table, column, 'in')} onLoad={() => loadValues(table, column)}
                  onChange={(list) => setSpec((prev) => setFilterValues(prev, table, column, 'in', list))} />
                <ValuePicker label="Leave out these values" values={values[`${table}.${column}`]}
                  selected={filterValues(spec, table, column, 'not in')} onLoad={() => loadValues(table, column)}
                  onChange={(list) => setSpec((prev) => setFilterValues(prev, table, column, 'not in', list))} />
              </>
            )}
          </div>
        );
      })}
      {filterTablesOutside(spec.data.filters, tables).map((table) => (
        <div key={table} data-filters-outside={table} className="border border-border rounded-lg p-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-text-secondary">Row filters on {table}, which is no longer a source table.</p>
          <button type="button" data-draft-change="" className="text-[11px] text-db-red-fg shrink-0" onClick={() => setSpec((prev) => withoutTableFilters(prev, table))}>
            Remove these filters
          </button>
        </div>
      ))}
    </section>
  );
}

function UseCaseDrawer({ title, ucRow, spec, patch, onOwner, onClose }) {
  const facts = [
    ['Who it helps', ucRow.beneficiary || ucRow.Beneficiary],
    ['Sponsor', ucRow.sponsor || ucRow.Sponsor],
    ['Business value', placeholderWords(ucRow.business_value || ucRow['Business Value'])],
  ].filter(([, val]) => val);
  const statement = ucRow.statement || ucRow.Statement;
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[60] bg-black/30 flex justify-end" data-use-case-drawer="">
        <div role="dialog" aria-modal="true" aria-label={`Use case details: ${title}`} className="bg-surface border-s border-border shadow-elevated w-full max-w-md h-full flex flex-col">
          <div className="px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold text-text-primary break-words">{title}</h2>
              {statement && <p className="text-[12px] text-text-secondary">{placeholderWords(statement)}</p>}
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-text-tertiary hover:text-text-primary" aria-label="Close details">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {facts.length > 0 && (
              <dl className="space-y-1 text-[12px]">
                {facts.map(([label, val]) => (
                  <div key={label} className="flex min-w-0 gap-1.5">
                    <dt className="shrink-0 font-semibold text-text-tertiary">{label}:</dt>
                    <dd className="text-text-secondary">{val}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Field label="Goal sentence">
              <textarea dir="auto" className={inputCls} rows={3} value={spec.use_case.goal} onChange={(e) => patch('use_case.goal', e.target.value)} />
            </Field>
            <Field label="Decision owner">
              <input dir="auto" className={inputCls} value={spec.use_case.decision_owner} onChange={(e) => onOwner(e.target.value)} />
            </Field>
            {[0, 1, 2].map((i) => (
              <Field key={i} label={i === 0 ? 'Success measures' : `Measure ${i + 1} (optional)`}>
                <input dir="auto"
                  className={inputCls}
                  value={spec.use_case.success_measures[i] || ''}
                  onChange={(e) => {
                    const next = [...spec.use_case.success_measures];
                    next[i] = e.target.value;
                    patch('use_case.success_measures', next.filter((m, idx) => m || idx < i));
                  }}
                />
              </Field>
            ))}
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

function Overlay({ title, uc, steps, total = steps.length, step, reach = [], done = [], onGo = null, onDetails = null, onClose, onTouch = undefined, children }) {
  const row = uc ? catalogRow(uc, 0) : null;
  const facts = row ? [['Domain', row.domain], ['Subdomain', row.subdomain], ['Technique', row.technique]].filter(([, v]) => v) : [];
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-implement-overlay="">
        <div role="dialog" aria-modal="true" onChangeCapture={onTouch} onClickCapture={onTouch} aria-label={title ? `${START_MVP_LABEL}: ${title}` : START_MVP_LABEL} className="bg-surface border border-border rounded-xl shadow-elevated w-full max-w-6xl max-h-full flex flex-col overflow-hidden">
          <header className="px-6 pt-4 pb-3 border-b border-border space-y-3" data-wizard-header="">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-db-red-fg">{START_MVP_LABEL}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-lg font-semibold leading-snug text-text-primary break-words">{title}</h2>
                  {onDetails && (
                    <button type="button" data-use-case-details-open="" onClick={onDetails} className="text-[12px] font-medium text-db-red-fg hover:underline glow-focus">{USE_CASE_DETAILS_LABEL}</button>
                  )}
                  {facts.length > 0 && (
                    <ul aria-label="About this use case" className="flex flex-wrap gap-1.5">
                      {facts.map(([label, value]) => (
                        <li key={label} className="rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-text-secondary">
                          <span className="text-text-tertiary">{label}</span> <span className="font-medium text-text-primary">{value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button type="button" onClick={onClose} className="shrink-0 text-text-tertiary hover:text-text-primary" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
              {steps.map((item, i) => {
                const label = <>{done[i] && <Check size={11} className="text-success-fg" aria-hidden="true" />}{i + 1}. {item.label}</>;
                return (
                  <li
                    key={item.id}
                    aria-current={i === step ? 'step' : undefined}
                    className={`shrink-0 whitespace-nowrap rounded-full ${i === step ? 'bg-db-red-50 text-db-red-fg font-semibold' : i < step ? 'text-text-primary' : 'text-text-tertiary'}`}
                  >
                    {onGo && i !== step && reach[i] ? (
                      <button type="button" data-step-go={item.id} onClick={() => onGo(item.id)} className="inline-flex items-center gap-1 px-1 py-1 rounded-full hover:underline glow-focus">{label}</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1 py-1" aria-disabled={i === step ? undefined : 'true'}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
            <span className="sr-only">Step {step + 1} of {total}</span>
          </header>
          {children}
        </div>
      </div>
    </BodyPortal>
  );
}
