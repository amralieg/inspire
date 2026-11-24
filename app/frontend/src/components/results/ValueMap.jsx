import { useMemo, useState } from 'react';
import { inspireScoreFromUc, nameOfUseCase, scoreOf, trackingIdOf } from '../../lib/useCaseFields';

const COLORS = ['#FF3621', '#3B82F6', '#22C55E', '#EAB308', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
const W = 900, H = 380, L = 64, R = 24, T = 24, B = 56, FLOOR = 24;
const PLOT_W = W - L - R, PLOT_H = H - T - B;

function money(amount, currency) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(amount); }
  catch { return `${currency || ''} ${amount}`.trim(); }
}

/** REQ-511: the value map. x = Inspire score, y = yearly value, size = feasibility, colour = domain. Plain SVG, no chart library. */
export default function ValueMap({ useCases, valueTotals, openUseCase, onRunValueRow }) {
  const [hidden, setHidden] = useState(null);
  const [tip, setTip] = useState(null);
  const { points, domains, maxValue } = useMemo(() => {
    const names = [];
    const rows = (useCases || []).map((uc) => {
      const id = trackingIdOf(uc);
      const e = valueTotals?.use_cases?.[id];
      const amount = e && e.status !== 'none' && Number(e.amount) > 0 ? Number(e.amount) : null;
      const domain = uc._domain || 'Other';
      if (!names.includes(domain)) names.push(domain);
      const feas = scoreOf(uc, 'feasibility_score', 'Feasibility_Score', 'Feasibility Score');
      return { uc, id, no: String(uc?.No ?? id ?? ''), name: nameOfUseCase(uc), score: inspireScoreFromUc(uc) ?? 0, amount, currency: e?.currency || 'USD', feas, domain };
    });
    return { points: rows, domains: names, maxValue: Math.max(0, ...rows.map((r) => r.amount || 0)) };
  }, [useCases, valueTotals]);

  const x = (s) => L + (Math.min(10, Math.max(0, s)) / 10) * PLOT_W;
  const floorY = T + PLOT_H - 6;
  const y = (a) => (a == null ? floorY : T + PLOT_H - FLOOR - (a / (maxValue || 1)) * (PLOT_H - FLOOR - 8));
  const colorOf = (d) => COLORS[domains.indexOf(d) % COLORS.length];
  const visible = points.filter((p) => hidden == null || p.domain === hidden);
  const go = (p) => (p.amount != null ? openUseCase?.(p.uc) : onRunValueRow?.(p.id));
  const label = (p) => `${p.name}, ${p.amount != null ? `${money(p.amount, p.currency)} a year` : 'No value yet'}, score ${Number(p.score.toFixed(1))}`;
  const tipP = tip && visible.find((p) => p.no === tip);

  return (
    <section role="region" aria-label="Value map" data-value-map="" className="bg-surface border border-border/70 rounded-xl p-4 mb-4 shadow-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-db-red-fg">Value map</h2>
        <div role="group" aria-label="Domains" className="flex flex-wrap gap-2">
          {domains.map((d) => (
            <button key={d} type="button" aria-pressed={hidden === d} onClick={() => setHidden(hidden === d ? null : d)}
              title={hidden === d ? 'Show every domain' : `Show only ${d}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-smooth ${hidden === d ? 'border-db-red/40 bg-db-red-50' : 'border-border bg-surface hover:border-db-red/25'}`}>
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(d) }} />
              {d} ({points.filter((p) => p.domain === d).length})
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxHeight: 420 }} role="group" aria-label="Inspire score against yearly value">
        <rect x={x(7)} y={T} width={x(10) - x(7)} height={y(maxValue * 0.5) - T} fill="#22C55E" fillOpacity="0.08" stroke="#22C55E" strokeDasharray="4 4" />
        <text x={x(7) + 8} y={T + 16} fontSize="12" fill="#15803D">Build first</text>
        <line x1={L} x2={W - R} y1={floorY + 10} y2={floorY + 10} stroke="#9CA3AF" strokeDasharray="3 3" />
        <text x={L - 8} y={floorY + 14} fontSize="11" textAnchor="end" fill="#6B7280">No value</text>
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="#D1D5DB" />
        {[0, 2, 4, 6, 8, 10].map((s) => <text key={s} x={x(s)} y={H - B + 32} fontSize="11" textAnchor="middle" fill="#6B7280">{s}</text>)}
        <text x={L + PLOT_W / 2} y={H - 6} fontSize="12" textAnchor="middle" fill="#6B7280">Inspire score</text>
        {maxValue > 0 && [0.5, 1].map((f) => <text key={f} x={L - 8} y={y(maxValue * f) + 4} fontSize="11" textAnchor="end" fill="#6B7280">{money(maxValue * f)}</text>)}
        <text transform={`translate(14 ${T + PLOT_H / 2}) rotate(-90)`} fontSize="12" textAnchor="middle" fill="#6B7280">Yearly value</text>
        {visible.map((p) => {
          const r = p.feas != null ? 6 + (Math.min(10, Math.max(0, p.feas)) / 10) * 8 : 9;
          const c = colorOf(p.domain);
          return (
            <circle key={p.no} data-map-point="" data-use-case-no={p.no} data-valued={p.amount != null ? 'true' : 'false'}
              role="button" tabIndex={0} aria-label={label(p)} cx={x(p.score)} cy={y(p.amount)} r={r}
              fill={p.amount != null ? c : 'transparent'} fillOpacity={p.amount != null ? 0.75 : 0} stroke={c} strokeWidth="2"
              style={{ cursor: 'pointer', outline: 'none' }}
              onMouseEnter={() => setTip(p.no)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(p.no)} onBlur={() => setTip(null)}
              onClick={() => go(p)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(p); } }} />
          );
        })}
        {tipP && (() => {
          const tw = Math.min(360, 14 + label(tipP).length * 6.4);
          const tx = Math.min(W - R - tw, Math.max(L, x(tipP.score) - tw / 2));
          const ty = Math.max(2, y(tipP.amount) - 44);
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height="26" rx="6" fill="#111827" fillOpacity="0.92" />
              <text x={tx + 7} y={ty + 17} fontSize="12" fill="#fff">{label(tipP)}</text>
            </g>
          );
        })()}
      </svg>
    </section>
  );
}
