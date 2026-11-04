const INT64_MAX = 9223372036854775807n;
const INT64_DIGITS = /^\d{1,19}$/;

function int64Id(value) {
  if (typeof value === 'bigint') return value >= 0n && value <= INT64_MAX ? value.toString() : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (value == null || typeof value === 'object' || typeof value === 'boolean') return null;
  const text = String(value).trim();
  if (!INT64_DIGITS.test(text)) return null;
  const id = BigInt(text);
  return id <= INT64_MAX ? id.toString() : null;
}

function isInt64Id(value) {
  return int64Id(value) != null;
}

function requireInt64Id(value, name) {
  const id = int64Id(value);
  if (id != null) return id;
  const err = new Error(`${name} must be a whole number id of at most 19 digits.`);
  err.statusCode = 400;
  throw err;
}

function jsonWithInt64Ids(body, names) {
  const fields = Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${JSON.stringify(key)}:${names.includes(key) ? requireInt64Id(value, key) : JSON.stringify(value)}`);
  return `{${fields.join(',')}}`;
}

module.exports = { INT64_MAX, int64Id, isInt64Id, requireInt64Id, jsonWithInt64Ids };
