import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import TechnicalDetails from './TechnicalDetails';
import PermissionRequired from './PermissionRequired';

function Notes({ items }) {
  if (!items.length) return null;
  return (
    <ul data-output-check-notes className="mt-1 space-y-0.5 text-xs text-warning-fg">
      {items.map((note) => (
        <li key={note} className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{note}</span>
        </li>
      ))}
    </ul>
  );
}

export default function OutputFolderCheck({ check, where = '', id }) {
  const [grant, setGrant] = useState(false);
  if (check.state === 'checking') {
    return (
      <p id={id} role="status" data-output-check="checking" className="flex items-center gap-1.5 text-xs text-text-tertiary mt-2">
        <Loader2 size={12} className="animate-spin shrink-0" />
        Checking that you can write to the output folder. Get Started waits for this check.
      </p>
    );
  }
  if (check.state === 'passed') {
    const warnings = check.warnings || [];
    return (
      <div id={id} role="status" data-output-check="passed" className="mt-2">
        {warnings.length ? (
          <>
            <Notes items={warnings} />
            <TechnicalDetails items={check.details || []} className="mt-1" />
          </>
        ) : (
          <p className="text-xs text-text-tertiary break-words min-w-0">{`Results go to ${check.folder}.`}</p>
        )}
      </div>
    );
  }
  if (check.state === 'unchecked') {
    return (
      <p id={id} role="status" data-output-check="unchecked" className="flex items-start gap-1.5 text-xs text-warning-fg mt-2">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <span className="break-words min-w-0">{check.text}</span>
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
        {check.permissions?.length > 0 && (
          <button type="button" data-see-grant="" onClick={() => setGrant(true)}
            className="mt-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:bg-bg-subtle">
            See the grant
          </button>
        )}
        {grant && <PermissionRequired permissions={check.permissions} onClose={() => setGrant(false)} />}
      </div>
    </div>
  );
}
