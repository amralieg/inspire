import { CheckCircle2 } from 'lucide-react';
import { belowBarLabelFromUseCase, meetsQualityBarOf } from '../lib/useCaseFields';

const CHIP = 'inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] px-2 py-0.5 rounded-md border shrink-0 leading-none';

export default function QualityBarChip({ uc }) {
  if (meetsQualityBarOf(uc) === true) {
    return (
      <span data-testid="quality-bar-chip" data-meets="yes" className={`${CHIP} text-success-fg border-success/35 bg-success-bg`}>
        <CheckCircle2 size={11} className="text-success-fg" />
        Meets your quality bar
      </span>
    );
  }
  const reason = belowBarLabelFromUseCase(uc);
  if (!reason) return null;
  return (
    <span data-testid="quality-bar-chip" data-meets="no" className={`${CHIP} text-warning-fg border-warning/35 bg-warning-bg`} title={reason}>
      Below your bar
    </span>
  );
}

export function QualityBarReason({ uc, className = '' }) {
  if (meetsQualityBarOf(uc) === true) return null;
  const reason = belowBarLabelFromUseCase(uc);
  if (!reason) return null;
  return (
    <p data-testid="quality-bar-reason" className={`text-xs text-warning-fg leading-snug ${className}`}>
      Why it is below your bar: {reason}
    </p>
  );
}
