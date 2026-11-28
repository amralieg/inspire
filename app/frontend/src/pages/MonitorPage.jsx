import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  ExternalLink,
  XCircle,
  Play,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { countEntries, parseStrategicContext, treeDepth } from '../lib/strategyContext';
import { displayId } from '../../../shared/useCaseId.mjs';
import { formatDuration } from '../lib/formatWhen';
import { counted } from '../lib/plural';
import { aiSeesAggregates, discoveryTypeOf } from '../lib/discoveryType';
import {
  mergeSteps, monitorFailureChoices, runEnded, monitorSendText, pollFailure, quietLine, runElapsedMs, runEndedBadly, runFailureText, runStopped, runTitle, viewerLine,
  sessionFailed, sessionFinished, sessionQuietSince, sessionSucceeded, stepCategory, isUnrecordedRefusal, unrecordedWaitOver,
} from '../lib/monitorState';
import ChoiceList from '../components/ChoiceList';
import { copyText } from '../lib/clipboard';
import { COPIED_SEND_TEXT } from '../lib/plainText';
import { requestHeaders, responseError } from '../lib/apiClient';
import StopRunControl from '../components/StopRunControl';
import RunLogPanel from '../components/RunLogPanel';
import RunStepper from '../components/RunStepper';
import MonitorHero from '../components/monitor/MonitorHero';
import ArrivingNow from '../components/monitor/ArrivingNow';
import ActivityFeed from '../components/monitor/ActivityFeed';
import EveryStepDialog from '../components/monitor/EveryStepDialog';
import StageDurationsDialog from '../components/monitor/StageDurationsDialog';
import { nameOfUseCase } from '../lib/useCaseFields';
import { nextStepOf, runOutcomeOf } from '../lib/runOutcome';
import { qualityBarCountText } from '../lib/qualityBarWording';
import { newSessionId, runResultText, runStateText } from '../lib/runState';
import { liveUseCasesOf } from '../lib/liveUseCases';
import { candidatesWanted, fetchCandidates } from '../lib/candidates';
import MatchMonitorBoxes from '../components/match/MatchMonitorBoxes';
import { useFollowEnd } from '../lib/followEnd';
import TechnicalDetails, { PlainMessage } from '../components/TechnicalDetails';
import BusyNote from '../components/BusyNote';
import { withStartDeadline } from '../lib/startDeadline';
import { aiWording } from '../lib/aiWording';

// Run lifecycle phases
const PHASE_PENDING = 'PENDING';
const PHASE_RUNNING = 'RUNNING';
const PHASE_TERMINATED = 'TERMINATED';

const MONITOR_NO_PROGRESS = 'Inspire has saved no progress for this run yet. Each step shows here as soon as it is saved.';
const MONITOR_NO_RUN_OPEN = 'No run is open here. Start a run or open one from Start to see it here.';

export default function MonitorPage({ settings, sessionId, runId, launchNotes = [], launchDetails = [], onComplete, onGenerateData, onRunAgain = null }) {
  const { databricksHost, token, warehouseId, inspireDatabase, showcase = '' } = settings;

  // Run-level state
  const [runInfo, setRunInfo] = useState(null);
  const [runReadError, setRunReadError] = useState('');
  // The run has no launch record yet (or ever): Monitor waits RUN_RECORD_WAIT_MS before it says so, and shows Starting meanwhile.
  const [recordWaiting, setRecordWaiting] = useState(false);
  const [runUnrecorded, setRunUnrecorded] = useState(false);
  const unrecordedSinceRef = useRef(null);
  const [sent, setSent] = useState('');
  const [again, setAgain] = useState({ busy: false, error: '' });
  const [runPhase, setRunPhase] = useState(PHASE_PENDING);

  // Session/step state
  const [session, setSession] = useState(null);
  const [steps, setSteps] = useState([]);
  const [polling, setPolling] = useState(true);
  const [pollProblem, setPollProblem] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const failuresRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const lastPollRef = useRef(null);
  const trackedSessionRef = useRef(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [collapsedStages, setCollapsedStages] = useState({});
  const [stepsOpen, setStepsOpen] = useState(false);
  const [durationsOpen, setDurationsOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopAllowed, setStopAllowed] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Live use case preview (extracted from steps during the run)
  const [liveUseCases, setLiveUseCases] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const stepsRef = useRef([]);
  stepsRef.current = steps;

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
      setLoaded(true);
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
      let stopWhenNoSession = false;
      let sessionSeen = false;
      if (runId) {
        try {
          const ri = await apiFetch(`/api/run/${runId}`);
          unrecordedSinceRef.current = null;
          setRecordWaiting(false);
          setRunUnrecorded(false);
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
          if (isUnrecordedRefusal(e)) {
            // Not a refusal of access: the run is not in the launch record yet. Starting until the record or the session shows.
            if (unrecordedSinceRef.current == null) unrecordedSinceRef.current = Date.now();
            setRecordWaiting(true);
            if (unrecordedWaitOver(unrecordedSinceRef.current, Date.now())) {
              setRunUnrecorded(true);
              setRunReadError(e.message);
              stopWhenNoSession = true;
            }
          } else if (e.status === 403) { setRunReadError(e.message); lastRead = true; }
          else failed.push(e);
        }
      }
      if (lastRead) setPolling(false);
      setNow(Date.now());

      // Without a session id the App has no run open: asking the App for "the latest session" would show an old completed run (FW1 D5).
      if (warehouseId && inspireDatabase && sessionId) {
        try {
          const sessQ = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
          const sessData = await apiFetch(`/api/inspire/session?${sessQ}`);
          if (sessData.session) {
            const sess = sessData.session;
            sessionSeen = true;
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

            // REQ-581 U3: provisional cards for the candidates the run has made eligible; only while the run is live.
            if (!showcase && !sessionFinished(sess) && candidatesWanted(stepsRef.current)) {
              try { setCandidates(await fetchCandidates(apiFetch, { inspireDatabase, warehouseId, sessionId: sid })); } catch { /* no candidate table or route yet */ }
            } else if (sessionFinished(sess)) setCandidates([]);

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
      // An unrecorded run keeps polling for its session; once the wait is over and no session exists, polling stops until Check again.
      if (stopWhenNoSession && !sessionSeen) setPolling(false);
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
  const noRunOpen = !sessionId && !runId;
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
  // A session row exists only once the run's notebook has started, so a session shows the run as running even before its launch record does.
  const phase = recordWaiting && session ? PHASE_RUNNING : runPhase;
  const isFailed = cannotRead || runFailed || (finished && outcome.failed);
  const isComplete = finished && !outcome.failed;
  const isPending = !cannotRead && (sessionOnly ? (!session) : (phase === PHASE_PENDING));
  const isRunning = sessionOnly
    ? (Boolean(session) && !isComplete && !isQuiet && !isFailed)
    : (phase === PHASE_RUNNING && !isComplete && !isFailed);
  const stepsLive = isPending || isRunning;
  const isWarning = isComplete && outcome.warning;
  const isCleanComplete = isComplete && !isWarning;

  let statusLabel = 'Initializing';
  let statusDetail = '';
  let statusDetails = [];
  if (noRunOpen) { statusLabel = 'No run open'; statusDetail = MONITOR_NO_RUN_OPEN; }
  // busy-ok: before the first poll returns the run is pending, so StatusIcon spins
  else if (!loaded && !session && !runInfo) { statusLabel = 'Loading'; statusDetail = 'Loading the run...'; }
  else if (isPending && sessionOnly) { statusLabel = 'Waiting'; statusDetail = MONITOR_NO_PROGRESS; }
  else if (isPending) { statusLabel = 'Starting'; statusDetail = 'Databricks is starting the run...'; }
  else if (isRunning) { statusLabel = 'Running'; statusDetail = isStaleSession || !session ? 'Inspire is getting ready...' : `${Math.round(percent)}% complete`; }
  else if (isQuiet) { statusLabel = 'Quiet'; statusDetail = quietLine(quietSince, now); }
  else if (isWarning) { statusLabel = 'Completed with a warning'; statusDetail = outcome.message || 'The run finished with a warning.'; }
  else if (isComplete) { statusLabel = 'Completed'; statusDetail = 'Inspire finished this run.'; }
  else if (cannotRead && runUnrecorded) { statusLabel = 'No record of this run'; statusDetail = runReadError; }
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
      setRunUnrecorded(false);
      unrecordedSinceRef.current = null;
      setPolling(true);
      return;
    }
    const text = monitorSendText({ label: statusLabel, detail: statusDetail, details: [...statusDetails, platformDetail], runId, sessionId: session?.session_id || sessionId, runUrl: runInfo?.run_page_url });
    copyText(text).then(() => setSent(COPIED_SEND_TEXT), () => setSent(text));
  };
  const elapsed = elapsedMs ? formatDuration(elapsedMs) : null;

  useEffect(() => {
    setLiveUseCases(liveUseCasesOf(steps).map((uc) => ({
      name: uc.Name || '',
      label: nameOfUseCase(uc),
      domain: uc['Business Domain'] || '',
      priority: uc.Priority || '',
      quality: uc.Quality || '',
      id: displayId(uc.No || ''),
    })));
  }, [steps]);

  // Group steps by stage, applying filters
  const { stages, stageNames, filteredCount, totalCount, statusCounts } = useMemo(() => {
    const stageMap = {};
    const counts = { all: 0, running: 0, success: 0, warning: 0, error: 0, skipped: 0, open: 0 };
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
        // A person types what they read, so "Databricks AI" finds a step stored under the old name; the stored name still matches too.
        [step.step_name, step.sub_step_name, step.message, stage].some((t) => [String(t || ''), aiWording(t)].some((x) => x.toLowerCase().includes(searchQuery.toLowerCase())));

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

  // REQ-511: the hero state, its one primary, and the More entries.
  const offline = Boolean(pollProblem?.transient);
  const heroState = !loaded && !noRunOpen ? 'loading' : isFailed ? 'failed' : isComplete ? 'done' : offline ? 'offline' : 'running';
  const canRunAgain = Boolean(runId && onRunAgain && !showcase);
  const recheck = () => { failuresRef.current = 0; setPollProblem(null); setPolling(true); };
  let heroPrimary = null;
  if (isComplete) heroPrimary = { label: 'Open in Review', onClick: onComplete };
  else if (isFailed && canRunAgain && runEndedBadly(runInfo)) heroPrimary = { label: 'Run again', onClick: runAgain, busy: again.busy };
  else if (pollProblem?.stop && offline && !isFailed) heroPrimary = { label: 'Check again', onClick: recheck };
  const menuItems = [];
  if (!showcase && runId && runInfo && (isPending || isRunning) && stopAllowed) menuItems.push({ label: 'Stop this run', onSelect: () => setStopOpen(true) });
  if (!showcase) menuItems.push({ label: 'Run log', onSelect: () => setLogOpen(true) });
  if (totalCount > 0) menuItems.push({ label: 'Stage durations', onSelect: () => setDurationsOpen(true) });
  if (runInfo?.run_page_url) menuItems.push({ label: 'Notebook output', onSelect: () => window.open(runInfo.run_page_url, '_blank', 'noopener') });
  if (isComplete && canRunAgain) menuItems.push({ label: 'Start a new run', onSelect: () => { if (!again.busy) runAgain(); } });

  return (
    <div className="w-full">
      <MonitorHero state={heroState} subtitle="Follow Inspire as it reads your data and writes your use cases." primary={heroPrimary} menuItems={menuItems}>
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

      {!noRunOpen && <RunStepper steps={steps} ended={runEnded(runInfo) || isComplete || isFailed} failed={isFailed} />}

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
              {runInfo?.started_by && <p data-started-by="" className="mt-0.5 text-xs text-text-tertiary">Started by {runInfo.started_by}</p>}
              {heroState === 'offline' && <p className="mt-1 text-xs text-warning-fg" data-offline-note="">Databricks is not answering right now. Inspire keeps the use cases it already has on screen.</p>}
              {pollProblem && (
                <div role="status" data-poll-problem={pollProblem.stop ? 'stopped' : 'checking'} className="mt-1 text-xs text-warning-fg">
                  <PlainMessage text={pollProblem.text} />
                  <TechnicalDetails items={pollProblem.details} />
                </div>
              )}
              {isComplete && (
                <p className="text-xs mt-0.5 text-text-secondary" data-testid="monitor-complete-detail">
                  The use cases are ready to review.
                  {elapsed && ` The run took ${elapsed}.`}
                  {totalCount > 0 && ` ${counted(totalCount, 'step')} processed.`}
                </p>
              )}
              {isComplete && outcome.found > 0 && (
                <p className="text-xs mt-0.5 text-text-secondary" data-testid="monitor-bar-counts">
                  {qualityBarCountText(outcome.found, outcome.meets, outcome.mode)}
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
                <Clock size={14} />
                <span className="font-mono">{elapsed}</span>
              </div>
            )}
            {runInfo?.life_cycle_state && (
              <span data-testid="monitor-job-state" className={`px-2.5 py-1 rounded-lg font-medium text-caption ${
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
        <div role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={isComplete ? 100 : Math.round(Math.min(percent, 100))} className="h-2.5 bg-bg-subtle rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
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
        {!showcase && runId && runInfo && (isPending || isRunning) && (
          <StopRunControl runId={runId} business={session?.business_name} apiFetch={apiFetch} open={stopOpen} onClose={() => setStopOpen(false)} onVerdict={setStopAllowed} />
        )}
        {!showcase && <RunLogPanel inspireDatabase={inspireDatabase} warehouseId={warehouseId} sessionId={session?.session_id || sessionId} apiFetch={apiFetch} open={logOpen} onOpenChange={setLogOpen}
          fallbackText={(steps || []).map((r) => [r.last_updated, aiWording(r.stage_name), aiWording(r.message)].filter(Boolean).join('  ')).join('\n')} />}

        {/* Latest activity line */}
        {latestStep && isRunning && (
          <div className="mt-3 flex items-center gap-2">
            <Activity size={14} className="text-db-red-fg shrink-0 animate-pulse" />
            <p className="text-caption text-text-secondary font-mono truncate">
              <span className="text-text-tertiary">{aiWording(latestStep.stage_name)}</span>
              {' → '}
              <span className="text-text-primary font-medium">{aiWording(latestStep.step_name)}</span>
              {latestStep.sub_step_name && (
                <span className="text-text-tertiary">: {aiWording(latestStep.sub_step_name)}</span>
              )}
            </p>
          </div>
        )}
        {runInfo?.run_name && !(latestStep && isRunning) && (
          <p className="text-caption text-text-tertiary mt-3" title={runInfo.run_name}>{runTitle(runInfo, session?.business_name)}</p>
        )}
        {viewerLine(runInfo) && (
          <p className="text-xs text-warning-fg mt-3" role="status" data-viewer-note>{viewerLine(runInfo)}</p>
        )}
        <RunSetupSummary widgetValues={session?.widget_values} />
      </div>

      {again.error && !isFailed && <PlainMessage text={`Inspire could not run it again: ${again.error}`} securable="workspace" copy role="alert" data-run-again-error="" className="mb-6 text-xs text-error-fg" />}
      </MonitorHero>

      {/* ═══ Failed State ═══ */}
      {isFailed && (
        <div className="mt-6 bg-error-bg border border-error/20 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="text-error-fg mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-text-primary">What you can do</p>
              <p className="text-xs text-text-secondary mt-1" data-testid="monitor-failure-next">
                {cannotRead && runUnrecorded
                  ? 'Inspire has no record of this run, so it cannot show it here. Open the run in Databricks to see its state.'
                  : cannotRead
                  ? 'Ask the person who started this run, or a workspace admin, to give you access to it.'
                  : outcome.failed
                    ? `Next step: ${nextStepOf(outcome)}`
                    : 'Open the run in Databricks to see the full error, fix what it names, then run again.'}
              </p>
              {platformDetail && <TechnicalDetails items={[platformDetail]} className="mt-2" />}
              <div className="mt-3 text-xs" data-testid="monitor-failure-choices">
                <ChoiceList choices={monitorFailureChoices({ cannotRead, unrecorded: runUnrecorded, runUrl: runInfo?.run_page_url || '', canRunAgain: Boolean(runId && onRunAgain && !showcase && runEndedBadly(runInfo)) })} mark="data-failure-choice" onPick={pickFailure} />
                {again.busy && <p role="status" className="mt-2 text-text-secondary"><Loader2 size={14} className="inline animate-spin me-1" aria-hidden="true" />Starting the run again…</p>}
                {again.error && <PlainMessage text={`Inspire could not run it again: ${again.error}`} securable="workspace" copy role="alert" data-run-again-error="" className="mt-2 text-error-fg" />}
                {sent && <p role="status" className="mt-2 text-text-secondary select-all">{sent}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* c33 (REQ-579): a Match run shows its input use cases and their match status; lane C owns the component. */}
      {sessionId && !showcase && <MatchMonitorBoxes settings={settings} sessionId={sessionId} runId={runId} apiFetch={apiFetch} steps={steps} />}
      {(totalCount > 0 || isRunning || isPending) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <ArrivingNow useCases={liveUseCases} live={isRunning} candidates={candidates}
            empty={<BusyNote inline text={isPending && sessionOnly ? 'No step yet. Use cases show here as Inspire writes them.' : isPending ? 'Waiting for the run to start. Use cases show here as Inspire writes them.' : 'Waiting for the first step. Use cases show here as Inspire writes them.'} />} />
          <aside className="min-w-0 space-y-4">
            <ActivityFeed steps={isStaleSession ? [] : steps} live={stepsLive} />
            {totalCount > 0 && (
              <button type="button" onClick={() => setStepsOpen(true)} aria-haspopup="dialog"
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-start shadow-sm hover:bg-bg-subtle/50 transition-smooth">
                <Layers size={16} className="shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-primary">Every step</span>
                  <span className="block text-xs text-text-secondary">
                    {stageNames.length} stage{stageNames.length !== 1 ? 's' : ''} &middot; {totalCount} step{totalCount !== 1 ? 's' : ''}
                    {statusCounts.running > 0 && <> &middot; <span className="text-info-fg font-medium">{statusCounts.running} in progress</span></>}
                    {statusCounts.error > 0 && <> &middot; <span className="text-error-fg font-medium">{statusCounts.error} error{statusCounts.error > 1 ? 's' : ''}</span></>}
                  </span>
                </span>
              </button>
            )}
          </aside>
        </div>
      )}

      {stepsOpen && (
        <EveryStepDialog onClose={() => setStepsOpen(false)} steps={steps} stages={stages} stageNames={stageNames} totalCount={totalCount}
          filteredCount={filteredCount} statusCounts={statusCounts} isStaleSession={isStaleSession} stepsLive={stepsLive}
          stageFilter={stageFilter} setStageFilter={setStageFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery} autoScroll={autoScroll} setAutoScroll={setAutoScroll}
          collapsedStages={collapsedStages} toggleStage={toggleStage} hasActiveFilters={hasActiveFilters} follow={follow} />
      )}
      {durationsOpen && <StageDurationsDialog steps={isStaleSession ? [] : steps} elapsed={elapsed} onClose={() => setDurationsOpen(false)} />}
    </div>
  );
}


/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Sub-components
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function StatusIcon({ isPending, isRunning, isQuiet, isComplete, isWarning, isFailed }) {
  const base = 'w-10 h-10 rounded-xl flex items-center justify-center';
  if (isWarning) return <div className={`${base} bg-warning/10`}><AlertTriangle size={24} className="text-warning-fg" /></div>;
  if (isComplete) return <div className={`${base} bg-success/10`}><CheckCircle2 size={24} className="text-success-fg" /></div>;
  if (isFailed) return <div className={`${base} bg-error/10`}><XCircle size={24} className="text-error-fg" /></div>;
  if (isPending) return <div className={`${base} bg-info/10`}><Loader2 size={24} className="animate-spin text-info-fg" /></div>;
  if (isRunning) return <div className={`${base} bg-db-red/10`}><Loader2 size={24} className="animate-spin text-db-red-fg" /></div>;
  if (isQuiet) return <div className={`${base} bg-bg-subtle`}><Clock size={24} className="text-text-tertiary" /></div>;
  return <div className={`${base} bg-bg-subtle`}><Play size={24} className="text-text-tertiary" /></div>;
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
    <div className="mt-3 flex flex-wrap items-center gap-2 text-caption">
      {discovery && (
        <span className="px-2 py-0.5 rounded-full border border-border bg-bg-subtle text-text-secondary">
          {aiSeesAggregates(discovery) ? 'Discovery: the AI sees the summary figures' : 'Discovery: summary figures kept from the AI'}
        </span>
      )}
      <span className="px-2 py-0.5 rounded-full border border-border bg-bg-subtle text-text-secondary" title={parsed.error || ''}>
        {parsed.error ? 'Strategy could not be read' : strategy}
      </span>
    </div>
  );
}

