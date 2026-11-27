import { AlertTriangle } from 'lucide-react';
import { VALUE_DISCLAIMER } from '../lib/valueLabels';

// REQ-489: the warning icon sits right before the disclaimer text, so no place shows the words without it.
// REQ-576: a page that shows a business value renders this once, near the top, above its first value, and nowhere else.
export default function ValueDisclaimer({ className = '' }) {
  return (
    <div className={`flex items-start gap-1 ${className}`}>
      <AlertTriangle aria-label="Warning" role="img" size={14} className="mt-px shrink-0 text-warning-fg" />
      <p data-value-disclaimer="" role="note" className="max-w-[80ch] text-caption leading-snug text-text-secondary">{VALUE_DISCLAIMER}</p>
    </div>
  );
}
