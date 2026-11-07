import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, Loader2, PenLine, Pencil, RotateCcw, Send, Upload } from 'lucide-react';
import {
  checklistHeadline, checklistPlace, checklistState, checklistStatusText, missedAsks, notMetAsks, publishedAnywayText, rephrasableAsks,
} from '../lib/mvpProgress';
import { heldPartsText, publishHeldText } from '../lib/implementControl';
import { VIBE_FEATURES_LABEL, heldNoReasonText } from '../lib/implementWizard';
import { reducedMotion } from '../lib/motion';

const OUTLINE_BUTTON = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:bg-db-red-solid-hover shadow-sm shadow-db-red/20 disabled:opacity-50';
const MARK = {
  met: 'bg-success-bg text-success-fg ring-success/30',
  not_met: 'bg-error-bg text-error-fg ring-error/30',
  anyway: 'bg-warning-bg text-warning-fg ring-warning/30',
  unchecked: 'bg-warning-bg text-warning-fg ring-warning/30',
  refused: 'bg-error-bg text-error-fg ring-error/30',
  self_fixed: 'bg-success-bg text-success-fg ring-success/30',
  unrequested: 'bg-error-bg text-error-fg ring-error/30',
  not_decided: 'bg-warning-bg text-warning-fg ring-warning/30',
};
const ROW_LOOK = {
  met: { mark: '✓', said: 'Met: ', border: 'border-border' },
  anyway: { mark: '×', said: 'Not met: ', border: 'border-warning/40' },
  not_met: { mark: '×', said: 'Not met: ', border: 'border-error/40' },
  unchecked: { mark: '?', said: 'Could not be checked: ', border: 'border-warning/40' },
  refused: { mark: '×', said: 'Settings change refused: ', border: 'border-error/40' },
  self_fixed: { mark: '✓', said: 'Put back by Inspire: ', border: 'border-border' },
  unrequested: { mark: '×', said: 'Changed with no ask: ', border: 'border-error/40' },
  not_decided: { mark: '?', said: 'Not decided: ', border: 'border-warning/40' },
};
const OWN_STATE = ['unchecked', 'refused', 'self_fixed', 'unrequested', 'not_decided'];

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const asked = (entry) => (entry.requirement ? `“${entry.requirement}”` : `Requirement ${entry.n}`);

function Requirement({ entry, assets, headline }) {
  const place = checklistPlace(entry, assets);
  const state = checklistState(entry);
  const look = ROW_LOOK[state];
  const status = checklistStatusText(entry);
  const anyway = publishedAnywayText(entry);
  const said = (entry.notDecided || entry.refused) && headline.includes(entry.evidence);
  const evidence = entry.evidence && !said ? entry.evidence : '';
  return (
    <li data-requirement={OWN_STATE.includes(state) ? state : entry.met ? 'met' : 'not_met'}
      className={`flex items-start gap-2.5 rounded-lg border bg-surface px-3 py-2 text-[12px] ${look.border}`}>
      <span aria-hidden className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ring-inset ${MARK[state]}`}>
        {look.mark}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-text-primary"><span className="sr-only">{look.said}</span>{asked(entry)}</p>
        {place && <p data-requirement-place="" className="text-text-secondary">{place}</p>}
        <p data-requirement-status="" className="text-text-secondary">{`${status}.${evidence ? ` ${sentence(evidence)}` : ''}`}</p>
        {!entry.met && entry.tried.length > 0 && (
          <ol aria-label="What Genie tried" className="space-y-0.5">
            {entry.tried.map((line, i) => <li key={`${i}-${line}`} className="text-text-secondary">{`${line.charAt(0).toUpperCase()}${line.slice(1)}`}</li>)}
          </ol>
        )}
        {entry.checks.length > 0 && (
          <ul aria-label="Checks Inspire ran" className="flex flex-wrap gap-1.5 pt-0.5">
            {entry.checks.map((check, i) => (
              <li key={`${i}-${check.name}`} data-check-passed={check.passed ? 'yes' : 'no'}
                className={`rounded-md px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${check.passed ? MARK.met : MARK.not_met}`}>
                <span aria-hidden>{check.passed ? '✓' : '×'} </span>{check.name}<span className="sr-only">{check.passed ? ': passed' : ': failed'}</span>
              </li>
            ))}
          </ul>
        )}
        {anyway && <p data-published-anyway="" className="font-medium text-warning-fg">{sentence(anyway)}</p>}
      </div>
    </li>
  );
}

export default function VibeChecklist({ checklist, assets = {}, compact = false, readOnly = false, locked = false, lockedReason = '', busy = false,
  onSendAgain, onEdit }) {
  if (!checklist?.entries?.length) return null;
  const tone = missedAsks(checklist).length || checklist.refused ? 'text-error-fg'
    : checklist.notDecided || checklist.met < checklist.total ? 'text-warning-fg' : 'text-success-fg';
  const Heading = compact ? 'h4' : 'h3';
  const settingsOnly = checklist.refused > 0 && !checklist.total;
  const title = settingsOnly ? 'Settings changes' : 'Vibe checklist';
  const headline = checklistHeadline(checklist);
  const sendAgain = checklist.notDecided > 0 && !readOnly && (onSendAgain || onEdit);
  return (
    <section aria-label={`${title} of v${checklist.version}`} data-vibe-checklist={checklist.version ?? ''} data-checklist-live={checklist.live ? '' : undefined}
      className={compact ? 'space-y-2 pt-2' : 'rounded-xl border border-border bg-surface shadow-sm px-4 py-3.5 space-y-3'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className={`flex items-center gap-1.5 font-semibold text-text-primary ${compact ? 'text-[12px]' : 'text-[15px]'}`}>
          <ListChecks size={compact ? 13 : 15} aria-hidden /> {title}
        </Heading>
        <p data-checklist-headline="" className={`font-bold ${compact ? 'text-[12px]' : 'text-[14px]'} ${tone}`}>{headline}</p>
      </div>
      {checklist.live && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden /> Inspire is checking each requirement on this build; the list fills as it checks.
        </p>
      )}
      <ol aria-label={settingsOnly ? `Settings changes asked in v${checklist.version}` : `Vibe requirements of v${checklist.version}`} className="space-y-1.5">
        {checklist.entries.map((entry, i) => <Requirement key={`${i}-${entry.n}-${entry.requirement}`} entry={entry} assets={assets} headline={headline} />)}
      </ol>
      {sendAgain && (
        <div className="flex flex-wrap gap-2">
          {onSendAgain && (
            <button type="button" disabled={locked} title={lockedReason || undefined} onClick={onSendAgain} className={PRIMARY_BUTTON}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send again
            </button>
          )}
          {onEdit && (
            <button type="button" onClick={onEdit} className={OUTLINE_BUTTON}>
              <Pencil size={12} /> {VIBE_FEATURES_LABEL}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function HeldVersion({ held, checklist, canPublish, readOnly, locked, lockedReason = '', busy = '', onRephrase, onTryAgain, onPublish }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [confirming]);
  const open = notMetAsks(checklist);
  const missed = missedAsks(checklist);
  const rephrasable = rephrasableAsks(checklist);
  const unchecked = open.length - missed.length;
  const parts = heldPartsText(held);
  const publish = async () => {
    if (await onPublish()) setConfirming(false);
  };
  return (
    <section aria-label={`v${held.version} is held`} data-held-version={held.version} className="rounded-lg border border-warning/40 bg-warning-bg px-3.5 py-3 text-[12px] space-y-2.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-px shrink-0 text-warning-fg" aria-hidden />
        <div className="min-w-0 space-y-0.5 text-warning-fg">
          <p className="text-[13px] font-semibold">v{held.version} is held</p>
          {held.reason ? <p data-held-reason="">{sentence(held.reason)}</p>
            : <p role="alert" data-held-error="" className="font-semibold text-error-fg">{sentence(heldNoReasonText(held.version))}</p>}
          {parts && <p data-held-parts="">{parts}</p>}
        </div>
      </div>
      {!readOnly && (
        <>
          <div className="flex flex-wrap gap-2">
            {rephrasable.some((entry) => entry.requirement) && (
              <button type="button" onClick={onRephrase} className={OUTLINE_BUTTON}>
                <PenLine size={12} /> Rephrase
              </button>
            )}
            <button type="button" disabled={locked} title={lockedReason || undefined} onClick={onTryAgain} className={PRIMARY_BUTTON}>
              {busy === 'retry' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Try again
            </button>
            {canPublish && (
              <button type="button" disabled={locked || confirming} title={lockedReason || undefined} onClick={() => setConfirming(true)} className={OUTLINE_BUTTON}>
                <Upload size={12} /> Publish anyway
              </button>
            )}
          </div>
        </>
      )}
      {!readOnly && canPublish && confirming && (
        <div ref={confirmRef} role="group" aria-label={`Confirm publishing v${held.version} anyway`}
          className="rounded-lg border border-border-strong bg-surface px-3 py-2 space-y-2 motion-safe:animate-terminal-line">
          <p className="font-semibold text-text-primary">
            Publish v{held.version} anyway?{open.length ? ` ${open.length === 1 ? 'This ask is' : `These ${open.length} asks are`} not met${unchecked ? ' or could not be checked' : ''}:` : ''}
          </p>
          {open.length > 0 && (
            <ul aria-label="Asks not met" className="list-disc ps-5 text-text-primary">
              {open.map((entry, i) => <li key={`${i}-${entry.n}`}>{asked(entry)}{entry.unchecked ? ' (Inspire could not check it)' : ''}</li>)}
            </ul>
          )}
          <p data-publish-held-text="" className="text-text-secondary">{publishHeldText(held)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={locked} onClick={publish} className={PRIMARY_BUTTON}>
              {busy === 'publish' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Publish anyway
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={OUTLINE_BUTTON}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
