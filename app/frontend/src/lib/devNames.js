// c39 (REQ-585 item 8): the one name-based dev check. A name looks dev when one of its parts (split on anything that is not a letter or
// a digit, trailing digits allowed) is a dev word. Whole parts only, never a substring: "device", "latest" and "deal_stage" are not dev.
const DEV_WORDS = new Set(['dev', 'devel', 'development', 'test', 'testing', 'tst', 'qa', 'uat', 'sandbox', 'sbx', 'staging', 'stg',
  'scratch', 'tmp', 'temp', 'demo', 'poc', 'playground', 'sample', 'samples']);

export function looksDev(name) {
  return String(name == null ? '' : name).toLowerCase().split(/[^a-z0-9]+/)
    .some((part) => part && DEV_WORDS.has(part.replace(/\d+$/, '')));
}

export const devWarningText = (kind, name) => `${name} looks like a dev ${kind}; Inspire advises production data.`;
