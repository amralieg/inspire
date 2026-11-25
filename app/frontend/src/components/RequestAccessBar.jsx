// REQ-521: the Request Access button at the top of the Start picker, and the result line per object after a send.
import { useState } from 'react';
import { requestAccessFor } from '../lib/accessRequest';

const lineOf = (r) => (r.sent
  ? `${r.full_name}: Request sent to ${(Array.isArray(r.destinations) ? r.destinations.filter(Boolean) : []).join(', ')}`
  : `${r.full_name}: Not sent: ${String(r.reason || '').trim()}`);

// objects: the picked [{type, full_name}]. onSent(fullNames): the objects that went, to be unpicked.
export default function RequestAccessBar({ objects, onSent }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [failure, setFailure] = useState('');

  const send = async () => {
    setBusy(true);
    setFailure('');
    try {
      const body = await requestAccessFor(objects);
      const rows = Array.isArray(body?.results) ? body.results : null;
      if (!rows) {
        setResults([]);
        setFailure(String(body?.error || body?.reason || 'No answer.'));
      } else {
        setResults(rows);
        onSent(rows.filter((r) => r.sent).map((r) => r.full_name));
      }
    } catch (err) {
      setResults([]);
      setFailure(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!objects.length && !results.length && !failure) return null;
  return (
    <div className="mb-3 space-y-1">
      {objects.length > 0 && (
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-xs font-semibold border border-db-red/30 bg-db-red-50 text-db-red-fg hover:border-db-red disabled:opacity-60"
        >
          {busy ? 'Sending...' : 'Request Access'}
        </button>
      )}
      {failure && <p className="text-xs text-error-fg">{`Inspire could not send the request: ${failure}`}</p>}
      {results.map((r) => (
        <p key={r.full_name} data-access-request-object={r.full_name} className={`text-xs ${r.sent ? 'text-success-fg' : 'text-warning-fg'}`}>{lineOf(r)}</p>
      ))}
    </div>
  );
}
