// REQ-482: every wait state shows motion. BusyNote is the one shared note: a spinner, the text, and after 8 s a still-working line.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let browser;
test.after(async () => { if (browser) await browser.close(); });

async function bundle() {
  const entry = `
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import BusyNote from './src/components/BusyNote.jsx';
    const root = createRoot(document.getElementById('root'));
    window.show = (props) => flushSync(() => root.render(<BusyNote {...props} />));
    window.hide = () => flushSync(() => root.render(null));
  `;
  const out = await build({
    stdin: { contents: entry, resolveDir: frontend, loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  });
  return out.outputFiles[0].text;
}

async function open() {
  const code = await bundle();
  if (!browser) browser = await chromium.launch();
  const page = await browser.newPage();
  // Track every pending timer of the still-working delay, so a test can see that unmount clears it.
  await page.clock.install({ time: 0 });
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.__live = new Set();
    const set = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => {
      const id = set((...a) => { window.__live.delete(id); return fn(...a); }, ms, ...rest);
      if (ms >= 1000) window.__live.add(id);
      return id;
    };
    window.clearTimeout = (id) => { window.__live.delete(id); return clear(id); };
  });
  await page.clock.pauseAt(1000);
  await page.addScriptTag({ content: code });
  return page;
}

const STILL = /Still working\. This can take up to a minute\./;

test('BusyNote shows a spinning element and the text at once, and the still-working line only after 8 s', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.show({ text: 'Reading your data to plan the value.' }));
    const note = page.locator('[role="status"]');
    assert.equal(await note.getAttribute('aria-live'), 'polite');
    assert.match(await note.innerText(), /Reading your data to plan the value\./);
    assert.equal(await note.locator('svg.animate-spin, svg[class*="animate-spin"]').count(), 1, 'one spinning icon');
    assert.doesNotMatch(await note.innerText(), STILL, 'absent at 0 s');
    await page.clock.fastForward(7999);
    assert.doesNotMatch(await note.innerText(), STILL, 'absent at 7.999 s');
    await page.clock.fastForward(2);
    assert.match(await note.innerText(), STILL, 'present after 8 s');
    assert.match(await note.innerText(), /Reading your data to plan the value\./, 'the text stays');
  } finally {
    await page.close();
  }
});

test('BusyNote keeps the data attributes and class of its site on the wrapper (must-keep)', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.show({ text: 'Reading the columns', 'data-link-loading': '', className: 'text-text-tertiary' }));
    const note = page.locator('[data-link-loading]');
    assert.equal(await note.getAttribute('role'), 'status');
    assert.match(await note.getAttribute('class'), /text-text-tertiary/);
  } finally {
    await page.close();
  }
});

test('unmounting clears the one timer (must-exclude: no timer left running)', async () => {
  const page = await open();
  try {
    await page.evaluate(() => window.show({ text: 'Checking' }));
    assert.equal(await page.evaluate(() => window.__live.size), 1, 'one timer while mounted');
    await page.evaluate(() => window.hide());
    assert.equal(await page.evaluate(() => window.__live.size), 0, 'no timer after unmount');
    await page.clock.fastForward(20000);
    assert.equal(await page.locator('[role="status"]').count(), 0);
  } finally {
    await page.close();
  }
});
