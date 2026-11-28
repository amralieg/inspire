// c33 base STUB (lane C owns this file and replaces the body). REQ-578: Your use cases (7a): business name, paste / CSV, XLSX, TXT upload / previous run; writes draft.useCases.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
// Until built it renders a placeholder and reports ready, so the wizard shell can walk past it.
import { useEffect } from 'react';

export default function MatchUseCasesStep({ onReady }) {
  useEffect(() => { onReady?.(true); }, [onReady]);
  return <section data-wiz-step="usecases" data-wiz-stub="" className="rounded-xl border border-dashed border-border p-6 text-sm text-text-secondary">MatchUseCasesStep is not built yet.</section>;
}
