import { VALUE_DISCLAIMER, VALUE_LABELS, yearlyBasis, yearlyHeadline } from '../lib/valueLabels';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-432: the value per year under the Inspire score: the verb, the number with "(estimated)", and the period. A use case with no
// value shows Calculate; a card with a value shows Edit value (REQ-435), which reopens the box with the saved answers. A failed save shows in the box.
const stop = (e) => e.stopPropagation();
const guard = { onClick: stop, onKeyDown: stop };
const link = 'text-[11px] font-semibold text-db-red-fg hover:underline underline-offset-2';

export default function CardValueLine({ yearly = null, canCalculate = false, onCalculate, onEdit }) {
  const head = yearly ? yearlyHeadline(yearly) : null;
  if (head) {
    return (
      <div data-value-yearly="" title={`${yearlyBasis(yearly)} ${VALUE_DISCLAIMER}`} {...guard} className="mt-1.5 flex max-w-[9.5rem] flex-col items-end text-end leading-tight">
        <span data-value-verb="" className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{yearly.verb}</span>
        <span data-value-amount="" className="text-[12px] font-bold tabular-nums text-text-primary">{head.text}</span>
        {head.more > 0 && <span className="text-[10px] text-text-tertiary">{`+${head.more} more`}</span>}
        <span data-value-period="" className="text-[10px] text-text-secondary">{yearly.period || VALUE_LABELS.perYear}</span>
        <ValueDisclaimer short />
        {onEdit && <button type="button" data-value-edit="" onClick={(e) => { e.stopPropagation(); onEdit(); }} onKeyDown={stop} className={`mt-0.5 ${link}`}>Edit value</button>}
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
