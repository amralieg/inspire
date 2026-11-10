export const helpLine = (...parts) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(' ');
