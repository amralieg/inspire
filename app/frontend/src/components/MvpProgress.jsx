import { useId } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, Loader2, PanelRightOpen, X, XCircle } from 'lucide-react';
import DrawerShell from './DrawerShell';
import { PlainMessage } from './TechnicalDetails';
import { splitTechnical } from '../lib/plainText';
import GenieLogo from './GenieLogo';
import { IconChip, PANEL_CLASS } from './BuildUi';
import { ACTION_ROW } from './ImplementControlTower';
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

const SHOW_CLASS = 'shrink-0 inline-flex h-8 items-center justify-center gap-1.5 px-3 rounded-lg whitespace-nowrap text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle';

function Heading({ title, active, tone, line, lineClass }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <StatusMark active={active} tone={tone} />
      <div className="min-w-0">
        <h3 className="text-[13px] font-bold text-text-primary">{title}</h3>
        <p data-build-headline="" className={`text-[12px] truncate ${lineClass}`}>{line}</p>
      </div>
    </div>
  );
}

export default function MvpProgress({
  stages, summary, chip, reason, toneClass, version, sorted = null, stop = null, logRef = null, view, warnings = 0, attention = null, diagnostics = null, children,
}) {
  const panelId = useId();
  const headline = summary.headline || chip?.label || '';
  const title = `Build progress${version ? ` · v${version}` : ''}`;
  const line = [headline, summary.span, warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' · ');
  const lineClass = summary.headline ? 'text-text-secondary' : toneClass(chip?.tone);
  const chips = stagesRecorded(stages) ? <StageArrows stages={stages} /> : null;
  const plainReason = reason ? splitTechnical(reason).plain : '';
  return (
    <>
      <section aria-label="Build progress" data-progress-card="" data-progress-open={view.open ? 'true' : 'false'}
        className={`${PANEL_CLASS} shrink-0 px-4 py-3 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <Heading title={title} active={summary.active} tone={chip?.tone} line={line} lineClass={lineClass} />
          <div data-progress-actions="" className={ACTION_ROW}>
            {!view.open && stop}
            <button type="button" data-progress-show="" aria-expanded={view.open} aria-controls={view.open ? panelId : undefined}
              onClick={view.open ? view.close : view.show} className={SHOW_CLASS}>
              <PanelRightOpen size={13} aria-hidden /> {view.open ? 'Hide progress' : 'Show progress'}
            </button>
            {diagnostics?.actions}
          </div>
          {diagnostics?.note}
        </div>
        {!view.open && plainReason && <p data-build-summary-reason="" title={plainReason} className={`text-[12px] line-clamp-2 ${toneClass(chip?.tone)}`}>{plainReason}</p>}
        {!view.open && chips}
        {!view.open && attention && <div data-build-attention="" className="space-y-3">{attention}</div>}
      </section>
      {view.open && (
        <DrawerShell side label={title} onClose={view.close} id={panelId} data-mvp-progress="" data-progress-panel=""
          bodyRef={logRef} bodyProps={{ 'data-build-log': '', className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4' }}
          title={<Heading title={title} active={summary.active} tone={chip?.tone} line={`${headline}${summary.span ? ` · ${summary.span}` : ''}`} lineClass={lineClass} />}
          actions={stop}
          below={(
            <div className="mt-3 space-y-3">
              {summary.detail && <p className="text-[12px] text-text-secondary">{summary.detail}</p>}
              {reason && <PlainMessage text={reason} data-build-reason="" className={`text-[12px] ${toneClass(chip?.tone)}`} />}
              {chips}
              {sorted && <p data-sorted-to="" className="text-[12px] font-medium text-text-primary">{sorted.text}</p>}
            </div>
          )}>
          {attention}
          {children}
        </DrawerShell>
      )}
    </>
  );
}
