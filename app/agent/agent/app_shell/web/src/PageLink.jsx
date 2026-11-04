import { useEffect, useRef, useState } from 'react';
import { LINK_STALE, UNKNOWN_PAGE, VIEW_STALE, buildHash, compactState, parseHash, readLink, readSaved } from './links.js';
import { useDialog, useToast } from './ui.jsx';
import ViewsMenu from './Views.jsx';

export function useUnknownPageNotice(route, pages, known = ['home']) {
  const toast = useToast();
  useEffect(() => {
    if (route && !known.includes(route) && !pages.some((p) => p.id === route)) toast(UNKNOWN_PAGE);
  }, [route, pages, toast]);
}

export function usePageAddress({ page, meta, state, onState, view, onView, views }) {
  const toast = useToast();
  const ready = !!meta && !!state && !meta.error;
  const taken = useRef(false);
  const apply = (next, stale) => {
    if (next.dropped) toast(stale);
    onState(next.state);
    if (next.view !== view) onView(next.view);
  };
  const write = () => {
    const next = buildHash(page.id, view, state, meta.filters, parseHash(window.location.hash).rec, meta.columns);
    if (next !== window.location.hash) window.history.replaceState(window.history.state, '', next);
  };
  useEffect(() => {
    if (!ready) return;
    if (!taken.current) {
      taken.current = true;
      const link = parseHash(window.location.hash);
      if (link.route === page.id && link.present) {
        apply(readLink(link, meta.filters, views, meta.columns), LINK_STALE);
        return;
      }
    }
    write();
  }, [ready, state, view, meta, page.id]);
  const latest = useRef(null);
  latest.current = { apply, write, filters: meta?.filters, columns: meta?.columns, views };
  useEffect(() => {
    if (!ready) return undefined;
    const onHash = () => {
      const link = parseHash(window.location.hash);
      if (link.route !== page.id) return;
      const now = latest.current;
      if (link.present) now.apply(readLink(link, now.filters, now.views, now.columns), LINK_STALE);
      else now.write();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [ready, page.id]);
  const applySaved = (entry) => {
    const next = readSaved(entry, meta.filters, views, meta.columns);
    if (!next.dropped) toast(`Showing the view "${entry.name}"`);
    apply(next, VIEW_STALE);
  };
  return { ready, applySaved };
}

function LinkDialog({ url, label, onClose }) {
  const ref = useDialog(true, onClose);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return (
    <dialog ref={ref} className="dialog" aria-label="Copy this link" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg">
        <header>
          <h2>Copy this link</h2>
          <p>This browser did not let the App copy it. The link is selected, so press Ctrl+C, or Cmd+C on a Mac, to copy it.</p>
        </header>
        <label className="in">{label}<input ref={input} readOnly value={url} onFocus={(e) => e.target.select()} /></label>
        <footer><button type="button" className="btn btn--pri" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}

export function useCopyLink(label, said = 'Link copied') {
  const toast = useToast();
  const [shared, setShared] = useState('');
  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(said);
    } catch {
      setShared(url);
    }
  };
  return { copy, dialog: shared ? <LinkDialog url={shared} label={label} onClose={() => setShared('')} /> : null };
}

export default function PageLink({ meta, state, view, pageId, address }) {
  const current = { view, filters: address.ready ? compactState(state, meta.filters, meta.columns) : {} };
  return <ViewsMenu pageId={pageId} current={current} ready={address.ready} onApply={address.applySaved} />;
}
