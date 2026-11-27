// C28 (REQ-571): the two names the Generate docs dialog codes against. infographicFor draws one use case as an SVG (the style, palette and
// custom colour pick the theme when no theme is given); INFOGRAPHIC_STYLES lists the scenario layouts with a thumbnail each.
import { infographicFor as draw, infographicStyles } from './designs/infographic.js';
import { resolveTheme } from './docStyles.js';

export function infographicFor(useCase, { orientation = 'landscape', scenario = '', content = null, theme = null, logo = '', style = '', palette = '', customColor = '', rtl = false } = {}) {
  const t = theme || (style || palette || customColor ? resolveTheme(style, palette, customColor, 'light') : null);
  return draw(useCase, { orientation, scenario, content, theme: t, logo, rtl });
}

export const INFOGRAPHIC_STYLES = infographicStyles(null).map((s) => ({ id: s.id, name: s.name, description: s.description, thumbnail: s.thumbnails.landscape, thumbnails: s.thumbnails }));
