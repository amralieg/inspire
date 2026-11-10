import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { actRecords, getBatches, getSimilar, undoRecords } from './api.js';
import { FieldGrid, recordColumns } from './DataTable.jsx';
import { useHistory } from './History.jsx';
import { withNotice } from './alerts.js';
import { compareValues, countOf, integer, kindOf, plainText, unitOf } from './format.js';
import { Icon } from './icons.jsx';
import { Popover, SaidNote, useDialog, useToast, PlainNote, toastFailure } from './ui.jsx';
import { SaveButton, missingWhy, runWrite, useWrite } from './saving.jsx';
import { localDay, nextDay } from './prefs.js';
import {
  DRAFT_LABEL, DRAFT_RECORDS, NOTE_CHARS, NO_AS_OF, NO_SIMILAR, REASON_CHARS, actError, listAsOf, matchOf, SIMILAR_KEYS, SIMILAR_PAGE, SIMILAR_SUMMARY, UNDO_MS, CHOICE_COLUMN, DEFAULT_CHOICES, DISMISSED, DONE, IN_PROGRESS, choiceOf, choiceValues, statusKind, actOutcome, actedText, actionProblem, asOfText, batchText, byWords, conflictText,
  recordDetails, recordLine, recordRef, recordView, recordsText, reviewedText, statusLabel, undoText, UNDO_THEIRS,
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
      toastFailure(toast, err, () => undo(batch, key));
      return null;
    }
  }, [pageId, onActed, toast]);
  const write = async (body, values, { said, about, nameOf } = {}) => {
    const out = await actRecords({ page: pageId, ...body, values });
    const outcome = actOutcome(out);
    if (outcome.batch) last.current = outcome.batch;
    setConflicts(outcome.conflicts ? outcome : null);
    const undoing = outcome.batch ? [{ label: 'Undo', run: () => undo(outcome.batch) }] : [];
    const text = withNotice(said && !outcome.conflicts && !outcome.leftOut ? said : actedText(outcome, values, nameOf), out);
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
      toastFailure(toast, err, () => findSimilar(keys, about));
      return null;
    }
  };
  const applySimilar = function apply(keys, values, key) {
    const byKey = new Map((similar?.sample || []).map((r) => [String(r.record_key), r]));
    const nameOf = (k) => plainText(byKey.get(k)?.label ?? k);
    const seen = Object.fromEntries(keys.map((k) => [k, String(byKey.get(k)?.valid_from_us ?? '')]));
    return act({ record_keys: keys, seen, similar: similar?.match }, values, { key, nameOf }).catch((err) => {
      const changed = Array.isArray(err?.detail?.changed) ? err.detail.changed.map(String) : [];
      toastFailure(toast, err, () => apply(keys, values, key), changed.length ? `Nothing was saved: ${reviewedText(changed, nameOf)}.` : actError(err));
      return null;
    });
  };
  const saidAt = (key) => (said && said.key === String(key) ? <SaidNote text={said.text} at={said.key} /> : null);
  return { act, undo, undoLast: () => undo(last.current), said, saidAt, conflicts, clearConflicts: () => setConflicts(null), similar, closeSimilar: () => setSimilar(null),
    findSimilar, applySimilar };
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

export function ChoiceSelect({ name, choices, value, status, onChange }) {
  const known = (choices || []).some((c) => c.id === value);
  return (
    <select name={name} value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value="" disabled>{statusLabel(status)}</option>}
      {(choices || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

const choiceForm = (choices, choice, reason) => choiceValues(choice, statusKind(choice.status) === 'dismissed' ? reason.trim() : '', choices);
const firstChoice = (choices, status, id) => choiceOf(choices, status, id) || (choices || [])[0] || null;

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
  onSimilar = null, onDraft = null, choices = DEFAULT_CHOICES }) {
  const { busy } = useWrite();
  const anchors = { done: useRef(null), dismiss: useRef(null), assign: useRef(null), status: useRef(null), snooze: useRef(null) };
  const [open, setOpen] = useState('');
  const [owner, setOwner] = useState(person);
  const [choiceId, setChoiceId] = useState(() => firstChoice(choices, IN_PROGRESS)?.id || '');
  const choice = (choices || []).find((c) => c.id === choiceId) || null;
  const status = choice?.status || IN_PROGRESS;
  const closes = (kind) => (choices || []).some((c) => statusKind(c.status) === kind);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState(tomorrow);
  const close = useCallback(() => setOpen(''), []);
  const n = matching ? matching.total : picked.size;
  const over = matching?.capped ? 'more than ' : '';
  const what = matching ? `${over}${integer(n)} open ${n === 1 ? 'record' : 'records'}` : `${over}${recordsText(n)}`;
  const problem = actionProblem({ status, reason });
  const why = actionProblem({ status: DISMISSED, reason });
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
      {matching ? <b>All {over}{integer(matching.total)} open records selected{matching.closed ? `. ${integer(matching.closed)} closed stay as they are` : ''}</b> : <b>{n} selected:</b>}
      {onAccept && <SaveButton write="bulk:accept" className="btn btn--pri" onClick={onAccept} data-accept-picked><Icon name="check" size={14} />Accept the suggestions</SaveButton>}
      {closes('done') && <SaveButton write="bulk:done" ref={anchors.done} onClick={toggle('done')} aria-expanded={open === 'done'} data-bulk="done"><Icon name="check" size={14} />{matching ? 'Mark all as done…' : 'Mark done…'}</SaveButton>}
      {closes('dismissed') && <SaveButton write="bulk:dismiss" ref={anchors.dismiss} onClick={toggle('dismiss')} aria-expanded={open === 'dismiss'} data-bulk="dismiss">{matching ? 'Not an issue for all…' : 'Not an issue…'}</SaveButton>}
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
          <form className="bulk-pop" onSubmit={submit('done', { action_status: DONE })}>
            {note500}
            {matching?.closed > 0 && <small className="faint" data-closed-note>{integer(matching.closed)} closed {matching.closed === 1 ? 'record stays' : 'records stay'} as {matching.closed === 1 ? 'it is' : 'they are'}.</small>}
            <SaveButton write="bulk:done" type="submit" className="btn btn--pri"><Icon name="check" size={14} />{matching ? `Mark ${what} as done?` : `Mark ${what} done`}</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'dismiss' && (
        <Popover anchor={anchors.dismiss.current} onClose={close} label="Mark the selected records not an issue" width={300}>
          <form className="bulk-pop" onSubmit={submit('dismiss', { action_status: DISMISSED, dismiss_reason: reason.trim() })}>
            <label className="in">
              <span>Why are these not issues? *</span>
              <textarea dir="auto" name="bulk_dismiss_reason" autoFocus rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={why ? true : undefined} />
              {why && <PlainNote text={why} as="small" className="in-err" />}
            </label>
            {note500}
            <SaveButton write="bulk:dismiss" type="submit" className="btn btn--pri" disabled={!!why} why={why || ''}>Mark {what} not an issue</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'assign' && (
        <Popover anchor={anchors.assign.current} onClose={close} label="Assign the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit('assign', { action_owner: owner.trim() })}>
            <label className="in"><span>Owner</span><input dir="auto" name="bulk_owner" autoFocus value={owner} onChange={(e) => setOwner(e.target.value)} list="owners-bulk" maxLength={254} autoComplete="off" /></label>
            <datalist id="owners-bulk">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            {note500}
            <SaveButton write="bulk:assign" type="submit" className="btn btn--pri" disabled={!owner.trim()} why={missingWhy(['who owns them'])}>Assign {what}</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'status' && (
        <Popover anchor={anchors.status.current} onClose={close} label="Set the status of the selected records" width={300}>
          <form className="bulk-pop" onSubmit={(e) => (choice ? submit('status', choiceForm(choices, choice, reason))(e) : e.preventDefault())}>
            <label className="in"><span>Status</span><ChoiceSelect name="bulk_choice" choices={choices} value={choiceId} status={status} onChange={setChoiceId} /></label>
            {statusKind(status) === 'dismissed' && (
              <label className="in">
                <span>Why are these not issues? *</span>
                <textarea dir="auto" name="bulk_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
                {problem && <PlainNote text={problem} as="small" className="in-err" />}
              </label>
            )}
            {note500}
            <SaveButton write="bulk:status" type="submit" className="btn btn--pri" disabled={!!problem || !choice} why={problem || missingWhy(['a status'])}>Set status of {what}</SaveButton>
          </form>
        </Popover>
      )}
      {open === 'snooze' && (
        <Popover anchor={anchors.snooze.current} onClose={close} label="Snooze the selected records" width={300}>
          <form className="bulk-pop" onSubmit={submit('snooze', { snooze_until: until })}>
            <label className="in"><span>Snooze until</span><input type="date" name="bulk_snooze" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
            {note500}
            <SaveButton write="bulk:snooze" type="submit" className="btn btn--pri" disabled={!until || until < tomorrow} why={until ? 'Pick a date after today to snooze.' : missingWhy(['a date'])}>Snooze {what}</SaveButton>
          </form>
        </Popover>
      )}
    </div>
  );
}

const NO_PICKS = new Map();

export function QueueBulk({ pageId, list, asked, person = '', onChanged, choices = DEFAULT_CHOICES }) {
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
      toastFailure(toast, err, () => act(values, { key }), actError(err));
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
    <BulkBar choices={choices} picked={NO_PICKS} matching={{ total, capped: !!list.total_more, as_of_us: asOf }} total={total} capped={!!list.total_more} allOnPage owners={list.summary?.owners || []}
      person={person} tomorrow={nextDay(localDay())} onAct={act} onAll={() => {}} onClear={() => setOn(false)} />
  );
}

const SIMILAR_WRITE = 'similar';

function recordFields(meta, row, model, details = true) {
  const all = [...(meta.tier && row[meta.tier] ? [[meta.tier, 'Tier', plainText(row[meta.tier])]] : []),
    ...recordColumns(meta, model).map((c) => [c.key, c.label, c.render(row)]), ...(details ? recordDetails(meta, row, unitOf(model), kindOf(model)) : [])];
  const seen = new Set();
  return all.filter(([column, , text]) => text != null && text !== '' && !seen.has(column) && seen.add(column));
}

function SimilarRecord({ id, meta, item, pageId, model, summary }) {
  const log = useHistory(pageId, recordRef(meta, item.row || { record_key: item.record_key }));
  const current = log.data?.current || null;
  const row = current ? { ...current, ...item.row } : item.row || {};
  const view = recordView(meta, current, row, {}, unitOf(model), kindOf(model));
  const fields = [...(view.explanation ? [['_why', 'Why', view.explanation]] : []), ...(view.action ? [['_do', 'Next best action', view.action]] : []),
    ...recordFields(meta, row, model).filter(([column]) => !summary.includes(column))];
  return (
    <div id={id} className="sim-x" role="region" aria-label={`Details of ${recordLine(meta, row).name || plainText(item.label ?? item.record_key)}`} aria-busy={log.loading || undefined}>
      {fields.length > 0 && <FieldGrid fields={fields} />}
      {!fields.length && !log.loading && <small className="faint">This record holds nothing more than the line above.</small>}
      {log.error && <PlainNote text={log.error} prefix="The rest of the record could not load: " as="small" className="in-err" />}
    </div>
  );
}

function SimilarRow({ meta, item, pageId, model, kept, open, onKeep, onOpen }) {
  const id = useId();
  const row = item.row || { [meta.label]: item.label };
  const { name, sub } = recordLine(meta, row);
  const label = name || plainText(item.label ?? item.record_key);
  const summary = recordFields(meta, row, model, false).slice(0, SIMILAR_SUMMARY);
  return (
    <li className={kept ? '' : 'is-out'} data-record={String(item.record_key)}>
      <div className="sim-r">
        <input type="checkbox" checked={kept} onChange={(e) => onKeep(e.target.checked)} aria-label={`Include ${label}`} />
        <button type="button" className="sim-t" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onOpen}>
          <Icon name="right" size={13} className="sim-c" />
          <span className="sim-n"><b><bdi>{label}</bdi></b>{sub.length > 0 && <small>{sub.map((part, i) => <span key={i}>{i > 0 && ' · '}<bdi>{part}</bdi></span>)}</small>}</span>
        </button>
        {summary.length > 0 && <span className="sim-f">{summary.map(([column, title, text]) => <span key={column}><small>{title}</small> <bdi>{text}</bdi></span>)}</span>}
      </div>
      {open && <SimilarRecord id={id} meta={meta} item={item} pageId={pageId} model={model} summary={summary.map(([column]) => column)} />}
    </li>
  );
}

export function SimilarDialog({ similar, meta, pageId, model, onClose, onApply, choices = DEFAULT_CHOICES }) {
  const ref = useDialog(true, onClose);
  const list = useRef(null);
  const head = useId();
  const [choiceId, setChoiceId] = useState(() => firstChoice(choices, similar.values?.action_status || DONE, similar.values?.[CHOICE_COLUMN])?.id || '');
  const choice = (choices || []).find((c) => c.id === choiceId) || null;
  const status = choice?.status || DONE;
  const [reason, setReason] = useState(similar.values?.dismiss_reason || '');
  const [note, setNote] = useState(similar.values?.note || '');
  const [left, setLeft] = useState(() => new Set());
  const [opened, setOpened] = useState(() => new Set());
  const [shown, setShown] = useState(SIMILAR_PAGE);
  const grown = useRef(0);
  const n = countOf(similar.count);
  const records = similar.sample || [];
  const keys = records.map((r) => String(r.record_key));
  const kept = keys.filter((k) => !left.has(k));
  const problem = actionProblem({ status, reason });
  const said = byWords(similar.by);
  useEffect(() => {
    if (grown.current) list.current?.querySelectorAll('li')[grown.current]?.querySelector('input')?.focus();
  }, [shown]);
  const toggle = (set, key, on) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const more = () => {
    grown.current = shown;
    setShown(shown + SIMILAR_PAGE);
  };
  const apply = async (e) => {
    e.preventDefault();
    if (!kept.length) return;
    if (await onApply(kept, withNote(choiceForm(choices, choice, reason), note), SIMILAR_WRITE)) onClose();
  };
  return (
    <dialog ref={ref} className="dialog" aria-label="Apply to similar records" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <form className="dlg dlg--form dlg--sim" onSubmit={apply}>
        <header>
          <h2>Apply to {recordsText(n)} like {similar.about?.label || 'this one'}?</h2>
          <p>{n === 1 ? 'This open record shares' : `These ${integer(n)} open records share`} {said || 'the same values'}. Nothing changes until you apply.</p>
        </header>
        {records.length > 0 && (
          <div className="sim" role="group" aria-labelledby={head}>
            <div className="sim-h">
              <b id={head}>Records to change</b>
              <span role="status" className="sim-k" data-kept>{`${integer(kept.length)} of ${integer(records.length)} included`}</span>
              <span className="sp" />
              <button type="button" className="link" onClick={() => setLeft(new Set())} disabled={!left.size}>Select all</button>
              <button type="button" className="link" onClick={() => setLeft(new Set(keys))} disabled={!kept.length}>Select none</button>
            </div>
            {n > records.length && (
              <p className="sim-cap" data-capped>{`The App lists ${integer(records.length)} of the ${integer(n)}, the most one change covers. Apply changes only the listed ones you keep; open Apply to similar again for the rest.`}</p>
            )}
            <ul className="sim-l" ref={list}>
              {records.slice(0, shown).map((r) => {
                const key = String(r.record_key);
                return (
                  <SimilarRow key={key} meta={meta} item={r} pageId={pageId} model={model} kept={!left.has(key)} open={opened.has(key)}
                    onKeep={(on) => setLeft((s) => toggle(s, key, !on))} onOpen={() => setOpened((s) => toggle(s, key, !s.has(key)))} />
                );
              })}
            </ul>
            {shown < records.length && (
              <button type="button" className="link sim-more" onClick={more}>
                {`Show ${integer(Math.min(SIMILAR_PAGE, records.length - shown))} more (${integer(records.length - shown)} not shown yet)`}
              </button>
            )}
          </div>
        )}
        <label className="in"><span>Status</span><ChoiceSelect name="similar_choice" choices={choices} value={choiceId} status={status} onChange={setChoiceId} /></label>
        {statusKind(status) === 'dismissed' && (
          <label className="in"><span>Why are these not issues? *</span>
            <textarea dir="auto" name="similar_reason" rows={2} maxLength={REASON_CHARS} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={problem ? true : undefined} />
            {problem && <PlainNote text={problem} as="small" className="in-err" />}
          </label>
        )}
        <NoteField name="similar_note" value={note} onChange={setNote} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <SaveButton write={SIMILAR_WRITE} type="submit" className="btn btn--pri" disabled={!!problem || !choice || !kept.length || !similar.match}
            why={problem || missingWhy([!choice && 'a status', !similar.match && 'a similar record to match'])}>{`Apply to ${recordsText(kept.length)}`}</SaveButton>
        </footer>
      </form>
    </dialog>
  );
}

export function BatchesDialog({ pageId, onClose, onUndo, labelOf, choices = DEFAULT_CHOICES }) {
  const ref = useDialog(true, onClose);
  const [state, setState] = useState({ busy: true, error: '', list: [] });
  const [undone, setUndone] = useState({});
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    getBatches(pageId)
      .then((d) => { if (live) setState({ busy: false, error: '', list: d?.batches || [] }); })
      .catch((e) => { if (live) setState({ busy: false, error: e.message, list: [] }); });
    return () => { live = false; };
  }, [pageId, again]);
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
          {state.error && <PlainNote text={state.error} prefix="The changes could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={() => { setState({ busy: true, error: '', list: [] }); setAgain((n) => n + 1); }} />}
          {!state.busy && !state.error && !state.list.length && <p className="more">No change recorded on this list yet.</p>}
          {state.list.length > 0 && (
            <ul className="batches">
              {state.list.map((b) => (
                <li key={b.batch_id} data-batch={b.batch_id}>
                  <span>{batchText(b, choices)}</span>
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
