import { useRef, useState } from 'react'
import LibraryAccess from './LibraryAccess'
import { changeContributorPassword } from './contributions'
import { libraryIsLocal } from './repository'
import './library.css'

export default function ContributorPasswordPanel() {
 const [ready,setReady]=useState(false),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
 const lock=useRef(false)
 return <section className="card library-contributor-password"><p className="eyebrow">REHBER KATKISI</p><h2>Rehber Gönderme Şifresi</h2><p>Bu şifreyle yalnız yeni rehber gönderilebilir. Gönderiler, onay bekleyenler bölümünde incelenir.</p>
  <LibraryAccess onReady={setReady}/>
  <form onSubmit={async event=>{event.preventDefault();if(lock.current||!ready||libraryIsLocal)return;setError('');setMessage('');if(password!==repeat){setError('Şifreler aynı olmalı.');return}if(password.length<8||new TextEncoder().encode(password).length>72){setError('Şifre en az 8 karakter, en fazla 72 bayt olmalı. Türkçe karakterler birden fazla bayt kullanabilir.');return}lock.current=true;setBusy(true);try{await changeContributorPassword(password);setPassword('');setRepeat('');setMessage('Rehber gönderme şifresi değiştirildi. Açık gönderme oturumları sonlandırıldı.')}catch(cause){setError(cause instanceof Error?cause.message:'Şifre değiştirilemedi.')}finally{lock.current=false;setBusy(false)}}}>
   <fieldset disabled={!ready||busy||libraryIsLocal}><div className="library-editor-meta"><label>Yeni rehber şifresi<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Yeni rehber şifresi tekrarı<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={repeat} onChange={event=>setRepeat(event.target.value)}/></label></div><p className="hint-text">Şifre değişince tüm rehber gönderme oturumları kapanır. Asistan giriş şifresi değişmez.</p><button type="submit">{busy?'Kaydediliyor…':'Rehber şifresini değiştir'}</button></fieldset>
  </form>{message?<p className="notice success" role="status">{message}</p>:null}{error?<p className="notice warning" role="alert">{error}</p>:null}
 </section>
}
