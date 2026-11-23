import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { expireStartingBuild, startingBuild, subscribeStartingBuild } from '../lib/implementControl';

export const STARTING_TEXT = 'Starting your build';
export const STARTING_SLOW_TEXT = 'Still starting. This can take a minute.';
const SLOW_MS = 20000;

// REQ-486: the cover over the screen from the final Build click until the Build page shows this build's progress.
export default function BuildStarting() {
  const current = useSyncExternalStore(subscribeStartingBuild, startingBuild, startingBuild);
  const at = current?.at ?? 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!current) return undefined;
    const timer = setInterval(() => { setNow(Date.now()); expireStartingBuild(); }, 1000);
    return () => clearInterval(timer);
  }, [current]);
  if (!current) return null;
  const waited = now - at;
  return (
    <BodyPortal>
      <div data-build-starting="" role="status" aria-live="polite" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-surface px-8 py-6 text-center shadow-elevated">
          <Loader2 size={28} className="animate-spin text-db-red-fg" aria-hidden="true" />
          <p className="text-sm font-semibold text-text-primary">{STARTING_TEXT}</p>
          {waited > SLOW_MS && <p data-build-starting-slow="" className="text-xs text-text-secondary">{STARTING_SLOW_TEXT}</p>}
        </div>
      </div>
    </BodyPortal>
  );
}
