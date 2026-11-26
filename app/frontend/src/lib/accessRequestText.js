// REQ-311: the pure rules of the Permission Required dialog's Request access, shared by the App and the MVP shell. No imports.

// The button is offered only when a destination is set for a securable the person can request.
export function offerShown(offer) {
  return Boolean(offer && offer.offered === true);
}

// The one plain line after a send: where the request went, or why it was not sent.
export function accessRequestResultText(result) {
  if (!result) return '';
  if (result.sent) {
    const where = Array.isArray(result.destinations) ? result.destinations.filter(Boolean).join(', ') : '';
    return where ? `Request sent to ${where}` : 'Request sent';
  }
  const reason = String(result.reason || '').trim();
  return reason ? `Request not sent: ${reason}` : 'Request not sent';
}

// The grant statements the dialog shows, in their dialog order, for the check and the send.
export function statementsOf(permissions) {
  return (permissions || []).flatMap((p) => (Array.isArray(p?.statements) ? p.statements : []));
}

// REQ-406: Request access always opens the Databricks request form when the in-App send does not go through. The form is the Catalog
// Explorer page of the first securable (the backend builds it), and the rest are listed as plain links. The person sees one plain line,
// never a raw API error.
export function requestFormLink(links) {
  return (Array.isArray(links) ? links : []).find((link) => link && link.url) || null;
}

export function otherRequestLinks(links) {
  return (Array.isArray(links) ? links : []).filter((link) => link && link.url).slice(1);
}

// c23: the securables the dialog's own statements name ("GRANT ... ON <TYPE> `a`.`b` TO ..."), as dotted full names.
export function statementNames(statements) {
  const names = new Set();
  for (const statement of statements || []) {
    const m = /\bON\s+(?:CATALOG|SCHEMA|TABLE|VOLUME|VIEW)\s+(.+?)\s+TO\s/i.exec(String(statement || ''));
    if (m) names.add([...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]).join('.') || m[1].trim());
  }
  return names;
}

// c23: only the links of securables this dialog asks for. A link the statements do not name (a catalog outside the run) is never listed.
// With no statement naming a securable there is nothing to compare, so the links stay as they are.
export function linksOfRun(links, statements) {
  const list = Array.isArray(links) ? links : [];
  const names = statementNames(statements);
  return names.size ? list.filter((link) => link && names.has(link.full_name)) : list;
}

// c23: links sharing a catalog are one row with a count; a lone link stays a plain row. Order of first appearance is kept.
export function groupRequestLinks(links) {
  const groups = new Map();
  for (const link of (Array.isArray(links) ? links : []).filter((l) => l && l.url)) {
    const parent = String(link.full_name || '').split('.')[0];
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(link);
  }
  return [...groups].map(([parent, items]) => {
    const kinds = new Set(items.map((i) => i.type));
    const noun = kinds.size === 1 ? { TABLE: 'table', SCHEMA: 'schema', VOLUME: 'volume', CATALOG: 'catalog' }[[...kinds][0]] || 'item' : 'item';
    return { parent, items, label: items.length > 1 ? `${parent} \u2014 ${items.length} ${noun}s` : '' };
  });
}

// `opened`: the browser let the tab open. A blocked tab leaves the link on the dialog instead, and the line never says "Opened" for it.
export function requestFormText(link, opened = true) {
  if (!link) return 'Copy the SQL under Advanced to request this access.';
  return opened ? `Opened the access request form for ${link.full_name} in a new tab. Send the request there.`
    : `Open the access request form for ${link.full_name} with the link below. Send the request there.`;
}
