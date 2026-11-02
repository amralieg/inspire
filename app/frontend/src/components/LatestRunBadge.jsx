import { LATEST_RUN_LABEL, isLatestRun } from '../lib/reviewFigures';

export default function LatestRunBadge({ session, className = '' }) {
  if (!isLatestRun(session)) return null;
  return (
    <span
      data-latest-run=""
      title="The newest run of this business, by its last update"
      className={`inline-flex shrink-0 items-center rounded-full border border-success/30 bg-success-bg px-2 py-0.5 text-[10px] font-semibold text-success-fg ${className}`}
    >
      {LATEST_RUN_LABEL}
    </span>
  );
}
