// Gauge vs threshold: one value on a dial with the limit marked. Roles: value, threshold, label?, key?. Draws the focus row, else the first.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, f, fmt, isFocus, markProps, roleSets, tidy } from './common.jsx';

const CX = 240; const CY = 120; const R = 90;
const at = (frac, r = R) => { const a = Math.PI * (1 - Math.min(1, Math.max(0, frac))); return [f(CX + Math.cos(a) * r), f(CY - Math.sin(a) * r)]; };
const arc = (a, b) => { const [x1, y1] = at(a); const [x2, y2] = at(b); return `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`; };

const ROLES = roleSets('gauge');

export default function Gauge({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES);
  if (!items.length) return <Empty id="gauge" />;
  const it = items.find((x) => isFocus(focus, x.key)) ?? items[0];
  const { value, threshold } = it.v;
  const max = Math.max(Math.abs(threshold) * 1.25, Math.abs(value) * 1.1, 1);
  const fv = Math.max(0, value) / max; const ft = Math.max(0, threshold) / max;
  const over = value > threshold;
  const name = it.t.label || it.key;
  const [tx1, ty1] = at(ft, R - 14); const [tx2, ty2] = at(ft, R + 12);
  const label = describe('Gauge against its limit', [`${name} ${fmt(value, format, currency)} against a limit of ${fmt(threshold, format, currency)}, ${over ? 'over' : 'within'} the limit`], isFocus(focus, it.key) && name);
  return (
    <Frame id="gauge" label={label} h={150} m={m} motion={motion} compare={compare}>
      <path className="vz-track" d={arc(0, 1)} />
      {fv > 0 && <path {...markProps(0, isFocus(focus, it.key))} className={`vz-mark vz-line vz-arc${over ? ' vz-over' : ''}${isFocus(focus, it.key) ? ' vz-focus' : ''}`} d={arc(0, fv)} pathLength="1" />}
      <line {...markProps(1, false)} className="vz-mark vz-limit" x1={tx1} y1={ty1} x2={tx2} y2={ty2} />
      <Text x={CX} y={CY - 16} anchor="middle" cls="vz-big"><Count value={value} m={m} motion={motion} format={format} currency={currency} /></Text>
      <Text x={CX} y={CY + 6} anchor="middle" full={name}>{clip(name, 30)}</Text>
      <Text x={f(CX + R + 10)} y={CY + 18} anchor="end" cls="vz-muted">Limit {fmt(threshold, format, currency)}</Text>
      <Text x={f(CX - R)} y={CY + 18} anchor="middle" cls="vz-muted">0</Text>
    </Frame>
  );
}
