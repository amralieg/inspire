// REQ-578, REQ-579: the per-piece match review on the Results page of a Match session. For each use case: verdict and confidence; for each
// piece the requirement, status, confidence, evidence (table, columns, why), the gap and the choice keep / drop / use known data
// (POST match/decision); then Accept (POST match/accept, phase accept). Renders nothing when match/result is state none.
// Props: { settings, sessionId, apiFetch }.
import { useEffect, useRef, useState } from 'react';
import { DECISION_TEXT, MATCH_ACCEPT, MATCH_DECISIONS, MATCH_REVIEW_TITLE, PIECE_STATUS_TEXT, VERDICT_TEXT } from '../../lib/startWizard';
import { acceptMatch, postOf, readMatch, saveDecision } from '../../lib/matchClient';

const POLL_MS = 15000;
const decisionKey = (inputNo, pieceNo) => `${inputNo}:${pieceNo}`;
const TONE = { full: 'text-success-fg', partial: 'text-warning-fg', none: 'text-db-red-fg', matched: 'text-success-fg', partial_: 'text-warning-fg', missing: 'text-db-red-fg' };
const pill = (on) => `rounded-lg border px-3 py-1 text-sm ${on ? 'border-db-red bg-db-red-50 text-db-red-fg' : 'border-border bg-surface text-text-primary hover:border-db-red'}`;

function Piece({ report, piece, chosen, saving, onChoose }) {
  const known = piece.known_data_option;
  const options = MATCH_DECISIONS.filter((d) => d !== 'use_known_data' || known);
  return (
    <li data-match-piece={piece.piece_no} className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">{piece.requirement}</p>
        <p className={`text-xs ${piece.status === 'partial' ? TONE.partial_ : TONE[piece.status] || ''}`}>{PIECE_STATUS_TEXT[piece.status] || piece.status} . {piece.confidence}% sure</p>
      </div>
      {(piece.evidence || []).map((e, i) => (
        <div key={`${e.table}-${i}`} className="mt-2 text-sm">
          <p><span className="font-mono text-text-primary">{e.table}</span>{(e.columns || []).length ? <span className="text-text-secondary">: <span className="font-mono">{e.columns.join(', ')}</span></span> : null}</p>
          {e.why ? <p className="text-xs text-text-secondary">{e.why}</p> : null}
        </div>
      ))}
      {piece.gap ? <p className="mt-2 text-sm text-warning-fg">Gap: {piece.gap}</p> : null}
      {known ? (
        <p className="mt-1 text-xs text-text-secondary">Known data: <span className="font-mono">{known.table}</span>{(known.columns || []).length ? <span>: <span className="font-mono">{known.columns.join(', ')}</span></span> : null}{known.why ? `. ${known.why}` : ''}</p>
      ) : null}
      {piece.status !== 'matched' && (
        <div role="group" aria-label={`Choice for ${piece.requirement}`} className="mt-3 flex flex-wrap gap-2">
          {options.map((d) => (
            <button key={d} type="button" data-match-decision={d} aria-pressed={chosen === d} disabled={saving} className={pill(chosen === d)}
              onClick={() => onChoose(report.input_no, piece.piece_no, d)}>{DECISION_TEXT[d]}</button>
          ))}
        </div>
      )}
    </li>
  );
}

export default function MatchResultsPanel({ settings, sessionId, apiFetch }) {
  const [match, setMatch] = useState(null);
  const [chosen, setChosen] = useState({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [accepted, setAccepted] = useState('');
  const fetchRef = useRef(apiFetch);
  fetchRef.current = apiFetch;
  const inspireDatabase = settings && settings.inspireDatabase;
  const warehouseId = settings && settings.warehouseId;
  const where = { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) };

  useEffect(() => {
    if (!sessionId || !inspireDatabase || !warehouseId) return undefined;
    let stop = false;
    let timer = null;
    const load = async () => {
      let next = null;
      try { next = await readMatch(fetchRef.current, { inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) }); } catch { next = null; }
      if (stop) return;
      if (next) {
        setMatch(next);
        // The server's latest decision per piece; a choice made here and not yet saved on the server is kept.
        setChosen((held) => ({ ...Object.fromEntries((next.decisions || []).map((d) => [decisionKey(d.input_no, d.piece_no), d.decision])), ...held }));
      }
      if (!next || next.state === 'running') timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [sessionId, inspireDatabase, warehouseId]);

  if (!match || match.state === 'none') return null;
  const reports = match.reports || [];

  const choose = async (inputNo, pieceNo, decision) => {
    setSaving(true);
    setProblem('');
    try {
      await saveDecision(postOf(settings), { ...where, input_no: inputNo, piece_no: pieceNo, decision });
      setChosen((held) => ({ ...held, [decisionKey(inputNo, pieceNo)]: decision }));
    } catch (err) {
      setProblem(err && err.message ? err.message : 'Inspire could not save that choice.');
    } finally { setSaving(false); }
  };
  const accept = async () => {
    setSaving(true);
    setProblem('');
    try {
      const got = await acceptMatch(postOf(settings), where);
      setAccepted(`Started run ${got.run_id}. The use cases you kept are created there.`);
    } catch (err) {
      setProblem(err && err.message ? err.message : 'Inspire could not start the accept run.');
    } finally { setSaving(false); }
  };

  return (
    <section data-match-panel="" aria-label={MATCH_REVIEW_TITLE} className="mb-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-text-primary">{MATCH_REVIEW_TITLE}</h2>
      {!reports.length && <p className="text-sm text-text-secondary">{match.state === 'failed' ? 'The match run ended before it matched your use cases.' : 'Inspire is still matching your use cases. This page fills in as each one finishes.'}</p>}
      {reports.map((report) => (
        <div key={report.input_no} data-match-report={report.input_no} data-match-verdict={report.verdict} className="space-y-2 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-medium text-text-primary">{report.name}</h3>
            <p className={`text-sm ${TONE[report.verdict] || ''}`}>{VERDICT_TEXT[report.verdict] || report.verdict} . {report.confidence}% sure</p>
          </div>
          <ul className="space-y-2">
            {(report.pieces || []).map((piece) => (
              <Piece key={piece.piece_no} report={report} piece={piece} chosen={chosen[decisionKey(report.input_no, piece.piece_no)]} saving={saving} onChoose={choose} />
            ))}
          </ul>
        </div>
      ))}
      {problem && <p role="alert" className="text-sm text-db-red-fg">{problem}</p>}
      {accepted && <p className="text-sm text-success-fg">{accepted}</p>}
      {reports.length > 0 && (
        <button type="button" disabled={saving || match.state === 'running'} onClick={accept}
          className="rounded-lg bg-db-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{MATCH_ACCEPT}</button>
      )}
    </section>
  );
}
