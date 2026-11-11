import test from 'node:test'
import assert from 'node:assert/strict'
import { matchingRichText, plainRichText, richTextColor, richTextLink, richTextToPlain, sanitizeRichText } from '../src/library/richText.ts'
import { libraryRow, newLibraryEntry, normalizeRichBlock, parseLibraryRow, removeTableColumn, reorderTableRows, updateTableCell } from '../src/library/model.ts'

const styled = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#245a9c' } }] }] }] })

test('legacy plain text retains whitespace, line breaks and literal HTML', () => {
  for (const text of ['', 'İzlem\n\nİkinci satır\n', '  Girintili\tmetin', '<script>alert(1)</script>']) {
    assert.equal(richTextToPlain(sanitizeRichText(plainRichText(text))), text)
    assert.equal(matchingRichText(text, undefined), undefined)
  }
})
test('only supported formatting, color values and safe links survive', () => {
  const raw = styled('Örnek')
  raw.content[0].attrs = { textAlign: 'center', onclick: 'alert(1)' }
  raw.content[0].content[0].marks.push({ type: 'highlight', attrs: { color: 'rgb(255, 240, 191)', onclick: 'alert(1)' } }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'unknown' })
  raw.content.push({ type: 'script', text: 'BAD' })
  const safe = sanitizeRichText(raw)
  assert.equal(richTextToPlain(safe), 'Örnek')
  assert.deepEqual(safe.content[0].attrs, { textAlign: 'center' })
  assert.deepEqual(safe.content[0].content[0].marks.at(-1), { type: 'highlight', attrs: { color: '#fff0bf' } })
  assert.ok(!JSON.stringify(safe).includes('onclick'))
  assert.ok(!JSON.stringify(safe).includes('javascript'))
  assert.equal(richTextLink('https://example.org/guide'), 'https://example.org/guide')
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.org', '//example.org']) assert.equal(richTextLink(url), undefined)
  for (const color of ['red;display:none', 'url(https://example.org)', 'rgb(999,0,0)']) assert.equal(richTextColor(color), undefined)
  assert.equal(richTextColor('#AbC'), '#aabbcc')
})
test('nested lists and headings retain their text and safe formatting', () => {
  const raw = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Başlık' }] }, { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: plainRichText('Bir').content }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'İki' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: plainRichText('Alt madde').content }] }] }] }] }
  const safe = sanitizeRichText(raw)
  assert.equal(richTextToPlain(safe), 'Başlık\nBir\nİki\nAlt madde')
  assert.deepEqual(sanitizeRichText(safe), safe)
  assert.equal(sanitizeRichText({ type: 'doc', content: [{ type: 'blockquote' }] }).content[0].content[0].type, 'paragraph')
})
test('a stale rich document can never replace authoritative clinical text', () => {
  assert.equal(matchingRichText('Yeni bilgi', styled('Eski bilgi')), undefined)
  assert.deepEqual(normalizeRichBlock({ id: 'a', type: 'text', text: 'Yeni bilgi', richText: styled('Eski bilgi') }), { id: 'a', type: 'text', text: 'Yeni bilgi' })
})
test('text and table formatting round-trip through the existing storage row', () => {
  const text = { id: 'text', type: 'text', text: 'Örnek', richText: styled('Örnek') }
  const table = { id: 'table', type: 'table', caption: '', headers: ['Başlık'], rows: [['Hücre']], headerRichText: [styled('Başlık')], rowRichText: [[styled('Hücre')]], headerColor: '#234563', rowColors: ['#fff0bf'], align: 'left', compact: false }
  const entry = { ...newLibraryEntry(), title: 'Test', blocks: [text, table] }
  assert.deepEqual(parseLibraryRow(libraryRow(entry)).blocks, entry.blocks)
})
test('cell edits, column removal and row movement keep text and formatting together', () => {
  const source = { id: 'table', type: 'table', caption: '', headers: ['A', 'B'], rows: [['Bir', 'İki'], ['Üç', 'Dört']], rowColors: ['#fff0bf', null] }
  let table = updateTableCell(source, 0, 1, 'İki', styled('İki'))
  table = updateTableCell(table, -1, 1, 'B', styled('B'))
  table = reorderTableRows(table, [1, 0, 0])
  assert.equal(richTextToPlain(table.rowRichText[1][1]), 'İki')
  table.rowRichText[1][1].content[0].content[0].marks[0].type = 'italic'
  assert.equal(table.rowRichText[2][1].content[0].content[0].marks[0].type, 'bold')
  table = removeTableColumn(table, 0)
  assert.deepEqual(table.rows, [['Dört'], ['İki'], ['İki']])
  assert.equal(richTextToPlain(table.headerRichText[0]), 'B')
  assert.equal(richTextToPlain(table.rowRichText[2][0]), 'İki')
  assert.deepEqual(source.rows, [['Bir', 'İki'], ['Üç', 'Dört']])
})
test('malformed and oversized rich metadata falls back without altering plain content', () => {
  assert.equal(sanitizeRichText({ type: 'doc', content: Array.from({ length: 10001 }, () => ({ type: 'paragraph' })) }), undefined)
  assert.equal(sanitizeRichText({ type: 'doc', content: 'bad' }), undefined)
  const table = { id: 'a', type: 'table', caption: '', headers: ['Başlık'], rows: [['Yeni']], rowRichText: [[styled('Eski')]] }
  assert.deepEqual(normalizeRichBlock(table).rowRichText, [[null]])
})
