/** Effective-month seniority. A person's original group and lifecycle remain historical data. */
const MONTH = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/u;
const nameKey = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');

export function personGroupId(person, month) {
  let groupId = person?.groupId;
  let latest = '';
  for (const entry of Array.isArray(person?.groupHistory) ? person.groupHistory : []) {
    if (entry?.from <= month && entry.from >= latest) {
      latest = entry.from;
      groupId = entry.groupId;
    }
  }
  return groupId;
}

/** Detached view for existing month-based grouping and display helpers; never persist this view. */
export function personAtMonth(person, month) {
  return { ...person, groupId: personGroupId(person, month) };
}

/**
 * Follow shared portal ranks from the effective current month onward. This deliberately
 * does not add, reactivate, retire, rename or recreate people, nor change duties/targets/flags.
 */
export function synchronizePersonRanks(state, portalPlannerState, { fromMonth, currentMonth } = {}) {
  if (!MONTH.test(fromMonth ?? '') || !MONTH.test(currentMonth ?? '')) throw new RangeError('Kıdem eşleştirmesi için geçerli ay gerekir.');
  const month = fromMonth > currentMonth ? fromMonth : currentMonth;
  const first = `${month}-01`;
  const lastDate = new Date(`${first}T00:00:00Z`);
  lastDate.setUTCMonth(lastDate.getUTCMonth() + 1);
  lastDate.setUTCDate(0);
  const last = lastDate.toISOString().slice(0, 10);
  const source = portalPlannerState ?? {};
  const portalNames = new Map();
  for (const name of Array.isArray(source.assistants) ? source.assistants : []) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const key = nameKey(name);
    portalNames.set(key, [...(portalNames.get(key) ?? []), name]);
  }
  const groups = (state.groups ?? []).slice();
  const activeGroups = groups.filter(group => group.from <= month && (!group.until || month < group.until))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ranks = new Map(activeGroups.map((group, index) => [index + 1, group.id]));
  const currentGroups = new Set(activeGroups.map(group => group.id));
  const eligible = (state.people ?? []).filter(person => currentGroups.has(personGroupId(person, month))
    && person.from <= last && (!person.until || first < person.until));
  const richNames = new Map();
  for (const person of eligible) {
    const key = nameKey(person.name);
    richNames.set(key, [...(richNames.get(key) ?? []), person.id]);
  }
  const warnings = [];
  const proposed = new Map();
  for (const person of eligible) {
    const matches = portalNames.get(nameKey(person.name)) ?? [];
    if (matches.length !== 1 || richNames.get(nameKey(person.name))?.length !== 1) {
      warnings.push({ code: 'source-rank-name', personId: person.id, message: `${person.name}: Kıdem eşleştirmesi için Asistan sisteminde tek bir kayıt gerekir.` });
      continue;
    }
    const rank = source.assistantRanks?.[matches[0]];
    // Portal ranks are compact: there cannot be more ranks than registered people.
    // Keep existing group slots valid too, and bound malformed source input before filling gaps.
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > Math.max(activeGroups.length, portalNames.size)) {
      warnings.push({ code: 'source-rank-missing', personId: person.id, message: `${person.name}: Asistan sistemindeki kıdem bilgisi eksik veya geçersiz.` });
      continue;
    }
    proposed.set(person.id, rank);
  }
  let changed = false;
  const maximumRank = Math.max(activeGroups.length, ...proposed.values());
  // An excluded/archived portal member can occupy a rank between linked core people.
  // Empty intervening groups keep the displayed ordinal equal to the portal rank.
  for (let rank = activeGroups.length + 1; rank <= maximumRank; rank++) {
    const id = `portal-rank-${rank}-${month}`;
    let group = groups.find(item => item.id === id);
    if (!group) {
      group = { id, order: Math.max(0, ...groups.map(item => item.order)) + 1, from: month, until: null };
      groups.push(group);
      changed = true;
    }
    ranks.set(rank, group.id);
  }
  const people = (state.people ?? []).map(person => {
    const rank = proposed.get(person.id);
    if (!rank) return person;
    const groupId = ranks.get(rank);
    const before = (person.groupHistory ?? []).filter(entry => entry.from < month)
      .slice().sort((a, b) => a.from.localeCompare(b.from));
    const previousGroup = before.at(-1)?.groupId ?? person.groupId;
    const history = previousGroup === groupId ? before : [...before, { from: month, groupId }];
    if (JSON.stringify(history) === JSON.stringify(person.groupHistory ?? [])) return person;
    changed = true;
    if (!history.length) {
      const next = { ...person };
      delete next.groupHistory;
      return next;
    }
    return { ...person, groupHistory: history };
  });
  return { state: changed ? { ...state, groups, people } : state, changed, warnings };
}
