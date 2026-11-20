const { readStatements, readStatementsFor, permissionRequired } = require('./permissions');
const RP = require('./routePolicy');

const DENIED = /\bPERMISSION_DENIED\b|\bINSUFFICIENT_PERMISSIONS\b|\bUser does not have\b|\bInsufficient privileges\b|\bCAN[ _]USE\b[^.\n]{0,60}\bwarehouse\b/i;
const OBJECT_ON = /\bon\s+(catalog|schema|table|volume)\s+[`'"]?([A-Za-z0-9_.\-`]+)[`'"]?/i;
// The privilege the warehouse named before "on <object>" (User does not have CREATE SCHEMA on Catalog main). Only the write privileges that
// need their own GRANT are named here; a read privilege keeps the read set (USE CATALOG, USE SCHEMA, SELECT).
const NAMED_PRIVILEGE = /\bdoes not have\s+(?:permission\s+)?(CREATE SCHEMA|CREATE TABLE|MODIFY)\s+on\s+/i;
const WAREHOUSE_CAN_USE = /\bCAN[ _]USE\b[^.\n]{0,60}\bwarehouse\s+[`'"]?([A-Za-z0-9-]+)[`'"]?/i;

// A refusal on a SQL warehouse (Can Use) is not a SQL GRANT: the admin sets it on the warehouse, so the payload carries steps to copy.
function warehouseDeniedOf(message) {
  const hit = WAREHOUSE_CAN_USE.exec(String(message || ''));
  return hit ? hit[1] : null;
}

function deniedObjectOf(message) {
  const text = String(message || '');
  if (!DENIED.test(text)) return null;
  const hit = OBJECT_ON.exec(text);
  if (!hit) return null;
  const kind = hit[1].toLowerCase();
  const name = hit[2].replace(/`/g, '').replace(/\.$/, '');
  if (kind === 'volume') return null;
  return { kind, name };
}

function permissionFor(message, principal) {
  const who = String(principal || '').trim();
  if (!who) return null;
  const warehouse = warehouseDeniedOf(message);
  if (warehouse) {
    return permissionRequired({ steps: [`In SQL Warehouses, open ${warehouse} > Permissions, add ${who} with Can Use`], principal: who,
      why: `Inspire runs its queries on SQL warehouse ${warehouse} as the App, and the App cannot use it yet.` });
  }
  const denied = deniedObjectOf(message);
  if (!denied) return null;
  const named = NAMED_PRIVILEGE.exec(String(message || ''));
  let statements;
  if (named && denied.kind === 'catalog' && /^CREATE SCHEMA$/i.test(named[1])) {
    statements = [`GRANT CREATE SCHEMA ON CATALOG \`${denied.name}\` TO \`${who}\``]; // PERMISSION_DIALOG
  } else if (named && denied.kind === 'schema' && /^CREATE TABLE$/i.test(named[1])) {
    const [catalog, schema] = denied.name.split('.');
    statements = [`GRANT CREATE TABLE ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``]; // PERMISSION_DIALOG
  } else if (named && denied.kind === 'table' && /^MODIFY$/i.test(named[1])) {
    statements = [`GRANT MODIFY ON TABLE ${denied.name.split('.').map((p) => `\`${p}\``).join('.')} TO \`${who}\``]; // PERMISSION_DIALOG
  } else if (denied.kind === 'schema') {
    const [catalog, schema] = denied.name.split('.');
    // PERMISSION_DIALOG: these statements go to the Permission Required dialog, which copies them (REQ-131, REQ-260)
    statements = [
      `GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${who}\``, // PERMISSION_DIALOG
      `GRANT USE SCHEMA ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``, // PERMISSION_DIALOG
      `GRANT SELECT ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``, // PERMISSION_DIALOG
    ];
  } else if (denied.kind === 'catalog') {
    statements = readStatements(denied.name, who);
  } else {
    statements = readStatementsFor([denied.name], who);
  }
  return permissionRequired({ statements, principal: who,
    why: 'Inspire reads this with your own access.' });
}

// The one principal rule for every failure response: the App for App-identity routes, otherwise the signed-in person.
function errorPermission(req, message) {
  const r = req || {};
  const appId = String(process.env.DATABRICKS_CLIENT_ID || '').trim();
  const identity = r.policyKey ? RP.identityFor(r.policyKey, r, '') : 'person';
  const principal = identity === 'app' ? appId : (RP.forwardedPerson(r.headers || {}) || appId);
  return permissionFor(message, principal);
}

// Body for a failed response. Carries structured grants only when the message is a permission refusal.
function failureBody(res, message) {
  const permission = errorPermission((res && res.req) || {}, message);
  return { error: message, ...(permission ? { permissions: [permission] } : {}) };
}

// One rule for every route that reads data: a warehouse or Unity Catalog refusal is HTTP 403 with the Permission Required payload,
// whatever status the route would have given a failure. A route never answers a denial with a 500 (REQ-314).
const CODED_DENIAL = new Set(['PERMISSION_DENIED', 'INSUFFICIENT_PERMISSIONS']);
function accessDenied(failure) {
  if (failure && typeof failure === 'object') {
    if (CODED_DENIAL.has(failure.error_code) || failure.http_status === 403) return true;
    if (failure.denial && accessDenied(failure.denial)) return true;
    return DENIED.test(String(failure.message || ''));
  }
  return DENIED.test(String(failure || ''));
}

// The status a failed route answers with: 403 for an access denial, otherwise the error's own status or 500.
function failureStatus(err, fallback = 500) {
  if (accessDenied(err)) return 403;
  return err && Number.isFinite(err.statusCode) ? err.statusCode : fallback;
}

// Body for a failed response. Carries structured grants only when the message (or the warehouse's own refusal text, when a route words
// its refusal in plain text) is a permission refusal.
function failureBody(res, message, denial) {
  const permission = errorPermission((res && res.req) || {}, denial || message);
  return { error: message, ...(permission ? { permissions: [permission] } : {}) };
}

function sendFailure(res, code, message, extra, denial) {
  const status = accessDenied(denial || message) ? 403 : code;
  return res.status(status).json({ ...(extra || {}), ...failureBody(res, message, denial) });
}

module.exports = { deniedObjectOf, permissionFor, errorPermission, failureBody, sendFailure, accessDenied, failureStatus };
