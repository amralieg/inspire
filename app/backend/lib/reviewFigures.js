const { int64Id } = require('./int64Id');
const {
  IMPLEMENT_DONE_STATUSES,
  IMPLEMENT_OUTPUT_ID_COLUMNS,
  IMPLEMENT_STOPPED_STATES,
  IMPLEMENT_TABLE,
  IMPLEMENT_UNINSTALLED,
  isMissingColumnError,
} = require('./inspireImplement');

const SESSION_LIST_CAP = 20;
const SESSION_PREVIEW_CAP = 4;
const PORTFOLIO_RUN_CAP = 1000;
const PORTFOLIO_TABLES = ['__inspire_session', '__inspire_usecases', IMPLEMENT_TABLE];
const PORTFOLIO_ASSETS = [['apps', 'app'], ['dashboards', 'dashboard'], ['genie_spaces', 'genie_space'], ['alerts', 'alert']];
const RUN_FIGURES = ['use_cases', 'domains', 'subdomains', 'best_of_best', 'mvps_started', 'mvps_live', ...PORTFOLIO_ASSETS.map(([key]) => key)];
const SESSION_LIST_COLUMNS = ['session_id', 'processing_status', 'completed_percent', 'create_at', 'last_updated', 'completed_on', 'business_name',
  'inspire_database_name', 'operation_mode', 'generation_path', 'business_domains', 'catalogs'];

const HIGH_PRIORITY_MIN_SCORE = 7;
const BELOW_BAR_ELITE_STATUSES = ['FALLBACK_BELOW_BAR', 'DOMAIN_COVERAGE_PICK'];
const MEETS_BAR_SQL = `UPPER(TRIM(COALESCE(elite_status, ''))) NOT IN (${BELOW_BAR_ELITE_STATUSES.map((s) => `'${s}'`).join(', ')})`;
const HIGH_PRIORITY_SQL = `COALESCE(priority_score, 0) >= ${HIGH_PRIORITY_MIN_SCORE} AND ${MEETS_BAR_SQL}`;

const BUSINESS_KEY = "LOWER(TRIM(COALESCE(business_name, '')))";
const RUN_BUSINESS_KEY = `CASE WHEN ${BUSINESS_KEY} = '' THEN CONCAT('#', CAST(session_id AS STRING)) ELSE ${BUSINESS_KEY} END`;

function sessionListStatement(table, { lastUpdated = true, cap = SESSION_LIST_CAP } = {}) {
  const columns = SESSION_LIST_COLUMNS.map((name) => (name === 'last_updated' && !lastUpdated ? 'NULL AS last_updated' : name)).join(', ');
  const runTime = lastUpdated ? 'COALESCE(last_updated, completed_on, create_at)' : 'COALESCE(completed_on, create_at)';
  return {
    sql: `SELECT ${columns}, CAST(COUNT(*) OVER (PARTITION BY ${RUN_BUSINESS_KEY}) AS INT) AS business_runs, `
      + `CAST(ROW_NUMBER() OVER (PARTITION BY ${RUN_BUSINESS_KEY} ORDER BY ${runTime} DESC NULLS LAST, session_id DESC) AS INT) AS business_rank `
      + `FROM ${table} ORDER BY create_at DESC LIMIT ${cap + 1}`,
    parameters: null,
  };
}

function sessionListCap(all) {
  return all ? PORTFOLIO_RUN_CAP : SESSION_LIST_CAP;
}

const whole = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

function sessionPreviewStatement(table, sessionIds, { withTechnique = true } = {}) {
  const ids = sessionIds.filter((id) => /^\d+$/.test(String(id))).join(',');
  const label = withTechnique ? 'name_with_technique' : 'CAST(NULL AS STRING) AS name_with_technique';
  return {
    sql: 'SELECT session_id, Name, name_with_technique, rn FROM ('
      + `SELECT session_id, COALESCE(NULLIF(TRIM(use_case), ''), CONCAT('Use case ', CAST(id AS STRING))) AS Name, ${label}, `
      + 'ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY COALESCE(priority_score, 0) DESC, use_case) AS rn '
      + `FROM ${table} WHERE session_id IN (${ids})) z WHERE z.rn <= ${SESSION_PREVIEW_CAP} ORDER BY session_id, rn`,
    parameters: null,
  };
}

async function loadSessionPreviews(run, table, sessionIds) {
  let rows;
  try {
    rows = await run(sessionPreviewStatement(table, sessionIds));
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    rows = await run(sessionPreviewStatement(table, sessionIds, { withTechnique: false }));
  }
  const bySession = {};
  for (const row of rows) {
    const sid = int64Id(row.session_id);
    if (!sid) continue;
    const list = bySession[sid] || (bySession[sid] = []);
    if (row.Name && list.length < SESSION_PREVIEW_CAP) list.push({ Name: String(row.Name), name_with_technique: row.name_with_technique ? String(row.name_with_technique) : null });
  }
  return bySession;
}

async function loadSessionList(run, table, cap = SESSION_LIST_CAP) {
  let rows;
  try {
    rows = await run(sessionListStatement(table, { cap }));
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    rows = await run(sessionListStatement(table, { lastUpdated: false, cap }));
  }
  return {
    sessions: rows.slice(0, cap).map((row) => ({ ...row, business_runs: whole(row.business_runs), business_rank: whole(row.business_rank) })),
    truncated: rows.length > cap,
  };
}

const runKeys = 'CAST(session_id AS STRING) AS sid, CAST(grouping(session_id) AS INT) AS is_total';
const rollup = `GROUP BY ROLLUP (session_id) ORDER BY is_total DESC, sid DESC LIMIT ${PORTFOLIO_RUN_CAP + 2}`;

function portfolioSessionStatement(table) {
  return {
    sql: `SELECT CAST(COUNT(*) AS INT) AS runs, CAST(COUNT(DISTINCT NULLIF(${BUSINESS_KEY}, '')) AS INT) AS businesses FROM ${table}`,
    parameters: null,
  };
}

function portfolioUseCaseStatement(table, existing = null) {
  const starred = !existing || existing.has('best_of_best');
  return {
    sql: `SELECT ${runKeys}, CAST(COUNT(*) AS INT) AS use_cases, `
      + "CAST(COUNT(DISTINCT NULLIF(TRIM(business_domain), '')) AS INT) AS domains, "
      + "CAST(COUNT(DISTINCT NULLIF(TRIM(subdomain), '')) AS INT) AS subdomains, "
      + `CAST(${starred ? 'COALESCE(SUM(CASE WHEN UPPER(TRIM(best_of_best)) = :starred THEN 1 ELSE 0 END), 0)' : '0'} AS INT) AS best_of_best `
      + `FROM ${table} ${rollup}`,
    parameters: starred ? [{ name: 'starred', value: 'Y', type: 'STRING' }] : null,
  };
}

function portfolioImplementStatement(table, existing = null) {
  const has = (name) => !existing || existing.has(name);
  const column = (name) => (has(name) ? `\`${name}\`` : 'NULL');
  const status = (name) => (has('asset_status') ? `get_json_object(to_json(\`asset_status\`), '$.${name}')` : 'NULL');
  const done = IMPLEMENT_DONE_STATUSES.map((_, i) => `:done${i}`).join(', ');
  const stopped = IMPLEMENT_STOPPED_STATES.map((_, i) => `:stop${i}`).join(', ');
  const builtKey = `CASE WHEN \`status\` IN (${done}, :gone) THEN \`spec_version\` END`;
  const assetId = (output) => (output === 'app'
    ? `COALESCE(NULLIF(TRIM(${column('app_name')}), ''), CONCAT('inspire:', ${status('app.hosted.id')}))`
    : `NULLIF(TRIM(${column(IMPLEMENT_OUTPUT_ID_COLUMNS[output])}), '')`);
  const builtAsset = ([, output]) => `max_by(CASE WHEN COALESCE(${status(`${output}.state`)}, '') IN (${stopped}) THEN NULL ELSE ${assetId(output)} END, `
    + `${builtKey}) AS ${output}`;
  const counted = ([key, output]) => `CAST(COUNT(DISTINCT CASE WHEN built_status IN (${done}) THEN ${output} END) AS INT) AS ${key}`;
  return {
    sql: `WITH mvp AS (SELECT \`session_id\` AS session_id, max_by(\`status\`, \`spec_version\`) AS latest_status, `
      + `max_by(\`status\`, ${builtKey}) AS built_status, ${PORTFOLIO_ASSETS.map(builtAsset).join(', ')} `
      + `FROM ${table} GROUP BY \`session_id\`, \`use_case_id\`) `
      + `SELECT ${runKeys}, `
      + "CAST(SUM(CASE WHEN COALESCE(latest_status, '') NOT IN ('', :gone) THEN 1 ELSE 0 END) AS INT) AS mvps_started, "
      + `CAST(SUM(CASE WHEN latest_status IN (${done}) THEN 1 ELSE 0 END) AS INT) AS mvps_live, `
      + `${PORTFOLIO_ASSETS.map(counted).join(', ')} FROM mvp ${rollup}`,
    parameters: [
      ...IMPLEMENT_DONE_STATUSES.map((value, i) => ({ name: `done${i}`, value, type: 'STRING' })),
      { name: 'gone', value: IMPLEMENT_UNINSTALLED, type: 'STRING' },
      ...IMPLEMENT_STOPPED_STATES.map((value, i) => ({ name: `stop${i}`, value, type: 'STRING' })),
    ],
  };
}

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const noFigures = () => Object.fromEntries([...RUN_FIGURES, 'live_assets'].map((key) => [key, 0]));
const liveAssets = (figures) => PORTFOLIO_ASSETS.reduce((sum, [key]) => sum + figures[key], 0);

function portfolioView({ runs = null, useCases = [], mvps = [], missing = [] } = {}) {
  const totals = { businesses: count(runs && runs.businesses), runs: count(runs && runs.runs), ...noFigures() };
  const sessions = {};
  let truncated = false;
  const fold = (rows, keys) => {
    let listed = 0;
    for (const row of rows || []) {
      if (count(row.is_total) === 1) {
        for (const key of keys) totals[key] = count(row[key]);
        continue;
      }
      const sid = int64Id(row.sid);
      if (!sid) continue;
      listed += 1;
      if (listed > PORTFOLIO_RUN_CAP) {
        truncated = true;
        continue;
      }
      if (!sessions[sid]) sessions[sid] = noFigures();
      for (const key of keys) sessions[sid][key] = count(row[key]);
    }
  };
  fold(useCases, RUN_FIGURES.slice(0, 4));
  fold(mvps, RUN_FIGURES.slice(4));
  totals.live_assets = liveAssets(totals);
  for (const figures of Object.values(sessions)) figures.live_assets = liveAssets(figures);
  return { totals, sessions, truncated, missing: PORTFOLIO_TABLES.filter((name) => (missing || []).includes(name)) };
}

module.exports = {
  HIGH_PRIORITY_MIN_SCORE,
  BELOW_BAR_ELITE_STATUSES,
  HIGH_PRIORITY_SQL,
  MEETS_BAR_SQL,
  SESSION_LIST_CAP,
  PORTFOLIO_RUN_CAP,
  PORTFOLIO_TABLES,
  PORTFOLIO_ASSETS,
  RUN_FIGURES,
  sessionListStatement,
  sessionListCap,
  loadSessionList,
  sessionPreviewStatement,
  loadSessionPreviews,
  portfolioSessionStatement,
  portfolioUseCaseStatement,
  portfolioImplementStatement,
  portfolioView,
};
