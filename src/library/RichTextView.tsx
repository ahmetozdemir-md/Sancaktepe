import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { matchingRichText, type RichTextDocument, type RichTextNode } from './richText'

function renderNode(node: RichTextNode, index: number): ReactNode {
  if (node.type === 'text') {
    let result: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') result = <strong>{result}</strong>
      else if (mark.type === 'italic') result = <em>{result}</em>
      else if (mark.type === 'underline') result = <u>{result}</u>
      else if (mark.type === 'strike') result = <s>{result}</s>
      else if (mark.type === 'textStyle') result = <span style={{ color: String(mark.attrs?.color) }}>{result}</span>
      else if (mark.type === 'highlight') result = <mark style={{ backgroundColor: String(mark.attrs?.color) }}>{result}</mark>
      else if (mark.type === 'link') result = <a href={String(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">{result}</a>
    }
    return <Fragment key={index}>{result}</Fragment>
  }
  if (node.type === 'hardBreak') return <br key={index} />
  const children = node.content?.map(renderNode)
  const style: CSSProperties = { textAlign: node.attrs?.textAlign as CSSProperties['textAlign'] }
  if (node.type === 'heading') return node.attrs?.level === 3 ? <h4 key={index} style={style}>{children}</h4> : <h3 key={index} style={style}>{children}</h3>
  if (node.type === 'bulletList') return <ul key={index}>{children}</ul>
  if (node.type === 'orderedList') return <ol key={index} start={Number(node.attrs?.start ?? 1)}>{children}</ol>
  if (node.type === 'listItem') return <li key={index}>{children}</li>
  if (node.type === 'blockquote') return <blockquote key={index}>{children}</blockquote>
  return <p key={index} style={style}>{children?.length ? children : <br />}</p>
}
export default function RichTextView({ text, document }: { text: string; document?: RichTextDocument | null }) {
  const safe = matchingRichText(text, document)
  return <div className="library-rich-content">{safe ? safe.content.map(renderNode) : <span className="library-plain-text">{text}</span>}</div>
}
