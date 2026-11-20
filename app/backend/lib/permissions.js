const { IMPLEMENT_READ_NEEDS, IMPLEMENT_SOURCE_NEEDS } = require('./implementNeeds');
const { coarseGrants } = require('./grantScope');

// AUTO-4: `steps` are the commands and Share steps an admin copies on their own (Copy steps); `instructions` are plain notes, shown once.
// REQ-408: every dialog payload passes here, so the read grants are asked at schema level (catalog level for a whole-catalog pick).
// `exact` keeps the table-level statements: a user-authorization App's viewers get its views only, and a schema grant would open the
// source tables that share the schema.
function permissionRequired({ statements, instructions, steps, principal = '', why = '', wholeCatalogs = [], exact = false } = {}) {
  const named = (Array.isArray(statements) ? statements : []).map((s) => String(s || '').trim()).filter(Boolean);
  const list = [...new Set(exact ? named : coarseGrants(named, { wholeCatalogs }))];
  const lines = [...new Set((Array.isArray(instructions) ? instructions : []).map((s) => String(s || '').trim()).filter(Boolean))];
  const copy = [...new Set((Array.isArray(steps) ? steps : []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!list.length && !lines.length && !copy.length) return null;
  return { statements: list, instructions: lines, steps: copy, principal: String(principal || ''), why: String(why || '') };
}

function folderPermission(folder, principal) {
  const path = String(folder || '').trim();
  const who = String(principal || '').trim();
  if (!path || !who) return null;
  return permissionRequired({
    steps: [
      `In Workspace, open ${path} > Share, add ${who} with Can Edit`,
      `databricks workspace get-status ${path}  (note its object_id)`,
      `databricks api patch /api/2.0/permissions/directories/<object_id> --json '{"access_control_list":[{"service_principal_name":"${who}","permission_level":"CAN_EDIT"}]}'`,
    ],
    principal: who,
    why: `The run writes its files to ${path}, and the App cannot write there yet.`,
  });
}

// One derivation for every read dialog: each privilege of `needs` (IMPLEMENT_READ_NEEDS for a person's reads, IMPLEMENT_SOURCE_NEEDS for
// the App's source check, which adds READ METADATA) is named on the object it is granted on. A dialog never keeps its own list.
function readStatements(name, principal, needs = IMPLEMENT_READ_NEEDS) {
  const who = String(principal || '').trim();
  const parts = String(name || '').replace(/`/g, '').split('.');
  if (!who || parts.length < 1 || parts.length > 3 || parts.some((p) => !p)) return [];
  const [catalog, schema, table] = parts;
  const objects = { catalog: [catalog], schema: schema && [catalog, schema], table: table && [catalog, schema, table] };
  // PERMISSION_DIALOG: these statements go to the Permission Required dialog, which copies them (REQ-131, REQ-260)
  return [...new Set(needs.filter(([, level]) => objects[level]).map(([privilege, level]) => (
    `GRANT ${privilege} ON ${level.toUpperCase()} ${objects[level].map((p) => `\`${p}\``).join('.')} TO \`${who}\``)))]; // PERMISSION_DIALOG
}

function readStatementsFor(names, principal) {
  return [...new Set((names || []).flatMap((n) => readStatements(n, principal)))];
}

function appReadStatements(table, appId) {
  return readStatements(table, appId, IMPLEMENT_SOURCE_NEEDS);
}

function appReadPermissions(found, appId, { wholeCatalogs = [] } = {}) {
  const warnings = [];
  const permissions = [];
  if (found.app_unreadable) {
    const offer = found.app_unreadable;
    const names = offer.tables.map((t) => t.table || t).join(', ');
    const principal = offer.app.id || appId;
    // The grants the App's plan still lacks (the same plan its check and the Grant button run on), refusal included: one list, no second one.
    const permission = permissionRequired({ statements: offer.grants, principal: offer.app.name || principal,
      why: `Discover reads ${names} as the App, and the App cannot read ${offer.tables.length === 1 ? 'it' : 'them'} yet.`, wholeCatalogs });
    if (permission) permissions.push(permission);
    else warnings.push(require('./inspireImplement').discoverUnreadText(offer)); // lazy: inspireImplement requires this module at load
  }
  if (found.missing && found.missing.length) {
    const names = found.missing.map((m) => m.table).join(', ');
    const statements = found.missing.flatMap((m) => appReadStatements(m.table, appId));
    const permission = permissionRequired({ statements, principal: appId,
      why: `Discover reads ${names} as the App, and the App cannot read ${found.missing.length === 1 ? 'it' : 'them'} yet.`, wholeCatalogs });
    if (permission) permissions.push(permission);
    else warnings.push(`Discover runs as the App, and the App cannot read ${found.missing.map((m) => `${m.table} (${m.reason})`).join(', ')}`);
  }
  return { warnings, permissions };
}

function sampleCopyPermission(failed, principal) {
  const sources = (failed || []).map((f) => f.source);
  return permissionRequired({ statements: readStatementsFor(sources, principal), principal,
    why: `Copying ${sources.join(', ')} reads them as the App, and the App cannot read ${sources.length === 1 ? 'it' : 'them'} yet.` });
}

function builderPermission(catalog, builderGrant, builder) {
  return permissionRequired({ statements: [...readStatements(catalog, builder), builderGrant], principal: builder,
    why: `The identity Inspire builds as cannot write to this schema yet. Your data owner grants it:` });
}

module.exports = { folderPermission, permissionRequired, readStatements, readStatementsFor, appReadStatements, appReadPermissions, sampleCopyPermission,
  builderPermission };
