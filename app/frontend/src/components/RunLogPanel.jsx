import { useState } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';

export function runLogQuery({ inspireDatabase, warehouseId, sessionId }) {
  return `/api/inspire/log?${new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, session_id: String(sessionId) })}`;
}

export default function RunLogPanel({ inspireDatabase, warehouseId, sessionId, apiFetch }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setLog(await apiFetch(runLogQuery({ inspireDatabase, warehouseId, sessionId })));
    } catch (err) {
      setError(err.message || 'Inspire could not read the run log.');
    }
    setLoading(false);
  };

  if (!inspireDatabase || !warehouseId || !sessionId) return null;
  const toggle = () => {
    if (!open && !log) load();
    setOpen(!open);
  };
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggle} aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded-lg hover:bg-bg-subtle">
          <FileText size={12} aria-hidden="true" /> {open ? 'Hide the run log' : 'Show the run log'}
        </button>
        {open && (
          <button type="button" onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border rounded-lg disabled:opacity-60">
            {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />} Refresh
          </button>
        )}
      </div>
      {open && error && <p role="alert" className="mt-2 text-xs text-error-fg">{error}</p>}
      {open && log && !log.found && <p role="status" className="mt-2 text-xs text-text-secondary">The run has not written its log yet. Refresh in a minute.</p>}
      {open && log && log.found && (
        <>
          {log.truncated && <p className="mt-2 text-[11px] text-text-tertiary">Showing the last part of the log.</p>}
          <pre aria-label="Run log" className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg-subtle p-3 text-[11px] leading-snug font-mono text-text-secondary whitespace-pre-wrap">{log.text}</pre>
        </>
      )}
    </div>
  );
}
