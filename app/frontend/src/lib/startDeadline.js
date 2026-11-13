// A launch or build start never spins forever. The request gets a deadline; when it passes, the caller gets a reason
// and the spinner stops. A start that timed out may still have begun on the server, so the reason says to check the
// Monitor page before starting again.
export const START_DEADLINE_MS = 240000;

export function startDeadlineError(label = 'Inspire', ms = START_DEADLINE_MS) {
  const minutes = Math.round(ms / 60000) || 1;
  return new Error(`${label} did not answer within ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + 'It may still have started, so check the Monitor page before you start it again.');
}

// send(signal) starts the request. The race makes the deadline hold even when fetch ignores the abort signal.
export async function withStartDeadline(send, { ms = START_DEADLINE_MS, label = 'Inspire' } = {}) {
  const controller = new AbortController();
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(startDeadlineError(label, ms));
    }, ms);
  });
  try {
    return await Promise.race([send(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
