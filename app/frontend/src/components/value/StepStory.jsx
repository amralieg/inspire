import { useState } from 'react';
import { VALUE_DISCLAIMER } from '../../lib/valueLabels';
import { SOURCE_TAGS, paramsHash, polishOk, storyAnswers, approvalHolds } from '../../lib/valueStory.js';
import { figureText } from '../../lib/valueWizard.js';

const INPUT = 'w-24 rounded-md border border-border px-2 py-1 text-end text-sm tabular-nums';

function ParamRow({ p, currency, onValue, onOwner }) {
  const many = Array.isArray(p.value);
  return (
    <li data-param={p.id} className="grid grid-cols-[1fr_auto_auto_9rem] items-center gap-3 rounded-lg border border-border px-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text-primary">{p.label}</p>
        {p.note && <p className="text-[12px] text-text-secondary">{p.note}</p>}
      </div>
      <span data-source-tag="" className="rounded-md bg-bg-subtle px-2 py-0.5 text-[11px] font-bold text-text-secondary">{SOURCE_TAGS[p.source]}</span>
      {many ? (
        <span className="flex gap-1">{p.value.map((v, i) => (
          <input key={i} type="number" aria-label={`${p.label}, year ${i + 1}`} value={v} className="w-16 rounded-md border border-border px-1 py-1 text-end text-sm tabular-nums"
            onChange={(e) => onValue(p.id, p.value.map((x, j) => (j === i ? Number(e.target.value) : x)))} />))}</span>
      ) : p.source === 'data' ? (
        <span data-from-data="" className="text-sm font-semibold tabular-nums">{figureText(p.kind, p.value, currency) || '...'}</span>
      ) : (
        <input type="number" min={0} step="any" aria-label={p.label} value={p.value ?? ''} className={INPUT}
          onChange={(e) => e.target.value !== '' && onValue(p.id, Number(e.target.value))} />
      )}
      <input type="text" aria-label={`Owner of ${p.label}`} placeholder="Owner" value={p.owner || ''} onChange={(e) => onOwner(p.id, e.target.value)}
        className="rounded-md border border-border px-2 py-1 text-sm" />
    </li>
  );
}

// REQ-507 L6, pages story:draft, story:params and story:approve. Controlled: story is storyOf(...), params is paramsOf(...) with the owners in,
// terms is the params_hash at which the terms were ticked (so a later value change clears it with no effect), story_saved is answers.story.
// onValue(id, value) and onOwner(id, text) edit the parameters; onTerms(hash|null) stores the ticked terms; onApprove(storyAnswers) is the PUT (L7).
export default function StepStory({ page, story, polish, params, currency, terms, onTerms, onValue, onOwner, saved, onApprove }) {
  const [include, setInclude] = useState(saved?.include_in_docs !== false);
  const polished = polishOk(story.text, polish) ? polish : null;
  const text = polished || story.text;
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
  if (page === 'params') {
    return (
      <div data-wizard-page="story:params" className="space-y-2">
        <p className="text-[13px] text-text-secondary">Every number behind the story, where it came from and who owns it. Changing a value clears the approval.</p>
        <ul className="space-y-1">{params.map((p) => <ParamRow key={p.id} p={p} currency={currency} onValue={onValue} onOwner={onOwner} />)}</ul>
      </div>
    );
  }
  const hash = paramsHash(params);
  const accepted = terms === hash;
  const held = approvalHolds(saved, params);
  return (
    <div data-wizard-page="story:approve" className="space-y-2">
      <p data-story-text="" className="whitespace-pre-line rounded-lg border border-border px-3 py-2 text-[13px] text-text-primary">{text}</p>
      {held ? <p data-approved="" className="text-[13px] font-semibold text-ok-fg">This story is approved for these numbers.</p>
        : saved?.approved && <p data-approval-cleared="" className="text-[13px] font-semibold text-warning-fg">A number changed after the approval, so it needs approving again.</p>}
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text-primary">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="h-4 w-4" />
        Include this story in generated docs
      </label>
      <div data-accept-terms="" className="rounded-lg border-2 border-warning bg-warning-bg px-3 py-1">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-text-primary">
          <input type="checkbox" checked={accepted} onChange={(e) => onTerms(e.target.checked ? hash : null)} className="h-4 w-4" />
          I have read and accept these terms
        </label>
        <p data-value-disclaimer="" role="note" className="text-[12px] leading-snug text-text-primary">{VALUE_DISCLAIMER}</p>
      </div>
      <button type="button" disabled={!accepted} onClick={() => onApprove(storyAnswers({ text, params, include_in_docs: include }))}
        className="rounded-lg bg-db-red-solid px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve story and save</button>
    </div>
  );
}
