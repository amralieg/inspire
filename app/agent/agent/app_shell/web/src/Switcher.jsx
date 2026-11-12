import { Suspense, lazy, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { hueVars } from './theme.js';
import { CASE_TONES, useCaseState } from './hub.js';

const CaseMenu = lazy(() => import('./CaseMenu.jsx'));

export default function Switcher({ pages, page, hub, summaries, onPick, onOpen }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const single = pages.length < 2;
  const now = page ? useCaseState(hub?.pages?.[page.id], summaries?.[page.id]) : null;
  return (
    <>
      <button ref={anchor} type="button" className="switch" style={hueVars(page?.hue || 'blue')} onClick={() => setOpen(!open)} disabled={single} title={page?.title}
        aria-haspopup="dialog" aria-expanded={open} aria-label={page ? `Use case: ${page.title}${single ? '' : '. Switch use case'}` : 'Pick a use case'} data-switcher>
        {page && <span className="switch-ic"><Icon name={page.icon} size={14} /></span>}
        <span className="switch-t"><b>{page ? page.title : 'Pick a use case'}</b>{now?.text && <small className={CASE_TONES[now.kind] || ''}>{now.text}</small>}</span>
        {!single && <Icon name="down" size={14} />}
      </button>
      {open && <Suspense fallback={null}><CaseMenu anchor={anchor.current} pages={pages} page={page} hub={hub} summaries={summaries} onPick={onPick} onOpen={onOpen}
        onClose={() => setOpen(false)} label="Switch use case" /></Suspense>}
    </>
  );
}

export function UseCases({ pages, page, hub, summaries, onPick, onOpen, siblings = [] }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const others = pages.filter((p) => p.id !== page?.id);
  return (
    <>
      <button ref={anchor} type="button" className="btn" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} data-use-cases>
        <span>Use cases</span><Icon name="down" size={13} />
      </button>
      {open && <Suspense fallback={null}><CaseMenu anchor={anchor.current} pages={others} page={page} hub={hub} summaries={summaries} onPick={onPick} onOpen={onOpen}
        onClose={() => setOpen(false)} label="Use cases" empty="No other use cases yet" siblings={siblings} /></Suspense>}
    </>
  );
}
