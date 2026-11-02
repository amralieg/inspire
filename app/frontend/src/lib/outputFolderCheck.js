import { useEffect, useState } from 'react';

export const OUTPUT_CHECK_DELAY_MS = 500;
export const OUTPUT_CHECK_URL = '/api/output-folder/check';

const CHECKING = { state: 'checking', text: '', folder: '', checked: '' };

export function outputCheckRequest(generationPath) {
  return { method: 'POST', body: JSON.stringify({ generation_path: String(generationPath ?? '') }) };
}

export function outputCheckVerdict(path, data, err) {
  if (err) {
    const text = String(err.message || 'Inspire could not check the output folder.');
    return { path, state: err.status === 403 ? 'refused' : 'error', text, folder: '', checked: '' };
  }
  if (data && data.allowed === true) return { path, state: 'passed', text: '', folder: String(data.folder || path), checked: String(data.checked || '') };
  return { path, state: 'error', text: 'Inspire got no clear answer from the output folder check.', folder: '', checked: '' };
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
  return { ...current, ready: current.state === 'passed' };
}
