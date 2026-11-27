// REQ-574 / REQ-571: business-neutral line icons for the infographic library (lucide-style: viewBox 24, round caps, stroke only).
// icon(name, x, y, size, color) draws one icon as a <g data-icon> so tests can count them.
export const ICONS = {
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  bars: '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="8" rx="1"/><rect x="10.5" y="6" width="3" height="13" rx="1"/><rect x="16" y="14" width="3" height="5" rx="1"/>',
  pie: '<path d="M21 12A9 9 0 1112 3v9z"/><path d="M15 3.5A9 9 0 0120.5 9H15z"/>',
  trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  gauge: '<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/><circle cx="12" cy="18" r="1.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14c2.6 0 4.5 2 4.5 5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9c-.6-1.2-1.8-1.8-3-1.8-1.7 0-3 .9-3 2.3 0 3.2 6 1.6 6 4.8 0 1.4-1.3 2.4-3 2.4-1.3 0-2.6-.7-3.2-1.9M12 5.5v1.7M12 16.8v1.7"/>',
  wallet: '<path d="M3 7a2 2 0 012-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
  receipt: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  document: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',
  checklist: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.5L16 9.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3M12 15v2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  filter: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  brain: '<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h1V4z"/><path d="M15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3h-1V4z"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  lightbulb: '<path d="M9 18h6M10 21h4"/><path d="M8 14a6 6 0 118 0c-1 1-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3z"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M11 7.2L6.2 15.8M13 7.2l4.8 8.6M7.5 18h9"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/>',
  box: '<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7M12 11.5v10"/>',
  truck: '<rect x="2" y="6" width="12" height="10" rx="1"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  building: '<rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 9h6v12H14M7 7h1M10 7h1M7 11h1M10 11h1M7 15h1M10 15h1M3 21h18"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 00-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  flow: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h5a5 5 0 015 5M7 18h5a5 5 0 005-5"/>',
  split: '<path d="M4 12h6l5-6h5M10 12l5 6h5"/><path d="M18 4l2 2-2 2M18 16l2 2-2 2"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 006 0zM19 7l-3 6a3 3 0 006 0z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  rocket: '<path d="M12 3c4 2 6 6 6 10l-3 3H9l-3-3c0-4 2-8 6-10z"/><circle cx="12" cy="10" r="2"/><path d="M9 16l-2 5 3-2M15 16l2 5-3-2"/>',
  handshake: '<path d="M2 11l4-4 4 2 3-2 3 2 4-2 2 4-4 4-3 3a1.5 1.5 0 01-2 0l-5-5"/><path d="M10 9l-2 2a1.5 1.5 0 002 2l2-2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11h11l2-8H6.3"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.5-4.5L3 9M4 13a8 8 0 0014.5 4.5L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 000-7H8a3.5 3.5 0 010-7h7.5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
};

// One icon at (x, y) top-left, `size` px square, stroked in `color`.
export function icon(name, x, y, size, color, sw = 1.8) {
  const k = size / 24;
  return `<g data-icon="${name}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.sparkles}</g>`;
}

// An icon centred on a filled disc (the "icon + number" anchor).
export function iconDisc(name, cx, cy, r, fill, stroke = '#ffffff') {
  const s = r * 1.1;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>${icon(name, cx - s / 2, cy - s / 2, s, stroke, 2)}`;
}

// Picks a business-neutral icon from words in a sentence (generic verbs and nouns only).
const WORDS = [
  [/forecast|predict|trend|rise/i, 'trendUp'], [/learn|model|cluster|similar/i, 'brain'], [/solver|optimi|pick|plan/i, 'sliders'],
  [/score|chance|risk|probab/i, 'gauge'], [/match|check|test|control|flag/i, 'shield'], [/\bcalls?\b|phone/i, 'phone'], [/list|queue/i, 'checklist'],
  [/map|location|site|place|catchment/i, 'pin'], [/network|link|node|ring|communit/i, 'network'], [/time|wait|hour|day|week/i, 'clock'],
  [/invoice|bill|payment|cash/i, 'receipt'], [/margin|cost|price|spend|\$/i, 'coin'], [/compare|peer|bench|baseline/i, 'scale'],
  [/question|ask|answer|summar/i, 'message'], [/dashboard|view|cockpit|explorer|readout|desk|lab/i, 'monitor'],
  [/split|bridge|driver|decompos/i, 'bars'], [/event|log|path|step|flow/i, 'route'], [/accept|override|approve|call\b|keep/i, 'check'],
  [/ship|deliver|freight|transport/i, 'truck'], [/contract|agreement|terms/i, 'document'],
  [/sales|order|buy|basket/i, 'cart'], [/group|segment|buyer|customer|account/i, 'users'], [/data|table|history|year/i, 'database'],
];
export const iconFor = (text, fallback = 'sparkles') => (WORDS.find(([re]) => re.test(String(text || ''))) || [0, fallback])[1];

// Icons for a list of labels, each one different (first matching word not used yet, then a neutral fallback).
export function distinctIcons(labels, fallback = ['database', 'brain', 'monitor', 'users', 'check', 'sparkles', 'layers', 'target']) {
  const used = new Set();
  return labels.map((t) => { const pick = WORDS.filter(([re]) => re.test(String(t || ''))).map(([, n]) => n).find((n) => !used.has(n)) || fallback.find((n) => !used.has(n)) || 'sparkles'; used.add(pick); return pick; });
}
