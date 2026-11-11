import { isSupabaseConfigured, supabase } from '../supabase'
import { ASSET_TYPES, MAX_ASSET_BYTES, libraryRow, parseLibraryRow, validateLibraryEntry, validAssetPath, type LibraryEntry } from './model'

const TABLE = 'portal_library_items'
const BUCKET = 'portal-library'
export const libraryIsLocal = !isSupabaseConfigured
export const CONFLICT_MESSAGE = 'Bu içerik başka bir oturumda değişti. Düzenlemen korundu; listeyi yenileyip güncel içerikle karşılaştır.'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('klinik-atlas-library-v1', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries', { keyPath: 'id' })
      request.result.createObjectStore('assets')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Bu cihazın içerik deposuna erişilemiyor.'))
  })
}

async function localRead<T>(store: string, key?: string): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readonly')
    const request = key ? transaction.objectStore(store).get(key) : transaction.objectStore(store).getAll()
    let result: T
    request.onsuccess = () => { result = request.result as T }
    transaction.oncomplete = () => { database.close(); resolve(result) }
    transaction.onerror = () => { database.close(); reject(new Error('Yerel içerik okunamadı.')) }
  })
}

async function localAssetWrite(path: string, file?: File): Promise<void> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('assets', 'readwrite')
    if (file) transaction.objectStore('assets').put(file, path)
    else transaction.objectStore('assets').delete(path)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(new Error('Dosya kaydedilemedi. Cihazın depolama alanını kontrol et.')) }
  })
}

function readableError(error: { code?: string; message?: string }): Error {
  if (error.code === '42P01' || error.code === 'PGRST205') return new Error('İçerik deposu henüz kurulmamış. Yönetici için kütüphane kurulumu gerekli.')
  if (error.code === '42501') return new Error('Bu işlem için yetkili yönetici oturumu gerekli.')
  return new Error('İçerik kaydına ulaşılamadı. Bağlantını ve yönetici oturumunu kontrol edip yeniden dene.')
}

export async function listLibraryEntries(admin: boolean): Promise<LibraryEntry[]> {
  if (!supabase) {
    const entries = (await localRead<LibraryEntry[]>('entries')).map((entry): LibraryEntry => ({ ...entry, kind: 'reference' }))
    return admin ? entries : entries.filter((entry) => entry.published && !entry.archivedAt)
  }
  let query = supabase.from(TABLE).select('*').order('updated_at', { ascending: false }).limit(500)
  if (!admin) query = query.eq('is_published', true).is('archived_at', null)
  const { data, error } = await query
  if (error) throw readableError(error)
  return (data ?? []).map(parseLibraryRow)
}

export async function saveLibraryEntry(entry: LibraryEntry): Promise<LibraryEntry> {
  const issues = validateLibraryEntry(entry)
  if (issues.length) throw new Error(issues.join(' '))
  if (!supabase) {
    const database = await db()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('entries', 'readwrite')
      const store = transaction.objectStore('entries')
      const request = store.get(entry.id)
      let saved: LibraryEntry
      let conflict = false
      request.onsuccess = () => {
        const previous = request.result as LibraryEntry | undefined
        if ((previous?.updatedAt ?? '') !== entry.updatedAt) { conflict = true; transaction.abort(); return }
        const now = new Date().toISOString()
        saved = { ...entry, kind: 'reference', createdAt: entry.createdAt || now, updatedAt: now }
        store.put(saved)
      }
      transaction.oncomplete = () => { database.close(); resolve(saved) }
      transaction.onabort = () => { database.close(); reject(new Error(conflict ? CONFLICT_MESSAGE : 'İçerik kaydedilemedi.')) }
      transaction.onerror = () => { database.close(); reject(new Error('İçerik kaydedilemedi. Cihazın depolama alanını kontrol et.')) }
    })
  }
  const query = entry.updatedAt
    ? supabase.from(TABLE).update(libraryRow(entry)).eq('id', entry.id).eq('updated_at', entry.updatedAt)
    : supabase.from(TABLE).insert(libraryRow(entry))
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw readableError(error)
  if (!data) throw new Error(CONFLICT_MESSAGE)
  return parseLibraryRow(data)
}

export async function validateAsset(file: File): Promise<void> {
  if (!ASSET_TYPES[file.type] || !file.size || file.size > MAX_ASSET_BYTES) throw new Error('PNG, JPG, WebP veya PDF seç. Dosya en fazla 8 MB olabilir.')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const matches = file.type === 'application/pdf' ? String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
    : file.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
      : file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!matches) throw new Error('Dosyanın içeriği seçilen dosya türüyle uyuşmuyor.')
}

export async function uploadLibraryAsset(entryId: string, file: File): Promise<string> {
  await validateAsset(file)
  const path = `${entryId}/${crypto.randomUUID()}.${ASSET_TYPES[file.type]}`
  if (!validAssetPath(path)) throw new Error('Dosya yolu geçersiz.')
  if (!supabase) await localAssetWrite(path, file)
  else {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error('Dosya yüklenemedi. Bağlantıyı, dosya deposunu ve yönetici oturumunu kontrol et.')
  }
  return path
}

export async function removeNewLibraryAssets(paths: string[]): Promise<void> {
  if (!paths.length) return
  if (!supabase) await Promise.all(paths.map((path) => localAssetWrite(path)))
  else {
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) throw new Error('Kaydedilmeyen dosyalar temizlenemedi.')
  }
}

export async function getLibraryAssetUrl(path: string): Promise<{ url: string; release: () => void }> {
  if (!validAssetPath(path)) throw new Error('Dosya yolu geçersiz.')
  if (!supabase) {
    const file = await localRead<File | undefined>('assets', path)
    if (!file) throw new Error('Dosya bulunamadı.')
    const url = URL.createObjectURL(file)
    return { url, release: () => URL.revokeObjectURL(url) }
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw new Error('Dosya açılamadı. Yeniden dene.')
  return { url: data.signedUrl, release: () => {} }
}
