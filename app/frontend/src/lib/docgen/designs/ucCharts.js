// C27 (REQ-564): the charts every document draws per use case and for the portfolio (PDF, Word, infographic).
// Amr (27 Nov): "MAKE THE PDF colorful, exciting, with tons of graph that are different per use case, or depends on the use case".
// The lead chart of a use case follows its analytics technique (a forecast gets a trend with a band, a segmentation a donut, ...); the second
// shows its real scores or its value by year. Shapes that only show the kind of result are labeled "Illustrative"; every number printed is real.
// Contract: each chart is a standalone <svg> string whose root carries data-chart="<type>" and, for one use case, data-uc="<id>".
import { esc } from './core.js';
import { LB } from '../docLabels.js';
import { fieldOf, inspireScoreFromUc, scoreOf, trackingIdOf } from '../../useCaseFields.js';
import { moneyText } from '../../valueWizard.js';

// The deck's palette (agentPptx.js, DOC_COLORS): teal, coral, gold, teal mid, green, amber, plus ink and quiet tones.
export const UC_PALETTE = {
  cats: ['#0f5e5a', '#e2725b', '#c9a24b', '#13746e', '#1f9d55', '#d9922e', '#2272b4', '#7b52c9'],
  ink: '#1f2a33', muted: '#6a7681', track: '#efe7d6', soft: '#dcefec', bg: '#ffffff', grid: '#e4dccb', hot: '#d1495b', cool: '#bfe3df',
};
const FONT = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif';
const QUALITY_ORDER = ['Ultra High', 'Very High', 'High', 'Medium', 'Low', 'Very Low', 'Ultra Low'];
const ILLUSTRATIVE = 'Illustrative shape';

// ---- the facts a chart reads from one use case: the docModel shape, an agent view (with .uc) or a raw record ----
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export function ucFacts(u) {
  const raw = u && typeof u.uc === 'object' && u.uc ? u.uc : u || {};
  const techFact = Array.isArray(u?.facts) ? (u.facts.find((f) => f[0] === 'analytics_technique') || [])[2] : '';
  const quality = String(u?.quality || fieldOf(raw, 'Quality', 'quality') || '').trim();
  const v = u?.value && typeof u.value === 'object' ? u.value : null;
  const amount = v && num(v.amount) !== null ? Number(v.amount) : null;
  const yearly = (v && Array.isArray(v.yearly) ? v.yearly : []).filter((y) => y && num(y.likely) !== null);
  return {
    id: String(u?.id || trackingIdOf(raw) || ''), name: String(u?.name || u?.title || fieldOf(raw, 'Name', 'name') || ''),
    technique: String(u?.technique || techFact || fieldOf(raw, 'Analytics Technique', 'analytics_technique') || '').trim(),
    domain: String(u?.domain || fieldOf(raw, 'Business Domain', 'business_domain') || '').trim(), subdomain: String(u?.subdomain || fieldOf(raw, 'Subdomain', 'subdomain') || '').trim(),
    score: num(u?.score) ?? inspireScoreFromUc(raw), priority: num(u?.priorityScore) ?? scoreOf(raw, 'Priority Score', 'priority_score'),
    feasibility: num(u?.feasibility) ?? scoreOf(raw, 'Feasibility', 'feasibility'), valueScore: num(u?.valueScore) ?? scoreOf(raw, 'Value', 'value_score'),
    qualityScore: scoreOf(raw, 'Quality Score', 'quality_score'), quality: QUALITY_ORDER.find((q) => q.toLowerCase() === quality.toLowerCase()) || '',
    amount, currency: v?.currency || 'USD', valueText: amount !== null ? v.text || moneyText(v.currency || 'USD', amount) : '',
    yearly: yearly.map((y) => ({ year: y.year, low: num(y.low), likely: Number(y.likely), high: num(y.high) })),
    kpis: (Array.isArray(u?.kpis) ? u.kpis : []).map(String).filter(Boolean),
  };
}

// A stable hash, and a seeded random so each use case's shape is its own but the same on every build.
export const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const seeded = (seed) => { let a = hashOf(seed) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---- the technique families: [pattern, lead, alternative]; the first match wins (specific families first) ----
const FAMILIES = [
  [/surviv|lifetime|time[- ]to[- ]|hazard/i, 'survival', 'risk'],
  [/process mining|process|workflow|journey|funnel|conversion/i, 'funnel', 'waterfall'],
  [/agent|q&a|question|assistant|genie|chat|nlq|llm|generative|natural language/i, 'agent-flow', 'funnel'],
  [/causal|uplift|experiment|a\/b|attribution|impact|incremental/i, 'impact', 'bridge'],
  [/benchmark|peer|compar/i, 'peers', 'ranked'],
  [/decompos|variance|driver|root cause|bridge|contribution/i, 'bridge', 'peers'],
  [/geo|spatial|location|route|map|territor/i, 'grid-map', 'network'],
  [/network|graph|link analysis|relationship/i, 'network', 'scatter'],
  [/anomal|outlier|control|fraud|audit|detect/i, 'scatter', 'risk'],
  [/forecast|time[- ]?series|demand|trend|projection/i, 'trend', 'gauge'],
  [/segment|cluster|cohort|persona/i, 'donut', 'treemap'],
  [/recommend|next best|ranking|personali|match/i, 'ranked', 'donut'],
  [/queue|capacity|staffing|throughput/i, 'waterfall', 'before-after'],
  [/simulat|monte carlo|scenario|what[- ]if/i, 'before-after', 'trend'],
  [/optimi|linear prog|allocation|schedul|pricing|routing/i, 'before-after', 'waterfall'],
  [/classif|churn|propensity|scoring|predict|regression|risk|likelihood/i, 'risk', 'gauge'],
];
export const LEAD_TYPES = ['trend', 'survival', 'risk', 'gauge', 'before-after', 'waterfall', 'donut', 'treemap', 'ranked', 'scatter', 'network', 'impact', 'bridge', 'peers', 'grid-map', 'funnel', 'agent-flow'];
export const SCORE_TYPES = ['score-bars', 'radar', 'score-rings'];
export const PORTFOLIO_TYPES = ['domain-value', 'domain-donut', 'quality-mix', 'matrix', 'top'];
const scoreAxes = (f) => [[LB('Inspire Score'), f.score, 10], [LB('Priority'), f.priority, 10], [LB('Value'), f.valueScore, 5], [LB('Feasibility'), f.feasibility, 5], [LB('Quality'), f.qualityScore, 5]]
  .filter(([, v]) => v !== null);

// The chart types of one use case, lead first: [lead (by technique), second (scores or value by year), alternative of the family].
export function chartTypesFor(uc) {
  const f = ucFacts(uc);
  const fam = FAMILIES.find(([re]) => re.test(f.technique));
  const h = hashOf(f.technique.toLowerCase());
  const lead = fam ? fam[1] : LEAD_TYPES[h % LEAD_TYPES.length];
  const alt = fam ? fam[2] : LEAD_TYPES[(h >>> 5) % LEAD_TYPES.length] === lead ? 'gauge' : LEAD_TYPES[(h >>> 5) % LEAD_TYPES.length];
  const axes = scoreAxes(f).length;
  const second = f.yearly.length >= 2 ? 'value-years' : axes >= 3 ? SCORE_TYPES[h % SCORE_TYPES.length] : ['score-bars', 'score-rings'][h % 2];
  return [lead, second, alt === lead || alt === second ? 'gauge' : alt];
}

// ---- drawing helpers (plain SVG strings) ----
const r1 = (n) => Math.round(n * 10) / 10;
const txt = (x, y, s, { size = 11, fill, weight = 400, anchor = 'start', op } = {}) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${Math.max(12, size)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${op != null ? ` fill-opacity="${op}"` : ''}>${esc(LB(s))}</text>`;
const box = (x, y, w, h, fill, o = {}) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${fill}"${o.op != null ? ` fill-opacity="${o.op}"` : ''}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}/>`;
const seg = (x1, y1, x2, y2, c, w = 1, dash = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
const dot = (cx, cy, r, fill, o = {}) => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"${o.op != null ? ` fill-opacity="${o.op}"` : ''}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1.5}"` : ''}/>`;
const path = (d, stroke, w = 2, o = {}) => `<path d="${d}" fill="${o.fill || 'none'}"${o.fop != null ? ` fill-opacity="${o.fop}"` : ''} stroke="${stroke}" stroke-width="${w}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
const poly = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join(' ');
const arcPath = (cx, cy, r0, r1x, a0, a1) => {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1x, a0); const [x1, y1] = p(r1x, a1); const [x2, y2] = p(r0, a1); const [x3, y3] = p(r0, a0);
  return `M${r1(x0)} ${r1(y0)} A${r1x} ${r1x} 0 ${big} 1 ${r1(x1)} ${r1(y1)} L${r1(x2)} ${r1(y2)} A${r0} ${r0} 0 ${big} 0 ${r1(x3)} ${r1(y3)} Z`;
};
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// The frame every chart shares: a white card, a colored top rule, the title, the "Illustrative" tag, the plot area and a footnote.
function frame(type, { w, h, P, uc, title, tag, note, accent }, body) {
  title = LB(title); tag = LB(tag); // a fixed text is translated before it is clipped
  const ink = P.ink; const a = accent || P.cats[0];
  const head = `${box(0, 0, w, h, P.bg, { rx: 10, stroke: P.grid })}${box(0, 0, w, 5, a, { rx: 2 })}${txt(14, 24, clip(title, Math.floor((w - (tag ? 146 : 28)) / 6.6)), { size: 12.5, fill: ink, weight: 700 })}`
    + (tag ? `${box(w - 132, 11, 118, 19, P.soft, { rx: 9.5 })}${txt(w - 73, 25, tag, { size: 12, fill: P.muted, anchor: 'middle' })}` : '')
    + (note ? txt(14, h - 10, clip(note, Math.floor((w - 28) / 6.4)), { size: 12, fill: P.muted }) : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" data-chart="${type}"${uc ? ` data-uc="${esc(uc)}"` : ''} role="img" aria-label="${esc(title)}">${head}${body}</svg>`;
}
// The plot box inside the frame.
const plotOf = (w, h, note) => ({ x: 16, y: 38, w: w - 32, h: h - 38 - (note ? 26 : 12) });
const valueNote = (f) => `${LB('Value at stake')}: ${f.valueText} ${LB('a year')}`;
const qualityNote = (f) => `${f.quality} ${LB('quality')}`;
const scoreNote = (f) => (f.amount !== null ? valueNote(f) : f.score !== null ? `${LB('Inspire Score')} ${fmt(f.score)} / 10${f.quality ? ` · ${qualityNote(f)}` : ''}` : f.quality ? qualityNote(f) : '');

// ---- the lead charts (one per technique family) ----
const LEAD = {
  trend: { title: 'Forecast with its range', draw(p, P, rnd) {
    const n = 12; const m = 6; const step = p.w / (n + m - 1); const base = p.y + p.h * 0.62;
    const hist = []; let y = base;
    for (let i = 0; i < n; i += 1) { y += (rnd() - 0.55) * p.h * 0.14 - p.h * 0.012; y = Math.max(p.y + 10, Math.min(p.y + p.h - 18, y)); hist.push([p.x + i * step, y]); }
    const fc = [hist[n - 1]]; let fy = hist[n - 1][1];
    for (let i = 1; i < m; i += 1) { fy -= p.h * 0.035 + rnd() * p.h * 0.03; fc.push([p.x + (n - 1 + i) * step, Math.max(p.y + 14, fy)]); }
    const band = [...fc.map(([x, yy], i) => [x, yy - i * p.h * 0.04]), ...fc.map(([x, yy], i) => [x, yy + i * p.h * 0.04]).reverse()];
    const grid = [0.25, 0.5, 0.75].map((t) => seg(p.x, p.y + p.h * t, p.x + p.w, p.y + p.h * t, P.grid, 1, '3 4')).join('');
    const split = hist[n - 1][0];
    return `${grid}<path d="${poly(band)} Z" fill="${P.cats[2]}" fill-opacity=".28" stroke="none"/>${path(poly(hist), P.cats[0], 2.6)}${path(poly(fc), P.cats[1], 2.6, { dash: '6 4' })}`
      + `${seg(split, p.y, split, p.y + p.h - 12, P.muted, 1, '2 3')}${dot(...hist[n - 1], 4, P.cats[0])}${txt(p.x, p.y + p.h, 'History', { size: 10, fill: P.muted })}${txt(p.x + p.w, p.y + p.h, 'Forecast', { size: 10, fill: P.cats[1], anchor: 'end', weight: 700 })}`;
  } },
  survival: { title: 'Survival with action', draw(p, P, rnd) {
    const steps = 10; const sw = p.w / steps; const top = p.y + 6; const span = p.h - 30;
    const curve = (drop) => { const pts = [[p.x, top]]; let y = top; for (let i = 1; i <= steps; i += 1) { y += span * drop * (0.6 + rnd() * 0.8) / steps; pts.push([p.x + (i - 1) * sw + sw, pts[pts.length - 1][1]]); pts.push([p.x + i * sw, Math.min(top + span, y)]); } return pts; };
    const a = curve(0.75); const b = curve(0.38);
    return `${seg(p.x, top + span, p.x + p.w, top + span, P.grid, 1)}<path d="${poly(b)} L${r1(p.x + p.w)} ${r1(top + span)} L${p.x} ${r1(top + span)} Z" fill="${P.cats[0]}" fill-opacity=".12" stroke="none"/>`
      + `${path(poly(a), P.cats[1], 2.4)}${path(poly(b), P.cats[0], 2.8)}${dot(p.x + 10, p.y + p.h - 6, 4, P.cats[0])}${txt(p.x + 18, p.y + p.h - 2, 'With action', { size: 10, fill: P.ink })}`
      + `${dot(p.x + 110, p.y + p.h - 6, 4, P.cats[1])}${txt(p.x + 118, p.y + p.h - 2, 'Without action', { size: 10, fill: P.ink })}`;
  } },
  risk: { title: 'Risk: who to act on first', draw(p, P, rnd) {
    const n = 14; const bw = p.w / n; const peak = 3 + Math.floor(rnd() * 3); const cut = n - 4;
    const bars = Array.from({ length: n }, (_, i) => { const v = Math.exp(-((i - peak) ** 2) / 9) * 0.85 + 0.08 + rnd() * 0.1; const bh = v * (p.h - 22); return box(p.x + i * bw + 1.5, p.y + p.h - 16 - bh, bw - 3, bh, i >= cut ? P.hot : P.cats[0], { rx: 2, op: i >= cut ? 0.95 : 0.55 + i * 0.03 }); }).join('');
    const cx = p.x + cut * bw;
    return `${bars}${seg(cx, p.y, cx, p.y + p.h - 14, P.hot, 1.5, '4 3')}${txt(cx + 5, p.y + 10, 'Act on these', { size: 10, fill: P.hot, weight: 700 })}`
      + `${txt(p.x, p.y + p.h, 'Low risk', { size: 10, fill: P.muted })}${txt(p.x + p.w, p.y + p.h, 'High risk', { size: 10, fill: P.hot, anchor: 'end' })}`;
  } },
  gauge: { title: 'Readiness gauge', real: true, draw(p, P, rnd, f) {
    const cx = p.x + p.w / 2; const r = Math.min(p.w / 2 - 6, p.h - 22); const cy = p.y + r + 6; const s = f.score ?? (f.qualityScore !== null ? f.qualityScore * 2 : 5);
    const bands = [[0, 0.4, P.hot], [0.4, 0.7, P.cats[5]], [0.7, 1, P.cats[4]]].map(([a, b, c]) => `<path d="${arcPath(cx, cy, r * 0.68, r, Math.PI + a * Math.PI, Math.PI + b * Math.PI)}" fill="${c}" fill-opacity=".85"/>`).join('');
    const ang = Math.PI + (Math.max(0, Math.min(10, s)) / 10) * Math.PI;
    return `${bands}${seg(cx, cy, cx + Math.cos(ang) * r * 0.86, cy + Math.sin(ang) * r * 0.86, P.ink, 3.2)}${dot(cx, cy, 6, P.ink)}`
      + (f.score !== null ? `${txt(cx, cy - r * 0.28, `${fmt(f.score)} / 10`, { size: 18, fill: P.ink, weight: 800, anchor: 'middle' })}${txt(cx, cy + 16, 'Inspire Score', { size: 10, fill: P.muted, anchor: 'middle' })}` : '');
  } },
  'before-after': { title: 'Today against optimized', draw(p, P, rnd) {
    const g = 4; const gw = p.w / g; const bw = gw * 0.3;
    const cols = Array.from({ length: g }, (_, i) => { const a = 0.55 + rnd() * 0.4; const b = a * (0.45 + rnd() * 0.3); const H = p.h - 30; const x = p.x + i * gw + gw * 0.15;
      return `${box(x, p.y + 8 + H * (1 - a), bw, H * a, P.muted, { rx: 3, op: 0.45 })}${box(x + bw + 4, p.y + 8 + H * (1 - b), bw, H * b, P.cats[i % 2 ? 3 : 0], { rx: 3 })}`
        + seg(x + bw / 2, p.y + 8 + H * (1 - a) - 4, x + bw * 1.5 + 4, p.y + 8 + H * (1 - b) - 4, P.cats[1], 1.4, '3 3'); }).join('');
    return `${seg(p.x, p.y + p.h - 22, p.x + p.w, p.y + p.h - 22, P.grid, 1)}${cols}${box(p.x, p.y + p.h - 12, 10, 10, P.muted, { rx: 2, op: 0.45 })}${txt(p.x + 14, p.y + p.h - 3, 'Today', { size: 10, fill: P.ink })}`
      + `${box(p.x + 70, p.y + p.h - 12, 10, 10, P.cats[0], { rx: 2 })}${txt(p.x + 84, p.y + p.h - 3, 'Optimized', { size: 10, fill: P.ink })}`;
  } },
  waterfall: { title: 'From today to the target', draw(p, P, rnd) {
    const n = 6; const bw = p.w / n; const H = p.h - 20; let level = 0.92; let out = '';
    out += box(p.x + 4, p.y + H * (1 - level), bw - 8, H * level, P.muted, { rx: 3, op: 0.55 });
    for (let i = 1; i < n - 1; i += 1) { const d = 0.08 + rnd() * 0.12; const y0 = p.y + H * (1 - level); out += box(p.x + i * bw + 4, y0, bw - 8, H * d, P.cats[(i % 3) + 1], { rx: 3 }); out += seg(p.x + i * bw - 4, y0, p.x + i * bw + 4, y0, P.muted, 1, '2 2'); level -= d; }
    out += box(p.x + (n - 1) * bw + 4, p.y + H * (1 - level), bw - 8, H * level, P.cats[0], { rx: 3 });
    return `${out}${txt(p.x + bw / 2, p.y + p.h, 'Today', { size: 10, fill: P.muted, anchor: 'middle' })}${txt(p.x + p.w / 2, p.y + p.h, 'Improvements', { size: 10, fill: P.muted, anchor: 'middle' })}${txt(p.x + p.w - bw / 2, p.y + p.h, 'Target', { size: 10, fill: P.cats[0], anchor: 'middle', weight: 700 })}`;
  } },
  donut: { title: 'Segments in the data', draw(p, P, rnd) {
    const n = 5; const parts = Array.from({ length: n }, () => 0.4 + rnd()); const tot = parts.reduce((a, b) => a + b, 0);
    const r = Math.min(p.h / 2 - 4, p.w / 4); const cx = p.x + r + 8; const cy = p.y + p.h / 2; let a = -Math.PI / 2;
    const arcs = parts.map((v, i) => { const b = a + (v / tot) * Math.PI * 2; const d = arcPath(cx, cy, r * 0.58, r, a, b - 0.02); a = b; return `<path d="${d}" fill="${P.cats[i]}"/>`; }).join('');
    const step = Math.min(20, (p.h - 4) / n); // the legend stays inside the plot, clear of the caption line
    const leg = parts.map((_, i) => `${box(cx + r + 22, p.y + 2 + i * step, 11, 11, P.cats[i], { rx: 3 })}${txt(cx + r + 40, p.y + 12 + i * step, LB(`Segment ${String.fromCharCode(65 + i)}`), { size: 10.5, fill: P.ink })}`).join('');
    return `${arcs}${txt(cx, cy + 4, LB(`${n} segments`), { size: 11, fill: P.ink, weight: 700, anchor: 'middle' })}${leg}`;
  } },
  treemap: { title: 'Clusters by size', draw(p, P, rnd) {
    const parts = Array.from({ length: 6 }, () => 0.3 + rnd()).sort((a, b) => b - a); const tot = parts.reduce((a, b) => a + b, 0);
    let x = p.x; let y = p.y; let w = p.w; let h = p.h; let out = '';
    parts.forEach((v, i) => { const share = v / parts.slice(i).reduce((a, b) => a + b, 0); const horiz = w >= h;
      const cw = horiz ? w * share : w; const ch = horiz ? h : h * share; out += box(x + 1.5, y + 1.5, cw - 3, ch - 3, P.cats[i], { rx: 4, op: 0.9 });
      if (cw > 52 && ch > 20) out += txt(x + 8, y + 17, LB(`Cluster ${i + 1}`), { size: 10, fill: '#ffffff', weight: 700 });
      if (horiz) { x += cw; w -= cw; } else { y += ch; h -= ch; } });
    void tot; return out;
  } },
  ranked: { title: 'Ranked recommendations', draw(p, P, rnd) {
    const n = 6; const rh = p.h / n; let v = 1;
    return Array.from({ length: n }, (_, i) => { const bw = (p.w - 40) * v; v *= 0.72 + rnd() * 0.18; const y = p.y + i * rh;
      return `${txt(p.x, y + rh * 0.68, `#${i + 1}`, { size: 10.5, fill: P.muted, weight: 700 })}${box(p.x + 30, y + rh * 0.18, p.w - 40, rh * 0.64, P.track, { rx: rh * 0.32 })}${box(p.x + 30, y + rh * 0.18, bw, rh * 0.64, P.cats[i % P.cats.length], { rx: rh * 0.32 })}`; }).join('');
  } },
  scatter: { title: 'Outliers to review', draw(p, P, rnd) {
    const pts = Array.from({ length: 46 }, () => [p.x + 20 + (rnd() * 0.5 + rnd() * 0.5) * (p.w - 40), p.y + 10 + (rnd() * 0.5 + rnd() * 0.5) * (p.h - 30)]);
    const out = Array.from({ length: 4 }, (_, i) => [p.x + (i % 2 ? p.w - 18 - rnd() * 30 : 18 + rnd() * 30), p.y + (i < 2 ? 10 + rnd() * 20 : p.h - 30 - rnd() * 14)]);
    return `${seg(p.x, p.y + p.h - 14, p.x + p.w, p.y + p.h - 14, P.grid, 1)}${seg(p.x, p.y, p.x, p.y + p.h - 14, P.grid, 1)}${pts.map(([x, y]) => dot(x, y, 3.2, P.cats[0], { op: 0.55 })).join('')}`
      + `${out.map(([x, y]) => `${dot(x, y, 4.2, P.hot)}${dot(x, y, 9, 'none', { stroke: P.hot, sw: 1.4 })}`).join('')}${txt(p.x + p.w, p.y + p.h, 'Flagged', { size: 10, fill: P.hot, anchor: 'end', weight: 700 })}`;
  } },
  network: { title: 'Hubs and their links', draw(p, P, rnd) {
    const n = 14; const cx = p.x + p.w / 2; const cy = p.y + p.h / 2 - 4;
    const nodes = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + rnd() * 0.4; const rr = (i % 3 ? 0.9 : 0.5) * Math.min(p.w / 2 - 12, p.h / 2 - 10); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]; });
    const hubs = [0, 5, 9]; const edges = [];
    for (let i = 0; i < n; i += 1) { edges.push([i, hubs[i % 3]]); if (rnd() > 0.6) edges.push([i, (i + 1) % n]); }
    edges.push([0, 5], [5, 9], [9, 0]);
    return `${edges.filter(([a, b]) => a !== b).map(([a, b]) => seg(...nodes[a], ...nodes[b], hubs.includes(a) && hubs.includes(b) ? P.cats[1] : P.grid, hubs.includes(a) && hubs.includes(b) ? 2.2 : 1.2)).join('')}`
      + nodes.map(([x, y], i) => (hubs.includes(i) ? `${dot(x, y, 10, P.cats[hubs.indexOf(i) + 1])}${dot(x, y, 15, 'none', { stroke: P.cats[hubs.indexOf(i) + 1], sw: 1.2 })}` : dot(x, y, 5, P.cats[0], { op: 0.7 }))).join('');
  } },
  impact: { title: 'Impact of the change', draw(p, P, rnd) {
    const n = 16; const step = p.w / (n - 1); const at = 9; let y = p.y + p.h * 0.6; const act = []; const cf = [];
    for (let i = 0; i < n; i += 1) { y += (rnd() - 0.5) * p.h * 0.08; act.push([p.x + i * step, i < at ? y : y - (i - at + 1) * p.h * 0.045]); cf.push([p.x + i * step, y]); }
    const ix = p.x + at * step - step / 2;
    const gap = [...act.slice(at - 1), ...cf.slice(at - 1).reverse()];
    return `${box(ix, p.y, p.x + p.w - ix, p.h - 16, P.soft, { op: 0.6 })}<path d="${poly(gap)} Z" fill="${P.cats[4]}" fill-opacity=".25" stroke="none"/>${path(poly(cf.slice(at - 1)), P.muted, 2, { dash: '5 4' })}${path(poly(act), P.cats[0], 2.6)}`
      + `${seg(ix, p.y, ix, p.y + p.h - 16, P.cats[1], 1.6)}${txt(ix + 5, p.y + 12, 'Intervention', { size: 10, fill: P.cats[1], weight: 700 })}${txt(p.x, p.y + p.h, 'Actual', { size: 10, fill: P.cats[0], weight: 700 })}${txt(p.x + p.w, p.y + p.h, 'Without the change', { size: 10, fill: P.muted, anchor: 'end' })}`;
  } },
  bridge: { title: 'What drives the change', draw(p, P, rnd) {
    const parts = Array.from({ length: 5 }, () => 0.3 + rnd()); const tot = parts.reduce((a, b) => a + b, 0); const rh = (p.h - 16) / 6; let x = p.x + 70; const W2 = p.w - 76; let out = '';
    out += `${txt(p.x, p.y + rh * 0.7, 'Total', { size: 10.5, fill: P.ink, weight: 700 })}${box(p.x + 70, p.y + rh * 0.15, W2, rh * 0.7, P.cats[0], { rx: 3 })}`;
    parts.forEach((v, i) => { const bw = (v / tot) * W2; const y = p.y + (i + 1) * rh; out += `${txt(p.x, y + rh * 0.7, LB(`Driver ${i + 1}`), { size: 10, fill: P.muted })}${box(x, y + rh * 0.15, bw, rh * 0.7, P.cats[(i % 5) + 1], { rx: 3 })}${seg(x, y - rh * 0.15, x, y + rh * 0.15, P.muted, 1, '2 2')}`; x += bw; });
    return out;
  } },
  peers: { title: 'Against its peers', draw(p, P, rnd) {
    const n = 9; const bw = p.w / n; const me = Math.floor(rnd() * n); const H = p.h - 22; const vals = Array.from({ length: n }, () => 0.35 + rnd() * 0.6);
    const med = [...vals].sort((a, b) => a - b)[Math.floor(n / 2)];
    return `${vals.map((v, i) => box(p.x + i * bw + 3, p.y + H * (1 - v), bw - 6, H * v, i === me ? P.cats[1] : P.cats[0], { rx: 3, op: i === me ? 1 : 0.45 })).join('')}`
      + `${seg(p.x, p.y + H * (1 - med), p.x + p.w, p.y + H * (1 - med), P.ink, 1.4, '5 4')}${txt(p.x + p.w, p.y + H * (1 - med) - 4, 'Peer median', { size: 10, fill: P.ink, anchor: 'end' })}`
      + `${txt(p.x + me * bw + bw / 2, p.y + p.h, 'This unit', { size: 10, fill: P.cats[1], anchor: 'middle', weight: 700 })}`;
  } },
  'grid-map': { title: 'Location heat map', draw(p, P, rnd) {
    const cols = 12; const rows = 6; const cw = p.w / cols; const ch = (p.h - 16) / rows; const hx = rnd() * cols; const hy = rnd() * rows; let out = '';
    const ramp = [P.cool, P.cats[3], P.cats[0], P.cats[5], P.hot];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { if (rnd() < 0.16) continue; const d = Math.hypot(c - hx, (r - hy) * 1.4); const k = Math.max(0, Math.min(4, Math.round(4 - d / 2.2 + rnd() * 0.8))); out += box(p.x + c * cw + 1.5, p.y + r * ch + 1.5, cw - 3, ch - 3, ramp[k], { rx: 3 }); }
    return `${out}${txt(p.x, p.y + p.h, 'Low', { size: 10, fill: P.muted })}${ramp.map((c, i) => box(p.x + 30 + i * 18, p.y + p.h - 9, 16, 9, c, { rx: 2 })).join('')}${txt(p.x + 30 + 5 * 18 + 4, p.y + p.h, 'High', { size: 10, fill: P.hot })}`;
  } },
  funnel: { title: 'Where work drops off', draw(p, P, rnd) {
    const n = 5; const rh = p.h / n; let v = 1;
    return Array.from({ length: n }, (_, i) => { const w = p.w * v; const x = p.x + (p.w - w) / 2; const y = p.y + i * rh; const nv = v * (0.68 + rnd() * 0.2); const w2 = p.w * nv; const x2 = p.x + (p.w - w2) / 2;
      const d = `M${r1(x)} ${r1(y + 2)} L${r1(x + w)} ${r1(y + 2)} L${r1(x2 + w2)} ${r1(y + rh - 2)} L${r1(x2)} ${r1(y + rh - 2)} Z`; v = nv;
      return `<path d="${d}" fill="${P.cats[i % P.cats.length]}" fill-opacity=".9"/>${txt(p.x + p.w / 2, y + rh / 2 + 4, LB(`Step ${i + 1}`), { size: 10.5, fill: '#ffffff', weight: 700, anchor: 'middle' })}`; }).join('');
  } },
  'agent-flow': { title: 'Ask, reason, answer', real: true, draw(p, P, rnd, f) {
    const bw = (p.w - 40) / 3; const bh = Math.min(54, p.h - 40); const y = p.y + 6;
    const steps = [['Question', P.cats[2]], ['Agent', P.cats[0]], ['Answer', P.cats[4]]];
    const boxes = steps.map(([l, c], i) => { const x = p.x + i * (bw + 20); return `${box(x, y, bw, bh, c, { rx: 12 })}${txt(x + bw / 2, y + bh / 2 + 5, l, { size: 12, fill: '#ffffff', weight: 700, anchor: 'middle' })}`
      + (i < 2 ? `${seg(x + bw + 3, y + bh / 2, x + bw + 16, y + bh / 2, P.ink, 2)}<path d="M${r1(x + bw + 17)} ${r1(y + bh / 2)} l-6 -4 v8 Z" fill="${P.ink}"/>` : ''); }).join('');
    const s = f.score; const my = y + bh + 16;
    return boxes + (s !== null ? `${txt(p.x, my + 10, 'Inspire Score', { size: 10, fill: P.muted })}${box(p.x + 78, my + 1, p.w - 130, 10, P.track, { rx: 5 })}${box(p.x + 78, my + 1, (p.w - 130) * Math.min(1, s / 10), 10, P.cats[0], { rx: 5 })}${txt(p.x + p.w, my + 10, `${fmt(s)} / 10`, { size: 10.5, fill: P.ink, weight: 700, anchor: 'end' })}` : '');
  } },
};

// ---- the second charts: the real scores (three visuals) and the value by year ----
const SCORE = {
  'score-bars': { title: 'Scores', draw(p, P, f) {
    const axes = scoreAxes(f); if (!axes.length) return txt(p.x, p.y + 20, 'Not scored yet', { size: 11, fill: P.muted });
    const rh = Math.min(30, p.h / axes.length); const lw = 86; const bw = p.w - lw - 52;
    return axes.map(([l, v, max], i) => { const y = p.y + i * rh; const c = P.cats[i % P.cats.length];
      return `${txt(p.x, y + rh * 0.62, l, { size: 10.5, fill: P.ink })}${box(p.x + lw, y + rh * 0.22, bw, rh * 0.5, P.track, { rx: rh * 0.25 })}${box(p.x + lw, y + rh * 0.22, bw * Math.min(1, v / max), rh * 0.5, c, { rx: rh * 0.25 })}`
        + txt(p.x + p.w, y + rh * 0.62, `${fmt(v)} / ${max}`, { size: 10.5, fill: P.ink, weight: 700, anchor: 'end' }); }).join('');
  } },
  radar: { title: 'Score profile', draw(p, P, f) {
    const axes = scoreAxes(f); const n = axes.length; const r = Math.min(p.h / 2 - 12, p.w / 2 - 70); const cx = p.x + p.w / 2; const cy = p.y + p.h / 2;
    const at = (i, t) => [cx + Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2) * r * t, cy + Math.sin(-Math.PI / 2 + (i / n) * Math.PI * 2) * r * t];
    const rings = [0.33, 0.66, 1].map((t) => `<path d="${poly(axes.map((_, i) => at(i, t)))} Z" fill="none" stroke="${P.grid}" stroke-width="1"/>`).join('');
    const shape = axes.map(([, v, max], i) => at(i, Math.max(0.05, Math.min(1, v / max))));
    return `${rings}${axes.map((_, i) => seg(cx, cy, ...at(i, 1), P.grid, 1)).join('')}<path d="${poly(shape)} Z" fill="${P.cats[0]}" fill-opacity=".3" stroke="${P.cats[0]}" stroke-width="2.4"/>`
      + shape.map(([x, y], i) => dot(x, y, 4, P.cats[(i % 4) + 1])).join('')
      + axes.map(([l, v, max], i) => { const [x, y] = at(i, 1.12); const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end'; return txt(x, y + (y > cy ? 10 : 0), `${l} ${fmt(v)}/${max}`, { size: 10, fill: P.ink, anchor, weight: 600 }); }).join('');
  } },
  'score-rings': { title: 'Scores as rings', draw(p, P, f) {
    const axes = scoreAxes(f).slice(0, 4); const n = Math.max(1, axes.length); const cw = p.w / n; const r = Math.min(cw / 2 - 8, (p.h - 26) / 2);
    return axes.map(([l, v, max], i) => { const cx = p.x + cw * i + cw / 2; const cy = p.y + r + 2; const t = Math.max(0.001, Math.min(0.999, v / max)); const c = P.cats[i % P.cats.length];
      return `${dot(cx, cy, r, 'none', { stroke: P.track, sw: r * 0.32 })}<path d="${arcPath(cx, cy, r * 0.84, r * 1.16, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2)}" fill="${c}"/>`
        + `${txt(cx, cy + 5, fmt(v), { size: Math.max(11, r * 0.5), fill: P.ink, weight: 800, anchor: 'middle' })}${txt(cx, cy + r + 18, `${l} / ${max}`, { size: 10, fill: P.muted, anchor: 'middle' })}`; }).join('');
  } },
  'value-years': { title: 'Value by year', draw(p, P, f) {
    const ys = f.yearly; const top = Math.max(1, ...ys.map((y) => y.high ?? y.likely)); const gw = p.w / ys.length; const H = p.h - 40;
    return ys.map((y, i) => { const x = p.x + i * gw + gw * 0.2; const bw = gw * 0.6; const hl = (H * y.likely) / top; const hh = y.high !== null ? (H * y.high) / top : hl; const hlw = y.low !== null ? (H * y.low) / top : hl;
      return `${box(x, p.y + 20 + H - hh, bw, hh, P.cats[2], { rx: 4, op: 0.3 })}${box(x, p.y + 20 + H - hl, bw, hl, P.cats[i % 2 ? 3 : 0], { rx: 4 })}${seg(x, p.y + 20 + H - hlw, x + bw, p.y + 20 + H - hlw, P.cats[1], 2, '3 2')}`
        + `${txt(x + bw / 2, p.y + 16 + H - hh, moneyText(f.currency, y.likely), { size: 10, fill: P.ink, weight: 700, anchor: 'middle' })}${txt(x + bw / 2, p.y + p.h, `Year ${y.year}`, { size: 10, fill: P.muted, anchor: 'middle' })}`; }).join('');
  } },
};

// One use case chart as a standalone SVG string.
export function ucChartSvg(type, uc, { w = 320, h = 200, palette } = {}) {
  const P = { ...UC_PALETTE, ...(palette || {}) };
  const f = ucFacts(uc);
  const rnd = seeded(`${f.id}|${type}`);
  if (SCORE[type]) {
    const s = SCORE[type]; const note = type === 'value-years' ? `${LB('Likely value a year')}, ${f.valueText} ${LB('in total')}` : f.quality ? qualityNote(f) : '';
    return frame(type, { w, h, P, uc: f.id, title: s.title, note, accent: P.cats[2] }, s.draw(plotOf(w, h, note), P, f));
  }
  const d = LEAD[type] || LEAD.gauge;
  const note = d.real ? (f.amount !== null ? valueNote(f) : f.technique) : [f.technique, scoreNote(f)].filter(Boolean).join(' · ');
  const accent = P.cats[hashOf(type) % 6];
  return frame(LEAD[type] ? type : 'gauge', { w, h, P, uc: f.id, title: d.title, tag: d.real ? '' : ILLUSTRATIVE, note, accent }, d.draw(plotOf(w, h, note), P, rnd, f));
}

// ---- portfolio charts (no data-uc): value or count by domain, the domain mix, the quality mix, the priority matrix and the top opportunities ----
function byDomain(list) {
  const m = new Map();
  for (const f of list) { const k = f.domain || 'Other'; if (!m.has(k)) m.set(k, { name: k, n: 0, amount: 0, best: null }); const d = m.get(k); d.n += 1; if (f.amount !== null && f.currency === list[0].currency) d.amount += f.amount; if (f.score !== null) d.best = Math.max(d.best ?? -Infinity, f.score); }
  return [...m.values()];
}
export function portfolioChartSvg(type, useCases, { w = 520, h = 260, palette } = {}) {
  const P = { ...UC_PALETTE, ...(palette || {}) };
  const list = (useCases || []).map(ucFacts);
  const doms = byDomain(list);
  const withValue = doms.some((d) => d.amount > 0);
  const cur = list.find((f) => f.amount !== null)?.currency || 'USD';
  const note = `${list.length} ${LB('use cases')} · ${doms.length} ${LB('business domains')}`;
  const p = plotOf(w, h, note);
  if (type === 'domain-value') {
    // Rows of at least 17 px so 12 px labels never touch; with values, only the domains that have one.
    const rows = [...doms].filter((d) => !withValue || d.amount > 0).sort((a, b) => (withValue ? b.amount - a.amount : b.n - a.n) || a.name.localeCompare(b.name)).slice(0, Math.max(1, Math.min(12, Math.floor(p.h / 17))));
    const max = Math.max(1, ...rows.map((d) => (withValue ? d.amount : d.n))); const rh = p.h / Math.max(rows.length, 1); const lw = Math.min(170, p.w * 0.36);
    const body = rows.map((d, i) => { const v = withValue ? d.amount : d.n; const y = p.y + i * rh; const bw = (p.w - lw - 70) * (v / max);
      return `${txt(p.x, y + rh * 0.66, clip(d.name, Math.floor(lw / 6.6)), { size: 12, fill: P.ink })}${box(p.x + lw, y + rh * 0.18, p.w - lw - 70, rh * 0.64, P.track, { rx: 3 })}${box(p.x + lw, y + rh * 0.18, Math.max(3, bw), rh * 0.64, P.cats[i % P.cats.length], { rx: 3 })}`
        + txt(p.x + p.w, y + rh * 0.66, withValue ? moneyText(cur, v) : String(v), { size: 12, fill: P.ink, weight: 700, anchor: 'end' }); }).join('');
    return frame('domain-value', { w, h, P, title: withValue ? 'Value at stake by business domain' : 'Use cases by business domain', note }, body);
  }
  if (type === 'domain-donut') {
    const rows = [...doms].sort((a, b) => b.n - a.n); const tot = list.length || 1; const r = Math.min(p.h / 2 - 2, p.w / 4); const cx = p.x + r + 6; const cy = p.y + p.h / 2; let a = -Math.PI / 2;
    const arcs = rows.map((d, i) => { const b = a + (d.n / tot) * Math.PI * 2; const s = `<path d="${arcPath(cx, cy, r * 0.6, r, a, b - 0.015)}" fill="${P.cats[i % P.cats.length]}" fill-opacity="${i < P.cats.length ? 1 : 0.6}"/>`; a = b; return s; }).join('');
    const shown = rows.slice(0, Math.max(1, Math.floor(p.h / 16))); const lh = p.h / Math.max(shown.length, 1);
    const leg = shown.map((d, i) => `${box(cx + r + 18, p.y + i * lh + lh / 2 - 6, 11, 11, P.cats[i % P.cats.length], { rx: 3, op: i < P.cats.length ? 1 : 0.6 })}${txt(cx + r + 34, p.y + i * lh + lh / 2 + 4, `${clip(d.name, Math.floor((w - cx - r - 70) / 6.6))} (${d.n})`, { size: 10.5, fill: P.ink })}`).join('');
    return frame('domain-donut', { w, h, P, title: 'The portfolio by business domain', note }, `${arcs}${txt(cx, cy, String(list.length), { size: 22, fill: P.ink, weight: 800, anchor: 'middle' })}${txt(cx, cy + 15, 'use cases', { size: 10, fill: P.muted, anchor: 'middle' })}${leg}`);
  }
  if (type === 'quality-mix') {
    const colors = { 'Ultra High': '#0b4642', 'Very High': '#0f5e5a', High: '#1f9d55', Medium: '#d9922e', Low: '#e2725b', 'Very Low': '#d1495b', 'Ultra Low': '#9b2c3b', '': '#9aa4ac' };
    const counts = [...QUALITY_ORDER, ''].map((q) => [q, list.filter((f) => f.quality === q).length]).filter(([, n]) => n);
    const tot = list.length || 1; let x = p.x; const bh = Math.min(40, p.h * 0.32);
    const bar = counts.map(([q, n]) => { const bw = (p.w * n) / tot; const s = `${box(x, p.y + 8, bw - 2, bh, colors[q], { rx: 4 })}${bw > 26 ? txt(x + bw / 2, p.y + 8 + bh / 2 + 5, String(n), { size: 13, fill: '#ffffff', weight: 800, anchor: 'middle' }) : ''}`; x += bw; return s; }).join('');
    const leg = counts.map(([q, n], i) => `${box(p.x + (i % 3) * (p.w / 3), p.y + bh + 26 + Math.floor(i / 3) * 20, 11, 11, colors[q], { rx: 3 })}${txt(p.x + (i % 3) * (p.w / 3) + 16, p.y + bh + 36 + Math.floor(i / 3) * 20, `${q || LB('Not scored')}: ${n}`, { size: 10.5, fill: P.ink })}`).join('');
    return frame('quality-mix', { w, h, P, title: 'Quality mix', note }, bar + leg);
  }
  if (type === 'matrix') {
    const yKey = list.some((f) => f.feasibility !== null) ? ['feasibility', LB('Feasibility'), 5] : ['qualityScore', LB('Quality score'), 5];
    const pts = list.filter((f) => f.priority !== null && f[yKey[0]] !== null);
    const xs = pts.map((f) => f.priority); const ys = pts.map((f) => f[yKey[0]]);
    const [x0, x1] = [Math.floor(Math.min(...xs, 10)) - 0.5, Math.ceil(Math.max(...xs, 0)) + 0.5]; const [y0, y1] = [Math.max(0, Math.min(...ys, 5) - 0.5), Math.min(yKey[2], Math.max(...ys, 0) + 0.5)];
    const X = (v) => p.x + 30 + ((v - x0) / Math.max(0.1, x1 - x0)) * (p.w - 40); const Y = (v) => p.y + p.h - 16 - ((v - y0) / Math.max(0.1, y1 - y0)) * (p.h - 26);
    const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
    const quad = `${box(X(mx), p.y, p.x + p.w - 10 - X(mx), Y(my) - p.y, P.soft, { op: 0.7 })}${txt(p.x + p.w - 14, p.y + 13, 'Quick wins', { size: 10.5, fill: P.cats[0], weight: 700, anchor: 'end' })}`;
    const axes = `${seg(p.x + 30, p.y + p.h - 16, p.x + p.w - 10, p.y + p.h - 16, P.muted, 1)}${seg(p.x + 30, p.y, p.x + 30, p.y + p.h - 16, P.muted, 1)}${txt(p.x + 30 + (p.w - 40) / 2, p.y + p.h - 2, 'Priority score', { size: 10, fill: P.muted, anchor: 'middle' })}${txt(p.x, p.y + 8, yKey[1], { size: 10, fill: P.muted })}`;
    const dots = pts.map((f, i) => `${dot(X(f.priority), Y(f[yKey[0]]), 7, P.cats[i % P.cats.length], { op: 0.85 })}`).join('');
    const ticks = [x0 + 0.5, x1 - 0.5].map((v) => txt(X(v), p.y + p.h - 4, fmt(v), { size: 9.5, fill: P.muted, anchor: 'middle' })).join('');
    return frame('matrix', { w, h, P, title: yKey[0] === 'feasibility' ? 'Priority against feasibility' : 'Priority against quality score', note }, quad + axes + ticks + dots);
  }
  // top: the strongest use cases by Inspire score.
  const top = list.filter((f) => f.score !== null).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 6);
  // Each row: the name over its bar (the full name fits), the score at the end of the bar.
  const rows = top.slice(0, Math.max(1, Math.floor(p.h / 26))); const rh = p.h / Math.max(rows.length, 1); const bh = Math.max(6, Math.min(10, rh - 18));
  const body = rows.map((f, i) => { const y = p.y + i * rh; const bw = (p.w - 40) * (f.score / 10);
    return `${txt(p.x, y + 12, clip(f.name, Math.floor((p.w - 40) / 6.6)), { size: 12, fill: P.ink })}${box(p.x, y + 16, p.w - 40, bh, P.track, { rx: bh / 2 })}${box(p.x, y + 16, bw, bh, P.cats[i % P.cats.length], { rx: bh / 2 })}`
      + txt(p.x + p.w, y + 16 + bh, fmt(f.score), { size: 12, fill: P.ink, weight: 800, anchor: 'end' }); }).join('');
  return frame('top', { w, h, P, title: 'Top opportunities by Inspire Score', note }, body);
}
