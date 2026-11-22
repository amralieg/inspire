import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// REQ-482: a wait state always moves. A business reads static "Reading..." text as an app that stopped answering.
export const STILL_WORKING_MS = 8000;
export const STILL_WORKING_TEXT = 'Still working. This can take up to a minute.';

// A spinner, the text, and after STILL_WORKING_MS a second line that says the wait is expected. One timer, cleared on unmount.
// Other props (data-*, className, id) go on the wrapper, so a site keeps its selectors and its look.
export default function BusyNote({ text, size = 14, inline = false, stillAfterMs = STILL_WORKING_MS, className = '', ...rest }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStill(true), stillAfterMs);
    return () => clearTimeout(timer);
  }, [stillAfterMs]);
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper role="status" aria-live="polite" {...rest} className={className}>
      <span className="inline-flex items-center gap-1.5">
        <Loader2 size={size} className="shrink-0 motion-safe:animate-spin" aria-hidden />
        <span>{text}</span>
      </span>
      {still && <span data-busy-still="" className="block text-text-tertiary">{STILL_WORKING_TEXT}</span>}
    </Wrapper>
  );
}
