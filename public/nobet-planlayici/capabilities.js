/* Monthly clinical capability flags and daily coverage. No role is inferred from a name or rank. */
import { personGroupId } from './person-history.js';
const SITES = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];
const EMPTY = { triangle: false, square: false, circle: false, companion: false };
const DEFAULTS = {
  sancaktepeCount: 3,
  cekmekoyCount: 1,
  ferihaCapacity: 9,
  companions: {
    'Sancaktepe': { min: 0, max: 1 },
    'Feriha Öz': { min: 0, max: 3 },
    'Çekmeköy': { min: 0, max: 0 },
  },
};

/** Ç excludes all clinical capabilities. Triangle always includes circle. */
export function normalizeCapabilities(flags = {}) {
  if (flags?.companion === true) return { ...EMPTY, companion: true };
  const triangle = flags?.triangle === true;
  return { triangle, square: flags?.square === true, circle: triangle || flags?.circle === true, companion: false };
}

export function groupCapabilitiesFor(state, groupId, month) {
  const record = (state.capabilities ?? []).filter(row => !row.personId && row.groupId === groupId
    && row.from <= month && (!row.through || month <= row.through))
    .reduce((latest, row) => !latest || row.from >= latest.from ? row : latest, null);
  return normalizeCapabilities(record);
}

/** Personal records replace all four group flags; an expired override returns to the group. */
export function capabilitiesFor(state, personId, month) {
  const person = (state.people ?? []).find(item => item.id === personId);
  if (!person) return { ...EMPTY };
  const begun = (state.capabilities ?? []).filter(item => item.from <= month);
  const latest = rows => rows.reduce((result, row) => !result || row.from >= result.from ? row : result, null);
  const active = row => !row.through || month <= row.through;
  const personal = latest(begun.filter(row => row.personId === personId));
  return personal && !personal.inherit && active(personal) ? normalizeCapabilities(personal)
    : groupCapabilitiesFor(state, personGroupId(person, month), month);
}

/** Return an independent settings object, with defaults for fields absent from old backups. */
export function getPlanningSettings(state) {
  const supplied = state.planningSettings ?? {};
  const count = (value, fallback, minimum = 0) => Number.isSafeInteger(value) && value >= minimum ? value : fallback;
  const companions = Object.fromEntries(SITES.map(site => {
    const proposed = supplied.companions?.[site] ?? {};
    const min = count(proposed.min, DEFAULTS.companions[site].min);
    const max = count(proposed.max, DEFAULTS.companions[site].max);
    return [site, { min, max: Math.max(min, max) }];
  }));
  return {
    sancaktepeCount: count(supplied.sancaktepeCount, DEFAULTS.sancaktepeCount, 3),
    cekmekoyCount: count(supplied.cekmekoyCount, DEFAULTS.cekmekoyCount),
    ferihaCapacity: count(supplied.ferihaCapacity, DEFAULTS.ferihaCapacity),
    companions,
  };
}

export function rulesEnabled(state, month) {
  return state.months?.[month]?.capabilityRulesEnabled === true;
}

/** Coverage counts distinct people, so an invalid duplicate can never satisfy two roles. */
export function siteCoverage(state, date, site) {
  const month = date.slice(0, 7);
  const unique = [...new Set((state.assignments ?? []).filter(row => row.date === date && row.site === site).map(row => row.personId))];
  const people = unique.map(personId => ({ personId, ...capabilitiesFor(state, personId, month) }));
  const active = people.filter(person => !person.companion);
  const triangles = active.filter(person => person.triangle);
  const circles = active.filter(person => person.circle);
  const plain = active.filter(person => !person.triangle && !person.square && !person.circle);
  const result = {
    peopleCount: people.length,
    activeCount: active.length,
    companionCount: people.length - active.length,
    capacity: active.reduce((sum, person) => sum + (person.square ? 2 : 1), 0),
    triangleCount: triangles.length,
    circleCount: circles.length,
    plainCount: plain.length,
    distinctSancPair: triangles.some(first => circles.some(second => second.personId !== first.personId)),
    issues: [],
  };
  if (!rulesEnabled(state, month) || !SITES.includes(site)) return result;
  const settings = getPlanningSettings(state);
  const warn = (code, message) => result.issues.push({ code, message, date, site, severity: 'warning' });
  const label = `${date.split('-').reverse().join('.')} · ${site}`;
  if (site === 'Sancaktepe' && result.activeCount >= settings.sancaktepeCount) {
    if (!result.triangleCount) warn('coverage-sanc-triangle', `${label}: En az bir üçgenli asistan gerekir.`);
    if (!result.circleCount) warn('coverage-sanc-circle', `${label}: En az bir yuvarlaklı asistan gerekir.`);
    if (result.triangleCount && result.circleCount && !result.distinctSancPair) warn('coverage-sanc-distinct', `${label}: Üçgenli ilk kişi dışında ikinci bir yuvarlaklı asistan gerekir.`);
  } else if (site === 'Feriha Öz' && settings.ferihaCapacity > 0) {
    if (result.capacity < settings.ferihaCapacity) warn('coverage-feriha-capacity', `${label}: Alan karşılığı ${result.capacity}/${settings.ferihaCapacity}.`);
  }
  return result;
}

export function coverageIssues(state, date) {
  if (!rulesEnabled(state, date.slice(0, 7))) return [];
  return SITES.flatMap(site => siteCoverage(state, date, site).issues);
}
