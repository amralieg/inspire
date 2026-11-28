// C33 (REQ-560, D5): the page layout of a document PDF, read from the browser as drawing operations, so the PDF can hold the page as vectors
// (shapes and real text) instead of a picture of it. domLayout(document) returns async (svg) => { w, h, ops }: it mounts the XHTML of one agent PDF
// page (agentPdf.js pagesIn) in a hidden frame, lets the browser lay it out, and reads back
//   { t: 'rect', x, y, w, h, r, fill: {r,g,b,a}, stroke: { w, color } }   a box, its fill and its border
//   { t: 'text', x, y, size, text, bold, italic, serif, color, width, natural, spacing }   one line of text, y = baseline, width = the width the browser
//   gave it, natural = the width the PDF's standard font (Helvetica or Times) gives it
//   { t: 'image', x, y, w, h, svg }   a chart or logo, drawn by the caller (an <svg> or <img>, as an SVG string)
// This file has no imports so a test or script can also load it into any page as plain text. Gradients are drawn as their first colour; shadows,
// clipping and z-order are not read.
export function domLayout(doc = globalThis.document) {
  const PAGE_W = 794;
  const PAGE_H = 1123;
  const rgba = (css, mul = 1) => {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/.exec(css || '');
    if (!m) return null;
    const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: a * mul };
  };
  const px = (v) => parseFloat(v) || 0;

  return async function layout(svg) {
    const frame = doc.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;border:0`;
    doc.body.appendChild(frame);
    try {
      const fd = frame.contentDocument;
      fd.open(); fd.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'); fd.close();
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const src = parsed.getElementsByTagName('foreignObject')[0].firstElementChild;
      const root = fd.importNode(src, true);
      root.style.cssText += `;position:absolute;left:0;top:0;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden`;
      fd.body.appendChild(root);
      const win = frame.contentWindow;
      const origin = root.getBoundingClientRect();
      const ops = [];
      const ctx = fd.createElement('canvas').getContext('2d');
      const opacityOf = new Map();
      const opacity = (el) => {
        if (!el) return 1;
        if (!opacityOf.has(el)) opacityOf.set(el, opacity(el.parentElement) * (parseFloat(win.getComputedStyle(el).opacity) || 0));
        return opacityOf.get(el);
      };
      const rel = (r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      const inSvg = (el) => Boolean(el.ownerSVGElement) || el.closest('svg') !== null && el.localName !== 'svg';

      const box = (el) => {
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = rel(el.getBoundingClientRect());
        if (r.w < 0.5 || r.h < 0.5) return;
        const op = opacity(el);
        if (el.localName === 'svg' || el.localName === 'img') {
          // The picture is drawn on the colour behind it (the rasterizer paints white), so a chart on a card or an art on a dark page keeps its ground.
          let ground = 'rgb(255,255,255)';
          for (let up = el.parentElement; up; up = up.parentElement) {
            const c = rgba(win.getComputedStyle(up).backgroundColor);
            if (c && c.a > 0.99) { ground = `rgb(${c.r},${c.g},${c.b})`; break; }
            const g = win.getComputedStyle(up).backgroundImage;
            if (/gradient/.test(g)) { const f = rgba(g.slice(g.indexOf('('))); if (f) { ground = `rgb(${f.r},${f.g},${f.b})`; break; } }
          }
          const w = Math.max(1, Math.round(r.w)); const h = Math.max(1, Math.round(r.h));
          let inner;
          if (el.localName === 'img') {
            inner = `<image href="${el.getAttribute('src')}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
          } else {
            const clone = el.cloneNode(true);
            if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${px(el.getAttribute('width')) || r.w} ${px(el.getAttribute('height')) || r.h}`);
            clone.setAttribute('width', w); clone.setAttribute('height', h);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            inner = new XMLSerializer().serializeToString(clone);
          }
          const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${ground}"/>${inner}</svg>`;
          ops.push({ t: 'image', ...r, svg: svgText });
          return;
        }
        let fill = rgba(cs.backgroundColor, op);
        if (!(fill && fill.a > 0) && /gradient/.test(cs.backgroundImage)) fill = rgba(cs.backgroundImage.slice(cs.backgroundImage.indexOf('(')), op);
        const radius = Math.min(px(cs.borderTopLeftRadius), r.w / 2, r.h / 2);
        const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({ w: px(cs[`border${s}Width`]), style: cs[`border${s}Style`], color: rgba(cs[`border${s}Color`], op) }));
        const drawn = sides.map((s) => (s.w > 0 && s.style !== 'none' && s.color && s.color.a > 0 ? s : null));
        const same = drawn.every((s) => s && s.w === drawn[0].w && s.color.r === drawn[0].color.r && s.color.g === drawn[0].color.g && s.color.b === drawn[0].color.b);
        const hasFill = fill && fill.a > 0;
        if (hasFill || same) ops.push({ t: 'rect', ...r, r: radius, fill: hasFill ? fill : null, stroke: same ? { w: drawn[0].w, color: drawn[0].color } : null });
        if (!same) {
          const [t, rt, b, l] = drawn;
          if (t) ops.push({ t: 'rect', x: r.x, y: r.y, w: r.w, h: t.w, r: 0, fill: t.color, stroke: null });
          if (b) ops.push({ t: 'rect', x: r.x, y: r.y + r.h - b.w, w: r.w, h: b.w, r: 0, fill: b.color, stroke: null });
          if (l) ops.push({ t: 'rect', x: r.x, y: r.y, w: l.w, h: r.h, r: 0, fill: l.color, stroke: null });
          if (rt) ops.push({ t: 'rect', x: r.x + r.w - rt.w, y: r.y, w: rt.w, h: r.h, r: 0, fill: rt.color, stroke: null });
        }
      };

      const textOf = (node) => {
        const el = node.parentElement;
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const op = opacity(el);
        const color = rgba(cs.color, op);
        if (!color || color.a <= 0) return;
        const words = [];
        const range = fd.createRange();
        for (const m of node.data.matchAll(/\S+/g)) {
          range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          const rects = [...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
          if (rects.length <= 1) { if (rects[0]) words.push({ s: m[0], r: rects[0] }); continue; }
          // a word the browser broke across lines: read it one letter at a time
          for (let i = 0; i < m[0].length; i += 1) {
            range.setStart(node, m.index + i); range.setEnd(node, m.index + i + 1);
            const q = [...range.getClientRects()].find((x) => x.width > 0 && x.height > 0);
            if (q) words.push({ s: m[0][i], r: q, cont: i > 0 });
          }
        }
        const lines = [];
        for (const w of words) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(w.r.top - last.top) < w.r.height * 0.5) { last.parts.push(w); last.right = Math.max(last.right, w.r.right); } else lines.push({ top: w.r.top, height: w.r.height, left: w.r.left, right: w.r.right, parts: [w] });
        }
        const css = Number.parseFloat(cs.fontSize) || 13;
        const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600 || cs.fontWeight === 'bold';
        const italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
        const serif = /^["']?(fraunces|georgia|times)/i.test(cs.fontFamily);
        const spacing = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
        ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${css}px ${cs.fontFamily}`;
        const m0 = ctx.measureText('Hxg');
        const asc = m0.fontBoundingBoxAscent; const desc = m0.fontBoundingBoxDescent;
        for (const [li, ln] of lines.entries()) {
          let text = '';
          ln.parts.forEach((w, i) => { text += (i && !w.cont ? ' ' : '') + w.s; });
          if (lines[li + 1] && lines[li + 1].parts[0].cont) text += '-'; // a word the browser broke with a hyphen
          if (cs.textTransform === 'uppercase') text = text.toUpperCase(); else if (cs.textTransform === 'lowercase') text = text.toLowerCase();
          const size = css * (ln.height / (asc + desc));
          ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${serif ? '"Times New Roman", Times, serif' : 'Arial, Helvetica, sans-serif'}`;
          const natural = ctx.measureText(text).width + spacing * text.length;
          ops.push({ t: 'text', x: ln.left - origin.left, y: ln.top - origin.top + asc * (size / css), size, text, bold, italic, serif, color, width: ln.right - ln.left, natural, spacing, rtl: cs.direction === 'rtl' });
        }
      };

      box(root);
      const walker = fd.createTreeWalker(root, 1 | 4);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {
          if (['style', 'script', 'title', 'head'].includes(n.localName) || inSvg(n)) continue;
          box(n);
        } else if (n.nodeType === 3 && n.parentElement && !inSvg(n.parentElement) && !['style', 'script'].includes(n.parentElement.localName)) {
          textOf(n);
        }
      }
      return { w: PAGE_W, h: PAGE_H, ops };
    } finally {
      frame.remove();
    }
  };
}
