import { useEffect, useRef } from 'react';
import Markdown from './Markdown.jsx';
import { blockFile, blockText, blockTitle, cleanHtml } from './blocks.js';
import { FoldButton, useFold } from './MyView.jsx';
import { AskGenie } from './AskGenie.jsx';

const WIDTHS = ['full', 'wide', 'half', 'narrow'];
const ALIGNS = ['left', 'center', 'right'];
const SHARE = { narrow: 1, half: 1.5, wide: 2 };

function HtmlBody({ html }) {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
    root.innerHTML = cleanHtml(html);
  }, [html]);
  return <div ref={host} className="blk-html" />;
}

function ImageBody({ content }) {
  const file = blockFile(content?.file);
  const alt = String(content?.alt || '');
  if (!file) return <p className="blk-gone" role="note">The image {alt ? `"${alt}" ` : ''}was not copied into the App.</p>;
  return (
    <figure className="blk-fig">
      <img src={file} alt={alt} loading="lazy" style={content.height ? { height: `${content.height}px` } : undefined} />
      {content.caption && <figcaption>{content.caption}</figcaption>}
    </figure>
  );
}

export function Block({ block, tile = false, wide = false }) {
  const fold = useFold(`block:${block.id}`);
  const width = WIDTHS.includes(block.width) ? block.width : 'full';
  const align = ALIGNS.includes(block.align) ? block.align : 'left';
  const body = block.kind === 'text' ? <Markdown text={String(block.content || '')} links heading="h3" />
    : block.kind === 'html' ? <HtmlBody html={String(block.content || '')} />
      : block.kind === 'image' ? <ImageBody content={block.content || {}} /> : null;
  const kind = ['text', 'html', 'image'].includes(block.kind) ? block.kind : 'none';
  const title = blockTitle(block);
  return (
    <div className={`blk blk--${kind} blk--a-${align}${tile ? ' blk--tile' : ` blk--w-${width}`}${wide ? ' blk--span2' : ''}${fold.folded ? ' blk--folded' : ''}`}
      data-block={block.id} data-kind={kind} data-width={width} data-align={align}>
      {fold.folded ? <p className="blk-sum" data-fold-sum>{title}</p> : body}
      {kind !== 'none' && <AskGenie kind="text" title={title} context={{ hint: blockText(block) }} />}
      <FoldButton fold={fold} title={title} />
    </div>
  );
}

export function Placed({ slots, children }) {
  const beside = slots.left.length + slots.right.length > 0;
  const cols = [...slots.left.map((b) => `${SHARE[b.width] || 1}fr`),
    `${Math.max(1, 3 - [...slots.left, ...slots.right].reduce((n, b) => n + (SHARE[b.width] || 1), 0))}fr`,
    ...slots.right.map((b) => `${SHARE[b.width] || 1}fr`)].join(' ');
  return (
    <>
      {slots.before.map((b) => <Block key={b.id} block={b} />)}
      {beside ? (
        <div className="blk-beside" style={{ gridTemplateColumns: cols }}>
          {slots.left.map((b) => <Block key={b.id} block={b} tile />)}
          <div className="blk-main">{children}</div>
          {slots.right.map((b) => <Block key={b.id} block={b} tile />)}
        </div>
      ) : children}
      {slots.after.map((b) => <Block key={b.id} block={b} />)}
    </>
  );
}
