import { useEffect, useRef, useState } from 'react'
import { MAX_BLOCKS, flattenLibrarySections, librarySections, validateLibraryEntry, type LibraryBlock, type LibraryEntry, type LibrarySection } from './model'
import { validateAsset } from './repository'
import LibraryContent from './LibraryContent'
import LibraryTableEditor from './LibraryTableEditor'

interface Props {
  initial: LibraryEntry
  onSave: (entry: LibraryEntry, files: Map<string, File>) => Promise<void>
  onClose: () => void
  busy: boolean
}
const blockLabels = { text: 'Metin', table: 'Tablo', image: 'Görsel', pdf: 'PDF dosyası' }

export default function LibraryEditor({ initial, onSave, onClose, busy }: Props) {
  const [draft, setDraft] = useState<LibraryEntry>(() => structuredClone(initial))
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [issues, setIssues] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const sectionInput = useRef<HTMLInputElement>(null)
  const uploadSection = useRef<string | null>(null)
  const sections = librarySections(draft.blocks)
  const section = sections.find((item) => item.id === sectionId) ?? sections[0]
  const sectionIndex = sections.indexOf(section)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || files.size > 0
  useEffect(() => { titleInput.current?.focus() }, [])
  useEffect(() => { if (sectionId) sectionInput.current?.focus() }, [sectionId])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const changeSections = (transform: (groups: LibrarySection[]) => LibrarySection[]) => setDraft((previous) => ({ ...previous, blocks: flattenLibrarySections(transform(librarySections(previous.blocks))) }))
  const updateBlock = (next: LibraryBlock) => setDraft((previous) => ({ ...previous, blocks: previous.blocks.map((block) => block.id === next.id ? next : block) }))
  const addBlocks = (blocks: LibrarySection['blocks'], target = section.id) => changeSections((groups) => groups.map((group) => group.id === target ? { ...group, blocks: [...group.blocks, ...blocks] } : group))
  const moveBlock = (index: number, direction: number) => changeSections((groups) => groups.map((group) => {
    if (group.id !== section.id) return group
    const blocks = [...group.blocks]
    ;[blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]]
    return { ...group, blocks }
  }))
  const moveSection = (direction: number) => changeSections((groups) => {
    const next = [...groups]
    ;[next[sectionIndex], next[sectionIndex + direction]] = [next[sectionIndex + direction], next[sectionIndex]]
    return next
  })
  const removeBlocks = (ids: string[]) => {
    setDraft((previous) => ({ ...previous, blocks: previous.blocks.filter((block) => !ids.includes(block.id)) }))
    setFiles((previous) => { const next = new Map(previous); ids.forEach((id) => next.delete(id)); return next })
  }
  const addFiles = async (selected: File[]) => {
    if (!selected.length) return
    if (draft.blocks.length + selected.length > MAX_BLOCKS) { setIssues([`En fazla ${MAX_BLOCKS} içerik bölümü ekleyebilirsin. Gerekirse ayrı bir rehber oluştur.`]); return }
    setReadingFile(true)
    try {
      await Promise.all(selected.map(validateAsset))
      const additions = selected.map((file) => ({ id: crypto.randomUUID(), file }))
      setFiles((previous) => new Map([...previous, ...additions.map(({ id, file }) => [id, file] as const)]))
      addBlocks(additions.map(({ id, file }) => ({ id, type: file.type === 'application/pdf' ? 'pdf' : 'image', path: '', fileName: file.name, caption: '' })), uploadSection.current)
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
    <div className="library-section-heading"><div><p className="eyebrow">İÇERİK YÖNETİMİ</p><h2 id="library-editor-title">{initial.updatedAt ? 'İçeriği düzenle' : 'Yeni içerik'}</h2><p>Başlığını belirle, içeriğini ekle. İstersen alt konulara ayır.</p></div><button type="button" className="ghost-button" disabled={busy || readingFile} onClick={() => { if (!dirty || window.confirm('Kaydedilmemiş değişiklikler var. Düzenlemeden çıkılsın mı?')) onClose() }}>Vazgeç</button></div>
    <fieldset disabled={busy || readingFile} className="library-editor-fields">
      <div className="library-editor-meta">
        <label>Başlık<input ref={titleInput} value={draft.title} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Örn. Antibiyotikler" /></label>
        <label>İçerik türü<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as LibraryEntry['kind'] })}><option value="reference">Hızlı rehber</option><option value="announcement">Duyuru</option></select></label>
        <label className="library-span-two">Kısa açıklama <span className="library-optional">İsteğe bağlı</span><textarea rows={2} maxLength={240} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="Başlığın altında görünecek kısa açıklama" /></label>
        <label className="library-check"><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />Üstte sabitle</label>
      </div>
      <div className="library-editor-tabs" role="group" aria-label="Editör görünümü"><button type="button" aria-pressed={!preview} className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>İçeriği Düzenle</button><button type="button" aria-pressed={preview} className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Kullanıcı Önizlemesi</button></div>
      {preview ? <article className="library-editor-preview"><p className="library-kicker">{draft.kind === 'announcement' ? 'Duyuru' : 'Hızlı rehber'}</p><h2>{draft.title || 'İçerik başlığı'}</h2><p>{draft.summary}</p><LibraryContent entry={draft} files={files} /></article> : <div className="library-compose-layout">
        <aside className="library-outline"><h3>İçerik yapısı</h3><p>Bir bölümü seçerek düzenle.</p><nav aria-label="Düzenlenecek alt konu">{sections.map((group) => <button key={group.id ?? 'general'} type="button" className={section.id === group.id ? 'active' : ''} aria-current={section.id === group.id ? 'true' : undefined} onClick={() => setSectionId(group.id)}><span aria-hidden="true">{group.id ? '↳' : '≡'}</span>{group.title || 'Adsız alt konu'}</button>)}</nav><button type="button" className="library-add-topic" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => { const id = crypto.randomUUID(); changeSections((groups) => [...groups, { id, title: '', blocks: [] }]); setSectionId(id) }}>+ Alt konu ekle</button><p className="hint-text">Örnek: Antibiyotikler altında Vankomisin ve Meropenem.</p></aside>
        <div className="library-compose-main">
          {section.id ? <div className="library-topic-edit"><label>Alt konu adı<input ref={sectionInput} value={section.title} maxLength={100} onChange={(event) => updateBlock({ id: section.id!, type: 'section', title: event.target.value })} placeholder="Örn. Vankomisin" /></label><div className="library-inline-actions"><button type="button" className="library-small-button" disabled={sectionIndex <= 1} onClick={() => moveSection(-1)}>↑ Yukarı</button><button type="button" className="library-small-button" disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(1)}>↓ Aşağı</button><button type="button" className="library-small-button" onClick={() => { if (section.blocks.length && !window.confirm(`“${section.title || 'Adsız alt konu'}” ve içeriği düzenlemeden kaldırılsın mı? Değişiklik ancak kaydedince uygulanır.`)) return; removeBlocks([section.id!, ...section.blocks.map((block) => block.id)]); setSectionId(null) }}>Alt konuyu kaldır</button></div></div> : <div className="library-general-heading"><h3>Genel içerik</h3><p>Tek başına bir rehber için içeriğini buraya ekle. Alt konular varsa bu bölüm giriş açıklaması olarak kullanılabilir.</p></div>}
          <div className="library-block-list">{section.blocks.map((block, index) => <section className="library-block-editor" key={block.id} aria-label={`${index + 1}. içerik bölümü`}>
            <header><h3><span>{index + 1}</span>{blockLabels[block.type]}</h3><div><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü yukarı taşı`} disabled={index === 0} onClick={() => moveBlock(index, -1)}>↑</button><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü aşağı taşı`} disabled={index === section.blocks.length - 1} onClick={() => moveBlock(index, 1)}>↓</button><button type="button" className="library-small-button" aria-label={`${index + 1}. bölümü kaldır`} onClick={() => removeBlocks([block.id])}>Kaldır</button></div></header>
            {block.type === 'text' ? <textarea aria-label={`${index + 1}. bölüm metni`} value={block.text} maxLength={20000} rows={6} onChange={(event) => updateBlock({ ...block, text: event.target.value })} placeholder="Açıklamalar, notlar veya duyuru metni…" /> : block.type === 'table' ? <LibraryTableEditor block={block} onChange={updateBlock} /> : <><label>Dosya açıklaması<input value={block.caption} maxLength={200} onChange={(event) => updateBlock({ ...block, caption: event.target.value })} placeholder="Görsel / dosya için kısa açıklama" /></label><p className="hint-text">{block.fileName}</p><LibraryContent entry={{ ...draft, sourceLabel: '', sourceUrl: '', blocks: [block] }} files={files} /></>}
          </section>)}</div>
          {!section.blocks.length ? <div className="library-editor-empty">{section.id ? 'Bu alt konuya metin, tablo veya dosya ekle.' : 'Metin, tablo veya dosya ekleyerek başla; ya da bir alt konu oluştur.'}</div> : null}
          <div className="library-add-blocks"><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => addBlocks([{ id: crypto.randomUUID(), type: 'text', text: '' }])}>+ Metin</button><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => addBlocks([{ id: crypto.randomUUID(), type: 'table', caption: '', headers: ['', ''], rows: [['', '']] }])}>+ Tablo</button><button type="button" className="secondary" disabled={draft.blocks.length >= MAX_BLOCKS} onClick={() => { uploadSection.current = section.id; fileInput.current?.click() }}>+ Görsel / PDF</button><input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="library-file-input" aria-label="Görsel veya PDF seç" onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} /></div>
          <p className="hint-text">PNG, JPG, WebP veya PDF · Dosya başına en fazla 8 MB.</p>
          {draft.blocks.length >= MAX_BLOCKS ? <p className="notice warning">Bu rehberdeki bölüm sınırına ulaştın. Yeni içerikler için ayrı bir rehber oluşturabilirsin.</p> : null}
        </div>
      </div>}
      <details className="library-source-fields"><summary>Kaynak bilgisi <span className="library-optional">İsteğe bağlı</span></summary><div className="library-editor-meta"><label>Kaynak adı<input value={draft.sourceLabel} maxLength={300} onChange={(event) => setDraft({ ...draft, sourceLabel: event.target.value })} placeholder="Kaynak veya belge adı" /></label><label>Kaynak bağlantısı<input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label></div></details>
    </fieldset>
    {issues.length ? <div className="notice warning" role="alert"><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
    <div className="library-editor-footer"><p role="status">{busy ? 'Dosyalar ve içerik kaydediliyor…' : readingFile ? 'Dosyalar kontrol ediliyor…' : dirty ? 'Kaydedilmemiş değişiklikler var.' : 'Değişiklikler kaydedildiğinde kullanıcı görünümüne yansır.'}</p><div><button type="button" className="ghost-button" disabled={busy || readingFile} onClick={() => void save(false)}>{initial.published ? 'Yayından Kaldır ve Kaydet' : 'Taslak Kaydet'}</button><button type="button" disabled={busy || readingFile} onClick={() => void save(true)}>{initial.published ? 'Değişiklikleri Yayınla' : 'Yayınla'}</button></div></div>
  </section>
}
