import { useMemo } from 'react';
import ModalDialog from '../ModalDialog';
import { formatDuration } from '../../lib/formatWhen';

// REQ-511 Monitor C (F186): how long each stage took, from the first and last time its steps were saved.
export function stageDurationsOf(steps) {
  const spans = new Map();
  for (const s of Array.isArray(steps) ? steps : []) {
    const at = Date.parse(s.last_updated);
    if (Number.isNaN(at)) continue;
    const name = s.stage_name || 'Pipeline';
    const span = spans.get(name) || { first: at, last: at };
    spans.set(name, { first: Math.min(span.first, at), last: Math.max(span.last, at) });
  }
  return [...spans.entries()].sort((a, b) => a[1].first - b[1].first).map(([name, span]) => ({ name, ms: span.last - span.first }));
}

export default function StageDurationsDialog({ steps, elapsed, onClose }) {
  const rows = useMemo(() => stageDurationsOf(steps), [steps]);
  return (
    <ModalDialog titleId="stage-durations-title" title="Stage durations" onClose={onClose} widthClass="max-w-md">
      {elapsed && <p className="text-sm text-text-secondary">The whole run: <span className="font-medium text-text-primary tabular-nums">{elapsed}</span></p>}
      {rows.length === 0 ? <p className="text-sm text-text-secondary">No stage has saved a step yet.</p> : (
        <ul role="list" className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-text-primary">{r.name}</span>
              <span className="shrink-0 tabular-nums text-text-secondary">{r.ms > 0 ? formatDuration(r.ms) : 'under a second'}</span>
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}
