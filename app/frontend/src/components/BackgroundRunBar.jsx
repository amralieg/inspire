import { Loader2 } from 'lucide-react';

const btn = 'rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';

// REQ-443, REQ-525: the line above the page while a background run's dialog is hidden: live text, a meter, Open, and Stop (running) or Dismiss (finished).
// The value run and the documents run both draw it; each passes its own data attributes and wording.
export default function BackgroundRunBar({ barAttrs, textAttrs, running, text, meterLabel, done, total, onOpen, onStop, onDismiss }) {
  return (
    <div {...barAttrs} className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
      <span {...textAttrs} aria-live="polite" className="font-semibold text-text-primary">{running && <Loader2 size={14} className="me-1.5 inline motion-safe:animate-spin" aria-hidden />}{text}</span>
      <div role="progressbar" aria-label={meterLabel} aria-valuemin={0} aria-valuenow={done} aria-valuemax={total}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full bg-primary-solid text-white" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <button type="button" onClick={onOpen} className={btn}>Open</button>
      {running ? <button type="button" onClick={onStop} className={btn}>Stop</button> : <button type="button" onClick={onDismiss} className={btn}>Dismiss</button>}
    </div>
  );
}
