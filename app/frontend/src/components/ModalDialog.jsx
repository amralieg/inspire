import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { useModal } from './useModal';

// The scrim colour as black at 40% in hwb(): Tailwind's bg-black/40 compiles to color-mix, which the browser reports as oklab, so the
// class names the intent and this keeps the computed colour a stable black at 40% alpha.
export const SCRIM_STYLE = { backgroundColor: 'hwb(0 0% 100% / 0.4)' };

// The one centered modal dialog, on the one overlay layer (z-overlay over a black/40 scrim). Escape closes it, the header with its
// Close button stays in view while the body scrolls, and the behaviour comes from useModal.
// `header` replaces the default title bar, `bare` hands the body to the caller's own layout, and `dismissible={false}` drops the
// Close button (a cover that the person cannot dismiss).
export default function ModalDialog({ titleId, title, onClose, overlayAttrs = {}, dialogAttrs = {},
  widthClass = 'max-w-lg', footer = null, header = null, bare = false, dismissible = true, children }) {
  const panel = useRef(null);
  useModal(panel, onClose);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/40 p-4" style={SCRIM_STYLE} {...overlayAttrs}>
        <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} {...dialogAttrs}
          className={`flex max-h-[calc(100dvh-2rem)] w-full ${widthClass} flex-col rounded-lg border border-border bg-surface shadow-e3 outline-none dialog-enter`}>
          {header || (
            <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 pt-5 pb-3">
              <h2 id={titleId} className="min-w-0 flex-1 text-base font-bold text-text-primary">{title}</h2>
              {dismissible && (
                <button type="button" onClick={() => closeRef.current?.()} aria-label="Close" title="Close (Esc)"
                  className="shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle">
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {bare ? children : <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>}
          {footer && (
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </div>
      </div>
    </BodyPortal>
  );
}
