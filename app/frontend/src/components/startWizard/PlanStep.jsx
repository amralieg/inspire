// c33 base STUB (lane B owns this file and replaces the body). REQ-577: Plan step (5a sorting, 5b review): POST /api/inspire/plan/sort, writes draft.plan.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
// Until built it renders a placeholder and reports ready, so the wizard shell can walk past it.
import { useEffect } from 'react';

export default function PlanStep({ onReady }) {
  useEffect(() => { onReady?.(true); }, [onReady]);
  return <section data-wiz-step="plan" data-wiz-stub="" className="rounded-xl border border-dashed border-border p-6 text-sm text-text-secondary">PlanStep is not built yet.</section>;
}
