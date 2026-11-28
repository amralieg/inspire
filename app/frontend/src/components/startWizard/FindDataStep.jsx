// c33 base STUB (lane B owns this file and replaces the body). REQ-577: Data step, find path: catalogs only (draft.catalogs), production catalog advice, no data rows.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
// Until built it renders a placeholder and reports ready, so the wizard shell can walk past it.
import { useEffect } from 'react';

export default function FindDataStep({ onReady }) {
  useEffect(() => { onReady?.(true); }, [onReady]);
  return <section data-wiz-step="find" data-wiz-stub="" className="rounded-xl border border-dashed border-border p-6 text-sm text-text-secondary">FindDataStep is not built yet.</section>;
}
