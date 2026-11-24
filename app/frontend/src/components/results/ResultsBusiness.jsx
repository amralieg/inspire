import { AlertCircle, Boxes, Building2, CheckCircle2, ChevronRight, FileText, Layers, LayoutGrid, Loader2, ShieldAlert, Sparkles, Star, Target, Wrench } from 'lucide-react';
import { DataAccessBadge, InsightsGrid } from '../../components/ResultsInsights';
import GlassCard from '../../components/GlassCard';
import { RunValuePanel } from '../../components/ValueTotalsPanel';
import { displayCleanText, nameOfUseCase, trackingIdOf } from '../../lib/useCaseFields';
import { mvpCounts } from '../../lib/implementWizard';
import ValueMap from './ValueMap';

const MVP_TILES = [
  { id: 'has', label: 'MVPs started', icon: Layers },
  { id: 'live', label: 'MVPs live', icon: CheckCircle2 },
  { id: 'building', label: 'Building', icon: Loader2 },
  { id: 'held', label: 'Vibes not met', icon: ShieldAlert },
  { id: 'failed', label: 'Failed', icon: AlertCircle },
  { id: 'none', label: 'No MVP yet', icon: FileText },
];

function MvpTiles({ counts, active, onPick }) {
  return (
    <div role="group" aria-label="MVPs" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {MVP_TILES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          aria-label={`${label}: ${counts[id]}`}
          title={active === id ? 'Show every use case' : `Show only: ${label}`}
          onClick={() => onPick(id)}
          className={`text-start rounded-xl border p-3 transition-smooth ${
            active === id ? 'border-db-red/40 bg-db-red-50' : 'border-border bg-surface hover:border-db-red/25'
          }`}
        >
          <span className="flex items-center gap-2 mb-1 text-caption font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            <Icon size={14} className="text-db-red-fg" />
            {label}
          </span>
          <span className="block text-2xl font-bold text-text-primary tabular-nums tracking-tight">{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, renderValue }) {
  return (
    <GlassCard tilt className="p-4" data-stat={label}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-db-red/10 ring-1 ring-inset ring-db-red/15">
          <Icon size={14} className="text-db-red-fg" />
        </div>
        <span className="text-caption font-semibold uppercase tracking-[0.18em] text-text-tertiary">{label}</span>
      </div>
      <div data-stat-value="" className="text-2xl font-bold text-text-primary tabular-nums tracking-tight">
        {renderValue != null ? renderValue : Number(value) || 0}
      </div>
    </GlassCard>
  );
}

/** The Business view of Results: the run's value at stake, the executive summary, the figure tiles, the MVPs group and the insights. Moved from ResultsPage. */
export default function ResultsBusiness({
  allUseCases, avgInspireScore, describeUseCase, domains, domainsSummary, feedbackState, filterMvp, hasMvpData, highPriorityCount, mvpStateOf, noneMeetsBar, onRunValueRow, onShowUseCases, openUseCase, results, selectedFigures, setFilterMvp, showRunValue, starredCount, summaryParagraphs, techniqueCount, uniqueSubdomainCount, v130Session, valueTotals,
}) {
  return (
    <>
        {showRunValue && results && valueTotals?.run && (
          <RunValuePanel run={valueTotals.run} useCases={valueTotals.use_cases}
            nameOf={(id) => { const u = allUseCases.find((x) => trackingIdOf(x) === id); return u ? nameOfUseCase(u) : id; }} onRow={onRunValueRow} />
        )}

        {allUseCases.length > 0 && <ValueMap useCases={allUseCases} valueTotals={valueTotals} openUseCase={openUseCase} onRunValueRow={onRunValueRow} />}

            {(summaryParagraphs.length > 0 || domainsSummary) && (
            <div
              id="executive-summary"
              data-executive-summary=""
              className="bg-surface border border-border/70 rounded-xl overflow-hidden mb-4 shadow-elevated scroll-mt-20"
            >
              <div className="flex items-center gap-2 border-b border-border bg-linear-to-r from-db-red-50/90 to-surface px-4 py-3 sm:px-6">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-db-red/10 ring-1 ring-inset ring-db-red/20">
                  <FileText size={14} className="text-db-red-fg" strokeWidth={2} />
                </div>
                <h2 className="text-caption font-semibold uppercase tracking-[0.18em] text-db-red-fg">
                  Executive summary
                </h2>
              </div>
              <div className="px-4 py-4 sm:px-6 sm:py-4 space-y-3">
                {summaryParagraphs.map((text, i) => (
                  <p key={i} className="text-sm leading-relaxed text-text-secondary sm:text-base">{text}</p>
                ))}
                {(() => {
                  const domRaw = domainsSummary;
                  if (!domRaw) return null;
                  return (
                    <details className="mt-3 border-t border-border pt-3 group">
                      <summary className="cursor-pointer list-none text-caption font-semibold uppercase tracking-[0.18em] text-text-tertiary transition-colors hover:text-db-red-fg [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <ChevronRight
                          size={14}
                          className="shrink-0 text-text-tertiary transition-transform duration-200 group-open:rotate-90"
                          aria-hidden
                        />
                        Domain overview
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-text-tertiary">
                        {displayCleanText(domRaw)}
                      </p>
                    </details>
                  );
                })()}
              </div>
            </div>
            )}

            {/* Stats */}
            <section aria-label="Figures of this run" className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard label="Use Cases" value={allUseCases.length} icon={FileText} />
              <StatCard label="Domains" value={domains.length} icon={Building2} />
              <StatCard label="Subdomains" value={uniqueSubdomainCount} icon={LayoutGrid} />
              <StatCard label="Best of Best" value={starredCount} icon={Star} />
              <StatCard
                label="High Priority"
                value={highPriorityCount}
                icon={Target}
                renderValue={noneMeetsBar ? 'n/a' : undefined}
              />
              <StatCard label="Techniques" value={techniqueCount} icon={Wrench} />
              <StatCard
                label="Avg Inspire score"
                value={0}
                icon={Sparkles}
                renderValue={avgInspireScore != null ? avgInspireScore.toFixed(1) : 'n/a'}
              />
              <StatCard
                label="Live assets"
                value={selectedFigures?.live_assets ?? 0}
                icon={Boxes}
                renderValue={selectedFigures?.live_assets == null ? 'n/a' : undefined}
              />
            </section>
            {hasMvpData && (
              <MvpTiles
                counts={mvpCounts(allUseCases.map(mvpStateOf))}
                active={filterMvp}
                onPick={(id) => { setFilterMvp(filterMvp === id ? 'all' : id); onShowUseCases(); }}
              />
            )}


            {v130Session && (
              <>
                <DataAccessBadge results={results} />
                <InsightsGrid
                  results={results}
                  feedback={feedbackState}
                  describe={describeUseCase}
                  onOpenUseCase={openUseCase}
                />
              </>
            )}
    </>
  );
}
