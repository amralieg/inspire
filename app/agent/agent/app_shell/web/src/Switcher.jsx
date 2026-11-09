import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Popover } from './ui.jsx';
import { hueVars } from './theme.js';
import { tabLabel } from './Layouts.jsx';
import { switcherMatches, useCaseState } from './hub.js';

const TONES = { stale: 'bad', error: 'bad', wait: 'warn' };

function caseNote(page, state) {
  return state.text || [tabLabel(page, ''), page.domain].filter(Boolean).join(' · ');
}

export default function Switcher({ pages, page, hub, summaries, onPick, onOpen }) {
  const anchor = useRef(null);
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const shown = switcherMatches(pages, text);
  const single = pages.length < 2;
  const state = (p) => useCaseState(hub?.pages?.[p.id], summaries?.[p.id]);
  useEffect(() => {
    if (!open) return;
    setText('');
    setAt(0);
    onOpen?.();
    input.current?.focus();
  }, [open]);
  useEffect(() => { setAt(0); }, [text]);
  const close = () => setOpen(false);
  const pick = (p) => {
    close();
    anchor.current?.focus();
    onPick(p.id);
  };
  const key = (e) => {
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[e.key];
    if (next !== undefined && shown.length) {
      e.preventDefault();
      setAt((next + shown.length) % shown.length);
    } else if (e.key === 'Enter' && shown[at]) {
      e.preventDefault();
      pick(shown[at]);
    }
  };
  const now = page ? state(page) : null;
  return (
    <>
      <button ref={anchor} type="button" className="switch" style={hueVars(page?.hue || 'blue')} onClick={() => setOpen(!open)} disabled={single}
        aria-haspopup="dialog" aria-expanded={open} aria-label={page ? `Use case: ${page.title}${single ? '' : '. Switch use case'}` : 'Pick a use case'} data-switcher>
        {page && <span className="switch-ic"><Icon name={page.icon} size={14} /></span>}
        <span className="switch-t"><b>{page ? page.title : 'Pick a use case'}</b>{now?.text && <small className={TONES[now.kind] || ''}>{now.text}</small>}</span>
        {!single && <Icon name="down" size={14} />}
      </button>
      {open && (
        <Popover anchor={anchor.current} onClose={close} label="Switch use case" width={360}>
          <div className="switch-pop">
            <label className="search switch-find"><Icon name="search" size={14} />
              <input ref={input} dir="auto" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={key} placeholder="Find a use case" aria-label="Find a use case"
                maxLength={100} role="combobox" aria-expanded="true" aria-controls="switch-list" aria-activedescendant={shown[at] ? `switch-${shown[at].id}` : undefined} />
            </label>
            <div className="switch-list" id="switch-list" role="listbox" aria-label="Use cases">
              {shown.map((p, i) => {
                const s = state(p);
                return (
                  <button key={p.id} id={`switch-${p.id}`} type="button" role="option" aria-selected={p.id === page?.id} className={`switch-i ${i === at ? 'is-at' : ''}`}
                    style={hueVars(p.hue || 'blue')} onMouseEnter={() => setAt(i)} onClick={() => pick(p)} data-case={p.id}>
                    <span className="switch-ic"><Icon name={p.icon} size={14} /></span>
                    <span className="switch-t"><b>{p.title}</b><small className={TONES[s.kind] || ''}>{caseNote(p, s)}</small></span>
                    {p.id === page?.id && <Icon name="check" size={14} />}
                  </button>
                );
              })}
              {!shown.length && <p className="empty">No use case matches “{text.trim()}”.</p>}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
