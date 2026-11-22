import { useEffect, useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import { copyStepsText, copyText, grantAsk, grantListKey } from '../lib/permissionBus';
import { accessRequestResultText, checkAccessRequest, offerShown, sendAccessRequest, statementsOf } from '../lib/accessRequest';
import { otherRequestLinks, requestFormLink, requestFormText } from '../lib/accessRequestText';
import { Loader2 } from 'lucide-react';

const BUTTON = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle';
const PRIMARY = 'inline-flex h-8 items-center justify-center px-3 rounded-lg text-xs font-semibold text-white bg-db-red-solid hover:opacity-90 disabled:opacity-60';
// REQ-313: Request access is the primary action. The SQL sits under Advanced, with the one instruction line (REQ-300). Advanced opens
// by default only when no destination exists, because then the SQL is the way forward.
export const ADVANCED_LINE = 'Copy the text below and pass it on to your Databricks admin.';

export default function PermissionRequired({ permissions, onStart, onRetry, onClose }) {
  const [status, setStatus] = useState('');
  const [stepsStatus, setStepsStatus] = useState('');
  // REQ-311: Request for Access. The destinations are read once per grant list; the button shows only when one is set.
  const [offer, setOffer] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [formLink, setFormLink] = useState(null);
  // REQ-406: the check promise is kept, so a click made before the check returns waits for it and never sends blind.
  const checkRef = useRef(null);
  const [requestText, setRequestText] = useState('');
  const [advancedState, setAdvancedState] = useState(null);
  const box = useRef(null);
  const text = copyText(permissions);
  const granted = (permissions || []).filter((p) => (p?.statements || []).length > 0);
  // Copy steps: the folder Share and CLI steps. A note (a reason to rebuild) is plain text, shown once, never copied.
  const steps = copyStepsText(permissions);
  const notes = (permissions || []).flatMap((p) => p?.instructions || []);
  const reasons = (permissions || []).filter((p) => p?.why).map((p) => p.why);
  const asked = statementsOf(permissions);
  const listKey = grantListKey(permissions);
  const advancedOpen = advancedState ?? (offer !== null && !offerShown(offer));
  useEffect(() => {
    setOffer(null);
    setRequestText('');
    setAdvancedState(null);
    setFormLink(null);
    checkRef.current = null;
    if (!asked.length) return undefined;
    let live = true;
    const pending = checkAccessRequest(asked).catch(() => ({ offered: false, links: [] }));
    checkRef.current = pending;
    pending.then((got) => { if (live) setOffer(got); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per grant list: the key stands for the statements
  }, [listKey]);
  // REQ-406: the send goes out only when the check offers it. Any other outcome (no destination, a refused scope, an unresolved
  // principal, a failed send) opens the Databricks request form for the first securable in a new tab, never a raw error.
  // The tab opens inside the click, so the browser allows it; its location is set once the check or the send answers. A blocked tab
  // leaves the form link on the dialog instead.
  const requestAccess = async () => {
    setRequesting(true);
    setFormLink(null);
    const tab = window.open('about:blank', '_blank');
    if (tab) { try { tab.opener = null; } catch { /* the page keeps its opener link: the form still opens */ } }
    let got = {};
    let sent = null;
    try {
      got = (await checkRef.current) || {};
      if (offerShown(got)) sent = await sendAccessRequest(asked);
    } catch {
      sent = null;
    }
    if (sent?.sent) {
      if (tab) tab.close();
      setRequestText(accessRequestResultText(sent));
    } else {
      const first = requestFormLink(sent?.links?.length ? sent.links : (got.links || []));
      let opened = false;
      if (first && tab) {
        try { tab.location = first.url; opened = true; } catch { opened = false; }
      } else if (tab) {
        tab.close();
      }
      if (first && !opened) setFormLink(first);
      setRequestText(requestFormText(first, opened));
    }
    setRequesting(false);
  };
  const copySteps = async () => {
    try {
      await navigator.clipboard.writeText(steps);
      setStepsStatus('Copied');
    } catch {
      setStepsStatus('');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
      return;
    } catch {
      // the Clipboard API is refused here, so select the statements and let the browser copy them
    }
    const range = document.createRange();
    range.selectNodeContents(box.current);
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
  const buttons = (
    <>
      {asked.length > 0 && <button type="button" onClick={requestAccess} disabled={requesting} className={PRIMARY} data-request-access="">{requesting ? <><Loader2 size={13} className="inline me-1 animate-spin" aria-hidden />Requesting</> : 'Request access'}</button>}
      {onRetry && <button type="button" onClick={onRetry} className={BUTTON}>Try again</button>}
      {onStart && <button type="button" onClick={onStart} className={BUTTON}>Start anyway</button>}
    </>
  );
  return (
    <ModalDialog titleId="permission-required-title" title="Permission Required" onClose={onClose} overlayAttrs={{ 'data-permission-dialog': '' }}
      footer={buttons}>
      {reasons.map((why) => (
        <p key={`why-${why}`} className="text-sm text-text-secondary">{why}</p>
      ))}
      {notes.length > 0 && (
        <div data-permission-notes="" className="space-y-1">
          {notes.map((note) => <p key={note} className="text-sm text-text-primary break-words">{note}</p>)}
        </div>
      )}
      {requestText && <p role="status" data-access-request-result="" className="text-sm text-text-primary break-words">{requestText}</p>}
      {formLink && <a data-request-form-link="" href={formLink.url} target="_blank" rel="noopener noreferrer" className="text-sm text-text-primary underline break-all">{formLink.full_name}</a>}
      {otherRequestLinks(offer?.links).length > 0 && (
        <div data-request-links="" className="space-y-1">
          <p className="text-xs text-text-secondary">Also request access on:</p>
          {otherRequestLinks(offer.links).map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm text-text-primary underline break-all">{link.full_name}</a>
          ))}
        </div>
      )}
      {(text || steps) && (
        <details data-permission-advanced="" open={advancedOpen} onToggle={(e) => setAdvancedState(e.currentTarget.open)} className="space-y-3">
          <summary className="cursor-pointer text-xs font-semibold text-text-primary">Advanced</summary>
          {text && <p className="text-sm text-text-primary">{ADVANCED_LINE}</p>}
          {granted.length > 0 && (
            <div ref={box} data-permission-box="" className="max-h-56 overflow-y-auto rounded-md bg-bg-subtle p-3 space-y-3">
              {granted.map((p) => (
                <div key={[...p.statements, ...(p.instructions || [])].join('|')} className="space-y-1">
                  <p className="text-xs font-semibold text-text-primary">{grantAsk(p)}</p>
                  <pre data-permission-statements="" className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">{copyText([p])}</pre>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {text && <button type="button" onClick={copy} className={BUTTON}>{status === 'Copied' ? 'Copied' : 'Copy'}</button>}
            {steps && <button type="button" onClick={copySteps} className={BUTTON}>{stepsStatus === 'Copied' ? 'Copied' : 'Copy steps'}</button>}
          </div>
          {steps && (
            <div data-permission-steps="" className="max-h-56 overflow-y-auto rounded-md bg-bg-subtle p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">{steps}</pre>
            </div>
          )}
          {status === 'Select and copy' && <p role="status" className="text-xs text-text-secondary">Select and copy: the statements are selected above.</p>}
        </details>
      )}
    </ModalDialog>
  );
}
