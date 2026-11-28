// c33 base STUB (lane C owns this file). REQ-579: on the Monitor of a Match run, one box per input use case (from __inspire_match_input)
// from the start of the run, each with its progress status (MATCH_PROGRESS_TEXT in lib/startWizard.js) read from the run's step rows
// (stage 'Match Use Cases', step 'Match <input_no>'; the shape is in lib/startWizard.js).
// Props: { settings, sessionId, runId, apiFetch, steps }. steps are the Monitor's own __inspire_step rows (no second steps read).
// It reads GET /api/inspire/match/result for the inputs and renders nothing when state is 'none' (not a Match run).
export default function MatchMonitorBoxes() {
  return null;
}
