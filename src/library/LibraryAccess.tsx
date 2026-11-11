import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { libraryIsLocal } from './repository'

export default function LibraryAccess({ onReady }: { onReady: (ready: boolean) => void }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [status, setStatus] = useState('Yönetici oturumu kontrol ediliyor…')
  const [ready, setReady] = useState(libraryIsLocal)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase) { onReady(true); return }
    const client = supabase
    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (active) setUserId(error ? null : data.session?.user.id ?? null)
    }).catch(() => { if (active) { setUserId(null); setStatus('Yönetici oturumu okunamadı. Yeniden giriş yap.') } })
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (active) setUserId(session?.user.id ?? null) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [onReady])
  useEffect(() => {
    if (!supabase || userId === undefined) return
    let active = true
    setReady(false); onReady(false)
    if (!userId) { setStatus('Rehber yönetimi için mevcut yönetici hesabınla giriş yap.'); return }
    const client = supabase
    void client.from('portal_admins').select('user_id').eq('user_id', userId).maybeSingle().then(({ data, error }) => {
      if (!active) return
      const allowed = !error && Boolean(data)
      setReady(allowed); onReady(allowed)
      setStatus(allowed ? '' : 'Bu hesap rehber yönetimi için yetkili değil. Yetkili yönetici hesabını kullan.')
    })
    return () => { active = false }
  }, [userId, onReady])
  if (ready || libraryIsLocal) return null
  return <section className="card library-access"><h2>Rehber yönetimine giriş</h2><p role="status">{status}</p><form onSubmit={(event) => {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    void supabase.auth.signInWithPassword({ email: email.trim(), password }).then(({ error }) => {
      setPassword('')
      if (error) setStatus('Giriş yapılamadı. E-posta ve şifreni kontrol et.')
    }).catch(() => setStatus('Bağlantı kurulamadı. Yeniden dene.')).finally(() => setBusy(false))
  }}><label>Yönetici e-postası<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Yönetici şifresi<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Rehber Yönetimini Aç'}</button></form></section>
}
