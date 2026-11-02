import { useCallback, useEffect, useRef, useState } from 'react';
import { getHistory } from './api.js';
import { dayLabel } from './format.js';
import { SOURCES, columnLabel, historyChanges, valueText, whenText, whoText } from './records.js';

export function useHistory(pageId, ref, nonce = 0) {
  const [state, setState] = useState({ data: null, error: '', loading: false });
  const key = ref ? JSON.stringify(ref) : '';
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    if (!key) {
      setState({ data: null, error: '', loading: false });
      return Promise.resolve(null);
    }
    setState((s) => ({ ...s, loading: true, error: '' }));
    return getHistory(pageId, JSON.parse(key))
      .then((data) => { if (mine === seq.current) setState({ data, error: '', loading: false }); return data; })
      .catch((e) => { if (mine === seq.current) setState({ data: null, error: e.message, loading: false }); throw e; });
  }, [pageId, key]);
  useEffect(() => { load().catch(() => {}); }, [load, nonce]);
  return { ...state, reload: load };
}

function runLine(version, first) {
  const day = version.as_of_date ? dayLabel(String(version.as_of_date).slice(0, 10)) : '';
  if (first) return day ? `First version, from the run of ${day}.` : 'First version.';
  return day ? `From the run of ${day}.` : '';
}

export function HistoryList({ data, meta, unit = '', kind = '' }) {
  const items = historyChanges(data.fields, data.versions).reverse();
  return (
    <ol className="hist" aria-label="Record history">
      {items.map(({ version, n, changes, set }) => (
        <li key={version.valid_from_us || n} className={`hist-i hist-i--${version.change_source}`} data-source={version.change_source}>
          <span className="hist-dot" />
          <div>
            <div className="hist-h">
              <b>v{n} · {SOURCES[version.change_source] || version.change_source}{version.is_current ? ' · current' : ''}</b>
              <span>{whoText(version)} · {whenText(version.valid_from)}</span>
            </div>
            {changes.length > 0 && (
              <ul>
                {changes.map((c) => (
                  <li key={c.field.name}>{columnLabel(c.field.name, meta, unit, kind)}: <s>{valueText(c.field, c.from, meta, unit, kind)}</s> → <b className="chg">{valueText(c.field, c.to, meta, unit, kind)}</b></li>
                ))}
              </ul>
            )}
            {set.length > 0 && <ul>{set.slice(0, 8).map((c) => <li key={c.field.name}>{columnLabel(c.field.name, meta, unit, kind)}: <b className="chg">{valueText(c.field, c.to, meta, unit, kind)}</b></li>)}</ul>}
            {version.change_source === 'run' && <p>{runLine(version, n === 1)}</p>}
            {n > 1 && !changes.length && version.change_source !== 'delete' && <p>No value changed.</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
