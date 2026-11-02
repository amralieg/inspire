import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { DENSITIES, LIMITS, MY_KEY, WINDOWS, cleanPrefs, isFolded, readPrefs, setFolds, writePrefs } from './prefs.js';

const PrefsContext = createContext(null);
const ScopeContext = createContext(null);
const MEMORY = { getItem: () => null, setItem: () => {} };

function storage() {
  try {
    return window.localStorage || MEMORY;
  } catch {
    return MEMORY;
  }
}

export function MyViewProvider({ person, children }) {
  const [prefs, setPrefs] = useState(() => readPrefs(storage(), person));
  const latest = useRef(prefs);
  latest.current = prefs;
  useEffect(() => {
    const sync = (e) => { if (e.key === MY_KEY) setPrefs(readPrefs(storage(), person)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [person]);
  const update = useCallback((change) => {
    const next = cleanPrefs(change(latest.current));
    latest.current = next;
    writePrefs(storage(), person, next);
    setPrefs(next);
  }, [person]);
  const value = useMemo(() => ({ prefs, update, stored: true }), [prefs, update]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

const ALONE = { prefs: cleanPrefs(null), update: () => {}, stored: false };
export const useMyView = () => useContext(PrefsContext) || ALONE;

export function FoldScope({ pageId, children }) {
  const ids = useRef(new Set());
  const [count, setCount] = useState(0);
  const register = useCallback((id) => {
    ids.current.add(id);
    setCount(ids.current.size);
    return () => {
      ids.current.delete(id);
      setCount(ids.current.size);
    };
  }, []);
  const value = useMemo(() => ({ pageId, ids, register, count }), [pageId, register, count]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useFold(id) {
  const scope = useContext(ScopeContext);
  const { prefs, update } = useMyView();
  const register = scope?.register;
  useEffect(() => (register ? register(id) : undefined), [register, id]);
  const folded = !!scope && isFolded(prefs, scope.pageId, id);
  const toggle = () => update((p) => setFolds(p, scope.pageId, [id], !folded));
  return { on: !!scope, folded, toggle };
}

export function useFocusList() {
  const scope = useContext(ScopeContext);
  const { prefs, update } = useMyView();
  const ids = scope ? [...scope.ids.current] : [];
  const on = ids.length > 0 && ids.every((id) => isFolded(prefs, scope.pageId, id));
  const toggle = () => update((p) => setFolds(p, scope.pageId, [...scope.ids.current], !on));
  return { any: (scope?.count || 0) > 0, on, toggle };
}

export function FoldButton({ fold, title }) {
  if (!fold.on) return null;
  return (
    <button type="button" className={`ibtn ibtn--sm fold-b ${fold.folded ? 'is-folded' : ''}`} onClick={fold.toggle} aria-expanded={!fold.folded}
      aria-label={`${fold.folded ? 'Unfold' : 'Fold'} ${title}`} title={fold.folded ? 'Unfold' : 'Fold'} data-fold>
      <Icon name="down" size={15} />
    </button>
  );
}

export function FoldStrip({ fold, title, summary, children }) {
  if (!fold.on) return children;
  return (
    <div className={`fold-s ${fold.folded ? 'is-folded' : ''}`}>
      <div className="fold-h">
        <span className="fold-t">{title}</span>
        {fold.folded && summary && <span className="fold-sum">{summary}</span>}
        <FoldButton fold={fold} title={title} />
      </div>
      {!fold.folded && children}
    </div>
  );
}

export function WindowChips() {
  const { prefs, update } = useMyView();
  return (
    <div className="wchips" role="group" aria-label="Your window">
      {WINDOWS.map(([id, text]) => (
        <button key={id} type="button" className={`pick-i ${prefs.window === id ? 'is-on' : ''}`} aria-pressed={prefs.window === id}
          onClick={() => update((p) => ({ ...p, window: id }))}>{text}</button>
      ))}
    </div>
  );
}

const pick = (name, update, cast = String) => (e) => update((p) => ({ ...p, [name]: cast(e.target.value) }));

export function MyViewGroup() {
  const { prefs, update } = useMyView();
  return (
    <div className="tbl-wrap" data-group="my_view">
      <h3>My view</h3>
      <p className="why">Only you see these, in this browser. They change what the lists show you, never the data.</p>
      <table>
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          <tr data-my="window">
            <td><b>Window</b><br /><small>Show the records that are due, or that joined the list, in this window. Overdue records always show on top. Everything shows every record, the fixed and dismissed ones too, and never changes the Overview counts.</small></td>
            <td>
              <select name="my_window" aria-label="Window" value={prefs.window} onChange={pick('window', update)}>
                {WINDOWS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
              </select>
            </td>
          </tr>
          <tr data-my="limit">
            <td><b>Limit</b><br /><small>Show at most this many records, in the order the list ranks them, with a line that says how many more there are. It does not apply to Everything.</small></td>
            <td>
              <select name="my_limit" aria-label="Limit" value={String(prefs.limit)} onChange={pick('limit', update, Number)}>
                <option value="0">Off</option>
                {LIMITS.map((n) => <option key={n} value={String(n)}>{`Top ${n}`}</option>)}
              </select>
            </td>
          </tr>
          <tr data-my="density">
            <td><b>Density</b><br /><small>Compact fits more rows on the screen.</small></td>
            <td>
              <select name="my_density" aria-label="Density" value={prefs.density} onChange={pick('density', update)}>
                {DENSITIES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
