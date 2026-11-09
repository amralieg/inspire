import { useCallback, useEffect, useId, useState } from 'react';
import { Bug, Check, Copy, Download } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import { saveBlob } from '../lib/download';
import { DIAGNOSTICS_PRIVACY_NOTE, REPORT_ISSUE_NOTE, newIssueUrl } from '../lib/issues';

const BUTTON_CLASS = 'shrink-0 inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40';
const COPIED_MS = 2500;

export default function useBuildDiagnostics({ apiFetch, query, refreshKey = '', enabled = true }) {
  const noteId = useId();
  const [issue, setIssue] = useState({ key: '', value: null });
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const key = `${query}|${refreshKey}`;
  const ready = issue.key === key ? issue.value : null;
  const load = useCallback(() => apiFetch(`/api/inspire/implement/diagnostics?${query}`).then((d) => {
    setIssue({ key, value: d?.issue || null });
    return d;
  }), [apiFetch, query, key]);
  const prepare = () => { if (!ready) load().catch(() => {}); };

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const run = async (what, act) => {
    setBusy(what);
    setError('');
    try {
      await act();
    } catch (err) {
      setError(`Inspire could not ${what === 'copy' ? 'copy' : 'download'} the diagnostics: ${err?.message || err}`);
    } finally {
      setBusy('');
    }
  };

  const download = () => run('download', async () => {
    const d = await load();
    saveBlob(new Blob([d.text], { type: 'text/plain;charset=utf-8' }), d.filename);
  });

  const copy = () => run('copy', async () => {
    const answer = load();
    await copyText(answer.then((d) => d.text));
    setCopied(true);
  });

  const report = (event) => {
    if (ready) return;
    event.preventDefault();
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    const go = (url) => { if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener,noreferrer'); };
    load().then((d) => go(newIssueUrl(d?.issue))).catch(() => go(newIssueUrl(null)));
  };

  if (!enabled) return null;
  return {
    actions: (
      <>
        <button type="button" data-diagnostics-download="" aria-describedby={noteId} disabled={busy === 'download'} onClick={download} className={BUTTON_CLASS}>
          <Download size={13} aria-hidden /> Download diagnostics
        </button>
        <button type="button" data-diagnostics-copy="" aria-describedby={noteId} disabled={busy === 'copy'} onClick={copy} className={BUTTON_CLASS}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? 'Copied diagnostics' : 'Copy diagnostics'}
        </button>
        <a data-diagnostics-report="" href={newIssueUrl(ready)} target="_blank" rel="noopener noreferrer" onPointerEnter={prepare} onFocus={prepare} onClick={report} aria-describedby={noteId} className={BUTTON_CLASS}>
          <Bug size={13} aria-hidden /> Report issue
        </a>
      </>
    ),
    note: (
      <>
        <p id={noteId} data-diagnostics-note="" className="basis-full text-[11px] text-text-secondary">
          {DIAGNOSTICS_PRIVACY_NOTE} {REPORT_ISSUE_NOTE}
        </p>
        <p role="status" aria-live="polite" data-diagnostics-said="" className={error || copied ? 'basis-full text-[11px]' : 'sr-only'}>
          {error ? <span className="text-error-fg">{error}</span> : copied ? 'The diagnostics are on your clipboard.' : ''}
        </p>
      </>
    ),
  };
}
