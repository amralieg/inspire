import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  ExternalLink,
  XCircle,
  ArrowRight,
  Play,
  Search,
  Filter,
  ChevronDown,
  Activity,
  Eye,
  EyeOff,
  Layers,
  Building2,
  BarChart3,
  AlertTriangle,
  ArrowDown,
} from 'lucide-react';
import ResultsPage from './ResultsPage';
import { countEntries, parseStrategicContext, treeDepth } from '../lib/strategyContext';
import { formatDuration } from '../lib/formatWhen';
import { counted } from '../lib/plural';
import { aiSeesAggregates, discoveryTypeOf } from '../lib/discoveryType';
import {
  mergeSteps, monitorFailureChoices, monitorSendText, pollFailure, quietLine, runElapsedMs, runEndedBadly, runFailureText, runStopped, runTitle, viewerLine,
  sessionFailed, sessionFinished, sessionQuietSince, sessionSucceeded, stepCategory,
} from '../lib/monitorState';
import ChoiceList from '../components/ChoiceList';
import { copyText } from '../lib/clipboard';
import { COPIED_SEND_TEXT } from '../lib/plainText';
import { requestHeaders, responseError } from '../lib/apiClient';
import StopRunControl from '../components/StopRunControl';
import RunLogPanel from '../components/RunLogPanel';
import { nameOfUseCase } from '../lib/useCaseFields';
import { nextStepOf, runOutcomeOf } from '../lib/runOutcome';
import { newSessionId, runResultText, runStateText } from '../lib/runState';
import { liveCountText, liveUseCasesOf } from '../lib/liveUseCases';
import { useFollowEnd } from '../lib/followEnd';
import TechnicalDetails, { PlainMessage } from '../components/TechnicalDetails';
import { splitTechnical } from '../lib/plainText';
import { withStartDeadline } from '../lib/startDeadline';

// Run lifecycle phases
const PHASE_PENDING = 'PENDING';
const PHASE_RUNNING = 'RUNNING';
const PHASE_TERMINATED = 'TERMINATED';

// Filter presets
const STATUS_FILTERS = [
  { key: 'all', label: 'All', color: 'text-text-secondary' },
  { key: 'running', label: 'In Progress', color: 'text-info-fg' },
  { key: 'success', label: 'Success', color: 'text-success-fg' },
  { key: 'warning', label: 'Warning', color: 'text-warning-fg' },
  { key: 'error', label: 'Error', color: 'text-error-fg' },
  { key: 'open', label: 'No end recorded', color: 'text-text-secondary' },
];

const MONITOR_NO_PROGRESS = 'Inspire has saved no progress for this run yet. Each step shows here as soon as it is saved.';

export default function MonitorPage({ settings, update, sessionId, runId, launchNotes = [], launchDetails = [], onComplete, onResultsSession, onOpenImplement, onGenerateData, onRunAgain = null }) {
  const { databricksHost, token, warehouseId, inspireDatabase, showcase = '' } = settings;

  // Run-level state
  const [runInfo, setRunInfo] = useState(null);
  const [runReadError, setRunReadError] = useState('');
  const [sent, setSent] = useState('');
  const [again, setAgain] = useState({ busy: false, error: '' });
  const [runPhase, setRunPhase] = useState(PHASE_PENDING);

  // Session/step state
  const [session, setSession] = useState(null);
  const [steps, setSteps] = useState([]);
  const [polling, setPolling] = useState(true);
  const [pollProblem, setPollProblem] = useState(null);
  const failuresRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const lastPollRef = useRef(null);
  const trackedSessionRef = useRef(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [collapsedStages, setCollapsedStages] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Results inline display state
  const [showInlineResults, setShowInlineResults] = useState(false);

  // Live use case preview (extracted from steps during the run)
  const [liveUseCases, setLiveUseCases] = useState([]);

  const apiFetch = useCallback(
    async (url, opts = {}) => {
      const headers = requestHeaders(token, databricksHost, { 'Content-Type': 'application/json', ...opts.headers }, showcase);
      const resp = await fetch(url, { ...opts, headers });
      if (!resp.ok) throw await responseError(resp);
      return resp.json();
    },
    [token, databricksHost, showcase]
  );

  // Main polling loop
  useEffect(() => {
    if (!polling) return;

    const poll = async () => {
      const failed = [];
      await pollOnce(failed);
      if (!failed.length) {
        failuresRef.current = 0;
        setPollProblem(null);
        return;
      }
      failuresRef.current += 1;
      const problem = pollFailure(failed[0], failuresRef.current);
      setPollProblem(problem);
      if (problem.stop) setPolling(false);
    };
    const pollOnce = async (failed) => {
      let currentRunInfo = runInfo;
      let lastRead = false;
      if (runId) {
        try {
          const ri = await apiFetch(`/api/run/${runId}`);
          setRunInfo(ri);
          currentRunInfo = ri;
          const lcs = ri.life_cycle_state || '';
          if (lcs === 'PENDING' || lcs === 'QUEUED' || lcs === 'BLOCKED') {
            setRunPhase(PHASE_PENDING);
          } else if (lcs === 'RUNNING' || lcs === 'TERMINATING') {
            setRunPhase(PHASE_RUNNING);
          } else {
            setRunPhase(PHASE_TERMINATED);
          }
          lastRead = runEndedBadly(ri) || runStopped(ri);
        } catch (e) {
          if (e.status === 403) { setRunReadError(e.message); lastRead = true; }
          else failed.push(e);
        }
      }
      if (lastRead) setPolling(false);
      setNow(Date.now());

      if (warehouseId && inspireDatabase) {
        try {
          const sessQ = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId });
          if (sessionId) sessQ.set('session_id', String(sessionId));
          const sessData = await apiFetch(`/api/inspire/session?${sessQ}`);
          if (sessData.session) {
            const sess = sessData.session;
            const sid = sess.session_id;
            if (trackedSessionRef.current && trackedSessionRef.current !== String(sid)) {
              setSteps([]);
              lastPollRef.current = null;
            }
            trackedSessionRef.current = String(sid);
            setSession(sess);

            try {
              const stepQ = new URLSearchParams({
                inspire_database: inspireDatabase,
                warehouse_id: warehouseId,
                session_id: String(sid),
                ...(lastPollRef.current ? { since: lastPollRef.current } : {}),
              });
              const stepData = await apiFetch(`/api/inspire/steps?${stepQ}`);
              if (stepData.steps?.length > 0) {
                setSteps((prev) => mergeSteps(prev, stepData.steps));
                lastPollRef.current = stepData.steps[stepData.steps.length - 1].last_updated;
              }
            } catch { /* steps table might not exist */ }

            if (sess.processing_status === 'ready' && !showcase) {
              try {
                await apiFetch('/api/inspire/ack', {
                  method: 'POST',
                  body: JSON.stringify({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: sid }),
                });
              } catch { /* silent */ }
            }

            const runDone = !runId || currentRunInfo?.life_cycle_state === 'TERMINATED' || currentRunInfo?.life_cycle_state === 'INTERNAL_ERROR';
            if (runDone && sessionFinished(sess)) setPolling(false);
          }
        } catch (e) {
          failed.push(e);
        }
      } else if (!runId) {
        setPolling(false);
      }
    };

    if (showcase) {
      poll().then(() => setPolling(false));
      return undefined;
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [polling, warehouseId, inspireDatabase, sessionId, runId, apiFetch, showcase]); // eslint-disable-line

  const follow = useFollowEnd(steps.length, autoScroll);

  // ── Derived display state ──
  // When no runId, derive state purely from session data
  const sessionOnly = !runId;
  const isStaleSession = !sessionOnly && session?.completed_on && runPhase !== PHASE_TERMINATED;
  const percent = isStaleSession ? 0 : (session?.completed_percent || 0);
  const outcome = runOutcomeOf(session?.results_json);
  const runFailed = runEndedBadly(runInfo) || (!isStaleSession && sessionFailed(session));
  const isStopped = runStopped(runInfo);
  const quietSince = sessionOnly ? sessionQuietSince(session, now) : null;
  const isQuiet = Boolean(quietSince);
  const finished = sessionOnly
    ? sessionSucceeded(session)
    : (!runFailed && !isStaleSession && runPhase === PHASE_TERMINATED && runInfo?.result_state === 'SUCCESS' && sessionSucceeded(session));
  const cannotRead = Boolean(runReadError) && !session;
  const isFailed = cannotRead || runFailed || (finished && outcome.failed);
  const isComplete = finished && !outcome.failed;
  const isPending = !cannotRead && (sessionOnly ? (!session) : (runPhase === PHASE_PENDING));
  const isRunning = sessionOnly
    ? (Boolean(session) && !isComplete && !isQuiet && !isFailed)
    : (runPhase === PHASE_RUNNING && !isComplete && !isFailed);
  const stepsLive = isPending || isRunning;
  const isWarning = isComplete && outcome.warning;
  const isCleanComplete = isComplete && !isWarning;

  let statusLabel = 'Initializing';
  let statusDetail = '';
  let statusDetails = [];
  if (isPending && sessionOnly) { statusLabel = 'Waiting'; statusDetail = MONITOR_NO_PROGRESS; }
  else if (isPending) { statusLabel = 'Starting'; statusDetail = 'Databricks is starting the run...'; }
  else if (isRunning) { statusLabel = 'Running'; statusDetail = isStaleSession || !session ? 'Inspire is getting ready...' : `${Math.round(percent)}% complete`; }
  else if (isQuiet) { statusLabel = 'Quiet'; statusDetail = quietLine(quietSince, now); }
  else if (isWarning) { statusLabel = 'Completed with a warning'; statusDetail = outcome.message || 'The run finished with a warning.'; }
  else if (isComplete) { statusLabel = 'Completed'; statusDetail = 'Inspire finished this run.'; }
  else if (cannotRead) { statusLabel = 'Cannot read this run'; statusDetail = `Inspire cannot read this run with your sign-in: ${runReadError}`; }
  else if (isFailed) {
    statusLabel = outcome.failed ? outcome.failureTitle : (runEndedBadly(runInfo) && runResultText(runInfo.result_state)) || 'Failed';
    if (outcome.failed && outcome.message) statusDetail = outcome.message;
    else ({ text: statusDetail, details: statusDetails } = runFailureText(runInfo));
  }
  else if (isStopped) { statusLabel = 'Stopped'; statusDetail = 'The run was stopped before it finished and what it already wrote stays, so start a new run on the Start page if you need the rest.'; }
  else if (runPhase === PHASE_TERMINATED && runInfo?.result_state === 'SUCCESS' && !session?.completed_on) { statusLabel = 'Finishing'; statusDetail = 'The run ended. Inspire is saving the use cases...'; }

  const platformMessage = String(runInfo?.state_message || '').trim();
  const platformDetail = isFailed && platformMessage && platformMessage !== String(statusDetail || '').trim() && !statusDetails.includes(platformMessage) ? platformMessage : '';
  const elapsedMs = runElapsedMs(runInfo, now);
  const runAgain = async () => {
    setAgain({ busy: true, error: '' });
    const sid = newSessionId();
    try {
      const data = await withStartDeadline((signal) => apiFetch(`/api/run/${runId}/again`, { method: 'POST', signal, body: JSON.stringify({ session_id: sid }) }), { label: 'The run' });
      setAgain({ busy: false, error: '' });
      onRunAgain(sid, data.run_id, Array.isArray(data.warnings) ? data.warnings : [], Array.isArray(data.warning_details) ? data.warning_details : []);
    } catch (e) {
      setAgain({ busy: false, error: e.message || String(e) });
    }
  };
  const pickFailure = (choice) => {
    setSent('');
    if (choice.id === 'again') {
      if (!again.busy) runAgain();
      return;
    }
    if (choice.id === 'read') {
      setRunReadError('');
      setPolling(true);
      return;
    }
    const text = monitorSendText({ label: statusLabel, detail: statusDetail, details: [...statusDetails, platformDetail], runId, sessionId: session?.session_id || sessionId, runUrl: runInfo?.run_page_url });
    copyText(text).then(() => setSent(COPIED_SEND_TEXT), () => setSent(text));
  };
  const elapsed = elapsedMs ? formatDuration(elapsedMs) : null;

  // Auto-show inline results when pipeline completes
  useEffect(() => {
    if (isComplete) setShowInlineResults(true);
  }, [isComplete]);

  useEffect(() => {
    setLiveUseCases(liveUseCasesOf(steps).map((uc) => ({
      name: uc.Name || '',
      label: nameOfUseCase(uc),
      domain: uc['Business Domain'] || '',
      priority: uc.Priority || '',
      quality: uc.Quality || '',
      id: uc.No || '',
    })));
  }, [steps]);

  // Group steps by stage, applying filters
  const { stages, stageNames, filteredCount, totalCount, statusCounts } = useMemo(() => {
    const stageMap = {};
    const counts = { all: 0, running: 0, success: 0, warning: 0, error: 0, open: 0 };
    let filtered = 0;

    const visibleSteps = isStaleSession ? [] : steps;

    for (const step of visibleSteps) {
      const stage = step.stage_name || 'Pipeline';
      if (!stageMap[stage]) stageMap[stage] = [];

      const cat = stepCategory(step.status, stepsLive);
      counts.all++;
      counts[cat]++;

      // Apply filters
      const matchesStatus = statusFilter === 'all' || cat === statusFilter;
      const matchesStage = stageFilter === 'all' || stage === stageFilter;
      const matchesSearch = !searchQuery ||
        (step.step_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (step.sub_step_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (step.message || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        stage.toLowerCase().includes(searchQuery.toLowerCase());

      if (matchesStatus && matchesStage && matchesSearch) {
        stageMap[stage].push(step);
        filtered++;
      }
    }

    // Remove empty stages after filtering
    const nonEmptyStages = {};
    const names = [];
    for (const [name, stageSteps] of Object.entries(stageMap)) {
      if (stageSteps.length > 0) {
        nonEmptyStages[name] = stageSteps;
        names.push(name);
      } else if (stageFilter === 'all' && statusFilter === 'all' && !searchQuery) {
        // Keep empty stages only when no filters are active (to show all stage headers)
      }
    }

    // Also collect all unique stage names for the filter dropdown
    const allStageNames = [...new Set(visibleSteps.map((s) => s.stage_name || 'Pipeline'))];

    return {
      stages: nonEmptyStages,
      stageNames: allStageNames,
      filteredCount: filtered,
      totalCount: counts.all,
      statusCounts: counts,
    };
  }, [steps, isStaleSession, stepsLive, statusFilter, stageFilter, searchQuery]);

  const hasActiveFilters = statusFilter !== 'all' || stageFilter !== 'all' || searchQuery;

  const toggleStage = (name) => {
    setCollapsedStages((prev) => ({ ...prev, [name]: prev[name] === false ? true : false }));
  };

  // Latest activity — most recent step by timestamp
  const latestStep = useMemo(() => {
    if (steps.length === 0) return null;
    return steps.reduce((a, b) => ((a.last_updated || '') > (b.last_updated || '') ? a : b));
  }, [steps]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* ═══ Page Header ═══ */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-db-red to-db-red-hover flex items-center justify-center shadow-sm">
            <Activity size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Monitor</h1>
            <p className="text-sm text-text-secondary">
              Follow Inspire as it reads your data and writes your use cases.
            </p>
          </div>
        </div>
        {runInfo?.run_page_url && (
          <a
            href={runInfo.run_page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm text-text-secondary border border-border rounded-lg hover:bg-bg-subtle hover:shadow-sm transition-smooth"
          >
            View in Databricks
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>

      {launchNotes.length > 0 && (
        <ul role="note" aria-label="What Inspire changed to start this run" data-testid="launch-notes"
          className="mb-6 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 space-y-1 text-sm text-warning-fg">
          {launchNotes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span className="break-words min-w-0">{note}</span>
            </li>
          ))}
          {launchDetails.length > 0 && (
            <li className="ps-6">
              <TechnicalDetails items={launchDetails} />
            </li>
          )}
        </ul>
      )}

      {/* ═══ Status Card ═══ */}
      <div data-testid="monitor-status" data-status={isWarning ? 'warning' : isCleanComplete ? 'success' : isFailed ? 'failed' : 'active'} className={`border rounded-xl p-5 mb-6 shadow-sm ${
        isWarning ? 'bg-warning-bg border-warning/30' :
        isComplete ? 'bg-success-bg border-success/20' :
        isFailed ? 'bg-error-bg border-error/20' :
        'bg-surface border-border'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <StatusIcon isPending={isPending} isRunning={isRunning} isQuiet={isQuiet} isComplete={isComplete} isWarning={isWarning} isFailed={isFailed} />
            <div>
              <span className={`text-base font-bold ${
                isWarning ? 'text-warning-fg' : isComplete ? 'text-success-fg' : isFailed ? 'text-error-fg' : 'text-text-primary'
              }`}>
                {statusLabel}
              </span>
              {statusDetail && (
                <PlainMessage className={`text-xs mt-0.5 ${
                  isWarning ? 'text-warning-fg' : isComplete ? 'text-success-fg' : isFailed ? 'text-error-fg' : 'text-text-secondary'
                }`} text={statusDetail} {...(isFailed ? { 'data-testid': 'monitor-failure-reason' } : {})} />
              )}
              <TechnicalDetails items={statusDetails} className="mt-1" />
              {pollProblem && (
                <div role="status" data-poll-problem={pollProblem.stop ? 'stopped' : 'checking'} className="mt-1 text-xs text-warning-fg">
                  <PlainMessage text={pollProblem.text} />
                  <TechnicalDetails items={pollProblem.details} />
                  {pollProblem.stop && pollProblem.transient && (
                    <button type="button" onClick={() => { failuresRef.current = 0; setPollProblem(null); setPolling(true); }}
                      className="mt-1 font-semibold underline">Check again</button>
                  )}
                </div>
              )}
              {isComplete && outcome.found > 0 && (
                <p className="text-xs mt-0.5 text-text-secondary" data-testid="monitor-bar-counts">
                  {outcome.found} use case{outcome.found === 1 ? '' : 's'} found, {outcome.meets} {outcome.meets === 1 ? 'meets' : 'meet'} your {outcome.mode || 'quality'} bar
                </p>
              )}
              {isComplete && outcome.emptyTables.length > 0 && (
                <p className="text-xs mt-0.5 text-warning-fg" data-testid="monitor-empty-tables">
                  {outcome.allTablesEmpty ? 'Every table you picked is empty, so no use case can be grounded in rows: '
                    : `${outcome.emptyTables.length === 1 ? 'This table has' : 'These tables have'} no rows yet: `}
                  {outcome.emptyTables.slice(0, 10).join(', ')}
                  {outcome.emptyTables.length > 10 ? ` and ${outcome.emptyTables.length - 10} more` : ''}.{' '}
                  {onGenerateData
                    ? <button type="button" onClick={onGenerateData} className="font-semibold underline">Add sample rows on the Generate data page</button>
                    : 'Add sample rows on the Generate data page'}, then run again.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {elapsed && (
              <div className="flex items-center gap-1.5 text-text-tertiary">
                <Clock size={12} />
                <span className="font-mono">{elapsed}</span>
              </div>
            )}
            {runInfo?.life_cycle_state && (
              <span data-testid="monitor-job-state" className={`px-2.5 py-1 rounded-lg font-medium text-[11px] ${
                isWarning ? 'bg-warning-bg text-warning-fg' :
                isComplete ? 'bg-success-bg text-success-fg' :
                isFailed ? 'bg-error-bg text-error-fg' :
                isStopped ? 'bg-bg-subtle text-text-secondary' :
                isPending ? 'bg-info-bg text-info-fg' :
                'bg-db-red-50 text-db-red-fg'
              }`}>
                Databricks job: {isWarning ? 'Finished with a warning' : runStateText(runInfo.life_cycle_state, runInfo.result_state)}
              </span>
            )}
            {isRunning && (
              <span className="font-mono text-lg font-bold text-db-red-fg">
                {Math.round(percent)}%
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-bg-subtle rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isWarning ? 'bg-warning' :
              isComplete || isStopped ? 'bg-success' :
              isFailed ? 'bg-error' :
              isPending ? 'bg-text-tertiary animate-pulse' :
              isQuiet ? 'bg-text-tertiary' :
              isStaleSession ? 'bg-db-red/40 animate-pulse' :
              'bg-db-red progress-glow'
            }`}
            style={{
              width: isComplete ? '100%' : isPending ? '3%' : isStaleSession ? '15%' : `${Math.max(Math.min(percent, 100), 1)}%`,
            }}
          />
        </div>
        {!showcase && runId && runInfo && (isPending || isRunning) && <StopRunControl runId={runId} business={session?.business_name} apiFetch={apiFetch} />}
        {!showcase && <RunLogPanel inspireDatabase={inspireDatabase} warehouseId={warehouseId} sessionId={session?.session_id || sessionId} apiFetch={apiFetch} />}

        {/* Latest activity line */}
        {latestStep && isRunning && (
          <div className="mt-3 flex items-center gap-2">
            <Activity size={11} className="text-db-red-fg shrink-0 animate-pulse" />
            <p className="text-[11px] text-text-secondary font-mono truncate">
              <span className="text-text-tertiary">{latestStep.stage_name}</span>
              {' → '}
              <span className="text-text-primary font-medium">{latestStep.step_name}</span>
              {latestStep.sub_step_name && (
                <span className="text-text-tertiary">: {latestStep.sub_step_name}</span>
              )}
            </p>
          </div>
        )}
        {runInfo?.run_name && !(latestStep && isRunning) && (
          <p className="text-[11px] text-text-tertiary mt-3" title={runInfo.run_name}>{runTitle(runInfo, session?.business_name)}</p>
        )}
        {viewerLine(runInfo) && (
          <p className="text-xs text-warning-fg mt-3" role="status" data-viewer-note>{viewerLine(runInfo)}</p>
        )}
        <RunSetupSummary widgetValues={session?.widget_values} />
      </div>

      {/* Pending info */}
      {isPending && !sessionOnly && (
        <div className="bg-info-bg border border-info/20 rounded-xl p-5 mb-6 flex items-start gap-3">
          <Clock size={16} className="text-info-fg mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Your run is waiting to start</p>
            <p className="text-xs text-text-secondary mt-1">
              Databricks usually starts it within 1 to 3 minutes.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Detailed Steps (Collapsible Advanced) ═══ */}
      {totalCount > 0 ? (
        <section className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm mb-6">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="w-full flex items-center gap-3 px-5 py-4 text-start hover:bg-bg-subtle/50 transition-smooth"
          >
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center">
              <Layers size={16} className="text-text-secondary" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-bold text-text-primary">Detailed Steps</h2>
              <p className="text-xs text-text-secondary">
                {stageNames.length} stage{stageNames.length !== 1 ? 's' : ''} &middot; {totalCount} step{totalCount !== 1 ? 's' : ''}
                {statusCounts.running > 0 && <> &middot; <span className="text-info-fg font-medium">{statusCounts.running} in progress</span></>}
                {statusCounts.error > 0 && <> &middot; <span className="text-error-fg font-medium">{statusCounts.error} error{statusCounts.error > 1 ? 's' : ''}</span></>}
              </p>
            </div>
            <div className={`transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`}>
              <ChevronDown size={18} className="text-text-tertiary" />
            </div>
          </button>

          {showFilters && (
            <div className="border-t border-border px-5 py-4">
        <div className="flex gap-4">
          {/* ── Left Sidebar: Stages ── */}
          <div className="w-56 shrink-0">
            <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden sticky top-6">
              {/* Sidebar header */}
              <div className="px-4 py-3 border-b border-border bg-gradient-to-b from-db-red-50 to-surface">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-db-red-fg" />
                  <span className="text-xs font-bold text-text-primary">Stages</span>
                </div>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  {stageNames.length} stage{stageNames.length !== 1 ? 's' : ''} &middot; {totalCount} steps
                </p>
              </div>

              {/* Stage list */}
              <div className="p-1.5 space-y-0.5 max-h-[60vh] overflow-y-auto">
                {/* All stages option */}
                <button
                  onClick={() => setStageFilter('all')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-start transition-smooth ${
                    stageFilter === 'all'
                      ? 'bg-db-red-50 border border-db-red/20'
                      : 'hover:bg-bg-subtle border border-transparent'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    stageFilter === 'all' ? 'bg-db-red/10' : 'bg-bg-subtle'
                  }`}>
                    <Layers size={10} className={stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[11px] font-semibold block ${
                      stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-primary'
                    }`}>
                      All Stages
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono ${stageFilter === 'all' ? 'text-db-red-fg' : 'text-text-tertiary'}`}>
                    {totalCount}
                  </span>
                </button>

                {/* Individual stages */}
                {stageNames.map((name) => {
                  const allStageSteps = isStaleSession ? [] : steps.filter((s) => (s.stage_name || 'Pipeline') === name);
                  const done = allStageSteps.filter((s) => isStepDone(s.status)).length;
                  const errors = allStageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'error').length;
                  const running = allStageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'running').length;
                  const active = stageFilter === name;
                  const total = allStageSteps.length;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                  return (
                    <button
                      key={name}
                      onClick={() => setStageFilter(active ? 'all' : name)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-start transition-smooth ${
                        active
                          ? 'bg-db-red-50 border border-db-red/20'
                          : 'hover:bg-bg-subtle border border-transparent'
                      }`}
                    >
                      {/* Status indicator */}
                      {errors > 0 ? (
                        <div className="w-5 h-5 rounded-full bg-error-bg flex items-center justify-center shrink-0 mt-0.5">
                          <XCircle size={10} className="text-error-fg" />
                        </div>
                      ) : running > 0 ? (
                        <div className="w-5 h-5 rounded-full bg-info-bg flex items-center justify-center shrink-0 mt-0.5">
                          <Loader2 size={10} className="animate-spin text-info-fg" />
                        </div>
                      ) : done === total && total > 0 ? (
                        <div className="w-5 h-5 rounded-full bg-success-bg flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle2 size={10} className="text-success-fg" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-bg-subtle flex items-center justify-center shrink-0 mt-0.5">
                          <Clock size={10} className="text-text-tertiary" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <span className={`text-[11px] font-semibold block truncate ${
                          active ? 'text-db-red-fg' : 'text-text-primary'
                        }`}>
                          {name}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 bg-bg rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                errors > 0 ? 'bg-error' : done === total && total > 0 ? 'bg-success' : 'bg-db-red'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-text-tertiary shrink-0">{done}/{total}</span>
                        </div>
                        {errors > 0 && (
                          <span className="text-[10px] text-error-fg font-medium mt-0.5 block">
                            {errors} error{errors > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right: Search/Filters + Steps Timeline ── */}
          <div className="flex-1 min-w-0">
            {/* Filter toolbar */}
            <div className="bg-surface border border-border rounded-xl mb-4 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input dir="auto"
                    type="text"
                    placeholder="Search steps, messages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full ps-9 pe-3 py-1.5 text-xs border border-border rounded-lg bg-bg text-text-primary placeholder:text-text-tertiary focus:border-db-red/30 transition-smooth"
                  />
                </div>

                {/* Status pills */}
                <div className="flex items-center gap-1">
                  {STATUS_FILTERS.map((f) => {
                    const count = statusCounts[f.key] || 0;
                    const active = statusFilter === f.key;
                    if (f.key !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={f.key}
                        onClick={() => setStatusFilter(active ? 'all' : f.key)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-smooth border ${
                          active
                            ? 'border-db-red/30 bg-db-red-50 text-db-red-fg'
                            : 'border-transparent text-text-secondary hover:bg-bg-subtle'
                        }`}
                      >
                        {f.label}
                        <span className={`text-[10px] font-mono ${active ? 'text-db-red-fg' : 'text-text-tertiary'}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Auto-scroll */}
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`p-1.5 rounded-lg transition-smooth border ${
                    autoScroll ? 'border-db-red/20 bg-db-red-50 text-db-red-fg' : 'border-transparent text-text-tertiary hover:bg-bg-subtle'
                  }`}
                  aria-label={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
                >
                  {autoScroll ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>

                {hasActiveFilters && (
                  <button
                    onClick={() => { setSearchQuery(''); setStatusFilter('all'); setStageFilter('all'); }}
                    className="text-[11px] text-db-red-fg hover:underline font-medium shrink-0"
                    aria-label="Clear all filters"
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
                    <span className="font-semibold text-text-primary">{filteredCount}</span> of{' '}
                    <span className="font-semibold text-text-primary">{totalCount}</span> steps
                  </span>
                  {statusFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                      {STATUS_FILTERS.find((f) => f.key === statusFilter)?.label}
                      <button onClick={() => setStatusFilter('all')} aria-label="Remove status filter" className="hover:text-db-red-fg">&times;</button>
                    </span>
                  )}
                  {stageFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                      {stageFilter}
                      <button onClick={() => setStageFilter('all')} aria-label="Remove stage filter" className="hover:text-db-red-fg">&times;</button>
                    </span>
                  )}
                  {searchQuery && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-db-red-50 text-db-red-fg text-[10px] font-medium border border-db-red/20">
                      "{searchQuery}"
                      <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="hover:text-db-red-fg">&times;</button>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Steps list */}
            {Object.keys(stages).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(stages).map(([stageName, stageSteps]) => {
                  const collapsed = collapsedStages[stageName] !== false;
                  const doneCount = stageSteps.filter((s) => isStepDone(s.status)).length;
                  const errorCount = stageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'error').length;
                  const runningCount = stageSteps.filter((s) => stepCategory(s.status, stepsLive) === 'running').length;

                  return (
                    <div key={stageName} className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => toggleStage(stageName)}
                        className="w-full px-4 py-3 border-b border-border bg-panel flex items-center gap-3 hover:bg-bg-subtle transition-smooth text-start"
                      >
                        <div className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
                          <ChevronDown size={14} className="text-text-tertiary" />
                        </div>
                        {errorCount > 0 ? (
                          <div className="w-5 h-5 rounded-full bg-error-bg flex items-center justify-center"><XCircle size={11} className="text-error-fg" /></div>
                        ) : runningCount > 0 ? (
                          <div className="w-5 h-5 rounded-full bg-info-bg flex items-center justify-center"><Loader2 size={11} className="animate-spin text-info-fg" /></div>
                        ) : doneCount === stageSteps.length ? (
                          <div className="w-5 h-5 rounded-full bg-success-bg flex items-center justify-center"><CheckCircle2 size={11} className="text-success-fg" /></div>
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-bg-subtle flex items-center justify-center"><Clock size={11} className="text-text-tertiary" /></div>
                        )}
                        <h3 className="text-xs font-bold text-text-primary flex-1">{stageName}</h3>
                        <div className="flex items-center gap-2">
                          {errorCount > 0 && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-error-bg text-error-fg">
                              {errorCount} error{errorCount > 1 ? 's' : ''}
                            </span>
                          )}
                          <span className="text-[11px] text-text-tertiary font-mono">{doneCount}/{stageSteps.length}</span>
                          <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                errorCount > 0 ? 'bg-error' : doneCount === stageSteps.length ? 'bg-success' : 'bg-db-red'
                              }`}
                              style={{ width: `${stageSteps.length > 0 ? (doneCount / stageSteps.length) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </button>
                      {!collapsed && (
                        <div className="divide-y divide-border-subtle">
                          {stageSteps.map((step) => (
                            <StepRow key={step.step_id} step={step} live={stepsLive} searchQuery={searchQuery} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={follow.ref} data-steps-end="" />
                {follow.unseen && (
                  <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-40 pointer-events-none">
                    <button type="button" onClick={follow.jump} className="pointer-events-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white bg-db-red-solid shadow-lg">
                      <ArrowDown size={12} /> New steps
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl p-8 text-center shadow-sm">
                <Search size={20} className="text-text-tertiary mx-auto mb-3" />
                <p className="text-sm text-text-secondary">No steps match your filters</p>
                <button
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); setStageFilter('all'); }}
                  className="text-xs text-db-red-fg hover:underline mt-2 font-medium"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
          )}
        </section>
      ) : isRunning || isPending ? (
        <div className="bg-surface border border-border rounded-xl p-10 text-center shadow-sm">
          <Loader2 size={24} className="animate-spin text-db-red-fg mx-auto mb-3" />
          <p className="text-sm font-medium text-text-primary">
            {isPending && sessionOnly ? 'No step yet' : isPending ? 'Waiting for the run to start...' : 'Waiting for the first step...'}
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            Each step shows here as Inspire works.
          </p>
        </div>
      ) : null}

      {/* ═══ Live Use Case Preview (during run) ═══ */}
      {!isComplete && liveUseCases.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm mb-6">
          <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-db-red-50 to-surface flex items-center gap-2">
            <BarChart3 size={14} className="text-db-red-fg" />
            <span className="text-xs font-bold text-text-primary">Use Cases Discovered</span>
            <span className="text-[10px] text-text-tertiary ms-auto">
              <span data-testid="live-use-case-count">{liveCountText(liveUseCases.length)}</span>
              {isRunning && <span className="ms-1 inline-block w-1.5 h-1.5 rounded-full bg-db-red animate-pulse" />}
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border">
            {liveUseCases.slice(0, 20).map((uc, i) => {
              const priorityLower = (uc.priority || '').toLowerCase();
              const priBadge = priorityLower.includes('ultra') || priorityLower.includes('very high')
                ? 'text-db-red-fg bg-db-red-50'
                : priorityLower.includes('high')
                  ? 'text-error-fg bg-error-bg'
                  : priorityLower.includes('medium')
                    ? 'text-warning-fg bg-warning-bg'
                    : 'text-text-secondary bg-bg';
              return (
                <div key={uc.id || i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[10px] font-mono text-text-tertiary w-5 shrink-0">
                    {uc.id || `#${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{uc.label || uc.name}</p>
                    {uc.domain && (
                      <p className="text-[10px] text-text-tertiary flex items-center gap-1 mt-0.5">
                        <Building2 size={8} /> {uc.domain}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {uc.quality && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-bg-subtle text-text-secondary">
                        Q: {uc.quality}
                      </span>
                    )}
                    {uc.priority && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${priBadge}`}>
                        {uc.priority}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {liveUseCases.length > 20 && (
            <div className="px-4 py-2 bg-bg border-t border-border text-center">
              <span className="text-[10px] text-text-tertiary font-medium">
                +{liveUseCases.length - 20} more use cases
              </span>
            </div>
          )}
        </div>
      )}

      {/* ═══ Failed State ═══ */}
      {isFailed && (
        <div className="mt-6 bg-error-bg border border-error/20 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <XCircle size={18} className="text-error-fg mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-text-primary">What you can do</p>
              <p className="text-xs text-text-secondary mt-1" data-testid="monitor-failure-next">
                {cannotRead
                  ? 'Ask the person who started this run, or a workspace admin, to give you access to it.'
                  : outcome.failed
                    ? `Next step: ${nextStepOf(outcome)}`
                    : 'Open the run in Databricks to see the full error, fix what it names, then run again.'}
              </p>
              {platformDetail && <TechnicalDetails items={[platformDetail]} className="mt-2" />}
              <div className="mt-3 text-xs" data-testid="monitor-failure-choices">
                <ChoiceList choices={monitorFailureChoices({ cannotRead, runUrl: runInfo?.run_page_url || '', canRunAgain: Boolean(runId && onRunAgain && !showcase && runEndedBadly(runInfo)) })} mark="data-failure-choice" onPick={pickFailure} />
                {again.busy && <p role="status" className="mt-2 text-text-secondary"><Loader2 size={12} className="inline animate-spin me-1" aria-hidden="true" />Starting the run again…</p>}
                {again.error && <PlainMessage text={`Inspire could not run it again: ${again.error}`} copy role="alert" data-run-again-error="" className="mt-2 text-error-fg" />}
                {sent && <p role="status" className="mt-2 text-text-secondary select-all">{sent}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Complete Action ═══ */}
      {isComplete && (
        <div className="mt-6 space-y-4">
          <div className={`${isWarning ? 'bg-warning-bg border-warning/30' : 'bg-success-bg border-success/20'} border rounded-xl p-5 flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${isWarning ? 'bg-warning/10' : 'bg-success/10'} flex items-center justify-center`}>
                {isWarning ? <AlertTriangle size={22} className="text-warning-fg" /> : <CheckCircle2 size={22} className="text-success-fg" />}
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary">{isWarning ? 'Run completed with a warning' : 'Run completed'}</p>
                <p className="text-xs text-text-secondary mt-0.5" data-testid="monitor-complete-detail">
                  The use cases are ready to review.
                  {elapsed && ` The run took ${elapsed}.`}
                  {totalCount > 0 && ` ${counted(totalCount, 'step')} processed.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowInlineResults(!showInlineResults)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-xl transition-smooth border ${
                  showInlineResults
                    ? 'border-db-red/20 bg-db-red-50 text-db-red-fg'
                    : 'border-border bg-surface text-text-secondary hover:bg-bg-subtle'
                }`}
              >
                {showInlineResults ? <EyeOff size={14} /> : <Eye size={14} />}
                {showInlineResults ? 'Hide the use cases' : 'Show the use cases'}
              </button>
              <button
                onClick={onComplete}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-db-red-solid to-db-red-solid-hover text-white text-sm font-bold rounded-xl hover:shadow-md transition-smooth"
              >
                Open in Review
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {/* Inline Results — full ResultsPage embedded */}
          {showInlineResults && (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-surface">
              <div className="px-4 py-3 border-b border-border bg-panel flex items-center gap-2">
                <BarChart3 size={14} className="text-db-red-fg" />
                <span className="text-xs font-bold text-text-primary">Use cases of {runTitle(runInfo, session?.business_name)}</span>
              </div>
              <ResultsPage settings={settings} update={update} sessionId={sessionId} embedded onSessionChange={onResultsSession} onOpenImplement={onOpenImplement} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Sub-components
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function StatusIcon({ isPending, isRunning, isQuiet, isComplete, isWarning, isFailed }) {
  const base = 'w-10 h-10 rounded-xl flex items-center justify-center';
  if (isWarning) return <div className={`${base} bg-warning/10`}><AlertTriangle size={22} className="text-warning-fg" /></div>;
  if (isComplete) return <div className={`${base} bg-success/10`}><CheckCircle2 size={22} className="text-success-fg" /></div>;
  if (isFailed) return <div className={`${base} bg-error/10`}><XCircle size={22} className="text-error-fg" /></div>;
  if (isPending) return <div className={`${base} bg-info/10`}><Clock size={22} className="text-info-fg" /></div>;
  if (isRunning) return <div className={`${base} bg-db-red/10`}><Loader2 size={22} className="animate-spin text-db-red-fg" /></div>;
  if (isQuiet) return <div className={`${base} bg-bg-subtle`}><Clock size={22} className="text-text-tertiary" /></div>;
  return <div className={`${base} bg-bg-subtle`}><Play size={22} className="text-text-tertiary" /></div>;
}

function getStepStyle(category) {
  switch (category) {
    case 'success':
      return { icon: <CheckCircle2 size={14} className="text-success-fg" />, badge: 'bg-success-bg text-success-fg', label: 'Success' };
    case 'running':
      return { icon: <Loader2 size={14} className="animate-spin text-info-fg" />, badge: 'bg-info-bg text-info-fg', label: 'In Progress' };
    case 'warning':
      return { icon: <AlertCircle size={14} className="text-warning-fg" />, badge: 'bg-warning-bg text-warning-fg', label: 'Warning' };
    case 'error':
      return { icon: <XCircle size={14} className="text-error-fg" />, badge: 'bg-error-bg text-error-fg', label: 'Error' };
    default:
      return { icon: <Clock size={14} className="text-text-tertiary" />, badge: 'bg-bg-subtle text-text-secondary', label: 'No end recorded' };
  }
}

function isStepDone(status) {
  return status === 'ended_success' || status === 'ended_warning' || status === 'completed';
}

function highlightMatch(text, query) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-db-red-100 text-db-red-fg rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function StepRow({ step, live, searchQuery }) {
  const style = getStepStyle(stepCategory(step.status, live));
  const [expanded, setExpanded] = useState(false);
  const said = splitTechnical(step.message || '');
  const hasDetails = step.message || step.sub_step_name || (step.result_json && Object.keys(step.result_json).length > 0);

  return (
    <div className="hover:bg-bg-subtle/50 transition-smooth">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {style.icon}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium truncate">
            {highlightMatch(step.step_name || step.sub_step_name || 'Step', searchQuery)}
          </div>
          {step.message && !expanded && (
            <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
              {highlightMatch(said.plain, searchQuery)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {step.progress_increment > 0 && (
            <span className="text-[11px] font-mono text-text-tertiary bg-bg-subtle px-1.5 py-0.5 rounded">
              +{step.progress_increment}%
            </span>
          )}
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
            {style.label}
          </span>
          {hasDetails && (
            <ChevronDown size={12} className={`text-text-tertiary transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-3 ps-11 space-y-1.5">
          {step.sub_step_name && (
            <p className="text-xs text-text-secondary">
              <span className="text-text-tertiary">Sub-step:</span> {step.sub_step_name}
            </p>
          )}
          <PlainMessage text={step.message} className="text-xs text-text-secondary bg-bg-subtle rounded-lg p-2.5 leading-relaxed" />
          {step.result_json && Object.keys(step.result_json).length > 0 && (
            <ResultJsonDisplay resultJson={step.result_json} />
          )}
        </div>
      )}
    </div>
  );
}

function ResultJsonDisplay({ resultJson }) {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const rj = resultJson;
  const prompt = rj.prompt_name || '';

  // Error display
  if (rj.error) {
    return (
      <div className="text-xs bg-error-bg/50 rounded-lg p-2.5 border border-error/10">
        <span className="text-error-fg font-semibold">Error:</span>{' '}
        <PlainMessage as="span" text={rj.error} className="text-text-secondary" />
      </div>
    );
  }

  // Use Case Generation
  if (prompt.endsWith('_USE_CASE_GEN_PROMPT') && Array.isArray(rj.use_cases)) {
    return (
      <div className="text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-success-bg text-success-fg font-semibold text-[10px]">
            {rj.use_cases_count || rj.use_cases.length} use cases
          </span>
          {rj.is_truncated && <span className="px-1.5 py-0.5 rounded bg-warning-bg text-warning-fg text-[10px]">truncated</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          {rj.use_cases.slice(0, 10).map((uc, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-[10px] border border-border">
              {nameOfUseCase(uc) || `#${uc.id}`}
            </span>
          ))}
          {rj.use_cases.length > 10 && (
            <span className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-tertiary text-[10px]">
              +{rj.use_cases.length - 10} more
            </span>
          )}
        </div>
      </div>
    );
  }

  // Scoring
  if (prompt === 'COMBINED_VALUE_QUALITY_SCORE_PROMPT' && Array.isArray(rj.scored_use_cases)) {
    return (
      <div className="text-xs space-y-1.5">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-[10px]">
          {rj.scored_count || rj.scored_use_cases.length} scored
        </span>
        <div className="grid grid-cols-1 gap-0.5 max-h-28 overflow-y-auto">
          {rj.scored_use_cases.slice(0, 8).map((sc, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
              <span className="text-text-primary font-medium truncate flex-1">{nameOfUseCase(sc) || `#${sc.id}`}</span>
              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                ['Ultra High', 'Very High', 'High'].includes(sc.priority) ? 'bg-db-red-50 text-db-red-fg' : 'bg-bg-subtle text-text-secondary'
              }`}>{sc.priority}</span>
              <span className="text-text-tertiary">Q: {sc.quality}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Domain Clustering
  if (prompt === 'DOMAIN_FINDER_PROMPT' && Array.isArray(rj.domains)) {
    return (
      <div className="text-xs space-y-1.5">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-[10px]">
          {rj.domains_count || rj.domains.length} domains
        </span>
        <div className="flex flex-wrap gap-1">
          {rj.domains.map((d, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-bg-subtle text-text-secondary text-[10px] border border-border">
              {d.domain_name} ({(d.use_case_ids || []).length})
            </span>
          ))}
        </div>
      </div>
    );
  }

  // SQL Generation
  if (prompt === 'USE_CASE_SQL_GEN_PROMPT' && rj.sql_preview) {
    return (
      <div className="text-xs space-y-1">
        <span className="px-1.5 py-0.5 rounded bg-info-bg text-info-fg font-semibold text-[10px]">SQL Generated</span>
        <pre className="text-[10px] text-text-secondary bg-bg-subtle rounded p-2 font-mono max-h-20 overflow-hidden">
          {rj.sql_preview.slice(0, 200)}{rj.sql_preview.length > 200 ? '...' : ''}
        </pre>
      </div>
    );
  }

  // Summary
  if (prompt === 'SUMMARY_GEN_PROMPT') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-success-bg text-success-fg font-semibold text-[10px]">Summary generated</span>
        {rj.response_chars && <span className="text-text-tertiary text-[10px]">{rj.response_chars.toLocaleString()} chars</span>}
      </div>
    );
  }

  // Business Context
  if (prompt === 'BUSINESS_CONTEXT_WORKER_PROMPT' && rj.json) {
    const ctx = rj.json;
    return (
      <div className="text-xs space-y-1">
        {ctx.business_context && (
          <p className="text-text-secondary text-[10px] line-clamp-2">{ctx.business_context.slice(0, 200)}</p>
        )}
        {Array.isArray(ctx.strategic_goals) && ctx.strategic_goals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ctx.strategic_goals.map((g, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary text-[10px]">{g}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default: show key metrics as badges
  const metricKeys = ['response_chars', 'rows_count', 'use_cases_count', 'scored_count', 'domains_count', 'batch_rows'];
  const badges = metricKeys.filter((k) => rj[k] != null).map((k) => ({ key: k, val: rj[k] }));
  if (badges.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <span key={b.key} className="px-1.5 py-0.5 rounded bg-bg-subtle text-text-tertiary text-[10px] font-mono">
            {b.key.replace(/_/g, ' ')}: {typeof b.val === 'number' ? b.val.toLocaleString() : b.val}
          </span>
        ))}
      </div>
    );
  }

  return null;
}

function RunSetupSummary({ widgetValues }) {
  const discovery = discoveryTypeOf(widgetValues?.discovery_type) ?? String(widgetValues?.discovery_type || '').trim();
  const strategyText = String(widgetValues?.strategic_context || '').trim();
  if (!discovery && !strategyText) return null;
  const parsed = parseStrategicContext(strategyText);
  let strategy = 'No strategy given, so Inspire uses common business goals';
  if (parsed.mode === 'path') strategy = 'Customer strategy';
  else if (parsed.mode === 'tree') {
    const entries = countEntries(parsed.model.strategy);
    const levels = treeDepth(parsed.model.strategy);
    const priorities = parsed.model.priorities.length;
    strategy = `Strategy: ${entries} entr${entries === 1 ? 'y' : 'ies'}` +
      (levels ? `, ${levels} level${levels === 1 ? '' : 's'}` : '') +
      (priorities ? `, ${priorities} priorit${priorities === 1 ? 'y' : 'ies'}` : '');
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      {discovery && (
        <span className="px-2 py-0.5 rounded-full border border-border bg-bg-subtle text-text-secondary">
          {aiSeesAggregates(discovery) ? `${discovery}: the AI sees the summary figures` : `${discovery}: summary figures kept from the AI`}
        </span>
      )}
      <span className="px-2 py-0.5 rounded-full border border-border bg-bg-subtle text-text-secondary" title={parsed.error || ''}>
        {parsed.error ? 'Strategy could not be read' : strategy}
      </span>
    </div>
  );
}

