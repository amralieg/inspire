import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Sparkles } from 'lucide-react';
import ModalDialog from './ModalDialog';
import { PlainMessage } from './TechnicalDetails';
import { ColumnsPage, DocumentsPage, IncludePage, LayoutPage, ReviewPage, StylePage } from './GenerateDocsPages.jsx';
import { defaultDocOptions, planFiles } from '../lib/docgen/docOptions.js';
import { buildDocModel } from '../lib/docgen/docModel.js';
import { infographicSvg } from '../lib/docgen/docSvg.js';
import { resolveTheme } from '../lib/docgen/docStyles.js';
import { generateDocs, markNewDocs } from '../lib/generateDocs.js';
import { trackingIdOf } from '../lib/useCaseFields.js';

const TITLES = { documents: 'Documents', layout: 'Layout and language', include: 'What to include', style: 'Style and color', columns: 'Excel columns', review: 'Review' };
const SUBTITLES = {
  documents: 'Which documents do you want?', layout: 'One file or one per use case, and in which languages.', include: 'Pick what each use case shows.',
  style: 'Pick a look. The picture on the right is your real infographic.', columns: 'Pick the columns of the Excel sheet.', review: 'These files will be made and saved to Assets.',
};
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-linear-to-r from-primary-solid to-primary-solid-hover px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50';

// REQ-503: the Generate docs wizard. Pages: documents, layout, include, style, columns (Excel only), review; then the files are made and saved.
export default function GenerateDocsDialog({ useCases, values, businessName, language, folder, apiPostJson, inspireDatabase, warehouseId, sessionId, onSaved, onGoToAssets, onClose }) {
  const [options, setOptions] = useState(() => defaultDocOptions(language));
  const [pageId, setPageId] = useState('documents');
  const [files, setFiles] = useState(null); // null before Generate; else { name: { state, message } }
  const running = useRef(false);
  const set = (patch) => setOptions((o) => ({ ...o, ...patch }));

  const pages = options.kinds.includes('xlsx') ? ['documents', 'layout', 'include', 'style', 'columns', 'review'] : ['documents', 'layout', 'include', 'style', 'review'];
  const at = Math.max(0, pages.indexOf(pageId));
  const planOptions = { ...options, businessName };
  const plan = useMemo(() => planFiles(planOptions, useCases), [options, businessName, useCases]); // eslint-disable-line react-hooks/exhaustive-deps
  const svg = useMemo(() => {
    if (pageId !== 'style') return '';
    const m = buildDocModel({ businessName, useCases, values, options });
    return infographicSvg(m, resolveTheme(options.style, options.palette, options.customColor));
  }, [pageId, businessName, useCases, values, options]);

  const names = useCases.map((uc) => String(uc.Name || uc.name || uc.use_case || trackingIdOf(uc)));
  const done = files ? Object.values(files).filter((f) => f.state === 'done').length : 0;
  const finished = files && plan.every((f) => ['done', 'failed'].includes(files[f.name]?.state));
  const failedCount = files ? Object.values(files).filter((f) => f.state === 'failed').length : 0;

  const generate = async () => {
    if (running.current) return;
    running.current = true;
    setFiles(Object.fromEntries(plan.map((f) => [f.name, { state: 'waiting' }])));
    setPageId('progress');
    try {
      const saved = await generateDocs({ plan, options, useCases, values, businessName, folder, post: apiPostJson, inspireDatabase, warehouseId, sessionId,
        onFile: (name, state, message = '') => setFiles((f) => ({ ...f, [name]: { state, message } })) });
      markNewDocs(sessionId, saved);
      if (saved.length) onSaved?.(saved);
    } finally {
      running.current = false;
    }
  };
  const close = () => { if (!files || finished) onClose(); };

  const footer = files ? (
    <>
      {finished && <button type="button" onClick={onClose} className={btn}>Close</button>}
      {finished && done > 0 && <button type="button" onClick={onGoToAssets} className={primary}>Go to Assets</button>}
    </>
  ) : (
    <>
      <button type="button" onClick={() => (at === 0 ? onClose() : setPageId(pages[at - 1]))} className={btn}>{at === 0 ? 'Cancel' : <><ArrowLeft size={14} aria-hidden /> Back</>}</button>
      {pageId === 'review'
        ? <button type="button" onClick={generate} disabled={!plan.length} className={primary}>✦ Generate {plan.length} {plan.length === 1 ? 'file' : 'files'}</button>
        : <button type="button" onClick={() => setPageId(pages[at + 1])} disabled={!options.kinds.length} className={primary}>Next <ArrowRight size={14} aria-hidden /></button>}
    </>
  );

  const shownNames = names.slice(0, 5);
  return (
    <ModalDialog titleId="generate-docs-title" title="Generate documents" onClose={close} widthClass="max-w-3xl" footer={footer}>
      <div className="-mx-5 -mt-4 mb-1 bg-linear-to-r from-db-red-50 to-transparent px-5 py-3">
        <p className="flex items-center gap-2 text-xs text-text-secondary">
          <Sparkles size={14} className="shrink-0 text-db-red-fg" aria-hidden />
          <span className="min-w-0 truncate" title={names.join(', ')}>{shownNames.join(', ')}{names.length > shownNames.length ? ` and ${names.length - shownNames.length} more` : ''}</span>
        </p>
        <ol className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Steps">
          {pages.map((p, i) => (
            <li key={p} data-docs-step={p} aria-current={p === pageId ? 'step' : undefined}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${p === pageId ? 'bg-primary-solid text-white' : i < at || files ? 'bg-db-red-100 text-db-red-fg' : 'bg-bg-subtle text-text-secondary'}`}>
              {(i < at || files) ? <Check size={14} aria-hidden /> : <span aria-hidden>{i + 1}</span>}{TITLES[p]}
            </li>
          ))}
        </ol>
      </div>
      {!files ? (
        <section key={pageId} data-docs-page={pageId} aria-label={TITLES[pageId]} className="tab-panel-enter space-y-3">
          <div><h3 className="text-sm font-bold text-text-primary">{TITLES[pageId]}</h3><p className="text-xs text-text-secondary">{SUBTITLES[pageId]}</p></div>
          {pageId === 'documents' && <DocumentsPage options={options} set={set} />}
          {pageId === 'layout' && <LayoutPage options={options} set={set} count={useCases.length} eachApplies={options.kinds.some((k) => k === 'pptx' || k === 'pdf')} />}
          {pageId === 'include' && <IncludePage options={options} set={set} />}
          {pageId === 'style' && <StylePage options={options} set={set} svg={svg} />}
          {pageId === 'columns' && <ColumnsPage options={options} set={set} />}
          {pageId === 'review' && <ReviewPage plan={plan} count={useCases.length} />}
        </section>
      ) : (
        <section data-docs-page="progress" aria-label="Progress" className="space-y-3">
          <p aria-live="polite" className="text-sm font-bold text-text-primary">
            {finished ? `${done} ${done === 1 ? 'file' : 'files'} ready${failedCount ? `, ${failedCount} failed` : ''}` : `Making ${plan.length} ${plan.length === 1 ? 'file' : 'files'}`}
          </p>
          <ul className="max-h-[48vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {plan.map((f) => {
              const s = files[f.name] || { state: 'waiting' };
              return (
                <li key={f.name} data-doc-file={f.name} data-doc-file-state={s.state} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-text-primary" title={f.name}>{f.name}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                    {s.state === 'working' && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />}
                    {s.state === 'done' && <Check size={14} className="text-success-fg" aria-hidden />}
                    {s.state === 'failed' && <CircleAlert size={14} className="text-error-fg" aria-hidden />}
                    {{ waiting: 'Waiting', working: 'Making', done: 'Saved', failed: 'Failed' }[s.state]}
                  </span>
                  {s.state === 'failed' && <PlainMessage as="span" dir="auto" text={s.message} className="basis-full text-xs text-error-fg" />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </ModalDialog>
  );
}
