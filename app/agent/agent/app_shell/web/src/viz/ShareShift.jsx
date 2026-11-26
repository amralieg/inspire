// Share shift: how the mix moved, one stacked bar before and one after with ribbons between. Roles: label, value (the share now), before? (the share before; without it the mix is drawn unchanged), key?.
import { useMotion } from '../motion.js';
import { Empty, Frame, Text, clip, color, describe, f, fit, fmt, isFocus, markProps, roleSets, tidy } from './common.jsx';

const ROLES = roleSets('share_shift');

export default function ShareShift({ rows, bind, focus, motion, motionLevel, compare, format, currency }) {
  const m = useMotion(motion, motionLevel);
  const items = tidy(rows, bind, ROLES).map((it) => ({ ...it, a: Math.max(0, it.v.value), b: Math.max(0, it.v.before ?? it.v.value) }));
  const sumB = items.reduce((s, it) => s + it.b, 0);
  const sumA = items.reduce((s, it) => s + it.a, 0);
  if (!items.length || sumB <= 0 || sumA <= 0) return <Empty id="share_shift" />;
  let cb = 0; let ca = 0;
  const segs = items.map((it) => {
    const s = { it, b0: 20 + (cb / sumB) * 440, b1: 20 + ((cb + it.b) / sumB) * 440, a0: 20 + (ca / sumA) * 440, a1: 20 + ((ca + it.a) / sumA) * 440 };
    cb += it.b; ca += it.a; return s;
  });
  const mine = items.find((it) => isFocus(focus, it.key));
  const label = describe('Share shift from before to after', items.map((it) => `${it.t.label || it.key} ${it.v.before != null ? `${fmt(it.v.before, format, currency)} before, ` : ''}${fmt(it.v.value, format, currency)} after`), mine && (mine.t.label || mine.key));
  return (
    <Frame id="share_shift" label={label} h={112 + items.length * 18} m={m} motion={motion} compare={compare}>
      <Text x="20" y="14" cls="vz-muted">Before</Text>
      <Text x="20" y="102" cls="vz-muted">After</Text>
      {segs.map((s, i) => (
        <path key={`r${s.it.i}`} className="vz-mark vz-ribbon" style={{ '--i': i, '--s': i % 2 ? 1 : -1, fill: color(i) }}
          d={`M${f(s.b0)} 42 L${f(s.b1)} 42 L${f(s.a1)} 66 L${f(s.a0)} 66 Z`} />
      ))}
      {segs.map((s, i) => {
        const on = isFocus(focus, s.it.key);
        const p = { ...markProps(i, on), style: { '--i': i, '--s': i % 2 ? 1 : -1, fill: color(i) } };
        return (
          <g key={s.it.i}>
            <rect {...p} x={f(s.b0)} y="20" width={f(Math.max(0.5, s.b1 - s.b0))} height="22" />
            <rect {...p} className={`vz-mark${on ? ' vz-focus' : ''}`} x={f(s.a0)} y="66" width={f(Math.max(0.5, s.a1 - s.a0))} height="22" />
          </g>
        );
      })}
      {segs.map((s, i) => (
        <g key={`l${s.it.i}`}>
          <rect x="20" y={f(116 + i * 18 - 8)} width="9" height="9" fill={color(i)} />
          <Text x="36" y={116 + i * 18} full={s.it.t.label || s.it.key} cls={isFocus(focus, s.it.key) ? 'vz-strong' : ''}>{clip(s.it.t.label || s.it.key, fit(240))}</Text>
          <Text x="460" y={116 + i * 18} anchor="end" cls="vz-v">{s.it.v.before != null && <>{fmt(s.it.v.before, format, currency)} to </>}{fmt(s.it.v.value, format, currency)}</Text>
        </g>
      ))}
    </Frame>
  );
}
