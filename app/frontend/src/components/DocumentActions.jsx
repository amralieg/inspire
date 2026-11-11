import { useEffect, useState } from 'react';
import { DOCUMENT_ACTIONS, documentJobState, documentRunBody } from '../lib/documentActions.js';
import { PlainMessage } from './TechnicalDetails';

const POLL_MS = 15000;

export default function DocumentActions({ apiFetch, apiPostJson, session, catalogPath, onFinished }) {
  const [job, setJob] = useState(null);
  const [format, setFormat] = useState('PDF');
  const busy = job?.state === 'starting' || job?.state === 'running';

  useEffect(() => {
    if (job?.state !== 'running') return undefined;
    const timer = setInterval(async () => {
      try {
        const run = await apiFetch(`/api/run/${job.runId}`);
        const state = documentJobState(run);
        if (state === 'running') return;
        clearInterval(timer);
        setJob((current) => ({ ...current, state, error: state === 'failed' ? 'The job ended without writing the files; open the run in Monitor for the reason.' : '' }));
        if (state === 'done' && onFinished) onFinished();
      } catch {
        // a failed poll keeps the job running; the next poll reads the run again
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job, apiFetch, onFinished]);

  const start = async (kind) => {
    setJob({ kind, state: 'starting', runId: null, error: '' });
    try {
      const body = documentRunBody({
        kind,
        format: kind === 'strategy-document' ? format : '',
        sessionId: session.sessionId,
        inspireDatabase: session.inspireDatabase,
        businessName: session.businessName,
        generationPath: session.generationPath,
        catalogPath,
        outputLanguage: session.outputLanguage,
      });
      const out = await apiPostJson('/api/documents', body);
      setJob({ kind, state: 'running', runId: out.run_id, error: '' });
    } catch (err) {
      setJob({ kind, state: 'failed', runId: null, error: err.message || 'Inspire could not start the document job' });
    }
  };

  const disabled = !catalogPath || busy;
  return (
    <div data-document-actions="" className="mb-3 rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Documents</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-doc-action="strategy-document" disabled={disabled}
          onClick={() => start('strategy-document')} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
          {DOCUMENT_ACTIONS['strategy-document'].label}
        </button>
        <select aria-label="Strategy document format" value={format} disabled={disabled}
          onChange={(e) => setFormat(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm">
          {DOCUMENT_ACTIONS['strategy-document'].formats.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="button" data-doc-action="use-case-catalog" disabled={disabled}
          onClick={() => start('use-case-catalog')} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">
          {DOCUMENT_ACTIONS['use-case-catalog'].label}
        </button>
      </div>
      {!catalogPath && (
        <p className="mt-2 text-xs text-muted-foreground">Open the artifacts folder so Inspire can see this session's catalog, then try again.</p>
      )}
      {job?.state === 'running' && <p data-doc-status="running" className="mt-2 text-xs">Rebuilding the files for run {job.runId}. This page updates when they are ready.</p>}
      {job?.state === 'starting' && <p data-doc-status="starting" className="mt-2 text-xs">Starting the document job.</p>}
      {job?.state === 'done' && <p data-doc-status="done" className="mt-2 text-xs">The files are ready and listed below.</p>}
      {job?.state === 'failed' && <PlainMessage text={job.error} as="p" className="mt-2 text-xs text-error-fg" />}
    </div>
  );
}
