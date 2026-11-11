/** A small, allowlisted document format. HTML is never stored or injected into the reader. */
export interface RichTextMark { type: string; attrs?: Record<string, string | number> }
export interface RichTextNode { type: string; text?: string; attrs?: Record<string, string | number>; marks?: RichTextMark[]; content?: RichTextNode[] }
export interface RichTextDocument { type: 'doc'; content: RichTextNode[] }

export function richTextColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map((char) => char + char).join('').toLowerCase()
  const rgb = value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i)
  if (rgb && rgb.slice(1).every((channel) => Number(channel) <= 255)) return '#' + rgb.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')
  return undefined
}
export function richTextLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function sanitizeRichText(value: unknown): RichTextDocument | undefined {
  const root = record(value)
  if (root.type !== 'doc' || !Array.isArray(root.content)) return undefined
  let budget = 10000
  let exhausted = false
  const consume = (depth: number) => { if (--budget < 0 || depth > 16) { exhausted = true; return false } return true }
  const marks = (value: unknown): RichTextMark[] => {
    if (!Array.isArray(value)) return []
    return value.slice(0, 12).flatMap((raw): RichTextMark[] => {
      const mark = record(raw), attrs = record(mark.attrs)
      if (['bold', 'italic', 'underline', 'strike'].includes(String(mark.type))) return [{ type: String(mark.type) }]
      if (mark.type === 'textStyle' || mark.type === 'highlight') {
        const color = richTextColor(attrs.color)
        return color ? [{ type: mark.type, attrs: { color } }] : []
      }
      if (mark.type === 'link') { const href = richTextLink(attrs.href); return href ? [{ type: 'link', attrs: { href } }] : [] }
      return []
    })
  }
  const inline = (value: unknown, depth: number): RichTextNode[] => Array.isArray(value) ? value.flatMap((raw): RichTextNode[] => {
    if (!consume(depth)) return []
    const node = record(raw)
    if (node.type === 'hardBreak') return [{ type: 'hardBreak' }]
    if (node.type !== 'text' || typeof node.text !== 'string' || !node.text) return []
    const safeMarks = marks(node.marks)
    return [{ type: 'text', text: node.text, ...(safeMarks.length ? { marks: safeMarks } : {}) }]
  }) : []
  const blocks = (value: unknown, depth: number): RichTextNode[] => Array.isArray(value) ? value.flatMap((raw): RichTextNode[] => {
    if (!consume(depth)) return []
    const node = record(raw), attrs = record(node.attrs)
    if (node.type === 'paragraph' || node.type === 'heading') {
      const safeAttrs: Record<string, string | number> = {}
      if (['left', 'center', 'right'].includes(String(attrs.textAlign))) safeAttrs.textAlign = String(attrs.textAlign)
      if (node.type === 'heading') safeAttrs.level = attrs.level === 3 ? 3 : 2
      return [{ type: node.type, ...(Object.keys(safeAttrs).length ? { attrs: safeAttrs } : {}), content: inline(node.content, depth + 1) }]
    }
    if (node.type === 'blockquote') {
      const content = blocks(node.content, depth + 1)
      return [{ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph', content: [] }] }]
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = Array.isArray(node.content) ? node.content.flatMap((rawItem): RichTextNode[] => {
        if (!consume(depth + 1)) return []
        const item = record(rawItem)
        if (item.type !== 'listItem') return []
        const content = blocks(item.content, depth + 2)
        if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph', content: [] })
        return [{ type: 'listItem', content }]
      }) : []
      if (!items.length) return []
      const start = typeof attrs.start === 'number' && Number.isInteger(attrs.start) && attrs.start > 0 && attrs.start < 10000 ? attrs.start : 1
      return [{ type: node.type, ...(node.type === 'orderedList' ? { attrs: { start } } : {}), content: items }]
    }
    return []
  }) : []
  const content = blocks(root.content, 0)
  if (exhausted) return undefined
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}

export function richTextToPlain(document: RichTextDocument): string {
  const read = (node: RichTextNode): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    const separator = ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type) ? '\n' : ''
    return (node.content ?? []).map(read).join(separator)
  }
  return read(document)
}
export function plainRichText(text: string): RichTextDocument {
  const content: RichTextNode[] = []
  text.split('\n').forEach((line, index) => { if (index) content.push({ type: 'hardBreak' }); if (line) content.push({ type: 'text', text: line }) })
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}
/** A stale rich document must never replace the current plain-text clinical content. */
export function matchingRichText(text: string, value: unknown): RichTextDocument | undefined {
  const document = sanitizeRichText(value)
  return document && richTextToPlain(document) === text ? document : undefined
}
