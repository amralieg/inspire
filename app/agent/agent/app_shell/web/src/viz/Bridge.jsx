// Bridge: a start stepping up and down through each part of the change to the end total. Roles: label, value (the step), key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, extent, f, fit, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('bridge');

export default function Bridge({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES);
  if (!items.length) return <Empty id="bridge" />;
  let level = 0;
  const steps = items.map((it) => { const from = level; level += it.v.value; return { it, from, to: level }; });
  const total = level;
  const [lo, hi] = extent([0, ...steps.flatMap((s) => [s.from, s.to])]);
  const y = scale(lo, hi, 150, 28);
  const slot = 456 / (steps.length + 1);
  const bar = (x, a, b) => ({ x: f(x), y: f(Math.min(y(a), y(b))), width: f(slot * 0.62), height: f(Math.max(1, Math.abs(y(a) - y(b)))) });
  const label = describe('Bridge from start to end', [...steps.map((s) => `${s.it.t.label || s.it.key} ${fmt(s.it.v.value, format, currency)}`), `Total ${fmt(total, format, currency)}`],
    items.find((it) => isFocus(focus, it.key))?.key);
  return (
    <Frame id="bridge" label={label} h={190} m={m} motion={motion} compare={compare}>
      <line className="vz-axis" x1="12" x2="468" y1={y(0)} y2={y(0)} />
      {steps.map((s, i) => {
        const x = 12 + i * slot + slot * 0.19;
        const up = s.to >= s.from;
        const name = s.it.t.label || s.it.key;
        return (
          <g key={s.it.i}>
            <rect {...markProps(i, isFocus(focus, s.it.key))} {...bar(x, s.from, s.to)} className={`vz-mark vz-fill-${up ? 'up' : 'down'}${isFocus(focus, s.it.key) ? ' vz-focus' : ''}`} />
            <Text x={x + slot * 0.31} y={Math.min(y(s.from), y(s.to)) - 4} anchor="middle" cls="vz-v"><Count value={s.it.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>
            <Text x={x + slot * 0.31} y={168} anchor="middle" full={name}>{clip(name, fit(slot))}</Text>
          </g>
        );
      })}
      <rect {...markProps(steps.length, false)} {...bar(12 + steps.length * slot + slot * 0.19, 0, total)} className="vz-mark vz-fill-total" />
      <Text x={12 + steps.length * slot + slot * 0.5} y={Math.min(y(0), y(total)) - 4} anchor="middle" cls="vz-v"><Count value={total} m={m} motion={motion} format={format} currency={currency} /></Text>
      <Text x={12 + steps.length * slot + slot * 0.5} y={168} anchor="middle">Total</Text>
    </Frame>
  );
}
