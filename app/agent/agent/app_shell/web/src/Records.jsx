import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import DataTable, { columnOf } from './DataTable.jsx';
import { GenieMark, Icon } from './icons.jsx';
import { ExplainButton } from './Genie.jsx';
import { askGenie, genieOn } from './genieAsk.js';
import { BUSY_TITLE } from './explain.js';
import { withRecord, withoutRecord } from './links.js';
import { addCounts, addedParts, cap, compareValues, dayLabel, formatValue, integer, kindOf, plainText, savedWords, shownUnit, unitOf } from './format.js';
import { hueVars } from './theme.js';
import { Failure, Popover, Skeleton, useDebounced, useDialog, useToast } from './ui.jsx';
import { failureOf, getRecords, toneOf } from './api.js';
import { HistoryList, useHistory } from './History.jsx';
import RecordForm, { DeleteDialog } from './RecordForm.jsx';
import Fx from './Fx.jsx';
import { moneyOf } from './money.js';
import { apiColumns } from './filters.js';
import { ColumnFilterStatus, withColumnFilters } from './ColumnFilters.jsx';
import { useCopyLink } from './PageLink.jsx';
import { WindowChips, useFocusList, useMyView } from './MyView.jsx';
import { EVERYTHING, listLimit, listWindow, localDay, markVisit, narrowWindow, nextDay, visitedAt, windowLabel } from './prefs.js';
import { BatchesDialog, BulkBar, CaughtUp, ConflictNote, HelpDialog, NoteField, SimilarDialog, isTyping, useActs } from './Work.jsx';
import {
  ACT_LIMIT, CLOSED_STATUSES, HELD, NOTE_CHARS, PAGE_SIZES, REASON_CHARS, STATUSES, UNEXPLAINED, actionForm, actionProblem, actionValues,
  aiValue, askQuestions, changeBadge, doneText, dueText, explainContext, heldBack, heldText, impactText, initials, isOverdue, keptText, leftText, matchOf,
  missingSince, NOT_IN_RUN, notInRunText, overdueFirst, pageText, recordCurrency, recordKeyOf, recordRef, recordView, recordsText, savingText, statusClass,
  statusLabel, actError, withoutWindow, NO_AS_OF, listAsOf,
  CODES, isStaleRecord, closedText, closedBatchOf, undoBatchOf, UNDO_CLOSE, isClosed, skippedText, READ_ONLY, READ_ONLY_KEPT, READ_ONLY_THEIRS,
  CLOSED_PICK,
} from './records.js';

const tierClass = (t) => `tier tier--${String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const CHANGE_TAGS = { edit: 'Edited', add: 'Added' };
const NONE = new Map();
const NO_ALIASES = {};
const KEPT = new Map();
const NO_PICKS = {};
const SOMEONE_ELSE = ' someone else';
const SAVED = 'Action saved. The earlier version stays in the history.';
const NO_FORMULA = 'How this amount is counted is not recorded for this record.';
const MONEY = 'value_at_stake';
const LATER = 'An assumption changed since the last update, so this record shows the amount the update wrote until it runs again.';

function moneyColumn(c, model) {
  const base = columnOf(c);
  return {
    ...base,
    render: (row) => {
      const kind = kindOf(model);
      const unit = shownUnit(unitOf(model), c.currency, kind);
      const shown = moneyOf(model, row, unit, kind);
      if (shown.amount == null) return base.render(row);
      return <Fx formula={shown.formula}>{formatValue(shown.amount, c.format || 'currency', unit, undefined, kind)}</Fx>;
    },
  };
}

function savingOf(view, row, model) {
  if (!view.saving || !model) return view.saving;
  if (row?._inspire_money == null) return model.changed ? { ...view.saving, note: LATER } : view.saving;
  const shown = moneyOf(model, row, unitOf(model), kindOf(model));
  return { text: savingText(shown.amount, unitOf(model), kindOf(model)), formula: shown.formula || view.saving.formula };
}

export function reasonsOf(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(/\s*[;|]\s*|\s*,\s+/).filter(Boolean);
}

function useList(body, ready, nonce, plain = null) {
  const [state, setState] = useState({ data: null, error: '', busy: true, at: 0, unwindowed: false });
  const seq = useRef(0);
  const key = JSON.stringify(body);
  const plainKey = plain ? JSON.stringify(plain) : '';
  useEffect(() => {
    if (!ready) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    getRecords(JSON.parse(key))
      .then((data) => ({ data, unwindowed: false }))
      .catch((e) => (plainKey && e.code === CODES.noWindow
        ? getRecords(JSON.parse(plainKey)).then((data) => { if (data?.actions) throw e; return { data, unwindowed: true }; })
        : Promise.reject(e)))
      .then(({ data, unwindowed }) => { if (mine === seq.current) setState({ data, error: '', busy: false, at: Date.now(), unwindowed }); })
      .catch((e) => { if (mine === seq.current) setState({ data: null, error: e.message, busy: false, at: 0, unwindowed: false }); });
  }, [key, plainKey, ready, nonce]);
  return state;
}

function Badge({ row }) {
  const badge = changeBadge(row);
  return badge ? <span className={`chg-b chg-b--${badge.kind}`}>{badge.text}</span> : null;
}

function OwnerList({ id, owners }) {
  return <datalist id={id}>{owners.map((o) => <option key={o} value={o} />)}</datalist>;
}

function useAction(data, person, acts, label) {
  const toast = useToast();
  const current = data?.current || null;
  const [form, setForm] = useState(() => actionForm(current, person));
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(actionForm(current, person)); setFailure(null); }, [current, person]);
  const send = async (values, said) => {
    if (!current) return null;
    setSaving(true);
    setFailure(null);
    try {
      return await acts.act({ record_keys: [data.record_key], seen: { [data.record_key]: current.valid_from_us } }, values,
        { said, about: { record_key: data.record_key, label } });
    } catch (err) {
      setFailure({ ...failureOf(err), stale: isStaleRecord(err) });
      return null;
    } finally {
      setSaving(false);
    }
  };
  const save = async (next, said) => {
    if (!current || actionProblem(next)) return null;
    const values = actionValues(current, next);
    if (!Object.keys(values).length) {
      toast('Nothing changed');
      return null;
    }
    return send(values, said);
  };
  return { form, setForm, failure, saving, save, send };
}

function AddNote({ action }) {
  const [note, setNote] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (await action.send({ note: note.trim() }, 'Note added. The status stays as it was.')) setNote('');
  };
  return (
    <section className="sec" aria-label="Add a note">
      <h3><Icon name="edit" size={13} />Add a note</h3>
      <form className="note-f" onSubmit={submit}>
        <NoteField name="record_note" value={note} onChange={setNote} label="Note for the history" />
        <button type="submit" className="btn" disabled={action.saving || !note.trim()}>Add note</button>
      </form>
    </section>
  );
}

function WorkBar({ work, action, tomorrow, canAct }) {
  const [until, setUntil] = useState(tomorrow);
  const run = async (kind, values) => {
    if (values && !(await action.send(values))) return;
    work.next(kind);
  };
  return (
    <div className="work-f" role="group" aria-label="Work through the list">
      <span className="work-k" data-work-k>{work.text}</span>
      <button className="btn btn--pri" onClick={() => run('done', { action_status: 'Done' })} disabled={action.saving || !canAct} data-key="d"><Icon name="check" size={15} />Done and next</button>
      <label className="work-snz"><span className="sr">Snooze until</span><input type="date" name="work_snooze" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <button className="btn" onClick={() => run('snoozed', { snooze_until: until })} disabled={action.saving || !canAct || !until || until < tomorrow} data-key="s">Snooze and next</button>
      <button className="btn" onClick={() => run('skipped', null)} disabled={action.saving} data-key="skip">Skip</button>
    </div>
  );
}

function SnoozeButton({ action, tomorrow }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(tomorrow);
  const close = useCallback(() => setOpen(false), []);
  const submit = async (e) => {
    e.preventDefault();
    close();
    await action.send({ snooze_until: until });
  };
  return (
    <>
      <button ref={anchor} className="btn" onClick={() => setOpen(!open)} aria-expanded={open} disabled={action.saving}>Snooze…</button>
      {open && (
        <Popover anchor={anchor.current} onClose={close} label="Snooze this record" width={260}>
          <form className="bulk-pop" onSubmit={submit}>
            <label className="in"><span>Snooze until</span><input type="date" name="record_snooze" autoFocus min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
            <button type="submit" className="btn btn--pri" disabled={!until || until < tomorrow}>Snooze until {until ? dayLabel(until) : 'the date'}</button>
          </form>
        </Popover>
      )}
    </>
  );
}

function ActionPanel({ action, owners, pageId, reason, owner, closing, unit, kind }) {
  const { form, setForm, saving } = action;
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const problem = actionProblem(form, unit, kind);
  const submit = (e) => {
    e.preventDefault();
    action.save(form, SAVED);
  };
  return (
    <section className="sec dr-act" aria-label="Action">
      <h3><Icon name="users" size={13} />Action</h3>
      <form className="act-form" onSubmit={submit} noValidate>
        <label className="in"><span>Owner</span><input ref={owner} name="action_owner" value={form.owner} onChange={set('owner')} list={`owners-${pageId}`} maxLength={254} autoComplete="off" /></label>
        <OwnerList id={`owners-${pageId}`} owners={owners} />
        <label className="in"><span>Status</span><select name="action_status" value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
        <label className="in"><span>Due</span><input type="date" name="action_due" value={form.due} onChange={set('due')} /></label>
        <label className="in in--wide"><span>Note</span><textarea name="action_note" rows={2} value={form.note} onChange={set('note')} /></label>
        {closing && form.status === 'Done' && (
          <>
            <label className="in"><span>{cap(savedWords(unit, kind))}<small> · optional</small></span>
              <input type="number" min="0" step="any" inputMode="decimal" name="realized_value" value={form.saved} onChange={set('saved')} aria-invalid={problem ? true : undefined} />
            </label>
            <label className="in in--wide"><span>How you know<small> · optional · {String(form.how || '').trim().length}/{NOTE_CHARS}</small></span>
              <textarea name="realized_note" rows={2} maxLength={NOTE_CHARS} value={form.how} onChange={set('how')} />
            </label>
            {problem && <small className="in-err in--wide">{problem}</small>}
          </>
        )}
        {form.status === 'Dismissed' && (
          <label className="in in--wide">
            <span>Why is it not a real issue? *<small> · {form.reason.trim().length}/{REASON_CHARS}</small></span>
            <textarea ref={reason} name="dismiss_reason" rows={2} maxLength={REASON_CHARS} value={form.reason} onChange={set('reason')} aria-invalid={problem ? true : undefined} required />
            {problem && <small className="in-err">{problem}</small>}
          </label>
        )}
        <div className="act-btns in--wide">
          <span className="sp" />
          <button type="submit" className="btn btn--pri" disabled={saving || !!problem}><Icon name="check" size={14} />{saving ? 'Saving…' : 'Save action'}</button>
        </div>
      </form>
    </section>
  );
}

function Why({ view, row, meta, explain, title, genieBusy }) {
  const reasons = meta.reasons ? reasonsOf(row[meta.reasons]).slice(0, 8) : [];
  const button = explain && <ExplainButton title={title} busy={genieBusy} onClick={explain} />;
  return (
    <section className="sec" aria-label="Why it is flagged">
      <h3><GenieMark size={13} />Why it is flagged</h3>
      {view.explanation ? <p>{view.explanation}</p> : <div className="unexplained"><p>{view.held ? `${HELD}: ${view.held}.` : UNEXPLAINED}</p>{button}</div>}
      {view.evidence.length > 0 && <ul className="ev">{view.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {reasons.length > 0 && <div className="reasons">{reasons.map((t) => <span key={t} className="chip chip--static">{t}</span>)}</div>}
      {view.explanation && button && <div className="why-x">{button}</div>}
    </section>
  );
}

function AskAbout({ meta, onAsk, busy }) {
  return (
    <section className="sec" aria-label="Ask Genie about this">
      <h3><GenieMark size={13} />Ask Genie about this</h3>
      <div className="g-sugg">{askQuestions(meta).map((q) => (
        <button key={q} type="button" className="sugg" onClick={() => onAsk(q)} disabled={busy} title={busy ? BUSY_TITLE : undefined}>{q}</button>
      ))}</div>
      <button type="button" className="btn ask-btn" onClick={() => onAsk('')}><GenieMark size={14} />Ask your own question</button>
    </section>
  );
}

function Drawer({ meta, row: given, onClose, history, canModify, tracker, owners, app, pageId, nonce, aliases, onEdit, onDelete, acts, onExplain, genieBusy, model,
  work, tomorrow, today, focusOwner, closedReadOnly }) {
  const ref = useDialog(!!given, onClose);
  const log = useHistory(pageId, history && given ? recordRef(meta, given) : null, nonce);
  const person = app.user?.email || '';
  const current = log.data?.current || null;
  const row = given && current && given[meta.label] == null ? { ...current, ...given } : given;
  const deleted = !!log.data?.deleted;
  const title = (row && plainText(row[meta.label])) || 'This record';
  const action = useAction(log.data, person, acts, title);
  const reason = useRef(null);
  const ownerInput = useRef(null);
  const link = useCopyLink('Link to this record', 'Link to this record copied');
  const linkKey = String(log.data?.record_key ?? recordKeyOf(row) ?? '');
  const copyLink = () => link.copy(`${window.location.origin}${window.location.pathname}${withRecord(window.location.hash, linkKey)}`);
  const snoozed = String(current?.snooze_until || '').slice(0, 10);
  const held = tracker && heldBack(current);
  const acting = tracker && !!current && !deleted && !held;
  const closed = acting && CLOSED_STATUSES.includes(current.action_status);
  const closedBy = closed ? closedText({ ...given, _inspire_status: current.action_status }) : '';
  const undoBatch = closed ? undoBatchOf({ ...given, _inspire_status: current.action_status }, person) : '';
  const theirs = closed && !undoBatch && !!closedBatchOf({ ...given, _inspire_status: current.action_status });
  const readOnly = closed && !!closedReadOnly;
  const [undoAsk, setUndoAsk] = useState(false);
  useEffect(() => { setUndoAsk(false); }, [linkKey, undoBatch]);
  const closing = (log.data?.fields || []).some((f) => f.name === 'realized_value');
  const unit = unitOf(model);
  const kind = kindOf(model);
  const view = row ? recordView(meta, current, row, aliases, unit, kind) : null;
  const saving = view ? savingOf(view, row, model) : null;
  const useCase = (app.pages || []).find((p) => p.id === pageId);
  const owner = (current ? current.action_owner : row?._inspire_owner) || '';
  const due = tracker && current ? dueText(current.action_due, current.action_status) : null;
  const segment = row && meta.sublabel ? addedParts(row[meta.label], [row[meta.sublabel]])[0] : '';
  const explain = genieOn(app, pageId) && onExplain ? () => onExplain('record', title, explainContext(meta, log.data, row, unit, kind)) : null;
  const ask = (question) => {
    const recordKey = String(log.data?.record_key ?? recordKeyOf(row) ?? row?.[meta.key] ?? '');
    onClose();
    askGenie({ pageId, recordKey, label: title, question });
  };
  const dismiss = () => {
    flushSync(() => action.setForm((f) => ({ ...f, status: 'Dismissed' })));
    reason.current?.focus();
  };
  const giveTo = (e) => {
    const who = e.target.value;
    if (who === SOMEONE_ELSE) {
      ownerInput.current?.focus();
      ownerInput.current?.select();
    } else if (who) {
      action.save({ ...action.form, owner: who }, `Given to ${who}. The earlier version stays in the history.`);
    }
  };
  useEffect(() => {
    if (focusOwner && acting) ownerInput.current?.focus();
  }, [focusOwner, acting]);
  const details = [...(meta.detail || []).map((d) => [d.column, d.label, d.column === MONEY
      ? formatValue(row?.[d.column], d.format || 'currency', shownUnit(unit, d.currency, kind), undefined, kind)
      : formatValue(row?.[d.column], d.format || 'text', d.currency)]),
    ...(meta.rank && row?.[meta.rank] != null ? [[meta.rank, 'Rank', `${integer(row[meta.rank])} on the latest run`]] : [])];
  return (
    <dialog ref={ref} className="drawer panel" aria-label={row ? title : 'Record'} data-closed={closed ? '' : undefined}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {row && (
        <div className="dr">
          <header className="panel-h">
            <div>
              <h2>{title}</h2>
              <div className="panel-meta">
                {useCase?.title && <span className="ucn" style={hueVars(useCase.hue || 'blue')}><i />{useCase.title}</span>}
                {segment && <span>{segment}</span>}
                {meta.tier && row[meta.tier] && <span className={tierClass(row[meta.tier])}>{row[meta.tier]}</span>}
                <Badge row={row} />
                {deleted && <span className="tag tag--del">Deleted</span>}
                {tracker && (owner ? <span className="owner"><i>{initials(owner)}</i>{owner}</span> : <span className="owner is-none">Nobody yet</span>)}
                {due && <span className={due.late ? 'late' : ''}>{due.text}</span>}
                {snoozed && snoozed >= today && <span className="snz">Snoozed until {dayLabel(snoozed)}</span>}
              </div>
            </div>
            {linkKey && <button className="ibtn ibtn--sm" onClick={copyLink} aria-label="Copy a link to this record" title="Copy a link to this record"><Icon name="link" size={15} /></button>}
            <button className="ibtn ibtn--sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
            {link.dialog}
          </header>
          <div className="panel-b">
            {held && <div className="held" role="status"><Icon name="info" size={14} />{heldText(app.held_meaning)}</div>}
            {!deleted && missingSince(row) && <div className="kept" role="status"><Icon name="info" size={14} />{notInRunText(missingSince(row))}</div>}
            {closed && (
              <div className="done" role="status">{doneText(current, shownUnit(unit, recordCurrency(meta, current, row), kind), kind)}{closedBy && <small className="done-by" data-closed-by>{closedBy}</small>}
                {readOnly && <small className="done-by" data-read-only>{undoBatch ? READ_ONLY : theirs ? READ_ONLY_THEIRS : READ_ONLY_KEPT}</small>}</div>
            )}
            {saving && (
              <section className="sec" aria-label="Could save">
                <h3>Could save</h3>
                <div className="save">{saving.text}</div>
                <div className="fx">{saving.formula || NO_FORMULA}</div>
                {saving.note && <div className="fx">{saving.note}</div>}
              </section>
            )}
            <Why view={view} row={row} meta={meta} explain={explain} title={title} genieBusy={genieBusy} />
            {view.confidence && (
              <section className="sec" aria-label="How sure the AI is">
                <h3><GenieMark size={13} />How sure the AI is</h3>
                <div className="conf-l"><span className={`conf conf--${view.confidence.level}`}>{view.confidence.level}</span>{view.confidence.reason && <span>{view.confidence.reason}</span>}</div>
              </section>
            )}
            {view.action && (
              <section className="sec nba" aria-label="Next best action">
                <h3><Icon name="right" size={13} />Next best action</h3>
                <div className="do">{view.action}</div>
                {(view.expected || view.other) && (
                  <dl>
                    {view.expected && <><dt>What should happen</dt><dd>{view.expected}</dd></>}
                    {view.other && <><dt>Other option</dt><dd>{view.other}</dd></>}
                  </dl>
                )}
              </section>
            )}
            {acting && !readOnly && <ActionPanel action={action} owners={owners} pageId={pageId} reason={reason} owner={ownerInput} closing={closing} unit={unit} kind={kind} />}
            {acting && !readOnly && <AddNote action={action} />}
            {genieOn(app, pageId) && <AskAbout meta={meta} onAsk={ask} busy={genieBusy} />}
            {details.length > 0 && (
              <section className="sec" aria-label="Details">
                <h3>Details</h3>
                <div className="mgrid">{details.map(([column, label, text]) => <div key={column}><span>{label}</span><b>{text}</b></div>)}</div>
              </section>
            )}
            {history && (
              <section className="sec dr-hist" aria-label="History">
                <h3><Icon name="history" size={13} />History</h3>
                {log.loading && !log.data && <div style={{ display: 'grid', gap: 8 }}><Skeleton height={18} /><Skeleton height={18} width="70%" /></div>}
                {log.error && <p className="tile-err tile-err--flat"><Icon name="info" size={14} />The history could not load: {log.error}</p>}
                {log.data && <HistoryList data={log.data} meta={meta} unit={unit} kind={kind} />}
                {log.data?.truncated && <p className="more">Showing the latest {integer(log.data.versions.length)} versions.</p>}
              </section>
            )}
          </div>
          <footer className="panel-f dr-f" data-toast-host>
            <Failure failure={action.failure} as="div" className="hint hint--box">
              <Icon name="info" size={14} /><span>{action.failure?.text}</span>
              {action.failure?.stale && <button type="button" className="link" onClick={() => log.reload().catch(() => {})}><Icon name="undo" size={13} />Reload the record</button>}
            </Failure>
            {work && <WorkBar key={linkKey} work={work} action={action} tomorrow={tomorrow} canAct={acting} />}
            {acting && !work && !closed && (
              <>
                <button className="btn btn--pri" onClick={() => action.save({ ...action.form, status: 'Done' }, 'Marked as fixed. The next run checks whether it worked.')}
                  disabled={action.saving} data-key="d"><Icon name="check" size={15} />Fixed</button>
                <button className="btn" onClick={dismiss} disabled={action.saving}>Not a real issue</button>
                <button className="btn" onClick={() => action.save({ ...action.form, status: 'Could not fix' }, 'Marked as could not fix. The next run still checks it.')}
                  disabled={action.saving}>Could not fix</button>
                <select className="btn" aria-label="Give to someone" value="" onChange={giveTo} disabled={action.saving}>
                  <option value="">{owner ? `With ${owner}` : 'Give to someone'}</option>
                  {person && person !== owner && <option value={person}>Give to me</option>}
                  {owners.filter((o) => o !== owner && o !== person).map((o) => <option key={o} value={o}>Give to {o}</option>)}
                  <option value={SOMEONE_ELSE}>Someone else…</option>
                </select>
                <SnoozeButton action={action} tomorrow={tomorrow} />
              </>
            )}
            {undoBatch && !work && !undoAsk && (
              <button type="button" className="btn" onClick={() => setUndoAsk(true)} data-undo-close><Icon name="undo" size={14} />Undo this change</button>
            )}
            {undoBatch && undoAsk && (
              <div className="note note--flat undo-ask" role="group" aria-label="Undo this change">
                <span>{UNDO_CLOSE}</span>
                <button type="button" className="btn btn--pri" onClick={() => { setUndoAsk(false); acts.undo(undoBatch); }}>Undo it</button>
                <button type="button" className="btn" onClick={() => setUndoAsk(false)}>Keep it</button>
              </div>
            )}
            <span className="sp" />
            {canModify && !deleted && !readOnly && (
              <>
                <button className="btn" onClick={() => onDelete(row)}><Icon name="trash" size={14} />Delete</button>
                <button className={`btn ${acting && !closed ? '' : 'btn--pri'}`} onClick={() => onEdit(row)}><Icon name="edit" size={14} />Edit</button>
              </>
            )}
            {!(canModify && !deleted && !readOnly) && !(acting && !closed) && <button className="btn" onClick={onClose}>Close</button>}
          </footer>
        </div>
      )}
    </dialog>
  );
}

function emptyState({ search, mine, changed, fresh, windowed, narrowedAny, ranged, onClear, onWide }) {
  const text = search ? 'No record matches this search.' : mine ? 'You own no record on this list.' : changed ? 'No record changed since the last run.'
    : fresh ? 'Nothing on this page changed since your last visit.' : windowed && !narrowedAny ? `All caught up: nothing is due or new for ${windowed.toLowerCase()}.`
      : narrowedAny || ranged ? 'No record matches these filters.' : 'No records yet. The next run of this use case fills this list.';
  const action = windowed && !narrowedAny && !search && !mine && !changed && !fresh ? <button type="button" className="lnk" onClick={onWide}>Show all open</button>
    : search || mine || changed || fresh || narrowedAny ? <button type="button" className="lnk" onClick={onClear}>Clear filters</button> : null;
  return <><span className="empty-t">{text}</span>{action && ' '}{action}</>;
}

export default function Records({ meta, app, pageId, filters, ai, onFilter, history = false, onChanged, nonce = 0, ready = true, onExplain, genieBusy, openKey,
  columnMeta, columnValues, onColumn, onClearColumns, onClearFilters, seeChanged = 0, onShowRuns, similarBy, keepsActions }) {
  const { prefs, update } = useMyView();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 300);
  const [sort, setSort] = useState(null);
  const size = prefs.rows;
  const setSize = (rows) => update((p) => ({ ...p, rows }));
  const [mine, setMine] = useState(false);
  const [changed, setChanged] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [visit] = useState(() => ({ last: visitedAt(prefs, pageId), since: Date.now() }));
  useEffect(() => { update((p) => markVisit(p, pageId, visit.since)); }, [pageId]);
  const today = localDay();
  const tomorrow = nextDay(today);
  const [kept, setKept] = useState(() => KEPT.get(pageId));
  const noActions = !history || !app.options.decisions || keepsActions === false || kept === false;
  const cap = noActions ? 0 : listLimit(prefs);
  const windowed = noActions ? {} : listWindow(prefs);
  const aiPicks = ai || NO_PICKS;
  const narrowed = apiColumns(columnValues);
  const scope = JSON.stringify({ filters, ai: aiPicks, search, mine, changed, columns: narrowed, ...windowed });
  const pageScope = JSON.stringify([scope, sort, size, cap]);
  const [paging, setPaging] = useState({ scope: pageScope, offset: 0, cursor: null });
  const offset = paging.scope === pageScope ? paging.offset : 0;
  const cursor = paging.scope === pageScope && offset > 0 ? paging.cursor : null;
  const [picks, setPicks] = useState({ scope, keys: NONE, all: null });
  const picked = picks.scope === scope ? picks.keys : NONE;
  const matching = picks.scope === scope ? picks.all : null;
  const inWindow = windowed.window ? { window: windowed.window, ...(windowed.time_zone ? { time_zone: windowed.time_zone } : {}) } : {};
  const listed = { page: pageId, filters, ai: aiPicks, search, mine, changed, ...(Object.keys(narrowed).length ? { column_filters: narrowed } : {}), ...inWindow };
  const room = cap ? Math.max(1, Math.min(size, cap - offset)) : size;
  const asked = { ...listed, ...(cap ? { window_limit: cap } : {}), ...(sort ? { sort } : {}), offset, limit: room, ...(cursor ? { cursor } : {}) };
  const list = useList(asked, ready, `${nonce}:${refresh}`, windowed.window ? { ...withoutWindow(asked), limit: size } : null);
  useEffect(() => {
    if (list.unwindowed) {
      KEPT.set(pageId, false);
      setKept(false);
    } else if (typeof list.data?.actions === 'boolean') KEPT.set(pageId, list.data.actions);
  }, [list.unwindowed, list.data, pageId]);
  const [open, setOpen] = useState(() => (openKey ? { record_key: String(openKey) } : null));
  const [form, setForm] = useState(null);
  const [doomed, setDoomed] = useState(null);
  const [drawerNonce, setDrawerNonce] = useState(0);
  const [acting, setActing] = useState(false);
  const [cursorKey, setCursorKey] = useState('');
  const [ownerFocus, setOwnerFocus] = useState(false);
  const [dialog, setDialog] = useState('');
  const [work, setWork] = useState(null);
  const toast = useToast();
  const focus = useFocusList();
  const card = useRef(null);
  const searchBox = useRef(null);
  const data = list.data;
  const rows = data?.rows || [];
  const aliases = data?.ai?.columns || NO_ALIASES;
  const tracker = !!(history && app.options.decisions && data?.actions);
  const everything = prefs.window === EVERYTHING;
  const owners = data?.summary?.owners || [];
  const person = app.user?.email || '';
  const canModify = !!(history && app.options.modify);
  const keyOf = useCallback((r) => String(recordKeyOf(r) ?? r?.[meta.key] ?? ''), [meta.key]);
  const labelOf = (c) => {
    const row = rows.find((r) => keyOf(r) === String(c.record_key));
    return row ? plainText(row[meta.label]) : plainText(c.label ?? c.record_key ?? '');
  };
  const isNew = (r) => {
    const at = Number(r?._inspire_version) / 1000;
    return visit.last > 0 && at > visit.last && at < visit.since;
  };
  const close = useCallback(() => {
    setOpen(null);
    setOwnerFocus(false);
    const next = withoutRecord(window.location.hash);
    if (next !== window.location.hash) window.history.replaceState(window.history.state, '', next);
  }, []);
  const found = open ? rows.find((r) => keyOf(r) === keyOf(open)) : null;
  const shown = found && recordKeyOf(found) == null && recordKeyOf(open) != null ? { ...found, record_key: recordKeyOf(open) } : found || open;
  const edit = (r) => setForm({ mode: 'edit', target: recordRef(meta, r) });
  const saved = (out) => {
    if (out?.record_key) setOpen((o) => (o ? { ...o, record_key: out.record_key } : o));
    setForm(null);
    setDoomed(null);
    setDrawerNonce((n) => n + 1);
    onChanged?.();
  };
  const acted = useCallback(() => {
    setDrawerNonce((n) => n + 1);
    setRefresh((n) => n + 1);
    onChanged?.();
  }, [onChanged]);
  const acts = useActs({ pageId, similarBy, onActed: acted, labelOf });
  const total = data?.total || 0;
  const shownTotal = cap && compareValues(total, cap) > 0 ? cap : total;
  const freshCount = rows.filter(isNew).length;
  const late = overdueFirst(fresh ? rows.filter(isNew) : rows, today);
  const tableRows = late.rows;
  const actable = rows.filter((r) => tracker && recordKeyOf(r) != null && r._inspire_version);
  const pickable = actable.filter((r) => !isClosed(r));
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(String(recordKeyOf(r))));
  const pickRows = (on, targets) => {
    const next = new Map(picked);
    const skipped = on ? targets.filter(isClosed).length : 0;
    let full = false;
    for (const r of targets) {
      const key = String(recordKeyOf(r));
      if (!on) next.delete(key);
      else if (isClosed(r)) continue;
      else if (!next.has(key) && next.size >= ACT_LIMIT) {
        full = true;
        toast(`You can act on ${ACT_LIMIT} records at a time`, 'error');
        break;
      } else next.set(key, String(r._inspire_version));
    }
    setPicks({ scope, keys: next, all: null });
    if (skipped && !full) toast(skippedText(skipped));
  };
  const clearPicks = () => setPicks({ scope, keys: NONE, all: null });
  const selectAll = () => {
    const asOf = listAsOf(data);
    if (!asOf) {
      toast(NO_AS_OF, 'error', { actions: [{ label: 'Reload the list', run: () => setRefresh((n) => n + 1) }] });
      return;
    }
    setPicks({ scope, keys: picked, all: { total: shownTotal, as_of_us: asOf } });
  };
  const actOn = async (values) => {
    setActing(true);
    try {
      await acts.act(matching ? { match: matchOf(asked, matching.as_of_us) } : { record_keys: [...picked.keys()], seen: Object.fromEntries(picked) }, values);
    } catch (err) {
      toast(actError(err), toneOf(err));
      acted();
    } finally {
      setActing(false);
      clearPicks();
    }
  };
  const quick = async (row, values) => {
    const key = recordKeyOf(row);
    if (isClosed(row)) {
      toast(skippedText(1));
      return;
    }
    if (key == null || !row._inspire_version) return;
    try {
      await acts.act({ record_keys: [String(key)], seen: { [String(key)]: String(row._inspire_version) } }, values,
        { about: { record_key: String(key), label: plainText(row[meta.label]) || String(key) } });
    } catch (err) {
      toast(err.message, toneOf(err));
    }
  };
  const clearAll = () => {
    setQuery('');
    setMine(false);
    setChanged(false);
    setFresh(false);
    onClearFilters?.();
  };
  const goTo = (at, from) => setPaging({ scope: pageScope, offset: at, cursor: at > 0 ? from || null : null });
  const more = offset + rows.length < shownTotal;
  const startWork = () => {
    const first = tableRows[0];
    if (!first) return;
    setWork({ seen: new Set(), n: shownTotal, done: 0, snoozed: 0, skipped: 0, pending: null, ended: false });
    setOpen(first);
  };
  const workNext = (kind) => {
    if (!work) return;
    const seen = new Set(work.seen).add(keyOf(shown));
    const next = { ...work, seen, [kind]: work[kind] + 1 };
    const after = tableRows.find((r) => !seen.has(keyOf(r)));
    if (after) {
      setWork(next);
      setOpen(after);
    } else if (more) {
      setWork({ ...next, pending: offset + size });
      goTo(offset + size, data?.cursors?.next);
    } else {
      setWork({ ...next, ended: true });
      close();
    }
  };
  useEffect(() => {
    if (work?.pending == null || list.busy || !data || data.offset !== work.pending) return;
    const after = tableRows.find((r) => !work.seen.has(keyOf(r)));
    setWork({ ...work, pending: null, ended: !after });
    if (after) setOpen(after);
    else close();
  }, [work, list.busy, data]);
  const stopWork = () => {
    const sum = work.done + work.snoozed + work.skipped;
    setWork(null);
    close();
    if (sum) toast(`Stopped. ${integer(work.done)} marked as fixed, ${integer(work.snoozed)} snoozed, ${integer(work.skipped)} skipped.`);
  };
  const handled = useRef(0);
  useEffect(() => {
    if (!seeChanged || seeChanged === handled.current || !data) return;
    handled.current = seeChanged;
    if (data.changes) {
      setChanged(true);
      card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else onShowRuns?.();
  }, [seeChanged, data]);
  const keys = useRef(null);
  keys.current = { rows: tableRows, cursorKey, open: shown, work, tracker, keyOf, quick, tomorrow, pickRows, picked, acts, skip: () => toast(skippedText(1)) };
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      if (!k || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if ([...document.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('drawer')) || document.querySelector('.pop')) return;
      if (e.target instanceof Element && e.target.closest('[role="tablist"],[role="menu"],[role="listbox"]')) return;
      const drawer = document.querySelector('dialog.drawer[open]');
      const press = (which) => {
        const button = drawer?.querySelector(`[data-key="${which}"]`);
        if (button && !button.disabled) button.click();
        return !!button;
      };
      if (e.key === '?') { e.preventDefault(); setDialog('help'); return; }
      if (e.key === 'u') { e.preventDefault(); k.acts.undoLast(); return; }
      if (e.key === '/' && !drawer) { e.preventDefault(); searchBox.current?.focus(); return; }
      if (e.key === 'Escape' && !drawer) { setCursorKey(''); return; }
      const at = k.rows.findIndex((r) => k.keyOf(r) === (drawer && k.open ? k.keyOf(k.open) : k.cursorKey));
      const step = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[e.key];
      if (step) {
        if (e.key.startsWith('Arrow') && at < 0 && !drawer) return;
        e.preventDefault();
        if (drawer && k.work) {
          if (step > 0) press('skip');
          return;
        }
        if (!k.rows.length) return;
        const next = k.rows[Math.max(0, Math.min(k.rows.length - 1, at < 0 ? 0 : at + step))];
        setCursorKey(k.keyOf(next));
        if (drawer) setOpen(next);
        return;
      }
      const row = drawer ? k.open : k.rows[at];
      if (!row) return;
      if (e.key === 'Enter' && !drawer) {
        if (e.target instanceof Element && e.target.closest('button,a,input,select,textarea')) return;
        e.preventDefault();
        setOpen(row);
        return;
      }
      if (!k.tracker) return;
      const closedNow = drawer ? drawer.hasAttribute('data-closed') : isClosed(row);
      if (closedNow && ['d', 's', 'a'].includes(e.key)) {
        e.preventDefault();
        k.skip();
        return;
      }
      if (e.key === 'd') {
        e.preventDefault();
        if (!drawer || !press('d')) k.quick(row, { action_status: 'Done' });
      } else if (e.key === 's') {
        e.preventDefault();
        if (!drawer || !press('s')) k.quick(row, { snooze_until: k.tomorrow });
      } else if (e.key === 'a') {
        e.preventDefault();
        setOwnerFocus(true);
        setOpen(row);
      } else if (e.key === 'x' && row._inspire_version) {
        e.preventDefault();
        k.pickRows(!k.picked.has(String(recordKeyOf(row))), [row]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!cursorKey) return;
    card.current?.querySelector('tr.is-cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursorKey]);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const hosted = meta.sublabel && meta.sublabel !== meta.label ? { [meta.label]: [meta.sublabel] } : {};
  const columns = withColumnFilters([
    ...(tracker ? [{
      key: '_pick', sortable: false, className: 'pick-c',
      label: <input type="checkbox" checked={allPicked || !!matching} onChange={() => pickRows(!allPicked, allPicked ? pickable : actable)} aria-label="Select every record on this page" disabled={!pickable.length} />,
      render: (r) => (
        <label className="pick-l" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={(!!matching && !isClosed(r)) || picked.has(String(recordKeyOf(r)))} disabled={!r._inspire_version || !!matching || isClosed(r)}
            onChange={() => pickRows(!picked.has(String(recordKeyOf(r))), [r])} aria-label={`Select ${plainText(r[meta.label])}`} title={isClosed(r) ? CLOSED_PICK : undefined} />
        </label>
      ),
    }] : []),
    { key: meta.rank, label: 'Rank', num: true, render: (r) => (r[meta.rank] == null ? '' : integer(r[meta.rank])) },
    {
      key: meta.label, label: meta.label_title || 'Item', className: 'wrap',
      render: (r) => {
        const why = aiValue('ai_explanation', null, r, aliases);
        const [segment, key] = addedParts(r[meta.label], [meta.sublabel ? r[meta.sublabel] : '', r[meta.key]]);
        const sub = [key, segment].filter(Boolean).join(' · ');
        return (
          <>
            <button className="cell-t" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>
              <b>{plainText(r[meta.label])}</b>{sub && <small>{sub}</small>}
            </button>
            {why && <span className="cell-ai">{why}</span>}
            {CHANGE_TAGS[r.change_source] && <span className="tag">{CHANGE_TAGS[r.change_source]}</span>}
            <Badge row={r} />
            {isOverdue(r._inspire_due, r._inspire_status, today) && <span className="chg-b chg-b--late">Overdue</span>}
            {isNew(r) && <span className="chg-b chg-b--you">New for you</span>}
          </>
        );
      },
    },
    ...(meta.tier ? [{ key: meta.tier, label: 'Tier', render: (r) => (r[meta.tier] ? <span className={tierClass(r[meta.tier])}>{r[meta.tier]}</span> : '') }] : []),
    ...meta.columns.filter((c) => c.column !== meta.sublabel).map((c) => (c.column === MONEY ? moneyColumn(c, data?.money)
      : columnOf({ ...c, filter: meta.filters?.[c.column] }, onFilter))),
    ...(tracker ? [
      { key: 'action_owner', label: 'Owner', className: 'nowrap', render: (r) => r._inspire_owner || <span className="unset">Unassigned</span> },
      {
        key: 'action_status', label: 'Status', className: 'wrap',
        render: (r) => {
          const by = closedText(r);
          return r._inspire_status ? <><span className={statusClass(r._inspire_status)}>{statusLabel(r._inspire_status)}</span>{by && <small className="closed-by" data-closed-by>{by}</small>}</> : '';
        },
      },
    ] : []),
    ...(canModify ? [{
      key: '_actions', label: 'Actions', hideLabel: true, sortable: false, className: 'act',
      render: (r) => {
        const name = plainText(r[meta.label]);
        return (
          <span className="row-acts">
            {!(everything && isClosed(r)) && <button className="ibtn ibtn--sm" onClick={stop(() => edit(r))} aria-label={`Edit ${name}`} title="Edit"><Icon name="edit" size={15} /></button>}
            {!(everything && isClosed(r)) && <button className="ibtn ibtn--sm" onClick={stop(() => setDoomed(r))} aria-label={`Delete ${name}`} title="Delete"><Icon name="trash" size={15} /></button>}
            <button className="ibtn ibtn--sm" onClick={stop(() => setOpen(r))} aria-label={`History of ${name}`} title="History"><Icon name="history" size={15} /></button>
          </span>
        );
      },
    }] : []),
  ], columnMeta, columnValues, onColumn, pageId, null, hosted);
  const left = [leftText(data?.summary?.left), keptText(data?.summary?.kept)].filter(Boolean).join(' · ');
  const impact = tracker ? impactText(data?.summary) : '';
  const narrowedAny = Object.keys(narrowed).length > 0 || Object.values(filters || {}).some((v) => Array.isArray(v) && v.length)
    || Object.values(aiPicks).some((v) => v?.length);
  const workText = work && !work.ended ? `${integer(work.seen.size + 1)} of ${integer(compareValues(work.n, work.seen.size + 1) > 0 ? work.n : work.seen.size + 1)} ${narrowWindow(prefs) ? 'in your window' : 'on this list'}` : '';
  const beyond = data?.window?.more ?? (compareValues(total, cap) > 0 ? addCounts([total, -cap]) : 0);
  const shownSort = sort || data?.sort || null;
  return (
    <section ref={card} className={`card card--table card--list ${list.busy && data ? 'is-busy' : ''}`} aria-label={meta.title} aria-busy={list.busy}>
      <header className="card-h">
        <div>
          <h2>{meta.title}</h2>
          <p>{!data ? 'Loading the list…' : `${integer(total)} ${total === 1 ? 'record' : 'records'}${meta.hint ? `. ${meta.hint}` : ''}`}</p>
          {left && <p className="left-n"><Icon name="trend" size={13} />{left}</p>}
        </div>
        <div className="tbar">
          <ColumnFilterStatus filters={columnMeta} values={columnValues} onClear={onClearColumns} />
          <label className="search"><Icon name="search" size={14} /><input ref={searchBox} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the list" aria-label="Search the list" maxLength={200} /></label>
          {(tracker || mine) && <button className={`pick-i ${mine ? 'is-on' : ''}`} aria-pressed={mine} onClick={() => setMine(!mine)}><Icon name="users" size={13} />My actions</button>}
          {(data?.changes || changed) && <button className={`pick-i ${changed ? 'is-on' : ''}`} aria-pressed={changed} onClick={() => setChanged(!changed)}><Icon name="trend" size={13} />Changed since the last run</button>}
          {canModify && <button className="btn btn--pri" onClick={() => setForm({ mode: 'add' })}><Icon name="plus" size={14} />Add record</button>}
        </div>
      </header>
      {data && (
        <div className="list-tools">
          {tracker && tableRows.length > 0 && !everything && <button className="btn btn--pri" onClick={startWork} data-start-work><Icon name="right" size={14} />Start working</button>}
          {tracker && <WindowChips />}
          {(freshCount > 0 || fresh) && (
            <button className={`pick-i pick-i--you ${fresh ? 'is-on' : ''}`} aria-pressed={fresh} onClick={() => setFresh(!fresh)} data-fresh>
              New since your last visit · {integer(freshCount)} on this page
            </button>
          )}
          <span className="sp" />
          {tracker && <button className="pick-i" onClick={() => setDialog('batches')}><Icon name="history" size={13} />Recent changes</button>}
          {focus.any && (
            <button className={`pick-i ${focus.on ? 'is-on' : ''}`} aria-pressed={focus.on}
              onClick={() => { focus.toggle(); if (!focus.on) card.current?.scrollIntoView({ block: 'start' }); }}>Focus on the list</button>
          )}
          <button className="ibtn ibtn--sm keys-b" onClick={() => setDialog('help')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</button>
        </div>
      )}
      {impact && <p className="impact"><Icon name="check" size={14} />{impact}</p>}
      {canModify && (
        <p className="note"><Icon name="info" size={14} />
          {app.options.replace_edits
            ? 'Edit, add or delete records; each change is kept as a version. The next run replaces edited records with its own values, and your edits stay in each record\u2019s history.'
            : `Edit, add or delete records; each change is kept as a version. New runs keep your edits: a record you changed keeps your values when the job runs again, and stays on the list tagged ${NOT_IN_RUN} when a run no longer lists it.`}
        </p>
      )}
      <ConflictNote conflicts={acts.conflicts} labelOf={labelOf} onClose={acts.clearConflicts} />
      {(picked.size > 0 || matching) && (
        <BulkBar picked={picked} matching={matching} total={shownTotal} allOnPage={allPicked} owners={owners} person={person} busy={acting} tomorrow={tomorrow}
          canMatch={!everything} onAct={actOn} onAll={selectAll} onClear={clearPicks} />
      )}
      {!data && list.busy && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={22} />)}</div>}
      {list.error && <p className="tile-err"><Icon name="info" size={14} />The list could not load: {list.error}</p>}
      {data && (
        <>
          {late.late > 0 && <p className="late-n" data-overdue><Icon name="calendar" size={13} />Overdue: {recordsText(late.late)} on this page, shown first.</p>}
          <DataTable label={meta.title} columns={columns} rows={tableRows} rowKey={keyOf} onRow={setOpen} paged={false}
            empty={emptyState({ search, mine, changed, fresh, windowed: narrowWindow(prefs) ? windowLabel(prefs.window) : '', narrowedAny,
              ranged: Object.values(filters || {}).some((v) => v && typeof v === 'object' && !Array.isArray(v)), onClear: clearAll,
              onWide: () => update((p) => ({ ...p, window: 'all' })) })}
            sort={shownSort ? { key: shownSort.key, dir: shownSort.dir === 'desc' ? -1 : 1 } : null} onSort={(s) => setSort({ key: s.key, dir: s.dir > 0 ? 'asc' : 'desc' })}
            rowClass={(r) => [picked.has(String(recordKeyOf(r))) || matching ? 'is-picked' : '', keyOf(r) === cursorKey ? 'is-cursor' : '',
              isOverdue(r._inspire_due, r._inspire_status, today) ? 'is-late' : ''].filter(Boolean).join(' ')}
            askAbout={genieOn(app, pageId) && history ? (r) => ({ pageId, recordKey: keyOf(r), label: plainText(r[meta.label]) || keyOf(r) }) : undefined} />
          {cap > 0 && beyond > 0 && (
            <p className="more" data-limit>{`Your limit shows the top ${integer(cap)} of ${integer(addCounts([cap, beyond]))}. ${integer(beyond)} more are not shown; change the limit in Settings.`}</p>
          )}
          {total > 0 && (
            <div className="pager">
              <span>Rows per page</span>
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="sp" />
              <span className="pager-n">{pageText(data.offset, rows.length, shownTotal)}</span>
              <button className="ibtn ibtn--sm" onClick={() => goTo(Math.max(0, offset - size), data.cursors?.prev)} disabled={offset === 0} aria-label="Previous page"><Icon name="left" size={15} /></button>
              <button className="ibtn ibtn--sm" onClick={() => goTo(offset + size, data.cursors?.next)} disabled={!more} aria-label="Next page"><Icon name="right" size={15} /></button>
            </div>
          )}
        </>
      )}
      <Drawer meta={meta} row={shown} onClose={work ? stopWork : close} history={history} canModify={canModify} tracker={tracker} owners={owners} app={app} pageId={pageId}
        nonce={drawerNonce} aliases={aliases} onEdit={edit} onDelete={setDoomed} acts={acts} onExplain={onExplain} genieBusy={genieBusy} model={data?.money}
        work={work && !work.ended && shown ? { text: workText, next: workNext } : null} tomorrow={tomorrow} today={today} focusOwner={ownerFocus}
        closedReadOnly={everything} />
      {form && <RecordForm mode={form.mode} target={form.target} meta={meta} pageId={pageId} rows={rows} onClose={() => setForm(null)} onSaved={saved} />}
      {doomed && <DeleteDialog target={recordRef(meta, doomed)} label={plainText(doomed[meta.label]) || 'this record'} pageId={pageId} onClose={() => setDoomed(null)} onSaved={saved} />}
      {acts.similar && (
        <SimilarDialog similar={acts.similar} onClose={acts.closeSimilar}
          onApply={(values) => acts.act({ match: acts.similar.match }, values).catch((err) => toast(actError(err), toneOf(err)))} />
      )}
      {dialog === 'batches' && <BatchesDialog pageId={pageId} onClose={() => setDialog('')} onUndo={acts.undo} labelOf={labelOf} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog('')} />}
      {work?.ended && <CaughtUp work={work} onClose={() => setWork(null)} />}
    </section>
  );
}
