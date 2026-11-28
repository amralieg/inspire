// c33 base STUB (lane C owns this file). REQ-578, REQ-579 Match: the client side of the match routes.
import { ROUTES } from './startWizard';

// POST /api/inspire/match/start { inspire_database, warehouse_id, business_name, use_cases, params } (the server mints the session id) -> { session_id, run_id }
export async function startMatch(apiFetch, body) { void apiFetch; void body; void ROUTES; throw new Error('Match is not built yet'); }
// GET /api/inspire/match/result ?inspire_database&warehouse_id&session_id[&run_id]
//   -> { state: 'none'|'running'|'done'|'failed', inputs: [{ input_no, name, description }], reports: Report[], decisions: [{ input_no, piece_no, decision, event_at }] }
export async function readMatch(apiFetch, query) { void apiFetch; void query; throw new Error('Match is not built yet'); }
// POST /api/inspire/match/decision { inspire_database, warehouse_id, session_id, input_no, piece_no, decision } -> { ok: true }
export async function saveDecision(apiFetch, body) { void apiFetch; void body; throw new Error('Match is not built yet'); }
// POST /api/inspire/match/accept { inspire_database, warehouse_id, session_id, params } -> { session_id, run_id }
export async function acceptMatch(apiFetch, body) { void apiFetch; void body; throw new Error('Match is not built yet'); }
