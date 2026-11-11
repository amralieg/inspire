import { useState } from 'react';
import { Icon } from './icons.jsx';
import { confirmText } from './agentView.js';
import { SaveButton } from './saving.jsx';
import './styles/agent.css';
import { AccessActions, PlainNote } from './ui.jsx';

export const RATINGS = [{ id: 'POSITIVE', label: 'Helpful' }, { id: 'NEGATIVE', label: 'Not helpful' }];

export function AgentSteps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="ag-steps" aria-label="What Genie did">
      {steps.map((s, i) => <li key={i} data-step={s.tool}><Icon name={s.tool === 'ask_genie' ? 'code' : s.tool === 'refused' ? 'info' : 'check'} size={12} />{s.text}</li>)}
    </ol>
  );
}

function savedText(result) {
  const written = result?.written?.length || 0;
  const conflicts = result?.conflicts_count || 0;
  return `Saved ${written} ${written === 1 ? 'record' : 'records'}${conflicts ? `; ${conflicts} changed meanwhile and were left as they are` : ''}.`;
}

export const confirmWrite = (k, n) => `confirm:${k}:${n}`;

export function ConfirmCard({ confirm, write, onConfirm, onCancel, onUndo }) {
  if (!confirm) return null;
  const asking = confirm.state === 'ask' || confirm.state === 'saving';
  const values = Object.entries(confirm.values || {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ');
  return (
    <div className="ag-confirm" role="group" aria-label={confirmText(confirm)} data-confirm={confirm.state}>
      <b>{confirmText(confirm)}</b>
      {values && <small>{values}</small>}
      <ul className="ag-rows">{(confirm.rows || []).map((r) => <li key={r.record_key} data-row={r.record_key}>{r.label}{r.label !== r.record_key ? <small> · {r.record_key}</small> : null}</li>)}</ul>
      {asking && (
        <div className="ag-act">
          <SaveButton write={write} className="btn btn--pri btn--sm" onClick={onConfirm}>Confirm</SaveButton>
          <button type="button" className="btn btn--sm" disabled={confirm.state === 'saving'} onClick={onCancel}>Cancel</button>
        </div>
      )}
      {confirm.state === 'saved' && (
        <p className="ag-done" role="status">{savedText(confirm.result)}
          {confirm.result?.batch_id && <SaveButton write={`${write}:undo`} className="link" onClick={onUndo}>Undo</SaveButton>}</p>
      )}
      {confirm.state === 'undone' && <p className="ag-done" role="status">Undone. The records are back as they were.</p>}
      {confirm.state === 'cancelled' && <p className="ag-done">Cancelled. Nothing changed.</p>}
      {confirm.error && confirm.state !== 'saving' && <PlainNote text={confirm.error} className="g-err" role="alert" />}
    </div>
  );
}

export function ViewUndo({ message, onUndo }) {
  if (!message.undo && !message.viewUndone) return null;
  return (
    <p className="ag-view" data-view-undo={message.viewUndone ? 'done' : 'ready'}>
      <Icon name="sliders" size={12} />
      {message.viewUndone ? 'The view is back as it was.' : <>Genie changed the view. <button type="button" className="link" onClick={onUndo}>Undo</button></>}
    </p>
  );
}

export function Rate({ message, onRate, disabled }) {
  if (!message.turn_id || message.refused) return null;
  return (
    <span className="ag-rate" role="group" aria-label="Rate this answer">
      {RATINGS.map((r) => (
        <SaveButton key={r.id} write={`rate:${message.turn_id}:${r.id}`} className={`btn btn--sm ${message.rated === r.id ? 'btn--pri' : ''}`} aria-pressed={message.rated === r.id} data-rating={r.id}
          disabled={disabled} onClick={() => onRate(r.id)}>{r.label}</SaveButton>
      ))}
      {message.rateError && <PlainNote text={message.rateError} as="small" className="g-err" />}
    </span>
  );
}

const OFFER_BUTTONS = [['done', 'Mark done'], ['not_an_issue', 'Not an issue'], ['snooze', 'Snooze'], ['assign', 'Assign']];
const OFFER_ASK = {
  not_an_issue: { label: 'Reason', type: 'text', key: 'reason' },
  snooze: { label: 'Snooze until', type: 'date', key: 'until' },
  assign: { label: 'Assign to', type: 'text', key: 'owner' },
};

export function Offers({ message, genie }) {
  const [asking, setAsking] = useState(null);
  const [value, setValue] = useState('');
  const offers = message.offers;
  if (!offers?.rows?.length) return null;
  const k = message.k;
  const start = (action, recordKey) => {
    if (action === 'done') genie.offer(k, message.n, action, recordKey, {});
    else { setAsking({ action, recordKey }); setValue(''); }
  };
  const send = (event) => {
    event.preventDefault();
    const spec = OFFER_ASK[asking.action];
    genie.offer(k, message.n, asking.action, asking.recordKey, { [spec.key]: value.trim() });
    setAsking(null);
  };
  return (
    <div className="msg-t ag-offers" role="group" aria-label="Actions on these records" data-offers>
      <table>
        <thead><tr><th>Record</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {offers.rows.map((r) => (
            <tr key={r.record_key} data-offer={r.record_key}>
              <td>{r.label}</td><td>{r.status}</td>
              <td className="ag-offer-acts">
                {OFFER_BUTTONS.map(([action, label]) => (
                  <button key={action} type="button" className="btn btn--sm" onClick={() => start(action, r.record_key)}>{label}</button>
                ))}
                <button type="button" className="btn btn--sm" onClick={() => genie.openRecord(k, r.record_key)}>Open record</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {asking && (
        <form className="ag-offer-ask" onSubmit={send} data-offer-ask={asking.action}>
          <label>{OFFER_ASK[asking.action].label}
            <input type={OFFER_ASK[asking.action].type} dir="auto" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
          </label>
          <button type="submit" className="btn btn--sm btn--pri">Prepare</button>
          <button type="button" className="btn btn--sm" onClick={() => setAsking(null)}>Cancel</button>
        </form>
      )}
      {message.offerError && <PlainNote text={message.offerError} className="g-err" role="alert" />}
    </div>
  );
}

export function NextSteps({ message, genie }) {
  if (message.stepped) return <p className="ag-view" role="status" data-next-done>{message.stepped}</p>;
  if (!message.next?.length) return null;
  return (
    <div className="g-sugg ag-next" aria-label="Next steps" data-next>
      {message.next.map((step, i) => (
        <button key={step.label} type="button" className="sugg" data-next-step={i} onClick={() => genie.step(message.k, message.n, i)}>{step.label}</button>
      ))}
    </div>
  );
}

export function RecordOffers({ message, genie }) {
  return (
    <>
      <Offers message={message} genie={genie} />
      <ConfirmCard confirm={message.confirm} write={confirmWrite(message.k, message.n)} onConfirm={() => genie.confirm(message.k, message.n)}
        onCancel={() => genie.cancel(message.k, message.n)} onUndo={() => genie.undoSaved(message.k, message.n)} />
    </>
  );
}

export function AgentExtras({ message, genie, rating = true }) {
  if (!message.agent) return null;
  const k = message.k;
  return (
    <>
      <Offers message={message} genie={genie} />
      <NextSteps message={message} genie={genie} />
      <ViewUndo message={message} onUndo={() => genie.undoView(k, message.n)} />
      {message.confirm?.kind === 'access'
        ? <div className="ag-confirm" data-confirm="access"><AccessActions access={message.confirm.access} /></div>
        : <ConfirmCard confirm={message.confirm} write={confirmWrite(k, message.n)} onConfirm={() => genie.confirm(k, message.n)} onCancel={() => genie.cancel(k, message.n)}
          onUndo={() => genie.undoSaved(k, message.n)} />}
      {rating && <Rate message={message} onRate={(r) => genie.rate(k, message.n, r)} />}
    </>
  );
}
