import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import ModalDialog from './ModalDialog';
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
    <ModalDialog titleId="build-starting-title" title={STARTING_TEXT} onClose={undefined} dismissible={false} widthClass="max-w-sm"
      overlayAttrs={{ 'data-build-starting': '', role: 'status', 'aria-live': 'polite' }}
      header={(
        <div className="flex flex-col items-center gap-3 px-8 pt-6 text-center">
          <Loader2 size={28} className="animate-spin text-db-red-fg" aria-hidden="true" />
          <h2 id="build-starting-title" className="text-sm font-semibold text-text-primary">{STARTING_TEXT}</h2>
        </div>
      )} bare>
      {waited > SLOW_MS && <p data-build-starting-slow="" className="px-8 pb-6 pt-3 text-center text-xs text-text-secondary">{STARTING_SLOW_TEXT}</p>}
      {waited <= SLOW_MS && <div className="pb-6" />}
    </ModalDialog>
  );
}
