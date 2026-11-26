// Before and after: for each item a muted bar for before and a strong bar for after, with the change. Roles: label, before, after, key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, f, fit, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('before_after');

export default function BeforeAfter({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES).slice(0, 8);
  if (!items.length) return <Empty id="before_after" />;
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Before and after', items.map((it) => `${it.t.label || it.key} ${fmt(it.v.before, format, currency)} before, ${fmt(it.v.after, format, currency)} after`), mine && (mine.t.label || mine.key));
  return (
    <Frame id="before_after" label={label} h={items.length * 52 + 8} m={m} motion={motion} compare={compare}>
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        const top = Math.max(Math.abs(it.v.before), Math.abs(it.v.after));
        const w = scale(0, top, 0, 250);
        const y0 = 8 + i * 52;
        const name = it.t.label || it.key;
        return (
          <g key={it.i}>
            <Text x="12" y={y0 + 12} full={name} cls={on ? 'vz-strong' : ''}>{clip(name, fit(110))}</Text>
            <rect {...markProps(i, false)} className="vz-mark vz-fill-down" x="130" y={y0 + 2} width={f(Math.max(1, Math.abs(w(it.v.before))))} height="16" rx="2" />
            <rect {...markProps(i, on)} className={`vz-mark vz-fill-up${on ? ' vz-focus' : ''}`} x="130" y={y0 + 24} width={f(Math.max(1, Math.abs(w(it.v.after))))} height="16" rx="2" />
            <Text x={f(136 + Math.abs(w(it.v.before)))} y={y0 + 15} cls="vz-muted">{fmt(it.v.before, format, currency)}</Text>
            <Text x={f(136 + Math.abs(w(it.v.after)))} y={y0 + 37} cls="vz-v"><Count value={it.v.after} m={m} motion={motion} format={format} currency={currency} /></Text>
          </g>
        );
      })}
    </Frame>
  );
}
