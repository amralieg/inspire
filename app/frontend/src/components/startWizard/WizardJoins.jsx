// REQ-584 (U9): the suggested joins across the tables the wizard will read, pre-filled, each removable, with "Add a join" (the Relationships
// section's pickers). Names only: the backend suggests by declared key and column name. The person's decisions live in draft.joins as
// [{ from, to, source, removed? }]: a suggestion the person removes stays in the list with removed: true, so the launch can say so.
import { useEffect, useMemo, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import RelationshipsSection from '../RelationshipsSection';
import { sameLink } from '../../lib/tableRelationships';
import { makeApiPostText } from '../../lib/apiClient';
import { PlainMessage } from '../TechnicalDetails';

const BUTTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50';
const short = (table) => String(table).split('.').pop();
export const joinText = (j) => `${short(j.from.table)}.${j.from.column} → ${short(j.to.table)}.${j.to.column}`;
const keyOf = (tables) => tables.map((t) => t.toLowerCase()).sort().join('|');

// The joins the person keeps, and the ones they took out, for tables still in scope.
export function joinsInScope(joins, tables) {
  const have = new Set(tables.map((t) => t.toLowerCase()));
  return (Array.isArray(joins) ? joins : []).filter((j) => have.has(j.from.table.toLowerCase()) && have.has(j.to.table.toLowerCase()));
}
export const keptJoins = (joins, tables) => joinsInScope(joins, tables).filter((j) => !j.removed);

// Adds the suggestions the list does not hold yet (either direction). Anything the person did stays as it is.
export const mergeSuggestions = (joins, suggestions) => {
  const next = [...(joins || [])];
  for (const s of suggestions) {
    if (!next.some((j) => sameLink(j, s))) next.push({ from: s.from, to: s.to, source: s.source });
  }
  return next;
};

// tables: every table the person has picked. groups: lists of tables that are read together (one run); a suggestion across two groups is not shown.
export default function WizardJoins({ tables, groups, joins, setJoins, settings, inspireDatabase }) {
  // The wizard's apiFetch reads only; the joins route is a POST, sent as the plan routes are. RelationshipsSection gets the same call in its own shape.
  const warehouseId = settings?.warehouseId || '';
  const apiFetch = useMemo(() => {
    return makeApiPostText({ token: settings?.token, databricksHost: settings?.databricksHost });
  }, [settings?.token, settings?.databricksHost]);
  const [state, setState] = useState({ status: 'idle', error: '' });
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tablesKey = keyOf(tables);
  const together = useMemo(() => (a, b) => (groups || [tables]).some((g) => g.includes(a) && g.includes(b)), [groups, tables]);

  useEffect(() => {
    if (tables.length < 2) { setState({ status: 'idle', error: '' }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading', error: '' });
    apiFetch(`/api/relationships?warehouse_id=${encodeURIComponent(warehouseId || '')}`, {
      method: 'POST', body: JSON.stringify({ tables, inspire_database: inspireDatabase || undefined }),
    }).then((d) => {
      if (cancelled) return;
      const found = (d.suggestions || []).filter((s) => together(s.from.table, s.to.table));
      setJoins((prev) => ({ joins: mergeSuggestions(prev.joins, found) }));
      setState({ status: 'done', error: '' });
    }).catch((e) => { if (!cancelled) setState({ status: 'error', error: e.message || 'The joins could not be read.' }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, warehouseId, inspireDatabase, attempt, apiFetch]);

  if (tables.length < 2) return null;
  const inScope = joinsInScope(joins, tables);
  const kept = inScope.filter((j) => !j.removed);
  const removed = inScope.filter((j) => j.removed);
  const put = (fn) => setJoins((prev) => ({ joins: fn(prev.joins || []) }));
  // RelationshipsSection hands back the list it wants kept: a link it no longer holds is removed (a person's own is dropped, a suggestion is flagged);
  // a link it adds that the person took out before is restored.
  const onRelationships = (list) => put((all) => {
    const out = [];
    for (const j of all) {
      const inList = list.some((l) => sameLink(l, j));
      if (!joinsInScope([j], tables).length) out.push(j);
      else if (j.removed) out.push(inList ? { from: j.from, to: j.to, source: j.source } : j);
      else if (inList) out.push(j);
      else if (j.source !== 'person') out.push({ ...j, removed: true });
    }
    for (const l of list) if (!out.some((j) => sameLink(j, l))) out.push({ from: l.from, to: l.to, source: l.source });
    return out;
  });
  const restore = (j) => put((all) => all.map((x) => (x === j ? { from: j.from, to: j.to, source: j.source } : x)));

  return (
    <section data-wiz-joins="" aria-labelledby="wiz-joins-title" className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h4 id="wiz-joins-title" className="text-sm font-bold text-text-primary">How your tables join</h4>
        <p className="mt-1 text-xs text-text-secondary">Inspire suggests joins by column name and declared keys. Remove the ones that are wrong, or add your own.</p>
      </div>
      {state.status === 'loading' && <p data-wiz-joins-loading="" role="status" className="text-xs text-text-secondary">Looking for joins between your tables</p>}
      {state.status === 'error' && (
        <div role="alert" className="text-xs text-error-fg">
          <PlainMessage as="span" text={state.error} />{' '}
          <button type="button" className="font-semibold underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}
      {state.status === 'done' && kept.length === 0 && <p data-wiz-joins-none="" className="text-xs text-text-secondary">No joins suggested. Add one if your tables join.</p>}
      {removed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-text-secondary">Removed ({removed.length})</p>
          <ul aria-label="Removed joins" className="grid gap-1">
            {removed.map((j) => (
              <li key={joinText(j)} data-wiz-join-removed={joinText(j)} className="flex min-w-0 items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 text-xs">
                <span className="min-w-0 truncate font-mono text-text-secondary line-through" title={joinText(j)}>{joinText(j)}</span>
                <button type="button" aria-label={`Restore join ${joinText(j)}`} onClick={() => restore(j)} className="ms-auto inline-flex items-center gap-1 font-semibold text-primary-fg hover:underline">
                  <Undo2 size={14} aria-hidden /> Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" data-wiz-join-add="" aria-expanded={adding} className={BUTTON} onClick={() => setAdding((v) => !v)}>
        {adding ? 'Done adding' : 'Add a join'}
      </button>
      {(adding || kept.length > 0) && (
        <div data-wiz-joins-list="">
          {adding
            ? <RelationshipsSection tables={tables} relationships={kept} onRelationships={onRelationships} apiFetch={apiFetch} warehouseId={warehouseId} />
            : (
              <ul aria-label="Joins kept" className="grid gap-2">
                {kept.map((j) => (
                  <li key={joinText(j)} data-wiz-join={joinText(j)} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-mono text-text-primary" title={joinText(j)}>{joinText(j)}</span>
                    <span className="ms-auto text-text-secondary">{j.source === 'person' ? 'added by you' : j.source}</span>
                    <button type="button" aria-label={`Remove join ${joinText(j)}`} onClick={() => onRelationships(kept.filter((x) => x !== j))} className="text-text-tertiary hover:text-db-red-fg"><X size={14} aria-hidden /></button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </section>
  );
}
