const LOCAL_HINT = 'Check DATABRICKS_HOST in .env (no trailing slash), VPN/network, and run: npm run verify:databricks';
const APP_HINT = 'The workspace did not answer. Try again in a minute; if it keeps happening, ask a workspace admin to check that this App can reach the workspace.';

function unreachableMessage(host, err, deployed) {
  const cause = err?.cause?.message || err?.cause?.code || '';
  const what = `${err?.message || 'no answer'}${cause ? `; ${cause}` : ''}`;
  return deployed ? `Cannot reach the Databricks workspace (${what}). ${APP_HINT}` : `Cannot reach Databricks at ${host} (${what}). ${LOCAL_HINT}`;
}

module.exports = { unreachableMessage };
