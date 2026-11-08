import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import { Rocket, BarChart3, Loader2, AlertCircle, Clock, CheckCircle2, ArrowRight, ChevronRight, ChevronDown, ChevronUp, Trash2, Eye, EyeOff, Target, FileText, Sparkles, X } from 'lucide-react';
import SessionSparkline from '../components/SessionSparkline';
import MagneticButton from '../components/MagneticButton';
import { SkeletonCard } from '../components/SkeletonLoader';
import LatestRunBadge from '../components/LatestRunBadge';
import PortfolioCards, { usePortfolio } from '../components/PortfolioCards';
import { makeApiFetch, requestHeaders } from '../lib/apiClient';
import { buildFilterOf, portfolioCard, runBusiness, runCounts, runFilterText, runsOfCard } from '../lib/reviewFigures';
import { sessionStatus, sessionSucceeded } from '../lib/monitorState';
import { SHOWCASE_BUTTON } from '../lib/showcase';
import { compareUseCaseRank, computeHighPriorityCount, nameOfUseCase, qualityBarCountsOf } from '../lib/useCaseFields';

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

const CHOICE = 'group flex w-full items-start gap-4 rounded-2xl border px-5 py-4 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40';

function StartChoice({ choice, icon: Icon, title, text, onClick, strong = false }) {
  const textId = useId();
  return (
    <button type="button" data-start-choice={choice} onClick={onClick} aria-label={title} aria-describedby={textId}
      className={`${CHOICE} ${strong ? 'border-db-red/30 bg-gradient-to-r from-db-red/[0.06] to-transparent hover:from-db-red/[0.12]' : 'border-border bg-surface hover:border-border-strong'}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${strong ? 'bg-db-red/10' : 'bg-bg-subtle'}`}>
        <Icon size={20} aria-hidden className="text-db-red-fg" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span id={textId} className="mt-1 block text-[12px] leading-snug text-text-secondary">{text}</span>
      </span>
      <ArrowRight size={18} aria-hidden className="mt-2.5 shrink-0 text-text-tertiary group-hover:text-db-red-fg" />
    </button>
  );
}

function StartChoices({ onNewExperiment, onNoData, onDemo }) {
  return (
    <section aria-label="How do you want to start?" data-start-choices="" className="space-y-3">
      <h2 className="text-center text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary">How do you want to start?</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StartChoice choice="data" icon={Rocket} strong onClick={onNewExperiment} title="I have data in Unity Catalog"
          text="Pick the catalogs, schemas or tables Inspire reads. Inspire finds use cases in your own data." />
        <StartChoice choice="no-data" icon={Sparkles} onClick={onNoData} title="No data yet"
          text="Describe your business. Inspire creates sample tables for it and simulates a full run on them, so you see what Inspire does without your own data." />
      </div>
      {onDemo && (
        <StartChoice choice="demo" icon={Eye} onClick={onDemo} title={SHOWCASE_BUTTON}
          text="Open a finished run: its use cases and the MVPs built for them. Nothing in your workspace changes." />
      )}
    </section>
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
    };
  }
  if (fromApi) return { total: 0, unread: {}, previewTitles: [] };
  return null;
}

export default function ChoosePage({ settings, onNewExperiment, onNoData, onDemo, onViewResults, onOpenBuild }) {
  const { token, databricksHost, warehouseId, inspireDatabase, showcase = '' } = settings;
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [runFilter, setRunFilter] = useState('');
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const { portfolio, error: portfolioError } = usePortfolio(apiFetch, inspireDatabase, warehouseId);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [expandedQuickView, setExpandedQuickView] = useState(null);
  const [quickViewUcsBySession, setQuickViewUcsBySession] = useState({});
  const [quickViewLoadingSid, setQuickViewLoadingSid] = useState(null);

  const deleteSession = useCallback(async (sessionId) => {
    if (!inspireDatabase || !warehouseId || showcase) return;
    setDeleting(sessionId);
    try {
      const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
      const resp = await fetch(`/api/inspire/session?${q}`, { method: 'DELETE', headers: requestHeaders(token, databricksHost) });
      if (resp.ok) {
        setSessions(prev => prev.filter(s => s.session_id !== sessionId));
        setDeleteError(null);
      } else {
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
        if (resp.ok) {
          const data = await resp.json();
          setSessions(data.sessions || []);
          setLoadedAt(Date.now());
          setTruncated(Boolean(data.truncated));
          if (data.connection_error || data.message) {
            setError(data.connection_error || data.message);
          }
        } else {
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

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6">
        <div className="max-w-3xl w-full space-y-6">
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

  if (sessions.length === 0 && !error) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6">
        <div className="max-w-3xl w-full space-y-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Get started with Inspire AI</h1>
          <p className="text-sm text-text-secondary">
            Start from your own Unity Catalog data, or let Inspire make sample data for you.
          </p>
          <StartChoices onNewExperiment={onNewExperiment} onNoData={onNoData} onDemo={onDemo} />
        </div>
      </div>
    );
  }

  const completedCount = sessions.filter(sessionSucceeded).length;
  const inProgressCount = sessions.filter((s) => sessionStatus(s, loadedAt) === 'running').length;
  const filtered = runFilter ? runsOfCard(runFilter, sessions, portfolio) : sessions;
  const listed = runFilter || showAll ? filtered : filtered.slice(0, 5);
  const openCard = (key) => {
    if (portfolioCard(key)?.opens === 'build') {
      const filter = buildFilterOf(key, sessions, portfolio);
      if (filter) onOpenBuild?.(filter);
      return;
    }
    setRunFilter((prev) => (prev === key ? '' : key));
  };

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-start justify-center pt-12 pb-16 px-6 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-[-15%] left-[-5%] w-[40%] h-[40%] rounded-full bg-db-red/[0.03] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[35%] h-[35%] rounded-full bg-db-red/[0.02] blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl w-full space-y-8">

        {/* ── Header ── */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bg-subtle border border-border rounded-full">
            <BarChart3 size={12} className="text-db-red-fg" />
            <span className="text-[11px] font-medium text-text-secondary">
              {completedCount} completed{inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ''}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em]">
            Welcome back
          </h1>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            Pick up where you left off or start a new run.
          </p>
        </div>

        <StartChoices onNewExperiment={onNewExperiment} onNoData={onNoData} onDemo={onDemo} />

        {inspireDatabase && warehouseId && (
          <PortfolioCards portfolio={portfolio} error={portfolioError} sessions={sessions} active={runFilter} onCard={openCard} />
        )}

        {/* ── Previous Experiments ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-[0.1em]">Previous runs</h2>
            <button
              onClick={() => onViewResults(null)}
              className="text-[11px] text-text-tertiary hover:text-db-red-fg transition-colors flex items-center gap-1"
            >
              View all <ChevronRight size={12} />
            </button>
          </div>

          {runFilter && (
            <div role="status" data-run-filter={runFilter} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-db-red/30 bg-db-red-50 px-3 py-2">
              <p className="min-w-0 text-[12px] font-medium text-db-red-fg">{runFilterText(runFilter, filtered.length, truncated)}</p>
              <button
                type="button"
                onClick={() => setRunFilter('')}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-db-red/30 bg-surface px-2 py-1 text-[11px] font-semibold text-db-red-fg hover:bg-db-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red"
              >
                <X size={11} aria-hidden /> Clear
              </button>
            </div>
          )}

          <div className="space-y-2">
            {listed.map((session) => {
              const status = sessionStatus(session, loadedAt);
              const cfg = session.starting && status === 'running' ? STATUS_CONFIG.starting : STATUS_CONFIG[status];
              const name = runBusiness(session) || `Session ${session.session_id}`;
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

              // Build a short text description from domain names and catalog
              const description = (() => {
                const parts = [];
                // Domain names from results_json
                const rj = session.results_json;
                if (rj && Array.isArray(rj.domains)) {
                  const domainNames = rj.domains.map(d => d.domain_name).filter(Boolean);
                  if (domainNames.length > 0) {
                    parts.push(domainNames.length <= 3 ? domainNames.join(', ') : `${domainNames.slice(0, 3).join(', ')} +${domainNames.length - 3} more`);
                  }
                }
                // Catalog info
                const db = session.inspire_database_name || '';
                if (db) parts.push(db.split('.')[0]);
                // Business domains from session config (fallback if no results_json)
                if (parts.length === 0 && session.business_domains) {
                  parts.push(session.business_domains.length > 60 ? session.business_domains.slice(0, 57) + '...' : session.business_domains);
                }
                return parts.join(' · ');
              })();

              const isQuickOpen = String(expandedQuickView) === sidStr;
              const PRIORITY_COLORS = { 'Ultra High': '#DC2626', 'Very High': '#EA580C', 'High': '#D97706', 'Medium': '#2563EB', 'Low': '#6B7280' };

              return (
                <div
                  key={session.session_id}
                  className={`rounded-xl bg-surface/50 border transition-all duration-200 ${isQuickOpen ? 'border-border-strong' : 'border-border hover:border-border-strong'}`}
                >
                  {/* Main clickable row */}
                  <div data-run={sidStr} className="group relative flex w-full items-center gap-4 px-5 py-4 rounded-xl hover:bg-surface transition-all duration-200">
                  <button
                    type="button"
                    onClick={() => onViewResults(session.session_id, session.starting ? session.run_id : null)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-start before:absolute before:inset-0 before:rounded-xl before:content-[''] focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-db-red/30"
                  >
                    {/* Status indicator */}
                    <div className="flex-shrink-0 relative">
                      <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                        {status === 'finished' ? (
                          <CheckCircle2 size={18} className={cfg.text} />
                        ) : status === 'failed' ? (
                          <AlertCircle size={18} className={cfg.text} />
                        ) : status === 'running' ? (
                          <Loader2 size={18} className={`${cfg.text} animate-spin`} />
                        ) : (
                          <Clock size={18} className={cfg.text} />
                        )}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-text-primary truncate">{name}</span>
                        <LatestRunBadge session={session} />
                      </p>
                      {description && (
                        <p className="text-[11px] text-text-secondary truncate mt-0.5">{description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {date && (
                          <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                            <Clock size={10} />
                            {formatDate(date)}
                          </span>
                        )}
                        {mode && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-subtle text-text-tertiary font-mono">
                            {mode}
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <>
                          {counts.items.length > 0 && (
                            <ul data-run-counts="" aria-label="Counts for this run" className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
                              {counts.items.map((item) => (
                                <li key={item.key} data-run-count={item.key} data-count-off={item.n == null ? '' : undefined}>
                                  {item.n == null ? `${item.label} not counted` : (
                                    <><span className="font-semibold tabular-nums text-text-primary">{item.n.toLocaleString('en-US')}</span> {item.label}</>
                                  )}
                                </li>
                              ))}
                              {isCompleted && session.completed_on && <li className="text-text-tertiary">Completed {formatCompletedDate(session.completed_on)}</li>}
                            </ul>
                          )}
                          {counts.note && <p data-run-counts-note="" className="mt-1.5 text-[11px] text-text-secondary">{counts.note}</p>}
                          {counts.why.map((line) => (
                            <p key={line} data-run-counts-why="" className="mt-0.5 text-[10px] leading-snug text-text-secondary">{line}</p>
                          ))}
                          {listOverview?.previewTitles.length > 0 && (
                            <p className="text-[10px] text-text-tertiary mt-1 line-clamp-2 leading-snug">
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

                  </button>

                    <div className="flex-shrink-0 flex items-center gap-2">
                      {status === 'running' && (
                        <div className="w-16 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                          <div
                            className="h-full rounded-full bg-db-red transition-all duration-500"
                            style={{ width: `${session.completed_percent || 0}%` }}
                          />
                        </div>
                      )}

                      {/* Quick View toggle */}
                      {canQuickView && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isQuickOpen) {
                              setExpandedQuickView(null);
                              return;
                            }
                            setExpandedQuickView(session.session_id);
                            if (!legacySummary && listOverview?.total > 0) {
                              const has = (quickViewUcsBySession[sidStr] || []).length > 0;
                              if (!has) fetchUcsForQuickView(session.session_id);
                            }
                          }}
                          className="relative z-10 px-2.5 py-1.5 text-[10px] font-medium rounded-lg flex items-center gap-1 transition-all border border-border hover:border-db-red/30 hover:bg-db-red-50 text-text-tertiary hover:text-db-red-fg"
                          title="Quick view use cases"
                        >
                          {isQuickOpen ? (
                            <>
                              <EyeOff size={10} /> Hide
                            </>
                          ) : (
                            <>
                              <Eye size={10} /> Quick View
                            </>
                          )}
                        </button>
                      )}

                      {deleteError && deleteError.sessionId === session.session_id && (
                        <span role="alert" className="max-w-[18rem] text-[10px] text-error-fg" onClick={(e) => e.stopPropagation()}>{deleteError.message}</span>
                      )}

                      {/* Delete button */}
                      {showcase ? null : confirmDelete === session.session_id ? (
                        <div className="relative z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSession(session.session_id); }}
                            disabled={deleting === session.session_id}
                            className="px-2 py-1 text-[10px] font-medium rounded-md bg-error-bg text-error-fg hover:bg-error/20 transition-colors"
                          >
                            {deleting === session.session_id ? <Loader2 size={10} className="animate-spin" /> : 'Delete'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                            className="px-2 py-1 text-[10px] font-medium rounded-md bg-bg-subtle text-text-tertiary hover:text-text-secondary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(session.session_id); }}
                          className="relative z-10 p-1.5 rounded-lg text-text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-error-fg hover:bg-error-bg transition-all"
                          title="Delete run"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      {!isQuickOpen && <SessionSparkline session={session} />}
                      <ChevronRight size={16} aria-hidden="true" className={`text-text-tertiary transition-all ${isQuickOpen ? 'rotate-90' : 'group-hover:text-text-secondary'}`} />
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
                            <span key={d} className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-db-red-50 text-db-red-fg border border-db-red/15">
                              {d}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Top use cases list */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Top Use Cases</p>
                        {[...panelSummary.useCases]
                          .sort(compareUseCaseRank)
                          .slice(0, 8)
                          .map((uc, i) => {
                            const ucName = nameOfUseCase(uc) || uc.usecase || `Use Case ${i + 1}`;
                            const ucPriority = uc.Priority || uc.priority || '';
                            const ucDomain = uc['Business Domain'] || uc.domain || '';
                            const ucTechnique = uc['Analytics Technique'] || '';
                            const priorityColor = PRIORITY_COLORS[ucPriority] || '#6B7280';
                            return (
                              <div key={uc.No || i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-subtle/50 hover:bg-bg-subtle transition-colors">
                                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityColor }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-medium text-text-primary truncate">{ucName}</p>
                                  <p className="text-[10px] text-text-tertiary truncate">
                                    {ucDomain}{ucTechnique ? ` · ${ucTechnique}` : ''}
                                  </p>
                                </div>
                                {ucPriority && (
                                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: `${priorityColor}15`, color: priorityColor }}>
                                    {ucPriority}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        {panelSummary.useCases.length > 8 && (
                          <p className="text-[10px] text-text-tertiary text-center pt-1">
                            +{panelSummary.useCases.length - 8} more use cases
                          </p>
                        )}
                      </div>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => onViewResults(session.session_id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-db-red-50 text-db-red-fg text-[11px] font-semibold hover:bg-db-red-100 transition-colors"
                      >
                        <BarChart3 size={12} /> Open in Review
                        <ArrowRight size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!runFilter && sessions.length > 5 && (
              <button
                onClick={() => setShowAll(prev => !prev)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border hover:border-border-strong text-text-tertiary hover:text-text-secondary transition-all duration-200 text-xs font-medium"
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
            <div className="flex items-center gap-2">
              <AlertCircle size={13} />
              <span>Could not load all runs. You can still start a new run.</span>
            </div>
            {typeof error === 'string' && error.trim() && error !== 'false' && (
              <span className="text-[10px] text-text-tertiary font-mono break-all max-w-xl">{error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
