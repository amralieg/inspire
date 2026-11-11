import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WAITING_FOR_ACCESS_CODE, getApp, getDefaults, getFilters, getOverview, getSummary } from './api.js';
import { applyTheme, hueVars, rememberPalette, storedPalette } from './theme.js';
import { apiValues, initialFilterState } from './filters.js';
import { AGENT_OPEN, EMPTY_LOOK, applyActions, changesView, visibleOf, topFact } from './agentView.js';
import { GenieMark, Icon } from './icons.jsx';
import { NoAccessScope, PlainNote, RetryProvider, ToastProvider, useToast } from './ui.jsx';
import Page from './Page.jsx';
import WaitingForAccess from './WaitingForAccess.jsx';
import { isQueue, pageSections } from './Layouts.jsx';
import { pageMode, performanceOn, sectionTitle } from './modes.js';
import ModeView from './ModeView.jsx';
import { inboxOn } from './inbox.js';
const Admin = lazy(() => import('./Admin.jsx'));
import { ADMIN_ROUTE } from './admin.js';
import GeniePanel, { useGenie } from './Genie.jsx';
import { GenieScope, GenieState } from './AskGenie.jsx';
import { DockContext, DockTabs, RecordDock } from './Dock.jsx';
import Switcher, { UseCases } from './Switcher.jsx';
import { LINK_STALE, UNKNOWN_PAGE, canonicalHash, parseHash, sectionHash, staleSection, unknownRoute, withRecord, workRecordHash } from './links.js';
import { MyViewProvider, useMyView } from './MyView.jsx';
import { windowParams } from './prefs.js';
import { DEFAULT_VIEW, visiblePages } from './hub.js';
import logo from './databricks-logo.png?inline';
import { integer } from './format.js';
import { markTourSeen, tourDue, tourKey } from './tourStart.js';
import { HelpContext } from './SectionHelp.jsx';

const Tour = lazy(() => import('./Tour.jsx'));
const Performance = lazy(() => import('./Performance.jsx'));

const THEME_KEY = 'inspire-app-theme';
const RAIL_ICONS = { dashboard: 'grid', inbox: 'bell', work: 'check', performance: 'trend', runs: 'history', alerts: 'bell', impact: 'trend', feedback: 'info', reports: 'history', settings: 'sliders' };

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

function Fatal({ error, onRetry }) {
  return (
    <div className="fatal" role="alert">
      <span className="mark-tile"><Icon name="info" size={18} /></span>
      <h1>{error.status === 401 ? 'Sign in to see this App' : 'This App could not start'}</h1>
      <PlainNote text={error.message} onRetry={onRetry} />
    </div>
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
      .catch((e) => { if (mine === seq.current) setError(e); });
  }, [asked]);
  const summarize = useCallback((id) => getSummary(id).then((s) => setSummaries((x) => ({ ...x, [id]: s })))
    .catch((e) => setSummaries((x) => ({ ...x, [id]: { run: null, categories: {}, error: e.message } }))), []);
  useEffect(() => {
    pages.filter((p) => p.history).forEach((p) => summarize(p.id));
  }, [pages, summarize]);
  return { hub, error, summaries, load, summarize };
}

function railOf(app, page) {
  const inbox = inboxOn(app, page);
  const sections = pageSections(app, page);
  const all = inbox ? [sections[0], 'inbox', ...sections.slice(1)] : sections;
  const at = (sections.includes('work') ? 2 : 1) + (inbox ? 1 : 0);
  return [...all.slice(0, at), ...(performanceOn(app) ? ['performance'] : []), ...all.slice(at)];
}

function SectionRail({ sections, on, onGo, open, page, counts = {}, alerting }) {
  const top = sections.filter((s) => s !== 'settings');
  const toured = (s) => (s === 'runs' && alerting && !sections.includes('alerts') ? 'alerts' : ['performance', 'alerts', 'runs', 'settings'].includes(s) ? s : undefined);
  const item = (s) => (
    <button key={s} type="button" className={`nav-i rail-i ${on === s ? 'is-on' : ''}`} onClick={() => onGo(s)} aria-current={on === s ? 'page' : undefined} data-rail={s}
      data-tour={toured(s)}
      aria-label={counts[s] != null ? `${sectionTitle(page, s)} (${integer(counts[s])})` : undefined}>
      <span className="nav-ic"><Icon name={RAIL_ICONS[s]} size={15} /></span>
      <span className="nav-t"><b>{sectionTitle(page, s)}</b></span>
      {counts[s] != null && <small className="rail-n" data-count={counts[s]}>{integer(counts[s])}</small>}
    </button>
  );
  return (
    <nav className={`side rail ${open ? 'is-open' : ''}`} aria-label={page ? `Sections of ${page.title}` : 'Sections'} style={hueVars(page?.hue || 'blue')}>
      {top.map(item)}
      <span className="sp" />
      {sections.includes('settings') && <div className="rail-foot">{item('settings')}</div>}
    </nav>
  );
}

function Shell({ app, onRefreshSiblings }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || app.theme; } catch { return app.theme; }
  });
  const [palette, setPalette] = useState(() => storedPalette(app.palette));
  const { prefs, update } = useMyView();
  const pages = app.pages;
  const known = useRef({ pages, last: prefs.last });
  known.current = { pages, last: prefs.last };
  const missed = useRef('');
  const resolve = useCallback(() => {
    const before = window.location.hash;
    if (unknownRoute(parseHash(before).route, known.current.pages)) missed.current = UNKNOWN_PAGE;
    const next = canonicalHash(before, { pages: known.current.pages, last: known.current.last, sectionsOf: (p) => railOf(app, p), queueOf: (p) => pageMode(p).queue });
    if (next) window.history.replaceState(window.history.state, '', next);
    if (next && staleSection(before, next)) missed.current = LINK_STALE;
    return parseHash(window.location.hash);
  }, []);
  const [link, setLink] = useState(resolve);
  const route = link.route;
  const [metas, setMetas] = useState({});
  const [states, setStates] = useState({});
  const [looks, setLooks] = useState({});
  const viewNow = useRef({});
  viewNow.current = { states, looks, metas };
  const agentView = useMemo(() => ({
    context: (id) => {
      const { states: st, looks: lk } = viewNow.current;
      return { view: { filters: apiValues(st[id]), columns: st[id]?.columns || {}, look: lk[id] || EMPTY_LOOK }, visible: visibleOf(id) };
    },
    apply: (id, actions) => {
      const { states: st, looks: lk, metas: mt } = viewNow.current;
      const before = { state: st[id] || initialFilterState(mt[id]?.filters), look: lk[id] || EMPTY_LOOK, hash: window.location.hash };
      const next = applyActions(before, actions, mt[id]?.filters);
      const restyled = changesView(actions);
      if (restyled) {
        setStates((s) => ({ ...s, [id]: next.state }));
        setLooks((l) => ({ ...l, [id]: next.look }));
      }
      if (next.route) window.location.hash = next.route;
      if (next.open) window.dispatchEvent(new CustomEvent(AGENT_OPEN, { detail: next.open }));
      return () => {
        if (restyled) {
          setStates((s) => ({ ...s, [id]: before.state }));
          setLooks((l) => ({ ...l, [id]: before.look }));
        }
        if (next.route) window.location.hash = before.hash || '#/';
      };
    },
  }), []);
  const [navOpen, setNavOpen] = useState(false);
  const [railCounts, setRailCounts] = useState({});
  const [genieOpen, setGenieOpen] = useState(false);
  const [dockSlot, setDockSlot] = useState(null);
  const [showing, setShowing] = useState(false);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [touring, setTouring] = useState('');
  const [tourFacts, setTourFacts] = useState({});
  const [helping, setHelping] = useState(null);
  const admin = route === ADMIN_ROUTE;
  const page = pages.find((p) => p.id === route) || (admin ? pages.find((p) => p.id === prefs.last) || pages[0] : null);
  const section = admin ? '' : (link.section === 'performance' && !performanceOn(app) ? 'dashboard' : link.section);
  const sectionsHere = page ? railOf(app, page) : [];
  const inboxOff = railCounts.page === page?.id && railCounts.inboxOff;
  const rail = sectionsHere.filter((s) => !(s === 'alerts' && sectionsHere.includes('runs')) && !(s === 'inbox' && inboxOff));
  const mode = pageMode(page);
  const working = !admin && section === 'work' && !!page && mode.queue;
  const fullChat = !admin && section === 'work' && !!page && mode.id === 'ask';
  const dock = working ? prefs.dock : '';
  const setDock = useCallback((next) => update((p) => ({ ...p, dock: next })), [update]);
  const openGenie = () => (fullChat ? null : working ? setDock('genie') : setGenieOpen(true));
  const genie = useGenie(app, page ? page.id : '', openGenie, agentView);
  const genieState = useMemo(() => ({ app, busy: genie.busy }), [app, genie.busy]);
  const { hub, error: hubError, summaries, load: loadHub, summarize } = useHub(pages, JSON.stringify(windowParams(prefs)));
  const hubWaiting = hubError && hubError.code === WAITING_FOR_ACCESS_CODE ? hubError : null;
  const shown = visiblePages(pages, hub);
  const toast = useToast();

  useFavicon();
  useLayoutEffect(() => { applyTheme(palette, theme, app.style); }, [palette, app.style, theme]);
  useEffect(() => {
    const onHash = () => setLink(resolve());
    window.addEventListener('hashchange', onHash, true);
    return () => window.removeEventListener('hashchange', onHash, true);
  }, [resolve]);
  useEffect(() => {
    if (!missed.current) return;
    const said = missed.current;
    missed.current = '';
    toast(said);
  }, [link, toast]);
  useEffect(() => {
    if (page && !admin && prefs.last !== page.id) update((p) => ({ ...p, last: page.id }));
  }, [page?.id, admin]);
  const person = app.user?.email || app.user?.name || '';
  const tourAt = page && !admin && page.tour ? tourKey(person, page.id, page.tour.version) : '';
  useEffect(() => {
    if (!tourAt || touring || !tourDue(tourAt)) return;
    markTourSeen(tourAt);
    setTouring(page.id);
  }, [tourAt]);
  const takeTour = useCallback(() => { if (tourAt) { markTourSeen(tourAt); setHelping(null); setTouring(page.id); } }, [tourAt, page?.id]);
  const startHelp = useCallback((help) => { setTouring(''); setHelping(help); }, []);
  const keepFacts = useCallback((id, facts) => setTourFacts((x) => (JSON.stringify(x[id]) === JSON.stringify(facts) ? x : { ...x, [id]: facts })), []);
  useEffect(() => {
    document.title = admin ? `Admin · ${app.title}` : page ? `${page.title} · ${app.title}` : app.title;
  }, [page, admin, app.title]);
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
  const retryMeta = useCallback((id) => { requested.current.delete(id); loadMeta(id); }, [loadMeta]);
  useEffect(() => { if (page) loadMeta(page.id); }, [page, loadMeta]);

  const leave = () => { setNavOpen(false); document.querySelector('.main')?.focus(); };
  const go = (id) => { window.location.hash = `#/${encodeURIComponent(id)}`; leave(); };
  const goSection = (s) => {
    const f = parseHash(window.location.hash).f;
    if (page) window.location.hash = sectionHash(page.id, s, new URLSearchParams(f && link.route === page.id ? { f } : {}));
    if (navOpen) leave();
  };
  const openRecord = (pageId, key) => {
    const target = pages.find((p) => p.id === pageId);
    if (target && isQueue(target)) {
      setDock('record');
      window.location.hash = workRecordHash(pageId, key);
    } else window.location.hash = withRecord(`#/${encodeURIComponent(pageId)}`, key);
    leave();
  };
  const perfScope = useMemo(() => ({ page: page?.id || '', filters: '' }), [page?.id]);
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
  const ask = (q) => { openGenie(); genie.ask(q); };
  const explain = (request) => { openGenie(); genie.explain(request); };
  const setPageState = (id) => (next) => setStates((s) => ({ ...s, [id]: next }));
  const setPageLook = (id) => (change) => setLooks((l) => ({ ...l, [id]: change(l[id] || EMPTY_LOOK) }));
  const themeKey = `${palette}:${theme}:${app.style}`;
  const crumb = page ? [page.domain, page.subdomain].filter(Boolean).join(' › ') : '';
  const chrome = { palette, built: app.palette, theme, onPalette: choosePalette, onTheme: toggleTheme };
  const genieShown = fullChat || (working ? dock === 'genie' : genieOpen);
  const toggleGenie = () => (fullChat ? document.querySelector('[data-genie-full] .g-in input')?.focus() : working ? setDock(dock === 'genie' ? '' : 'genie') : setGenieOpen(!genieOpen));
  const dockValue = useMemo(() => (working ? { slot: dockSlot, tab: dock, onTab: setDock, onShowing: setShowing } : null), [working, dockSlot, dock, setDock]);
  const tabs = working ? <DockTabs tab={dock} onTab={setDock} /> : null;
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current === working) return;
    wasWorking.current = working;
    if (working && genieOpen) {
      setDock('genie');
      setGenieOpen(false);
    } else if (!working && prefs.dock === 'genie') {
      setGenieOpen(true);
    }
  }, [working]);
  const genieProps = { app, genie, page, pages: shown, onPick: go, fact: page ? topFact(page, tourFacts[page.id]) : '' };

  return (
    <GenieState.Provider value={genieState}>
    <DockContext.Provider value={dockValue}>
    <HelpContext.Provider value={startHelp}>
    <div className="stage">
      <div className="app" data-ready="" data-layout={app.layout} data-density={prefs.density}>
        <header className="top">
          <button className="ibtn menu-btn" onClick={() => setNavOpen(!navOpen)} aria-label="Open the sections" aria-expanded={navOpen}><Icon name="menu" size={18} /></button>
          <button className="mark" onClick={() => go('')} aria-label={`${app.title}, home`} title={crumb ? `${app.title}\n${crumb}` : app.title}>
            <span className="mark-tile logo"><img src={logo} alt="Databricks" width="22" height="22" /></span>
            <span className="mark-t"><b>{app.title}</b><small>{crumb || app.subtitle || `${pages.length} use case${pages.length === 1 ? '' : 's'} · built by Inspire`}</small></span>
          </button>
          <Switcher pages={shown} page={page} hub={hub} summaries={summaries} onPick={go} onOpen={loadHub} />
          <span className="sp" />
          <button className="genie-btn" data-tour="genie" onClick={toggleGenie} aria-expanded={genieShown} aria-label="Ask Genie"><GenieMark size={15} /><span>Ask Genie</span></button>
          <UseCases pages={shown} page={page} hub={hub} summaries={summaries} onPick={go} onOpen={() => { loadHub(); onRefreshSiblings?.(); }} siblings={app.siblings || []} />
          {(app.user.email || app.user.name) && <span className="avatar" title={app.user.email || app.user.name} aria-hidden="true">{initials(app.user)}</span>}
          {page && !admin && <button type="button" className="ibtn tour-top" onClick={takeTour} disabled={!page.tour} data-tour-top aria-label="Take the guided tour again" title="Take the guided tour again"><Icon name="info" size={16} /></button>}
        </header>
        <div className="body">
          {page && <SectionRail sections={rail} on={section === 'alerts' && !rail.includes('alerts') ? 'runs' : section} onGo={goSection} open={navOpen} page={page}
            counts={railCounts.page === page.id ? railCounts : {}} alerting={!!app.alerting?.on} />}
          {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
          <main className="main" tabIndex={-1}>
            <NoAccessScope key={page ? `page:${page.id}` : admin ? 'admin' : 'home'} app={app}>
            <RetryProvider value={loadHub}>
            {admin && <Suspense fallback={null}><Admin /></Suspense>}
            {!admin && !page && hubWaiting && <WaitingForAccess waiting={hubWaiting.detail} onCheck={loadHub} />}
            {!admin && page && section === 'performance' && (
              <GenieScope.Provider value={perfScope}>
                <ModeView key={page.id} mode={mode.id} part="Performance" app={app} page={page} genie={genie}
                  fallback={<Performance key={page.id} app={app} page={page} summary={summaries[page.id]} onRecord={openRecord} onExplain={explain} genieBusy={genie.busy} />} />
              </GenieScope.Provider>
            )}
            {!admin && page && section !== 'performance' && (
              <Page key={page.id} app={app} page={page} meta={metas[page.id]} state={states[page.id]} onState={setPageState(page.id)} look={looks[page.id] || EMPTY_LOOK}
                onLook={setPageLook(page.id)} themeKey={themeKey} onAsk={ask} onExplain={explain} genieBusy={genie.busy} hubEntry={hub?.pages?.[page.id]}
                summary={summaries[page.id]} view={view} onView={setView} genie={genie} section={section} tab={link.tab} focus={link.focus} chrome={chrome}
                onCounts={setRailCounts} onRecord={openRecord} onRetryMeta={() => retryMeta(page.id)} onRetrySummary={() => summarize(page.id)}
                onTour={page.tour ? takeTour : null} onTourFacts={keepFacts} />
            )}
            </RetryProvider>
            </NoAccessScope>
          </main>
          {working && dock === 'genie' && <GeniePanel {...genieProps} tabs={tabs} onClose={() => setDock('')} />}
          {working && dock === 'record' && <RecordDock tabs={tabs} onSlot={setDockSlot} onClose={() => setDock('')} empty={!showing} />}
          {!working && !fullChat && genieOpen && <GeniePanel {...genieProps} onClose={() => setGenieOpen(false)} />}
        </div>
        {page && (helping || touring === page.id) && page.tour && (
          <Suspense fallback={null}>
            <Tour key={`${page.id}:${page.tour.version}:${helping ? 'help' : 'tour'}`} tour={page.tour} help={helping} facts={tourFacts[page.id]} queue={isQueue(page)}
              section={section} onSection={goSection} onEnd={() => { setTouring(''); setHelping(null); }} />
          </Suspense>
        )}
      </div>
    </div>
    </HelpContext.Provider>
    </DockContext.Provider>
    </GenieState.Provider>
  );
}

export default function App() {
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const boot = useCallback(() => getApp().then((got) => { setError(null); setApp(got); }).catch(setError), []);
  const refreshSiblings = useCallback(() => getApp().then((got) => setApp((a) => (a ? { ...a, siblings: got.siblings || [] } : a))).catch(() => {}), []);
  useEffect(() => { boot(); }, [boot]);
  useLayoutEffect(() => { if (!app) applyTheme('default', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', 'a'); }, [app]);
  return (
    <ToastProvider>
      {error ? (error.code === WAITING_FOR_ACCESS_CODE ? <WaitingForAccess waiting={error.detail} onCheck={boot} /> : <Fatal error={error} onRetry={boot} />) : app ? <MyViewProvider person={app.user?.email || app.user?.name}><Shell app={app} onRefreshSiblings={refreshSiblings} /></MyViewProvider>
        : <div className="boot" role="status"><span className="ring" /><span>Opening the App…</span></div>}
    </ToastProvider>
  );
}
