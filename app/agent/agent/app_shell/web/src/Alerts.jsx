import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteAlert, failureOf, getAlerts, pauseAlert, previewAlert, saveAlert } from './api.js';
import { formatValue } from './format.js';
import { stampText } from './freshness.js';
import { plural } from './hub.js';
import { Icon } from './icons.jsx';
import { Failure, Skeleton, useToast, PlainNote, toastFailure } from './ui.jsx';
import { SaveButton, runWrite, useWrite } from './saving.jsx';
import DataTable from './DataTable.jsx';
import { AskGenie } from './AskGenie.jsx';
import { fieldsOf, tableContext } from './explain.js';
import {
  blankForm, capText, capped, defaultName, filtersText, formFrom, formProblem, measureOf, operatorLabel, operatorsOf, parseEmails,
  previewText, reachable, ruleText, stateFlag, watchOf,
} from './alerts.js';

function useAlerts(pageId) {
  const [out, setOut] = useState({ data: null, error: '' });
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    getAlerts(pageId).then((data) => { if (mine === seq.current) setOut({ data, error: '' }); })
      .catch((e) => { if (mine === seq.current) setOut((o) => ({ data: o.data, error: e.message })); });
  }, [pageId]);
  useEffect(() => { load(); }, [load]);
  return { ...out, load };
}

function FilterPicks({ filter, picked, onPick }) {
  const options = filter.options || [];
  return (
    <fieldset className="alert-opts">
      <legend>{filter.label}</legend>
      {!options.length && <span className="none">No values to pick</span>}
      {options.map((value) => (
        <label key={value} className="alert-opt">
          <input type="checkbox" checked={picked.includes(value)} onChange={(e) => onPick(e.target.checked ? [...picked, value] : picked.filter((v) => v !== value))} />
          <span>{value}</span>
        </label>
      ))}
    </fieldset>
  );
}

function AlertForm({ listing, meta, page, start, onDone, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState(start);
  const saving = useWrite().busy;
  const [failure, setFailure] = useState(null);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const measure = measureOf(listing, form);
  const operators = operatorsOf(listing, form);
  const filters = (meta?.filters || []).filter((f) => reachable(listing, form).includes(f.id));
  const problem = formProblem(listing, form);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };
  const setBasis = (basis) => set({ basis, operator: (basis === 'baseline' ? listing.baseline_operators : listing.operators).includes(form.operator) ? form.operator : '>=' });
  const format = (v) => formatValue(v, measure?.format === 'integer' ? 'number' : measure?.format, measure?.currency);
  const check = async () => {
    setChecking(true);
    setFailure(null);
    try {
      setPreview(await previewAlert({ page: page.id, watch: watchOf(listing, form) }));
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setChecking(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (problem) return;
    setFailure(null);
    await runWrite('alert:save', async () => {
      try {
        await saveAlert({ page: page.id, ...(form.id ? { id: form.id } : {}), name: form.name.trim() || defaultName(listing, form), watch: watchOf(listing, form),
          schedule: form.schedule, emails: parseEmails(form.emails), paused: form.paused, notify_on_ok: form.notify });
        toast(form.id ? 'Alert saved.' : 'Alert set up. It checks on its schedule.');
        onDone();
      } catch (err) {
        setFailure(failureOf(err));
      }
    });
  };
  return (
    <form className="alert-form" onSubmit={submit} aria-label={form.id ? 'Change the alert' : 'New alert'}>
      <div className="alert-grid">
        <label className="in"><span>What to watch</span>
          <select value={form.what} onChange={(e) => set({ what: e.target.value, basis: 'fixed', filters: {} })} aria-label="What to watch">
            {listing.measures.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <fieldset className="in alert-basis">
          <legend>Compare with</legend>
          <label><input type="radio" name="alert-basis" checked={form.basis === 'fixed'} onChange={() => setBasis('fixed')} />A number you set</label>
          <label className={measure?.baseline ? '' : 'is-off'}>
            <input type="radio" name="alert-basis" checked={form.basis === 'baseline'} disabled={!measure?.baseline} onChange={() => setBasis('baseline')} />
            Earlier runs
          </label>
          {measure && !measure.baseline && <small>Earlier runs are not available: {measure.baseline_note}.</small>}
        </fieldset>
        <label className="in"><span>Send an email when it</span>
          <select value={form.operator} onChange={(e) => set({ operator: e.target.value })} aria-label="How to compare">
            {operators.map((o) => <option key={o} value={o}>{operatorLabel(o, form.basis)}</option>)}
          </select>
        </label>
        <label className="in"><span>{form.basis === 'baseline' ? 'Number to use until 5 earlier runs exist' : 'Number'}</span>
          <input type="number" step="any" value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} aria-label="Number" />
        </label>
        <label className="in"><span>Check it</span>
          <select value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} aria-label="Check it">
            {listing.schedules.map((s) => <option key={s.id} value={s.id}>{s.label[0].toUpperCase() + s.label.slice(1)}</option>)}
          </select>
        </label>
        <label className="in in--wide"><span>Email addresses, separated by commas</span>
          <textarea dir="auto" value={form.emails} onChange={(e) => set({ emails: e.target.value })} rows={2} aria-label="Email addresses" />
          <small>Only people with a user in this workspace get the email. It never lists records.</small>
        </label>
        <div className="in in--wide">
          <label className="alert-opt">
            <input type="checkbox" checked={form.notify} onChange={(e) => set({ notify: e.target.checked })} aria-label="Email again when it clears" />
            <span>Email again when it clears</span>
          </label>
          <small>One more email when the value is back on the right side of the line. Turn it off to hear from the alert only when it fires.</small>
        </div>
        <label className="in in--wide"><span>Name</span>
          <input dir="auto" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={defaultName(listing, form)} maxLength={100} aria-label="Name" />
        </label>
      </div>
      {filters.length > 0 && (
        <div className="alert-filters">
          <p className="alert-sub">Only count these segments (leave empty for all)</p>
          {filters.map((f) => (
            <FilterPicks key={f.id} filter={f} picked={form.filters[f.id] || []} onPick={(values) => set({ filters: { ...form.filters, [f.id]: values } })} />
          ))}
        </div>
      )}
      {preview && <p className="note note--flat alert-preview" role="status">{previewText(preview, format)}</p>}
      <Failure failure={failure} className="tile-err tile-err--flat"><Icon name="info" size={14} />{failure?.text}</Failure>
      {problem && <PlainNote text={problem} className="hint" />}
      <div className="alert-acts">
        <button type="button" className="btn" onClick={check} disabled={!!problem || checking}><Icon name="search" size={14} />{checking ? 'Checking' : 'Check the value now'}</button>
        <span className="sp" />
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <SaveButton write="alert:save" type="submit" className="btn btn--pri" disabled={!!problem} why={problem || ''}><Icon name="check" size={14} />{form.id ? 'Save the alert' : 'Set up the alert'}</SaveButton>
      </div>
    </form>
  );
}

function AlertActions({ alert, onEdit, onChanged }) {
  const toast = useToast();
  const busy = useWrite().busy;
  const run = async (action, said, key) => {
    await runWrite(key, async () => {
      try {
        await action();
        toast(said);
        onChanged();
      } catch (err) {
        toastFailure(toast, err, () => run(action, said, key));
      }
    });
  };
  const paused = alert.state === 'paused';
  return (
    <>
        {alert.can_change && alert.kind === 'watch' && (
          <button className="link" onClick={() => onEdit(alert)} disabled={busy} aria-label={`Change ${alert.name}`}><Icon name="edit" size={13} />Change</button>
        )}
        {alert.can_change && (
          <SaveButton write={`alert:${alert.id}:pause`} className="link" aria-label={`${paused ? 'Resume' : 'Pause'} ${alert.name}`}
            onClick={() => run(() => pauseAlert({ id: alert.id, paused: !paused }), paused ? 'Alert resumed.' : 'Alert paused. It sends nothing until you resume it.', `alert:${alert.id}:pause`)}>
            {paused ? 'Resume' : 'Pause'}
          </SaveButton>
        )}
        {alert.can_change && (
          <SaveButton write={`alert:${alert.id}:delete`} className="link link--danger" aria-label={`Delete ${alert.name}`}
            onClick={() => { if (window.confirm(`Delete the alert ${alert.name}? It stops sending emails.`)) run(() => deleteAlert({ id: alert.id }), 'Alert deleted.', `alert:${alert.id}:delete`); }}>
            <Icon name="trash" size={13} />Delete
          </SaveButton>
        )}
    </>
  );
}

const scheduleText = (alert, listing) => {
  const label = listing.schedules.find((s) => s.id === alert.schedule)?.label || 'every hour';
  return label[0].toUpperCase() + label.slice(1);
};
const ownerText = (alert) => (alert.kind === 'watch' ? alert.by : 'The App');

function alertColumns(listing, meta, onEdit, onChanged) {
  return [
    {
      key: 'name', label: 'Alert', className: 'wrap',
      render: (alert) => {
        const scope = alert.kind === 'watch' ? filtersText(alert.watch, meta?.filters) : '';
        return (
          <>
            <b>{alert.name}</b>
            <span className="runs-sub-t">
              {alert.kind === 'watch' ? `${ruleText(alert.watch, listing.measures)}${scope ? ` (${scope})` : ''}` : `Emails ${alert.owner} when records are assigned to them`}
            </span>
          </>
        );
      },
    },
    {
      key: 'state', label: 'State', className: 'nowrap', sortValue: (alert) => stateFlag(alert.state).text,
      render: (alert) => { const flag = stateFlag(alert.state); return <span className={`run-st run-st--${flag.tone || 'idle'}`}><i aria-hidden="true" />{flag.text}</span>; },
    },
    { key: 'checked', label: 'Last checked', date: true, className: 'nowrap', render: (alert) => (alert.checked ? stampText(alert.checked) : <span className="none">Not yet</span>) },
    { key: 'schedule', label: 'Checks', className: 'nowrap', sortValue: (alert) => scheduleText(alert, listing), render: (alert) => scheduleText(alert, listing) },
    {
      key: 'owner', label: 'Owner', className: 'nowrap', sortValue: ownerText,
      render: (alert) => <>{ownerText(alert)}<span className="runs-sub-t">{alert.email_count} {alert.email_count === 1 ? 'person' : 'people'}</span></>,
    },
    { key: '_actions', label: 'Actions', hideLabel: true, fixed: true, className: 'act', render: (alert) => <AlertActions alert={alert} onEdit={onEdit} onChanged={onChanged} /> },
  ];
}

function alertFields(alert, columns, listing, meta) {
  const checks = alert.kind === 'watch' ? [ruleText(alert.watch, listing.measures), filtersText(alert.watch, meta?.filters)].filter(Boolean).join(', ')
    : `Emails ${alert.owner} when records are assigned to them`;
  return { ...fieldsOf(alert, columns), 'What it checks': checks };
}

export default function Alerts({ app, page, meta, compose = false, onComposed }) {
  const { data, error, load } = useAlerts(page.id);
  const [form, setForm] = useState(null);
  const listing = data;
  const full = capped(listing?.caps);
  useEffect(() => {
    if (!compose || !listing) return;
    onComposed?.();
    if (!full && listing.measures.length > 0) setForm((now) => now || blankForm(listing, app.user));
  }, [compose, listing, full, app.user, onComposed]);
  const done = () => { setForm(null); load(); };
  const columns = listing ? alertColumns(listing, meta, (x) => setForm(formFrom(x)), load) : [];
  const fields = (alert) => alertFields(alert, columns, listing, meta);
  return (
    <section className="card card--table alerts" aria-label="Alerts">
      <header className="card-h">
        <div>
          <h2>Alerts</h2>
          <p>Get an email when what this page shows crosses a line you set. Each alert checks on its own schedule.</p>
        </div>
        {listing && !form && listing.measures.length > 0 && (
          <button className="btn btn--pri" onClick={() => setForm(blankForm(listing, app.user))} disabled={full} title={full ? capText(listing.caps) : undefined}>
            <Icon name="plus" size={14} />New alert
          </button>
        )}
        <AskGenie kind="table" title="Alerts" context={tableContext('The alerts of this use case.', listing?.alerts || [], fields)} />
      </header>
      {!listing && !error && <div style={{ padding: 16, display: 'grid', gap: 10 }}>{[1, 2].map((i) => <Skeleton key={i} height={22} />)}</div>}
      {error && <PlainNote text={error} prefix="The alerts could not load: " icon={<Icon name="info" size={14} />} className="tile-err" role="alert" onRetry={load} />}
      {listing && form && <AlertForm key={form.id || 'new'} listing={listing} meta={meta} page={page} start={form} onDone={done} onCancel={() => setForm(null)} />}
      {listing && (
        <>
          {listing.alerts.length > 0 ? (
            <DataTable label="Alerts of this use case" tableClass="alerts-tbl" columns={columns} rows={listing.alerts}
              rowKey={(a) => a.id} grid={`page:${page.id}:alerts`} askRow={(a) => ({ title: a.name, context: { hint: 'An alert of this use case.', fields: fields(a) } })} />
          ) : !form && <p className="more">No alerts on this page yet.</p>}
          {listing.unread > 0 && <p className="note" role="status"><Icon name="info" size={14} />{plural(listing.unread, 'alert')} could not be read just now.</p>}
          <p className="more alerts-foot">
            {capText(listing.caps)}
            {listing.built && <> <a href={listing.built} target="_blank" rel="noopener noreferrer">The alert set up when the App was built</a> opens in Databricks; the App does not change it.</>}
          </p>
        </>
      )}
    </section>
  );
}
