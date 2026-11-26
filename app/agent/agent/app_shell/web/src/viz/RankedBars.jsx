// Ranked bars: items from largest to smallest with the focus item highlighted. Roles: label, value, key?.
import { useMotion } from './motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, f, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const SHOWN = 10;

const ROLES = roleSets('ranked_bars');

export default function RankedBars({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const all = tidy(rows, bind, ROLES).sort((a, b) => b.v.value - a.v.value);
  if (!all.length) return <Empty id="ranked_bars" />;
  const mine = all.findIndex((it) => isFocus(focus, it.key));
  const items = all.slice(0, SHOWN);
  if (mine >= SHOWN) items[SHOWN - 1] = all[mine];
  const [lo, hi] = extent([0, ...items.map((it) => it.v.value)]);
  const x = scale(lo, hi, 150, 400);
  const zero = x(0);
  const label = describe('Ranked bars', items.map((it) => `${it.t.label || it.key} ${fmt(it.v.value, format, currency)}`), mine >= 0 && (all[mine].t.label || all[mine].key));
  return (
    <Frame id="ranked_bars" label={label} h={items.length * 26 + 12} m={m} motion={motion} compare={compare}>
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        const end = x(it.v.value);
        const name = it.t.label || it.key;
        return (
          <g key={it.i}>
            <Text x="12" y={26 * i + 24} full={name} cls={on ? 'vz-strong' : ''}>{clip(name, 20)}</Text>
            <rect {...markProps(i, on)} className={`vz-mark vz-fill-up${on ? ' vz-focus' : ''}`} x={f(Math.min(zero, end))} y={26 * i + 12} width={f(Math.max(1, Math.abs(end - zero)))} height="16" rx="2" />
            <Text x={f(Math.max(zero, end) + 6)} y={26 * i + 24} cls="vz-v"><Count value={it.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>
          </g>
        );
      })}
    </Frame>
  );
}
