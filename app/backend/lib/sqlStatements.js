const { AsyncLocalStorage } = require('node:async_hooks');
const { plural } = require('./plural');

const PAGE_SQL_DEADLINE_MS = 240000;
const READ_ONLY_SQL_RE = /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
const DELTA_WRITE_CONFLICT_RE =
  /DELTA_CONCURRENT_\w+|DELTA_(METADATA|PROTOCOL)_CHANGED|CONCURRENT_(APPEND|DELETE|TRANSACTION|WRITE)|Concurrent\w*Exception|(Metadata|Protocol)ChangedException/i;
const CONFLICT_WINDOW_MS = 60000;
const CONFLICT_BASE_DELAY_MS = 250;
const CONFLICT_MAX_DELAY_MS = 8000;

function conflictDelayCeiling(attempt) {
  return Math.min(CONFLICT_MAX_DELAY_MS, CONFLICT_BASE_DELAY_MS * 2 ** (attempt - 1));
}

function conflictAttempts() {
  let attempts = 1;
  let spent = 0;
  while (spent + 1.5 * conflictDelayCeiling(attempts) <= CONFLICT_WINDOW_MS) {
    spent += 1.5 * conflictDelayCeiling(attempts);
    attempts += 1;
  }
  return attempts;
}

const CONFLICT_ATTEMPTS = conflictAttempts();
const SLOW_WAREHOUSE_MESSAGE =
  `The SQL warehouse did not answer within ${PAGE_SQL_DEADLINE_MS / 60000} minutes, so Inspire stopped the query. ` +
  'The warehouse may be starting or waiting for compute. Try again in a minute.';

const requestDeadline = new AsyncLocalStorage();

function runWithRequestDeadline(fn, ms = PAGE_SQL_DEADLINE_MS, now = Date.now) {
  return requestDeadline.run({ deadline: now() + ms }, fn);
}

function readDeadline(sql) {
  const store = requestDeadline.getStore();
  if (!store || typeof sql !== 'string' || !READ_ONLY_SQL_RE.test(sql)) return null;
  return store.deadline;
}

function sqlDeadlineError(statementId) {
  return Object.assign(new Error(SLOW_WAREHOUSE_MESSAGE), { code: 'SQL_DEADLINE', statementId });
}

function sqlCancelledError(statementId) {
  return Object.assign(new Error('The query was cancelled, so Inspire stopped it.'), { code: 'SQL_CANCELLED', statementId });
}

function isDeltaWriteConflict(message) {
  return DELTA_WRITE_CONFLICT_RE.test(String(message || ''));
}

function createExecuteSql(dbFetch, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  async function cancelStatement(host, token, statementId) {
    try {
      const resp = await dbFetch(host, token, `/api/2.0/sql/statements/${statementId}/cancel`, { method: 'POST' });
      if (!resp.ok) console.warn(`   ⚠️ SQL cancel refused for ${statementId} (${resp.status})`);
    } catch (e) {
      console.warn(`   ⚠️ SQL cancel failed for ${statementId}: ${e.message}`);
    }
  }

  async function runOnce(host, token, warehouseId, sql, parameters, options) {
    console.log(`   🔶 SQL: ${sql.substring(0, 150)}...`);
    const deadline = readDeadline(sql);
    if (deadline !== null && now() >= deadline) throw sqlDeadlineError(null);
    const { rowLimit = null, byteLimit = null, waitTimeout = '50s', signal = null } = options || {};
    if (signal && signal.aborted) throw sqlCancelledError(null);

    const body = {
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: waitTimeout,
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    };
    if (Array.isArray(parameters) && parameters.length) body.parameters = parameters;
    if (Number.isInteger(rowLimit) && rowLimit > 0) body.row_limit = rowLimit;
    if (Number.isInteger(byteLimit) && byteLimit > 0) body.byte_limit = byteLimit;
    const submitResp = await dbFetch(host, token, '/api/2.0/sql/statements', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!submitResp.ok) {
      const errText = await submitResp.text();
      console.error(`   ❌ SQL submit failed (${submitResp.status}): ${errText.substring(0, 200)}`);
      throw new Error(`SQL failed (${submitResp.status}): ${errText}`);
    }
    let result = await submitResp.json();
    console.log(`   📄 SQL state: ${result.status?.state}`);

    let pollCount = 0;
    while (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING') {
      if (signal && signal.aborted) {
        await cancelStatement(host, token, result.statement_id);
        console.warn(`   ⏹️ SQL cancelled by the caller: ${result.statement_id}`);
        throw sqlCancelledError(result.statement_id);
      }
      if (deadline !== null && now() >= deadline) {
        await cancelStatement(host, token, result.statement_id);
        console.warn(`   ⏱️ SQL stopped at the page deadline: ${result.statement_id}`);
        throw sqlDeadlineError(result.statement_id);
      }
      pollCount++;
      await sleep(2000);
      const pollResp = await dbFetch(host, token, `/api/2.0/sql/statements/${result.statement_id}`);
      if (!pollResp.ok) throw new Error(`SQL polling failed`);
      result = await pollResp.json();
      if (pollCount % 5 === 0) console.log(`   ⏳ Polling (${pollCount})...`);
    }

    if (result.status?.state === 'FAILED') {
      const errMsg = result.status?.error?.message || 'SQL statement execution failed';
      throw new Error(errMsg);
    }

    if (result.manifest?.total_chunk_count > 1 && result.manifest?.chunks) {
      let allData = result.result?.data_array || [];
      for (const chunk of result.manifest.chunks) {
        if (chunk.chunk_index === 0) continue;
        const chunkResp = await dbFetch(host, token, `/api/2.0/sql/statements/${result.statement_id}/result/chunks/${chunk.chunk_index}`);
        if (chunkResp.ok) {
          const chunkData = await chunkResp.json();
          if (chunkData.data_array) allData = allData.concat(chunkData.data_array);
        }
      }
      result.result = result.result || {};
      result.result.data_array = allData;
    }

    const rowCount = result.result?.data_array?.length ?? 0;
    console.log(`   ✅ SQL done: ${plural(rowCount, 'row')}`);
    return result;
  }

  return async function executeSql(host, token, warehouseId, sql, parameters = null, options = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runOnce(host, token, warehouseId, sql, parameters, options);
      } catch (err) {
        if (attempt >= CONFLICT_ATTEMPTS || !isDeltaWriteConflict(err.message)) throw err;
        const ceiling = conflictDelayCeiling(attempt);
        const wait = ceiling + Math.floor(random() * ceiling);
        console.warn(`   🔄 Delta write conflict with another Inspire run, SQL retry ${attempt}/${CONFLICT_ATTEMPTS - 1} in ${wait}ms`);
        await sleep(wait);
      }
    }
  };
}

module.exports = {
  createExecuteSql,
  sqlCancelledError,
  isDeltaWriteConflict,
  CONFLICT_ATTEMPTS,
  CONFLICT_WINDOW_MS,
  runWithRequestDeadline,
  readDeadline,
  PAGE_SQL_DEADLINE_MS,
  SLOW_WAREHOUSE_MESSAGE,
};
