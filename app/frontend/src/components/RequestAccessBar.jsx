// REQ-521: the Request Access button at the top of the Start picker, and the result line per object after a send.
import { useState } from 'react';
import { requestAccessFor } from '../lib/accessRequest';
import { splitTechnical } from '../lib/plainText';

const lineOf = (r) => {
  const where = (Array.isArray(r.destinations) ? r.destinations.filter(Boolean) : []).join(', ');
  const reason = String(r.reason || '').trim();
  if (r.for === 'inspire') return r.sent ? `${r.full_name}: Request for Inspire sent to ${where}` : `${r.full_name}: Request for Inspire not sent: ${reason}`;
  return r.sent ? `${r.full_name}: Request sent to ${where}` : `${r.full_name}: Not sent: ${reason}`;
};

// The grant lines of a request that could not go out, with a Copy button.
function CopyBlock({ name, statements }) {
  const [copied, setCopied] = useState(false);
  const text = statements.join('\n');
  const copy = () => { Promise.resolve(navigator.clipboard?.writeText(text)).then(() => setCopied(true), () => {}); };
  return (
    <div data-access-request-copy={name} className="rounded-md bg-bg-subtle p-2 space-y-1">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">{text}</pre>
      <button type="button" onClick={copy} className="px-2 py-0.5 rounded-md text-xs font-semibold border border-border hover:border-border-strong">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

const noRequest = (why) => `No request was sent: ${why}`;

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
        setFailure(noRequest(String(body?.error || body?.reason || 'No answer.')));
      } else {
        setResults(rows);
        // An object is unpicked only when every one of its rows went: a refused row keeps it picked.
        const names = [...new Set(rows.map((r) => r.full_name))];
        onSent(names.filter((n) => rows.filter((r) => r.full_name === n).every((r) => r.sent)));
      }
    } catch (err) {
      setResults([]);
      setFailure(noRequest(splitTechnical(err?.message || String(err)).plain));
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
      {failure && <p className="text-xs text-error-fg">{failure}</p>}
      {results.map((r) => (
        <div key={`${r.full_name}|${r.for || 'person'}`} className="space-y-1">
          <p data-access-request-object={r.full_name} data-access-request-for={r.for || 'person'} className={`text-xs ${r.sent ? 'text-success-fg' : 'text-warning-fg'}`}>{lineOf(r)}</p>
          {!r.sent && Array.isArray(r.statements) && r.statements.length > 0 && <CopyBlock name={r.full_name} statements={r.statements} />}
        </div>
      ))}
    </div>
  );
}
