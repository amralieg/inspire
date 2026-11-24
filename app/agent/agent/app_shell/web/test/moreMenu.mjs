// REQ-506: the record panel and the selection bar show 3 actions and a More menu (role=menu) for the rest.
// Test helpers for reading both parts; not a test file and not part of the shared harness.
export async function openMore(scope) {
  const more = scope.getByRole('button', { name: 'More', exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  const menu = scope.page().getByRole('menu', { name: 'More actions' });
  await menu.waitFor({ state: 'visible' });
  return menu;
}

// Every action of a panel footer or selection bar: the visible buttons plus the More menu items, sorted.
export async function allActions(scope) {
  const shown = await scope.locator('button').evaluateAll((els) => els
    .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0 && !el.closest('[role="menu"]'))
    .map((el) => el.innerText.trim()).filter((t) => t && t !== 'More'));
  const menu = await openMore(scope);
  return [...shown, ...(await menu.getByRole('menuitem').allInnerTexts())].sort();
}
