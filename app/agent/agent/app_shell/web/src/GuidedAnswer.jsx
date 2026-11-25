// REQ-535 (D-UX-4, D-UX-5): a ranked Genie answer read as five steps, one at a time, with "Show all steps".
import { useState } from 'react';
import { cellText, answerLabel } from './format.js';
import { ConfirmCard, confirmWrite } from './AgentParts.jsx';
import { PlainNote } from './ui.jsx';

// UX-C builds explainers.js in parallel; until it is merged the chip is simply absent.
const MODULES = import.meta.glob('./explainers.js', { eager: true });
const explainerFor = Object.values(MODULES)[0]?.explainerFor;
const chipText = (kind) => {
  const x = kind && typeof explainerFor === 'function' ? explainerFor(kind) : null;
  const t = typeof x === 'string' ? x : x?.title ?? x?.label ?? x?.name;
  return typeof t === 'string' ? t : '';
};

function Bars({ step, max }) {
  return (
    <ol className="gd-bars" aria-label={`Ranked by ${answerLabel(step.measure)}`}>
      {step.bars.slice(0, 8).map((b) => (
        <li key={b.label}><span className="gd-bl" title={b.label}>{b.label}</span><span className="gd-bt"><i style={{ width: `${max > 0 ? Math.max(2, Math.round((Math.max(b.value, 0) / max) * 100)) : 0}%` }} /></span><b>{cellText(b.value, { name: step.measure, type: 'DOUBLE' })}</b></li>
      ))}
    </ol>
  );
}

function StepBody({ step, genie, message, onStart }) {
  if (step.id === 'look') return <Bars step={step} max={Math.max(...step.bars.map((b) => b.value), 0)} />;
  if (step.id === 'means') {
    const chip = chipText(step.kind);
    return chip ? <span className="gd-chip" data-explainer={step.kind}>{chip}</span> : <p className="gd-quiet">Read the ranking from the top: the first rows matter most.</p>;
  }
  if (step.id === 'do') {
    if (!step.top.key) return <p>{step.top.label} is first. This answer carries no record to open.</p>;
    return (
      <div className="gd-do">
        <p>Begin with <b>{step.top.label}</b>.</p>
        <div className="gd-act">
          {step.actions.includes('start') && <button type="button" className="btn btn--sm btn--pri" data-guide-start onClick={() => onStart(step.top.key)}>Start</button>}
          {step.actions.includes('open') && <button type="button" className="btn btn--sm" data-guide-open onClick={() => genie.openRecord(genie.key, step.top.key)}>Open</button>}
        </div>
      </div>
    );
  }
  return <p>{step.text}</p>;
}

export default function GuidedAnswer({ guide, genie, message }) {
  const [at, setAt] = useState(0);
  const [all, setAll] = useState(false);
  const steps = guide.steps;
  const shown = all ? steps : [steps[at]];
  const onStart = (key) => genie.offer?.(message.k ?? genie.key, message.n, 'done', key, {});
  return (
    <section className="gd" aria-label="Guided answer" data-guided>
      {shown.map((step) => (
        <div key={step.id} className="gd-step" data-guide-step={step.id}>
          <h4><span>{steps.indexOf(step) + 1}</span>{step.title}</h4>
          <StepBody step={step} genie={genie} message={message} onStart={onStart} />
        </div>
      ))}
      <div className="gd-nav">
        {!all && <button type="button" className="btn btn--sm" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</button>}
        {!all && <button type="button" className="btn btn--sm" disabled={at === steps.length - 1} onClick={() => setAt(at + 1)}>Next</button>}
        {!all && <small>{at + 1} of {steps.length}</small>}
        <button type="button" className="link" aria-pressed={all} onClick={() => setAll(!all)}>{all ? 'Show one step at a time' : 'Show all steps'}</button>
      </div>
      {message.offerError && <PlainNote text={message.offerError} className="g-err" role="alert" />}
      {!message.agent && <ConfirmCard confirm={message.confirm} write={confirmWrite(message.k ?? genie.key, message.n)} onConfirm={() => genie.confirm(message.k ?? genie.key, message.n)}
        onCancel={() => genie.cancel(message.k ?? genie.key, message.n)} onUndo={() => genie.undoSaved(message.k ?? genie.key, message.n)} />}
    </section>
  );
}
