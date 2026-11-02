import { Target } from 'lucide-react';
import { PANEL_CLASS, SectionTitle } from './BuildUi';
import { RunScopeLine } from './RunScope';
import { impactText, kpiLine } from '../lib/targetKpi';

const NOTE_TONE = {
  warning: 'border-warning/40 bg-warning-bg text-warning-fg',
  error: 'border-error/30 bg-error-bg text-error-fg',
};

export const KPI_BUILT_BEFORE_READ_ONLY = 'No target KPI yet: this version was built before Inspire tracked one. The next version Inspire builds picks one.';
export const KPI_BUILT_BEFORE = KPI_BUILT_BEFORE_READ_ONLY.replace(/\.$/, ', or you pick it in Edit MVP.');

export function TargetKpiLine({ view }) {
  if (!view) return null;
  return <p data-kpi-line="" className={view.status === 'failed' ? 'text-error-fg' : 'text-text-secondary'}>{kpiLine(view)}</p>;
}

export default function TargetKpiCard({ view, builtBefore = false, readOnly = false, scope = null }) {
  if (!view && !builtBefore) return null;
  if (!view) {
    return (
      <section role="region" aria-label="Target KPI" data-kpi-status="none" className={PANEL_CLASS}>
        <SectionTitle icon={Target} title="Target KPI" />
        <p data-kpi-built-before="" className="px-4 py-3 text-[12px] text-text-secondary">{readOnly ? KPI_BUILT_BEFORE_READ_ONLY : KPI_BUILT_BEFORE}</p>
      </section>
    );
  }
  const facts = [
    ['Unit', view.unit || 'No unit', ''],
    ['Baseline', view.baseline, view.baselineOn],
    ['Latest', view.latest, view.latestOn],
    ['Target', view.target, ''],
    ['Direction', view.direction || 'Not set', ''],
  ];
  return (
    <section role="region" aria-label="Target KPI" data-kpi-status={view.status} className={PANEL_CLASS}>
      <SectionTitle icon={Target} title="Target KPI" hint={view.version == null ? 'Measured on every run of the notebook' : `Tracked since v${view.version}, measured on every run of the notebook`} />
      <div className="p-4 space-y-3 text-[12px]">
        <h4 className="text-[15px] font-semibold text-text-primary">Target KPI: {view.name}</h4>
        <RunScopeLine facts={scope} />
        {view.why && <p data-kpi-why="" className="text-text-secondary">{view.why}</p>}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {facts.map(([label, value, on]) => (
            <div key={label} data-kpi-fact="" className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{label}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-text-primary tabular-nums">
                {value}
                {on && <small className="block text-[11px] font-normal text-text-secondary">measured {on}</small>}
              </dd>
            </div>
          ))}
        </dl>
        {view.baselineFlag && (
          <p data-kpi-baseline-flag="" role="status" className={`rounded-lg border px-3 py-2 ${NOTE_TONE.warning}`}>{view.baselineFlag}</p>
        )}
        {view.note && (
          <p data-kpi-note="" data-tone={view.tone} role="status" className={`rounded-lg border px-3 py-2 ${NOTE_TONE[view.tone] || NOTE_TONE.warning}`}>{view.note}</p>
        )}
        {view.impact && <p data-kpi-impact="" className="text-text-secondary">{impactText(view.impact)}</p>}
      </div>
    </section>
  );
}
