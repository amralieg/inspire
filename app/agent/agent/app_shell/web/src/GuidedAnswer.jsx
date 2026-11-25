// REQ-535 (D-UX-4, D-UX-5): a ranked Genie answer read as five steps, one at a time, with "Show all steps".
import { useState } from 'react';
import { cellText, answerLabel } from './format.js';
import { ConfirmCard, confirmWrite } from './AgentParts.jsx';
import { PlainNote } from './ui.jsx';
import { explainerFor } from './explainers.js';
import TermChip from './TermChip.jsx';

function Bars({ step, max }) {
  return (
    <ol className="gd-bars" aria-label={`Ranked by ${answerLabel(step.measure)}`}>
      {step.bars.slice(0, 8).map((b) => (
        <li key={b.label}><span className="gd-bl" title={b.label}>{b.label}</span><span className="gd-bt"><i style={{ width: `${max > 0 ? Math.max(2, Math.round((Math.max(b.value, 0) / max) * 100)) : 0}%` }} /></span><b>{cellText(b.value, { name: step.measure, type: 'DOUBLE' })}</b></li>
      ))}
    </ol>
  );
}

function StepBody({ step, genie, onStart, context }) {
  if (step.id === 'look') return <Bars step={step} max={Math.max(...step.bars.map((b) => b.value), 0)} />;
  if (step.id === 'means') {
    const x = step.kind ? explainerFor(step.kind) : null;
    if (!x) return <p className="gd-quiet">Read the ranking from the top: the first rows matter most.</p>;
    return <div className="gd-means" data-guide-kind={step.kind}><p>{x.what}</p>{x.terms[0] && <TermChip term={x.terms[0].term} kind={step.kind} context={context} />}</div>;
  }
  if (step.id === 'do') {
    if (!step.top.key) return <p>{step.top.label} is first. This answer carries no record to open.</p>;
    return (
      <div className="gd-do">
        <p>Begin with <b>{step.top.label}</b>.</p>
        <div className="gd-act">
          {step.actions.includes('start') && onStart && <button type="button" className="btn btn--sm btn--pri" data-guide-start onClick={() => onStart(step.top.key)}>Start</button>}
          {step.actions.includes('open') && <button type="button" className="btn btn--sm" data-guide-open onClick={() => genie.openRecord(genie.key, step.top.key)}>Open</button>}
        </div>
      </div>
    );
  }
  return <p>{step.text}</p>;
}

// person is the signed-in user (app.user.email): Start assigns the top record to them, as Records' "Give to me" does.
export default function GuidedAnswer({ guide, genie, message, person = '' }) {
  const [at, setAt] = useState(0);
  const [all, setAll] = useState(false);
  const steps = guide.steps;
  const shown = all ? steps : [steps[at]];
  const onStart = person ? (key) => genie.offer?.(message.k ?? genie.key, message.n, 'assign', key, { owner: person }) : null;
  const context = steps.find((s) => s.id === 'do')?.top?.label || '';
  return (
    <section className="gd" aria-label="Guided answer" data-guided>
      {shown.map((step) => (
        <div key={step.id} className="gd-step" data-guide-step={step.id}>
          <h4><span>{steps.indexOf(step) + 1}</span>{step.title}</h4>
          <StepBody step={step} genie={genie} onStart={onStart} context={context} />
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
