import { useEffect, useState } from 'react';
import { valueQuery } from './valueLedger';

export function useValueRead(apiFetch, url, refreshKey = 0) {
  const [state, setState] = useState({ url: '', value: null });
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    apiFetch(url)
      .then((value) => { if (!cancelled) setState({ url, value }); })
      .catch(() => { if (!cancelled) setState({ url, value: null }); });
    return () => { cancelled = true; };
  }, [apiFetch, url, refreshKey]);
  return state.url === url ? state.value : null;
}

export function useRunValues(apiFetch, db, warehouseId, sessionIds) {
  const [runs, setRuns] = useState({});
  const key = sessionIds.join(',');
  useEffect(() => {
    if (!db || !warehouseId || !key) return undefined;
    let cancelled = false;
    Promise.all(key.split(',').map((sid) => apiFetch(`/api/inspire/value?${valueQuery(db, warehouseId, { session_id: sid })}`)
      .then((value) => [sid, value?.run ?? null])
      .catch(() => [sid, null])))
      .then((pairs) => { if (!cancelled) setRuns(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [apiFetch, db, warehouseId, key]);
  return runs;
}
