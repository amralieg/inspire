import { useEffect, useState } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';

export function runLogQuery({ inspireDatabase, warehouseId, sessionId }) {
  return `/api/inspire/log?${new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) })}`;
}

// REQ-511: with `open` set, the page's More menu owns the Run log entry and this renders only the log, its Refresh and a way to hide it.
export default function RunLogPanel({ inspireDatabase, warehouseId, sessionId, apiFetch, open: openProp, onOpenChange, fallbackText = '' }) {
  const controlled = openProp !== undefined;
  const [openOwn, setOpenOwn] = useState(false);
  const open = controlled ? openProp : openOwn;
  const setOpen = controlled ? onOpenChange : setOpenOwn;
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setLog(await apiFetch(runLogQuery({ inspireDatabase, warehouseId, sessionId })));
    } catch (err) {
      // REQ-511: a server without the log route (404) shows the step messages this page already holds; a refusal still shows only the refusal.
      if (err.status === 404 && fallbackText) setLog({ found: true, truncated: false, text: fallbackText });
      else setError(err.message || 'Inspire could not read the run log.');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (controlled && open && !log && !loading) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inspireDatabase || !warehouseId || !sessionId || (controlled && !open)) return null;
  const toggle = () => {
    if (!open && !log) load();
    setOpen(!open);
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded-lg hover:bg-bg-subtle">
          <FileText size={14} aria-hidden="true" /> {open ? 'Hide the run log' : 'Show the run log'}
        </button>
        {open && (
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border rounded-lg disabled:opacity-60">
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Refresh
          </button>
        )}
      </div>
      {open && error && <PlainMessage text={error} role="alert" className="mt-2 text-xs text-error-fg" />}
      {open && log && !log.found && <p role="status" className="mt-2 text-xs text-text-secondary">The run has not written its log yet. Refresh in a minute.</p>}
      {open && log && log.found && (
        <>
          {log.truncated && <p className="mt-2 text-caption text-text-tertiary">Showing the last part of the log.</p>}
          <pre aria-label="Run log" className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg-subtle p-3 text-caption leading-snug font-mono text-text-secondary whitespace-pre-wrap">{log.text}</pre>
        </>
      )}
    </div>
  );
}
