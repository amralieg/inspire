import { useState } from 'react';

export const PROGRESS_QUERY = 'progress';

export function progressLinked(scope, search) {
  return scope != null && new URLSearchParams(search).get(PROGRESS_QUERY) === String(scope);
}

export function progressLink(scope, open, href) {
  const url = new URL(href);
  if (open) url.searchParams.set(PROGRESS_QUERY, String(scope));
  else if (url.searchParams.get(PROGRESS_QUERY) === String(scope)) url.searchParams.delete(PROGRESS_QUERY);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useProgressView(scope, openByDefault = false) {
  const [view, setView] = useState({ scope: null, open: null });
  const chosen = view.scope === scope ? view.open : null;
  const open = chosen ?? (progressLinked(scope, window.location.search) || openByDefault);
  const keep = (next) => {
    setView({ scope, open: next });
    const to = progressLink(scope, next, window.location.href);
    if (to !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', to);
  };
  return { open, show: () => keep(true), close: () => keep(false) };
}
