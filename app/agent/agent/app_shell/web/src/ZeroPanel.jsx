import { AskGenie } from './AskGenie.jsx';
import { ZERO_TITLE } from './zeroState.js';

export function ZeroPanel({ rule = '', lastRefresh = '', cutoff = '', checked = '' }) {
  return (
    <section className="card zero-panel" aria-label="Nothing found" data-zero-state="" style={{ gridColumn: '1 / -1' }}>
      <header className="card-h">
        <div>
          <h2>{ZERO_TITLE}</h2>
          {rule && <p data-zero-rule="">{rule}</p>}
        </div>
        <AskGenie kind="text" title={ZERO_TITLE} context={{ hint: [ZERO_TITLE, rule].filter(Boolean).join('. ') }} />
      </header>
      {checked && <p className="note" data-zero-checked="">{checked}</p>}
      {cutoff && <p className="note" data-cutoff="">{cutoff}</p>}
      <p className="note" data-zero-refresh="">Last refresh {lastRefresh || 'is not recorded yet'}</p>
    </section>
  );
}
