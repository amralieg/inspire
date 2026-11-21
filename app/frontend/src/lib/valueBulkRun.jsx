import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { runBulk } from './valueBulk.js';

// REQ-443: the bulk value run lives here, above the pages, so it survives leaving Results. One run at a time:
// { sessionId, items, rows, running, open, gots } where gots is { <use case id>: the save's reply } for each row that is done.
const Ctx = createContext(null);

export const useValueBulkRun = () => useContext(Ctx) || { run: null, start: () => {}, stop: () => {}, retry: () => {}, show: () => {}, hide: () => {}, dismiss: () => {} };

// The number of rows that count: every row that is not skipped.
export const bulkCounts = (run) => {
  const todo = (run?.rows || []).filter((r) => r.state !== 'skipped');
  return { done: todo.filter((r) => r.state === 'done').length, total: todo.length };
};

export function ValueBulkRunProvider({ children }) {
  const [run, setRun] = useState(null);
  const live = useRef({ token: 0, ctl: null, active: 0, gots: {}, worker: null, items: [] });

  const track = useCallback((token, items, onlyRows) => {
    const L = live.current;
    const worker = async (item) => {
      const got = await L.worker(item);
      if (L.token === token) L.gots[item.id] = got;
      return got;
    };
    L.active += 1;
    const merge = (next) => {
      if (L.token !== token) return;
      setRun((prev) => (prev ? { ...prev, rows: onlyRows ? prev.rows.map((r) => next.find((n) => n.id === r.id) || r) : next, gots: { ...L.gots } } : prev));
    };
    runBulk({ items, worker, onUpdate: merge, signal: onlyRows ? null : L.ctl.signal }).then(() => {
      L.active -= 1;
      if (L.token === token) setRun((prev) => (prev ? { ...prev, running: L.active > 0 } : prev));
    });
  }, []);

  const start = useCallback(({ sessionId, items, worker }) => {
    const L = live.current;
    L.token += 1;
    L.ctl = new AbortController();
    L.active = 0;
    L.gots = {};
    L.worker = worker;
    L.items = items;
    setRun({ sessionId: String(sessionId ?? ''), items, rows: items.map((it) => (it.skip ? { id: it.id, state: 'skipped', reason: it.skip } : { id: it.id, state: 'waiting' })),
      running: true, open: true, gots: {} });
    track(L.token, items, false);
  }, [track]);
  const stop = useCallback(() => live.current.ctl?.abort(), []);
  const retry = useCallback((id) => {
    const L = live.current;
    const item = L.items.find((it) => it.id === id);
    if (!item) return;
    setRun((prev) => (prev ? { ...prev, running: true } : prev));
    track(L.token, [item], true);
  }, [track]);
  const show = useCallback(() => setRun((prev) => (prev ? { ...prev, open: true } : prev)), []);
  const hide = useCallback(() => setRun((prev) => (prev && prev.open ? { ...prev, open: false } : prev)), []);
  const dismiss = useCallback(() => { live.current.token += 1; setRun(null); }, []);

  const value = useMemo(() => ({ run, start, stop, retry, show, hide, dismiss }), [run, start, stop, retry, show, hide, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
