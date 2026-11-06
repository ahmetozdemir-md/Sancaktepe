import { useState } from 'react'
import { assistantDutyEnabled, assistantIdentityForName, type AssistantRegistry } from './assistantIdentity.js'
import './AssistantRegistryPanel.css'

interface IdentityControlsProps {
  id: string
  name: string
  dutyEnabled: boolean
  archived?: boolean
  disabled?: boolean
  onDutyChange(id: string, enabled: boolean): void | Promise<void>
  onRename(id: string, name: string): void | Promise<void>
}

export function AssistantIdentityControls({id,name,dutyEnabled,archived=false,disabled=false,onDutyChange,onRename}:IdentityControlsProps) {
  const [editing,setEditing] = useState(false)
  const [draft,setDraft] = useState(name)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const changeDuty = async (enabled:boolean) => {
    setBusy(true);setError('')
    try { await onDutyChange(id,enabled) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Kişi güncellenemedi.') }
    finally { setBusy(false) }
  }
  const rename = async () => {
    setBusy(true);setError('')
    try { await onRename(id,draft);setEditing(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'İsim güncellenemedi.') }
    finally { setBusy(false) }
  }
  return <div className="assistant-identity-controls">
    <label className="assistant-duty-toggle"><input type="checkbox" checked={dutyEnabled} disabled={disabled||busy||archived} onChange={event=>{void changeDuty(event.currentTarget.checked)}} aria-label={`${name} nöbete dahil`} /><span>Nöbete dahil</span></label>
    {editing ? <div className="assistant-rename-form">
      <input aria-label={`${name} yeni adı`} value={draft} onChange={event=>setDraft(event.currentTarget.value)} disabled={busy||disabled} autoComplete="off" maxLength={150} />
      <button type="button" disabled={busy||disabled||!draft.trim()} onClick={()=>{void rename()}}>Kaydet</button>
      <button type="button" disabled={busy} onClick={()=>{setEditing(false);setError('')}}>Vazgeç</button>
    </div> : <button type="button" className="assistant-rename-open" disabled={disabled||busy} onClick={()=>{setDraft(name);setEditing(true);setError('')}} aria-label={`${name} adını düzenle`}>Adı düzenle</button>}
    {error ? <p className="assistant-identity-error" role="alert">{error}</p> : null}
  </div>
}

interface Props {
  assistants:string[]
  assistantRanks:Record<string,number>
  registry:AssistantRegistry
  month?:string
  disabled?:boolean
  onDutyChange(id:string,enabled:boolean):void|Promise<void>
  onRename(id:string,name:string):void|Promise<void>
}

export default function AssistantRegistryPanel({assistants,assistantRanks,registry,month,disabled=false,onDutyChange,onRename}:Props) {
  const [query,setQuery] = useState('')
  const key=(value:string)=>value.normalize('NFC').toLocaleLowerCase('tr-TR')
  const rows=assistants.slice().sort((a,b)=>(assistantRanks[a]??Number.MAX_SAFE_INTEGER)-(assistantRanks[b]??Number.MAX_SAFE_INTEGER)||a.localeCompare(b,'tr')).filter(name=>key(name).includes(key(query.trim())))
  const enabled=assistants.filter(name=>(month ? assistantDutyEnabled(assistantIdentityForName(registry,name),month) : assistantIdentityForName(registry,name)?.dutyEnabled)).length
  return <section className="assistant-registry-panel" aria-label="Ortak kişi kayıtları">
    <div className="assistant-registry-heading"><div><h3>Nöbet programı</h3><p>{enabled} kişi nöbete dahil</p></div><label><span className="sr-only">Kişi ara</span><input type="search" aria-label="Ortak kişi listesinde ara" placeholder="İsim ara…" value={query} onChange={event=>setQuery(event.currentTarget.value)} /></label></div>
    <div className="assistant-registry-grid">{rows.map(name=>{
      const identity=assistantIdentityForName(registry,name)
      return <div className="assistant-registry-person" key={identity?.id??name}>
        <div className="assistant-registry-name"><strong>{name}</strong><span>{assistantRanks[name]??'—'}. kıdem</span></div>
        {identity ? <AssistantIdentityControls id={identity.id} name={name} dutyEnabled={month ? assistantDutyEnabled(identity,month) ?? false : identity.dutyEnabled} archived={identity.archived} disabled={disabled} onDutyChange={onDutyChange} onRename={onRename}/> : <span className="assistant-identity-pending">Kişi kaydı eşleştiriliyor…</span>}
      </div>
    })}</div>
    {!rows.length ? <p className="empty">Eşleşen kişi yok.</p> : null}
  </section>
}
