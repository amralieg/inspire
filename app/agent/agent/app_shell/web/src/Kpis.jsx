import { change, changeParts, formatValue, storyPieces } from './format.js';
import { HUES } from './theme.js';
import { Icon } from './icons.jsx';
import { Skeleton } from './ui.jsx';
import { useFx } from './Fx.jsx';
import { Block } from './Blocks.jsx';
import { withBlocks } from './blocks.js';
import { FoldStrip, useFold } from './MyView.jsx';

export const kpiValue = (kpi, data) => formatValue(data?.now, kpi.format, kpi.currency);

export function kpiHues(pageHue, count) {
  const start = Math.max(0, HUES.indexOf(pageHue));
  return Array.from({ length: count }, (_, i) => HUES[(start + i) % HUES.length]);
}

function Delta({ kpi, data, scope }) {
  if (!kpi.compare) return <div className="kpi-s">{kpi.caption || '\u00a0'}</div>;
  const none = scope?.note || kpi.words.none;
  if (data?.before == null) return <div className="kpi-s">{kpi.caption ? `${kpi.caption} · ${none}` : none}</div>;
  const d = change(data?.now, data?.before);
  if (d == null) return <div className="kpi-s">{kpi.caption || '\u00a0'}</div>;
  const { way, text } = changeParts(d, kpi.words);
  const good = kpi.good === 'neutral' || way === 'same' ? null : (kpi.good === 'down') === d < 0;
  return (
    <div className="kpi-s">
      <span className={`delta ${good == null ? '' : good ? 'is-good' : 'is-bad'}`}>{kpi.marks[way]} {text}</span> {kpi.vs}
    </div>
  );
}

export default function Kpis({ page, data, errors, loading, plan, scope }) {
  const fold = useFold('kpis');
  const hues = kpiHues(page.hue, page.kpis.length);
  const entries = withBlocks(page.kpis, plan);
  const index = new Map(page.kpis.map((kpi, i) => [kpi.id, i]));
  const summary = loading ? '' : page.kpis.filter((kpi) => !errors?.[`kpi:${kpi.id}`]).map((kpi) => `${kpi.label} ${kpiValue(kpi, data?.[kpi.id])}`).join(' · ');
  const strip = (
    <section className="kpis" aria-label="Key numbers" data-n={entries.length}>
      {entries.map((entry) => {
        if (entry.block) return <Block key={entry.key} block={entry.block} tile />;
        const kpi = entry.item;
        const i = index.get(kpi.id);
        const error = errors?.[`kpi:${kpi.id}`];
        return (
          <div key={kpi.id} className="kpi" style={{ '--k-line': `var(--${hues[i]}-line)`, '--k-bg': `var(--${hues[i]}-bg)`, '--k-tile': `var(--${hues[i]}-tile)`, '--k-ink': `var(--${hues[i]}-ink)` }}>
            <div className="kpi-l">{kpi.label}</div>
            {loading ? <Skeleton height={30} width="60%" /> : error ? <p className="tile-err"><Icon name="info" size={12} />{error}</p> : (
              <>
                <div className="kpi-v">{kpiValue(kpi, data?.[kpi.id])}</div>
                <Delta kpi={kpi} data={data?.[kpi.id]} scope={scope} />
                {scope?.text && <div className="kpi-scope">{scope.text}</div>}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
  return <FoldStrip fold={fold} title="Key numbers" summary={summary}>{strip}</FoldStrip>;
}

function Tile({ t, loading }) {
  const { props, tip } = useFx(t.formula);
  return (
    <div className="kpi" data-tile={t.id}>
      <div className="kpi-l">{t.label}</div>
      {loading ? <Skeleton height={30} width="60%" /> : (
        <>
          <div className={`kpi-v ${t.tone || ''}`} tabIndex={t.formula ? 0 : undefined} {...props}>{t.value}{tip}</div>
          <div className="kpi-s">{t.sub || '\u00a0'}</div>
        </>
      )}
    </div>
  );
}

export function Tiles({ tiles, loading, label = 'Key numbers' }) {
  const fold = useFold('kpis');
  return (
    <FoldStrip fold={fold} title={label} summary={loading ? '' : tiles.map((t) => `${t.label} ${t.value}`).join(' · ')}>
      <section className="kpis" aria-label={label} data-n={tiles.length}>
        {tiles.map((t) => <Tile key={t.id} t={t} loading={loading} />)}
      </section>
    </FoldStrip>
  );
}

export function Story({ page, data }) {
  if (!page.story) return null;
  return (
    <p className="story">
      {storyPieces(page.story, page.kpis, data).map((piece, i) => (piece.strong
        ? <b key={i} className={piece.tone || ''}>{piece.text}</b>
        : <span key={i}>{piece.text}</span>))}
    </p>
  );
}
