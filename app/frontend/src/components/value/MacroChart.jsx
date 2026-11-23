import { chartPoints } from '../../lib/macroData.js';

// REQ-507 L5: one line for the history and a dashed one for the forecast, drawn apart. The forecast starts where the history ends.
const W = 480;
const H = 160;
const PAD = 24;

export default function MacroChart({ series }) {
  const { history, forecast } = chartPoints(series);
  const all = [...history, ...forecast];
  if (!all.length) return null;
  const ys = all.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const at = (i) => PAD + (all.length === 1 ? 0 : (i * (W - 2 * PAD)) / (all.length - 1));
  const yOf = (y) => H - PAD - ((y - lo) / span) * (H - 2 * PAD);
  const path = (pts, from) => pts.map((p, i) => `${i ? 'L' : 'M'}${at(from + i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
  const join = history.length ? [history[history.length - 1], ...forecast] : forecast;
  const unit = series?.unit ? ` in ${series.unit}` : '';
  return (
    <svg data-macro-chart="" role="img" aria-label={`History and forecast${unit}, ${all[0].x} to ${all[all.length - 1].x}`} viewBox={`0 0 ${W} ${H}`} className="h-40 w-full">
      <text x={PAD} y={12} fontSize="10" fill="currentColor">{`${hi}${series?.unit || ''}`}</text>
      <text x={PAD} y={H - 6} fontSize="10" fill="currentColor">{`${lo}${series?.unit || ''}`}</text>
      {history.length > 0 && <path data-macro-history="" d={path(history, 0)} fill="none" stroke="currentColor" strokeWidth="2" />}
      {forecast.length > 0 && <path data-macro-forecast="" d={path(join, history.length ? history.length - 1 : 0)} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" opacity="0.7" />}
    </svg>
  );
}
