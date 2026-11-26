import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion } from './theme.js';
import { useMyView } from './MyView.jsx';
import { ONBOARD_DEFAULTS, QUESTIONS, motionOf, onboardDue } from './onboarding.js';
import './styles/onboarding.css';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Three tiny CSS-only pictures; each is still under reduced motion or motion off (onboarding.css).
function Preview({ q, opt }) {
  return <span className={`onb-pv onb-pv--${q}-${opt}`} aria-hidden="true"><i /><i /><i /></span>;
}

function Question({ q, value, onPick }) {
  return (
    <div data-onb-q={q.id} role="radiogroup" aria-labelledby={`onb-t-${q.id}`}>
      <h2 id={`onb-t-${q.id}`}>{q.title}</h2>
      <div className="onb-opts">
        {q.options.map(([id, text]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={`onb-opt ${value === id ? 'is-on' : ''}`}
            data-onb-opt={id} onClick={() => onPick(id)}>
            <Preview q={q.id} opt={id} />
            <b>{text}</b>
            <small>{q.why[id]}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function useMotionAttribute() {
  const { prefs } = useMyView();
  useLayoutEffect(() => {
    const set = () => { document.documentElement.dataset.motion = motionOf(prefs, reducedMotion()); };
    set();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', set);
    return () => mq.removeEventListener?.('change', set);
  }, [prefs.motion]);
}

function Questions({ onDone }) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState(ONBOARD_DEFAULTS);
  const box = useRef(null);
  const q = QUESTIONS[at];
  const last = at === QUESTIONS.length - 1;
  const skip = () => onDone(ONBOARD_DEFAULTS);
  const next = () => (last ? onDone(answers) : setAt(at + 1));
  useEffect(() => {
    box.current?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [at]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(); return; }
      if (e.key === 'Tab' && box.current) {
        const items = [...box.current.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const inside = box.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === items[0] || !inside)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && (document.activeElement === items[items.length - 1] || !inside)) { e.preventDefault(); items[0].focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  return createPortal(
    <div className="onb" data-onboarding="">
      <div className="onb-box" ref={box} role="dialog" aria-modal="true" aria-label="Make it yours">
        <p className="onb-kick">Make it yours <span className="onb-n" aria-label={`${at + 1} of ${QUESTIONS.length}`}>{at + 1} / {QUESTIONS.length}</span></p>
        <Question key={q.id} q={q} value={answers[q.key]} onPick={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} />
        <div className="onb-row">
          <button type="button" className="btn" onClick={skip} data-onb-skip>Skip</button>
          <span className="sp" />
          {at > 0 && <button type="button" className="btn" onClick={() => setAt(at - 1)} data-onb-back>Back</button>}
          <button type="button" className="btn btn--pri" onClick={next} data-onb-next>{last ? 'Done' : 'Continue'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function Onboarding() {
  const { prefs, update, stored } = useMyView();
  useMotionAttribute();
  const [asked] = useState(() => stored && onboardDue(prefs));
  const [open, setOpen] = useState(asked);
  if (!open) return null;
  const done = (answers) => { update((p) => ({ ...p, ...answers })); setOpen(false); };
  return <Questions onDone={done} />;
}

const SETTING_ROWS = [
  ['workMode', 'How I like to work', 'my_work_mode', 0, 'One by one shows a single item at a time. Depends on how many picks one by one when 20 or fewer items need you.'],
  ['help', 'How much help', 'my_help', 1, 'Show me around opens the tour by itself on a first visit. The tour can always be replayed from the menu.'],
  ['motion', 'Motion', 'my_motion', 2, 'Reduced motion in your system always wins.'],
];

export function MakeItYoursGroup() {
  const { prefs, update } = useMyView();
  return (
    <div className="tbl-wrap" data-group="make_it_yours">
      <h3>Make it yours</h3>
      <p className="why">Only you see these, in this browser.</p>
      <table>
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          {SETTING_ROWS.map(([key, label, name, at, help]) => (
            <tr key={key} data-my={key}>
              <td><b>{label}</b><br /><small>{help}</small></td>
              <td>
                <select name={name} aria-label={label} value={prefs[key] || ONBOARD_DEFAULTS[key]} onChange={(e) => update((p) => ({ ...p, [key]: e.target.value }))}>
                  {QUESTIONS[at].options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
