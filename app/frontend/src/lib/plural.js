export const shown = (count) => (typeof count === 'number' && Number.isFinite(count) ? count.toLocaleString('en-US') : count);

export function plural(count, one, many = `${one}s`) {
  return `${shown(count)} ${Number(count) === 1 ? one : many}`;
}

export function counted(count, one, many = `${one}s`) {
  return plural(Number(count), one, many);
}
