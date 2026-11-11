/**
 * Inspire's own App service principal application ID, for UC / warehouse grants. Only the client id Inspire runs with is used;
 * principals are never looked up by display name.
 */

function ownServicePrincipalId(env = process.env) {
  return String(env.DATABRICKS_CLIENT_ID || env.SP_CLIENT_ID || '').trim();
}

function resolveInspireAppServicePrincipalId(explicitId) {
  return String(explicitId || ownServicePrincipalId() || '').trim() || null;
}

module.exports = {
  ownServicePrincipalId,
  resolveInspireAppServicePrincipalId,
};
