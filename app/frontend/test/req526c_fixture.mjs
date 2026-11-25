// REQ-526 part C: the shared model the brief page tests and the snapshot use.
import fs from 'node:fs';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
export const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name })));
export const VALUED = UCS.slice(0, 20);
export const ALL_BLOCKS = ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'];
const VERBS = ['GROW REVENUE', 'AVOID RISK', 'CUT COST'];
export const yearsOf = (i) => [1, 2, 3].map((year) => ({ year, low: 20000 + i * 5000 * year, likely: 40000 + i * 12500 * year, high: 70000 + i * 20000 * year }));
export const mkValues = ({ yearly = true } = {}) => Object.fromEntries(VALUED.map((u, i) => [u.No, { amount: 40000 + i * 12500, currency: 'USD', status: i % 2 ? 'calculated' : 'estimated', verb: VERBS[i % 3],
  story: 'It pays back within the first year because the manual review step disappears.', yearly: yearly ? yearsOf(i) : [], factors: [] }]));
export const model = ({ values = mkValues(), blocks = ALL_BLOCKS, language = 'English', ucs = UCS } = {}) =>
  buildDocModel({ businessName: 'Acme Bakes', useCases: ucs, values, options: { ...defaultDocOptions(language), blocks } });
