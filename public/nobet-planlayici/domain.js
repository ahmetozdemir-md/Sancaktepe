/* Shared scheduling rules. Dates use UTC calendar arithmetic, never local DST. */
import { coverageIssues, rulesEnabled, siteCoverage } from './capabilities.js';
import { personAtMonth, personGroupId, groupRankAt, personRosterEnabled, personDutyActive, groupActiveInMonth } from './person-history.js';
const DAY = 86_400_000;
const SITES = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];

export function uid() {
  return globalThis.crypto?.randomUUID?.()
    ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function dateValue(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Tarih YYYY-AA-GG biçiminde olmalı.');
  }
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new RangeError('Geçersiz takvim tarihi.');
  }
  return value;
}

export function daysInMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    throw new RangeError('Ay YYYY-AA biçiminde olmalı.');
  }
  const first = dateValue(`${month}-01`);
  const result = [];
  for (let value = first; new Date(value).toISOString().slice(0, 7) === month; value += DAY) {
    result.push(new Date(value).toISOString().slice(0, 10));
  }
  return result;
}

export function addDays(date, count) {
  if (!Number.isInteger(count)) throw new RangeError('Gün farkı tam sayı olmalı.');
  return new Date(dateValue(date) + count * DAY).toISOString().slice(0, 10);
}

export function dayOfWeek(date) {
  return new Date(dateValue(date)).getUTCDay();
}

export function initialState() {
  const namesByGroup = [
    ['Ensar', 'Muaz'],
    ['Ahmet Özdemir', 'Azmi', 'Birhan', 'Burcu', 'Cebrail', 'Ebubekir', 'Erçin', 'Ezgi', 'Oğuzhan', 'Oya', 'Seda'],
    ['Deniz', 'Ebru', 'Fulden', 'Gözde Bayar', 'Hilal', 'İsa', 'Nedim', 'Rana'],
    ['Aslınur', 'Ayşenur', 'Bahadır', 'Eyüp', 'Gamze', 'İlker', 'Kıymet', 'Kübra Kaya', 'Zeynep Sallamacı'],
    ['Handan', 'Özge'],
    ['Fatih', 'Seyhan', 'Tarık'],
    ['Beyza', 'Bilal', 'Samet', 'Zeynep Gözde'],
    ['Ersin', 'Sadık', 'Selin', 'Yasin'],
    ['Gozel', 'Ömer', 'Tuğana'],
    ['Batuhan', 'Burak', 'Burcu Gülşen', 'Egemen', 'Musa'],
    ['Azad', 'Berk', 'Furkan', 'İnci', 'İsa Özer', 'Lezgin', 'Mehmet', 'Öncel', 'Özdemir', 'Ufuk', 'Yusuf', 'Yüsra'],
  ];
  const groups = namesByGroup.map((_, index) => ({
    id: `group-${index + 1}`, order: index + 1, from: '2026-10', until: null,
  }));
  const people = namesByGroup.flatMap((names, index) => names.map((name, personIndex) => ({
    id: `person-${index + 1}-${personIndex + 1}`, name, groupId: groups[index].id,
    from: '2026-10-01', until: null,
  })));
  return {
    schemaVersion: 1, people, groups, targets: [], assignments: [], absences: [],
    requests: [], rotations: [], holidays: [], months: { '2026-11': { completedAt: null } },
    updatedAt: new Date().toISOString(),
  };
}

export function activeGroups(state, month) {
  return (state.groups ?? [])
    .filter(group => groupActiveInMonth(state, group, month))
    .slice().sort((a, b) => groupRankAt(a, month, a.order) - groupRankAt(b, month, b.order) || a.order - b.order || a.id.localeCompare(b.id));
}

export function activePeople(state, month) {
  const days = daysInMonth(month);
  const groups = new Set(activeGroups(state, month).map(group => group.id));
  return (state.people ?? []).filter(person => groups.has(personGroupId(person, month))
    && person.from <= days.at(-1) && (personRosterEnabled(person, month) ?? (!person.until || person.until > days[0])))
    .map(person => personAtMonth(person, month));
}

export function rankOf(state, groupId, month) {
  const groups = activeGroups(state, month), index = groups.findIndex(group => group.id === groupId);
  return index < 0 ? 0 : groupRankAt(groups[index], month, index + 1);
}

export function hasFullMonthTargetExemption(state, personId, month) {
  const first = `${month}-01`, last = daysInMonth(month).at(-1);
  const ranges = (state.absences ?? []).filter(item => item.personId === personId
    && item.type === 'exempt' && item.zeroTarget === true && item.start <= last && item.end >= first)
    .slice().sort((a, b) => a.start.localeCompare(b.start));
  let coveredThrough = null;
  for (const range of ranges) {
    if (coveredThrough === null) {
      if (range.start > first) return false;
      coveredThrough = range.end;
    } else {
      if (range.start > addDays(coveredThrough, 1)) return false;
      if (range.end > coveredThrough) coveredThrough = range.end;
    }
    if (coveredThrough >= last) return true;
  }
  return false;
}

export function targetFor(state, personId, month) {
  const person = (state.people ?? []).find(item => item.id === personId);
  if (!person) return null;
  if (hasFullMonthTargetExemption(state, personId, month)) return { weekday: 0, weekend: 0 };
  const begun = (state.targets ?? []).filter(item => item.from <= month);
  const latest = list => list.reduce((result, item) => !result || item.from >= result.from ? item : result, null);
  const active = item => !item.through || month <= item.through;
  // Display seniority follows the portal; inherited planning settings stay with the original group until edited manually.
  const personal = latest(begun.filter(item => item.personId === personId));
  const target = personal && !personal.inherit && active(personal) ? personal
    : latest(begun.filter(item => !item.personId && item.groupId === person.groupId && active(item)));
  return target ? { weekday: target.weekday, weekend: target.weekend } : null;
}

function holidayEntries(state, date) {
  return (state.holidays ?? []).filter(holiday => holiday.date === date);
}

function credits(state, date) {
  const dow = dayOfWeek(date);
  // Friday/Sunday are half a weekend even when the date is a holiday.
  if (dow === 5 || dow === 0) return { weekday: 0, weekend: 0.5, countedTotal: 1 };
  if (dow === 6) return { weekday: 0, weekend: 1, countedTotal: 1 };
  const holiday = holidayEntries(state, date)[0];
  if (holiday) {
    const weekday = Number(holiday.weekdayCredit) || 0;
    const weekend = Number(holiday.weekendCredit) || 0;
    return { weekday, weekend, countedTotal: weekday + weekend };
  }
  return { weekday: 1, weekend: 0, countedTotal: 1 };
}

export function tally(state, personId, month) {
  const all = (state.assignments ?? []).filter(item => item.personId === personId);
  const dates = new Set(all.map(item => item.date));
  const result = { weekday: 0, weekend: 0, total: 0, countedTotal: 0, holidayCount: 0, holidays: [], unpaired: [] };
  for (const assignment of all.filter(item => item.date.slice(0, 7) === month)) {
    const credit = credits(state, assignment.date);
    result.weekday += credit.weekday;
    result.weekend += credit.weekend;
    result.total += 1;
    result.countedTotal += credit.countedTotal;
    const holidays = holidayEntries(state, assignment.date);
    if (holidays.length) {
      result.holidayCount += 1;
      result.holidays.push(...holidays.map(holiday => ({ date: assignment.date, name: holiday.name, site: assignment.site })));
    }
    const dow = dayOfWeek(assignment.date);
    if (dow === 5 || dow === 0) {
      const missingDate = addDays(assignment.date, dow === 5 ? 2 : -2);
      if (!dates.has(missingDate)) result.unpaired.push({ date: assignment.date, missingDate });
    }
  }
  result.holidays.sort((a, b) => a.date.localeCompare(b.date));
  result.unpaired.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

/** The two stored target values sum to the duty total; weekend units are a separate quota. */
export function targetProgress(target, counts) {
  if (!target) return null;
  const totalTarget = target.weekday + target.weekend;
  const totalAssigned = counts.countedTotal;
  const totalRemaining = totalTarget - totalAssigned;
  const weekendTarget = target.weekend;
  const weekendAssigned = counts.weekend;
  const weekendRemaining = weekendTarget - weekendAssigned;
  return {
    totalTarget, totalAssigned, totalRemaining,
    weekendTarget, weekendAssigned, weekendRemaining,
    isUnder: totalRemaining > 0 || weekendRemaining > 0,
    isOver: totalRemaining < 0 || weekendRemaining < 0,
  };
}

const prettyDate = date => date.split('-').reverse().join('.');
const amount = number => String(number).replace('.', ',');
const within = (record, date) => record.start <= date && date <= record.end;

function isIntensiveCareRotation(rotation) {
  const unit = String(rotation.unit ?? '').toLocaleLowerCase('tr-TR').normalize('NFKD')
    .replace(/\p{M}/gu, '').replace(/ı/gu, 'i').replace(/[^a-z0-9]+/gu, ' ');
  return SITES.includes(rotation.site) && /\b(?:y\s*b\s*u|yogun\s*bakim)\b/u.test(unit);
}

function alternateChainFromDates(dates, date) {
  const chain = [date];
  for (let previous = addDays(date, -2); dates.has(previous); previous = addDays(previous, -2)) chain.unshift(previous);
  for (let next = addDays(date, 2); dates.has(next); next = addDays(next, 2)) chain.push(next);
  return chain;
}

/** Includes the proposed date so the candidate card and assignment check use the same chain. */
export function alternateDutyChain(state, personId, date, ignoreId = null) {
  const dates = new Set((state.assignments ?? [])
    .filter(item => item.personId === personId && item.id !== ignoreId)
    .map(item => item.date));
  return alternateChainFromDates(dates, date);
}

export function validateAssignment(state, assignment, ignoreId = null) {
  const errors = [];
  const warnings = [];
  const error = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const { personId, date, site } = assignment;
  try { dateValue(date); } catch {
    error('invalid-date', 'Geçerli bir nöbet tarihi seçin.');
    return { errors, warnings };
  }
  if (!SITES.includes(site)) error('invalid-site', 'Geçerli bir hastane seçin.');
  const person = (state.people ?? []).find(item => item.id === personId);
  if (!personDutyActive(person, date)
    || !activeGroups(state, date.slice(0, 7)).some(group => group.id === personGroupId(person, date.slice(0, 7)))) {
    error('inactive', 'Bu kişi seçilen tarihte aktif asistan listesinde değil.');
    return { errors, warnings };
  }
  const others = (state.assignments ?? []).filter(item => item.id !== ignoreId);
  const own = others.filter(item => item.personId === personId);
  const dates = new Set(own.map(item => item.date));
  if (dates.has(date)) error('duplicate', `${person.name} bu tarihte zaten nöbetçi; aynı güne ikinci kez yazılamaz.`);
  const adjacent = [addDays(date, -1), addDays(date, 1)].filter(value => dates.has(value));
  if (adjacent.length) error('consecutive', `${person.name}: ${adjacent.map(prettyDate).join(' ve ')} tarihinde nöbet var. Arka arkaya iki gün nöbet kesinlikle yazılamaz.`);

  for (const absence of (state.absences ?? []).filter(item => item.personId === personId && within(item, date))) {
    const label = { annual: 'Yıllık izin', excused: 'Mazeret izni', exempt: 'Nöbet muafiyeti' }[absence.type] ?? 'İzin';
    warn('absence', `${person.name}: ${label} (${prettyDate(absence.start)}–${prettyDate(absence.end)})${absence.note ? ` — ${absence.note}` : ''}. Yine de yazılsın mı?`);
  }
  for (const request of (state.requests ?? []).filter(item => item.personId === personId && item.kind === 'avoid' && within(item, date))) {
    warn('avoid', `${person.name} bu gün nöbet yazılmamasını istemiş${request.note ? `: ${request.note}` : ''}. Yine de yazılsın mı?`);
  }

  const dow = dayOfWeek(date);
  const restConflicts = dow === 4
    ? [1, 2, 3].map(offset => addDays(date, offset)).filter(value => dates.has(value))
    : (dow === 5 || dow === 6 || dow === 0)
      ? [addDays(date, -(dow === 0 ? 3 : dow - 4))].filter(value => dates.has(value))
      : [];
  if (restConflicts.length) warn('thursday-rest', `${person.name}: Perşembe nöbeti sonrası cuma–cumartesi–pazar dinlenme tercihiyle çakışıyor (${restConflicts.map(prettyDate).join(', ')}). Yine de yazılsın mı?`);

  const chain = alternateChainFromDates(dates, date);
  if (chain.length >= 3) warn('alternate-chain', `${person.name}: ${chain.length} kez gün aşırı nöbet (${chain.map(prettyDate).join(', ')}). Yine de yazılsın mı?`);

  const rotation = (state.rotations ?? []).filter(item => item.personId === personId && within(item, date))
    .reduce((latest, item) => !latest || item.start >= latest.start ? item : latest, null);
  if (rotation && rotation.site !== site && isIntensiveCareRotation(rotation)) warn('rotation', `${person.name} bu tarihte ${rotation.site}${rotation.unit ? ` / ${rotation.unit}` : ''} rotasyonunda; ${site} hastanesine yazılıyor. Gün isteği öncelikli tutulabilir.`);

  const month = date.slice(0, 7);
  const target = targetFor(state, personId, month);
  if (target) {
    const projected = tally({ ...state, assignments: [...others, { ...assignment, id: '__candidate__' }] }, personId, month);
    const progress = targetProgress(target, projected);
    const excess = [];
    if (progress.totalRemaining < 0) excess.push(`toplam ${amount(progress.totalAssigned)}/${amount(progress.totalTarget)}`);
    if (progress.weekendRemaining < 0) excess.push(`hafta sonu ${amount(progress.weekendAssigned)}/${amount(progress.weekendTarget)}`);
    if (excess.length) warn('over-target', `${person.name}: Aylık hedef aşılıyor (${excess.join(', ')}). Yine de yazılsın mı?`);
  }
  if (SITES.includes(site) && rulesEnabled(state, month)) {
    const coverage = siteCoverage({ ...state, assignments: [...others, { ...assignment, id: '__candidate__' }] }, date, site);
    for (const item of coverage.issues) {
      if (item.code.startsWith('coverage-sanc-')) warn(item.code, `${item.message} Yine de yazılsın mı?`);
    }
  }
  return { errors, warnings };
}

export function auditMonth(state, month) {
  const result = [];
  const assignments = (state.assignments ?? []).filter(item => item.date.slice(0, 7) === month);
  const active = activePeople(state, month);
  const people = new Map((state.people ?? []).map(person => [person.id, person]));
  const included = new Set([...active.map(person => person.id), ...assignments.map(item => item.personId)]);
  const issue = (code, message, personId, date, severity = 'warning') => result.push({
    code, message, ...(personId ? { personId } : {}), ...(date ? { date } : {}), severity,
  });
  for (const personId of included) {
    const person = people.get(personId);
    if (!person) continue; // The assignment validator below reports unknown/inactive people.
    const totals = tally(state, personId, month);
    const target = targetFor(state, personId, month);
    if (!target) {
      issue('missing-target', `${person.name}: Bu ay için nöbet hedefi girilmedi.`, personId);
    } else {
      const less = [], more = [];
      const progress = targetProgress(target, totals);
      for (const [assigned, expected, label] of [
        [progress.totalAssigned, progress.totalTarget, 'toplam'],
        [progress.weekendAssigned, progress.weekendTarget, 'hafta sonu'],
      ]) {
        if (assigned < expected) less.push(`${label} ${amount(assigned)}/${amount(expected)}`);
        if (assigned > expected) more.push(`${label} ${amount(assigned)}/${amount(expected)}`);
      }
      if (less.length) issue('under-target', `${person.name}: Aylık hedefin altında (${less.join(', ')}).`, personId);
      if (more.length) issue('over-target', `${person.name}: Aylık hedefin üzerinde (${more.join(', ')}).`, personId);
    }
    for (const missing of totals.unpaired) issue('unpaired-weekend', `${person.name}: ${prettyDate(missing.date)} nöbetinin cuma–pazar eşi ${prettyDate(missing.missingDate)} tarihinde eksik; 0,5 hafta sonu sayıldı.`, personId, missing.date);
  }
  for (const assignment of assignments) {
    const validation = validateAssignment(state, assignment, assignment.id);
    for (const item of validation.errors) issue(item.code, item.message, assignment.personId, assignment.date, 'error');
    for (const item of validation.warnings.filter(item => item.code !== 'over-target' && !item.code.startsWith('coverage-'))) issue(item.code, item.message, assignment.personId, assignment.date);
  }
  if (rulesEnabled(state, month)) for (const date of daysInMonth(month)) result.push(...coverageIssues(state, date));
  return result;
}
