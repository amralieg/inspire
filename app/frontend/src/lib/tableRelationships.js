// The joins the person draws between picked tables on the Launch page (REQ-373). The run reads them as one widget, 18_table_relationships:
// a JSON list of { from: { table, column }, to: { table, column } }, where `from` is the foreign-key side. The agent notebook uses these
// joins before any declared key or name match, and reads each linked group of tables as one joined dataset.
import { scopeKeyOf } from './tableScope.js';

const text = (v) => (v == null ? '' : String(v).trim());

// A side names a catalog.schema.table and one column of it. Anything else is not a join the run can use.
function sideOf(value) {
  if (!value || typeof value !== 'object') return null;
  const table = text(value.table).replace(/`/g, '');
  const column = text(value.column);
  const parts = table.split('.').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  if (!column) return null;
  return { table: parts.join('.'), column };
}

/** One relationship as the run reads it, or null when either side is not a table and column. A removed one keeps `removed: true`. */
export function normalizeRelationship(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const from = sideOf(entry.from);
  const to = sideOf(entry.to);
  // REQ-584: a suggestion the person removed travels as `removed: true`; no flag (or removed:false) is a plain join, as before.
  return from && to ? { from, to, ...(entry.removed === true ? { removed: true } : {}) } : null;
}

const relationKey = (r) => scopeKeyOf(`${r.from.table}.${r.from.column}>${r.to.table}.${r.to.column}`);

/**
 * Parses the widget text or a parsed list. Returns { relations, problems }: the valid relationships, de-duplicated, and one problem
 * per entry that is not a join (the backend refuses the launch with them).
 */
export function relationshipsFromObject(value) {
  if (value == null) return { relations: [], problems: [] };
  if (!Array.isArray(value)) return { relations: [], problems: ['The relationships must be a list.'] };
  const relations = [];
  const problems = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const relation = normalizeRelationship(entry);
    if (!relation) {
      problems.push(`Relationship ${index + 1} needs a catalog.schema.table name and a column on each side.`);
      return;
    }
    const key = relationKey(relation);
    if (seen.has(key)) return;
    seen.add(key);
    relations.push(relation);
  });
  return { relations, problems };
}

/**
 * The 18_table_relationships text a launch sends: only the joins whose both tables the run reads (pickedTables, the tables the run
 * reads, as launchTableScopeText picks them). Empty text when no join applies, so the notebook gets no widget value.
 */
export function launchRelationshipsText(relationships, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const kept = [];
  const seen = new Set();
  for (const entry of Array.isArray(relationships) ? relationships : []) {
    const relation = normalizeRelationship(entry);
    if (!relation) continue;
    if (!picked.has(scopeKeyOf(relation.from.table)) || !picked.has(scopeKeyOf(relation.to.table))) continue;
    const key = relationKey(relation);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(relation);
  }
  return kept.length ? JSON.stringify(kept) : '';
}

const sameSide = (a, b) => a.table === b.table && a.column === b.column;

/** Two links are one link when they join the same two columns, in either direction: A.col -> B.col is the same join as B.col -> A.col (REQ-394). */
export function sameLink(a, b) {
  return (sameSide(a.from, b.from) && sameSide(a.to, b.to)) || (sameSide(a.from, b.to) && sameSide(a.to, b.from));
}

/**
 * The links a saved draft or profile restores (REQ-362, REQ-394): each side names a table and a column, and the source says where the link
 * came from. A link already restored is not restored again, so a saved profile with both directions of one join loads one link.
 */
export function restoredRelationshipList(value) {
  const side = (v) => (v && typeof v === 'object' && typeof v.table === 'string' && typeof v.column === 'string' ? { table: v.table, column: v.column } : null);
  if (!Array.isArray(value)) return [];
  const kept = [];
  for (const l of value) {
    const entry = l && typeof l === 'object' && side(l.from) && side(l.to) && typeof l.source === 'string'
      ? { from: side(l.from), to: side(l.to), source: l.source }
      : null;
    if (entry && !kept.some((k) => sameLink(k, entry))) kept.push(entry);
  }
  return kept;
}
