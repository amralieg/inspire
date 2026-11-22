// REQ-427: per use case, which assets Inspire built (App, Dashboard, Lakebase, Genie), read from the tracking table (__inspire_implement)
// as the App. REQ-459: no DBU figure and no billing read.
const I = require('./inspireImplement');

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

module.exports = { assetFlagsOf, assetFlagsView };
