// The one wording for the quality-bar count. Start, Monitor and Review all read it from here, so the same counts read the same everywhere.
export function qualityBarCountText(found, meets) {
  const total = Number(found) || 0;
  const passed = Number(meets) || 0;
  return `${passed} of ${total} ${total === 1 ? 'use case meets' : 'use cases meet'} the quality bar`;
}
