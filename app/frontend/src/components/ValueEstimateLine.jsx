import { valueEstimateOf } from '../lib/v130UseCase';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-078: the rule-based estimate from /api/inspire/value/estimates. Measured money is never shown as an estimate.
const amountText = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

function RuleEstimateLine({ estimate, className, onSetRule }) {
  const base = `text-xs leading-snug text-text-secondary ${className}`;
  if (estimate.status === 'estimated') {
    return (
      <p data-value-estimate="estimated" className={base}>
        <span className="font-medium text-text-primary">Estimated {amountText(estimate.amount)} {estimate.currency}</span>
        {` · estimated with ${estimate.app}'s money rule `}
        <ValueDisclaimer short />
      </p>
    );
  }
  if (estimate.status === 'set_rule') {
    return (
      <p data-value-estimate="set-rule" className={base}>
        Set a money rule to see the value at stake.
        {onSetRule && <button type="button" className="lnk ms-2" onClick={onSetRule} data-value-set-rule="">Set rule</button>}
      </p>
    );
  }
  if (estimate.status === 'cannot') {
    return (
      <p data-value-estimate="cannot" className={base}>
        {estimate.borrowed
          ? `Cannot estimate yet: this use case has no money rule of its own. It borrows ${estimate.app}'s money rule, which values each record by ${estimate.method}. Set a fixed amount, or this use case's own money rule, to estimate.`
          : `Cannot estimate yet: this use case's money rule values each record by ${estimate.method}. Set a fixed amount to estimate.`}
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
      {`Plus estimated, not measured: ${entries.map(([code, amount]) => `${amountText(amount)} ${code}`).join(', ')} `}
      <ValueDisclaimer short />
    </p>
  );
}

export default function ValueEstimateLine({ uc = null, estimate: given = null, className = '', onSetRule = null }) {
  const own = valueEstimateOf(uc);
  // A measured figure is the figure: a rule estimate never replaces it (REQ-078).
  if (given && given.status && !own?.measured) return <RuleEstimateLine estimate={given} className={className} onSetRule={onSetRule} />;
  const estimate = own?.measured ? own : (given || own);
  if (!estimate) return null;
  const line = (
    <p data-value-estimate={estimate.measured ? 'measured' : 'not-measured'}
      className={`text-xs leading-snug ${estimate.measured ? 'font-semibold text-success-fg' : 'text-text-tertiary'} ${className}`}>
      {estimate.text}
    </p>
  );
  return estimate.measured ? <>{line}<ValueDisclaimer short className="block" /></> : line;
}
