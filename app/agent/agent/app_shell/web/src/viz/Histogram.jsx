// Histogram: how the values spread, with a marker where the focus item sits. Roles: value, key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, describe, extent, f, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('histogram');

export default function Histogram({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES);
  if (!items.length) return <Empty id="histogram" />;
  const values = items.map((it) => it.v.value);
  const [lo, hi] = extent(values);
  const bins = lo === hi ? 1 : Math.min(10, Math.max(3, Math.ceil(Math.sqrt(values.length))));
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((v) => { counts[Math.min(bins - 1, bins === 1 ? 0 : Math.floor(((v - lo) / (hi - lo)) * bins))] += 1; });
  const top = Math.max(...counts);
  const x = scale(lo, hi, 30, 450);
  const bw = 420 / bins;
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Histogram of values', values.map((v) => fmt(v, format, currency)), mine && fmt(mine.v.value, format, currency));
  return (
    <Frame id="histogram" label={label} h={170} m={m} motion={motion} compare={compare}>
      <line className="vz-axis" x1="30" x2="450" y1="130" y2="130" />
      {counts.map((c, i) => {
        const h = f((c / top) * 90);
        return <rect key={i} {...markProps(i, false)} className="vz-mark vz-fill-up" x={f(30 + i * bw + 1)} y={f(130 - h)} width={f(Math.max(1, bw - 2))} height={h} />;
      })}
      {mine && <line {...markProps(counts.length, true)} className="vz-mark vz-focus vz-marker" x1={x(mine.v.value)} x2={x(mine.v.value)} y1="22" y2="130" />}
      {mine && <Text x={Math.min(Math.max(x(mine.v.value), 40), 440)} y="16" anchor="middle" cls="vz-v"><Count value={mine.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>}
      <Text x="30" y="150">{fmt(lo, format, currency)}</Text>
      <Text x="450" y="150" anchor="end">{fmt(hi, format, currency)}</Text>
    </Frame>
  );
}
