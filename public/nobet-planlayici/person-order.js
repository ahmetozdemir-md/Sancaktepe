import { activeGroups } from './domain.js';

const names = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

/** Current seniority first, then Turkish name order. Inactive or unknown groups follow active groups. */
export function comparePeopleBySeniority(state, month) {
  const ranks = new Map(activeGroups(state, month).map((group, index) => [group.id, index]));
  const rank = person => ranks.get(person?.groupId) ?? Number.MAX_SAFE_INTEGER;
  return (left, right) => rank(left) - rank(right)
    || names.compare(left?.name ?? '', right?.name ?? '')
    || String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

/** Return a sorted copy; storage order and canonical multi-person IDs stay untouched. */
export function sortPeopleBySeniority(state, month, people = state.people ?? []) {
  return people.slice().sort(comparePeopleBySeniority(state, month));
}
