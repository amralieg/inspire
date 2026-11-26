import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import ModalDialog from './ModalDialog';
import { ColumnsPage, DocsHeader, DocumentsPage, IncludePage, LayoutPage, ReviewPage, StylePage, TITLES } from './GenerateDocsPages.jsx';
import { defaultDocOptions, planFiles } from '../lib/docgen/docOptions.js';
import { buildDocModel } from '../lib/docgen/docModel.js';
import { infographicSvg } from '../lib/docgen/docSvg.js';
import { DOC_STYLES, resolveTheme } from '../lib/docgen/docStyles.js';
import { useDocsRun } from '../lib/docsRun.jsx';
import { trackingIdOf } from '../lib/useCaseFields.js';

const SUBTITLES = {
  documents: 'Which documents do you want?', layout: 'One file or one per use case, and in which languages.', include: 'Pick what each use case shows.',
  style: 'Pick a look. The picture on the right is your real infographic.', columns: 'Pick the columns of the Excel sheet.', review: 'These files will be made and saved to Assets.',
};
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-linear-to-r from-primary-solid to-primary-solid-hover px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50';

// REQ-503: the Generate docs wizard. Pages: documents, layout, include, style, columns (Excel only), review; then the files are made and saved.
export default function GenerateDocsDialog({ useCases, values, businessName, summary, foundations, language, folder, apiPostJson, inspireDatabase, warehouseId, sessionId, onSaved, onClose }) {
  const [options, setOptions] = useState(() => defaultDocOptions(language));
  const [pageId, setPageId] = useState('documents');
  const docsRun = useDocsRun();
  const set = (patch) => setOptions((o) => ({ ...o, ...patch }));

  const pages = options.kinds.includes('xlsx') ? ['documents', 'layout', 'include', 'style', 'columns', 'review'] : ['documents', 'layout', 'include', 'style', 'review'];
  const at = Math.max(0, pages.indexOf(pageId));
  const planOptions = { ...options, businessName };
  const plan = useMemo(() => planFiles(planOptions, useCases), [options, businessName, useCases]); // eslint-disable-line react-hooks/exhaustive-deps
  const svg = useMemo(() => {
    if (pageId !== 'style') return '';
    const m = buildDocModel({ businessName, useCases, values, options });
    return infographicSvg(m, resolveTheme(options.style, options.palette, options.customColor, options.theme));
  }, [pageId, businessName, useCases, values, options]);

  // REQ-526: one thumbnail per design, drawn from the same model, theme mode and colour as the preview.
  const thumbs = useMemo(() => {
    if (pageId !== 'style') return {};
    const m = buildDocModel({ businessName, useCases, values, options });
    return Object.fromEntries(DOC_STYLES.filter((s) => s.design).map((s) => [s.id, infographicSvg(m, resolveTheme(s.id, options.palette, options.customColor, options.theme))]));
  }, [pageId, businessName, useCases, values, options]);

  const names = useCases.map((uc) => String(uc.Name || uc.name || uc.use_case || trackingIdOf(uc)));

  // REQ-525: the files are made by the app-level run (lib/docsRun), so they keep going when this dialog is hidden; its panel shows the progress.
  const generate = () => {
    docsRun.start({ plan, options, useCases, values, businessName, summary, foundations, folder, post: apiPostJson, inspireDatabase, warehouseId, sessionId, names, pages, onSaved });
    onClose();
  };
  const busy = Boolean(docsRun.run?.running);

  const footer = (
    <>
      <button type="button" onClick={() => (at === 0 ? onClose() : setPageId(pages[at - 1]))} className={btn}>{at === 0 ? 'Cancel' : <><ArrowLeft size={14} aria-hidden /> Back</>}</button>
      {pageId === 'review'
        ? <button type="button" onClick={generate} disabled={!plan.length || busy} title={busy ? 'Documents are being made. Wait for them to finish or stop them first.' : undefined} className={primary}>✦ Generate {plan.length} {plan.length === 1 ? 'file' : 'files'}</button>
        : <button type="button" onClick={() => setPageId(pages[at + 1])} disabled={!options.kinds.length} className={primary}>Next <ArrowRight size={14} aria-hidden /></button>}
    </>
  );

  return (
    <ModalDialog titleId="generate-docs-title" title="Generate documents" onClose={onClose} widthClass="max-w-3xl" footer={footer}>
      <DocsHeader names={names} pages={pages} pageId={pageId} />
      <section key={pageId} data-docs-page={pageId} aria-label={TITLES[pageId]} className="tab-panel-enter space-y-3">
        <div><h3 className="text-sm font-bold text-text-primary">{TITLES[pageId]}</h3><p className="text-xs text-text-secondary">{SUBTITLES[pageId]}</p></div>
        {pageId === 'documents' && <DocumentsPage options={options} set={set} />}
        {pageId === 'layout' && <LayoutPage options={options} set={set} count={useCases.length} eachApplies={options.kinds.some((k) => k === 'pptx' || k === 'pdf' || k === 'docx')} />}
        {pageId === 'include' && <IncludePage options={options} set={set} />}
        {pageId === 'style' && <StylePage options={options} set={set} svg={svg} thumbs={thumbs} />}
        {pageId === 'columns' && <ColumnsPage options={options} set={set} />}
        {pageId === 'review' && <ReviewPage plan={plan} count={useCases.length} options={options} />}
      </section>
    </ModalDialog>
  );
}
