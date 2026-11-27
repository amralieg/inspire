import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import BodyPortal from '../BodyPortal';

// One shared "More" menu for every page's secondary actions (REQ-510 L1).
// items = [{ label, onSelect, disabled, danger }]
const OPEN_EVENT = 'more-menu-open';
const GAP = 4;
const EDGE = 8;

// REQ-545: the panel is drawn on the page layer (a portal, fixed to the viewport) and placed from the trigger's box, so no sibling resizer,
// drawer edge or overflow-hidden parent can cover or clip it. It opens below the trigger, end-aligned with it (start-aligned in RTL),
// flips above when the bottom of the window is too near, and is clamped to stay fully inside the window.
function place(trigger, panel) {
  const t = trigger.getBoundingClientRect();
  const { width, height } = panel.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const rtl = getComputedStyle(trigger).direction === 'rtl';
  const left = Math.max(EDGE, Math.min(rtl ? t.left : t.right - width, vw - width - EDGE));
  const below = t.bottom + GAP;
  const fitsBelow = below + height <= vh - EDGE;
  const above = t.top - GAP - height;
  const top = fitsBelow ? below : (above >= EDGE ? above : Math.max(EDGE, vh - height - EDGE));
  return { left, top };
}

export default function MoreMenu({ label = 'More', items = [] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [at, setAt] = useState(null);

  const enabled = () => [...(panelRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [])];

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) { setAt(null); return undefined; }
    const move = () => { if (triggerRef.current && panelRef.current) setAt(place(triggerRef.current, panelRef.current)); };
    move();
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
  }, [open]);

  // The panel is hidden until it is placed, and a hidden element cannot take focus, so focus waits for the placement.
  const placed = at !== null;
  useEffect(() => {
    if (open && placed) enabled()[0]?.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return undefined;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOther = (e) => { if (e.detail !== id) setOpen(false); };
    const onDown = (e) => { if (!rootRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, id]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = enabled();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at <= 0 ? list.length - 1 : at - 1);
    list[next].focus();
  };

  const pick = (item) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={open ? onKeyDown : undefined}>
      <button ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-subtle">
        <bdi>{label}</bdi>
      </button>
      {open && (
        <BodyPortal>
          <div ref={panelRef} role="menu" aria-label={label}
            style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
            className="menu-enter fixed z-drawer min-w-[12rem] rounded-md border border-border bg-surface py-1 shadow-lg">
            {items.map((item) => (
              <button key={item.label} type="button" role="menuitem" tabIndex={-1}
                aria-disabled={item.disabled ? 'true' : undefined}
                onClick={() => pick(item)}
                className={`block w-full px-3 py-1.5 text-start text-sm hover:bg-bg-subtle focus:bg-bg-subtle focus:outline-none ${item.disabled ? 'cursor-not-allowed text-text-disabled' : item.danger ? 'text-error-fg' : 'text-text-primary'}`}>
                {item.label}
              </button>
            ))}
          </div>
        </BodyPortal>
      )}
    </div>
  );
}
