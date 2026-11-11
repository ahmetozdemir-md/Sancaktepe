import { useEffect, useRef, useState } from 'react'
import './AssistantRegistryPanel.css'

interface Props {
  name: string
  rank: number
  rankOptions: number[]
  disabled: boolean
  onSave: (name: string, rank: number) => Promise<void>
  onCancel: () => void
  onRemove: () => void
}

export default function AssistantEditDialog({ name, rank, rankOptions, disabled, onSave, onCancel, onRemove }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [draftName, setDraftName] = useState(name)
  const [draftRank, setDraftRank] = useState(rank)
  const [busy, setBusy] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const changed = draftName.trim() !== name || draftRank !== rank
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    nameRef.current?.focus()
    return () => dialog?.close()
  }, [])
  const save = async () => {
    if (savingRef.current || disabled || !changed) return
    savingRef.current = true
    setBusy(true)
    setError('')
    try { await onSave(draftName, draftRank); onCancel() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Asistan bilgileri kaydedilemedi.') }
    finally { savingRef.current = false; setBusy(false) }
  }
  return <dialog ref={dialogRef} className="assistant-edit-dialog" aria-labelledby="assistant-edit-title" onCancel={event => { if (busy) event.preventDefault(); else onCancel() }}>
    <header className="assistant-edit-heading"><div><p className="eyebrow">ASİSTAN BİLGİLERİ</p><h2 id="assistant-edit-title">Asistanı düzenle</h2></div><button type="button" className="assistant-edit-close" aria-label="Düzenlemeyi kapat" disabled={busy} onClick={onCancel}>×</button></header>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset disabled={disabled || busy}>
        <label>Ad soyad<input ref={nameRef} value={draftName} maxLength={150} autoComplete="off" required onChange={event => setDraftName(event.target.value)} /></label>
        <label>Kıdem<select value={draftRank} onChange={event => setDraftRank(Number(event.target.value))}>{rankOptions.map(level => <option key={level} value={level}>{level}. Kıdem</option>)}</select></label>
        <p className="assistant-edit-hint">Kıdem değişikliği yalnız bu asistana uygulanır. İsim değiştiğinde mevcut kayıtlar aynı kişiyle bağlantılı kalır.</p>
      </fieldset>
      {error ? <p className="assistant-edit-error" role="alert">{error}</p> : null}
      <div className="assistant-edit-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>Vazgeç</button><button type="submit" disabled={disabled || busy || !changed || !draftName.trim()}>{busy ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}</button></div>
    </form>
    <div className="assistant-edit-remove"><div><strong>Asistanı listeden çıkar</strong><p>Silme işlemi ayrıca onay ister.</p></div><button type="button" disabled={disabled || busy} onClick={onRemove}>Asistanı sil</button></div>
  </dialog>
}
