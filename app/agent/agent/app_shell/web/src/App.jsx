import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getApp, getDefaults, getFilters, getOverview, getSummary } from './api.js';
import { applyTheme, hueVars, rememberPalette, storedPalette } from './theme.js';
import { initialFilterState } from './filters.js';
import { GenieMark, Icon } from './icons.jsx';
import { ToastProvider } from './ui.jsx';
import Page from './Page.jsx';
import Home, { hubToday } from './Home.jsx';
import Impact from './Impact.jsx';
import MyWorkPage from './MyWorkPage.jsx';
import { MY_WORK_ROUTE } from './mywork.js';
import Admin, { AdminLink } from './Admin.jsx';
import { ADMIN_ROUTE } from './admin.js';
import GeniePanel, { useGenie } from './Genie.jsx';
import { GenieScope, GenieState } from './AskGenie.jsx';
import { buildHash, parseHash } from './links.js';
import { useUnknownPageNotice } from './PageLink.jsx';
import PaletteButton from './Palette.jsx';
import { MyViewProvider, useMyView } from './MyView.jsx';
import { windowParams } from './prefs.js';
import { DEFAULT_VIEW, hubTimes, useCaseState, visiblePages } from './hub.js';
import logo from './databricks-logo.png?inline';

const THEME_KEY = 'inspire-app-theme';
const HUB_ROUTES = ['home', 'overview', MY_WORK_ROUTE, 'impact', 'results', ADMIN_ROUTE];
const IMPACT_ROUTES = ['impact', 'results'];
const TONES = { stale: 'bad', error: 'bad', wait: 'warn' };
const HUB_SCOPES = { overview: { page: 'overview', filters: '' }, impact: { page: 'impact', filters: '' } };

function readRoute() {
  return parseHash(window.location.hash).route;
}

function initials(user) {
  const source = user?.name || user?.email || '';
  const parts = source.split(/[@.\s_-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}

function useFavicon() {
  useLayoutEffect(() => {
    const link = document.querySelector('link[rel="icon"]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
    link.type = 'image/png';
    link.href = logo;
  }, []);
}

function Fatal({ error }) {
  return (
    <div className="fatal" role="alert">
      <span className="mark-tile"><Icon name="info" size={18} /></span>
      <h1>{error.status === 401 ? 'Sign in to see this App' : 'This App could not start'}</h1>
      <p>{error.message}</p>
    </div>
  );
}

function NavItem({ on, icon, title, small, tone, hue, onClick }) {
  return (
    <button className={`nav-i ${on ? 'is-on' : ''}`} onClick={onClick} style={hueVars(hue)} aria-current={on ? 'page' : undefined}>
      <span className="nav-ic"><Icon name={icon} size={15} /></span>
      <span className="nav-t"><b>{title}</b>{small && <small className={tone || ''}>{small}</small>}</span>
    </button>
  );
}

function startedFrom(state, filters) {
  if (!state.defaults || Object.values(state.sel || {}).some((values) => values?.length)) return false;
  return JSON.stringify(initialFilterState(filters).range) !== JSON.stringify(state.range);
}

function useHub(pages, asked) {
  const [hub, setHub] = useState(null);
  const [error, setError] = useState('');
  const [summaries, setSummaries] = useState({});
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    getOverview(JSON.parse(asked)).then((data) => { if (mine === seq.current) { setHub(data); setError(''); } })
      .catch((e) => { if (mine === seq.current) setError(e.message); });
  }, [asked]);
  useEffect(() => {
    pages.filter((p) => p.history).forEach((p) => {
      getSummary(p.id).then((s) => setSummaries((x) => ({ ...x, [p.id]: s }))).catch((e) => setSummaries((x) => ({ ...x, [p.id]: { run: null, categories: {}, error: e.message } })));
    });
  }, [pages]);
  return { hub, error, summaries, load };
}

function Shell({ app }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || app.theme; } catch { return app.theme; }
  });
  const [palette, setPalette] = useState(() => storedPalette(app.palette));
  const [route, setRoute] = useState(readRoute);
  const [metas, setMetas] = useState({});
  const [states, setStates] = useState({});
  const [navOpen, setNavOpen] = useState(false);
  const [genieOpen, setGenieOpen] = useState(false);
  const [view, setView] = useState(DEFAULT_VIEW);
  const { prefs } = useMyView();
  const pages = app.pages;
  const single = pages.length === 1;
  const routed = pages.find((p) => p.id === route);
  const impactOn = app.screens?.impact !== false;
  const screen = route === ADMIN_ROUTE ? 'admin' : routed ? 'page' : route === MY_WORK_ROUTE ? 'mywork'
    : impactOn && IMPACT_ROUTES.includes(route) ? 'impact' : single ? 'page' : 'overview';
  const page = screen === 'page' ? routed || pages[0] : null;
  const genie = useGenie(app, page ? page.id : screen, () => setGenieOpen(true));
  const genieState = useMemo(() => ({ app, busy: genie.busy }), [app, genie.busy]);
  const { hub, error: hubError, summaries, load: loadHub } = useHub(pages, JSON.stringify(windowParams(prefs)));
  const shown = visiblePages(pages, hub);

  useFavicon();
  useLayoutEffect(() => { applyTheme(palette, theme, app.style); }, [palette, app.style, theme]);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const named = { impact: 'Impact', admin: 'Admin', mywork: 'My work' }[screen];
    document.title = page ? `${page.title} · ${app.title}` : named ? `${named} · ${app.title}` : app.title;
  }, [page, screen, app.title]);
  useEffect(() => { if (screen !== 'page') loadHub(); }, [screen, loadHub]);
  useUnknownPageNotice(route, pages, HUB_ROUTES);
  useEffect(() => {
    if (!navOpen) return undefined;
    const key = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navOpen]);

  const requested = useRef(new Set());
  const loadMeta = useCallback((id) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    const settle = (meta) => {
      setMetas((x) => ({ ...x, [id]: meta }));
      setStates((s) => (s[id] && !startedFrom(s[id], meta.filters) ? s : { ...s, [id]: initialFilterState(meta.filters) }));
    };
    const start = (found) => {
      if (found?.range) setStates((s) => (s[id] ? s : { ...s, [id]: { range: found.range, sel: {}, defaults: true } }));
    };
    getDefaults(id).then(start).catch(() => {});
    getFilters(id).then(settle).catch((error) => settle({ filters: [], error: error.message }));
  }, []);
  useEffect(() => { if (page) loadMeta(page.id); }, [page, loadMeta]);

  const leave = () => { setNavOpen(false); document.querySelector('.main')?.focus(); };
  const go = (id) => { window.location.hash = `#/${id}`; leave(); };
  const openRecord = (pageId, key) => { window.location.hash = buildHash(pageId, 'overview', null, [], key); leave(); };
  const restyle = (nextPalette, nextTheme) => {
    applyTheme(nextPalette, nextTheme, app.style);
    setPalette(nextPalette);
    setTheme(nextTheme);
  };
  const choosePalette = (next) => { restyle(next, theme); rememberPalette(next, app.palette); };
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    restyle(palette, next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode keeps the choice for this visit */ }
  };
  const ask = (q) => { setGenieOpen(true); genie.ask(q); };
  const explain = (request) => { setGenieOpen(true); genie.explain(request); };
  const setPageState = (id) => (next) => setStates((s) => ({ ...s, [id]: next }));
  const themeKey = `${palette}:${theme}:${app.style}`;
  const times = hubTimes(shown.map((p) => hub?.pages?.[p.id]), hubToday(hub));
  const state = (p) => useCaseState(hub?.pages?.[p.id], summaries[p.id]);
  const impactTab = <button className={`tab ${screen === 'impact' ? 'is-on' : ''}`} onClick={() => go('impact')} aria-current={screen === 'impact' ? 'page' : undefined}><Icon name="trend" size={14} />Impact</button>;
  const impactItem = <NavItem on={screen === 'impact'} icon="trend" title="Impact" small={single ? 'What the use case delivered' : 'What the use cases delivered'} hue="green" onClick={() => go('impact')} />;
  const workTab = <button className={`tab ${screen === 'mywork' ? 'is-on' : ''}`} onClick={() => go(MY_WORK_ROUTE)} aria-current={screen === 'mywork' ? 'page' : undefined}><Icon name="check" size={14} />My work</button>;
  const workItem = <NavItem on={screen === 'mywork'} icon="check" title="My work" small="What you did, and when" hue="teal" onClick={() => go(MY_WORK_ROUTE)} />;

  return (
    <GenieState.Provider value={genieState}>
    <div className="stage">
      <div className="app" data-layout={app.layout} data-density={prefs.density}>
        <header className="top">
          <button className="ibtn menu-btn" onClick={() => setNavOpen(!navOpen)} aria-label="Open the use case list" aria-expanded={navOpen}><Icon name="menu" size={18} /></button>
          <button className="mark" onClick={() => go(single ? pages[0].id : 'overview')} aria-label={`${app.title}, home`}>
            <span className="mark-tile logo"><img src={logo} alt="Databricks" width="22" height="22" /></span>
            <span className="mark-t"><b>{app.title}</b><small>{times || app.subtitle || `${pages.length} use case${single ? '' : 's'} · built by Inspire`}</small></span>
          </button>
          {app.layout === 'tabs' && (
            <nav className="tabs" aria-label="Use cases">
              {!single && <button className={`tab ${screen === 'overview' ? 'is-on' : ''}`} onClick={() => go('overview')} aria-current={screen === 'overview' ? 'page' : undefined}><Icon name="home" size={14} />Overview</button>}
              {!single && workTab}
              {!single && impactOn && impactTab}
              {shown.map((p) => <button key={p.id} className={`tab ${page?.id === p.id ? 'is-on' : ''}`} onClick={() => go(p.id)} aria-current={page?.id === p.id ? 'page' : undefined}><Icon name={p.icon} size={14} />{p.title}</button>)}
              {single && workTab}
              {single && impactOn && impactTab}
            </nav>
          )}
          <span className="sp" />
          {app.auth === 'user'
            ? <span className="auth" title="Each person sees only the rows and columns their Unity Catalog grants allow. The App queries as you."><Icon name="lock" size={13} />Your view</span>
            : <span className="auth" title="Everyone sees the same data. The App reads it with its own service principal."><Icon name="users" size={13} />Shared view</span>}
          <button className="genie-btn" onClick={() => setGenieOpen(!genieOpen)} aria-expanded={genieOpen} aria-label="Ask Genie"><GenieMark size={15} /><span>Ask Genie</span></button>
          <PaletteButton palette={palette} built={app.palette} theme={theme} onChoose={choosePalette} />
          <button className="ibtn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button>
          {app.is_owner === true && <AdminLink on={screen === 'admin'} />}
          {(app.user.email || app.user.name) && <span className="avatar" title={app.user.email || app.user.name} aria-hidden="true">{initials(app.user)}</span>}
        </header>
        <div className="body">
          <nav className={`side ${navOpen ? 'is-open' : ''}`} aria-label="Use cases">
            {!single && <NavItem on={screen === 'overview'} icon="home" title="Overview" small="All use cases" hue="slate" onClick={() => go('overview')} />}
            {!single && workItem}
            {!single && impactOn && impactItem}
            {!single && <div className="side-sep" />}
            <div className="side-h">{single ? 'Use case' : 'Use cases'}</div>
            {shown.map((p) => (
              <NavItem key={p.id} on={page?.id === p.id} icon={p.icon} title={p.title} hue={p.hue || 'blue'} onClick={() => go(p.id)}
                small={state(p).text || [p.use_case_id, p.domain].filter(Boolean).join(' · ')} tone={TONES[state(p).kind]} />
            ))}
            {single && <div className="side-sep" />}
            {single && workItem}
            {single && impactOn && impactItem}
          </nav>
          {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
          <main className="main" tabIndex={-1}>
            {screen === 'overview' && <GenieScope.Provider value={HUB_SCOPES.overview}><Home app={app} hub={hub} hubError={hubError} summaries={summaries} view={view} onView={setView} onOpen={go} onRecord={openRecord}
              onChanges={(id) => { window.location.hash = `#/${encodeURIComponent(id)}?changed=1`; leave(); }} onMyWork={() => go(MY_WORK_ROUTE)} /></GenieScope.Provider>}
            {screen === 'mywork' && <MyWorkPage app={app} hub={hub} hubError={hubError} summaries={summaries} onRecord={openRecord} />}
            {screen === 'impact' && (
              <GenieScope.Provider value={HUB_SCOPES.impact}>
                <Impact app={app} hub={hub} hubError={hubError} summaries={summaries} onOpen={go} onExplain={explain} genieBusy={genie.busy} />
              </GenieScope.Provider>
            )}
            {screen === 'admin' && <Admin />}
            {page && (
              <Page key={page.id} app={app} page={page} meta={metas[page.id]} state={states[page.id]} onState={setPageState(page.id)} themeKey={themeKey}
                onAsk={ask} onExplain={explain} genieBusy={genie.busy} hubEntry={hub?.pages?.[page.id]} summary={summaries[page.id]} view={view} onView={setView} />
            )}
          </main>
          {genieOpen && <GeniePanel app={app} genie={genie} page={page} pages={shown} onPick={go} onClose={() => setGenieOpen(false)} />}
        </div>
      </div>
    </div>
    </GenieState.Provider>
  );
}

export default function App() {
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { getApp().then(setApp).catch(setError); }, []);
  useLayoutEffect(() => { if (!app) applyTheme('default', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', 'a'); }, [app]);
  return (
    <ToastProvider>
      {error ? <Fatal error={error} /> : app ? <MyViewProvider person={app.user?.email || app.user?.name}><Shell app={app} /></MyViewProvider>
        : <div className="boot" role="status"><span className="ring" /><span>Opening the App…</span></div>}
    </ToastProvider>
  );
}
