// Map pin: where the focus item sits among the others inside its region (plain frame, no base map). Roles: label, x (longitude), y (latitude), value?, key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, f, fmt, isFocus, markProps, tidy } from './common.jsx';

export default function MapPin({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, { need: ['x', 'y'], bound: ['value'], text: ['label'] });
  if (!items.length) return <Empty id="map_pin" />;
  const [x0, x1] = extent(items.map((it) => it.v.x));
  const [y0, y1] = extent(items.map((it) => it.v.y));
  const sx = x1 - x0 || 1; const sy = y1 - y0 || 1;
  const k = Math.min(400 / sx, 170 / sy);
  const cx = (v) => f(240 + (v - (x0 + x1) / 2) * k);
  const cy = (v) => f(105 - (v - (y0 + y1) / 2) * k);
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Map of places', items.map((it) => `${it.t.label || it.key} at ${fmt(it.v.x, format, currency)}, ${fmt(it.v.y, format, currency)}${it.v.value != null ? ` value ${fmt(it.v.value, format, currency)}` : ''}`), mine && (mine.t.label || mine.key));
  return (
    <Frame id="map_pin" label={label} h={210} m={m} motion={motion} compare={compare}>
      <rect className="vz-region" x="12" y="8" width="456" height="194" rx="6" />
      {[1, 2, 3].map((g) => <line key={`v${g}`} className="vz-grid" x1={f(12 + g * 114)} x2={f(12 + g * 114)} y1="8" y2="202" />)}
      {[1, 2].map((g) => <line key={`h${g}`} className="vz-grid" x1="12" x2="468" y1={f(8 + g * 65)} y2={f(8 + g * 65)} />)}
      {items.map((it, i) => (isFocus(focus, it.key) ? null : <circle key={it.i} {...markProps(i, false)} className="vz-mark vz-dot" cx={cx(it.v.x)} cy={cy(it.v.y)} r="5" />))}
      {mine && <circle {...markProps(items.indexOf(mine), true)} cx={cx(mine.v.x)} cy={cy(mine.v.y)} r="9" />}
      {mine && <Text x={Math.min(Math.max(cx(mine.v.x), 70), 410)} y={f(Math.max(cy(mine.v.y) - 16, 24))} anchor="middle" cls="vz-v" full={mine.t.label || mine.key}>{clip(mine.t.label || mine.key, 20)}{mine.v.value != null && <>: <Count value={mine.v.value} m={m} motion={motion} format={format} currency={currency} /></>}</Text>}
    </Frame>
  );
}
