import { useEffect, useRef, useState } from 'react';
import { HORIZONS, chartIsEmpty, chartOption, clickHint, clickPart, clickPick } from './charts.js';
import { countOf, largestFirst, numberOf } from './format.js';
import { chartPalette, hueVars, reducedMotion } from './theme.js';
import { Icon } from './icons.jsx';
import { Menu, Skeleton, SoWhat, useToast, useRetry } from './ui.jsx';
import { saveBlob, saveDataUrl } from './api.js';
import { barsContext, chartContext, chartItems, chartKind } from './explain.js';
import { ExplainButton } from './Genie.jsx';
import { SectionHelp } from './SectionHelp.jsx';
import { helpLine } from './help.js';
import { CardFailure, useShared } from './PageFailure.jsx';
import { AskGenie } from './AskGenie.jsx';
import { genieOn } from './genieAsk.js';
import { useFx } from './Fx.jsx';
import { FoldButton, useFold } from './MyView.jsx';

export const loadECharts = () => import('./echarts.js').then((m) => m.default);

export function useChart(option, deps, onWidth) {
  const el = useRef(null);
  const inst = useRef(null);
  const latest = useRef(option);
  latest.current = option;
  useEffect(() => {
    if (!el.current || !option) return undefined;
    let gone = false;
    let observer = null;
    loadECharts().then((echarts) => {
      if (gone || !el.current) return;
      inst.current = echarts.init(el.current, null, { renderer: 'canvas' });
      if (latest.current) inst.current.setOption(latest.current, true);
      observer = new ResizeObserver(() => {
        inst.current?.resize();
        if (onWidth && el.current) onWidth(Math.round(el.current.clientWidth / WIDTH_STEP) * WIDTH_STEP);
      });
      observer.observe(el.current);
    });
    return () => { gone = true; observer?.disconnect(); inst.current?.dispose(); inst.current = null; };
  }, [!!option]);
  useEffect(() => {
    if (inst.current && option) inst.current.setOption(option, true);
  }, deps);
  return { el, inst };
}

const VBAR_PX = 118;
const WIDTH_STEP = 8;

function HBar({ b, max, onPick, picked, onFix }) {
  const { props, tip } = useFx(b.formula);
  const body = (
    <>
      <span title={b.label}>{b.label}</span>
      <span className="hb-t"><i style={{ width: `${(numberOf(b.value) / max) * 100}%` }} /></span>
      <b>{b.text}</b>
      {tip}
    </>
  );
  const bar = onPick
    ? <button type="button" className={`hb ${picked === b.key ? 'is-on' : ''}`} style={hueVars(b.hue)} onClick={() => onPick(b.key)}
        aria-pressed={picked === undefined ? undefined : picked === b.key} title={b.formula ? undefined : `Show ${b.label}`} {...props}>{body}</button>
    : <div className="hb" style={hueVars(b.hue)} tabIndex={b.formula ? 0 : undefined} {...props}>{body}</div>;
  if (!onFix || b.fix === false) return bar;
  return (
    <div className="hb-row">
      {bar}
      <button type="button" className="lnk hb-fix" onClick={() => onFix(b.key)} aria-label={`Fix ${b.label}`} data-fix-reason={b.key}>Fix this</button>
    </div>
  );
}

function HBars({ bars, onPick, picked, onFix }) {
  const max = Math.max(1, ...bars.map((b) => numberOf(b.value)));
  return bars.map((b) => <HBar key={b.key} b={b} max={max} onPick={onPick} picked={picked} onFix={onFix} />);
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

export function BarsCard({ id, title, hint, action, bars, vertical = false, hue = 'green', onPick, picked, loading, empty, x, measure, filters, onExplain, genieBusy, onFix }) {
  const fold = useFold(`bars:${id}`);
  const said = [hint, action].filter(Boolean).join(' ');
  const drawn = !loading && bars?.length > 0 ? barsContext({ hint, vertical, x, measure, filters }, bars) : null;
  const explain = onExplain && drawn ? () => onExplain('chart', title, drawn) : null;
  const top = !loading && bars?.length ? [...bars].sort((a, b) => largestFirst(countOf(a.value), countOf(b.value)))[0] : null;
  return (
    <article className={`card ${fold.folded ? 'card--folded' : ''}`} data-bars={id}>
      <header className="card-h">
        <div><h2>{title}</h2>{fold.folded ? top && <p data-fold-sum>{`Largest: ${top.label}, ${top.text}`}</p> : said && <p>{said}</p>}</div>
        <SectionHelp title={title} steps={[{ title, text: helpLine(hint, onPick ? 'Click a bar to filter the page.' : '', action && `So what: ${action}`, explain ? 'Explain asks Genie to walk through this in plain words.' : '') }]} />
        {!fold.folded && explain && <ExplainButton title={title} busy={genieBusy} onClick={explain} />}
        <AskGenie kind="chart" title={title} context={drawn || { hint: said, filters }} />
        <FoldButton fold={fold} title={title} />
      </header>
      {!fold.folded && (
        <div className="cb" role={vertical ? 'img' : undefined} aria-label={vertical ? `${title}: ${(bars || []).map((b) => `${b.label} ${b.text}`).join(', ')}` : undefined}>
          {loading && <div className="chart-skel"><Skeleton height={150} /></div>}
          {!loading && !bars?.length && <p className="empty">{empty}</p>}
          {!loading && bars?.length > 0 && (vertical ? <VBars bars={bars} hue={hue} /> : <HBars bars={bars} onPick={onPick} picked={picked} onFix={onFix} />)}
        </div>
      )}
    </article>
  );
}

export default function ChartCard({ chart, wide, result, error, loading, themeKey, app, pageId, onPick, onExplain, genieBusy }) {
  const retry = useRetry();
  const fold = useFold(`chart:${chart.id}`);
  const shared = useShared(error);
  const [horizon, setHorizon] = useState(0);
  const shown = chart.type === 'band' && horizon ? { ...chart, horizon } : chart;
  const rows = result?.rows || [];
  const empty = !loading && !error && chartIsEmpty(chart, rows);
  const [width, setWidth] = useState(0);
  const option = !fold.folded && !loading && !error && !empty ? chartOption(shown, rows, chartPalette(), { reduced: reducedMotion(), width: width || undefined }) : null;
  const drawnAs = `${chart.type}|${(Array.isArray(chart.y) ? chart.y : []).map((y) => y.label).join('|')}`;
  const { el, inst } = useChart(option, [result, themeKey, loading, error, fold.folded, horizon, width, drawnAs], setWidth);
  const toast = useToast();
  const more = useRef(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const i = inst.current;
    if (!i || !chart.click_filter || !clickPart(chart.type) || !onPick) return undefined;
    const handler = (e) => {
      const key = clickPick(chart.type, e);
      if (key != null) onPick(chart.click_filter, key);
    };
    i.on('click', handler);
    return () => i.off('click', handler);
  });

  const exportImage = (kind) => {
    const name = `${pageId}_${chart.id}`;
    const P = chartPalette();
    if (kind === 'png') {
      saveDataUrl(inst.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: P.card }), `${name}.png`);
      toast(`Downloaded ${kind.toUpperCase()}`);
      return;
    }
    loadECharts().then((echarts) => {
      const ssr = echarts.init(null, null, { renderer: 'svg', ssr: true, width: el.current.clientWidth, height: el.current.clientHeight });
      ssr.setOption({ ...chartOption(shown, rows, P, { reduced: true, width: el.current.clientWidth }), animation: false, backgroundColor: P.card });
      const svg = ssr.renderToSVGString();
      ssr.dispose();
      saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
      toast(`Downloaded ${kind.toUpperCase()}`);
    });
  };
  const drawn = !loading && !error ? chartContext(chart, result) : { hint: chart.hint || '', type: chart.type, rows: [], row_count: 0 };
  const explain = genieOn(app, pageId) && onExplain && option ? () => onExplain('chart', chart.title, chartContext(chart, result)) : null;

  const items = [];
  if (app.image_export && option) {
    items.push({ label: 'Download PNG', icon: <Icon name="image" size={14} />, run: () => exportImage('png') });
    items.push({ label: 'Download SVG', icon: <Icon name="code" size={14} />, run: () => exportImage('svg') });
  }

  return (
    <article className={`card ${wide ? 'card--wide' : ''} ${fold.folded ? 'card--folded' : ''}`} data-card={chart.id} data-rows={option ? rows.length : undefined}>
      <header className="card-h">
        <div>
          <h2>{chart.title}</h2>{chart.hint && <p>{chart.hint}{clickHint(chart, fold.folded)}</p>}
          <SoWhat text={chart.so_what} />
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
        <SectionHelp title={chart.title} steps={[{ title: chart.title, text: helpLine(chart.hint, clickHint(chart).trim(), chart.so_what && `So what: ${chart.so_what}`, explain ? 'Explain asks Genie to walk through this in plain words.' : '') }]} />
        {explain && <ExplainButton title={chart.title} busy={genieBusy} onClick={explain} />}
        {!shared && <AskGenie kind={chartKind(chart)} title={chart.title} context={drawn} items={!loading && !error ? chartItems(chart, result) : []} />}
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
          <CardFailure text={error} prefix="This chart could not load: " onRetry={retry} />
          {empty && <p className="empty">No data for these filters.</p>}
          {option && <div ref={el} style={{ position: 'absolute', inset: 0 }} />}
        </div>
      )}
    </article>
  );
}
