// REQ-541: the 10 motions for the visual blocks. A motion is a CSS class on the block root; the stylesheet (styles/viz.css) holds its keyframes.
// Every motion has a static end state: Motion Off and prefers-reduced-motion draw the finished picture with zero animations.
import { useEffect, useState } from 'react';

export const MOTIONS = {
  build: { label: 'Build step by step', cls: 'vz-m-build' },
  count_up: { label: 'Count up', cls: 'vz-m-count_up' },
  morph: { label: 'Morph between views', cls: 'vz-m-morph' },
  pulse: { label: 'Pulse the focus', cls: 'vz-m-pulse' },
  slide: { label: 'Slide into place', cls: 'vz-m-slide' },
  fill: { label: 'Fill', cls: 'vz-m-fill' },
  trace: { label: 'Trace the path', cls: 'vz-m-trace' },
  split_merge: { label: 'Split and merge', cls: 'vz-m-split_merge' },
  zoom: { label: 'Zoom to the item', cls: 'vz-m-zoom' },
  reveal: { label: 'Reveal', cls: 'vz-m-reveal' },
};
export const MOTION_LEVELS = ['lively', 'calm', 'off'];

const QUERY = '(prefers-reduced-motion: reduce)';
export const prefersReduced = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches;

// Pure: run is false (the static end state) for Off, reduced motion, or a motion id that does not exist.
export function motionState(motion, level, reduced) {
  const known = Object.prototype.hasOwnProperty.call(MOTIONS, motion);
  const run = known && level !== 'off' && !reduced;
  return { run, calm: run && level === 'calm', cls: run ? MOTIONS[motion].cls : '' };
}

export function useMotion(motion, level = 'lively') {
  const [reduced, setReduced] = useState(prefersReduced);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const q = matchMedia(QUERY);
    const on = () => setReduced(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return motionState(motion, level, reduced);
}

// The number shown while it counts up; the target itself when the motion is not running.
export function useCountUp(target, run, ms = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!run || !Number.isFinite(target)) return undefined;
    let raf; let t0;
    const step = (t) => {
      t0 ??= t;
      const p = Math.min(1, (t - t0) / ms);
      setShown(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return run ? shown : target;
}
