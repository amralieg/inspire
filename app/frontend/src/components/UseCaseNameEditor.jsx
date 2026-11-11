import { useEffect, useState } from 'react';
import { PlainMessage } from './TechnicalDetails';

const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export default function UseCaseNameEditor({ name, originalName = '', onSave, liveAppStale = false, onUpdateLiveApp }) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const renamed = Boolean(originalName) && originalName !== name;
  const changed = tidy(draft) !== tidy(name);

  useEffect(() => setDraft(name), [name]);

  const save = async (value, action = onSave) => {
    setBusy(true);
    setError('');
    try {
      await action(value);
    } catch (err) {
      setError(err?.message || 'Could not save the name.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-3" data-use-case-name-editor="">
      <label className="block text-xs font-semibold text-text-secondary" htmlFor="use-case-name-input">Use case name</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id="use-case-name-input"
          dir="auto"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-primary"
        />
        <button
          type="button"
          disabled={!changed || busy}
          onClick={() => save(draft)}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-text-primary disabled:opacity-40"
        >
          Save name
        </button>
        {renamed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save('')}
            className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-40"
          >
            Use catalogue name
          </button>
        )}
      </div>
      {renamed && <p className="mt-1 text-xs text-text-tertiary">Catalogue name: {originalName}</p>}
      {liveAppStale && typeof onUpdateLiveApp === 'function' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => save(null, onUpdateLiveApp)}
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-text-primary disabled:opacity-40"
        >
          Update the live App to show the new name
        </button>
      )}
      {error && <PlainMessage as="p" text={error} role="alert" dir="auto" className="mt-1 text-xs text-error-fg" />}
    </div>
  );
}
