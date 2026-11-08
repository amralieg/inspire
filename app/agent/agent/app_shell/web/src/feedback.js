export const FEEDBACK_CHARS = 2000;
export const FEEDBACK_SECTIONS = ['dashboard', 'work', 'performance', 'runs', 'alerts', 'settings'];
const STATUS_TEXT = { new: 'New', vibe: 'Turned into vibe', closed: 'Closed' };

export const feedbackChars = (text) => [...String(text ?? '').trim()].length;

export function feedbackProblem(text) {
  const n = feedbackChars(text);
  return n > FEEDBACK_CHARS ? `Keep the report to ${FEEDBACK_CHARS.toLocaleString('en-US')} characters; it has ${n.toLocaleString('en-US')}.` : '';
}

export const feedbackStatusText = (status) => STATUS_TEXT[status] || '';
