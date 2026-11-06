import { supabase, REMOTE_STATE_ROW_ID, REMOTE_STATE_TABLE } from './supabase'
import { validateState } from '../public/nobet-planlayici/state-schema.js'
import type { PublicationDraft, PublicationPortal, PublishedDuty } from './month-publication.js'
import { synchronizePlannerSource, type PlannerSourcePortal } from './plannerSourceSync.js'
import { synchronizePersonRanks } from '../public/nobet-planlayici/person-history.js'
import { createSourceRevisionTracker, invalidateSourceCompletion, sourceSignature } from './sourceSyncSafety.js'
import { synchronizePlannerRoster } from './plannerRosterSync.js'

const sourceRevisions = createSourceRevisionTracker()

export interface RichPlannerState extends PublicationDraft {
  schemaVersion: number
  months: Record<string, { completedAt: string | null; capabilityRulesEnabled?: boolean }>
  updatedAt: string
  [key: string]: unknown
}

export interface PublishedPortalPayload {
  plannerState: PublicationPortal
  userBindings?: unknown
  [key: string]: unknown
}

export interface PlannerPublication {
  publishedAt: string
  portalRevision: string
  payload: PublishedPortalPayload
  removedRoomAssignments?: number
}

export class PlannerCloudError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'PlannerCloudError'
    this.status = status
  }
}

function client() {
  if (!supabase) throw new PlannerCloudError('Çevrimiçi bağlantı yapılandırılmamış.', 503)
  return supabase
}

function fail(error: { code?: string; message?: string }): never {
  if (error.code === '40001') throw new PlannerCloudError('Liste başka bir pencerede değişti. Sayfayı yenileyip yeniden dene.', 409)
  if (error.code === '42501' || error.code === 'PGRST301') throw new PlannerCloudError('Bu bölüm için yetkili admin girişi gerekli.', 403)
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202') throw new PlannerCloudError('Çevrimiçi nöbet kayıt altyapısı henüz hazır değil.', 503)
  throw new PlannerCloudError(error.message || 'Çevrimiçi işlem tamamlanamadı.', 422)
}

function revision(value: unknown): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new PlannerCloudError('Kayıt sürümü okunamadı.', 422)
  return result
}

export function checkPlannerState(value: unknown): RichPlannerState {
  const check = validateState(value)
  if (!check.valid) throw new PlannerCloudError(`Nöbet kaydı doğrulanamadı: ${check.errors.slice(0, 4).join(' · ')}`, 422)
  if (new TextEncoder().encode(JSON.stringify(value)).length > 10 * 1024 * 1024) throw new PlannerCloudError('Nöbet kaydı 10 MB sınırını aşıyor.', 413)
  return value as RichPlannerState
}

async function readStoredPlanner() {
  const { data, error } = await client().from('duty_planner_state').select('state,revision').eq('id', 1).maybeSingle()
  if (error) fail(error)
  if (!data) throw new PlannerCloudError('Çevrimiçi nöbet taslağı bulunamadı. Mevcut nöbet yedeğini yükleyin.', 404)
  return { state: checkPlannerState(data.state), revision: revision(data.revision) }
}

/** Fetch only staff and monthly rotations, leaving large daily schedules out of refreshes. */
async function readRotationSource() {
  const fields = ['assistants', 'assistantRanks', 'assistantRegistry', 'locations', 'locationOwnersByMonth', 'postDutyPoolByMonth']
  const { data, error } = await client().from(REMOTE_STATE_TABLE)
    .select(fields.map(field => `${field}:payload->plannerState->${field}`).join(','))
    .eq('id', REMOTE_STATE_ROW_ID).maybeSingle()
  if (error) fail(error)
  const source = data as unknown as Record<string, unknown> | null
  const object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!source || !Array.isArray(source.assistants) || !Array.isArray(source.locations)
    || !object(source.locationOwnersByMonth) || !object(source.postDutyPoolByMonth) || !object(source.assistantRanks)) {
    throw new PlannerCloudError('Uygulamanın kişi ve rotasyon kayıtları okunamadı.', 503)
  }
  return source as unknown as PlannerSourcePortal
}

function synchronize(state: RichPlannerState, portal: PlannerSourcePortal): RichPlannerState {
  const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).format(new Date())
  const source = state.portalSource as { fromMonth?: string } | undefined
  const fromMonth = typeof source?.fromMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(source.fromMonth) ? source.fromMonth : currentMonth
  const options = { fromMonth, currentMonth, rosterPolicy: 'preserve-active' as const }
  const roster = synchronizePlannerRoster(state, portal, options)
  const ranks = synchronizePersonRanks(roster.state, portal, options)
  const rotations = synchronizePlannerSource(ranks.state, portal, options)
  const result = invalidateSourceCompletion(state, rotations.state, fromMonth) as RichPlannerState
  result.portalSource = { ...(result.portalSource as object), currentMonth, warnings: [...roster.warnings, ...rotations.warnings, ...ranks.warnings] }
  return checkPlannerState(result)
}

async function storePlanner(state: RichPlannerState, expectedRevision: number) {
  const { data, error } = await client().rpc('save_duty_planner', { p_state: state, p_revision: revision(expectedRevision) })
  if (error) fail(error)
  return { state, revision: revision(data?.revision) }
}

export async function readPlanner() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [draft, source] = await Promise.all([readStoredPlanner(), readRotationSource()])
    const next = synchronize(draft.state, source)
    if (sourceSignature(next) === sourceSignature(draft.state)) return draft
    next.updatedAt = new Date().toISOString()
    try {
      const stored = await storePlanner(next, draft.revision)
      sourceRevisions.record(draft.revision, stored.revision)
      return stored
    }
    catch (error) { if (!(error instanceof PlannerCloudError) || error.status !== 409 || attempt === 1) throw error }
  }
  throw new PlannerCloudError('Taslak güncelleniyor. Yeniden dene.', 409)
}

export async function savePlanner(state: unknown, expectedRevision: number) {
  const checked = checkPlannerState(state)
  for (let attempt = 0; attempt < 3; attempt++) {
    const expected = sourceRevisions.resolve(expectedRevision)
    const next = synchronize(checked, await readRotationSource())
    try { return await storePlanner(next, expected) }
    catch (error) {
      if (!(error instanceof PlannerCloudError) || error.status !== 409 || sourceRevisions.resolve(expectedRevision) === expected || attempt === 2) throw error
    }
  }
  throw new PlannerCloudError('Taslak başka bir pencerede değişti. Yeniden yükle.', 409)
}

export async function listPlannerBackups() {
  const { data, error } = await client().from('duty_planner_history').select('id,kind,revision,saved_at,month')
    .order('saved_at', { ascending: false }).limit(1000)
  if (error) fail(error)
  return { backups: (data ?? []).map(row => ({
    id: row.id as string, kind: row.kind as string, revision: revision(row.revision),
    savedAt: row.saved_at as string, ...(row.month ? { month: row.month as string } : {}),
  })), retentionDays: 30 }
}

export async function readPlannerBackup(id: string) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new PlannerCloudError('Geçerli bir yedek seçin.', 422)
  const { data, error } = await client().from('duty_planner_history').select('state,revision').eq('id', id).maybeSingle()
  if (error) fail(error)
  if (!data) throw new PlannerCloudError('Yedek bulunamadı.', 404)
  return { state: checkPlannerState(data.state), revision: revision(data.revision) }
}

export async function readPublishedPortal() {
  const { data, error } = await client().from(REMOTE_STATE_TABLE).select('payload,updated_at').eq('id', REMOTE_STATE_ROW_ID).maybeSingle()
  if (error) fail(error)
  if (!data?.payload?.plannerState || typeof data.updated_at !== 'string') throw new PlannerCloudError('Asistan sisteminin güncel listesi okunamadı.', 503)
  return { payload: data.payload as PublishedPortalPayload, updatedAt: data.updated_at }
}

export async function readPlannerRoomChanges(month: string) {
  const { data, error } = await client().from('duty_planner_room_changes')
    .select('id,publication_month,date,duty_date,name,location_id,site,room_before,day_after,invalidated_at,restored_at')
    .eq('publication_month', month).is('invalidated_at', null).is('restored_at', null)
  if (error) fail(error)
  return (data ?? []).map(row => ({ id: row.id as string, month: row.publication_month as string,
    date: row.date as string, dutyDate: row.duty_date as string, name: row.name as string,
    locationId: row.location_id as string, site: row.site as string,
    roomBefore: row.room_before as string[], dayAfter: row.day_after as Record<string, string[]>,
    invalidatedAt: row.invalidated_at as string | null, restoredAt: row.restored_at as string | null,
  }))
}

export async function publishPlanner(input: {
  month: string; revision: number; portalRevision: string; monthRoster: Record<string, PublishedDuty[]>; restoreRoomChangeIds?: string[]
}): Promise<PlannerPublication> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new PlannerCloudError('Geçerli bir ay seçin.', 422)
  const { data, error } = await client().rpc('publish_duty_planner_v2', {
    p_month: input.month,
    p_draft_revision: revision(input.revision),
    p_portal_revision: input.portalRevision,
    p_month_duties: input.monthRoster,
    p_restore_ids: input.restoreRoomChangeIds ?? [],
  })
  if (error) fail(error)
  if (!data?.payload?.plannerState || typeof data.portalRevision !== 'string' || typeof data.publishedAt !== 'string') throw new PlannerCloudError('Yayın sonucu doğrulanamadı. Güncel listeyi tekrar açın.', 503)
  return data as PlannerPublication
}
