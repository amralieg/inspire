// c33 base STUB (lane C owns this file). REQ-578, REQ-579: the per-piece match review on the Results page of a Match session.
// For each use case: verdict and confidence; for each piece the requirement, status, confidence, evidence (table, columns, why), the gap,
// and the choice keep / drop / use known data (POST /api/inspire/match/decision); then Accept (POST /api/inspire/match/accept, phase 2).
// Props: { settings, sessionId, apiFetch }. It reads GET /api/inspire/match/result and renders nothing when state is 'none' (not a Match run).
export default function MatchResultsPanel() {
  return null;
}
