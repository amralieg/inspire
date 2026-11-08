import { closeOpenMarks, inlineParts, linkParts, markdownBlocks } from './markdown.js';

function Inline({ text, links }) {
  return (links ? linkParts(text) : inlineParts(text)).map((part, i) => {
    if (part.kind === 'link') return <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>;
    if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>;
    if (part.kind === 'em') return <em key={i}>{part.text}</em>;
    if (part.kind === 'code') return <code key={i}>{part.text}</code>;
    return part.text;
  });
}

const alignOf = (align) => (align ? { textAlign: align } : undefined);

function Table({ block, links, end }) {
  return (
    <div className="msg-t">
      <table>
        <thead>
          <tr>{block.head.map((cell, j) => <th key={j} scope="col" style={alignOf(block.align[j])}><Inline text={cell} links={links} /></th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>{row.map((cell, j) => <td key={j} style={alignOf(block.align[j])}><Inline text={cell} links={links} /></td>)}</tr>
          ))}
        </tbody>
      </table>
      {end}
    </div>
  );
}

export default function Markdown({ text, cursor, links = false, heading = '' }) {
  const blocks = markdownBlocks(closeOpenMarks(text));
  const caret = cursor ? <span className="cursor" /> : null;
  if (!blocks.length) return <p>{caret}</p>;
  return blocks.map((block, i) => {
    const end = i === blocks.length - 1 ? caret : null;
    if (block.type === 'p') return <p key={i}><Inline text={block.text} links={links} />{end}</p>;
    if (block.type === 'table') return <Table key={i} block={block} links={links} end={end} />;
    if (block.type === 'hr') return <hr key={i} className="msg-hr" />;
    if (block.type === 'h' && heading) {
      const Heading = heading;
      return <Heading key={i}><Inline text={block.text} links={links} />{end}</Heading>;
    }
    if (block.type === 'h') return <p key={i} className="msg-h"><Inline text={block.text} links={links} />{end}</p>;
    const List = block.type;
    return (
      <List key={i}>
        {block.items.map((item, j) => <li key={j}><Inline text={item} links={links} />{j === block.items.length - 1 ? end : null}</li>)}
      </List>
    );
  });
}
