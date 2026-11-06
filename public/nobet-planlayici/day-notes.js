import { activeGroups, addDays, rankOf } from './domain.js';
import { comparePeopleBySeniority } from './person-order.js';

const labelText = {
  prefer: 'Nöbet istiyor',
  together: 'Birlikte nöbet',
  avoid: 'Nöbet istemiyor',
  annual: 'Yıllık izin',
  excused: 'Mazeret izni',
  exempt: 'Nöbet muafiyeti',
};
const labelOrder = ['prefer', 'together', 'avoid', 'annual', 'excused', 'exempt'];
const nameOrder = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
const contains = (record, date) => record.start <= date && date <= record.end;

/** Day-specific reminders; together preferences surface unassigned partners after an anchor is assigned. */
export function dayNotes(state, date) {
  addDays(date, 0); // Use the same strict calendar validation as scheduling rules.
  const month = date.slice(0, 7);
  const comparePeople = comparePeopleBySeniority(state, month);
  const groupIds = new Set(activeGroups(state, month).map(group => group.id));
  const registeredPeople = new Map((state.people ?? []).map(person => [person.id, person]));
  const people = new Map((state.people ?? [])
    .filter(person => groupIds.has(person.groupId) && person.from <= date
      && (!person.until || date < person.until))
    .map(person => [person.id, person]));
  const assignments = new Map((state.assignments ?? [])
    .filter(assignment => assignment.date === date)
    .map(assignment => [assignment.personId, assignment]));
  const notes = new Map();

  function include(record, kind, note = record.note ?? '') {
    const person = people.get(record.personId);
    if (!person || !contains(record, date)) return;
    let entry = notes.get(person.id);
    if (!entry) {
      const assignment = assignments.get(person.id);
      entry = {
        personId: person.id,
        person: { ...person },
        rank: rankOf(state, person.groupId, month),
        labels: [],
        assignment: assignment ? {
          ...assignment,
          ...(assignment.overrides ? { overrides: [...assignment.overrides] } : {}),
        } : null,
      };
      notes.set(person.id, entry);
    }
    const label = { kind, text: labelText[kind], note };
    if (!entry.labels.some(existing => existing.kind === label.kind
      && existing.text === label.text && existing.note === label.note)) {
      entry.labels.push(label);
    }
  }

  for (const request of (state.requests ?? [])) {
    if (request.kind === 'prefer' || request.kind === 'avoid') include(request, request.kind);
    else if (request.kind === 'together' && contains(request, date)) {
      if (!Array.isArray(request.personIds)) continue;
      const memberIds = [...new Set(request.personIds)];
      if (memberIds.length < 2 || memberIds.some(id => !registeredPeople.has(id))) continue;
      const assigned = memberIds.filter(id => assignments.has(id));
      if (!assigned.length) continue;
      const names = assigned.map(id => registeredPeople.get(id))
        .sort(comparePeople).map(person => person.name);
      const note = `${names.join(', ')} ile${request.note ? ` · ${request.note}` : ''}`;
      for (const personId of memberIds) {
        if (!assignments.has(personId)) include({ ...request, personId }, 'together', note);
      }
    }
  }
  for (const absence of (state.absences ?? [])) {
    if (['annual', 'excused', 'exempt'].includes(absence.type)) include(absence, absence.type);
  }
  for (const entry of notes.values()) {
    entry.labels.sort((a, b) => labelOrder.indexOf(a.kind) - labelOrder.indexOf(b.kind)
      || nameOrder.compare(a.note, b.note) || a.note.localeCompare(b.note));
  }
  return [...notes.values()].sort((a, b) => comparePeople(a.person, b.person));
}
