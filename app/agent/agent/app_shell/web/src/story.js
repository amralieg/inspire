// REQ-533: the record story. Pure data for the drawer pictures: headline, bridge, strip, trend. Keyed by column roles in
// meta.story ({components:[{column,label}], total, prior, current}); with no config, columns ending in _effect are the components.
import { grouped } from './format.js';
import { statusKind } from './records.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const titled = (column) => String(column).replace(/_effect$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function componentsOf(record, config) {
  const given = config.components?.length ? config.components : Object.keys(record || {}).filter((k) => /_effect$/.test(k) && k !== config.total)
    .map((column) => ({ column, label: titled(column) }));
  return given.map((c) => ({ name: c.label || titled(c.column), value: num(record?.[c.column]) })).filter((p) => p.value != null);
}

export function storyOf(record, meta, compared, history) {
  const config = meta?.story || {};
  const parts = componentsOf(record, config);
  const sum = parts.reduce((a, p) => a + p.value, 0);
  const stated = config.total ? num(record?.[config.total]) : null;
  const total = stated ?? sum;
  // A part the columns do not explain keeps the bridge honest: the parts always sum to the total.
  const gap = total - sum;
  const bridge = parts.length ? {
    parts: Math.abs(gap) > 1e-9 ? [...parts, { name: 'Other', value: gap }] : parts, total,
    start: config.prior && config.current ? num(record?.[config.prior]) : null,
    end: config.prior && config.current ? num(record?.[config.current]) : null,
  } : null;
  const direction = total > 0 ? 'up' : total < 0 ? 'down' : 'flat';
  const amount = Math.abs(total);
  const headline = stated == null && !parts.length ? null : { direction, amount, text: direction === 'flat' ? 'No change' : `${direction === 'up' ? 'Up' : 'Down'} ${grouped(amount)}` };
  let strip = null;
  if (compared?.band && Array.isArray(compared.points) && compared.points.length) {
    const xs = [...compared.points.map((p) => p.x), ...compared.band].filter((v) => Number.isFinite(v));
    const span = (Math.max(...xs) - Math.min(...xs)) || 1;
    strip = { points: compared.points, band: compared.band, lo: Math.min(...xs) - span * 0.05, hi: Math.max(...xs) + span * 0.05,
      flagged: !!compared.flagged, rank: compared.rank ?? null, n: compared.n ?? null, status: compared.status || '' };
  }
  const column = config.total || config.current || '';
  const trend = column ? (history?.versions || []).map((v, i) => ({ x: i, y: num(v?.[column]) })).filter((p) => p.y != null) : [];
  const words = ['headline', 'what', 'why', 'do'].reduce((o, k) => ({ ...o, [k]: String(record?.[`ai_${k}`] ?? '').trim() }), {});
  return { headline, bridge, strip, trend: trend.length >= 2 ? trend : [], words: words.headline || words.what || words.why || words.do ? words : null };
}

/** Queue progress from the list's status counts: closed records of all records. Null when the counts are not there. */
export function queueOf(counts) {
  const statuses = counts?.statuses;
  if (!statuses) return null;
  const all = Object.entries(statuses);
  const total = all.reduce((a, [, n]) => a + n, 0);
  const done = all.filter(([s]) => statusKind(s) !== 'open').reduce((a, [, n]) => a + n, 0);
  return total ? { done, total } : null;
}
