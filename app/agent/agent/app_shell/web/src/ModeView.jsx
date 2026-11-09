import { Suspense, lazy } from 'react';
import { MODE_VIEWS } from './modes.js';
import { Skeleton } from './ui.jsx';

const loaded = new Map();

function viewOf(mode, part) {
  const key = `${mode}:${part}`;
  if (!loaded.has(key)) {
    const load = MODE_VIEWS[mode];
    loaded.set(key, load ? lazy(() => load().then((m) => ({ default: (Object.hasOwn(m.default, part) && m.default[part]) || Missing }))) : null);
  }
  return loaded.get(key);
}

function Missing({ fallback = null }) {
  return fallback;
}

export default function ModeView({ mode, part, fallback = null, ...props }) {
  const View = viewOf(mode, part);
  return (
    <Suspense fallback={<div className="mode-wait" role="status" aria-label="Loading"><Skeleton height={160} /></div>}>
      {View ? <View {...props} fallback={fallback} /> : fallback}
    </Suspense>
  );
}
