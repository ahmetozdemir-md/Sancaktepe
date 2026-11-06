import { supabase } from './supabase'

export interface PortalCloudSnapshot<T = Record<string, unknown>> {
  payload: T
  updatedAt: string
}
export interface PortalCloudRevision { updatedAt: string }

export class PortalAccessError extends Error {
  readonly status = 403
  constructor(message = 'Listeyi görmek için yeniden giriş yapmalısın.') {
    super(message)
    this.name = 'PortalAccessError'
  }
}
export function isPortalAccessError(error: unknown): error is PortalAccessError {
  return error instanceof PortalAccessError
}

function client() {
  if (!supabase) throw new Error('Çevrimiçi bağlantı yapılandırılmamış.')
  return supabase
}
function fail(error: { code?: string; message?: string }): never {
  if (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST302') throw new PortalAccessError()
  if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Güvenli liste bağlantısı henüz hazır değil. Kısa süre sonra yeniden dene.')
  throw new Error('Listeye ulaşılamadı. Bağlantını kontrol edip yeniden dene.')
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function revision(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/** The access token stays in RPC POST arguments, never in a URL or log. */
export async function readPortalState<T = Record<string, unknown>>(accessToken = ''): Promise<PortalCloudSnapshot<T> | null> {
  const { data, error } = await client().rpc('read_portal_state', { p_access_token: accessToken.trim() || null })
  if (error) fail(error)
  if (data === null) return null
  if (!object(data) || !object(data.payload) || !revision(data.updatedAt)) throw new Error('Liste kaydı doğrulanamadı. Yeniden dene.')
  return { payload: data.payload as T, updatedAt: data.updatedAt }
}

export async function readPortalRevision(accessToken = ''): Promise<PortalCloudRevision | null> {
  const { data, error } = await client().rpc('read_portal_revision', { p_access_token: accessToken.trim() || null })
  if (error) fail(error)
  if (data === null) return null
  if (!object(data) || !revision(data.updatedAt)) throw new Error('Liste sürümü doğrulanamadı. Yeniden dene.')
  return { updatedAt: data.updatedAt }
}
