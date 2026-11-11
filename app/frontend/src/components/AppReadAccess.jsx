import TechnicalDetails, { PlainMessage } from './TechnicalDetails';
import { APP_READ_ACTION } from '../lib/implementWizard';

export function GrantList({ label, items }) {
  if (!items?.length) return null;
  return (
    <ul aria-label={label} className="space-y-0.5">
      {items.map((sql) => <li key={sql} className="font-mono text-[11px] text-text-primary break-all">{sql}</li>)}
    </ul>
  );
}

export function AppReadAccess({ offer, result, busy, onGrant }) {
  return (
    <section aria-label="App read access" data-app-read="" className="space-y-1.5 text-[11px] bg-bg border border-border rounded-md px-3 py-2">
      {offer && <PlainMessage text={offer.text} className="text-text-secondary" />}
      {offer?.can_grant && (
        <button type="button" disabled={busy} onClick={onGrant}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-db-red-solid disabled:opacity-70">
          {busy ? 'Granting with your sign-in' : APP_READ_ACTION}
        </button>
      )}
      {offer?.grants?.length > 0 && <TechnicalDetails items={offer.grants} />}
      {result && (
        <div role="status" aria-label="Grant result" className="space-y-1">
          {result.error ? <PlainMessage text={`Your grant was refused: ${result.error}`} onRetry={offer?.can_grant ? onGrant : null} copy className="text-text-secondary" /> : <p className="text-text-secondary">{result.text}</p>}
          {(result.ran?.length > 0 || result.failed?.length > 0) && (
            <TechnicalDetails items={[...(result.ran || []).map((sql) => `Ran: ${sql}`), ...(result.failed || []).map((sql) => `Failed: ${sql}`)]} />
          )}
        </div>
      )}
    </section>
  );
}
