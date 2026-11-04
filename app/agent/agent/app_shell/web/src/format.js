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
  return sign + (a % 1 ? a.toFixed(2) : String(a));
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

export function axisValue(v, format, currency) {
  if (format === 'currency') return money(v, currency, 0);
  if (format === 'percent') return `${Number(v).toFixed(0)}%`;
  return compact(v, 0);
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
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const m = /^\{([A-Za-z_][A-Za-z0-9_]*)(:change)?\}$/.exec(parts[i]);
    const kpi = m && byId[m[1]];
    if (!kpi) {
      if (parts[i]) out.push({ text: parts[i] });
      continue;
    }
    const value = data?.[kpi.id];
    if (!m[2]) {
      out.push({ text: formatValue(value?.now, kpi.format, kpi.currency), strong: true });
      continue;
    }
    const d = change(value?.now, value?.before);
    if (d == null) {
      if (value?.before == null) out.push({ text: kpi.words.story_none });
      else if (out.length && !out[out.length - 1].strong) out[out.length - 1].text = out[out.length - 1].text.replace(/[,;:]?\s*$/, '');
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
