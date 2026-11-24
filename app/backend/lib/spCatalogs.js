// REQ-420 (D-SL-13): the catalogs Inspire offers come from what the App's own service principal can read right now (its live grants),
// never from the installer's pick (INSPIRE_DATA_CATALOGS only seeds the grants). A catalog the principal can see but cannot fully read
// (for example USE CATALOG without SELECT) is listed with the exact GRANT lines it is missing, for the Permission Required dialog.
const { listCatalogs } = require('./ucReads');
const { parseExactJson } = require('./exactJson');
const { permissionRequired, readStatements } = require('./permissions');

const UC = '/api/2.1/unity-catalog';
// What a catalog needs for the App to read its data. Each line below is asked at catalog level; the held privileges come from
// Unity Catalog's effective permissions of the principal, so a grant made higher up or by a group counts.
const CATALOG_READ = [['USE CATALOG', 'catalog'], ['SELECT', 'catalog'], ['READ METADATA', 'catalog']];

const key = (name) => String(name || '').replace(/`/g, '').trim().toLowerCase();

// The privileges held on one catalog, or null when Unity Catalog will not say (then the catalog is listed without a verdict).
async function heldOn(dbFetch, host, token, catalog, principal) {
  try {
    const resp = await dbFetch(host, token, `${UC}/effective-permissions/catalog/${encodeURIComponent(catalog)}?principal=${encodeURIComponent(principal)}`);
    if (!resp.ok) return null;
    const data = parseExactJson((await resp.text()) || '{}');
    const held = new Set();
    for (const entry of Array.isArray(data.privilege_assignments) ? data.privilege_assignments : []) {
      for (const item of Array.isArray(entry.privileges) ? entry.privileges : []) held.add(String(item.privilege || item).toUpperCase().replace(/\s+/g, '_'));
    }
    return held;
  } catch {
    return null;
  }
}

// Returns { names: Map(lowercase -> { name, missing: [GRANT lines] }) } for every catalog the principal sees, or null when the principal's
// catalogs cannot be listed (the caller then keeps the person's own list). `listed` is a listing the caller already read with this same
// token ({ items, truncated }); it is used as is, so the catalogs are not listed twice.
async function spGrantedCatalogs(dbFetch, host, token, principal, listed = null) {
  if (!token || !principal) return null;
  if (!listed) {
    try {
      listed = await listCatalogs(dbFetch, host, token);
    } catch {
      return null;
    }
  }
  const names = new Map();
  await Promise.all((listed.items || []).filter((c) => c && c.name && !String(c.name).startsWith('__')).map(async (c) => {
    const held = await heldOn(dbFetch, host, token, c.name, principal);
    const lacking = held ? CATALOG_READ.filter(([privilege]) => !held.has('ALL_PRIVILEGES') || privilege === 'READ METADATA')
      .filter(([privilege]) => !held.has(privilege.replace(/ /g, '_'))) : [];
    const missing = readStatements(c.name, principal, lacking);
    names.set(key(c.name), { name: c.name, missing });
  }));
  return { names, truncated: Boolean(listed.truncated) };
}

// The picker's catalogs: the ones the person sees and the principal can read, partial ones flagged with their missing GRANT lines.
function grantedCatalogList(personList, granted) {
  const catalogs = [];
  for (const c of personList) {
    const hit = granted.names.get(key(c.name));
    if (!hit) {
      if (granted.truncated) catalogs.push(c); // a cut listing proves nothing about a catalog it does not name
      continue;
    }
    catalogs.push(hit.missing.length ? { ...c, partial: { missing: hit.missing } } : c);
  }
  return catalogs;
}

// SEC-01 (W4): the picker's table rows. `readable(token, name)` is a LIMIT 0 read (tableProbeStatement). The person is probed on every listed
// table and the principal on the tables the person can read; a row is pickable when both can read it. Otherwise `request` says who must ask:
// 'person' (the person cannot read it) or 'inspire' (the principal cannot). Past `cap` tables the rows carry no verdict (nothing is hidden).
const PICKER_PROBE_CAP = 100;
async function pickableRows(rows, { readable, personToken, spToken, cap = PICKER_PROBE_CAP }) {
  if (!personToken) return rows;
  const checked = rows.slice(0, cap);
  const byName = new Map();
  await Promise.all(checked.map(async (row) => {
    const person = await readable(personToken, row.full_name);
    const sp = person && spToken ? await readable(spToken, row.full_name) : person;
    byName.set(row.full_name, person ? (sp ? { pickable: true } : { pickable: false, request: 'inspire' }) : { pickable: false, request: 'person' });
  }));
  return rows.map((row) => ({ ...row, ...(byName.get(row.full_name) || {}) }));
}

// The permission entry for the partial catalogs, one dialog payload.
function partialPermission(catalogs, principal) {
  const statements = catalogs.flatMap((c) => (c.partial ? c.partial.missing : []));
  return permissionRequired({ statements, principal, exact: true,
    why: 'The App can see these catalogs but cannot read all of what Inspire needs in them yet.' });
}

// The catalogs a run's scope names (a catalog, or the catalog of a schema or table) that the principal can no longer read.
// A cut listing proves nothing about a catalog it does not name, so it drops none.
function droppedCatalogs(scopeCatalogs, granted) {
  if (granted.truncated) return [];
  return [...new Set(scopeCatalogs.filter((name) => !granted.names.has(key(name))))];
}

module.exports = { spGrantedCatalogs, grantedCatalogList, partialPermission, droppedCatalogs, pickableRows };
