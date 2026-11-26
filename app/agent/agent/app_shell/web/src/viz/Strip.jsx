// Strip: every item as a dot on one number line, the focus item picked out against the population. Roles: value, label?, key?.
import { useMotion } from './motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('strip');

export default function Strip({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES);
  if (!items.length) return <Empty id="strip" />;
  const [lo, hi] = extent(items.map((it) => it.v.value));
  const x = scale(lo, hi, 30, 450);
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Strip of values', items.map((it) => `${it.t.label || it.key} ${fmt(it.v.value, format, currency)}`), mine && (mine.t.label || mine.key));
  return (
    <Frame id="strip" label={label} h={100} m={m} motion={motion} compare={compare}>
      <line className="vz-axis" x1="30" x2="450" y1="60" y2="60" />
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        return on ? null : <circle key={it.i} {...markProps(i, false)} className="vz-mark vz-dot" cx={x(it.v.value)} cy={60 + ((i % 3) - 1) * 7} r="5" />;
      })}
      {mine && <circle {...markProps(items.indexOf(mine), true)} cx={x(mine.v.value)} cy="60" r="8" />}
      {mine && <Text x={Math.min(Math.max(x(mine.v.value), 70), 410)} y="32" anchor="middle" cls="vz-v" full={mine.t.label || mine.key}>{clip(mine.t.label || mine.key, 22)}: <Count value={mine.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>}
      <Text x="30" y="88">{fmt(lo, format, currency)}</Text>
      <Text x="450" y="88" anchor="end">{fmt(hi, format, currency)}</Text>
    </Frame>
  );
}
