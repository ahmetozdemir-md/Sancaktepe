import { useEffect, useRef } from 'react'

export default function AssistantRemovalDialog({ name, disabled, onCancel, onConfirm }: {
  name: string
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    cancelRef.current?.focus()
    return () => dialog?.close()
  }, [])
  return <dialog ref={dialogRef} className="assistant-removal-dialog" aria-labelledby="assistant-removal-title" aria-describedby="assistant-removal-description" onCancel={onCancel}>
    <span className="assistant-removal-icon" aria-hidden="true">×</span>
    <h2 id="assistant-removal-title">Asistan listeden çıkarılsın mı?</h2>
    <p className="assistant-removal-name">{name}</p>
    <p id="assistant-removal-description">Bu asistan listeden çıkarılacak; alan atamaları ve nöbet kayıtları da temizlenecek.</p>
    <div className="assistant-removal-actions"><button ref={cancelRef} type="button" className="ghost-button" onClick={onCancel}>Vazgeç</button><button type="button" className="danger-soft-button" disabled={disabled} onClick={onConfirm}>Asistanı çıkar</button></div>
  </dialog>
}
