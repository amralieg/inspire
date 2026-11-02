import { dayLabel } from './format.js';

export const GROUPS = [
  ['impact', 'How the impact is worked out'],
  ['flagging', 'When a record is flagged'],
  ['scope', 'What each run covers'],
  ['alerts', 'Alerts'],
];
const ALL = 'all';
const NUMBER = /^-?[0-9]+(?:\.[0-9]+)?$/;

export function settingProblem(setting, value) {
  const name = String(setting?.name || '');
  const text = String(value ?? '').trim();
  if (setting?.kind === 'choice') {
    const choices = (setting.choices || []).map(String);
    const picked = setting.many ? text.split(',').map((p) => p.trim()).filter(Boolean) : [text];
    const allowed = setting.many ? [...choices, ALL] : choices;
    if ((!text && !setting.optional) || (choices.length && picked.some((p) => !allowed.includes(p)))) {
      return `${name} is '${text}'; allowed: ${choices.length ? allowed.join(', ') : 'any text'}`;
    }
    const alone = picked.filter((p) => (setting.solo || []).includes(p));
    if (alone.length && picked.length > 1) {
      return `${name} is '${text}'; ${alone.join(' and ')} stand${alone.length === 1 ? 's' : ''} alone, never with another choice`;
    }
    return '';
  }
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const low = num(setting?.low);
  const high = num(setting?.high);
  const whole = !!setting?.whole;
  const number = NUMBER.test(text) && !(whole && text.includes('.')) ? Number(text) : null;
  if (number === null || (low !== null && (setting.low_open ? number <= low : number < low))
    || (high !== null && (setting.high_open ? number >= high : number > high))) {
    return `${name} is '${text}'; allowed: ${setting?.allowed || 'a number'}`;
  }
  return '';
}

export function inputText(setting, value) {
  if (value === null || value === undefined || value === '') return '';
  if (setting.kind === 'percent' && NUMBER.test(String(value).trim())) return String(Number((Number(value) * 100).toPrecision(12)));
  return String(value);
}

export function storedText(setting, text) {
  const trimmed = String(text ?? '').trim();
  if (setting.kind === 'percent' && NUMBER.test(trimmed)) return String(Number((Number(trimmed) / 100).toPrecision(12)));
  return trimmed;
}

export function valueText(setting, value) {
  if (value === null || value === undefined || value === '') return 'not set';
  if (setting.kind === 'choice') return String(value) === ALL ? 'every segment' : String(value).split(',').map((p) => p.trim()).join(', ');
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (setting.kind === 'percent') return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  const shown = n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return setting.unit && setting.unit !== '%' ? `${shown} ${setting.unit}` : shown;
}

export const ownerSettings = (data) => !!(data?.editable && data.settings?.length);

export const groupsOf = (settings) => GROUPS.map(([id, label]) => [id, label, (settings || []).filter((s) => s.group === id)]).filter(([, , list]) => list.length);

export function historyLines(history, settings) {
  const byName = Object.fromEntries((settings || []).map((s) => [s.name, s]));
  return (history || []).filter((h) => byName[h.name]).map((h, i, all) => {
    const setting = byName[h.name];
    const older = all.slice(i + 1).find((x) => x.name === h.name);
    const when = h.changed_at ? `${dayLabel(String(h.changed_at).slice(0, 10))}, ` : '';
    const from = older ? ` from ${valueText(setting, older.value)}` : '';
    return `${when}${h.changed_by || 'someone'} set ${setting.label || setting.name}${from} to ${valueText(setting, h.value)}${h.note ? `: ${h.note}` : ''}`;
  });
}
