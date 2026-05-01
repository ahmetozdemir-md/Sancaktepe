import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const cloudWriteEnv = String(import.meta.env.VITE_CLOUD_WRITE_ENABLED ?? 'true')
const requireAdminAuthEnv = String(import.meta.env.VITE_REQUIRE_SUPABASE_ADMIN_AUTH ?? 'false')

export const REMOTE_STATE_TABLE = 'portal_state'
export const REMOTE_STATE_ROW_ID = 1
export const REMOTE_STATE_HISTORY_TABLE = 'portal_state_history'
export const LOGIN_EVENTS_TABLE = 'login_events'

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)
export const isCloudWriteEnabled = cloudWriteEnv.toLocaleLowerCase('tr') !== 'false'
export const isSupabaseAdminAuthRequired =
  requireAdminAuthEnv.toLocaleLowerCase('tr') === 'true'

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null
