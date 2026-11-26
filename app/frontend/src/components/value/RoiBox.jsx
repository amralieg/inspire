import { BOX, ROW_BOX } from '../ValueBox';
import { VALUE_DISCLAIMER } from '../../lib/valueLabels';

// C24 (P247): "ROI (3 yr)" beside the value box, the same size. The number is the server's projection (roi_3y, a ratio: 1.5 reads 150%); no formula here.
// REQ-481: it carries the same disclaimer as the value box. Nothing is shown when there is no value or the projection has no cost to return against.
export const roiOf = (yearly) => {
  const r = yearly?.projection?.roi_3y;
  return r === null || r === undefined || r === '' || !Number.isFinite(Number(r)) ? null : Number(r);
};
export default function RoiBox({ yearly = null, inset = false }) {
  const roi = roiOf(yearly);
  if (roi === null) return null;
  return (
    <div data-roi-box="" title={VALUE_DISCLAIMER} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      className={`${inset ? ROW_BOX : BOX} border-border bg-surface text-text-primary`}>
      <span className="text-caption font-semibold uppercase tracking-wide text-text-secondary">ROI (3 yr)</span>
      <span data-roi-amount="" className="text-[22px] leading-6 font-extrabold tabular-nums">{`${Math.round(roi * 100).toLocaleString('en-US')}%`}</span>
      <span className="text-caption text-text-secondary">After cost</span>
    </div>
  );
}
