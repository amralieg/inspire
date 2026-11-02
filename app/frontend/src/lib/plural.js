export function plural(count, one, many = `${one}s`) {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

export function counted(count, one, many = `${one}s`) {
  return `${Number(count).toLocaleString('en-US')} ${Number(count) === 1 ? one : many}`;
}
