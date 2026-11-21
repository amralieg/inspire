import { AlertTriangle, CheckCircle2, ChevronRight, Download, ExternalLink, Eye, EyeOff, FileText, FolderOpen, Loader2, Sparkles, XCircle } from 'lucide-react';
import DocumentActions from '../../components/DocumentActions';
import FilePreview from '../../components/FilePreview';
import { PlainMessage } from '../../components/TechnicalDetails';
import { artifactTreeFiles, fileActions, fileExtension, fileSizeText, quickAccessFiles } from '../../lib/artifactFiles';
import { displayCleanText, findUcForNotebookFilename, hasShippedGenieCode } from '../../lib/useCaseFields';
import { documentBasePath } from '../../lib/documentActions';
import { nextStepOf } from '../../lib/runOutcome';
import { qualityBarCountText } from '../../lib/qualityBarWording';
import { runBusiness } from '../../lib/reviewFigures';
import { workspaceWebUiHashPath } from '../../lib/workspaceLinks';

/** The Assets view of Results: everything the run generated (the run's outcome strip, its files and folders, the document actions, Quick access). Moved from ResultsPage unchanged. */
export default function ResultsAssets({
  allUseCases, apiFetch, apiPostJson, artifactTree, artifactsExpanded, artifactsLoading, artifactsRootFiles, databricksHost, downloadFile, expandedFolders, generationPath, genieQuickAccessExpanded, inspireDb, isProgressive, lastArtifactsLoadKeyRef, loadArtifacts, loadFolder, noneMeetsBar, openFileInTab, previewData, previewFile, previewFrom, previewLoading, qualityBarCounts, reviewBarStages, runOutcome, selectedSession, selectedSessionId, setArtifactsExpanded, setGenieQuickAccessExpanded, settings, settingsNotebookPath, showcase, toggleFolder, togglePreview,
}) {
  return (
    <>
            {/* ═══ Execution Summary Banner ═══ */}
            {!isProgressive && (
              <div className="bg-surface border border-border/70 rounded-xl overflow-hidden mb-4 shadow-elevated">
                <div className="px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3" data-testid="execution-complete" data-status={runOutcome.failed ? 'failed' : runOutcome.warning ? 'warning' : 'success'} data-failure={runOutcome.failureKind || undefined}>
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${runOutcome.failed ? 'bg-error/10 ring-error/20' : runOutcome.warning ? 'bg-warning/10 ring-warning/20' : 'bg-success/10 ring-success/20'}`}>
                        {runOutcome.failed
                          ? <XCircle size={14} className="text-error-fg" />
                          : runOutcome.warning
                            ? <AlertTriangle size={14} className="text-warning-fg" />
                            : <CheckCircle2 size={14} className="text-success-fg" />}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-text-primary tracking-tight">
                          {runOutcome.failed ? runOutcome.failureTitle : runOutcome.warning ? 'Run finished, with a warning' : 'Run finished'}
                        </h3>
                        {runOutcome.failed
                          ? <p className="text-[11px] text-error-fg" data-testid="execution-failure">{displayCleanText(runOutcome.message)}</p>
                          : (runOutcome.missingDocuments.length > 0 || runOutcome.unfinishedSteps.length > 0)
                            ? (
                              <>
                                {runOutcome.missingDocuments.length > 0 && (
                                  <ul className="text-[11px] text-warning-fg" data-testid="missing-documents" aria-label="Documents the run did not write">
                                    {runOutcome.missingDocuments.map((line) => <li key={line} dir="auto">{line}</li>)}
                                    <li className="text-text-secondary">Open the run log to see why.</li>
                                  </ul>
                                )}
                                {runOutcome.unfinishedSteps.length > 0 && (
                                  <ul className="text-[11px] text-warning-fg" data-testid="unfinished-steps" aria-label="Steps the run did not finish">
                                    {runOutcome.unfinishedSteps.map((line) => <li key={line} dir="auto">{line}</li>)}
                                  </ul>
                                )}
                              </>
                            )
                            : <p className="text-[11px] text-text-secondary">Every step of the run finished.</p>}
                        {qualityBarCounts.found > 0 && (
                          <p className="text-[11px] text-text-secondary mt-0.5" data-testid="quality-bar-counts">
                            {qualityBarCountText(qualityBarCounts.found, qualityBarCounts.meets, runOutcome.mode)}
                          </p>
                        )}
                        {noneMeetsBar && !runOutcome.failed && (
                          <p className="text-[11px] font-semibold text-text-primary mt-1" data-testid="quality-bar-next-step">
                            Next step: {nextStepOf(runOutcome)}
                          </p>
                        )}
                        {!runOutcome.failed && (runOutcome.barMessage || runOutcome.notes.length > 0) && (
                          <p className="text-[10px] text-warning-fg mt-0.5" data-testid="execution-outcome">
                            {displayCleanText(runOutcome.barMessage || runOutcome.notes[0])}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Pipeline stages row */}
                  <div className="flex items-center gap-1 pt-2 border-t border-border overflow-x-auto">
                    {reviewBarStages.map((stage, i) => (
                      <div key={stage} className="flex items-center shrink-0">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-success-bg">
                          <CheckCircle2 size={11} className="text-success-fg shrink-0" />
                          <span className="text-[10px] font-medium text-success-fg whitespace-nowrap">{stage}</span>
                        </div>
                        {i < reviewBarStages.length - 1 && (
                          <span className="text-text-tertiary text-[10px] mx-1 shrink-0">&rarr;</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Artifacts Panel (feature 7) */}
            {!isProgressive && generationPath && !showcase && (() => {
              // Recursive file tree renderer
              const renderFileTree = (files, depth = 0) => (
                <div className={depth > 0 ? 'ms-4 border-s border-border/50 ps-2' : ''}>
                  {files.map((f) => {
                    const isDir = f.is_directory;
                    const isOpen = expandedFolders[f.path];
                    const folderData = artifactTree[f.path];
                    return (
                      <div key={f.path}>
                        <div
                          className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-bg-subtle transition-smooth ${isDir ? 'cursor-pointer' : ''}`}
                          onClick={isDir ? () => toggleFolder(f.path) : undefined}
                        >
                          {isDir ? (
                            <>
                              <ChevronRight size={10} className={`text-text-tertiary transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                              <FolderOpen size={12} className="text-warning-fg shrink-0" />
                            </>
                          ) : (
                            <>
                              <span className="w-[10px]" />
                              <FileText size={12} className="text-text-tertiary shrink-0" />
                            </>
                          )}
                          <span className="text-xs text-text-primary font-mono truncate flex-1">{f.name}</span>
                          {fileSizeText(f.file_size) && (
                            <span className="text-[9px] text-text-tertiary">{fileSizeText(f.file_size)}</span>
                          )}
                          {!isDir && (() => {
                            const actions = fileActions(f);
                            return (
                              <div className="flex items-center gap-2 shrink-0">
                                {actions.preview && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-info-fg hover:underline font-medium flex items-center gap-0.5"
                                    onClick={(e) => { e.stopPropagation(); togglePreview(f.path, f.name, 'files'); }}
                                  >
                                    {previewFile === f.path && previewFrom === 'files' ? <><Eye size={10} /> Hide</> : <><Eye size={10} /> Preview</>}
                                  </button>
                                )}
                                {actions.open && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-success-fg hover:underline font-medium flex items-center gap-0.5"
                                    aria-label={`Open ${f.name}`}
                                    onClick={(e) => { e.stopPropagation(); openFileInTab(f.path, f.name); }}
                                  >
                                    <ExternalLink size={10} /> Open
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="text-[10px] text-db-red-fg hover:underline font-medium flex items-center gap-0.5"
                                  aria-label={`Download ${f.name}`}
                                  onClick={(e) => { e.stopPropagation(); downloadFile(f.path, f.name); }}
                                >
                                  <Download size={10} /> Download
                                </button>
                              </div>
                            );
                          })()}
                          {isDir && (
                            <button
                              type="button"
                              className="text-[10px] text-info-fg hover:underline font-medium flex items-center gap-0.5 shrink-0"
                              onClick={(e) => { e.stopPropagation(); downloadFile(f.path, `${f.name}.zip`); }}
                              aria-label={`Download the ${f.name} folder`}
                              title="Download folder"
                            >
                              <Download size={10} />
                            </button>
                          )}
                        </div>
                        {/* Inline file preview */}
                        {!isDir && previewFile === f.path && previewFrom === 'files' && (
                          <div className="ms-6 me-2 my-2">
                            <FilePreview name={f.name} loading={previewLoading} data={previewData} />
                          </div>
                        )}
                        {isDir && isOpen && (
                          <div>
                            {folderData?.loading && (
                              <div className="flex items-center gap-2 py-2 ms-6">
                                <Loader2 size={10} className="animate-spin text-text-tertiary" />
                                <span className="text-[10px] text-text-secondary">Loading...</span>
                              </div>
                            )}
                            {folderData?.error && (
                              <div className="ms-6 py-1">
                                <PlainMessage as="span" text={folderData.error} className="text-[10px] text-text-tertiary" />
                                <button type="button" onClick={(e) => { e.stopPropagation(); loadFolder(f.path); }} className="ms-2 text-[10px] text-db-red-fg hover:underline">Retry</button>
                              </div>
                            )}
                            {folderData && !folderData.loading && !folderData.error && folderData.files.length === 0 && (
                              <div className="ms-6 py-1">
                                <span className="text-[10px] text-text-tertiary italic">Empty folder</span>
                              </div>
                            )}
                            {folderData && !folderData.loading && folderData.files.length > 0 && renderFileTree(folderData.files, depth + 1)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );

              return (
                <div className="bg-surface border border-border/70 rounded-xl overflow-hidden mb-6 shadow-elevated">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !artifactsExpanded;
                      setArtifactsExpanded(next);
                      if (next && !artifactsRootFiles && !artifactsLoading) loadArtifacts(generationPath);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-start hover:bg-bg-subtle/50 transition-smooth"
                  >
                    <div className="w-7 h-7 rounded-lg bg-info/10 flex items-center justify-center">
                      <FolderOpen size={14} className="text-info-fg" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xs font-bold text-text-primary">Generated Artifacts</h3>
                      <p className="text-[10px] text-text-tertiary font-mono">{generationPath}</p>
                    </div>
                    {artifactsRootFiles && artifactsRootFiles.length > 0 && (
                      <span className="text-[10px] text-info-fg font-semibold bg-info-bg px-2 py-0.5 rounded-full">
                        {artifactsRootFiles.length} item{artifactsRootFiles.length > 1 ? 's' : ''}
                      </span>
                    )}
                    <div className={`transition-transform duration-200 ${artifactsExpanded ? 'rotate-90' : ''}`}>
                      <ChevronRight size={14} className="text-text-tertiary" />
                    </div>
                  </button>
                  {artifactsExpanded && (
                    <div className="border-t border-border px-5 py-3">
                      {artifactsLoading && (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <Loader2 size={14} className="animate-spin text-text-tertiary" />
                          <span className="text-xs text-text-secondary">Loading files...</span>
                        </div>
                      )}
                      {!artifactsLoading && artifactsRootFiles && artifactsRootFiles.length === 0 && (
                        <div className="text-center py-4">
                          <p className="text-xs text-text-tertiary">No files found at this path.</p>
                          <p className="text-[10px] text-text-tertiary mt-1 max-w-lg mx-auto leading-relaxed">
                            Resolved folder <span className="font-mono break-all">{generationPath}</span>
                            {settingsNotebookPath ? (
                              <>
                                {' '}
                                (notebook <span className="font-mono break-all">{settingsNotebookPath}</span> in Settings. Use{' '}
                                <span className="font-mono">/Workspace/Shared/…</span> if relative <span className="font-mono">./../demos/</span> should sit next to Shared).
                              </>
                            ) : (
                              <>. Set the Inspire notebook path in Workspace settings so relative <span className="font-mono">11_generation_path</span> resolves correctly.</>
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              lastArtifactsLoadKeyRef.current = '';
                              loadArtifacts(generationPath);
                            }}
                            className="mt-2 text-[10px] text-db-red-fg hover:underline font-medium"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {artifactsRootFiles && artifactsRootFiles.length > 0 && (
                        <div className="max-h-80 overflow-y-auto">
                          {renderFileTree(artifactsRootFiles)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {generationPath && !showcase && selectedSessionId && (
              <DocumentActions
                apiFetch={apiFetch}
                apiPostJson={apiPostJson}
                session={{ sessionId: selectedSessionId, inspireDatabase: inspireDb, businessName: runBusiness(selectedSession), outputLanguage: selectedSession?.output_language || '', generationPath: documentBasePath({ generationPath: selectedSession?.generation_path || selectedSession?.widget_values?.generation_path || '', notebookPath: settings?.notebookPath || '' }) }}
                onFinished={() => loadArtifacts(generationPath)}
              />
            )}

            {/* Quick Access — always visible, PDF/Excel/CSV files from artifacts */}
            {(() => {
              const artifactFiles = artifactTreeFiles(artifactsRootFiles, artifactTree);
              const previewableFiles = quickAccessFiles(artifactFiles);
              if (previewableFiles.length === 0) return null;

              const EXT_STYLES = {
                pdf:  { bg: 'bg-error-bg', text: 'text-error-fg' },
                csv:  { bg: 'bg-success-bg', text: 'text-success-fg' },
                xlsx: { bg: 'bg-info-bg', text: 'text-info-fg' },
                xls:  { bg: 'bg-info-bg', text: 'text-info-fg' },
              };

              return (
                <div className="bg-surface border border-border/70 rounded-xl p-4 mb-6 shadow-elevated">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-db-red/10 ring-1 ring-inset ring-db-red/20">
                      <FileText size={12} className="text-db-red-fg" strokeWidth={2} />
                    </div>
                    <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.18em]">Quick access: documents and data</h3>
                  </div>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                    {previewableFiles.map((f) => {
                      const ext = fileExtension(f);
                      const style = EXT_STYLES[ext] || EXT_STYLES.csv;
                      const isActive = previewFile === f.path && previewFrom === 'quick';
                      return (
                        <div key={f.path} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] border transition-all shrink-0 ${isActive ? 'border-db-red/30 bg-db-red-50' : 'border-border bg-bg-subtle/50 hover:bg-bg-subtle'}`}>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>{ext}</span>
                          <span className="text-text-primary font-medium truncate max-w-[200px]">{f.name}</span>
                          <div className="flex items-center gap-1.5 ms-1 border-s border-border ps-2">
                            <button type="button" className="text-[10px] text-info-fg hover:text-info-fg font-medium flex items-center gap-0.5 hover:underline" onClick={() => togglePreview(f.path, f.name, 'quick')}>
                              {isActive ? <><EyeOff size={9} /> Hide</> : <><Eye size={9} /> Preview</>}
                            </button>
                            {fileActions(f).open && (
                              <button type="button" aria-label={`Open ${f.name}`} className="text-[10px] text-success-fg font-medium flex items-center gap-0.5 hover:underline" onClick={() => openFileInTab(f.path, f.name)}>
                                <ExternalLink size={9} /> Open
                              </button>
                            )}
                            <button type="button" aria-label={`Download ${f.name}`} title={`Download ${f.name}`} className="text-[10px] text-db-red-fg font-medium flex items-center gap-0.5 hover:underline" onClick={() => downloadFile(f.path, f.name)}>
                              <Download size={9} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Inline preview */}
                  {previewFile && previewFrom === 'quick' && previewableFiles.some(f => f.path === previewFile) && (
                    <div className="mt-4">
                      <FilePreview name={previewableFiles.find((f) => f.path === previewFile).name} loading={previewLoading} data={previewData}
                        pdfClassName="h-[600px] rounded-xl shadow-sm" />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Quick Access — .ipynb under artifacts whose use case has shipped Genie (not skeleton-only) */}
            {(() => {
              const notebookFiles = [];
              const collectNb = (files) => {
                if (!files) return;
                for (const f of files) {
                  if (f.is_directory) {
                    const sub = artifactTree[f.path];
                    if (sub?.files) collectNb(sub.files);
                  } else if ((f.name || '').toLowerCase().endsWith('.ipynb')) {
                    const uc = findUcForNotebookFilename(f.name, allUseCases);
                    if (uc && hasShippedGenieCode(uc)) notebookFiles.push(f);
                  }
                }
              };
              collectNb(artifactsRootFiles);
              if (notebookFiles.length === 0) return null;
              const base = databricksHost
                ? databricksHost.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://')
                : '';
              const origin = base && (base.startsWith('http') ? base : `https://${base}`);
              return (
                <div className="bg-surface border border-border/70 rounded-xl p-4 mb-6 shadow-elevated overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setGenieQuickAccessExpanded((o) => !o)}
                    aria-expanded={genieQuickAccessExpanded}
                    aria-controls="genie-quick-access-list"
                    id="genie-quick-access-toggle"
                    className="flex w-full items-center justify-between gap-3 rounded-lg text-start transition-smooth hover:bg-bg-subtle/80 -mx-1 px-1 py-0.5"
                  >
                    <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-[0.18em] flex items-center gap-2 min-w-0">
                      <Sparkles size={12} className="text-db-red-fg shrink-0" aria-hidden />
                      <span className="truncate">Quick access: Genie Code instructions ready</span>
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono font-semibold text-text-tertiary tabular-nums px-2 py-0.5 rounded-md bg-bg-subtle border border-border">
                        {notebookFiles.length}
                      </span>
                      <ChevronRight
                        size={16}
                        className={`text-text-tertiary transition-transform duration-200 ${genieQuickAccessExpanded ? 'rotate-90' : ''}`}
                        aria-hidden
                      />
                    </div>
                  </button>
                  {genieQuickAccessExpanded && (
                    <>
                      {!origin && (
                        <p className="text-[10px] text-text-tertiary mt-2 mb-2">
                          Add your Databricks workspace URL in settings to open notebooks in the Workspace UI.
                        </p>
                      )}
                      <div
                        id="genie-quick-access-list"
                        role="region"
                        aria-labelledby="genie-quick-access-toggle"
                        className={`rounded-xl border border-border/80 bg-linear-to-b from-bg-subtle/40 to-surface max-h-[min(42vh,340px)] overflow-y-auto shadow-inner [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong/80 [&::-webkit-scrollbar-track]:bg-transparent ${origin ? 'mt-2' : ''}`}
                      >
                        <ul className="divide-y divide-border/70">
                          {notebookFiles.map((f) => {
                            const hashPath = workspaceWebUiHashPath(f.path);
                            const pathSeg = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
                            const href = origin ? `${origin}/#workspace${pathSeg}` : '';
                            const rowClass =
                              'flex items-center gap-2.5 px-3 py-2.5 min-h-[2.75rem] text-start text-[11px] text-text-primary font-medium transition-colors hover:bg-db-red-50/40 dark:hover:bg-db-red-950/20';
                            if (href) {
                              return (
                                <li key={f.path} className="min-w-0">
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`${rowClass} group`}
                                    title={f.path}
                                  >
                                    <ExternalLink
                                      size={12}
                                      className="shrink-0 text-db-red-fg opacity-80 group-hover:opacity-100"
                                      aria-hidden
                                    />
                                    <span className="truncate min-w-0 leading-snug">{f.name}</span>
                                  </a>
                                </li>
                              );
                            }
                            return (
                              <li key={f.path} className={`${rowClass} cursor-default text-text-secondary`} title={f.path}>
                                <FileText size={12} className="shrink-0 text-text-tertiary" aria-hidden />
                                <span className="truncate min-w-0 leading-snug">{f.name}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
    </>
  );
}
