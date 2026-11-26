// Timeline to event: dated steps along one line, spaced by time. Roles: label, time (a date), value?, key?.
import { useMotion } from './motion.js';
import { asDate, dayLabel } from '../format.js';
import { Count, Empty, Frame, Text, clip, describe, f, fmt, isFocus, markProps, scale, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('timeline');

export default function Timeline({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  let items = tidy(rows, bind, ROLES).slice(0, 10);
  if (!items.length) return <Empty id="timeline" />;
  const times = items.map((it) => asDate(it.t.time)?.getTime());
  const dated = times.every((t) => Number.isFinite(t));
  if (dated) items = items.map((it, i) => ({ ...it, at: times[i] })).sort((a, b) => a.at - b.at);
  else items = items.map((it, i) => ({ ...it, at: i }));
  const x = scale(items[0].at, items[items.length - 1].at, 50, 430);
  const when = (it) => (dated ? dayLabel(it.t.time) : it.t.time);
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Timeline', items.map((it) => `${it.t.label || it.key} on ${when(it)}${it.v.value != null ? `, ${fmt(it.v.value, format, currency)}` : ''}`), mine && (mine.t.label || mine.key));
  return (
    <Frame id="timeline" label={label} h={160} m={m} motion={motion} compare={compare}>
      <line {...markProps(0, false)} className="vz-mark vz-line vz-axis" x1="30" x2="450" y1="80" y2="80" pathLength="1" />
      {items.map((it, i) => {
        const on = isFocus(focus, it.key);
        const px = x(it.at); const up = i % 2 === 0;
        const side = px < 70 ? 'start' : px > 410 ? 'end' : 'middle';
        const name = it.t.label || it.key;
        return (
          <g key={it.i}>
            <line className="vz-stem" x1={px} x2={px} y1="80" y2={up ? 56 : 104} />
            <circle {...markProps(i + 1, on)} className={`vz-mark vz-dot${on ? ' vz-focus' : ''}`} cx={px} cy="80" r={on ? 8 : 5} />
            <Text x={px} y={up ? 40 : 124} anchor={side} cls={on ? 'vz-strong' : ''} full={name}>{clip(name, 14)}</Text>
            <Text x={px} y={up ? 52 : 138} anchor={side} cls="vz-muted">{clip(when(it), 12)}{it.v.value != null && <> · <Count value={it.v.value} m={m} motion={motion} format={format} currency={currency} /></>}</Text>
          </g>
        );
      })}
    </Frame>
  );
}
