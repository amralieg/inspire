// REQ-541: helpers shared by the 14 visual blocks. Rows are tidied first, so a bad value never reaches an SVG attribute.
import { formatValue } from '../format.js';
import { SERIES_TOKENS } from '../tokens.js';
import { useCountUp } from '../motion.js';
import '../styles/viz.css';

export const W = 480;
export const PAD = 12;
export const MAX_LISTED = 12;
export const color = (i) => `var(--${SERIES_TOKENS[i % SERIES_TOKENS.length]})`;
export const f = (x) => { const n = typeof x === 'number' ? x : Number(x); return x != null && x !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
export const toNum = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return NaN;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
export const fmt = (v, format = 'number', currency) => formatValue(v, format, currency);
export const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t; };
export const fit = (px, size = 6.3) => Math.max(3, Math.floor(px / size));

// A linear scale from [lo, hi] to [a, b]. A flat or empty domain maps to the middle of the range, never to NaN.
export function scale(lo, hi, a, b) {
  const span = hi - lo;
  return (v) => (Number.isFinite(span) && span !== 0 && Number.isFinite(v) ? f(a + ((v - lo) / span) * (b - a)) : f((a + b) / 2));
}
export const extent = (values) => (values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]);

// need: roles that must be numbers. bound: roles that must be numbers only when the bind names a column. text: roles read as text.
export function tidy(rows, bind = {}, { need = [], bound = [], text = [] } = {}) {
  const keyCol = bind.key ?? bind.label ?? bind.x ?? bind.source;
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const v = {};
    for (const role of [...need, ...bound.filter((r) => bind[r] != null)]) {
      const n = toNum(row[bind[role]]);
      if (Number.isNaN(n)) return;
      v[role] = n;
    }
    const t = {};
    for (const role of text) t[role] = row[bind[role]] == null ? '' : String(row[bind[role]]);
    out.push({ i, v, t, key: row[keyCol] == null ? String(i) : String(row[keyCol]), row });
  });
  return out;
}

export const isFocus = (focus, key) => focus != null && focus !== '' && String(focus) === String(key);
export const markProps = (i, focused) => ({ className: `vz-mark${focused ? ' vz-focus' : ''}`, style: { '--i': i, '--s': i % 2 ? 1 : -1 }, ...(focused ? { 'data-focus': '' } : {}) });

export const describe = (title, parts, focusText) => `${title}. ${parts.slice(0, MAX_LISTED).join('; ')}${parts.length > MAX_LISTED ? `; and ${parts.length - MAX_LISTED} more` : ''}.${focusText ? ` Focus: ${focusText}.` : ''}`;

export function Empty({ id }) {
  return <div className={`vz vz-empty vz-${id}`} data-viz={id} data-motion-state="static" role="status">No data to draw</div>;
}

export function Frame({ id, label, h, m, motion, compare, children }) {
  return (
    <div className={`vz vz-${id}${m.calm ? ' vz-calm' : ''}${m.cls ? ` ${m.cls}` : ''}`} data-viz={id} data-motion={motion || 'none'} data-motion-state={m.run ? 'running' : 'static'}
      {...(compare ? { 'data-compare': compare } : {})}>
      <svg className="vz-svg" viewBox={`0 0 ${W} ${f(h)}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">{children}</svg>
    </div>
  );
}

// A number that counts up when the count_up motion runs, and is the final text otherwise.
export function Count({ value, m, motion, format, currency }) {
  const shown = useCountUp(value, m.run && motion === 'count_up');
  return <>{fmt(shown, format, currency)}</>;
}

export function Text({ x, y, anchor = 'start', cls = '', full, children }) {
  return <text x={f(x)} y={f(y)} textAnchor={anchor} className={`vz-t ${cls}`}>{full != null && <title>{full}</title>}{children}</text>;
}
