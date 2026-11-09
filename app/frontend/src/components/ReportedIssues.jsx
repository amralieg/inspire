import { useCallback, useEffect, useState } from 'react';
import { MessageSquareWarning, Sparkles, X } from 'lucide-react';
import { PANEL_CLASS, SectionTitle } from './BuildUi';
import { PlainMessage } from './TechnicalDetails';

const FILTERS = [['new', 'New'], ['vibe', 'Turned into vibe'], ['closed', 'Closed']];
const BUTTON = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const ERROR = 'text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2';
const NOTE = 'text-xs text-info-fg bg-info-bg border border-info/20 rounded-lg px-3 py-2';

export const FEEDBACK_ROUTES = {
  list: '/api/inspire/implement/feedback',
  status: '/api/inspire/implement/feedback/status',
  vibe: '/api/inspire/implement/feedback/vibe',
};

export function useReportedIssues({ apiFetch, apiPostJson, qBase, useCaseId, on, refreshKey }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(0);
  const query = `${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`;
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    apiFetch(`${FEEDBACK_ROUTES.list}?${query}`)
      .then((data) => { if (live) { setView(data); setError(''); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [apiFetch, query, on, refreshKey, again]);
  const reload = useCallback(() => setAgain((n) => n + 1), []);
  const setStatus = useCallback(async (feedbackId, status, vibeText = '') => {
    const data = await apiPostJson(`${FEEDBACK_ROUTES.status}?${query}`, { feedback_id: feedbackId, status, vibe_text: vibeText });
    setView(data);
    return data;
  }, [apiPostJson, query]);
  const draftVibe = useCallback((feedbackId) => apiPostJson(`${FEEDBACK_ROUTES.vibe}?${query}`, { feedback_id: feedbackId }), [apiPostJson, query]);
  return { view, error, reload, setStatus, draftVibe };
}

function where(item) {
  return [item.section ? `${item.section[0].toUpperCase()}${item.section.slice(1)}` : '', item.record_key ? `record ${item.record_key}` : '',
    item.filters && item.filters !== 'none' ? item.filters : ''].filter(Boolean).join(' · ');
}

export default function ReportedIssues({ issues, onDraft, locked = '' }) {
  const { view, error, reload, setStatus, draftVibe } = issues;
  const [shown, setShown] = useState('new');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState(null);
  const [said, setSaid] = useState('');
  if (!view && !error) return null;
  if (!error && !view?.items?.length) return null;
  const items = view?.items || [];
  const counts = Object.fromEntries(FILTERS.map(([id]) => [id, items.filter((i) => i.status === id).length]));
  const listed = items.filter((i) => i.status === shown);
  const act = async (item, kind) => {
    setBusy(`${kind}:${item.feedback_id}`);
    setFailure(null);
    setSaid('');
    try {
      if (kind === 'close') {
        await setStatus(item.feedback_id, 'closed');
      } else {
        const draft = await draftVibe(item.feedback_id);
        if (!draft.vibe) setSaid(`No change to make: ${draft.genie_should}`);
        else onDraft({ text: draft.vibe, feedback: item.feedback_id });
      }
    } catch (e) {
      setFailure({ text: e.message, again: () => act(item, kind) });
    } finally {
      setBusy('');
    }
  };
  return (
    <section aria-label="Reported issues" data-reported-issues="" className={`${PANEL_CLASS} shrink-0`}>
      <SectionTitle icon={MessageSquareWarning} title="Reported issues"
        hint={counts.new ? `${counts.new} new from the people using the App` : 'What the people using the App reported'}
        right={<span data-new-issues={counts.new} className="text-xs font-semibold text-text-secondary">{counts.new} new</span>} />
      <div className="p-4 space-y-3">
        <div role="tablist" aria-label="Show issues" className="flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={shown === id} data-issue-filter={id} onClick={() => setShown(id)}
              className={`${BUTTON} ${shown === id ? 'bg-bg-subtle ring-1 ring-border' : ''}`}>
              {label} <span className="text-text-secondary">{counts[id]}</span>
            </button>
          ))}
        </div>
        {error && <PlainMessage text={`Inspire could not read the reported issues: ${error}`} className={ERROR} data-issues-error="" onRetry={reload} copy />}
        {failure && <PlainMessage text={failure.text} className={ERROR} role="alert" onRetry={failure.again} copy />}
        {said && <p className={NOTE} role="status">{said}</p>}
        {!view?.editable && view?.why && <p className="text-xs text-text-secondary">{view.why}</p>}
        {!listed.length && view && <p className="text-xs text-text-secondary" data-issues-empty="">Nothing here.</p>}
        <ul className="space-y-2">
          {listed.map((item) => (
            <li key={item.feedback_id} data-issue={item.feedback_id} className="border border-border rounded-lg px-3 py-2 space-y-1.5">
              <p dir="auto" className="text-sm text-text-primary whitespace-pre-wrap break-words">{item.text}</p>
              <p className="text-[11px] text-text-tertiary">{[where(item), item.reported_by, item.reported_at ? String(item.reported_at).slice(0, 16) : ''].filter(Boolean).join(' · ')}</p>
              {item.status === 'vibe' && item.vibe_text && <p className="text-xs text-text-secondary" data-issue-vibe="">Vibe: {item.vibe_text}</p>}
              {item.status === 'new' && view?.editable && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={BUTTON} disabled={Boolean(busy) || Boolean(locked)} title={locked || undefined}
                    onClick={() => act(item, 'vibe')} data-issue-vibe-draft="">
                    <Sparkles size={12} /> {busy === `vibe:${item.feedback_id}` ? 'Drafting…' : 'Add to vibe'}
                  </button>
                  <button type="button" className={BUTTON} disabled={Boolean(busy)} onClick={() => act(item, 'close')} data-issue-close="">
                    <X size={12} /> Not a change
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
