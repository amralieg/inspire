export const NOT_RECORDED = 'Not recorded';
export const DATE_FORMATS = ['date', 'month'];

const WHOLE_TEXT = /^[-+]?\d+$/;

export function bigWhole(v) {
  const text = typeof v === 'string' ? v.trim() : '';
  return WHOLE_TEXT.test(text) && !Number.isSafeInteger(Number(text)) ? BigInt(text) : null;
}

export function grouped(n, options) {
  const big = bigWhole(n);
  return big == null ? Number(n).toLocaleString('en-US', options) : big.toLocaleString('en-US');
}

const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function partsOf(v) {
  if (typeof v === 'bigint') return [v, 0];
  const text = typeof v === 'string' ? v.trim() : null;
  if (text != null && WHOLE_TEXT.test(text)) return [BigInt(text), 0];
  const n = text != null ? (NUMBER_TEXT.test(text) ? Number(text) : NaN) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  return [BigInt(whole), n - whole];
}

export const isAmount = (v) => partsOf(v) != null;

export function addCounts(values) {
  let whole = 0n;
  let part = 0;
  (values || []).forEach((v) => {
    const p = partsOf(v);
    if (p) {
      whole += p[0];
      part += p[1];
    }
  });
  const carry = Math.trunc(part);
  whole += BigInt(carry);
  part -= carry;
  return whole >= -SAFE && whole <= SAFE ? Number(whole) + part : String(whole + BigInt(Math.round(part)));
}

export const sumOf = (items, pick = (x) => x) => addCounts((items || []).map(pick));
export const countOf = (v) => addCounts([v]);

export function numberOf(v) {
  const p = partsOf(v);
  return p ? Number(p[0]) + p[1] : 0;
}

export const percentOf = (part, whole) => Math.round((numberOf(part) / numberOf(whole)) * 100);

export function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const [x, y] = [partsOf(a), partsOf(b)];
  if (x && y) return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : Math.sign(x[1] - y[1]);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export const largestFirst = (a, b) => (a == null) - (b == null) || compareValues(b, a);

export function compact(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return NOT_RECORDED;
  const v = Number(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(digits).replace(/\.0$/, '') + 'K';
  return sign + (a % 1 ? a.toFixed(2).replace(/\.?0+$/, '') : String(a));
}

const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ', JPY: '¥', INR: '₹' };

const MONEY_CODES = new Set((
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP '
  + 'CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR '
  + 'IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR '
  + 'MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE '
  + 'SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XCG XOF '
  + 'XPF YER ZAR ZMW ZWG ZWL').split(' '));

export const isCurrency = (unit) => MONEY_CODES.has(String(unit || '').trim());
export const unitOf = (x) => String(x?.unit ?? x?.currency ?? '');
export const kindOf = (x) => String(x?.impact_kind ?? '');
export const isMoney = (unit, kind) => (kind ? kind === 'money' : !String(unit || '').trim() || isCurrency(unit));
export const shownUnit = (unit, named, kind) => (isMoney(unit, kind) ? named || unit || '' : unit);
const counted = (v, unit) => `${grouped(v, { maximumFractionDigits: 2 })} ${unit}`;

export const stakeNoun = (unit, kind) => {
  const label = String(unit || '').trim().replace(/\s+/g, ' ');
  return isMoney(label, kind) ? 'money' : label || kind;
};

export const stakeWords = (unit, kind) => `${stakeNoun(unit, kind)} at stake`;

export function stakeName(unit, kind) {
  return cap(stakeWords(unit, kind));
}

export function stakeNameOf(units, kinds = []) {
  const named = [...new Set((units || []).map((unit, i) => stakeName(unit, kinds[i])))];
  return named.length <= 1 ? named[0] || stakeName('') : 'At stake';
}

const SAVED_VERBS = { count: 'avoided', percent: 'moved' };

export const savedVerb = (unit, kind) => (isMoney(unit, kind) ? 'saved' : SAVED_VERBS[kind] || 'saved');

export const savedWords = (unit, kind) => `${stakeNoun(unit, kind)} it ${savedVerb(unit, kind)}`;

export function money(n, currency = 'USD', digits, kind) {
  if (n == null || !Number.isFinite(Number(n))) return NOT_RECORDED;
  const v = Number(n);
  if (currency && !isMoney(currency, kind)) return `${compact(v, digits)} ${currency}`;
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return (v < 0 ? '-' : '') + symbol + compact(Math.abs(v), digits);
}

export function wholeMoney(n, currency, kind) {
  if (n == null || !Number.isFinite(Number(n))) return NOT_RECORDED;
  if (currency && !isMoney(currency, kind)) return counted(n, currency);
  const big = bigWhole(n);
  const v = big ?? Math.round(Number(n));
  const symbol = currency ? SYMBOLS[currency] ?? `${currency} ` : '';
  return (v < 0 ? '-' : '') + symbol + (big == null ? Math.abs(v) : v < 0 ? -v : v).toLocaleString('en-US');
}

export function integer(n) {
  if (n == null || !Number.isFinite(Number(n))) return NOT_RECORDED;
  return bigWhole(n) == null ? Math.round(Number(n)).toLocaleString('en-US') : grouped(n);
}

export const percent = (n, digits = 1) => (n == null || !Number.isFinite(Number(n)) ? NOT_RECORDED : `${Number(n).toFixed(digits)}%`);

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const asDate = (v) => {
  const text = String(v ?? '').trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const d = new Date(text.length <= 10 ? `${text}T00:00:00Z` : /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const monthLabel = (v) => { const d = asDate(v); return d ? MONTH.format(d) : String(v ?? ''); };
export const shortMonth = (v) => { const d = asDate(v); return d ? SHORT_MONTH.format(d) : String(v ?? ''); };
export const dayLabel = (v) => { const d = asDate(v); return d ? DAY.format(d) : String(v ?? ''); };

export function plainText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(' · ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${plainText(x)}`).join(' · ');
  return String(v);
}

const wordsOf = (text) => plainText(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export function addedParts(name, parts) {
  const seen = new Set(wordsOf(name));
  return parts.map((part) => {
    const words = wordsOf(part);
    if (!words.some((w) => !seen.has(w))) return '';
    words.forEach((w) => seen.add(w));
    return plainText(part).trim();
  });
}

export function formatValue(v, format = 'number', currency = 'USD', digits, kind) {
  if (v == null || v === '') return NOT_RECORDED;
  if (typeof v === 'object') return plainText(v) || NOT_RECORDED;
  switch (format) {
    case 'currency': return money(v, currency, digits, kind);
    case 'integer': return integer(v);
    case 'percent': return percent(v);
    case 'date': return dayLabel(v);
    case 'month': return monthLabel(v);
    case 'text': return plainText(v);
    default: return bigWhole(v) != null ? integer(v) : Number.isFinite(Number(v)) ? compact(v, digits) : plainText(v);
  }
}

const KEY_WORDS = new Set(['id', 'ids', 'key', 'keys', 'code', 'codes', 'zip', 'zips', 'zipcode', 'postcode', 'postal', 'year', 'years', 'yr', 'fips', 'sku', 'isbn', 'phone', 'uuid', 'guid']);
const KEY_ENDINGS = /(key|zip|zipcode|postcode|uuid|guid)$/;
const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INT|INTEGER|BIGINT|LONG|SHORT|BYTE|FLOAT|DOUBLE|DECIMAL)/i;

export function isKeyColumn(name, type) {
  if (/^(DATE|TIMESTAMP)/i.test(String(type || ''))) return false;
  const words = String(name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => KEY_WORDS.has(w) || KEY_ENDINGS.test(w));
}

const wordList = (name) => String(name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const COUNT_WORDS = new Set(['unit', 'units', 'qty', 'count', 'counts', 'orders', 'items', 'pieces', 'pcs', 'customers', 'people', 'visits', 'trips', 'calls',
  'tickets', 'cases', 'decisions', 'records', 'rows', 'shipments', 'packages', 'transactions', 'sessions', 'users', 'employees', 'patients', 'beds', 'seats',
  'vehicles', 'stores', 'issues', 'alerts', 'claims', 'loans', 'accounts', 'members', 'products', 'skus', 'lines', 'boxes', 'pallets', 'cartons', 'loaves']);
const SPREAD_WORDS = new Set(['avg', 'average', 'mean', 'per', 'rate', 'ratio', 'share', 'pct', 'percent', 'percentage', 'mase', 'mape', 'error', 'score', 'std', 'variance', 'probability', 'prob']);

export function isCountable(...names) {
  return names.some((name) => {
    const words = wordList(name);
    return words.some((w) => COUNT_WORDS.has(w)) && !words.some((w) => SPREAD_WORDS.has(w));
  });
}

export const wholeFormat = (format, ...names) => ((!format || format === 'number') && isCountable(...names) ? 'integer' : format);

export const kpiHasValue = (data) => data?.now != null || (data?.by_currency?.length > 0);

export function kpiText(kpi, data) {
  const format = wholeFormat(kpi.format, kpi.label, kpi.unit, kpi.id);
  if (data?.by_currency?.length) return data.by_currency.map((c) => formatValue(c.now, format, c.currency)).join(' · ');
  return formatValue(data?.now, format, kpi.currency);
}

const JARGON = [
  [/\berror\s*\(\s*mase\s*\)|\bmase\b/gi, 'forecast error vs a simple guess'],
  [/\bs?mape\b/gi, 'forecast error %'],
  [/\bp50\b|\bmedian forecast\b/gi, 'likely'],
  [/\bp(?:9[05]|8[05])\b/gi, 'high case'],
  [/\bp(?:0?5|10|15|20)\b/gi, 'low case'],
  [/\bquantiles?\b/gi, 'range'],
  [/\bqty\b/gi, 'quantity'],
  [/\bpct\b/gi, '%'],
];

export function plainWords(text) {
  if (text == null || typeof text !== 'string') return text;
  const raw = text.trim();
  const code = /_/.test(raw) || /^[A-Z0-9 ]+$/.test(raw) || /^[a-z]+[A-Z]/.test(raw);
  let out = code ? wordList(raw).join(' ') : raw;
  JARGON.forEach(([from, to]) => { out = out.replace(from, to); });
  out = out.replace(/\s+/g, ' ').trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : raw;
}

const AGGREGATE_WORDS = { sum: 'Total', avg: 'Average', count: 'Count', min: 'Lowest', max: 'Highest' };

export function answerLabel(name) {
  const call = /^(\w+)\((.*)\)$/.exec(String(name ?? '').trim());
  const word = call && AGGREGATE_WORDS[call[1].toLowerCase()];
  if (!word) return plainWords(name);
  return `${word} ${String(plainWords(call[2]) ?? '').toLowerCase()}`;
}

export function plainChart(chart) {
  const y = Array.isArray(chart?.y) ? chart.y.map((s) => ({ ...s, label: plainWords(s.label), format: wholeFormat(s.format, s.label) })) : chart?.y;
  return { ...chart, y, ...(chart?.x ? { x: { ...chart.x, label: plainWords(chart.x.label) } } : {}) };
}

const NAME_ENDINGS = ['name', 'label', 'title', 'description', 'desc'];

export function entityName(row, column, { ids = true } = {}) {
  const v = row?.[column];
  if (v == null || v === '') return '';
  if (/[A-Za-z]/.test(String(v))) return plainText(v);
  if (!isKeyColumn(column)) return ids ? plainText(v) : '';
  const stem = wordList(column).filter((w) => !KEY_WORDS.has(w) && !KEY_ENDINGS.test(w)).join('_');
  const norm = (k) => wordList(k).join('_');
  const wanted = stem ? [...NAME_ENDINGS.map((e) => `${stem}_${e}`), stem] : NAME_ENDINGS;
  const named = Object.keys(row).filter((k) => k !== column && wanted.includes(norm(k)))
    .sort((a, b) => wanted.indexOf(norm(a)) - wanted.indexOf(norm(b)))
    .find((k) => /[A-Za-z]/.test(String(row[k] ?? '')));
  if (named) return plainText(row[named]);
  return ids ? `${cap(stem.replace(/_/g, ' ') || 'item')} ${plainText(v)}` : '';
}

export function fullNumber(v) {
  if (bigWhole(v) != null) return integer(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return plainText(v);
  return Number.isInteger(n) ? integer(n) : grouped(n, { maximumFractionDigits: 2 });
}

export function cellText(v, column = {}) {
  if (v == null || v === '') return NOT_RECORDED;
  const name = column.column ?? column.name;
  if (isKeyColumn(name, column.type) && (!column.format || ['number', 'integer', 'text'].includes(column.format))) return plainText(v);
  const whole = isCountable(name, column.label);
  if (column.format === 'number' || column.format === 'integer') return isAmount(v) ? (whole ? integer(v) : fullNumber(v)) : plainText(v);
  if (column.format) return formatValue(v, column.format, column.currency);
  const numeric = typeof v === 'number' || typeof v === 'bigint' || NUMERIC_TYPE.test(String(column.type || ''));
  return numeric && isAmount(v) ? (whole ? integer(v) : fullNumber(v)) : plainText(v);
}

const exactDigits = (x) => [0, 1, 2].find((d) => Math.abs(Number(x.toFixed(d)) - x) <= 1e-9 * Math.max(1, Math.abs(x))) ?? 3;
const shownScale = (a) => (a >= 1e9 ? a / 1e9 : a >= 1e6 ? a / 1e6 : a >= 1e3 ? a / 1e3 : a);

export function axisValue(v, format, currency) {
  const n = Number(v);
  if (format === 'percent') return `${n.toFixed(exactDigits(n))}%`;
  const digits = exactDigits(shownScale(Math.abs(n)));
  return format === 'currency' ? money(v, currency, digits) : compact(v, digits);
}

export function change(now, before) {
  if (now == null || before == null || !Number.isFinite(Number(now)) || !Number.isFinite(Number(before))) return null;
  if (Number(before) === 0) return Number(now) === 0 ? 0 : Math.sign(Number(now)) * Infinity;
  return ((Number(now) - Number(before)) / Math.abs(Number(before))) * 100;
}

export function changeParts(d, words) {
  const size = Math.abs(d).toFixed(1);
  if (Number.isFinite(d) && Number(size) === 0) return { way: 'same', text: words.same };
  return { way: d > 0 ? 'up' : 'down', text: Number.isFinite(d) ? `${size}%` : words.from_zero };
}

export function changeText(d, words) {
  const { way, text } = changeParts(d, words);
  return way === 'same' ? text : `${way} ${text}`;
}

const STORY_TOKEN = /(\{[A-Za-z_][A-Za-z0-9_]*(?::change)?\})/g;
const COMPARED_TO = /^\s*(?:on|over|versus|vs\.?|against|compared\s+(?:to|with)|relative\s+to|from)\s[^,;.!?{}]*(?=[,;.!?]|$)/i;

export function storyPieces(story, kpis, data) {
  const byId = Object.fromEntries((kpis || []).map((k) => [k.id, k]));
  const parts = String(story ?? '').split(STORY_TOKEN);
  const used = parts.map((p) => /^\{([A-Za-z_][A-Za-z0-9_]*)(?::change)?\}$/.exec(p)?.[1]).filter((id) => byId[id]);
  if (used.some((id) => !kpiHasValue(data?.[id]) || data[id].now === '')) return [];
  const out = [];
  let noneSaid = false;
  for (let i = 0; i < parts.length; i += 1) {
    const m = /^\{([A-Za-z_][A-Za-z0-9_]*)(:change)?\}$/.exec(parts[i]);
    const kpi = m && byId[m[1]];
    if (!kpi) {
      if (parts[i]) out.push({ text: parts[i] });
      continue;
    }
    const value = data?.[kpi.id];
    if (!m[2]) {
      out.push({ text: kpiText(kpi, value), strong: true });
      continue;
    }
    const d = change(value?.now, value?.before);
    if (d == null) {
      if (value?.before == null && !noneSaid) {
        out.push({ text: kpi.words.story_none });
        noneSaid = true;
      } else if (out.length && !out[out.length - 1].strong) out[out.length - 1].text = out[out.length - 1].text.replace(/[,;:]?\s*$/, '');
      const next = parts[i + 1] ?? '';
      const compared = COMPARED_TO.exec(next);
      if (compared && (compared[0].length < next.length || i + 2 >= parts.length)) parts[i + 1] = next.slice(compared[0].length);
      continue;
    }
    const { way } = changeParts(d, kpi.words);
    const good = kpi.good === 'neutral' || way === 'same' ? null : (kpi.good === 'down') === d < 0;
    out.push({ text: changeText(d, kpi.words), strong: true, tone: good == null ? '' : good ? 'good' : 'up' });
  }
  return out;
}

export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
