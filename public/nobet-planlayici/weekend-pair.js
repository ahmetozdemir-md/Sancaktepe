import { addDays, dayOfWeek, daysInMonth, uid, validateAssignment } from './domain.js';

const keyOf = (personId, date) => JSON.stringify([personId, date]);

/**
 * Plan Sunday partners for actual new Friday placements, plus a month's first
 * weekend when explicitly opening it for the first time. Never run on render.
 * Warnings are proposals: callers must obtain approval before applying the plan.
 */
export function planAutoWeekend(state, addedAssignments = [], { reconcileMonth = null } = {}) {
  const result = { assignments: [], alreadyAssigned: [], blocked: [], warnings: [], monthUpdates: {} };
  const working = { ...state, assignments: [...(state.assignments ?? [])] };
  const present = new Map(working.assignments.map(assignment => [keyOf(assignment.personId, assignment.date), assignment]));
  // Accept either the state before an insertion or a draft already containing it.
  for (const assignment of addedAssignments) {
    const key = keyOf(assignment.personId, assignment.date);
    if (!present.has(key)) {
      working.assignments.push(assignment);
      present.set(key, assignment);
    }
  }

  const sources = new Map();
  const includeFriday = friday => {
    if (dayOfWeek(friday.date) !== 5) return;
    sources.set(keyOf(friday.personId, addDays(friday.date, 2)), friday);
  };
  for (const assignment of addedAssignments) includeFriday(assignment);

  const initializeMonth = month => {
    const first = daysInMonth(month)[0];
    if (!state.months?.[month]?.weekendPairInitialized) {
      result.monthUpdates[month] = { weekendPairInitialized: true };
      const weekday = dayOfWeek(first);
      if (weekday === 6 || weekday === 0) {
        const sunday = weekday === 0 ? first : addDays(first, 1);
        const friday = addDays(sunday, -2);
        for (const assignment of working.assignments) {
          if (assignment.date === friday) includeFriday(assignment);
        }
      }
    }
  };
  // Creating a later Friday request may open an entire future month. Carry its
  // first weekend as well before marking the month initialized; otherwise that
  // marker would conceal a known Friday from the preceding month.
  const generatedMonths = new Set([...sources.values()].map(friday => addDays(friday.date, 2).slice(0, 7)));
  for (const month of generatedMonths) initializeMonth(month);
  if (reconcileMonth !== null) initializeMonth(reconcileMonth);

  for (const friday of [...sources.values()].sort((a, b) => a.date.localeCompare(b.date)
    || a.personId.localeCompare(b.personId))) {
    const date = addDays(friday.date, 2);
    // This marker also protects a later manual Sunday deletion from first-open
    // reconciliation, including when the pair spans two different months.
    result.monthUpdates[date.slice(0, 7)] = { weekendPairInitialized: true };
    const candidate = { personId: friday.personId, date, site: friday.site, sourceDate: friday.date };
    const existing = present.get(keyOf(candidate.personId, date));
    if (existing) {
      result.alreadyAssigned.push({ ...existing, overrides: [...(existing.overrides ?? [])], sourceDate: friday.date });
      continue;
    }
    const assignment = { id: uid(), personId: candidate.personId, date, site: candidate.site, overrides: [] };
    const validation = validateAssignment(working, assignment);
    if (validation.errors.length) {
      result.blocked.push({ ...candidate,
        messages: validation.errors.map(item => item.message),
        codes: validation.errors.map(item => item.code),
      });
      continue;
    }
    assignment.overrides = [...new Set(validation.warnings.map(item => item.code))];
    result.warnings.push(...validation.warnings.map(item => ({ ...item, ...candidate })));
    result.assignments.push(assignment);
    working.assignments.push(assignment);
    present.set(keyOf(assignment.personId, date), assignment);
  }
  return result;
}

/** Explicitly retry the first Sunday's pairs from the saved previous month's final two days. */
export function planPreviousMonthWeekend(state, month) {
  const first = daysInMonth(month)[0];
  const previousDates = new Set([addDays(first, -2), addDays(first, -1)]);
  const fridays = (state.assignments ?? []).filter(assignment => previousDates.has(assignment.date)
    && dayOfWeek(assignment.date) === 5 && addDays(assignment.date, 2).slice(0, 7) === month);
  return planAutoWeekend(state, fridays);
}

/** Apply only after the transaction's warning confirmation, with its Friday. */
export function applyWeekendPlan(state, plan) {
  for (const assignment of plan.assignments) {
    if (!state.assignments.some(item => item.personId === assignment.personId && item.date === assignment.date)) {
      state.assignments.push(assignment);
    }
  }
  for (const [month, patch] of Object.entries(plan.monthUpdates)) {
    state.months[month] ??= { completedAt: null };
    Object.assign(state.months[month], patch);
  }
}
