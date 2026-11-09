import { useRef } from 'react';
import { resizeKeyWidth } from '../lib/paneWidth';

const sideOf = (el) => (getComputedStyle(el).direction === 'rtl' ? -1 : 1);

export default function PaneResizer({ width, onWidth, limits, label, grows = 1, className = '', ...rest }) {
  const drag = useRef(null);
  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, width, side: sideOf(e.currentTarget) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (drag.current) onWidth(drag.current.width + (e.clientX - drag.current.x) * grows * drag.current.side);
  };
  const onPointerUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e) => {
    const to = resizeKeyWidth(limits, width, e.key, grows * sideOf(e.currentTarget));
    if (to === undefined) return;
    e.preventDefault();
    onWidth(to);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={`group hidden md:flex w-3 shrink-0 cursor-col-resize touch-none justify-center rounded ${className}`}
      {...rest}
    >
      <span aria-hidden className="h-full w-px bg-border transition-smooth group-hover:w-0.5 group-hover:bg-db-red/60" />
    </div>
  );
}
