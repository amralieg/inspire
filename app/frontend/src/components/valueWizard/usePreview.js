import { useEffect, useRef, useState } from 'react';
import { PREVIEW_DEBOUNCE_MS, PREVIEW_ROUTE, answersKey, bodyOf } from '../../lib/valueWizard.js';

// REQ-436: the live amounts. Every change of the answers asks the server (the latest request wins); no amount is worked out here.
// REQ-450: throttled, not debounced: during a slider drag a request goes out at most every PREVIEW_DEBOUNCE_MS, so the amount moves while the user drags.
export default function usePreview(plan, answers, apiPostJson) {
  const [state, setState] = useState({ status: 'updating', yearly: null, error: '' });
  const latest = useRef(0);
  const lastSent = useRef(0);
  const key = plan && answers ? `${plan.grouping}|${answersKey(answers)}` : '';
  useEffect(() => {
    if (!key) return undefined;
    latest.current += 1;
    const mine = latest.current;
    setState((s) => ({ ...s, status: 'updating' }));
    const wait = Math.max(0, PREVIEW_DEBOUNCE_MS - (Date.now() - lastSent.current));
    const timer = setTimeout(async () => {
      lastSent.current = Date.now();
      try {
        const got = await apiPostJson(PREVIEW_ROUTE, bodyOf(plan, answers));
        if (mine === latest.current) setState({ status: 'ready', yearly: got?.yearly || null, error: '' });
      } catch (err) {
        if (mine === latest.current) setState((s) => ({ ...s, status: 'error', error: String(err?.message || err || 'The value could not be worked out.') }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
