import { useEffect, useRef, useState } from 'react';
import { Hammer, Loader2, RotateCcw, Settings2, Trash2, Undo2, Wand2 } from 'lucide-react';
import DrawerShell from './DrawerShell';
import VibesEditor, { VibePrevious } from './VibesEditor';
import { OPEN_ALL_SETTINGS, VIBES_MAX, VIBE_FEATURES_LABEL, VIBE_ROUTING, heldAsks, vibesLength, vibesProblem } from '../lib/implementWizard';
import { vibeLimitNotes } from '../lib/vibeLimits';
import { REBUILD_WAITS, rebuildLabel, removingAsk } from '../lib/implementControl';
import { capital } from '../lib/targetKpi';
import { plural } from '../lib/plural';

const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:bg-db-red-solid-hover shadow-sm shadow-db-red/20';
const GREYED = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-bg-subtle text-text-secondary border border-border cursor-not-allowed';
const OUTLINE_BUTTON = 'inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const ITEM = 'flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-subtle/60 px-3 py-2 text-[12px]';

const LIMIT_LEAD = { refused: 'Not built: ', vague: 'Too vague: ', conflict: 'Conflict: ' };

function LimitNote({ note }) {
  const tone = note.kind === 'refused' ? 'text-error-fg' : 'text-text-secondary';
  return (
    <span data-vibe-limit={note.kind} role={note.kind === 'refused' ? 'alert' : undefined} className={`block text-[11px] ${tone}`}>
      <span className="font-semibold">{LIMIT_LEAD[note.kind]}</span>{note.reason}.
    </span>
  );
}

function Waiting({ entries, onDrop }) {
  if (!entries.length) return <p className="text-[12px] text-text-secondary">No changes waiting yet.</p>;
  const notes = vibeLimitNotes(entries.filter((entry) => entry.kind === 'ask').flatMap((entry) => heldAsks(entry.text)));
  return (
    <ul aria-label="Changes waiting for the next build" className="space-y-1.5">
      {entries.map((entry) => {
        const out = entry.kind === 'remove';
        const lines = out ? [] : heldAsks(entry.text).map((line) => line.toLowerCase());
        const mine = notes.filter((note) => lines.includes(note.ask.toLowerCase()));
        return (
          <li key={`${entry.kind}:${entry.id || ''}:${entry.text}`} data-waiting={entry.kind} className={ITEM}>
            <span className="min-w-0 whitespace-pre-line text-text-primary">
              {out && <span className="font-semibold">Take out of the {entry.label}: </span>}“{entry.text}”
              {mine.map((note) => <LimitNote key={`${note.kind}:${note.reason}`} note={note} />)}
            </span>
            <button type="button" onClick={() => onDrop(entry)} className={OUTLINE_BUTTON}>
              {out ? <Undo2 size={12} /> : <Trash2 size={12} />} {out ? 'Keep it' : 'Take it out'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NotLanded({ asset, item }) {
  return (
    <li data-held-ask="waiting" className={ITEM}>
      <span className="min-w-0 text-text-primary">
        <span className="font-semibold not-italic">{capital(asset.label)}: </span>“{item.ask}”
        <span className="block text-text-secondary">Not in the live {asset.label} yet, it waits for the next build{item.evidence ? `: ${item.evidence}` : '.'}</span>
      </span>
    </li>
  );
}

function BuiltWith({ assets, entries, onRemove, onKeep }) {
  const waitingOf = (asset) => (Array.isArray(asset.waiting) ? asset.waiting : []);
  const held = assets.filter((asset) => asset.rebuild && (heldAsks(asset.vibes).length || waitingOf(asset).some((item) => !item.listed)));
  if (!held.length) return null;
  return (
    <section aria-label="Built with" data-built-with="" className="space-y-2">
      <h3 className="text-[13px] font-semibold text-text-primary">Built with</h3>
      {held.map((asset) => (
        <ul key={asset.id} aria-label={`Asks the ${asset.label} holds`} className="space-y-1">
          {waitingOf(asset).filter((item) => !item.listed).map((item) => <NotLanded key={`waiting-${item.ask}`} asset={asset} item={item} />)}
          {heldAsks(asset.vibes).map((ask, i) => {
            const missed = waitingOf(asset).find((item) => item.listed && item.ask === ask);
            const removing = removingAsk(entries, asset.id, ask);
            return (
              <li key={`${i}-${ask}`} data-held-ask={removing ? 'removing' : missed ? 'waiting' : 'held'} className={ITEM}>
                <span className={`min-w-0 ${removing ? 'line-through text-text-secondary' : 'text-text-primary'}`}>
                  <span className="font-semibold not-italic">{capital(asset.label)}: </span>“{ask}”{removing && <span className="sr-only">, taken out on the next build</span>}
                  {missed && !removing && <span className="block text-text-secondary">Not in the live {asset.label} yet, it waits for the next build{missed.evidence ? `: ${missed.evidence}` : '.'}</span>}
                </span>
                <button type="button" onClick={() => (removing ? onKeep(removing) : onRemove(asset, ask))} aria-label={`${removing ? 'Keep' : 'Remove'} “${ask}”`}
                  className={OUTLINE_BUTTON}>
                  {removing ? <RotateCcw size={12} /> : <Trash2 size={12} />} {removing ? 'Keep it' : 'Remove'}
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}

export default function VibeFeatures({
  name, entries, assets = [], seed = null, active, busy, error = '', notice = '', built = null, choices = [], previous = '', blocked = '',
  onPrevious, onAdd, onDrop, onRemoveAsk, onRebuild, onOpenSettings, onClose,
}) {
  const [text, setText] = useState(seed?.text || '');
  const [replaces, setReplaces] = useState(seed?.replaces || []);
  const boxRef = useRef(null);
  useEffect(() => {
    boxRef.current?.querySelector('textarea')?.focus();
  }, []);
  const waiting = entries.filter((entry) => entry.kind === 'ask').map((entry) => entry.text);
  const own = vibesProblem('mvp', text, 'MVP');
  const length = vibesLength([...waiting, text.trim()].filter(Boolean).join('\n'));
  const total = !own && text.trim() && length > VIBES_MAX ? `with the asks waiting, the MVP vibes would be ${plural(length, 'character')}; at most ${VIBES_MAX.toLocaleString('en-US')} are allowed` : '';
  const add = () => {
    onAdd(text, replaces);
    setText('');
    setReplaces([]);
  };
  const out = replaces.length;
  const stopped = active || busy || Boolean(blocked);
  const footer = (
    <>
      {onOpenSettings && (
        <button type="button" onClick={onOpenSettings} className={`me-auto ${OUTLINE_BUTTON}`}>
          <Settings2 size={12} /> Need more than words? {OPEN_ALL_SETTINGS}
        </button>
      )}
      <button type="button" onClick={onClose} className={OUTLINE_BUTTON}>Close</button>
      <button type="button" data-rebuild="" disabled={stopped} aria-disabled={stopped} title={active ? REBUILD_WAITS : blocked || undefined} onClick={onRebuild}
        className={stopped ? GREYED : PRIMARY_BUTTON}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />} {rebuildLabel(entries)}
      </button>
    </>
  );
  return (
    <DrawerShell center data-vibe-features-dialog="" label={`${VIBE_FEATURES_LABEL}: ${name}`} closeLabel={`Close ${VIBE_FEATURES_LABEL}`} onClose={onClose} footer={footer}
      title={(
        <>
          <h2 className="text-base font-bold text-text-primary">{VIBE_FEATURES_LABEL}: {name}</h2>
          <p className="text-[12px] text-text-secondary">One box for the whole use case. {VIBE_ROUTING}.</p>
        </>
      )}>
      <div className="space-y-4">
        <div ref={boxRef} data-vibe-box="mvp" className="space-y-2">
          <VibesEditor id="mvp" label="MVP" value={text} onChange={setText} minPx={220} />
          {total && <p role="alert" className="text-[11px] text-error-fg">{total}</p>}
          {out > 0 && (
            <p data-rephrasing="" className="text-[11px] font-medium text-text-primary">
              Add vibe takes out the {out === 1 ? 'ask that was not met' : `${out} asks that were not met`} and keeps your new words instead.
            </p>
          )}
          <button type="button" disabled={!text.trim() || Boolean(own || total)} onClick={add} className={`${OUTLINE_BUTTON} disabled:cursor-not-allowed`}>
            <Wand2 size={12} /> Add vibe
          </button>
        </div>
        <section aria-label="Changes waiting" className="space-y-2">
          <h3 className="text-[13px] font-semibold text-text-primary">Changes waiting</h3>
          <Waiting entries={entries} onDrop={onDrop} />
        </section>
        <BuiltWith assets={assets} entries={entries} onRemove={onRemoveAsk} onKeep={onDrop} />
        {!active && waiting.length > 0 && <VibePrevious built={built} choices={choices} value={previous} onPick={onPrevious} />}
        {active && <p data-rebuild-waits="" className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[12px] font-medium text-text-primary">{REBUILD_WAITS}</p>}
        {!active && blocked && <p data-rebuild-blocked="" className="text-[12px] text-text-secondary">{blocked}</p>}
        {notice && <p role="status" className="text-[12px] text-text-secondary">{notice}</p>}
        {error && <p role="alert" className="text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2">{error}</p>}
      </div>
    </DrawerShell>
  );
}
