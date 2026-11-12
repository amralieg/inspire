import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { BestOfBestDetail, FeedbackControls, UseCaseStrategyDetail } from './UseCaseStrategyDetail';
import { workspaceNotebookUrl } from '../lib/workspaceLinks';
import { placeholderWords } from '../lib/placeholderWords';
import { copyText } from '../lib/clipboard';
import { START_MVP_LABEL } from '../lib/implementWizard';
import { KIND_INFORMATIONAL_LABEL, kindChipStyle } from '../lib/useCaseKind';
import { beneficiaryFromUc, fieldOf, hasShippedGenieCode, notebookPathOf, sponsorFromUc } from '../lib/useCaseFields';

const s = (v) => (v == null ? '' : String(v));
const stripHtml = (v) => (v == null ? '' : placeholderWords(String(v).replace(/<[^>]*>/g, ' ')).replace(/\s{2,}/g, ' ').trim());

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
  className = 'space-y-4',
  resolveTable = (t) => t,
  databricksHost,
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
  const kind = v130?.kind || null;

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
            <div className="absolute start-0 top-0 bottom-0 w-1 bg-info/30 rounded-s-lg" />
            <pre className="text-[11px] text-text-primary bg-bg p-4 ps-5 overflow-x-auto max-h-60 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
              {sql}
            </pre>
          </div>
        </div>
      )}

      {workspaceNotebookHref && (
        <div data-use-case-notebook="">
          <div className="flex items-center justify-between gap-2">
            <h4 className="min-w-0 text-[10px] font-bold text-db-red-fg uppercase tracking-[0.18em]">
              {shippedGenie ? 'Genie Code Instruction' : 'Use case notebook'}
              <span className="text-text-tertiary font-normal normal-case ms-1 font-mono text-[9px] truncate max-w-[300px] inline-block align-bottom">
                {notebookPath.split('/').pop()}
              </span>
            </h4>
            <a
              href={workspaceNotebookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-db-red-fg hover:underline transition-colors"
              title="Open the notebook in your Databricks workspace"
            >
              Open notebook <ExternalLink size={10} aria-hidden />
            </a>
          </div>
          {!shippedGenie && (
            <p className="mt-2 text-[10px] text-text-tertiary leading-relaxed">
              This notebook holds an outline or part of the instruction. To write the full Genie Code instruction, use <span className="font-semibold">{START_MVP_LABEL}</span> and tick only Notebook under Deliver.
            </p>
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
