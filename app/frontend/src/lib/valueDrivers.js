import { valueChips } from './valueLedger.js';
import defs from '../../../backend/lib/valueDrivers.json' with { type: 'json' };

// REQ-435: the value that is not in the data. The five drivers and the share input come from backend/lib/valueDrivers.json; the
// amounts are worked out by the server, so this file only reads the definition and builds the answers (no formula lives here).
export const DRIVERS = defs.drivers;
export const ATTRIBUTION = defs.attribution;
export const DRIVER_TAG = 'your assumption';
export const DATA_TAG = 'from data';

const text = (v) => String(v ?? '').trim();
const numberOf = (v) => (text(v) === '' ? NaN : Number(text(v)));
const inRange = (n, kind) => Number.isFinite(n) && n >= 0 && (kind !== 'pct' || n <= 100);

// Typed boxes by driver id and input id, from saved numbers.
export const valuesOfAnswers = (drivers) => Object.fromEntries(Object.entries(drivers && typeof drivers === 'object' ? drivers : {})
  .map(([id, inputs]) => [id, Object.fromEntries(Object.entries(inputs || {}).map(([k, v]) => [k, String(v)]))]));

export const driverFilled = (typed, driver) => driver.inputs.some((i) => text(typed?.[driver.id]?.[i.id]) !== '');

// Only a part with something typed is sent. A part with some boxes empty or out of range blocks Calculate with one line saying which.
export function driverAnswersOf(typed) {
  const drivers = {};
  let incomplete = '';
  for (const d of DRIVERS) {
    if (!driverFilled(typed, d)) continue;
    const values = d.inputs.map((i) => numberOf(typed[d.id][i.id]));
    if (values.every((n, k) => inRange(n, d.inputs[k].kind))) drivers[d.id] = Object.fromEntries(d.inputs.map((i, k) => [i.id, values[k]]));
    else if (!incomplete) incomplete = `${d.label}: fill every box with a number of 0 or more (a percent is 0 to 100).`;
  }
  return { drivers, incomplete };
}

export const attributionOf = (typed) => {
  const n = numberOf(typed);
  return n >= ATTRIBUTION.min && n <= ATTRIBUTION.max ? n : null;
};

// The total of a saved or calculated value as short text ("$888K"): the server's total when it sent parts, else the first entry.
export const totalTextOf = (yearly) => {
  const entries = yearly?.total ? [{ kind: 'money', ...yearly.total }] : yearly?.entries;
  return valueChips(entries, 1).shown[0]?.text || '';
};
