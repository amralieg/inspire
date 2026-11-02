import { useEffect, useRef, useState } from 'react';
import { Trash2, Undo2, Wand2 } from 'lucide-react';
import VibesEditor from './VibesEditor';
import { VIBES_MAX, VIBE_ROUTING, vibesLength, vibesProblem } from '../lib/implementWizard';
import { reducedMotion } from '../lib/motion';

const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:bg-db-red-solid-hover shadow-sm shadow-db-red/20 disabled:opacity-50';
const OUTLINE_BUTTON = 'inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';

function Waiting({ entries, onDrop }) {
  if (!entries.length) return null;
  return (
    <ul aria-label="Asks waiting for Edit MVP" className="space-y-1.5">
      {entries.map((entry) => {
        const out = entry.kind === 'remove';
        return (
          <li key={`${entry.kind}:${entry.id || ''}:${entry.text}`} data-waiting={entry.kind}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-subtle/60 px-3 py-2 text-[12px]">
            <span className="min-w-0 whitespace-pre-line text-text-primary">
              {out && <span className="font-semibold">Take out of the {entry.label}: </span>}“{entry.text}”
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

export default function GlobalVibe({ entries, active, error = '', seed = null, onAdd, onDrop }) {
  const [text, setText] = useState('');
  const [replaces, setReplaces] = useState([]);
  const [seen, setSeen] = useState(null);
  const box = useRef(null);
  if ((seed?.at ?? null) !== seen) {
    setSeen(seed?.at ?? null);
    if (seed) {
      setText(seed.text);
      setReplaces(seed.replaces || []);
    }
  }
  useEffect(() => {
    if (!seed?.at) return;
    box.current?.scrollIntoView?.({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    box.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [seed?.at]);
  const waiting = entries.filter((entry) => entry.kind === 'ask').map((entry) => entry.text);
  const own = vibesProblem('mvp', text, 'MVP');
  const length = vibesLength([...waiting, text.trim()].filter(Boolean).join('\n'));
  const total = !own && text.trim() && length > VIBES_MAX ? `with the asks waiting, the MVP vibes would be ${length} characters; at most ${VIBES_MAX} are allowed` : '';
  const add = () => {
    onAdd(text, replaces);
    setText('');
    setReplaces([]);
  };
  const out = replaces.length;
  return (
    <section ref={box} aria-label="Vibe this MVP" data-vibe-box="mvp" className="rounded-xl border border-border bg-surface shadow-sm px-4 py-3.5 space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-text-primary">Vibe this MVP</h3>
        <p className="text-[12px] text-text-secondary">Say what to change, in your own words. {VIBE_ROUTING}.</p>
      </div>
      <VibesEditor id="mvp" label="MVP" value={text} onChange={setText} />
      {total && <p role="alert" className="text-[11px] text-error-fg">{total}</p>}
      {out > 0 && (
        <p data-rephrasing="" className="text-[11px] font-medium text-text-primary">
          Add vibes takes out the {out === 1 ? 'ask that was not met' : `${out} asks that were not met`} and keeps your new words instead.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!text.trim() || Boolean(own || total)} onClick={add} className={PRIMARY_BUTTON}>
          <Wand2 size={12} /> Add vibes
        </button>
        <span className="min-w-0 flex-1 text-[11px] text-text-secondary">
          {active ? 'A version is building now; the asks you add wait for Edit MVP.' : 'Add vibes keeps your ask for Edit MVP, so one build carries all your changes.'}
        </span>
      </div>
      <Waiting entries={entries} onDrop={onDrop} />
      {error && <p role="alert" className="text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2">{error}</p>}
    </section>
  );
}
