import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, AppWindow, ArrowLeft, ExternalLink, Loader2, Maximize2, Menu, PlayCircle, RefreshCw } from 'lucide-react';
import { makeApiFetch } from '../lib/apiClient';
import { APP_INSIDE, APP_INSIDE_PLACEMENT } from '../lib/implementWizard';
import {
  RUN_BACK, RUN_BANNER, RUN_CONTROL, RUN_DEMO_KIND, RUN_DEMO_NOTE, RUN_EMPTY, RUN_FULL_STATE, RUN_NEW_TAB, RUN_OPEN, RUN_OPEN_APP, RUN_OPENING, RUN_POLL_MS,
  RUN_STATE_LABELS, RUN_SWITCH,
  demoRunPages, runAppUrl, runFrameSrc, runFramedPages, runFullPage, runGroups, runKey, runPicked, runPolling, runStateText, runUnknownText,
} from '../lib/runPages';
import { PANEL_CLASS } from '../components/BuildUi';
import BodyPortal from '../components/BodyPortal';

const STATE_TONE = { ready: 'text-success-fg', starting: 'text-text-secondary', stopped: 'text-text-secondary', failed: 'text-error-fg' };
const LINK_CLASS = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold';
const PRIMARY_CLASS = `${LINK_CLASS} text-white bg-db-red-solid hover:opacity-90`;
const SECONDARY_CLASS = `${LINK_CLASS} border border-border bg-surface text-text-primary hover:border-border-strong`;

function pageDetail(page) {
  if (page.kind === RUN_DEMO_KIND) return `${page.use_case_id} · MVP App`;
  return `${page.use_case_id} · v${page.version} · ${page.kind === APP_INSIDE ? APP_INSIDE_PLACEMENT.label : page.app_name}`;
}

function frameTitle(page) {
  return page.kind === RUN_DEMO_KIND ? `${page.name}, MVP App` : `${page.name}, ${APP_INSIDE_PLACEMENT.label}`;
}

function frameKey(page) {
  return page.kind === RUN_DEMO_KIND ? page.id : `${page.id}:${page.version}`;
}

function PageItem({ page, on, onPick }) {
  const framed = page.kind === APP_INSIDE || page.kind === RUN_DEMO_KIND;
  return (
    <li>
      <button type="button" onClick={() => onPick(page)} aria-current={on ? 'true' : undefined} data-run-page={runKey(page)}
        className={`w-full text-left rounded-lg border px-3 py-2 text-[12px] glow-focus ${on ? 'border-db-red/50 bg-db-red-50/40' : 'border-border hover:border-border-strong'}`}>
        <span className="flex items-center gap-1.5 font-semibold text-text-primary">
          {framed ? <PlayCircle size={13} aria-hidden /> : <AppWindow size={13} aria-hidden />} {page.name}
        </span>
        <span className="block text-text-secondary">{pageDetail(page)}</span>
      </button>
    </li>
  );
}

function FrameStatus({ page, userAuthorization, note }) {
  if (page.kind === RUN_DEMO_KIND) {
    return <p role="note" aria-label="Demo" className="rounded-lg bg-info-bg px-3 py-2 text-[12px] font-medium text-info-fg ring-1 ring-inset ring-info/30">{RUN_DEMO_NOTE}</p>;
  }
  return (
    <>
      <p role="note" aria-label="Inside Inspire" data-run-banner="" className="flex items-start gap-2 rounded-lg bg-warning-bg px-3 py-2 text-[12px] font-medium text-warning-fg ring-1 ring-inset ring-warning/30">
        <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> {RUN_BANNER}
      </p>
      <p data-run-state={page.state} className={`text-[12px] ${STATE_TONE[page.state] || 'text-text-secondary'}`}>
        {page.state === 'starting' && <Loader2 size={12} className="inline mr-1 motion-safe:animate-spin" aria-hidden />}
        {runStateText(page)}
      </p>
      {page.stderr && page.stderr.length > 0 && (
        <pre aria-label="The last lines the page wrote" data-run-stderr="" className="max-h-48 overflow-auto rounded-lg border border-border bg-bg-subtle p-2 text-[10px] font-mono text-text-secondary whitespace-pre-wrap">
          {page.stderr.join('\n')}
        </pre>
      )}
      {!userAuthorization && <p role="alert" data-run-no-token="" className="text-[12px] text-error-fg">{note}</p>}
    </>
  );
}

function NewTabLink({ page, className }) {
  return (
    <a href={runFrameSrc(page)} target="_blank" rel="noreferrer" data-run-new-tab={page.id} className={className}>
      {RUN_NEW_TAB} <ExternalLink size={11} aria-hidden />
    </a>
  );
}

function FrameDetail({ page, userAuthorization, note, onOpen }) {
  return (
    <div className="space-y-2">
      <FrameStatus page={page} userAuthorization={userAuthorization} note={note} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={() => onOpen(page)} data-run-open={page.id} className={PRIMARY_CLASS}>
          <Maximize2 size={11} aria-hidden /> {RUN_OPEN}
        </button>
        <NewTabLink page={page} className={SECONDARY_CLASS} />
      </div>
    </div>
  );
}

function OwnAppView({ page }) {
  const url = runAppUrl(page);
  return (
    <div className="space-y-2 text-[12px]">
      <p className="text-text-secondary">{page.name} runs in its own App, {page.app_name}.</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" data-run-open-app={page.app_name} className={PRIMARY_CLASS}>
          {RUN_OPEN_APP} <ExternalLink size={11} />
        </a>
      ) : (
        <p className="text-text-secondary">Inspire has no link to this App yet.</p>
      )}
    </div>
  );
}

function RunControl({ page, pages, userAuthorization, note, onSwitch, onBack }) {
  const attention = page.kind === APP_INSIDE && (page.state === 'failed' || !userAuthorization);
  const [open, setOpen] = useState(attention);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onBlur = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);
  const others = runFramedPages(pages);
  const busy = page.kind === APP_INSIDE && page.state !== 'ready';
  return (
    <div className="absolute left-3 bottom-3 z-10 flex flex-col items-start gap-2" data-run-control="">
      {open && (
        <div id="run-control-menu" aria-label={`${page.name}, ${pageDetail(page)}`} role="region"
          className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-5rem)] overflow-auto rounded-xl border border-border bg-surface p-3 space-y-2 shadow-elevated">
          <p className="text-[13px] font-semibold text-text-primary">{page.name}</p>
          <p className="text-[11px] text-text-secondary">{pageDetail(page)}</p>
          <FrameStatus page={page} userAuthorization={userAuthorization} note={note} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={onBack} data-run-back="" className={PRIMARY_CLASS}>
              <ArrowLeft size={11} aria-hidden /> {RUN_BACK}
            </button>
            <NewTabLink page={page} className={SECONDARY_CLASS} />
          </div>
          {others.length > 1 && (
            <nav aria-label={RUN_SWITCH} className="space-y-1 border-t border-border pt-2">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">{RUN_SWITCH}</h2>
              <ul className="space-y-1">
                {others.map((other) => {
                  const on = runKey(other) === runKey(page);
                  return (
                    <li key={runKey(other)}>
                      <button type="button" onClick={() => { setOpen(false); onSwitch(other); }} aria-current={on ? 'true' : undefined} data-run-switch={runKey(other)}
                        className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-[12px] ${on ? 'border-db-red/50 bg-db-red-50/40' : 'border-border hover:border-border-strong'}`}>
                        <span className="block font-semibold text-text-primary">{other.name}</span>
                        <span className="block text-text-secondary">{pageDetail(other)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="run-control-menu" aria-label={RUN_CONTROL} title={RUN_CONTROL}
        data-run-control-toggle=""
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-semibold text-text-primary shadow-elevated hover:border-border-strong glow-focus">
        <Menu size={13} aria-hidden /> Inspire
        {busy && (
          <span data-run-control-state={page.state} className={`inline-flex items-center gap-1 font-medium ${STATE_TONE[page.state] || 'text-text-secondary'}`}>
            {page.state === 'starting' && <Loader2 size={11} className="motion-safe:animate-spin" aria-hidden />}
            {RUN_STATE_LABELS[page.state] || RUN_STATE_LABELS.stopped}
          </span>
        )}
      </button>
    </div>
  );
}

function FullView({ page, pages, userAuthorization, note, onSwitch, onBack }) {
  return (
    <BodyPortal>
      <div data-run-full={runKey(page)} role="region" aria-label={frameTitle(page)} className="fixed inset-0 z-[90] bg-surface">
        <iframe key={frameKey(page)} title={frameTitle(page)} src={runFrameSrc(page)} data-run-frame={page.id} className="block h-full w-full border-0 bg-surface" />
        <RunControl key={runKey(page)} page={page} pages={pages} userAuthorization={userAuthorization} note={note} onSwitch={onSwitch} onBack={onBack} />
      </div>
    </BodyPortal>
  );
}

const ignore = () => {};

export default function RunPage({ settings, focusId = null, onFocus = ignore, onFull = ignore, showcase = null, notice = '' }) {
  const { token, databricksHost, inspireDatabase, warehouseId } = settings || {};
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost }), [token, databricksHost]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(focusId ? `${APP_INSIDE}:${focusId}` : '');
  const [asked, setAsked] = useState(focusId);
  const [demoFull, setDemoFull] = useState('');
  const [tick, setTick] = useState(0);
  const query = `inspire_database=${encodeURIComponent(inspireDatabase || '')}&warehouse_id=${encodeURIComponent(warehouseId || '')}`;
  useEffect(() => {
    if (showcase) return undefined;
    let cancelled = false;
    apiFetch(`/api/run/pages?${query}`)
      .then((got) => { if (!cancelled) { setData(got); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [apiFetch, query, tick, showcase]);
  const load = useCallback(() => setTick((n) => n + 1), []);
  const demoData = useMemo(() => (showcase ? { pages: demoRunPages(showcase), user_authorization: true } : null), [showcase]);
  const shown = demoData || data;
  const pages = useMemo(() => shown?.pages || [], [shown]);
  const wanted = showcase ? demoFull : focusId ? `${APP_INSIDE}:${focusId}` : '';
  const full = runFullPage(pages, wanted);
  const opening = Boolean(wanted) && !shown && !error;
  const chosen = full || runPicked(pages, picked);
  const chosenKey = chosen ? runKey(chosen) : '';
  const polling = runPolling(pages, chosenKey);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(load, RUN_POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, data, load]);
  const isFull = Boolean(full) || opening;
  useEffect(() => {
    onFull(isFull);
    return () => onFull(false);
  }, [isFull, onFull]);
  useEffect(() => {
    if (!showcase) return undefined;
    const onPop = () => {
      const key = window.history.state?.[RUN_FULL_STATE];
      setDemoFull(typeof key === 'string' && key.startsWith(`${RUN_DEMO_KIND}:`) ? key : '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showcase]);
  const missing = asked != null && Boolean(data) && !pages.some((p) => p.kind === APP_INSIDE && p.id === asked);
  const userAuthorization = shown?.user_authorization !== false;
  const note = shown?.user_authorization_note;
  const showDemo = (key, push) => {
    const state = { ...window.history.state, [RUN_FULL_STATE]: key };
    if (push) window.history.pushState(state, '', window.location.href);
    else window.history.replaceState(state, '', window.location.href);
    setDemoFull(key);
  };
  const show = (page, { push }) => {
    const key = runKey(page);
    setPicked(key);
    setAsked(null);
    if (page.kind === RUN_DEMO_KIND) showDemo(key, push);
    else onFocus(page.id, { push });
  };
  const open = (page) => show(page, { push: true });
  const pick = (page) => {
    if (runFrameSrc(page)) {
      open(page);
      return;
    }
    setPicked(runKey(page));
    setAsked(null);
    onFocus(null);
  };
  const back = () => {
    if (showcase) showDemo('', true);
    else onFocus(null, { push: true });
  };
  if (full) {
    return <FullView page={full} pages={pages} userAuthorization={userAuthorization} note={note} onSwitch={(page) => show(page, { push: false })} onBack={back} />;
  }
  if (opening) {
    return (
      <BodyPortal>
        <div data-run-opening="" className="fixed inset-0 z-[90] grid place-items-center bg-surface text-[12px] text-text-secondary">
          <p><Loader2 size={12} className="inline mr-1 animate-spin" aria-hidden /> {RUN_OPENING}</p>
        </div>
      </BodyPortal>
    );
  }
  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-4" data-run-page-root="">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Run</h1>
          <p className="text-[12px] text-text-secondary">Every deployed use case of this Inspire database, by business domain.</p>
        </div>
        {!showcase && (
          <button type="button" onClick={load} aria-label="Read the deployed use cases again" className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary">
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      {notice && <p role="note" data-run-left-demo="" className="text-[12px] text-text-secondary">{notice}</p>}
      {error && <p role="alert" className="text-[12px] text-error-fg">Inspire cannot list the deployed use cases: {error}</p>}
      {missing && <p role="note" data-run-unknown="" className="text-[12px] text-warning-fg">{runUnknownText(asked)}</p>}
      {!shown && !error && <p className="text-[12px] text-text-secondary"><Loader2 size={12} className="inline mr-1 animate-spin" aria-hidden /> Reading the deployed use cases</p>}
      {shown && !pages.length && <p data-run-empty="" className={`${PANEL_CLASS} p-6 text-[12px] text-text-secondary`}>{RUN_EMPTY}</p>}
      {pages.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
          <nav aria-label="Deployed use cases" className="space-y-3">
            {runGroups(pages).map((group) => (
              <section key={group.domain} aria-label={group.domain} data-run-domain={group.domain} className="space-y-1.5">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">{group.domain}</h2>
                <ul className="space-y-1.5">
                  {group.pages.map((page) => <PageItem key={runKey(page)} page={page} on={runKey(page) === chosenKey} onPick={pick} />)}
                </ul>
              </section>
            ))}
          </nav>
          <section aria-label={chosen ? chosen.name : 'Deployed use case'} className={`${PANEL_CLASS} p-4 space-y-3`}>
            {chosen && <h2 className="text-[15px] font-semibold text-text-primary">{chosen.name}</h2>}
            {chosen && runFrameSrc(chosen) && <FrameDetail page={chosen} userAuthorization={userAuthorization} note={note} onOpen={open} />}
            {chosen && !runFrameSrc(chosen) && (chosen.kind === APP_INSIDE || chosen.kind === RUN_DEMO_KIND) && (
              <FrameStatus page={chosen} userAuthorization={userAuthorization} note={note} />
            )}
            {chosen && chosen.kind !== APP_INSIDE && chosen.kind !== RUN_DEMO_KIND && <OwnAppView page={chosen} />}
          </section>
        </div>
      )}
    </div>
  );
}
