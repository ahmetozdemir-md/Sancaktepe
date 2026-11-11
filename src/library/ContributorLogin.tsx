import { useEffect, useRef, useState } from 'react'
import { loginContributor, type ContributorIdentity, type ContributorSession } from './contributions'

export default function ContributorLogin({identity,onSuccess,onClose}:{identity:ContributorIdentity;onSuccess:(session:ContributorSession)=>void;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),lock=useRef(false)
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{const node=dialog.current;node?.showModal();input.current?.focus();return()=>node?.close()},[])
 return <dialog ref={dialog} className="library-contributor-dialog" aria-labelledby="contributor-login-title" onCancel={event=>{if(busy)event.preventDefault();else onClose()}}>
  <header><div><p className="eyebrow">REHBER KATKISI</p><h2 id="contributor-login-title">Rehber gönderme girişi</h2></div><button type="button" className="library-small-button" aria-label="Giriş penceresini kapat" disabled={busy} onClick={onClose}>×</button></header>
  <p>Hazırladığın rehberi adminin incelemesine gönder. İçerik yalnız admin onayından sonra yayınlanır.</p>
  <form onSubmit={async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const session=await loginContributor(identity,password);setPassword('');onSuccess(session)}catch(cause){setPassword('');setError(cause instanceof Error?cause.message:'Giriş yapılamadı.');input.current?.focus()}finally{lock.current=false;setBusy(false)}}}>
   <label>Rehber gönderme şifresi<input ref={input} type="password" required maxLength={72} autoComplete="current-password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
   {error?<p className="notice warning" role="alert">{error}</p>:null}
   <p className="hint-text">Oturum 8 saat geçerlidir. Cihaz başına saatte 3, günde 10 gönderim yapılabilir.</p>
   <button type="submit" disabled={busy||!password}>{busy?'Giriş yapılıyor…':'Giriş yap'}</button>
  </form>
 </dialog>
}
