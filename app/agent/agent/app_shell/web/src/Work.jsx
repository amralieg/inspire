import { useCallback, useEffect, useRef, useState } from 'react';
import { actRecords, getBatches, getSimilar, toneOf, undoRecords } from './api.js';
import { withNotice } from './alerts.js';
import { compareValues, countOf, integer, plainText } from './format.js';
import { Icon } from './icons.jsx';
import { Popover, SaidNote, useDialog, useToast, PlainNote } from './ui.jsx';
import { SaveButton, runWrite, useWrite } from './saving.jsx';
import { localDay, nextDay } from './prefs.js';
import {
  DRAFT_LABEL, DRAFT_RECORDS, NOTE_CHARS, NO_AS_OF, NO_SIMILAR, REASON_CHARS, actError, listAsOf, matchOf, SIMILAR_KEYS, SIMILAR_SHOWN, STATUSES, UNDO_MS, actOutcome, actedText, actionProblem, asOfText, batchText, byWords, conflictText,
  recordsText, statusLabel, undoText, UNDO_THEIRS,
} from './records.js';

export const SHORTCUTS = [
  ['j or Down arrow', 'Go to the next record'], ['k or Up arrow', 'Go to the previous record'], ['Enter', 'Open the record'],
  ['d', 'Mark it done'], ['s', 'Snooze it until tomorrow'], ['a', 'Give it to someone'], ['x', 'Select it, or clear it'],
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
  const [said, setSaid] = useState(null);
  const told = useRef(0);
  const undo = useCallback(async (batch, key = `undo:${batch}`) => {
    if (!batch) {
      toast('Nothing to undo yet');
      return null;
    }
    try {
      const out = await runWrite(key, () => undoRecords({ page: pageId, batch_id: batch }));
      if (!out) return null;
      if (last.current === batch) last.current = '';
      const text = undoText(out, names.current);
      setSaid({ key: 'all', text });
      toast(text);
      onActed();
      return out;
    } catch (err) {
      toast(err.message, toneOf(err));
      return null;
    }
  }, [pageId, onActed, toast]);
  const write = async (body, values, { said, about } = {}) => {
    const out = await actRecords({ page: pageId, ...body, values });
    const outcome = actOutcome(out);
    if (outcome.batch) last.current = outcome.batch;
    setConflicts(outcome.conflicts ? outcome : null);
    const undoing = outcome.batch ? [{ label: 'Undo', run: () => undo(outcome.batch) }] : [];
    const text = withNotice(said && !outcome.conflicts && !outcome.leftOut ? said : actedText(outcome, values), out);
    const one = about?.record_key ?? (body.record_keys?.length === 1 ? body.record_keys[0] : null);
    const mine = ++told.current;
    setSaid({ key: one == null ? 'all' : String(one), text });
    toast(text, 'info', { actions: undoing, ms: UNDO_MS });
    onActed();
    const by = (similarBy || []).map((b) => b?.filter).filter(Boolean);
    if (about && by.length) {
      getSimilar(pageId, about.record_key, by).then((found) => {
        if (told.current !== mine || !(compareValues(countOf(found?.count), 0) > 0 && found.match)) return;
        toast(text, 'info', { actions: [...undoing, { label: `Apply to ${integer(found.count)} similar`, run: () => setSimilar({ ...found, values, about }) }], ms: UNDO_MS });
      }).catch(() => {});
    }
    return outcome;
  };
  const act = (body, values, { key = 'act', inside = false, ...opts } = {}) => runWrite(key, () => write(body, values, opts), { rows: body?.record_keys || [], inside });
  const findSimilar = async (keys, about) => {
    const by = (similarBy || []).map((b) => b?.filter).filter(Boolean);
    if (!by.length || !keys.length) return null;
    try {
      const found = await getSimilar(pageId, keys, by);
      if (compareValues(countOf(found?.count), 0) > 0 && found.match) setSimilar({ ...found, values: {}, about });
      else toast(NO_SIMILAR);
      return found;
    } catch (err) {
      toast(err.message, toneOf(err));
      return null;
    }
  };
  const saidAt = (key) => (said && said.key === String(key) ? <SaidNote text={said.text} at={said.key} /> : null);
  return { act, undo, undoLast: () => undo(last.current), said, saidAt, conflicts, clearConflicts: () => setConflicts(null), similar, closeSimilar: () => setSimilar(null),
    findSimilar };
}

export function NoteField({ name, value, onChange, label = 'Note' }) {
  return (
    <label className="in">
      <span>{label}<small> · optional · {String(value).trim().length}/{NOTE_CHARS}</small></span>
      <textarea dir="auto" name={name} rows={2} maxLength={NOTE_CHARS} value={value} onChange={(e) => onChange(e.target.value)} />
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

export function BulkBar({ picked, matching, total, capped = false, allOnPage, owners, person, tomorrow, canMatch = true, onAct, onAll, onClear, onAccept = null,
  onSimilar = null, onDraft = null }) {
  const { busy } = useWrite();
  const anchors = { done: useRef(null), dismiss: useRef(null), assign: useRef(null), status: useRef(null), snooze: useRef(null) };
  const [open, setOpen] = useState('');
  const [owner, setOwner] = useState(person);
  const [status, setStatus] = useState('In progress');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState(tomorrow);
  const close = useCallback(() => setOpen(''), []);
  const n = matching ? matching.total : picked.size;
  const over = matching?.capped ? 'more than ' : '';
  const what = `${over}${recordsText(n)}`;
  const problem = actionProblem({ status, reason });
  const why = actionProblem({ status: 'Dismissed', reason });
  const submit = (name, values) => async (e) => {
    e.preventDefault();
    if (!(await onAct(withNote(values, note), { key: `bulk:${name}` }))) return;
    setNote('');
    close();
  };
  const toggle = (name) => () => setOpen(open === name ? '' : name);
  const note500 = <NoteField name="bulk_note" value={note} onChange={setNote} />;
  return (
    <div className="bulk" role="region" aria-label="Selected records">
      {matching ? <b>All {over}{integer(matching.total)} matching records selected</b> : <b>{n} selected:</b>}
      {onAccept && <SaveButton write="bulk:accept" className="btn btn--pri" onClick={onAccept} data-accept-picked><Icon name="check" size={14} />Accept the suggestions</SaveButton>}
      <SaveButton write="bulk:done" ref={anchors.done} onClick={toggle('done')} aria-expanded={open === 'done'} data-bulk="done"><Icon name="check" size={14} />{matching ? 'Mark all done…' : 'Mark done…'}</SaveButton>
      <SaveButton write="bulk:dismiss" ref={anchors.dismiss} onClick={toggle('dismiss')} aria-expanded={open === 'dismiss'} data-bulk="dismiss">{matching ? 'Not an issue for all…' : 'Not an issue…'}</SaveButton>
      <SaveButton write="bulk:assign" ref={anchors.assign} onClick={toggle('assign')} aria-expanded={open === 'assign'}>Assign to…</SaveButton>
      <SaveButton write="bulk:status" ref={anchors.status} onClick={toggle('status')} aria-expanded={open === 'status'}>Set status…</SaveButton>
      <SaveButton write="bulk:snooze" ref={anchors.snooze} onClick={toggle('snooze')} aria-expanded={open === 'snooze'} data-bulk="snooze">{matching ? 'Snooze all…' : 'Snooze…'}</SaveButton>
      {onSimilar && !matching && picked.size <= SIMILAR_KEYS && <button className="btn" onClick={onSimilar} disabled={busy} data-bulk="similar">Apply to similar…</button>}
      {onDraft && !matching && (
        <button className="btn" onClick={onDraft} disabled={picked.size > DRAFT_RECORDS} data-bulk="draft"
          title={picked.size > DRAFT_RECORDS ? `One message covers at most ${DRAFT_RECORDS} records: select fewer to draft one` : undefined}>
          <Icon name="send" size={14} />{DRAFT_LABEL}
        </button>
      )}
      {!matching && canMatch && allOnPage && total > picked.size && <button className="link" onClick={onAll}>Select all {capped ? 'more than ' : ''}{integer(total)} matching</button>}
      <span className="sp" />
      <button className="link" onClick={onClear}>Clear selection</button>
      {matching && <small className="bulk-asof">As of {asOfText(matching.as_of_us)}. A record that changes after that is left as it is.</small>}
      {open === 'done' && (
        <Popover anchor={anchors.done.current} onClose={close} label="Mark the selected records done" width={300}>
          <form className="bulk-pop" onSubmit={submit('done', { action_status: 'Done' })}>
            {note500}
            <SaveButton write="bulk:done" type="submit" className="btn btn--pri"><Icon name="check" size={14} />Mark {what} done</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'dismiss' && (
        <Popover anchor={anchors.dismiss.current} onClose={close} label="Mark the selected records not an issue" width={300}>
          <form className="bulk-pop" onSubmit={submit('dismiss', { action_status: 'Dismissed', dismiss_reason: reason.trim() })}>
            <label className="in">
              <span>Why are these not issues? *</span>
              <textarea dir="auto" name="bulk_dismiss_reason" autoFocus rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={why ? true : undefined} />
              {why && <PlainNote text={why} as="small" className="in-err" />}
            </label>
            {note500}
            <SaveButton write="bulk:dismiss" type="submit" className="btn btn--pri" disabled={!!why}>Mark {what} not an issue</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'assign' && (
        <Popover anchor={anchors.assign.current} onClose={close} label="Assign the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit('assign', { action_owner: owner.trim() })}>
            <label className="in"><span>Owner</span><input dir="auto" name="bulk_owner" autoFocus value={owner} onChange={(e) => setOwner(e.target.value)} list="owners-bulk" maxLength={254} autoComplete="off" /></label>
            <datalist id="owners-bulk">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            {note500}
            <SaveButton write="bulk:assign" type="submit" className="btn btn--pri" disabled={!owner.trim()}>Assign {what}</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'status' && (
        <Popover anchor={anchors.status.current} onClose={close} label="Set the status of the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit('status', status === 'Dismissed' ? { action_status: status, dismiss_reason: reason.trim() } : { action_status: status })}>
            <label className="in"><span>Status</span><select name="bulk_status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
            {status === 'Dismissed' && (
              <label className="in">
                <span>Why are these not issues? *</span>
                <textarea dir="auto" name="bulk_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
                {problem && <PlainNote text={problem} as="small" className="in-err" />}
              </label>
            )}
            {note500}
            <SaveButton write="bulk:status" type="submit" className="btn btn--pri" disabled={!!problem}>Set status of {what}</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'snooze' && (
        <Popover anchor={anchors.snooze.current} onClose={close} label="Snooze the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit('snooze', { snooze_until: until })}>
            <label className="in"><span>Snooze until</span><input type="date" name="bulk_snooze" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
            {note500}
            <SaveButton write="bulk:snooze" type="submit" className="btn btn--pri" disabled={!until || until < tomorrow}>Snooze {what}</SaveButton>
          </form>
        </Popover>
      )}
    </div>
  );
}

const NO_PICKS = new Map();

export function QueueBulk({ pageId, list, asked, person = '', onChanged }) {
  const [on, setOn] = useState(false);
  const { busy } = useWrite();
  const toast = useToast();
  const acts = useActs({ pageId, similarBy: [], onActed: () => onChanged?.(), labelOf: (c) => plainText(c?.label ?? c?.record_key ?? '') });
  const total = countOf(list?.total);
  const asOf = listAsOf(list);
  if (!list?.actions || !(compareValues(total, 0) > 0)) return null;
  const act = async (values, { key } = {}) => {
    try {
      const out = await acts.act({ match: matchOf(asked, asOf) }, values, { key });
      if (out) setOn(false);
      return out;
    } catch (err) {
      toast(actError(err), toneOf(err));
      return null;
    }
  };
  if (!on) {
    return (
      <div className="queue-all">
        <button type="button" className="pick-i" data-act-all disabled={busy} onClick={() => (asOf ? setOn(true) : toast(NO_AS_OF, 'error'))}>
          Act on all {list.total_more ? 'more than ' : ''}{integer(total)} matching
        </button>
      </div>
    );
  }
  return (
    <BulkBar picked={NO_PICKS} matching={{ total, capped: !!list.total_more, as_of_us: asOf }} total={total} capped={!!list.total_more} allOnPage owners={list.summary?.owners || []}
      person={person} tomorrow={nextDay(localDay())} onAct={act} onAll={() => {}} onClear={() => setOn(false)} />
  );
}

const SIMILAR_WRITE = 'similar';

export function SimilarDialog({ similar, onClose, onApply }) {
  const ref = useDialog(true, onClose);
  const [status, setStatus] = useState(similar.values?.action_status || 'Done');
  const [reason, setReason] = useState(similar.values?.dismiss_reason || '');
  const [note, setNote] = useState(similar.values?.note || '');
  const n = countOf(similar.count);
  const sample = (similar.sample || []).slice(0, SIMILAR_SHOWN);
  const problem = actionProblem({ status, reason });
  const said = byWords(similar.by);
  const apply = async (e) => {
    e.preventDefault();
    if (await onApply(withNote(status === 'Dismissed' ? { action_status: status, dismiss_reason: reason.trim() } : { action_status: status }, note), SIMILAR_WRITE)) onClose();
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
          <label className="in"><span>Why are these not issues? *</span>
            <textarea dir="auto" name="similar_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
            {problem && <PlainNote text={problem} as="small" className="in-err" />}
          </label>
        )}
        <NoteField name="similar_note" value={note} onChange={setNote} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <SaveButton write={SIMILAR_WRITE} type="submit" className="btn btn--pri" disabled={!!problem || !n || !similar.match}>{`Apply to ${recordsText(n)}`}</SaveButton>
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
    const out = await onUndo(batch);
    if (out) setUndone((u) => ({ ...u, [batch]: undoText(out, labelOf) }));
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
          {state.error && <PlainNote text={state.error} prefix="The changes could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" />}
          {!state.busy && !state.error && !state.list.length && <p className="more">No change recorded on this list yet.</p>}
          {state.list.length > 0 && (
            <ul className="batches">
              {state.list.map((b) => (
                <li key={b.batch_id} data-batch={b.batch_id}>
                  <span>{batchText(b)}</span>
                  {b.undone ? <small className="faint">Undone</small> : undone[b.batch_id] ? <small role="status">{undone[b.batch_id]}</small>
                    : !b.undoes && (b.can_undo
                      ? <SaveButton write={`undo:${b.batch_id}`} onClick={() => undo(b.batch_id)}><Icon name="undo" size={13} />Undo</SaveButton>
                      : <small className="faint" data-undo-theirs>{UNDO_THEIRS}</small>)}
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
          <p>{`You went through ${recordsText(seen)}: ${integer(work.done)} marked done, ${integer(work.snoozed)} snoozed and ${integer(work.skipped)} skipped.`}</p>
        </header>
        <footer><button type="button" className="btn btn--pri" onClick={onClose}>Done</button></footer>
      </div>
    </dialog>
  );
}
