import { useEffect, useRef, useState } from 'react'
import { librarySections, tableColorStyle, type LibraryBlock, type LibraryEntry } from './model'
import { getLibraryAssetUrl } from './repository'

function AssetView({ block, file }: { block: Extract<LibraryBlock, { path: string }>; file?: File }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(100)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let cancelled = false
    let release = () => {}
    setUrl(''); setError('')
    const load = async () => {
      try {
        const asset = file ? { url: URL.createObjectURL(file), release: () => {} } : await getLibraryAssetUrl(block.path)
        release = file ? () => URL.revokeObjectURL(asset.url) : asset.release
        if (cancelled) { release(); return }
        setUrl(asset.url)
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Dosya açılamadı.') }
    }
    void load()
    return () => { cancelled = true; release() }
  }, [block.path, file, attempt])
  if (error) return <div className="library-asset-error" role="alert"><p>{error}</p><button type="button" className="ghost-button" onClick={() => setAttempt((value) => value + 1)}>Dosyayı Yeniden Yükle</button></div>
  if (!url) return <p className="hint-text" role="status">Dosya yükleniyor…</p>
  if (block.type === 'pdf') return <a className="library-pdf" href={url} target="_blank" rel="noopener noreferrer"><span className="library-file-icon" aria-hidden="true">PDF</span><span><strong>{block.caption || block.fileName}</strong><small>PDF dosyasını yeni sekmede aç</small></span><span aria-hidden="true">↗</span></a>
  return <figure className="library-image">
    <button className="library-image-button" type="button" aria-label={`${block.caption || block.fileName} görselini büyüt`} onClick={() => { setZoom(100); dialog.current?.showModal() }}>
      <img src={url} alt={block.caption || block.fileName} loading="lazy" onError={() => setError('Görsel yüklenemedi. Yeniden yüklemeyi dene.')} />
      <span>Görseli büyüt ↗</span>
    </button>
    {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    <dialog ref={dialog} className="library-image-dialog" aria-label={block.caption || block.fileName}>
      <div className="library-zoom-toolbar"><strong>{block.caption || block.fileName}</strong><div><button type="button" aria-label="Uzaklaştır" disabled={zoom <= 50} onClick={() => setZoom((value) => value - 25)}>−</button><span>{zoom}%</span><button type="button" aria-label="Yakınlaştır" disabled={zoom >= 300} onClick={() => setZoom((value) => value + 25)}>+</button><button type="button" className="ghost-button" onClick={() => dialog.current?.close()}>Kapat</button></div></div>
      <div className="library-zoom-scroll" tabIndex={0}><img src={url} alt={block.caption || block.fileName} style={{ width: `${zoom}%` }} /></div>
    </dialog>
  </figure>
}

export default function LibraryContent({ entry, files = new Map(), sectionId }: { entry: LibraryEntry; files?: Map<string, File>; sectionId?: string | null }) {
  const sections = librarySections(entry.blocks)
  const selectedSection = sections.find((section) => section.id === sectionId && sectionId)
  const blocks = selectedSection ? selectedSection.blocks : entry.blocks
  return <div className="library-content">
    {selectedSection ? <h3 className="library-subtopic-title">{selectedSection.title}</h3> : null}
    {blocks.map((block) => {
      if (block.type === 'section') return <h3 key={block.id} className="library-subtopic-title">{block.title}</h3>
      if (block.type === 'text') return <div key={block.id} className="library-prose">{block.text}</div>
      if (block.type === 'table') return <div key={block.id} className="library-table-section">
        {block.caption ? <h3>{block.caption}</h3> : null}
        <div className="library-table-scroll" tabIndex={0} role="region" aria-label={block.caption || 'Referans tablosu'}><table className={block.compact ? 'is-compact' : ''}><thead><tr>{block.headers.map((header, index) => <th key={index} scope="col" style={{ ...tableColorStyle(block.headerColor ?? '#18584e'), textAlign: block.align ?? 'left' }}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{block.headers.map((_, column) => column === 0 ? <th key={column} scope="row" style={{ ...tableColorStyle(block.rowColors?.[index]), textAlign: block.align ?? 'left' }}>{row[column]}</th> : <td key={column} style={{ ...tableColorStyle(block.rowColors?.[index]), textAlign: block.align ?? 'left' }}>{row[column]}</td>)}</tr>)}</tbody></table></div>
      </div>
      return <AssetView key={block.id} block={block} file={files.get(block.id)} />
    })}
    {entry.sourceLabel || entry.sourceUrl ? <footer className="library-source"><span>Kaynak</span>{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.sourceLabel || 'Kaynağı aç'} ↗</a> : <p>{entry.sourceLabel}</p>}</footer> : null}
  </div>
}
