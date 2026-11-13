import { valueEstimateOf } from '../lib/v130UseCase';

// REQ-078: the rule-based estimate from /api/inspire/value/estimates. Measured money is never shown as an estimate.
const amountText = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

function RuleEstimateLine({ estimate, className, onSetRule }) {
  const base = `text-xs leading-snug text-text-secondary ${className}`;
  if (estimate.status === 'estimated') {
    return (
      <p data-value-estimate="estimated" className={base}>
        <span className="font-medium text-text-primary">Estimated {amountText(estimate.amount)} {estimate.currency}</span>
        {` · estimated with ${estimate.app}'s money rule`}
      </p>
    );
  }
  if (estimate.status === 'set_rule') {
    return (
      <p data-value-estimate="set-rule" className={base}>
        Set a money rule to see its value.
        {onSetRule && <button type="button" className="lnk ms-2" onClick={onSetRule} data-value-set-rule="">Set a money rule</button>}
      </p>
    );
  }
  if (estimate.status === 'cannot') {
    return (
      <p data-value-estimate="cannot" className={base}>
        {`Cannot estimate yet: ${estimate.app}'s money rule values each record by ${estimate.method}. A fixed amount gives an estimate.`}
      </p>
    );
  }
  return (
    <p data-value-estimate="no-baseline" className={base}>
      No number yet: this use case has no KPI baseline from its App.
    </p>
  );
}

export function EstimateTotals({ totals, className = '' }) {
  const entries = Object.entries(totals?.estimated || {});
  if (!entries.length) return null;
  return (
    <p data-value-estimated-total="" className={`text-xs leading-snug text-text-secondary ${className}`}>
      {`Plus estimated, not measured: ${entries.map(([code, amount]) => `${amountText(amount)} ${code}`).join(', ')}`}
    </p>
  );
}

export default function ValueEstimateLine({ uc = null, estimate: given = null, className = '', onSetRule = null }) {
  if (given && given.status) return <RuleEstimateLine estimate={given} className={className} onSetRule={onSetRule} />;
  const estimate = given || valueEstimateOf(uc);
  if (!estimate) return null;
  return (
    <p data-value-estimate={estimate.measured ? 'measured' : 'not-measured'}
      className={`text-xs leading-snug ${estimate.measured ? 'font-semibold text-success-fg' : 'text-text-tertiary'} ${className}`}>
      {estimate.text}
    </p>
  );
}
