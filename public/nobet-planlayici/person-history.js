/** Display seniority follows the master app; stable cohorts keep their manual targets and clinical flags. */
const MONTH = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u;
const nameKey = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');

export function personGroupId(person, month) {
  let groupId = person?.groupId, latest = '';
  for (const entry of Array.isArray(person?.groupHistory) ? person.groupHistory : []) if (entry?.from <= month && entry.from >= latest) {
    latest = entry.from;groupId = entry.groupId;
  }
  return groupId;
}

/** null means the master registry has not taken ownership of this historical month. */
export function personRosterEnabled(person, month) {
  let result = null, latest = '';
  for (const entry of Array.isArray(person?.rosterHistory) ? person.rosterHistory : []) if (MONTH.test(entry?.from ?? '') && typeof entry.enabled === 'boolean' && entry.from <= month && entry.from >= latest) {
    latest = entry.from;result = entry.enabled;
  }
  return result;
}

export function personDutyActive(person, date) {
  if (!person || typeof date !== 'string' || person.from > date) return false;
  const enabled = personRosterEnabled(person, date.slice(0, 7));
  return enabled === null ? !person.until || date < person.until : enabled;
}

/** Explicit re-inclusion reopens a cohort only in that month and later, without rewriting past lifetime fields. */
export function groupActiveInMonth(state, group, month) {
  if (!group || !MONTH.test(month ?? '') || group.from > month) return false;
  if (!group.until || month < group.until) return true;
  const lastDate = new Date(`${month}-01T00:00:00Z`);lastDate.setUTCMonth(lastDate.getUTCMonth()+1,0);const last=lastDate.toISOString().slice(0,10);
  return (Array.isArray(state?.people) ? state.people : []).some(person => person?.groupId === group.id && person.from <= last && personRosterEnabled(person, month) === true);
}

export function groupRankAt(group, month, fallback = null) {
  let rank = fallback, latest = '';
  for (const entry of Array.isArray(group?.rankHistory) ? group.rankHistory : []) if (entry?.from <= month && entry.from >= latest) {
    latest = entry.from;rank = entry.rank;
  }
  return rank;
}

/** Detached display view. The original groupId remains the cohort/planning identity. */
export function personAtMonth(person, month) { return {...person,groupId:personGroupId(person,month)}; }

/**
 * Synchronize only a stable cohort's displayed rank. Targets and flags never migrate to the
 * numeric destination group. Conflicting individual ranks require a deliberate manual decision.
 */
export function synchronizePersonRanks(state, portalPlannerState, {fromMonth,currentMonth} = {}) {
  if (!MONTH.test(fromMonth ?? '') || !MONTH.test(currentMonth ?? '')) throw new RangeError('Kıdem eşleştirmesi için geçerli ay gerekir.');
  const month = fromMonth > currentMonth ? fromMonth : currentMonth, first = `${month}-01`;
  const lastDate = new Date(`${first}T00:00:00Z`);lastDate.setUTCMonth(lastDate.getUTCMonth()+1,0);const last=lastDate.toISOString().slice(0,10);
  const source = portalPlannerState ?? {}, portalNames = new Map();
  for (const name of Array.isArray(source.assistants) ? source.assistants : []) if (typeof name === 'string' && name.trim()) {
    const key=nameKey(name);portalNames.set(key,[...(portalNames.get(key) ?? []),name]);
  }
  const activeGroups=(state.groups ?? []).filter(group=>groupActiveInMonth(state,group,month)).slice().sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const groupsById=new Map(activeGroups.map(group=>[group.id,group]));
  const baseRanks=new Map(activeGroups.map((group,index)=>[group.id,index+1]));
  const eligible=(state.people ?? []).filter(person=>person.from<=last&&(personRosterEnabled(person,month)??(!person.until||first<person.until))&&groupsById.has(personGroupId(person,month)));
  const richNames=new Map();
  for(const person of eligible){const key=nameKey(person.name);richNames.set(key,[...(richNames.get(key)??[]),person.id]);}
  const warnings=[], proposed=new Map();
  for(const person of eligible){
    if(!groupsById.has(person.groupId)){
      warnings.push({code:'source-cohort-inactive',personId:person.id,message:`${person.name}: Hedef grubunun geçerliliği bitmiş; kıdem sırası otomatik değiştirilmedi.`});continue;
    }
    const matches=portalNames.get(nameKey(person.name))??[];
    if(matches.length!==1||richNames.get(nameKey(person.name))?.length!==1){warnings.push({code:'source-rank-name',personId:person.id,message:`${person.name}: Kıdem eşleştirmesi için Asistan sisteminde tek bir kayıt gerekir.`});continue;}
    const rank=source.assistantRanks?.[matches[0]];
    if(!Number.isSafeInteger(rank)||rank<1||rank>Math.max(activeGroups.length,portalNames.size)){warnings.push({code:'source-rank-missing',personId:person.id,message:`${person.name}: Asistan sistemindeki kıdem bilgisi eksik veya geçersiz.`});continue;}
    proposed.set(person.groupId,[...(proposed.get(person.groupId)??[]),{person,rank}]);
  }
  let changed=false;
  const accepted=new Map();
  for(const [groupId,rows]of proposed){
    const ranks=[...new Set(rows.map(row=>row.rank))];
    if(ranks.length!==1){warnings.push({code:'source-cohort-rank-conflict',groupId,message:`${rows.map(row=>row.person.name).join(', ')}: Aynı hedef grubunda farklı kıdem sıraları var. Hedefler ve işaretler korundu; kıdem grubu için manuel karar gerekir.`});continue;}
    accepted.set(groupId,ranks[0]);
  }
  const cohortsByRank=new Map();
  for(const [groupId,rank]of accepted)cohortsByRank.set(rank,[...(cohortsByRank.get(rank)??[]),groupId]);
  for(const [rank,groupIds]of cohortsByRank)if(groupIds.length>1){
    warnings.push({code:'source-cohort-rank-collision',message:`${rank}. kıdem sırasına birden fazla hedef grubu bağlı. Hedefler ve işaretler korundu; grupları birleştirmek için manuel karar gerekir.`});
    for(const groupId of groupIds)accepted.delete(groupId);
  }
  const groups=(state.groups??[]).map(group=>{
    if(!accepted.has(group.id))return group;
    const rank=accepted.get(group.id), before=(group.rankHistory??[]).filter(entry=>entry.from<month).slice().sort((a,b)=>a.from.localeCompare(b.from));
    const previousRank=before.at(-1)?.rank??baseRanks.get(group.id);
    const history=previousRank===rank?before:[...before,{from:month,rank}];
    if(JSON.stringify(history)===JSON.stringify(group.rankHistory??[]))return group;
    changed=true;const next={...group};if(history.length)next.rankHistory=history;else delete next.rankHistory;return next;
  });
  let peopleChanged=false;
  const people=(state.people??[]).map(person=>{
    if(!accepted.has(person.groupId))return person;
    // Older releases represented source rank as a person transfer. Retain earlier display
    // history, but restore the stable cohort from this month without changing any settings.
    const before=(person.groupHistory??[]).filter(entry=>entry.from<month).slice().sort((a,b)=>a.from.localeCompare(b.from));
    const history=(before.at(-1)?.groupId??person.groupId)===person.groupId?before:[...before,{from:month,groupId:person.groupId}];
    if(JSON.stringify(history)===JSON.stringify(person.groupHistory??[]))return person;
    changed=true;peopleChanged=true;const next={...person};if(history.length)next.groupHistory=history;else delete next.groupHistory;return next;
  });
  return {state:changed?{...state,groups,people:peopleChanged?people:state.people}:state,changed,warnings};
}
