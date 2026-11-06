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
