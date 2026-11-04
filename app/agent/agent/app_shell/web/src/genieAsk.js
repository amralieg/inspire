import { genieMessage } from './api.js';

export const GENIE_ASK = 'inspire:genie-ask';
const POLL_MS = 1500;
const GIVE_UP_MS = 180000;
export const GENIE_USUAL_S = [20, 90];

export function paceText(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s >= GIVE_UP_MS / 1000) return `${s} s: Genie stops at 3 minutes`;
  if (s > GENIE_USUAL_S[1]) return `${s} s: longer than usual, Genie keeps working for up to 3 minutes`;
  return `${s} s so far: answers usually take ${GENIE_USUAL_S[0]} to ${GENIE_USUAL_S[1]} seconds`;
}

export async function genieAnswer(pageId, started, { onStep = () => {}, alive = () => true } = {}) {
  const until = Date.now() + GIVE_UP_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!alive()) return null;
    const msg = await genieMessage(pageId, started.conversation_id, started.message_id);
    if (msg.state === 'running') {
      onStep(msg.step);
      if (Date.now() > until) throw new Error('Genie took longer than three minutes. Try a narrower question.');
      continue;
    }
    if (msg.state === 'failed') throw new Error(msg.error || 'Genie could not answer this question.');
    return msg;
  }
}

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
