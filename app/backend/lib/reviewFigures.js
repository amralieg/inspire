const { int64Id } = require('./int64Id');
const { isMissingTableError } = require('./inspireFeedback');
const {
  IMPLEMENT_ACTIVE_STATUSES,
  IMPLEMENT_DONE_STATUSES,
  IMPLEMENT_OUTPUT_ID_COLUMNS,
  IMPLEMENT_STOPPED_STATES,
  IMPLEMENT_TABLE,
  IMPLEMENT_UNINSTALLED,
  IMPLEMENT_VIBE_NOT_MET,
  describedColumnNames,
  isMissingColumnError,
} = require('./inspireImplement');

const SESSION_LIST_CAP = 20;
const SESSION_PREVIEW_CAP = 4;
const PORTFOLIO_RUN_CAP = 1000;
const PORTFOLIO_TABLES = ['__inspire_session', '__inspire_usecases', IMPLEMENT_TABLE];
const PORTFOLIO_ASSETS = [['apps', 'app'], ['dashboards', 'dashboard'], ['genie_spaces', 'genie_space'], ['alerts', 'alert']];
const RUN_FIGURES = ['use_cases', 'domains', 'subdomains', 'best_of_best', 'mvps_started', 'mvps_live', 'mvps_building', 'mvps_failed', 'mvps_held',
  ...PORTFOLIO_ASSETS.map(([key]) => key)];
const IMPLEMENT_FAILED = 'failed';
const SESSION_LIST_COLUMNS = ['session_id', 'processing_status', 'completed_percent', 'create_at', 'last_updated', 'completed_on', 'business_name',
  'inspire_database_name', 'operation_mode', 'generation_path', 'business_domains', 'catalogs'];

const INSPIRE_QUALITY_WEIGHT = 0.65;
const INSPIRE_PRIORITY_WEIGHT = 0.35;
const HIGH_PRIORITY_MIN_INSPIRE_SCORE = 3;
const BELOW_BAR_ELITE_STATUSES = ['FALLBACK_BELOW_BAR', 'DOMAIN_COVERAGE_PICK'];
const MEETS_BAR_SQL = `UPPER(TRIM(COALESCE(elite_status, ''))) NOT IN (${BELOW_BAR_ELITE_STATUSES.map((s) => `'${s}'`).join(', ')})`;
const everyColumn = () => true;
function inspireScoreSql(has = everyColumn) {
  const column = (name) => (has(name) ? name : 'CAST(NULL AS DOUBLE)');
  return `COALESCE(${column('inspire_score')}, ${INSPIRE_QUALITY_WEIGHT} * LEAST(10, GREATEST(0, ${column('quality_score')} * 2)) `
    + `+ ${INSPIRE_PRIORITY_WEIGHT} * LEAST(10, GREATEST(0, ${column('priority_score')}))) / 2`;
}
const highPrioritySql = (has = everyColumn) => `COALESCE(${inspireScoreSql(has)}, 0) >= ${HIGH_PRIORITY_MIN_INSPIRE_SCORE}`;
const INSPIRE_SCORE_SQL = inspireScoreSql();
const HIGH_PRIORITY_SQL = highPrioritySql();

const OVERVIEW_FIGURES = [
  { key: 'high', column: 'high_priority_count', needs: [['inspire_score'], ['quality_score', 'priority_score']],
    why: 'the use case table has no inspire_score column, and no quality_score and priority_score columns to work it out from' },
  { key: 'quality', column: 'meets_bar_count', needs: [['elite_status']], why: 'the use case table has no elite_status column, which holds the quality bar' },
  { key: 'domains', column: 'domain_count', needs: [['business_domain']], why: 'the use case table has no business_domain column' },
];

function overviewUnread(existing) {
  if (!existing) return {};
  return Object.fromEntries(OVERVIEW_FIGURES
    .filter((figure) => !figure.needs.some((group) => group.every((name) => existing.has(name))))
    .map((figure) => [figure.key, figure.why]));
}

function sessionOverviewStatement(table, sessionIds, existing = null) {
  const ids = sessionIds.filter((id) => /^\d+$/.test(String(id))).join(',');
  const has = (name) => !existing || existing.has(name);
  const unread = overviewUnread(existing);
  const rules = { high: highPrioritySql(has), quality: MEETS_BAR_SQL };
  const figure = ({ key, column }) => {
    if (unread[key]) return `CAST(NULL AS INT) AS ${column}`;
    if (key === 'domains') return `CAST(COUNT(DISTINCT NULLIF(TRIM(business_domain), '')) AS INT) AS ${column}`;
    return `CAST(SUM(CASE WHEN ${rules[key]} THEN 1 ELSE 0 END) AS INT) AS ${column}`;
  };
  return {
    sql: `SELECT session_id, CAST(COUNT(*) AS INT) AS usecase_count, ${OVERVIEW_FIGURES.map(figure).join(', ')} `
      + `FROM ${table} WHERE session_id IN (${ids}) GROUP BY session_id`,
    parameters: null,
  };
}

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

const figureOrNull = (value) => (value == null ? null : whole(value));

async function loadSessionOverviews(run, table, sessionIds) {
  let existing = null;
  let rows;
  let previews = {};
  try {
    try {
      rows = await run(sessionOverviewStatement(table, sessionIds));
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
      existing = describedColumnNames(await run({ sql: `DESCRIBE TABLE ${table}`, parameters: null }));
      rows = await run(sessionOverviewStatement(table, sessionIds, existing));
    }
    previews = await loadSessionPreviews(run, table, sessionIds, existing);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    rows = [];
  }
  const unread = overviewUnread(existing);
  const empty = {
    total: 0, high: unread.high ? null : 0, meets: unread.quality ? null : 0, below: unread.quality ? null : 0,
    domains: unread.domains ? null : 0, unread,
  };
  const bySession = {};
  for (const row of rows) {
    const sid = int64Id(row.session_id);
    if (!sid) continue;
    const total = whole(row.usecase_count);
    const meets = unread.quality ? null : Math.min(total, whole(row.meets_bar_count));
    bySession[sid] = {
      total,
      high: unread.high ? null : figureOrNull(row.high_priority_count),
      meets,
      below: meets == null ? null : total - meets,
      domains: unread.domains ? null : figureOrNull(row.domain_count),
      unread,
    };
  }
  return Object.fromEntries(sessionIds.map((sid) => [String(sid), { ...(bySession[String(sid)] || empty), preview_use_cases: previews[String(sid)] || [] }]));
}

function sessionListCap(all) {
  return all ? PORTFOLIO_RUN_CAP : SESSION_LIST_CAP;
}

const whole = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

function sessionPreviewStatement(table, sessionIds, { withTechnique = true, byBar = true, has = everyColumn } = {}) {
  const ids = sessionIds.filter((id) => /^\d+$/.test(String(id))).join(',');
  const label = withTechnique ? 'name_with_technique' : 'CAST(NULL AS STRING) AS name_with_technique';
  const scored = ['inspire_score', 'quality_score', 'priority_score'].some(has);
  const order = [byBar ? `CASE WHEN ${MEETS_BAR_SQL} THEN 0 ELSE 1 END` : '', scored ? `COALESCE(${inspireScoreSql(has)}, 0) DESC` : '', 'use_case']
    .filter(Boolean).join(', ');
  return {
    sql: 'SELECT session_id, Name, name_with_technique, rn FROM ('
      + `SELECT session_id, COALESCE(NULLIF(TRIM(use_case), ''), CONCAT('Use case ', CAST(id AS STRING))) AS Name, ${label}, `
      + `ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ${order}) AS rn `
      + `FROM ${table} WHERE session_id IN (${ids})) z WHERE z.rn <= ${SESSION_PREVIEW_CAP} ORDER BY session_id, rn`,
    parameters: null,
  };
}

async function loadSessionPreviews(run, table, sessionIds, existing = null) {
  let rows;
  if (existing) {
    rows = await run(sessionPreviewStatement(table, sessionIds, { withTechnique: existing.has('name_with_technique'), byBar: existing.has('elite_status'),
      has: (name) => existing.has(name) }));
  } else {
    try {
      rows = await run(sessionPreviewStatement(table, sessionIds));
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
      rows = await run(sessionPreviewStatement(table, sessionIds, { withTechnique: false, byBar: false, has: (name) => name === 'priority_score' }));
    }
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
  const active = IMPLEMENT_ACTIVE_STATUSES.map((_, i) => `:active${i}`).join(', ');
  const stopped = IMPLEMENT_STOPPED_STATES.map((_, i) => `:stop${i}`).join(', ');
  const builtKey = `CASE WHEN \`status\` IN (${done}, :gone) THEN \`spec_version\` END`;
  const assetId = (output) => (output === 'app'
    ? `COALESCE(NULLIF(TRIM(${column('app_name')}), ''), CONCAT('inspire:', ${status('app.hosted.id')}))`
    : `NULLIF(TRIM(${column(IMPLEMENT_OUTPUT_ID_COLUMNS[output])}), '')`);
  const builtAsset = ([, output]) => `max_by(CASE WHEN COALESCE(${status(`${output}.state`)}, '') IN (${stopped}) THEN NULL ELSE ${assetId(output)} END, `
    + `${builtKey}) AS ${output}`;
  const live = `COALESCE(built_status, '') IN (${done})`;
  const notLive = `NOT ${live}`;
  const counted = ([key, output]) => `CAST(COUNT(DISTINCT CASE WHEN ${live} THEN ${output} END) AS INT) AS ${key}`;
  return {
    sql: `WITH mvp AS (SELECT \`session_id\` AS session_id, max_by(\`status\`, \`spec_version\`) AS latest_status, `
      + `max_by(\`status\`, ${builtKey}) AS built_status, ${PORTFOLIO_ASSETS.map(builtAsset).join(', ')} `
      + `FROM ${table} GROUP BY \`session_id\`, \`use_case_id\`) `
      + `SELECT ${runKeys}, `
      + "CAST(SUM(CASE WHEN COALESCE(latest_status, '') NOT IN ('', :gone) THEN 1 ELSE 0 END) AS INT) AS mvps_started, "
      + `CAST(SUM(CASE WHEN ${live} THEN 1 ELSE 0 END) AS INT) AS mvps_live, `
      + `CAST(SUM(CASE WHEN ${notLive} AND latest_status IN (${active}) THEN 1 ELSE 0 END) AS INT) AS mvps_building, `
      + `CAST(SUM(CASE WHEN ${notLive} AND latest_status = :failed THEN 1 ELSE 0 END) AS INT) AS mvps_failed, `
      + `CAST(SUM(CASE WHEN ${notLive} AND latest_status = :held THEN 1 ELSE 0 END) AS INT) AS mvps_held, `
      + `${PORTFOLIO_ASSETS.map(counted).join(', ')} FROM mvp ${rollup}`,
    parameters: [
      ...IMPLEMENT_DONE_STATUSES.map((value, i) => ({ name: `done${i}`, value, type: 'STRING' })),
      { name: 'gone', value: IMPLEMENT_UNINSTALLED, type: 'STRING' },
      ...IMPLEMENT_ACTIVE_STATUSES.map((value, i) => ({ name: `active${i}`, value, type: 'STRING' })),
      { name: 'failed', value: IMPLEMENT_FAILED, type: 'STRING' },
      { name: 'held', value: IMPLEMENT_VIBE_NOT_MET, type: 'STRING' },
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
  HIGH_PRIORITY_MIN_INSPIRE_SCORE,
  INSPIRE_PRIORITY_WEIGHT,
  INSPIRE_QUALITY_WEIGHT,
  INSPIRE_SCORE_SQL,
  BELOW_BAR_ELITE_STATUSES,
  HIGH_PRIORITY_SQL,
  MEETS_BAR_SQL,
  OVERVIEW_FIGURES,
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
  sessionOverviewStatement,
  loadSessionOverviews,
  portfolioSessionStatement,
  portfolioUseCaseStatement,
  portfolioImplementStatement,
  portfolioView,
};
