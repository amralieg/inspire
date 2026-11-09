import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, ExternalLink, Loader2, Pause, Pencil, Play, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import ImplementStatusBadge from './ImplementStatusBadge';
import { PANEL_CLASS, SectionTitle } from './BuildUi';
import DemoNote from './DemoNote';
import { formatWhen } from '../lib/formatWhen';
import { plural } from '../lib/plural';
import { readOnlyReason } from '../lib/showcase';
import {
  ALERTS_EMPTY, ALERTS_GENIE_NOTE, ALERTS_HINT, ALERTS_NOTHING, BASELINE_HINT, BUILT_BY_GENIE, BUILT_DETAIL, CLEARS_HINT, CLEARS_LABEL, EMAILS_HINT, alertFormFrom,
  alertRequest, alertState, clearsText,
  blankAlertForm, capText, capped, measureOf, operatorChoices, previewLine, reachableFilters, scheduleLabel, thresholdHint,
} from '../lib/useCaseAlerts';
import { OPEN_ALL_SETTINGS } from '../lib/implementWizard';
import { PlainMessage } from './TechnicalDetails';

const BUTTON = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50';
const PRIMARY = `${BUTTON} font-semibold text-white bg-db-red-solid hover:opacity-90`;
const OUTLINE = `${BUTTON} border border-border bg-surface text-text-primary`;
const DANGER = `${BUTTON} border border-error/40 bg-surface text-error-fg`;
const FIELD = 'mt-0.5 w-full px-2 py-1 border border-border rounded-lg bg-surface text-[12px] text-text-primary';
const LABEL = 'block text-[11px] text-text-secondary';
const ERROR = 'text-[12px] text-error-fg bg-error-bg border border-error/20 rounded-lg px-3 py-2';
const NOTE = 'text-[12px] text-info-fg bg-info-bg border border-info/20 rounded-lg px-3 py-2';

function SegmentPicks({ filter, picked, onPick }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[11px] font-semibold text-text-primary">{filter.label}</legend>
      {filter.error && <p className="text-[11px] text-error-fg">Inspire could not read its values: {filter.error}</p>}
      {!filter.error && !filter.options.length && <p className="text-[11px] text-text-secondary">No values to pick</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {filter.options.map((value) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[12px] text-text-primary">
            <input type="checkbox" checked={picked.includes(value)} onChange={(e) => onPick(e.target.checked ? [...picked, value] : picked.filter((v) => v !== value))} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AlertForm({ listing, start, post, onDone, onCancel }) {
  const [form, setForm] = useState(start);
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const [preview, setPreview] = useState(null);
  const measure = measureOf(listing, form);
  const operators = operatorChoices(listing, form);
  const segments = reachableFilters(listing, form);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };
  const setBasis = (basis) => {
    const ids = (basis === 'baseline' ? listing.baseline_operators : listing.operators) || [];
    set({ basis, operator: ids.includes(form.operator) ? form.operator : ids[0] || '>=' });
  };
  const run = async (kind, step) => {
    setBusy(kind);
    setFailure('');
    try {
      return await step();
    } catch (err) {
      setFailure(err.message);
      return null;
    } finally {
      setBusy('');
    }
  };
  const check = () => run('check', async () => setPreview(await post('preview', { watch: alertRequest(listing, form).watch })));
  const submit = (e) => {
    e.preventDefault();
    run('save', async () => {
      const got = await post('save', alertRequest(listing, form));
      onDone(form.id ? 'Alert saved in Databricks.' : 'Alert set up in Databricks. It checks on its schedule.', got.alert);
    });
  };
  return (
    <form noValidate onSubmit={submit} aria-label={form.id ? 'Change the alert' : 'New alert'} className="px-4 py-3 space-y-3 border-b border-border bg-bg-subtle/40">
      <div className="grid gap-3 md:grid-cols-3">
        <label className={LABEL}>What to watch
          <select className={FIELD} value={form.what} aria-label="What to watch" onChange={(e) => set({ what: e.target.value, basis: 'fixed', filters: {} })}>
            {listing.measures.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <fieldset className={LABEL}>
          <legend>Compare with</legend>
          <label className="me-3 inline-flex items-center gap-1.5 text-[12px] text-text-primary">
            <input type="radio" name="alert-basis" checked={form.basis === 'fixed'} onChange={() => setBasis('fixed')} />A number you set
          </label>
          <label className={`inline-flex items-center gap-1.5 text-[12px] ${measure?.baseline ? 'text-text-primary' : 'text-text-tertiary'}`}>
            <input type="radio" name="alert-basis" checked={form.basis === 'baseline'} disabled={!measure?.baseline} onChange={() => setBasis('baseline')} />Earlier runs
          </label>
          {measure && !measure.baseline && measure.baseline_note && <span className="block text-[11px]">Earlier runs are not available: {measure.baseline_note}.</span>}
          {form.basis === 'baseline' && <span className="block text-[11px]">{BASELINE_HINT}</span>}
        </fieldset>
        <label className={LABEL}>Send an email when it
          <select className={FIELD} value={form.operator} aria-label="Condition" onChange={(e) => set({ operator: e.target.value })}>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className={LABEL}>{form.basis === 'baseline' ? 'Number to use until 5 earlier runs exist' : 'Number'}
          <input className={FIELD} type="number" step={measure?.whole ? 1 : 'any'} min={measure?.min ?? undefined} value={form.threshold} aria-label="Number"
            onChange={(e) => set({ threshold: e.target.value })} />
          {thresholdHint(measure) && <span className="block text-[11px]">{thresholdHint(measure)}</span>}
        </label>
        <label className={LABEL}>Check it
          <select className={FIELD} value={form.schedule} aria-label="Check it" onChange={(e) => set({ schedule: e.target.value })}>
            {listing.schedules.map((s) => <option key={s.id} value={s.id}>{scheduleLabel(listing, s.id)}</option>)}
          </select>
        </label>
        <label className={LABEL}>Name
          <input dir="auto" className={FIELD} value={form.name} maxLength={100} aria-label="Name" placeholder="Named after its rule when left empty"
            onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className={`${LABEL} md:col-span-3`}>Email addresses, separated by commas
          <textarea dir="auto" className={FIELD} rows={2} value={form.emails} aria-label="Email addresses" onChange={(e) => set({ emails: e.target.value })} />
          <span className="block text-[11px]">{EMAILS_HINT}</span>
        </label>
        <label className={`${LABEL} md:col-span-3 flex items-start gap-2`}>
          <input type="checkbox" className="mt-0.5" checked={form.notify} aria-label={CLEARS_LABEL} onChange={(e) => set({ notify: e.target.checked })} />
          <span>
            <span className="block text-text-primary">{CLEARS_LABEL}</span>
            <span className="block">{CLEARS_HINT}</span>
          </span>
        </label>
      </div>
      {segments.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-text-secondary">Only count these segments (leave empty for all)</p>
          <div className="grid gap-3 md:grid-cols-2">
            {segments.map((f) => (
              <SegmentPicks key={f.id} filter={f} picked={form.filters[f.id] || []} onPick={(values) => set({ filters: { ...form.filters, [f.id]: values } })} />
            ))}
          </div>
        </div>
      )}
      {preview && <p role="status" className={NOTE}>{previewLine(preview)}</p>}
      {failure && <p role="alert" className={ERROR}>{failure}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={OUTLINE} onClick={check} disabled={Boolean(busy) || !measure}>
          {busy === 'check' ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} {busy === 'check' ? 'Checking' : 'Check the value now'}
        </button>
        <span className="flex-1" />
        <button type="button" className={OUTLINE} onClick={onCancel} disabled={busy === 'save'}>Cancel</button>
        <button type="submit" className={PRIMARY} disabled={Boolean(busy) || !measure}>
          {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {busy === 'save' ? 'Saving' : form.id ? 'Save the alert' : 'Set up the alert'}
        </button>
      </div>
    </form>
  );
}

function BuiltRow({ alert }) {
  return (
    <li data-alert-built={alert.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-[12px]">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text-primary">{alert.name}</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-db-red-fg">
            <Sparkles size={11} aria-hidden />{BUILT_BY_GENIE}
          </span>
          <ImplementStatusBadge state={alertState(alert.state)} />
        </div>
        {alert.trigger && <p className="text-text-secondary">Fires when {alert.trigger}</p>}
        {typeof alert.notify_on_ok === 'boolean' && <p className="text-text-secondary">{clearsText(alert.notify_on_ok)}</p>}
        <p className="text-text-secondary">{BUILT_DETAIL}</p>
        {alert.error && <p className="text-error-fg">Inspire cannot read it: {alert.error}</p>}
      </div>
      {alert.url && (
        <a href={alert.url} target="_blank" rel="noreferrer" className={OUTLINE}>Open in Databricks <ExternalLink size={11} /></a>
      )}
    </li>
  );
}

function AlertRow({ alert, listing, post, readOnly, onEdit, onChanged }) {
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState('');
  const paused = alert.state === 'paused';
  const locked = Boolean(busy) || readOnly;
  const why = readOnlyReason(readOnly) || undefined;
  const act = async (kind, step, body, said) => {
    setBusy(kind);
    setFailure('');
    try {
      await post(step, body);
      setConfirming(false);
      onChanged(said);
    } catch (err) {
      setFailure(err.message);
    } finally {
      setBusy('');
    }
  };
  const rule = alert.kind === 'watch' ? alert.rule || alert.name : `Emails ${alert.owner} when records are assigned to them`;
  return (
    <li data-alert-row={alert.id} className="px-4 py-3 text-[12px] space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary">{alert.name}</span>
            <ImplementStatusBadge state={alertState(alert.state)} />
          </div>
          {rule !== alert.name && <p className="text-text-primary">{rule}</p>}
          {alert.scope && <p className="text-text-secondary">{alert.scope}</p>}
          <p className="text-text-secondary">
            {[scheduleLabel(listing, alert.schedule), alert.checked ? `Last checked ${formatWhen(alert.checked, alert.checked)}` : 'Not checked yet',
              `Emails ${alert.email_count} ${alert.email_count === 1 ? 'person' : 'people'}`,
              alert.kind === 'watch' ? clearsText(alert.notify_on_ok) : ''].filter(Boolean).join('. ')}
          </p>
          <p className="text-text-secondary">{alert.kind === 'watch' ? `Set up by ${alert.by}` : `Set up when ${alert.owner} was given records`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {alert.url && <a href={alert.url} target="_blank" rel="noreferrer" className={OUTLINE}>Open <ExternalLink size={11} /></a>}
          {alert.can_change && alert.kind === 'watch' && (
            <button type="button" className={OUTLINE} disabled={locked} title={why} onClick={() => onEdit(alert)}><Pencil size={11} /> Edit</button>
          )}
          {alert.can_change && (
            <button type="button" className={OUTLINE} disabled={locked} title={why}
              onClick={() => act('pause', 'pause', { id: alert.id, paused: !paused }, paused ? 'Alert resumed.' : 'Alert paused. It sends nothing until you resume it.')}>
              {busy === 'pause' ? <Loader2 size={11} className="animate-spin" /> : paused ? <Play size={11} /> : <Pause size={11} />} {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {alert.can_change && !confirming && (
            <button type="button" className={DANGER} disabled={locked} title={why} onClick={() => setConfirming(true)}><Trash2 size={11} /> Delete</button>
          )}
        </div>
      </div>
      {confirming && (
        <div role="group" aria-label={`Delete ${alert.name}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-error-bg px-3 py-2">
          <span className="text-error-fg">Delete this alert? It stops sending emails.</span>
          <button type="button" className={DANGER} disabled={Boolean(busy)} onClick={() => act('delete', 'delete', { id: alert.id }, 'Alert deleted.')}>
            {busy === 'delete' ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete the alert
          </button>
          <button type="button" className={OUTLINE} disabled={Boolean(busy)} onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      )}
      {failure && <p role="alert" className={ERROR}>{failure}</p>}
    </li>
  );
}

export default function UseCaseAlerts({ apiFetch, apiPostJson, qBase, useCaseId, refreshKey = 0, readOnly = false, onEditMvp = null }) {
  const [listing, setListing] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState('');
  const [reloads, setReloads] = useState(0);
  const where = useCallback((step) => `/api/inspire/implement/alerts${step ? `/${step}` : ''}?${qBase}&use_case_id=${encodeURIComponent(useCaseId)}`,
    [qBase, useCaseId]);
  useEffect(() => {
    let live = true;
    apiFetch(where(''))
      .then((got) => { if (live) { setListing(got); setLoadError(''); } })
      .catch((err) => { if (live) setLoadError(err.message); });
    return () => { live = false; };
  }, [apiFetch, where, refreshKey, reloads]);
  const post = useCallback((step, body) => apiPostJson(where(step), body), [apiPostJson, where]);
  const changed = (said) => {
    setNotice(said);
    setReloads((n) => n + 1);
  };
  const full = capped(listing?.caps);
  const canAdd = Boolean(listing?.can_add) && (listing?.measures || []).length > 0;
  const addButton = listing && canAdd && !form && (
    <button type="button" className={PRIMARY} disabled={full || readOnly} title={readOnlyReason(readOnly) || (full ? capText(listing.caps) : undefined)}
      onClick={() => { setNotice(''); setForm(blankAlertForm(listing)); }}>
      <Plus size={11} /> Add alert
    </button>
  );
  return (
    <section role="region" aria-label="Alerts of this use case" className={PANEL_CLASS}>
      <SectionTitle icon={BellRing} title="Alerts" hint={ALERTS_HINT} right={addButton} />
      {readOnly && <DemoNote className="m-4" />}
      {!listing && !loadError && <p className="px-4 py-3 text-[12px] text-text-secondary">Reading the alerts of this use case</p>}
      {loadError && <PlainMessage text={`The alerts could not load: ${loadError}`} role="alert" className={`m-4 ${ERROR}`} />}
      {listing && !listing.can_add && listing.why && <PlainMessage as="p" text={listing.why} className={`m-4 ${NOTE}`} />}
      {listing && listing.can_add && !(listing.measures || []).length && <p className={`m-4 ${NOTE}`}>{ALERTS_NOTHING}</p>}
      {notice && <p role="status" className={`m-4 ${NOTE}`}>{notice}</p>}
      {listing && form && !readOnly && (
        <AlertForm key={form.id || 'new'} listing={listing} start={form} post={post} onCancel={() => setForm(null)}
          onDone={(said) => { setForm(null); changed(said); }} />
      )}
      {listing && !listing.unavailable && (
        <>
          {(listing.built_alert || listing.alerts.length > 0) ? (
            <ul className="divide-y divide-border">
              {listing.built_alert && <BuiltRow alert={listing.built_alert} />}
              {listing.alerts.map((a) => (
                <AlertRow key={a.id} alert={a} listing={listing} post={post} readOnly={readOnly} onChanged={changed}
                  onEdit={(x) => { setNotice(''); setForm(alertFormFrom(x)); }} />
              ))}
            </ul>
          ) : !form && <p className="px-4 py-3 text-[12px] text-text-secondary">{ALERTS_EMPTY}</p>}
          {listing.unread > 0 && <p className="px-4 pb-2 text-[12px] text-warning-fg">{plural(listing.unread, 'alert')} could not be read just now.</p>}
          <div className="px-4 py-2 border-t border-border bg-bg-subtle/50 text-[11px] text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{capText(listing.caps)}</span>
            {!listing.built_alert && onEditMvp && (
              <span>{ALERTS_GENIE_NOTE} <button type="button" className="font-semibold text-db-red-fg underline" onClick={onEditMvp}>{OPEN_ALL_SETTINGS}</button></span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
