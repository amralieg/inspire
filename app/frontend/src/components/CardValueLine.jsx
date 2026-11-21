import { VALUE_DISCLAIMER, VALUE_LABELS, yearlyBasis, yearlyHeadline } from '../lib/valueLabels';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-432: the value per year under the Inspire score: the verb, the number with "(estimated)", and the period. A use case with no
// value shows Calculate; calculating shows a busy line; a failure shows one line of why with Retry (never 0 and never blank).
const stop = (e) => e.stopPropagation();
const guard = { onClick: stop, onKeyDown: stop };
const link = 'text-[11px] font-semibold text-db-red-fg hover:underline underline-offset-2';

export default function CardValueLine({ yearly = null, calc = null, canCalculate = false, onCalculate, onRetry }) {
  const head = yearly ? yearlyHeadline(yearly) : null;
  if (head) {
    return (
      <div data-value-yearly="" title={`${yearlyBasis(yearly)} ${VALUE_DISCLAIMER}`} {...guard} className="mt-1.5 flex max-w-[9.5rem] flex-col items-end text-end leading-tight">
        <span data-value-verb="" className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{yearly.verb}</span>
        <span data-value-amount="" className="text-[12px] font-bold tabular-nums text-text-primary">{head.text}</span>
        {head.more > 0 && <span className="text-[10px] text-text-tertiary">{`+${head.more} more`}</span>}
        <span data-value-period="" className="text-[10px] text-text-secondary">{yearly.period || VALUE_LABELS.perYear}</span>
        <ValueDisclaimer short />
      </div>
    );
  }
  if (calc?.status === 'busy') {
    return <p data-value-busy="" role="status" {...guard} className="mt-1.5 text-end text-[11px] text-text-secondary">{`${VALUE_LABELS.calculating}...`}</p>;
  }
  if (calc?.status === 'failed') {
    return (
      <div data-value-failed="" role="alert" {...guard} className="mt-1.5 flex max-w-[9.5rem] flex-col items-end text-end text-[11px] leading-snug text-error-fg">
        <span dir="auto" className="break-words">{calc.error}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onRetry?.(); }} className={link}>{VALUE_LABELS.retry}</button>
      </div>
    );
  }
  if (!canCalculate) return null;
  return (
    <button type="button" data-value-calculate="" onClick={(e) => { e.stopPropagation(); onCalculate?.(); }} onKeyDown={stop}
      className={`mt-1.5 ${link}`}>{VALUE_LABELS.calculate}</button>
  );
}

// The same line, read only, for the details drawer next to its Inspire score tile.
export function YearlyValueLine({ yearly }) {
  const head = yearly ? yearlyHeadline(yearly) : null;
  if (!head) return null;
  return (
    <p data-value-yearly="" title={`${yearlyBasis(yearly)} ${VALUE_DISCLAIMER}`} className="mt-2 text-[12px] text-text-primary">
      <span data-value-verb="" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{yearly.verb}</span>{' '}
      <span data-value-amount="" className="font-bold tabular-nums">{head.text}</span>{' '}
      <span data-value-period="" className="text-text-secondary">{yearly.period || VALUE_LABELS.perYear}</span>
      <ValueDisclaimer className="mt-1" />
    </p>
  );
}
