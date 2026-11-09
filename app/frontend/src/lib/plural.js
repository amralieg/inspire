export const shown = (count) => (typeof count === 'number' && Number.isFinite(count) ? count.toLocaleString('en-US') : count);

export function plural(count, one, many = `${one}s`) {
  return `${shown(count)} ${Number(count) === 1 ? one : many}`;
}

export function counted(count, one, many = `${one}s`) {
  return plural(Number(count), one, many);
}

export function briefList(items, { max = 3, sep = ', ' } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.length > max ? `${list.slice(0, max).join(sep)} and ${list.length - max} more` : list.join(sep);
}
