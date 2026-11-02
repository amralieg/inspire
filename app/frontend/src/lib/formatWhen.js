export function formatWhen(value, fallback = '') {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

export function utcDate(value) {
  const text = String(value ?? '').trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  if (!text) return null;
  const zoned = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text;
  const d = new Date(zoned);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDay(value, fallback = '') {
  const d = utcDate(value);
  return d ? DAY.format(d) : fallback;
}

export function formatClockUtc(value, now = null) {
  const d = utcDate(value);
  if (!d) return '';
  const today = Number.isFinite(now) && DAY.format(new Date(now)) === DAY.format(d);
  return `${today ? '' : `${SHORT_DAY.format(d)}, `}${CLOCK.format(d)} UTC`;
}

export function formatDuration(ms, empty = '') {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return empty;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
