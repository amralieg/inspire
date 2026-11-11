import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { agentFeedback, genieFeedback } from './api.js';
import { AgentSteps, RATINGS } from './AgentParts.jsx';
import { AskGenie } from './AskGenie.jsx';
import { Answer } from './Genie.jsx';
import { genieOf, genieOn } from './genieAsk.js';
import { ChoiceList } from './KindParts.jsx';
import { KIND_LAZY } from './kindCharts.js';
import { GenieMark, Icon } from './icons.jsx';
import { Skeleton, PlainNote, NewMessages, useFollowBottom } from './ui.jsx';
import { SaveButton, runWrite } from './saving.jsx';
import './styles/kindlayouts.css';
import { SectionHelp } from './SectionHelp.jsx';

export const CHAT_QUESTIONS = 12;
export { RATINGS };
const MODULES = { flow: () => import('./echartsFlow.js'), geo: () => import('./echartsGeo.js') };
const ready = {};

function readyFor(names) {
  const key = names.join('+');
  if (!ready[key]) ready[key] = lazy(() => Promise.all(names.map((n) => MODULES[n]())).then(() => ({ default: ({ children }) => children })));
  return ready[key];
}

export function lazyModules(page) {
  return [...new Set((page.charts || []).map((c) => KIND_LAZY[c.type]).filter(Boolean))].sort();
}

export function KindReady({ page, children }) {
  const names = lazyModules(page);
  if (!names.length) return children;
  const Ready = readyFor(names);
  return <Suspense fallback={<section className="card"><Skeleton height={240} /></section>}><Ready>{children}</Ready></Suspense>;
}

export function tablesRead(sql) {
  const found = [...String(sql || '').matchAll(/\b(?:from|join)\s+((?:`[^`]+`|[A-Za-z_][\w]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w]*)){0,2})/gi)].map((m) => m[1].replace(/`/g, ''));
  return [...new Set(found.filter((t) => !/^(select|lateral|unnest|values)$/i.test(t)))];
}

function useChat(page, app, genie) {
  const on = genieOn(app, page.id) && !!genie;
  const mine = on && genie.key === page.id;
  const thread = mine ? genie.thread : [];
  const pairs = thread.filter((m) => m.who === 'genie').map((m) => ({ answer: m, question: thread.find((q) => q.n === m.n - 1) }));
  return { on: mine, info: genieOf(app, page.id), thread, pairs, busy: !!genie?.busy, agent: mine && genie.mode?.mode === 'agent', note: mine ? genie.mode?.note || '' : '' };
}

function Conversation({ page, app, genie }) {
  const chat = useChat(page, app, genie);
  const [text, setText] = useState('');
  const log = useRef(null);
  const setThread = genie?.setThread;
  const tick = useCallback((n, shown) => setThread?.((t) => t.map((m) => (m.n === n ? { ...m, shown } : m))), [setThread]);
  const follow = useFollowBottom(log, chat.thread, `${page.id}:${chat.thread.filter((m) => m.who === 'you').at(-1)?.n ?? ''}`);
  const submit = (e) => {
    e.preventDefault();
    if (chat.on && text.trim() && !chat.busy) { genie.ask(text); setText(''); }
  };
  const who = app.auth === 'user' ? 'with your permissions' : "with the App's permissions";
  return (
    <section className="card chat" aria-label="Ask the data" data-part="conversation">
      <header className="card-h"><div><h2>Ask the data</h2>
        <p>{chat.agent ? `Genie answers about this use case ${who}, asks the Genie Agent${chat.info.title ? ` "${chat.info.title}"` : ''} when it needs the data, and asks you before it changes a record.`
          : chat.on ? `Answers from the Genie Agent${chat.info.title ? ` "${chat.info.title}"` : ''}, ${who}. Genie answers only: nothing on this page changes a record.`
          : chat.info.note || 'Ask Genie is off for this use case.'}</p>{chat.note && <p className="g-err" role="note" data-agent-note>{chat.note}</p>}</div>
        {chat.on && chat.thread.length > 0 && <button type="button" className="link" onClick={genie.reset}>New chat</button>}
        <SectionHelp title={'Ask the data'} steps={[{ title: 'Ask the data', text: "Ask a question about this data in your own words. Genie answers from this use case's tables." }]} /><AskGenie kind="text" title="Ask the data" context={{ hint: chat.pairs.map((p) => p.question?.text).filter(Boolean).join('; ') || page.question || '' }} />
      </header>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Genie conversation">
        {chat.on && !chat.thread.length && <p className="empty">Ask a question, or pick one below. Genie writes the SQL, runs it {who}, and shows its work.</p>}
        {chat.thread.map((m) => (m.who === 'you' ? (
          <div key={m.n} className="msg msg--you" data-chat="you"><p>{m.text}</p></div>
        ) : (
          <div key={m.n} className="msg msg--genie" data-chat={m.state}>
            <span className="msg-av"><GenieMark size={14} /></span>
            {m.state === 'running' && <div className="msg-b"><AgentSteps steps={m.steps} /><span className="g-step"><span className="dots"><i /><i /><i /></span>{m.step}…</span></div>}
            {m.state === 'failed' && <div className="msg-b"><PlainNote text={m.error} className="g-err" /></div>}
            {m.state === 'done' && <Answer message={m} url={chat.info.url} onTick={tick} genie={genie} rating={false} />}
          </div>
        )))}
        <NewMessages follow={follow} />
      </div>
      <form className="g-in" onSubmit={submit}>
        <input dir="auto" value={text} onChange={(e) => setText(e.target.value)} aria-label="Your question" autoComplete="off" maxLength={1000} disabled={!chat.on}
          placeholder={chat.on ? 'Ask about the data in this use case' : 'Ask Genie is off'} />
        <button className="btn btn--pri" type="submit" aria-label="Send" disabled={!chat.on || chat.busy || !text.trim()}><Icon name="send" size={15} /></button>
      </form>
    </section>
  );
}

function Suggested({ page, app, genie }) {
  const chat = useChat(page, app, genie);
  const questions = (page.questions || []).slice(0, CHAT_QUESTIONS);
  return (
    <section className="card" aria-label="Suggested questions" data-part="suggested_questions">
      <header className="card-h"><div><h2>Questions to start with</h2><p>Each one goes to Genie as written; edit nothing, or ask your own above.</p></div>
        <SectionHelp title={'Questions to start with'} steps={[{ title: 'Questions to start with', text: "Suggested questions Genie can answer for this use case. Pick one to see its answer." }]} /><AskGenie kind="text" title="Questions to start with" context={{ hint: questions.join('; ') }} /></header>
      <div className="chat-sugg">
        {questions.map((q) => <button key={q} type="button" className="sugg" data-question disabled={!chat.on || chat.busy} onClick={() => genie.ask(q)}>{q}</button>)}
      </div>
    </section>
  );
}

function CitedSql({ page, app, genie }) {
  const { pairs } = useChat(page, app, genie);
  const cited = pairs.filter((p) => p.answer.state === 'done' && p.answer.answer?.sql);
  return (
    <section className="card" aria-label="The SQL behind each answer" data-part="cited_sql">
      <header className="card-h"><div><h2>The SQL behind each answer</h2><p>Check what Genie read before you use a number from it.</p></div>
        <SectionHelp title={'The SQL behind each answer'} steps={[{ title: 'The SQL behind each answer', text: "The query Genie ran for each answer. Check it before you use a number from it." }]} /><AskGenie kind="text" title="The SQL behind each answer" context={{ hint: cited.map((p) => p.answer.answer.sql).join('\n\n') }} /></header>
      {!cited.length && <p className="empty">Ask a question: the SQL Genie runs shows here, with the tables it read.</p>}
      <ol className="chat-cited">
        {cited.map(({ answer, question }) => (
          <li key={answer.n} data-cited={answer.n}>
            <b>{question?.text || 'Question'}</b>
            <p className="chat-tables">Tables it read: {tablesRead(answer.answer.sql).join(', ') || 'none named'}</p>
            <pre>{answer.answer.sql}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Feedback({ page, app, genie }) {
  const { pairs, on } = useChat(page, app, genie);
  const [sent, setSent] = useState({});
  const [error, setError] = useState('');
  const done = pairs.filter((p) => p.answer.state === 'done' && !p.answer.refused && (p.answer.turn_id || p.answer.ids?.message_id));
  const rate = (answer, rating) => runWrite(`rate:${answer.n}:${rating}`, async () => {
    setError('');
    try {
      if (answer.turn_id) await agentFeedback(answer.turn_id, rating);
      else await genieFeedback(page.id, answer.ids.conversation_id, answer.ids.message_id, rating);
      setSent((all) => ({ ...all, [answer.n]: rating }));
    } catch (e) {
      setError(e.message);
    }
  });
  return (
    <section className="card" aria-label="Rate the answers" data-part="feedback">
      <header className="card-h"><div><h2>Rate the answers</h2><p>Your mark goes to the Genie Agent, so its owner can see which answers to fix.</p></div>
        <SectionHelp title={'Rate the answers'} steps={[{ title: 'Rate the answers', text: "Mark each Genie answer helpful or not, so its owner can see which answers to fix." }]} /><AskGenie kind="text" title="Rate the answers" context={{ hint: done.map((p) => `${p.question?.text || 'Answer'}: ${RATINGS.find((r) => r.id === sent[p.answer.n])?.label || 'not rated'}`).join('; ') }} /></header>
      {error && <PlainNote text={error} icon={<Icon name="info" size={14} />} className="tile-err" role="alert" />}
      {!done.length && <p className="empty">Answers you get show here for a helpful or not helpful mark.</p>}
      <ol className="chat-rate">
        {done.map(({ answer, question }) => (
          <li key={answer.n} data-rate={answer.n}>
            <span>{question?.text || 'Answer'}</span>
            <span role="group" aria-label={`Rate the answer to ${question?.text || 'this question'}`}>
              {RATINGS.map((r) => (
                <SaveButton key={r.id} write={`rate:${answer.n}:${r.id}`} className={`btn btn--sm ${sent[answer.n] === r.id ? 'btn--pri' : ''}`} disabled={!on} aria-pressed={sent[answer.n] === r.id}
                  data-rating={r.id} onClick={() => rate(answer, r.id)}>{r.label}</SaveButton>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export const KIND_PARTS = { breach_risk_cases: ChoiceList, ranked_sites: ChoiceList, centrality_list: ChoiceList, conversation: Conversation,
  suggested_questions: Suggested, cited_sql: CitedSql, feedback: Feedback };
