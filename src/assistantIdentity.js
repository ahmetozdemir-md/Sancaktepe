/** Stable identity for the shared staff registry. Labels and duty participation can change independently. */
export const assistantNameKey = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');
const validMonth = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u.test(value);
const cleanName = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const hash = value => {
  let result = 2166136261;
  for (const character of value) { result ^= character.codePointAt(0); result = Math.imul(result, 16777619) >>> 0; }
  return result.toString(36);
};
const index = (values, nameOf) => {
  const result = new Map();
  for (const value of values) { const key = assistantNameKey(nameOf(value)); result.set(key, [...(result.get(key) ?? []), value]); }
  return result;
};
const uniqueName = value => {
  const name = cleanName(value);
  if (!name || !/\p{L}/u.test(name) || name.includes('|') || name.length > 150) throw new Error('Geçerli ve ayırt edilebilir bir asistan adı yaz.');
  return name;
};

export function validateAssistantRegistry(value) {
  const errors = [];
  if (!object(value)) return {valid:false,errors:['Kişi kayıtları bir nesne olmalıdır.']};
  const names = new Set(), personIds = new Set();
  for (const [id, entry] of Object.entries(value)) {
    if (!id || id.length > 200 || !object(entry)) { errors.push('Kişi kimliği veya kaydı hatalı.'); continue; }
    if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push(`${id}: Ad boş olamaz.`);
    if (typeof entry.dutyEnabled !== 'boolean') errors.push(`${id}: Nöbete dahil seçimi gerekir.`);
    if (entry.archived !== undefined && typeof entry.archived !== 'boolean') errors.push(`${id}: Arşiv seçimi hatalı.`);
    if (entry.archived && entry.dutyEnabled) errors.push(`${id}: Arşivlenen kişi nöbete dahil olamaz.`);
    if (entry.plannerPersonId !== undefined && (typeof entry.plannerPersonId !== 'string' || !entry.plannerPersonId)) errors.push(`${id}: Bağlı nöbet kişi kimliği hatalı.`);
    if (entry.dutyHistory !== undefined) {
      if (!Array.isArray(entry.dutyHistory)) errors.push(`${id}: Nöbet katılım geçmişi liste olmalıdır.`);
      else {
        let previous = '';
        for (const item of entry.dutyHistory) {
          if (!object(item) || !validMonth(item.from) || typeof item.enabled !== 'boolean' || item.from <= previous) errors.push(`${id}: Nöbet katılım ayları geçerli, tekil ve sıralı olmalıdır.`);
          previous = item?.from ?? previous;
        }
      }
    }
    if (entry.aliases !== undefined && (!Array.isArray(entry.aliases) || entry.aliases.some(name => typeof name !== 'string' || !name.trim()))) errors.push(`${id}: Önceki adlar hatalı.`);
    const name = assistantNameKey(entry.name);
    if (names.has(name)) errors.push(`${entry.name}: Aynı isim birden fazla kişiye bağlı.`);
    names.add(name);
    if (entry.plannerPersonId) {
      if (personIds.has(entry.plannerPersonId)) errors.push(`${entry.name}: Nöbet kişi kimliği iki kez bağlı.`);
      personIds.add(entry.plannerPersonId);
    }
  }
  return {valid:errors.length === 0,errors};
}

/** Seed legacy names once. A new master record starts excluded until an admin includes it. */
export function ensureAssistantRegistry(assistants, supplied = {}, plannerPeople = [], month) {
  if (!Array.isArray(assistants) || assistants.some(name => typeof name !== 'string' || !name.trim())) throw new Error('Uygulamanın kişi listesi okunamadı.');
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u.test(month ?? '')) throw new Error('Kişi eşleşmesi için geçerli ay gerekir.');
  const registry = object(supplied) ? clone(supplied) : {};
  const validation = validateAssistantRegistry(registry);
  if (!validation.valid) throw new Error(validation.errors.join(' · '));
  const sourceNames = index(assistants, name => name), registryNames = index(Object.entries(registry), ([, entry]) => entry.name), richNames = index(plannerPeople, person => person.name);
  const first = `${month}-01`, lastDate = new Date(`${first}T00:00:00Z`);lastDate.setUTCMonth(lastDate.getUTCMonth()+1,0);const last=lastDate.toISOString().slice(0,10);
  const warnings = [], linkedPersonIds = new Set(Object.values(registry).map(entry=>entry.plannerPersonId).filter(Boolean));
  for (const [key, names] of sourceNames) {
    if (names.length !== 1) { warnings.push({code:'ambiguous-master-name',message:`${names[0]}: Uygulamada aynı isim birden fazla kez var; eşleşme yapılmadı.`}); continue; }
    const existing = registryNames.get(key) ?? [];
    if (existing.length === 1) {
      const entry=existing[0][1];entry.name=cleanName(names[0]);
      if (!Array.isArray(entry.dutyHistory) || !entry.dutyHistory.length) entry.dutyHistory=[{from:month,enabled:entry.archived?false:entry.dutyEnabled}];
      continue;
    }
    const matches = richNames.get(key) ?? [];
    const person = matches.length === 1 && !linkedPersonIds.has(matches[0].id) ? matches[0] : null;
    if (matches.length === 1 && !person) warnings.push({code:'already-linked-planner-person',message:`${names[0]}: Mevcut nöbet kaydı başka bir ortak kimliğe bağlı; ikinci kez bağlanmadı.`});
    if (matches.length > 1) warnings.push({code:'ambiguous-planner-name',message:`${names[0]}: Nöbet programında aynı isim birden fazla kişiye ait; otomatik bağlanmadı.`});
    const preferred = person?.id ?? `assistant-${hash(key)}`;
    let id = preferred;
    for (let suffix = 2; Object.hasOwn(registry, id); suffix++) id = `${preferred}-${suffix}`;
    const included = !!person && person.from <= last && (!person.until || person.until > first);
    registry[id] = {
      name: cleanName(names[0]),
      dutyEnabled: included,
      dutyHistory: [{from:month,enabled:included}],
      archived: false,
      ...(person ? {plannerPersonId:person.id} : {}),
    };
    if(person)linkedPersonIds.add(person.id);
  }
  for (const [id,entry] of Object.entries(registry)) if (!sourceNames.has(assistantNameKey(entry.name))) {
    registry[id]=setAssistantArchived(registry,id,true,month)[id];
  }
  return {registry,changed:JSON.stringify(registry)!==JSON.stringify(supplied),warnings};
}

export function assistantDutyEnabled(entry, month) {
  if (!entry || !validMonth(month)) return null;
  const history = Array.isArray(entry.dutyHistory) ? entry.dutyHistory : [];
  if (!history.length) return typeof entry.dutyEnabled === 'boolean' ? entry.archived ? false : entry.dutyEnabled : null;
  const latest = history.filter(item=>item.from<=month).reduce((result,item)=>!result||item.from>result.from?item:result,null);
  return latest ? latest.enabled : null;
}

export function setAssistantDutyEnabled(registry, id, enabled, month) {
  if (!registry[id]) throw new Error('Kişi kaydı bulunamadı.');
  if (typeof enabled !== 'boolean') throw new Error('Nöbete dahil seçimi geçerli değil.');
  if (registry[id].archived && enabled) throw new Error('Önce kişiyi uygulamanın aktif listesine geri al.');
  if (month !== undefined && !validMonth(month)) throw new Error('Nöbet katılımı için geçerli başlangıç ayı gerekir.');
  const entry = {...registry[id]};
  const effectiveMonth = month ?? entry.dutyHistory?.at(-1)?.from;
  if (effectiveMonth) {
    entry.dutyHistory = [...(entry.dutyHistory ?? []).filter(item=>item.from!==effectiveMonth),{from:effectiveMonth,enabled}].sort((a,b)=>a.from.localeCompare(b.from));
    entry.dutyEnabled = entry.dutyHistory.at(-1).enabled;
  } else entry.dutyEnabled = enabled;
  return {...registry,[id]:entry};
}

export function setAssistantArchived(registry,id,archived,month) {
  if (!registry[id] || typeof archived !== 'boolean') throw new Error('Arşivlenecek kişi veya arşiv seçimi geçerli değil.');
  if (archived) {
    const entry={...registry[id],archived:false};
    if (month && Array.isArray(entry.dutyHistory)) entry.dutyHistory=entry.dutyHistory.filter(item=>item.from<month);
    const updated=setAssistantDutyEnabled({...registry,[id]:entry},id,false,month);
    return {...updated,[id]:{...updated[id],archived:true}};
  }
  return {...registry,[id]:{...registry[id],archived:false}};
}

export function assistantIdentityForName(registry, name) {
  const matches = Object.entries(registry ?? {}).filter(([,entry]) => assistantNameKey(entry.name) === assistantNameKey(name));
  return matches.length === 1 ? {id:matches[0][0],...matches[0][1]} : null;
}

/** Rename explicit name-based roster fields only. Free-text notes and unrelated specialist fields stay untouched. */
export function renameAssistantInPlanner(planner, id, requestedName) {
  const registry = planner.assistantRegistry ?? {}, entry = registry[id];
  if (!entry) throw new Error('Kişi kaydı bulunamadı.');
  const name = uniqueName(requestedName), oldName = entry.name, oldKey = assistantNameKey(oldName), newKey = assistantNameKey(name);
  if (Object.entries(registry).some(([key,record]) => key !== id && assistantNameKey(record.name) === newKey)
    || (planner.assistants ?? []).some(value => assistantNameKey(value) === newKey && assistantNameKey(value) !== oldKey)) throw new Error('Bu ad başka bir kişiye ait. Ayırt eden tam adı kullan.');
  const next = clone(planner), replace = value => assistantNameKey(value) === oldKey ? name : value;
  const names = values => Array.isArray(values) ? values.map(replace) : values;
  const buckets = record => Object.fromEntries(Object.entries(record ?? {}).map(([key,values]) => [key,names(values)]));
  const nested = record => Object.fromEntries(Object.entries(record ?? {}).map(([key,values]) => [key,buckets(values)]));
  next.assistants = names(next.assistants);
  next.assistantRanks = Object.fromEntries(Object.entries(next.assistantRanks ?? {}).map(([key,value])=>[replace(key),value]));
  if (next.locationOwners) next.locationOwners = buckets(next.locationOwners);
  for (const key of ['locationOwnersByMonth','manualAssignments','rotatorAssignments']) if (next[key]) next[key] = nested(next[key]);
  for (const key of ['postDutyPoolByMonth','rotatorRoster']) if (next[key]) next[key] = buckets(next[key]);
  if (next.dutyRoster) next.dutyRoster = Object.fromEntries(Object.entries(next.dutyRoster).map(([date,rows])=>[date,rows.map(row=>({...row,name:replace(row.name)}))]));
  next.assistantRegistry[id] = {...entry,name,aliases:[...new Set([...(entry.aliases ?? []),oldName])].filter(value=>assistantNameKey(value)!==newKey)};
  return next;
}

export function renameAssistantBindings(bindings, previousName, nextName) {
  const key = assistantNameKey(previousName);
  return Object.fromEntries(Object.entries(bindings ?? {}).map(([id,name])=>[id,assistantNameKey(name)===key?cleanName(nextName):name]));
}
