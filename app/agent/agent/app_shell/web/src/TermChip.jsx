// REQ-534: a small underlined term. Props: term (string), kind (technique kind), context (one line tying the picture to this record).
import { useRef, useState } from 'react';
import Explainer from './Explainer.jsx';
import './styles/explainer.css';

export default function TermChip({ term, kind, context = '' }) {
  const [open, setOpen] = useState(false);
  const chip = useRef(null);
  const close = () => { setOpen(false); chip.current?.focus(); };
  return (
    <span className="term-chip-wrap">
      <button type="button" ref={chip} className="term-chip" data-term-chip aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}>{term}</button>
      {open && <Explainer term={term} kind={kind} context={context} onClose={close} />}
    </span>
  );
}
export { TermChip };
