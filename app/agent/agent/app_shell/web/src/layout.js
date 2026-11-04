export function fillRows(charts) {
  const spans = charts.map((c) => (c.span === 2 ? 2 : 1));
  let open = -1;
  spans.forEach((span, i) => {
    if (charts[i].beside && !charts[i - 1]?.beside && open >= 0) {
      spans[open] = 2;
      open = -1;
    }
    if (span === 2) {
      if (open >= 0) spans[open] = 2;
      open = -1;
    } else {
      open = open >= 0 ? -1 : i;
    }
  });
  if (open >= 0) spans[open] = 2;
  return spans;
}

export const CHART_WIDTH = 640;
export const LABEL_TILT = 35;
const CHAR_EM = 0.6;
const TILTED_MAX = 96;
const SIDE_SHARE = 0.3;
const SIDE_MIN = 96;
const SIDE_MAX = 240;

export const labelPx = (text, fontSize) => Math.ceil(String(text ?? '').length * fontSize * CHAR_EM);

export function categoryLabels(names, { width = CHART_WIDTH, left = 58, right = 16, fontSize = 10, side = false } = {}) {
  const longest = Math.max(0, ...names.map((n) => labelPx(n, fontSize)));
  const cut = { fontSize, overflow: 'truncate', ellipsis: '…' };
  if (side) {
    const room = Math.round(Math.min(Math.max((width || CHART_WIDTH) * SIDE_SHARE, SIDE_MIN), SIDE_MAX));
    const shown = Math.min(room, longest + 4);
    return { axisLabel: { ...cut, width: shown }, left: Math.max(48, shown + 14) };
  }
  const each = Math.max(1, ((width || CHART_WIDTH) - left - right) / Math.max(1, names.length));
  const fits = longest <= each - 6;
  return { axisLabel: { ...cut, interval: 0, rotate: fits ? 0 : LABEL_TILT, hideOverlap: !fits, width: Math.floor(fits ? each - 6 : Math.min(TILTED_MAX, longest)) }, left };
}
