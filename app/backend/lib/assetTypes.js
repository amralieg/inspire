const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const UNKNOWN_ASSET_TYPE = 'application/octet-stream';
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.map', '.svg']);
const COMPRESS_MIN_BYTES = 1024;
const CACHE_HASHED = 'public, max-age=31536000, immutable';
const CACHE_REVALIDATE = 'no-cache';
const HASHED_ASSET_RE = /(^|\/)assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

function assetType(name) {
  return ASSET_TYPES[path.extname(String(name || '')).toLowerCase()] || null;
}

function isCompressible(name) {
  return COMPRESSIBLE.has(path.extname(String(name || '')).toLowerCase());
}

function assetCacheControl(name) {
  return HASHED_ASSET_RE.test(String(name || '').split(path.sep).join('/')) ? CACHE_HASHED : CACHE_REVALIDATE;
}

function acceptedEncoding(header) {
  const offered = new Map();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const weight = q ? Number(q.slice(2)) : 1;
    offered.set(name.trim(), Number.isFinite(weight) ? weight : 0);
  }
  const ok = (name) => (offered.has(name) ? offered.get(name) > 0 : (offered.get('*') || 0) > 0);
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return '';
}

function staticHeaders(res, file) {
  res.setHeader('Content-Type', assetType(file) || UNKNOWN_ASSET_TYPE);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', assetCacheControl(file));
  if (isCompressible(file)) res.setHeader('Vary', 'Accept-Encoding');
}

function encodedCache() {
  const memo = new Map();
  return (key, body, encoding) => {
    const id = `${encoding}\0${key}`;
    if (!memo.has(id)) {
      memo.set(id, encoding === 'br'
        ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
        : zlib.gzipSync(body, { level: 9 }));
    }
    return memo.get(id);
  };
}

function sendAsset(req, res, name, body, encode, extraHeaders = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const compressible = isCompressible(name);
  const etag = `"${crypto.createHash('sha1').update(raw).digest('base64url')}"`;
  const encoding = compressible && raw.length >= COMPRESS_MIN_BYTES ? acceptedEncoding(req.headers['accept-encoding']) : '';
  const packed = encoding ? encode(name, raw, encoding) : raw;
  const useEncoding = encoding && packed.length < raw.length ? encoding : '';
  const out = useEncoding ? packed : raw;
  const sentTag = useEncoding ? `${etag.slice(0, -1)}-${useEncoding}"` : etag;
  const headers = {
    ...extraHeaders,
    'Content-Type': assetType(name) || UNKNOWN_ASSET_TYPE,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': assetCacheControl(name),
    ETag: sentTag,
    ...(compressible ? { Vary: 'Accept-Encoding' } : {}),
    ...(useEncoding ? { 'Content-Encoding': useEncoding } : {}),
  };
  for (const [header, value] of Object.entries(headers)) res.setHeader(header, value);
  const match = String(req.headers['if-none-match'] || '').split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (match.includes(sentTag) || match.includes('*')) return res.status(304).end();
  res.setHeader('Content-Length', String(out.length));
  return req.method === 'HEAD' ? res.end() : res.end(out);
}

function compressedStatic(dir) {
  const root = path.resolve(dir);
  const encode = encodedCache();
  const files = new Map();
  const fileOf = (rel) => {
    if (files.has(rel)) return files.get(rel);
    const full = path.resolve(root, `.${rel}`);
    if (!full.startsWith(root + path.sep) || !isCompressible(full)) return null;
    try {
      if (!fs.statSync(full).isFile()) return null;
      const body = fs.readFileSync(full);
      files.set(rel, body);
      return body;
    } catch {
      return null;
    }
  };
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!acceptedEncoding(req.headers['accept-encoding'])) return next();
    let rel;
    try {
      rel = path.posix.normalize(decodeURIComponent(req.path));
    } catch {
      return next();
    }
    if (rel.endsWith('/') || rel.includes('\0')) return next();
    const body = fileOf(rel);
    if (!body || body.length < COMPRESS_MIN_BYTES) return next();
    return sendAsset(req, res, rel, body, encode);
  };
}

module.exports = {
  ASSET_TYPES,
  UNKNOWN_ASSET_TYPE,
  CACHE_HASHED,
  CACHE_REVALIDATE,
  COMPRESS_MIN_BYTES,
  assetType,
  assetCacheControl,
  acceptedEncoding,
  isCompressible,
  staticHeaders,
  encodedCache,
  sendAsset,
  compressedStatic,
};
