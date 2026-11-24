import { Suspense, lazy, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { hueVars } from './theme.js';
import { CASE_TONES, useCaseState } from './hub.js';

const CaseMenu = lazy(() => import('./CaseMenu.jsx'));

export default function Switcher({ pages, page, hub, summaries, onPick, onOpen, siblings = [] }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const single = pages.length < 2 && !siblings.length;
  const now = page ? useCaseState(hub?.pages?.[page.id], summaries?.[page.id]) : null;
  return (
    <>
      <button ref={anchor} type="button" className="switch" style={hueVars(page?.hue || 'blue')} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }} disabled={single} title={page?.title}
        aria-haspopup="dialog" aria-expanded={open} aria-label={page ? `Use case: ${page.title}${single ? '' : '. Switch use case'}` : 'Pick a use case'} data-switcher>
        {page && <span className="switch-ic"><Icon name={page.icon} size={14} /></span>}
        <span className="switch-t"><b>{page ? page.title : 'Pick a use case'}</b>{now?.text && <small className={CASE_TONES[now.kind] || ''}>{now.text}</small>}</span>
        {!single && <Icon name="down" size={14} />}
      </button>
      {open && <Suspense fallback={null}><CaseMenu anchor={anchor.current} pages={pages} page={page} hub={hub} summaries={summaries} onPick={onPick} onOpen={onOpen}
        onClose={() => setOpen(false)} label="Switch use case" siblings={siblings} /></Suspense>}
    </>
  );
}
