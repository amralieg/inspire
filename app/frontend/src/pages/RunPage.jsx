import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, AppWindow, ExternalLink, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { makeApiFetch } from '../lib/apiClient';
import { APP_INSIDE, APP_INSIDE_PLACEMENT } from '../lib/implementWizard';
import {
  RUN_BANNER, RUN_DEMO_KIND, RUN_DEMO_NOTE, RUN_EMPTY, RUN_OPEN_APP, RUN_POLL_MS, demoRunPages, runAppUrl, runFrameSrc, runGroups, runKey, runPicked,
  runPolling, runStateText, runUnknownText,
} from '../lib/runPages';
import { PANEL_CLASS } from '../components/BuildUi';

const STATE_TONE = { ready: 'text-success-fg', starting: 'text-text-secondary', stopped: 'text-text-secondary', failed: 'text-error-fg' };

function pageDetail(page) {
  if (page.kind === RUN_DEMO_KIND) return `${page.use_case_id} · MVP App`;
  return `${page.use_case_id} · v${page.version} · ${page.kind === APP_INSIDE ? APP_INSIDE_PLACEMENT.label : page.app_name}`;
}

function PageItem({ page, on, onPick }) {
  const framed = page.kind === APP_INSIDE || page.kind === RUN_DEMO_KIND;
  return (
    <li>
      <button type="button" onClick={() => onPick(runKey(page))} aria-current={on ? 'true' : undefined} data-run-page={runKey(page)}
        className={`w-full text-left rounded-lg border px-3 py-2 text-[12px] glow-focus ${on ? 'border-db-red/50 bg-db-red-50/40' : 'border-border hover:border-border-strong'}`}>
        <span className="flex items-center gap-1.5 font-semibold text-text-primary">
          {framed ? <PlayCircle size={13} aria-hidden /> : <AppWindow size={13} aria-hidden />} {page.name}
        </span>
        <span className="block text-text-secondary">{pageDetail(page)}</span>
      </button>
    </li>
  );
}

function DemoView({ page }) {
  return (
    <div className="space-y-2">
      <p role="note" aria-label="Demo" className="rounded-lg bg-info-bg px-3 py-2 text-[12px] font-medium text-info-fg ring-1 ring-inset ring-info/30">{RUN_DEMO_NOTE}</p>
      <iframe key={page.id} title={`${page.name}, MVP App`} src={runFrameSrc(page)} data-run-frame={page.id}
        className="w-full h-[72vh] rounded-xl border border-border bg-surface" />
    </div>
  );
}

function HostedView({ page, userAuthorization, note }) {
  const src = runFrameSrc(page);
  return (
    <div className="space-y-2">
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
      {src && (
        <iframe key={`${page.id}:${page.version}`} title={`${page.name}, ${APP_INSIDE_PLACEMENT.label}`} src={src} data-run-frame={page.id}
          className="w-full h-[72vh] rounded-xl border border-border bg-surface" />
      )}
    </div>
  );
}

function OwnAppView({ page }) {
  const url = runAppUrl(page);
  return (
    <div className="space-y-2 text-[12px]">
      <p className="text-text-secondary">{page.name} runs in its own App, {page.app_name}.</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" data-run-open-app={page.app_name}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:opacity-90">
          {RUN_OPEN_APP} <ExternalLink size={11} />
        </a>
      ) : (
        <p className="text-text-secondary">Inspire has no link to this App yet.</p>
      )}
    </div>
  );
}

export default function RunPage({ settings, focusId = null, onFocus = () => {}, showcase = null, notice = '' }) {
  const { token, databricksHost, inspireDatabase, warehouseId } = settings || {};
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost }), [token, databricksHost]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(focusId ? `${APP_INSIDE}:${focusId}` : '');
  const [asked, setAsked] = useState(focusId);
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
  const chosen = runPicked(pages, picked);
  const chosenKey = chosen ? runKey(chosen) : '';
  const polling = runPolling(pages, chosenKey);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(load, RUN_POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, data, load]);
  const missing = asked != null && Boolean(data) && !pages.some((p) => p.kind === APP_INSIDE && p.id === asked);
  const pick = (key) => {
    setPicked(key);
    setAsked(null);
    onFocus(key.startsWith(`${APP_INSIDE}:`) ? key.slice(APP_INSIDE.length + 1) : null);
  };
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
            {chosen && chosen.kind === APP_INSIDE && <HostedView page={chosen} userAuthorization={shown.user_authorization !== false} note={shown.user_authorization_note} />}
            {chosen && chosen.kind === RUN_DEMO_KIND && <DemoView page={chosen} />}
            {chosen && chosen.kind !== APP_INSIDE && chosen.kind !== RUN_DEMO_KIND && <OwnAppView page={chosen} />}
          </section>
        </div>
      )}
    </div>
  );
}
