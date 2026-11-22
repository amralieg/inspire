import { VALUE_DISCLAIMER, VALUE_DISCLAIMER_SHORT } from '../lib/valueLabels';

// REQ-434: every surface that shows a calculated value carries this. `short` is the one-line form (the full text sits in its tooltip).
export default function ValueDisclaimer({ short = false, footer = false, className = '' }) {
  // REQ-481: the page footer, the full text in small grey at the end of a page that shows a calculated amount.
  if (footer) return <p data-value-footer="" role="note" className={`mt-6 text-[11px] leading-snug text-text-secondary ${className}`}>{VALUE_DISCLAIMER}</p>;
  if (short) {
    return <span data-value-disclaimer="" title={VALUE_DISCLAIMER} className={`text-[10px] text-text-tertiary ${className}`}>{VALUE_DISCLAIMER_SHORT}</span>;
  }
  return <p data-value-disclaimer="" role="note" className={`text-[11px] leading-snug text-text-secondary ${className}`}>{VALUE_DISCLAIMER}</p>;
}
