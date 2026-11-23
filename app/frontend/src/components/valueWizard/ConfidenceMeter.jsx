// REQ-495: how much of this value the user stands behind (the share set on the last page), as a meter with the percent.
export default function ConfidenceMeter({ pct }) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const v = Math.min(100, Math.max(0, n));
  const tone = v >= 70 ? 'bg-ok' : v >= 40 ? 'bg-warning' : 'bg-error';
  return (
    <section data-confidence-meter="" className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-1.5">
      <h4 className="shrink-0 text-[12px] font-semibold text-text-primary">Your confidence in this value</h4>
      <div role="meter" aria-label="Your confidence in this value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-subtle">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="shrink-0 text-base font-extrabold tabular-nums text-text-primary">{Math.round(v)}%</span>
    </section>
  );
}
