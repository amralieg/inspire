import { Check, CircleAlert, Download, Eye, FolderOpen, Loader2 } from 'lucide-react';
import BackgroundRunBar from './BackgroundRunBar';
import ModalDialog from './ModalDialog';
import { PlainMessage } from './TechnicalDetails';
import { DocsHeader } from './GenerateDocsPages.jsx';
import { docsCounts, useDocsRun } from '../lib/docsRun.jsx';
import { isViewable } from '../lib/docView.js';

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-linear-to-r from-primary-solid to-primary-solid-hover px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50';

// REQ-525: the progress of the files being made, a view of the app-level run (lib/docsRun), like ValueBulkPanel. "Run in background", X and Esc hide it
// while the run goes on; only Stop stops it (no new file starts, the one being made finishes). When the run is finished, Close removes it.
const link = 'inline-flex items-center gap-1 text-xs font-medium text-info-fg hover:underline';

// C25 (REQ-559): each saved file has View (in place), Download and Go to asset; the pages hand in how a path is viewed, downloaded and found in Assets.
export default function GenerateDocsPanel({ onGoToAssets, onView, onDownload }) {
  const { run, stop, hide, dismiss } = useDocsRun();
  if (!run) return null;
  const { plan, files, running, stopping } = run;
  const { done, failed, stopped } = docsCounts(run);
  const close = running ? hide : dismiss;
  const label = (s) => (s === 'working' && stopping ? 'Finishing' : { waiting: 'Waiting', working: 'Making', done: 'Saved', failed: 'Failed', stopped: 'Not started' }[s]);

  return (
    <ModalDialog titleId="generate-docs-title" title="Generate documents" onClose={close} widthClass="max-w-3xl"
      footer={running ? (
        <>
          <button type="button" onClick={hide} className={btn}>Run in background</button>
          <button type="button" onClick={stop} disabled={stopping} className={btn}>Stop</button>
        </>
      ) : (
        <>
          <button type="button" onClick={dismiss} className={btn}>Close</button>
          {done > 0 && <button type="button" onClick={() => { dismiss(); onGoToAssets?.(); }} className={primary}>Go to Assets</button>}
        </>
      )}>
      <DocsHeader names={run.names} pages={run.pages} pageId="progress" made />
      <section data-docs-page="progress" aria-label="Progress" className="space-y-3">
        <p aria-live="polite" className="text-sm font-bold text-text-primary">
          {running ? `Making ${plan.length} ${plan.length === 1 ? 'file' : 'files'}`
            : `${done} ${done === 1 ? 'file' : 'files'} ready${failed ? `, ${failed} failed` : ''}${stopped ? `, ${stopped} not started` : ''}`}
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
                  {label(s.state)}
                </span>
                {s.state === 'done' && run.folder && (
                  <span className="flex items-center gap-3">
                    {isViewable(f) && <button type="button" className={link} aria-label={`View ${f.name}`} onClick={() => onView?.(`${run.folder}/${f.name}`, f.name)}><Eye size={14} aria-hidden /> View</button>}
                    <button type="button" className={link} aria-label={`Download ${f.name}`} onClick={() => onDownload?.(`${run.folder}/${f.name}`, f.name)}><Download size={14} aria-hidden /> Download</button>
                    <button type="button" className={link} aria-label={`Go to asset ${f.name}`} onClick={() => { dismiss(); onGoToAssets?.(`${run.folder}/${f.name}`); }}><FolderOpen size={14} aria-hidden /> Go to asset</button>
                  </span>
                )}
                {s.state === 'failed' && <PlainMessage as="span" dir="auto" text={s.message} className="basis-full text-xs text-error-fg" />}
              </li>
            );
          })}
        </ul>
      </section>
    </ModalDialog>
  );
}

// REQ-525: the line above the cards while the run's dialog is hidden: "Making documents: 1 of 4 saved", Open, Stop; Dismiss once finished.
export function DocsRunProgress() {
  const { run, stop, show, dismiss } = useDocsRun();
  if (!run || run.open) return null;
  const { done, failed, total } = docsCounts(run);
  return (
    <BackgroundRunBar barAttrs={{ 'data-docs-bg': '' }} textAttrs={{ 'data-docs-bg-text': '' }} running={run.running}
      text={`${run.running ? 'Making documents' : 'Documents made'}: ${done} of ${total} saved${!run.running && failed ? `, ${failed} failed` : ''}`}
      meterLabel="Documents progress" done={done} total={total} onOpen={show} onStop={stop} onDismiss={dismiss} />
  );
}
