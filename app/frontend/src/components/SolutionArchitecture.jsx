import { useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileDown, Network, RefreshCw } from 'lucide-react';
import {
  CARD_H, COL_W, LANE_COLOR, ROW_GAP, STAGES, VB_W, colX, iconUrl, layoutArchitecture, shortName, stageOf, usd,
} from '../lib/architectureLayout';

// A Databricks solution architecture for one use case: the components from the use case's tables to where people use the result, the
// flows between them, why each was chosen, a phased plan and a rough monthly cost. A chat model designs it once and Inspire saves it.

export const ARCHITECTURE_ROUTE = '/api/inspire/implement/architecture';
const BUTTON = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.16em] text-text-tertiary';
const ACCENT = 'var(--color-db-red)';

export default function SolutionArchitecture({ apiFetch, apiPostJson, query, useCase, readOnly = false }) {
  const [design, setDesign] = useState(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `${ARCHITECTURE_ROUTE}?${query}`;

  useEffect(() => {
    let live = true;
    setDesign(undefined);
    apiFetch(url)
      .then((data) => { if (live) { setDesign(data?.design || null); setError(''); } })
      .catch((e) => { if (live) { setDesign(null); setError(e.message); } });
    return () => { live = false; };
  }, [apiFetch, url]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await apiPostJson(url, {});
      setDesign(data?.design || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (design === undefined) return <p data-architecture="loading" className="text-[12px] text-text-tertiary">Loading the solution architecture…</p>;

  const action = !readOnly && (
    <button type="button" onClick={generate} disabled={busy} className={BUTTON} data-architecture-generate="">
      {design ? <RefreshCw size={12} aria-hidden /> : <Network size={12} aria-hidden />}
      {busy ? 'Designing… (about two minutes)' : design ? 'Design again' : 'Design the architecture'}
    </button>
  );

  if (!design) {
    return (
      <section data-architecture="empty" aria-label="Solution architecture" className="rounded-xl border border-dashed border-border p-4">
        <div className={EYEBROW}>Solution architecture</div>
        <p className="mt-1.5 text-[12px] text-text-secondary">
          Design how this use case would run on Databricks: which components, how data flows from its tables, why each one, a phased plan and a rough monthly cost.
        </p>
        {action && <div className="mt-3">{action}</div>}
        {readOnly && <p className="mt-2 text-[11px] text-text-tertiary">No architecture has been designed for this use case yet.</p>}
        {error && <p role="alert" className="mt-2 text-xs text-error-fg">{error}</p>}
      </section>
    );
  }

  return <Design design={design} useCase={useCase} action={action} error={error} />;
}

function Design({ design, useCase, action, error }) {
  const [hover, setHover] = useState(null);
  const govern = design.components.filter((c) => c.lane === 'govern');
  const build = design.components.filter((c) => c.lane === 'build');
  const flowParts = design.components.filter((c) => c.lane !== 'govern' && c.lane !== 'build').sort((a, b) => stageOf(a.lane) - stageOf(b.lane));
  return (
    <section data-architecture="design" aria-label="Solution architecture" className="border-t border-border pt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={EYEBROW}>Solution architecture</span>
        <span className="text-[11px] text-text-tertiary">Designed by AI: review before committing</span>
        <span className="ms-auto flex gap-2">
          <button type="button" onClick={() => exportPdf(design, useCase)} className={BUTTON}><FileDown size={12} aria-hidden />Export PDF</button>
          {action}
        </span>
      </div>
      {design.pattern && (
        <div className="text-[14px] font-semibold text-text-primary"><span className="text-text-tertiary">Pattern · </span>{design.pattern}</div>
      )}
      {design.summary && <p className="mt-1 mb-3 text-[12px] leading-relaxed text-text-secondary">{design.summary}</p>}
      {error && <p role="alert" className="mb-2 text-xs text-error-fg">{error}</p>}

      <div className="rounded-xl border border-border bg-bg p-3">
        <Diagram design={design} hover={hover} onHover={setHover} />
        <Strip title="Built with" items={build} />
        <Strip title="Governed by" items={govern} />
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {flowParts.map((c) => (
          <div key={c.id} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}
            className={`rounded-xl border p-3 transition-colors ${hover === c.id ? 'border-db-red/60 bg-bg-subtle' : 'border-border'}`}>
            <div className="flex items-center gap-2">
              <Icon id={c.id} size={22} />
              <span className="text-[12.5px] font-semibold text-text-primary">{c.name}</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: LANE_COLOR[c.lane] }}>{STAGES[stageOf(c.lane)]?.label}</div>
            {c.role && <div className="mt-1 text-[11.5px] text-text-secondary">{c.role}</div>}
            {c.why && <div className="mt-1 text-[11px] italic text-text-tertiary">Why: {c.why}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className={`${EYEBROW} mb-2`}>Build plan</div>
          <ol className="space-y-2">
            {design.phases.map((p, i) => (
              <li key={`${p.name}-${i}`} className="rounded-lg bg-bg-subtle p-2.5">
                <div className="text-[12px] font-semibold text-text-primary">{i + 1}. {p.name}{p.weeks && <span className="font-normal text-text-tertiary"> · weeks {p.weeks}</span>}</div>
                <ul className="mt-1 list-disc space-y-0.5 ps-4 text-[11.5px] text-text-secondary">{p.steps.map((s, j) => <li key={j}>{s}</li>)}</ul>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className={EYEBROW}>Rough monthly cost</span>
            <span className="text-[16px] font-bold tabular-nums text-db-red-fg" data-architecture-cost="">{usd(design.cost_low)}–{usd(design.cost_high)}</span>
          </div>
          <table className="w-full text-[11.5px]">
            <tbody>
              {design.cost_items.map((c) => (
                <tr key={c.id} className="border-b border-border-subtle align-top">
                  <td className="py-1.5 pe-2 font-medium text-text-primary">{c.name}</td>
                  <td className="py-1.5 pe-2 text-end tabular-nums text-text-secondary">{usd(c.usd_low)}–{usd(c.usd_high)}</td>
                  <td className="py-1.5 text-text-tertiary">{c.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-text-tertiary">Databricks list price in US dollars, pilot scale, excludes people. {design.assumptions.join(' ')}</p>
          <ListBlock title="Before you start" items={design.prerequisites} />
          <ListBlock title="Risks" items={design.risks} />
        </div>
      </div>
      <p className="mt-3 text-[10.5px] text-text-tertiary">
        {[design.model && `Model ${design.model}`, design.created_by && `by ${design.created_by}`, design.review_fixes ? `${design.review_fixes} reviewer fix${design.review_fixes === 1 ? '' : 'es'} applied` : 'passed review first time']
          .filter(Boolean).join(' · ')}
      </p>
    </section>
  );
}

function Strip({ title, items }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-tertiary">
      <Icon id={items[0].id} size={18} />
      <span className="font-semibold text-text-secondary">{title} {items.map((g) => g.name).join(', ')}</span>
      {items[0].role ? ` · ${items[0].role}` : ''}
    </div>
  );
}

function ListBlock({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <div className={EYEBROW}>{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 ps-4 text-[11.5px] text-text-secondary">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  );
}

/** A product icon on a white tile, so every logo reads in both themes. */
function Icon({ id, size }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-white" style={{ width: size, height: size, padding: size * 0.12 }}>
      <img src={iconUrl(id)} alt="" className="h-full w-full object-contain" />
    </span>
  );
}

const THEMED = { card: 'var(--color-surface)', text: 'var(--color-text-primary)', sub: 'var(--color-text-tertiary)', edge: 'var(--color-border-strong)', col: 'var(--color-bg-subtle)', src: 'var(--color-bg)' };
const PRINT = { card: '#ffffff', text: '#111111', sub: '#666666', edge: '#9a9a9a', col: '#f6f6f4', src: '#fafafa' };

export function Diagram({ design, hover = null, onHover, print = false, origin = '' }) {
  const L = useMemo(() => layoutArchitecture(design), [design]);
  const T = print ? PRINT : THEMED;
  const lit = print ? '#d0402a' : ACCENT;
  const curve = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };
  const loopTargets = new Set(L.loops.map((e) => e.to));
  const name = (id) => design.components.find((c) => c.id === id)?.name || id;
  return (
    <div>
      <svg viewBox={`0 0 ${VB_W} ${L.height}`} width="100%" className="block" role="img" aria-label="Solution architecture diagram">
        <defs>
          <marker id="sa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={T.edge} /></marker>
          <marker id="sa-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={lit} /></marker>
        </defs>
        {STAGES.map((st, k) => (
          <g key={st.id}>
            <rect x={colX(k) - 6} y={0} width={COL_W + 12} height={L.height} rx={10} fill={T.col} />
            <text x={colX(k)} y={17} fill={st.color} fontSize={11} fontWeight={700} letterSpacing={1.1}>{st.label.toUpperCase()}</text>
          </g>
        ))}
        {L.entries.map((id) => {
          const b = L.pos.get(id);
          return <path key={`src-${id}`} d={curve(colX(0) + COL_W, L.srcMid + CARD_H / 2, b.x, b.y + CARD_H / 2)} fill="none" stroke={T.edge} strokeWidth={1.3} markerEnd="url(#sa-arrow)" />;
        })}
        {[...L.forward, ...L.same].map((f, i) => {
          const a = L.pos.get(f.from);
          const b = L.pos.get(f.to);
          const on = hover && (f.from === hover || f.to === hover);
          let d;
          if (a.x !== b.x) d = curve(a.x + COL_W, a.y + CARD_H / 2, b.x, b.y + CARD_H / 2);
          else if (b.y > a.y && b.y - a.y <= CARD_H + ROW_GAP) d = `M${a.x + COL_W / 2},${a.y + CARD_H} L${b.x + COL_W / 2},${b.y}`;
          else {
            const x = a.x;
            const y1 = a.y + CARD_H / 2;
            const y2 = b.y + CARD_H / 2;
            d = `M${x},${y1} C${x - 22},${y1} ${x - 22},${y2} ${x},${y2}`;
          }
          return (
            <path key={i} d={d} fill="none" stroke={on ? lit : T.edge} strokeWidth={on ? 2 : 1.3} markerEnd={on ? 'url(#sa-arrow-lit)' : 'url(#sa-arrow)'}>
              <title>{`${name(f.from)} → ${name(f.to)}${f.label ? `: ${f.label}` : ''}`}</title>
            </path>
          );
        })}
        {L.srcBoxes.map((s, i) => (
          <g key={`s${i}`}>
            <rect x={s.x} y={s.y} width={COL_W} height={CARD_H} rx={9} fill={T.src} stroke={STAGES[0].color} strokeOpacity={0.6} strokeDasharray="3 3" />
            <rect x={s.x + 8} y={s.y + 10} width={26} height={26} rx={6} fill="#ffffff" />
            <image href={`${origin}${iconUrl('delta_tables')}`} x={s.x + 11} y={s.y + 13} width={20} height={20} />
            <foreignObject x={s.x + 40} y={s.y + 3} width={COL_W - 46} height={CARD_H - 6}>
              <div style={{ color: T.text, fontSize: 10.5, lineHeight: 1.2, height: '100%', display: 'flex', alignItems: 'center', wordBreak: 'break-all', fontFamily: 'ui-monospace, Menlo, monospace' }}>{s.name}</div>
            </foreignObject>
          </g>
        ))}
        {L.more > 0 && L.srcBoxes.length > 0 && (
          <text x={colX(0) + 8} y={L.srcBoxes[L.srcBoxes.length - 1].y + CARD_H + ROW_GAP + CARD_H / 2 + 4} fill={T.sub} fontSize={11}>+ {L.more} more tables</text>
        )}
        {design.components.filter((c) => L.pos.has(c.id)).map((c) => {
          const p = L.pos.get(c.id);
          const on = hover === c.id;
          return (
            <g key={c.id} onMouseEnter={() => onHover?.(c.id)} onMouseLeave={() => onHover?.(null)} data-architecture-box={c.id}>
              <rect x={p.x} y={p.y} width={COL_W} height={CARD_H} rx={10} fill={T.card} stroke={on ? lit : LANE_COLOR[c.lane]} strokeWidth={on ? 2 : 1.3} />
              <rect x={p.x + 8} y={p.y + 8} width={30} height={30} rx={7} fill="#ffffff" />
              <image href={`${origin}${iconUrl(c.id)}`} x={p.x + 11} y={p.y + 11} width={24} height={24} />
              <foreignObject x={p.x + 44} y={p.y + 3} width={COL_W - 50} height={CARD_H - 6}>
                <div style={{ color: T.text, fontSize: 11.5, fontWeight: 600, lineHeight: 1.15, height: '100%', display: 'flex', alignItems: 'center' }}>{shortName(c.name)}</div>
              </foreignObject>
              {loopTargets.has(c.id) && <text x={p.x + COL_W - 6} y={p.y + 12} textAnchor="end" fill={lit} fontSize={12} fontWeight={700}>↻</text>}
            </g>
          );
        })}
      </svg>
      {L.loops.length > 0 && (
        <div className="mt-2 text-[11px]" style={{ color: T.sub }}>
          <span className="font-semibold" style={{ color: lit }}>↻ Feedback loops: </span>
          {L.loops.map((e) => `${name(e.from)} → ${name(e.to)}${e.label ? ` (${e.label})` : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Opens a print-ready page of the design; the browser's Save as PDF turns it into a PDF. */
function exportPdf(design, useCase) {
  const origin = window.location.origin;
  const diagram = renderToStaticMarkup(<Diagram design={design} print origin={origin} />);
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = design.components.map((c) => `<tr><td class="ic"><img src="${origin}${iconUrl(c.id)}"/></td><td><b>${esc(c.name)}</b></td><td>${esc(c.role)}</td><td><i>${esc(c.why)}</i></td></tr>`).join('');
  const cost = design.cost_items.map((c) => `<tr><td>${esc(c.name)}</td><td>${usd(c.usd_low)}–${usd(c.usd_high)}</td><td>${esc(c.basis)}</td></tr>`).join('');
  const phases = design.phases.map((p) => `<li><b>${esc(p.name)}</b>${p.weeks ? ` (weeks ${esc(p.weeks)})` : ''}<ul>${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></li>`).join('');
  const list = (title, items) => (items.length ? `<h2>${title}</h2><ul>${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '');
  w.document.write(`<!doctype html><html><head><title>${esc(useCase?.name || 'Solution architecture')}</title><style>
    @page{size:A4 landscape;margin:14mm} body{font-family:-apple-system,"Segoe UI",sans-serif;color:#111;margin:0;font-size:12px}
    h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.08em;color:#b2301c}
    table{border-collapse:collapse;width:100%} td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top} .muted{color:#666}
    .ic{width:26px} .ic img{width:20px;height:20px;object-fit:contain} .pattern{font-size:14px;font-weight:600;margin:8px 0 2px}</style></head><body>
    <h1>${esc(useCase?.name)}</h1>${useCase?.description ? `<div class="muted">${esc(useCase.description)}</div>` : ''}
    <h2>Solution architecture</h2>${design.pattern ? `<div class="pattern">Pattern · ${esc(design.pattern)}</div>` : ''}<p>${esc(design.summary)}</p>${diagram}
    <h2>Components</h2><table>${rows}</table>
    <h2>Build plan</h2><ol>${phases}</ol>
    <h2>Rough monthly cost: ${usd(design.cost_low)}–${usd(design.cost_high)}</h2><table>${cost}</table>
    <p class="muted">Databricks list price in US dollars, pilot scale, excludes people. ${esc(design.assumptions.join(' '))}</p>
    ${list('Before you start', design.prerequisites)}${list('Risks', design.risks)}
    <p class="muted">Designed by AI in Inspire; review before committing.</p>
    <script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}
