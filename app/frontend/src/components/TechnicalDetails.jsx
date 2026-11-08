import { DETAILS_LABEL, splitTechnical } from '../lib/plainText';

export default function TechnicalDetails({ items, label = DETAILS_LABEL, className = '' }) {
  const lines = (Array.isArray(items) ? items : [items]).map((item) => String(item ?? '').trim()).filter(Boolean);
  if (!lines.length) return null;
  return (
    <details data-technical-details="" className={`text-[11px] text-text-tertiary ${className}`}>
      <summary className="cursor-pointer hover:text-text-secondary">{label}</summary>
      <pre className="mt-2 p-2 rounded-lg bg-surface border border-border text-[10px] text-text-secondary whitespace-pre-wrap break-words font-mono">
        {lines.join('\n')}
      </pre>
    </details>
  );
}

export function PlainMessage({ text, className = '', ...rest }) {
  const { plain, details } = splitTechnical(text);
  if (!plain && !details.length) return null;
  return (
    <>
      {plain && <p className={className} {...rest}>{plain}</p>}
      <TechnicalDetails items={details} />
    </>
  );
}
