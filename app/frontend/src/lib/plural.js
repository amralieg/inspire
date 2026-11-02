export function plural(count, one, many = `${one}s`) {
  return `${count} ${Number(count) === 1 ? one : many}`;
}
