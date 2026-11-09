import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw } from 'lucide-react';
import { COPIED_SEND_TEXT, COPY_SEND_LABEL, DETAILS_LABEL, RETRYING_LABEL, RETRY_LABEL, sendText, splitTechnical } from '../lib/plainText';
import { copyText } from '../lib/clipboard';

const CHOICE_BUTTON = 'inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg whitespace-nowrap text-[11px] font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-60';
const COPIED_MS = 2500;

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

export function RetryChoice({ onRetry, label = RETRY_LABEL }) {
  const [trying, setTrying] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  if (!onRetry) return null;
  const again = () => {
    setTrying(true);
    Promise.resolve().then(onRetry).catch(() => {}).finally(() => { if (live.current) setTrying(false); });
  };
  return (
    <button type="button" data-retry="" disabled={trying} onClick={again} className={CHOICE_BUTTON}>
      {trying ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RotateCcw size={12} aria-hidden />} {trying ? RETRYING_LABEL : label}
    </button>
  );
}

export function CopySendChoice({ text }) {
  const [state, setState] = useState('');
  useEffect(() => {
    if (state !== 'copied') return undefined;
    const t = setTimeout(() => setState(''), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => copyText(text).then(() => setState('copied'), () => setState('failed'));
  return (
    <>
      <button type="button" data-copy-send="" onClick={copy} className={CHOICE_BUTTON}>
        {state === 'copied' ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {COPY_SEND_LABEL}
      </button>
      {state === 'copied' && <span role="status" className="text-[11px] text-text-secondary">{COPIED_SEND_TEXT}</span>}
      {state === 'failed' && <span role="status" className="basis-full text-[11px] text-text-secondary select-all">{text}</span>}
    </>
  );
}

export function PlainMessage({ text, after = '', as: Tag = 'p', className = '', onRetry = null, copy = false, actions = null, ...rest }) {
  const split = splitTechnical(text);
  const { details } = split;
  const plain = split.plain && after ? `${split.plain}${/[.!?…]$/.test(split.plain) ? '' : '.'} ${after}` : split.plain;
  if (!plain && !details.length) return null;
  const sendable = copy || Boolean(onRetry && details.length > 0);
  const choices = onRetry || sendable || actions;
  if (!choices) {
    return (
      <>
        {plain && <Tag className={className} {...rest}>{plain}</Tag>}
        <TechnicalDetails items={details} />
      </>
    );
  }
  return (
    <div className={`${className} space-y-1.5`} {...rest}>
      {plain && <Tag>{plain}</Tag>}
      <div data-choices="" className="flex flex-wrap items-center gap-1.5">
        <RetryChoice onRetry={onRetry} />
        {sendable && <CopySendChoice text={sendText(plain, details)} />}
        {actions}
      </div>
      <TechnicalDetails items={details} />
    </div>
  );
}
