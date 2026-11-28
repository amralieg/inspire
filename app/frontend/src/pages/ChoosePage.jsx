import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { Rocket, BarChart3, Loader2, AlertCircle, Clock, CheckCircle2, ArrowRight, ChevronRight, ChevronDown, ChevronUp, Eye, Target, FileText, Sparkles, X, Search } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import MoreMenu from '../components/ui/MoreMenu';
import Button from '../components/ui/Button';
import SessionSparkline from '../components/SessionSparkline';
import MagneticButton from '../components/MagneticButton';
import { SkeletonCard } from '../components/SkeletonLoader';
import LatestRunBadge from '../components/LatestRunBadge';
import PortfolioCards, { usePortfolio } from '../components/PortfolioCards';
import { AllRunsValuePanel, RunValueLine } from '../components/ValueTotalsPanel';
import { valueQuery } from '../lib/valueLedger';
import ValueDisclaimer from '../components/ValueDisclaimer';
import { anyRunValue } from '../lib/valueFooter';
import { useValueRead } from '../lib/useValueLedger';
import { makeApiFetch, requestHeaders, responseError } from '../lib/apiClient';
import { saveBlob } from '../lib/download';
import { profileFileName, profileFileText } from '../lib/businessProfiles';
import { buildFilterOf, portfolioCard, runAverageScore, runCounts, runLabel, runFilterText, runSearchHit, runsOfCard } from '../lib/reviewFigures';
import { sessionCountsLine, sessionStatus } from '../lib/monitorState';
import { compareUseCaseRank, computeHighPriorityCount, nameOfUseCase, qualityBarCountsOf } from '../lib/useCaseFields';
import { PlainMessage } from '../components/TechnicalDetails';
import InspireScoreBadge from '../components/InspireScoreBadge';
import RunCountChips from '../components/RunCountChips';
import StartWizard from '../components/startWizard/StartWizard';
import { usePlanAdvance } from '../lib/wizPlanClient';
import { START_NEW_DISCOVERY } from '../lib/startWizard';

const RUNS_ERROR_TEXT = 'Inspire could not load your runs, and you can still start a new one';

const STATUS_CONFIG = {
  finished: { label: 'Completed', bg: 'bg-success-bg', text: 'text-success-fg', dot: 'bg-success' },
  failed:   { label: 'Failed', bg: 'bg-error-bg', text: 'text-error-fg', dot: 'bg-error' },
  running:  { label: 'In Progress', bg: 'bg-info-bg', text: 'text-info-fg', dot: 'bg-info' },
  starting: { label: 'Starting', bg: 'bg-info-bg', text: 'text-info-fg', dot: 'bg-info' },
  quiet:    { label: 'No news', bg: 'bg-bg-subtle', text: 'text-text-secondary', dot: 'bg-text-tertiary' },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.max(1, Math.round(diffMs / 60000))}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCompletedDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


function getSessionSummary(session) {
  const rj = session.results_json;
  if (!rj) return null;
  // Extract all use cases from results_json
  let useCases = [];
  const domains = new Set();
  if (Array.isArray(rj.domains)) {
    for (const d of rj.domains) {
      if (d.domain_name) domains.add(d.domain_name);
      if (Array.isArray(d.use_cases)) useCases.push(...d.use_cases);
    }
  } else if (Array.isArray(rj.use_cases)) {
    useCases = rj.use_cases;
    for (const uc of useCases) {
      const dom = uc['Business Domain'] || uc.domain || '';
      if (dom) domains.add(dom);
    }
  } else if (Array.isArray(rj)) {
    useCases = rj;
    for (const uc of useCases) {
      const dom = uc['Business Domain'] || uc.domain || '';
      if (dom) domains.add(dom);
    }
  }
  if (useCases.length === 0) return null;
  const { meets, below } = qualityBarCountsOf(useCases);
  return { total: useCases.length, high: computeHighPriorityCount(useCases), meets, below, domains: domains.size, domainNames: [...domains], useCases };
}

function DemoRow({ demo, onDemo }) {
  const name = demo.title || demo.business || 'Demo';
  return (
    <div data-run="demo" className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-border bg-bg-subtle/40 px-5 py-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span data-run-demo-badge="" className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Demo</span>
          <span className="truncate text-sm font-semibold text-text-primary">{name}</span>
        </div>
        {demo.summary && <p className="text-xs text-text-secondary">{demo.summary}</p>}
      </div>
      {onDemo && <Button variant="secondary" size="sm" onClick={onDemo}><Eye size={14} aria-hidden /> Open the demo</Button>}
    </div>
  );
}

/** Full quick-view shape from __inspire_usecases API rows */
function buildSummaryFromUclist(ucs) {
  if (!ucs || !ucs.length) return null;
  const domainNames = [
    ...new Set(
      ucs
        .map((u) => u._domain || u['Business Domain'] || u.business_domain || '')
        .filter(Boolean)
    ),
  ];
  return {
    total: ucs.length,
    high: computeHighPriorityCount(ucs),
    meets: qualityBarCountsOf(ucs).meets,
    domains: domainNames.length,
    domainNames,
    useCases: ucs,
  };
}

/**
 * Per-session overview for list cards: uses `usecase_overview` from GET /api/inspire/sessions
 * (results_json is omitted on that endpoint), then falls back to embedded results_json if present.
 */
function getListRowOverview(session) {
  const api = session.usecase_overview;
  if (api && typeof api === 'object' && api.error) return { error: String(api.error), total: 0, previewTitles: [] };
  const fromApi = api && typeof api === 'object' && typeof api.total === 'number';
  if (fromApi && api.total > 0) {
    const meets = api.meets == null ? null : Number(api.meets) || 0;
    return {
      total: api.total,
      high: api.high == null ? null : Number(api.high) || 0,
      meets,
      below: api.below != null ? Number(api.below) || 0 : meets == null ? null : Math.max(0, api.total - meets),
      domains: api.domains == null ? null : Number(api.domains) || 0,
      unread: api.unread && typeof api.unread === 'object' ? api.unread : {},
      previewTitles: Array.isArray(api.preview_use_cases) ? api.preview_use_cases.map(nameOfUseCase).filter(Boolean) : [],
      avgScore: runAverageScore(api),
      searchTitles: Array.isArray(api.use_case_titles) ? api.use_case_titles : [],
    };
  }
  const legacy = getSessionSummary(session);
  if (legacy) {
    const previewTitles = [...legacy.useCases]
      .sort(compareUseCaseRank)
      .slice(0, 4)
      .map((uc) => nameOfUseCase(uc) || uc.usecase || '')
      .filter(Boolean);
    return {
      total: legacy.total,
      high: legacy.high,
      meets: legacy.meets,
      below: legacy.below,
      domains: legacy.domains,
      unread: {},
      previewTitles,
      avgScore: runAverageScore(null, legacy.useCases),
      searchTitles: legacy.useCases.map((uc) => nameOfUseCase(uc) || uc.usecase || '').filter(Boolean),
    };
  }
  if (fromApi) return { total: 0, unread: {}, previewTitles: [] };
  return null;
}

export default function ChoosePage({ settings, update, onNoData, onDemo, demo = null, onLaunched, onViewResults, onOpenBuild }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { token, databricksHost, warehouseId, inspireDatabase, showcase = '' } = settings;
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [runFilter, setRunFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showValue, setShowValue] = useState(false);
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  usePlanAdvance(apiFetch, { inspireDatabase, warehouseId });
  const { portfolio, error: portfolioError } = usePortfolio(apiFetch, inspireDatabase, warehouseId);
  const valueReady = Boolean(inspireDatabase && warehouseId);
  // FX-34 (REQ-448, W16 D2/D3): one read, the run value of every run and of all runs; the panel, its bars and the run cards render it.
  const allTotals = useValueRead(apiFetch, valueReady ? `/api/inspire/value/totals?${valueQuery(inspireDatabase, warehouseId)}` : '');
  const runValueOf = (sid) => (allTotals?.runs || []).find((r) => String(r.session_id) === sid)?.run_value || null;
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [expandedQuickView, setExpandedQuickView] = useState(null);
  const [quickViewUcsBySession, setQuickViewUcsBySession] = useState({});
  const [quickViewLoadingSid, setQuickViewLoadingSid] = useState(null);
  const [profileError, setProfileError] = useState(null);

  // Download profile (REQ-366): the profile a run was started with, saved as inspire_profile_<name>.json.
  const downloadProfile = useCallback(async (profileId, sessionId) => {
    setProfileError(null);
    try {
      const resp = await fetch(`/api/inspire/profiles/${encodeURIComponent(profileId)}`, { headers: requestHeaders(token, databricksHost, {}, showcase) });
      // A refused read raises the Permission Required dialog (REQ-313); the dialog then shows the reason, so no second message appears here (REQ-220).
      if (!resp.ok) throw await responseError(resp);
      const { profile } = await resp.json();
      saveBlob(new Blob([profileFileText(profile)], { type: 'application/json' }), profileFileName(profile.name));
    } catch (e) {
      if (!e.dialog) setProfileError({ sessionId: String(sessionId), message: e.message });
    }
  }, [token, databricksHost, showcase]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!inspireDatabase || !warehouseId || showcase) return;
    setDeleting(sessionId);
    try {
      const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
      const resp = await fetch(`/api/inspire/session?${q}`, { method: 'DELETE', headers: requestHeaders(token, databricksHost) });
      const refused = resp.ok ? null : await responseError(resp.clone());
      if (resp.ok) {
        setSessions(prev => prev.filter(s => s.session_id !== sessionId));
        setDeleteError(null);
      } else if (!refused.dialog) {
        const data = await resp.json().catch(() => ({}));
        setDeleteError({ sessionId, message: data.error || `Inspire could not delete session ${sessionId}.` });
      }
    } catch (e) {
      setDeleteError({ sessionId, message: e.message || `Inspire could not delete session ${sessionId}.` });
    }
    setDeleting(null);
    setConfirmDelete(null);
  }, [token, databricksHost, warehouseId, inspireDatabase, showcase]);

  const fetchUcsForQuickView = useCallback(
    async (sessionId) => {
      const sid = String(sessionId);
      if (!inspireDatabase || !warehouseId) return;
      setQuickViewLoadingSid(sid);
      try {
        const q = new URLSearchParams({
          inspire_database: inspireDatabase,
          warehouse_id: warehouseId,
          session_id: sid,
        });
        const resp = await fetch(`/api/inspire/usecases?${q}`, { headers: requestHeaders(token, databricksHost, {}, showcase) });
        if (!resp.ok) await responseError(resp.clone());
        if (resp.ok) {
          const data = await resp.json();
          setQuickViewUcsBySession((prev) => ({ ...prev, [sid]: data.usecases || [] }));
        }
      } catch {
        /* silent */
      } finally {
        setQuickViewLoadingSid((cur) => (cur === sid ? null : cur));
      }
    },
    [inspireDatabase, warehouseId, token, databricksHost, showcase]
  );

  useEffect(() => {
    if (!inspireDatabase || !warehouseId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, all: '1' });
        const resp = await fetch(`/api/inspire/sessions?${q}`, { headers: requestHeaders(token, databricksHost, {}, showcase) });
        const refused = resp.ok ? null : await responseError(resp.clone());
        if (resp.ok) {
          const data = await resp.json();
          setSessions(data.sessions || []);
          setLoadedAt(Date.now());
          setTruncated(Boolean(data.truncated));
          if (data.connection_error || data.message) {
            setError(data.connection_error || data.message);
          }
        } else if (!refused.dialog) {
          const errText = await resp.text().catch(() => '');
          setError(errText || `Could not load runs (${resp.status})`);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token, databricksHost, warehouseId, inspireDatabase, showcase]);

  const toggleQuickView = (session, isQuickOpen, legacySummary, listOverview, sidStr) => {
    if (isQuickOpen) {
      setExpandedQuickView(null);
      return;
    }
    setExpandedQuickView(session.session_id);
    if (!legacySummary && listOverview?.total > 0) {
      const has = (quickViewUcsBySession[sidStr] || []).length > 0;
      if (!has) fetchUcsForQuickView(session.session_id);
    }
  };

  const byFilter = runFilter ? runsOfCard(runFilter, sessions, portfolio) : sessions;
  // REQ-575: the search reads the run name and every use case title the list carries; each hit keeps the titles it matched.
  const hits = new Map();
  const filtered = query.trim() ? byFilter.filter((session) => {
    const overview = getListRowOverview(session);
    const hit = runSearchHit(runLabel(session), [...(overview?.searchTitles || []), ...(overview?.previewTitles || [])], query);
    if (hit.match) hits.set(String(session.session_id), hit.titles);
    return hit.match;
  }) : byFilter;
  const listed = runFilter || query.trim() || showAll ? filtered : filtered.slice(0, 5);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6">
        <div className="w-full space-y-6">
          <div className="text-center space-y-3">
            <div className="skeleton w-40 h-5 mx-auto rounded-full" />
            <div className="skeleton w-64 h-9 mx-auto rounded-lg" />
            <div className="skeleton w-52 h-4 mx-auto rounded" />
          </div>
          <div className="skeleton w-full h-20 rounded-2xl" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  const startButton = (
    <Button data-start-new="" data-variant="primary" onClick={() => setWizardOpen(true)}>
      <Rocket size={16} aria-hidden /> {START_NEW_DISCOVERY}
    </Button>
  );
  const wizard = wizardOpen && (
    <StartWizard settings={settings} apiFetch={apiFetch} onClose={() => setWizardOpen(false)}
      onNoData={onNoData ? () => { setWizardOpen(false); onNoData(); } : undefined}
      onLaunched={(...args) => { setWizardOpen(false); onLaunched?.(...args); }} update={update} />
  );

  if (sessions.length === 0 && !error) {
    return (
      <>
      <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6">
        <div className="mx-auto w-full max-w-[1440px] space-y-6">
          <PageHeader icon={Rocket} title="Get started with Inspire AI" subtitle="Start your first discovery to see your use cases here." actions={startButton} />
          <div className="w-full space-y-6">
            <p className="max-w-[75ch] text-sm text-text-secondary">
              Start from your own Unity Catalog data, or look at the demo first.
            </p>
            {demo && (
              <div className="space-y-3">
                <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary">Previous runs</h2>
                <DemoRow demo={demo} onDemo={onDemo} />
              </div>
            )}
            <div data-runs-none="" className="rounded-xl border border-dashed border-border px-5 py-6 text-center">
              <p className="text-sm font-semibold text-text-primary">No runs of your own yet</p>
              <p className="mt-1 text-xs text-text-secondary">Start a discovery on your data. Your runs show up here.</p>
              <div className="mt-4 flex justify-center">{startButton}</div>
            </div>
          </div>
        </div>
      </div>
      {wizard}
    </>
  );
}

  const openCard = (key) => {
    if (portfolioCard(key)?.opens === 'build') {
      const filter = buildFilterOf(key, sessions, portfolio);
      if (filter) onOpenBuild?.(filter);
      return;
    }
    setRunFilter((prev) => (prev === key ? '' : key));
  };

  return (
    <>
    <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-[-15%] start-[-5%] w-[40%] h-[40%] rounded-full bg-db-red/[0.03] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] end-[-5%] w-[35%] h-[35%] rounded-full bg-db-red/[0.02] blur-[100px] pointer-events-none" />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] space-y-8">

        {/* ── Header ── */}
        <div className="space-y-3">
          <PageHeader icon={Rocket} title="Welcome back" subtitle="Pick up where you left off or start a new run."
            actions={<MoreMenu items={[
              { label: 'View all runs', onSelect: () => onViewResults(null) },
              ...(allTotals?.all ? [{ label: 'Value across all runs', onSelect: () => setShowValue(true) }] : []),
            ]} />} />
          {!error && <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg-subtle border border-border rounded-full">
            <BarChart3 size={14} className="text-db-red-fg" />
            <span className="text-xs font-medium text-text-secondary">
              {sessionCountsLine(sessions, loadedAt)}
            </span>
          </div>}
        </div>

        <div className="flex justify-start">{startButton}</div>

        {anyRunValue(allTotals) && <ValueDisclaimer />}
        {allTotals?.all && showValue && <AllRunsValuePanel reply={allTotals} />}
        {inspireDatabase && warehouseId && (
          <PortfolioCards portfolio={portfolio} error={portfolioError} sessions={sessions} active={runFilter} onCard={openCard} />
        )}

        {/* ── Previous Experiments ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-[0.1em]">Previous runs</h2>
          </div>

          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search runs and use cases" placeholder="Search runs and use cases" dir="auto"
              className="w-full max-w-[1040px] rounded-lg border border-border bg-surface py-2 ps-9 pe-3 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2" />
          </div>

          {runFilter && (
            <div role="status" data-run-filter={runFilter} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-db-red/30 bg-db-red-50 px-3 py-2">
              <p className="min-w-0 text-[12px] font-medium text-db-red-fg">{runFilterText(runFilter, filtered.length, truncated)}</p>
              <button
                type="button"
                onClick={() => setRunFilter('')}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-db-red/30 bg-surface px-2 py-1 text-xs font-semibold text-db-red-fg hover:bg-db-red-50"
              >
                <X size={14} aria-hidden /> Clear filter
              </button>
            </div>
          )}

          {listed.length === 0 && (query.trim() || runFilter) && (
            <div data-runs-empty="" role="status" className="rounded-xl border border-dashed border-border px-5 py-6 text-center text-sm text-text-secondary">
              <p>{query.trim() ? `No run or use case matches "${query.trim()}".` : 'No run has this.'}</p>
              {query.trim() && (
                <button type="button" onClick={() => setQuery('')} className="mt-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-bg-subtle">Clear search</button>
              )}
            </div>
          )}

          <div className="space-y-2">
            {demo && !query.trim() && !runFilter && <DemoRow demo={demo} onDemo={onDemo} />}
            {listed.map((session) => {
              const status = sessionStatus(session, loadedAt);
              const cfg = session.starting && status === 'running' ? STATUS_CONFIG.starting : STATUS_CONFIG[status];
              const name = runLabel(session);
              const date = session.completed_on || session.create_at;
              const mode = session.widget_values?.operation_mode
                || session.widget_values?.['15_operation']
                || session.widget_values?.['02_operation_mode']
                || session.operation_mode
                || '';
              const isCompleted = status === 'finished';
              const sidStr = String(session.session_id);
              const legacySummary = getSessionSummary(session);
              const listOverview = getListRowOverview(session);
              const panelSummary = legacySummary || buildSummaryFromUclist(quickViewUcsBySession[sidStr]);
              const canQuickView = !!(legacySummary || listOverview?.total > 0);
              const counts = runCounts(listOverview, portfolio, session, { running: status === 'running' || status === 'quiet', mvpError: portfolioError });
              const buildingCount = Number(portfolio?.sessions?.[String(session.session_id)]?.mvps_building) || 0;
              const mvpsStarted = Number(portfolio?.sessions?.[String(session.session_id)]?.mvps_started) || 0;
              const buildFilter = mvpsStarted ? buildFilterOf('mvps_started', [session], portfolio) : null;

              // Build a short text description from domain names and catalog
              const description = (() => {
                const parts = [];
                // Domain names from results_json
                const rj = session.results_json;
                if (rj && Array.isArray(rj.domains)) {
                  const domainNames = rj.domains.map(d => d.domain_name).filter(Boolean);
                  domainNames.slice(0, 3).forEach((d, i) => parts.push([i ? ', ' : '', d]));
                  if (domainNames.length > 3) parts.push([' ', `+${domainNames.length - 3} more`]);
                }
                // Catalog info
                const db = session.inspire_database_name || '';
                if (db) parts.push([parts.length ? ' · ' : '', db.split('.')[0]]);
                // Business domains from session config (fallback if no results_json)
                if (parts.length === 0 && session.business_domains) {
                  parts.push(['', session.business_domains.length > 60 ? session.business_domains.slice(0, 57) + '...' : session.business_domains]);
                }
                return parts.length ? parts.map(([sep, value], i) => <Fragment key={i}>{sep}<bdi>{value}</bdi></Fragment>) : null;
              })();

              const isQuickOpen = String(expandedQuickView) === sidStr;
              const PRIORITY_TONES = {
                'Ultra High': ['bg-danger', 'bg-danger-bg text-danger-fg'], 'Very High': ['bg-danger', 'bg-danger-bg text-danger-fg'],
                'High': ['bg-warning', 'bg-warning-bg text-warning-fg'], 'Medium': ['bg-info', 'bg-info-bg text-info-fg'],
              };

              return (
                <div
                  key={session.session_id}
                  className={`rounded-xl bg-surface/50 border transition-colors duration-200 ${isQuickOpen ? 'border-border-strong' : 'border-border hover:border-border-strong'}`}
                >
                  {/* Main clickable row */}
                  <div data-run={sidStr} className="group relative flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 rounded-xl hover:bg-surface transition-colors duration-200">
                  <button
                    type="button"
                    onClick={() => onViewResults(session.session_id, session.starting ? session.run_id : null)}
                    className="flex w-full min-w-0 items-center gap-4 text-start before:absolute before:inset-0 before:rounded-xl before:content-['']"
                  >
                    {/* Status indicator */}
                    <div className="flex-shrink-0 relative">
                      <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                        {status === 'finished' ? (
                          <CheckCircle2 size={16} className={cfg.text} />
                        ) : status === 'failed' ? (
                          <AlertCircle size={16} className={cfg.text} />
                        ) : status === 'running' ? (
                          <Loader2 size={16} className={`${cfg.text} animate-spin`} />
                        ) : (
                          <Clock size={16} className={cfg.text} />
                        )}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="flex items-center gap-2 min-w-0">
                        <span dir="auto" className="text-base font-semibold text-text-primary truncate">{name}</span>
                        <LatestRunBadge session={session} />
                      </p>
                      {description && (
                        <p className="text-xs text-text-secondary truncate mt-0.5">{description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {date && (
                          <span className="flex items-center gap-1 text-xs text-text-tertiary">
                            <Clock size={14} />
                            {formatDate(date)}
                          </span>
                        )}
                        {mode && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-tertiary font-mono">
                            {mode}
                          </span>
                        )}
                        <span title={isCompleted && session.completed_on ? `Completed ${formatCompletedDate(session.completed_on)}` : undefined} className={`text-xs px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                        {session.profile_id && (
                          <span data-run-profile="" className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary">
                            Profile: {session.profile_name || 'saved profile'}
                          </span>
                        )}
                      </div>
                      {profileError?.sessionId === sidStr && (
                        <PlainMessage as="p" text={profileError.message} role="alert" data-run-profile-error="" className="mt-1 text-xs text-error-fg" />
                      )}
                      <>
                          {hits.get(sidStr)?.length > 0 && (
                            <p data-run-match="" className="mt-1.5 text-xs text-text-secondary">
                              Matches: {hits.get(sidStr).slice(0, 3).map((title, i) => <Fragment key={title}>{i ? ', ' : ''}<bdi className="font-medium text-text-primary">{title}</bdi></Fragment>)}
                            </p>
                          )}
                          {counts.note && <p data-run-counts-note="" className="mt-1.5 text-xs text-text-secondary">{counts.note}</p>}
                          {counts.why.map((line) => (
                            <p key={line} data-run-counts-why="" className="mt-0.5 text-xs leading-snug text-text-secondary">{line}</p>
                          ))}
                          {listOverview?.previewTitles.length > 0 && (
                            <p className="text-xs text-text-tertiary mt-1 line-clamp-2 leading-snug">
                              {listOverview.previewTitles.join(' · ')}
                              {listOverview.total > listOverview.previewTitles.length && (
                                <span>
                                  {' '}
                                  · +{listOverview.total - listOverview.previewTitles.length} more
                                </span>
                              )}
                            </p>
                          )}
                      </>
                    </div>

                    <div data-run-aside="" className="flex shrink-0 items-start gap-3">
                      <InspireScoreBadge row score={listOverview?.avgScore ?? null} />
                      {allTotals && <div className="w-60 min-w-0"><RunValueLine value={runValueOf(sidStr)} compact /></div>}
                    </div>
                  </button>

                  <RunCountChips items={counts.items} active={runFilter}
                    onToggle={(key) => setRunFilter((prev) => (prev === key ? '' : key))} />
                    <div className="relative z-10 ms-auto flex flex-shrink-0 items-center gap-2">
                      <div className="relative z-10">
                        <MoreMenu label={`More for ${name}`} items={[
                          { label: 'Download profile', disabled: !session.profile_id, onSelect: () => downloadProfile(session.profile_id, sidStr) },
                          { label: 'Go to Build', disabled: !buildFilter, onSelect: () => onOpenBuild?.(buildFilter) },
                          ...(canQuickView ? [{ label: isQuickOpen ? 'Hide quick view' : 'Quick view', onSelect: () => toggleQuickView(session, isQuickOpen, legacySummary, listOverview, sidStr) }] : []),
                          ...(showcase ? [] : [{ label: 'Delete run', danger: true, onSelect: () => setConfirmDelete(session.session_id) }]),
                        ]} />
                      </div>
                      {Number(portfolio?.sessions?.[sidStr]?.mvps_live) > 0 && (
                        <span data-run-live="" className="rounded-lg border border-success/35 bg-success-bg px-2.5 py-1.5 text-xs font-semibold tabular-nums text-success-fg">
                          {portfolio.sessions[sidStr].mvps_live.toLocaleString('en-US')} live
                        </span>
                      )}
                      {buildFilter && buildingCount > 0 && (
                        <div data-run-building="" className="relative z-10 flex items-center gap-2 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium text-text-primary">
                          <Loader2 data-run-building-spinner="" size={14} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none text-text-secondary" />
                          <span className="tabular-nums">{buildingCount.toLocaleString('en-US')} building</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenBuild?.(buildFilter); }}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-text-primary hover:bg-bg-subtle"
                          >
                            Go to Build <ArrowRight size={14} aria-hidden />
                          </button>
                        </div>
                      )}
                      {status === 'running' && (
                        <div className="w-16 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                          <div
                            className="h-full rounded-full bg-db-red transition-[width] duration-500"
                            style={{ width: `${session.completed_percent || 0}%` }}
                          />
                        </div>
                      )}

                      {deleteError && deleteError.sessionId === session.session_id && (
                        <PlainMessage as="span" text={deleteError.message} role="alert" className="max-w-[18rem] text-xs text-error-fg" onClick={(e) => e.stopPropagation()} />
                      )}

                      {/* Delete button */}
                      {showcase ? null : confirmDelete === session.session_id ? (
                        <div className="relative z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSession(session.session_id); }}
                            disabled={deleting === session.session_id}
                            className="px-2 py-1 text-xs font-medium rounded-md bg-error-bg text-error-fg hover:bg-error/20 transition-colors"
                          >
                            {deleting === session.session_id ? <Loader2 size={14} className="animate-spin" /> : 'Delete'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                            className="px-2 py-1 text-xs font-medium rounded-md bg-bg-subtle text-text-tertiary hover:text-text-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}

                      {!isQuickOpen && <SessionSparkline session={session} />}
                      <ChevronRight size={16} aria-hidden="true" className={`text-text-tertiary transition-transform ${isQuickOpen ? 'rotate-90' : 'group-hover:text-text-secondary'}`} />
                    </div>
                  </div>

                  {/* ── Quick View Panel ── */}
                  {isQuickOpen && canQuickView && (
                    <div className="border-t border-border px-5 py-4 space-y-4">
                      {quickViewLoadingSid === sidStr && !panelSummary && (
                        <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
                          <Loader2 size={14} className="animate-spin text-db-red-fg" />
                          Loading use cases…
                        </div>
                      )}
                      {!legacySummary &&
                        quickViewLoadingSid !== sidStr &&
                        !panelSummary &&
                        listOverview?.total > 0 && (
                          <p className="text-xs text-text-tertiary py-1">
                            Preview could not be loaded. Open the run in Review to browse all its use cases.
                          </p>
                        )}
                      {panelSummary && (
                        <>
                      {/* Domain chips */}
                      {panelSummary.domainNames.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {panelSummary.domainNames.map((d) => (
                            <span key={d} className="text-xs font-medium px-2.5 py-1 rounded-full bg-db-red-50 text-db-red-fg border border-db-red/15">
                              {d}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Top use cases list */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Top Use Cases</p>
                        {[...panelSummary.useCases]
                          .sort(compareUseCaseRank)
                          .slice(0, 8)
                          .map((uc, i) => {
                            const ucName = nameOfUseCase(uc) || uc.usecase || `Use Case ${i + 1}`;
                            const ucPriority = uc.Priority || uc.priority || '';
                            const ucDomain = uc['Business Domain'] || uc.domain || '';
                            const ucTechnique = uc['Analytics Technique'] || '';
                            const [priorityDot, priorityChip] = PRIORITY_TONES[ucPriority] || ['bg-neutral', 'bg-neutral-bg text-neutral-fg'];
                            return (
                              <div key={uc.No || i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-subtle/50 hover:bg-bg-subtle transition-colors">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-text-primary truncate">{ucName}</p>
                                  <p className="text-xs text-text-tertiary truncate">
                                    {ucDomain}{ucTechnique ? ` · ${ucTechnique}` : ''}
                                  </p>
                                </div>
                                {ucPriority && (
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${priorityChip}`}>
                                    {ucPriority}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        {panelSummary.useCases.length > 8 && (
                          <p className="text-xs text-text-tertiary text-center pt-1">
                            +{panelSummary.useCases.length - 8} more use cases
                          </p>
                        )}
                      </div>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => onViewResults(session.session_id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-db-red-50 text-db-red-fg text-xs font-semibold hover:bg-db-red-100 transition-colors"
                      >
                        <BarChart3 size={14} /> Open in Review
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!runFilter && sessions.length > 5 && (
              <button
                onClick={() => setShowAll(prev => !prev)}
                className="mx-auto flex w-auto items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border hover:border-border-strong text-text-tertiary hover:text-text-secondary transition-colors duration-200 text-xs font-medium"
              >
                {showAll ? (
                  <><ChevronUp size={14} /> Show less</>
                ) : (
                  <><ChevronDown size={14} /> Show {sessions.length - 5} more run{sessions.length - 5 !== 1 ? 's' : ''}</>
                )}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="flex flex-col items-center gap-1 text-xs text-warning-fg justify-center pt-2 px-4 text-center">
            <div className="flex items-center gap-2" data-runs-error="">
              <AlertCircle size={14} />
              <PlainMessage as="span" text={`${RUNS_ERROR_TEXT}: ${typeof error === 'string' && error.trim() && error !== 'false' ? error : 'Databricks gave no reason'}`} />
            </div>
          </div>
        )}
      </div>
    </div>
    {wizard}
    </>
  );
}
