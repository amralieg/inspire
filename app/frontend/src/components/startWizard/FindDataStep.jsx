// c33 (REQ-577): Data step, find path: catalogs only (draft.catalogs), production catalog advice, no data rows.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
import { useEffect, useState } from 'react';
import { NO_DATA_ROWS_NOTE, PRODUCTION_CATALOG_ADVICE } from '../../lib/startWizard';
import DevWarnings from './DevWarnings';
import { PlainMessage } from '../TechnicalDetails';

export default function FindDataStep({ draft, setDraft, settings, apiFetch, onReady }) {
  const [catalogs, setCatalogs] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const picked = Array.isArray(draft?.catalogs) ? draft.catalogs : [];
  const warehouseId = settings?.warehouseId || '';

  useEffect(() => {
    let cancelled = false;
    setError('');
    apiFetch(`/api/catalogs?warehouse_id=${encodeURIComponent(warehouseId)}`)
      .then((data) => { if (!cancelled) setCatalogs((data.catalogs || []).map((c) => c.name).filter(Boolean)); })
      .catch((err) => { if (!cancelled) { setCatalogs([]); setError(err.message || 'The catalogs could not be listed.'); } });
    return () => { cancelled = true; };
  }, [apiFetch, warehouseId, attempt]);

  useEffect(() => { onReady?.(picked.length > 0); }, [onReady, picked.length]);

  const toggle = (name) => setDraft({ catalogs: picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name] });

  return (
    <section data-wiz-step="find" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Which catalogs should Inspire look in?</h2>
        <p className="mt-1 text-sm text-text-secondary">{PRODUCTION_CATALOG_ADVICE}</p>
        <p className="mt-1 text-sm text-text-secondary">{NO_DATA_ROWS_NOTE}</p>
      </div>
      <DevWarnings picks={picked.map((name) => ({ kind: 'catalog', name }))} />
      {catalogs === null && <p className="text-sm text-text-secondary">Loading your catalogs</p>}
      {error && (
        <div role="alert" className="text-sm text-error-fg">
          <PlainMessage as="span" text={error} />{' '}
          <button type="button" className="underline" onClick={() => { setCatalogs(null); setAttempt((n) => n + 1); }}>Try again</button>
        </div>
      )}
      {catalogs && catalogs.length === 0 && !error && <p className="text-sm text-text-secondary">No catalogs found. Check that the App can read your catalogs.</p>}
      {catalogs && catalogs.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {catalogs.map((name) => (
            <li key={name}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="checkbox" checked={picked.includes(name)} onChange={() => toggle(name)} />
                <span>{name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
