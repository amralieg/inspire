import { useState } from 'react';
import {
  AlertTriangle, AppWindow, Ban, Bell, Briefcase, ExternalLink, Eye, EyeOff, Hammer, History, LayoutDashboard, Loader2, NotebookPen, Pause, Play, PlayCircle, Plus,
  RefreshCw, RotateCcw, Square, Trash2, Zap,
} from 'lucide-react';
import BodyPortal from './BodyPortal';
import GenieLogo from './GenieLogo';
import ImplementStatusBadge from './ImplementStatusBadge';
import { IconChip, PANEL_CLASS, SectionTitle } from './BuildUi';
import { TargetKpiLine } from './TargetKpiCard';
import { controlTiles, controlActionText, removeConfirmed, sharedControlAsks, sharedControlText, sharedNote, uninstallText } from '../lib/implementControl';
import { formatWhen } from '../lib/formatWhen';
import { readOnlyReason } from '../lib/showcase';
import { RUN_LINK_LABEL } from '../lib/implementWizard';

const ACTION_ICONS = { stop: Square, start: Play, unpublish: EyeOff, publish: Eye, cancel: Ban };
const ASSET_ICONS = { build: Hammer, job: Briefcase, dashboard: LayoutDashboard, genie_space: GenieLogo, app: AppWindow, alert: Bell, notebook: NotebookPen };
const TONE_CHIP = { success: 'success', error: 'error', warning: 'warning', busy: 'red', idle: 'idle' };
const BUTTON = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50';
const FIT_BUTTON = 'flex w-full h-7 min-w-0 items-center justify-center gap-1 px-2 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-50';
const fitted = (fit, text) => (fit ? <span className="truncate">{text}</span> : text);

export function ConfirmDialog({ title, confirmLabel, useCaseId, busy, onCancel, onConfirm, children }) {
  const [typed, setTyped] = useState('');
  const ok = removeConfirmed(typed, useCaseId);
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-label={title} className="bg-surface border border-border rounded-xl shadow-elevated w-full max-w-md p-5 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <div className="text-[12px] text-text-secondary space-y-2">{children}</div>
          <label className="block text-[12px] text-text-secondary">
            Type <span className="font-mono font-semibold text-text-primary">{useCaseId}</span> to confirm
            <input
              autoFocus
              aria-label="Type the use case id to confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full border border-border rounded-md px-2 py-1.5 font-mono text-[12px] bg-surface"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border">Cancel</button>
            <button
              type="button"
              disabled={!ok || busy}
              onClick={onConfirm}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-error-solid disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

function RetryButton({ failed, disabled, lockedReason = '', onRetry, fit = false }) {
  return (
    <button type="button" disabled={disabled} onClick={onRetry} title={lockedReason || failed.error || undefined} aria-label={`Retry the ${failed.label}`}
      className={`${fit ? FIT_BUTTON : BUTTON} border border-error/40 bg-surface text-error-fg`}>
      <RotateCcw size={11} className="shrink-0" /> {fitted(fit, 'Retry')}
    </button>
  );
}

export function RowControls({ row, active, actionBusy, submitBusy, readOnly = false, failed = null, onAction, onToggleSchedule, onRetry, onOpenRun = null, fit = false }) {
  const locked = readOnly || active || submitBusy;
  const lockedReason = readOnlyReason(readOnly);
  const base = fit ? FIT_BUTTON : BUTTON;
  const named = (text) => (fit ? text : undefined);
  return (
    <>
      {row.run && onOpenRun && (
        <button type="button" data-open-run={row.run.id} title={named(RUN_LINK_LABEL)} onClick={() => onOpenRun(row.run.id)}
          className={`${base} font-semibold text-white bg-db-red-solid hover:opacity-90`}>
          <PlayCircle size={11} className="shrink-0" /> {fitted(fit, RUN_LINK_LABEL)}
        </button>
      )}
      {row.url && (
        <a href={row.url} target="_blank" rel="noreferrer" className={`${BUTTON} font-semibold text-white bg-db-red-solid hover:opacity-90`}>
          Open <ExternalLink size={11} />
        </a>
      )}
      {row.actions.map((a) => {
        const Icon = ACTION_ICONS[a.action] || Square;
        const key = `${a.asset}:${a.action}`;
        const blocked = readOnly || actionBusy !== '' || (active && a.asset !== 'build');
        return (
          <button
            key={key}
            type="button"
            disabled={blocked}
            title={lockedReason || (blocked && active ? 'Wait for the build to finish, or stop the build first' : named(a.label))}
            onClick={() => onAction(a)}
            className={`${base} border bg-surface ${a.danger ? 'border-error/40 text-error-fg' : 'border-border text-text-primary'}`}
          >
            {actionBusy === key ? <Loader2 size={11} className="shrink-0 animate-spin" /> : <Icon size={11} className="shrink-0" />} {fitted(fit, a.label)}
          </button>
        );
      })}
      {row.schedule && (
        <button type="button" disabled={locked} title={lockedReason || named(row.schedule.label)} onClick={onToggleSchedule} className={`${base} border border-border bg-surface text-text-primary`}>
          {row.schedule.on ? <Pause size={11} className="shrink-0" /> : <Play size={11} className="shrink-0" />} {fitted(fit, row.schedule.label)}
        </button>
      )}
      {failed && <RetryButton failed={failed} disabled={locked} lockedReason={lockedReason} onRetry={onRetry} fit={fit} />}
      {!failed && row.lakebaseSwitch && (
        <button type="button" disabled={locked} title={lockedReason || named('Switch to Lakebase')} onClick={onRetry} className={`${base} border border-border bg-surface text-text-primary`}>
          <Zap size={11} className="shrink-0" /> {fitted(fit, 'Switch to Lakebase')}
        </button>
      )}
    </>
  );
}

function StripRow({ row, controls }) {
  return (
    <li data-control={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px]">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <IconChip icon={ASSET_ICONS[row.id] || Briefcase} tone={TONE_CHIP[row.state.tone] || 'idle'} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary">{row.label}</span>
            <span className="font-mono text-[11px] text-text-secondary truncate">{row.name}</span>
            <ImplementStatusBadge state={row.state} />
          </div>
          {row.detail && <p data-control-detail="" className={row.state.tone === 'error' ? 'text-error-fg' : 'text-text-secondary'}>{row.detail}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{controls}</div>
    </li>
  );
}

const PENDING_LOOK = {
  building: (tile) => ({ tone: 'red', text: tile.now ? tile.doing || 'Genie is building it now' : 'Waiting for its turn in this run' }),
  planning: () => ({ tone: 'idle', text: 'Inspire is working out whether this version changes it' }),
  failed: (tile) => ({ tone: 'error', text: tile.error ? `It failed: ${tile.error}` : 'It failed on this version' }),
  checking: (_tile, liveError) => ({ tone: 'idle', text: liveError ? 'Inspire cannot read its live status' : 'Reading its live status' }),
  missing: () => ({ tone: 'warning', text: 'Not built on this version' }),
  held: (tile) => ({ tone: 'warning', text: tile.note }),
};

function useAssetControls({ output, row, uninstall, useCaseId, submitBusy, actionBusy, onAction, onRemove }) {
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const canRemove = Boolean(row?.removable && uninstall && onRemove);
  const confirm = async () => {
    if (await onRemove(output.id)) setRemoving(false);
  };
  const act = (a) => (sharedControlAsks(a, uninstall) ? setConfirming(a) : onAction(a));
  const confirmShared = async () => {
    const a = confirming;
    setConfirming(null);
    await onAction(a, { confirmShared: true });
  };
  const dialogs = (
    <>
      {removing && (
        <ConfirmDialog title={uninstall.others.length && uninstall.target ? `Remove this use case from ${uninstall.target}` : `Uninstall the ${output.label}`}
          confirmLabel={uninstall.label} useCaseId={useCaseId} busy={submitBusy}
          onCancel={() => setRemoving(false)} onConfirm={confirm}>
          <p>{uninstallText(output, row, uninstall)}</p>
        </ConfirmDialog>
      )}
      {confirming && (
        <ConfirmDialog title={`${confirming.label} for every use case in it`} confirmLabel={confirming.label} useCaseId={useCaseId} busy={actionBusy !== ''}
          onCancel={() => setConfirming(null)} onConfirm={confirmShared}>
          <p>{sharedControlText(confirming, uninstall)}</p>
        </ConfirmDialog>
      )}
    </>
  );
  return { canRemove, act, ask: () => setRemoving(true), dialogs };
}

const TILE_LOOK = {
  off: { label: 'Not in this MVP', tone: 'idle' },
  planning: { label: 'Planning', tone: 'idle' },
  checking: { label: 'Checking', tone: 'idle' },
  missing: { label: 'Not built', tone: 'warning' },
  held: { label: 'Not published', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  building: { label: 'Building', tone: 'busy' },
};

function tileState(tile) {
  if (tile.kind === 'live') return tile.building?.now ? { label: 'Building', tone: 'busy' } : tile.row.state;
  if (tile.kind === 'building') return tile.now ? { label: 'Building', tone: 'busy' } : { label: 'Waiting', tone: 'idle' };
  return TILE_LOOK[tile.kind];
}

const TO_BUILD = ['building', 'failed', 'planning', 'held'];
const TILE_BUTTON = `${FIT_BUTTON} border border-border bg-surface text-text-primary`;
const TILE_DANGER = `${FIT_BUTTON} border border-error/40 bg-surface text-error-fg`;

export function AssetTile({
  id, label, icon = null, tile = null, state = null, href = '', reason = '', row = null, uninstall = null, removeLabel = '', onUninstall = null, failed = null,
  active, actionBusy, submitBusy, readOnly = false, useCaseId, onAction, onToggleSchedule, onRetry, onRemove, onAdd = null, onVersions, onShowBuild, onOpenRun = null,
  building = false,
}) {
  const output = tile?.output || { id, label };
  const kind = tile?.kind || (!state ? 'off' : state.tone === 'error' ? 'failed' : 'live');
  const failing = kind === 'failed' || Boolean(failed);
  const settled = failed || tile?.kind === 'failed' ? TILE_LOOK.failed : tile ? tileState(tile) : state || TILE_LOOK.off;
  const shown = building ? TILE_LOOK.building : settled;
  const live = tile ? tile.row || null : row;
  const controls = useAssetControls({ output, row: live, uninstall, useCaseId, submitBusy, actionBusy, onAction, onRemove });
  const Icon = icon || ASSET_ICONS[id];
  const off = kind === 'off';
  const busy = kind === 'building' ? tile : tile?.building || null;
  const toReason = failing && Boolean(onVersions);
  const toBuild = !toReason && (failing || TO_BUILD.includes(kind) || Boolean(tile?.building));
  const link = !toBuild && !toReason && (href || live?.url || '');
  const locked = readOnly || active || submitBusy;
  const lockedReason = readOnlyReason(readOnly);
  const head = (
    <>
      <IconChip icon={Icon} tone={off ? 'idle' : TONE_CHIP[shown.tone] || 'idle'} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[13px] font-semibold text-text-primary">
          {label}{link && <ExternalLink size={11} aria-hidden className="shrink-0 text-text-secondary" />}
        </span>
        <span data-tile-state="" title={shown.label} className={`flex items-center gap-1 min-w-0 text-[11px] font-medium ${off ? 'text-text-secondary' : shown.tone === 'error' ? 'text-error-fg' : 'text-text-secondary'}`}>
          {building && <Loader2 data-tile-spinner="" size={11} aria-hidden className="shrink-0 text-db-red-fg motion-safe:animate-spin" />}
          <span className="truncate">{shown.label}</span>
        </span>
        {off && tile?.note && <span data-asset-note="" className="mt-0.5 block line-clamp-3 text-[11px] text-text-secondary">{tile.note}</span>}
      </span>
    </>
  );
  const headClass = 'flex items-start gap-2 min-w-0 rounded-lg -m-1 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-db-red/40';
  return (
    <li data-asset-tile={id} data-tile-kind={kind} data-tile-building={busy ? (busy.now ? 'now' : 'waiting') : undefined} data-tile-animated={building ? '' : undefined}
      title={reason || undefined}
      className={`flex flex-col gap-2 min-w-0 rounded-xl border p-3 text-[12px] ${off ? 'border-dashed border-border-strong bg-bg-subtle/60' : 'border-border bg-surface shadow-sm'} ${building ? 'asset-building' : ''}`}>
      {link ? (
        <a data-tile-open="asset" href={link} target="_blank" rel="noreferrer" aria-label={`Open the ${label}`} className={`${headClass} hover:bg-bg-subtle`}>{head}</a>
      ) : toReason ? (
        <button type="button" data-tile-open="reason" onClick={onVersions} aria-label={`${label}: ${shown.label}. Show why`} className={`${headClass} hover:bg-bg-subtle`}>{head}</button>
      ) : toBuild ? (
        <button type="button" data-tile-open="build" onClick={onShowBuild} aria-label={`${label}: ${shown.label}. Show the build progress`} className={`${headClass} hover:bg-bg-subtle`}>{head}</button>
      ) : (
        <div className={headClass}>{head}</div>
      )}
      <div data-tile-actions="" className="mt-auto flex flex-col gap-1">
        {live && (
          <RowControls row={{ ...live, url: '' }} active={active} actionBusy={actionBusy} submitBusy={submitBusy} readOnly={readOnly} failed={failed}
            onAction={controls.act} onToggleSchedule={onToggleSchedule} onRetry={() => onRetry(output.id)} onOpenRun={onOpenRun} fit />
        )}
        {!live && failed && <RetryButton failed={failed} disabled={locked} lockedReason={lockedReason} onRetry={() => onRetry(output.id)} fit />}
        {off && onAdd && (
          <button type="button" data-tile-add="" disabled={active} onClick={onAdd} aria-label={`Add the ${label}`} title="Add" className={TILE_BUTTON}>
            <Plus size={11} className="shrink-0" /> {fitted(true, 'Add')}
          </button>
        )}
        {!off && onVersions && (
          <button type="button" data-tile-versions="" onClick={onVersions} aria-label={`Versions of the ${label}`} title="Versions" className={TILE_BUTTON}>
            <History size={11} className="shrink-0" /> {fitted(true, 'Versions')}
          </button>
        )}
        {controls.canRemove && (
          <button type="button" data-tile-uninstall="" disabled={locked || Boolean(uninstall.blocked)} title={uninstall.blocked || lockedReason || uninstall.label}
            onClick={controls.ask} aria-label={`${uninstall.label} the ${label}`} className={TILE_DANGER}>
            <Trash2 size={11} className="shrink-0" /> {fitted(true, uninstall.label)}
          </button>
        )}
        {onUninstall && (
          <button type="button" data-tile-uninstall="" disabled={locked} title={lockedReason || removeLabel} onClick={onUninstall}
            aria-label={`${removeLabel} the ${label}`} className={TILE_DANGER}>
            <Trash2 size={11} className="shrink-0" /> {fitted(true, removeLabel)}
          </button>
        )}
      </div>
      {controls.dialogs}
    </li>
  );
}

export function AssetPanel({
  tile, liveError, active, actionBusy, submitBusy, readOnly = false, failed = null, uninstall = null, builtBy = null, useCaseId, onAction, onToggleSchedule, onRetry, onRemove, onAddOutput,
  onOpenRun = null,
}) {
  const { output, kind } = tile;
  const row = kind === 'live' ? tile.row : null;
  const controls = useAssetControls({ output, row, uninstall, useCaseId, submitBusy, actionBusy, onAction, onRemove });
  const Icon = ASSET_ICONS[output.id];
  if (kind === 'off') {
    return (
      <section data-asset-panel={output.id} data-tile-kind="off" className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-bg-subtle/50 p-4 text-[12px]">
        <div className="flex items-start gap-3">
          <IconChip icon={Icon} tone="idle" size="md" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">{output.label}: not in this MVP</p>
            {tile.note && <p data-asset-note="" className="text-text-primary">{tile.note}</p>}
            <p className="text-text-secondary">{output.blurb}</p>
          </div>
        </div>
        {onAddOutput && (
          <div>
            <button type="button" disabled={active} onClick={onAddOutput} className={`${BUTTON} border border-border bg-surface text-text-primary`}>
              <Plus size={11} /> Add the {output.label}
            </button>
          </div>
        )}
      </section>
    );
  }
  const busy = kind === 'building' ? tile : tile.building || null;
  const failure = failed ? `The ${failed.label} failed on v${failed.spec_version}: ${failed.error || 'no error text was recorded'}` : '';
  const look = row ? (busy ? PENDING_LOOK.building(busy) : null) : kind === 'failed' && failure ? { tone: 'error', text: failure } : PENDING_LOOK[kind](tile, liveError);
  const warned = row?.warnings?.length > 0;
  const tone = row ? (warned && row.state.tone === 'success' ? 'warning' : TONE_CHIP[row.state.tone] || 'idle') : look.tone;
  const { canRemove, act } = controls;
  const locked = readOnly || active || submitBusy;
  const retry = () => onRetry(output.id);
  const note = row ? sharedNote(output.id, uninstall, builtBy) : '';
  return (
    <section data-asset-panel={output.id} data-tile-kind={kind} data-control={row ? row.id : undefined} data-tile-building={busy ? (busy.now ? 'now' : 'waiting') : undefined}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-[12px] shadow-sm">
      <div className="flex items-start gap-3">
        <IconChip icon={Icon} tone={tone} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-text-primary">{output.label}</span>
            {row && <ImplementStatusBadge state={row.state} />}
          </div>
          {row && <p className="font-mono text-[11px] text-text-secondary truncate" title={row.name}>{row.name}</p>}
          {note && <p data-shared-note="" className="mt-1 text-text-primary">{note}</p>}
          {row?.detail && <p data-control-detail="" className={`mt-1 ${row.state.tone === 'error' ? 'text-error-fg' : 'text-text-secondary'}`}>{row.detail}</p>}
          {row?.backend && <p data-app-backend="" className="mt-1 text-text-secondary">{row.backend}</p>}
          {row?.notes?.map((n) => <p key={n} data-built-note="" className="mt-1 text-text-secondary">{n}</p>)}
          {row && failure && <p data-asset-failure="" className="mt-1 text-error-fg">{failure}</p>}
          {look && (
            <p className={kind === 'failed' ? 'text-error-fg' : 'text-text-secondary'}>
              {busy?.now && <Loader2 size={11} className="inline mr-1 align-[-1px] motion-safe:animate-spin text-db-red-fg" aria-hidden />}
              {look.text}
            </p>
          )}
        </div>
      </div>
      {busy && (
        <div className="relative h-1 rounded-full bg-bg-subtle overflow-hidden" aria-hidden>
          <span className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${busy.now ? 'bg-db-red motion-safe:animate-[shimmer_1.8s_ease-in-out_infinite]' : 'bg-border'}`} />
        </div>
      )}
      {warned && (
        <ul aria-label={`${row.label} warnings`} className="space-y-1 rounded-lg bg-warning-bg px-2.5 py-2 ring-1 ring-inset ring-warning/40">
          {row.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5 text-warning-fg">
              <AlertTriangle size={12} className="mt-[2px] shrink-0" aria-hidden />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {row && <RowControls row={row} active={active} actionBusy={actionBusy} submitBusy={submitBusy} readOnly={readOnly} failed={failed} onAction={act} onToggleSchedule={onToggleSchedule} onRetry={retry} onOpenRun={onOpenRun} />}
        {!row && failed && <RetryButton failed={failed} disabled={locked} lockedReason={readOnlyReason(readOnly)} onRetry={retry} />}
        {canRemove && (
          <button type="button" disabled={locked || Boolean(uninstall.blocked)} onClick={controls.ask}
            className={`${BUTTON} border border-error/40 bg-surface text-error-fg`}>
            <Trash2 size={11} /> {uninstall.label}
          </button>
        )}
      </div>
      {canRemove && uninstall.blocked && <p data-uninstall-blocked="" className="text-[11px] text-text-secondary">{uninstall.blocked}</p>}
      {controls.dialogs}
    </section>
  );
}

export function NotebookFacts({ notebook }) {
  return (
    <>
      {notebook.state.reason && <p className={notebook.state.state === 'failed' ? 'text-error-fg' : 'text-text-secondary'}>{notebook.state.reason}</p>}
      {notebook.runError && <p className="text-error-fg">{notebook.runError}</p>}
      {notebook.path && <p className="font-mono text-[11px] text-text-secondary break-all">{notebook.path}</p>}
    </>
  );
}

export function NotebookLinks({ notebook }) {
  return (
    <>
      {notebook.href && (
        <a className={`${BUTTON} font-semibold text-white bg-db-red-solid hover:opacity-90`} href={notebook.href} target="_blank" rel="noreferrer">
          Open the notebook <ExternalLink size={11} />
        </a>
      )}
      {notebook.runUrl && (
        <a className={`${BUTTON} border border-border bg-surface text-text-primary`} href={notebook.runUrl} target="_blank" rel="noreferrer">
          Open the notebook run <ExternalLink size={11} />
        </a>
      )}
    </>
  );
}

export function NotebookPanel({ notebook, kpi = null, children = null }) {
  return (
    <section data-asset-panel="notebook" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-[12px] shadow-sm">
      <div className="flex items-start gap-3 min-w-0">
        <IconChip icon={NotebookPen} tone={TONE_CHIP[notebook.state.tone] || 'idle'} size="md" />
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-text-primary">Genie Code notebook</span>
            <ImplementStatusBadge state={notebook.state} />
          </div>
          <NotebookFacts notebook={notebook} />
          <TargetKpiLine view={kpi} />
        </div>
      </div>
      {(notebook.href || notebook.runUrl || children) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <NotebookLinks notebook={notebook} />
          {children}
        </div>
      )}
    </section>
  );
}

function KeptVersions({ kept, locked, lockedReason = '', onRemove }) {
  return (
    <section aria-label="Kept live from earlier versions" className="px-4 pb-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">Kept live from earlier versions</p>
      <ul className="mt-1.5 divide-y divide-border rounded-xl border border-border bg-surface text-[12px]">
        {kept.map((entry) => (
          <li key={entry.version} data-kept-version={entry.version} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              <span className="font-semibold text-text-primary">v{entry.version}</span>
              {entry.assets.map((asset) => (
                <span key={`${asset.output}:${asset.id}`} className="inline-flex items-center gap-1.5 text-text-secondary">
                  <IconChip icon={ASSET_ICONS[asset.output]} size="sm" />
                  {asset.url
                    ? <a href={asset.url} target="_blank" rel="noreferrer" className="font-medium text-db-red-fg hover:underline">{asset.title || asset.label} <ExternalLink size={11} className="inline" /></a>
                    : <span className="font-medium text-text-primary">{asset.title || asset.label}</span>}
                </span>
              ))}
            </div>
            <button type="button" disabled={locked} title={lockedReason || undefined} onClick={() => onRemove(entry)} className={`${BUTTON} border border-error/40 bg-surface text-error-fg`}>
              <Trash2 size={11} /> Remove v{entry.version}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const keptNames = (entry) => entry.assets.map((asset) => asset.label).join(', ');

export function BuildControls({
  kept = [], live, liveError, latest, useCaseId, active, buildingNow, actionBusy, submitBusy, readOnly = false, onAction, onRemoveKept, onToggleSchedule, onRefresh,
  onOpenRun = null,
}) {
  const [removingKept, setRemovingKept] = useState(null);
  const { strips } = controlTiles(live, latest, { active, buildingNow });
  const actions = (live?.actions || []).slice(0, 5);
  const confirmRemoveKept = async () => {
    if (await onRemoveKept(removingKept.version)) setRemovingKept(null);
  };
  return (
    <section role="region" aria-label="Build and job" className={PANEL_CLASS}>
      <SectionTitle
        icon={Hammer}
        title="Build and job"
        hint={live?.checked_at ? `Live status checked ${formatWhen(live.checked_at, live.checked_at)}` : 'Reading the live status of the build and the job'}
        right={(
          <button type="button" onClick={onRefresh} aria-label="Check the live status now" className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary">
            <RefreshCw size={13} />
          </button>
        )}
      />
      {liveError && <p className="px-4 pt-3 text-[12px] text-error-fg">Inspire cannot read the live status: {liveError}</p>}
      {live && !strips.length && <p className="px-4 py-3 text-[12px] text-text-secondary">This MVP has no job yet.</p>}
      {strips.length > 0 && (
        <ul className="divide-y divide-border border-b border-border">
          {strips.map((row) => (
            <StripRow key={row.id} row={row} controls={(
              <RowControls row={row} active={active} actionBusy={actionBusy} submitBusy={submitBusy} readOnly={readOnly} onAction={onAction} onToggleSchedule={onToggleSchedule}
                onOpenRun={onOpenRun} />
            )} />
          ))}
        </ul>
      )}
      {kept.length > 0 && <div className="pt-4"><KeptVersions kept={kept} locked={readOnly || active || submitBusy} lockedReason={readOnlyReason(readOnly)} onRemove={setRemovingKept} /></div>}
      {actions.length > 0 && (
        <div className="px-4 py-3 border-t border-border bg-bg-subtle/50">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Recent actions</p>
          <ul aria-label="Recent control actions" className="mt-1 text-[11px] text-text-secondary space-y-0.5">
            {actions.map((entry, i) => (
              <li key={`${entry.acted_at}-${i}`} className={entry.result === 'done' ? '' : 'text-error-fg'}>{controlActionText(entry)}</li>
            ))}
          </ul>
        </div>
      )}
      {removingKept && (
        <ConfirmDialog title={`Remove v${removingKept.version}`} confirmLabel={`Remove v${removingKept.version}`} useCaseId={useCaseId} busy={submitBusy}
          onCancel={() => setRemovingKept(null)} onConfirm={confirmRemoveKept}>
          <p>
            Inspire deletes what v{removingKept.version} kept live ({keptNames(removingKept)}) in a new version of this MVP. The live version stays as it is.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
