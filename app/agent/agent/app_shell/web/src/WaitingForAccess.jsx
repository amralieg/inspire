import { WAITING_FOR_ACCESS_TITLE } from './api.js';

export const WAITING_REASON = 'The App cannot read the tables this page uses yet, so its numbers and records stay empty until access is granted.';
export const WAITING_OWNER = 'your data owner';

export default function WaitingForAccess({ waiting, onCheck }) {
  const tables = waiting?.tables || [];
  return (
    <section className="card waiting-access" role="status" aria-label={WAITING_FOR_ACCESS_TITLE} data-waiting-for-access="">
      <h2>{WAITING_FOR_ACCESS_TITLE}</h2>
      <p>{WAITING_REASON} Ask {WAITING_OWNER} to grant it.</p>
      {tables.length > 0 && (
        <details data-waiting-details="">
          <summary>Details</summary>
          <ul aria-label="Tables the App cannot read">
            {tables.map((table) => <li key={table} className="mono">{table}</li>)}
          </ul>
          {waiting?.detail && <p className="mono">{String(waiting.detail)}</p>}
        </details>
      )}
      <button type="button" className="btn" onClick={onCheck} data-check-again="">Check again</button>
    </section>
  );
}
