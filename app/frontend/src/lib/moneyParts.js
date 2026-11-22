export const MONEY_PARTS = ['currency', 'window', 'off'];
// REQ-473: the method, movement and sign questions predate the value wizard and are gone; the money rule comes from the saved value wizard
// answers or the default rule. Every Measure screen in order.
export function moneyPartsOf() {
  return MONEY_PARTS;
}
