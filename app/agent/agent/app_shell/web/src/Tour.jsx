import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion } from './theme.js';
import { TOUR_WAIT_MS, fillTourText, holeOf, pickTourLanguage, placeTour, tourSection } from './tour.js';
import './styles/tour.css';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function shownAnchor(anchor) {
  return [...document.querySelectorAll(`[data-tour="${anchor}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) || null;
}

function inView(rect, view) {
  return rect.top >= 0 && rect.bottom <= view.height && rect.left >= 0 && rect.right <= view.width;
}

export default function Tour({ tour, facts, queue, section, onSection, onEnd }) {
  const language = useMemo(() => pickTourLanguage(tour?.languages, navigator.languages || [navigator.language]), [tour]);
  const steps = useMemo(() => (language?.steps || []).map((s) => ({ ...s, text: fillTourText(s.text, facts) })).filter((s) => s.title),
    [language, facts]);
  const [at, setAt] = useState(0);
  const [way, setWay] = useState(1);
  const [target, setTarget] = useState(null);
  const [rect, setRect] = useState(null);
  const [spot, setSpot] = useState(null);
  const pop = useRef(null);
  const started = useRef({ section, focus: document.activeElement });
  const ended = useRef(false);
  const ui = language?.ui || {};
  const dir = language?.dir || 'ltr';

  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    const { section: from, focus } = started.current;
    if (from && from !== section) onSection(from);
    onEnd();
    const mark = focus?.getAttributeNames?.().find((n) => n.startsWith('data-'));
    const back = (tries) => {
      const el = focus?.isConnected ? focus : mark ? document.querySelector(`[${mark}]`) : null;
      if (el && typeof el.focus === 'function') el.focus();
      else if (tries > 0) setTimeout(() => back(tries - 1), 50);
      else document.querySelector('.main')?.focus();
    };
    requestAnimationFrame(() => back(20));
  }, [onEnd, onSection, section]);

  const move = useCallback((by) => {
    setWay(by);
    if (at + by >= steps.length) end();
    else setAt(Math.max(at + by, 0));
  }, [at, steps.length, end]);

  useEffect(() => {
    if (!steps.length) end();
  }, [steps.length, end]);

  const step = steps[at];
  useEffect(() => {
    if (!step) return undefined;
    const wanted = tourSection(step.anchor, tour, queue);
    if (wanted && wanted !== section) {
      onSection(wanted);
      return undefined;
    }
    let stop = false;
    const began = Date.now();
    const look = () => {
      if (stop) return;
      const el = step.text ? shownAnchor(step.anchor) : null;
      if (el) {
        const view = viewport();
        if (!inView(el.getBoundingClientRect(), view)) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        setTarget({ at, el });
        return;
      }
      if (Date.now() - began > TOUR_WAIT_MS) {
        setTarget(null);
        if (at + way < 0) move(1);
        else move(way);
        return;
      }
      setTimeout(look, 100);
    };
    look();
    return () => { stop = true; };
  }, [step, section]);

  const el = target?.el;
  useLayoutEffect(() => {
    if (!el) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        setRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, el });
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const seen = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    seen?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      seen?.disconnect();
    };
  }, [el]);

  const hole = rect && el ? holeOf(rect, viewport()) : null;
  const ready = !!hole && target.at === at && rect.el === el;
  useLayoutEffect(() => {
    if (!hole || !pop.current) return;
    const box = pop.current.getBoundingClientRect();
    setSpot(placeTour(hole, { width: box.width, height: box.height }, viewport(), dir));
  }, [hole?.left, hole?.top, hole?.width, hole?.height, at, dir]);

  const placed = ready && !!spot;
  useEffect(() => {
    if (!placed) return;
    pop.current?.querySelector('[data-tour-next]')?.focus({ preventScroll: true });
  }, [at, placed]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        const forward = (e.key === 'ArrowRight') === (dir !== 'rtl');
        move(forward ? 1 : -1);
        return;
      }
      if (e.key === 'Tab' && pop.current) {
        const items = [...pop.current.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = pop.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [end, move, dir]);

  if (!step) return null;
  const last = at === steps.length - 1;
  return createPortal(
    <div className="tour" data-tour-on={step.anchor} data-tour-step={at + 1}>
      <div className="tour-catch" onClick={end} aria-hidden="true" />
      <div className="tour-hole" aria-hidden="true" style={hole ? { left: hole.left, top: hole.top, width: hole.width, height: hole.height } : { opacity: 0 }} />
      <div ref={pop} className="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-x" dir={dir} lang={language.code}
        data-side={spot?.side} style={placed ? { left: spot.left, top: spot.top } : { visibility: 'hidden', left: 0, top: 0 }}>
        <h4 id="tour-t"><bdi>{step.title}</bdi></h4>
        <p id="tour-x"><bdi>{step.text}</bdi></p>
        <div className="tour-row">
          <span className="tour-step" aria-label={`${at + 1} / ${steps.length}`}>{at + 1} / {steps.length}</span>
          {!last && <button type="button" className="tour-skip" onClick={end} data-tour-skip>{ui.skip || 'Skip'}</button>}
          <span className="sp" />
          {at > 0 && <button type="button" className="tour-btn" onClick={() => move(-1)} data-tour-back>{ui.back || 'Back'}</button>}
          <button type="button" className="tour-btn accent" onClick={() => move(1)} data-tour-next>{last ? (ui.done || 'Done') : (ui.next || 'Next')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
