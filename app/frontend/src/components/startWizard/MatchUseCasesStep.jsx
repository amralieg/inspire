// REQ-578: Your use cases (Match path): the business name, then the use cases pasted ("name: description" per line), uploaded (CSV, XLSX, TXT)
// or copied from a previous run. Writes draft.businessName, draft.useCases and draft.useCaseSource.
// Props (lib/startWizard.js): draft, setDraft, settings, apiFetch, onReady.
import { useEffect, useRef, useState } from 'react';
import { MATCH_INPUT_MAX } from '../../lib/startWizard';
import { numberUseCases, parseUseCaseText, useCaseLines, useCasesOfFile } from '../../lib/matchReport';
import { formatWhen } from '../../lib/formatWhen';
import BusyNote from '../BusyNote';
import { PlainMessage } from '../TechnicalDetails';

const BUSINESS_HINT = 'e.g. Contoso, Acme Corp, Retail Division';
const field = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary';
const button = 'rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary hover:border-db-red';

export default function MatchUseCasesStep({ draft, setDraft, settings, apiFetch, onReady }) {
  const [items, setItems] = useState(() => (draft.useCases || []).map((u) => ({ name: u.name, description: u.description || '' })));
  const [text, setText] = useState(() => useCaseLines(items));
  const [source, setSource] = useState(draft.useCaseSource || 'paste');
  const [problem, setProblem] = useState('');
  const [runs, setRuns] = useState(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const live = useRef({});
  live.current = { setDraft, onReady, draft };

  const business = String(draft.businessName || '');
  const { total, useCases } = numberUseCases(items);
  const ready = Boolean(business.trim() && useCases.length);

  useEffect(() => { live.current.setDraft({ useCases, useCaseSource: source }); }, [items, source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { live.current.onReady?.(ready); }, [ready]);

  const take = (list, from, fill = true) => { setItems(list); setSource(from); if (fill) setText(useCaseLines(list)); };
  const edit = (value) => { setText(value); setItems(parseUseCaseText(value)); setSource('paste'); setProblem(''); };

  const upload = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setProblem('');
    try {
      const list = await useCasesOfFile(file);
      if (!list.length) { setProblem(`${file.name} holds no use cases. Put one use case on each line, or a name column and a description column.`); return; }
      take(list, 'upload');
    } catch (err) {
      setProblem(`Inspire could not read ${file.name}: ${err && err.message ? err.message : 'the file is not readable'}.`);
    }
  };

  const openRuns = async () => {
    const next = !runsOpen;
    setRunsOpen(next);
    if (!next || runs) return;
    setRunsError('');
    try {
      const q = new URLSearchParams({ inspire_database: settings.inspireDatabase, warehouse_id: settings.warehouseId, all: '1' });
      const got = await apiFetch(`/api/inspire/sessions?${q}`);
      setRuns(got.sessions || []);
    } catch (err) {
      setRuns([]);
      setRunsError(err && err.message ? err.message : 'Inspire could not read your runs.');
    }
  };

  const pickRun = async (run) => {
    setBusy(true);
    setProblem('');
    try {
      const sid = String(run.session_id);
      const q = new URLSearchParams({ inspire_database: settings.inspireDatabase, warehouse_id: settings.warehouseId, session_id: sid });
      const got = await apiFetch(`/api/inspire/usecases?${q}`);
      const list = (got.usecases || []).filter((r) => r.session_id == null || String(r.session_id) === sid)
        .map((r) => ({ name: r.Name || r.name || r.use_case || '', description: r.statement || r.Statement || '' })).filter((u) => String(u.name).trim());
      if (!list.length) { setProblem(`Run ${run.business_name || sid} has no use cases to copy.`); return; }
      take(list, 'run');
      if (!business.trim() && run.business_name) setDraft({ businessName: String(run.business_name) });
      setRunsOpen(false);
    } catch (err) {
      setProblem(err && err.message ? err.message : 'Inspire could not read the use cases of that run.');
    } finally { setBusy(false); }
  };

  return (
    <section data-wiz-step="usecases" className="space-y-5">
      <div>
        <label htmlFor="match-business" className="block text-sm font-medium text-text-primary">Your business</label>
        <input id="match-business" dir="auto" type="text" aria-label="Business name" value={business} placeholder={BUSINESS_HINT}
          onChange={(e) => setDraft({ businessName: e.target.value })} className={`${field} mt-1`} />
      </div>
      <div>
        <label htmlFor="match-use-cases" className="block text-sm font-medium text-text-primary">Your use cases</label>
        <p className="mt-0.5 text-xs text-text-secondary">One use case on each line, as name: description. Up to {MATCH_INPUT_MAX}.</p>
        <textarea id="match-use-cases" dir="auto" aria-label="Your use cases" rows={8} value={text} onChange={(e) => edit(e.target.value)}
          placeholder={'Forecast weekly demand: Predict units per store and week\nReduce customer churn'} className={`${field} mt-1 font-mono`} />
        <p className="mt-1 text-sm text-text-secondary" aria-live="polite">
          {useCases.length === 1 ? '1 use case found' : `${useCases.length} use cases found`}
          {total > MATCH_INPUT_MAX && <span className="text-warning-fg"> . Only the first {MATCH_INPUT_MAX} of {total} are kept.</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => fileRef.current && fileRef.current.click()}>Upload a file</button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt" className="sr-only" aria-label="Upload use cases (CSV, XLSX or TXT)" onChange={upload} />
        <button type="button" className={button} aria-expanded={runsOpen} onClick={openRuns}>From a previous run</button>
        <span className="text-xs text-text-secondary">CSV, XLSX or TXT: a name column, then a description column.</span>
      </div>
      {runsOpen && (
        <div className="max-h-60 space-y-1 overflow-auto rounded-lg border border-border p-2" data-match-runs="">
          {runs === null && <BusyNote inline text="Reading your runs..." className="text-sm text-text-secondary" />}
          {runsError && <PlainMessage text={runsError} className="text-sm text-db-red-fg" />}
          {runs && !runs.length && !runsError && <p className="text-sm text-text-secondary">No runs yet.</p>}
          {(runs || []).map((run) => (
            <button key={run.session_id} type="button" disabled={busy} onClick={() => pickRun(run)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface">
              <span className="text-text-primary">{run.business_name || `Run ${run.session_id}`}</span>
              <span className="text-xs text-text-secondary">{formatWhen(run.create_at)}</span>
            </button>
          ))}
        </div>
      )}
      {problem && <p role="alert" className="text-sm text-db-red-fg">{problem}</p>}
    </section>
  );
}
