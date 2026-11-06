import { useEffect, useRef, useState } from 'react'
import { LIBRARY_CATEGORIES, MAX_BLOCKS, parsePastedTable, validateLibraryEntry, type LibraryBlock, type LibraryEntry } from './model'
import { validateAsset } from './repository'
import LibraryContent from './LibraryContent'

interface Props {
  initial: LibraryEntry
  onSave: (entry: LibraryEntry, files: Map<string, File>) => Promise<void>
  onClose: () => void
  busy: boolean
}

function TableEditor({ block, onChange }: { block: Extract<LibraryBlock, { type: 'table' }>; onChange: (block: LibraryBlock) => void }) {
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')
  return <div className="library-table-editor">
    <label>Tablo başlığı<input value={block.caption} maxLength={160} onChange={(event) => onChange({ ...block, caption: event.target.value })} placeholder="İsteğe bağlı tablo başlığı" /></label>
    <details className="library-paste"><summary>Excel / Google Sheets tablosu yapıştır</summary><p className="hint-text">Başlık satırıyla birlikte kopyala. Bu bölümdeki mevcut tabloyu değiştirir.</p><textarea aria-label="Yapıştırılacak tablo" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={'Başlık 1\tBaşlık 2\nSatır 1\tBilgi'} /><button className="secondary" type="button" disabled={!paste.trim()} onClick={() => { try { onChange({ ...block, ...parsePastedTable(paste) }); setPaste(''); setError('') } catch (failure) { setError((failure as Error).message) } }}>Tabloya Dönüştür</button>{error ? <p role="alert">{error}</p> : null}</details>
    <div className="library-table-scroll"><table><thead><tr>{block.headers.map((header, column) => <th key={column}><input aria-label={`${column + 1}. sütun başlığı`} value={header} maxLength={2000} onChange={(event) => onChange({ ...block, headers: block.headers.map((cell, index) => index === column ? event.target.value : cell) })} /><button type="button" className="library-small-button" aria-label={`${column + 1}. sütunu kaldır`} disabled={block.headers.length <= 1} onClick={() => onChange({ ...block, headers: block.headers.filter((_, index) => index !== column), rows: block.rows.map((row) => row.filter((_, index) => index !== column)) })}>Sütunu kaldır</button></th>)}<th scope="col">Satır</th></tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}><textarea aria-label={`${rowIndex + 1}. satır ${column + 1}. sütun`} value={cell} maxLength={2000} rows={2} onChange={(event) => onChange({ ...block, rows: block.rows.map((values, index) => index === rowIndex ? values.map((value, col) => col === column ? event.target.value : value) : values) })} /></td>)}<td><button type="button" className="library-small-button" aria-label={`${rowIndex + 1}. satırı kaldır`} disabled={block.rows.length <= 1} onClick={() => onChange({ ...block, rows: block.rows.filter((_, index) => index !== rowIndex) })}>Kaldır</button></td></tr>)}</tbody></table></div>
    <div className="library-inline-actions"><button type="button" className="ghost-button" disabled={block.rows.length >= 100} onClick={() => onChange({ ...block, rows: [...block.rows, block.headers.map(() => '')] })}>+ Satır</button><button type="button" className="ghost-button" disabled={block.headers.length >= 12} onClick={() => onChange({ ...block, headers: [...block.headers, ''], rows: block.rows.map((row) => [...row, '']) })}>+ Sütun</button></div>
  </div>
}

export default function LibraryEditor({ initial, onSave, onClose, busy }: Props) {
  const [draft, setDraft] = useState<LibraryEntry>(() => structuredClone(initial))
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [issues, setIssues] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || files.size > 0
  useEffect(() => { titleInput.current?.focus() }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const updateBlock = (next: LibraryBlock) => setDraft((previous) => ({ ...previous, blocks: previous.blocks.map((block) => block.id === next.id ? next : block) }))
  const addBlock = (block: LibraryBlock) => setDraft((previous) => ({ ...previous, blocks: [...previous.blocks, block] }))
  const moveBlock = (index: number, direction: number) => setDraft((previous) => {
    const blocks = [...previous.blocks]
    ;[blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]]
    return { ...previous, blocks }
  })
  const addFiles = async (selected: File[]) => {
    if (!selected.length) return
    if (draft.blocks.length + selected.length > MAX_BLOCKS) { setIssues([`En fazla ${MAX_BLOCKS} bölüm ekleyebilirsin.`]); return }
    setReadingFile(true)
    try {
      await Promise.all(selected.map(validateAsset))
      const additions = selected.map((file) => ({ id: crypto.randomUUID(), file }))
      setFiles((previous) => new Map([...previous, ...additions.map(({ id, file }) => [id, file] as const)]))
      setDraft((previous) => ({ ...previous, blocks: [...previous.blocks, ...additions.map(({ id, file }): LibraryBlock => ({ id, type: file.type === 'application/pdf' ? 'pdf' : 'image', path: '', fileName: file.name, caption: '' }))] }))
      setIssues([])
    } catch (failure) { setIssues([(failure as Error).message]) }
    finally { setReadingFile(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const save = async (published: boolean) => {
    const next = { ...draft, published }
    const errors = validateLibraryEntry(next, files)
    if (errors.length) { setIssues(errors); return }
    setIssues([])
    try { await onSave(next, files) } catch (failure) { setIssues([failure instanceof Error ? failure.message : 'Kayıt tamamlanamadı.']) }
  }
  return <section className="card library-editor" aria-labelledby="library-editor-title">
    <div className="library-section-heading"><div><p className="eyebrow">İÇERİK YÖNETİMİ</p><h2 id="library-editor-title">{initial.updatedAt ? 'İçeriği düzenle' : 'Yeni içerik'}</h2></div><button type="button" className="ghost-button" disabled={busy || readingFile} onClick={() => { if (!dirty || window.confirm('Kaydedilmemiş değişiklikler var. Düzenlemeden çıkılsın mı?')) onClose() }}>Vazgeç</button></div>
    <fieldset disabled={busy || readingFile} className="library-editor-fields">
      <div className="library-editor-meta"><label className="library-span-two">Başlık<input ref={titleInput} value={draft.title} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Örn. Antibiyotik GFR dozları" /></label><label>İçerik türü<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as LibraryEntry['kind'] })}><option value="reference">Hızlı rehber</option><option value="announcement">Duyuru</option></select></label><label>Kategori<input list="library-category-options" value={draft.category} maxLength={50} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /><datalist id="library-category-options">{LIBRARY_CATEGORIES.map((category) => <option key={category} value={category} />)}</datalist></label><label className="library-span-two">Kısa açıklama<textarea rows={2} maxLength={240} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="Kart üzerinde görünecek bir veya iki cümle" /></label><label className="library-check"><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />Üstte sabitle</label></div>
      <div className="library-editor-tabs"><button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>İçeriği Düzenle</button><button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Kullanıcı Önizlemesi</button></div>
      {preview ? <article className="library-editor-preview"><p className="library-kicker">{draft.category}</p><h2>{draft.title || 'İçerik başlığı'}</h2><p>{draft.summary}</p><LibraryContent entry={draft} files={files} /></article> : <>
        <div className="library-block-list">{draft.blocks.map((block, index) => <section className="library-block-editor" key={block.id}>
          <header><h3><span>{index + 1}</span>{block.type === 'text' ? 'Metin' : block.type === 'table' ? 'Tablo' : block.type === 'image' ? 'Görsel' : 'PDF dosyası'}</h3><div><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü yukarı taşı`} disabled={index === 0} onClick={() => moveBlock(index, -1)}>↑</button><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü aşağı taşı`} disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)}>↓</button><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü kaldır`} onClick={() => { setDraft({ ...draft, blocks: draft.blocks.filter((item) => item.id !== block.id) }); setFiles((previous) => { const next = new Map(previous); next.delete(block.id); return next }) }}>Kaldır</button></div></header>
          {block.type === 'text' ? <textarea aria-label={`${index + 1}. bölüm metni`} value={block.text} maxLength={20000} rows={6} onChange={(event) => updateBlock({ ...block, text: event.target.value })} placeholder="Açıklamalar, notlar veya duyuru metni…" /> : block.type === 'table' ? <TableEditor block={block} onChange={updateBlock} /> : <><label>Dosya açıklaması<input value={block.caption} maxLength={200} onChange={(event) => updateBlock({ ...block, caption: event.target.value })} placeholder="Görsel / dosya için kısa açıklama" /></label><p className="hint-text">{block.fileName}</p><LibraryContent entry={{ ...draft, sourceLabel: '', sourceUrl: '', blocks: [block] }} files={files} /></>}
        </section>)}</div>
        {!draft.blocks.length ? <div className="library-editor-empty">Metin, tablo veya dosya ekleyerek başla. Aynı başlık altında farklı içerikler bir arada olabilir.</div> : null}
        <div className="library-add-blocks"><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => addBlock({ id: crypto.randomUUID(), type: 'text', text: '' })}>+ Metin</button><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => addBlock({ id: crypto.randomUUID(), type: 'table', caption: '', headers: ['', ''], rows: [['', '']] })}>+ Tablo</button><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => fileInput.current?.click()}>+ Görsel / PDF</button><input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="library-file-input" aria-label="Görsel veya PDF seç" onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} /></div>
        <p className="hint-text">PNG, JPG, WebP veya PDF · Dosya başına en fazla 8 MB · Görseller özgün çözünürlüğünde saklanır.</p>
      </>}
      <div className="library-editor-meta library-source-fields"><label>Kaynak adı<input value={draft.sourceLabel} maxLength={300} onChange={(event) => setDraft({ ...draft, sourceLabel: event.target.value })} placeholder="İsteğe bağlı kaynak veya belge adı" /></label><label>Kaynak bağlantısı<input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label></div>
    </fieldset>
    {issues.length ? <div className="notice warning" role="alert"><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
    <div className="library-editor-footer"><p role="status">{busy ? 'Dosyalar ve içerik kaydediliyor…' : readingFile ? 'Dosyalar kontrol ediliyor…' : dirty ? 'Kaydedilmemiş değişiklikler var.' : 'Değişiklikler kaydedildiğinde kullanıcı görünümüne yansır.'}</p><div><button type="button" className="ghost-button" disabled={busy || readingFile} onClick={() => void save(false)}>{initial.published ? 'Yayından Kaldır ve Kaydet' : 'Taslak Kaydet'}</button><button type="button" disabled={busy || readingFile} onClick={() => void save(true)}>{initial.published ? 'Değişiklikleri Yayınla' : 'Yayınla'}</button></div></div>
  </section>
}
