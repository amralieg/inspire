// REQ-574 / REQ-571: the gallery of the 12 approved infographic concepts, each drawn for the use case it was approved with, in the
// orientation it was shown in. The drawing is the same one the documents use (concepts.js); content comes only from the use case.
import { drawConcept } from './concepts.js';
import { contentFor } from './content.js';

const build = (pattern, orientation) => (row) => drawConcept(pattern, contentFor(row, pattern), orientation);
export const CONCEPTS = [
  { n: 1, pattern: 'journey', orientation: 'landscape', uc: 'N09-U01', idea: 'a winding road with numbered stops and the slowest wait called out' },
  { n: 2, pattern: 'cycle', orientation: 'portrait', uc: 'N06-U04', idea: 'a loop wheel of the steps with the headline result in the hub' },
  { n: 3, pattern: 'isometric', orientation: 'landscape', uc: 'N04-U02', idea: 'data stack to model to a cloud of scenarios to the screen a person decides on' },
  { n: 4, pattern: 'pictogram', orientation: 'portrait', uc: 'N01-U04', idea: '100 units of the value at stake, the share the use case is about filled in' },
  { n: 5, pattern: 'beforeafter', orientation: 'landscape', uc: 'N02-U02', idea: 'today against the new way, with the steps that make the change' },
  { n: 6, pattern: 'timeline', orientation: 'landscape', uc: 'N03-U01', idea: 'a history line running into a widening forecast band past today' },
  { n: 7, pattern: 'funnel', orientation: 'portrait', uc: 'N01-U01', idea: 'a funnel from the wide set to the few to act on, a number in every stage' },
  { n: 8, pattern: 'hub', orientation: 'landscape', uc: 'N11-U01', idea: 'a person asks, the central capability draws on the sources around it' },
  { n: 9, pattern: 'map', orientation: 'portrait', uc: 'N10-U01', idea: 'a drawn map with numbered pins and a route between them' },
  { n: 10, pattern: 'network', orientation: 'landscape', uc: 'N10-U03', idea: 'a dark constellation of linked clusters, the new ones glowing' },
  { n: 11, pattern: 'waterfall', orientation: 'portrait', uc: 'N12-U01', idea: 'a bridge of what each driver took or added, an icon over every bar' },
  { n: 12, pattern: 'balance', orientation: 'portrait', uc: 'N08-U01', idea: 'a balance scale of the measured effect, then a keep, change or stop split' },
].map((c) => ({ ...c, build: build(c.pattern, c.orientation) }));

export function galleryFor(rows) {
  const byId = new Map(rows.map((r) => [String(r.No), r]));
  return CONCEPTS.filter((c) => byId.has(c.uc)).map((c) => ({ ...c, file: `${String(c.n).padStart(2, '0')}_${c.pattern}_${c.orientation}`, svg: c.build(byId.get(c.uc)) }));
}
