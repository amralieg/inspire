// C29 (REQ-571, REQ-574): the per use case infographic. One of the 12 approved concepts (infog/concepts.js) draws the use case's story in
// landscape (16:9) or portrait (A4), each orientation laid out on its own. The concept is the user's choice when one is given (user input wins),
// else the AI pick's, else the local picker's (infographicPick.js). `content` is a validated pick; every field it leaves out comes from the use case.
import { SCENARIOS, SCENARIO_IDS } from '../../../../../backend/lib/infographicPick.mjs';
import { rtlSvg } from './core.js';
import { P } from './infog/shapes.js';
import { drawConcept, SIZE } from './infog/concepts.js';
import { contentFor } from './infog/content.js';
import { fallbackPick } from './infographicPick.js';

export { SCENARIO_IDS };
export const DIMS = { landscape: { W: SIZE.landscape.w, H: SIZE.landscape.h }, portrait: { W: SIZE.portrait.w, H: SIZE.portrait.h } };

// The infographic of one use case: { svg, scenario, width, height }.
export function renderInfographic(useCase, { orientation = 'landscape', scenario = '', content = null, theme = null, logo = '', rtl = false } = {}) {
  const row = useCase && typeof useCase === 'object' ? useCase : {};
  const orient = orientation === 'portrait' ? 'portrait' : 'landscape';
  const pick = content && typeof content === 'object' ? content : null;
  const id = SCENARIO_IDS.includes(scenario) ? scenario : pick && SCENARIO_IDS.includes(pick.scenario) ? pick.scenario : fallbackPick(row).scenario;
  const accent = theme && Array.isArray(theme.accents) && /^#[0-9a-f]{6}$/i.test(theme.accents[0] || '') ? theme.accents[0] : '';
  const keep = P.lava;
  let svg;
  try { if (accent) P.lava = accent; svg = drawConcept(id, contentFor(row, id, pick), orient, { logo: logo || '' }); } finally { P.lava = keep; }
  if (rtl) svg = rtlSvg(svg);
  return { svg, scenario: id, width: DIMS[orient].W, height: DIMS[orient].H };
}
export const infographicFor = (useCase, o = {}) => renderInfographic(useCase, o).svg;

// ---------- the examples the dialog shows: each concept drawn by the same library from one neutral sample ----------
const SAMPLE = {
  No: '', Name: 'From signals to action', 'Analytics Technique': 'Sample', 'Decision Cadence': 'Weekly', Beneficiary: 'The planning team',
  Statement: '1,200 items wait 9.5 hours at one step and 40% of the value sits in a few of them. The total fell $0.30M: volume took $0.18M, price $0.08M and mix $0.04M.',
  Solution: 'Sample: a model learns the pattern, scores every item and ranks the best moves.',
  'Business Value': 'Value kept by acting first. At stake: $1.2M a year.',
  serving_summary: 'A ranked list on screen: the next moves, with the reasons.',
};
const THUMB = { landscape: 'width="240" height="135"', portrait: 'width="120" height="170"' };
export function infographicStyles(theme = null) {
  const thumb = (id, o) => renderInfographic(SAMPLE, { orientation: o, scenario: id, theme }).svg.replace(/width="\d+" height="\d+"/, THUMB[o]);
  return SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.when, orientations: ['landscape', 'portrait'], thumbnails: { landscape: thumb(s.id, 'landscape'), portrait: thumb(s.id, 'portrait') } }));
}
