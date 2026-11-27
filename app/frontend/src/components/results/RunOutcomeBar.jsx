import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { displayCleanText } from '../../lib/useCaseFields';
import { nextStepOf } from '../../lib/runOutcome';
import { qualityBarCountText } from '../../lib/qualityBarWording';

/** How the run ended (the outcome strip), shown at the top of Overview. Moved unchanged from the Assets view, which is gone (C28, REQ-568). */
export default function RunOutcomeBar({ isProgressive, runOutcome, qualityBarCounts, noneMeetsBar, reviewBarStages }) {
  return (
    <>
    {!isProgressive && (
      <div className="bg-surface border border-border/70 rounded-xl overflow-hidden mb-4 shadow-elevated">
        <div className="px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3" data-testid="execution-complete" data-status={runOutcome.failed ? 'failed' : runOutcome.warning ? 'warning' : 'success'} data-failure={runOutcome.failureKind || undefined}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${runOutcome.failed ? 'bg-error/10 ring-error/20' : runOutcome.warning ? 'bg-warning/10 ring-warning/20' : 'bg-success/10 ring-success/20'}`}>
                {runOutcome.failed
                  ? <XCircle size={14} className="text-error-fg" />
                  : runOutcome.warning
                    ? <AlertTriangle size={14} className="text-warning-fg" />
                    : <CheckCircle2 size={14} className="text-success-fg" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary tracking-tight">
                  {runOutcome.failed ? runOutcome.failureTitle : runOutcome.warning ? 'Run finished, with a warning' : 'Run finished'}
                </h3>
                {runOutcome.failed
                  ? <p className="text-caption text-error-fg" data-testid="execution-failure">{displayCleanText(runOutcome.message)}</p>
                  : (runOutcome.missingDocuments.length > 0 || runOutcome.unfinishedSteps.length > 0)
                    ? (
                      <>
                        {runOutcome.missingDocuments.length > 0 && (
                          <ul className="text-caption text-warning-fg" data-testid="missing-documents" aria-label="Documents the run did not write">
                            {runOutcome.missingDocuments.map((line) => <li key={line} dir="auto">{line}</li>)}
                            <li className="text-text-secondary">Open the run log to see why.</li>
                          </ul>
                        )}
                        {runOutcome.unfinishedSteps.length > 0 && (
                          <ul className="text-caption text-warning-fg" data-testid="unfinished-steps" aria-label="Steps the run did not finish">
                            {runOutcome.unfinishedSteps.map((line) => <li key={line} dir="auto">{line}</li>)}
                          </ul>
                        )}
                      </>
                    )
                    : <p className="text-caption text-text-secondary">Every step of the run finished.</p>}
                {qualityBarCounts.found > 0 && (
                  <p className="text-caption text-text-secondary mt-0.5" data-testid="quality-bar-counts">
                    {qualityBarCountText(qualityBarCounts.found, qualityBarCounts.meets, runOutcome.mode)}
                  </p>
                )}
                {noneMeetsBar && !runOutcome.failed && (
                  <p className="text-caption font-semibold text-text-primary mt-1" data-testid="quality-bar-next-step">
                    Next step: {nextStepOf(runOutcome)}
                  </p>
                )}
                {!runOutcome.failed && (runOutcome.barMessage || runOutcome.notes.length > 0) && (
                  <p className="text-caption text-warning-fg mt-0.5" data-testid="execution-outcome">
                    {displayCleanText(runOutcome.barMessage || runOutcome.notes[0])}
                  </p>
                )}
              </div>
            </div>
          </div>
          {/* Pipeline stages row */}
          <div className="flex flex-wrap items-center gap-y-1 gap-1 pt-2 border-t border-border">
            {reviewBarStages.map((stage, i) => (
              <div key={stage} className="flex items-center shrink-0">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-neutral-bg">
                  <span className="text-caption font-medium text-neutral-fg whitespace-nowrap">{stage}</span>
                </div>
                {i < reviewBarStages.length - 1 && (
                  <span className="text-text-tertiary text-caption mx-1 shrink-0">&rarr;</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
