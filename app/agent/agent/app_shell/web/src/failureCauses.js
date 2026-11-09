import { MACHINE_ID } from './plainText.js';

const OBJECT_ON = /\bon\s+(catalog|schema|table|view|volume|function|warehouse)\s+[`'"]?([\w-]+(?:[`'"]?\.[`'"]?[\w-]+)*)/i;
const OBJECT_NAMED = /\b(?:the\s+)?(table|view|table or view|schema|catalog)\s+[`'"]?([\w-]+(?:[`'"]?\.[`'"]?[\w-]+)*)[`'"]?\s+(?:cannot be found|does not exist|was not found)/i;

function objectOf(text, pattern) {
  const m = pattern.exec(text);
  if (!m) return '';
  const kind = m[1].toLowerCase() === 'table or view' ? 'table' : m[1].toLowerCase();
  return `${kind} ${m[2].replace(/[`'"]/g, '')}`;
}

function statedReason(raw) {
  const said = raw.replace(/^\s*(?:\[[A-Z][A-Z0-9_]*\]\s*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+:\s*|Insufficient privileges:\s*)+/, '').split(/(?<=[.!?])\s/)[0].replace(/[.!?\s]+$/, '').trim();
  if (!said || said.length > 140 || /[A-Z][A-Z0-9]*_[A-Z0-9_]+|[{}[\]/\\]|SQLSTATE|\bHTTP\b/.test(said) || new RegExp(MACHINE_ID.source, 'i').test(said)) return '';
  return said;
}

export const FAILURE_CAUSES = [
  { kind: 'network', transient: true, test: /^(?:TypeError:\s*)?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed|network error)$|\b(?:fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up)\b/i,
    text: () => 'Inspire lost its connection to Databricks, so try again in a minute and ask a workspace admin if it keeps happening' },
  { kind: 'signed_out', test: /\bInvalid access token\b|\b(?:access )?token (?:has |is )?expired\b|\bexpired (?:access )?token\b|\bCredential was not sent\b|\bUNAUTHENTICATED\b|\(HTTP 401\)|\bNo authentication token available\b/i,
    text: () => 'your Databricks sign-in has expired, so reload the page to sign in again' },
  { kind: 'app_limit', test: /\bmaximum number of apps\b|\bapps? (?:quota|limit) (?:is |has been )?(?:reached|exceeded)\b|\breached the (?:maximum|limit) (?:number )?of apps\b/i,
    text: () => 'this workspace has reached its limit of Apps, so delete an App you no longer use or ask a workspace admin to raise the limit' },
  { kind: 'quota', test: /\bRESOURCE_EXHAUSTED\b|\bQUOTA_EXCEEDED\b|\bquota (?:is |has been )?(?:exceeded|reached)\b|\b(?:exceeded|reached) (?:the |its |your )?(?:\w+ )?quota\b/i,
    text: () => 'this workspace has reached one of its Databricks limits, so remove what you no longer use or ask a workspace admin to raise the limit' },
  { kind: 'busy', transient: true, test: /\bREQUEST_LIMIT_EXCEEDED\b|\bTOO_MANY_REQUESTS\b|\bTEMPORARILY_UNAVAILABLE\b|\brate limit\b|\bToo Many Requests\b|\(HTTP 429\)|\(HTTP 503\)/i,
    text: () => 'Databricks is busy right now, so wait a minute and try again' },
  { kind: 'warehouse_gone', test: /\b(?:SQL )?warehouse\b[^.]*?\b(?:does not exist|not found|was deleted|has been deleted)\b/i,
    text: () => 'the SQL warehouse Inspire uses no longer exists, so ask whoever installed Inspire to pick another warehouse' },
  { kind: 'warehouse_stopped', test: /\b(?:SQL )?warehouse\b[^.]*?\b(?:is not running|is stopped|is stopping|has stopped|was stopped)\b/i,
    text: () => 'the SQL warehouse is stopped, so start it on the SQL Warehouses page or ask its owner to, then try again' },
  { kind: 'not_found', test: /\b(?:TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND|CATALOG_NOT_FOUND|NO_SUCH_CATALOG_EXCEPTION|(?:CATALOG|SCHEMA|TABLE)_DOES_NOT_EXIST)\b|\b(?:Catalog|Schema|Table)\s+'[^']+'\s+does not exist\b/,
    text: (raw) => `${objectOf(raw, OBJECT_NAMED) || 'a table it needs'} does not exist, so check that it was not renamed or dropped, or pick another one` },
  { kind: 'denied', test: /\bPERMISSION_DENIED\b|\bINSUFFICIENT_PERMISSIONS\b|\bInsufficient privileges\b|\bUser does not have\b|\(HTTP 403\)/i,
    text: (raw) => {
      const object = objectOf(raw, OBJECT_ON);
      if (object) return `access to ${object} was refused, so ask its owner or a workspace admin to give you access`;
      const reason = statedReason(raw);
      return `${reason || 'access to what it needs was refused'}, so ask its owner or a workspace admin to give you access`;
    } },
  { kind: 'server', transient: true, test: /\bINTERNAL_ERROR\b|\bInternal (?:server )?error\b|\(HTTP 50[0-4]\)|\bBad Gateway\b|\bService Unavailable\b/i,
    text: () => 'Databricks had a problem on its side, so try again in a minute' },
];
