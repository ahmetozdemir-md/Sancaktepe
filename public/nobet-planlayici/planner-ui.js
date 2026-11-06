import { dayOfWeek, daysInMonth, targetFor, targetProgress, tally, validateAssignment, alternateDutyChain } from './domain.js';

const sites = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];
const views = ['plan', 'people', 'records', 'rotations', 'holidays', 'summary', 'data', 'settings'];

const normalizedName = value => String(value ?? '').trim().replace(/\s+/gu, ' ')
  .toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/gu, 'i');

/** Pin matching names by relevance while retaining the existing order within each match type. */
export function candidateNameMatches(people, query) {
  const search = normalizedName(query);
  if (!search) return [];
  return people.map((person, index) => {
    const name = normalizedName(person.name);
    const rank = name === search ? 0 : name.startsWith(search) ? 1 : name.includes(search) ? 2 : -1;
    return { person, index, rank };
  }).filter(item => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.person);
}

/** Preview the same restrictions as manual assignment without changing any saved duties. */
export function searchCellAvailability(state, people, date, site) {
  const affected = [];
  for (const person of people) {
    // An existing duty is highlighted separately; it is not a proposed duplicate.
    if ((state.assignments ?? []).some(item => item.personId === person.id && item.date === date && item.site === site)) continue;
    const { errors, warnings } = validateAssignment(state, { personId: person.id, date, site });
    const hints = [...warnings];
    if (!errors.length && alternateDutyChain(state, person.id, date).length === 2) {
      hints.push({ code: 'alternate-preview', message: 'Bu nöbetle 2 kez gün aşırı nöbet olur.' });
    }
    if (errors.length || hints.length) affected.push({
      name: person.name, blocked: errors.length > 0, issues: [...errors, ...hints],
    });
  }
  // A partial name can match several people. Red means none of them can be assigned here.
  const status = affected.length && affected.length === people.length && affected.every(item => item.blocked)
    ? 'blocked' : affected.length ? 'warning' : '';
  return {
    status, count: affected.length, total: people.length,
    title: affected.map(item => `${item.name} · ${item.blocked ? 'Yazılamaz' : 'Uyarı'}\n${item.issues.map(issue => issue.message).join('\n')}`).join('\n\n'),
  };
}

/** Completion follows the total duty quota and the selected date's weekend contribution. */
export function targetFinishedForDate(state, personId, month, date, counts = null) {
  const target = targetFor(state, personId, month);
  if (!target) return false;
  const dow = dayOfWeek(date);
  const holiday = (state.holidays ?? []).find(item => item.date === date);
  const credit = [0, 5, 6].includes(dow) ? { weekday: 0, weekend: 1 }
    : holiday ? { weekday: Number(holiday.weekdayCredit) || 0, weekend: Number(holiday.weekendCredit) || 0 }
    : { weekday: 1, weekend: 0 };
  if (credit.weekday + credit.weekend === 0) return false;
  const actual = counts ?? tally(state, personId, month);
  const progress = targetProgress(target, actual);
  return progress.totalRemaining <= 0 || (credit.weekend > 0 && progress.weekendRemaining <= 0);
}

/** Validate a remembered workspace without trusting outdated months or arbitrary view names. */
export function restorePlannerLocation(state, saved) {
  let value;
  try { value = typeof saved === 'string' ? JSON.parse(saved) : saved; } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const months = Object.keys(state.months ?? {}).sort();
  const month = months.includes(value.month) ? value.month : months.at(-1) ?? '2026-11';
  const date = typeof value.date === 'string' && daysInMonth(month).includes(value.date) ? value.date : `${month}-01`;
  const validSavedMonth = value.month === month;
  const scroll = key => validSavedMonth && Number.isFinite(value[key]) && value[key] >= 0 ? Math.min(value[key], 1_000_000) : 0;
  return {
    month, date, site: sites.includes(value.site) ? value.site : sites[0],
    view: views.includes(value.view) ? value.view : 'plan',
    contentScroll: scroll('contentScroll'), tableScroll: scroll('tableScroll'), candidateScroll: scroll('candidateScroll'),
  };
}
