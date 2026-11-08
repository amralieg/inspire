const I = require('./inspireImplement');
const P = require('./requestPerson');
const { parseExactJson } = require('./exactJson');

function createSourceAccess({ executeSql, sqlResultToObjects, dbFetch, appToken = async () => '' }) {
  const sqlRows = async (host, token, warehouseId, statement) =>
    sqlResultToObjects(await executeSql(host, token, warehouseId, statement.sql, statement.parameters));

  async function appIdentity(req, token) {
    let me = {};
    try {
      const resp = await dbFetch(req.dbHost, token, P.SCIM_ME_PATH);
      me = resp.ok ? parseExactJson((await resp.text()) || '{}') : {};
    } catch {
      me = {};
    }
    const id = String(me.applicationId || me.userName || '').trim();
    return { name: String(me.displayName || '').trim() || id, id };
  }

  const accessRowsOf = (req, token, warehouseId, table) => Promise.resolve()
    .then(() => sqlRows(req.dbHost, token, warehouseId, I.outputAccessStatement(table)))
    .catch(() => []);

  const appTokenOf = async (req) => (await appToken()) || req.dbToken;

  async function sourceAccess(req, warehouseId, tables, job = 'build') {
    const app = await appTokenOf(req);
    const probes = await Promise.all(tables.map((table) => sqlRows(req.dbHost, app, warehouseId, I.tableProbeStatement(table))
      .then(() => null)
      .catch((err) => {
        const reason = I.tableAccessReason(table, err && err.message);
        return reason ? { table, reason, error: String(err.message || '').slice(0, 300) } : null;
      })));
    const lost = probes.filter(Boolean);
    const person = P.personTokenOf(req);
    if (!lost.length || !person || person === app) return { missing: lost, app_unreadable: null };
    const readable = await Promise.all(lost.map((m) => sqlRows(req.dbHost, person, warehouseId, I.tableProbeStatement(m.table))
      .then(() => true).catch(() => false)));
    const appOnly = lost.filter((_m, i) => readable[i]).map((m) => m.table);
    if (!appOnly.length) return { missing: lost, app_unreadable: null };
    const [who, rows] = await Promise.all([appIdentity(req, app), Promise.all(appOnly.map((t) => accessRowsOf(req, person, warehouseId, t)))]);
    const offer = I.appReadGrantsOffer(appOnly, appOnly.map((t, i) => I.accessPlan(t, rows[i], who.id)), who);
    return { missing: lost.filter((m) => !appOnly.includes(m.table)), app_unreadable: { ...offer, text: I.appUnreadableMessage(offer, job) } };
  }

  async function runPersonGrants(req, token, warehouseId, statements) {
    const ran = [];
    const failed = [];
    for (const sql of statements) {
      try {
        await executeSql(req.dbHost, token, warehouseId, sql);
        ran.push(sql);
      } catch (err) {
        failed.push(`${sql}: ${String((err && err.message) || err).slice(0, 200)}`);
      }
    }
    return { ran, failed };
  }

  async function grantSourceAccess(req, token, warehouseId, tables, job = 'build') {
    const before = await sourceAccess(req, warehouseId, tables, job);
    const offer = before.app_unreadable;
    if (!offer) return { granted: 0, ran: [], failed: [], missing_tables: before.missing, app_unreadable: null };
    if (!offer.can_grant) {
      const err = I.badRequest(offer.text, 403);
      err.details = { app_unreadable: offer };
      throw err;
    }
    const { ran, failed } = await runPersonGrants(req, token, warehouseId, offer.grants);
    const after = await sourceAccess(req, warehouseId, tables, job);
    return { granted: ran.length, ran, failed, missing_tables: after.missing, app_unreadable: after.app_unreadable };
  }

  return { accessRowsOf, appIdentity, appTokenOf, grantSourceAccess, runPersonGrants, sourceAccess };
}

module.exports = { createSourceAccess };
