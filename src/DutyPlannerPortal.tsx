import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listPlannerBackups,
  publishPlanner,
  readPlanner,
  readPlannerBackup,
  readPublishedPortal,
  savePlanner,
  type PublishedPortalPayload,
  type RichPlannerState,
} from './dutyPlannerCloud'
import {
  createPublicationPreview,
  type PublicationDraft,
  type PublicationPortal,
  type PublicationPreview,
} from './month-publication.js'
import { validateState } from '../public/nobet-planlayici/state-schema.js'
import { auditMonth } from '../public/nobet-planlayici/domain.js'
import './DutyPlannerPortal.css'

const CHANNEL = 'nobet-planner-v1'
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u
type BridgeRequest = { channel: string; type: 'request'; id: string; action: string; payload: Record<string, unknown> }
type BridgeResponse = { channel: string; type: 'response'; id: string; ok: boolean; data?: unknown; error?: string; status?: number }
type PendingPublication = { request: BridgeRequest; source: Window; preview: PublicationPreview; revision: number; portalRevision: string }
type FrameStatus = { dirty: boolean; busy: boolean; month: string }
interface Props { onClose(): void; onPublished(payload: PublishedPortalPayload, revision: string): void }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const revisionNumber = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'İşlem tamamlanamadı.'
const errorStatus = (error: unknown) => object(error) && Number.isInteger(error.status) ? Number(error.status) : 500
function problem(message: string, status = 422): Error & { status: number } { return Object.assign(new Error(message), { status }) }
function validDraft(value: unknown): asserts value is RichPlannerState {
  const checked = validateState(value)
  if (!checked.valid) throw problem(checked.errors.slice(0, 5).join(' · '))
}
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (date: string) => date.split('-').reverse().join('.')

/** Authenticated portal shell. Only this parent handles cloud credentials and publication. */
export default function DutyPlannerPortal({ onClose, onPublished }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const callbacks = useRef({ onClose, onPublished })
  const publicationRef = useRef<PendingPublication | null>(null)
  const preparingRef = useRef(false)
  const publishingRef = useRef(false)
  const frameStatusRef = useRef<FrameStatus>({ dirty: false, busy: false, month: '' })
  const requests = useRef(new Map<string, BridgeResponse | null>())
  const mounted = useRef(false)
  const [publication, setPublication] = useState<PendingPublication | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [frameStatus, setFrameStatus] = useState<FrameStatus>({ dirty: false, busy: false, month: '' })
  const [notice, setNotice] = useState('')

  useEffect(() => { callbacks.current = { onClose, onPublished } }, [onClose, onPublished])

  const reply = useCallback((request: BridgeRequest, source: Window, result: Omit<BridgeResponse, 'channel' | 'type' | 'id'>) => {
    const response: BridgeResponse = { channel: CHANNEL, type: 'response', id: request.id, ...result }
    requests.current.set(request.id, response)
    source.postMessage(response, window.location.origin)
    if (requests.current.size > 150) {
      for (const [id, value] of requests.current) {
        if (value && id !== request.id) { requests.current.delete(id); break }
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const receive = (event: MessageEvent<unknown>) => {
      const source = iframeRef.current?.contentWindow
      if (!source || event.source !== source || event.origin !== window.location.origin || !object(event.data)) return
      const message = event.data
      if (message.channel !== CHANNEL) return
      if (message.type === 'status') {
        if (typeof message.dirty !== 'boolean' || typeof message.busy !== 'boolean' || typeof message.month !== 'string' || !MONTH.test(message.month)) return
        const status = { dirty: message.dirty, busy: message.busy, month: message.month }
        frameStatusRef.current = status
        setFrameStatus(status)
        return
      }
      if (message.type !== 'request' || typeof message.id !== 'string' || !message.id || message.id.length > 200
        || typeof message.action !== 'string' || !object(message.payload)) return
      const request = message as unknown as BridgeRequest
      if (requests.current.has(request.id)) {
        const previous = requests.current.get(request.id)
        if (previous) source.postMessage(previous, window.location.origin)
        return
      }
      requests.current.set(request.id, null)
      const run = async () => {
        try {
          let data: unknown
          switch (request.action) {
            case 'load':
              data = await readPlanner()
              break
            case 'save':
              if (!revisionNumber(request.payload.revision)) throw problem('Taslak sürümü okunamadı.')
              validDraft(request.payload.state)
              data = await savePlanner(request.payload.state, request.payload.revision)
              break
            case 'backups':
              data = await listPlannerBackups()
              break
            case 'backup':
              if (typeof request.payload.id !== 'string' || !request.payload.id || request.payload.id.length > 200) throw problem('Yedek kimliği geçerli değil.')
              data = await readPlannerBackup(request.payload.id)
              break
            case 'publish': {
              if (preparingRef.current || publicationRef.current || publishingRef.current) throw problem('Açık yayınlama işlemini önce tamamla.', 409)
              if (typeof request.payload.month !== 'string' || !MONTH.test(request.payload.month) || request.payload.month.startsWith('0000')
                || !revisionNumber(request.payload.revision)) throw problem('Yayın ayı veya taslak sürümü geçerli değil.')
              preparingRef.current = true
              try {
                const draft = await readPlanner()
                if (draft.revision !== request.payload.revision) throw problem('Nöbet taslağı değişti. Güncel taslağı yükleyip yeniden yayınla.', 409)
                validDraft(draft.state)
                const portal = await readPublishedPortal()
                const audit = auditMonth(draft.state, request.payload.month)
                const preview = createPublicationPreview(
                  draft.state as unknown as PublicationDraft,
                  portal.payload.plannerState as unknown as PublicationPortal,
                  request.payload.month,
                  { warnings: audit.filter(item => item.severity !== 'error') },
                )
                const errors = audit.filter(item => item.severity === 'error')
                if (errors.length) { preview.errors.push(...errors); preview.canPublish = false }
                if (!mounted.current) throw problem('Planlayıcı kapatıldı.', 400)
                const pending = { request, source, preview, revision: draft.revision, portalRevision: portal.updatedAt }
                publicationRef.current = pending
                setPublication(pending)
                setNotice('')
                return // Confirmation or cancellation sends the correlated response.
              } finally { preparingRef.current = false }
            }
            default: throw problem('Desteklenmeyen planlayıcı işlemi.', 400)
          }
          if (mounted.current) reply(request, source, { ok: true, data })
        } catch (error) {
          if (mounted.current) reply(request, source, { ok: false, status: errorStatus(error), error: errorMessage(error) })
        }
      }
      void run()
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (frameStatusRef.current.dirty || frameStatusRef.current.busy || preparingRef.current || publishingRef.current || publicationRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('message', receive)
    window.addEventListener('beforeunload', unload)
    return () => {
      mounted.current = false
      window.removeEventListener('message', receive)
      window.removeEventListener('beforeunload', unload)
    }
  }, [reply])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (publication && !dialog.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!publication && dialog.open) {
      dialog.close()
      previousFocus.current?.focus({ preventScroll: true })
    }
  }, [publication])

  const cancelPublication = () => {
    if (publishingRef.current) return
    const pending = publicationRef.current
    if (!pending) return
    reply(pending.request, pending.source, { ok: false, status: 400, error: 'Yayınlama iptal edildi.' })
    publicationRef.current = null
    setPublication(null)
  }

  const confirmPublication = async () => {
    const pending = publicationRef.current
    if (!pending?.preview.canPublish || publishingRef.current) return
    publishingRef.current = true
    setPublishing(true)
    try {
      const result = await publishPlanner({
        month: pending.preview.month,
        revision: pending.revision,
        portalRevision: pending.portalRevision,
        monthRoster: pending.preview.monthRoster,
      })
      reply(pending.request, pending.source, { ok: true, data: { month: pending.preview.month, publishedAt: result.publishedAt, message: 'Nöbet listesi Asistan sistemine yayınlandı.' } })
      publicationRef.current = null
      setPublication(null)
      setNotice(`${monthLabel(pending.preview.month)} Asistan sistemine yayınlandı.`)
      // Publication has committed. A parent rendering error must not report a false failure to the planner.
      try { callbacks.current.onPublished(result.payload, result.portalRevision) } catch { setNotice('Liste yayınlandı. Çalışma listesini yenileyerek güncel yayını görebilirsin.') }
    } catch (error) {
      reply(pending.request, pending.source, { ok: false, status: errorStatus(error), error: errorMessage(error) })
      publicationRef.current = null
      setPublication(null)
      setNotice(errorMessage(error))
    } finally {
      publishingRef.current = false
      setPublishing(false)
    }
  }

  const close = () => {
    if (preparingRef.current || publishingRef.current || publicationRef.current || frameStatusRef.current.busy) {
      setNotice('Devam eden kaydetme veya yayınlama işlemini önce tamamla.')
      return
    }
    if (frameStatusRef.current.dirty && !window.confirm('Kaydedilmemiş değişiklikler var. Planlayıcıyı yine de kapatmak istiyor musun?')) return
    callbacks.current.onClose()
  }

  return (
    <section className="duty-portal" aria-label="Çevrimiçi nöbet planlayıcı">
      <header className="duty-portal-toolbar">
        <button type="button" className="duty-portal-back" onClick={close}>← Çalışma listesine dön</button>
        <div className="duty-portal-status">
          <strong>Nöbet planlayıcı</strong>
          <span>{frameStatus.busy ? 'İşlem sürüyor…' : frameStatus.dirty ? 'Kaydedilmeyen değişiklikler var' : 'Çevrimiçi taslak'}</span>
        </div>
        {notice ? <p className="duty-portal-notice" role="status">{notice}</p> : null}
      </header>
      <iframe ref={iframeRef} className="duty-portal-frame" src="/nobet-planlayici/index.html" title="Nöbet planlayıcı" />
      <dialog ref={dialogRef} className="duty-publish-dialog" aria-labelledby="duty-publish-title" onCancel={event => { event.preventDefault(); cancelPublication() }}>
        {publication ? <>
          <header className="duty-publish-heading"><h2 id="duty-publish-title">{monthLabel(publication.preview.month)} · Yayınla</h2></header>
          <div className="duty-publish-content">
            <p>Bu ayın nöbet listesi Asistan sisteminde görünecek. Diğer aylar korunacak.</p>
            <dl className="duty-publish-counts">
              <div><dt>Nöbet</dt><dd>{publication.preview.count}</dd></div>
              <div><dt>Değişen gün</dt><dd>{publication.preview.changedDays.length}</dd></div>
              <div><dt>Eklenen</dt><dd>{publication.preview.addedCount}</dd></div>
              <div><dt>Kaldırılan</dt><dd>{publication.preview.removedCount}</dd></div>
            </dl>
            {!publication.preview.hasChanges ? <p className="duty-publish-muted">Yayınlanmış listeyle aynı; değişecek atama yok.</p> : null}
            {publication.preview.errors.length ? <section className="duty-publish-errors"><h3>Önce bunları düzelt</h3><ul>{publication.preview.errors.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></section> : null}
            {publication.preview.removedRoomAssignments.length ? <section className="duty-publish-removals">
              <h3>Nöbet ertesi nedeniyle kaldırılacak çalışma yeri atamaları ({publication.preview.removedRoomAssignments.length})</h3>
              <div className="duty-publish-table"><table><thead><tr><th>Tarih</th><th>Asistan</th><th>Çalışma yeri</th></tr></thead><tbody>{publication.preview.removedRoomAssignments.map((item, index) => <tr key={`${item.date}-${item.locationId}-${item.name}-${index}`}><td>{dayLabel(item.date)}</td><td>{item.name}</td><td>{item.site ? `${item.site} · ` : ''}{item.locationName}</td></tr>)}</tbody></table></div>
            </section> : null}
            {publication.preview.warnings.length ? <details className="duty-publish-warnings"><summary>Kontrol notları ({publication.preview.warnings.length})</summary><ul>{publication.preview.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></details> : null}
          </div>
          <footer className="duty-publish-actions"><button type="button" className="duty-portal-cancel" onClick={cancelPublication} disabled={publishing}>Vazgeç</button><button type="button" onClick={() => { void confirmPublication() }} disabled={publishing || !publication.preview.canPublish}>{publishing ? 'Yayınlanıyor…' : 'Onayla ve yayınla'}</button></footer>
        </> : null}
      </dialog>
    </section>
  )
}
