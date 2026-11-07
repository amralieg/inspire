const shown = (count) => (typeof count === 'number' && Number.isFinite(count) ? count.toLocaleString('en-US') : count);

function plural(count, one, many = `${one}s`) {
  return `${shown(count)} ${Number(count) === 1 ? one : many}`;
}

module.exports = { plural };
