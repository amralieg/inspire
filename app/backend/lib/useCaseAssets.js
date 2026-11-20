// REQ-427: per use case, which assets Inspire built (App, Dashboard, Lakebase, Genie) and the DBUs they consumed. Both read the tracking
// table (__inspire_implement) as the App. The flags come from the rows alone; the DBU total adds one read of system.billing.usage, on
// the ids and the use case name tag REQ-340 records (docs/usecase_billing_tags.md).
const I = require('./inspireImplement');

const NAME_TAG = 'dbx_inspire_ai_usecase_name';
const BILLING_TABLE = 'system.billing.usage';
const ID_COLUMNS = { job: 'usage_metadata.job_id', app: 'usage_metadata.app_id', warehouse: 'usage_metadata.warehouse_id',
  lakebase: 'usage_metadata.database_instance_id' };
const DBU_ID_LIMIT = 200;

const text = (value) => (value == null ? '' : String(value).trim());
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const stopped = (row, output) => plain(row.asset_status) && plain(row.asset_status[output]) && I.IMPLEMENT_STOPPED_STATES.includes(row.asset_status[output].state);

// What the live build of one use case holds. A deleted or released asset is not held.
function assetFlagsOf(rows) {
  const built = I.liveBuiltRow(rows);
  if (!built) return { app: false, dashboard: false, lakebase: false, genie: false };
  const app = I.liveAppOf(rows);
  return {
    app: Boolean((app && app.name) || I.hostedRecord(built)) && !stopped(built, 'app'),
    dashboard: text(built.dashboard_id) !== '' && !stopped(built, 'dashboard'),
    lakebase: text(built.lakebase_project_id) !== '',
    genie: text(built.genie_space_id) !== '' && !stopped(built, 'genie_space'),
  };
}

function rowsByUseCase(history) {
  const by = {};
  for (const row of history || []) (by[text(row.use_case_id)] || (by[text(row.use_case_id)] = [])).push(row);
  return by;
}

function assetFlagsView(history) {
  return Object.fromEntries(Object.entries(rowsByUseCase(history)).filter(([id]) => id).map(([id, rows]) => [id, assetFlagsOf(rows)]));
}

// Every billing id the builds of one use case recorded, over all its versions (an older build's job still consumed DBUs).
function billingIdsOf(rows) {
  const ids = { job: new Set(), app: new Set(), warehouse: new Set(), lakebase: new Set() };
  for (const row of rows) {
    const app = plain(row.asset_status) && plain(row.asset_status.app) ? text(row.asset_status.app.app_id) : '';
    for (const [kind, value] of [['job', row.job_id], ['app', app], ['warehouse', row.warehouse_id], ['lakebase', row.lakebase_project_id]]) {
      if (text(value)) ids[kind].add(text(value));
    }
  }
  return ids;
}

// One owner per billing id. A warehouse several use cases name is shared, so it has no owner (docs/usecase_billing_tags.md).
function billingOwners(history) {
  const by = rowsByUseCase(history);
  const owners = { job: {}, app: {}, warehouse: {}, lakebase: {} };
  const names = {};
  const claimed = {};
  for (const [useCase, rows] of Object.entries(by)) {
    if (!useCase) continue;
    const name = rows.map((r) => text(r.use_case_name_tag)).find(Boolean);
    if (name) names[name] = useCase;
    const ids = billingIdsOf(rows);
    for (const kind of Object.keys(ids)) {
      for (const id of ids[kind]) {
        const key = `${kind}:${id}`;
        (claimed[key] || (claimed[key] = new Set())).add(useCase);
        owners[kind][id] = useCase;
      }
    }
  }
  for (const [key, who] of Object.entries(claimed)) {
    const [kind, ...rest] = key.split(':');
    if (who.size > 1 && kind === 'warehouse') delete owners.warehouse[rest.join(':')];
  }
  return { owners, names, useCases: Object.keys(by).filter(Boolean) };
}

// null when nothing is recorded to look up: the cell then says so instead of a 0.
function dbuStatement(history) {
  const { owners, names } = billingOwners(history);
  const parameters = [];
  const bind = (value) => { const name = `p${parameters.length}`; parameters.push({ name, value, type: 'STRING' }); return `:${name}`; };
  const clauses = [];
  for (const kind of Object.keys(ID_COLUMNS)) {
    const ids = Object.keys(owners[kind]).slice(0, DBU_ID_LIMIT);
    if (ids.length) clauses.push(`CAST(${ID_COLUMNS[kind]} AS STRING) IN (${ids.map(bind).join(', ')})`);
  }
  const tagged = Object.keys(names).slice(0, DBU_ID_LIMIT);
  if (tagged.length) clauses.push(`custom_tags['${NAME_TAG}'] IN (${tagged.map(bind).join(', ')})`);
  if (!clauses.length) return null;
  return {
    sql: `SELECT custom_tags['${NAME_TAG}'] AS use_case_name, CAST(usage_metadata.job_id AS STRING) AS job_id, `
      + 'CAST(usage_metadata.app_id AS STRING) AS app_id, CAST(usage_metadata.warehouse_id AS STRING) AS warehouse_id, '
      + 'CAST(usage_metadata.database_instance_id AS STRING) AS lakebase_id, CAST(SUM(usage_quantity) AS DOUBLE) AS dbus '
      + `FROM ${BILLING_TABLE} WHERE usage_unit = 'DBU' AND (${clauses.join(' OR ')}) GROUP BY 1, 2, 3, 4, 5`,
    parameters,
  };
}

// Each billing group is counted once: for the use case that owns its id, else for the one its name tag names.
function dbuView(history, billingRows) {
  const { owners, names, useCases } = billingOwners(history);
  const totals = Object.fromEntries(useCases.map((id) => [id, null]));
  for (const row of billingRows || []) {
    const quantity = Number(row.dbus);
    if (!Number.isFinite(quantity)) continue;
    const byId = owners.job[text(row.job_id)] || owners.app[text(row.app_id)] || owners.warehouse[text(row.warehouse_id)] || owners.lakebase[text(row.lakebase_id)];
    const owner = byId || names[text(row.use_case_name)];
    if (owner) totals[owner] = (totals[owner] || 0) + quantity;
  }
  return totals;
}

function billingGrants(principal) {
  const who = text(principal);
  if (!who) return [];
  return [
    `GRANT USE CATALOG ON CATALOG \`system\` TO \`${who}\``, // PERMISSION_DIALOG
    `GRANT USE SCHEMA ON SCHEMA \`system\`.\`billing\` TO \`${who}\``, // PERMISSION_DIALOG
    `GRANT SELECT ON TABLE \`system\`.\`billing\`.\`usage\` TO \`${who}\``, // PERMISSION_DIALOG
  ];
}

module.exports = { assetFlagsOf, assetFlagsView, billingGrants, billingOwners, dbuStatement, dbuView, BILLING_TABLE };
