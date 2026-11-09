const util = require('node:util');

const SECRET_HEADER_RE = /(["']?)\b(authorization|proxy-authorization|cookie|set-cookie|x-forwarded-access-token|x-databricks-[a-z0-9-]+)\1(\s*[:=]\s*)(?:\[[^\]\r\n]*\]|(["'`])[^\r\n"'`]*\4|[^\r\n]*)/gi;
const SECRET_PATTERNS = [
  /\bBearer\s+\S+/gi,
  /\bdapi[0-9a-f]{16,}\b/gi,
  /\bdose[0-9a-f]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}/g,
  /\b(token|secret|password|client_secret|access_token)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
];

function redactSecrets(text, extra = []) {
  let out = String(text ?? '').replace(SECRET_HEADER_RE, (_m, quote, name, joint) => `${quote}${name}${quote}${joint}[redacted]`);
  for (const pattern of [...SECRET_PATTERNS, ...extra]) {
    out = out.replace(pattern, (match, key, joint) => (typeof key === 'string' && typeof joint === 'string' ? `${key}${joint}[redacted]` : '[redacted]'));
  }
  return out;
}

const redactedText = (...args) => redactSecrets(util.format(...args));

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const REDACTED = Symbol.for('inspire.redacted');

function redactConsole(target = console) {
  if (target[REDACTED]) return target;
  for (const level of CONSOLE_LEVELS) {
    const real = target[level].bind(target);
    target[level] = (...args) => real(redactedText(...args));
  }
  target[REDACTED] = true;
  return target;
}

function redactCrashes(proc = process, out = (text) => proc.stderr.write(`${text}\n`)) {
  const fail = (err) => {
    out(redactedText(err));
    proc.exit(1);
  };
  proc.on('uncaughtException', fail);
  proc.on('unhandledRejection', fail);
}

function redactOutput(proc = process) {
  redactConsole();
  redactCrashes(proc);
}

module.exports = { SECRET_HEADER_RE, SECRET_PATTERNS, redactConsole, redactCrashes, redactOutput, redactSecrets, redactedText };
