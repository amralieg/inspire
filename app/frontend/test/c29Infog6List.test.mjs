// C29 phase 6 (REQ-574, REQ-571): a cut never drops the last item of a list. "A, B, or C" cut before ", or C" leaves "A, B", which
// reads as whole but is not; the list comma before "and"/"or" is gated like a bare "and"/"or", so the cut moves back to before the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clip } from '../src/lib/docgen/designs/infog/text.js';
import { whoBlock } from '../src/lib/docgen/designs/infog/common.js';

test('a cut before ", or" lands before the list, never on its middle item', () => {
  const s = 'Freight invoices billed above the contract rate, duplicated, or charged for more weight than was shipped, before they are paid.';
  assert.equal(clip(s, (x) => x.length < 70), 'Freight invoices billed above the contract rate');
});

test('a closed clause before ", and" still cuts there', () => {
  const s = 'Demand rises 6% over the next 4 weeks, and the top of the range runs above capacity in 2 of the next 8 weeks.';
  assert.equal(clip(s, (x) => x.length < 60), 'Demand rises 6% over the next 4 weeks');
});

test('a comma cut never leaves a subordinate clause open ("split into what price, units sold")', () => {
  const s = 'A price-volume-mix bridge: the change in margin is split into what price, units sold, the mix of items and unit cost each contributed, line by line.';
  const c = clip(s.split(': ')[1], (x) => x.length < 75);
  assert.ok(!/what price/.test(c), c);
});

test('a one-word list item is never left without the phrase that completes it ("..., tests" before "for a decline")', () => {
  const s = 'Builds monthly margin series per brand, decomposes seasonality, tests for a monotonic decline with a trend test, and ranks brands by decline slope.';
  assert.equal(clip(s, (x) => x.length < 80), 'Builds monthly margin series per brand, decomposes seasonality');
});

test('a sponsor line that does not fit whole is left out, never shown as a bare "Sponsor:" label', () => {
  const tooLong = whoBlock(0, 0, { who: 'Customer Experience Manager', sponsor: 'Head of Customer Experience' }).svg;
  assert.doesNotMatch(tooLong, />Sponsor:?</);
  const shown = (svg) => [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]).join(' ');
  assert.match(shown(tooLong), /Sponsor: Head of Customer Experience$/);
  const short = whoBlock(0, 0, { who: 'Customer Experience Manager', sponsor: 'Head of Customer Experience' }, undefined, { maxH: 120, w: 400 }).svg;
  assert.match(short, />Head of Customer Experience</);
  const noFit = whoBlock(0, 0, { who: 'Customer Experience Manager', sponsor: 'Senior Vice President of Global Customer Experience Operations' }).svg;
  assert.doesNotMatch(noFit, /Sponsor|Senior|M8 7V5/);
  const fits = whoBlock(0, 0, { who: 'Market Manager', sponsor: 'CFO' }).svg;
  assert.match(fits, /Sponsor: CFO/);
});
