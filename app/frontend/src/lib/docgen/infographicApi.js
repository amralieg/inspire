// C28 (REQ-570): the interface the dialog codes against for the per use case infographic. The c28_infog lane replaces this stub with the real
// layouts: infographicFor(useCase, { orientation, scenario, content, theme, logo, ... }) returns an SVG string; INFOGRAPHIC_STYLES is [{ id, name, thumbnail }].
import { buildDocModel } from './docModel.js';
import { infographicSvg } from './docSvg.js';
import { buildAgentModel } from './agentModel.js';
import { DOC_STYLES, resolveTheme } from './docStyles.js';

// STUB until c28_infog merges: the styles are the existing designs, with no thumbnail yet (the dialog draws one when it is empty).
export const INFOGRAPHIC_STYLES = DOC_STYLES.map((s) => ({ id: s.id, name: s.label, thumbnail: '' }));

// STUB: the existing infographic of one use case; orientation is not applied until c28_infog merges.
export function infographicFor(useCase, { businessName = '', values = {}, theme = 'light', style = 'original', palette = 'databricks', customColor = '', content } = {}) {
  const options = content ? { blocks: content } : {};
  const m = buildDocModel({ businessName, useCases: [useCase], values, options });
  const views = buildAgentModel({ businessName, useCases: [useCase], values }).ranked;
  return infographicSvg(m, resolveTheme(style, palette, customColor, theme), views);
}
