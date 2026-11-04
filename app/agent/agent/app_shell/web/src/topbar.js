export const TOP_FITS = [['narrow', 860], ['tight', 1100], ['mid', 1600]];

export function topFit(width) {
  const hit = TOP_FITS.find(([, upTo]) => width <= upTo);
  return hit ? hit[0] : 'full';
}
