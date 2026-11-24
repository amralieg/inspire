import { AlertTriangle, Check, Circle, Loader2, Minus, X } from 'lucide-react';
import { RUN_PHASES, runPhasesOf } from '../lib/runPhases';

// REQ-508 L3: the one run stepper (Monitor and Review). Colour is success only for done, danger for failed, neutral for todo and skipped.
const WORDS = { todo: 'not started', active: 'running', done: 'done', warning: 'done with warnings', error: 'failed', skipped: 'skipped' };
const TONE = {
  todo: 'text-text-tertiary', active: 'text-info-fg', done: 'text-success-fg', warning: 'text-warning-fg', error: 'text-error-fg', skipped: 'text-text-tertiary',
};
const ICON = { todo: Circle, active: Loader2, done: Check, warning: AlertTriangle, error: X, skipped: Minus };

function Step({ phase, column }) {
  const Icon = ICON[phase.state];
  return (
    <li data-run-step={phase.key} data-run-step-column={column} data-state={phase.state} aria-label={`${phase.label}: ${WORDS[phase.state]}`}
      className="flex items-center gap-2 min-w-0">
      <Icon size={14} aria-hidden="true" className={`shrink-0 ${TONE[phase.state]} ${phase.state === 'active' ? 'animate-spin' : ''}`} />
      <span className={`text-xs ${phase.state === 'todo' || phase.state === 'skipped' ? 'text-text-tertiary' : 'text-text-primary font-medium'}`}>
        {phase.label}
      </span>
      {phase.state === 'skipped' && <span className="text-caption text-text-tertiary">(skipped)</span>}
    </li>
  );
}

export default function RunStepper({ steps, ended = false, failed = false }) {
  const phases = runPhasesOf(steps, { ended, failed });
  const columns = [...new Set(RUN_PHASES.map((p) => p.column))];
  return (
    <ol role="list" data-run-stepper="" aria-label="Run steps"
      className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-2 lg:grid-cols-7">
      {columns.map((col) => {
        const inCol = phases.filter((p) => p.column === col);
        return inCol.length > 1 ? (
          <li key={col} role="presentation" data-run-step-column={col} className="min-w-0">
            <ul role="list" className="space-y-2">{inCol.map((p) => <Step key={p.key} phase={p} />)}</ul>
          </li>
        ) : <Step key={col} phase={inCol[0]} column={col} />;
      })}
    </ol>
  );
}
