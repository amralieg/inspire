import { useCallback, useEffect, useRef, useState } from 'react';
import { reducedMotion } from './motion';

export const FOLLOW_SLACK_PX = 40;

export function useFollowEnd(count, enabled) {
  const [end, setEnd] = useState(null);
  const atEnd = useRef(true);
  const seen = useRef(0);
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    if (!end || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => {
      atEnd.current = entry.isIntersecting;
      if (entry.isIntersecting) setUnseen(false);
    }, { rootMargin: `${FOLLOW_SLACK_PX}px 0px` });
    watch.observe(end);
    return () => watch.disconnect();
  }, [end]);
  useEffect(() => {
    if (!end) return;
    const first = seen.current === 0 && count > 0;
    if (enabled && (first || atEnd.current)) end.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    else if (count > seen.current) setUnseen(true);
    seen.current = count;
  }, [end, count, enabled]);
  const jump = useCallback(() => {
    atEnd.current = true;
    setUnseen(false);
    end?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }, [end]);
  return { ref: setEnd, unseen, jump };
}
