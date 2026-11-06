import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterLibrary, libraryRow, newLibraryEntry, parseLibraryRow, parsePastedTable, safeSourceUrl, validateLibraryEntry, validAssetPath } from '../src/library/model.ts'

const entry = (overrides = {}) => ({ ...newLibraryEntry(), title: 'CRRT — sitrat ayarı', category: 'Böbrek / CRRT', published: true, blocks: [{ id: 'text', type: 'text', text: 'Kurum tarafından eklenen içerik.' }], ...overrides })
const filter = (entries, options = {}) => filterLibrary(entries, { query: '', kind: 'all', category: 'all', ...options })

test('readers see only published, non-archived records; admin status filters stay separate', () => {
  const published = entry(), draft = entry({ published: false }), archived = entry({ archivedAt: '2026-11-06' })
  assert.deepEqual(filter([draft, published, archived]), [published])
  assert.deepEqual(filter([draft, published, archived], { admin: true, status: 'draft' }), [draft])
  assert.deepEqual(filter([draft, published, archived], { admin: true, status: 'published' }), [published])
  assert.deepEqual(filter([draft, published, archived], { admin: true, status: 'archived' }), [archived])
})
test('Turkish search matches unaccented words across title, description and category', () => {
  const item = entry({ title: 'İnotrop ve vazopressör', category: 'İlaç ve doz', summary: 'Hızlı başvuru' })
  assert.deepEqual(filter([item], { query: 'INOTROP ilac hizli' }), [item])
  assert.deepEqual(filter([item], { query: 'CRRT' }), [])
})
test('category, content type and device favorites combine without changing source order', () => {
  const a = entry({ pinned: false }), b = entry({ pinned: true, kind: 'announcement' })
  const source = Object.freeze([a, b])
  assert.deepEqual(filter(source), [b, a])
  assert.deepEqual(filter(source, { category: a.category, kind: 'reference', onlyFavorites: true, favorites: new Set([a.id]) }), [a])
  assert.deepEqual(source, [a, b])
})
test('Excel paste preserves quoted tabs, line breaks and escaped quotes', () => {
  assert.deepEqual(parsePastedTable('Alan\tBilgi\r\nA\t"Bir\r\niki"\r\nB\t"Bir\tiki ""üç"""\r\n'), { headers: ['Alan', 'Bilgi'], rows: [['A', 'Bir\niki'], ['B', 'Bir\tiki "üç"']] })
})
test('paste pads ragged rows and rejects empty, incomplete and oversized tables', () => {
  assert.deepEqual(parsePastedTable('A\tB\nx'), { headers: ['A', 'B'], rows: [['x', '']] })
  for (const value of ['', 'A\tB', 'A\n"incomplete', Array(13).fill('A').join('\t') + '\nx', 'A\n' + Array(101).fill('x').join('\n')]) assert.throws(() => parsePastedTable(value))
})
test('untrusted source links and asset paths are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://name:pass@example.org', '//example.org']) assert.equal(safeSourceUrl(url), null)
  assert.equal(safeSourceUrl('https://example.org/reference'), 'https://example.org/reference')
  for (const path of ['../secret.png', 'https://example.org/image.png', 'x/y.svg']) assert.equal(validAssetPath(path), false)
  const path = `${crypto.randomUUID()}/${crypto.randomUUID()}.png`
  assert.equal(validAssetPath(path), true)
})
test('publish validation rejects blank content, bad tables and missing uploads', () => {
  assert.deepEqual(validateLibraryEntry(entry()), [])
  assert.ok(validateLibraryEntry(entry({ title: ' ', blocks: [] })).length >= 2)
  const table = { id: 'table', type: 'table', caption: '', headers: ['A', ''], rows: [['B']] }
  assert.ok(validateLibraryEntry(entry({ blocks: [table] })).length >= 2)
  const image = { id: 'image', type: 'image', path: '', fileName: 'test.png', caption: '' }
  assert.ok(validateLibraryEntry(entry({ blocks: [image] })).length)
  assert.deepEqual(validateLibraryEntry(entry({ blocks: [image] }), new Map([['image', {}]])), [])
})
test('remote parsing ignores malformed blocks and unsafe sources; storage preserves plain text', () => {
  const item = entry({ sourceUrl: 'https://example.org', blocks: [{ id: 'text', type: 'text', text: '<script>plain text</script>' }] })
  const raw = { ...libraryRow(item), blocks: [...item.blocks, { id: 'bad', type: 'image', path: '../secret', caption: '', fileName: '' }], source_url: 'javascript:alert(1)' }
  const parsed = parseLibraryRow(raw)
  assert.deepEqual(parsed.blocks, item.blocks)
  assert.equal(parsed.sourceUrl, '')
})
