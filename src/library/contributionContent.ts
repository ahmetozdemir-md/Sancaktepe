import { MAX_BLOCKS, newLibraryEntry, normalizeRichBlock, safeSourceUrl, safeTableColor, validateLibraryEntry, type LibraryBlock, type LibraryEntry } from './model.ts'

export const MAX_CONTRIBUTION_BYTES = 262144
export const MAX_CONTRIBUTION_IMAGES = 8
export const CONTRIBUTION_HOURLY_LIMIT = 3
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('invalid-content')
  return value
}
/** Server and client share this allowlist. Submission permissions are enforced separately by SQL. */
export function normalizeContribution(value: unknown): LibraryEntry {
  if (!object(value) || new TextEncoder().encode(JSON.stringify(value)).length > MAX_CONTRIBUTION_BYTES) throw new Error('invalid-content')
  if (typeof value.id !== 'string' || !uuid.test(value.id) || !Array.isArray(value.blocks) || value.blocks.length > MAX_BLOCKS) throw new Error('invalid-content')
  let images = 0
  const blocks = value.blocks.map((raw): LibraryBlock => {
    if (!object(raw) || typeof raw.id !== 'string' || !uuid.test(raw.id)) throw new Error('invalid-content')
    const id = raw.id
    if (raw.type === 'section') return { id, type: 'section', title: string(raw.title,100,true) }
    if (raw.type === 'text') return normalizeRichBlock({ id, type:'text', text:string(raw.text,20000,true), richText:raw.richText as never })
    if (raw.type === 'image') {
      if (++images > MAX_CONTRIBUTION_IMAGES) throw new Error('file-limit')
      const path = string(raw.path,200,true)
      if (!path.startsWith(`${value.id}/`) || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/i.test(path)) throw new Error('invalid-file')
      return { id, type:'image', path, caption:string(raw.caption ?? '',200), fileName:'rehber-gorseli.png' }
    }
    if (raw.type === 'table') {
      if (!Array.isArray(raw.headers) || raw.headers.length < 1 || raw.headers.length > 12 || !Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > 100) throw new Error('invalid-content')
      const headers = raw.headers.map(cell => string(cell,2000,true))
      const rows = raw.rows.map(row => { if (!Array.isArray(row) || row.length !== headers.length) throw new Error('invalid-content'); return row.map(cell => string(cell,2000)) })
      return normalizeRichBlock({ id, type:'table', caption:string(raw.caption ?? '',160), headers, rows,
        headerColor:safeTableColor(raw.headerColor), rowColors:rows.map((_,index)=>safeTableColor(Array.isArray(raw.rowColors) ? raw.rowColors[index] : undefined) ?? null),
        align:raw.align === 'center' || raw.align === 'right' ? raw.align : 'left', compact:raw.compact === true,
        headerRichText:raw.headerRichText as never, rowRichText:raw.rowRichText as never })
    }
    throw new Error('invalid-content')
  })
  const sourceUrl = string(value.sourceUrl ?? '',2000)
  if (sourceUrl && !safeSourceUrl(sourceUrl)) throw new Error('invalid-content')
  const entry: LibraryEntry = { ...newLibraryEntry(), id:value.id, title:string(value.title,120,true).trim(), summary:string(value.summary ?? '',240), blocks,
    sourceLabel:string(value.sourceLabel ?? '',300), sourceUrl, published:false, pinned:false, reviewStatus:'pending' }
  if (validateLibraryEntry(entry).length) throw new Error('invalid-content')
  return entry
}
