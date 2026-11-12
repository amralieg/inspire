import { useCallback, useEffect, useRef, useState } from 'react';
import { failureOf, getFeedback, sendFeedback } from './api.js';
import { dayLabel } from './format.js';
import { Icon } from './icons.jsx';
import { Failure, Popover, useToast } from './ui.jsx';
import { FEEDBACK_CHARS, FEEDBACK_SECTIONS, feedbackChars, feedbackProblem, feedbackStatusText } from './feedback.js';

function useFeedback(pageId) {
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  useEffect(() => {
    getFeedback(pageId).then((d) => { setData(d); setFailure(null); }).catch((e) => setFailure(failureOf(e)));
  }, [pageId]);
  return { data, failure, setData };
}

function FeedbackForm({ pageId, context, sections, onSent, autoFocus = false, reports = null }) {
  const [text, setText] = useState('');
  const [about, setAbout] = useState(context.section);
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);
  const box = useRef(null);
  const toast = useToast();
  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
  const problem = feedbackProblem(text);
  const picks = (sections || []).filter((s) => FEEDBACK_SECTIONS.includes(s));
  const send = async (e) => {
    e.preventDefault();
    if (problem || sending) return;
    setSending(true);
    setFailure(null);
    try {
      const out = await sendFeedback({ page: pageId, section: about, text: text.trim(), record_key: context.recordKey || '', filters: context.filters || '' });
      setText('');
      toast('Thanks. The owners of this use case see your report on its Build page in Inspire.');
      onSent?.(out);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setSending(false);
    }
  };
  if (reports?.ready === false) return <p className="why" data-feedback-note>{reports.note}</p>;
  return (
    <form className="fb-form" onSubmit={send} data-feedback-form>
      {reports?.where && <p className="why" data-feedback-where>{reports.where}</p>}
      {picks.length > 1 && context.section === 'settings' && (
        <label className="fb-about">About
          <select value={about} onChange={(e) => setAbout(e.target.value)} name="feedback_section">
            {picks.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
      )}
      <textarea ref={box} dir="auto" name="feedback_text" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="What is wrong, or what would you change?"
        placeholder="What is wrong, or what would you change?" aria-invalid={!!problem} />
      <p className={`fb-count ${problem ? 'is-over' : ''}`} data-feedback-count>{feedbackChars(text).toLocaleString('en-US')} / {FEEDBACK_CHARS.toLocaleString('en-US')}</p>
      {problem && <p className="err" role="alert">{problem}</p>}
      <p className="why" data-feedback-context>
        Sent with: the {about} section{context.filters && context.filters !== 'none' ? `, filters ${context.filters}` : ''}{context.recordKey ? `, record ${context.recordKey}` : ''}.
      </p>
      <Failure failure={failure} className="err">{failure?.text}</Failure>
      <button type="submit" className="btn btn--pri" disabled={!text.trim() || !!problem || sending} data-feedback-send>
        <Icon name="send" size={14} />{sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}

function FeedbackList({ data, failure }) {
  if (failure?.text) return <Failure failure={failure} className="err">{failure.text}</Failure>;
  if (!data) return null;
  if (data.missing) return <p className="why" data-feedback-missing>This App was built before it kept reported issues. Ask an owner to rebuild it from the Build page in Inspire.</p>;
  if (!data.items?.length) return null;
  return (
    <div className="fb-list" data-feedback-list>
      <b>{data.everyone ? 'Reported issues' : 'Your reports'}</b>
      <ul>
        {data.items.map((item) => (
          <li key={item.feedback_id} data-feedback-item={item.feedback_id}>
            <span dir="auto">{item.text}</span>
            <small>{[item.section, data.everyone ? item.reported_by : '', item.reported_at ? dayLabel(String(item.reported_at).slice(0, 10)) : '',
              feedbackStatusText(item.status)].filter(Boolean).join(' · ')}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeedbackButton({ pageId, context, sections, reports = null }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={anchor} type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open} data-feedback-open
        title="Tell the owners of this use case what is wrong or what you would change">
        <Icon name="info" size={15} /><span>Report an issue</span>
      </button>
      {open && (
        <Popover anchor={anchor.current} onClose={close} label="Report an issue" width={340}>
          <FeedbackForm pageId={pageId} context={context} sections={sections} onSent={close} autoFocus reports={reports} />
        </Popover>
      )}
    </>
  );
}

export function FeedbackScreen({ pageId, context, sections, reports = null }) {
  return (
    <section className="card" aria-label="Feedback" data-feedback-screen>
      <FeedbackButton pageId={pageId} context={context} sections={sections} reports={reports} />
    </section>
  );
}

export function ReportedIssues({ pageId }) {
  const feedback = useFeedback(pageId);
  const empty = !!feedback.data && !feedback.data.missing && !feedback.data.items?.length;
  return (
    <section className="card" aria-label="Reported issues" data-reported-issues>
      <FeedbackList data={feedback.data} failure={feedback.failure} />
      {empty && <p className="why" data-feedback-empty>Nobody has reported an issue with this App yet.</p>}
    </section>
  );
}

export function FeedbackSettings({ pageId, context, sections, reports = null }) {
  const feedback = useFeedback(pageId);
  return (
    <>
      <FeedbackForm pageId={pageId} context={context} sections={sections} onSent={(out) => feedback.setData(out)} reports={reports} />
      <FeedbackList data={feedback.data} failure={feedback.failure} />
    </>
  );
}
