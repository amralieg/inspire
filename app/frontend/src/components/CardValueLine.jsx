import ValueBox, { boxModel } from './ValueBox';
import RoiBox from './value/RoiBox';

// REQ-432, REQ-438: the value box under or beside the Inspire score on a card (all states), and its read-only form for the details drawer.
export default function CardValueLine({ yearly = null, summary = null, canCalculate = false, onCalculate, onEdit, calculating = false }) {
  return <><ValueBox yearly={yearly} summary={summary} canCalculate={canCalculate} onCalculate={onCalculate} onEdit={onEdit} calculating={calculating} /><RoiBox yearly={yearly} /></>;
}

export function YearlyValueLine({ yearly, summary = null }) {
  const shows = ['calculated', 'estimated', 'stale', 'measured'].includes(boxModel({ yearly, summary }).state);
  return <div className="mt-2 pt-1"><div className="flex flex-wrap items-start gap-3"><ValueBox yearly={yearly} summary={summary} readOnly />{shows && <RoiBox yearly={yearly} />}</div></div>;
}
