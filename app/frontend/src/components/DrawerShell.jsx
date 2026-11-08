import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';

export default function DrawerShell({ label, closeLabel, focusKey = null, onClose, title, actions = null, below = null, footer = null, center = false, side = false, bodyRef = null, bodyProps = {}, children, ...rest }) {
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (side && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, side]);

  return (
    <BodyPortal>
      <div className={`fixed inset-0 flex ${side ? 'z-[45] pointer-events-none' : 'z-[70]'} ${center ? 'items-center justify-center p-4' : 'justify-end'}`} {...rest}>
        {!side && <button type="button" aria-label={closeLabel} className="absolute inset-0 bg-black/40 cursor-default" onClick={onClose} />}
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal={side ? 'false' : 'true'}
          aria-label={label}
          className={`relative flex w-full flex-col bg-surface shadow-elevated outline-none ${side ? 'pointer-events-auto' : ''} ${
            center ? 'max-h-[92dvh] max-w-[44rem] rounded-xl border border-border'
              : `h-full border-s border-border ${side ? 'md:w-[max(34rem,56vw)] md:max-w-[64rem]' : 'max-w-[46rem]'}`}`}
        >
          <div className="shrink-0 border-b border-border px-6 pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{title}</div>
              <div className="flex shrink-0 items-center gap-1">
                {actions}
                <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-secondary hover:bg-bg-subtle" aria-label="Close" title="Close (Esc)">
                  <X size={16} />
                </button>
              </div>
            </div>
            {below}
          </div>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5" {...bodyProps}>
            {children}
          </div>

          {footer && (
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-panel px-4 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </BodyPortal>
  );
}
