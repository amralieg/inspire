export const GENIE_ASK = 'inspire:genie-ask';

export function askGenie(detail) {
  window.dispatchEvent(new CustomEvent(GENIE_ASK, { detail }));
}

export function genieKey(app, id) {
  if (app.pages.some((p) => p.id === id)) return id;
  return app.pages.length === 1 ? app.pages[0].id : '';
}

export function genieOf(app, id) {
  const key = genieKey(app, id);
  return key ? app.pages.find((p) => p.id === key).genie : app.genie;
}

export const genieOn = (app, id) => Boolean(genieKey(app, id) && genieOf(app, id).enabled);
