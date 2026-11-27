// C28 (REQ-566): pages are drawn at 200+ DPI, where a full-colour PNG is 0.4 to 2.5 MB a page and a JPEG blurs the text. A page of flat colours with
// anti-aliased text needs only a few distinct colours, so it is re-encoded as a 4-bit indexed PNG (text stays sharp, the file stays small).
// Pages with gradients or photos do not fit a small palette: indexedPng returns null for them and the caller keeps a JPEG.
import { unzlibSync, zlibSync } from 'fflate';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// An 8-bit RGB or RGBA PNG to { w, h, rgb } (alpha is dropped: the page is drawn on white).
export function decodePng(bytes) {
  if (SIG.some((v, i) => bytes[i] !== v)) throw new Error('Not a PNG.');
  let w = 0; let h = 0; let ch = 0; const idat = [];
  for (let o = 8; o < bytes.length;) {
    const len = u32(bytes, o); const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]); const d = o + 8;
    if (type === 'IHDR') { w = u32(bytes, d); h = u32(bytes, d + 4); if (bytes[d + 8] !== 8 || ![2, 6].includes(bytes[d + 9]) || bytes[d + 12] !== 0) throw new Error('Only 8-bit RGB or RGBA PNGs.'); ch = bytes[d + 9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(bytes.subarray(d, d + len));
    o = d + len + 4;
  }
  const raw = unzlibSync(idat.length === 1 ? idat[0] : Uint8Array.from(idat.flatMap((c) => [...c])));
  const stride = w * ch; const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[dst + i - ch] : 0; const b = y ? px[dst - stride + i] : 0; const c = i >= ch && y ? px[dst - stride + i - ch] : 0;
      let p = 0;
      if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f === 1) p = a; else if (f === 2) p = b;
      px[dst + i] = (raw[src + i] + p) & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += ch) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; }
  return { w, h, rgb };
}

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
};

// { w, h, rgb } to an indexed PNG with at most `max` colours, or null when more than `bad` of its pixels would move further than `far` (RGB distance)
// from their true colour, which is what gradients and photos do.
export function indexedPng({ w, h, rgb }, { max = 16, far = 28, bad = 0.02 } = {}) {
  const cnt = new Uint32Array(32768); const sr = new Float64Array(32768); const sg = new Float64Array(32768); const sb = new Float64Array(32768);
  const key = new Uint16Array(w * h);
  for (let i = 0, p = 0; p < key.length; p++, i += 3) {
    const k = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3); key[p] = k;
    cnt[k]++; sr[k] += rgb[i]; sg[k] += rgb[i + 1]; sb[k] += rgb[i + 2];
  }
  const all = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) all.push({ k, n: cnt[k], c: [Math.round(sr[k] / cnt[k]), Math.round(sg[k] / cnt[k]), Math.round(sb[k] / cnt[k])] });
  all.sort((a, b) => b.n - a.n);
  // Palette: the most common colour, then again and again the colour that is worst served so far (count x squared distance), so a small accent
  // such as a dot or a pale caption keeps its own entry and the many soft anti-aliasing shades do not crowd it out.
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const pal = [all[0]]; const near = all.map((e) => d2(e.c, all[0].c));
  while (pal.length < Math.min(max, all.length)) {
    let at = 0; let worst = -1; all.forEach((e, i) => { const v = e.n * near[i]; if (v > worst) { worst = v; at = i; } });
    if (worst <= 0) break;
    pal.push(all[at]); all.forEach((e, i) => { near[i] = Math.min(near[i], d2(e.c, all[at].c)); });
  }
  const map = new Uint8Array(32768);
  let off = 0;
  for (const e of all) { let best = 0; let bd = Infinity; pal.forEach((q, i) => { const d = (q.c[0] - e.c[0]) ** 2 + (q.c[1] - e.c[1]) ** 2 + (q.c[2] - e.c[2]) ** 2; if (d < bd) { bd = d; best = i; } }); map[e.k] = best; if (bd > far * far) off += e.n; }
  if (off > bad * w * h) return null;
  const bits = pal.length <= 16 ? 4 : 8; const row = bits === 4 ? Math.ceil(w / 2) : w;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = map[key[y * w + x]]; if (bits === 8) raw[y * (row + 1) + 1 + x] = v; else raw[y * (row + 1) + 1 + (x >> 1)] |= v << (x & 1 ? 0 : 4); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = bits; ihdr[9] = 3;
  const plte = new Uint8Array(pal.length * 3); pal.forEach((q, i) => plte.set(q.c, i * 3));
  const parts = [Uint8Array.from(SIG), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// One page drawn crisp and small: the sharp PNG when its colours fit a 16-colour palette, else a JPEG. rasterize is generateDocs.svgToPng.
export async function rasterPage(rasterize, svg, scale, jpeg = { quality: 0.5 }) {
  const png = await rasterize(svg, scale, { type: 'image/png' });
  try {
    const out = indexedPng(decodePng(Uint8Array.from(atob(png.dataUrl.split(',')[1]), (c) => c.charCodeAt(0))));
    if (out) return { dataUrl: `data:image/png;base64,${b64(out)}`, type: 'image/png', width: png.width, height: png.height };
  } catch { /* a PNG this reader does not know: keep the JPEG below */ }
  return rasterize(svg, scale, { type: 'image/jpeg', quality: jpeg.quality });
}
