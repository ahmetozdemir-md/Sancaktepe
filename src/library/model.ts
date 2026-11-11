// Keep the storage discriminator for compatibility; the product now contains guides only.
export type LibraryKind = 'reference'
export type LibraryTable = { id: string; type: 'table'; caption: string; headers: string[]; rows: string[][]; headerColor?: string; rowColors?: (string | null)[]; align?: 'left' | 'center' | 'right'; compact?: boolean }
export type LibraryBlock =
  | { id: string; type: 'section'; title: string }
  | { id: string; type: 'text'; text: string }
  | LibraryTable
  | { id: string; type: 'image' | 'pdf'; path: string; fileName: string; caption: string }

export interface LibraryEntry {
  id: string
  title: string
  summary: string
  category: string
  kind: LibraryKind
  pinned: boolean
  published: boolean
  blocks: LibraryBlock[]
  sourceLabel: string
  sourceUrl: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export const LIBRARY_CATEGORIES = ['Genel', 'İlaç ve doz', 'Hemodinami', 'Böbrek / CRRT', 'Solunum', 'Prosedürler', 'Klinik işleyiş']
export const MAX_ASSET_BYTES = 8 * 1024 * 1024
export const MAX_BLOCKS = 20
export const ASSET_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' }

export function safeTableColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined
}

export function tableColorStyle(value: unknown): { backgroundColor?: string; color?: string } {
  const color = safeTableColor(value)
  if (!color) return {}
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return { backgroundColor: color, color: luminance > 0.179 ? '#000000' : '#ffffff' }
}

export interface LibrarySection { id: string | null; title: string; blocks: Exclude<LibraryBlock, { type: 'section' }>[] }
export function librarySections(blocks: LibraryBlock[]): LibrarySection[] {
  const sections: LibrarySection[] = [{ id: null, title: 'Genel içerik', blocks: [] }]
  for (const block of blocks) {
    if (block.type === 'section') sections.push({ id: block.id, title: block.title, blocks: [] })
    else sections[sections.length - 1].blocks.push(block)
  }
  return sections
}

/** Keep section contents and asset paths together; assets remain top-level for storage access policies. */
export function flattenLibrarySections(sections: LibrarySection[]): LibraryBlock[] {
  return sections.flatMap((section): LibraryBlock[] => section.id ? [{ id: section.id, type: 'section', title: section.title }, ...section.blocks] : section.blocks)
}

export function reorderTableRows(block: LibraryTable, order: number[]): LibraryTable {
  return { ...block, rows: order.map((index) => [...block.rows[index]]), rowColors: order.map((index) => block.rowColors?.[index] ?? null) }
}

export function newLibraryEntry(): LibraryEntry {
  return { id: crypto.randomUUID(), title: '', summary: '', category: 'Genel', kind: 'reference', pinned: false, published: false, blocks: [], sourceLabel: '', sourceUrl: '', createdAt: '', updatedAt: '', archivedAt: null }
}

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

export function safeSourceUrl(value: string): string | null {
  if (!value.trim()) return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function validAssetPath(path: string): boolean {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(png|jpg|webp|pdf)$/.test(path)
}

export function validateLibraryEntry(entry: LibraryEntry, pending?: Map<string, File>): string[] {
  const issues: string[] = []
  if (!entry.title.trim() || entry.title.length > 120) issues.push('Başlık 1–120 karakter olmalı.')
  if (entry.summary.length > 240) issues.push('Kısa açıklama en fazla 240 karakter olabilir.')
  if (!entry.category.trim() || entry.category.length > 50) issues.push('Kategori 1–50 karakter olmalı.')
  if (safeSourceUrl(entry.sourceUrl) === null) issues.push('Kaynak bağlantısı http:// veya https:// ile başlamalı.')
  if (!entry.blocks.length || entry.blocks.length > MAX_BLOCKS) issues.push(`En az bir içerik ekle; en fazla ${MAX_BLOCKS} bölüm olabilir.`)
  if (new Set(entry.blocks.map((block) => block.id)).size !== entry.blocks.length) issues.push('İçerik bölümlerinin kimlikleri benzersiz olmalı.')
  for (const section of librarySections(entry.blocks).filter((section) => section.id)) {
    if (!section.title.trim() || section.title.length > 100) issues.push('Alt konu adı 1–100 karakter olmalı.')
    if (!section.blocks.length) issues.push(`“${section.title || 'Adsız alt konu'}” için metin, tablo veya dosya ekle.`)
  }
  entry.blocks.forEach((block, index) => {
    const prefix = `${index + 1}. bölüm: `
    if (block.type === 'text' && (!block.text.trim() || block.text.length > 20000)) issues.push(prefix + 'Metin 1–20.000 karakter olmalı.')
    if (block.type === 'table') {
      if (!block.headers.length || block.headers.length > 12 || !block.rows.length || block.rows.length > 100) issues.push(prefix + 'Tablo 1–12 sütun ve 1–100 satır içermeli.')
      if (block.rows.some((row) => row.length !== block.headers.length)) issues.push(prefix + 'Tablonun sütun sayıları eşit olmalı.')
      if (block.headers.some((value) => !value.trim())) issues.push(prefix + 'Tüm sütun başlıklarını doldur.')
      if ([...block.headers, ...block.rows.flat()].some((cell) => cell.length > 2000)) issues.push(prefix + 'Tablo hücresi en fazla 2.000 karakter olabilir.')
      if (!block.rows.some((row) => row.some((cell) => cell.trim()))) issues.push(prefix + 'Tabloya en az bir dolu hücre ekle.')
      if (block.headerColor && !safeTableColor(block.headerColor)) issues.push(prefix + 'Başlık rengi geçersiz.')
      if (block.rowColors?.some((color) => color !== null && !safeTableColor(color))) issues.push(prefix + 'Satır rengi geçersiz.')
    }
    if ((block.type === 'image' || block.type === 'pdf') && !validAssetPath(block.path) && !pending?.has(block.id)) issues.push(prefix + 'Dosya seçilmeli.')
  })
  return issues
}

export function parsePastedTable(text: string): { headers: string[]; rows: string[][] } {
  // Read TSV including quoted multiline Excel cells. Content stays plain text.
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '"' && (quoted || cell === '')) {
      if (quoted && input[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted
    } else if (!quoted && (char === '\t' || char === '\n')) {
      row.push(cell); cell = ''
      if (char === '\n') { rows.push(row); row = [] }
    } else cell += char
  }
  if (quoted) throw new Error('Tablodaki tırnak kapanmamış. Hücrelerin tamamını kopyala.')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((value) => !value.trim())) rows.pop()
  if (rows.length < 2) throw new Error('İlk satır başlık, altında en az bir veri satırı olmalı.')
  const width = Math.max(...rows.map((cells) => cells.length))
  if (width > 12 || rows.length > 101) throw new Error('En fazla 12 sütun ve 100 veri satırı yapıştırabilirsin.')
  const normalized = rows.map((cells) => Array.from({ length: width }, (_, index) => cells[index]?.trim() ?? ''))
  return { headers: normalized[0], rows: normalized.slice(1) }
}

export function filterLibrary(entries: LibraryEntry[], options: { query: string; category: string; favorites?: Set<string>; onlyFavorites?: boolean; admin?: boolean; status?: string }): LibraryEntry[] {
  const terms = normalizeSearch(options.query).split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (!options.admin && (!entry.published || entry.archivedAt)) return false
    if (options.admin) {
      const showArchived = options.status === 'archived'
      if (showArchived !== Boolean(entry.archivedAt)) return false
    }
    if (options.admin && options.status === 'draft' && entry.published) return false
    if (options.admin && options.status === 'published' && !entry.published) return false
    if (options.category !== 'all' && entry.category !== options.category) return false
    if (options.onlyFavorites && !options.favorites?.has(entry.id)) return false
    const searchable = normalizeSearch(`${entry.title} ${entry.summary} ${entry.category}`)
    return terms.every((term) => searchable.includes(term))
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title, 'tr'))
}

export function parseLibraryRow(raw: Record<string, unknown>): LibraryEntry {
  const str = (key: string) => typeof raw[key] === 'string' ? raw[key] as string : ''
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.filter((block): block is LibraryBlock => {
    if (!block || typeof block !== 'object' || typeof block.id !== 'string') return false
    if (block.type === 'section') return typeof block.title === 'string'
    if (block.type === 'text') return typeof block.text === 'string'
    if (block.type === 'table') return typeof block.caption === 'string' && Array.isArray(block.headers) && block.headers.every((cell: unknown) => typeof cell === 'string') && Array.isArray(block.rows) && block.rows.every((row: unknown) => Array.isArray(row) && row.every((cell: unknown) => typeof cell === 'string'))
    return ['image', 'pdf'].includes(block.type) && typeof block.path === 'string' && validAssetPath(block.path) && typeof block.caption === 'string' && typeof block.fileName === 'string'
  }).map((block) => block.type === 'table' ? { ...block, headerColor: safeTableColor(block.headerColor), rowColors: block.rows.map((_, index) => safeTableColor(block.rowColors?.[index]) ?? null), align: ['left', 'center', 'right'].includes(block.align ?? '') ? block.align : 'left', compact: block.compact === true } : block) : []
  return { id: str('id'), title: str('title'), summary: str('summary'), category: str('category'), kind: 'reference', pinned: raw.pinned === true, published: raw.is_published === true, blocks, sourceLabel: str('source_label'), sourceUrl: safeSourceUrl(str('source_url')) ?? '', createdAt: str('created_at'), updatedAt: str('updated_at'), archivedAt: str('archived_at') || null }
}

export function libraryRow(entry: LibraryEntry) {
  return { id: entry.id, title: entry.title.trim(), summary: entry.summary.trim(), category: entry.category.trim(), kind: 'reference', pinned: entry.pinned, is_published: entry.published, blocks: entry.blocks, source_label: entry.sourceLabel.trim(), source_url: safeSourceUrl(entry.sourceUrl) ?? '', archived_at: entry.archivedAt }
}
