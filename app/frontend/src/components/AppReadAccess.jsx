import { useEffect } from 'react';
import TechnicalDetails, { PlainMessage } from './TechnicalDetails';
import { APP_READ_ACTION, grantFailurePermissions } from '../lib/implementWizard';
import { raisePermissions } from '../lib/permissionBus';

export function GrantList({ label, items }) {
  if (!items?.length) return null;
  return (
    <ul aria-label={label} className="space-y-0.5">
      {items.map((sql) => <li key={sql} className="font-mono text-caption text-text-primary break-all">{sql}</li>)}
    </ul>
  );
}

export function AppReadAccess({ offer, result, busy, onGrant }) {
  // REQ-131, REQ-260: the exact GRANT statements open in the Permission Required dialog; the panel keeps plain words.
  useEffect(() => {
    if (offer?.permissions?.length) raisePermissions(offer.permissions);
  }, [offer]);
  useEffect(() => {
    if (result?.failed?.length) raisePermissions(grantFailurePermissions(result));
  }, [result]);
  return (
    <section aria-label="App read access" data-app-read="" className="space-y-1.5 text-caption bg-bg border border-border rounded-md px-3 py-2">
      {offer && <PlainMessage text={offer.text} className="text-text-secondary" />}
      {offer?.can_grant && (
        <button type="button" disabled={busy} onClick={onGrant}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary-solid disabled:opacity-70">
          {busy ? 'Granting with your sign-in' : APP_READ_ACTION}
        </button>
      )}
      {result && (
        <div role="status" aria-label="Grant result" className="space-y-1">
          {result.error ? <PlainMessage text={`Your grant was refused: ${result.error}`} onRetry={offer?.can_grant ? onGrant : null} copy className="text-text-secondary" /> : <p className="text-text-secondary">{result.text}</p>}
          {(result.ran?.length > 0 || result.failed?.length > 0) && (
            <p className="text-text-secondary">
              {`Granted ${result.ran?.length || 0}, failed ${result.failed?.length || 0}.`}{result.failed?.length > 0 ? ' The failed commands are in Permission Required.' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
