import { useSyncExternalStore } from 'react';

// C24 (Amr P218): whether the App's AI calls are going through. One store, fed from the one API helper (apiClient.js): no polling of the model.
// The routes below are the ones whose server handler asks the chat model (askChatModel, generate-genie, vibe, translate, describe-value).
export const AI_ROUTES = [
  '/api/inspire/value/estimate', '/api/inspire/value/case-plan', '/api/inspire/value/filter', '/api/inspire/value/run-review',
  '/api/inspire/docs/translate', '/api/inspire/generate-genie', '/api/inspire/generate_genie',
  '/api/inspire/implement/feedback/vibe', '/api/money/describe-value',
];
export const isAiRoute = (url) => { const path = String(url).split('?')[0]; return AI_ROUTES.includes(path); };

let state = { inFlight: 0, error: '' };
const listeners = new Set();
const set = (next) => { state = next; listeners.forEach((fn) => fn()); };

// Runs `call`; for an AI route it counts the call while pending, records the error text of a failure and clears it on the next success.
export async function trackAi(url, call) {
  if (!isAiRoute(url)) return call();
  set({ ...state, inFlight: state.inFlight + 1 });
  try {
    const out = await call();
    set({ inFlight: state.inFlight - 1, error: '' });
    return out;
  } catch (e) {
    const cancelled = e?.name === 'AbortError';
    set({ inFlight: state.inFlight - 1, error: cancelled ? state.error : String(e?.message || e) });
    throw e;
  }
}

export const aiStatus = () => state;
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useAiStatus = () => useSyncExternalStore(subscribe, aiStatus);
export const aiLabel = (s) => (s.inFlight > 0 ? 'working' : s.error ? 'unavailable' : 'ready');
