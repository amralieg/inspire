import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import './styles/pagework.css';

// REQ-506: the three actions that matter sit in the open; everything else waits under More (a menu, not a second row of buttons).
export function MoreMenu({ items, buttonRef = null, label = 'More' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const own = useRef(null);
  const shown = (items || []).filter(Boolean);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); (buttonRef || own).current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc, true); };
  }, [open, buttonRef]);
  if (!shown.length) return null;
  return (
    <span className="more-m" ref={box}>
      <button type="button" className="btn" ref={buttonRef || own} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-act="more">
        <Icon name="dots" size={14} />{label}
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label={`${label} actions`}>
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem" className="more-i" disabled={item.disabled} onClick={() => { setOpen(false); item.run(); }} {...(item.attrs || {})}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
