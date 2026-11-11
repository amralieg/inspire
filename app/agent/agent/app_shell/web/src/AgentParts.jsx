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

export function AgentExtras({ message, genie, rating = true }) {
  if (!message.agent) return null;
  const k = message.k;
  return (
    <>
      <ViewUndo message={message} onUndo={() => genie.undoView(k, message.n)} />
      {message.confirm?.kind === 'access'
        ? <div className="ag-confirm" data-confirm="access"><AccessActions access={message.confirm.access} /></div>
        : <ConfirmCard confirm={message.confirm} write={confirmWrite(k, message.n)} onConfirm={() => genie.confirm(k, message.n)} onCancel={() => genie.cancel(k, message.n)}
          onUndo={() => genie.undoSaved(k, message.n)} />}
      {rating && <Rate message={message} onRate={(r) => genie.rate(k, message.n, r)} />}
    </>
  );
}
