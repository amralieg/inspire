// FX-38b (REQ-453, W16 D26): a dialog opened from a card hands the person back to that same card: the list is where it was and focus is
// on the card (the button that opened the dialog may be gone by then, such as the Calculate box a saved value replaces).
const cardOf = (id) => [...document.querySelectorAll('[data-use-case-id]')].find((el) => el.getAttribute('data-use-case-id') === id) || null;

function scrollerOf(el) {
  for (let up = el.parentElement; up; up = up.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(up).overflowY) && up.scrollHeight > up.clientHeight) return up;
  }
  return document.scrollingElement;
}

export function rememberCard(id) {
  const card = id ? cardOf(id) : null;
  return card ? { id, top: card.getBoundingClientRect().top } : null;
}

export function returnToCard(saved) {
  if (!saved) return;
  const back = () => {
    const card = cardOf(saved.id);
    if (!card) return;
    const moved = card.getBoundingClientRect().top - saved.top;
    if (Math.abs(moved) > 4) scrollerOf(card).scrollBy({ top: moved, behavior: 'instant' });
    if (!card.contains(document.activeElement)) card.querySelector('[aria-expanded]')?.focus({ preventScroll: true });
  };
  // Twice: once after the dialog is gone, once after the card has taken its new value box.
  requestAnimationFrame(() => { back(); requestAnimationFrame(back); });
}
