import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import RichTextEditor from './RichTextEditor'
import RichTextToolbar from './RichTextToolbar'
import RichTextView from './RichTextView'
import { parsePastedTable, removeTableColumn, updateTableCell, reorderTableRows, safeTableColor, tableColorStyle, type LibraryTable } from './model'

const COLORS = [
  ['Koyu yeşil', '#18584e'], ['Gece mavisi', '#234563'], ['Mor', '#635080'],
  ['Açık yeşil', '#e1f1e8'], ['Açık mavi', '#e3effa'], ['Sarı', '#fff0bf'],
  ['Mercan', '#fbe2db'], ['Lila', '#ede4f6'], ['Beyaz', '#ffffff'],
]

export default function LibraryTableEditor({ block, onChange, disabled = false }: { block: LibraryTable; onChange: (block: LibraryTable) => void; disabled?: boolean }) {
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const [cellEditor, setCellEditor] = useState<Editor | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')
  const [target, setTarget] = useState('header')
  const [custom, setCustom] = useState(block.headerColor ?? '#18584e')
  const selectedColor = target === 'header' ? block.headerColor ?? '#18584e' : target === 'all' ? undefined : block.rowColors?.[Number(target)]
  const chooseTarget = (value: string) => {
    setTarget(value)
    setCustom(value === 'header' ? block.headerColor ?? '#18584e' : block.rowColors?.[value === 'all' ? 0 : Number(value)] ?? '#ffffff')
  }
  const applyColor = (color: string | null) => {
    setCustom(color ?? (target === 'header' ? '#18584e' : '#ffffff'))
    if (target === 'header') onChange({ ...block, headerColor: color ?? undefined })
    else onChange({ ...block, rowColors: block.rows.map((_, index) => target === 'all' || Number(target) === index ? color : block.rowColors?.[index] ?? null) })
  }
  const rowAction = (index: number, action: 'up' | 'down' | 'duplicate' | 'remove') => {
    const order = block.rows.map((_, i) => i)
    if (action === 'remove') order.splice(index, 1)
    else if (action === 'duplicate') order.splice(index + 1, 0, index)
    else { const next = index + (action === 'up' ? -1 : 1); [order[index], order[next]] = [order[next], order[index]] }
    setActiveCell(null)
    onChange(reorderTableRows(block, order))
    chooseTarget('header')
  }
  const renderCell = (row: number, column: number) => {
    const key = `${row}:${column}`
    const text = row === -1 ? block.headers[column] : block.rows[row][column]
    const document = row === -1 ? block.headerRichText?.[column] : block.rowRichText?.[row]?.[column]
    const label = row === -1 ? `${column + 1}. sütun başlığı` : `${row + 1}. satır ${column + 1}. sütun`
    return activeCell === key ? <RichTextEditor key={key} label={label} text={text} document={document} compact autoFocus disabled={disabled} onReady={setCellEditor} onChange={(value, richText) => onChange(updateTableCell(block, row, column, value, richText))} />
      : <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} className="library-cell-preview" aria-label={`${label} düzenle`} onClick={() => { if (!disabled) setActiveCell(key) }} onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setActiveCell(key) } }}><RichTextView text={text || 'Yazı ekle…'} document={document} /></div>
  }
  return <div className="library-table-editor">
    <label>Tablo başlığı <span className="library-optional">İsteğe bağlı</span><input value={block.caption} maxLength={160} onChange={(event) => onChange({ ...block, caption: event.target.value })} placeholder="Örn. Böbrek fonksiyonuna göre doz ayarı" /></label>
    <details className="library-paste"><summary>Hazır tabloyu yapıştır</summary><p className="hint-text">Excel veya Google Sheets’ten başlık satırıyla birlikte kopyala. Mevcut hücreler ve satır renkleri değişir; başlık rengi korunur.</p><textarea aria-label="Yapıştırılacak tablo" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={'Başlık 1\tBaşlık 2\nSatır 1\tBilgi'} /><button className="secondary" type="button" disabled={!paste.trim()} onClick={() => { try { setActiveCell(null); onChange({ ...block, ...parsePastedTable(paste), rowColors: [], headerRichText: [], rowRichText: [] }); setPaste(''); setError(''); chooseTarget('header') } catch (failure) { setError((failure as Error).message) } }}>Tabloya Dönüştür</button>{error ? <p role="alert">{error}</p> : null}</details>
    <details className="library-table-format" open={formatOpen} onToggle={(event) => setFormatOpen(event.currentTarget.open)}><summary>Tablo görünümü <span>Satır renkleri, hizalama ve aralık</span></summary>
      <p className="hint-text">Başlığı veya veri satırını seçerek zemin rengini değiştir.</p>
      <div className="library-format-options">
        <label>Renklendirilecek alan<select value={target} onChange={(event) => chooseTarget(event.target.value)}><option value="header">Başlık satırı</option><option value="all">Tüm veri satırları</option>{block.rows.map((row, index) => <option key={index} value={index}>{index + 1}. satır{row[0] ? ` · ${row[0].slice(0, 35)}` : ''}</option>)}</select></label>
        <label>Hizalama<select value={block.align ?? 'left'} onChange={(event) => onChange({ ...block, align: event.target.value as LibraryTable['align'] })}><option value="left">Sola</option><option value="center">Ortala</option><option value="right">Sağa</option></select></label>
        <label>Satır aralığı<select value={block.compact ? 'compact' : 'normal'} onChange={(event) => onChange({ ...block, compact: event.target.value === 'compact' })}><option value="normal">Rahat</option><option value="compact">Sıkı</option></select></label>
      </div>
      <div className="library-color-tools">
        <div className="library-color-palette" role="group" aria-label="Hazır satır renkleri">{COLORS.map(([name, color]) => <button type="button" key={color} aria-label={name} title={name} aria-pressed={selectedColor === color} style={tableColorStyle(color)} onClick={() => applyColor(color)}>{selectedColor === color ? '✓' : ''}</button>)}</div>
        <div className="library-custom-color"><label className="library-color-input-label">Özel renk<input type="color" aria-label="Özel renk seçici" value={safeTableColor(custom) ?? '#18584e'} onChange={(event) => { setCustom(event.target.value); applyColor(event.target.value) }} /></label><input aria-label="Özel renk kodu" value={custom} maxLength={7} onChange={(event) => setCustom(event.target.value)} placeholder="#18584e" spellCheck={false} /><button type="button" className="library-small-button" disabled={!safeTableColor(custom)} onClick={() => applyColor(custom)}>Uygula</button></div>
        <button type="button" className="library-small-button" onClick={() => applyColor(null)}>Rengi sıfırla</button>
      </div>
      <p className="hint-text">Yazı rengi, seçtiğin zemine göre otomatik açılır veya koyulaşır.</p>
    </details>
    <div className="library-cell-format"><div className="library-cell-format-heading"><strong>Hücre yazısı</strong><span>{activeCell ? 'Seçili hücredeki yazıyı biçimlendir.' : 'Düzenlemek için bir hücreye tıkla.'}</span></div><RichTextToolbar editor={cellEditor} compact /></div>
    <div className="library-table-scroll" tabIndex={0} role="region" aria-label="Düzenlenebilir tablo"><table className={block.compact ? 'is-compact' : ''}><thead><tr>{block.headers.map((_, column) => <th key={column} style={{ ...tableColorStyle(block.headerColor ?? '#18584e'), textAlign: block.align ?? 'left' }}>{renderCell(-1, column)}<button type="button" className="library-small-button" aria-label={`${column + 1}. sütunu kaldır`} disabled={block.headers.length <= 1} onClick={() => { setActiveCell(null); onChange(removeTableColumn(block, column)) }}>Sütunu kaldır</button></th>)}<th scope="col" className="library-row-tools-heading">Satır işlemleri</th></tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} className={target === String(rowIndex) ? 'is-selected-row' : ''}>{row.map((_, column) => <td key={column} style={{ ...tableColorStyle(block.rowColors?.[rowIndex]), textAlign: block.align ?? 'left' }}>{renderCell(rowIndex, column)}</td>)}<td className="library-row-tools"><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı renklendir`} aria-pressed={target === String(rowIndex)} onClick={() => { chooseTarget(String(rowIndex)); setFormatOpen(true) }}>{rowIndex + 1}. satır · Renk</button><div><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı yukarı taşı`} disabled={rowIndex === 0} onClick={() => rowAction(rowIndex, 'up')}>↑</button><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı aşağı taşı`} disabled={rowIndex === block.rows.length - 1} onClick={() => rowAction(rowIndex, 'down')}>↓</button><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı çoğalt`} disabled={block.rows.length >= 100} onClick={() => rowAction(rowIndex, 'duplicate')}>Çoğalt</button><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı kaldır`} disabled={block.rows.length <= 1} onClick={() => rowAction(rowIndex, 'remove')}>Kaldır</button></div></td></tr>)}</tbody></table></div>
    <div className="library-inline-actions"><button type="button" className="ghost-button" disabled={block.rows.length >= 100} onClick={() => onChange({ ...block, rows: [...block.rows, block.headers.map(() => '')], rowColors: [...block.rows.map((_, index) => block.rowColors?.[index] ?? null), null] })}>+ Satır</button><button type="button" className="ghost-button" disabled={block.headers.length >= 12} onClick={() => onChange({ ...block, headers: [...block.headers, ''], rows: block.rows.map((row) => [...row, '']) })}>+ Sütun</button></div>
  </div>
}
