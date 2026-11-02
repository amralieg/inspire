import { useEffect, useRef, useState } from 'react';
import { Loader2, Square } from 'lucide-react';

export default function StopRunControl({ runId, business, apiFetch }) {
  const [verdict, setVerdict] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/run/${runId}/cancel`)
      .then((got) => { if (live) setVerdict({ ...got, runId }); })
      .catch((err) => { if (live) setVerdict({ allowed: false, error: err.message, runId }); });
    return () => { live = false; };
  }, [runId, apiFetch]);

  const stop = async () => {
    if (sent.current) return;
    sent.current = true;
    setStopping(true);
    setError('');
    try {
      await apiFetch(`/api/run/${runId}/cancel`, { method: 'POST' });
      setStopped(true);
    } catch (err) {
      sent.current = false;
      setError(err.message || 'Inspire could not stop this run.');
    }
    setStopping(false);
  };

  if (!verdict || verdict.runId !== runId) return null;
  if (!verdict.allowed) {
    return <p role="status" className="mt-3 text-xs text-text-secondary">{verdict.error}</p>;
  }
  if (stopped) return <p role="status" className="mt-3 text-xs text-text-secondary">Stopping the run. What it already wrote stays.</p>;
  const name = business || 'this business';
  return (
    <div className="mt-3">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded-lg hover:bg-bg-subtle">
          <Square size={12} aria-hidden="true" /> Stop this run
        </button>
      ) : (
        <div role="group" aria-label="Stop this run" className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-primary">Stop the Discover run for {name}? What the run already wrote stays.</span>
          <button type="button" onClick={stop} disabled={stopping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-db-red-solid rounded-lg disabled:opacity-60">
            {stopping && <Loader2 size={12} className="animate-spin" aria-hidden="true" />} Stop the run
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={stopping}
            className="px-3 py-1.5 text-text-secondary border border-border rounded-lg">Keep it running</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-error-fg">{error}</p>}
    </div>
  );
}
