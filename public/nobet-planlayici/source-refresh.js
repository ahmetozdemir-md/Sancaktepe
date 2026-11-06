import { personGroupId } from './person-history.js';

export const sourceValueSignature = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(value);
const copy = value => structuredClone(value);

export function istanbulMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}

export function plannerSourceCutoff(server, now = new Date()) {
  const source = server?.portalSource;
  const from = validMonth(source?.fromMonth) ? source.fromMonth : '2026-11';
  const current = validMonth(source?.currentMonth) ? source.currentMonth : istanbulMonth(now);
  return `${from > current ? from : current}-01`;
}

/**
 * A save reply may arrive after another local edit. Adopt only fields owned by Asistan;
 * assignments, targets, membership, lifetimes and the pending local edit remain local.
 */
export function mergePlannerSourceFields(local, server, now = new Date()) {
  const result = copy(local);
  if (server?.portalSource?.version !== 1) return result;
  const people = new Map((server.people ?? []).map(person => [person.id, person]));
  result.people = result.people.map(person => {
    const canonical = people.get(person.id);
    if (!canonical) return person;
    person.name = canonical.name;
    if (Object.hasOwn(canonical, 'groupHistory')) person.groupHistory = copy(canonical.groupHistory);
    else delete person.groupHistory;
    return person;
  });
  const groupIds = new Set(result.groups.map(group => group.id));
  for (const group of server.groups ?? []) if (!groupIds.has(group.id)) {
    result.groups.push(copy(group));
    groupIds.add(group.id);
  }
  const cutoff = plannerSourceCutoff(server, now);
  const previousDay = new Date(Date.parse(`${cutoff}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const future = (server.rotations ?? []).filter(row => row.end >= cutoff)
    .map(row => ({ ...copy(row), start: row.start < cutoff ? cutoff : row.start }));
  const usedIds = new Set(future.map(row => row.id));
  const historical = result.rotations.filter(row => row.start < cutoff).map(row => {
    const retained = { ...row, end: row.end >= cutoff ? previousDay : row.end };
    // A range crossing the boundary becomes two records; keep canonical future IDs stable.
    if (usedIds.has(retained.id)) {
      const base = `${retained.id}:before:${cutoff}`;
      retained.id = base;
      for (let suffix = 2; usedIds.has(retained.id); suffix++) retained.id = `${base}:${suffix}`;
    }
    usedIds.add(retained.id);
    return retained;
  });
  result.rotations = [...historical, ...future];
  result.portalSource = copy(server.portalSource);
  return invalidateSourceCompletion(local, result, cutoff.slice(0, 7));
}

/** An idle read must never replace edits made while its request was in flight. */
export function canAdoptPlannerRefresh(start, current, { allowPublishing = false } = {}) {
  return start.revision === current.revision && start.editVersion === current.editVersion
    && !current.dirty && !current.saving && !current.error && !current.conflict
    && !current.dialogOpen && !current.shareOpen && current.visible
    && (allowPublishing || !current.publishing);
}

function monthPlanSource(state, month) {
  const first = `${month}-01`;
  const end = new Date(`${first}T00:00:00Z`);end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const last = end.toISOString().slice(0, 10);
  return {
    rotations: state.rotations.filter(row => row.start <= last && row.end >= first)
      .map(row => ({personId:row.personId,start:row.start < first ? first : row.start,end:row.end > last ? last : row.end,site:row.site,unit:row.unit}))
      .sort((a,b)=>sourceValueSignature(a).localeCompare(sourceValueSignature(b))),
    groups: state.people.map(person => [person.id,personGroupId(person,month)]).sort((a,b)=>a[0].localeCompare(b[0])),
  };
}
export function invalidateSourceCompletion(before, after, cutoffMonth) {
  const result = structuredClone(after);
  for (const [month, info] of Object.entries(result.months)) {
    if (month >= cutoffMonth && info.completedAt && sourceValueSignature(monthPlanSource(before,month)) !== sourceValueSignature(monthPlanSource(result,month))) info.completedAt = null;
  }
  return result;
}
