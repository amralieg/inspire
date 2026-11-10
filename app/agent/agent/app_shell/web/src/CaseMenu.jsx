import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Popover } from './ui.jsx';
import { hueVars } from './theme.js';
import { tabLabel } from './Layouts.jsx';
import { CASE_TONES, switcherMatches, useCaseState } from './hub.js';

function caseNote(page, state) {
  return state.text || [tabLabel(page, ''), page.domain].filter(Boolean).join(' · ');
}

function CaseMenu({ anchor, pages, page, hub, summaries, onPick, onOpen, onClose, label, empty = '', siblings = [] }) {
  const input = useRef(null);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const shown = switcherMatches(pages, text);
  const state = (p) => useCaseState(hub?.pages?.[p.id], summaries?.[p.id]);
  useEffect(() => {
    onOpen?.();
    input.current?.focus();
  }, []);
  useEffect(() => { setAt(0); }, [text]);
  const pick = (p) => {
    onClose();
    anchor?.focus();
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
  if (!pages.length && !siblings.length && empty) {
    return (
      <Popover anchor={anchor} onClose={onClose} label={label} width={360}>
        <div className="switch-pop"><p className="empty" data-no-cases>{empty}</p></div>
      </Popover>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} label={label} width={360}>
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
                <span className="switch-t"><b>{p.title}</b><small className={CASE_TONES[s.kind] || ''}>{caseNote(p, s)}</small></span>
                {p.id === page?.id && <Icon name="check" size={14} />}
              </button>
            );
          })}
          {!shown.length && pages.length > 0 && <p className="empty">No use case matches “{text.trim()}”.</p>}
        </div>
        {siblings.length > 0 && (
          <div className="switch-list" aria-label="Other Apps" data-siblings>
            {siblings.map((item) => (
              <a key={item.use_case_id} className="switch-i" href={item.url} data-sibling={item.use_case_id}>
                <span className="switch-t"><b>{item.name}</b><small>{item.use_case_id}</small></span>
              </a>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}

export default CaseMenu;
