import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Component, Suspense, lazy } from 'react';
import { ThemeProvider } from './ThemeContext';
import Header from './components/Header';
import LandingPage from './pages/LandingPage';
import SetupWizard from './pages/SetupWizard';
import ChoosePage from './pages/ChoosePage';
import {
  BUILD_TAB, HOME_PAGE, INSPIRE_ENTRY, MONITOR_TAB, REVIEW_LEFT_DEMO, REVIEW_TAB, RUN_LEFT_DEMO, RUN_TAB, demoRunPages, hashLink, pageHash, queryLink,
} from './lib/runPages';
import ScrollProgressRing from './components/ScrollProgressRing';
import ParticleField from './components/ParticleField';
import ShowcaseBar from './components/ShowcaseBar';
import { RESULTS_FRAME } from './lib/layout';
import { showcaseSettings, showcasesFrom, staysInShowcase } from './lib/showcase';

const noop = () => {};

const LATER_PAGES = {
  launch: () => import('./pages/LaunchPage'),
  generate: () => import('./pages/GenerateDataPage'),
  monitor: () => import('./pages/MonitorPage'),
  results: () => import('./pages/ResultsPage'),
  implement: () => import('./pages/ImplementPage'),
  run: () => import('./pages/RunPage'),
};
const LaunchPage = lazy(LATER_PAGES.launch);
const GenerateDataPage = lazy(LATER_PAGES.generate);
const MonitorPage = lazy(LATER_PAGES.monitor);
const ResultsPage = lazy(LATER_PAGES.results);
const ImplementPage = lazy(LATER_PAGES.implement);
const RunPage = lazy(LATER_PAGES.run);

function preloadLaterPages() {
  Object.values(LATER_PAGES).forEach((load) => load().catch(noop));
}

function PageSpinner({ text }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-10 h-10 border-2 border-db-red border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

/** Legacy Configure default pointed at a user folder that often does not exist; use shared publish path. */
const WORKSPACE_NOTEBOOK_SHARED = '/Shared/inspire-ai/dbx_inspire_ai_agent';
function migrateLegacyUserHomeInspirePath(nb) {
  const s = String(nb || '').trim();
  if (!s) return '';
  const base = s.replace(/\/$/, '');
  if (/^\/Users\/[^/]+\/inspire_ai$/i.test(base)) return WORKSPACE_NOTEBOOK_SHARED;
  return s;
}

// Error Boundary to catch rendering crashes and display useful info
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#DC2626' }}>Component Crash</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#FEF2F2', padding: 16, borderRadius: 8 }}>
            {this.state.error?.toString()}
          </pre>
          <details>
            <summary>Stack trace</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
              {this.state.info?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => this.setState({ hasError: false, error: null, info: null })}
            style={{ marginTop: 12, padding: '8px 16px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // Start in 'loading' — resolve backend config before rendering any page.
  const [page, setPage] = useState('loading');

  // Settings: server defaults (from /api/defaults) are the source of truth.
  // localStorage is just a cache for non-App mode (local dev with PAT).
  const [settings, setSettings] = useState({
    databricksHost: '',
    token: '',
    notebookPath: '',
    warehouseId: '',
    inspireDatabase: '',
    authMode: 'pat',
    spClientId: '',
    spClientSecret: '',
    spTenantId: '',
    /** True when server has DATABRICKS_TOKEN and/or SP OAuth (browser may omit PAT). */
    serverEnvHasPat: false,
  });

  // Session tracking
  const [sessionId, setSessionId] = useState(null);
  const [runId, setRunId] = useState(null);
  const [launchNotes, setLaunchNotes] = useState({ runId: null, notes: [], details: [] });
  const [implement, setImplement] = useState({ sessionId: null, focus: null });
  const [showcases, setShowcases] = useState([]);
  const [setupManaged, setSetupManaged] = useState(false);
  const [demo, setDemo] = useState({ showcase: null, focus: null });
  const [reviewSid, setReviewSid] = useState(null);
  const showcasesLoaded = useRef(null);
  const loadingHash = useRef(null);
  const preloaded = useRef(false);

  useEffect(() => {
    if (page === 'loading' || preloaded.current) return;
    preloaded.current = true;
    preloadLaterPages();
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    showcasesLoaded.current = fetch('/api/showcase')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        const list = showcasesFrom(data);
        if (!cancelled) setShowcases(list);
        return list;
      })
      .catch(() => []);
    return () => { cancelled = true; };
  }, []);

  const onDemoFocus = useCallback((id) => {
    setDemo((prev) => ({ ...prev, focus: id }));
  }, []);

  const onResultsSession = useCallback((sid) => {
    setReviewSid(sid);
    setImplement((prev) => (prev.sessionId === sid ? prev : { sessionId: sid, focus: null }));
  }, []);
  const onImplementFocus = useCallback((id) => {
    setImplement((prev) => ({ ...prev, focus: id }));
  }, []);
  const [runFocus, setRunFocus] = useState(null);
  const [runFull, setRunFull] = useState(false);
  const pushNext = useRef(false);
  const [hashTick, setHashTick] = useState(0);
  const focusRun = useCallback((id, { push = false } = {}) => {
    setRunFocus((prev) => {
      pushNext.current = push && id !== prev;
      return id;
    });
  }, []);
  const [runLink, setRunLink] = useState({ n: 0, notice: '' });
  const [reviewLink, setReviewLink] = useState({ n: 0, link: null, notice: '' });
  const takeReviewLink = useCallback((link, notice) => {
    if (link.valid) setSessionId(link.sessionId);
    setReviewLink((prev) => ({ n: prev.n + 1, link, notice }));
  }, []);
  const routeState = useCallback((link, leftDemo) => {
    if (link.page === RUN_TAB) {
      setRunFocus(link.bare ? null : link.id);
      if (!link.bare) setRunLink((prev) => ({ n: prev.n + 1, notice: leftDemo ? RUN_LEFT_DEMO : '' }));
      return RUN_TAB;
    }
    if (link.page === REVIEW_TAB) {
      if (!link.bare) takeReviewLink(link, leftDemo ? REVIEW_LEFT_DEMO : '');
      return REVIEW_TAB;
    }
    if (link.page === MONITOR_TAB && !link.bare) {
      setSessionId(link.sessionId);
      setRunId(link.runId || null);
    }
    if (link.page === BUILD_TAB && !link.bare) setImplement({ sessionId: link.sessionId, focus: link.useCaseId || null });
    return link.page;
  }, [takeReviewLink]);
  const [transitioning, setTransitioning] = useState(false);
  const openDemo = useCallback((showcase, link = null) => {
    const target = link?.demo && staysInShowcase(link.page) ? link.page : REVIEW_TAB;
    setTransitioning(true);
    setTimeout(() => {
      setDemo({ showcase, focus: target === BUILD_TAB ? link.useCaseId || null : null });
      setReviewSid(null);
      pushNext.current = !link;
      setPage(target);
      setTransitioning(false);
    }, 200);
  }, []);

  const update = useCallback((key, val) => {
    setSettings((prev) => {
      const next = typeof val === 'function' ? val(prev[key]) : val;
      try { localStorage.setItem(`db_${key.replace(/([A-Z])/g, '_$1').toLowerCase()}`, next); } catch {}
      return { ...prev, [key]: next };
    });
  }, []);

  // ── Bootstrap: fetch server config ONCE on mount, then show the app ──
  // This runs before any page renders. In Databricks App mode, the backend
  // provides everything via env vars + the proxy provides auth via
  // x-forwarded-access-token. No localStorage needed.
  useEffect(() => {
    (async () => {
      const moved = queryLink(window.location);
      if (moved) window.history.replaceState(window.history.state, '', moved);
      const startHash = window.location.hash;
      try {
        // 1. Fetch server-side defaults (always available, no auth needed)
        const defResp = await fetch('/api/defaults');
        const defaults = defResp.ok ? await defResp.json() : {};

        // 2. Build initial settings: server defaults > localStorage cache > empty
        const resolved = {
          databricksHost: defaults.databricksHost || localStorage.getItem('db_databricks_host') || '',
          token: localStorage.getItem('db_token') || '',
          notebookPath: migrateLegacyUserHomeInspirePath(
            defaults.notebookPath || localStorage.getItem('db_notebook_path') || '',
          ),
          warehouseId: defaults.warehouseId || localStorage.getItem('db_warehouse_id') || '',
          inspireDatabase: defaults.inspireDatabase || localStorage.getItem('db_inspire_database') || '',
          authMode: localStorage.getItem('db_auth_mode') || 'pat',
          spClientId: localStorage.getItem('db_sp_client_id') || '',
          spClientSecret: localStorage.getItem('db_sp_client_secret') || '',
          spTenantId: localStorage.getItem('db_sp_tenant_id') || '',
          serverEnvHasPat: !!(defaults.hasServerPlatformAuth ?? defaults.hasServiceToken),
        };

        // 3. Auto-detect warehouse if installer didn't set one
        if (!resolved.warehouseId) {
          try {
            const whResp = await fetch('/api/warehouses');
            if (whResp.ok) {
              const whs = (await whResp.json()).warehouses || [];
              const pick = whs.find(w => w.state === 'RUNNING' && w.enable_serverless_compute)
                || whs.find(w => w.state === 'RUNNING')
                || whs[0];
              if (pick) resolved.warehouseId = pick.id;
            }
          } catch {}
        }

        // 4. Auto-publish notebook if not already set
        if (!resolved.notebookPath) {
          try {
            const nbResp = await fetch('/api/notebook');
            if (nbResp.ok) {
              const nbData = await nbResp.json();
              if (nbData.path) resolved.notebookPath = migrateLegacyUserHomeInspirePath(nbData.path);
            }
          } catch {}
        }

        // 5. Apply all settings at once (single state update)
        setSettings(resolved);

        // 6. Persist to localStorage for next load
        for (const [key, val] of Object.entries(resolved)) {
          if (val) {
            try { localStorage.setItem(`db_${key.replace(/([A-Z])/g, '_$1').toLowerCase()}`, val); } catch {}
          }
        }

        console.log('[bootstrap] ready:', {
          host: resolved.databricksHost ? 'set' : 'MISSING',
          warehouse: resolved.warehouseId ? 'set' : 'MISSING',
          database: resolved.inspireDatabase ? 'set' : 'MISSING',
          notebook: resolved.notebookPath ? 'set' : 'MISSING',
          isDatabricksApp: defaults.isDatabricksApp,
        });

        // First-run: show Setup Wizard unless user finished it, or env/installer already supplied everything.
        const setupComplete = localStorage.getItem('db_setup_complete') === '1';
        const installerReady =
          defaults.isDatabricksApp &&
          defaults.autoSetup &&
          !!defaults.databricksHost &&
          !!defaults.warehouseId &&
          !!defaults.inspireDatabase;
        const localReady = !!(
          resolved.databricksHost &&
          (resolved.token || resolved.serverEnvHasPat) &&
          resolved.warehouseId &&
          resolved.inspireDatabase
        );
        const envSkipsSetupWizard = !!defaults.envSkipsSetupWizard;
        setSetupManaged(envSkipsSetupWizard || installerReady);
        if (envSkipsSetupWizard) {
          try {
            localStorage.setItem('db_setup_complete', '1');
          } catch { /* ignore */ }
        }
        if (!setupComplete && !installerReady && !localReady && !envSkipsSetupWizard) {
          setPage('setup');
          return;
        }
      } catch (err) {
        console.error('[bootstrap] error:', err);
        setSettings({
          databricksHost: localStorage.getItem('db_databricks_host') || '',
          token: localStorage.getItem('db_token') || '',
          notebookPath: migrateLegacyUserHomeInspirePath(localStorage.getItem('db_notebook_path') || ''),
          warehouseId: localStorage.getItem('db_warehouse_id') || '',
          inspireDatabase: localStorage.getItem('db_inspire_database') || '',
          authMode: localStorage.getItem('db_auth_mode') || 'pat',
          spClientId: localStorage.getItem('db_sp_client_id') || '',
          spClientSecret: localStorage.getItem('db_sp_client_secret') || '',
          spTenantId: localStorage.getItem('db_sp_tenant_id') || '',
          serverEnvHasPat: false,
        });
        if (localStorage.getItem('db_setup_complete') !== '1') {
          const h = localStorage.getItem('db_databricks_host');
          const t = localStorage.getItem('db_token');
          const w = localStorage.getItem('db_warehouse_id');
          const d = localStorage.getItem('db_inspire_database');
          if (!(h && t && w && d)) {
            setPage('setup');
            return;
          }
        }
      }

      const link = hashLink(loadingHash.current ?? startHash);
      if (link?.demo) {
        const showcase = (await showcasesLoaded.current)?.find((s) => s.id === link.demo);
        if (showcase) {
          openDemo(showcase, link);
          return;
        }
      } else if (link) {
        setPage(routeState(link, false));
        return;
      }
      setPage(HOME_PAGE);
    })();
  }, []);

  // Auto-fetch SP token when in SP mode (local dev only)
  useEffect(() => {
    if (settings.authMode !== 'sp' || !settings.spClientId || !settings.spClientSecret || !settings.spTenantId || !settings.databricksHost) return;
    (async () => {
      try {
        const resp = await fetch('/api/auth/sp-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: settings.spClientId,
            client_secret: settings.spClientSecret,
            tenant_id: settings.spTenantId,
            databricks_host: settings.databricksHost,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.access_token) update('token', data.access_token);
        }
      } catch {}
    })();
  }, [settings.authMode, settings.spClientId, settings.spClientSecret, settings.spTenantId, settings.databricksHost]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  const inDemo = !!demo.showcase;
  const demoScope = inDemo ? `demo-${demo.showcase.id}` : '';
  const nav = useCallback((p, { leaveDemo = false, push = true } = {}) => {
    const leaving = inDemo && (leaveDemo || !staysInShowcase(p));
    if (p === page && !leaving) return;
    setTransitioning(true);
    setTimeout(() => {
      if (leaving) setDemo({ showcase: null, focus: null });
      if (p !== 'run') {
        setRunLink((prev) => (prev.notice ? { ...prev, notice: '' } : prev));
        setRunFocus(null);
      }
      if (p !== REVIEW_TAB) {
        setReviewLink((prev) => (prev.notice || prev.link ? { ...prev, link: null, notice: '' } : prev));
        setReviewSid(null);
      }
      pushNext.current = push;
      setPage(p);
      setTransitioning(false);
    }, 200);
  }, [page, inDemo]);

  const onLaunched = useCallback((sid, rid, notes = [], details = []) => {
    setSessionId(sid);
    setRunId(rid);
    setLaunchNotes({ runId: rid, notes, details });
    nav('monitor');
  }, [nav]);

  const openImplement = useCallback((sid, useCaseId, step = null) => {
    if (inDemo) setDemo((prev) => ({ ...prev, focus: useCaseId || null }));
    else setImplement({ sessionId: String(sid), focus: useCaseId || null, step });
    nav('implement');
  }, [nav, inDemo]);

  const openBuildFilter = useCallback((filter) => {
    if (!filter?.runs?.length) return;
    setImplement({ sessionId: filter.runs[0].session_id, focus: null, filter });
    nav('implement');
  }, [nav]);
  const pickBuildRun = useCallback((sid) => {
    setImplement((prev) => ({ ...prev, sessionId: String(sid), focus: null }));
  }, []);
  const clearBuildFilter = useCallback(() => {
    setImplement((prev) => ({ ...prev, filter: null }));
  }, []);

  const openRun = useCallback((id) => {
    focusRun(id || null, { push: true });
    nav('run');
  }, [nav, focusRun]);

  const [demoRun, setDemoRun] = useState(null);
  const clearDemoRun = useCallback(() => setDemoRun(null), []);
  const demoMvps = useMemo(() => {
    const ids = inDemo ? demoRunPages(demo.showcase).map((p) => p.id) : [];
    return ids.length ? { ids, open: (id) => { setDemoRun(id); nav('run'); } } : null;
  }, [inDemo, demo.showcase, nav]);

  const openLink = useCallback((link, { fresh = true } = {}) => {
    if (link.demo) {
      const showcase = showcases.find((s) => s.id === link.demo);
      if (showcase) openDemo(showcase, link);
      else nav(HOME_PAGE, { leaveDemo: true, push: false });
      return;
    }
    nav(routeState(link, fresh && inDemo), { leaveDemo: true, push: false });
  }, [showcases, openDemo, routeState, nav, inDemo]);

  useEffect(() => {
    const onHash = () => {
      if (page === 'loading') loadingHash.current = window.location.hash;
      if (page === 'loading' || page === 'setup') return;
      const link = hashLink(window.location.hash);
      if (link) openLink(link, { fresh: !window.history.state?.[INSPIRE_ENTRY] });
      setHashTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [page, openLink]);

  const implementSessionId = inDemo ? demo.showcase.session_id : implement.sessionId || (sessionId ? String(sessionId) : null);
  const implementFocus = inDemo ? demo.focus : implement.focus;
  const route = inDemo ? { page, demo: demo.showcase.id, useCaseId: page === BUILD_TAB ? implementFocus || '' : '' }
    : page === MONITOR_TAB ? { page, sessionId: sessionId ? String(sessionId) : '', runId: runId ? String(runId) : '' }
      : page === REVIEW_TAB ? { page, sessionId: reviewSid || '' }
        : page === BUILD_TAB ? { page, sessionId: implementSessionId || '', useCaseId: implementFocus || '' }
          : page === RUN_TAB ? { page, id: runFocus || '' }
            : { page };
  const routeHash = page === 'loading' || page === 'setup' ? '' : pageHash(route);

  useEffect(() => {
    if (transitioning) return;
    const push = pushNext.current;
    pushNext.current = false;
    if (!routeHash) return;
    const state = window.history.state;
    if (routeHash === window.location.hash && state?.[INSPIRE_ENTRY]) return;
    const next = `${window.location.pathname}${window.location.search}${routeHash}`;
    if (push && routeHash !== window.location.hash) window.history.pushState({ [INSPIRE_ENTRY]: true }, '', next);
    else window.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), [INSPIRE_ENTRY]: true }, '', next);
  }, [page, routeHash, hashTick, transitioning]);

  const pageSettings = useMemo(() => showcaseSettings(settings, demo.showcase), [settings, demo.showcase]);

  const finishSetup = useCallback(() => {
    try {
      localStorage.setItem('db_setup_complete', '1');
    } catch { /* ignore */ }
    const link = hashLink(window.location.hash);
    if (link) openLink(link);
    else nav(HOME_PAGE, { push: false });
  }, [nav, openLink]);

  const canLaunch = true;
  const canMonitor = inDemo || Boolean(sessionId || runId);
  const canResults = true;
  const bare = page === 'run' && runFull;

  return (
    <ThemeProvider>
    <div className="min-h-screen bg-bg text-text-primary relative">
      {!bare && <ParticleField count={40} />}

      {!bare && page !== 'landing' && page !== 'loading' && page !== 'setup' && (
        <Header
          page={page}
          setPage={nav}
          canLaunch={canLaunch}
          canMonitor={canMonitor}
          canResults={canResults}
          canImplement={Boolean(implementSessionId)}
        />
      )}
      {!bare && inDemo && page !== 'landing' && (
        <ShowcaseBar showcase={demo.showcase} showcases={showcases} onSwitch={openDemo} onGetStarted={() => nav('choose', { leaveDemo: true })} onLeave={() => nav('landing')} />
      )}

      <main className={transitioning ? 'page-exit' : 'page-enter'} key={page}>
        <ErrorBoundary key={page}>
        <Suspense fallback={<PageSpinner text="Opening the page..." />}>
        {page === 'loading' && <PageSpinner text="Connecting to workspace..." />}

        {page === 'setup' && (
          <SetupWizard settings={settings} update={update} onComplete={finishSetup} />
        )}

        {page === 'landing' && (
          <LandingPage
            onStart={() => nav('choose')}
            onOpenSetup={setupManaged ? undefined : () => nav('setup')}
          />
        )}

        {page === 'choose' && (
          <ChoosePage
            key={demoScope || 'workspace'}
            settings={pageSettings}
            onNewExperiment={() => nav('launch')}
            onNoData={() => nav('generate-data')}
            onDemo={showcases.length && !inDemo ? () => openDemo(showcases[0]) : undefined}
            onViewResults={(sid, rid) => {
              if (sid && !inDemo) setSessionId(sid);
              if (rid && !inDemo) {
                setRunId(rid);
                nav('monitor');
                return;
              }
              nav('results');
            }}
            onOpenBuild={openBuildFilter}
            onOpenUseCase={openImplement}
          />
        )}

        {page === 'generate-data' && (
          <GenerateDataPage
            settings={settings}
            onBack={() => nav('choose')}
            onLaunched={(sid, rid) => {
              setSessionId(sid);
              setRunId(rid);
              nav('monitor');
            }}
          />
        )}

        {page === 'launch' && (
          <LaunchPage
            settings={settings}
            update={update}
            onNoData={() => nav('generate-data')}
            onOpenResults={(sid) => {
              if (sid) setSessionId(sid);
              nav('results');
            }}
            onLaunched={onLaunched}
          />
        )}

        {page === 'monitor' && (
          <div className="max-w-7xl mx-auto px-6 py-8">
            <MonitorPage
              key={`${demoScope || 'workspace'}:${inDemo ? '' : runId ?? ''}`}
              settings={pageSettings}
              update={inDemo ? noop : update}
              sessionId={inDemo ? demo.showcase.session_id : sessionId}
              runId={inDemo ? null : runId}
              launchNotes={!inDemo && runId != null && launchNotes.runId === runId ? launchNotes.notes : []}
              launchDetails={!inDemo && runId != null && launchNotes.runId === runId ? launchNotes.details || [] : []}
              onComplete={() => nav('results')}
              onResultsSession={inDemo ? noop : onResultsSession}
              onOpenImplement={openImplement}
              onGenerateData={inDemo ? undefined : () => nav('generate-data')}
              onRunAgain={inDemo ? null : onLaunched}
            />
          </div>
        )}

        {page === 'results' && (
          <ErrorBoundary key="results">
            <div className={RESULTS_FRAME}>
              <ResultsPage
                key={demoScope || `workspace-${reviewLink.n}`}
                settings={pageSettings}
                update={inDemo ? noop : update}
                sessionId={inDemo ? demo.showcase.session_id : sessionId}
                onSessionChange={inDemo ? noop : onResultsSession}
                onOpenImplement={openImplement}
                link={inDemo ? null : reviewLink.link}
                notice={inDemo ? '' : reviewLink.notice}
              />
            </div>
          </ErrorBoundary>
        )}

        {page === 'implement' && implementSessionId && (
          <ErrorBoundary key="implement">
            <ImplementPage
              key={demoScope || implementSessionId}
              settings={pageSettings}
              sessionId={implementSessionId}
              focusId={implementFocus}
              focusStep={inDemo ? null : implement.step || null}
              onStepOpened={inDemo ? null : () => setImplement((prev) => ({ ...prev, step: null }))}
              onFocus={inDemo ? onDemoFocus : onImplementFocus}
              onOpenRun={inDemo ? null : openRun}
              demoMvps={demoMvps}
              filter={inDemo ? null : implement.filter || null}
              onPickRun={pickBuildRun}
              onClearFilter={clearBuildFilter}
            />
          </ErrorBoundary>
        )}

        {page === 'run' && (
          <ErrorBoundary key="run">
            <RunPage
              key={demoScope || `workspace-${runLink.n}`}
              settings={inDemo ? pageSettings : settings}
              focusId={inDemo ? demoRun : runFocus}
              onFocus={inDemo ? clearDemoRun : focusRun}
              onFull={setRunFull}
              showcase={inDemo ? demo.showcase : null}
              notice={inDemo ? '' : runLink.notice}
              onOpenBuild={inDemo ? null : openImplement}
            />
          </ErrorBoundary>
        )}
        </Suspense>
        </ErrorBoundary>
      </main>

      {!bare && page !== 'landing' && page !== 'setup' && <ScrollProgressRing />}
    </div>
    </ThemeProvider>
  );
}
