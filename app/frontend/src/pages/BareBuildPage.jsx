import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hammer, Loader2 } from 'lucide-react';
import { makeApiFetch } from '../lib/apiClient';
import { sessionSucceeded } from '../lib/monitorState';
import { PlainMessage } from '../components/TechnicalDetails';
import Button from '../components/ui/Button';
import UiPageHeader from '../components/ui/PageHeader';

// FX-94 (D-uae-03, REQ-482): "#/build" with no run id. Build needs a run, so this page looks for the newest finished one and opens it.
// While it reads, a spinner shows; with no finished run, a plain message and a way forward; a failed read shows Retry. Never a blank page.
export default function BareBuildPage({ settings, onPick, onReview }) {
  const { token, databricksHost, showcase = '', inspireDatabase, warehouseId } = settings;
  const apiFetch = useMemo(() => makeApiFetch({ token, databricksHost, showcase }), [token, databricksHost, showcase]);
  const [state, setState] = useState({ phase: 'loading', error: '' });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!inspireDatabase || !warehouseId) { setState({ phase: 'empty', error: '' }); return undefined; }
    let cancelled = false;
    setState({ phase: 'loading', error: '' });
    const q = new URLSearchParams({ inspire_database: inspireDatabase, warehouse_id: warehouseId, all: '1' });
    apiFetch(`/api/inspire/sessions?${q}`).then((data) => {
      if (cancelled) return;
      const done = (data?.sessions || []).find(sessionSucceeded);
      if (done) onPick(String(done.session_id));
      else setState({ phase: 'empty', error: '' });
    }, (e) => { if (!cancelled) setState({ phase: 'error', error: e?.message || 'The builds could not be read.' }); });
    return () => { cancelled = true; };
  }, [apiFetch, inspireDatabase, warehouseId, onPick, tick]);

  return (
    <div className="w-full px-6 py-10 space-y-4" data-implement-bare="">
      <UiPageHeader icon={Hammer} title="Build" />
      {state.phase === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" /> Loading your builds…</p>
      )}
      {state.phase === 'empty' && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">No builds yet. Pick a use case on Review to build one.</p>
          <Button onClick={onReview}>Go to Review</Button>
        </div>
      )}
      {state.phase === 'error' && (
        <PlainMessage text={state.error} className="text-xs text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2" onRetry={retry} copy />
      )}
    </div>
  );
}
