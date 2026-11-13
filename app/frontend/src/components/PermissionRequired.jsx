import { useRef, useState } from 'react';

const BUTTON = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle';

function permissionText(permissions) {
  return (permissions || []).flatMap((p) => [...(p.statements || []).map((s) => (s.endsWith(';') ? s : `${s};`)), ...(p.instructions || [])]).join('\n');
}

export default function PermissionRequired({ permissions, onStart, onRetry, onClose }) {
  const [status, setStatus] = useState('');
  const block = useRef(null);
  const text = permissionText(permissions);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
      return;
    } catch {
      // the Clipboard API is refused here, so select the text and let the browser copy it
    }
    const range = document.createRange();
    range.selectNodeContents(block.current);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    setStatus(copied ? 'Copied' : 'Select and copy');
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="permission-required-title" data-permission-dialog=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h2 id="permission-required-title" className="text-base font-bold text-text-primary">Permission Required</h2>
        {(permissions || []).map((p) => (
          <div key={[...p.statements, ...(p.instructions || [])].join('|')} className="space-y-2">
            {p.why && <p className="text-sm text-text-secondary">{p.why}</p>}
            <p className="text-sm text-text-primary">
              Ask your admin to grant this permission{p.principal ? ` to ${p.principal}` : ''}:
            </p>
          </div>
        ))}
        <pre ref={block} data-permission-statements="" className="whitespace-pre-wrap break-all rounded-md bg-bg-subtle p-3 font-mono text-xs text-text-primary">{text}</pre>
        {status === 'Select and copy' && <p role="status" className="text-xs text-text-secondary">Select and copy: the statements are selected above.</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={copy} className={BUTTON}>{status === 'Copied' ? 'Copied' : 'Copy'}</button>
          {onRetry && <button type="button" onClick={onRetry} className={BUTTON}>Try again</button>}
          {onStart && <button type="button" onClick={onStart} className={BUTTON}>Start anyway</button>}
          <button type="button" onClick={onClose} className={BUTTON}>Close</button>
        </div>
      </div>
    </div>
  );
}
