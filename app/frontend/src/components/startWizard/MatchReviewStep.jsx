// c33 base STUB (lane C owns this file and replaces the body). REQ-578, REQ-579: Match path, Review and start (7d).
// Shows the use cases, catalogs and settings; registerStart(fn) where fn() writes the inputs and launches the Match run
// (POST /api/inspire/match/start: 15_operation 'Match Use Cases', 19_match_phase 'match') and resolves { sessionId, runId }; the shell then opens the Monitor.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady, registerStart, launchParams, onEditStep.
import { useEffect } from 'react';

export default function MatchReviewStep({ onReady }) {
  useEffect(() => { onReady?.(true); }, [onReady]);
  return <section data-wiz-step="matchReview" data-wiz-stub="" className="rounded-xl border border-dashed border-border p-6 text-sm text-text-secondary">MatchReviewStep is not built yet.</section>;
}
