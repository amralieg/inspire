import { change, changeParts, changeText, formatValue, storyPieces, wholeFormat } from './format.js';
import { HUES } from './theme.js';
import { Icon } from './icons.jsx';
import { Skeleton, PlainNote, useRetry } from './ui.jsx';
import { useFx } from './Fx.jsx';
import { Block } from './Blocks.jsx';
import { withBlocks } from './blocks.js';
import { FoldStrip, useFold } from './MyView.jsx';
import { AskGenie } from './AskGenie.jsx';

export const kpiValue = (kpi, data) => formatValue(data?.now, wholeFormat(kpi.format, kpi.label, kpi.unit, kpi.id), kpi.currency);

function kpiContext(kpi, data, error, scope) {
  if (error) return { hint: kpi.caption || '', fields: { Error: error } };
  const d = kpi.compare ? change(data?.now, data?.before) : null;
  const fields = { Now: kpiValue(kpi, data) };
  if (kpi.compare && data?.before != null) fields.Before = kpiValue(kpi, { now: data.before });
  if (d != null) fields.Change = `${changeText(d, kpi.words)} ${kpi.vs || ''}`.trim();
  if (scope?.text) fields.Scope = scope.text;
  return { hint: kpi.caption || '', fields };
}

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
  const retry = useRetry();
  const fold = useFold('kpis');
  const hues = kpiHues(page.hue, page.kpis.length);
  const entries = withBlocks(page.kpis, plan);
  const index = new Map(page.kpis.map((kpi, i) => [kpi.id, i]));
  const summary = loading ? '' : page.kpis.filter((kpi) => !errors?.[`kpi:${kpi.id}`]).map((kpi) => `${kpi.label} ${kpiValue(kpi, data?.[kpi.id])}`).join(' · ');
  const strip = (
    <>
    {scope?.text && <p className="kpi-scope scope-banner" data-scope-banner>{scope.text}</p>}
    <section className="kpis" aria-label="Key numbers" data-n={entries.length}>
      {entries.map((entry) => {
        if (entry.block) return <Block key={entry.key} block={entry.block} tile />;
        const kpi = entry.item;
        const i = index.get(kpi.id);
        const error = errors?.[`kpi:${kpi.id}`];
        return (
          <div key={kpi.id} className="kpi" style={{ '--k-line': `var(--${hues[i]}-line)`, '--k-bg': `var(--${hues[i]}-bg)`, '--k-tile': `var(--${hues[i]}-tile)`, '--k-ink': `var(--${hues[i]}-ink)` }}>
            <div className="kpi-l">{kpi.label}</div>
            {loading ? <Skeleton height={30} width="60%" /> : error ? <PlainNote text={error} icon={<Icon name="info" size={12} />} className="tile-err" onRetry={retry} /> : (
              <>
                <div className="kpi-v">{kpiValue(kpi, data?.[kpi.id])}</div>
                <Delta kpi={kpi} data={data?.[kpi.id]} scope={scope} />
              </>
            )}
            {!loading && <AskGenie kind="kpi" title={kpi.label} context={kpiContext(kpi, data?.[kpi.id], error, scope)} />}
          </div>
        );
      })}
    </section>
    </>
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
          {t.action && <button type="button" className="lnk kpi-fix" onClick={t.action.run} data-fix={t.id}><Icon name="right" size={12} />{t.action.label}</button>}
          <AskGenie kind="kpi" title={t.label} context={{ hint: t.formula || '', fields: { Now: t.value, ...(t.sub ? { Note: t.sub } : {}) } }} />
        </>
      )}
    </div>
  );
}

export function Tiles({ tiles, loading, label = 'Key numbers', fold: foldId = 'kpis' }) {
  const fold = useFold(foldId);
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
  const pieces = storyPieces(page.story, page.kpis, data);
  if (!pieces.length) return null;
  return (
    <p className="story">
      {pieces.map((piece, i) => (piece.strong
        ? <b key={i} className={piece.tone || ''}>{piece.text}</b>
        : <span key={i}>{piece.text}</span>))}
      <AskGenie kind="text" title="Page summary" context={{ hint: pieces.map((piece) => piece.text).join('') }} />
    </p>
  );
}
