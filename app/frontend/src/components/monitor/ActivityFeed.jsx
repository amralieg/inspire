import { useEffect, useRef } from 'react';
import { ArrowDown } from 'lucide-react';
import { splitTechnical } from '../../lib/plainText';

// REQ-511 Monitor C: "What Inspire is doing", the latest saved steps as a short feed that follows the newest line.
const FEED_LINES = 40;
const SLACK_PX = 40;

export default function ActivityFeed({ steps, live }) {
  const box = useRef(null);
  const pinned = useRef(true);
  const lines = steps.filter((s) => s.step_name || s.message).slice(-FEED_LINES);
  const last = lines.length ? lines[lines.length - 1].step_id : '';
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [last]);
  const jump = () => {
    const el = box.current;
    pinned.current = true;
    if (el) el.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  };
  return (
    <section aria-label="What Inspire is doing" className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-semibold text-text-primary">What Inspire is doing</h2>
        {live && (
          <button type="button" onClick={jump} className="ms-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-subtle">
            <ArrowDown size={12} aria-hidden="true" /> Jump to latest
          </button>
        )}
      </div>
      <ol ref={box} role="list" className="max-h-80 space-y-2 overflow-y-auto"
        onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < SLACK_PX; }}>
        {lines.length === 0 && <li className="text-sm text-text-secondary">Each step shows here as soon as Inspire saves it.</li>}
        {lines.map((s) => (
          <li key={s.step_id} className="text-sm">
            <p className="font-medium text-text-primary break-words">{s.step_name || s.sub_step_name}</p>
            {s.message && <p className="line-clamp-2 text-xs text-text-secondary break-words">{splitTechnical(s.message).plain}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
