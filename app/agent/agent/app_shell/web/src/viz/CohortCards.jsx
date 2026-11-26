// Cohort compare cards: one card per group with its headline value and size; each shows the gap to the focus group. Roles: group, value, count?, key?.
import { useMotion } from '../motion.js';
import { Count, Empty, Frame, Text, clip, describe, f, fit, fmt, isFocus, markProps, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('cohort_cards');

export default function CohortCards({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES).slice(0, 6);
  if (!items.length) return <Empty id="cohort_cards" />;
  const mine = items.find((it) => isFocus(focus, it.key));
  const cols = Math.min(3, items.length);
  const cw = (456 - (cols - 1) * 12) / cols;
  const label = describe('Cohort cards', items.map((it) => `${it.t.group || it.key} ${fmt(it.v.value, format, currency)}${it.v.count != null ? `, ${fmt(it.v.count, 'integer')} in the group` : ''}`), mine && (mine.t.group || mine.key));
  return (
    <Frame id="cohort_cards" label={label} h={Math.ceil(items.length / cols) * 100 + 8} m={m} motion={motion} compare={compare}>
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        const ox = 12 + (i % cols) * (cw + 12); const oy = 8 + Math.floor(i / cols) * 100;
        const name = it.t.group || it.key;
        const gap = mine && !on ? it.v.value - mine.v.value : null;
        return (
          <g key={it.i}>
            <rect {...markProps(i, on)} className={`vz-mark vz-panel${on ? ' vz-focus' : ''}`} x={f(ox)} y={oy} width={f(cw)} height="92" rx="6" />
            <Text x={ox + 10} y={oy + 20} cls="vz-strong" full={name}>{clip(name, fit(cw - 20))}</Text>
            <Text x={ox + 10} y={oy + 56} cls="vz-big"><Count value={it.v.value} m={m} motion={motion} format={format} currency={currency} /></Text>
            <Text x={ox + 10} y={oy + 80} cls="vz-muted">{it.v.count != null ? `${fmt(it.v.count, 'integer')} in group` : ''}{gap != null && `${it.v.count != null ? ' · ' : ''}${gap >= 0 ? '+' : ''}${fmt(gap, format, currency)} vs ${clip(mine.t.group || mine.key, 10)}`}</Text>
          </g>
        );
      })}
    </Frame>
  );
}
