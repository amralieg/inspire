import { useId } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Loader2, Maximize2, Minimize2, X, XCircle } from 'lucide-react';
import GenieLogo from './GenieLogo';
import { IconChip, PANEL_CLASS } from './BuildUi';
import { progressPercent, stageSteps, stagesRecorded } from '../lib/mvpProgress';
import { plural } from '../lib/plural';

const STAGE_LOOK = {
  done: { Icon: Check, chip: 'bg-success-bg text-success-fg ring-1 ring-inset ring-success/40', words: 'done' },
  warning: { Icon: AlertTriangle, chip: 'bg-warning-bg text-warning-fg ring-1 ring-inset ring-warning/40', words: 'done with warnings' },
  error: { Icon: X, chip: 'bg-error-solid text-white', words: 'failed' },
  running: { Icon: Loader2, chip: 'bg-db-red-solid text-white shadow-sm shadow-db-red/30', words: 'in progress', live: true },
  next: { Icon: Loader2, chip: 'bg-db-red-solid text-white shadow-sm shadow-db-red/30', words: 'starting', live: true },
  waiting: { Icon: Circle, chip: 'bg-bg-subtle text-text-secondary ring-1 ring-inset ring-border', words: 'not started' },
  not_reached: { Icon: Circle, chip: 'bg-bg-subtle text-text-secondary ring-1 ring-inset ring-border', words: 'not reached' },
};

const BAR_TONE = {
  busy: 'bg-gradient-to-r from-db-red-solid to-db-red',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  idle: 'bg-text-tertiary',
};

const STATUS_CHIP = {
  success: { icon: CheckCircle2, tone: 'success' },
  warning: { icon: AlertTriangle, tone: 'warning' },
  error: { icon: XCircle, tone: 'error' },
};

const SETTLED = ['done', 'warning'];

function StatusMark({ active, tone }) {
  if (active) {
    return (
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-db-red/30 motion-safe:animate-ping" aria-hidden />
        <span className="relative h-8 w-8 rounded-full bg-db-red-50 ring-1 ring-inset ring-db-red/30 text-db-red-fg flex items-center justify-center" aria-hidden>
          <GenieLogo size={16} />
        </span>
      </span>
    );
  }
  const look = STATUS_CHIP[tone] || { icon: GenieLogo, tone: 'idle' };
  return <IconChip icon={look.icon} tone={look.tone} size="md" />;
}

export function ProgressLine({ chip, summary }) {
  const percent = progressPercent(chip, summary);
  const bar = BAR_TONE[chip?.tone] || BAR_TONE.idle;
  return (
    <div data-progress-line="" className="flex items-center gap-3 min-w-0">
      <div
        className="relative h-2 flex-1 min-w-24 rounded-full bg-bg-subtle overflow-hidden"
        role="progressbar"
        aria-label="Build progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`relative h-full rounded-full overflow-hidden ${bar} transition-[width] duration-700 ease-out`}
          style={{ width: `${Math.max(percent, summary.active ? 4 : 0)}%` }}
        >
          {summary.active && (
            <span
              className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent motion-safe:animate-[shimmer_1.8s_ease-in-out_infinite]"
              aria-hidden
            />
          )}
        </div>
      </div>
      <span data-progress-percent="" className="shrink-0 font-mono text-sm font-bold tabular-nums text-text-primary">{percent}%</span>
      {summary.headline && <span data-progress-step="" className="min-w-0 truncate text-[12px] text-text-secondary">{summary.headline}</span>}
    </div>
  );
}

function StageArrows({ stages }) {
  const steps = stageSteps(stages);
  return (
    <ol aria-label="Build stages" className="flex flex-wrap items-center gap-y-2">
      {steps.map((step, i) => {
        const look = STAGE_LOOK[step.state] || STAGE_LOOK.waiting;
        const { Icon } = look;
        const after = i > 0 && SETTLED.includes(steps[i - 1].state);
        return (
          <li key={step.id} data-stage={step.id} data-stage-state={step.state} className="flex items-center">
            {i > 0 && (
              <ArrowRight data-stage-arrow={after ? 'done' : 'todo'} size={16} strokeWidth={2.5} aria-hidden
                className={`mx-1.5 shrink-0 ${after ? 'text-text-primary' : 'text-text-tertiary'}`} />
            )}
            <span title={step.title} className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${look.chip}`}>
              {look.live && <span className="absolute inset-0 rounded-full ring-4 ring-db-red/30 motion-safe:animate-pulse" aria-hidden />}
              <Icon size={13} aria-hidden className={look.live ? 'motion-safe:animate-spin' : ''} />
              {step.label}
              {step.elapsed && <span className="font-normal tabular-nums">{step.elapsed}</span>}
            </span>
            <span className="sr-only">: {look.words}{step.message ? `: ${step.message}` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function StageNotes({ stages, label = 'What Inspire noted on the build', heading = '' }) {
  const noted = (stages || []).filter((stage) => stage.notes?.length);
  if (!noted.length) return null;
  const list = (
    <ul aria-label={label} data-stage-notes="" className="space-y-1 text-[12px] text-text-secondary">
      {noted.flatMap((stage) => stage.notes.map((note) => (
        <li key={`${stage.id}:${note}`} data-stage-note={stage.id}>{note}</li>
      )))}
    </ul>
  );
  if (!heading) return list;
  return (
    <div className="space-y-1">
      <p className="text-[12px] font-semibold">{heading}</p>
      {list}
    </div>
  );
}

export function ScopeNotes({ scope }) {
  const vibe = scope?.vibe || [];
  const notes = scope?.notes || [];
  if (!vibe.length && !notes.length) return null;
  return (
    <ul aria-label="What this version changes" data-mvp-scope="" className="space-y-1 text-[12px]">
      {vibe.map((line) => (
        <li key={`${line.kind}:${line.text}`} data-vibe-route={line.kind} className="text-text-primary">
          {line.text}
          {line.note && <span className="block text-text-secondary">{line.note}</span>}
        </li>
      ))}
      {notes.map((note) => <li key={note.kind} data-scope-note={note.kind} className="text-text-secondary">{note.text}</li>)}
    </ul>
  );
}

const TOGGLE_CLASS = 'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40';

function sizeClass(view, active) {
  if (!view.open) return 'shrink-0';
  if (view.large) return 'min-h-[40rem] md:min-h-[80vh]';
  return active ? 'min-h-[32rem] md:min-h-[28rem] md:flex-1' : 'min-h-[24rem] md:min-h-[14rem] md:flex-1';
}

export default function MvpProgress({
  stages, summary, chip, reason, toneClass, version, sorted = null, stop = null, boxRef = null, logRef = null, view, warnings = 0, attention = null, children,
}) {
  const bodyId = useId();
  const headline = summary.headline || chip?.label || '';
  const title = `Build progress${version ? ` · v${version}` : ''}`;
  const line = [headline, summary.span, warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' · ');
  const toggleLabel = view.open ? 'Collapse the build progress' : 'Expand the build progress';
  return (
    <section ref={boxRef} tabIndex={-1} aria-label="Build progress" data-mvp-progress="" data-progress-open={view.open ? 'true' : 'false'}
      data-progress-large={view.large ? 'true' : undefined}
      className={`${PANEL_CLASS} flex flex-col ${sizeClass(view, summary.active)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40`}>
      {!view.open ? (
        <div className="flex items-center gap-2 px-4 py-2.5 min-w-0">
          <button type="button" data-progress-toggle="" aria-expanded="false" aria-controls={bodyId} aria-label={toggleLabel} onClick={view.toggle}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40">
            <StatusMark active={summary.active} tone={chip?.tone} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-text-primary">{title}</span>
              <span data-build-summary="" className="flex min-w-0 items-baseline gap-1.5 text-[12px]">
                <span className={`shrink-0 ${summary.headline ? 'text-text-secondary' : toneClass(chip?.tone)}`}>{line}</span>
                {reason && <span data-build-summary-reason="" title={reason} className={`min-w-0 truncate ${toneClass(chip?.tone)}`}>· {reason}</span>}
              </span>
            </span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-text-secondary" />
          </button>
          {stop}
        </div>
      ) : null}
      {!view.open && attention && <div data-build-attention="" className="px-4 pb-3 space-y-3">{attention}</div>}
      {view.open && (
        <div className="shrink-0 px-4 pt-3 pb-3 space-y-3 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <StatusMark active={summary.active} tone={chip?.tone} />
              <div className="min-w-0">
                <h3 className="text-[13px] font-bold text-text-primary">{title}</h3>
                <p data-build-headline="" className={`text-[12px] truncate ${summary.headline ? 'text-text-secondary' : toneClass(chip?.tone)}`}>
                  {headline}{summary.span ? ` · ${summary.span}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {stop}
              <button type="button" data-progress-enlarge="" aria-pressed={view.large} aria-label={view.large ? 'Make the build progress smaller' : 'Make the build progress larger'}
                title={view.large ? 'Smaller' : 'Larger'} onClick={view.enlarge} className={TOGGLE_CLASS}>
                {view.large ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
              </button>
              <button type="button" data-progress-toggle="" aria-expanded="true" aria-controls={bodyId} aria-label={toggleLabel} title="Collapse" onClick={view.toggle}
                className={TOGGLE_CLASS}>
                <ChevronDown size={14} aria-hidden className="rotate-180" />
              </button>
            </div>
          </div>
          {summary.detail && <p className="text-[12px] text-text-secondary">{summary.detail}</p>}
          {reason && <p data-build-reason="" className={`text-[12px] ${toneClass(chip?.tone)}`}>{reason}</p>}
          {stagesRecorded(stages) && <StageArrows stages={stages} />}
          {sorted && <p data-sorted-to="" className="text-[12px] font-medium text-text-primary">{sorted.text}</p>}
        </div>
      )}
      <div ref={logRef} data-build-log="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4" id={bodyId} hidden={!view.open}>
        {view.open && attention}
        {children}
      </div>
    </section>
  );
}
