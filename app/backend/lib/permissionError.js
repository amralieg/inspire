const { readStatements, readStatementsFor, permissionRequired } = require('./permissions');
const RP = require('./routePolicy');

const DENIED = /\bPERMISSION_DENIED\b|\bINSUFFICIENT_PERMISSIONS\b|\bUser does not have\b|\bInsufficient privileges\b/i;
const OBJECT_ON = /\bon\s+(catalog|schema|table|volume)\s+[`'"]?([A-Za-z0-9_.\-`]+)[`'"]?/i;

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
  const denied = deniedObjectOf(message);
  const who = String(principal || '').trim();
  if (!denied || !who) return null;
  let statements;
  if (denied.kind === 'schema') {
    const [catalog, schema] = denied.name.split('.');
    statements = [
      `GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${who}\``,
      `GRANT USE SCHEMA ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``,
      `GRANT SELECT ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${who}\``,
    ];
  } else if (denied.kind === 'catalog') {
    statements = readStatements(denied.name, who);
  } else {
    statements = readStatementsFor([denied.name], who);
  }
  return permissionRequired({ statements, principal: who,
    why: 'Inspire reads this with your own access. Ask your workspace admin to run these commands, then click Try again.' });
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

function sendFailure(res, code, message, extra) {
  return res.status(code).json({ ...(extra || {}), ...failureBody(res, message) });
}

module.exports = { deniedObjectOf, permissionFor, errorPermission, failureBody, sendFailure };
