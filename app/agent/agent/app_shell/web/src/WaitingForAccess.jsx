import { useEffect } from 'react';
import { WAITING_FOR_ACCESS_TITLE } from './api.js';
import { ACCESS_CHECKED, AccessActions } from './ui.jsx';

export const WAITING_REASON = 'The App cannot read the tables this page uses yet, so its numbers and records stay empty until access is granted.';
export const WAITING_OWNER = 'your data owner';

export default function WaitingForAccess({ waiting, onCheck, compact = false }) {
  const tables = waiting?.tables || [];
  const owner = waiting?.owners?.length ? waiting.owners.join(' or ') : WAITING_OWNER;
  useEffect(() => {
    if (!onCheck) return undefined;
    const again = () => onCheck();
    window.addEventListener(ACCESS_CHECKED, again);
    return () => window.removeEventListener(ACCESS_CHECKED, again);
  }, [onCheck]);
  const actions = <AccessActions />;
  if (compact) {
    return (
      <div className="waiting-access waiting-access--compact tile-err" role="status" aria-label={WAITING_FOR_ACCESS_TITLE} data-waiting-for-access="" data-waiting-compact="">
        <p>{WAITING_REASON} Ask {owner} to grant it.</p>
        {actions}
      </div>
    );
  }
  return (
    <section className="card waiting-access" role="status" aria-label={WAITING_FOR_ACCESS_TITLE} data-waiting-for-access="">
      <h2>{WAITING_FOR_ACCESS_TITLE}</h2>
      <p>{WAITING_REASON} Ask {owner} to grant it.</p>
      {tables.length > 0 && (
        <details data-waiting-details="">
          <summary>Details</summary>
          <ul aria-label="Tables the App cannot read">
            {tables.map((table) => <li key={table} className="mono">{table}</li>)}
          </ul>
          {waiting?.detail && <p className="mono">{String(waiting.detail)}</p>}
        </details>
      )}
      {actions}
    </section>
  );
}
