import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterLibrary, flattenLibrarySections, librarySections, reorderTableRows, tableColorStyle, libraryRow, newLibraryEntry, parseLibraryRow, parsePastedTable, safeSourceUrl, validateLibraryEntry, validAssetPath } from '../src/library/model.ts'

const entry = (overrides = {}) => ({ ...newLibraryEntry(), title: 'CRRT — sitrat ayarı', category: 'Böbrek / CRRT', published: true, blocks: [{ id: 'text', type: 'text', text: 'Kurum tarafından eklenen içerik.' }], ...overrides })
const filter = (entries, options = {}) => filterLibrary(entries, { query: '', category: 'all', ...options })

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
test('category and device favorites combine without changing source order', () => {
  const a = entry({ pinned: false }), b = entry({ pinned: true })
  const source = Object.freeze([a, b])
  assert.deepEqual(filter(source), [b, a])
  assert.deepEqual(filter(source, { category: a.category, onlyFavorites: true, favorites: new Set([a.id]) }), [a])
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


test('legacy entries remain a single general section; subtopics round-trip without nesting asset paths', () => {
  const legacy = entry()
  assert.deepEqual(librarySections(legacy.blocks), [{ id: null, title: 'Genel içerik', blocks: legacy.blocks }])
  const asset = { id: 'image', type: 'image', path: `${crypto.randomUUID()}/${crypto.randomUUID()}.png`, fileName: 'guide.png', caption: 'Kurum tablosu' }
  const item = entry({ blocks: [...legacy.blocks, { id: 'vanco', type: 'section', title: 'Vankomisin' }, asset, { id: 'mero', type: 'section', title: 'Meropenem' }, { id: 'note', type: 'text', text: 'Örnek açıklama' }] })
  const saved = parseLibraryRow(libraryRow(item))
  assert.deepEqual(saved.blocks, item.blocks)
  const groups = librarySections(saved.blocks)
  assert.deepEqual(groups.map((group) => group.title), ['Genel içerik', 'Vankomisin', 'Meropenem'])
  const reordered = flattenLibrarySections([groups[0], groups[2], groups[1]])
  assert.equal(librarySections(reordered)[2].blocks[0].path, asset.path)
  assert.ok(libraryRow({ ...item, blocks: reordered }).blocks.some((block) => block.path === asset.path))
  assert.deepEqual(validateLibraryEntry(item), [])
})
test('empty subtopics, missing titles and duplicate block identities cannot be published', () => {
  const marker = { id: 'subtopic', type: 'section', title: 'Vankomisin' }
  assert.ok(validateLibraryEntry(entry({ blocks: [marker] })).some((issue) => issue.includes('metin, tablo veya dosya')))
  assert.ok(validateLibraryEntry(entry({ blocks: [{ ...marker, title: '' }, { id: 'text', type: 'text', text: 'Not' }] })).some((issue) => issue.includes('Alt konu adı')))
  assert.ok(validateLibraryEntry(entry({ blocks: [{ ...marker, id: 'text' }, { id: 'text', type: 'text', text: 'Not' }] })).some((issue) => issue.includes('benzersiz')))
})
test('table colors, alignment and spacing survive storage; missing legacy styles stay usable', () => {
  const table = { id: 'table', type: 'table', caption: 'Örnek', headers: ['A', 'B'], rows: [['X', 'Y'], ['Z', 'W']], headerColor: '#234563', rowColors: ['#fff0bf', null], align: 'center', compact: true }
  const item = entry({ blocks: [table] })
  assert.deepEqual(parseLibraryRow(libraryRow(item)).blocks, [table])
  assert.deepEqual(validateLibraryEntry(item), [])
  const legacy = { id: 'old', type: 'table', caption: '', headers: ['Başlık'], rows: [['İçerik']] }
  const parsed = parseLibraryRow(libraryRow(entry({ blocks: [legacy] }))).blocks[0]
  assert.deepEqual(parsed.rows, legacy.rows)
  assert.deepEqual(parsed.rowColors, [null])
  assert.equal(parsed.align, 'left')
  assert.equal(parsed.compact, false)
})
test('row movement, duplication and removal carry colors with the original content', () => {
  const table = { id: 'table', type: 'table', caption: '', headers: ['A'], rows: [['Bir'], ['İki'], ['Üç']], rowColors: ['#fff0bf', '#e3effa', null] }
  const updated = reorderTableRows(table, [2, 0, 0])
  assert.deepEqual(updated.rows, [['Üç'], ['Bir'], ['Bir']])
  assert.deepEqual(updated.rowColors, [null, '#fff0bf', '#fff0bf'])
  updated.rows[1][0] = 'Düzenlendi'
  assert.equal(updated.rows[2][0], 'Bir')
  assert.equal(table.rows[0][0], 'Bir')
})
test('arbitrary CSS is rejected and untrusted stored colors cannot become CSS properties', () => {
  const table = { id: 'table', type: 'table', caption: '', headers: ['A'], rows: [['X']], headerColor: 'url(https://example.org)', rowColors: ['red;display:none'], align: 'unsafe' }
  const parsed = parseLibraryRow(libraryRow(entry({ blocks: [table] }))).blocks[0]
  assert.equal(parsed.headerColor, undefined)
  assert.deepEqual(parsed.rowColors, [null])
  assert.equal(parsed.align, 'left')
  assert.ok(validateLibraryEntry(entry({ blocks: [table] })).length >= 2)
  assert.deepEqual(tableColorStyle('red;display:none'), {})
  assert.equal(tableColorStyle('#ffffff').color, '#000000')
  assert.equal(tableColorStyle('#18584e').color, '#ffffff')
})
test('thirty titles with subtopics retain reader visibility and ordering', () => {
  const entries = Array.from({ length: 30 }, (_, index) => entry({ title: `Rehber ${String(index).padStart(2, '0')}`, blocks: [{ id: 'section', type: 'section', title: 'Alt konu' }, { id: 'text', type: 'text', text: 'Açıklama' }] }))
  assert.equal(filter(entries).length, 30)
  assert.equal(filter(entries)[0].title, 'Rehber 00')
  assert.equal(filter([...entries, entry({ published: false }), entry({ archivedAt: '2026-11-11' })]).length, 30)
})


test('legacy announcements become guides without losing identity, content or publication state', () => {
  const legacy = entry({ kind: 'announcement', title: 'Eski kayıt', pinned: true })
  const raw = { ...libraryRow(legacy), kind: 'announcement', updated_at: '2026-11-11T09:00:00Z' }
  const parsed = parseLibraryRow(raw)
  assert.equal(parsed.kind, 'reference')
  assert.equal(parsed.id, legacy.id)
  assert.equal(parsed.title, legacy.title)
  assert.deepEqual(parsed.blocks, legacy.blocks)
  assert.equal(parsed.published, true)
  assert.equal(parsed.pinned, true)
  assert.equal(libraryRow(legacy).kind, 'reference')
})
test('guide ordering uses pinned status then Turkish titles, irrespective of legacy kind or date', () => {
  const a = entry({ title: 'Antibiyotikler', updatedAt: '2026-01-01' })
  const c = entry({ title: 'CRRT', kind: 'announcement', updatedAt: '2026-11-11' })
  const pinned = entry({ title: 'Zor hava yolu', pinned: true })
  assert.deepEqual(filter([c, pinned, a]), [pinned, a, c])
})
