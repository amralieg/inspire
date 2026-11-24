import { useEffect, useRef, useState } from 'react';
import { Loader2, Square } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';

// REQ-511: with `open` set, the page's More menu owns the Stop entry and this renders only the confirm (and the refusal), reporting the verdict through onVerdict.
export default function StopRunControl({ runId, business, apiFetch, open, onClose, onVerdict }) {
  const controlled = open !== undefined;
  const [verdict, setVerdict] = useState(null);
  const [confirmingOwn, setConfirming] = useState(false);
  const confirming = controlled ? open : confirmingOwn;
  const closeConfirm = () => (controlled ? onClose?.() : setConfirming(false));
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/run/${runId}/cancel`)
      .then((got) => { if (live) { setVerdict({ ...got, runId }); onVerdict?.(Boolean(got.allowed)); } })
      .catch((err) => { if (live) { setVerdict({ allowed: false, error: err.message, runId }); onVerdict?.(false); } });
    return () => { live = false; };
  }, [runId, apiFetch]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const ready = Boolean(verdict) && verdict.runId === runId;
  if (!ready && !controlled) return null;
  if (ready && !verdict.allowed) {
    return <PlainMessage as="p" text={verdict.error} role="status" className="mt-3 text-xs text-text-secondary" />;
  }
  if (stopped) return <p role="status" className="mt-3 text-xs text-text-secondary">Stopping the run. What it already wrote stays.</p>;
  if (controlled && !open) return null;
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-primary-solid rounded-lg disabled:opacity-60">
            {stopping && <Loader2 size={12} className="animate-spin" aria-hidden="true" />} Stop the run
          </button>
          <button type="button" onClick={closeConfirm} disabled={stopping}
            className="px-3 py-1.5 text-text-secondary border border-border rounded-lg">Keep it running</button>
        </div>
      )}
      {error && <PlainMessage text={error} role="alert" className="mt-2 text-xs text-error-fg" />}
    </div>
  );
}
