// REQ-578, REQ-579 Match: the client side of the match routes (lib/startWizard.js ROUTES).
// apiFetch is the app's GET function (lib/apiClient makeApiFetch). The POST calls take the matching JSON POST function (makeApiPostJson);
// postOf(settings) builds it from the signed-in settings.
import { makeApiPostJson } from './apiClient';
import { ROUTES } from './startWizard';

export const postOf = (settings) => makeApiPostJson({ token: settings?.token, databricksHost: settings?.databricksHost, showcase: settings?.showcase || '' });

// POST /api/inspire/match/start { inspire_database, warehouse_id, business_name, use_cases, params } (the server mints the session id) -> { session_id, run_id }
export const startMatch = (post, body) => post(ROUTES.matchStart, body, { raise: false });
// GET /api/inspire/match/result ?inspire_database&warehouse_id&session_id[&run_id]
//   -> { state: 'none'|'running'|'done'|'failed', inputs: [{ input_no, name, description }], reports: Report[], decisions: [{ input_no, piece_no, decision, event_at }] }
export const readMatch = (apiFetch, query) => apiFetch(`${ROUTES.matchResult}?${new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v != null && v !== '')))}`, { raise: false });
// POST /api/inspire/match/decision { inspire_database, warehouse_id, session_id, input_no, piece_no, decision } -> { ok: true }
export const saveDecision = (post, body) => post(ROUTES.matchDecision, body);
// POST /api/inspire/match/accept { inspire_database, warehouse_id, session_id, params } -> { session_id, run_id }
export const acceptMatch = (post, body) => post(ROUTES.matchAccept, body);
