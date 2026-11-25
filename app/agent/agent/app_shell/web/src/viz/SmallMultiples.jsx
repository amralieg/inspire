// Small multiples: the same measure over x drawn once per group, so peers can be compared at a glance. Roles: label (the group), x, value, key?.
import { useMotion } from '../motion.js';
import { Empty, Frame, Text, clip, describe, extent, f, fit, fmt, isFocus, markProps, scale, tidy } from './common.jsx';

const GROUPS = 6;

export default function SmallMultiples({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, { need: ['value'], text: ['label', 'x'] });
  if (!items.length) return <Empty id="small_multiples" />;
  const groups = [];
  items.forEach((it) => {
    const name = it.t.label || it.key;
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, pts: [] }; groups.push(g); }
    g.pts.push(it);
  });
  const shown = groups.slice(0, GROUPS);
  const fi = groups.findIndex((g) => isFocus(focus, g.name));
  if (fi >= GROUPS) shown[GROUPS - 1] = groups[fi];
  const [lo, hi] = extent(shown.flatMap((g) => g.pts.map((p) => p.v.value)));
  const cols = shown.length > 4 ? 3 : Math.min(2, shown.length);
  const cw = (456 - (cols - 1) * 12) / cols;
  const rowsN = Math.ceil(shown.length / cols);
  const label = describe('Small multiples by group', shown.map((g) => `${g.name}: ${g.pts.map((p) => `${p.t.x || p.key} ${fmt(p.v.value, format, currency)}`).join(', ')}`), fi >= 0 && groups[fi].name);
  return (
    <Frame id="small_multiples" label={label} h={rowsN * 96 + 8} m={m} motion={motion} compare={compare}>
      {shown.map((g, gi) => {
        const ox = 12 + (gi % cols) * (cw + 12);
        const oy = 8 + Math.floor(gi / cols) * 96;
        const on = isFocus(focus, g.name);
        const y = scale(lo, hi, oy + 72, oy + 22);
        const x = (i) => (g.pts.length === 1 ? f(ox + cw / 2) : f(ox + 8 + (i / (g.pts.length - 1)) * (cw - 16)));
        const path = g.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.v.value)}`).join(' ');
        return (
          <g key={g.name}>
            <rect {...markProps(gi, on)} className={`vz-mark vz-panel${on ? ' vz-focus' : ''}`} x={f(ox)} y={f(oy)} width={f(cw)} height="88" rx="4" />
            <Text x={ox + 8} y={oy + 15} cls="vz-strong" full={g.name}>{clip(g.name, fit(cw - 16))}</Text>
            <path className="vz-mark vz-line" style={{ '--i': gi }} d={path} pathLength="1" />
            {g.pts.length === 1 && <circle className="vz-mark vz-dot" style={{ '--i': gi }} cx={x(0)} cy={y(g.pts[0].v.value)} r="3.5" />}
          </g>
        );
      })}
    </Frame>
  );
}
