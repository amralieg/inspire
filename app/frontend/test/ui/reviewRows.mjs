// REQ-511 (Review A6): the Review list is rows, not expandable cards. Tests that used the card expander [aria-expanded] use these helpers.
// A row is [data-use-case-row]; a row click opens the reader [data-review-reader], which holds the full expanded use case card.
export const rowsOf = (list) => list.locator('[data-use-case-row]');
export const rowNamed = (list, name) => rowsOf(list).filter({ hasText: name });
export const readerOf = (page) => page.locator('[data-review-reader]');
// Opens the reader for a row (a click on its name, outside the row's buttons) and returns the reader.
export async function openReader(page, row) {
  await row.locator('[data-row-name]').click();
  const reader = readerOf(page);
  await reader.waitFor();
  return reader;
}
export const closeReader = async (page) => { await readerOf(page).getByRole('button', { name: 'Close' }).first().click(); await readerOf(page).waitFor({ state: 'detached' }); };
// A tab panel fades in (tabPanelEnter, opacity 0 to 1); a contrast measure taken mid-fade reads the faded colour (4.00 at 75%). Wait for the fade to end first.
export const panelSettled = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.animationName === 'tabPanelEnter').map((a) => a.finished.catch(() => null))));
