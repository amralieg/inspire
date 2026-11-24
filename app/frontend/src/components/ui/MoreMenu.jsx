import { useEffect, useId, useRef, useState } from 'react';

// One shared "More" menu for every page's secondary actions (REQ-510 L1).
// items = [{ label, onSelect, disabled, danger }]
const OPEN_EVENT = 'more-menu-open';

export default function MoreMenu({ label = 'More', items = [] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const enabled = () => [...(panelRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [])];

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    enabled()[0]?.focus();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOther = (e) => { if (e.detail !== id) setOpen(false); };
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
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
        <div ref={panelRef} role="menu" aria-label={label}
          className="menu-enter absolute end-0 top-full z-drawer mt-1 min-w-[12rem] rounded-md border border-border bg-surface py-1 shadow-lg">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1}
              aria-disabled={item.disabled ? 'true' : undefined}
              onClick={() => pick(item)}
              className={`block w-full px-3 py-1.5 text-start text-sm hover:bg-bg-subtle focus:bg-bg-subtle focus:outline-none ${item.disabled ? 'cursor-not-allowed text-text-disabled' : item.danger ? 'text-error-fg' : 'text-text-primary'}`}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
