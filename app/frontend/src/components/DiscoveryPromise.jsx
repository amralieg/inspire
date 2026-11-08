import { ShieldCheck } from 'lucide-react';
import { DISCOVERY_PROMISE } from '../lib/discoveryType';

export default function DiscoveryPromise({ className = '' }) {
  return (
    <div role="note" aria-label={DISCOVERY_PROMISE.title} data-discovery-promise="" className={className}>
      <p className="flex items-center gap-1.5 text-sm font-bold text-success-fg">
        <ShieldCheck size={15} className="shrink-0" />
        {DISCOVERY_PROMISE.title}
      </p>
      {DISCOVERY_PROMISE.lines.map((line) => (
        <p key={line} className="mt-1 text-xs leading-snug text-text-secondary">{line}</p>
      ))}
    </div>
  );
}
