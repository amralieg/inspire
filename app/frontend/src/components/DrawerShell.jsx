import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import PaneResizer from './PaneResizer';
import { DRAWER_WIDTH, loadPaneWidth, paneWidth, savePaneWidth } from '../lib/paneWidth';

const WIDE = '(min-width: 768px)';

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}

const KEEP_OPEN = '[aria-modal="true"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

export default function DrawerShell({ label, closeLabel, focusKey = null, onClose, title, actions = null, below = null, footer = null, center = false, side = false, dock = null, bodyRef = null, bodyProps = {}, children, ...rest }) {
  const panelRef = useRef(null);
  const wide = useWide();
  const docked = Boolean(side && dock && wide);
  const openerRef = useRef(null);
  const [width, setWidth] = useState(() => loadPaneWidth(DRAWER_WIDTH));
  useEffect(() => { if (!center) savePaneWidth(DRAWER_WIDTH, width); }, [width, center]);

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

  useEffect(() => {
    if (!side || docked) return undefined;
    const onDown = (e) => {
      const target = e.target;
      if (!(target instanceof Element) || !target.isConnected) return;
      if (panelRef.current?.contains(target)) return;
      if (openerRef.current instanceof Element && openerRef.current.contains(target)) return;
      if (target.closest(KEEP_OPEN)) return;
      onClose?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose, side, docked]);

  useEffect(() => {
    if (!docked) return undefined;
    document.documentElement.style.setProperty('--dock-w', `min(${width}px, 40vw)`);
    return () => document.documentElement.style.removeProperty('--dock-w');
  }, [docked, width]);

  const panel = (
    <>
      {!side && <button type="button" aria-label={closeLabel} className="absolute inset-0 bg-black/40 cursor-default" onClick={onClose} />}
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal={side ? 'false' : 'true'}
      aria-label={label}
      className={`relative flex w-full flex-col bg-surface shadow-elevated outline-none ${side ? 'pointer-events-auto' : ''} ${
        center ? 'max-h-[92dvh] max-w-[44rem] rounded-xl border border-border'
          : `h-full border-s border-border md:w-[var(--drawer-width)] ${side ? 'md:max-w-[40vw]' : 'md:max-w-[calc(100vw-3rem)]'}`}`}
      style={center ? undefined : { '--drawer-width': `${width}px` }}
    >
      {!center && (
        <PaneResizer width={width} onWidth={(next) => setWidth(paneWidth(DRAWER_WIDTH, next))} limits={DRAWER_WIDTH} grows={-1}
          label="Resize this panel" data-drawer-resizer="" className="absolute inset-y-0 -start-1.5 z-10" />
      )}
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
        {below && <div className={docked ? 'md:max-h-[12dvh] md:overflow-y-auto' : undefined}>{below}</div>}
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
    </>
  );
  if (docked) return createPortal(<div className="flex h-full min-h-0 md:shrink-0" {...rest}>{panel}</div>, dock);
  return (
    <BodyPortal>
      <div className={`fixed inset-0 flex ${side ? 'z-[45] pointer-events-none' : 'z-[70]'} ${center ? 'items-center justify-center p-4' : 'justify-end'}`} {...rest}>
        {panel}
      </div>
    </BodyPortal>
  );
}
