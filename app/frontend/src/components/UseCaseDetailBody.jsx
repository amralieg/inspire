import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import GenieMarkdownPreview from './GenieMarkdownPreview';
import { BestOfBestDetail, FeedbackControls, UseCaseStrategyDetail } from './UseCaseStrategyDetail';
import { workspaceNotebookUrl } from '../lib/workspaceLinks';
import { placeholderWords } from '../lib/placeholderWords';
import { requestHeaders } from '../lib/apiClient';
import { NOTEBOOK_MODE_LABEL, START_MVP_LABEL } from '../lib/implementWizard';
import { KIND_INFORMATIONAL_LABEL, kindChipStyle } from '../lib/useCaseKind';
import { beneficiaryFromUc, expandWorkspaceListCandidates, fieldOf, hasShippedGenieCode, notebookPathOf, sponsorFromUc } from '../lib/useCaseFields';

const notebookCache = new Map();

const s = (v) => (v == null ? '' : String(v));
const stripHtml = (v) => (v == null ? '' : placeholderWords(String(v).replace(/<[^>]*>/g, ' ')).replace(/\s{2,}/g, ' ').trim());

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-smooth border ${
        copied
          ? 'bg-success-bg text-success-fg border-success/20'
          : 'bg-bg text-text-tertiary border-border hover:text-text-secondary hover:border-border-strong'
      }`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function UseCaseDetailBody({
  uc,
  active = true,
  className = 'space-y-4',
  resolveTable = (t) => t,
  token,
  databricksHost,
  showcase = '',
  allNotebookFiles = [],
  v130 = null,
  knownPriorities: priorityList = [],
  strategy = null,
  foundationsById,
  feedbackAvailable = null,
  feedbackCurrent,
  feedbackBusy = false,
  feedbackError = '',
  feedbackNote = false,
  feedbackReadOnly = false,
  onFeedback,
}) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const notebookPath = notebookPathOf(u, allNotebookFiles);
  const genieInstruction = s(u.genie_instruction);
  const cacheKey = notebookPath ? `${showcase ? `showcase:${showcase}` : databricksHost || ''}|${notebookPath}` : '';
  const [notebookContent, setNotebookContent] = useState(() => (cacheKey && notebookCache.get(cacheKey)) || null);
  const [notebookLoading, setNotebookLoading] = useState(false);
  const [notebookError, setNotebookError] = useState('');
  const [showNotebook, setShowNotebook] = useState(false);
  const pathPreviewTriedRef = useRef('');

  const statement = stripHtml(fieldOf(u, 'Statement', 'statement') || u.description || u.problem_statement);
  const solution = stripHtml(fieldOf(u, 'Solution', 'solution'));
  const businessValue = stripHtml(fieldOf(u, 'Business Value', 'business_value') || u.business_impact);
  const beneficiary = beneficiaryFromUc(u);
  const sponsor = sponsorFromUc(u);
  const quality = s(fieldOf(u, 'Quality', 'quality'));
  const alignment = s(fieldOf(u, 'Business Priority Alignment', 'business_priority_alignment'));
  const rawSql = u.SQL || u.sql || u.sql_query || '';
  const sql = typeof rawSql === 'string' ? rawSql : String(rawSql);
  const resultTable = s(u.result_table);
  const tablesInvolved = s(fieldOf(u, 'Tables Involved', 'tables_involved'));
  const shippedGenie = hasShippedGenieCode(u);
  const hasNotebook = !!(notebookPath || genieInstruction.trim());
  const kind = v130?.kind || null;

  const loadNotebookPreview = useCallback(async () => {
    if (notebookContent) {
      setShowNotebook(true);
      return;
    }
    const gi = genieInstruction.trim();
    if (gi) {
      setNotebookContent(genieInstruction);
      setShowNotebook(true);
      return;
    }
    if (!notebookPath) return;
    setNotebookLoading(true);
    setNotebookError('');
    try {
      const headers = requestHeaders(token, databricksHost, {}, showcase);
      let resp = null;
      let refused = '';
      for (const pth of expandWorkspaceListCandidates(notebookPath)) {
        const r = await fetch(`/api/workspace/export?path=${encodeURIComponent(pth)}`, { headers });
        if (r.ok) {
          resp = r;
          break;
        }
        if (showcase && !refused) refused = (await r.json().catch(() => ({}))).error || '';
      }
      if (resp && resp.ok) {
        const ct = resp.headers.get('content-type') || '';
        let content = '';
        if (ct.includes('application/json')) {
          const data = await resp.json();
          content = data.content || '';
          if (data.content && data.file_type !== 'text') {
            try {
              content = atob(data.content);
            } catch {
              /* already decoded */
            }
          }
        } else {
          content = await resp.text();
        }
        if (cacheKey) notebookCache.set(cacheKey, content);
        setNotebookContent(content);
        setShowNotebook(true);
      } else {
        setNotebookError(
          refused || 'Could not load the notebook because the export failed. Check the workspace path, the token scope, and that the file exists under /Workspace.',
        );
      }
    } catch (err) {
      setNotebookError(err.message || 'Failed to fetch');
    }
    setNotebookLoading(false);
  }, [notebookContent, genieInstruction, notebookPath, token, databricksHost, showcase, cacheKey]);

  useEffect(() => {
    if (!active) {
      pathPreviewTriedRef.current = '';
      return;
    }
    if (!hasNotebook) return;
    if (genieInstruction.trim()) {
      setNotebookContent(genieInstruction);
      setShowNotebook(true);
      return;
    }
    if (notebookContent) {
      setShowNotebook(true);
      return;
    }
    if (notebookPath && pathPreviewTriedRef.current !== notebookPath && !notebookLoading) {
      pathPreviewTriedRef.current = notebookPath;
      void loadNotebookPreview();
    }
  }, [active, hasNotebook, genieInstruction, notebookPath, notebookContent, notebookLoading, loadNotebookPreview]);

  const workspaceNotebookHref = workspaceNotebookUrl(databricksHost, notebookPath);

  if (!uc || typeof uc !== 'object') return null;

  return (
    <div className={className}>
      {kind && (
        <section data-what-you-get className="rounded-lg border border-border p-3" style={kindChipStyle(kind.color)}>
          <h4 className="text-[10px] font-bold text-text-primary uppercase tracking-[0.18em] mb-1">
            What you get
          </h4>
          <p className="text-[11px] font-semibold text-text-primary mb-1.5">
            {kind.familyLabel} · {kind.label}{kind.technique && <> · <bdi>{kind.technique}</bdi></>}{kind.informational ? ` · ${KIND_INFORMATIONAL_LABEL}` : ''}
          </p>
          {kind.lines.length > 0 ? (
            <dl className="space-y-1 text-sm text-text-secondary leading-relaxed">
              {kind.lines.map((line) => (
                <div key={line.key} data-kind-line={line.key}>
                  <dt className="inline font-semibold text-text-primary">{line.label}: </dt>
                  <dd dir="auto" className="inline">{line.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-text-secondary leading-relaxed">{kind.question}</p>
          )}
        </section>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="min-w-0">
          <h4 className="text-[10px] font-bold text-db-red-fg uppercase tracking-[0.18em] mb-1">
            Problem Statement
          </h4>
          <p dir="auto" data-use-case-text="statement" className="text-sm text-text-secondary leading-relaxed break-words">
            {statement || 'N/A'}
          </p>
        </div>
        <div className="min-w-0">
          <h4 className="text-[10px] font-bold text-success-fg uppercase tracking-[0.18em] mb-1">
            Proposed Solution
          </h4>
          <p dir="auto" data-use-case-text="solution" className="text-sm text-text-secondary leading-relaxed break-words">
            {solution || 'N/A'}
          </p>
        </div>
      </div>

      {businessValue && (
        <div>
          <h4 className="text-[10px] font-bold text-warning-fg uppercase tracking-[0.18em] mb-1">
            Business Value
          </h4>
          <p dir="auto" data-use-case-text="value" className="text-sm text-text-secondary leading-relaxed break-words">
            {businessValue}
          </p>
        </div>
      )}

      <BestOfBestDetail info={v130} />
      <UseCaseStrategyDetail info={v130} knownPriorities={priorityList} foundationsById={foundationsById} strategy={strategy} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        {[
          { label: 'Beneficiary', val: beneficiary },
          { label: 'Sponsor', val: sponsor },
          { label: 'Quality', val: quality },
          ...(v130?.hasStrategyData ? [] : [{ label: 'Priority Alignment', val: alignment }]),
          {
            label: 'Tables',
            val: String(tablesInvolved || '')
              .split(',')
              .map((t) => resolveTable(t.trim()))
              .join(', '),
            mono: true,
          },
        ].map((item) => (
          <div key={item.label} data-use-case-fact={item.label} className="min-w-0 bg-bg rounded-lg p-2.5 border border-border">
            <span className="text-[9px] text-text-tertiary uppercase tracking-[0.18em] font-bold block mb-0.5">
              {item.label}
            </span>
            <span dir="auto" data-use-case-fact-value="" className={`block text-text-secondary break-words ${item.mono ? 'font-mono text-[10px]' : ''}`}>
              {item.val || 'N/A'}
            </span>
          </div>
        ))}
      </div>

      {sql && !sql.startsWith('--') && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-[10px] font-bold text-info-fg uppercase tracking-[0.18em]">
              SQL Implementation
              {resultTable && (
                <span className="text-text-tertiary font-normal normal-case ms-1">
                  &rarr; {resultTable}
                </span>
              )}
            </h4>
            <CopyButton text={sql} />
          </div>
          <div className="relative rounded-lg border border-border overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-info/30 rounded-s-lg" />
            <pre className="text-[11px] text-text-primary bg-bg p-4 ps-5 overflow-x-auto max-h-60 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
              {sql}
            </pre>
          </div>
        </div>
      )}

      {hasNotebook && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold text-db-red-fg uppercase tracking-[0.18em]">
              {shippedGenie ? 'Genie Code Instruction' : 'Use case notebook'}
              {notebookPath && (
                <span className="text-text-tertiary font-normal normal-case ms-1 font-mono text-[9px] truncate max-w-[300px] inline-block align-bottom">
                  {notebookPath.split('/').pop()}
                </span>
              )}
            </h4>
            <div className="flex items-center gap-2">
              {notebookPath && workspaceNotebookHref && (
                <a
                  href={workspaceNotebookHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-db-red-fg hover:underline transition-colors"
                  title="Open notebook in Databricks workspace"
                >
                  Open in workspace
                </a>
              )}
              <button
                type="button"
                onClick={showNotebook ? () => setShowNotebook(false) : loadNotebookPreview}
                disabled={notebookLoading}
                className="text-[10px] font-medium text-text-tertiary hover:text-db-red-fg flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {notebookLoading ? (
                  <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin shrink-0" aria-hidden /> Loading…</span>
                ) : showNotebook ? (
                  'Hide'
                ) : (
                  'Preview'
                )}
              </button>
              {notebookContent && <CopyButton text={notebookContent} />}
              {notebookContent && (
                <div className="relative group">
                  <span className="text-[10px] text-text-tertiary hover:text-db-red-fg cursor-help border border-border rounded px-1.5 py-0.5 transition-colors" tabIndex={0}>Help</span>
                  <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-200 absolute bottom-full right-0 mb-2 z-50 min-w-[280px] bg-surface border border-border rounded-lg shadow-xl p-3 text-[10px] text-text-secondary leading-relaxed whitespace-pre-line">
                    <div className="font-bold text-text-primary mb-1.5">HOW TO USE:</div>
                    <div>1. Open Genie Code in your Databricks workspace (side panel in any notebook)</div>
                    <div>2. Copy the ENTIRE content of the instruction below</div>
                    <div>3. Paste it into Genie Code and let Genie generate the implementation</div>
                    <div>4. Genie writes the complete code. Review it, iterate, and run it</div>
                    <div className="absolute bottom-[-5px] right-3 w-2.5 h-2.5 bg-surface border-b border-e border-border rotate-45" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {!shippedGenie && notebookPath && (
            <p className="text-[10px] text-text-tertiary mb-2 leading-relaxed">
              This notebook holds an outline or part of the instruction. To write the full Genie Code instruction, use <span className="font-semibold">{START_MVP_LABEL}</span> and choose {NOTEBOOK_MODE_LABEL}. Preview shows the notebook cells or the instruction text when there are some.
            </p>
          )}

          {notebookError && (
            <p className="text-[11px] text-error-fg">{notebookError}</p>
          )}

          {notebookLoading && !notebookContent && (
            <div className="flex items-center gap-2 py-4 text-[11px] text-text-tertiary">
              <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
              Loading notebook preview…
            </div>
          )}

          {showNotebook && notebookContent && (
            <div className="relative rounded-lg border border-db-red/20 overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-db-red/30 rounded-s-lg" />
              <div className="bg-bg p-4 ps-5 overflow-x-auto max-h-[500px] overflow-y-auto">
                <GenieMarkdownPreview content={notebookContent} />
              </div>
            </div>
          )}
        </div>
      )}

      {typeof onFeedback === 'function' && (
        <FeedbackControls
          useCaseKey={v130?.useCaseKey}
          available={feedbackAvailable}
          current={feedbackCurrent}
          busy={feedbackBusy}
          error={feedbackError}
          note={feedbackNote}
          readOnly={feedbackReadOnly}
          onSubmit={onFeedback}
        />
      )}
    </div>
  );
}
