import { useEffect } from 'react';
import { X } from 'lucide-react';

// REQ-511 (A6): the reader. A row click opens the whole use case here, as the expanded card it always was, beside the list.
// The list stays usable under it; Close (or Esc) puts the list back.
export default function ReviewReader({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside data-review-reader="" aria-label="Use case reader"
      className="drawer-enter fixed inset-y-0 end-0 z-40 flex w-[min(40rem,94vw)] flex-col border-s border-border bg-bg shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
        <span className="text-caption font-semibold uppercase tracking-[0.18em] text-text-secondary">Use case</span>
        <button type="button" onClick={onClose} aria-label="Close the reader"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-subtle">
          <X size={14} aria-hidden />Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
