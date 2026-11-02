const path = require('path');

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

function assetType(name) {
  return ASSET_TYPES[path.extname(String(name || '')).toLowerCase()] || null;
}

function staticHeaders(res, file) {
  res.setHeader('Content-Type', assetType(file) || UNKNOWN_ASSET_TYPE);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = { ASSET_TYPES, UNKNOWN_ASSET_TYPE, assetType, staticHeaders };
