// REQ-579: on the Monitor of a Match run, one box per input use case with its match progress (MATCH_PROGRESS_TEXT) read from the run's
// step rows (stage 'Match Use Cases', step 'Match <input_no>'). Renders nothing when match/result is state none (not a Match run).
// Props: { settings, sessionId, runId, apiFetch, steps } (steps are the Monitor's own step rows).
import { useEffect, useRef, useState } from 'react';
import { MATCH_PROGRESS, MATCH_PROGRESS_TEXT, MATCH_STAGE, matchStepName } from '../../lib/startWizard';
import { readMatch } from '../../lib/matchClient';

const POLL_MS = 15000;
const TONE = { matched: 'border-success text-success-fg', 'partly matched': 'border-warning text-warning-fg', 'not matched': 'border-db-red text-db-red-fg',
  matching: 'border-border text-text-primary', waiting: 'border-border text-text-secondary' };
const VERDICT_PROGRESS = { full: 'matched', partial: 'partly matched', none: 'not matched' };

const resultOf = (row) => {
  const raw = row && row.result_json;
  if (raw && typeof raw === 'object') return raw;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};
const atOf = (row, result) => { const t = Date.parse(result.event_at || row.last_updated || ''); return Number.isFinite(t) ? t : 0; };

// The latest step row of this input decides; sub_step names back up a result_json without a status.
function progressOf(steps, inputNo) {
  const mine = (steps || []).filter((r) => r && r.stage_name === MATCH_STAGE && r.step_name === matchStepName(inputNo)).map((row) => ({ row, result: resultOf(row) }));
  if (!mine.length) return null;
  const { row, result } = mine.reduce((a, b) => (atOf(b.row, b.result) >= atOf(a.row, a.result) ? b : a));
  const sub = String(row.sub_step_name || '').toLowerCase();
  let status = String(result.status || '').toLowerCase();
  if (!MATCH_PROGRESS.includes(status)) status = sub === 'error' ? 'not matched' : (sub === 'complete' ? (VERDICT_PROGRESS[result.verdict] || 'matched') : 'matching');
  return { status, confidence: result.confidence, error: result.error };
}

export default function MatchMonitorBoxes({ settings, sessionId, runId, apiFetch, steps }) {
  const [match, setMatch] = useState(null);
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const inspireDatabase = settings && settings.inspireDatabase;
  const warehouseId = settings && settings.warehouseId;

  useEffect(() => {
    if (!sessionId || !inspireDatabase || !warehouseId) return undefined;
    let stop = false;
    let timer = null;
    const load = async () => {
      let next = null;
      try { next = await readMatch(fetchRef.current, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId), run_id: runId }); } catch { next = null; }
      if (stop) return;
      if (next) setMatch(next);
      if (!next || next.state === 'running') timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [sessionId, runId, inspireDatabase, warehouseId]);

  if (!match || match.state === 'none' || !(match.inputs || []).length) return null;
  const inputs = [...match.inputs].sort((a, b) => a.input_no - b.input_no);
  return (
    <section aria-label="Use cases being matched" data-match-boxes="" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {inputs.map((u) => {
        const report = (match.reports || []).find((r) => r.input_no === u.input_no);
        const found = progressOf(steps, u.input_no)
          || (report && VERDICT_PROGRESS[report.verdict] ? { status: VERDICT_PROGRESS[report.verdict], confidence: report.confidence } : null)
          || { status: 'waiting' };
        const showConfidence = (found.status === 'matched' || found.status === 'partly matched') && found.confidence != null;
        return (
          <div key={u.input_no} data-match-box={u.input_no} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-medium text-text-primary">{u.name}</p>
            {u.description ? <p className="mt-0.5 text-xs text-text-secondary">{u.description}</p> : null}
            <p className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-xs ${TONE[found.status]}`}>
              <span data-match-status={found.status}>{MATCH_PROGRESS_TEXT[found.status]}</span>
              {showConfidence ? <span className="text-text-secondary"> . {found.confidence}% sure</span> : null}
            </p>
            {found.status === 'not matched' && found.error ? <p className="mt-1 text-xs text-db-red-fg">{String(found.error)}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
