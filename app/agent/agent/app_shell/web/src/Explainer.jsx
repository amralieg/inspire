// REQ-534: the explainer card. Props: kind, term, context (one line about the record), onClose.
// Esc closes (the chip takes focus back). Under prefers-reduced-motion the picture has no animation classes.
import { useEffect, useRef, useState } from 'react';
import { explainerFor, termFor } from './explainers.js';
import './styles/explainer.css';

const QUERY = '(prefers-reduced-motion: reduce)';
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches;

// Each template draws in a 240 x 120 box. `a` is the animation class prefix ('' when static).
const T = {
  bridge: (a) => [60, -30, 40, -20].reduce((acc, d, i) => {
    const y0 = acc.level; const h = Math.abs(d) * 1.6; const y = d > 0 ? y0 - h : y0;
    acc.nodes.push(<rect key={i} x={20 + i * 52} y={y} width="34" height={h} className={`ex-bar ${d > 0 ? 'ex-up' : 'ex-down'} ${a && 'ex-anim ex-grow'}`} style={{ animationDelay: `${i * 0.2}s` }} />);
    acc.level = d > 0 ? y0 - h : y0 + h; return acc;
  }, { level: 90, nodes: [] }).nodes,
  band: (a) => [<rect key="b" x="10" y="40" width="220" height="40" className="ex-band" />,
    <polyline key="l" points="10,60 50,52 90,66 130,58 150,18 170,62 230,56" className={`ex-line ${a && 'ex-anim ex-draw'}`} />,
    <circle key="o" cx="150" cy="18" r="5" className={`ex-dot ${a && 'ex-anim ex-pop'}`} />],
  trend: (a) => [<polyline key="h" points="10,90 50,76 90,84 130,60" className="ex-line" />,
    <polyline key="f" points="130,60 170,46 230,30" className={`ex-line ex-future ${a && 'ex-anim ex-draw'}`} />,
    <polygon key="r" points="130,60 230,16 230,48" className={`ex-range ${a && 'ex-anim ex-fade'}`} />],
  bars: (a) => [100, 78, 56, 34, 20].map((w, i) => <rect key={i} x="14" y={14 + i * 20} width={w * 2} height="14" className={`ex-bar ex-up ${a && 'ex-anim ex-sweep'}`} style={{ animationDelay: `${i * 0.12}s` }} />),
  share: (a) => [[0, 90], [90, 150], [150, 220]].map(([s, e], i) => <rect key={i} x={10 + s} y="44" width={e - s} height="32" className={`ex-seg ex-seg${i} ${a && 'ex-anim ex-fade'}`} style={{ animationDelay: `${i * 0.25}s` }} />),
  funnel: (a) => [200, 150, 100, 50].map((w, i) => <rect key={i} x={120 - w / 2} y={8 + i * 28} width={w} height="22" className={`ex-bar ex-up ${a && 'ex-anim ex-grow'}`} style={{ animationDelay: `${i * 0.2}s` }} />),
  network: (a) => {
    const n = [[120, 20], [50, 60], [190, 60], [80, 100], [160, 100]];
    return [...[[0, 1], [0, 2], [1, 3], [2, 4], [1, 2]].map(([p, q], i) => <line key={`e${i}`} x1={n[p][0]} y1={n[p][1]} x2={n[q][0]} y2={n[q][1]} className={`ex-edge ${a && 'ex-anim ex-fade'}`} style={{ animationDelay: `${i * 0.15}s` }} />),
      ...n.map(([x, y], i) => <circle key={`n${i}`} cx={x} cy={y} r={i ? 9 : 12} className={`ex-dot ${a && 'ex-anim ex-pop'}`} style={{ animationDelay: `${i * 0.15}s` }} />)];
  },
  beforeafter: (a) => [<rect key="a" x="30" y="50" width="70" height="50" className="ex-bar ex-down" />,
    <rect key="b" x="140" y="20" width="70" height="80" className={`ex-bar ex-up ${a && 'ex-anim ex-grow'}`} />,
    <polyline key="c" points="104,70 134,70 126,63 134,70 126,77" className="ex-line" />],
};
const LABEL = {
  bridge: 'Bars stepping up and down from a start to an end, one bar for each part of the change',
  band: 'A line moving inside a normal band, with one point outside it',
  trend: 'A line of past values continuing into a forecast with a widening range',
  bars: 'Horizontal bars ranked from longest to shortest',
  share: 'One bar split into groups by share of the total',
  funnel: 'Bars getting shorter at each step, showing where records drop out',
  network: 'Dots joined by lines, showing what depends on what',
  beforeafter: 'A short bar before and a taller bar after',
};

export default function Explainer({ kind, term, context = '', onClose }) {
  const e = explainerFor(kind);
  const box = useRef(null);
  const [still] = useState(reducedMotion);
  useEffect(() => {
    box.current?.focus();
    const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  if (!e) return null;
  const meaning = termFor(kind, term);
  const a = still ? '' : 'on';
  return (
    <div className={`explainer${still ? ' ex-still' : ''}`} data-explainer role="dialog" aria-label={`What ${term || 'this'} means`} tabIndex={-1} ref={box}>
      <svg viewBox="0 0 240 120" role="img" aria-label={`${LABEL[e.template]}. ${e.what}`} className="ex-svg">{T[e.template](a)}</svg>
      {meaning && <p className="ex-term"><strong>{meaning.term}.</strong> {meaning.plain}</p>}
      <p className="ex-what">{e.what}</p>
      <p className="ex-why">{e.why}</p>
      {context && <p className="ex-record" data-explainer-record>{context}</p>}
      <button type="button" className="ex-close" onClick={onClose}>Close</button>
    </div>
  );
}
