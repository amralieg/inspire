import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { generateDocs, markNewDocs } from './generateDocs.js';

// REQ-525: the documents run lives here, above the pages (next to ValueBulkRunProvider), so it survives hiding the dialog and leaving Results.
// One run at a time: { sessionId, plan, names, pages, files: { <file name>: { state, message } }, running, stopping, open }.
// A file's state is waiting, working, done, failed or stopped (Stop: not started).
const Ctx = createContext(null);

const NONE = { run: null, start: () => {}, stop: () => {}, show: () => {}, hide: () => {}, dismiss: () => {} };
export const useDocsRun = () => useContext(Ctx) || NONE;

export const docsCounts = (run) => {
  const states = Object.values(run?.files || {}).map((f) => f.state);
  return { done: states.filter((s) => s === 'done').length, failed: states.filter((s) => s === 'failed').length, stopped: states.filter((s) => s === 'stopped').length, total: run?.plan?.length || 0 };
};

export function DocsRunProvider({ children }) {
  const [run, setRun] = useState(null);
  const live = useRef({ token: 0, ctl: null, running: false });

  // `args` is what generateDocs takes (minus onFile and signal) plus names and pages for the dialog; onSaved runs once with the saved paths.
  const start = useCallback(({ names, pages, onSaved, ...args }) => {
    const L = live.current;
    if (L.running) return;
    L.running = true;
    L.token += 1;
    const token = L.token;
    L.ctl = new AbortController();
    const { plan, sessionId } = args;
    setRun({ sessionId: String(sessionId ?? ''), folder: args.folder, plan, names, pages, files: Object.fromEntries(plan.map((f) => [f.name, { state: 'waiting' }])), running: true, stopping: false, open: true });
    (async () => {
      let saved = [];
      try {
        saved = await generateDocs({ ...args, signal: L.ctl.signal,
          onFile: (name, state, message = '') => { if (L.token === token) setRun((r) => (r ? { ...r, files: { ...r.files, [name]: { state, message } } } : r)); } });
      } catch (e) {
        plan.forEach((f) => { if (L.token === token) setRun((r) => (r && !['done', 'failed', 'stopped'].includes(r.files[f.name]?.state) ? { ...r, files: { ...r.files, [f.name]: { state: 'failed', message: e?.message || 'The file could not be made.' } } } : r)); });
      } finally {
        L.running = false;
      }
      markNewDocs(sessionId, saved);
      if (saved.length) onSaved?.(saved);
      if (L.token === token) setRun((r) => (r ? { ...r, running: false, stopping: false } : r));
    })();
  }, []);
  const stop = useCallback(() => {
    live.current.ctl?.abort();
    setRun((r) => (r && r.running ? { ...r, stopping: true } : r));
  }, []);
  const show = useCallback(() => setRun((r) => (r ? { ...r, open: true } : r)), []);
  const hide = useCallback(() => setRun((r) => (r && r.open ? { ...r, open: false } : r)), []);
  const dismiss = useCallback(() => { if (!live.current.running) setRun(null); }, []);

  const value = useMemo(() => ({ run, start, stop, show, hide, dismiss }), [run, start, stop, show, hide, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
