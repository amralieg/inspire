const ID = '[A-Za-z_][A-Za-z0-9_]*';
const QUOTED_OR_ID = '(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)';
const MAP_NAME = `${QUOTED_OR_ID}(?:\\.${QUOTED_OR_ID}){2}`;
const EXISTS_SHAPE = new RegExp(`^exists\\s*\\(\\s*select\\s+1\\s+from\\s+(${MAP_NAME})\\s+(${ID})\\s+where\\s+\\2\\.(${ID})\\s*=\\s*(${ID})\\s+and\\s+(.+?)\\s*\\)$`, 'i');
const IN_SHAPE = new RegExp(`^(${ID})\\s+in\\s*\\(\\s*select\\s+(${ID})\\.(${ID})\\s+from\\s+(${MAP_NAME})\\s+(${ID})\\s+where\\s+(.+?)\\s*\\)$`, 'i');

function unquoted(name) {
  return String(name).replace(/`/g, '').trim();
}

function stripped(expr) {
  let text = String(expr || '').replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
  text = text.replace(/^return\s+/i, '');
  while (text.startsWith('(') && text.endsWith(')') && balanced(text.slice(1, -1))) text = text.slice(1, -1).trim();
  return text;
}

function balanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function principalColumn(expr, alias) {
  const parts = stripped(expr).split(/\s+or\s+/i).map((part) => stripped(part));
  const columns = new Set();
  for (const part of parts) {
    const user = part.match(new RegExp(`^${alias}\\.(${ID})\\s*=\\s*current_user\\(\\)$`, 'i'));
    const group = part.match(new RegExp(`^is_account_group_member\\(\\s*${alias}\\.(${ID})\\s*\\)$`, 'i'));
    const found = user || group;
    if (!found) return '';
    columns.add(found[1].toLowerCase());
  }
  return columns.size === 1 ? [...columns][0] : '';
}

function rowFilterMapping(body, filter) {
  const text = stripped(body);
  const exists = text.match(EXISTS_SHAPE);
  if (exists) {
    const [, map, alias, key, param, principal] = exists;
    const principalName = principalColumn(principal, alias);
    if (!principalName || unquoted(param).toLowerCase() !== filter.parameter.toLowerCase()) return null;
    return { map: unquoted(map), key: unquoted(key), principal: principalName, column: filter.column };
  }
  const inList = text.match(IN_SHAPE);
  if (inList) {
    const [, param, alias, key, map, mapAlias, principal] = inList;
    if (alias !== mapAlias || unquoted(param).toLowerCase() !== filter.parameter.toLowerCase()) return null;
    const principalName = principalColumn(principal, alias);
    if (!principalName) return null;
    return { map: unquoted(map), key: unquoted(key), principal: principalName, column: filter.column };
  }
  return null;
}

function tableEnforcement(name, tableInfo, routine) {
  const masked = (tableInfo.columns || []).filter((c) => c && c.mask && c.mask.function_name).map((c) => c.name);
  const filter = tableInfo.row_filter;
  const filtered = Boolean(filter && filter.function_name);
  if (!filter || !filter.function_name) return { table: name, enforced: true, mapping: null, column: '', masked, filtered, reason: '' };
  const fn = filter.function_name;
  if (!routine) return { table: name, enforced: false, masked, filtered, reason: `Inspire could not read the row filter ${fn}` };
  const inputs = filter.input_column_names || [];
  const parameters = routine.parameters || [];
  if (inputs.length !== 1 || parameters.length !== 1) {
    return { table: name, enforced: false, masked, filtered, reason: `the row filter ${fn} reads more than one column, which is not a user-to-key mapping` };
  }
  const mapping = rowFilterMapping(routine.body, { column: inputs[0], parameter: parameters[0] });
  if (!mapping) {
    return { table: name, enforced: false, masked, filtered, reason: `the row filter ${fn} is not a user-to-key mapping table` };
  }
  if (masked.includes(inputs[0])) {
    return { table: name, enforced: false, masked, filtered, reason: `the row filter ${fn} reads ${inputs[0]}, which a column mask hides` };
  }
  return { table: name, enforced: true, mapping, column: inputs[0], masked, filtered, reason: '' };
}

async function oneEnforcement(name, fetchJson) {
  const unreadable = { table: name, enforced: false, masked: [], filtered: false, reason: `Inspire could not read the table ${name}` };
  try {
    const table = await fetchJson(`/api/2.1/unity-catalog/tables/${encodeURIComponent(name)}`);
    if (!table.ok) return unreadable;
    const fn = table.data && table.data.row_filter && table.data.row_filter.function_name;
    let routine = null;
    if (fn) {
      const got = await fetchJson(`/api/2.1/unity-catalog/functions/${encodeURIComponent(fn)}`);
      if (got.ok) {
        routine = { body: got.data.routine_definition, parameters: ((got.data.input_params || {}).parameters || []).map((p) => p.name) };
      }
    }
    return tableEnforcement(name, table.data || {}, routine);
  } catch {
    return unreadable;
  }
}

async function tablesEnforcement(names, fetchJson) {
  const out = {};
  for (const name of names) {
    out[name] = await oneEnforcement(name, fetchJson);
  }
  return out;
}

module.exports = { rowFilterMapping, tableEnforcement, tablesEnforcement };
