export const PLACEHOLDER_WORDS = {
  placeholder_baseline: 'the current value',
  placeholder_baseline_note: 'the current value ({detail})',
  placeholder_target: 'a target the sponsor sets',
  placeholder_window: 'a time frame the sponsor sets',
  placeholder_assumption: '(assumption: {detail})',
  placeholder_estimate: '(estimate: {detail})',
  placeholder_missing_data: '(missing data: {detail})',
};

const TAG = /\[\s*(BASELINE|TARGET|WINDOW|ASSUMPTION|ESTIMATE|MISSING_DATA)(?![A-Za-z_])\s*(?:[:\s]\s*([^[\]]*?))?\s*\]/gi;
const EMPTY_DETAIL = /\s*[:\uff1a\u060c]\s*\)/g;
const UNSET_TARGET = /\[\s*TARGET\s*\]/i;
const KPI_REF = /^K\d+$/i;

export function placeholderWords(text) {
  return String(text ?? '').replace(TAG, (_all, rawTag, rawNote) => {
    const tag = rawTag.toUpperCase();
    const note = String(rawNote ?? '').split(/\s+/).filter(Boolean).join(' ');
    let key = `placeholder_${tag.toLowerCase()}`;
    if (tag === 'BASELINE') key = !note || KPI_REF.test(note) ? 'placeholder_baseline' : 'placeholder_baseline_note';
    else if (note && (tag === 'TARGET' || tag === 'WINDOW')) return note;
    const phrase = PLACEHOLDER_WORDS[key].replace('{detail}', note);
    return note ? phrase : phrase.replace(EMPTY_DETAIL, ')');
  });
}

export function hasUnsetTarget(text) {
  return UNSET_TARGET.test(String(text ?? ''));
}
