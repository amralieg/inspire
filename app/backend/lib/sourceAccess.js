const I = require('./inspireImplement');
const P = require('./requestPerson');
const { parseExactJson } = require('./exactJson');
const { redactSecrets } = require('./redact');
const { runAsPerson } = require('./inspireJobParams');

const POLICY_PRIVILEGE_DENIED_RE = /does not have .+ on /i;

function policyPath(table) {
  return `/api/2.1/unity-catalog/policies/table/${encodeURIComponent(table)}`;
}

function policyDenialOf(status, body) {
  return status === 403 && POLICY_PRIVILEGE_DENIED_RE.test(String(body || ''));
}

function createSourceAccess({ executeSql, sqlResultToObjects, dbFetch, appToken = async () => '', logger = console }) {
  const fallbackLogged = new Set();

  function logFallback(table, status, detail) {
    if (fallbackLogged.has(table)) return;
    fallbackLogged.add(table);
    logger.warn(`[SOURCE-ACCESS] the ABAC policies of ${table} could not be read with the person's sign-in (HTTP ${status}), so the App's own read decides: ${redactSecrets(String(detail || '')).slice(0, 300)}`);
  }

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

  // Run-as-me: the App acts as the person, so its reads use the person's forwarded token (never an App token).
  const appTokenOf = async (req) => (await appToken()) || (req.dbTokenKind === P.PERSON_TOKEN && !runAsPerson() ? '' : req.dbToken);

  async function abacUnreadable(req, app, table) {
    try {
      const resp = await dbFetch(req.dbHost, app, policyPath(table));
      if (resp.ok || resp.status === 404) return false;
      const body = await resp.text().catch(() => '');
      logger.warn(`[SOURCE-ACCESS] the App could not read the ABAC policies of ${table} (HTTP ${resp.status}): ${redactSecrets(body).slice(0, 300)}`);
      return true;
    } catch (error) {
      logger.warn(`[SOURCE-ACCESS] the App could not read the ABAC policies of ${table}: ${redactSecrets(String((error && error.message) || error)).slice(0, 300)}`);
      return true;
    }
  }

  async function personAbacUnreadable(req, person, table) {
    try {
      const resp = await dbFetch(req.dbHost, person, policyPath(table));
      if (resp.ok || resp.status === 404) return false;
      const body = await resp.text().catch(() => '');
      if (policyDenialOf(resp.status, body)) return true;
      logFallback(table, resp.status, body);
      return false;
    } catch (error) {
      logFallback(table, 0, (error && error.message) || error);
      return false;
    }
  }

  function unverifiedOffer(tables) {
    return { tables, app: { name: '', id: '' }, grants: [], can_grant: false, builtin: [],
      text: 'Inspire cannot check what the App can read right now, so the build waits. Try again in a moment' };
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
    if (!app) return { missing: [], app_unreadable: unverifiedOffer(tables) };
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
      ? (await Promise.all(tables.map(async (t) => ((await personAbacUnreadable(req, person, t)) ? t : null)))).filter(Boolean)
      : [];
    if (personPolicyLost.length) {
      const label = (await appIdentity(req, person)).name;
      const builtIn = personPolicyLost.filter((t) => I.builtInSampleTable(t));
      const others = personPolicyLost.filter((t) => !builtIn.includes(t));
      const text = [others.length ? I.abacUnreadableSentence(label) : '', builtIn.length ? I.builtInSampleMessage(builtIn) : ''].filter(Boolean).join('. ');
      return { missing: lost, app_unreadable: { tables: personPolicyLost, app: { name: '', id: '' }, grants: [], can_grant: false,
        builtin: builtIn, text } };
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
