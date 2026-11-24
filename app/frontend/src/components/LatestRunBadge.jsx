import { LATEST_RUN_LABEL, isLatestRun } from '../lib/reviewFigures';

export default function LatestRunBadge({ session, latest, className = '' }) {
  // `latest` (true or false) is the page's own answer; without it the badge falls back to the newest run of the run's business.
  if (!(latest ?? isLatestRun(session))) return null;
  return (
    <span
      data-latest-run=""
      title="The newest completed run, by its last update"
      className={`inline-flex shrink-0 items-center rounded-full border border-success/30 bg-success-bg px-2 py-0.5 text-caption font-semibold text-success-fg ${className}`}
    >
      {LATEST_RUN_LABEL}
    </span>
  );
}
