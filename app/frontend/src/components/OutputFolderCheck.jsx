import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

export default function OutputFolderCheck({ check, where = '', id }) {
  if (check.state === 'checking') {
    return (
      <p id={id} role="status" data-output-check="checking" className="flex items-center gap-1.5 text-xs text-text-tertiary mt-2">
        <Loader2 size={12} className="animate-spin shrink-0" />
        Checking that you can write to the output folder. Get Started waits for this check.
      </p>
    );
  }
  if (check.state === 'passed') {
    return (
      <p id={id} role="status" data-output-check="passed" className="flex items-start gap-1.5 text-xs text-success-fg mt-2">
        <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
        <span className="break-words min-w-0">
          {check.checked === 'manager'
            ? `You manage this App, so Inspire skips the write check for ${check.folder}.`
            : `You can write to ${check.folder}.`}
        </span>
      </p>
    );
  }
  return (
    <div id={id} role="alert" data-output-check={check.state}
      className="flex items-start gap-2 text-xs text-error-fg bg-error-bg border border-error/30 rounded-lg px-3 py-2 mt-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="break-words">{check.text}</p>
        <p className="mt-1 text-text-secondary">
          {`Get Started stays off until the output folder check passes${where ? `. ${where}` : ''}.`}
        </p>
      </div>
    </div>
  );
}
