// Map pin: where the focus item sits among the others by region (plain frame, no base map). Roles: region, value, x? (longitude), y? (latitude), label?, key?.
// With x and y bound the pins sit at their coordinates; without them they are ranked by value in a grid.
import { useMotion } from './motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, f, fmt, isFocus, markProps, roleSets, scale, tidy } from './common.jsx';

const ROLES = roleSets('map_pin');
const SHOWN = 12;

export default function MapPin({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const placed = bind?.x != null && bind?.y != null;
  const all = tidy(rows, bind, ROLES);
  if (!all.length) return <Empty id="map_pin" />;
  const nameOf = (it) => it.t.label || it.t.region || it.key;
  const items = placed ? all : [...all].sort((a, b) => b.v.value - a.v.value).slice(0, SHOWN);
  const mine = items.find((it) => isFocus(focus, it.key)) ?? items.find((it) => isFocus(focus, it.t.region));
  let at; let radius;
  if (placed) {
    const [x0, x1] = extent(items.map((it) => it.v.x ?? 0));
    const [y0, y1] = extent(items.map((it) => it.v.y ?? 0));
    const k = Math.min(400 / (x1 - x0 || 1), 170 / (y1 - y0 || 1));
    at = (it) => [f(240 + ((it.v.x ?? 0) - (x0 + x1) / 2) * k), f(105 - ((it.v.y ?? 0) - (y0 + y1) / 2) * k)];
    radius = () => 5;
  } else {
    const cols = Math.min(4, items.length);
    const rowsN = Math.ceil(items.length / cols);
    const [v0, v1] = extent(items.map((it) => it.v.value));
    const size = scale(v0, v1, 5, 14);
    at = (it) => { const i = items.indexOf(it); return [f(12 + (456 / cols) * ((i % cols) + 0.5)), f(8 + (194 / rowsN) * (Math.floor(i / cols) + 0.4))]; };
    radius = (it) => size(it.v.value);
  }
  const label = describe('Map of places', items.map((it) => `${it.t.region || it.key}${it.t.label ? ` (${it.t.label})` : ''}${placed ? ` at ${fmt(it.v.x, format, currency)}, ${fmt(it.v.y, format, currency)}` : ''} value ${fmt(it.v.value, format, currency)}`), mine && nameOf(mine));
  const [mx, my] = mine ? at(mine) : [0, 0];
  return (
    <Frame id="map_pin" label={label} h={210} m={m} motion={motion} compare={compare}>
      <rect className="vz-region" x="12" y="8" width="456" height="194" rx="6" />
      {[1, 2, 3].map((g) => <line key={`v${g}`} className="vz-grid" x1={f(12 + g * 114)} x2={f(12 + g * 114)} y1="8" y2="202" />)}
      {[1, 2].map((g) => <line key={`h${g}`} className="vz-grid" x1="12" x2="468" y1={f(8 + g * 65)} y2={f(8 + g * 65)} />)}
      {items.map((it, i) => {
        if (it === mine) return null;
        const [cx, cy] = at(it);
        return (
          <g key={it.i}>
            <circle {...markProps(i, false)} className="vz-mark vz-dot" cx={cx} cy={cy} r={radius(it)} />
            {!placed && <Text x={cx} y={f(cy + radius(it) + 12)} anchor="middle" full={nameOf(it)}>{clip(nameOf(it), 12)}</Text>}
          </g>
        );
      })}
      {mine && <circle {...markProps(items.indexOf(mine), true)} cx={mx} cy={my} r={placed ? 9 : radius(mine) + 3} />}
      {mine && <Text x={Math.min(Math.max(mx, 70), 410)} y={f(placed ? Math.max(my - 16, 24) : my + radius(mine) + 15)} anchor="middle" cls="vz-v" full={nameOf(mine)}>{clip(nameOf(mine), 20)}: <Count value={mine.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>}
    </Frame>
  );
}
