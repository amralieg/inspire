import { useState } from 'react';
import { VALUE_DISCLAIMER } from '../../lib/valueLabels';
import { SOURCE_TAGS, paramsHash, polishOk, storyAnswers, approvalHolds } from '../../lib/valueStory.js';
import { figureText } from '../../lib/valueWizard.js';
import TermsHeading from './TermsHeading';

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
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1">{params.map((p) => <ParamRow key={p.id} p={p} currency={currency} onValue={onValue} onOwner={onOwner} />)}</ul>
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
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <TermsHeading />
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-text-primary">
            <input type="checkbox" checked={accepted} onChange={(e) => onTerms(e.target.checked ? hash : null)} className="h-4 w-4" />
            I have read and accept these terms
          </label>
        </div>
        <p data-value-disclaimer="" role="note" className="text-[12px] leading-snug text-text-primary">{VALUE_DISCLAIMER}</p>
      </div>
      <button type="button" disabled={!accepted} onClick={() => onApprove(storyAnswers({ text, params, include_in_docs: include }))}
        className="rounded-lg bg-primary-solid px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve story and save</button>
    </div>
  );
}
