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
