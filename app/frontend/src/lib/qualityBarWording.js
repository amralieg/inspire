// The one wording for the quality-bar count. Start, Monitor and Review read it from here. Pass the mode (Good, High, Ultra High)
// where the line names it, so the Monitor count line and the backend headline read the same.
export function qualityBarCountText(found, meets, mode = '') {
  const total = Number(found) || 0;
  const passed = Number(meets) || 0;
  const bar = mode ? `the ${mode} quality bar` : 'the quality bar';
  return `${passed} of ${total} ${total === 1 ? 'use case meets' : 'use cases meet'} ${bar}`;
}
