// rc.2 (REQ-152): the App's own agent answers Ask on a page with no Genie Agent space; the Open in Genie Agent link needs a space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genieOf, genieOn } from '../src/genieAsk.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (file) => readFileSync(join(here, '..', 'src', file), 'utf8');

const agentOnly = { pages: [{ id: 'n01', genie: { enabled: false, agent: true, title: '', url: '', note: '' } }] };
const noAnswer = { pages: [{ id: 'n01', genie: { enabled: false, agent: false, title: '', url: '', note: 'no model' } }] };

test('a page with no Genie Agent space still turns Ask on when the App agent can answer', () => {
  assert.equal(genieOn(agentOnly, 'n01'), true);
  assert.equal(genieOn(agentOnly, 'n01', 'agent'), true);
  assert.equal(genieOf(agentOnly, 'n01').url, '', 'no Genie Agent link without a space');
});

test('a page with neither a space nor an agent keeps Ask off', () => {
  assert.equal(genieOn(noAnswer, 'n01'), false);
});

test('the Open in Genie Agent link renders only with a space URL', () => {
  assert.match(src('Genie.jsx'), /\{url && <a href=\{url\}[^>]*>[\s\S]*?Open in Genie Agent<\/a>\}/);
});
