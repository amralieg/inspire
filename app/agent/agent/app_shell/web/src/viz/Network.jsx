// Network neighbourhood: the focus item in the middle with what it connects to around it. Roles: source, target, value? (link weight), key?.
import { useMotion } from '../motion.js';
import { Empty, Frame, Text, clip, describe, f, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const NODES = 12;

const ROLES = roleSets('network');

export default function Network({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const edges = tidy(rows, bind, ROLES).filter((e) => e.t.source !== '' || e.t.target !== '');
  if (!edges.length) return <Empty id="network" />;
  const degree = new Map();
  edges.forEach((e) => [e.t.source, e.t.target].forEach((n) => degree.set(n, (degree.get(n) || 0) + 1)));
  const names = [...degree.keys()].sort((a, b) => degree.get(b) - degree.get(a));
  const hub = names.find((n) => isFocus(focus, n)) ?? names[0];
  const ring = names.filter((n) => n !== hub).slice(0, NODES - 1);
  const pos = new Map([[hub, [240, 110]]]);
  ring.forEach((n, i) => { const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2; pos.set(n, [f(240 + Math.cos(a) * 130), f(110 + Math.sin(a) * 78)]); });
  const drawn = edges.filter((e) => pos.has(e.t.source) && pos.has(e.t.target));
  const weights = drawn.map((e) => e.v.value ?? 1);
  const wmax = Math.max(1, ...weights.map(Math.abs));
  const sw = scale(0, wmax, 1, 5);
  const label = describe('Network of links', edges.map((e) => `${e.t.source} to ${e.t.target}${e.v.value != null ? ` ${fmt(e.v.value, format, currency)}` : ''}`), isFocus(focus, hub) && hub);
  return (
    <Frame id="network" label={label} h={225} m={m} motion={motion} compare={compare}>
      {drawn.map((e, i) => {
        const [x1, y1] = pos.get(e.t.source); const [x2, y2] = pos.get(e.t.target);
        return <line key={`e${e.i}`} {...markProps(i, false)} className="vz-mark vz-line vz-edge" x1={x1} y1={y1} x2={x2} y2={y2} pathLength="1" strokeWidth={sw(Math.abs(e.v.value ?? 1))} />;
      })}
      {[hub, ...ring].map((n, i) => {
        const [x, y] = pos.get(n);
        const on = isFocus(focus, n);
        const side = x < 230 ? 'end' : x > 250 ? 'start' : 'middle';
        const dx = side === 'end' ? -12 : side === 'start' ? 12 : 0;
        return (
          <g key={n}>
            <circle {...markProps(drawn.length + i, on)} className={`vz-mark vz-dot${i === 0 ? ' vz-hub' : ''}${on ? ' vz-focus' : ''}`} cx={x} cy={y} r={i === 0 ? 11 : 7} />
            <Text x={x + dx} y={f(y + (side === 'middle' ? (y < 110 ? -14 : 24) : 4))} anchor={side} full={n} cls={on ? 'vz-strong' : ''}>{clip(n, 16)}</Text>
          </g>
        );
      })}
    </Frame>
  );
}
