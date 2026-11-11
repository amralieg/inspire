import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import SaveButton from './SaveButton';

export const NAME_TEXT_CLASS = 'text-lg sm:text-xl font-bold text-text-primary leading-snug';
const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export default function UseCaseNameEditor({ text, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef(null);
  const inFlight = useRef(false);
  const skipBlur = useRef(false);

  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  const leave = () => { skipBlur.current = true; setEditing(false); };
  const start = () => { skipBlur.current = false; setError(''); setEditing(true); };
  const commit = async (draft) => {
    if (inFlight.current) return;
    const next = tidy(draft);
    if (!next || next === tidy(value)) { leave(); return; }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      leave();
    } catch (err) {
      setError(err?.message || 'Could not save the name.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
        <h3 dir="auto" className={NAME_TEXT_CLASS}>{text}</h3>
        {typeof onSave === 'function' && (
          <button type="button" aria-label={`Rename ${text}`} title="Rename this use case"
            onClick={(e) => { e.stopPropagation(); start(); }}
            className="shrink-0 rounded-md p-1 text-text-tertiary hover:text-text-primary hover:bg-bg-subtle transition-smooth">
            <Pencil size={14} aria-hidden />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1 min-w-0 flex-1 basis-full sm:basis-auto" data-use-case-name-editor="">
      <span className="inline-flex items-center gap-2 min-w-0">
        <input
          ref={field}
          dir="auto"
          aria-label={`Use case name for ${text}`}
          defaultValue={value}
          maxLength={200}
          disabled={busy}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); leave(); }
          }}
          onBlur={(e) => { if (skipBlur.current) { skipBlur.current = false; return; } commit(e.currentTarget.value); }}
          className={`${NAME_TEXT_CLASS} min-w-0 flex-1 bg-transparent border-b border-db-red-solid/60 outline-none disabled:opacity-60`}
        />
        {busy && (
          <span role="status" data-saving="" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary shrink-0">
            <Loader2 size={12} className="animate-spin" aria-hidden />Saving…
          </span>
        )}
      </span>
      {error && <PlainMessage as="p" text={error} role="alert" dir="auto" className="text-xs text-error-fg" />}
    </span>
  );
}

export function UseCaseNameNotes({ name, originalName = '', onSave, liveAppStale = false, onUpdateLiveApp }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const renamed = Boolean(originalName) && originalName !== name;
  const run = async (key, action) => {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err?.message || 'Could not save the name.');
    } finally {
      setBusy('');
    }
  };
  const showLive = liveAppStale && typeof onUpdateLiveApp === 'function';
  if (!renamed && !showLive) return null;

  return (
    <div className="px-4 pt-3 space-y-1" data-use-case-name-notes="">
      {renamed && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <span>Catalogue name: {originalName}</span>
          <SaveButton busy={busy === 'reset'} busyLabel="Saving…" disabled={busy !== ''}
            onClick={() => run('reset', () => onSave(''))}
            className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-subtle disabled:opacity-40">
            Use catalogue name
          </SaveButton>
        </div>
      )}
      {showLive && (
        <SaveButton busy={busy === 'live'} busyLabel="Updating the live App…" disabled={busy !== ''}
          onClick={() => run('live', () => onUpdateLiveApp())}
          className="mt-1 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-text-primary disabled:opacity-40">
          Update the live App to show the new name
        </SaveButton>
      )}
      {error && <PlainMessage as="p" text={error} role="alert" dir="auto" className="text-xs text-error-fg" />}
    </div>
  );
}
