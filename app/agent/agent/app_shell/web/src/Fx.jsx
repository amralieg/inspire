import { useId, useState } from 'react';
import { createPortal } from 'react-dom';

const TIP_PX = 340;

export function useFx(formula) {
  const id = useId();
  const [at, setAt] = useState(null);
  if (!formula) return { props: {}, tip: null };
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - TIP_PX - 8)), top: r.bottom + 6 });
  };
  const hide = () => setAt(null);
  return {
    props: { 'aria-describedby': id, 'data-fx': '', onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide },
    tip: createPortal(<span role="tooltip" id={id} className={`fx-tip${at ? ' is-on' : ''}`} style={at || undefined}>{formula}</span>, document.body),
  };
}

export default function Fx({ formula, children, className = '' }) {
  const { props, tip } = useFx(formula);
  if (!formula) return children;
  return <span className={`fx-n ${className}`} tabIndex={0} {...props}>{children}{tip}</span>;
}
