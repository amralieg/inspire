import { useEffect, useState } from 'react';

export const OUTPUT_CHECK_DELAY_MS = 500;
export const OUTPUT_CHECK_URL = '/api/output-folder/check';

const CHECKING = { state: 'checking', text: '', folder: '', checked: '', warnings: [], details: [] };
const UNCHECKED_TAIL = 'Get Started still works, and the run checks the folder again.';
const lines = (items) => (Array.isArray(items) ? items.filter((item) => item != null).map(String).filter(Boolean) : []);

export function outputCheckRequest(generationPath) {
  return { method: 'POST', body: JSON.stringify({ generation_path: String(generationPath ?? '') }) };
}

export function outputCheckVerdict(path, data, err) {
  if (err && [400, 401, 403].includes(err.status)) {
    return { path, state: 'refused', text: String(err.message || 'You cannot write to the output folder.'), folder: '', checked: '', warnings: [], details: [] };
  }
  if (!err && data && data.allowed === true) {
    return { path, state: 'passed', text: '', folder: String(data.folder || path), checked: String(data.checked || ''),
      warnings: lines(data.warnings), details: lines(data.warning_details) };
  }
  const why = err ? String(err.message || 'the check did not answer') : 'the check gave no clear answer';
  return { path, state: 'unchecked', text: `Inspire could not check the output folder (${why}). ${UNCHECKED_TAIL}`, folder: '', checked: '', warnings: [], details: [] };
}

export function useOutputFolderCheck(apiFetch, generationPath) {
  const path = String(generationPath ?? '');
  const [check, setCheck] = useState({ path: null, ...CHECKING });
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      let verdict;
      try {
        verdict = outputCheckVerdict(path, await apiFetch(OUTPUT_CHECK_URL, outputCheckRequest(path)), null);
      } catch (err) {
        verdict = outputCheckVerdict(path, null, err);
      }
      if (!cancelled) setCheck(verdict);
    }, OUTPUT_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiFetch, path]);
  const current = check.path === path ? check : { path, ...CHECKING };
  return { ...current, ready: current.state === 'passed' || current.state === 'unchecked' };
}
