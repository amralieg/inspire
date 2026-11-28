import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, ExternalLink, Eye, FileText, Loader2, Plus } from 'lucide-react';
import { artifactTreeFiles, fileActions, fileDateText, fileSizeText, fileTypeText, hasStrategyDocument, overallDocsByFormat } from '../../lib/artifactFiles';
import BusyNote from '../BusyNote';
import { isViewable } from '../../lib/docView';
import { PENDING_TEXT } from '../../lib/candidates';
import { nameOfUseCase, trackingIdOf } from '../../lib/useCaseFields';

const NEW_DOCS_EVENT = 'inspire:new-docs';
const newDocsKey = (sessionId) => `inspire:new-docs:${sessionId}`;
function readNewDocs(sessionId) {
  try {
    const list = JSON.parse(window.sessionStorage.getItem(newDocsKey(sessionId)) || '[]');
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
const parentOf = (path) => String(path).replace(/\/[^/]*$/, '');

/** The files the Generate docs wizard saved into this run (marked in sessionStorage by the wizard), and a reload of the listing when it saves more. */
function useNewDocs(sessionId, generationPath, loadArtifacts, loadFolder) {
  const [paths, setPaths] = useState(() => readNewDocs(sessionId));
  useEffect(() => { setPaths(readNewDocs(sessionId)); }, [sessionId]);
  const onSaved = useCallback((event) => {
    const detail = (event && event.detail) || {};
    if (String(detail.sessionId) !== String(sessionId)) return;
    setPaths(readNewDocs(sessionId).concat(Array.isArray(detail.paths) ? detail.paths.filter((p) => typeof p === 'string') : []));
    if (generationPath) loadArtifacts(generationPath);
    const folders = new Set((Array.isArray(detail.paths) ? detail.paths : []).map(parentOf).filter((f) => f && f !== generationPath));
    folders.forEach((folder) => { if (loadFolder) loadFolder(folder); });
  }, [sessionId, generationPath, loadArtifacts, loadFolder]);
  useEffect(() => {
    window.addEventListener(NEW_DOCS_EVENT, onSaved);
    return () => window.removeEventListener(NEW_DOCS_EVENT, onSaved);
  }, [onSaved]);
  return new Set(paths);
}

const link = 'text-caption font-medium flex items-center gap-0.5 hover:underline';

function OverallDoc({ format, newDocs, assetFocus, focusRef, viewFile, openFileInTab, downloadFile, onGenerate }) {
  return (
    <li data-overall-doc={format.id} className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-text-tertiary shrink-0" aria-hidden />
        <h4 className="text-xs font-bold text-text-primary">{format.label}</h4>
        {onGenerate && <button type="button" onClick={onGenerate} className={`${link} ms-auto text-db-red-fg`}><Plus size={14} aria-hidden /> Generate</button>}
      </div>
      {format.files.length === 0 && <p className="mt-1 text-caption text-text-secondary">Not made yet.</p>}
      {format.files.map((f) => (
        <div key={f.path} data-doc-file={f.name} {...(assetFocus === f.path ? { 'data-asset-focus': f.path, ref: focusRef } : {})}
          className={`mt-1 flex flex-wrap items-center gap-2 rounded-md px-2 py-1 ${assetFocus === f.path ? 'ring-2 ring-info-fg bg-bg-subtle' : ''}`}>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">{f.name}</span>
          {newDocs.has(f.path) && <span data-new-doc={f.path} className="text-caption font-bold uppercase px-1.5 py-0.5 rounded bg-success-bg text-success-fg">NEW</span>}
          <span data-asset-type="" className="text-caption text-text-secondary">{fileTypeText(f)}</span>
          {fileDateText(f) && <span data-asset-date="" className="text-caption text-text-tertiary">{fileDateText(f)}</span>}
          {fileSizeText(f.file_size) && <span className="text-caption text-text-tertiary">{fileSizeText(f.file_size)}</span>}
          {isViewable(f) && viewFile && <button type="button" aria-label={`View ${f.name}`} onClick={() => viewFile(f.path, f.name)} className={`${link} text-info-fg`}><Eye size={14} /> View</button>}
          {fileActions(f).open && openFileInTab && <button type="button" aria-label={`Open ${f.name}`} onClick={() => openFileInTab(f.path, f.name)} className={`${link} text-success-fg`}><ExternalLink size={14} /> Open</button>}
          <button type="button" aria-label={`Download ${f.name}`} onClick={() => downloadFile(f.path, f.name)} className={`${link} text-db-red-fg`}><Download size={14} /> Download</button>
        </div>
      ))}
    </li>
  );
}

/** Documents: the overall documents (Excel, PDF, PowerPoint) with generate and download, then every use case that has documents. Reads the run's own file listing. */
function OverviewDocuments({
  allUseCases, docsMadeIds, artifactsRootFiles, artifactTree, artifactsLoading, generationPath, selectedSessionId, loadArtifacts, loadFolder,
  assetFocus, viewFile, openFileInTab, downloadFile, onGenerateAll, openUseCase, strategyDoc, pendingArtifacts = [],
}) {
  const docsPending = pendingArtifacts.some((p) => p && p.kind === 'docs');
  const newDocs = useNewDocs(selectedSessionId, generationPath, loadArtifacts, loadFolder);
  const focusRef = useRef(null);
  useEffect(() => { focusRef.current?.scrollIntoView?.({ block: 'center' }); }, [assetFocus, artifactsRootFiles, artifactTree]);
  const files = artifactTreeFiles(artifactsRootFiles, artifactTree);
  const formats = overallDocsByFormat(files, allUseCases.map(trackingIdOf));
  const withDocs = allUseCases.filter((uc) => uc.docs_generated_at || docsMadeIds.has(trackingIdOf(uc)));
  return (
    <section data-overview-documents="" aria-label="Documents" className="min-w-0">
      {strategyDoc?.state === 'building' && <p data-strategy-doc-building="" className="mb-2 text-caption text-text-secondary"><BusyNote inline text="Building the strategy document" /></p>}
      {strategyDoc?.state === 'failed' && (
        <p data-strategy-doc-failed="" className="mb-2 text-caption text-text-secondary">
          The strategy document could not be saved.{' '}
          <button type="button" onClick={strategyDoc.retry} className="font-medium text-db-red-fg hover:underline">Retry</button>
        </p>
      )}
      <h3 className="mb-2 text-caption font-bold uppercase tracking-[0.18em] text-text-secondary">Overall documents</h3>
      {artifactsLoading && !artifactsRootFiles && <p className="flex items-center gap-2 py-2 text-xs text-text-secondary"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading files...</p>}
      <ul className="mb-6 grid gap-2">
        {formats.map((format) => (
          <OverallDoc key={format.id} format={format} newDocs={newDocs} assetFocus={assetFocus} focusRef={focusRef} viewFile={viewFile} openFileInTab={openFileInTab} downloadFile={downloadFile}
            onGenerate={allUseCases.length > 0 ? onGenerateAll : undefined} />
        ))}
      </ul>
      {!artifactsLoading && artifactsRootFiles && artifactsRootFiles.length > 0 && !hasStrategyDocument(files) && (
        <p data-testid="strategy-document-note" className="-mt-4 mb-6 text-caption text-text-secondary">
          No strategy document is listed here. To make another PDF, tick the use cases on the Use cases tab and choose Generate docs.
        </p>
      )}
      <h3 className="mb-2 text-caption font-bold uppercase tracking-[0.18em] text-text-secondary">Use cases with documents ({withDocs.length})</h3>
      {withDocs.length === 0 && docsPending && <p data-pending-artifact="docs" className="text-xs text-text-secondary">Documents {PENDING_TEXT}.</p>}
      {withDocs.length === 0 && !docsPending && <p className="text-xs text-text-secondary">No use case has documents yet. Tick use cases on the Use cases tab and choose Generate docs.</p>}
      <ul className="grid gap-1">
        {withDocs.map((uc) => {
          const id = trackingIdOf(uc);
          return (
            <li key={id} data-doc-use-case={id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span className="font-mono text-caption text-text-tertiary">{id}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{nameOfUseCase(uc)}</span>
              <button type="button" aria-label={`Open the documents of ${id}`} onClick={() => openUseCase(uc)} className={`${link} text-info-fg`}><BookOpen size={14} aria-hidden /> Open documents</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PANELS = [{ id: 'story', label: 'Story' }, { id: 'documents', label: 'Documents' }];

/** The Overview of Results (C28, REQ-568): a left panel with Story (the business and value content, `children`) and Documents. The run's outcome strip sits above both. */
export default function ResultsOverview({ panel, onPanel, outcomeBar, children, ...documents }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Overview sections" data-overview-nav="" className="flex gap-1 md:flex-col md:self-start">
        {PANELS.map(({ id, label }) => (
          <button key={id} type="button" data-overview-panel={id} aria-current={panel === id ? 'page' : undefined} onClick={() => onPanel(id)}
            className={`rounded-lg px-3 py-2 text-start text-sm font-semibold transition-smooth ${panel === id ? 'bg-db-red-50 text-db-red-fg' : 'text-text-secondary hover:bg-bg-subtle'}`}>
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {outcomeBar}
        {panel === 'documents' ? <OverviewDocuments {...documents} /> : children}
      </div>
    </div>
  );
}
