// Funnel: each step of a path with how many get through, so the drop-off shows. Roles: stage, value, key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, f, fit, fmt, isFocus, markProps, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('funnel');

export default function Funnel({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES).slice(0, 8);
  if (!items.length) return <Empty id="funnel" />;
  const top = Math.max(...items.map((it) => Math.abs(it.v.value))) || 1;
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Funnel', items.map((it) => `${it.t.stage || it.key} ${fmt(it.v.value, format, currency)}`), mine && (mine.t.stage || mine.key));
  return (
    <Frame id="funnel" label={label} h={items.length * 34 + 8} m={m} motion={motion} compare={compare}>
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        const w = f(Math.max(4, (Math.abs(it.v.value) / top) * 300));
        const name = it.t.stage || it.key;
        return (
          <g key={it.i}>
            <rect {...markProps(i, on)} className={`vz-mark vz-fill-up${on ? ' vz-focus' : ''}`} x={f(250 - w / 2)} y={8 + i * 34} width={w} height="26" rx="2" />
            <Text x="12" y={26 + i * 34} full={name} cls={on ? 'vz-strong' : ''}>{clip(name, fit(90))}</Text>
            <Text x="468" y={26 + i * 34} anchor="end" cls="vz-v"><Count value={it.v.value} m={m} motion={motion} format={format} currency={currency} /> ({fmt(Math.round((it.v.value / top) * 100), 'percent', currency).replace('.0', '')})</Text>
          </g>
        );
      })}
    </Frame>
  );
}
