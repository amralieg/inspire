import { useCallback, useEffect, useRef, useState } from 'react';

export const NAME_TEXT_CLASS = 'text-lg sm:text-xl font-bold text-text-primary leading-snug';
const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const USE_CASE_NAME_EMPTY = 'A use case needs a name. Type one, or press Esc to keep the current name.';

export function useUseCaseRename(value, onSave) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef(null);
  const setField = useCallback((node) => { field.current = node; }, []);
  const inFlight = useRef(false);
  const skipBlur = useRef(false);

  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  const leave = () => { skipBlur.current = true; setEditing(false); };
  const start = () => { skipBlur.current = false; setError(''); setEditing(true); };
  const commit = async (draft) => {
    if (inFlight.current) return;
    const next = tidy(draft);
    if (!next) { setError(USE_CASE_NAME_EMPTY); return; }
    if (next === tidy(value)) { leave(); return; }
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
  const blur = (draft) => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    commit(draft);
  };
  return { value, editing, busy, error, setField, start, leave, commit, blur, canRename: typeof onSave === 'function' };
}
