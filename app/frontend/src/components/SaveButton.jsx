import { Loader2 } from 'lucide-react';

export default function SaveButton({ busy = false, busyLabel = 'Saving…', disabled = false, type = 'button', className, children, ...rest }) {
  return (
    <button {...rest} type={type} className={className} disabled={disabled || busy} aria-busy={busy || undefined} data-saving={busy ? '' : undefined}>
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}{busy ? busyLabel : children}
    </button>
  );
}
