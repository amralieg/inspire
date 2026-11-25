// REQ-533: the record story at the top of the drawer: headline, one picture, plain words, one action, a queue line.
// Props: story (storyOf), view (explanation, evidence, confidence, action), kind (technique kind), money ({kind,label,could_save}),
// queue ({done,total}), primary ({label, onSave, write, attrs}). Every number shows once; evidence stays folded.
import { useEffect, useState } from 'react';
import { grouped } from './format.js';
import { reducedMotion } from './Explainer.jsx';
import { explainerFor } from './explainers.js';
import { SaveButton } from './saving.jsx';
import TermChip from './TermChip.jsx';
import './styles/story.css';

const W = 320;
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${grouped(Math.abs(v))}`;

function Bridge({ bridge, once, a }) {
  const { parts, total, start, end } = bridge;
  const bars = [];
  let level = start ?? 0;
  if (start != null) bars.push({ name: 'Start', from: 0, to: start, label: grouped(start), kind: 'edge' });
  parts.forEach((p) => { bars.push({ name: p.name, from: level, to: level + p.value, label: p.value === 0 ? 'none' : signed(p.value), kind: p.value < 0 ? 'down' : 'up' }); level += p.value; });
  bars.push({ name: start != null ? 'End' : 'Total', from: start != null ? 0 : 0, to: end ?? total, label: start != null ? grouped(end ?? 0) : '', kind: 'edge' });
  const ys = bars.flatMap((b) => [b.from, b.to, 0]);
  const lo = Math.min(...ys); const hi = Math.max(...ys); const span = hi - lo || 1;
  const y = (v) => 14 + (1 - (v - lo) / span) * 70;
  const step = W / bars.length;
  return (
    <svg viewBox={`0 0 ${W} 120`} role="img" aria-label={`How the change adds up, ${bars.map((b) => b.name).join(', ')}`} className="st-svg">
      {bars.map((b, i) => {
        const top = y(Math.max(b.from, b.to)); const h = Math.max(Math.abs(y(b.from) - y(b.to)), 1.5);
        return (
          <g key={b.name}>
            <rect x={i * step + 8} y={top} width={step - 16} height={h} className={`st-bar st-${b.kind} ${a && 'st-anim st-grow'}`} style={{ animationDelay: `${i * 0.12}s` }} />
            <text x={i * step + step / 2} y={top - 4} textAnchor="middle" className="st-n">{b.label === 'none' ? 'none' : once(b.label)}</text>
            <text x={i * step + step / 2} y="108" textAnchor="middle" className="st-k">{b.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Strip({ strip, once, a }) {
  const x = (v) => 12 + ((v - strip.lo) / (strip.hi - strip.lo || 1)) * (W - 24);
  return (
    <svg viewBox={`0 0 ${W} 70`} role="img" aria-label="This record against the normal range and the average" className="st-svg">
      <rect x={x(strip.band[0])} y="20" width={Math.max(x(strip.band[1]) - x(strip.band[0]), 2)} height="22" className="st-band" />
      {strip.points.map((p, i) => (
        <g key={p.name}>
          <circle cx={x(p.x)} cy="31" r={i === 0 ? 7 : 5} className={`st-dot ${i === 0 && strip.flagged ? 'st-flag' : ''} ${a && 'st-anim st-pop'}`} />
          <text x={x(p.x)} y={i === 0 ? 14 : 60} textAnchor="middle" className="st-k">{p.name} {once(grouped(p.x))}</text>
        </g>
      ))}
    </svg>
  );
}

function Trend({ trend, once, a }) {
  const ys = trend.map((p) => p.y); const lo = Math.min(...ys); const hi = Math.max(...ys); const span = hi - lo || 1;
  const pts = trend.map((p, i) => `${12 + (i / (trend.length - 1)) * (W - 24)},${60 - ((p.y - lo) / span) * 44}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} 76`} role="img" aria-label="How this figure moved over the versions of this record" className="st-svg">
      <polyline points={pts} className={`st-line ${a && 'st-anim st-draw'}`} />
      <text x="12" y="74" className="st-k">{once(grouped(trend[0].y))}</text>
    </svg>
  );
}

export default function RecordStory({ story, view = {}, kind = '', money = null, queue = null, primary = null }) {
  const [still] = useState(reducedMotion);
  const a = still ? '' : 'on';
  const [extra, setExtra] = useState(0);
  useEffect(() => { setExtra(0); }, [queue?.done, queue?.total]);
  const seen = new Set();
  const once = (text) => { const key = String(text).replace(/[^\d.,]/g, ''); return seen.has(key) ? '' : (seen.add(key), text); };
  const save = async () => { if (await primary.onSave()) setExtra((n) => n + 1); };
  const words = story.words;
  const e = explainerFor(kind);
  const done = queue ? Math.min(queue.done + extra, queue.total) : 0;
  const head = story.headline;
  const label = money?.label || '';
  const savedAmount = money?.could_save != null ? once(grouped(money.could_save)) : '';
  const sure = view.evidence?.length || view.confidence;
  return (
    <section className={`sec story${still ? ' st-still' : ''}`} data-story aria-label="The story of this record">
      <h3 className="st-head" data-story-head><span className={`st-arrow st-${head.direction}`} aria-hidden="true" />{once(head.text) || head.text.split(' ')[0]}
        {label && <span className="st-money" data-money> {label}{savedAmount && ` ${savedAmount}`}</span>}</h3>
      {words?.headline && <p className="st-lead">{words.headline}</p>}
      {story.bridge && <Bridge bridge={story.bridge} once={once} a={a} />}
      {story.strip && <Strip strip={story.strip} once={once} a={a} />}
      {story.strip && <p className="st-note">{story.strip.status}{story.strip.rank != null && story.strip.n != null ? `, ranks ${once(grouped(story.strip.rank)) || story.strip.rank} of ${once(grouped(story.strip.n)) || story.strip.n}` : ''}</p>}
      {story.trend.length > 1 && <Trend trend={story.trend} once={once} a={a} />}
      {e && <p className="st-term"><TermChip term={e.terms[0].term} kind={kind} context={head.text} /> {e.what}</p>}
      {words ? <>{words.what && <p>{words.what}</p>}{words.why && <p>{words.why}</p>}{words.do && <p className="st-do">{words.do}</p>}</>
        : <>{view.explanation && <p>{view.explanation}</p>}{view.action && <p className="st-do">{view.action}</p>}</>}
      {sure && (
        <details className="st-sure" data-evidence>
          <summary>How sure is this?</summary>
          {view.confidence && <p><span className={`conf conf--${view.confidence.level}`}>{view.confidence.level}</span> {view.confidence.reason}</p>}
          {view.evidence?.length > 0 && <ul className="ev">{view.evidence.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </details>
      )}
      <div className="st-foot">
        {primary && <SaveButton write={primary.write} className="btn btn--pri" disabled={primary.disabled} {...(primary.attrs || {})} onClick={save}>{primary.label}</SaveButton>}
        {queue && <span className="st-queue" data-queue>{`${done} of ${queue.total} done`}</span>}
      </div>
    </section>
  );
}
