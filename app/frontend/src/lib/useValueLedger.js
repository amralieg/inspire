import { useEffect, useState } from 'react';

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
