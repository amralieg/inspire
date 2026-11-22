import ValueBox, { boxModel } from './ValueBox';
import ValueDisclaimer from './ValueDisclaimer';

// REQ-432, REQ-438: the value box under or beside the Inspire score on a card (all states), and its read-only form for the details drawer.
export default function CardValueLine({ yearly = null, summary = null, canCalculate = false, onCalculate, onEdit }) {
  return <ValueBox yearly={yearly} summary={summary} canCalculate={canCalculate} onCalculate={onCalculate} onEdit={onEdit} />;
}

export function YearlyValueLine({ yearly, summary = null }) {
  const shows = ['calculated', 'estimated', 'stale', 'measured'].includes(boxModel({ yearly, summary }).state);
  // REQ-481: the drawer amount carries the short label as a visible caption (the box tooltip holds the full text).
  return <div className="mt-2 pt-1"><ValueBox yearly={yearly} summary={summary} readOnly />{shows && <ValueDisclaimer short className="mt-1 block" />}</div>;
}
