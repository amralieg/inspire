import { useEffect, useRef, useState } from 'react';
import { draftMessage } from './api.js';
import { Icon } from './icons.jsx';
import { DRAFT_ATTEMPTS, DRAFT_COPIED, DRAFT_FAILED, DRAFT_MANUAL, recordsText } from './records.js';
import { Skeleton, useDialog, useToast } from './ui.jsx';

export async function copyText(text, box) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!box) return false;
    box.focus();
    box.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function DraftDialog({ pageId, keys, label, onClose }) {
  const ref = useDialog(true, onClose);
  const box = useRef(null);
  const toast = useToast();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ busy: true, error: '', draft: null });
  const [text, setText] = useState('');
  const [manual, setManual] = useState(false);
  const asked = JSON.stringify(keys.map(String));
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, busy: true, error: '' }));
    setManual(false);
    draftMessage({ page: pageId, record_keys: JSON.parse(asked), attempt })
      .then((draft) => {
        if (!live) return;
        setState({ busy: false, error: '', draft });
        setText(draft.text);
      })
      .catch((err) => { if (live) setState((s) => ({ ...s, busy: false, error: err.message || DRAFT_FAILED })); });
    return () => { live = false; };
  }, [pageId, asked, attempt]);
  const copy = async () => {
    if (await copyText(text, box.current)) {
      setManual(false);
      toast(DRAFT_COPIED);
    } else {
      setManual(true);
      box.current?.focus();
      box.current?.select();
    }
  };
  const many = keys.length > 1;
  const { busy, error, draft } = state;
  return (
    <dialog ref={ref} className="dialog" aria-label="Draft a message" data-draft onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg" data-toast-host>
        <header>
          <h2>Draft a message</h2>
          <p>{many ? `One message about ${recordsText(keys.length)}` : `About ${label}`}. Nothing on the record changes: copy the message and paste it into any app to send it.</p>
        </header>
        {busy && !draft && <div style={{ display: 'grid', gap: 8 }} aria-busy="true" data-draft-busy><Skeleton height={18} /><Skeleton height={18} /><Skeleton height={18} width="60%" /></div>}
        {busy && draft && <p className="note note--flat" role="status" data-draft-busy>Writing a new draft…</p>}
        {error && <p className="hint hint--box" role="alert" data-draft-error><Icon name="info" size={14} /><span>{DRAFT_FAILED}: {error}</span></p>}
        {draft?.note && !busy && <p className="note note--flat" role="status" data-draft-note><Icon name="info" size={14} />{draft.note}</p>}
        {draft && (
          <label className="in"><span>Message</span>
            <textarea ref={box} dir="auto" name="draft_message" rows={12} value={text} readOnly={busy} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        {manual && <p className="note note--flat" role="status" data-draft-manual>{DRAFT_MANUAL}</p>}
        <footer>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)} disabled={busy || attempt >= DRAFT_ATTEMPTS}>
            <Icon name="undo" size={14} />{error && !draft ? 'Try again' : 'Regenerate'}
          </button>
          <button type="button" className="btn btn--pri" onClick={copy} disabled={busy || !text.trim()}>Copy</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </footer>
      </div>
    </dialog>
  );
}
