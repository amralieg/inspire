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

  async function abacUnreadable(req, app, table) {
    try {
      const resp = await dbFetch(req.dbHost, app, `/api/2.1/unity-catalog/policies/table/${encodeURIComponent(table)}`);
      return !resp.ok && resp.status !== 404;
    } catch {
      return true;
    }
  }

  function noSignInOffer(tables, who) {
    const count = tables.length === 1 ? 'a source table' : `${tables.length} source tables`;
    const app = who.name && who.name !== who.id ? `${who.name} (application id ${who.id})` : `with application id ${who.id}`;
    return { tables, app: { name: who.name, id: who.id }, grants: [], can_grant: false, builtin: [],
      text: `The App service principal ${app} cannot read ${count}, so the build cannot check that its results keep the access rules. `
        + 'Sign in and build again, or ask the table owner to grant the App read access' };
  }

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
    const policyLost = (await Promise.all(tables.map(async (t) => ((await abacUnreadable(req, app, t)) ? t : null)))).filter(Boolean);
    const personPolicyLost = person && person !== app
      ? (await Promise.all(tables.map(async (t) => ((await abacUnreadable(req, person, t)) ? t : null)))).filter(Boolean)
      : [];
    if (personPolicyLost.length) {
      const label = (await appIdentity(req, person)).name;
      return { missing: lost, app_unreadable: { tables: personPolicyLost, app: { name: '', id: '' }, grants: [], can_grant: false,
        builtin: [], text: I.abacUnreadableSentence(label) } };
    }
    if (!lost.length && !policyLost.length) return { missing: [], app_unreadable: null };
    if (!person || person === app) {
      if (!policyLost.length) return { missing: lost, app_unreadable: null };
      const who = await appIdentity(req, app);
      return { missing: lost, app_unreadable: noSignInOffer(policyLost, who) };
    }
    const readable = await Promise.all(lost.map((m) => sqlRows(req.dbHost, person, warehouseId, I.tableProbeStatement(m.table))
      .then(() => true).catch(() => false)));
    const appOnly = [...lost.filter((_m, i) => readable[i]).map((m) => m.table), ...policyLost];
    if (!appOnly.length) return { missing: lost, app_unreadable: null };
    const who = await appIdentity(req, app);
    const builtIn = appOnly.filter((t) => I.builtInSampleTable(t));
    const grantable = appOnly.filter((t) => !builtIn.includes(t));
    const missing = lost.filter((m) => !appOnly.includes(m.table));
    if (!grantable.length) {
      return { missing, app_unreadable: { tables: builtIn, app: { name: who.name, id: who.id }, grants: [], can_grant: false,
        builtin: builtIn, text: I.builtInSampleMessage(builtIn) } };
    }
    const rows = await Promise.all(grantable.map((t) => accessRowsOf(req, person, warehouseId, t)));
    const offer = I.appReadGrantsOffer(grantable, grantable.map((t, i) => I.accessPlan(t, rows[i], who.id, { needs: I.IMPLEMENT_SOURCE_NEEDS })), who);
    const policy = policyLost.length ? `${I.abacUnreadableSentence(who.name || who.id, { app: true })}. ` : '';
    const text = policy + I.appUnreadableMessage(offer, job) + (builtIn.length ? `. ${I.builtInSampleMessage(builtIn)}` : '');
    return { missing, app_unreadable: { ...offer, builtin: builtIn, text } };
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

  async function abacGrantsOf(req, token, warehouseId, tables) {
    const who = await appIdentity(req, await appTokenOf(req));
    const shareable = tables.filter((t) => !I.builtInSampleTable(t));
    if (!shareable.length || !who.id) return { grants: [], gaps: [] };
    const rows = await Promise.all(shareable.map((t) => accessRowsOf(req, token, warehouseId, t)));
    const needs = [...I.IMPLEMENT_READ_NEEDS, ...I.IMPLEMENT_ABAC_READ_NEEDS];
    const plans = shareable.map((t, i) => I.accessPlan(t, rows[i], who.id, { needs }));
    return {
      grants: [...new Set(plans.flatMap((p) => p.grants.map((g) => I.grantSql(g, who.id))))],
      gaps: shareable.flatMap((table, i) => (plans[i].gaps.length
        ? [{ table, owner: plans[i].gaps[0].owner || '', grants: plans[i].gaps.map((g) => I.grantSql(g, who.id)) }] : [])),
    };
  }

  async function grantSourceAccess(req, token, warehouseId, tables, job = 'build') {
    const before = await sourceAccess(req, warehouseId, tables, job);
    const offer = before.app_unreadable;
    const abac = await abacGrantsOf(req, token, warehouseId, tables);
    const readGrants = offer && offer.can_grant ? offer.grants : [];
    const statements = [...new Set([...readGrants, ...abac.grants])];
    if (!statements.length) {
      if (offer && !offer.can_grant) {
        const err = I.badRequest(offer.text, 403);
        err.details = { app_unreadable: offer };
        throw err;
      }
      return { granted: 0, ran: [], failed: [], missing_tables: before.missing, app_unreadable: offer || null, abac_gaps: abac.gaps };
    }
    const { ran, failed } = await runPersonGrants(req, token, warehouseId, statements);
    const after = await sourceAccess(req, warehouseId, tables, job);
    const left = await abacGrantsOf(req, token, warehouseId, tables);
    return { granted: ran.length, ran, failed, missing_tables: after.missing, app_unreadable: after.app_unreadable, abac_gaps: left.gaps };
  }

  async function appReadsLeftOf(req, token, warehouseId, record) {
    const rows = await Promise.all(record.tables.map((t) => accessRowsOf(req, token, warehouseId, t.table)));
    return I.appReadsLeft(record, record.tables.map((t, i) => I.accessPlan(t.table, rows[i], record.app, { needs: I.IMPLEMENT_SOURCE_NEEDS })));
  }

  async function appReads(req, warehouseId, record, grant) {
    const person = P.personTokenOf(req);
    const token = person || req.dbToken;
    const before = await appReadsLeftOf(req, token, warehouseId, record);
    if (!grant) return { left: before, ran: [], failed: [] };
    if (!person) throw I.badRequest(I.IMPLEMENT_GRANT_NO_SIGN_IN, 401);
    const { ran, failed } = await runPersonGrants(req, person, warehouseId, I.appReadsGrantable(record, before));
    return { left: ran.length ? await appReadsLeftOf(req, token, warehouseId, record) : before, ran, failed };
  }

  return { accessRowsOf, appIdentity, appReads, appTokenOf, grantSourceAccess, runPersonGrants, sourceAccess };
}

module.exports = { createSourceAccess };
