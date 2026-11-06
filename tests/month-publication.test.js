import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationPreview, applyPublication, normalizePublicationName } from '../src/month-publication.js';

function fixture() {
  const draft = {
    people: [
      { id: 'ahmet', name: 'Ahmet Özdemir', groupId: 'g1', from: '2026-10-01', until: null },
      { id: 'deniz', name: 'Deniz', groupId: 'g2', from: '2026-10-01', until: null },
      { id: 'isa', name: 'İsa', groupId: 'g2', from: '2026-10-01', until: null },
    ],
    groups: [
      { id: 'g1', from: '2026-10', until: null },
      { id: 'g2', from: '2026-10', until: null },
    ],
    assignments: [
      { id: 'one', personId: 'ahmet', date: '2026-11-02', site: 'Sancaktepe', overrides: [] },
      { id: 'two', personId: 'deniz', date: '2026-11-02', site: 'Feriha Öz', overrides: ['avoid'] },
    ],
    targets: [{ personId: 'ahmet', weekday: 2, weekend: 1 }],
    requests: [{ personId: 'deniz', kind: 'avoid' }],
  };
  const portal = {
    assistants: ['Ahmet Özdemir', 'Deniz', 'İsa'],
    assistantRanks: { 'Ahmet Özdemir': 1, Deniz: 2, İsa: 2 },
    dutyRoster: {
      '2026-10-30': [{ name: 'Ahmet Özdemir', site: 'Çekmeköy' }],
      '2026-11-02': [{ name: 'İsa', site: 'Çekmeköy' }],
      '2026-11-20': [{ name: 'Deniz', site: 'Feriha Öz' }],
      '2026-12-03': [{ name: 'Deniz', site: 'Çekmeköy' }],
    },
    locations: [
      { id: 'room', name: 'Ameliyathane', kind: 'normal', site: 'Sancaktepe' },
      { id: 'leave', name: 'Yıllık izin', kind: 'leave', site: 'Diğer' },
      { id: 'post', name: 'Nöbet ertesi', kind: 'postDuty', site: 'Diğer' },
    ],
    manualAssignments: {
      '2026-11-02': { room: ['Ahmet Özdemir'] },
      '2026-11-03': { room: ['Ahmet Özdemir', 'Deniz', 'İsa'], leave: ['Deniz'] },
      '2026-12-04': { room: ['Deniz'] },
    },
    specialistDutyRoster: { '2026-11-02': [{ name: 'Uzman', site: 'Feriha C123' }] },
    rotatorRoster: { '2026-11-02': ['Rotasyoner'] },
    unknownFutureField: { preserve: true },
  };
  return { draft, portal };
}

const codes = result => result.errors.map(error => error.code);

test('selected month replaces only assistant duty projection and next-day normal work', () => {
  const { draft, portal } = fixture();
  const beforeDraft = structuredClone(draft), beforePortal = structuredClone(portal);
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(preview.canPublish, true);
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.changedDays, ['2026-11-02', '2026-11-20']);
  assert.equal(preview.addedCount, 2);
  assert.equal(preview.removedCount, 2);
  assert.equal(preview.removedRoomAssignments.length, 2);
  const next = applyPublication(portal, preview, draft);
  assert.deepEqual(next.dutyRoster['2026-11-02'], [
    { name: 'Ahmet Özdemir', site: 'Sancaktepe' }, { name: 'Deniz', site: 'Feriha Öz' },
  ]);
  assert.deepEqual(next.dutyRoster['2026-11-20'], []);
  assert.deepEqual(next.dutyRoster['2026-10-30'], portal.dutyRoster['2026-10-30']);
  assert.deepEqual(next.dutyRoster['2026-12-03'], portal.dutyRoster['2026-12-03']);
  assert.deepEqual(next.manualAssignments['2026-11-02'], portal.manualAssignments['2026-11-02']);
  assert.deepEqual(next.manualAssignments['2026-11-03'], { room: ['İsa'], leave: ['Deniz'] });
  assert.deepEqual(next.manualAssignments['2026-12-04'], portal.manualAssignments['2026-12-04']);
  for (const key of ['specialistDutyRoster', 'rotatorRoster', 'unknownFutureField']) assert.deepEqual(next[key], portal[key]);
  assert.deepEqual(draft, beforeDraft);
  assert.deepEqual(portal, beforePortal);
  next.assistants.push('Snapshot only');
  assert.deepEqual(portal, beforePortal);
});

test('blank dates explicitly remove old duties and an empty month requires an advisory', () => {
  const { draft, portal } = fixture();
  draft.assignments = [];
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(preview.canPublish, true);
  assert.equal(Object.keys(preview.monthRoster).length, 30);
  assert.ok(Object.values(preview.monthRoster).every(entries => entries.length === 0));
  assert.equal(preview.warnings[0].code, 'empty-month');
  assert.deepEqual(applyPublication(portal, preview).dutyRoster['2026-11-20'], []);
  assert.deepEqual(applyPublication(portal, preview).manualAssignments, portal.manualAssignments);
});

test('only exact Turkish case, whitespace and Unicode canonical equivalence are matched', () => {
  const { draft, portal } = fixture();
  draft.people[0].name = '  AHMET\t ÖZDEMİR  ';
  assert.equal(createPublicationPreview(draft, portal, '2026-11').canPublish, true);
  draft.people[0].name = 'Ahmet Özdemir';
  assert.equal(createPublicationPreview(draft, portal, '2026-11').canPublish, true);
  draft.people[0].name = 'Ahmet Ozdemir';
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('unknown-name'));
  assert.equal(normalizePublicationName(' İSA '), 'isa');
  assert.notEqual(normalizePublicationName('Işık'), normalizePublicationName('Isik'));
});

test('missing and ambiguous portal names cannot be published', () => {
  const { draft, portal } = fixture();
  portal.assistants = portal.assistants.filter(name => name !== 'Deniz');
  const missing = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(missing.canPublish, false);
  assert.ok(codes(missing).includes('unknown-name'));
  assert.throws(() => applyPublication(portal, missing), /uygulanamaz/);
  portal.assistants.push('Deniz', 'DENİZ');
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('ambiguous-name'));
});

test('two different draft IDs with one canonical name cannot collapse to one assistant', () => {
  const { draft, portal } = fixture();
  draft.people.push({ ...draft.people[0], id: 'other-ahmet' });
  draft.assignments.push({ id: 'three', personId: 'other-ahmet', date: '2026-11-05', site: 'Feriha Öz' });
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('ambiguous-draft-name'));
});

test('unassigned archived draft people do not block publication while inactive selected assignees do', () => {
  const { draft, portal } = fixture();
  draft.people.push({ id: 'old', name: 'Arşiv Kişi', groupId: 'g1', from: '2026-10-01', until: '2026-11-01' });
  assert.equal(createPublicationPreview(draft, portal, '2026-11').canPublish, true);
  draft.people[0].until = '2026-11-02';
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('inactive-person'));
  draft.people[0].until = null;
  draft.groups[0].until = '2026-11';
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('inactive-person'));
});

test('a historical assignee can publish when active on the duty date and present in portal', () => {
  const { draft, portal } = fixture();
  draft.people[0].until = '2026-11-03';
  assert.equal(createPublicationPreview(draft, portal, '2026-11').canPublish, true);
});

test('duplicate and consecutive draft duties block even at different hospitals', () => {
  const { draft, portal } = fixture();
  draft.assignments.push({ ...draft.assignments[0], id: 'duplicate', site: 'Çekmeköy' });
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('duplicate-duty'));
  draft.assignments.at(-1).date = '2026-11-03';
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('consecutive-duty'));
});

test('actual published neighboring months guard both boundaries instead of trusting draft history', () => {
  const { draft, portal } = fixture();
  draft.assignments = [{ id: 'first', personId: 'ahmet', date: '2026-11-01', site: 'Sancaktepe' }];
  portal.dutyRoster['2026-10-31'] = [{ name: 'Ahmet Özdemir', site: 'Feriha Öz' }];
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('consecutive-duty'));
  delete portal.dutyRoster['2026-10-31'];
  draft.assignments[0].date = '2026-11-30';
  portal.dutyRoster['2026-12-01'] = [{ name: 'Ahmet Özdemir', site: 'Çekmeköy' }];
  assert.ok(codes(createPublicationPreview(draft, portal, '2026-11')).includes('consecutive-duty'));
});

test('month-end duty removes only that person from next month first-day normal locations', () => {
  const { draft, portal } = fixture();
  draft.assignments = [{ id: 'last', personId: 'ahmet', date: '2026-11-30', site: 'Feriha Öz' }];
  portal.manualAssignments['2026-12-01'] = { room: ['Ahmet Özdemir', 'Deniz'], leave: ['Ahmet Özdemir'], post: ['Ahmet Özdemir'] };
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.deepEqual(preview.removedRoomAssignments.map(item => [item.date, item.dutyDate, item.locationId, item.name]), [['2026-12-01', '2026-11-30', 'room', 'Ahmet Özdemir']]);
  const next = applyPublication(portal, preview);
  assert.deepEqual(next.manualAssignments['2026-12-01'], { room: ['Deniz'], leave: ['Ahmet Özdemir'], post: ['Ahmet Özdemir'] });
});

test('draft assignments outside selected month never replace published other-month lists', () => {
  const { draft, portal } = fixture();
  draft.assignments.push({ id: 'draft-other', personId: 'isa', date: '2026-12-03', site: 'Sancaktepe' });
  const next = applyPublication(portal, createPublicationPreview(draft, portal, '2026-11'));
  assert.deepEqual(next.dutyRoster['2026-12-03'], portal.dutyRoster['2026-12-03']);
});

test('canonical portal names and portal seniority are preserved in published ordering', () => {
  const { draft, portal } = fixture();
  draft.assignments[1].site = 'Sancaktepe';
  portal.assistants[0] = 'AHMET ÖZDEMİR';
  portal.assistantRanks = { 'AHMET ÖZDEMİR': 3, Deniz: 1 };
  assert.deepEqual(createPublicationPreview(draft, portal, '2026-11').monthRoster['2026-11-02'], [
    { name: 'Deniz', site: 'Sancaktepe' }, { name: 'AHMET ÖZDEMİR', site: 'Sancaktepe' },
  ]);
});

test('publication is idempotent and does not clear unrelated existing room conflicts', () => {
  const { draft, portal } = fixture();
  const first = applyPublication(portal, createPublicationPreview(draft, portal, '2026-11'));
  const preview = createPublicationPreview(draft, first, '2026-11');
  assert.equal(preview.canPublish, true);
  assert.equal(preview.hasChanges, false);
  assert.deepEqual(preview.changedDays, []);
  assert.equal(preview.removedRoomAssignments.length, 0);
  assert.deepEqual(applyPublication(first, preview), first);
  assert.deepEqual(first.manualAssignments['2026-12-04'], portal.manualAssignments['2026-12-04']);
});

test('target and overridden request audit warnings remain visible and nonblocking', () => {
  const { draft, portal } = fixture();
  const warning = { code: 'under-target', message: 'Ahmet hedefin altında.' };
  const preview = createPublicationPreview(draft, portal, '2026-11', { warnings: [warning] });
  assert.equal(preview.canPublish, true);
  assert.deepEqual(preview.warnings, [warning]);
  assert.notEqual(preview.warnings[0], warning);
});

test('intervening portal edits or draft edits require a fresh preview', () => {
  const { draft, portal } = fixture();
  const preview = createPublicationPreview(draft, portal, '2026-11');
  portal.specialistDutyRoster['2026-11-03'] = [];
  assert.throws(() => applyPublication(portal, preview), /Asistan sistemi önizlemeden sonra değişti/);
  delete portal.specialistDutyRoster['2026-11-03'];
  draft.assignments[0].site = 'Çekmeköy';
  assert.throws(() => applyPublication(portal, preview, draft), /Nöbet taslağı önizlemeden sonra değişti/);
});

test('cloud JSON object-key ordering does not invalidate an unchanged preview', () => {
  const { draft, portal } = fixture();
  const preview = createPublicationPreview(draft, portal, '2026-11');
  const reordered = Object.fromEntries(Object.entries(portal).reverse());
  reordered.assistantRanks = Object.fromEntries(Object.entries(portal.assistantRanks).reverse());
  assert.deepEqual(applyPublication(reordered, preview), applyPublication(portal, preview));
});

test('published Asistan leave conflicts are advisory and do not remove leave records', () => {
  const { draft, portal } = fixture();
  portal.manualAssignments['2026-11-02'].leave = ['Deniz'];
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(preview.canPublish, true);
  assert.equal(preview.warnings.some(item => item.code === 'portal-leave'), true);
  assert.deepEqual(applyPublication(portal, preview).manualAssignments['2026-11-02'].leave, ['Deniz']);
});

test('caller edits to proposed projected fields cannot overwrite other months or portal data', () => {
  const { draft, portal } = fixture();
  const preview = createPublicationPreview(draft, portal, '2026-11');
  preview.nextDutyRoster['2026-12-03'] = [];
  preview.nextManualAssignments['2026-12-04'] = {};
  const next = applyPublication(portal, preview);
  assert.deepEqual(next.dutyRoster['2026-12-03'], portal.dutyRoster['2026-12-03']);
  assert.deepEqual(next.manualAssignments['2026-12-04'], portal.manualAssignments['2026-12-04']);
  preview.draftSnapshot.assignments[0].site = 'Çekmeköy';
  assert.throws(() => applyPublication(portal, preview), /Onaylanan nöbet önizlemesi değişti/);
});

test('invalid month, dates, sites and missing references cannot silently publish', () => {
  const { draft, portal } = fixture();
  assert.throws(() => createPublicationPreview(draft, portal, '2026-13'), RangeError);
  for (const patch of [{ date: '2026-11-31' }, { site: 'Bilinmeyen' }, { personId: 'unknown' }]) {
    const candidate = structuredClone(draft);
    Object.assign(candidate.assignments[0], patch);
    assert.equal(createPublicationPreview(candidate, portal, '2026-11').canPublish, false);
  }
  assert.equal(createPublicationPreview({}, portal, '2026-11').canPublish, false);
  assert.equal(createPublicationPreview(draft, {}, '2026-11').canPublish, false);
});

function recoveryFixture() {
  const { draft, portal } = fixture();
  draft.assignments = draft.assignments.filter(row => row.personId === 'ahmet');
  const first = createPublicationPreview(draft, portal, '2026-11');
  const published = applyPublication(portal, first, draft);
  const removed = first.removedRoomAssignments.find(row => row.name === 'Ahmet Özdemir');
  const change = { id: 'change-1', month: '2026-11', ...removed,
    roomBefore: structuredClone(portal.manualAssignments[removed.date][removed.locationId]),
    dayAfter: structuredClone(published.manualAssignments[removed.date]), invalidatedAt: null, restoredAt: null };
  return { draft: { ...draft, assignments: [] }, portal: published, change };
}

test('a cancelled published duty offers a recorded old room but never restores without selection', () => {
  const { draft, portal, change } = recoveryFixture();
  const before = structuredClone(portal);
  const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change] });
  assert.equal(preview.canPublish, true);
  assert.equal(preview.restorableRoomAssignments.length, 1);
  assert.equal(preview.restoredRoomAssignments.length, 0);
  assert.equal(preview.nextManualAssignments['2026-11-03'].room.includes(change.name), false);
  assert.deepEqual(portal, before);
});

test('only explicitly selected safe recovery is applied and caller edits to projected room data are ignored', () => {
  const { draft, portal, change } = recoveryFixture();
  const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change], restoreRoomChangeIds: [change.id] });
  assert.equal(preview.canPublish, true);
  assert.equal(preview.restoredRoomAssignments.length, 1);
  preview.nextManualAssignments['2026-11-03'].room = ['Injected'];
  const applied = applyPublication(portal, preview, draft);
  assert.deepEqual(applied.manualAssignments['2026-11-03'].room, ['Deniz', 'İsa', 'Ahmet Özdemir']);
  assert.deepEqual(applied.specialistDutyRoster, portal.specialistDutyRoster);
  assert.deepEqual(applied.dutyRoster['2026-12-03'], portal.dutyRoster['2026-12-03']);
});

test('recovery refuses stale manual-day snapshots and retired or already restored journal records', () => {
  for (const mutate of [
    ({ portal }) => { portal.manualAssignments['2026-11-03'].room.push('Other'); },
    ({ change }) => { change.invalidatedAt = '2026-11-06T12:00:00Z'; },
    ({ change }) => { change.restoredAt = '2026-11-06T12:00:00Z'; },
  ]) {
    const f = recoveryFixture(); mutate(f);
    assert.equal(createPublicationPreview(f.draft, f.portal, '2026-11', { roomChanges: [f.change] }).restorableRoomAssignments.length, 0);
  }
});

test('recovery refuses leave, another room or status placement even when a journal snapshot matches', () => {
  for (const location of ['leave', 'room-two', 'post']) {
    const { draft, portal, change } = recoveryFixture();
    portal.manualAssignments['2026-11-03'][location] = [change.name];
    change.dayAfter = structuredClone(portal.manualAssignments['2026-11-03']);
    assert.equal(createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change] }).restorableRoomAssignments.length, 0);
  }
});

test('recovery refuses new same-day duty and a remaining previous-day duty at any hospital', () => {
  for (const date of ['2026-11-02', '2026-11-03']) {
    const { draft, portal, change } = recoveryFixture();
    draft.assignments = [{ personId: 'ahmet', date, site: 'Çekmeköy' }];
    assert.equal(createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change] }).restorableRoomAssignments.length, 0);
  }
});

test('recovery respects closed, not-yet-open, moved and non-normal rooms and excludes weekends', () => {
  for (const mutate of [
    f => { f.portal.locations[0].activeUntil = '2026-11-03'; },
    f => { f.portal.locations[0].activeFrom = '2026-11-04'; },
    f => { f.portal.locations[0].site = 'Feriha Öz'; },
    f => { f.portal.locations[0].kind = 'leave'; },
    f => { f.change.date = '2026-11-08'; f.change.dutyDate = '2026-11-07'; f.portal.manualAssignments[f.change.date] = f.change.dayAfter; },
  ]) {
    const f = recoveryFixture(); mutate(f);
    assert.equal(createPublicationPreview(f.draft, f.portal, '2026-11', { roomChanges: [f.change] }).restorableRoomAssignments.length, 0);
  }
});

test('recovery never invents provenance and rejects unknown, duplicate or stale selection IDs', () => {
  const { draft, portal, change } = recoveryFixture();
  assert.equal(createPublicationPreview(draft, portal, '2026-11').restorableRoomAssignments.length, 0);
  for (const ids of [['unknown'], [change.id, change.id]]) {
    const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change], restoreRoomChangeIds: ids });
    assert.equal(preview.canPublish, false);
    assert.ok(preview.errors.some(row => row.code === 'invalid-room-restoration'));
  }
});

test('two old rooms can be offered as alternatives but the same person cannot restore into both', () => {
  const { draft, portal, change } = recoveryFixture();
  portal.locations.push({ id: 'other-room', kind: 'normal', site: 'Sancaktepe', name: 'Diğer oda' });
  const second = { ...change, id: 'change-2', locationId: 'other-room' };
  const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change, second], restoreRoomChangeIds: [change.id, second.id] });
  assert.equal(preview.restorableRoomAssignments.length, 2);
  assert.equal(preview.canPublish, false);
  assert.ok(preview.errors.some(row => row.code === 'duplicate-room-restoration'));
});

test('recovery is month-scoped, name-canonical and indifferent to jsonb key ordering', () => {
  const { draft, portal, change } = recoveryFixture();
  change.name = '  ahmet   özdemir '; change.roomBefore = ['Ahmet Özdemir'];
  change.dayAfter = Object.fromEntries(Object.entries(change.dayAfter).reverse());
  const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change, { ...change, id: 'other', month: '2026-10' }] });
  assert.equal(preview.restorableRoomAssignments.length, 1);
  assert.equal(preview.restorableRoomAssignments[0].name, 'Ahmet Özdemir');
});

test('known annual/excused planner leave blocks room recovery while duty exemption alone does not', () => {
  for (const type of ['annual', 'excused', 'exempt']) {
    const { draft, portal, change } = recoveryFixture();
    draft.absences = [{ personId: 'ahmet', type, start: '2026-11-03', end: '2026-11-03' }];
    const preview = createPublicationPreview(draft, portal, '2026-11', { roomChanges: [change] });
    assert.equal(preview.restorableRoomAssignments.length, type === 'exempt' ? 1 : 0);
  }
});

test('explicit master re-inclusion can publish a formerly archived assistant and cohort without rewriting history', () => {
  const { draft, portal } = fixture();
  draft.assignments = draft.assignments.filter(row => row.personId === 'ahmet');
  draft.people[0].until = '2026-11-01';
  draft.people[0].rosterHistory = [{ from: '2026-11', enabled: true }];
  draft.groups[0].until = '2026-11';
  const before = structuredClone(draft);
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(preview.canPublish, true, JSON.stringify(preview.errors));
  assert.equal(preview.monthRoster['2026-11-02'][0].name, 'Ahmet Özdemir');
  assert.deepEqual(draft, before);
  assert.equal(preview.draftSnapshot.people[0].until, '2026-11-01');
  assert.equal(preview.draftSnapshot.groups[0].until, '2026-11');
});

test('master disabling preserves stored duties but blocks publishing until the conflict is resolved', () => {
  const { draft, portal } = fixture();
  draft.people[0].rosterHistory = [{ from: '2026-11', enabled: false }];
  const before = structuredClone(draft);
  const preview = createPublicationPreview(draft, portal, '2026-11');
  assert.equal(preview.canPublish, false);
  assert.ok(preview.errors.some(row => row.code === 'inactive-person' && row.personId === 'ahmet'));
  assert.deepEqual(draft, before);
  assert.ok(draft.assignments.some(row => row.personId === 'ahmet' && row.date === '2026-11-02'));
  assert.throws(() => applyPublication(portal, preview, draft), /Yayınlanamayan/);
});

test('a future master roster change does not retroactively disable the earlier publication month', () => {
  const { draft, portal } = fixture();
  draft.people[0].rosterHistory = [{ from: '2026-12', enabled: false }];
  assert.equal(createPublicationPreview(draft, portal, '2026-11').canPublish, true);
  draft.assignments = [{ personId: 'ahmet', date: '2026-12-07', site: 'Sancaktepe' }];
  const december = createPublicationPreview(draft, portal, '2026-12');
  assert.equal(december.canPublish, false);
  assert.ok(december.errors.some(row => row.code === 'inactive-person' && row.personId === 'ahmet'));
});
