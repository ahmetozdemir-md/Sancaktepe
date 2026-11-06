import test from 'node:test';
import assert from 'node:assert/strict';
import { personGroupId, personAtMonth, synchronizePersonRanks } from '../public/nobet-planlayici/person-history.js';
import { activePeople, targetFor, validateAssignment, rankOf } from '../public/nobet-planlayici/domain.js';
import { capabilitiesFor } from '../public/nobet-planlayici/capabilities.js';
import { sortPeopleBySeniority } from '../public/nobet-planlayici/person-order.js';
import { buildShareModel } from '../public/nobet-planlayici/sharing.js';
import { summaryCSV } from '../public/nobet-planlayici/exporters.js';
import { validateState } from '../public/nobet-planlayici/state-schema.js';
import { createPublicationPreview } from '../src/month-publication.js';

function fixture() {
  return {
    schemaVersion: 1, updatedAt: '2026-11-06T00:00:00.000Z',
    groups: [
      { id: 'g1', order: 1, from: '2026-10', until: null },
      { id: 'g2', order: 2, from: '2026-10', until: null },
    ],
    people: [
      { id: 'a', name: 'İpek', groupId: 'g2', from: '2026-10-01', until: null },
      { id: 'b', name: 'Ahmet', groupId: 'g1', from: '2026-10-01', until: null },
      { id: 'old', name: 'Arşiv', groupId: 'g1', from: '2026-10-01', until: '2026-11-01' },
    ],
    targets: [
      { id: 't1', groupId: 'g1', personId: null, from: '2026-10', weekday: 1, weekend: 0 },
      { id: 't2', groupId: 'g2', personId: null, from: '2026-10', weekday: 3, weekend: 1 },
    ],
    capabilities: [
      { id: 'c1', groupId: 'g1', personId: null, from: '2026-10', triangle: true, square: false, circle: true, companion: false },
      { id: 'c2', groupId: 'g2', personId: null, from: '2026-10', triangle: false, square: true, circle: false, companion: false },
    ],
    assignments: [
      { id: 'ao', personId: 'a', date: '2026-10-06', site: 'Feriha Öz', overrides: [] },
      { id: 'bo', personId: 'b', date: '2026-10-06', site: 'Feriha Öz', overrides: [] },
      { id: 'an', personId: 'a', date: '2026-11-02', site: 'Feriha Öz', overrides: [] },
      { id: 'bn', personId: 'b', date: '2026-11-02', site: 'Feriha Öz', overrides: [] },
    ],
    requests: [], absences: [], rotations: [], holidays: [],
    months: { '2026-10': { completedAt: null }, '2026-11': { completedAt: null }, '2026-12': { completedAt: null } },
  };
}
const portal = ranks => ({ assistants: ['İpek', 'Ahmet', 'Arşiv', 'Yeni'], assistantRanks: { İpek: 1, Ahmet: 2, Arşiv: 2, Yeni: 3, ...ranks } });
const sync = (state, source = portal(), options = {}) => synchronizePersonRanks(state, source, { fromMonth: '2026-11', currentMonth: '2026-11', ...options });

test('effective group follows history without modifying the base person or legacy fallback', () => {
  const person = { groupId: 'g1', groupHistory: [{ from: '2026-11', groupId: 'g2' }, { from: '2027-01', groupId: 'g3' }] };
  assert.equal(personGroupId(person, '2026-10'), 'g1');
  assert.equal(personGroupId(person, '2026-11'), 'g2');
  assert.equal(personGroupId(person, '2026-12'), 'g2');
  assert.equal(personGroupId(person, '2027-01'), 'g3');
  assert.equal(personGroupId({ groupId: 'g1' }, '2026-11'), 'g1');
  assert.deepEqual(personAtMonth(person, '2026-11'), { ...person, groupId: 'g2' });
  assert.equal(person.groupId, 'g1');
});

test('rank synchronization retains IDs, base groups, lifetimes and all planning collections', () => {
  const state = fixture(), before = structuredClone(state), result = sync(state);
  assert.equal(result.changed, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(state, before);
  assert.equal(result.state.people.length, 3); // New portal people never become duty staff automatically.
  assert.equal(result.state.people[0].id, 'a');
  assert.equal(result.state.people[0].groupId, 'g2');
  assert.deepEqual(result.state.people[0].groupHistory, [{ from: '2026-11', groupId: 'g1' }]);
  assert.deepEqual(result.state.people[2], state.people[2]); // An archived person stays archived.
  for (const key of ['assignments', 'targets', 'capabilities', 'requests', 'absences', 'rotations', 'holidays', 'months']) assert.equal(result.state[key], state[key]);
  assert.equal(result.state.updatedAt, state.updatedAt);
  assert.equal(sync(result.state).changed, false);
  assert.equal(sync(result.state).state, result.state);
});

test('past targets and flags stay unchanged while the current and future months inherit the new group', () => {
  const state = sync(fixture()).state;
  assert.deepEqual(targetFor(state, 'a', '2026-10'), { weekday: 3, weekend: 1 });
  assert.deepEqual(targetFor(state, 'a', '2026-11'), { weekday: 1, weekend: 0 });
  assert.deepEqual(targetFor(state, 'a', '2026-12'), { weekday: 1, weekend: 0 });
  assert.equal(capabilitiesFor(state, 'a', '2026-10').square, true);
  assert.equal(capabilitiesFor(state, 'a', '2026-11').triangle, true);
  state.targets.push({ id: 'personal', personId: 'a', groupId: null, from: '2026-11', through: '2026-11', weekday: 7, weekend: 1 });
  state.capabilities.push({ id: 'pc', personId: 'a', groupId: null, from: '2026-11', through: '2026-11', triangle: false, square: true, circle: false, companion: false });
  assert.equal(targetFor(state, 'a', '2026-11').weekday, 7);
  assert.equal(targetFor(state, 'a', '2026-12').weekday, 1);
  assert.equal(capabilitiesFor(state, 'a', '2026-11').square, true);
  assert.equal(capabilitiesFor(state, 'a', '2026-12').triangle, true);
});

test('month-resolved active lists, sorting, sharing and CSV all use the effective group', () => {
  const state = sync(fixture()).state;
  assert.equal(activePeople(state, '2026-11').find(p => p.id === 'a').groupId, 'g1');
  assert.equal(state.people[0].groupId, 'g2');
  assert.deepEqual(sortPeopleBySeniority(state, '2026-10', state.people.slice(0, 2)).map(p => p.id), ['b', 'a']);
  assert.deepEqual(sortPeopleBySeniority(state, '2026-11', state.people.slice(0, 2)).map(p => p.id), ['a', 'b']);
  assert.deepEqual(buildShareModel(state, '2026-10').rows[5].hospitals[1].names, ['Ahmet', 'İpek']);
  assert.deepEqual(buildShareModel(state, '2026-11').rows[1].hospitals[1].names, ['İpek', 'Ahmet']);
  assert.match(summaryCSV(state, '2026-10'), /2026-10;İpek;2;/u);
  assert.match(summaryCSV(state, '2026-11'), /2026-11;İpek;1;/u);
});

test('new current rank entries preserve previous month history and replace the same-month rank deterministically', () => {
  const november = sync(fixture()).state;
  const december = sync(november, portal({ İpek: 2, Ahmet: 1 }), { currentMonth: '2026-12' }).state;
  assert.equal(personGroupId(december.people[0], '2026-10'), 'g2');
  assert.equal(personGroupId(december.people[0], '2026-11'), 'g1');
  assert.equal(personGroupId(december.people[0], '2026-12'), 'g2');
  assert.deepEqual(december.people[0].groupHistory, [{ from: '2026-11', groupId: 'g1' }, { from: '2026-12', groupId: 'g2' }]);
  const corrected = sync(december, portal(), { currentMonth: '2026-12' }).state;
  assert.deepEqual(corrected.people[0].groupHistory, [{ from: '2026-11', groupId: 'g1' }]);
  assert.equal(sync(corrected, portal(), { currentMonth: '2026-12' }).changed, false);
});

test('synchronization never begins before the configured cutoff or Istanbul current month', () => {
  const state = sync(fixture(), portal(), { fromMonth: '2026-12' }).state;
  assert.equal(personGroupId(state.people[0], '2026-11'), 'g2');
  assert.equal(personGroupId(state.people[0], '2026-12'), 'g1');
  assert.throws(() => sync(fixture(), portal(), { currentMonth: '2026-13' }), RangeError);
  assert.throws(() => sync(fixture(), portal(), { fromMonth: '0000-11' }), RangeError);
});

test('name matching uses Turkish case, canonical Unicode and whitespace but never strips accents', () => {
  const state = fixture();
  const good = sync(state, { assistants: ['  İPEK ', 'Ahmet'], assistantRanks: { '  İPEK ': 1, Ahmet: 2 } });
  assert.equal(personGroupId(good.state.people[0], '2026-11'), 'g1');
  const missing = sync(state, { assistants: ['Ipek', 'Ahmet'], assistantRanks: { Ipek: 1, Ahmet: 2 } });
  assert.equal(personGroupId(missing.state.people[0], '2026-11'), 'g2');
  assert.equal(missing.warnings[0].code, 'source-rank-name');
  const duplicate = sync(state, { assistants: ['İpek', 'İPEK', 'Ahmet'], assistantRanks: { İpek: 1, İPEK: 1, Ahmet: 2 } });
  assert.equal(personGroupId(duplicate.state.people[0], '2026-11'), 'g2');
  assert.equal(duplicate.warnings[0].code, 'source-rank-name');
});

test('missing or invalid source ranks preserve the existing group and produce a warning', () => {
  const state = fixture();
  for (const rank of [undefined, 0, 1.5, '1', NaN]) {
    const result = sync(state, portal({ İpek: rank }));
    assert.equal(personGroupId(result.state.people[0], '2026-11'), 'g2');
    assert.ok(result.warnings.some(item => item.personId === 'a' && item.code === 'source-rank-missing'));
  }
});

test('a missing new rank adds one stable group without changing old groups, targets or capabilities', () => {
  const state = fixture(), result = sync(state, portal({ İpek: 3 }));
  assert.equal(result.state.groups.length, 3);
  assert.deepEqual(result.state.groups.slice(0, 2), state.groups);
  assert.equal(personGroupId(result.state.people[0], '2026-11'), 'portal-rank-3-2026-11');
  assert.equal(targetFor(result.state, 'a', '2026-11'), null);
  assert.deepEqual(capabilitiesFor(result.state, 'a', '2026-11'), { triangle: false, square: false, circle: false, companion: false });
  assert.equal(sync(result.state, portal({ İpek: 3 })).changed, false);
});

test('rank thirteen with eleven existing groups fills the twelfth slot and stays source-aligned on repeated sync', () => {
  const state = fixture();
  for (let rank = 3; rank <= 11; rank++) state.groups.push({ id: `g${rank}`, order: rank, from: '2026-10', until: null });
  const source = portal({ İpek: 13 });
  for (let rank = 4; rank <= 13; rank++) source.assistants.push(`Başka ${rank}`);
  const result = sync(state, source);
  assert.equal(result.state.groups.length, 13);
  assert.ok(result.state.groups.some(group => group.id === 'portal-rank-12-2026-11'));
  assert.ok(result.state.groups.some(group => group.id === 'portal-rank-13-2026-11'));
  assert.equal(rankOf(result.state, personGroupId(result.state.people[0], '2026-11'), '2026-11'), 13);
  assert.equal(sync(result.state, source).changed, false);
  assert.equal(sync(result.state, source).state, result.state);
  assert.equal(personGroupId(result.state.people[0], '2026-10'), 'g2');
});

test('impossible noncompact source rank is warned without generating unbounded empty groups', () => {
  const result = sync(fixture(), portal({ İpek: Number.MAX_SAFE_INTEGER }));
  assert.equal(result.state.groups.length, 2);
  assert.equal(personGroupId(result.state.people[0], '2026-11'), 'g2');
  assert.ok(result.warnings.some(item => item.personId === 'a' && item.code === 'source-rank-missing'));
});

test('history structural validation rejects bad references, months, duplicates and ordering', () => {
  for (const history of [{}, [null], [{ from: '2026-13', groupId: 'g1' }], [{ from: '2026-11', groupId: 'missing' }],
    [{ from: '2026-11', groupId: 'g1' }, { from: '2026-11', groupId: 'g2' }],
    [{ from: '2026-12', groupId: 'g1' }, { from: '2026-11', groupId: 'g2' }]]) {
    const state = fixture(); state.people[0].groupHistory = history;
    assert.equal(validateState(state).valid, false);
  }
  assert.equal(validateState(sync(fixture()).state).valid, true);
  assert.equal(validateState(fixture()).valid, true);
});

test('duty validation and publication use the effective group while retaining previous-month validity', () => {
  const state = fixture();
  state.groups[1].until = '2026-11';
  state.people[0].groupHistory = [{ from: '2026-11', groupId: 'g1' }];
  assert.equal(validateState(state).valid, true);
  assert.deepEqual(validateAssignment(state, { personId: 'a', date: '2026-11-04', site: 'Sancaktepe' }).errors, []);
  assert.deepEqual(validateAssignment(state, { personId: 'a', date: '2026-10-08', site: 'Sancaktepe' }).errors, []);
  const published = { ...portal(), dutyRoster: {}, manualAssignments: {}, locations: [] };
  assert.equal(createPublicationPreview(state, published, '2026-11').canPublish, true);
  assert.equal(createPublicationPreview(state, published, '2026-10').canPublish, true);
});
