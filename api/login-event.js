import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const LOGIN_EVENT_RETENTION_DAYS = 14
const LOGIN_EVENTS_TABLE = 'login_events'

function normalizePersonName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return String(value ?? '')
}

function getRequestIp(request) {
  const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for'])
  const forwardedIp = forwardedFor.split(',')[0]?.trim()
  if (forwardedIp) {
    return forwardedIp
  }

  return (
    firstHeaderValue(request.headers['x-real-ip']) ||
    firstHeaderValue(request.headers['cf-connecting-ip']) ||
    request.socket?.remoteAddress ||
    ''
  ).trim()
}

function hashIp(ip) {
  if (!ip) {
    return null
  }

  const salt =
    process.env.LOGIN_EVENT_HASH_SALT ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'assistant-system-login-events'

  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }

  const chunks = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (!chunks.length) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  if (request.method !== 'POST') {
    response.status(405).json({ ok: false, error: 'method_not_allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    response.status(503).json({ ok: false, error: 'supabase_not_configured' })
    return
  }

  const body = await readJsonBody(request)
  const personName = normalizePersonName(body.personName ?? body.person_name)
  if (!personName) {
    response.status(400).json({ ok: false, error: 'person_name_required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const now = Date.now()
  const cutoff = new Date(now - LOGIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from(LOGIN_EVENTS_TABLE).delete().lt('created_at', cutoff)

  const { error } = await supabase.from(LOGIN_EVENTS_TABLE).insert({
    person_name: personName,
    created_at: new Date(now).toISOString(),
    ip_hash: hashIp(getRequestIp(request)),
  })

  if (error) {
    response.status(500).json({ ok: false, error: 'insert_failed' })
    return
  }

  response.status(200).json({ ok: true })
}
