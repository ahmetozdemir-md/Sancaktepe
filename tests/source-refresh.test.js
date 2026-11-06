import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePlannerSourceFields, plannerSourceCutoff, istanbulMonth, canAdoptPlannerRefresh } from '../public/nobet-planlayici/source-refresh.js';

function fixture() {
  return {
    schemaVersion: 1, updatedAt: '2026-11-06T10:00:00Z',
    people: [{ id: 'p1', name: 'Ahmet', groupId: 'g1', from: '2026-10-01', until: null }],
    groups: [{ id: 'g1', order: 1, from: '2026-10', until: null, localNote: 'keep' }],
    rotations: [
      { id: 'historical', personId: 'p1', start: '2026-09-01', end: '2026-09-30', site: 'Çekmeköy', unit: 'Eski' },
      { id: 'crossing', personId: 'p1', start: '2026-10-01', end: '2026-12-31', site: 'Sancaktepe', unit: 'Yerel' },
      { id: 'future-local', personId: 'p1', start: '2026-12-01', end: '2026-12-31', site: 'Çekmeköy', unit: 'Eski gelecek' },
    ],
    assignments: [{ id: 'a1', personId: 'p1', date: '2026-11-04', site: 'Sancaktepe', overrides: [] }],
    targets: [{ id: 't1', weekday: 4, weekend: 1 }],
    requests: [], absences: [], capabilities: [], holidays: [],
    months: { '2026-11': { completedAt: null } }, planningSettings: { ferihaCapacity: 9 },
  };
}

function canonical(local) {
  const server = structuredClone(local);
  server.people[0] = { ...server.people[0], name: 'Ahmet Özdemir', from: '2030-01-01', until: '2031-01-01', groupHistory: [{ from: '2026-11', groupId: 'g2' }] };
  server.people.push({ id: 'portal-only', name: 'Listede olmayan', from: '2026-11-01', until: null, groupId: 'g2' });
  server.groups[0].localNote = 'server must not overwrite';
  server.groups.push({ id: 'g2', order: 2, from: '2026-11', until: null });
  server.rotations = [{ id: 'crossing', personId: 'p1', start: '2026-10-01', end: '2026-12-31', site: 'Feriha Öz', unit: 'Yoğun bakım', source: 'asistan-portal' }];
  server.portalSource = { version: 1, fromMonth: '2026-11', currentMonth: '2026-11', rosterPolicy: 'preserve-active', warnings: [{ code: 'example' }] };
  return server;
}

test('an awaited canonical save preserves every queued scheduling edit and existing membership', () => {
  const snapshot = fixture(), server = canonical(snapshot), local = structuredClone(snapshot);
  local.assignments.push({ id: 'queued', personId: 'p1', date: '2026-11-08', site: 'Çekmeköy', overrides: [] });
  local.targets[0].weekday = 7;
  local.requests.push({ id: 'r1', note: 'await sırasında' });
  local.absences.push({ id: 'leave', start: '2026-11-09' });
  local.capabilities.push({ id: 'c1', square: true });
  local.holidays.push({ id: 'h1', date: '2026-11-10' });
  local.months['2026-12'] = { completedAt: null };
  local.planningSettings.ferihaCapacity = 10;
  local.people[0].localNote = 'kişisel hedefleri koru';
  local.updatedAt = '2026-11-06T10:01:00Z';
  const beforeLocal = structuredClone(local), beforeServer = structuredClone(server);
  const merged = mergePlannerSourceFields(local, server);
  for (const key of ['assignments', 'targets', 'requests', 'absences', 'capabilities', 'holidays', 'months', 'planningSettings', 'updatedAt']) {
    assert.deepEqual(merged[key], local[key], `${key} must retain the queued edit`);
  }
  assert.equal(merged.people.length, 1);
  assert.deepEqual(merged.people[0], { ...local.people[0], name: 'Ahmet Özdemir', groupHistory: server.people[0].groupHistory });
  assert.deepEqual(merged.groups, [local.groups[0], server.groups[1]]);
  assert.deepEqual(merged.portalSource, server.portalSource);
  assert.deepEqual(local, beforeLocal);
  assert.deepEqual(server, beforeServer);
  merged.portalSource.warnings[0].code = 'independent copy';
  assert.equal(server.portalSource.warnings[0].code, 'example');
});

test('historical local rotations survive; only canonical current and future rotations are adopted', () => {
  const local = fixture(), server = canonical(local);
  local.rotations[0].unit = 'Yerel geçmiş düzenlemesi';
  const merged = mergePlannerSourceFields(local, server);
  assert.deepEqual(merged.rotations[0], local.rotations[0]);
  assert.deepEqual(merged.rotations[1], { ...local.rotations[1], id: 'crossing:before:2026-11-01', end: '2026-10-31' });
  assert.deepEqual(merged.rotations[2], { ...server.rotations[0], start: '2026-11-01' });
  assert.equal(new Set(merged.rotations.map(row => row.id)).size, 3);
  assert.equal(merged.rotations.some(row => row.id === 'future-local'), false);
});

test('applying the same save reply twice is idempotent, including split ranges and appended groups', () => {
  const local = fixture(), server = canonical(local);
  const merged = mergePlannerSourceFields(local, server);
  assert.deepEqual(mergePlannerSourceFields(merged, server), merged);
  assert.deepEqual(mergePlannerSourceFields(local, { ...server, portalSource: undefined }), local);
});

test('a removed canonical group history cannot survive as a stale source override', () => {
  const local = fixture(), server = canonical(local);
  local.people[0].groupHistory = [{ from: '2026-11', groupId: 'g1' }];
  delete server.people[0].groupHistory;
  assert.equal(Object.hasOwn(mergePlannerSourceFields(local, server).people[0], 'groupHistory'), false);
});

test('cutoff uses the later source/current month and an Istanbul fallback at the UTC boundary', () => {
  const now = new Date('2026-11-30T21:30:00Z');
  assert.equal(istanbulMonth(now), '2026-12');
  assert.equal(plannerSourceCutoff({ portalSource: { fromMonth: '2026-11' } }, now), '2026-12-01');
  assert.equal(plannerSourceCutoff({ portalSource: { fromMonth: '2027-02', currentMonth: '2026-12' } }, now), '2027-02-01');
  assert.equal(plannerSourceCutoff({ portalSource: { fromMonth: '2026-11', currentMonth: '2026-11' } }, now), '2026-11-01');
});

const idle = () => ({ revision: 10, editVersion: 2, dirty: false, saving: false, error: false, conflict: false, publishing: false, dialogOpen: false, shareOpen: false, visible: true });

test('an idle refresh is rejected if any edit or save occurred during await, even if now clean', () => {
  const start = idle();
  assert.equal(canAdoptPlannerRefresh(start, idle()), true);
  assert.equal(canAdoptPlannerRefresh(start, { ...idle(), editVersion: 3 }), false);
  assert.equal(canAdoptPlannerRefresh(start, { ...idle(), revision: 11 }), false);
  for (const key of ['dirty', 'saving', 'error', 'conflict', 'publishing', 'dialogOpen', 'shareOpen']) {
    assert.equal(canAdoptPlannerRefresh(start, { ...idle(), [key]: true }), false, key);
  }
  assert.equal(canAdoptPlannerRefresh(start, { ...idle(), visible: false }), false);
});

test('publish may refresh its own clean draft but still refuses an in-flight local edit or dialog', () => {
  const start = { ...idle(), publishing: true }, options = { allowPublishing: true };
  assert.equal(canAdoptPlannerRefresh(start, start, options), true);
  assert.equal(canAdoptPlannerRefresh(start, { ...start, editVersion: 3 }, options), false);
  assert.equal(canAdoptPlannerRefresh(start, { ...start, dirty: true }, options), false);
  assert.equal(canAdoptPlannerRefresh(start, { ...start, dialogOpen: true }, options), false);
});
