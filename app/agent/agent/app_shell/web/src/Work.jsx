import { useCallback, useEffect, useRef, useState } from 'react';
import { actRecords, getBatches, getSimilar, toneOf, undoRecords } from './api.js';
import { withNotice } from './alerts.js';
import { compareValues, countOf, integer, plainText } from './format.js';
import { Icon } from './icons.jsx';
import { Popover, useDialog, useToast } from './ui.jsx';
import {
  NOTE_CHARS, REASON_CHARS, SIMILAR_SHOWN, STATUSES, UNDO_MS, actOutcome, actedText, actionProblem, asOfText, batchText, byWords, conflictText,
  recordsText, statusLabel, undoText,
} from './records.js';

export const SHORTCUTS = [
  ['j or Down arrow', 'Go to the next record'], ['k or Up arrow', 'Go to the previous record'], ['Enter', 'Open the record'],
  ['d', 'Mark it as fixed'], ['s', 'Snooze it until tomorrow'], ['a', 'Give it to someone'], ['x', 'Select it, or clear it'],
  ['u', 'Undo your last change'], ['/', 'Search the list'], ['Esc', 'Close'], ['?', 'Show these shortcuts'],
];

export function isTyping(target) {
  const el = target instanceof Element ? target : null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('[contenteditable="true"]'));
}

export function useActs({ pageId, similarBy, onActed, labelOf }) {
  const toast = useToast();
  const last = useRef('');
  const names = useRef(labelOf);
  names.current = labelOf;
  const [conflicts, setConflicts] = useState(null);
  const [similar, setSimilar] = useState(null);
  const undo = useCallback(async (batch) => {
    if (!batch) {
      toast('Nothing to undo yet');
      return null;
    }
    try {
      const out = await undoRecords({ page: pageId, batch_id: batch });
      if (last.current === batch) last.current = '';
      toast(undoText(out, names.current));
      onActed();
      return out;
    } catch (err) {
      toast(err.message, toneOf(err));
      return null;
    }
  }, [pageId, onActed, toast]);
  const act = async (body, values, { said, about } = {}) => {
    const out = await actRecords({ page: pageId, ...body, values });
    const outcome = actOutcome(out);
    if (outcome.batch) last.current = outcome.batch;
    setConflicts(outcome.conflicts ? outcome : null);
    const by = (similarBy || []).map((b) => b?.filter).filter(Boolean);
    const found = about && by.length ? await getSimilar(pageId, about.record_key, by).catch(() => null) : null;
    const actions = [
      ...(outcome.batch ? [{ label: 'Undo', run: () => undo(outcome.batch) }] : []),
      ...(compareValues(countOf(found?.count), 0) > 0 && found.match ? [{ label: `Apply to ${integer(found.count)} similar`, run: () => setSimilar({ ...found, values, about }) }] : []),
    ];
    toast(withNotice(said && !outcome.conflicts ? said : actedText(outcome, values), out), 'info', { actions, ms: UNDO_MS });
    onActed();
    return outcome;
  };
  return { act, undo, undoLast: () => undo(last.current), conflicts, clearConflicts: () => setConflicts(null), similar, closeSimilar: () => setSimilar(null) };
}

export function NoteField({ name, value, onChange, label = 'Note' }) {
  return (
    <label className="in">
      <span>{label}<small> · optional · {String(value).trim().length}/{NOTE_CHARS}</small></span>
      <textarea name={name} rows={2} maxLength={NOTE_CHARS} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const withNote = (values, note) => (note.trim() ? { ...values, note: note.trim() } : values);

export function ConflictNote({ conflicts, labelOf, onClose }) {
  if (!conflicts?.conflicts) return null;
  const names = conflicts.sample.map((c) => labelOf(c)).filter(Boolean);
  return (
    <div className="hint hint--box conflicts" role="alert">
      <Icon name="info" size={14} />
      <span>{conflictText(conflicts.conflicts)}{names.length ? `: ${names.join(', ')}${conflicts.conflicts > names.length ? `, and ${integer(conflicts.conflicts - names.length)} more` : ''}` : ''}.</span>
      <button type="button" className="ibtn ibtn--sm" onClick={onClose} aria-label="Close this notice"><Icon name="x" size={14} /></button>
    </div>
  );
}

export function BulkBar({ picked, matching, total, allOnPage, owners, person, busy, tomorrow, canMatch = true, onAct, onAll, onClear }) {
  const anchors = { done: useRef(null), assign: useRef(null), status: useRef(null), snooze: useRef(null) };
  const [open, setOpen] = useState('');
  const [owner, setOwner] = useState(person);
  const [status, setStatus] = useState('In progress');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState(tomorrow);
  const close = useCallback(() => setOpen(''), []);
  const n = matching ? matching.total : picked.size;
  const what = recordsText(n);
  const problem = actionProblem({ status, reason });
  const submit = (values) => (e) => {
    e.preventDefault();
    onAct(withNote(values, note));
    setNote('');
    close();
  };
  const toggle = (name) => () => setOpen(open === name ? '' : name);
  const note500 = <NoteField name="bulk_note" value={note} onChange={setNote} />;
  return (
    <div className="bulk" role="region" aria-label="Selected records">
      {matching ? <b>All {integer(matching.total)} matching records selected</b> : <b>{n} selected:</b>}
      <button ref={anchors.done} className="btn" onClick={toggle('done')} aria-expanded={open === 'done'} disabled={busy}><Icon name="check" size={14} />Mark done…</button>
      <button ref={anchors.assign} className="btn" onClick={toggle('assign')} aria-expanded={open === 'assign'} disabled={busy}>Assign to…</button>
      <button ref={anchors.status} className="btn" onClick={toggle('status')} aria-expanded={open === 'status'} disabled={busy}>Set status…</button>
      <button ref={anchors.snooze} className="btn" onClick={toggle('snooze')} aria-expanded={open === 'snooze'} disabled={busy}>Snooze…</button>
      {!matching && canMatch && allOnPage && total > picked.size && <button className="link" onClick={onAll}>Select all {integer(total)} matching</button>}
      <span className="sp" />
      <button className="link" onClick={onClear}>Clear selection</button>
      {matching && <small className="bulk-asof">As of {asOfText(matching.as_of_us)}. A record that changes after that is left as it is.</small>}
      {open === 'done' && (
        <Popover anchor={anchors.done.current} onClose={close} label="Mark the selected records done" width={300}>
          <form className="bulk-pop" onSubmit={submit({ action_status: 'Done' })}>
            {note500}
            <button type="submit" className="btn btn--pri"><Icon name="check" size={14} />Mark {what} done</button>
          </form>
        </Popover>
      )}
      {open === 'assign' && (
        <Popover anchor={anchors.assign.current} onClose={close} label="Assign the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit({ action_owner: owner.trim() })}>
            <label className="in"><span>Owner</span><input name="bulk_owner" autoFocus value={owner} onChange={(e) => setOwner(e.target.value)} list="owners-bulk" maxLength={254} autoComplete="off" /></label>
            <datalist id="owners-bulk">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            {note500}
            <button type="submit" className="btn btn--pri" disabled={!owner.trim()}>Assign {what}</button>
          </form>
        </Popover>
      )}
      {open === 'status' && (
        <Popover anchor={anchors.status.current} onClose={close} label="Set the status of the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit(status === 'Dismissed' ? { action_status: status, dismiss_reason: reason.trim() } : { action_status: status })}>
            <label className="in"><span>Status</span><select name="bulk_status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
            {status === 'Dismissed' && (
              <label className="in">
                <span>Why are these not real issues? *</span>
                <textarea name="bulk_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
                {problem && <small className="in-err">{problem}</small>}
              </label>
            )}
            {note500}
            <button type="submit" className="btn btn--pri" disabled={!!problem}>Set status of {what}</button>
          </form>
        </Popover>
      )}
      {open === 'snooze' && (
        <Popover anchor={anchors.snooze.current} onClose={close} label="Snooze the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit({ snooze_until: until })}>
            <label className="in"><span>Snooze until</span><input type="date" name="bulk_snooze" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
            {note500}
            <button type="submit" className="btn btn--pri" disabled={!until || until < tomorrow}>Snooze {what}</button>
          </form>
        </Popover>
      )}
    </div>
  );
}

export function SimilarDialog({ similar, onClose, onApply }) {
  const ref = useDialog(true, onClose);
  const [status, setStatus] = useState(similar.values?.action_status || 'Done');
  const [reason, setReason] = useState(similar.values?.dismiss_reason || '');
  const [note, setNote] = useState(similar.values?.note || '');
  const [saving, setSaving] = useState(false);
  const n = countOf(similar.count);
  const sample = (similar.sample || []).slice(0, SIMILAR_SHOWN);
  const problem = actionProblem({ status, reason });
  const said = byWords(similar.by);
  const apply = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onApply(withNote(status === 'Dismissed' ? { action_status: status, dismiss_reason: reason.trim() } : { action_status: status }, note));
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog ref={ref} className="dialog" aria-label="Apply to similar records" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg" onSubmit={apply}>
        <header>
          <h2>Apply to {recordsText(n)} like {similar.about?.label || 'this one'}?</h2>
          <p>{n === 1 ? 'This open record shares' : `These ${integer(n)} open records share`} {said || 'the same values'}. Nothing changes until you apply.</p>
        </header>
        {sample.length > 0 && (
          <div className="sim">
            <b>{n > sample.length ? `${integer(sample.length)} of the ${integer(n)}` : n === 1 ? 'The record' : `All ${integer(n)}`}</b>
            <ul>{sample.map((s, i) => <li key={s.record_key ?? i}>{plainText(s.label ?? s.record_key)}</li>)}</ul>
          </div>
        )}
        <label className="in"><span>Status</span><select name="similar_status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
        {status === 'Dismissed' && (
          <label className="in"><span>Why are these not real issues? *</span>
            <textarea name="similar_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
            {problem && <small className="in-err">{problem}</small>}
          </label>
        )}
        <NoteField name="similar_note" value={note} onChange={setNote} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--pri" disabled={saving || !!problem || !n || !similar.match}>{saving ? 'Applying…' : `Apply to ${recordsText(n)}`}</button>
        </footer>
      </form>
    </dialog>
  );
}

export function BatchesDialog({ pageId, onClose, onUndo, labelOf }) {
  const ref = useDialog(true, onClose);
  const [state, setState] = useState({ busy: true, error: '', list: [] });
  const [undone, setUndone] = useState({});
  useEffect(() => {
    let live = true;
    getBatches(pageId)
      .then((d) => { if (live) setState({ busy: false, error: '', list: d?.batches || [] }); })
      .catch((e) => { if (live) setState({ busy: false, error: e.message, list: [] }); });
    return () => { live = false; };
  }, [pageId]);
  const undo = async (batch) => {
    setUndone((u) => ({ ...u, [batch]: 'Undoing…' }));
    const out = await onUndo(batch);
    setUndone((u) => ({ ...u, [batch]: out ? undoText(out, labelOf) : '' }));
  };
  return (
    <dialog ref={ref} className="dialog" aria-label="Recent changes" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg dlg--form">
        <header>
          <h2>Recent changes</h2>
          <p>Each change made to many records at once, newest first. Undo puts the records back as they were, and keeps both versions in their history.</p>
        </header>
        <div className="dlg-b">
          {state.busy && <p className="more">Loading the changes…</p>}
          {state.error && <p className="tile-err" role="alert"><Icon name="info" size={14} />The changes could not load: {state.error}</p>}
          {!state.busy && !state.error && !state.list.length && <p className="more">No change recorded on this list yet.</p>}
          {state.list.length > 0 && (
            <ul className="batches">
              {state.list.map((b) => (
                <li key={b.batch_id} data-batch={b.batch_id}>
                  <span>{batchText(b)}</span>
                  {b.undone ? <small className="faint">Undone</small> : undone[b.batch_id] ? <small role="status">{undone[b.batch_id]}</small>
                    : !b.undoes && <button type="button" className="btn" onClick={() => undo(b.batch_id)}><Icon name="undo" size={13} />Undo</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer><button type="button" className="btn btn--pri" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}

export function HelpDialog({ onClose }) {
  const ref = useDialog(true, onClose);
  return (
    <dialog ref={ref} className="dialog" aria-label="Keyboard shortcuts" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg">
        <header><h2>Keyboard shortcuts</h2><p>They work on the list and in an open record, never while you type in a box.</p></header>
        <dl className="keys">{SHORTCUTS.map(([key, what]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{what}</dd></div>)}</dl>
        <footer><button type="button" className="btn btn--pri" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}

export function CaughtUp({ work, onClose }) {
  const ref = useDialog(true, onClose);
  const seen = work.done + work.snoozed + work.skipped;
  return (
    <dialog ref={ref} className="dialog" aria-label="All caught up" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg">
        <header>
          <h2>All caught up</h2>
          <p>{`You went through ${recordsText(seen)}: ${integer(work.done)} marked as fixed, ${integer(work.snoozed)} snoozed and ${integer(work.skipped)} skipped.`}</p>
        </header>
        <footer><button type="button" className="btn btn--pri" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}
