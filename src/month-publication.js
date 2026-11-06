/** Pure adapter from the rich duty-planner draft to the published Asistan roster. */
import { personGroupId, personDutyActive, groupActiveInMonth } from '../public/nobet-planlayici/person-history.js';
const SITES = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];
const DAY = 86400000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
export const normalizePublicationName = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');
const validDate = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const addDays = (date, amount) => new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
const copy = value => structuredClone(value);
// jsonb may return object keys in a different order after a cloud round trip.
const signature = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function monthDays(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(month) || month.startsWith('0000')) throw new RangeError('Geçerli bir yayın ayı seçin.');
  const dates = [];
  for (let date = `${month}-01`; date.startsWith(`${month}-`); date = addDays(date, 1)) dates.push(date);
  return dates;
}

function compareEntries(ranks = {}) {
  const rank = name => Number.isFinite(ranks[name]) && ranks[name] >= 1 ? Math.floor(ranks[name]) : 999;
  return (a, b) => SITES.indexOf(a.site) - SITES.indexOf(b.site) || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'tr');
}

function draftSnapshot(draft) {
  return copy({ people: draft.people, groups: draft.groups, assignments: draft.assignments, ...(Array.isArray(draft.absences) ? { absences: draft.absences } : {}) });
}

/** Only recorded removals with untouched daily placements can be offered back. */
export function getRestorableRoomAssignments(portal, nextDutyRoster, month, roomChanges = [], draft = null) {
  const locations = new Map((portal.locations ?? []).filter(object).map(row => [row.id, row]));
  const names = new Map();
  for (const name of portal.assistants ?? []) {
    const key = normalizePublicationName(name);
    names.set(key, [...(names.get(key) ?? []), name]);
  }
  const result = [], seen = new Set();
  for (const row of Array.isArray(roomChanges) ? roomChanges : []) {
    if (!object(row) || !text(row.id) || seen.has(row.id) || row.month !== month || row.invalidatedAt || row.restoredAt
      || !validDate(row.date) || !validDate(row.dutyDate) || addDays(row.dutyDate, 1) !== row.date
      || !row.dutyDate.startsWith(`${month}-`) || !text(row.name) || !text(row.locationId)
      || !Array.isArray(row.roomBefore) || !row.roomBefore.every(text) || !object(row.dayAfter)) continue;
    const location = locations.get(row.locationId), key = normalizePublicationName(row.name), currentNames = names.get(key) ?? [];
    const personIds = new Set((draft?.people ?? []).filter(person => normalizePublicationName(person.name) === key).map(person => person.id));
    if ((draft?.absences ?? []).some(absence => personIds.has(absence.personId) && ['annual', 'excused'].includes(absence.type) && absence.start <= row.date && absence.end >= row.date)) continue;
    const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
    if (currentNames.length !== 1 || location?.kind !== 'normal' || location.site !== row.site || weekday === 0 || weekday === 6
      || (location.activeFrom && (!validDate(location.activeFrom) || location.activeFrom > row.date))
      || (location.activeUntil && (!validDate(location.activeUntil) || location.activeUntil <= row.date))
      || !row.roomBefore.some(name => normalizePublicationName(name) === key)) continue;
    const currentDay = portal.manualAssignments[row.date];
    if (!object(currentDay) || signature(currentDay) !== signature(row.dayAfter)) continue;
    if (Object.values(currentDay).some(assigned => !Array.isArray(assigned) || !assigned.every(text)
      || assigned.some(name => normalizePublicationName(name) === key))) continue;
    if ([row.date, addDays(row.date, -1)].some(date => !Array.isArray(nextDutyRoster[date] ?? [])
      || (nextDutyRoster[date] ?? []).some(duty => normalizePublicationName(duty?.name) === key))) continue;
    seen.add(row.id);
    result.push({ id: row.id, date: row.date, dutyDate: row.dutyDate, name: currentNames[0], locationId: row.locationId,
      locationName: String(location.name ?? row.locationId), site: String(location.site ?? '') });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'tr') || a.locationId.localeCompare(b.locationId));
}

/**
 * No existing records are modified. Full validateState/auditMonth can run before this adapter;
 * passed audit warnings remain advisory. Errors here always prevent applyPublication.
 */
export function createPublicationPreview(draft, portal, month, options = {}) {
  const dates = monthDays(month), errors = [], warnings = [];
  const issue = (code, message, details = {}) => errors.push({ code, message, ...details });
  const result = {
    month, count: 0, changedDays: [], addedCount: 0, removedCount: 0,
    removedRoomAssignments: [], restorableRoomAssignments: [], restoredRoomAssignments: [], warnings, errors, canPublish: false, hasChanges: false,
    roomChangesSnapshot: copy(Array.isArray(options.roomChanges) ? options.roomChanges : []), restoreRoomChangeIds: [], recoverySignature: '',
    monthRoster: {}, nextDutyRoster: {}, nextManualAssignments: {},
    portalSignature: signature(portal), draftSignature: '', draftSnapshot: null,
  };
  if (!object(draft) || !Array.isArray(draft.people) || !Array.isArray(draft.groups) || !Array.isArray(draft.assignments)) {
    issue('invalid-draft', 'Nöbet taslağının kişi, kıdem ve nöbet listeleri okunamadı.');
    return result;
  }
  if (!object(portal) || !Array.isArray(portal.assistants) || !portal.assistants.every(text)
    || !object(portal.dutyRoster) || !object(portal.manualAssignments) || !Array.isArray(portal.locations)) {
    issue('invalid-portal', 'Asistan sisteminin kişi veya plan verileri okunamadı.');
    return result;
  }
  result.draftSnapshot = draftSnapshot(draft);
  result.draftSignature = signature(result.draftSnapshot);
  for (const warning of Array.isArray(options.warnings) ? options.warnings : []) if (object(warning) && text(warning.message)) {
    warnings.push({ code: text(warning.code) ? warning.code : 'audit', message: warning.message });
  }
  const portalNames = new Map();
  for (const name of portal.assistants) {
    const key = normalizePublicationName(name);
    portalNames.set(key, [...(portalNames.get(key) ?? []), name]);
  }
  const people = new Map(), groups = new Map();
  for (const person of draft.people) {
    if (!object(person) || !text(person.id) || !text(person.name) || people.has(person.id)) {
      issue('invalid-person', 'Taslakta eksik veya tekrarlanan kişi kimliği var.'); continue;
    }
    people.set(person.id, person);
  }
  for (const group of draft.groups) {
    if (!object(group) || !text(group.id) || groups.has(group.id)) {
      issue('invalid-group', 'Taslakta eksik veya tekrarlanan kıdem kimliği var.'); continue;
    }
    groups.set(group.id, group);
  }
  const selected = [];
  for (const assignment of draft.assignments) {
    if (!object(assignment) || typeof assignment.date !== 'string') {
      issue('invalid-assignment', 'Taslakta geçerli tarihi olmayan nöbet kaydı var.'); continue;
    }
    if (!assignment.date.startsWith(`${month}-`)) continue;
    selected.push(assignment);
  }
  const compare = compareEntries(portal.assistantRanks), byDate = new Map(dates.map(date => [date, []]));
  const personDates = new Set(), selectedNameIds = new Map();
  for (const assignment of selected) {
    const { date, personId, site } = assignment;
    if (!validDate(date) || !byDate.has(date) || !SITES.includes(site)) {
      issue('invalid-assignment', 'Nöbetin tarihi veya hastanesi geçerli değil.', { date, personId }); continue;
    }
    const person = people.get(personId), group = person && groups.get(personGroupId(person, month));
    if (!person || !group || !validDate(person.from) || !personDutyActive(person, date)
      || (person.until != null && !validDate(person.until))
      || typeof group.from !== 'string' || !groupActiveInMonth(draft, group, month)) {
      issue('inactive-person', `${person?.name ?? personId ?? 'Bilinmeyen kişi'} bu nöbet tarihinde aktif değil.`, { date, personId }); continue;
    }
    const key = normalizePublicationName(person.name), names = portalNames.get(key) ?? [];
    if (names.length !== 1) {
      issue(names.length ? 'ambiguous-name' : 'unknown-name', names.length
        ? `${person.name}: Asistan sisteminde bu isim birden fazla kişiye karşılık geliyor.`
        : `${person.name}: Asistan sisteminde eşleşen kişi bulunamadı.`, { date, personId }); continue;
    }
    const mappedId = selectedNameIds.get(key);
    if (mappedId && mappedId !== personId) {
      issue('ambiguous-draft-name', `${person.name}: Taslakta aynı isimli iki farklı kişi var.`, { date, personId }); continue;
    }
    selectedNameIds.set(key, personId);
    const personDate = `${personId}:${date}`;
    if (personDates.has(personDate)) {
      issue('duplicate-duty', `${person.name}, ${date} tarihinde iki kez nöbetçi olamaz.`, { date, personId }); continue;
    }
    personDates.add(personDate);
    byDate.get(date).push({ name: names[0], site });
  }
  for (const [date, entries] of byDate) result.monthRoster[date] = entries.sort(compare);
  result.count = selected.length;
  result.nextDutyRoster = copy(portal.dutyRoster);
  for (const date of Object.keys(result.nextDutyRoster)) if (date.startsWith(`${month}-`)) {
    if (!byDate.has(date)) issue('invalid-published-date', `${date}: Mevcut yayımlanmış nöbet tarihi geçerli değil.`, { date });
    delete result.nextDutyRoster[date];
  }
  Object.assign(result.nextDutyRoster, copy(result.monthRoster));
  const entryKeys = entries => new Set(entries.map(entry => `${normalizePublicationName(entry.name)}\u0000${entry.site}`));
  for (const date of dates) {
    const before = portal.dutyRoster[date] ?? [], after = result.monthRoster[date];
    if (!Array.isArray(before) || !before.every(entry => object(entry) && text(entry.name) && SITES.includes(entry.site))) {
      issue('invalid-published-duty', `${date}: Mevcut yayımlanmış nöbet kaydı okunamadı.`, { date }); continue;
    }
    const previousKeys = entryKeys(before), nextKeys = entryKeys(after);
    if (previousKeys.size !== nextKeys.size || [...previousKeys].some(key => !nextKeys.has(key))) result.changedDays.push(date);
    result.addedCount += [...nextKeys].filter(key => !previousKeys.has(key)).length;
    result.removedCount += [...previousKeys].filter(key => !nextKeys.has(key)).length;
    for (const entry of after) for (const adjacent of [addDays(date, -1), addDays(date, 1)]) {
      const neighboring = result.nextDutyRoster[adjacent] ?? [];
      if (!Array.isArray(neighboring) || !neighboring.every(other => object(other) && text(other.name) && SITES.includes(other.site))) {
        issue('invalid-published-duty', `${adjacent}: Komşu ayın yayımlanmış nöbet kaydı okunamadı.`, { date: adjacent }); continue;
      }
      if (Array.isArray(neighboring) && neighboring.some(other => normalizePublicationName(other?.name) === normalizePublicationName(entry.name))) {
        // One report for an interior pair; boundary pairs still report from their selected-month date.
        if (!adjacent.startsWith(`${month}-`) || adjacent > date) issue('consecutive-duty', `${entry.name}: ${date} ile ${adjacent} ardışık günlerine nöbet yazılamaz.`, { date });
      }
    }
  }
  const locations = new Map(portal.locations.filter(object).map(location => [location.id, location]));
  for (const [date, entries] of Object.entries(result.monthRoster)) for (const entry of entries) {
    for (const [locationId, names] of Object.entries(portal.manualAssignments[date] ?? {})) {
      const location = locations.get(locationId);
      if (location?.kind === 'leave' && Array.isArray(names) && names.some(name => normalizePublicationName(name) === normalizePublicationName(entry.name))) {
        warnings.push({ code: 'portal-leave', message: `${entry.name}, ${date} tarihinde Asistan sisteminde ${location.name ?? 'izin/rotasyon'} olarak görünüyor.` });
      }
    }
  }
  result.nextManualAssignments = copy(portal.manualAssignments);
  for (const dutyDate of dates) {
    const date = addDays(dutyDate, 1), manual = result.nextManualAssignments[date];
    if (manual === undefined) continue;
    if (!object(manual)) { issue('invalid-room-assignments', `${date}: Çalışma yeri atamaları okunamadı.`, { date }); continue; }
    const postDutyNames = new Set((result.monthRoster[dutyDate] ?? []).map(entry => normalizePublicationName(entry.name)));
    for (const [locationId, names] of Object.entries(manual)) {
      const location = locations.get(locationId);
      if (location?.kind !== 'normal') continue;
      if (!Array.isArray(names) || !names.every(text)) { issue('invalid-room-assignments', `${date}: Çalışma yeri atamaları okunamadı.`, { date }); continue; }
      const removed = new Set(names.filter(name => postDutyNames.has(normalizePublicationName(name))));
      if (!removed.size) continue;
      manual[locationId] = names.filter(name => !removed.has(name));
      for (const name of removed) result.removedRoomAssignments.push({
        date, dutyDate, name, locationId, locationName: String(location.name ?? locationId), site: String(location.site ?? ''),
      });
    }
  }
  result.restorableRoomAssignments = getRestorableRoomAssignments(portal, result.nextDutyRoster, month, result.roomChangesSnapshot, draft);
  const restoreIds = options.restoreRoomChangeIds ?? [];
  if (!Array.isArray(restoreIds) || !restoreIds.every(text) || new Set(restoreIds).size !== restoreIds.length) {
    issue('invalid-room-restoration', 'Geri konulacak çalışma atamalarını yeniden seçin.');
  } else {
    const available = new Map(result.restorableRoomAssignments.map(row => [row.id, row])), chosenDates = new Set();
    for (const id of restoreIds) {
      const row = available.get(id);
      if (!row) { issue('invalid-room-restoration', 'Eski çalışma ataması artık güvenli biçimde geri konulamıyor. Önizlemeyi yenileyin.'); continue; }
      const key = `${row.date}:${normalizePublicationName(row.name)}`;
      if (chosenDates.has(key)) { issue('duplicate-room-restoration', `${row.name}: ${row.date} için yalnız bir çalışma yeri seçilebilir.`); continue; }
      chosenDates.add(key);
      result.restoreRoomChangeIds.push(id);
      const day = result.nextManualAssignments[row.date] ??= {};
      day[row.locationId] = [...(day[row.locationId] ?? []), row.name];
      result.restoredRoomAssignments.push(row);
    }
  }
  result.recoverySignature = signature({ roomChanges: result.roomChangesSnapshot, restoreIds: result.restoreRoomChangeIds });
  if (!selected.length && result.removedCount) warnings.push({ code: 'empty-month', message: 'Taslak boş: seçili ayın yayımlanmış nöbetleri temizlenecek.' });
  result.hasChanges = result.changedDays.length > 0 || result.removedRoomAssignments.length > 0 || result.restoredRoomAssignments.length > 0;
  result.canPublish = errors.length === 0;
  return result;
}

/** Apply only the confirmed snapshot; refuse any intervening portal changes. */
export function applyPublication(portal, preview, currentDraft = null) {
  if (!preview?.canPublish || preview.errors?.length || !preview.draftSnapshot) throw new Error('Yayınlanamayan nöbet taslağı uygulanamaz.');
  if (signature(preview.draftSnapshot) !== preview.draftSignature) throw new Error('Onaylanan nöbet önizlemesi değişti. Yeniden önizleyip yayınlayın.');
  if (signature(portal) !== preview.portalSignature) throw new Error('Asistan sistemi önizlemeden sonra değişti. Yeniden önizleyip yayınlayın.');
  if (currentDraft && signature(draftSnapshot(currentDraft)) !== signature(preview.draftSnapshot)) throw new Error('Nöbet taslağı önizlemeden sonra değişti. Yeniden önizleyip yayınlayın.');
  // Recompute from the confirmed draft; do not trust caller-modified nextDutyRoster fields.
  if (signature({ roomChanges: preview.roomChangesSnapshot ?? [], restoreIds: preview.restoreRoomChangeIds ?? [] }) !== preview.recoverySignature) throw new Error('Geri dönüş önizlemesi değişti. Yeniden önizleyip yayınlayın.');
  const checked = createPublicationPreview(preview.draftSnapshot, portal, preview.month, { roomChanges: preview.roomChangesSnapshot, restoreRoomChangeIds: preview.restoreRoomChangeIds });
  if (!checked.canPublish) throw new Error(checked.errors.map(item => item.message).join('\n'));
  return { ...copy(portal), dutyRoster: checked.nextDutyRoster, manualAssignments: checked.nextManualAssignments };
}
