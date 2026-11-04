import { valueEstimateOf } from '../lib/v130UseCase';

export default function ValueEstimateLine({ uc = null, estimate: given = null, className = '' }) {
  const estimate = given || valueEstimateOf(uc);
  if (!estimate) return null;
  return (
    <p data-value-estimate={estimate.measured ? 'measured' : 'not-measured'}
      className={`text-xs leading-snug ${estimate.measured ? 'font-semibold text-success-fg' : 'text-text-tertiary'} ${className}`}>
      {estimate.text}
    </p>
  );
}
