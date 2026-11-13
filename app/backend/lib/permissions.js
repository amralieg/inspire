const I = require('./inspireImplement');

function permissionRequired({ statements, instructions, principal = '', why = '' } = {}) {
  const list = [...new Set((Array.isArray(statements) ? statements : []).map((s) => String(s || '').trim()).filter(Boolean))];
  const lines = [...new Set((Array.isArray(instructions) ? instructions : []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!list.length && !lines.length) return null;
  return { statements: list, instructions: lines, principal: String(principal || ''), why: String(why || '') };
}

function folderPermission(folder, principal) {
  const path = String(folder || '').trim();
  const who = String(principal || '').trim();
  if (!path || !who) return null;
  return permissionRequired({
    instructions: [
      `In Workspace, open ${path} > Share, add ${who} with Can Edit`,
      `databricks workspace get-status ${path}  (note its object_id)`,
      `databricks api patch /api/2.0/permissions/directories/<object_id> --json '{"access_control_list":[{"service_principal_name":"${who}","permission_level":"CAN_EDIT"}]}'`,
    ],
    principal: who,
    why: `The run writes its files to ${path}, and the App cannot write there yet.`,
  });
}

function readStatements(name, principal) {
  const who = String(principal || '').trim();
  const parts = String(name || '').replace(/`/g, '').split('.');
  if (!who || parts.length < 1 || parts.length > 3 || parts.some((p) => !p)) return [];
  const [catalog, schema, table] = parts;
  const grants = [`GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${who}\``];
  if (schema) grants.push(`GRANT USE SCHEMA ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``);
  if (table) grants.push(`GRANT SELECT ON TABLE \`${catalog}\`.\`${schema}\`.\`${table}\` TO \`${who}\``);
  return [...new Set(grants)];
}

function readStatementsFor(names, principal) {
  return [...new Set((names || []).flatMap((n) => readStatements(n, principal)))];
}

function appReadStatements(table, appId) {
  return readStatements(table, appId);
}

function appReadPermissions(found, appId) {
  const warnings = [];
  const permissions = [];
  if (found.app_unreadable) {
    const offer = found.app_unreadable;
    const names = offer.tables.map((t) => t.table || t).join(', ');
    const principal = offer.app.id || appId;
    const permission = permissionRequired({ statements: readStatementsFor(offer.tables.map((t) => t.table || t), principal), principal: offer.app.name || principal,
      why: `Discover reads ${names} as the App, and the App cannot read ${offer.tables.length === 1 ? 'it' : 'them'} yet.` });
    if (permission) permissions.push(permission);
    else warnings.push(I.discoverUnreadText(offer));
  }
  if (found.missing && found.missing.length) {
    const names = found.missing.map((m) => m.table).join(', ');
    const statements = found.missing.flatMap((m) => appReadStatements(m.table, appId));
    const permission = permissionRequired({ statements, principal: appId,
      why: `Discover reads ${names} as the App, and the App cannot read ${found.missing.length === 1 ? 'it' : 'them'} yet.` });
    if (permission) permissions.push(permission);
    else warnings.push(`Discover runs as the App, and the App cannot read ${found.missing.map((m) => `${m.table} (${m.reason})`).join(', ')}`);
  }
  return { warnings, permissions };
}

function sampleCopyPermission(failed, principal) {
  const sources = (failed || []).map((f) => f.source);
  return permissionRequired({ statements: readStatementsFor(sources, principal), principal,
    why: `Copying ${sources.join(', ')} reads them with your own access, and you cannot read ${sources.length === 1 ? 'it' : 'them'} yet.` });
}

function builderPermission(catalog, builderGrant, builder) {
  return permissionRequired({ statements: [...readStatements(catalog, builder), builderGrant], principal: builder,
    why: `The identity Inspire builds as cannot write to this schema yet. Its owner grants it:` });
}

module.exports = { folderPermission, permissionRequired, readStatements, readStatementsFor, appReadStatements, appReadPermissions, sampleCopyPermission, builderPermission };
