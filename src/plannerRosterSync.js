import {assistantDutyEnabled, assistantNameKey, validateAssistantRegistry} from './assistantIdentity.js';
import {groupRankAt, personDutyActive} from '../public/nobet-planlayici/person-history.js';
import {sourceSignature} from './sourceSyncSafety.js';
const copy=value=>structuredClone(value);
const monthValid=value=>typeof value==='string'&&/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** The master registry owns inclusion and names; existing planning IDs and every duty survive. */
export function synchronizePlannerRoster(draft,portal,{fromMonth,currentMonth}={}) {
  if(!monthValid(fromMonth)||!monthValid(currentMonth))throw new Error('Kişi eşleştirmesi için geçerli ay gerekir.');
  if(!object(draft)||!Array.isArray(draft.people)||!Array.isArray(draft.groups)||!Array.isArray(draft.assignments)||!object(portal)||!Array.isArray(portal.assistants)||portal.assistants.some(name=>typeof name!=='string'||!name.trim()))throw new Error('Ortak kişi listesi veya nöbet kaydı okunamadı.');
  const registry=portal.assistantRegistry;
  if(!registry||!Object.keys(registry).length)return{state:draft,changed:false,warnings:[]};
  const check=validateAssistantRegistry(registry);if(!check.valid)throw new Error(check.errors.join(' · '));
  const state=copy(draft),warnings=[],cutoffMonth=fromMonth>currentMonth?fromMonth:currentMonth,at=`${cutoffMonth}-01`;
  const sourceNames=new Map();
  for(const name of portal.assistants){const key=assistantNameKey(name);sourceNames.set(key,[...(sourceNames.get(key)??[]),name]);}
  const entries=Object.entries(registry).sort(([a],[b])=>a.localeCompare(b));
  const histories=new Map(entries.map(([id,entry])=>[id,(entry.dutyHistory?.length?entry.dutyHistory:[{from:cutoffMonth,enabled:!!entry.dutyEnabled}]).map(row=>({...row})).sort((a,b)=>a.from.localeCompare(b.from))]));
  const historyFor=(id,entry)=>{
    const history=histories.get(id);
    // Dated participation is authoritative even when an archive is scheduled for a future month.
    if(entry.dutyHistory?.length)return history;
    if(entry.archived||!sourceNames.has(assistantNameKey(entry.name)))return[{from:cutoffMonth,enabled:false}];
    return history;
  };
  const monthlyEnabled=(id,entry,month)=>assistantDutyEnabled({...entry,dutyHistory:historyFor(id,entry)},month);
  const sourceRank=entry=>{
    const names=sourceNames.get(assistantNameKey(entry.name))??[];
    const rank=names.length===1?portal.assistantRanks?.[names[0]]:undefined;
    return Number.isSafeInteger(rank)&&rank>=1?rank:null;
  };

  // Reserve every existing ID link before name fallback. Registry key order must never let
  // a newly reused old label steal a renamed person's existing planning identity.
  const reserved=new Map(), explicitByIdentity=new Map(), conflicts=new Set();
  for(const person of state.people){
    const claims=new Set(person.portalIdentityId?[person.portalIdentityId]:[]);
    for(const [id,entry]of entries)if(person.id===entry.plannerPersonId||person.id===id)claims.add(id);
    if(claims.size>1){for(const id of claims)conflicts.add(id);reserved.set(person.id,null);continue;}
    if(claims.size===1){const id=[...claims][0];reserved.set(person.id,id);explicitByIdentity.set(id,[...(explicitByIdentity.get(id)??[]),person]);}
  }
  const identityForPerson=person=>{
    const id=person.portalIdentityId??reserved.get(person.id);
    return id&&registry[id]?{id,entry:registry[id]}:null;
  };
  const groupEnabledAt=(group,month)=>{
    if(group.from>month)return false;
    if(!group.until||month<group.until)return true;
    return state.people.some(person=>{
      if(person.groupId!==group.id||person.from>`${month}-31`)return false;
      const identity=identityForPerson(person);
      return identity?monthlyEnabled(identity.id,identity.entry,month)===true:personDutyActive(person,`${month}-01`);
    });
  };
  const pickCohort=(rank,enabledFrom)=>{
    const groups=state.groups.filter(group=>groupEnabledAt(group,enabledFrom)).slice().sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    const ranked=groups.map((group,index)=>{
      const ranks=[];
      for(const person of state.people.filter(row=>row.groupId===group.id)){
        const identity=identityForPerson(person);
        if(!identity||person.from>`${enabledFrom}-31`||monthlyEnabled(identity.id,identity.entry,enabledFrom)!==true)continue;
        const value=sourceRank(identity.entry);if(value!==null)ranks.push(value);
      }
      const distinct=[...new Set(ranks)];
      return{group,source:distinct.length===1?distinct[0]:null,conflict:distinct.length>1,fallback:groupRankAt(group,enabledFrom,index+1)};
    });
    const matched=ranked.filter(row=>row.source===rank&&!row.conflict);
    if(matched.length)return{group:matched.length===1?matched[0].group:null,ambiguous:matched.length>1};
    const fallback=ranked.filter(row=>row.source===null&&!row.conflict&&row.fallback===rank);
    return{group:fallback.length===1?fallback[0].group:null,ambiguous:fallback.length>1};
  };

  const usedPeople=new Set();
  for(const [identityId,entry]of entries){
    if(conflicts.has(identityId)){warnings.push({code:'registry-conflicting-link',message:`${entry.name}: ortak kimlik mevcut kişi bağlantısıyla çelişiyor; otomatik işlem yapılmadı.`});continue;}
    const explicit=explicitByIdentity.get(identityId)??[];
    const byName=state.people.filter(person=>!reserved.has(person.id)&&!person.portalIdentityId&&!usedPeople.has(person.id)&&assistantNameKey(person.name)===assistantNameKey(entry.name));
    const matches=explicit.length?explicit:byName;
    if(matches.length>1){warnings.push({code:'registry-ambiguous',message:`${entry.name}: kişi kimliği tekil değil; otomatik işlem yapılmadı.`});continue;}
    let person=matches[0];
    const history=historyFor(identityId,entry);
    const enabledFrom=history.find(row=>row.enabled)?.from;
    if(!person){
      if(!enabledFrom||!sourceNames.has(assistantNameKey(entry.name)))continue;
      const rank=sourceRank(entry);
      if(rank===null){warnings.push({code:'registry-rank',message:`${entry.name}: nöbet programına eklemek için uygulamada kıdem seç.`});continue;}
      const selected=pickCohort(rank,enabledFrom);
      if(selected.ambiguous){warnings.push({code:'registry-cohort-ambiguous',message:`${entry.name}: aynı kıdem sırasına birden fazla hedef grubu bağlı; eklemeden önce grupları kontrol et.`});continue;}
      let group=selected.group;
      if(!group){group={id:`portal-cohort:${identityId}`,order:Math.max(0,...state.groups.map(item=>item.order))+1,from:enabledFrom,until:null,sourceCreated:true,rankHistory:[{from:enabledFrom,rank}]};state.groups.push(group);}
      person={id:entry.plannerPersonId??identityId,name:entry.name,groupId:group.id,from:`${enabledFrom}-01`,until:null,sourceCreated:true};
      if(state.people.some(item=>item.id===person.id)){warnings.push({code:'registry-id',message:`${entry.name}: kişi kimliği başka bir kayıtta kullanılıyor.`});continue;}
      state.people.push(person);
    }
    if(usedPeople.has(person.id)){warnings.push({code:'registry-duplicate-link',message:`${entry.name}: iki ortak kayıt aynı kişiye bağlı; ikinci kayıt atlandı.`});continue;}
    if(person.sourceCreated===true&&enabledFrom&&`${enabledFrom}-01`<person.from){
      person.from=`${enabledFrom}-01`;
      const cohort=state.groups.find(group=>group.id===person.groupId);
      if(cohort?.sourceCreated===true&&enabledFrom<cohort.from){
        const rank=groupRankAt(cohort,cohort.from,sourceRank(entry)??cohort.order);
        cohort.from=enabledFrom;
        cohort.rankHistory=[{from:enabledFrom,rank},...(cohort.rankHistory??[]).filter(row=>row.from>enabledFrom)];
      }
    }
    usedPeople.add(person.id);reserved.set(person.id,identityId);person.portalIdentityId=identityId;person.name=entry.name;person.rosterHistory=history;
  }
  for(const person of state.people)if(!usedPeople.has(person.id)){
    const prior=(person.rosterHistory??[]).filter(row=>row.from<cutoffMonth);
    const hasCurrentOrFutureLife=!person.until||person.until>at;
    person.rosterHistory=[...prior,{from:cutoffMonth,enabled:false}];
    if(hasCurrentOrFutureLife||state.assignments.some(row=>row.personId===person.id&&row.date>=at))warnings.push({code:'registry-orphan',personId:person.id,month:cutoffMonth,message:`${person.name}: ortak kişi listesinde eşleşme yok; bu aydan itibaren nöbete dahil edilmedi. Geçmişi ve mevcut nöbetleri korundu; uygulamadan ekle veya eşleştir.`});
  }
  for(const person of state.people){
    const months=[...new Set(state.assignments.filter(row=>row.personId===person.id&&row.date.slice(0,7)>=fromMonth&&!personDutyActive(person,row.date)).map(row=>row.date.slice(0,7)))].sort();
    for(const month of months)warnings.push({code:'registry-existing-duties',personId:person.id,month,message:`${person.name}, ${month} ayında nöbete dahil değil; mevcut nöbetleri korunuyor. Yayınlamadan önce bu atamaları kontrol et.`});
  }
  state.portalSource={...(state.portalSource??{}),registryManaged:true};
  warnings.sort((a,b)=>(a.month??'').localeCompare(b.month??'')||(a.personId??'').localeCompare(b.personId??'')||a.code.localeCompare(b.code)||a.message.localeCompare(b.message,'tr'));
  return{state,changed:sourceSignature(state)!==sourceSignature(draft),warnings};
}
