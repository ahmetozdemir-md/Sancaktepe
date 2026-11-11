import { librarySections, type LibraryEntry } from './model'

interface Props {
  entries: LibraryEntry[]
  admin: boolean
  busy: boolean
  favorites: Set<string>
  expanded: Set<string>
  onExpand: (id: string) => void
  onFavorite: (id: string) => void
  onOpen: (entry: LibraryEntry, sectionId?: string) => void
  onEdit: (entry: LibraryEntry) => void
  onArchive: (entry: LibraryEntry, restore?: boolean) => void
}

export default function LibraryDirectory({ entries, admin, busy, favorites, expanded, onExpand, onFavorite, onOpen, onEdit, onArchive }: Props) {
  return <div className="library-index">{entries.map((entry) => {
    const topics = librarySections(entry.blocks).filter((section) => section.id)
    const open = expanded.has(entry.id)
    return <article key={entry.id} className={`library-index-item${entry.pinned ? ' is-pinned' : ''}`}>
      <div className="library-index-row">
        <button id={`library-open-${entry.id}`} type="button" className="library-index-open" aria-expanded={topics.length ? open : undefined} aria-controls={topics.length ? `library-topics-${entry.id}` : undefined} onClick={() => topics.length ? onExpand(entry.id) : onOpen(entry)}>
          <span className="library-index-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h11l3 3v15H5zM9 8h6M9 12h6" />{topics.length ? <path d="M9 16h6" /> : null}</svg></span>
          <span className="library-index-copy"><span className="library-index-title">{entry.title}{entry.pinned ? <span className="library-pinned">Sabit</span> : null}</span>{entry.summary ? <span className="library-index-summary">{entry.summary}</span> : null}</span>
          <span className="library-index-arrow" aria-hidden="true">{topics.length ? open ? '−' : '+' : '→'}</span>
        </button>
        <button type="button" className="library-star" aria-label={`${entry.title}: ${favorites.has(entry.id) ? 'yıldızı kaldır' : 'yıldızla'}`} aria-pressed={favorites.has(entry.id)} onClick={() => onFavorite(entry.id)}>{favorites.has(entry.id) ? '★' : '☆'}</button>
        {admin ? <div className="library-index-admin"><span className={`library-status ${entry.archivedAt ? 'archived' : entry.published ? 'published' : 'draft'}`}>{entry.archivedAt ? 'Arşiv' : entry.published ? 'Yayında' : 'Taslak'}</span>{entry.archivedAt ? <button type="button" className="library-small-button" disabled={busy} onClick={() => onArchive(entry, true)}>Geri al</button> : <><button type="button" className="library-small-button" disabled={busy} aria-label={`${entry.title}: düzenle`} onClick={() => onEdit(entry)}>Düzenle</button><button type="button" className="library-small-button" disabled={busy} aria-label={`${entry.title}: arşivle`} onClick={() => onArchive(entry)}>Arşivle</button></>}</div> : null}
      </div>
      {topics.length ? <div id={`library-topics-${entry.id}`} className="library-index-topics" hidden={!open}><button type="button" className="library-topic-overview" onClick={() => onOpen(entry)}>Rehberin tamamını aç <span aria-hidden="true">↗</span></button><ul>{topics.map((topic) => <li key={topic.id}><button type="button" onClick={() => onOpen(entry, topic.id!)}><span>{topic.title}</span><span aria-hidden="true">→</span></button></li>)}</ul></div> : null}
    </article>
  })}</div>
}
