export const HUES = ['blue', 'teal', 'amber', 'green', 'violet', 'coral', 'plum', 'rose', 'slate'];
export const SERIES_TOKENS = HUES.map((h) => `${h}-line`);
export const TIER_TOKENS = { 'Act now': 'brand', Review: 'amber-line', Monitor: 'slate-line' };

export function themeTokens(palettes, palette, theme) {
  const dark = theme === 'dark';
  const p = (palettes[palette] || palettes.default)[dark ? 'dark' : 'light'];
  const out = { ...p.base, 'btn-bg': dark ? p.base.brand : p.base['brand-ink'], 'btn-fg': dark ? p.base.bg : '#ffffff' };
  HUES.forEach((h) => Object.entries(p.hues[h]).forEach(([k, v]) => { out[`${h}-${k}`] = v; }));
  return out;
}
