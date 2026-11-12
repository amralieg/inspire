import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import SaveButton from './SaveButton';

export const NAME_TEXT_CLASS = 'text-lg sm:text-xl font-bold text-text-primary leading-snug';
const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function useUseCaseRename(value, onSave) {
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
  return { value, editing, busy, error, field, skipBlur, start, leave, commit, canRename: typeof onSave === 'function' };
}

export function UseCaseNameTitle({ text, rename }) {
  if (!rename.editing) return <h3 dir="auto" className={NAME_TEXT_CLASS}>{text}</h3>;
  return (
    <span className="flex flex-col gap-1 min-w-0 flex-1 basis-full sm:basis-auto" data-use-case-name-editor="">
      <span className="inline-flex items-center gap-2 min-w-0">
        <input
          ref={rename.field}
          dir="auto"
          aria-label={`Use case name for ${text}`}
          defaultValue={rename.value}
          maxLength={200}
          disabled={rename.busy}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); rename.commit(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); rename.leave(); }
          }}
          onBlur={(e) => { if (rename.skipBlur.current) { rename.skipBlur.current = false; return; } rename.commit(e.currentTarget.value); }}
          className={`${NAME_TEXT_CLASS} min-w-0 flex-1 bg-transparent border-b border-db-red-solid/60 outline-none disabled:opacity-60`}
        />
        {rename.busy && (
          <span role="status" data-saving="" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary shrink-0">
            <Loader2 size={12} className="animate-spin" aria-hidden />Saving…
          </span>
        )}
      </span>
      {rename.error && <PlainMessage as="p" text={rename.error} role="alert" dir="auto" className="text-xs text-error-fg" />}
    </span>
  );
}

export function UseCaseRenameButton({ text, rename }) {
  if (!rename.canRename || rename.editing) return null;
  return (
    <button type="button" aria-label={`Rename ${text}`} title="Rename this use case" onClick={rename.start}
      className="shrink-0 self-start mt-3 mx-1 rounded-md p-1 text-text-tertiary hover:text-text-primary hover:bg-bg-subtle transition-smooth">
      <Pencil size={14} aria-hidden />
    </button>
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
