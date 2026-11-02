import { SHOWCASE_NOTE } from '../lib/showcase';

const DEMO_NOTE = 'rounded-lg bg-info-bg px-3 py-2 text-[11px] font-medium text-info-fg ring-1 ring-inset ring-info/30';

export default function DemoNote({ children = SHOWCASE_NOTE, className = '' }) {
  return <p role="note" data-demo-note="" className={className ? `${DEMO_NOTE} ${className}` : DEMO_NOTE}>{children}</p>;
}
