import {plannerBridge,plannerFetch} from './online-bridge.js';
import {uid,daysInMonth,dayOfWeek,addDays,activePeople,rankOf,targetFor,targetProgress,tally,validateAssignment,auditMonth,alternateDutyChain} from './domain.js';
import {validateState} from './state-schema.js';
import {renderManagement,handleManagement,updateTargetPreview,handleCapabilityChange,updateCapabilityControls} from './management.js';
import {downloadFile,rosterCSV,summaryCSV} from './exporters.js';
import {openShareView} from './sharing.js';
import {removeMonth} from './months.js';
import {dayNotes} from './day-notes.js';
import {enhanceDateInputs} from './calendar-ui.js';
import {targetFinishedForDate,restorePlannerLocation,candidateNameMatches,searchCellAvailability} from './planner-ui.js';
import {planAutoWeekend,planPreviousMonthWeekend,applyWeekendPlan} from './weekend-pair.js';
import {rulesEnabled,siteCoverage} from './capabilities.js';
import {planMonthClear,clearMonthPlan} from './plan-clear.js';
import {comparePeopleBySeniority,sortPeopleBySeniority} from './person-order.js';
import {rotationLabel,rotationColorKey} from './rotations.js';

const sites=['Sancaktepe','Feriha Öz','Çekmeköy'];
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(n)?n.toLocaleString('tr-TR',{maximumFractionDigits:1}):'—';
const dateLabel=(d,opts={day:'numeric',month:'long',weekday:'long'})=>new Date(`${d}T12:00:00`).toLocaleDateString('tr-TR',opts);
const monthLabel=m=>dateLabel(`${m}-01`,{month:'long',year:'numeric'});
const shortDate=d=>dateLabel(d,{day:'2-digit',month:'2-digit',year:'numeric'});
const icons={plan:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h1M14 15h1"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3M16 4a3 3 0 010 6M21 21v-3a6 6 0 00-4-5"/>',records:'<path d="M8 3h12v18H4V7zM8 3v4H4M8 12h8M8 16h5"/>',rotations:'<path d="M4 7h16l-4-4M20 17H4l4 4M20 7v3M4 17v-3"/>',holidays:'<path d="M5 21V3M5 4h14l-3 5 3 5H5"/>',summary:'<path d="M4 20h16M7 16V9M12 16V4M17 16v-5"/>',data:'<path d="M4 4h14l2 3v13H4zM8 4v6h8V4M8 20v-6h8v6"/>'};
const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]||icons.plan}</svg>`;
let state,revision=0,month='2026-11',view='plan',selectedDay='2026-11-01',selectedSite=sites[0],selectedPerson=null,selectedAssignment=null;
let undoStack=[],redoStack=[],pendingSave=null,saving=false,saveError='',conflict=false,dialogGeneration=0,toastTimer,monthStats=new Map();
let datePickerCleanup=()=>{};
let lastCandidateClick=null;
let selectedCandidateId=null,candidateSearch='';
let publishing=false,savingPromise=null;
let pendingLocationScroll=null,locationSaveTimer;
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem('nobet-online-sidebar-collapsed')==='1'}catch{}
const app=document.querySelector('#app'),dlg=document.querySelector('#dialog');
const ctx={get state(){return state},get month(){return month},commit,dialog,toast,render};
function people(){return sortPeopleBySeniority(state,month,activePeople(state,month));}
function person(id){return state.people.find(p=>p.id===id)}
function stats(id){if(!monthStats.has(id))monthStats.set(id,tally(state,id,month));return monthStats.get(id)}
function applicable(list,id,d){return list.filter(r=>r.personId===id&&r.start<=d&&r.end>=d)}
function rotationFor(id,d){return applicable(state.rotations,id,d).reduce((latest,item)=>!latest||item.start>=latest.start?item:latest,null)}
function targetFinished(id){return targetFinishedForDate(state,id,month,selectedDay,stats(id))}
function rotationDescription(rotation){return rotation?`Gündüz: ${rotationLabel(rotation)}${rotation.site&&rotation.unit?` / ${rotation.unit}`:''}`:'Rotasyon girilmedi'}
function rememberLocation(){
 if(!state)return;
 const location={month,date:selectedDay,site:selectedSite,view,contentScroll:document.querySelector('.content')?.scrollTop||0,tableScroll:document.querySelector('.plan-table')?.scrollTop||0,candidateScroll:document.querySelector('.candidate-scroll')?.scrollTop||0};
 try{localStorage.setItem('nobet-online-planner-location',JSON.stringify(location))}catch{}
}
function remainingBadge(value,cls='',label=''){return `<span class="tiny-badge ${cls} ${value<0?'over':''}" title="${e(label)}">${fmt(value)}</span>`}
function thursdayCount(id){return state.assignments.filter(a=>a.personId===id&&a.date.startsWith(`${month}-`)&&dayOfWeek(a.date)===4).length}
function candidateBadges(id){
 const progress=targetProgress(targetFor(state,id,month),stats(id));
 const thursdays=thursdayCount(id);
 return `<span class="numbers">${remainingBadge(progress?.totalRemaining??NaN,'','Kalan toplam nöbet')}${remainingBadge(progress?.weekendRemaining??NaN,'we','Kalan hafta sonu puanı')}<span class="tiny-badge thursday" title="${e(monthLabel(month))}: ${thursdays} perşembe nöbeti">P${thursdays}</span></span>`;
}
function selectCandidate(id){
 selectedCandidateId=id;selectedPerson=null;selectedAssignment=null;
 app.querySelectorAll('.picked').forEach(card=>card.classList.remove('picked'));
 app.querySelectorAll('.candidate-panel [data-person]').forEach(card=>{
  const selected=id!==null&&card.dataset.person===id;
  card.classList.toggle('candidate-selected',selected);
  if(card.dataset.action==='pick')card.setAttribute('aria-pressed',String(selected));
 });
 app.querySelector('[data-action="remove-selected"]')?.setAttribute('disabled','');
}
function clearCandidateSelection(){
 selectCandidate(null);lastCandidateClick=null;
 const active=document.activeElement;
 if(active?.closest('.candidate-panel [data-person],.duty-chip'))active.blur();
}
function sidebarToggleIcon(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16${sidebarCollapsed?'M13 8l4 4-4 4':'M17 8l-4 4 4 4'}"/></svg>`}
function toggleSidebar(){
 sidebarCollapsed=!sidebarCollapsed;
 try{localStorage.setItem('nobet-online-sidebar-collapsed',sidebarCollapsed?'1':'0')}catch{}
 document.querySelector('.app-shell').classList.toggle('sidebar-collapsed',sidebarCollapsed);
 document.querySelector('#app-sidebar').hidden=sidebarCollapsed;
 const button=document.querySelector('.sidebar-toggle'),label=sidebarCollapsed?'Menüyü aç':'Menüyü kapat';
 button.innerHTML=sidebarToggleIcon();button.setAttribute('aria-expanded',String(!sidebarCollapsed));button.setAttribute('aria-label',label);button.title=label;
}
function toast(text){const t=document.querySelector('#toast');t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500)}
function dialog({title,body,confirmLabel='Tamam',onConfirm,onCancel,hideCancel=false}){
 datePickerCleanup();
 const generation=++dialogGeneration;let settled=false;
 const cancel=()=>{if(!settled&&generation===dialogGeneration){settled=true;try{onCancel?.()}catch(error){toast(error.message)}}};
 dlg.innerHTML=`<form id="modal-form"><div class="dialog-head"><h2>${e(title)}</h2><button type="button" class="icon-btn" data-dialog-close aria-label="Pencereyi kapat">×</button></div><div class="dialog-body">${body}<div id="dialog-error" role="alert"></div></div><div class="dialog-footer">${hideCancel?'':'<button type="button" class="btn" data-dialog-close>Vazgeç</button>'}<button class="btn primary" type="submit">${e(confirmLabel)}</button></div></form>`;
 const form=dlg.querySelector('form');updateTargetPreview(form);updateCapabilityControls(form);form.addEventListener('input',event=>{updateTargetPreview(form);updateCapabilityControls(form,event.target)});form.addEventListener('change',event=>{updateTargetPreview(form);updateCapabilityControls(form,event.target)});
 dlg.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>{cancel();dlg.close()});
 dlg.oncancel=cancel;
 dlg.querySelector('form').onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;try{const result=await onConfirm?.(new FormData(event.target));if(result!==false&&generation===dialogGeneration){settled=true;dlg.close()}}catch(error){if(generation===dialogGeneration)dlg.querySelector('#dialog-error').innerHTML=`<div class="notice error">${e(error.message)}</div>`;else toast(error.message)}finally{if(generation===dialogGeneration)submit.disabled=false}};
 if(!dlg.open)dlg.showModal();
 datePickerCleanup=enhanceDateInputs(dlg,state?.holidays??[]);
}
function changedRecords(before,after,key){const previous=new Map((before[key]??[]).map(r=>[r.id,r]));const current=new Map((after[key]??[]).map(r=>[r.id,r]));const changed=[];for(const [id,r]of previous)if(JSON.stringify(r)!==JSON.stringify(current.get(id)))changed.push(r);for(const[id,r]of current)if(JSON.stringify(r)!==JSON.stringify(previous.get(id)))changed.push(r);return changed}
function invalidateAffected(before,after){
 const affected=new Set(),add=d=>{if(d)affected.add(d.slice(0,7))},since=m=>Object.keys(after.months).filter(k=>k>=m).forEach(k=>affected.add(k));
 changedRecords(before,after,'assignments').forEach(r=>{add(r.date);add(addDays(r.date,-4));add(addDays(r.date,4))});
 for(const key of ['absences','requests','rotations'])changedRecords(before,after,key).forEach(r=>Object.keys(after.months).filter(m=>`${m}-01`<=r.end&&daysInMonth(m).at(-1)>=r.start).forEach(m=>affected.add(m)));
 changedRecords(before,after,'holidays').forEach(r=>add(r.date));
 changedRecords(before,after,'targets').forEach(r=>since(r.from));
 changedRecords(before,after,'capabilities').forEach(r=>since(r.from));
 if(JSON.stringify(before.planningSettings)!==JSON.stringify(after.planningSettings))Object.keys(after.months).forEach(m=>affected.add(m));
 for(const m of Object.keys(after.months))if(before.months[m]?.capabilityRulesEnabled!==after.months[m]?.capabilityRulesEnabled)affected.add(m);
 for(const key of ['people','groups']){const olds=new Map(before[key].map(r=>[r.id,r]));for(const r of after[key]){const old=olds.get(r.id);if(!old)since(r.from.slice(0,7));else if(old.until!==r.until)since((old.until&&r.until?[old.until,r.until].sort()[0]:old.until||r.until||r.from).slice(0,7))}}
 for(const key of ['people','groups']){const currentIds=new Set(after[key].map(r=>r.id));for(const removed of before[key])if(!currentIds.has(removed.id))since(removed.from.slice(0,7));}
 for(const m of affected)if(after.months[m])after.months[m].completedAt=null;
}
function commit(mutator,label='Değişiklik kaydedildi',options={}){
 if(conflict)throw new Error('Başka bir pencere verileri güncelledi. Önce taslağını yedekleyip sayfayı yeniden yükle.');
 const next=structuredClone(state);mutator(next);if(options.invalidate!==false)invalidateAffected(state,next);next.updatedAt=new Date().toISOString();
 const check=validateState(next);if(!check.valid)throw new Error(check.errors.slice(0,4).join(' · '));
 undoStack.push(structuredClone(state));if(undoStack.length>40)undoStack.shift();redoStack=[];state=next;selectedPerson=null;selectedAssignment=null;pendingSave=structuredClone(state);render();void flushSave();if(label)toast(label);
}
function flushSave(){if(savingPromise)return savingPromise;savingPromise=performSave().finally(()=>{savingPromise=null});return savingPromise}
async function performSave(){
 if(saving||conflict)return;saving=true;saveError='';updateSave();
 while(pendingSave&&!conflict){const snapshot=pendingSave;pendingSave=null;try{const res=await plannerFetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot,revision})});const body=await res.json();if(!res.ok){if(res.status===409)conflict=true;throw new Error(body.error||body.errors?.join(' · ')||'Kayıt başarısız')}revision=body.revision}catch(error){pendingSave=pendingSave||snapshot;saveError=error.message;break}}
 saving=false;updateSave();if(saveError)render();
}
function updateSave(){const el=document.querySelector('#save-status');if(el){el.textContent=saveError?'Kaydedilemedi':saving||pendingSave?'Kaydediliyor…':'Çevrimiçi kaydedildi';el.classList.toggle('error',!!saveError)}const publish=document.querySelector('[data-action=publish]');if(publish){publish.disabled=!state?.months[month]||publishing||saving||!!pendingSave||!!saveError||conflict;publish.textContent=publishing?'Yayınlanıyor…':'Yayınla'}plannerBridge.notifyStatus({dirty:!!(pendingSave||saving||saveError),busy:publishing||saving,month})}
async function load(){try{const res=await plannerFetch('/api/state');const payload=await res.json();if(!res.ok)throw new Error(payload.error||'Çevrimiçi nöbet taslağı okunamadı.');if(!payload.state)throw new Error('Çevrimiçi nöbet taslağı henüz oluşturulmadı. Asistan sisteminden mevcut nöbet yedeğini yükle.');revision=payload.revision;state=payload.state;const result=validateState(state);if(!result.valid)throw new Error(result.errors.join(' · '));let saved=null;try{saved=localStorage.getItem('nobet-online-planner-location')}catch{}const location=restorePlannerLocation(state,saved);month=location.month;selectedDay=location.date;selectedSite=location.site;view=location.view;pendingLocationScroll=location;render();if(state.months[month])reconcileWeekendMonth(month);}catch(error){app.innerHTML=`<div class="loading"><div><h2>Dosyalar yüklenemedi</h2><p class="muted">${e(error.message)}</p><button class="btn" data-action="reload">Yeniden dene</button></div></div>`}}
function render(){
 if(!state)return;
 if(selectedCandidateId&&!person(selectedCandidateId))selectedCandidateId=null;
 const hasMonths=Object.keys(state.months).length>0;
 if(hasMonths&&!state.months[month])month=Object.keys(state.months).sort().at(-1);
 if(!month)month='2026-11';
 if(!selectedDay.startsWith(month)||!daysInMonth(month).includes(selectedDay))selectedDay=`${month}-01`;
 monthStats.clear();
 const scroll=document.querySelector('.content')?.scrollTop||0,tableScroll=document.querySelector('.plan-table')?.scrollTop||0,candidateScroll=document.querySelector('.candidate-scroll')?.scrollTop||0;
 const navs=[['plan','Planlayıcı'],['people','Kişiler ve hedefler'],['records','İzin ve istekler'],['rotations','Rotasyonlar'],['holidays','Resmî tatiller'],['summary','Aylık özet'],['data','Veri ve yedek'],['settings','Ayarlar']];
 const current=navs.find(n=>n[0]===view),complete=state.months[month]?.completedAt;
 app.innerHTML=`<div class="app-shell${sidebarCollapsed?' sidebar-collapsed':''}"><aside id="app-sidebar" class="sidebar" ${sidebarCollapsed?'hidden':''}><div class="brand"><div class="brand-mark">✣</div><div><strong>Nöbet Uygulaması</strong><small>ANESTEZİ KLİNİĞİ</small></div></div><nav class="nav" aria-label="Ana menü">${navs.map(([key,label])=>`<button data-action="nav" data-view="${key}" class="${view===key?'active':''}" ${!hasMonths&&!['plan','data','settings'].includes(key)?'disabled':''}>${icon(key==='settings'?'data':key)}${label}</button>`).join('')}</nav><div class="sidebar-label">AYLIK LİSTELER <button class="plus" data-action="new-month" aria-label="Yeni ay ekle">+</button></div><div class="month-list">${Object.keys(state.months).sort().map(m=>`<div class="month-item ${m===month?'active':''}"><button data-action="month" data-month="${m}" class="month-link ${m===month?'active':''}"><span>${e(monthLabel(m))}</span><i class="month-dot ${state.months[m].completedAt?'done':''}"></i></button><button class="month-delete" data-action="delete-month" data-month="${m}" aria-label="${e(monthLabel(m))} listesini sil" title="${e(monthLabel(m))} listesini sil">×</button></div>`).join('')}</div></aside><main class="workspace"><header class="topbar"><div class="workspace-heading"><button class="icon-btn sidebar-toggle" data-action="toggle-sidebar" aria-controls="app-sidebar" aria-expanded="${!sidebarCollapsed}" aria-label="${sidebarCollapsed?'Menüyü aç':'Menüyü kapat'}" title="${sidebarCollapsed?'Menüyü aç':'Menüyü kapat'}">${sidebarToggleIcon()}</button><div><div class="title-line"><h1>${e(!hasMonths&&view==='plan'?'Yeni liste oluştur':view==='plan'||view==='summary'?monthLabel(month):current?.[1])}</h1><span class="pill ${complete?'green':'amber'}">${complete?'✓ Tamamlandı':'Taslak'}</span></div></div></div><div class="top-actions"><span id="save-status" class="save-status"></span><button class="icon-btn" data-action="undo" title="Geri al (⌘ Z)" aria-label="Geri al" ${undoStack.length?'':'disabled'}>↶</button><button class="icon-btn" data-action="redo" title="Yinele" aria-label="Yinele" ${redoStack.length?'':'disabled'}>↷</button><button class="btn primary" data-action="publish" ${!hasMonths||publishing||saving||pendingSave||saveError||conflict?'disabled':''}>${publishing?'Yayınlanıyor…':'Yayınla'}</button><button class="btn" data-action="share" ${hasMonths?'':'disabled'}>Paylaş / yazdır</button><button class="btn" data-action="export-roster" ${hasMonths?'':'disabled'}>Listeyi indir ↓</button><button class="btn primary" data-action="audit" ${hasMonths?'':'disabled'}>${complete?'Listeyi denetle':'Kontrol et ve tamamla'} ↗</button></div></header>${saveError?`<div class="notice error save-banner"><span><b>Değişiklikler henüz çevrimiçi kaydedilemedi.</b> ${e(saveError)}</span><div class="toolbar"><button class="btn" data-action="backup">Taslağı yedekle</button><button class="btn" data-action="${conflict?'reload':'retry-save'}">${conflict?'Yeniden yükle':'Kaydı tekrar dene'}</button></div></div>`:''}<div class="content"><h1 class="print-only">${e(monthLabel(month))} · Nöbet listesi</h1>${!hasMonths&&!['data','settings'].includes(view)?renderEmptyWorkspace():view==='plan'?renderPlanner():view==='summary'?renderSummary():view==='data'?renderData():renderManagement(state,month,view)}</div></main></div>`;
 document.querySelector('.content').scrollTop=pendingLocationScroll?.contentScroll??scroll;if(document.querySelector('.plan-table'))document.querySelector('.plan-table').scrollTop=pendingLocationScroll?.tableScroll??tableScroll;if(document.querySelector('.candidate-scroll'))document.querySelector('.candidate-scroll').scrollTop=pendingLocationScroll?.candidateScroll??candidateScroll;pendingLocationScroll=null;updateSave();updateSearchHighlights();rememberLocation();
}
function renderEmptyWorkspace(){return `<section class="panel empty-workspace"><div class="empty-workspace-icon">▦</div><h2>Henüz aylık liste yok</h2><p>Bir ay ekleyerek nöbet planlamaya başlayabilirsin.<br>Asistanlar, hedefler, izinler ve istekler kayıtlı duruyor.</p><button class="btn primary" data-action="new-month">+ Aylık liste ekle</button><p class="form-help">Az önce sildiğin listeyi üstteki Geri al düğmesiyle geri getirebilirsin.</p></section>`}
function deleteMonth(m){if(!Object.hasOwn(state.months,m))return;const count=state.assignments.filter(a=>a.date.startsWith(`${m}-`)).length;dialog({title:`${monthLabel(m)} listesi silinsin mi?`,confirmLabel:'Ayı ve nöbetlerini sil',body:`<p><strong>${e(monthLabel(m))}</strong> aylık listesi${count?` ve bu aydaki <strong>${count} nöbet</strong>`:''} kaldırılacak.</p><p>Asistanlar, hedefler, izinler, istekler ve rotasyonlar kayıtlı kalır. İşlemi <strong>Geri al</strong> düğmesiyle geri çevirebilirsin.</p>`,onConfirm:()=>commit(st=>removeMonth(st,m),`${monthLabel(m)} listesi silindi · Geri al ile geri getirebilirsin`)})}
function clearPlanDialog(){
 if(conflict)return;
 const keepPlan=planMonthClear(state,month),allPlan=planMonthClear(state,month,{includeRequests:true});
 if(!allPlan.totalAssignments){toast('Bu ayda silinecek nöbet yok.');return}
 const confirmClear=plan=>{
  if(!plan.removedAssignments.length){toast('İstek atamaları dışında silinecek nöbet yok.');return}
  dialog({title:'Emin misin?',confirmLabel:'Evet, nöbetleri sil',body:`<p><strong>${e(monthLabel(plan.month))}</strong> listesinden <strong>${plan.removedAssignments.length} nöbet</strong> silinecek.${plan.keptRequestAssignments.length?` <strong>${plan.keptRequestAssignments.length} istek ataması</strong> kalacak.`:''}</p><p class="muted">İstek kayıtları korunur. İşlemi Geri al ile geri çevirebilirsin.</p>`,onConfirm:()=>{
   commit(st=>clearMonthPlan(st,plan),'Nöbetler silindi · Geri al ile geri getirebilirsin');
   clearCandidateSelection();
  }});
 };
 if(!keepPlan.requestAssignmentCount){confirmClear(allPlan);return}
 dialog({title:'İstek atamaları da silinsin mi?',confirmLabel:'Devam et',body:`<p>Bu ay isteklere bağlı <strong>${keepPlan.requestAssignmentCount} nöbet</strong> var; cuma–pazar eşleri dahil.</p><div class="clear-plan-options"><label><input type="radio" name="clear-scope" value="keep" checked><span>Hayır, istek atamalarını koru</span></label><label><input type="radio" name="clear-scope" value="all"><span>Evet, onları da sil</span></label></div><p class="muted">İsteklerin kendisi silinmez.</p>`,onConfirm:fd=>confirmClear(fd.get('clear-scope')==='all'?allPlan:keepPlan)});
}
function renderCapabilityControls(){
 return `<div class="capability-rule-controls"><label class="capability-rule-switch"><input id="capability-rules-enabled" type="checkbox" ${rulesEnabled(state,month)?'checked':''}><span>Yetkinlik kontrolü</span></label><button class="btn small" data-action="nav" data-view="settings">Ayarlar</button></div>`;
}
function renderPlanner(){
 const all=people(),assigned=state.assignments.filter(a=>a.date.startsWith(month)),missing=all.filter(p=>!targetFor(state,p.id,month)).length,unpaired=all.reduce((n,p)=>n+stats(p.id).unpaired.length,0),filledDays=new Set(assigned.map(a=>a.date)).size;
 return `<div class="planner-layout"><div class="planner-main">${renderCapabilityControls()}<div class="planner-summary" aria-label="Aylık sayılar"><span><strong>${all.length}</strong> asistan</span><span><strong>${assigned.length}</strong> nöbet</span><span><strong>${filledDays}/${daysInMonth(month).length}</strong> gün dolu</span><span><strong>${unpaired}</strong> eksik cuma–pazar eşi</span>${missing?`<button class="summary-link" data-action="nav" data-view="people" title="${missing} kişinin nöbet hedefi tanımlı değil">${missing} hedef eksik</button>`:''}</div>
 <section class="panel plan-panel"><div class="plan-head"><div class="plan-title"><h2>Aylık plan</h2><button class="btn small" data-action="carry-previous-month" ${conflict?'disabled':''}>Önceki aydan aktar</button><button class="btn small danger" data-action="clear-plan" ${!assigned.length||conflict?'disabled':''}>Yapılanları sil</button></div><div class="legend"><span class="legend-weekend"><i></i>Cuma–Pazar</span><span class="legend-holiday"><i></i>Resmî tatil</span><button class="icon-btn" data-action="share" aria-label="Paylaş / yazdır" title="Paylaş / yazdır">⎙</button></div></div><div class="plan-table"><div class="table-heading"><div>Gün</div>${sites.map((s,i)=>`<div><i class="site-dot s${i}"></i>${e(s)}</div>`).join('')}</div>${daysInMonth(month).map(renderDay).join('')}</div></section></div><aside class="panel candidate-panel">${renderCandidates()}</aside></div>`;
}
function renderDay(d){
 const dow=dayOfWeek(d),holiday=state.holidays.find(h=>h.date===d),dayAss=state.assignments.filter(a=>a.date===d);
 const compare=comparePeopleBySeniority(state,month);
 const cells=sites.map(site=>{
  const current=selectedDay===d&&selectedSite===site;
  const list=dayAss.filter(a=>a.site===site).sort((a,b)=>compare(person(a.personId),person(b.personId)));
  const chips=list.map(a=>{
   const p=person(a.personId),rotation=rotationFor(p.id,d);
   return `<div class="duty-chip ${a.overrides?.length?'warn':''} ${selectedAssignment===a.id?'picked':''}" draggable="false" data-person="${e(p.id)}" data-assignment="${e(a.id)}" data-action="pick-duty" data-rotation-site="${e(rotationColorKey(rotation))}" title="${e(p.name)} · ${e(rotationDescription(rotation))} · Taşımak için sürükle veya seç"><span>${e(p.name)}</span><button data-action="remove-duty" data-id="${e(a.id)}" aria-label="${e(p.name)} ${e(shortDate(d))} nöbetini kaldır">×</button></div>`;
  }).join('');
  return `<div class="duty-cell ${current?'current':''}" data-action="cell" data-date="${d}" data-site="${e(site)}" tabindex="0" role="button" aria-label="${e(shortDate(d))} ${e(site)}, ${list.length} kişi"><div class="cell-meta"><span>${current?'SEÇİLİ':''}</span><span class="cell-count-stack"><span class="cell-count">${list.length}</span>${site==='Feriha Öz'?`<span class="cell-capacity ${rulesEnabled(state,month)&&siteCoverage(state,d,site).issues.some(item=>item.code==='coverage-feriha-capacity')?'short':''}" title="Alan karşılığı: kareli × 2 + diğer çalışanlar; Ç katkısı 0" aria-label="${e(shortDate(d))} Feriha Öz alan karşılığı ${siteCoverage(state,d,site).capacity}">${siteCoverage(state,d,site).capacity}</span>`:''}</span></div>${list.length?`<div class="duty-list">${chips}</div>`:'<span class="cell-empty">+ Nöbetçi</span>'}</div>`;
 }).join('');
 return `<div class="day-row ${[0,5,6].includes(dow)?'weekend':''} ${holiday?'holiday':''} ${selectedDay===d?'selected':''}" data-date="${d}"><button class="day-label ${selectedDay===d?'selected':''}" data-action="day" data-date="${d}" aria-label="${e(dateLabel(d))}"><b>${Number(d.slice(-2))}</b><span>${dateLabel(d,{weekday:'short'})}</span>${holiday?`<span class="day-kind">Tatil</span><small title="${e(holiday.name)}">${e(holiday.name)}</small>`:[0,5,6].includes(dow)?'<span class="day-kind">H. sonu</span>':''}</button>${cells}</div>`;
}
function candidateModel(p){
 const check=validateAssignment(state,{personId:p.id,date:selectedDay,site:selectedSite});
 const pref=applicable(state.requests,p.id,selectedDay).some(r=>r.kind==='prefer'),rotation=rotationFor(p.id,selectedDay);
 const chain=alternateDutyChain(state,p.id,selectedDay);
 const warningLevel=chain.length>=3?2:(chain.length===2||check.warnings.length?1:0);
 const alternateHint=chain.length===2?`2 kez gün aşırı nöbet (${chain.map(shortDate).join(', ')}).`:'';
 return{p,check,pref,rotation,warningLevel,alternateHint};
}
function renderDayNotes(promotedIds){
 const notes=dayNotes(state,selectedDay).filter(item=>!promotedIds.has(item.person.id)&&!targetFinished(item.person.id));
 if(!notes.length)return '';
 return `<section class="day-notes" aria-label="Seçili günün istekleri ve izinleri"><div class="day-notes-heading"><h3>İstekler ve izinler</h3><span>${notes.length} kişi</span></div><div class="candidate-grid day-notes-grid">${notes.map(renderDayNote).join('')}</div></section>`;
}
function renderDayNote(item){
 const p=item.person,{check,rotation,warningLevel,alternateHint}=candidateModel(p),blocked=!item.assignment&&check.errors.length>0;
 const title=[p.name,rotationDescription(rotation),...item.labels.map(l=>`${l.text}${l.note?': '+l.note:''}`),item.assignment?`Nöbetli: ${item.assignment.site}`:'',...(!item.assignment?[alternateHint,...check.errors.map(x=>x.message),...check.warnings.map(x=>x.message)]:[])].filter(Boolean).join('\n');
 const symbols={prefer:'★',together:'↔',avoid:'⊘',annual:'İ',excused:'İ',exempt:'M'};
 const togetherHints=[...new Set(item.labels.filter(label=>label.kind==='together').map(label=>label.note))];
 const togetherHint=togetherHints.filter(hint=>!togetherHints.some(other=>other!==hint&&other.includes(hint))).join(' · '),kinds=[...new Set(item.labels.map(label=>label.kind))];
 return `<button class="${item.assignment?'':'candidate '}day-note${blocked?' blocked':''}${!item.assignment&&warningLevel?' warning':''}${!item.assignment&&warningLevel===2?' warning-double':''}${selectedPerson===p.id?' picked':''}${selectedCandidateId===p.id?' candidate-selected':''}" ${item.assignment?'':`aria-pressed="${selectedCandidateId===p.id}"`} data-action="${item.assignment?'person-detail':'pick'}" data-person="${e(p.id)}" data-rotation-site="${e(rotationColorKey(rotation))}" draggable="false" title="${e(title)}" aria-label="${e(title)}"><span class="name">${item.assignment?'<span class="assigned-flag" aria-hidden="true">✓ </span>':''}${kinds.map(kind=>`<span class="note-flag tag-${kind}" aria-hidden="true">${symbols[kind]}</span>`).join('')}${e(p.name)}</span><span class="sub">${e(togetherHint||rotationLabel(rotation))}</span>${candidateBadges(p.id)}</button>`;
}
function renderCandidates(){
 const all=people(),matches=candidateNameMatches(all,candidateSearch),promotedIds=new Set(matches.map(p=>p.id));
 const assignments=state.assignments.filter(a=>a.date===selectedDay),assignedByPerson=new Map(assignments.map(a=>[a.personId,a]));
 const candidates=all.filter(p=>!assignedByPerson.has(p.id)&&!promotedIds.has(p.id)).map(candidateModel);
 const compare=comparePeopleBySeniority(state,month),ordered=candidates.sort((a,b)=>compare(a.p,b.p));
 const current=ordered.filter(x=>!targetFinished(x.p.id));
 const notes=dayNotes(state,selectedDay),noteMap=new Map(notes.map(item=>[item.person.id,item]));
 const finished=new Map(ordered.filter(x=>targetFinished(x.p.id)).map(x=>[x.p.id,x]));
 for(const item of notes)if(!promotedIds.has(item.person.id)&&targetFinished(item.person.id))finished.set(item.person.id,candidateModel(item.person));
 const finishedCards=[...finished.values()].sort((a,b)=>compare(a.p,b.p)).map(x=>noteMap.has(x.p.id)?renderDayNote(noteMap.get(x.p.id)):renderCandidate(x)).join('');
 const matchedCards=matches.map(p=>{
  if(noteMap.has(p.id))return renderDayNote(noteMap.get(p.id));
  if(assignedByPerson.has(p.id))return renderDayNote({person:p,labels:[],assignment:assignedByPerson.get(p.id)});
  return renderCandidate(candidateModel(p));
 }).join('');
 const searchResults=matches.length?`<div class="candidate-grid candidate-search-results" aria-label="Aranan kişiler">${matchedCards}</div>`:candidateSearch.trim()?'<p class="candidate-search-empty" role="status">İsim bulunamadı.</p>':'';
 return `<div class="candidate-search-toolbar"><label class="sr-only" for="candidate-search">İsim ara</label><input id="candidate-search" type="search" placeholder="İsim ara…" value="${e(candidateSearch)}" autocomplete="off"></div><div class="candidate-scroll" data-drop-remove="true">${searchResults}${renderDayNotes(promotedIds)}${current.length?`<div class="candidate-grid">${current.map(renderCandidate).join('')}</div>`:finished.size||matches.length?'':'<div class="empty">Bu güne yazılabilecek kişi kalmadı.</div>'}${finished.size?`<section class="finished-candidates" aria-label="Bu gün için nöbet hedefi bitenler"><h3>Bitenler <span>${finished.size} kişi</span></h3><div class="candidate-grid">${finishedCards}</div></section>`:''}</div>${selectedAssignment?'<div class="candidate-actions"><button class="btn danger" data-action="remove-selected">Seçili nöbeti kaldır</button></div>':''}`;
}
function refreshCandidates(){
 const panel=document.querySelector('.candidate-panel');if(!panel)return;
 const input=panel.querySelector('#candidate-search'),focused=document.activeElement===input;
 const start=input?.selectionStart,end=input?.selectionEnd;
 panel.innerHTML=renderCandidates();
 panel.querySelector('.candidate-scroll').scrollTop=0;
 if(focused){const next=panel.querySelector('#candidate-search');next.focus({preventScroll:true});next.setSelectionRange(start,end)}
 updateSearchHighlights();
}
function updateSearchHighlights(){
 const table=app.querySelector('.plan-table');if(!table)return;
 const matches=candidateNameMatches(people(),candidateSearch),matchedIds=new Set(matches.map(p=>p.id));
 let any=false;
 for(const chip of table.querySelectorAll('.duty-chip')){
  const matched=matchedIds.has(chip.dataset.person);
  chip.classList.toggle('search-match',matched);any||=matched;
 }
 for(const cell of table.querySelectorAll('.duty-cell')){
  cell.classList.toggle('search-match',!!cell.querySelector('.duty-chip.search-match'));
  const availability=searchCellAvailability(state,matches,cell.dataset.date,cell.dataset.site);
  cell.classList.toggle('search-blocked',availability.status==='blocked');
  cell.classList.toggle('search-warning',availability.status==='warning');
  cell.removeAttribute('title');
  if(!cell.dataset.baseLabel)cell.dataset.baseLabel=cell.getAttribute('aria-label');
  cell.setAttribute('aria-label',cell.dataset.baseLabel+(availability.title?'\n'+availability.title:''));
  cell.querySelector('.search-availability')?.remove();
  if(availability.status){
   cell.title=availability.title;
   const badge=document.createElement('span');badge.className='search-availability';badge.setAttribute('aria-hidden','true');
   badge.textContent=(availability.status==='blocked'?'⊘':'!')+(matches.length>1?` ${availability.count}/${availability.total}`:'');
   cell.querySelector('.cell-meta').append(badge);
  }
 }
 for(const row of table.querySelectorAll('.day-row'))row.classList.toggle('search-match',!!row.querySelector('.duty-cell.search-match'));
 table.classList.toggle('search-active',any);
}
function renderCandidate({p,check,pref,rotation,warningLevel,alternateHint}){const isBlocked=check.errors.length>0;const subtitle=rotationLabel(rotation);const title=[p.name,pref?'Bu güne nöbet istiyor.':'',rotationDescription(rotation),alternateHint,...check.errors.map(x=>x.message),...check.warnings.map(x=>x.message)].filter(Boolean).join('\n');return `<button class="candidate ${isBlocked?'blocked':''} ${warningLevel?'warning':''} ${warningLevel===2?'warning-double':''} ${pref?'preferred':''} ${selectedPerson===p.id?'picked':''} ${selectedCandidateId===p.id?'candidate-selected':''}" aria-pressed="${selectedCandidateId===p.id}" draggable="false" data-action="pick" data-person="${e(p.id)}" data-rotation-site="${e(rotationColorKey(rotation))}" title="${e(title)}" aria-label="${e(title)}"><span class="name">${pref?'<span class="preference-flag" aria-hidden="true">★ </span>':''}${e(p.name)}</span><span class="sub">${e(subtitle)}</span>${candidateBadges(p.id)}</button>`}
function renderSummary(){
 const all=people(),issues=auditMonth(state,month),under=all.filter(p=>targetProgress(targetFor(state,p.id,month),stats(p.id))?.isUnder).length;
 const remainingClass=value=>value>0?'positive':value<0?'negative':'good';
 return `<div class="page-intro"><div><h2>Aylık nöbet özeti</h2></div><div class="toolbar summary-actions"><button class="btn" data-action="export-summary">Özeti indir ↓</button><button class="btn" data-action="print">Özeti yazdır / PDF</button></div></div><div class="summary-totals"><span>${all.length} asistan</span><span>·</span><span>${under} kişi hedefin altında</span><span>·</span><span>${issues.length} kontrol notu</span></div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Asistan / kıdem</th><th>Toplam nöbet<br>sayılan / hedef</th><th>Kalan nöbet</th><th>Hafta sonu<br>puan / hedef</th><th>Kalan hafta sonu</th><th>Gerçek nöbet</th><th>Perşembe</th><th>Tatil nöbeti</th><th class="no-print"></th></tr></thead><tbody>${all.map(p=>{const c=stats(p.id),progress=targetProgress(targetFor(state,p.id,month),c);return `<tr><td><strong>${e(p.name)}</strong><div class="muted">${rankOf(state,p.groupId,month)}. kıdem</div></td><td>${fmt(c.countedTotal)} <span class="muted">/ ${progress?fmt(progress.totalTarget):'—'}</span></td><td class="remaining ${progress?remainingClass(progress.totalRemaining):''}">${progress?fmt(progress.totalRemaining):'—'}</td><td>${fmt(c.weekend)} <span class="muted">/ ${progress?fmt(progress.weekendTarget):'—'}</span></td><td class="remaining ${progress?remainingClass(progress.weekendRemaining):''}">${progress?fmt(progress.weekendRemaining):'—'}</td><td>${c.total}</td><td>${thursdayCount(p.id)}</td><td>${c.holidayCount?`${c.holidayCount}<div class="muted">${c.holidays.map(h=>`${e(h.name)} · ${e(shortDate(h.date))}`).join('<br>')}</div>`:'—'}</td><td class="no-print"><button class="btn small" data-action="person-detail" data-person="${e(p.id)}">İncele</button></td></tr>`}).join('')}</tbody></table></div></section><section class="panel" style="margin-top:20px"><div class="section-head"><h2>Kontrol notları</h2><span class="pill amber">${issues.length}</span></div><div class="issues-scroll">${issuesHTML(issues)}</div></section>`;
}
function issuesHTML(issues){return issues.length?`<ul class="issues">${issues.map(i=>`<li class="${i.severity==='error'?'error':''}">${i.personId?`<strong>${e(person(i.personId)?.name||'')}</strong> · `:''}${e(i.message)}</li>`).join('')}</ul>`:'<div class="empty">✓ Tanımlı kurallarla bir çakışma bulunmadı.</div>'}
function renderData(){const hasMonths=Object.keys(state.months).length>0;return `<div class="page-intro"><div><h2>Çevrimiçi nöbet taslağı</h2><p>Değişiklikler Asistan sistemine taslak olarak kaydedilir. Yayınla düğmesi seçili ayı asistanların gördüğü listeye aktarır.</p></div></div><div class="backup-grid"><section class="panel"><div class="section-head"><h2>Tam yedek</h2><span class="pill">JSON</span></div><div class="panel-body"><p class="muted">Kişiler, kıdem geçmişi, hedefler, nöbetler, izinler, istekler, rotasyonlar ve tatiller birlikte saklanır.</p><div class="toolbar"><button class="btn primary" data-action="backup">Tam yedek indir ↓</button><button class="btn" data-action="backup-history">Otomatik yedekler</button></div></div></section><section class="panel"><div class="section-head"><h2>Yedekten geri yükle</h2><span class="pill">JSON</span></div><div class="panel-body"><p class="muted">Seçtiğin yedeği önce doğrularız. Onayından sonra çevrimiçi taslağın yerini alır; yayınlanmış listeyi değiştirmek için ayrıca Yayınla düğmesini kullan.</p><button class="btn" data-action="restore">Yedek dosyası seç ↑</button><input id="restore-file" type="file" accept=".json,application/json" hidden></div></section><section class="panel"><div class="section-head"><h2>Aylık çıktılar</h2><span class="pill">PNG / PDF / CSV</span></div><div class="panel-body"><p class="muted">${hasMonths?`${e(monthLabel(month))} için hastane bazında liste veya kişi bazında özet. CSV dosyalarını Excel ile açabilirsin.`:'Aylık çıktı almak için önce bir ay ekle.'}</p><div class="toolbar"><button class="btn primary" data-action="share" ${hasMonths?'':'disabled'}>Paylaş / yazdır</button><button class="btn" data-action="export-roster" ${hasMonths?'':'disabled'}>Nöbet listesi ↓</button><button class="btn" data-action="export-summary" ${hasMonths?'':'disabled'}>Kişi özeti ↓</button></div></div></section><section class="panel"><div class="section-head"><h2>GPT için giriş komutu</h2><span class="pill">TXT</span></div><div class="panel-body"><p class="muted">Bu talimatı GPT projenin komutuna ekle; serbest metin isteklerini uygulamanın anlayacağı satırlara dönüştürsün.</p><button class="btn" data-action="download-prompt">Proje komutunu indir ↓</button></div></section></div><div class="notice info" style="margin-top:20px">Taslak ve yayınlanan liste ayrı tutulur. İndirdiğin JSON yedeği hedefleri, istekleri ve geçmiş nöbetleri birlikte korur.</div><section class="panel"><div class="section-head"><h2>Önceki ayın sınır nöbetleri</h2></div><div class="panel-body"><p class="muted">Ayın ilk günlerinde ardışık / gün aşırı nöbetleri ve cuma–pazar eşlerini doğru kontrol etmek için önceki ayın son günlerini de gir. Verilmeyen geçmiş nöbetleri program bilemez.</p><button class="btn" data-action="mg-import" data-kind="duty" style="margin-top:12px">Geçmiş nöbetleri aktar</button></div></section>`}
function confirmRestore(backup,label){
 const restoreMonth=Object.hasOwn(backup.months??{},month)?month:Object.keys(backup.months??{}).sort().at(-1);
 const check=validateState(backup);if(!check.valid)throw new Error(check.errors.slice(0,5).join(' · '));
 dialog({title:'Bu yedek geri yüklensin mi?',body:`<p><b>${e(label)}</b></p><p>${backup.people.length} kişi · ${backup.assignments.length} nöbet · ${Object.keys(backup.months).length} aylık liste</p><p class="form-help">Mevcut çalışma alanının yerini alır. Geri al düğmesiyle mevcut duruma dönebilirsin; disk yedeği de korunur.</p>`,confirmLabel:'Yedeği geri yükle',onConfirm:()=>{commit(st=>{for(const key of Object.keys(st))delete st[key];Object.assign(st,structuredClone(backup))},'Yedek geri yüklendi',{invalidate:false});selectMonth(restoreMonth,{reconcile:false})}});
}
const backupKindLabel={daily:'Günlük', 'day-start':'Gün başlangıcı',completed:'Tamamlanan liste',rolling:'Son işlem'};
const backupTime=value=>new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
async function openBackupHistory(){
 const response=await plannerFetch('/api/backups');const result=await response.json();if(!response.ok)throw new Error(result.error||'Yedekler okunamadı.');
 const backups=result.backups??[];
 dialog({title:'Otomatik yedekler',body:`<p class="muted">Çevrimiçi taslağın önceki kayıtları.</p>${backups.length?`<div class="backup-history-scroll"><table class="data-table"><thead><tr><th>Tarih</th><th>Kopya</th><th></th></tr></thead><tbody>${backups.map(item=>`<tr><td>${e(backupTime(item.savedAt))}</td><td>${e(backupKindLabel[item.kind]||'Yedek')}${item.month?`<div class="muted">${e(monthLabel(item.month))}</div>`:''}</td><td><button type="button" class="btn small" data-backup-id="${e(item.id)}" data-backup-label="${e(backupTime(item.savedAt))} · ${e(backupKindLabel[item.kind]||'Yedek')}">Geri yükle</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Henüz otomatik yedek yok.</div>'}`,confirmLabel:'Kapat',hideCancel:true});
}
async function previewAutomaticBackup(id,label){
 const generation=dialogGeneration;
 const response=await plannerFetch(`/api/backups/${encodeURIComponent(id)}`);const result=await response.json();if(!response.ok)throw new Error(result.error||'Yedek okunamadı.');
 if(!dlg.open||generation!==dialogGeneration)return;
 confirmRestore(result.state,label);
}
function selectMonth(m,{reconcile=true}={}){selectedCandidateId=null;candidateSearch='';month=m||'2026-11';selectedDay=`${month}-01`;selectedPerson=null;selectedAssignment=null;render();document.querySelector('.content').scrollTop=0;document.querySelector('.plan-table')?.scrollTo(0,0);document.querySelector('.candidate-scroll')?.scrollTo(0,0);rememberLocation();if(reconcile)reconcileWeekendMonth(month)}
function weekendWarnings(plan){return plan.warnings.map(item=>({...item,message:`${shortDate(item.date)} · Pazar eşi: ${item.message}`}))}
function weekendBlockedHTML(items){return `<ul class="issues">${items.map(item=>`<li><strong>${e(person(item.personId)?.name||'')}</strong> · ${e(shortDate(item.date))} · ${e(item.site)}<br>${item.messages.map(e).join('<br>')}</li>`).join('')}</ul>`}
function showWeekendBlocked(items){if(items.length)dialog({title:'Pazar nöbeti eklenemedi',body:`<p>Cuma nöbeti korunuyor. Aşağıdaki pazar günleri kesin kural engeli nedeniyle eklenmedi.</p>${weekendBlockedHTML(items)}`,confirmLabel:'Anladım',hideCancel:true})}
function createPlanningMonth(m){
 daysInMonth(m);
 if(state.months[m]){selectMonth(m);return}
 const original=JSON.stringify(state),plan=planAutoWeekend(state,[],{reconcileMonth:m});
 const apply=()=>{
  if(JSON.stringify(state)!==original)throw new Error('Liste değişti. Ayı yeniden seçerek tekrar dene.');
  commit(st=>{st.months[m]={completedAt:null};applyWeekendPlan(st,plan)},`Yeni ay açıldı${plan.assignments.length?` · ${plan.assignments.length} pazar nöbeti eklendi`:''}`);
  selectMonth(m,{reconcile:false});showWeekendBlocked(plan.blocked);
 };
 if(plan.warnings.length)dialog({title:'Yeni ay ve pazar nöbetleri',body:`<p>${e(monthLabel(m))} açılacak. Önceki ayın cuma nöbetlerinden ${plan.assignments.length} pazar nöbeti eklenecek.</p>${issuesHTML(weekendWarnings(plan))}${plan.blocked.length?weekendBlockedHTML(plan.blocked):''}`,confirmLabel:'Ayı aç ve nöbetleri ekle',onConfirm:apply});
 else apply();
}
function reconcileWeekendMonth(m){
 if(!state.months[m]||state.months[m].weekendPairInitialized||conflict)return;
 const original=JSON.stringify(state),plan=planAutoWeekend(state,[],{reconcileMonth:m});
 if(!plan.assignments.length&&!plan.alreadyAssigned.length&&!plan.blocked.length&&!plan.warnings.length)return;
 const apply=(include=true)=>{
  if(JSON.stringify(state)!==original)throw new Error('Liste değişti. Ayı yeniden açarak tekrar kontrol et.');
  const accepted=include?plan:{...plan,assignments:[]};
  commit(st=>applyWeekendPlan(st,accepted),include&&plan.assignments.length?`${plan.assignments.length} pazar nöbeti önceki ayın cumasından eklendi`:'',{invalidate:include&&plan.assignments.length>0});
  if(include)showWeekendBlocked(plan.blocked);
 };
 if(plan.warnings.length)dialog({title:'Ay başındaki pazar nöbetleri',body:`<p>Önceki ayın cuma nöbetlerinden ${plan.assignments.length} pazar nöbeti eklenecek.</p>${issuesHTML(weekendWarnings(plan))}${plan.blocked.length?weekendBlockedHTML(plan.blocked):''}`,confirmLabel:'Pazar nöbetlerini ekle',onConfirm:()=>apply(),onCancel:()=>apply(false)});
 else apply();
}
function carryPreviousMonth(){
 const original=JSON.stringify(state),selectedMonth=month,plan=planPreviousMonthWeekend(state,month);
 if(!plan.assignments.length){
  if(plan.blocked.length)showWeekendBlocked(plan.blocked);
  else toast(plan.alreadyAssigned.length?'Önceki aydan gelen pazar nöbetleri zaten yazılmış.':'Önceki ayın son iki gününden bu aya devredecek pazar nöbeti yok.');
  return;
 }
 const apply=()=>{
  if(JSON.stringify(state)!==original||month!==selectedMonth)throw new Error('Liste veya ay değişti. Önceki aydan aktar düğmesine yeniden basın.');
  commit(st=>applyWeekendPlan(st,plan),`${plan.assignments.length} pazar nöbeti önceki aydan eklendi.`);
  showWeekendBlocked(plan.blocked);
 };
 if(plan.warnings.length)dialog({title:'Önceki aydan gelen pazar nöbetleri',body:`<p>${plan.assignments.length} pazar nöbeti eklenecek.</p>${issuesHTML(weekendWarnings(plan))}${plan.blocked.length?weekendBlockedHTML(plan.blocked):''}`,confirmLabel:'Uyarıları onayla ve ekle',onConfirm:apply});
 else apply();
}
function askAssignment(id,d,s,moveId=null){
 const p=person(id);if(!p)return;const old=moveId?state.assignments.find(a=>a.id===moveId):null;if(old&&old.date===d&&old.site===s){selectedPerson=null;selectedAssignment=null;render();return}
 const checks=validateAssignment(state,{personId:id,date:d,site:s},moveId);if(checks.errors.length){dialog({title:'Bu nöbet yazılamaz',body:`<p><b>${e(p.name)}</b> · ${e(shortDate(d))}</p>${issuesHTML(checks.errors.map(x=>({...x,severity:'error'})))}`,confirmLabel:'Anladım',hideCancel:true});return}
 const original=JSON.stringify(state),assignment={id:old?.id||uid(),personId:id,date:d,site:s,overrides:checks.warnings.map(w=>w.code)};
 const draft=structuredClone(state);if(moveId)draft.assignments=draft.assignments.filter(a=>a.id!==moveId);draft.assignments.push(assignment);
 const plan=planAutoWeekend(draft,[assignment]),warnings=[...checks.warnings,...weekendWarnings(plan)];
 const perform=()=>{
  if(JSON.stringify(state)!==original)throw new Error('Liste değişti. Nöbeti yeniden seçerek tekrar dene.');
  commit(st=>{if(moveId)st.assignments=st.assignments.filter(a=>a.id!==moveId);st.assignments.push(assignment);st.months[d.slice(0,7)]??={completedAt:null};applyWeekendPlan(st,plan)},`${p.name} · ${shortDate(d)} · ${s}${plan.assignments.length?' · Pazar eşi eklendi':''}`);
  selectedDay=d;selectedSite=s;render();showWeekendBlocked(plan.blocked);
 };
 if(warnings.length){dialog({title:'Bu atama için onayın gerekli',body:`<p><b>${e(p.name)}</b><br>${e(dateLabel(d))} · ${e(s)}${plan.assignments.length?`<br>Otomatik pazar: ${plan.assignments.map(a=>e(shortDate(a.date))).join(', ')}`:''}</p>${issuesHTML(warnings)}${plan.blocked.length?weekendBlockedHTML(plan.blocked):''}`,confirmLabel:'Eminim, nöbetleri yaz',onConfirm:perform})}else perform();
}
function openAudit(){const issues=auditMonth(state,month),errors=issues.filter(i=>i.severity==='error'),emptyDays=daysInMonth(month).filter(d=>!state.assignments.some(a=>a.date===d)).length;dialog({title:`${monthLabel(month)} · Son kontrol`,body:`<p>${issues.length?`${issues.length} kontrol notu var.`:'Tanımlı kurallar sağlanıyor.'} ${emptyDays?`${emptyDays} güne henüz nöbet yazılmadı.`:''}</p><div class="issues-scroll">${issuesHTML(issues)}</div><p class="form-help">Eksik hedefler, yarım hafta sonları ve izin/istek istisnalarını kontrol et. Hastane kişi sayısını sen belirlersin.</p>`,confirmLabel:errors.length?'Hataları düzeltmek için dön':issues.length||emptyDays?'Notları gördüm, tamamla':'Listeyi tamamla',onConfirm:()=>{if(errors.length)return true;commit(st=>{st.months[month].completedAt=new Date().toISOString()},'Liste tamamlandı',{invalidate:false})}})}
function personDetail(id){const p=person(id),c=stats(id),t=targetFor(state,id,month),progress=targetProgress(t,c),list=state.assignments.filter(a=>a.personId===id&&a.date.startsWith(month)).sort((a,b)=>a.date.localeCompare(b.date));dialog({title:p.name,body:`<p>${rankOf(state,p.groupId,month)}. kıdem · ${e(monthLabel(month))}</p><div class="notice info">Toplam nöbet ${fmt(c.countedTotal)} / ${progress?fmt(progress.totalTarget):'—'} · Hafta sonu ${fmt(c.weekend)} / ${progress?fmt(progress.weekendTarget):'—'} puan</div><p class="muted">Gerçek nöbet: ${c.total}${c.countedTotal!==c.total?' · Tatil katkı ayarı toplam hedefe uygulandı.':''}</p>${list.length?`<table class="data-table"><thead><tr><th>Tarih</th><th>Hastane</th><th>Not</th></tr></thead><tbody>${list.map(a=>`<tr><td>${e(dateLabel(a.date,{day:'numeric',month:'short',weekday:'short'}))}</td><td>${e(a.site)}</td><td>${a.overrides?.length?'Onaylı istisna':'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Bu ay henüz nöbet yazılmadı.</p>'}${c.unpaired.length?`<p class="form-help">Eksik hafta sonu eşi: ${c.unpaired.map(x=>e(shortDate(x.missingDate))).join(', ')}</p>`:''}`,confirmLabel:'Kapat',hideCancel:true})}
function undo(redo=false){const source=redo?redoStack:undoStack,dest=redo?undoStack:redoStack;if(!source.length)return;if(conflict){toast('Önce kayıt çakışmasını çöz.');return}dest.push(structuredClone(state));state=source.pop();state.updatedAt=new Date().toISOString();pendingSave=structuredClone(state);selectedPerson=null;selectedAssignment=null;render();void flushSave();toast(redo?'İşlem yinelendi':'Son işlem geri alındı')}
async function publishMonth(){
 if(publishing||!state?.months[month])return;
 publishing=true;updateSave();
 try{
  await flushSave();
  if(saving||pendingSave||saveError||conflict)throw new Error('Önce değişikliklerinin çevrimiçi kaydedilmesini bekle.');
  const errors=auditMonth(state,month).filter(item=>item.severity==='error');
  if(errors.length){dialog({title:'Yayınlamadan önce düzelt',body:issuesHTML(errors),confirmLabel:'Anladım',hideCancel:true});return}
  const result=await plannerBridge.request('publish',{month,revision,state:structuredClone(state)},{timeoutMs:600000});
  toast(result?.message||'Nöbet listesi Asistan sistemine yayınlandı.');
 }catch(error){toast(error.message)}finally{publishing=false;updateSave()}
}
async function handle(action,el){
 if(action.startsWith('mg-'))return handleManagement(action,el,ctx);
 switch(action){
 case'toggle-sidebar':toggleSidebar();break;
 case'nav':selectedCandidateId=null;view=el.dataset.view;selectedPerson=null;selectedAssignment=null;render();document.querySelector('.content').scrollTop=0;break;
 case'month':selectMonth(el.dataset.month);break;
 case'delete-month':deleteMonth(el.dataset.month);break;
 case'clear-plan':clearPlanDialog();break;
 case'carry-previous-month':carryPreviousMonth();break;
 case'new-month':dialog({title:'Aylık liste ekle',body:`<label class="field">Ay<input name="month" type="month" required min="2026-10" value="${Object.keys(state.months).length?addDays(daysInMonth(month).at(-1),1).slice(0,7):month}"></label><p class="form-help">Hedefler geçerlilik tarihine göre yeni aya taşınır. Önceki ayın cuma nöbetleri varsa ay başındaki pazara da eklenir.</p>`,confirmLabel:'Ayı aç',onConfirm:fd=>createPlanningMonth(fd.get('month'))});break;
 case'day':selectedDay=el.dataset.date;selectedPerson=null;selectedAssignment=null;render();document.querySelector('.candidate-scroll')?.scrollTo(0,0);break;
 case'cell':if(selectedPerson){askAssignment(selectedPerson,el.dataset.date,el.dataset.site,selectedAssignment)}else{selectedDay=el.dataset.date;selectedSite=el.dataset.site;render();document.querySelector('.candidate-scroll')?.scrollTo(0,0)}break;
 case'pick':selectCandidate(el.dataset.person);break;
 case'quick-assign':selectCandidate(el.dataset.person);render();askAssignment(el.dataset.person,selectedDay,selectedSite);break;
 case'pick-duty':{const duty=state.assignments.find(a=>a.id===el.dataset.assignment);if(duty){selectedDay=duty.date;selectedSite=duty.site}selectedPerson=el.dataset.person;selectedAssignment=el.dataset.assignment;render();break}
 case'clear-selection':clearCandidateSelection();render();break;
 case'remove-duty':commit(st=>{st.assignments=st.assignments.filter(a=>a.id!==el.dataset.id)},'Nöbet kaldırıldı · Geri al ile geri getirebilirsin');break;
 case'remove-selected':if(selectedAssignment)commit(st=>{st.assignments=st.assignments.filter(a=>a.id!==selectedAssignment)},'Nöbet kaldırıldı');break;
 case'audit':openAudit();break;
 case'publish':await publishMonth();break;
 case'person-detail':if(el.closest('.candidate-panel'))selectCandidate(el.dataset.person);personDetail(el.dataset.person);break;
 case'undo':undo();break;case'redo':undo(true);break;
 case'export-roster':downloadFile(`Nobet-${month}.csv`,rosterCSV(state,month),'text/csv;charset=utf-8');break;
 case'export-summary':downloadFile(`Kisi-ozeti-${month}.csv`,summaryCSV(state,month),'text/csv;charset=utf-8');break;
 case'backup-history':await openBackupHistory();break;
 case'backup':downloadFile(`Nobet-yedek-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`,JSON.stringify(state,null,2),'application/json');break;
 case'share':if(state.months[month])openShareView(state,month);break;
 case'print':window.print();break;
 case'retry-save':void flushSave();break;
 case'reload':if(pendingSave||saveError)dialog({title:'Kaydedilmeyen değişiklikler var',body:'<p>Önce “Taslağı yedekle” ile değişikliklerini indir. Yeniden yüklemek ekrandaki kaydedilmemiş değişiklikleri kaybettirir.</p>',confirmLabel:'Yedeğimi aldım, yeniden yükle',onConfirm:()=>{pendingSave=null;saveError='';location.reload()}});else location.reload();break;
 case'restore':document.querySelector('#restore-file').click();break;
 case'download-prompt':{const res=await fetch(new URL('./GPT-GIRIS-KOMUTU.txt',import.meta.url));if(!res.ok)throw new Error('Komut dosyası okunamadı. Bağlantını kontrol edip yeniden dene.');downloadFile('GPT-GIRIS-KOMUTU.txt',await res.text());break}
 }
}
app.addEventListener('click',event=>{
 const el=event.target.closest('[data-action]');if(!el){lastCandidateClick=null;return}
 event.stopPropagation();let action=el.dataset.action;
 // Scope a double click to the same person and destination, even across card rerenders.
 if(action==='pick'&&event.detail>0){
  const current={personId:el.dataset.person,date:selectedDay,site:selectedSite,time:event.timeStamp,x:event.clientX,y:event.clientY},previous=lastCandidateClick;
  const repeated=previous&&current.personId===previous.personId&&current.date===previous.date&&current.site===previous.site&&current.time>=previous.time&&current.time-previous.time<=500&&Math.hypot(current.x-previous.x,current.y-previous.y)<=8;
  lastCandidateClick=repeated?null:current;if(repeated)action='quick-assign';
 }else lastCandidateClick=null;
 Promise.resolve(handle(action,el)).catch(err=>toast(err.message));
});
app.addEventListener('input',event=>{lastCandidateClick=null;if(event.target.id==='candidate-search'){candidateSearch=event.target.value;refreshCandidates()}});
app.addEventListener('change',async event=>{lastCandidateClick=null;if(event.target.matches('[data-capability]')){try{await handleCapabilityChange(event.target,ctx)}catch(error){toast(error.message);render()}return}if(event.target.id==='capability-rules-enabled'){const enabled=event.target.checked;try{commit(st=>{st.months[month].capabilityRulesEnabled=enabled},enabled?'Yetkinlik kontrolü açıldı':'Yetkinlik kontrolü kapatıldı')}catch(error){toast(error.message);render()}return}if(event.target.id==='restore-file'){const file=event.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('Yedek dosyası 10 MB sınırını aşıyor.');const parsed=JSON.parse(await file.text());confirmRestore(parsed.state||parsed,file.name)}catch(error){dialog({title:'Yedek yüklenemedi',body:`<div class="notice error">${e(error.message)}</div>`,confirmLabel:'Kapat',hideCancel:true})}event.target.value=''}});
dlg.addEventListener('click',async event=>{const button=event.target.closest('[data-backup-id]');if(!button)return;event.preventDefault();button.disabled=true;try{await previewAutomaticBackup(button.dataset.backupId,button.dataset.backupLabel)}catch(error){if(button.isConnected)button.disabled=false;toast(error.message)}});
let pointerDrag=null,suppressClick=false;
function endPointerDrag(){document.querySelectorAll('.drag-over').forEach(n=>n.classList.remove('drag-over'));document.querySelector('.drag-ghost')?.remove();document.body.classList.remove('is-dragging');pointerDrag=null}
app.addEventListener('pointerdown',event=>{
 if(event.button!==0||event.target.closest('[data-action="remove-duty"]'))return;
 const card=event.target.closest('.candidate:not(.blocked),.duty-chip');if(!card)return;
 pointerDrag={id:event.pointerId,x:event.clientX,y:event.clientY,personId:card.dataset.person,assignmentId:card.dataset.assignment||null,card,started:false};
 card.setPointerCapture(event.pointerId);
});
app.addEventListener('pointermove',event=>{
 const drag=pointerDrag;if(!drag||drag.id!==event.pointerId)return;
 if(!drag.started&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6){lastCandidateClick=null;drag.started=true;document.body.classList.add('is-dragging');const ghost=document.createElement('div');ghost.className='drag-ghost';ghost.textContent=person(drag.personId)?.name||'';document.body.append(ghost)}
 if(!drag.started)return;event.preventDefault();
 const ghost=document.querySelector('.drag-ghost');ghost.style.left=`${event.clientX+14}px`;ghost.style.top=`${event.clientY+14}px`;
 document.querySelectorAll('.drag-over').forEach(n=>n.classList.remove('drag-over'));
 const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.duty-cell,[data-drop-remove]');target?.classList.add('drag-over');
 const pane=document.querySelector('.plan-table');if(pane){const r=pane.getBoundingClientRect();if(event.clientX>=r.left&&event.clientX<=r.right){if(event.clientY>r.bottom-30&&event.clientY<r.bottom+20)pane.scrollTop+=16;else if(event.clientY<r.top+55&&event.clientY>r.top-20)pane.scrollTop-=16}}
});
app.addEventListener('pointerup',event=>{
 const drag=pointerDrag;if(!drag||drag.id!==event.pointerId)return;
 if(!drag.started){endPointerDrag();return}
 event.preventDefault();suppressClick=true;setTimeout(()=>{suppressClick=false},0);
 const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.duty-cell,[data-drop-remove]');endPointerDrag();
 try{if(!target)return;if(target.hasAttribute('data-drop-remove')){if(drag.assignmentId)commit(st=>{st.assignments=st.assignments.filter(a=>a.id!==drag.assignmentId)},'Nöbet aday listesine geri alındı')}else askAssignment(drag.personId,target.dataset.date,target.dataset.site,drag.assignmentId)}catch(error){toast(error.message)}
});
app.addEventListener('pointercancel',()=>{lastCandidateClick=null;endPointerDrag()});
app.addEventListener('click',event=>{if(suppressClick){lastCandidateClick=null;event.preventDefault();event.stopImmediatePropagation()}},true);
document.addEventListener('click',event=>{
 if(view!=='plan'||dlg.open||document.querySelector('#share-view')||suppressClick||pointerDrag?.started)return;
 const target=event.target;
 if(!(target instanceof Element)||target.closest('.plan-panel,[data-person],button,a,input,select,textarea,label,[contenteditable],[data-action]'))return;
 clearCandidateSelection();
});
app.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('duty-cell')){event.preventDefault();void handle('cell',event.target)}});
document.addEventListener('keydown',event=>{if(document.querySelector('#share-view'))return;const editable=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!editable&&!dlg.open){event.preventDefault();undo(event.shiftKey)}if(event.key==='Escape'&&!dlg.open){if(event.target.id==='candidate-search'){event.preventDefault();candidateSearch='';clearCandidateSelection();refreshCandidates()}else{clearCandidateSelection();render()}}});
dlg.addEventListener('close',()=>datePickerCleanup());
window.addEventListener('beforeprint',()=>{if(view==='plan'&&state?.months[month]&&!document.querySelector('#share-view'))openShareView(state,month)});
document.addEventListener('scroll',event=>{if(event.target instanceof Element&&event.target.matches('.content,.plan-table,.candidate-scroll')){clearTimeout(locationSaveTimer);locationSaveTimer=setTimeout(rememberLocation,150)}},true);
window.addEventListener('beforeunload',event=>{rememberLocation();if(pendingSave||saving||saveError||publishing){event.preventDefault();event.returnValue=''}});
window.addEventListener('pagehide',event=>{if(!event.persisted)plannerBridge.destroy()});
load();
