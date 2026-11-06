import { addDays, dayOfWeek, daysInMonth } from './domain.js';

const reviewedPlans = new WeakMap();
const dutyKey = (personId, date) => JSON.stringify([personId, date]);
const snapshotOf = state => JSON.stringify({ assignments: state.assignments, requests: state.requests, months: state.months });

function checkMonth(state, month) {
  daysInMonth(month);
  if (month.startsWith('0000-')) throw new RangeError('Geçersiz ay.');
  if (!Array.isArray(state?.assignments) || !Array.isArray(state?.requests)
    || !state.months || typeof state.months !== 'object'
    || !state.months[month] || typeof state.months[month] !== 'object') {
    throw new Error('Silinecek aylık liste bulunamadı.');
  }
  const ids = new Set();
  for (const row of state.assignments) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || typeof row.personId !== 'string' || typeof row.date !== 'string') {
      throw new Error('Nöbet kayıtları okunamadı. Listeyi yeniden yükleyin.');
    }
    ids.add(row.id);
  }
}

/** Review only the selected month's duties; request records themselves are never deleted. */
export function planMonthClear(state, month, { includeRequests = false } = {}) {
  checkMonth(state, month);
  if (typeof includeRequests !== 'boolean') throw new TypeError('İstek nöbetlerini silme seçimi geçersiz.');
  const preferred = state.requests.filter(row => row.kind === 'prefer');
  const requested = (personId, date) => preferred.some(row => row.personId === personId
    && row.start <= date && date <= row.end);
  const present = new Set(state.assignments.map(row => dutyKey(row.personId, row.date)));
  const monthly = state.assignments.filter(row => row.date.startsWith(`${month}-`));
  const requestAssignments = monthly.filter(row => {
    if (requested(row.personId, row.date)) return true;
    if (dayOfWeek(row.date) !== 0) return false;
    const friday = addDays(row.date, -2);
    return present.has(dutyKey(row.personId, friday)) && requested(row.personId, friday);
  });
  const protectedIds = new Set(requestAssignments.map(row => row.id));
  const plan = {
    month,
    removedAssignments: structuredClone(monthly.filter(row => includeRequests || !protectedIds.has(row.id))),
    keptRequestAssignments: includeRequests ? [] : structuredClone(requestAssignments),
    requestAssignmentCount: requestAssignments.length,
    totalAssignments: monthly.length,
    includeRequests,
  };
  reviewedPlans.set(plan, { snapshot: snapshotOf(state), reviewed: JSON.stringify(plan) });
  return plan;
}

/** Apply the exact reviewed removal atomically, retaining every other month's duties. */
export function clearMonthPlan(state, plan) {
  const reviewed = plan && reviewedPlans.get(plan);
  if (!reviewed || reviewed.reviewed !== JSON.stringify(plan)) {
    throw new Error('Silme önizlemesi geçersiz. İşlemi yeniden başlatın.');
  }
  checkMonth(state, plan.month);
  if (reviewed.snapshot !== snapshotOf(state)) {
    throw new Error('Liste veya istekler değişti. Silme işlemini yeniden başlatın.');
  }
  const ids = new Set(plan.removedAssignments.map(row => row.id));
  if (!ids.size) return 0;
  const remaining = state.assignments.filter(row => !(row.date.startsWith(`${plan.month}-`) && ids.has(row.id)));
  state.assignments = remaining;
  state.months[plan.month].weekendPairInitialized = true;
  state.months[plan.month].completedAt = null;
  return ids.size;
}
