import { addDays, uid, validateAssignment } from './domain.js';
import { planAutoWeekend } from './weekend-pair.js';

const names = new Intl.Collator('tr');
const keyOf = (personId, date) => JSON.stringify([personId, date]);
const sites = new Set(['Sancaktepe', 'Feriha Öz', 'Çekmeköy']);

/** Plan placements only for the explicitly supplied requests; never modify saved data. */
export function planRequestAssignments(state, requests = [], fallbackSite = 'Sancaktepe') {
  const people = new Map((state.people ?? []).map(person => [person.id, person]));
  const candidates = new Map();
  for (const request of requests) {
    if (request.kind !== 'prefer') continue;
    // Validate both endpoints before expanding so a bad interval cannot produce a partial plan.
    addDays(request.start, 0);
    addDays(request.end, 0);
    if (request.start > request.end) throw new RangeError('Nöbet isteğinin başlangıcı bitişinden sonra olamaz.');
    for (let date = request.start; ; date = addDays(date, 1)) {
      candidates.set(keyOf(request.personId, date), { personId: request.personId, date });
      if (date === request.end) break;
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => a.date.localeCompare(b.date)
    || names.compare(people.get(a.personId)?.name ?? a.personId, people.get(b.personId)?.name ?? b.personId)
    || a.personId.localeCompare(b.personId));
  const working = { ...state, assignments: [...(state.assignments ?? [])] };
  const existing = new Map(working.assignments.map(assignment => [keyOf(assignment.personId, assignment.date), assignment]));
  const result = { assignments: [], alreadyAssigned: [], blocked: [], warnings: [], monthUpdates: {} };

  for (const candidate of ordered) {
    const previous = existing.get(keyOf(candidate.personId, candidate.date));
    if (previous) {
      result.alreadyAssigned.push({ ...previous, overrides: [...(previous.overrides ?? [])] });
      continue;
    }
    const rotation = (state.rotations ?? []).filter(item => item.personId === candidate.personId
      && item.start <= candidate.date && candidate.date <= item.end)
      .reduce((latest, item) => !latest || item.start >= latest.start ? item : latest, null);
    const assignment = { id: uid(), ...candidate, site: sites.has(rotation?.site) ? rotation.site : fallbackSite, overrides: [] };
    const validation = validateAssignment(working, assignment);
    if (validation.errors.length) {
      result.blocked.push({
        ...candidate, site: assignment.site,
        messages: validation.errors.map(item => item.message),
        codes: validation.errors.map(item => item.code),
      });
      continue;
    }
    assignment.overrides = [...new Set(validation.warnings.map(item => item.code))];
    result.warnings.push(...validation.warnings.map(item => ({
      ...item, ...candidate, site: assignment.site,
    })));
    result.assignments.push(assignment);
    working.assignments.push(assignment);
    existing.set(keyOf(assignment.personId, assignment.date), assignment);
  }
  // Explicit preferred dates take priority. A Sunday partner cannot displace an
  // explicitly requested Monday or an existing Sunday at another hospital.
  const weekend = planAutoWeekend(working, result.assignments);
  result.alreadyAssigned.push(...weekend.alreadyAssigned.filter(assignment =>
    ![...result.alreadyAssigned, ...result.assignments].some(item => item.personId === assignment.personId && item.date === assignment.date)));
  result.assignments.push(...weekend.assignments);
  result.blocked.push(...weekend.blocked);
  result.warnings.push(...weekend.warnings);
  result.monthUpdates = weekend.monthUpdates;
  return result;
}
