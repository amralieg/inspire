import { createContext, useContext, useRef, useState } from 'react';
import { GenieMark } from './icons.jsx';
import { Popover } from './ui.jsx';
import { askGenie, genieOn } from './genieAsk.js';
import { ASK_CHARS, BUSY_TITLE, SUGGESTIONS, receives, scoped } from './explain.js';

export const GenieState = createContext({ app: null, busy: false });
export const GenieScope = createContext({ page: '', filters: '' });

export function AskGenie({ kind, title, context, page: given }) {
  const { app, busy } = useContext(GenieState);
  const scope = useContext(GenieScope);
  const page = given ?? scope.page;
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const name = String(title ?? '').trim() || 'this';
  const on = !!app && genieOn(app, page);
  const sent = scoped(context, scope.filters);
  const send = (question) => {
    const asked = String(question || '').trim();
    if (!asked || busy) return;
    askGenie({ element: { kind, page, title: name, context: sent, question: asked } });
    setOpen(false);
    setText('');
  };
  const toggle = (e) => {
    e.stopPropagation();
    if (on) setOpen(!open);
    else askGenie({});
  };
  const keep = (e) => { if (e.key !== 'Escape') e.stopPropagation(); };
  return (
    <>
      <button ref={anchor} type="button" className="ask-genie" data-ask={kind} aria-label={`Ask Genie about ${name}`} aria-haspopup={on ? 'dialog' : undefined}
        aria-expanded={on ? open : undefined} onClick={toggle} onKeyDown={keep}>
        <GenieMark size={13} /><span>Ask Genie</span>
      </button>
      {open && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)} label={`Ask Genie about ${name}`} width={320}>
          <form className="ask-box" onSubmit={(e) => { e.preventDefault(); send(text); }} onClick={(e) => e.stopPropagation()} onKeyDown={keep}>
            <div className="ask-row">
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question about this" aria-label={`Your question about ${name}`}
                maxLength={ASK_CHARS} autoComplete="off" />
              <button className="btn btn--pri" type="submit" disabled={busy || !text.trim()} title={busy ? BUSY_TITLE : undefined}>Ask Genie</button>
            </div>
            <div className="g-sugg">
              {(SUGGESTIONS[kind] || []).map((q) => (
                <button key={q} type="button" className="sugg" disabled={busy} title={busy ? BUSY_TITLE : undefined} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
            <p className="ask-what" data-receives>Genie receives {receives(sent)}.</p>
          </form>
        </Popover>
      )}
    </>
  );
}
