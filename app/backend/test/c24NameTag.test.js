// REQ-340 (Amr P040, REQ-557): the use case name tag is a ONE-WAY slug of the full name (predict_customer_churn); there is no decoder, the App shows the
// real name from the use case row. This pins what a round trip can mean: the slug is stable (encoding a slug returns it), fits the tag charset and the
// cloud limit for spaces, '&', non-ASCII and a 200-char name, and no UI source reads the tag back as a display name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useCaseNameTag, inspireTagValueMax } = require('../lib/inspireJobParams');

const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ').slice(0, 200);
const NAMES = {
  spaces: ['  Predict   Customer  Churn ', 'predict_customer_churn'],
  ampersand: ['Sales & Marketing: Q3 / Q4 uplift', 'sales_marketing_q3_q4_uplift'],
  accents: ['Café Résumé Scoring', 'cafe_resume_scoring'],
  mixedScript: ['Churn 客户 Score', 'churn_score'],
};

test('a name with spaces, an ampersand or accents encodes to its readable slug, and the slug encodes to itself', () => {
  for (const [what, [name, slug]] of Object.entries(NAMES)) {
    assert.equal(useCaseNameTag(name), slug, what);
    assert.equal(useCaseNameTag(slug), slug, `${what}: re-encoding the tag changes nothing`);
  }
});

test('a name with no ASCII letters writes no tag instead of a wrong one', () => {
  assert.equal(useCaseNameTag('客户流失 & 预测'), '');
});

test('a 200-char name fits the cloud tag limit on a word boundary, in the tag charset, and stays stable', () => {
  assert.equal(LONG.length, 200);
  const tag = useCaseNameTag(LONG);
  assert.ok(tag.length > 0 && tag.length <= inspireTagValueMax(), `length ${tag.length}`);
  assert.match(tag, /^[a-z0-9]+(_[a-z0-9]+)*$/);
  assert.ok(LONG.toLowerCase().replace(/ /g, '_').startsWith(tag), 'the tag is the start of the name');
  assert.ok(LONG.replace(/ /g, '_').startsWith(`${tag}_`) || tag === LONG.replace(/ /g, '_'), 'it ends on a whole word');
  assert.equal(useCaseNameTag(tag), tag);
});

test('no UI source reads the name tag back: the App shows the use case name from its row, not a decoded tag', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && /use_case_name_tag|usecase_name/.test(fs.readFileSync(full, 'utf8'))) found.push(full);
    }
  };
  walk(path.join(__dirname, '..', '..', 'frontend', 'src'));
  assert.deepEqual(found, []);
});
