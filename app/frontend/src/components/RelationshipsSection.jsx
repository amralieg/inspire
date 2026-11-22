import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PlainMessage } from './TechnicalDetails';
import { raisePermissions } from '../lib/permissionBus';
import { sameLink } from '../lib/tableRelationships';
import BusyNote from './BusyNote';

const ANSWER_MS = 20000;
const FILTER_AT = 12;
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary';
const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap px-3 rounded-lg text-xs font-semibold border border-border bg-surface text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const PERSON = 'person';
const SOURCE_TEXT = { [PERSON]: 'added by you' };

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Inspire did not get an answer in time.')), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
});
const shortName = (table) => table.split('.').pop();
// The name a table shows: its table name, or schema.table when another picked table has the same table name.
const nameOfIn = (tables) => {
  const count = new Map();
  for (const t of tables) count.set(shortName(t), (count.get(shortName(t)) || 0) + 1);
  return (table) => (count.get(shortName(table)) > 1 ? table.split('.').slice(-2).join('.') : shortName(table));
};
const linkText = (link, nameOf = shortName) => `${nameOf(link.from.table)}.${link.from.column} → ${nameOf(link.to.table)}.${link.to.column}`;
const sourceText = (source) => SOURCE_TEXT[source] || source;

// One list of the picked tables (or of the columns of one table): a filter box once the list is long, then the buttons.
function PickList({ label, items, picked, disabledItem, onPick, filterLabel, nameOf }) {
  const [filter, setFilter] = useState('');
  const shown = items.filter((item) => !filter.trim() || item.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="font-semibold text-text-primary">{label}</p>
      {items.length > FILTER_AT && (
        <input type="search" aria-label={filterLabel} value={filter} dir="auto" onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter" className={`${FIELD} w-full`} />
      )}
      <ul aria-label={label} className="grid h-56 grid-cols-[minmax(0,1fr)] content-start gap-1 overflow-y-auto">
        {shown.map((item) => (
          <li key={item} className="min-w-0">
            <button type="button" aria-pressed={picked === item} disabled={disabledItem === item} title={item}
              onClick={() => onPick(item)}
              className={`w-full truncate rounded-md border px-2 py-1 text-start font-mono text-xs disabled:opacity-40 ${picked === item ? 'border-db-red-fg bg-db-red-50 text-text-primary' : 'border-border bg-surface text-text-primary hover:bg-bg-subtle'}`}>
              {nameOf(item)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The Link dialog (REQ-371, REQ-376): the columns of the source table on the left, the target's on the right. One click on Link, between
// the two lists, adds the pair at once and shows it in the dialog's list. Every link is kept as it is made, so the dialog closes with
// Close, Esc or a click outside it and nothing is lost. Suggestions (declared keys, matching names) are added only by their own button.
function LinkDialog({ dialog, links, suggestions, linked, onPick, onLink, onRemove, onAddSuggested, onClose, onRetry, nameOf }) {
  const { source, target } = dialog;
  const boxRef = useRef(null);
  const columnsOf = (table) => dialog.columns?.[table]?.columns || [];
  const [filter, setFilter] = useState({ source: '', target: '' });
  const ready = dialog.pickSource && dialog.pickTarget && !linked;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target) && !e.target.closest?.('[data-link-open]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const sideList = (side, table, picked) => {
    const names = columnsOf(table);
    const term = filter[side].trim().toLowerCase();
    const shown = names.filter((n) => !term || n.toLowerCase().includes(term));
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <p className="truncate font-semibold text-text-primary" title={table}>{nameOf(table)}</p>
        {names.length > FILTER_AT && (
          <input type="search" aria-label={`Filter the columns of ${nameOf(table)}`} value={filter[side]} dir="auto"
            onChange={(e) => setFilter({ ...filter, [side]: e.target.value })} placeholder="Filter" className={`${FIELD} w-full`} />
        )}
        <ul aria-label={`Columns of ${nameOf(table)}`} className="grid h-56 grid-cols-[minmax(0,1fr)] content-start gap-1 overflow-y-auto">
          {shown.map((c) => (
            <li key={c} className="min-w-0">
              <button type="button" aria-pressed={picked === c} onClick={() => onPick(side, c)}
                className={`w-full truncate rounded-md border px-2 py-1 text-start font-mono text-xs ${picked === c ? 'border-db-red-fg bg-db-red-50 text-text-primary' : 'border-border bg-surface text-text-primary hover:bg-bg-subtle'}`}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div ref={boxRef} role="dialog" aria-label={`Link ${nameOf(source)} to ${nameOf(target)}`} data-link-dialog className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-3">
      <p className="font-semibold text-text-primary">Link {nameOf(source)} to {nameOf(target)}</p>
      {dialog.status === 'loading' && <BusyNote data-link-loading="" className="text-text-tertiary" text="Reading the columns of both tables" />}
      {dialog.status === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <PlainMessage role="alert" className="text-error-fg" text={dialog.error} />
          <button type="button" className={BUTTON} onClick={onRetry}>Try again</button>
        </div>
      )}
      {dialog.status === 'done' && (
        <>
          {dialog.note && <p data-link-note role="status" className="text-warning-fg">{dialog.note}</p>}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
            {sideList('source', source, dialog.pickSource)}
            <div className="flex flex-col items-center gap-2 pt-8">
              <button type="button" aria-label="Link" className={BUTTON} disabled={!ready} onClick={onLink}>Link</button>
              {linked && <p data-link-refused role="status" className="max-w-[10rem] text-center text-warning-fg">{linked}</p>}
              {!linked && !ready && <p data-link-pick-reason className="max-w-[10rem] text-center text-text-tertiary">Pick one column in each table, then Link.</p>}
            </div>
            {sideList('target', target, dialog.pickTarget)}
          </div>
          {links.length > 0 && (
            <ul aria-label="Links between these tables" className="grid gap-1">
              {links.map((link) => (
                <li key={linkText(link, nameOf)} data-dialog-link={linkText(link, nameOf)} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-2 py-1">
                  <span className="min-w-0 truncate font-mono text-text-primary" title={linkText(link, nameOf)}>{linkText(link, nameOf)}</span>
                  <button type="button" aria-label={`Remove link ${linkText(link, nameOf)}`} onClick={() => onRemove(link)}
                    className="ms-auto text-text-tertiary hover:text-db-red-fg"><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-text-secondary">Suggested</p>
              <ul aria-label="Suggested links" className="grid grid-cols-[minmax(0,1fr)] gap-1">
                {suggestions.map((s) => (
                  <li key={linkText(s, nameOf)} data-suggested-link={linkText(s, nameOf)} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2 py-1">
                    <span className="min-w-0 truncate font-mono text-text-primary" title={linkText(s, nameOf)}>{linkText(s, nameOf)}</span>
                    <span className="ms-auto text-text-secondary">{s.source}</span>
                    <button type="button" className={BUTTON} aria-label={`Add suggested link ${linkText(s, nameOf)}`} onClick={() => onAddSuggested(s)}>Add</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button type="button" className={BUTTON} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// The Relationships section of Data Management (REQ-362, REQ-370, REQ-371, REQ-376). Two lists of the picked tables sit side by side,
// Source and Target; the picks stay when a link is made, so one side can change alone. Link opens the dialog to pair columns. Every link
// is kept at once and listed below with a count, and each can be removed.
export default function RelationshipsSection({ tables, relationships, onRelationships, apiFetch, warehouseId, onMetricViews = () => {} }) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [dialog, setDialog] = useState(null);
  const run = dialog?.run ?? 0;

  // The dialog reads the two tables' columns and the suggested pairs once per opening (run), and every read ends: done, or a reason.
  useEffect(() => {
    if (!dialog || dialog.status !== 'loading') return undefined;
    let cancelled = false;
    withTimeout(apiFetch(`/api/relationships?warehouse_id=${encodeURIComponent(warehouseId || '')}`, {
      method: 'POST',
      body: JSON.stringify({ table: dialog.source, tables, focus: [dialog.target] }),
    }), ANSWER_MS)
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.metric_views) && d.metric_views.length) {
          onMetricViews(d.metric_views);
          setDialog(null);
          setSource('');
          return;
        }
        const pair = (s) => [s.from.table, s.to.table].sort().join('|') === [dialog.source, dialog.target].sort().join('|');
        setDialog((prev) => (prev && prev.run === run ? { ...prev, status: 'done', columns: d.tables || {}, note: d.columns_note || '', suggestions: (d.suggestions || []).filter(pair) } : prev));
      })
      .catch((e) => {
        if (cancelled) return;
        const permissions = Array.isArray(e.body?.permissions) ? e.body.permissions : [];
        setDialog((prev) => (prev && prev.run === run ? { ...prev, status: 'error', error: e.message || 'The columns could not be read.' } : prev));
        raisePermissions(permissions, { retry: () => setDialog((prev) => (prev ? { ...prev, run: prev.run + 1, status: 'loading' } : prev)) });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (!tables.length) {
    return <p data-relationships-empty className="text-text-tertiary">Pick tables under Unity Catalog Metadata to see how they join.</p>;
  }
  const openLink = () => setDialog({ run: run + 1, source, target, status: 'loading', columns: {}, suggestions: [], pickSource: '', pickTarget: '' });
  const closeDialog = () => setDialog(null);
  const pickSide = (side, column) => setDialog((prev) => ({ ...prev, [side === 'source' ? 'pickSource' : 'pickTarget']: column }));
  // Every link is written at once: a link already listed is not added twice, in either direction (REQ-394).
  const commitLinks = (added) => {
    const fresh = added.filter((s, i) => !relationships.some((l) => sameLink(l, s)) && added.findIndex((x) => sameLink(x, s)) === i);
    if (fresh.length) onRelationships([...relationships, ...fresh]);
  };
  const nameOf = nameOfIn(tables);
  const linkPicked = () => {
    commitLinks([{ from: { table: dialog.source, column: dialog.pickSource }, to: { table: dialog.target, column: dialog.pickTarget }, source: PERSON }]);
    setDialog((prev) => ({ ...prev, pickSource: '', pickTarget: '' }));
  };
  const linkReason = !source || !target ? 'Pick one source table and one target table to link them.' : '';
  const betweenDialog = dialog ? relationships.filter((l) => [l.from.table, l.to.table].sort().join('|') === [dialog.source, dialog.target].sort().join('|')) : [];
  const suggestions = dialog ? (dialog.suggestions || []).filter((s) => !relationships.some((l) => sameLink(l, s))) : [];
  // REQ-394: the picked pair is already a link, or the reverse of one: Link stays disabled and this one plain line says why.
  const linked = dialog && dialog.pickSource && dialog.pickTarget
    && relationships.some((l) => sameLink(l, { from: { table: dialog.source, column: dialog.pickSource }, to: { table: dialog.target, column: dialog.pickTarget } }))
    ? (dialog.pickSource === dialog.pickTarget ? `These tables are already linked on ${dialog.pickSource}.` : `These tables are already linked on ${dialog.pickSource} and ${dialog.pickTarget}.`)
    : '';

  return (
    <div data-relationships className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        <div data-list="source" className="min-w-0">
          <PickList label="Source tables" items={tables} picked={source} disabledItem={target} onPick={setSource} filterLabel="Filter source tables" nameOf={nameOf} />
        </div>
        <div className="flex flex-col items-center gap-2 pt-8">
          <button type="button" data-link-open="" className={BUTTON} disabled={!source || !target} onClick={openLink}>Link</button>
          {linkReason && <p data-link-reason className="max-w-[10rem] text-center text-text-tertiary">{linkReason}</p>}
        </div>
        <div data-list="target" className="min-w-0">
          <PickList label="Target tables" items={tables} picked={target} disabledItem={source} onPick={setTarget} filterLabel="Filter target tables" nameOf={nameOf} />
        </div>
      </div>
      {dialog && (
        <LinkDialog dialog={dialog} links={betweenDialog} suggestions={suggestions} linked={linked} onPick={pickSide} onLink={linkPicked} nameOf={nameOf}
          onRemove={(link) => onRelationships(relationships.filter((l) => l !== link))}
          onAddSuggested={(s) => commitLinks([s])} onClose={closeDialog}
          onRetry={() => setDialog((prev) => ({ ...prev, run: prev.run + 1, status: 'loading' }))} />
      )}
      <div data-links className="space-y-2">
        <p className="font-semibold text-text-primary">Links ({relationships.length})</p>
        {relationships.length === 0 && <p data-links-empty className="text-text-secondary">No links yet. Pick a source and a target table, then Link.</p>}
        {relationships.length > 0 && (
          <ul aria-label="Links" className="grid gap-2">
            {relationships.map((link) => (
              <li key={linkText(link, nameOf)} data-relationship={linkText(link, nameOf)} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <span className="min-w-0 truncate font-mono text-text-primary" title={linkText(link, nameOf)}>{linkText(link, nameOf)}</span>
                <span data-link-source className="ms-auto text-text-secondary">{sourceText(link.source)}</span>
                <button type="button" aria-label={`Remove relationship ${linkText(link, nameOf)}`} onClick={() => onRelationships(relationships.filter((l) => l !== link))}
                  className="text-text-tertiary hover:text-db-red-fg"><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
