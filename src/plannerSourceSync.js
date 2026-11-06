/** Read-only Asistan master data projected into the rich planner's existing identities. */
import { normalizePublicationName } from './month-publication.js';
import { personGroupId, personDutyActive, groupActiveInMonth } from '../public/nobet-planlayici/person-history.js';
import { assistantDutyEnabled, validateAssistantRegistry } from './assistantIdentity.js';
import { isPostCallUnit } from '../public/nobet-planlayici/rotations.js';

const SITES = new Set(['Sancaktepe', 'Feriha Öz', 'Çekmeköy']);
const SOURCE = 'asistan-portal';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(value) && !value.startsWith('0000');
const date = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const day = (value, amount) => new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const cleanName = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
const signature = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function bounds(value) {
  const start = `${value}-01`, parsed = new Date(`${start}T00:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + 1, 0);
  return { start, end: parsed.toISOString().slice(0, 10) };
}
function datesIn(range) {
  const result = [];
  for (let selectedDay = range.start; ; selectedDay = day(selectedDay, 1)) {
    result.push(selectedDay);
    if (selectedDay === range.end) return result;
  }
}
function indexNames(rows, nameOf) {
  const result = new Map();
  for (const row of rows) {
    const key = normalizePublicationName(nameOf(row));
    result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}
function mergedRanges(ranges) {
  const result = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = result.at(-1);
    if (last && range.start <= day(last.end, 1)) last.end = last.end > range.end ? last.end : range.end;
    else result.push({ ...range });
  }
  return result;
}
function subtractRanges(row, ranges) {
  let pieces = [{ start: row.start, end: row.end }];
  for (const range of ranges) pieces = pieces.flatMap(piece => {
    if (piece.end < range.start || piece.start > range.end) return [piece];
    const result = [];
    if (piece.start < range.start) result.push({ start: piece.start, end: day(range.start, -1) });
    if (piece.end > range.end) result.push({ start: day(range.end, 1), end: piece.end });
    return result;
  });
  return pieces.map((piece, index) => ({ ...row, ...piece, id: index === 0 ? row.id : `${row.id}~${piece.start}` }));
}
function activeOnDay(person, groups, selectedDay, state) {
  const selectedMonth = selectedDay.slice(0, 7), group = groups.get(personGroupId(person, selectedMonth));
  return personDutyActive(person, selectedDay) && !!group && groupActiveInMonth(state, group, selectedMonth);
}

/**
 * Keeps existing person IDs, membership, lifetimes and every scheduling record. Only names,
 * current/future rotation projections and source metadata change. No implicit month carryover.
 */
export function synchronizePlannerSource(draft, portal, options) {
  if (!object(draft) || !Array.isArray(draft.people) || !Array.isArray(draft.groups)
    || !Array.isArray(draft.rotations) || !object(draft.months)) throw new TypeError('Nöbet taslağının kişi ve rotasyon kayıtları okunamadı.');
  if (!object(portal) || !Array.isArray(portal.assistants) || !portal.assistants.every(text)
    || !Array.isArray(portal.locations)) throw new TypeError('Asistan uygulamasının kişi ve çalışma alanları okunamadı.');
  if (!object(options) || !month(options.fromMonth) || !month(options.currentMonth)
    || !['preserve-active', 'portal-all'].includes(options.rosterPolicy)) throw new TypeError('Eşleştirme ayı veya kişi politikası geçerli değil.');
  const state = structuredClone(draft), warnings = [], warningKeys = new Set();
  const warn = (code, message, details = {}) => {
    const item = { code, message, ...details }, key = signature(item);
    if (!warningKeys.has(key)) { warningKeys.add(key); warnings.push(item); }
  };
  const cutoffMonth = options.fromMonth;
  const cutoff = `${cutoffMonth}-01`;
  const ownersByMonth = object(portal.locationOwnersByMonth) ? portal.locationOwnersByMonth : {};
  const poolByMonth = object(portal.postDutyPoolByMonth) ? portal.postDutyPoolByMonth : {};
  const sourceMonths = [...new Set([...Object.keys(ownersByMonth), ...Object.keys(poolByMonth)])]
    .filter(value => month(value) && value >= cutoffMonth).sort();
  const managedMonths = [...new Set([...Object.keys(state.months), ...sourceMonths])]
    .filter(value => month(value) && value >= cutoffMonth).sort();
  const replaceRanges = mergedRanges(managedMonths.map(bounds));
  const portalNames = indexNames(portal.assistants, value => value), groups = new Map(state.groups.map(group => [group.id, group]));
  const registry = portal.assistantRegistry ?? {};
  if (portal.assistantRegistry !== undefined) {
    const valid = validateAssistantRegistry(registry);
    if (!valid.valid) throw new TypeError(valid.errors.join(' · '));
  }
  const identitiesByName = indexNames(Object.entries(registry), ([, entry]) => entry.name);
  const linked = new Map(), reserved = new Map();
  for (const person of state.people) {
    if (Object.keys(registry).length && person.portalIdentityId) reserved.set(person.id, person.portalIdentityId);
    for (const [identityId, entry] of Object.entries(registry)) if (person.id === identityId || person.id === entry.plannerPersonId) {
      const previous = reserved.get(person.id);
      reserved.set(person.id, reserved.has(person.id) && previous !== identityId ? false : identityId);
    }
  }
  for (const [identityId, entry] of Object.entries(registry)) {
    const candidates = state.people.filter(person => reserved.get(person.id) === identityId);
    linked.set(identityId, candidates);
    const sourceNames = portalNames.get(normalizePublicationName(entry.name)) ?? [];
    if (candidates.length === 1 && sourceNames.length === 1) candidates[0].name = cleanName(sourceNames[0]);
  }
  const draftNames = indexNames(state.people, value => value.name);
  const activeInMonth = (person, selectedMonth) => datesIn(bounds(selectedMonth)).some(selectedDay => activeOnDay(person, groups, selectedDay, state));
  for (const [key, people] of draftNames) {
    const names = portalNames.get(key) ?? [];
    if (!names.length) for (const person of people) {
      if (managedMonths.some(selectedMonth => activeInMonth(person, selectedMonth))) warn('missing-source-person', `${person.name}: uygulamanın kişi listesinde aynı adla bulunamadı. İsim değiştiyse mevcut kişiyle eşleştirilmesi gerekiyor; otomatik tahmin yapılmadı.`, { personId: person.id });
    }
    if (people.length === 1 && names.length === 1 && !reserved.has(people[0].id)) people[0].name = cleanName(names[0]);
  }
  const resolved = new Map();
  const resolve = (name, selectedMonth) => {
    if (!text(name)) { warn('invalid-source-person', `${selectedMonth}: rotasyonda geçerli bir asistan adı yok.`, { month: selectedMonth }); return null; }
    const key = normalizePublicationName(name), cacheKey = `${selectedMonth}:${key}`;
    if (resolved.has(cacheKey)) return resolved.get(cacheKey);
    const finish = value => { resolved.set(cacheKey, value); return value; };
    const names = portalNames.get(key) ?? [];
    if (names.length !== 1) {
      warn(names.length ? 'ambiguous-person' : 'unknown-source-person', `${selectedMonth}: ${cleanName(name)} uygulamanın kişi listesinde tekil olarak bulunamadı; rotasyonu alınmadı.`, { month: selectedMonth });
      return finish(null);
    }
    const identities = identitiesByName.get(key) ?? [];
    if (identities.length > 1) {
      warn('ambiguous-person', `${selectedMonth}: ${names[0]} birden fazla ortak kimliğe bağlı; rotasyonu alınmadı.`, { month: selectedMonth });return finish(null);
    }
    if (identities.length === 1) {
      const [identityId, entry] = identities[0];
      if (assistantDutyEnabled(entry, selectedMonth) === false) return finish(null);
      const exact = linked.get(identityId) ?? [];
      if (exact.length > 1) { warn('ambiguous-person', `${names[0]}: ortak kimlik birden fazla nöbet kişisine bağlı; rotasyonu alınmadı.`, { month: selectedMonth });return finish(null); }
      if (exact.length === 1) return finish(activeInMonth(exact[0], selectedMonth) ? exact[0] : null);
      // A name is only a legacy bridge for an otherwise unbound, uniquely active person.
      const fallback = (draftNames.get(key) ?? []).filter(person => !reserved.has(person.id) && activeInMonth(person, selectedMonth));
      if (fallback.length === 1) { fallback[0].name = cleanName(names[0]);return finish(fallback[0]); }
      if (fallback.length > 1) warn('ambiguous-person', `${names[0]}: aynı ayda birden fazla aktif nöbet kişisine karşılık geliyor; rotasyonu alınmadı.`, { month: selectedMonth });
      else if (assistantDutyEnabled(entry, selectedMonth) === true) warn('unlinked-source-person', `${names[0]}: ortak kişi kaydı nöbet kişisiyle eşleşmedi; rotasyonu alınmadı.`, { month: selectedMonth });
      return finish(null);
    }
    const fallback = (draftNames.get(key) ?? []).filter(person => !reserved.has(person.id) && activeInMonth(person, selectedMonth));
    if (fallback.length === 1) { fallback[0].name = cleanName(names[0]);return finish(fallback[0]); }
    if (fallback.length > 1) warn('ambiguous-person', `${names[0]}: aynı ayda birden fazla aktif nöbet kişisine karşılık geliyor; rotasyonu alınmadı.`, { month: selectedMonth });
    return finish(null);
  };
  const locationsById = new Map();
  for (const location of portal.locations.filter(object)) locationsById.set(location.id, [...(locationsById.get(location.id) ?? []), location]);
  const generated = [];
  for (const selectedMonth of sourceMonths) {
    const range = bounds(selectedMonth), claimsByPerson = new Map();
    const addClaim = (person, claim) => {
      if (!person) return;
      claimsByPerson.set(person.id, [...(claimsByPerson.get(person.id) ?? []), claim]);
    };
    const owners = ownersByMonth[selectedMonth];
    if (owners !== undefined && !object(owners)) warn('invalid-source-month', `${selectedMonth}: aylık rotasyon kaydı okunamadı.`, { month: selectedMonth });
    for (const [locationId, names] of Object.entries(object(owners) ? owners : {})) {
      if (!Array.isArray(names)) { warn('invalid-source-owners', `${selectedMonth}: ${locationId} asistan listesi okunamadı.`, { month: selectedMonth }); continue; }
      if (!names.length) continue;
      const locations = locationsById.get(locationId) ?? [];
      if (locations.length !== 1) { warn('unknown-source-location', `${selectedMonth}: ${locationId} çalışma alanı tekil olarak bulunamadı.`, { month: selectedMonth }); continue; }
      const location = locations[0];
      if (location.kind !== 'normal') continue;
      if (!SITES.has(location.site) || !text(location.name) || isPostCallUnit(location.name)) { warn('invalid-source-location', `${selectedMonth}: ${locationId} için hastane veya birim geçerli değil.`, { month: selectedMonth }); continue; }
      if ((location.activeFrom != null && !date(location.activeFrom)) || (location.activeUntil != null && !date(location.activeUntil))) {
        warn('invalid-source-location', `${selectedMonth}: ${locationId} geçerlilik tarihleri okunamadı.`, { month: selectedMonth }); continue;
      }
      const start = location.activeFrom && location.activeFrom > range.start ? location.activeFrom : range.start;
      const end = location.activeUntil && location.activeUntil <= range.end ? day(location.activeUntil, -1) : range.end;
      if (start > end) continue;
      for (const name of names) addClaim(resolve(name, selectedMonth), { start, end, site: location.site, unit: cleanName(location.name), locationId });
    }
    const pool = poolByMonth[selectedMonth];
    if (pool !== undefined && !Array.isArray(pool)) warn('invalid-source-pool', `${selectedMonth}: nöbet ertesi havuzu okunamadı.`, { month: selectedMonth });
    for (const name of Array.isArray(pool) ? pool : []) addClaim(resolve(name, selectedMonth), { ...range, site: null, unit: 'Nöbet ertesi', locationId: null });
    for (const person of state.people) {
      const claims = claimsByPerson.get(person.id) ?? [], segments = [], conflicts = [];
      for (const selectedDay of datesIn(range)) {
        if (!activeOnDay(person, groups, selectedDay, state)) continue;
        const active = claims.filter(claim => claim.start <= selectedDay && selectedDay <= claim.end);
        if (!active.length) continue;
        const sites = [...new Set(active.map(claim => claim.site))];
        if (sites.length > 1) {
          const conflictKey = signature([...sites].sort()), last = conflicts.at(-1);
          if (last?.key === conflictKey && day(last.end, 1) === selectedDay) last.end = selectedDay;
          else conflicts.push({ key: conflictKey, start: selectedDay, end: selectedDay, sites });
          continue;
        }
        const units = [...new Set(active.map(claim => claim.unit))].sort((a, b) => a.localeCompare(b, 'tr'));
        const locationIds = [...new Set(active.map(claim => claim.locationId).filter(Boolean))].sort();
        const value = { site: sites[0], unit: units.join(' · '), sourceLocationIds: locationIds };
        const last = segments.at(-1), valueKey = signature(value);
        if (last?.key === valueKey && day(last.end, 1) === selectedDay) last.end = selectedDay;
        else segments.push({ key: valueKey, start: selectedDay, end: selectedDay, ...value });
      }
      for (const conflict of conflicts) warn('rotation-conflict', `${person.name}: ${conflict.start}–${conflict.end} için birden fazla hastane veya nöbet ertesi rotasyonu var; bu günler boş bırakıldı.`, { personId: person.id, month: selectedMonth, start: conflict.start, end: conflict.end });
      for (const segment of segments) {
        const { key: _key, ...record } = segment;
        generated.push({ id: `portal-rotation:${encodeURIComponent(person.id)}:${segment.start}:${segment.end}`, personId: person.id, ...record, source: SOURCE, sourceMonth: selectedMonth });
      }
    }
  }
  const retained = state.rotations.flatMap(row => {
    const ranges = row.source === SOURCE ? [{ start: cutoff, end: '9999-12-31' }] : replaceRanges;
    return subtractRanges(row, ranges);
  });
  generated.sort((a, b) => a.start.localeCompare(b.start) || a.personId.localeCompare(b.personId) || a.end.localeCompare(b.end));
  state.rotations = [...retained, ...generated];
  state.portalSource = { ...(object(state.portalSource) ? state.portalSource : {}), version: 1, fromMonth: options.fromMonth, rosterPolicy: options.rosterPolicy };
  warnings.sort((a,b)=>(a.month??'').localeCompare(b.month??'')||(a.personId??'').localeCompare(b.personId??'')||a.code.localeCompare(b.code)||(a.start??'').localeCompare(b.start??'')||a.message.localeCompare(b.message,'tr'));
  return { state, changed: signature(state) !== signature(draft), warnings };
}
