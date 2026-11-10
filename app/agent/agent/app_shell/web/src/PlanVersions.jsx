import { useState } from 'react';
import { movePlan } from './api.js';
import { Icon } from './icons.jsx';
import { PlainNote, SaidNote, useToast } from './ui.jsx';
import './styles/plan.css';

export const REASON_MAX = 500;
export const PLAN_WORDS = {
  noun: 'Version', start: 'Start a draft', again: 'Start a new draft',
  actions: { submit: 'Send for review', approve: 'Approve', reopen: 'Reopen', publish: 'Publish' },
  shown: { Draft: 'Draft', 'In review': 'In review', Approved: 'Approved', Published: 'Published' },
  asks: { approve: 'Why you approve this version', reopen: 'Why you reopen it', publish: 'Why you publish it', submit: 'A note for the reviewers (optional)' },
};
export const CYCLE_WORDS = {
  noun: 'Cycle', start: 'Start a review cycle', again: 'Start the next cycle',
  actions: { approve: 'Sign off the cycle', reopen: 'Reopen' },
  shown: { Draft: 'Open', 'In review': 'In review', Approved: 'Signed off', Published: 'Signed off' },
  asks: { approve: 'Why you sign off this cycle', reopen: 'Why you reopen it' },
};
const REASONED = ['approve', 'reopen', 'publish'];
const MOVES = { Draft: ['submit', 'approve'], 'In review': ['approve', 'reopen'], Approved: ['publish', 'reopen'], Published: [] };

export const versionName = (version, words) => (version ? `${words.noun} ${version.number}` : '');
export const statusWord = (status, words) => words.shown[status] || status;
export const movesOf = (version, words) => (version ? MOVES[version.status] || [] : []).filter((m) => words.actions[m]);

export function ReasonForm({ ask, required = true, busy, onSubmit, onCancel, submit = 'Save', name = 'reason' }) {
  const [text, setText] = useState('');
  const missing = required && !text.trim();
  return (
    <form className="plan-why" onSubmit={(e) => { e.preventDefault(); if (!missing) onSubmit(text.trim()); }} data-reason-form={name}>
      <label className="grow">{ask}
        <textarea dir="auto" rows={2} maxLength={REASON_MAX} required={required} value={text} onChange={(e) => setText(e.target.value)} data-reason />
      </label>
      <small className="muted" aria-live="polite">{text.length}/{REASON_MAX}</small>
      <button className="btn btn--sm btn--pri" type="submit" disabled={busy || missing} data-reason-save>{submit}</button>
      {onCancel && <button className="btn btn--sm" type="button" onClick={onCancel}>Cancel</button>}
    </form>
  );
}

export function VersionBar({ page, versions, access, words, onMoved, beforeMove }) {
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const toast = useToast();
  const latest = versions[0] || null;
  const open = versions.some((v) => v.editable);
  const can = access?.can_decide;
  const move = async (action, reason = '', target = latest) => {
    setBusy(true);
    setError('');
    setSaid('');
    try {
      const before = beforeMove ? await beforeMove(action, target) : '';
      const got = await movePlan({ page: page.id, action, reason, ...(target && action !== 'new' ? { plan_id: target.plan_id, seen: target.status } : {}) });
      const now = action === 'new' ? got?.versions?.[0] : got?.versions?.find((v) => v.plan_id === target.plan_id);
      const text = `${action === 'new' ? `Started ${versionName(now, words)}` : `${versionName(target, words)} is ${statusWord(now?.status, words).toLowerCase()}`}${before ? `. ${before}` : ''}`;
      setSaid(text);
      toast(text);
      setAsking(null);
      onMoved(got);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (action, target = latest) => (REASONED.includes(action) || action === 'submit'
    ? setAsking(asking?.action === action && asking.target === target ? null : { action, target }) : move(action, '', target));
  const owned = (action) => action === 'approve' || action === 'publish';
  const blocked = (action) => busy || (owned(action) && !access.can_approve);
  const newerPublished = (v) => versions.some((o) => o.status === 'Published' && o.number > v.number);
  const older = (v) => (can && v !== latest && v.status === 'Approved' && words.actions.publish && !newerPublished(v) ? ['publish'] : []);
  return (
    <section className="card plan-ver" aria-label={`${words.noun}s`} data-versions>
      <header className="card-h"><div><h2>{latest ? `${versionName(latest, words)} · ${statusWord(latest.status, words)}` : `No ${words.noun.toLowerCase()} yet`}</h2>
        {latest && <p data-version-meta>{latest.changed_by ? `Last change by ${latest.changed_by}` : ''}{latest.overrides?.length ? ` · ${latest.overrides.length} override${latest.overrides.length === 1 ? '' : 's'}` : ''}</p>}
        {!can && access?.why && <p className="muted" data-no-decisions>{access.why}</p>}
      </div></header>
      {versions.length > 0 && (
        <ol className="plan-steps" aria-label={`${words.noun}s so far`}>
          {versions.slice(0, 6).map((v) => (
            <li key={v.plan_id} className={`plan-chip is-${v.status.toLowerCase().replace(/\s+/g, '-')}`} data-version={v.number} data-status={v.status}>
              {versionName(v, words)}<b>{statusWord(v.status, words)}</b>
              {older(v).map((action) => (
                <button key={action} type="button" className="btn btn--sm" disabled={blocked(action)} title={owned(action) && !access.can_approve ? access.approve_why : undefined}
                  aria-expanded={asking?.action === action && asking.target === v} aria-label={`${words.actions[action]} ${versionName(v, words)}`}
                  onClick={() => pick(action, v)} data-move={action} data-move-version={v.number}>{words.actions[action]}</button>
              ))}
            </li>
          ))}
        </ol>
      )}
      {can && (
        <div className="plan-moves">
          {!open && <button type="button" className="btn btn--sm btn--pri" disabled={busy} onClick={() => move('new')} data-move="new">
            <Icon name="plus" size={14} />{latest ? words.again : words.start}</button>}
          {movesOf(latest, words).map((action) => (
            <button key={action} type="button" className={`btn btn--sm ${action === 'approve' ? 'btn--pri' : ''}`} disabled={blocked(action)}
              title={owned(action) && !access.can_approve ? access.approve_why : undefined} aria-expanded={asking?.action === action && asking.target === latest} onClick={() => pick(action)} data-move={action}>
              {words.actions[action]}
            </button>
          ))}
        </div>
      )}
      {can && asking && <ReasonForm key={`${asking.action}-${asking.target?.plan_id}`} name={asking.action} ask={`${words.asks[asking.action]}${asking.target !== latest ? ` (${versionName(asking.target, words)})` : ''}`}
        required={REASONED.includes(asking.action)} busy={busy} submit={words.actions[asking.action]} onSubmit={(reason) => move(asking.action, reason, asking.target)} onCancel={() => setAsking(null)} />}
      {error && <PlainNote text={error} icon={<Icon name="info" size={12} />} className="tile-err" role="alert" />}
      {!error && <SaidNote text={said} at="version" />}
    </section>
  );
}
