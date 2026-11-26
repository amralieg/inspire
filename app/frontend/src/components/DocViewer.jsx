import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import FilePreview from './FilePreview';
import ModalDialog from './ModalDialog';
import { viewOf } from '../lib/docView';

const btn = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle disabled:opacity-50';

// C25 (REQ-559): "View" for a document: opens in place over the page, nothing navigates. `load()` returns the file's Blob (or null when it could not be read;
// the page then says why). A PDF is an iframe from a blob URL, a deck is its slides (picture when the slide has one, else its text), a sheet is a table.
export default function DocViewer({ name, load, onDownload, onClose }) {
  const [view, setView] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let made = null;
    (async () => {
      const blob = await load();
      if (cancelled) return;
      if (!blob) { onClose(); return; }
      made = await viewOf(name, blob);
      if (!cancelled) setView(made);
    })();
    return () => {
      cancelled = true;
      if (made?.url) URL.revokeObjectURL(made.url);
      made?.slides?.forEach((s) => { if (s.image) URL.revokeObjectURL(s.image); });
    };
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ModalDialog titleId="doc-viewer-title" title={name} onClose={onClose} widthClass="max-w-4xl" dialogAttrs={{ 'data-doc-viewer': name }}
      footer={<><button type="button" onClick={onClose} className={btn}>Close</button>
        <button type="button" onClick={onDownload} className={btn} aria-label={`Download ${name} from the viewer`}><Download size={14} aria-hidden /> Download</button></>}>
      {!view && <div className="flex items-center justify-center gap-2 py-6 text-caption text-text-secondary"><Loader2 size={14} className="animate-spin" aria-hidden /> Opening {name}...</div>}
      {view?.type === 'slides' && (
        <ol aria-label={`Slides of ${name}`} className="space-y-3">
          {view.slides.map((s, i) => (
            <li key={i} data-slide={i + 1} className="rounded-lg border border-border p-3">
              <p className="text-xs text-text-tertiary">Slide {i + 1}</p>
              <p className="text-sm font-bold text-text-primary" dir="auto">{s.title}</p>
              {s.image ? <img src={s.image} alt={`Slide ${i + 1}: ${s.title}`} className="mt-2 w-full rounded-md border border-border" />
                : s.lines.length > 0 && <ul className="mt-1 list-disc ps-5 text-xs text-text-secondary" dir="auto">{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      {view?.type === 'text' && (
        <div role="document" aria-label={`Text of ${name}`} className="space-y-2 text-sm text-text-primary" dir="auto">{view.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
      )}
      {view && ['pdf', 'csv', 'error'].includes(view.type) && <FilePreview name={name} loading={false} data={view} pdfClassName="h-[70vh] rounded-lg" />}
    </ModalDialog>
  );
}
