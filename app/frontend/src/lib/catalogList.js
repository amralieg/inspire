import { counted } from './plural.js';

export const CATALOG_SEARCH_FROM = 50;

const nameOf = (c) => (typeof c === 'string' ? c : c && typeof c.name === 'string' ? c.name : '');

export function catalogNames(catalogs) {
  return (Array.isArray(catalogs) ? catalogs : []).map(nameOf).filter(Boolean);
}

export function catalogListed(catalogs, name) {
  const wanted = String(name || '').trim().toLowerCase();
  return Boolean(wanted) && catalogNames(catalogs).some((n) => n.toLowerCase() === wanted);
}

export function catalogListNote(catalogs, truncated, typed = '') {
  const count = catalogNames(catalogs).length;
  const name = String(typed || '').trim();
  if (name && !catalogListed(catalogs, name)) {
    return truncated
      ? `${name} is not among the first ${count.toLocaleString('en-US')} catalogs Inspire listed; Inspire checks it with Unity Catalog when it reads its schemas`
      : `No catalog named ${name} is among the ${count.toLocaleString('en-US')} you can see`;
  }
  return truncated ? `Inspire listed the first ${count.toLocaleString('en-US')} catalogs you can see; type the name of one that is not listed` : '';
}

export function typedCatalog(catalogs, truncated, typed) {
  const name = String(typed || '').trim();
  return truncated && name && !/[\s.`]/.test(name) && !catalogListed(catalogs, name) ? { name, typed: true } : null;
}

const under = (parent) => (name) => String(name).startsWith(`${parent}.`);

// What 01_uc_metadata reads. A table the person picked is read alone, whatever chips above it are still on. A schema or
// catalog is read whole only when no table under it was picked. Tables with no picked parent are still read.
export function pickedScope(catalogs = [], schemas = [], tables = [], whole = catalogs) {
  const scope = { entries: [], catalogs: [], schemas: [], tables: [] };
  const add = (kind, names) => { scope[kind].push(...names); scope.entries.push(...names); };
  const placed = new Set();
  for (const catalog of catalogs) {
    const picked = schemas.filter(under(catalog));
    const named = tables.filter(under(catalog));
    named.forEach((t) => placed.add(t));
    if (!picked.length) {
      if (named.length) add('tables', named);
      else if (whole.includes(catalog)) add('catalogs', [catalog]);
      continue;
    }
    for (const schema of picked) {
      const inSchema = tables.filter(under(schema));
      if (inSchema.length) { inSchema.forEach((t) => placed.add(t)); add('tables', inSchema); }
      else add('schemas', [schema]);
    }
  }
  const orphans = tables.filter((t) => !placed.has(t));
  if (orphans.length) add('tables', orphans);
  return scope;
}

// A catalog is whole only while no schema or table under it is picked: a picked child is what the person chose, so the catalog
// stops being whole (REQ-388). It stays listed, so its schemas still show. Every change to the picked schemas or tables passes
// through this, so the form, the draft and a saved profile all carry the same wholeCatalogs.
export function wholeCatalogsWithoutPicks(whole, schemas, tables) {
  return whole.filter((c) => ![...schemas, ...tables].some(under(c)));
}

export function scopeSummary(scope) {
  return [
    scope.tables.length && counted(scope.tables.length, 'table'),
    scope.schemas.length && counted(scope.schemas.length, 'schema'),
    scope.catalogs.length && counted(scope.catalogs.length, 'catalog'),
  ].filter(Boolean).join(', ');
}

// REQ-420: the catalogs a draft or profile holds (a catalog, or the catalog of a schema or table) that the App's own grants no longer list.
export function droppedCatalogNames(catalogs, held) {
  const listed = new Set(catalogNames(catalogs).map((n) => n.toLowerCase()));
  return [...new Set((held || []).map((name) => String(name).split('.')[0]).filter((c) => c && !listed.has(c.toLowerCase())))];
}
