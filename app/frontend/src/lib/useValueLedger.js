import { useEffect, useRef, useState } from 'react';

// One request per (url, refreshKey). StrictMode runs effects twice in development, and a ref keeps the in-flight request
// across that simulated remount, so the second run waits on the same request rather than sending another.
export function useValueRead(apiFetch, url, refreshKey = 0) {
  const [state, setState] = useState({ url: '', value: null });
  const inflight = useRef({ key: '', promise: null });
  useEffect(() => {
    if (!url) return undefined;
    const key = `${refreshKey}|${url}`;
    if (inflight.current.key !== key) {
      inflight.current = {
        key,
        promise: apiFetch(url).then((value) => ({ ok: true, value }), () => ({ ok: false, value: null })),
      };
    }
    let cancelled = false;
    inflight.current.promise.then((result) => { if (!cancelled) setState({ url, value: result.ok ? result.value : null }); });
    return () => { cancelled = true; };
  }, [apiFetch, url, refreshKey]);
  return state.url === url ? state.value : null;
}
