import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, finiteAnimationsDone, holdClock, openUi, painted, watchScrolls } from './uiSupport.mjs';
import { APP_TABS } from '../../src/lib/tabs.js';
import { SHOWCASE_BUTTON } from '../../src/lib/showcase.js';
import { DISCOVERY_MODE_TEXT } from '../../src/lib/discoveryType.js';

test.after(closeBrowser);

const STALE = ['in under 30 minutes', 'in minutes', 'Scans 100+ tables', 'Genie-ready code instructions', 'executive presentations',
  'implementation-ready', 'clusters tables into business domains', 'The Pipeline', 'Deliver Artifacts', 'See Demo Results'];

const groups = (page) => page.locator('[data-landing-actions]');
const clicks = (page) => page.locator('output[aria-label="Landing clicks"]');

test('the home page offers one call to action, Get Started, in the hero and at the end, and leaves the demo to the Start page', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    assert.equal(await groups(page).count(), 2, 'the hero and the closing section');
    for (let i = 0; i < 2; i += 1) {
      assert.deepEqual((await groups(page).nth(i).getByRole('button').allInnerTexts()).map((t) => t.trim()), ['Get Started']);
    }
    const names = await page.getByRole('button').evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') || el.textContent || el.title).trim()));
    assert.equal(names.filter((n) => n === 'Get Started').length, 2, 'Get Started shows only in the two call-to-action groups');
    assert.equal(names.filter((n) => n === SHOWCASE_BUTTON).length, 0, 'the home page offers no demo button (must-exclude)');
    const others = names.filter((n) => !['Get Started', 'Workspace setup'].includes(n) && !/^Switch to (dark|light) mode$/.test(n));
    assert.deepEqual(others, ['Discover', 'Analyze', 'How it works', 'Agent', 'What you get', 'Try it'],
      'the rest are the section links and the theme switch, so nothing else asks the person to act');
    assert.equal(await page.locator('nav').getByRole('button', { name: 'Get Started' }).count(), 0, 'the top bar holds no third Get Started');
    assert.doesNotMatch(await page.locator('nav').first().innerText(), /\bv\d/i, 'the top bar shows no version badge');
    await groups(page).first().getByRole('button', { name: 'Get Started', exact: true }).click();
    await groups(page).last().getByRole('button', { name: 'Get Started', exact: true }).click();
    assert.equal(await clicks(page).textContent(), 'start,start');
    assert.match(await page.locator('body').innerText(), /Point Inspire at your catalog to find your use cases\./);
    assert.doesNotMatch(await page.locator('body').innerText(), /demo/i);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the hero types each of its words without moving Get Started, and a section link jumps without animation for a person who asked for less motion', async () => {
  let scrolls;
  const ui = await openUi('landing', {}, '', { init: async (page) => { await page.clock.install(); scrolls = await watchScrolls(page); } });
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    await finiteAnimationsDone(page);
    await holdClock(page);
    const cta = groups(page).first().getByRole('button', { name: 'Get Started', exact: true });
    const typed = page.locator('h1 .bg-clip-text').first();
    const at = new Set();
    const words = new Set();
    for (let ms = 0; ms < 16000; ms += 80) {
      await page.clock.runFor(80);
      const box = await cta.boundingBox();
      at.add(`${box.x},${box.y}`);
      words.add(await typed.textContent());
    }
    await page.clock.resume();
    for (const word of ['Use Cases', 'Business Value', 'Data Strategy', 'AI Insights']) assert.ok(words.has(word), `the hero typed ${word} in full`);
    assert.deepEqual([...at], [[...at][0]], 'Get Started stays where it is while the words are typed and deleted (must-exclude: a word that wraps moved it)');
    scrolls();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('nav').getByRole('button', { name: 'Analyze', exact: true }).click();
    assert.deepEqual(await scrolls(), ['auto'], 'less motion: the section link jumps');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('nav').getByRole('button', { name: 'Discover', exact: true }).click();
    assert.deepEqual(await scrolls(), ['smooth'], 'otherwise it glides');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('scrolling the home page down and back step by step, through the section where the orb rings start and stop, writes no console error', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    const height = await page.locator('.snap-y').evaluate((el) => {
      el.style.scrollSnapType = 'none';
      el.style.scrollBehavior = 'auto';
      return el.scrollHeight - el.clientHeight;
    });
    const stops = Array.from({ length: 41 }, (_, i) => Math.round((height * i) / 40));
    const seen = new Set();
    for (const y of [...stops, ...[...stops].reverse(), ...stops]) {
      await page.locator('.snap-y').evaluate((el, to) => { el.scrollTop = to; }, y);
      await painted(page);
      const rings = await page.evaluate(() => [...document.querySelectorAll('[class*="rounded-full border"]')]
        .map((el) => `${el.style.animationName || 'none'} ${el.style.animationDelay || '0s'}`));
      for (const ring of rings) seen.add(ring);
    }
    assert.ok(seen.has('orbRing 0.5s'), `the scroll crosses the section where the rings run, each with its own delay: ${[...seen].join(', ')}`);
    assert.deepEqual(ui.pageErrors, [], 'no rerender mixes the animation shorthand with its delay');
  } finally {
    await ui.close();
  }
});

test('an App the installer set up shows no setup wizard on its home page, and a self-run App names Workspace setup without the word wizard', async () => {
  const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
    inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
  };
  const installed = await openUi('app', {}, '', { mount });
  try {
    await installed.page.getByRole('button', { name: 'Get Started', exact: true }).first().waitFor({ timeout: 20000 });
    const text = await installed.page.locator('body').innerText();
    assert.doesNotMatch(text, /setup wizard/i);
    assert.doesNotMatch(text, /host, token/i);
    assert.equal(await installed.page.getByRole('button', { name: 'Workspace setup' }).count(), 0);
    const about = installed.page.getByRole('contentinfo', { name: 'About Inspire' });
    assert.equal(await about.count(), 1);
    assert.equal(await about.innerText(), 'Inspire is open source and provided as is. Databricks Support does not cover it: ask questions and request features on the Inspire GitHub Issues page.');
    assert.equal(await about.getByRole('link', { name: 'Inspire GitHub Issues page' }).getAttribute('href'), 'https://github.com/amralieg/inspire/issues');
    const hero = installed.page.getByRole('button', { name: 'Get Started', exact: true }).first().locator('xpath=ancestor::section[1]');
    assert.doesNotMatch(await hero.innerText(), /support|provided as/i, 'the notice sits in the footer, not under Get Started (must-exclude)');
    assert.deepEqual(installed.pageErrors, []);
  } finally {
    await installed.close();
  }
  const local = await openUi('landing');
  try {
    await local.page.getByText('Scroll to explore').waitFor();
    assert.doesNotMatch(await local.page.locator('body').innerText(), /wizard/i);
    await local.page.getByRole('button', { name: 'Workspace setup', exact: true }).click();
    assert.equal(await clicks(local.page).textContent(), 'setup');
    assert.deepEqual(local.pageErrors, []);
  } finally {
    await local.close();
  }
});

test('the home page walks through the five tabs as they work now and keeps none of the old claims', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.getByText('Scroll to explore').waitFor();
    const steps = page.getByRole('list', { name: 'How Inspire works' }).getByRole('listitem');
    assert.equal(await steps.count(), APP_TABS.length);
    for (let i = 0; i < APP_TABS.length; i += 1) {
      const tab = APP_TABS[i];
      assert.equal(await steps.nth(i).getAttribute('data-landing-step'), tab.label);
      assert.equal((await steps.nth(i).getByRole('heading').innerText()).trim(), tab.label);
      assert.match(await steps.nth(i).innerText(), new RegExp(`0${i + 1}`));
      assert.equal((await steps.nth(i).locator('p').innerText()).trim(), tab.blurb);
    }
    assert.deepEqual(APP_TABS.map((t) => t.label), ['Start', 'Monitor', 'Review', 'Build', 'Run']);
    const text = await page.locator('body').innerText();
    for (const claim of STALE) assert.equal(text.includes(claim), false, claim);
    assert.doesNotMatch(text, /\bResults\b/, 'no section or step names the old Results tab');
    for (const claim of ['Genie then builds an MVP for each one you pick.', 'Writes a PDF catalog and, if you ask, a slide deck',
      'Hands each use case you pick to Genie to build its MVP', 'Ready to build.']) {
      assert.ok(text.includes(claim), claim);
    }
    assert.doesNotMatch(text, /[\u2013\u2014]/, 'no en or em dash in the home page text');
    const hint = page.getByText('Scroll to explore');
    assert.equal(await hint.isVisible(), true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await hint.waitFor({ state: 'hidden', timeout: 15000 });
    assert.equal(await hint.isVisible(), false, 'on a short screen the scroll hint gives way to the setup note and the disclaimer');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the home page shows no discovery type choice: Standard and AI Enhanced Discovery are named and picked in Get Started only (must-exclude)', async () => {
  const ui = await openUi('landing');
  const { page } = ui;
  try {
    await page.locator('[data-landing-actions]').first().waitFor();
    assert.equal(await page.locator('[data-landing-discovery], [data-landing-discovery-mode]').count(), 0);
    assert.equal(await page.getByRole('list', { name: 'Discovery modes' }).count(), 0);
    const body = await page.locator('body').innerText();
    for (const mode of ['Standard Discovery', 'AI Enhanced Discovery']) assert.doesNotMatch(body, new RegExp(mode), `${mode} is not on Home`);
    assert.equal(await page.locator('[data-discovery-promise]').count(), 0, 'Home carries no discovery recommendation');
    for (const text of Object.values(DISCOVERY_MODE_TEXT)) assert.equal(body.includes(text), false, 'no mode description on Home');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
