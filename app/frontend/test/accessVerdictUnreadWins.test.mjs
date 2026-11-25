import test from 'node:test';
import assert from 'node:assert/strict';
import { accessVerdictOf } from '../src/lib/implementWizard.js';

// REQ-042, MVP-ADP-08 regression: while the App cannot read a source the verdict is refused, whatever the preflight
// said about the person's own read (a late sources.ok = true must not bring the Build button back).
const unread = { text: 'The App cannot read main.s.orders.' };

test('an unreadable App wins over a preflight that says the sources are ok', () => {
  assert.equal(accessVerdictOf({ preflight: { checks: { sources: { ok: true } } }, unread }), 'refused');
});

test('an unreadable App is refused while the preflight is busy, in error, or has no source verdict', () => {
  assert.equal(accessVerdictOf({ preflight: { checks: { sources: { ok: true } } }, busy: true, unread }), 'refused');
  assert.equal(accessVerdictOf({ error: 'x', unread }), 'refused');
  assert.equal(accessVerdictOf({ preflight: { checks: {} }, unread }), 'refused');
});

test('a readable App keeps the preflight verdict', () => {
  assert.equal(accessVerdictOf({ preflight: { checks: { sources: { ok: true } } } }), 'ok');
  assert.equal(accessVerdictOf({ preflight: { checks: { sources: { ok: false } } } }), 'refused');
});
