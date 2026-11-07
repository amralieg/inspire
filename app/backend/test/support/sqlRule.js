const { DatabaseSync } = require('node:sqlite');

const RULE_COLUMNS = ['inspire_score', 'quality_score', 'priority_score'];

function rowsMatching(sqlRule, rows) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE uc (i INTEGER, ${RULE_COLUMNS.map((c) => `${c} REAL`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO uc VALUES (?, ${RULE_COLUMNS.map(() => '?').join(', ')})`);
    rows.forEach((row, i) => insert.run(i, ...RULE_COLUMNS.map((c) => (row[c] == null || row[c] === '' ? null : Number(row[c])))));
    const rule = sqlRule.replace(/\bLEAST\(/g, 'MIN(').replace(/\bGREATEST\(/g, 'MAX(');
    const hits = new Set(db.prepare(`SELECT i FROM uc WHERE ${rule}`).all().map((r) => r.i));
    return rows.filter((_, i) => hits.has(i));
  } finally {
    db.close();
  }
}

module.exports = { rowsMatching };
