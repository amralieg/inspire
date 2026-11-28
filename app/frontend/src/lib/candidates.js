// REQ-581 U3: provisional use case cards. The agent publishes a candidate as soon as it is eligible, with a provisional rank
// (<inspire_db>.__inspire_candidates, read through GET /api/inspire/candidates).
import { stepCategory } from './monitorState.js';

export async function fetchCandidates(apiFetch, { inspireDatabase, warehouseId, sessionId }) {
  const query = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) });
  const data = await apiFetch(`/api/inspire/candidates?${query}`);
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

/** Candidates exist while a use case stage is in progress and no step has failed; before that, or after a failure, there is nothing to read. */
export function candidatesWanted(steps, { runFailed = false } = {}) {
  if (runFailed) return false;
  const list = Array.isArray(steps) ? steps : [];
  if (list.some((s) => stepCategory(s?.status, false) === 'error')) return false;
  return list.some((s) => /^Use Cases? /i.test(String(s?.stage_name || '')) && stepCategory(s?.status, true) === 'running');
}

/** The Monitor clears the cards it shows when the run job ended badly, the session finished, or a step failed. A use case stage that merely moved on does not clear them. */
export function candidatesDropped(steps, { runFailed = false, finished = false } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  return Boolean(finished || runFailed || list.some((s) => stepCategory(s?.status, false) === 'error'));
}

const nameKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const rankOf = (candidate) => (Number.isFinite(Number(candidate.provisional_rank)) && candidate.provisional_rank !== null ? Number(candidate.provisional_rank) : Infinity);

/** Eligible and selected candidates in rank order whose use case has not arrived as a final card yet. Every other state shows no provisional card. */
export function provisionalCardsOf(candidates, liveUseCases) {
  const arrived = new Set((liveUseCases || []).flatMap((uc) => [uc.name, uc.label]).map(nameKey).filter(Boolean));
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && (c.state === 'eligible' || c.state === 'selected') && !arrived.has(nameKey(c.name || c.candidate_id)))
    .sort((a, b) => rankOf(a) - rankOf(b) || String(a.candidate_id).localeCompare(String(b.candidate_id)));
}

// REQ-581 U4: what the Discover run left for Implement, as GET /api/inspire/results answers it (pending_artifacts).
export const PENDING_LABEL = { docs: 'Documents', genie_instructions: 'Databricks AI instructions', notebook: 'Notebook', translation: 'Translation' };
export const PENDING_TEXT = 'pending, produced at Implement';

/** The pending kinds that apply to one use case: entries naming it, plus those naming no use case (the whole session). Each kind once, and none the use case already has (made). */
export function pendingKindsFor(pending, useCaseId, made = {}) {
  const kinds = [];
  for (const entry of Array.isArray(pending) ? pending : []) {
    if (!entry || !PENDING_LABEL[entry.kind] || kinds.includes(entry.kind) || made?.[entry.kind]) continue;
    if (entry.use_case_id == null || String(entry.use_case_id) === String(useCaseId)) kinds.push(entry.kind);
  }
  return kinds;
}
