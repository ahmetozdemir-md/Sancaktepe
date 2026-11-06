import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizePlannerSource } from '../src/plannerSourceSync.js';
import { validateState } from '../public/nobet-planlayici/state-schema.js';

const options = { fromMonth: '2026-11', currentMonth: '2026-11', rosterPolicy: 'preserve-active' };
function fixture() {
  const draft = {
    schemaVersion: 1, updatedAt: '2026-11-06T12:00:00Z',
    groups: [{ id: 'g1', order: 1, from: '2026-10', until: null }],
    people: [
      { id: 'a', name: 'Ahmet Özdemir', groupId: 'g1', from: '2026-10-01', until: null },
      { id: 'i', name: 'İsa', groupId: 'g1', from: '2026-10-01', until: null },
      { id: 'old', name: 'Arşivli', groupId: 'g1', from: '2026-10-01', until: '2026-11-01' },
    ],
    targets: [{ id: 't', personId: 'a', groupId: null, from: '2026-10', weekday: 2, weekend: 1 }],
    assignments: [{ id: 'd', personId: 'a', date: '2026-11-02', site: 'Sancaktepe', overrides: [] }],
    absences: [{ id: 'absence', personId: 'i', start: '2026-11-05', end: '2026-11-06', type: 'annual', note: '' }],
    requests: [{ id: 'request', personId: 'a', start: '2026-11-10', end: '2026-11-10', kind: 'avoid', note: '' }],
    capabilities: [{ id: 'cap', personId: 'a', groupId: null, from: '2026-10', triangle: false, circle: false, square: true, companion: false }],
    rotations: [], holidays: [], months: { '2026-11': { completedAt: null } },
    unknownFutureField: { keep: true },
  };
  const portal = {
    assistants: ['Ahmet Özdemir', 'İsa', 'Arşivli', 'Yeni Rotasyoner'],
    assistantRanks: { 'Ahmet Özdemir': 1, İsa: 1, Arşivli: 1, 'Yeni Rotasyoner': 1 },
    locations: [
      { id: 's', kind: 'normal', site: 'Sancaktepe', name: 'Ameliyathane 1' },
      { id: 'f', kind: 'normal', site: 'Feriha Öz', name: 'C1 Yoğun Bakım Ünitesi' },
      { id: 'c', kind: 'normal', site: 'Çekmeköy', name: 'Ameliyathane' },
      { id: 'leave', kind: 'leave', site: 'Diğer', name: 'Rotasyon' },
    ],
    locationOwnersByMonth: { '2026-11': { s: ['Ahmet Özdemir', 'Arşivli', 'Yeni Rotasyoner'], f: [], c: [] } },
    postDutyPoolByMonth: { '2026-11': ['İsa'] },
    locationOwners: { f: ['İsa'] },
    manualAssignments: { '2026-11-06': { f: ['Ahmet Özdemir'] } },
  };
  return { draft, portal };
}
const sync = (draft, portal, override = {}) => synchronizePlannerSource(draft, portal, { ...options, ...override });
const rotations = (state, personId) => state.rotations.filter(row => row.personId === personId).map(row => ({ start: row.start, end: row.end, site: row.site, unit: row.unit }));

test('monthly room owners and hospital-less pool import without changing membership, lifetimes or schedules', () => {
  const { draft, portal } = fixture(), before = structuredClone(draft), sourceBefore = structuredClone(portal);
  const result = sync(draft, portal);
  assert.equal(result.changed, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(rotations(result.state, 'a'), [{ start: '2026-11-01', end: '2026-11-30', site: 'Sancaktepe', unit: 'Ameliyathane 1' }]);
  assert.deepEqual(rotations(result.state, 'i'), [{ start: '2026-11-01', end: '2026-11-30', site: null, unit: 'Nöbet ertesi' }]);
  assert.deepEqual(rotations(result.state, 'old'), []);
  for (const key of ['people', 'groups', 'targets', 'assignments', 'absences', 'requests', 'capabilities', 'months', 'unknownFutureField', 'updatedAt']) assert.deepEqual(result.state[key], draft[key], key);
  assert.equal(validateState(result.state).valid, true);
  assert.deepEqual(draft, before);
  assert.deepEqual(portal, sourceBefore);
});

test('exact Turkish case, whitespace and Unicode names resolve to existing IDs without fuzzy accents', () => {
  const { draft, portal } = fixture();
  draft.people[0].name = ' AHMET\t ÖZDEMİR ';
  portal.locationOwnersByMonth['2026-11'].s = ['Ahmet  Özdemir'];
  const result = sync(draft, portal);
  assert.equal(result.state.people[0].name, 'Ahmet Özdemir');
  assert.equal(result.state.people[0].id, 'a');
  assert.equal(result.state.rotations.find(row => row.personId === 'a').site, 'Sancaktepe');
  portal.locationOwnersByMonth['2026-11'].s = ['Ahmet Ozdemir'];
  const unknown = sync(draft, portal);
  assert.ok(unknown.warnings.some(item => item.code === 'unknown-source-person'));
  assert.deepEqual(rotations(unknown.state, 'a'), []);
});

test('ambiguous portal and draft names are skipped instead of assigning by arbitrary identity', () => {
  const { draft, portal } = fixture();
  portal.assistants.push('AHMET ÖZDEMİR');
  const ambiguousPortal = sync(draft, portal);
  assert.ok(ambiguousPortal.warnings.some(item => item.code === 'ambiguous-person'));
  assert.deepEqual(rotations(ambiguousPortal.state, 'a'), []);
  portal.assistants.pop();
  draft.people.push({ ...draft.people[0], id: 'duplicate' });
  const ambiguousDraft = sync(draft, portal);
  assert.ok(ambiguousDraft.warnings.some(item => item.code === 'ambiguous-person'));
  assert.deepEqual(ambiguousDraft.state.rotations.filter(row => row.site === 'Sancaktepe'), []);
});

test('genuine renames warn for active unmatched staff while retaining IDs, membership and history', () => {
  const { draft, portal } = fixture();
  draft.rotations = [{ id: 'history', personId: 'a', start: '2026-10-01', end: '2026-10-31', site: 'Feriha Öz', unit: 'Ameliyathane' }];
  portal.assistants[0] = 'Ahmet Ali Özdemir';
  portal.locationOwnersByMonth['2026-11'].s = ['Ahmet Ali Özdemir', 'Arşivli', 'Yeni Rotasyoner'];
  portal.assistants = portal.assistants.filter(name => name !== 'Arşivli');
  const result = sync(draft, portal);
  assert.ok(result.warnings.some(item => item.code === 'missing-source-person' && item.personId === 'a'));
  assert.equal(result.warnings.some(item => item.code === 'missing-source-person' && item.personId === 'old'), false);
  assert.deepEqual(result.state.people, draft.people);
  assert.deepEqual(result.state.assignments, draft.assignments);
  assert.deepEqual(result.state.rotations.filter(row => row.personId === 'a'), draft.rotations);
});

test('missing source month never borrows legacy owners, other months or daily work', () => {
  const { draft, portal } = fixture();
  portal.locationOwnersByMonth = { '2026-10': { f: ['Ahmet Özdemir'] } };
  portal.postDutyPoolByMonth = {};
  assert.deepEqual(sync(draft, portal).state.rotations, []);
});

test('explicit empty source and missing future source clear copied rotations but preserve earlier history', () => {
  const { draft, portal } = fixture();
  draft.months['2026-12'] = { completedAt: null };
  draft.rotations = [{ id: 'manual', personId: 'a', start: '2026-10-01', end: '2027-01-31', site: 'Feriha Öz', unit: 'Ancien' }];
  portal.locationOwnersByMonth = { '2026-11': {} }; portal.postDutyPoolByMonth = { '2026-11': [] };
  const result = sync(draft, portal);
  assert.deepEqual(rotations(result.state, 'a'), [
    { start: '2026-10-01', end: '2026-10-31', site: 'Feriha Öz', unit: 'Ancien' },
    { start: '2027-01-01', end: '2027-01-31', site: 'Feriha Öz', unit: 'Ancien' },
  ]);
  assert.equal(result.state.rotations[0].id, 'manual');
  assert.equal(validateState(result.state).valid, true);
  assert.equal(sync(result.state, portal).changed, false);
});

test('future explicit rotations do not invent planner month records', () => {
  const { draft, portal } = fixture();
  portal.locationOwnersByMonth['2026-12'] = { c: ['Ahmet Özdemir'] };
  const result = sync(draft, portal);
  assert.deepEqual(result.state.months, draft.months);
  assert.equal(rotations(result.state, 'a').at(-1).start, '2026-12-01');
});

test('advancing the current month freezes the earlier imported rotation even if portal history changes', () => {
  const { draft, portal } = fixture();
  const first = sync(draft, portal).state;
  portal.locationOwnersByMonth['2026-11'] = { f: ['Ahmet Özdemir'] };
  portal.locationOwnersByMonth['2026-12'] = { c: ['Ahmet Özdemir'] };
  const later = sync(first, portal, { currentMonth: '2026-12' });
  assert.deepEqual(later.state.rotations.filter(row => row.start.startsWith('2026-11')), first.rotations);
  assert.equal(rotations(later.state, 'a').at(-1).site, 'Çekmeköy');
});

test('midmonth room activation and exclusive closure produce correctly clipped deterministic segments', () => {
  const { draft, portal } = fixture();
  portal.locations[0].activeFrom = '2026-11-05'; portal.locations[0].activeUntil = '2026-11-20';
  portal.locations.push({ id: 's2', kind: 'normal', site: 'Sancaktepe', name: 'Yoğun Bakım Ünitesi', activeFrom: '2026-11-10', activeUntil: '2026-11-15' });
  portal.locationOwnersByMonth['2026-11'].s2 = ['Ahmet Özdemir'];
  const result = sync(draft, portal);
  assert.deepEqual(rotations(result.state, 'a'), [
    { start: '2026-11-05', end: '2026-11-09', site: 'Sancaktepe', unit: 'Ameliyathane 1' },
    { start: '2026-11-10', end: '2026-11-14', site: 'Sancaktepe', unit: 'Ameliyathane 1 · Yoğun Bakım Ünitesi' },
    { start: '2026-11-15', end: '2026-11-19', site: 'Sancaktepe', unit: 'Ameliyathane 1' },
  ]);
  assert.equal(sync(result.state, portal).changed, false);
});

test('cross-hospital and pool/room overlaps leave conflicted days blank with one bounded warning', () => {
  const { draft, portal } = fixture();
  portal.locationOwnersByMonth['2026-11'].f = ['Ahmet Özdemir'];
  portal.locations[1].activeFrom = '2026-11-10'; portal.locations[1].activeUntil = '2026-11-15';
  portal.locationOwnersByMonth['2026-11'].c = ['İsa'];
  const result = sync(draft, portal);
  assert.deepEqual(rotations(result.state, 'a').map(row => [row.start, row.end]), [['2026-11-01', '2026-11-09'], ['2026-11-15', '2026-11-30']]);
  assert.deepEqual(rotations(result.state, 'i'), []);
  assert.equal(result.warnings.filter(item => item.code === 'rotation-conflict').length, 2);
  assert.ok(result.warnings.some(item => item.personId === 'a' && item.start === '2026-11-10' && item.end === '2026-11-14'));
});

test('archived source-only names and new portal rotators do not reactivate or add people', () => {
  const { draft, portal } = fixture();
  const result = sync(draft, portal);
  assert.equal(result.state.people.length, 3);
  assert.equal(result.state.people.find(person => person.id === 'old').until, '2026-11-01');
  assert.equal(result.state.rotations.some(row => row.personId === 'old'), false);
  assert.equal(result.warnings.some(item => /Arşivli|Yeni Rotasyoner/u.test(item.message)), false);
});

test('person lifetime clips rotations without changing their core validity dates', () => {
  const { draft, portal } = fixture();
  draft.people[0].from = '2026-11-03'; draft.people[0].until = '2026-11-18';
  assert.deepEqual(rotations(sync(draft, portal).state, 'a'), [{ start: '2026-11-03', end: '2026-11-17', site: 'Sancaktepe', unit: 'Ameliyathane 1' }]);
});

test('rotation activity follows shared monthly rank history while retaining the base cohort identity', () => {
  const { draft, portal } = fixture();
  draft.groups[0].until = '2026-11';
  draft.groups.push({ id: 'g2', order: 2, from: '2026-11', until: null });
  draft.people[0].groupHistory = [{ from: '2026-11', groupId: 'g2' }];
  const result = sync(draft, portal);
  assert.equal(result.state.people[0].groupId, 'g1');
  assert.equal(rotations(result.state, 'a').length, 1);
  assert.equal(rotations(result.state, 'i').length, 0);
  assert.equal(validateState(result.state).valid, true);
});

test('source metadata merges existing fields and repeated polls do not create new IDs or clock writes', () => {
  const { draft, portal } = fixture();
  draft.portalSource = { personRanksVersion: 2, privateSetting: { preserve: true } };
  const first = sync(draft, portal);
  assert.equal(first.state.portalSource.personRanksVersion, 2);
  assert.deepEqual(first.state.portalSource.privateSetting, { preserve: true });
  const second = sync(first.state, structuredClone(portal));
  assert.equal(second.changed, false);
  assert.deepEqual(second.state, first.state);
  second.state.people[0].name = 'Only copy';
  assert.equal(first.state.people[0].name, 'Ahmet Özdemir');
});

test('jsonb object key order and source owner order do not create new synchronization writes', () => {
  const { draft, portal } = fixture();
  const first = sync(draft, portal).state;
  const stored = JSON.parse(JSON.stringify(first, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
  portal.locationOwnersByMonth['2026-11'].s.reverse();
  portal.locations.reverse();
  assert.equal(sync(stored, portal).changed, false);
});

test('deleted source month removes its managed future projection and keeps past generated history', () => {
  const { draft, portal } = fixture();
  portal.locationOwnersByMonth['2027-01'] = { c: ['Ahmet Özdemir'] };
  const first = sync(draft, portal).state;
  delete portal.locationOwnersByMonth['2027-01'];
  const result = sync(first, portal, { currentMonth: '2026-12' });
  assert.equal(result.state.rotations.some(row => row.start.startsWith('2027-01')), false);
  assert.deepEqual(result.state.rotations, first.rotations.filter(row => row.start.startsWith('2026-11')));
});

test('unknown locations and malformed month records are visible without using a guessed hospital', () => {
  const { draft, portal } = fixture();
  portal.locationOwnersByMonth['2026-11'] = { missing: ['Ahmet Özdemir'] };
  portal.postDutyPoolByMonth['2026-11'] = 'İsa';
  const result = sync(draft, portal);
  assert.deepEqual(result.state.rotations, []);
  assert.ok(result.warnings.some(item => item.code === 'unknown-source-location'));
  assert.ok(result.warnings.some(item => item.code === 'invalid-source-pool'));
});

test('outer calendar edges and leap months remain valid', () => {
  const { draft, portal } = fixture();
  draft.months = { '9999-12': { completedAt: null } };
  portal.locationOwnersByMonth = { '9999-12': { s: ['Ahmet Özdemir'] } }; portal.postDutyPoolByMonth = {};
  const far = sync(draft, portal, { fromMonth: '9999-12', currentMonth: '9999-12' });
  assert.equal(far.state.rotations[0].end, '9999-12-31');
  portal.locationOwnersByMonth = { '2028-02': { s: ['Ahmet Özdemir'] } };
  assert.equal(sync(draft, portal, { currentMonth: '2028-02' }).state.rotations[0].end, '2028-02-29');
});

test('invalid roots and effective dates are rejected instead of silently enabling synchronization', () => {
  const { draft, portal } = fixture();
  assert.throws(() => sync(draft, portal, { fromMonth: '2026-13' }), /Eşleştirme/u);
  assert.throws(() => synchronizePlannerSource(null, portal, options), /taslağının/u);
  assert.throws(() => synchronizePlannerSource(draft, { ...portal, assistants: null }, options), /uygulamasının/u);
});
