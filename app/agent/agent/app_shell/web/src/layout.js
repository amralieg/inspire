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

export const labelTilt = (labels) => (labels.length > 8 || labels.reduce((n, l) => n + String(l).length, 0) > 64 ? 35 : 0);
