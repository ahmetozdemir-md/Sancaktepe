import { activePeople, daysInMonth, dayOfWeek, rankOf, tally, targetFor, targetProgress } from './domain.js';
import { comparePeopleBySeniority } from './person-order.js';
import { personGroupId } from './person-history.js';

const SITES = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const numberFormat = new Intl.NumberFormat('tr-TR', { useGrouping: false, maximumFractionDigits: 10 });
const prettyDate = date => date.split('-').reverse().join('.');

// Numeric values are controlled numbers; untrusted text never becomes an Excel formula.
function cell(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? numberFormat.format(value === 0 ? 0 : value) : '';
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[;"\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

const csv = rows => `\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}\r\n`;
const seniorityComparator = comparePeopleBySeniority;

/** One row per calendar day, including empty days and all hospital headcounts. */
export function rosterCSV(state, month) {
  const people = new Map(state.people.map(person => [person.id, person]));
  const compare = seniorityComparator(state, month);
  const rows = [[
    'Tarih', 'Gün', 'Resmî tatil',
    ...SITES.flatMap(site => [`${site} kişi sayısı`, `${site} nöbetçiler`]),
    'Toplam kişi sayısı',
  ]];
  for (const date of daysInMonth(month)) {
    const assignments = state.assignments.filter(item => item.date === date);
    const holidayNames = state.holidays.filter(item => item.date === date).map(item => item.name).join(', ');
    const row = [prettyDate(date), WEEKDAYS[dayOfWeek(date)], holidayNames];
    for (const site of SITES) {
      const duties = assignments.filter(item => item.site === site);
      const names = duties.map(duty => people.get(duty.personId) ?? { id: duty.personId, name: `Kayıt bulunamadı (${duty.personId})`, groupId: '' })
        .sort(compare).map(person => person.name);
      row.push(duties.length, names.join(', '));
    }
    row.push(assignments.length);
    rows.push(row);
  }
  return csv(rows);
}

/** Includes active people and any historical person with a duty in this month. */
export function summaryCSV(state, month) {
  daysInMonth(month); // Reject invalid month values consistently with rosterCSV.
  const assigned = new Set(state.assignments.filter(item => item.date.slice(0, 7) === month).map(item => item.personId));
  const active = new Set(activePeople(state, month).map(person => person.id));
  const people = state.people.filter(person => active.has(person.id) || assigned.has(person.id)).slice().sort(seniorityComparator(state, month));
  const rows = [[
    'Ay', 'Ad soyad', 'Kıdem',
    'Toplam nöbet hedefi', 'Hedefe sayılan nöbet', 'Toplam kalan',
    'Hafta sonu hedefi (birim)', 'Hafta sonu yazılan (birim)', 'Hafta sonu kalan (birim)',
    'Gerçek nöbet günü (tüm kayıtlar)',
    'Tatil nöbeti sayısı', 'Tatil nöbetleri (tarih / ad / hastane)',
  ]];
  for (const person of people) {
    const target = targetFor(state, person.id, month);
    const totals = tally(state, person.id, month);
    const progress = targetProgress(target, totals);
    const holidays = totals.holidays.map(holiday => `${prettyDate(holiday.date)} / ${holiday.name} / ${holiday.site}`).join('\n');
    rows.push([
      month, person.name, rankOf(state, personGroupId(person, month), month) || 'Arşiv',
      progress?.totalTarget ?? 'Hedef girilmedi', totals.countedTotal, progress?.totalRemaining ?? '',
      progress?.weekendTarget ?? 'Hedef girilmedi', totals.weekend, progress?.weekendRemaining ?? '',
      totals.total, totals.holidayCount, holidays,
    ]);
  }
  return csv(rows);
}

/** Call from a user action. Blob URLs are released after the browser starts its download. */
export function downloadFile(filename, text, type = 'text/plain') {
  const safeName = String(filename).replace(/[\/\\\u0000-\u001f]/gu, '_').trim() || 'nobet-planlayici.txt';
  const blob = new Blob([text], { type: `${type}${type.includes('charset=') ? '' : ';charset=utf-8'}` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
