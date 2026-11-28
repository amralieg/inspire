// C27 (REQ-564): shared fixture for the exciting-docs tests: the recorded retail demo (17 use cases, 16 analytics techniques).
import fs from 'node:fs';
import zlib from 'node:zlib';

const show = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(new URL('../../backend/showcase/kinds-retail.json.br', import.meta.url))));
export const ROWS = show.inspire['GET /api/inspire/results?session_id=2001'].body.results.domains.flatMap((d) => d.use_cases);
export const ARGS = { businessName: 'Retail', useCases: ROWS, values: {}, summary: ['Retail sells through stores and the web.'], foundations: [], language: 'English', date: '2026-11-27' };
export const DOMAINS = [...new Set(ROWS.map((r) => String(r['Business Domain'] || r.domain || '').trim()).filter(Boolean))];
export const IDS = ROWS.map((r) => String(r.No));
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const flat = (s) => decode(String(s).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export const words = (s) => flat(s).split(' ').filter((w) => /[A-Za-z]{2,}/.test(w)).length;
// The chart contract: every chart is an element with data-chart="<type>", and data-uc="<use case id>" when it is about one use case.
export const charts = (svg) => [...String(svg).matchAll(/<[^>]*\bdata-chart="([a-z0-9_-]+)"[^>]*>/g)].map((m) => ({ type: m[1], uc: (m[0].match(/\bdata-uc="([^"]+)"/) || [])[1] || '' }));
export const fills = (svg) => new Set([...String(svg).matchAll(/(?:fill|background(?:-color)?)[=:]\s*"?(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()).filter((c) => !['#ffffff', '#000000'].includes(c)));
