import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GenieMark, Icon } from './icons.jsx';
import { agentAsk, agentFeedback, agentStatus, agentTurn, askGenie, explainGenie, undoRecords, writeRecord } from './api.js';
import { reducedMotion } from './theme.js';
import { cellText, integer, isKeyColumn, plainWords } from './format.js';
import DataTable from './DataTable.jsx';
import Markdown from './Markdown.jsx';
import { BUSY_TITLE, explainBody } from './explain.js';
import { GENIE_DEFAULT, GENIE_MIN, clampGenie, genieMax, keyWidth, rememberGenieWidth, storedGenieWidth } from './genieWidth.js';
import { GENIE_ASK, genieAnswer, genieKey, genieOf, genieOn, paceText } from './genieAsk.js';
import { AGENT_CHANGED, suggestions } from './agentView.js';
import { AgentExtras, AgentSteps, confirmWrite } from './AgentParts.jsx';
import { runWrite } from './saving.jsx';

const WORDS_PER_SECOND = 14;
const AGENT_POLL_MS = 1000;
const AGENT_GIVE_UP_MS = 300000;
const HISTORY_SENT = 6;
const ELEMENT_CHARS = 8000;

function answerColumns(answer) {
  const rows = answer.rows || [];
  return (answer.columns || []).map((c) => {
    const num = !isKeyColumn(c.name, c.type) && rows.some((r) => typeof r[c.name] === 'number') && rows.every((r) => r[c.name] == null || typeof r[c.name] === 'number');
    return { key: c.name, label: plainWords(c.name), num, render: (r) => (r[c.name] == null ? '' : cellText(r[c.name], c)) };
  });
}

function Pace({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <small className="g-pace" data-pace>{paceText((now - since) / 1000)}</small>;
}

const recordQuestions = (entity) => [`Show the history of this ${entity}`, 'Are there others like this?', 'What happens if we do nothing?'];

function aboutOf(detail) {
  const pageId = String(detail?.pageId ?? '').trim();
  const recordKey = String(detail?.recordKey ?? '');
  if (!pageId || !recordKey) return null;
  return { pageId, recordKey, label: String(detail?.label ?? '').trim() || recordKey };
}

function historyOf(thread) {
  return thread.filter((m) => m.who === 'genie' && m.state === 'done').slice(-HISTORY_SENT).map((m) => ({
    question: thread.find((q) => q.n === m.n - 1)?.text || '', answer: String(m.answer?.text || '').slice(0, 1500),
  }));
}

function elementView(body) {
  const element = { kind: body.kind, title: body.title, context: body.context };
  const text = JSON.stringify(element);
  return text.length <= ELEMENT_CHARS ? element : { kind: body.kind, title: body.title, context: text.slice(0, ELEMENT_CHARS) };
}

function agentAnswer(turn) {
  const g = turn.genie || {};
  return { text: turn.answer || '', sql: g.sql || '', columns: g.columns || [], rows: g.rows || [], truncated: !!g.truncated };
}

export function useGenie(app, current, onOpen, view = null) {
  const [threads, setThreads] = useState({});
  const [about, setAbout] = useState(null);
  const [pinned, setPinned] = useState('');
  const [draft, setDraft] = useState('');
  const [modes, setModes] = useState({});
  const conversations = useRef({});
  const alive = useRef(true);
  const subject = useRef(null);
  const opener = useRef(onOpen);
  const running = useRef(false);
  const shown = useRef(app);
  const all = useRef({});
  const modesNow = useRef({});
  const viewNow = useRef(view);
  const key = about ? about.pageId : pinned || genieKey(app, current);
  const keyNow = useRef(key);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { setPinned(''); }, [current]);
  useEffect(() => { opener.current = onOpen; shown.current = app; keyNow.current = key; all.current = threads; modesNow.current = modes; viewNow.current = view; });
  useEffect(() => {
    if (!key || !genieOn(app, key) || modesNow.current[key]) return;
    const settle = (mode) => setModes((m) => ({ ...m, [key]: mode }));
    settle({ mode: 'checking', note: '' });
    agentStatus(key).then((m) => settle({ mode: m.mode === 'agent' ? 'agent' : 'genie', note: m.note || '' }))
      .catch(() => settle({ mode: 'genie', note: '' }));
  }, [app, key]);
  const edit = (k, change) => setThreads((t) => ({ ...t, [k]: change(t[k] || []) }));
  const update = (k, n, patch) => edit(k, (t) => t.map((m) => (m.n === n ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));
  const find = (k, n) => (all.current[k] || []).find((m) => m.n === n);

  const send = useCallback(async (k, you, start) => {
    if (!k || !genieOn(shown.current, k)) return;
    const n = Date.now();
    edit(k, (t) => [...t, { n: n - 1, who: 'you', ...you }, { n, who: 'genie', state: 'running', step: 'Reading your question' }]);
    try {
      const started = await start(conversations.current[k] || '');
      conversations.current[k] = started.conversation_id;
      if (started.question) update(k, n - 1, { sent: started.question });
      const msg = await genieAnswer(k, started, { onStep: (step) => update(k, n, { step }), alive: () => alive.current });
      if (msg) update(k, n, { state: 'done', answer: msg, ids: started, shown: reducedMotion() ? Infinity : 0 });
    } catch (error) {
      update(k, n, { state: 'failed', error: error.message, calm: !!error.calm });
    }
  }, []);

  const sendAgent = useCallback(async (k, you, extra) => {
    if (!k || !genieOn(shown.current, k)) return;
    const n = Date.now();
    const history = historyOf(all.current[k] || []);
    edit(k, (t) => [...t, { n: n - 1, who: 'you', ...you }, { n, k, who: 'genie', agent: true, state: 'running', step: 'Reading your question', steps: [] }]);
    const seen = viewNow.current?.context(k) || {};
    const body = { page: k, question: you.text, conversation_id: conversations.current[k] || '', history,
      view: { ...(seen.view || {}), ...(extra.element ? { element: extra.element } : {}) }, visible: seen.visible || [],
      ...(extra.about ? { record_key: extra.about.recordKey } : {}) };
    try {
      let turn = await agentAsk(body);
      const until = Date.now() + AGENT_GIVE_UP_MS;
      while (turn.state === 'running') {
        update(k, n, { steps: turn.steps, step: turn.steps.length ? turn.steps[turn.steps.length - 1].text : 'Reading your question' });
        await new Promise((r) => setTimeout(r, AGENT_POLL_MS));
        if (!alive.current) return;
        if (Date.now() > until) throw new Error('Genie took longer than five minutes. Try a narrower question.');
        turn = await agentTurn(turn.turn_id);
      }
      if (turn.state === 'no_model') {
        setModes((m) => ({ ...m, [k]: { mode: 'genie', note: turn.error } }));
        edit(k, (t) => t.filter((m) => m.n !== n && m.n !== n - 1));
        send(k, you, (id) => askGenie(k, you.text, id, extra.about));
        return;
      }
      if (turn.state === 'failed') throw new Error(turn.error || 'Genie could not answer this question.');
      if (turn.conversation_id) conversations.current[k] = turn.conversation_id;
      const undo = turn.actions?.length ? viewNow.current?.apply(k, turn.actions) || null : null;
      update(k, n, { state: 'done', turn_id: turn.turn_id, steps: turn.steps, actions: turn.actions, refused: turn.refused, undo,
        confirm: turn.confirm ? { ...turn.confirm, state: 'ask' } : null, answer: agentAnswer(turn),
        ids: turn.genie ? { conversation_id: turn.genie.conversation_id, message_id: turn.genie.message_id } : null, shown: reducedMotion() ? Infinity : 0 });
    } catch (error) {
      update(k, n, { state: 'failed', error: error.message, calm: !!error.calm });
    }
  }, [send]);

  const agentOn = (k) => modesNow.current[k]?.mode === 'agent';

  const ask = useCallback((question, target = subject.current) => {
    const text = String(question || '').trim();
    const k = target ? target.pageId : keyNow.current;
    if (!text) return;
    if (agentOn(k)) sendAgent(k, { text, about: target }, { about: target });
    else send(k, { text, about: target }, (id) => askGenie(k, text, id, target));
  }, [send, sendAgent]);

  const choose = useCallback((next) => { subject.current = next; setAbout(next); setPinned(''); }, []);
  const clearAbout = useCallback(() => choose(null), [choose]);

  const explain = useCallback(({ kind, page, title, context, question }) => {
    const body = explainBody(kind, page, title, context, question);
    const you = body.question ? { text: body.question, about: { label: body.title } } : { text: `Explain “${body.title}”`, explain: true };
    const k = genieKey(shown.current, page);
    setPinned(k);
    if (agentOn(k)) sendAgent(k, you, { element: elementView(body) });
    else send(k, you, (id) => explainGenie({ ...body, conversation_id: id }));
  }, [send, sendAgent]);

  const changed = (pageId) => window.dispatchEvent(new CustomEvent(AGENT_CHANGED, { detail: { pageId } }));
  const confirm = useCallback((k, n) => {
    const c = find(k, n)?.confirm;
    if (!c || c.state !== 'ask') return undefined;
    return runWrite(confirmWrite(k, n), async () => {
      update(k, n, (m) => ({ confirm: { ...m.confirm, state: 'saving', error: '' } }));
      try {
        const result = await writeRecord(c.route.split('/')[1], c.body);
        changed(c.body.page);
        update(k, n, (m) => ({ confirm: { ...m.confirm, state: c.route === 'records/undo' ? 'undone' : 'saved', result } }));
      } catch (error) {
        update(k, n, (m) => ({ confirm: { ...m.confirm, state: 'ask', error: error.message } }));
      }
    }, { rows: c.body?.record_keys || [] });
  }, []);
  const cancel = useCallback((k, n) => update(k, n, (m) => ({ confirm: { ...m.confirm, state: 'cancelled' } })), []);
  const undoSaved = useCallback((k, n) => {
    const c = find(k, n)?.confirm;
    if (!c?.result?.batch_id) return undefined;
    return runWrite(`${confirmWrite(k, n)}:undo`, async () => {
      try {
        await undoRecords({ page: c.body.page, batch_id: c.result.batch_id });
        changed(c.body.page);
        update(k, n, (m) => ({ confirm: { ...m.confirm, state: 'undone', error: '' } }));
      } catch (error) {
        update(k, n, (m) => ({ confirm: { ...m.confirm, error: error.message } }));
      }
    });
  }, []);
  const undoView = useCallback((k, n) => {
    const m = find(k, n);
    if (!m?.undo) return;
    m.undo();
    update(k, n, { undo: null, viewUndone: true });
  }, []);
  const rate = useCallback((k, n, rating) => {
    const m = find(k, n);
    if (!m?.turn_id) return undefined;
    return runWrite(`rate:${m.turn_id}:${rating}`, async () => {
      try {
        await agentFeedback(m.turn_id, rating);
        update(k, n, { rated: rating, rateError: '' });
      } catch (error) {
        update(k, n, { rateError: error.message });
      }
    });
  }, []);

  useEffect(() => {
    const onAsk = (event) => {
      opener.current?.();
      if (event.detail?.element) {
        choose(null);
        explain(event.detail.element);
        return;
      }
      const target = aboutOf(event.detail);
      if (!target || !genieOn(shown.current, target.pageId)) return;
      choose(target);
      const question = String(event.detail?.question || '').trim();
      if (!question) return;
      if (running.current) setDraft(question);
      else ask(question, target);
    };
    window.addEventListener(GENIE_ASK, onAsk);
    return () => window.removeEventListener(GENIE_ASK, onAsk);
  }, [ask, choose, explain]);

  const thread = threads[key] || [];
  const setThread = useCallback((change) => edit(keyNow.current, change), []);
  const reset = useCallback(() => {
    conversations.current[keyNow.current] = '';
    edit(keyNow.current, () => []);
  }, []);
  const busy = thread.some((m) => m.state === 'running');
  useEffect(() => { running.current = busy; }, [busy]);
  const mode = modes[key] || { mode: 'genie', note: '' };
  return { key, thread, ask, explain, reset, setThread, busy, about, clearAbout, draft, setDraft, mode, confirm, cancel, undoSaved, undoView, rate };
}

export function ExplainButton({ title, busy, onClick }) {
  return (
    <button type="button" className="explain-btn" onClick={onClick} disabled={busy} title={busy ? BUSY_TITLE : undefined} aria-label={`Explain ${title}`}>
      <GenieMark size={13} /><span>Explain</span>
    </button>
  );
}

function roomBeside(panel) {
  const main = panel?.parentElement?.querySelector(':scope > .main');
  if (!main || getComputedStyle(panel).position === 'absolute') return Infinity;
  return panel.getBoundingClientRect().right - main.getBoundingClientRect().left;
}

function useGenieWidth(panel) {
  const [width, setWidth] = useState(storedGenieWidth);
  const [space, setSpace] = useState(() => ({ viewport: window.innerWidth, room: Infinity }));
  const before = useRef(GENIE_DEFAULT);
  useLayoutEffect(() => {
    const measure = () => setSpace({ viewport: window.innerWidth, room: roomBeside(panel.current) });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [panel]);
  const { viewport, room } = space;
  const shown = clampGenie(width, viewport, room);
  const max = genieMax(viewport, room);
  const set = (next) => {
    const w = clampGenie(next, viewport, room);
    setWidth(w);
    rememberGenieWidth(w);
  };
  const toggle = () => {
    if (shown < max) {
      before.current = shown;
      set(max);
    } else {
      set(before.current < max ? before.current : GENIE_DEFAULT);
    }
  };
  return { shown, max, set, toggle, maxed: shown >= max, step: (key) => keyWidth(key, shown, viewport, room) };
}

function Resizer({ width }) {
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width.shown };
    setDragging(true);
  };
  const move = (e) => { if (drag.current) width.set(drag.current.w + drag.current.x - e.clientX); };
  const up = (e) => {
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const key = (e) => {
    const next = width.step(e.key);
    if (next == null) return;
    e.preventDefault();
    width.set(next);
  };
  return (
    <div className={dragging ? 'g-resize is-dragging' : 'g-resize'} role="separator" aria-orientation="vertical" aria-label="Resize Ask Genie"
      aria-valuenow={width.shown} aria-valuemin={GENIE_MIN} aria-valuemax={width.max} tabIndex={0} title="Drag to resize. Double-click for the default width."
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => width.set(GENIE_DEFAULT)} onKeyDown={key}>
      <span className="g-grip" aria-hidden="true" />
    </div>
  );
}

function Typing({ message, onTick }) {
  const words = String(message.answer.text || '').split(/(\s+)/);
  const shown = Math.min(message.shown, words.length);
  useEffect(() => {
    if (shown >= words.length) return undefined;
    const t = setTimeout(() => onTick(message.n, shown + 2), 1000 / WORDS_PER_SECOND);
    return () => clearTimeout(t);
  }, [shown, words.length, message.n, onTick]);
  const typing = shown < words.length;
  return <Markdown text={words.slice(0, shown).join('')} cursor={typing} />;
}

export function Answer({ message, url, onTick, genie, rating = true }) {
  const a = message.answer;
  const words = String(a.text || '').split(/(\s+)/).length;
  const done = message.shown >= words;
  return (
    <div className="msg-b">
      <AgentSteps steps={message.steps} />
      <Typing message={message} onTick={onTick} />
      {done && a.rows?.length > 0 && (
        <div className="msg-t">
          <DataTable label="Genie's answer" columns={answerColumns(a)} rows={a.rows} />
        </div>
      )}
      {done && a.truncated && <p className="g-foot" style={{ padding: '6px 0 0' }}>Showing the first {integer(a.rows.length)} rows of the answer.</p>}
      {done && a.result_error && <p className="g-foot g-err" style={{ padding: '6px 0 0' }}>The answer's table could not load: {a.result_error}</p>}
      {done && a.sql && (
        <details className="msg-sql"><summary><Icon name="code" size={13} />The SQL Genie ran</summary><pre>{a.sql}</pre></details>
      )}
      {done && genie && <AgentExtras message={message} genie={genie} rating={rating} />}
      {done && (!message.agent || message.ids) && (
        <div className="msg-f">
          {url && <a href={url} target="_blank" rel="noreferrer"><Icon name="external" size={12} />Open in Genie Agent</a>}
        </div>
      )}
    </div>
  );
}

function YouSent({ message }) {
  return (
    <div className="msg-x">
      <p>{message.text}</p>
      {message.about && <small className="msg-about">About: {message.about.label}</small>}
      {message.sent && <details className="msg-sent"><summary>What the App sent Genie</summary><pre>{message.sent}</pre></details>}
    </div>
  );
}

export default function GeniePanel({ app, genie, page, pages, onPick, onClose }) {
  const log = useRef(null);
  const input = useRef(null);
  const panel = useRef(null);
  const [text, setText] = useState('');
  const { key, thread, ask, reset, setThread, busy, about, clearAbout, draft, setDraft, mode } = genie;
  const agent = mode?.mode === 'agent';
  const width = useGenieWidth(panel);
  const tick = useCallback((n, shown) => setThread((t) => t.map((m) => (m.n === n ? { ...m, shown } : m))), [setThread]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [thread]);
  useEffect(() => {
    if (!draft) return;
    setText(draft);
    setDraft('');
    input.current?.focus();
  }, [draft, setDraft]);
  useEffect(() => { if (about && page && page.id !== about.pageId) clearAbout(); }, [about, page, clearAbout]);
  const info = genieOf(app, key);
  const home = key ? app.pages.find((p) => p.id === key) : null;
  const on = Boolean(home) && info.enabled;
  const entity = String(app.pages.find((p) => p.id === about?.pageId)?.records?.label_title || 'record').toLowerCase();
  const asked = thread.filter((m) => m.who === 'you').map((m) => m.text);
  const questions = home ? (agent ? suggestions(home, null, String(home.records?.label_title || 'record').toLowerCase(), asked) : (home.questions || []).filter((q) => !asked.includes(q))) : [];
  const answering = pages.filter((p) => p.genie.enabled);
  const submit = (e) => { e.preventDefault(); if (on && text.trim() && !busy) { ask(text); setText(''); } };
  const who = app.auth === 'user' ? 'with your permissions' : "with the App's permissions";
  const subject = about ? `"${about.label}"` : home ? home.title : '';
  const status = !home ? 'Each use case has its own Genie Agent'
    : on && agent ? `Answers about this use case ${who}; asks the Genie Agent${info.title ? ` "${info.title}"` : ''} when it needs the data`
      : on ? `Answers from the Genie Agent${info.title ? ` "${info.title}"` : ''} · ${who}` : 'Ask Genie is off for this use case';
  return (
    <aside ref={panel} className="genie is-open" aria-label="Ask Genie" style={{ '--genie-w': `${width.shown}px` }}>
      <Resizer width={width} />
      <header className="g-h">
        <span className="g-logo"><GenieMark size={18} /></span>
        <div><b>Ask Genie</b><small>{status}</small></div>
        {thread.length > 0 && <button className="link" onClick={reset}>New chat</button>}
        <button className="ibtn g-max" onClick={width.toggle} aria-pressed={width.maxed} aria-label="Maximize Ask Genie" title={width.maxed ? 'Restore the panel width' : 'Widen the panel'}>
          <Icon name={width.maxed ? 'restore' : 'maximize'} size={16} />
        </button>
        <button className="ibtn" onClick={onClose} aria-label="Close Ask Genie"><Icon name="x" size={18} /></button>
      </header>
      {on && mode?.note && <p className="g-note" role="note" data-agent-note>{mode.note}</p>}
      <div className="g-log" ref={log} role="log" aria-live="polite" aria-label="Genie conversation">
        {!home && (
          <div className="g-empty g-pick">
            <GenieMark size={28} />
            <p>{info.note}</p>
            {answering.length > 0 && (
              <div className="g-pick-list" aria-label="Use cases with a Genie Agent">
                {answering.map((p) => <button key={p.id} type="button" className="sugg" onClick={() => onPick?.(p.id)}>{p.use_case_id ? `${p.use_case_id} · ` : ''}{p.title}</button>)}
              </div>
            )}
          </div>
        )}
        {home && !on && <div className="g-off"><GenieMark size={28} /><b>Ask Genie is off</b><span>{info.note}</span></div>}
        {on && !thread.length && (
          <div className="g-empty"><GenieMark size={28} /><p>{agent
            ? `Ask about ${subject}. Genie reads what the page shows, asks the Genie Agent when it needs the data, can change the view, and asks before it changes a record.`
            : `Ask a question about ${subject}. Genie writes the SQL, runs it ${app.auth === 'user' ? 'as you' : 'as the App'}, and shows its work.`}</p></div>
        )}
        {home && thread.map((m) => (m.who === 'you' ? (
          <div key={m.n} className="msg msg--you">
            {m.explain || m.about || m.sent ? <YouSent message={m} /> : <p>{m.text}</p>}
          </div>
        ) : (
          <div key={m.n} className="msg msg--genie">
            <span className="msg-av"><GenieMark size={14} /></span>
            {m.state === 'running' && <div className="msg-b"><AgentSteps steps={m.steps} /><span className="g-step"><span className="dots"><i /><i /><i /></span>{m.step}…</span><Pace since={m.n} /></div>}
            {m.state === 'failed' && <div className="msg-b">{m.calm ? <p className="note" role="status" data-calm>{m.error}</p> : <p className="g-err">{m.error}</p>}</div>}
            {m.state === 'done' && <Answer message={m} url={info.url} onTick={tick} genie={genie} />}
          </div>
        )))}
      </div>
      {on && about && (
        <div className="g-about">
          <span className="g-chip">
            <GenieMark size={12} /><span className="g-chip-t">About: {about.label}</span>
            <button type="button" className="g-chip-x" onClick={clearAbout} aria-label={`Stop asking about ${about.label}`} title="Ask about the page instead"><Icon name="x" size={12} /></button>
          </span>
        </div>
      )}
      {on && about && (
        <div className="g-sugg" aria-label={`Questions about ${about.label}`}>
          {(agent ? suggestions(home, about, entity) : recordQuestions(entity)).map((q) => <button key={q} className="sugg" onClick={() => ask(q)} disabled={busy}>{q}</button>)}
        </div>
      )}
      {on && !about && questions.length > 0 && (thread.length === 0 || (thread.at(-1)?.state === 'failed' && thread.at(-1)?.calm)) && (
        <div className="g-sugg">{questions.slice(0, 4).map((q) => <button key={q} className="sugg" onClick={() => ask(q)} disabled={busy}>{q}</button>)}</div>
      )}
      <form className="g-in" onSubmit={submit}>
        <input dir="auto" ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={!home ? 'Pick a use case first' : !on ? 'Ask Genie is off' : about ? `Ask about ${about.label}` : 'Ask about the data in this use case'} aria-label="Your question" autoComplete="off" disabled={!on} maxLength={1000} />
        <button className="btn btn--pri" type="submit" aria-label="Send" disabled={!on || busy || !text.trim()}><Icon name="send" size={15} /></button>
      </form>
    </aside>
  );
}
