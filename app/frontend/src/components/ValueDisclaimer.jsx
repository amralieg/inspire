import { AlertTriangle } from 'lucide-react';
import { VALUE_DISCLAIMER, VALUE_DISCLAIMER_SHORT } from '../lib/valueLabels';

// REQ-489: the warning icon sits right before every disclaimer text, so no place shows the words without it.
const Warn = () => <AlertTriangle aria-label="Warning" role="img" size={12} className="mt-px shrink-0 text-warning-fg" />;

// REQ-434: every surface that shows a calculated value carries this. `short` is the one-line form (the full text sits in its tooltip).
export default function ValueDisclaimer({ short = false, footer = false, className = '' }) {
  // REQ-481: the page footer, the full text in small grey at the end of a page that shows a calculated amount.
  if (footer) {
    return (
      <div className={`mt-6 flex items-start gap-1 ${className}`}>
        <Warn />
        <p data-value-footer="" role="note" className="text-[11px] leading-snug text-text-secondary">{VALUE_DISCLAIMER}</p>
      </div>
    );
  }
  if (short) {
    return (
      <span className={`inline-flex items-center gap-1 align-middle ${className}`}>
        <Warn />
        <span data-value-disclaimer="" title={VALUE_DISCLAIMER} className="text-[10px] text-text-tertiary">{VALUE_DISCLAIMER_SHORT}</span>
      </span>
    );
  }
  return (
    <div className={`flex items-start gap-1 ${className}`}>
      <Warn />
      <p data-value-disclaimer="" role="note" className="text-[11px] leading-snug text-text-secondary">{VALUE_DISCLAIMER}</p>
    </div>
  );
}
