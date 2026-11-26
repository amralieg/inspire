// Trend vs normal band: a line moving through its usual range, points outside the range stand out. Roles: time, value, low?, high?, key?.
import { useMotion } from './motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, f, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('trend_band');

export default function TrendBand({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES);
  if (!items.length) return <Empty id="trend_band" />;
  const vals = items.map((it) => it.v.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const band = items.map((it) => [it.v.low ?? mean - sd, it.v.high ?? mean + sd].sort((a, b) => a - b));
  const [lo, hi] = extent([...vals, ...band.flat()]);
  const y = scale(lo, hi, 130, 24);
  const x = (i) => (items.length === 1 ? 240 : f(36 + (i / (items.length - 1)) * 408));
  const path = items.map((it, i) => `${i ? 'L' : 'M'}${x(i)} ${y(it.v.value)}`).join(' ');
  const area = `${band.map((b, i) => `${i ? 'L' : 'M'}${x(i)} ${y(b[1])}`).join(' ')} ${band.map((b, i) => `L${x(band.length - 1 - i)} ${y(band[band.length - 1 - i][0])}`).join(' ')} Z`;
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Trend against its normal band', items.map((it, i) => `${it.t.time || it.key} ${fmt(it.v.value, format, currency)} (normal ${fmt(band[i][0], format, currency)} to ${fmt(band[i][1], format, currency)})`),
    mine && (mine.t.time || mine.key));
  return (
    <Frame id="trend_band" label={label} h={175} m={m} motion={motion} compare={compare}>
      <path className="vz-band" d={area} />
      <path {...markProps(0, false)} className="vz-mark vz-line" d={path} pathLength="1" />
      {items.map((it, i) => {
        const out = it.v.value < band[i][0] || it.v.value > band[i][1];
        const on = isFocus(focus, it.key);
        return <circle key={it.i} {...markProps(i + 1, on)} className={`vz-mark vz-dot${out ? ' vz-out' : ''}${on ? ' vz-focus' : ''}`} cx={x(i)} cy={y(it.v.value)} r={on ? 7 : 4} />;
      })}
      {mine && <Text x={Math.min(Math.max(x(items.indexOf(mine)), 40), 440)} y={f(y(mine.v.value) - 12)} anchor="middle" cls="vz-v"><Count value={mine.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>}
      <Text x="36" y="160" full={items[0].t.time}>{clip(items[0].t.time || items[0].key, 14)}</Text>
      <Text x="444" y="160" anchor="end" full={items[items.length - 1].t.time}>{clip(items[items.length - 1].t.time || items[items.length - 1].key, 14)}</Text>
    </Frame>
  );
}
