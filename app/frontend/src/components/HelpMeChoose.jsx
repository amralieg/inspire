import { useEffect, useMemo, useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import Button from './ui/Button';
import { pickedAfter, trailOf, wizardSteps } from '../lib/helpMeChoose';
import { reducedMotion } from '../lib/motion';

const TITLE_ID = 'help-me-choose-title';
const TWEEN_MS = 450;

// The counter counts from the previous number to the new one; reduced motion jumps straight to it.
function CountUp({ value }) {
  const [tween, setTween] = useState({ shown: value });
  const from = useRef(value);
  const instant = reducedMotion();
  useEffect(() => {
    if (instant) { from.current = value; return undefined; }
    const origin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const shown = Math.round(origin + (value - origin) * t);
      from.current = shown;
      setTween({ shown });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, instant]);
  const shown = instant ? value : tween.shown;
  return <span data-help-count="" data-help-target={value} className="tabular-nums">{shown}</span>;
}

// The "Help me choose" wizard (REQ-538): business questions that narrow the use cases while a counter falls, then the picked list.
// onDone({ ids picked list, total, chips }) hands the result to the page; onClose leaves the list as it was.
export default function HelpMeChoose({ useCases, onClose, onDone }) {
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(null);
  const steps = useMemo(() => wizardSteps(useCases, answers), [useCases, answers]);
  const visible = steps.filter((s) => !s.skipped);
  const total = useCases.length;
  const index = Math.max(0, visible.findIndex((s) => s.id === current));
  const step = visible[index];
  const left = step ? step.after : total;
  const trail = trailOf(steps, answers);
  const isLast = index >= visible.length - 1;

  const toggle = (key) => setAnswers((prev) => {
    const mine = prev[step.id] || [];
    const next = step.multi ? (mine.includes(key) ? mine.filter((k) => k !== key) : [...mine, key]) : (mine.includes(key) ? [] : [key]);
    const later = {};
    let after = false;
    for (const s of steps) { if (after) continue; if (s.id === step.id) after = true; else later[s.id] = prev[s.id]; }
    return { ...later, [step.id]: next };
  });
  const goTo = (to) => { const s = visible[to]; if (s) setCurrent(s.id); };
  const skip = () => { setAnswers((prev) => ({ ...prev, [step.id]: [] })); if (!isLast) goTo(index + 1); };
  const finish = () => onDone({ picked: pickedAfter(useCases, answers), total, chips: trail.map((t) => t.label) });

  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={() => goTo(index - 1)} disabled={index === 0} data-help-back="">Back</Button>
      <Button variant="ghost" size="sm" onClick={skip} disabled={!step || isLast} data-help-skip="">Skip</Button>
      {!isLast && <Button variant="secondary" size="sm" onClick={() => goTo(index + 1)} data-help-next="">Next</Button>}
      <Button size="sm" onClick={finish} disabled={left === 0} data-help-done="">Done</Button>
    </>
  );

  return (
    <ModalDialog titleId={TITLE_ID} title="Help me choose" onClose={onClose} widthClass="max-w-xl" footer={footer}>
      <div data-help-body="" className="min-w-0 space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-text-primary"><CountUp value={left} /></span>
            <span className="text-sm text-text-secondary">of {total} use cases left</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden="true">
            <div className="h-full rounded-full bg-primary-solid" style={{ width: `${total ? (left / total) * 100 : 0}%`, transition: reducedMotion() ? 'none' : `width ${TWEEN_MS}ms ease-out` }} />
          </div>
          <p data-help-trail="" className="mt-2 break-words text-caption text-text-secondary">
            {[String(total), ...trail.map((t) => `${t.count} ${t.label}`)].join(' → ')}
          </p>
        </div>
        {step ? (
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-semibold text-text-primary">{step.title}</legend>
            <p className="text-caption text-text-tertiary">{step.multi ? 'Pick any that apply, or skip.' : 'Pick one, or skip.'}</p>
            <div className="flex flex-wrap gap-2">
              {step.options.map((o) => {
                const on = (answers[step.id] || []).includes(o.key);
                return (
                  <button key={o.key} type="button" data-help-option={o.label} aria-pressed={on} disabled={o.disabled} onClick={() => toggle(o.key)}
                    className={`max-w-full break-words rounded-lg border px-3 py-1.5 text-start text-xs font-medium transition-smooth disabled:cursor-not-allowed disabled:text-neutral-fg ${
                      on ? 'border-db-red/30 bg-db-red-50 text-db-red-fg' : 'border-border bg-bg text-text-primary hover:border-border-strong'}`}>
                    <span dir="auto">{o.label}</span>
                    <span className="ms-2 tabular-nums text-text-tertiary">{o.disabled ? 'No use cases' : o.count}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-text-secondary">These use cases have nothing more to narrow by. Press Done to see them.</p>
        )}
      </div>
    </ModalDialog>
  );
}
