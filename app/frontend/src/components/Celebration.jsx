import { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { reducedMotion } from '../lib/motion';

const COLORS = ['#FF3621', '#FF8A6B', '#3B82F6', '#22C55E', '#EAB308'];

export default function Celebration({ trigger }) {
  const fired = useRef(false);

  useEffect(() => {
    if (!trigger || fired.current || reducedMotion()) return;
    fired.current = true;
    const base = { origin: { y: 0.6 }, zIndex: 9999, disableForReducedMotion: true };
    confetti({ ...base, spread: 80, particleCount: 50, colors: COLORS });
    setTimeout(() => confetti({ ...base, spread: 100, particleCount: 30, origin: { x: 0.3, y: 0.5 } }), 200);
    setTimeout(() => confetti({ ...base, spread: 100, particleCount: 30, origin: { x: 0.7, y: 0.5 } }), 400);
  }, [trigger]);

  return null;
}
