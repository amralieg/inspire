import { DatabaseSync } from 'node:sqlite';

const ROLLUP = ' GROUP BY ROLLUP (session_id) ';
const GROUPING = 'CAST(grouping(session_id) AS INT) AS is_total';

function sparkConcat(...parts) {
  return parts.some((p) => p == null) ? null : parts.join('');
}

function jsonPath(text, path) {
  if (text == null) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  for (const key of String(path).replace(/^\$\./, '').split('.')) {
    if (value == null || typeof value !== 'object') return null;
    value = value[key];
  }
  if (value == null) return null;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function expandRollup(sql) {
  const at = sql.lastIndexOf(ROLLUP);
  if (at < 0) return sql;
  const head = sql.slice(0, at);
  const tail = sql.slice(at + ROLLUP.length);
  const cte = head.match(/^(WITH [\s\S]*?\) )(SELECT [\s\S]*)$/);
  const [prefix, select] = cte ? [cte[1], cte[2]] : ['', head];
  if (!select.includes(GROUPING)) throw new Error(`rawWarehouse: a ROLLUP without ${GROUPING}`);
  const perRun = `${select.replace(GROUPING, '0 AS is_total')} GROUP BY session_id`;
  const total = select.replace(GROUPING, '1 AS is_total').replace('CAST(session_id AS TEXT) AS sid', 'NULL AS sid');
  return `${prefix}SELECT * FROM (${perRun}) UNION ALL SELECT * FROM (${total}) ${tail}`;
}

export function toSqlite(sql) {
  const plain = sql
    .replace(/(`[^`]+`\.){2}`(__inspire_\w+)`/g, '$2')
    .replace(/\bAS STRING\)/g, 'AS TEXT)')
    .replace(/\bCONCAT\(/g, 'spark_concat(')
    .replace(/\bto_json\(/g, '(');
  return expandRollup(plain);
}

export function rawWarehouse(tables) {
  const db = new DatabaseSync(':memory:');
  db.function('spark_concat', { varargs: true, deterministic: true }, sparkConcat);
  db.function('get_json_object', { deterministic: true }, jsonPath);
  db.aggregate('max_by', {
    start: () => null,
    step: (best, value, order) => (order == null || (best && best.order >= order) ? best : { value, order }),
    result: (best) => (best ? best.value : null),
  });
  for (const [name, rows] of Object.entries(tables)) {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    db.exec(`CREATE TABLE ${name} (${columns.map((c) => `\`${c}\``).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${name} (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
    for (const row of rows) insert.run(...columns.map((c) => (row[c] === undefined ? null : row[c])));
  }
  const run = (sql, parameters) => {
    const named = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    return { rows: db.prepare(toSqlite(sql)).all(named) };
  };
  return { run, close: () => db.close() };
}
