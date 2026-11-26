import { SOURCE_TAGS, polishOk } from '../../lib/valueStory.js';
import { figureText } from '../../lib/valueWizard.js';

const INPUT = 'w-20 rounded-md border border-border px-1.5 py-0.5 text-end text-[13px] tabular-nums';

// FX-106: a compact two-line cell (label, then tag, value and owner) in a grid, so all the parameters fit the dialog body without a scroll.
function ParamRow({ p, currency, onValue, onOwner }) {
  const many = Array.isArray(p.value);
  return (
    <li data-param={p.id} className={`flex min-w-0 flex-col gap-0.5 rounded-lg border border-border px-2 py-1${many ? ' col-span-2' : ''}`}>
      <p title={[p.label, p.note].filter(Boolean).join(': ')} className="line-clamp-1 text-[12px] font-semibold leading-tight text-text-primary">
        {p.label}{p.note && <span className="font-normal text-text-secondary">{`: ${p.note}`}</span>}
      </p>
      <div className="flex items-center gap-1">
        <span data-source-tag="" className="shrink-0 rounded-md bg-bg-subtle px-1.5 py-0.5 text-caption font-bold text-text-secondary">{SOURCE_TAGS[p.source]}</span>
        {many ? (
          <span className="flex gap-1">{p.value.map((v, i) => (
            <input key={i} type="number" aria-label={`${p.label}, year ${i + 1}`} value={v} className="w-14 rounded-md border border-border px-1 py-0.5 text-end text-[13px] tabular-nums"
              onChange={(e) => onValue(p.id, p.value.map((x, j) => (j === i ? Number(e.target.value) : x)))} />))}</span>
        ) : p.source === 'data' ? (
          <span data-from-data="" className="w-20 shrink-0 text-end text-[13px] font-semibold tabular-nums">{figureText(p.kind, p.value, currency) || '...'}</span>
        ) : (
          <input type="number" min={0} step="any" aria-label={p.label} value={p.value ?? ''} className={INPUT}
            onChange={(e) => e.target.value !== '' && onValue(p.id, Number(e.target.value))} />
        )}
        <input dir="auto" type="text" aria-label={`Owner of ${p.label}`} placeholder="Owner" value={p.owner || ''} onChange={(e) => onOwner(p.id, e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border px-1.5 py-0.5 text-[13px]" />
      </div>
    </li>
  );
}

// REQ-544: the Value story page shows the draft and the parameter table (pages 'draft' and 'params'). Controlled: story is storyOf(...), params is
// paramsOf(...) with the owners in. onValue(id, value) and onOwner(id, text) edit the parameters. The terms and the one save are on the Terms page.
export default function StepStory({ page, story, polish, params, currency, onValue, onOwner }) {
  const polished = polishOk(story.text, polish) ? polish : null;
  if (page === 'draft') {
    return (
      <div data-wizard-page="story:draft" className="space-y-2">
        <h3 data-story-headline="" className="text-lg font-extrabold text-text-primary">{story.headline}</h3>
        <ul className="space-y-1">
          {story.lines.map((l) => (
            <li key={l.label} data-story-line={l.label} className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-primary">
              <span className="font-semibold">{l.label}</span>: {l.text}
            </li>
          ))}
        </ul>
        {polished && <p data-story-polish="" className="rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-[13px] text-text-primary">{polished}</p>}
      </div>
    );
  }
  return (
    <div data-wizard-page="story:params" className="space-y-2">
      <p className="text-[13px] text-text-secondary">Every number behind the story, where it came from and who owns it. Changing a value clears the approval.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1">{params.map((p) => <ParamRow key={p.id} p={p} currency={currency} onValue={onValue} onOwner={onOwner} />)}</ul>
    </div>
  );
}
