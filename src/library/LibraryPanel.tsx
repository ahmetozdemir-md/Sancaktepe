import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { filterLibrary, librarySections, newLibraryEntry, type LibraryEntry } from './model'
import { libraryIsLocal, listLibraryEntries, removeNewLibraryAssets, saveLibraryEntry, uploadLibraryAsset } from './repository'
import LibraryAccess from './LibraryAccess'
import LibraryContent from './LibraryContent'
import LibraryDirectory from './LibraryDirectory'
import ContributorLogin from './ContributorLogin'
import { ContributionAccessError, logoutContributor, submitContribution, type ContributorIdentity, type ContributorSession } from './contributions'
import './library.css'

const LibraryEditor = lazy(() => import('./LibraryEditor'))

function LibraryIcon() {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v15M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 1-3-1-5-2-9-1z" /><path d="M6 8h3m-3 4h3m6-4h3m-3 4h3" /></svg>
}
const formatDate = (value: string) => value ? new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const FAVORITES_KEY = 'klinik-atlas-library-favorites-v1'

interface Props { admin?: boolean; active?: boolean; onBusyChange?: (busy: boolean) => void; contributorIdentity?: ContributorIdentity }

export default function LibraryPanel(props: Props) {
  const [authorized, setAuthorized] = useState(libraryIsLocal)
  return <div>
    {props.admin ? <LibraryAccess onReady={setAuthorized} /> : null}
    {!props.admin || authorized ? <LibraryWorkspace {...props} /> : null}
  </div>
}

function LibraryWorkspace({ admin = false, active = true, onBusyChange, contributorIdentity }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('all')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []) } catch { return new Set() }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<LibraryEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [contributorSession, setContributorSession] = useState<ContributorSession | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const operationLock = useRef(false)
  const requestNumber = useRef(0)
  const lastOpened = useRef<string | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const refresh = useCallback(async () => {
    const request = ++requestNumber.current
    setLoading(true); setError('')
    try {
      const result = await listLibraryEntries(admin)
      if (request !== requestNumber.current) return
      setEntries(result); setLoaded(true)
    } catch (failure) { if (request === requestNumber.current) setError(admin && failure instanceof Error ? failure.message : 'Rehberler yüklenemedi. Bağlantını kontrol edip yeniden dene.') }
    finally { if (request === requestNumber.current) setLoading(false) }
  }, [admin])
  useEffect(() => {
    if (!active) return
    const requestCounter = requestNumber
    void refresh()
    const focus = () => { if (!operationLock.current) void refresh() }
    window.addEventListener('focus', focus)
    return () => { requestCounter.current++; window.removeEventListener('focus', focus) }
  }, [active, refresh])
  useEffect(() => {
    if (selected) detailHeading.current?.focus()
    else if (lastOpened.current) document.getElementById(`library-open-${lastOpened.current}`)?.focus()
  }, [selected, selectedSection])
  const favorite = (id: string) => setFavorites((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id); else next.add(id)
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next])) } catch { /* Device-only convenience; reading remains available. */ }
    return next
  })
  const replaceEntry = (saved: LibraryEntry) => setEntries((previous) => [saved, ...previous.filter((entry) => entry.id !== saved.id)])
  const save = async (entry: LibraryEntry, files: Map<string, File>) => {
    if (operationLock.current) return
    operationLock.current = true; setBusy(true); onBusyChange?.(true); setNotice('')
    const uploaded: string[] = []
    let recordSaveStarted = false
    try {
      const blocks = []
      for (const block of entry.blocks) {
        const file = files.get(block.id)
        if ((block.type === 'image' || block.type === 'pdf') && file) {
          const path = await uploadLibraryAsset(entry.id, file)
          uploaded.push(path); blocks.push({ ...block, path })
        } else blocks.push(block)
      }
      recordSaveStarted = true
      const saved = await saveLibraryEntry({ ...entry, blocks })
      replaceEntry(saved); setEditing(null); setSelected(null)
      setNotice(`${saved.published ? 'Rehber yayınlandı.' : saved.reviewStatus === 'pending' ? 'İnceleme değişiklikleri kaydedildi.' : 'Taslak kaydedildi.'}${libraryIsLocal ? ' Yalnız bu cihazda saklanıyor.' : ''}`)
    } catch (failure) {
      if (!recordSaveStarted) {
        try { await removeNewLibraryAssets(uploaded) } catch { /* Unreferenced private files remain invisible; never remove old published assets. */ }
      }
      // A lost save response may still have committed. Retain files once the record save starts.
      throw failure
    } finally { operationLock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const sendContribution = async (entry: LibraryEntry, files: Map<string, File>) => {
    if (operationLock.current) return
    if (!contributorSession || Date.parse(contributorSession.expiresAt) <= Date.now()) {
      setContributorSession(null); setLoginOpen(true)
      throw new Error('Göndermek için rehber gönderme şifresiyle tekrar giriş yap. İçeriğin korunuyor.')
    }
    operationLock.current = true; setBusy(true); onBusyChange?.(true)
    try {
      await submitContribution(contributorSession.token, entry, files)
      setEditing(null); setNotice('Rehberin incelemeye gönderildi. Admin onayından sonra yayınlanacak.')
    } catch (failure) {
      if (failure instanceof ContributionAccessError) { setContributorSession(null); setLoginOpen(true) }
      throw failure
    } finally { operationLock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const leaveContributor = async () => {
    if (!contributorSession || operationLock.current) return
    operationLock.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try { await logoutContributor(contributorSession.token); setContributorSession(null) }
    catch (failure) {
      if (failure instanceof ContributionAccessError) setContributorSession(null)
      else setError(failure instanceof Error ? failure.message : 'Çıkış yapılamadı; yeniden dene.')
    } finally { operationLock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const loginDialog = loginOpen && contributorIdentity ? <ContributorLogin identity={contributorIdentity} onClose={() => setLoginOpen(false)} onSuccess={(session) => { setContributorSession(session); setLoginOpen(false); setNotice('Rehber gönderme girişi yapıldı. Yeni bir rehber hazırlayabilirsin.') }} /> : null
  const archive = async (entry: LibraryEntry, restore = false) => {
    if (operationLock.current) return
    const pending = entry.reviewStatus === 'pending'
    if (!restore && !window.confirm(pending ? `“${entry.title}” gönderisi reddedilsin mi? Yayınlanmaz; arşivden geri alabilirsin.` : `“${entry.title}” arşivlensin mi? Kullanıcı görünümünden kalkar; daha sonra geri alabilirsin.`)) return
    operationLock.current = true; setBusy(true); onBusyChange?.(true)
    try {
      const saved = await saveLibraryEntry({ ...entry, published: false, reviewStatus: restore && entry.reviewStatus === 'rejected' ? 'pending' : pending ? 'rejected' : entry.reviewStatus, archivedAt: restore ? null : new Date().toISOString() })
      replaceEntry(saved); setSelected(null); setNotice(restore ? entry.reviewStatus === 'rejected' ? 'Gönderi tekrar onay bekleyenlere alındı.' : 'Rehber taslağa geri alındı. Düzenleyip tekrar yayınlayabilirsin.' : pending ? 'Gönderi reddedildi ve arşive taşındı.' : 'Rehber arşivlendi.')
    } catch (failure) { setError((failure as Error).message) }
    finally { operationLock.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const visible = filterLibrary(entries, { query: '', category: 'all', favorites, onlyFavorites, admin, status })
  const available = entries.filter((entry) => admin ? !entry.archivedAt : entry.published && (entry.reviewStatus ?? 'approved') === 'approved' && !entry.archivedAt)
  const current = entries.find((entry) => entry.id === selected && (admin || (entry.published && (entry.reviewStatus ?? 'approved') === 'approved' && !entry.archivedAt)))
  if (editing) return <>{loginDialog}<Suspense fallback={<section className="card" role="status">Rehber editörü açılıyor…</section>}><LibraryEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} onSave={admin ? save : sendContribution} busy={busy} contributionMode={!admin} /></Suspense></>
  if (current) {
    const topics = librarySections(current.blocks).filter((section) => section.id)
    return <section className="card library-detail">
      <div className="library-detail-toolbar"><button type="button" className="ghost-button" onClick={() => setSelected(null)}>← Tüm başlıklar</button><div>{admin && !current.archivedAt ? <button type="button" className="secondary" onClick={() => setEditing(current)}>Düzenle</button> : null}<button type="button" className="ghost-button" aria-pressed={favorites.has(current.id)} onClick={() => favorite(current.id)}>{favorites.has(current.id) ? '★ Yıldızlı' : '☆ Yıldızla'}</button></div></div>
      <div className="library-detail-head"><div className="library-card-tags">{admin && !current.published ? <span>{current.reviewStatus === 'pending' ? 'Onay bekliyor' : current.reviewStatus === 'rejected' ? 'Reddedildi' : 'Taslak'}</span> : null}</div><h2 ref={detailHeading} tabIndex={-1}>{current.title}</h2>{current.summary ? <p>{current.summary}</p> : null}<small>Son güncelleme: {formatDate(current.updatedAt)}</small></div>
      <div className={topics.length ? 'library-reading-layout' : ''}>
        {topics.length ? <nav className="library-reading-topics" aria-label="Rehber alt konuları"><p>BU REHBERDE</p><button type="button" aria-current={!selectedSection ? 'true' : undefined} onClick={() => setSelectedSection(null)}>Tüm içerik</button>{topics.map((topic) => <button type="button" key={topic.id} aria-current={selectedSection === topic.id ? 'true' : undefined} onClick={() => setSelectedSection(topic.id)}>{topic.title}</button>)}</nav> : null}
        <LibraryContent entry={current} sectionId={selectedSection} />
      </div>
    </section>
  }
  return <div className="library-workspace">{loginDialog}
    <section className="card library-directory" aria-labelledby="library-directory-title">
      <header className="library-section-heading"><div><p className="eyebrow">KLİNİK BAŞVURU</p><h2 id="library-directory-title">Rehberler</h2><p>{admin ? 'Rehberleri ve alt konularını düzenle; klinik bilgiyi kolay ulaşılır tut.' : 'İhtiyacın olan bilgiye başlıktan veya alt konudan ulaş.'}</p></div>{admin ? <button type="button" onClick={() => { setEditing(newLibraryEntry()); setNotice('') }}>+ Yeni Rehber</button> : contributorIdentity ? <div className="library-contributor-actions">{contributorSession ? <><button type="button" disabled={busy} onClick={() => { setEditing(newLibraryEntry()); setNotice('') }}>+ Rehber gönder</button><button type="button" className="ghost-button" disabled={busy} onClick={() => void leaveContributor()}>Çıkış</button></> : <button type="button" className="ghost-button library-contributor-entry" onClick={() => setLoginOpen(true)}>Giriş</button>}</div> : null}</header>
      {libraryIsLocal ? <p className="hint-text library-local-note">Yerel önizleme · İçerikler ve dosyalar yalnız bu cihazda saklanır.</p> : null}
      <div className="library-filter-row"><div className="library-view-filters" role="group" aria-label="Rehber görünümü"><button type="button" aria-pressed={!onlyFavorites && status !== 'pending'} className={!onlyFavorites && status !== 'pending' ? 'active' : ''} onClick={() => { setOnlyFavorites(false); setStatus('all') }}>Tüm rehberler</button><button type="button" aria-pressed={onlyFavorites} className={onlyFavorites ? 'active' : ''} onClick={() => { setOnlyFavorites(true); setStatus('all') }}>☆ Yıldızlılar</button>{admin ? <button type="button" aria-pressed={status === 'pending'} className={status === 'pending' ? 'active' : ''} onClick={() => { setOnlyFavorites(false); setStatus('pending') }}>Onay bekleyenler</button> : null}</div><div className="library-filter-tools">{admin && status !== 'pending' ? <select aria-label="Yayın durumu" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Aktif rehberler</option><option value="published">Yayında</option><option value="draft">Taslaklar</option><option value="archived">Arşiv</option></select> : null}<button type="button" className="ghost-button" disabled={loading || busy} onClick={() => void refresh()}>Yenile</button></div></div>
      {notice ? <p className="notice success" role="status">{notice}</p> : null}
      {error ? <p className="notice warning" role="alert">{error}</p> : null}
      {loading && !loaded ? <div className="library-empty" role="status">Rehberler yükleniyor…</div> : loaded && !visible.length ? <div className="library-empty"><LibraryIcon /><h3>{status === 'pending' ? 'Onay bekleyen gönderi yok' : !available.length && status !== 'archived' ? 'Henüz rehber eklenmedi' : 'Bu filtrelerle eşleşen başlık yok'}</h3><p>{status === 'pending' ? 'Asistanların gönderdiği rehberler burada incelenir.' : !available.length ? admin ? 'İlk rehberini ekle; istersen bilgileri alt konulara ayır.' : 'Yayınlanan rehberler burada görünecek.' : 'Filtreleri değiştirerek tekrar dene.'}</p>{available.length ? <button type="button" className="ghost-button" onClick={() => { setOnlyFavorites(false); setStatus('all') }}>Filtreleri Temizle</button> : null}</div> : null}
      {visible.length ? <LibraryDirectory entries={visible} admin={admin} busy={busy} favorites={favorites} expanded={expanded}
        onExpand={(id) => setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })}
        onFavorite={favorite} onEdit={setEditing} onArchive={(entry, restore) => void archive(entry, restore)}
        onOpen={(entry, sectionId) => { lastOpened.current = entry.id; setSelectedSection(sectionId ?? null); setSelected(entry.id) }} /> : null}
    </section>
  </div>
}
