import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;

// REQ-515: two saved steps can share a step_id (sub-steps); React must not report a duplicate key. Keys are checked when the DOM renderer reconciles, so the feed is mounted in a real browser.
const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ActivityFeed from './src/components/monitor/ActivityFeed.jsx';
import ArrivingNow from './src/components/monitor/ArrivingNow.jsx';
const steps = [
  { step_id: 'S1', step_name: 'Reading tables', sub_step_name: 'a', message: 'first' },
  { step_id: 'S1', step_name: 'Reading tables', sub_step_name: 'b', message: 'second' },
];
const useCases = [{ id: '1', name: 'One', domain: 'A' }, { id: '1', name: 'Two', domain: 'B' }];
createRoot(document.getElementById('root')).render(createElement('div', null,
  createElement(ActivityFeed, { steps, live: false }),
  createElement(ArrivingNow, { useCases, live: false, empty: '' })));
`;

test('Monitor feed renders two lines with the same step_id with no duplicate-key warning', async () => {
  const out = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx' },
    bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: out.outputFiles[0].text });
    await page.locator('li').nth(1).waitFor();
    assert.equal(await page.locator('ol li').count(), 2, 'both lines render');
    assert.equal(await page.locator('[data-live-use-case]').count(), 2, 'both live use cards render');
    assert.deepEqual(errors.filter((m) => /same key/.test(m)), [], 'no duplicate key warning');
  } finally {
    await browser.close();
  }
});
