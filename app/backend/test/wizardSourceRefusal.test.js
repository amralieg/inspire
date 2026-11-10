const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIZARD = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementWizard.jsx'), 'utf8');

test('the wizard disables the build button while the source check refuses, with a plain reason beside it (must fail before the fix)', () => {
  const blocked = WIZARD.match(/const implementBlocked = ([\s\S]*?);\n/);
  assert.ok(blocked, 'implementBlocked is defined');
  assert.match(blocked[1], /sourceRefused/, 'implementBlocked includes the source refusal');
  assert.match(WIZARD, /const sourceRefused = Boolean\(appUnreadable\)/);
  assert.match(WIZARD, /data-source-refused=""/, 'a plain reason sits beside the build button');
  assert.doesNotMatch(WIZARD, /data-source-refused=""[^>]*>[^<]*(PERMISSION_DENIED|GRANT )/, 'the reason carries no raw error or GRANT');
});
