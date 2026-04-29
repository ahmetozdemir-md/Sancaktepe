import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const cloudWriteEnv = String(import.meta.env.VITE_CLOUD_WRITE_ENABLED ?? 'true')

export const REMOTE_STATE_TABLE = 'portal_state'
export const REMOTE_STATE_ROW_ID = 1

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)
export const isCloudWriteEnabled = cloudWriteEnv.toLocaleLowerCase('tr') !== 'false'

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null
