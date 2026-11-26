// C24 (P247): "Tune values from the data Inspire processed". On by default; the person's choice lives in this browser (same cache the other settings use).
export const TUNE_FROM_DATA_KEY = 'db_tune_from_data';
export const TUNE_FROM_DATA_LABEL = 'Tune values from the data Inspire processed';
export function readTuneFromData() {
  try { return localStorage.getItem(TUNE_FROM_DATA_KEY) !== 'false'; } catch { return true; }
}
export function writeTuneFromData(on) {
  try { localStorage.setItem(TUNE_FROM_DATA_KEY, on ? 'true' : 'false'); } catch { /* storage may be blocked */ }
}
