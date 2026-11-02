import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowDown, Terminal, Info } from 'lucide-react';
import GenieLogo from './GenieLogo';
import { feedLine, feedKey, feedTypesOut, typedText, typingSchedule } from '../lib/mvpProgress';
import { reducedMotion } from '../lib/motion';

const TONE_TEXT = { plain: 'text-text-primary', quiet: 'text-text-secondary', warning: 'text-warning-fg', error: 'text-error-fg' };
const PINNED_TOP_PX = 160;
const TICK_MS = 60;
const FEED_MARKDOWN = ['p', 'strong', 'em', 'code', 'ul', 'ol', 'li'];
const FEED_COMPONENTS = {
  p: ({ children }) => <p className="[&+*]:mt-1.5">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
  code: ({ children }) => <code className="px-1 py-px rounded bg-bg-subtle ring-1 ring-inset ring-border font-mono text-[12px]">{children}</code>,
};

function clock(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function GenieFeed({ feed, arrivals, active, working }) {
  const endRef = useRef(null);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState(false);
  const [readCount, setReadCount] = useState(null);
  const [reduced] = useState(reducedMotion);

  const entries = useMemo(() => (Array.isArray(feed) ? feed : [])
    .map((item) => ({ item, key: feedKey(item), line: feedLine(item) }))
    .filter((entry) => entry.line && entry.line.text), [feed]);
  const schedule = useMemo(() => (reduced ? { starts: new Map(), end: 0 } : typingSchedule(feed, arrivals)), [feed, arrivals, reduced]);

  const typing = schedule.end > now;
  useEffect(() => {
    if (!typing) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [typing]);

  const waitingAt = entries.findIndex((entry) => (schedule.starts.get(entry.key) ?? -Infinity) > now);
  const shown = waitingAt < 0 ? entries : entries.slice(0, waitingAt);
  if (readCount === null && Array.isArray(feed)) setReadCount(shown.length);
  const unread = !pinned && readCount !== null && shown.length > readCount;

  const count = shown.length;
  useEffect(() => {
    const end = endRef.current;
    if (!end || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => {
      setPinned(entry.isIntersecting);
      if (entry.isIntersecting) setReadCount(count);
    }, { rootMargin: `-${PINNED_TOP_PX}px 0px 0px 0px` });
    watch.observe(end);
    return () => watch.disconnect();
  }, [count]);

  useLayoutEffect(() => {
    if (pinned) endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [count, now, pinned, active]);

  const jump = () => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
    setPinned(true);
    setReadCount(count);
  };

  const said = entries.filter((entry) => entry.line.who === 'genie' && feedTypesOut(entry.item)).length;
  return (
    <div className="relative" data-genie-feed="">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-border bg-bg-subtle">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          <GenieLogo size={13} /> Genie&apos;s messages
        </span>
        {Array.isArray(feed) && (
          <span className="text-[11px] text-text-secondary">
            {said} {said === 1 ? 'message' : 'messages'}{active ? ' · new ones appear as Genie works' : ''}
          </span>
        )}
      </div>
      <div
        role="log"
        aria-live="polite"
        aria-busy={typing}
        aria-label="Genie's messages"
        className="bg-panel px-4 py-4 space-y-3"
      >
        {!Array.isArray(feed) && <p className="text-[12px] text-text-tertiary">Loading Genie&apos;s messages…</p>}
        {Array.isArray(feed) && shown.length === 0 && (
          <p className="text-[12px] text-text-tertiary">
            {active ? 'Genie’s messages appear here as it works.' : 'Genie sent no messages for this version.'}
          </p>
        )}
        {shown.map((entry) => {
          const start = schedule.starts.get(entry.key);
          const text = start === undefined ? entry.line.text : typedText(entry.line.text, now - start);
          const still = text !== entry.line.text;
          const tone = TONE_TEXT[entry.line.tone] || TONE_TEXT.plain;
          const time = clock(entry.item.at);
          if (entry.line.who === 'genie' && feedTypesOut(entry.item)) {
            return (
              <div key={entry.key} className="flex gap-2.5 animate-terminal-line" data-feed-kind={entry.item.kind}>
                <span className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-db-red-50 text-db-red-fg ring-1 ring-inset ring-db-red/20 flex items-center justify-center">
                  <GenieLogo size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="inline-block max-w-full rounded-2xl rounded-tl-md px-3.5 py-2.5 bg-surface ring-1 ring-inset ring-border shadow-sm">
                    <div className={`text-[13px] leading-relaxed break-words ${tone} ${still ? '[&>p:last-of-type]:inline' : ''}`}>
                      <ReactMarkdown allowedElements={FEED_MARKDOWN} unwrapDisallowed components={FEED_COMPONENTS}>{text}</ReactMarkdown>
                      {still && <span className="ml-0.5 inline-block w-1.5 h-3.5 align-[-2px] bg-db-red-fg animate-cursor-blink" aria-hidden />}
                    </div>
                  </div>
                  {time && <p className="mt-1 text-[10px] text-text-tertiary">Genie · {time}</p>}
                </div>
              </div>
            );
          }
          const Icon = entry.line.who === 'genie' ? Terminal : Info;
          return (
            <div key={entry.key} className="flex items-start gap-2.5 pl-1 animate-terminal-line" data-feed-kind={entry.item.kind}>
              <Icon size={13} className={`mt-0.5 shrink-0 ${entry.line.tone === 'error' ? 'text-error-fg' : 'text-text-tertiary'}`} aria-hidden />
              <p className={`text-[12px] ${tone}`}>
                {entry.line.who === 'inspire' && <span className="font-semibold text-text-secondary">Inspire · </span>}
                {entry.line.text}
                {time && <span className="text-[10px] text-text-tertiary"> · {time}</span>}
              </p>
            </div>
          );
        })}
        {active && (
          <div className="flex items-center gap-2.5 pt-1" data-genie-working="">
            <span className="shrink-0 w-7 h-7 rounded-full bg-db-red-50 text-db-red-fg ring-1 ring-inset ring-db-red/20 flex items-center justify-center motion-safe:animate-pulse">
              <GenieLogo size={15} />
            </span>
            <span className="text-[12px] text-text-secondary">{working || 'Genie is working'}</span>
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-db-red-fg motion-safe:animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </span>
          </div>
        )}
        <span ref={endRef} data-feed-end="" aria-hidden className="block h-px" />
      </div>
      {unread && (
        <button
          type="button"
          onClick={jump}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white bg-db-red-solid shadow-lg"
        >
          <ArrowDown size={12} /> Jump to latest
        </button>
      )}
    </div>
  );
}
