// REQ-495: how much of this value the user stands behind (the share set on the last page), as a meter with the percent.
export default function ConfidenceMeter({ pct }) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const v = Math.min(100, Math.max(0, n));
  const tone = v >= 70 ? 'bg-ok' : v >= 40 ? 'bg-warning' : 'bg-error';
  return (
    <section data-confidence-meter="" className="min-w-0 space-y-1 rounded-lg border border-border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[12px] font-semibold text-text-primary">Your confidence in this value</h4>
        <span className="text-lg font-extrabold tabular-nums text-text-primary">{Math.round(v)}%</span>
      </div>
      <div role="meter" aria-label="Your confidence in this value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-3 overflow-hidden rounded-full bg-bg-subtle">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </section>
  );
}
