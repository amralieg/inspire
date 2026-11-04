import { useEffect, useRef, useState } from 'react';
import echarts from './echarts.js';
import { HORIZONS, chartIsEmpty, chartOption } from './charts.js';
import { countOf, largestFirst, numberOf } from './format.js';
import { chartPalette, hueVars, reducedMotion } from './theme.js';
import { Icon } from './icons.jsx';
import { Menu, Skeleton, useToast } from './ui.jsx';
import { saveBlob, saveDataUrl } from './api.js';
import { barsContext, chartContext } from './explain.js';
import { ExplainButton } from './Genie.jsx';
import { AskGenie } from './AskGenie.jsx';
import { genieOn } from './genieAsk.js';
import { useFx } from './Fx.jsx';
import { FoldButton, useFold } from './MyView.jsx';

export function useChart(option, deps) {
  const el = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (!el.current || !option) return undefined;
    inst.current = echarts.init(el.current, null, { renderer: 'canvas' });
    const observer = new ResizeObserver(() => inst.current?.resize());
    observer.observe(el.current);
    return () => { observer.disconnect(); inst.current?.dispose(); inst.current = null; };
  }, [!!option]);
  useEffect(() => {
    if (inst.current && option) inst.current.setOption(option, true);
  }, deps);
  return { el, inst };
}

const VBAR_PX = 118;

function HBar({ b, max, onPick, picked }) {
  const { props, tip } = useFx(b.formula);
  const body = (
    <>
      <span title={b.label}>{b.label}</span>
      <span className="hb-t"><i style={{ width: `${(numberOf(b.value) / max) * 100}%` }} /></span>
      <b>{b.text}</b>
      {tip}
    </>
  );
  return onPick
    ? <button type="button" className={`hb ${picked === b.key ? 'is-on' : ''}`} style={hueVars(b.hue)} onClick={() => onPick(b.key)}
        aria-pressed={picked === undefined ? undefined : picked === b.key} title={b.formula ? undefined : `Show ${b.label}`} {...props}>{body}</button>
    : <div className="hb" style={hueVars(b.hue)} tabIndex={b.formula ? 0 : undefined} {...props}>{body}</div>;
}

function HBars({ bars, onPick, picked }) {
  const max = Math.max(1, ...bars.map((b) => numberOf(b.value)));
  return bars.map((b) => <HBar key={b.key} b={b} max={max} onPick={onPick} picked={picked} />);
}

function VBar({ b, max }) {
  const { props, tip } = useFx(b.formula);
  return (
    <div className="vb-c" tabIndex={b.formula ? 0 : undefined} {...props}>
      <b>{b.text}</b>
      <i style={{ height: `${Math.max(2, (numberOf(b.value) / max) * VBAR_PX)}px` }} />
      <span>{b.tick ?? b.label}</span>
      {tip}
    </div>
  );
}

function VBars({ bars, hue }) {
  const max = Math.max(1, ...bars.map((b) => numberOf(b.value)));
  return <div className="vb" style={hueVars(hue)}>{bars.map((b) => <VBar key={b.key} b={b} max={max} />)}</div>;
}

export function BarsCard({ id, title, hint, action, bars, vertical = false, hue = 'green', onPick, picked, loading, empty, x, measure, filters, onExplain, genieBusy }) {
  const fold = useFold(`bars:${id}`);
  const said = [hint, action].filter(Boolean).join(' ');
  const drawn = !loading && bars?.length > 0 ? barsContext({ hint, vertical, x, measure, filters }, bars) : null;
  const explain = onExplain && drawn ? () => onExplain('chart', title, drawn) : null;
  const top = !loading && bars?.length ? [...bars].sort((a, b) => largestFirst(countOf(a.value), countOf(b.value)))[0] : null;
  return (
    <article className={`card ${fold.folded ? 'card--folded' : ''}`} data-bars={id}>
      <header className="card-h">
        <div><h2>{title}</h2>{fold.folded ? top && <p data-fold-sum>{`Largest: ${top.label}, ${top.text}`}</p> : said && <p>{said}</p>}</div>
        {!fold.folded && explain && <ExplainButton title={title} busy={genieBusy} onClick={explain} />}
        <AskGenie kind="chart" title={title} context={drawn || { hint: said, filters }} />
        <FoldButton fold={fold} title={title} />
      </header>
      {!fold.folded && (
        <div className="cb" role={vertical ? 'img' : undefined} aria-label={vertical ? `${title}: ${(bars || []).map((b) => `${b.label} ${b.text}`).join(', ')}` : undefined}>
          {loading && <div className="chart-skel"><Skeleton height={150} /></div>}
          {!loading && !bars?.length && <p className="empty">{empty}</p>}
          {!loading && bars?.length > 0 && (vertical ? <VBars bars={bars} hue={hue} /> : <HBars bars={bars} onPick={onPick} picked={picked} />)}
        </div>
      )}
    </article>
  );
}

export default function ChartCard({ chart, wide, result, error, loading, themeKey, app, pageId, onPick, onExplain, genieBusy }) {
  const fold = useFold(`chart:${chart.id}`);
  const [horizon, setHorizon] = useState(0);
  const shown = chart.type === 'band' && horizon ? { ...chart, horizon } : chart;
  const rows = result?.rows || [];
  const empty = !loading && !error && chartIsEmpty(chart, rows);
  const option = !fold.folded && !loading && !error && !empty ? chartOption(shown, rows, chartPalette(), { reduced: reducedMotion() }) : null;
  const { el, inst } = useChart(option, [result, themeKey, loading, error, fold.folded, horizon]);
  const toast = useToast();
  const more = useRef(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const i = inst.current;
    if (!i || !chart.click_filter || !onPick) return undefined;
    const handler = (e) => {
      const key = chart.type === 'scatter' ? e.data?.[2] : e.data?.pick ?? e.name;
      if (key != null && key !== 'Other' && key !== 'Unknown') onPick(chart.click_filter, key);
    };
    i.on('click', handler);
    return () => i.off('click', handler);
  });

  const exportImage = (kind) => {
    const name = `${pageId}_${chart.id}`;
    const P = chartPalette();
    if (kind === 'png') {
      saveDataUrl(inst.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: P.card }), `${name}.png`);
    } else {
      const ssr = echarts.init(null, null, { renderer: 'svg', ssr: true, width: el.current.clientWidth, height: el.current.clientHeight });
      ssr.setOption({ ...chartOption(shown, rows, P, { reduced: true }), animation: false, backgroundColor: P.card });
      const svg = ssr.renderToSVGString();
      ssr.dispose();
      saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    }
    toast(`Downloaded ${kind.toUpperCase()}`);
  };
  const drawn = !loading && !error ? chartContext(chart, result) : { hint: chart.hint || '', type: chart.type, rows: [], row_count: 0 };
  const explain = genieOn(app, pageId) && onExplain && option ? () => onExplain('chart', chart.title, chartContext(chart, result)) : null;

  const items = [];
  if (app.image_export && option) {
    items.push({ label: 'Download PNG', icon: <Icon name="image" size={14} />, run: () => exportImage('png') });
    items.push({ label: 'Download SVG', icon: <Icon name="code" size={14} />, run: () => exportImage('svg') });
  }

  return (
    <article className={`card ${wide ? 'card--wide' : ''} ${fold.folded ? 'card--folded' : ''}`} data-card={chart.id}>
      <header className="card-h">
        <div>
          <h2>{chart.title}</h2>{chart.hint && <p>{chart.hint}{!fold.folded && chart.click_filter ? ' Click a bar or slice to filter the page.' : ''}</p>}
          {chart.so_what && <p className="so-what" data-so-what><b>So what:</b> {chart.so_what}</p>}
        </div>
        {chart.type === 'band' && !fold.folded && (
          <div className="seg" role="group" aria-label="Forecast horizon" data-horizon>
            {[0, ...HORIZONS].map((h) => (
              <button key={h} type="button" className={`seg-b ${horizon === h ? 'is-on' : ''}`} aria-pressed={horizon === h} onClick={() => setHorizon(h)}>
                {h ? `${h} ahead` : 'All'}
              </button>
            ))}
          </div>
        )}
        {explain && <ExplainButton title={chart.title} busy={genieBusy} onClick={explain} />}
        <AskGenie kind="chart" title={chart.title} context={drawn} />
        {items.length > 0 && (
          <button ref={more} className="ibtn ibtn--sm" aria-label={`Export ${chart.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="dots" size={16} />
          </button>
        )}
        {menu && <Menu anchor={more.current} onClose={() => setMenu(false)} items={items} label={`Export ${chart.title}`} />}
        <FoldButton fold={fold} title={chart.title} />
      </header>
      {!fold.folded && (
        <div className="chart" role="img" aria-label={chart.title}>
          {loading && <div className="chart-skel"><Skeleton height="100%" /></div>}
          {error && <p className="tile-err"><Icon name="info" size={14} />This chart could not load: {error}</p>}
          {empty && <p className="empty">No data for these filters.</p>}
          {option && <div ref={el} style={{ position: 'absolute', inset: 0 }} />}
        </div>
      )}
    </article>
  );
}
