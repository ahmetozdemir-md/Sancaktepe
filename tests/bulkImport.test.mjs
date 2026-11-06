import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareBulkImport } from '../src/bulkImport.ts'

const state = () => ({
  assistants: ['Azmi', 'Aslınur'], assistantRanks: {},
  locations: [
    { id: 'room', site: 'Sancaktepe', name: 'Ameliyathane 1', kind: 'normal', tone: 'sand' },
    { id: 'annual', site: 'Diğer', name: 'Yıllık İzin', kind: 'leave', tone: 'sky' },
    { id: 'rotation', site: 'Diğer', name: 'Rotasyon', kind: 'leave', tone: 'sky' },
  ],
  locationOwners: {}, locationOwnersByMonth: {}, postDutyPoolByMonth: {},
  manualAssignments: {}, dutyRoster: {}, specialistWorkAssignments: {},
  specialistDutyRoster: {}, rotatorRoster: {}, rotatorAssignments: {}, weekStartISO: '2026-11-09',
})
const rules = {
  resolveAssistant: (name) => ({ name: ['Azmi', 'Aslınur'].find((entry) => entry.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')) ?? null, reason: 'Asistan bulunamadı.' }),
  normalizeName: (name) => name.trim(),
  dutySite: (site) => ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'].includes(site) ? site : null,
  specialistDutySite: (site) => ['Sancaktepe', 'Çekmeköy', 'Feriha C123', 'Feriha C456', 'Feriha G123'].includes(site) ? site : null,
  workLocation: (_day, value) => value === 'Sancaktepe Ameliyathane 1' ? { id: 'room', label: value } : { reason: 'Alan bulunamadı.' },
  statusLocation: (value) => ({ 'Yıllık İzin': { id: 'annual', label: value }, Rotasyon: { id: 'rotation', label: value } })[value] ?? null,
  statusDayError: (day) => [0, 6].includes(new Date(day+'T12:00:00Z').getUTCDay()) ? 'Çalışma günü değil.' : null,
}
const parse = (text, base = state(), overrides = {}) => prepareBulkImport(text, base, { ...rules, ...overrides })
const mixed = [
  'ASISTAN_NOBET | 2026-11-09 | Aslınur | Çekmeköy',
  'IZIN_ROTASYON | 2026-11-09 | Azmi | Yıllık İzin',
  'UZMAN_CALISMA | 2026-11-09 | Uzman Bir | Sancaktepe Ameliyathane 1',
  'UZMAN_NOBET | 2026-11-09 | Uzman İki | Feriha C123',
  'ROTASYONER | 2026-11-09 | Rotasyoner Bir',
].join('\n')
function deepFreeze(value) { Object.values(value).forEach((item) => { if (item && typeof item === 'object') deepFreeze(item) }); return Object.freeze(value) }

test('five mixed types route correctly without modifying the source', () => {
  const base = deepFreeze(state())
  const result = parse(mixed, base)
  assert.deepEqual(result.issues, [])
  assert.equal(result.rows.length, 5)
  assert.deepEqual(result.nextState.dutyRoster['2026-11-09'], [{ name: 'Aslınur', site: 'Çekmeköy' }])
  assert.deepEqual(result.nextState.manualAssignments['2026-11-09'].annual, ['Azmi'])
  assert.deepEqual(result.nextState.specialistWorkAssignments['2026-11-09'].room, ['Uzman Bir'])
  assert.deepEqual(result.nextState.rotatorRoster['2026-11-09'], ['Rotasyoner Bir'])
  assert.equal(base.assistants.includes('Rotasyoner Bir'), false)
})
test('one malformed line rejects the whole batch and reports original line', () => {
  const result = parse('```text\n'+mixed+'\ninvalid row\n```')
  assert.equal(result.nextState, null)
  assert.match(result.issues[0], /^7\. satır/)
})
test('explicit ISO year and valid calendar dates required', () => {
  for (const date of ['09.11', '2026-02-30', '2026-13-01', '2026-2-01']) assert.equal(parse(`ROTASYONER | ${date} | Bir`).nextState, null)
  assert.ok(parse('ROTASYONER | 2028-02-29 | Bir').nextState)
})
test('unknown type, extra columns, missing values and empty paste are rejected', () => {
  for (const text of ['', 'constructor | 2026-11-09 | Bir', 'ROTASYONER | 2026-11-09 | Bir | Oda', 'UZMAN_NOBET | 2026-11-09 | Bir |', '09.11 Bir (Sancaktepe)']) assert.equal(parse(text).nextState, null)
})
test('unknown assistants, ambiguous names, inactive or unknown rooms are rejected', () => {
  assert.equal(parse('ASISTAN_NOBET | 2026-11-09 | Kayıtsız | Sancaktepe').nextState, null)
  assert.equal(parse('UZMAN_CALISMA | 2026-11-09 | Bir | Kayıtsız Alan').nextState, null)
  assert.equal(parse(mixed, state(), { resolveAssistant: () => ({ name: null, reason: 'Birden fazla kişi' }) }).nextState, null)
  assert.equal(parse(mixed, state(), { workLocation: () => ({ reason: 'Alan artık aktif değil' }) }).nextState, null)
})
test('invalid hospital and incomplete Feriha specialist group are rejected', () => {
  assert.equal(parse('ASISTAN_NOBET | 2026-11-09 | Azmi | Feriha C123').nextState, null)
  assert.equal(parse('UZMAN_NOBET | 2026-11-09 | Bir | Feriha Öz').nextState, null)
})
test('duplicate rows are counted once and retrying a batch is idempotent', () => {
  const first = parse(mixed+'\n'+mixed)
  assert.equal(first.duplicateCount, 5)
  assert.equal(first.rows.length, 5)
  assert.deepEqual(parse(mixed, first.nextState).nextState, first.nextState)
})
test('consecutive new duty assignments are rejected in either row order across month/year boundary', () => {
  const lines = ['ASISTAN_NOBET | 2026-12-31 | Azmi | Sancaktepe', 'ASISTAN_NOBET | 2027-01-01 | Azmi | Çekmeköy']
  assert.equal(parse(lines.join('\n')).nextState, null)
  assert.equal(parse(lines.reverse().join('\n')).nextState, null)
})
test('adjacent existing duty and two hospitals on the same day block import', () => {
  const base = state()
  base.dutyRoster['2026-11-08'] = [{ name: 'Azmi', site: 'Sancaktepe' }]
  assert.equal(parse('ASISTAN_NOBET | 2026-11-09 | Azmi | Çekmeköy', base).nextState, null)
  base.dutyRoster = { '2026-11-09': [{ name: 'Azmi', site: 'Sancaktepe' }] }
  assert.equal(parse('ASISTAN_NOBET | 2026-11-09 | Azmi | Çekmeköy', base).nextState, null)
})
test('mixed leave and duty/post-duty conflict is rejected independently of order', () => {
  for (const day of ['2026-11-09', '2026-11-10']) {
    const lines = ['ASISTAN_NOBET | 2026-11-09 | Azmi | Sancaktepe', `IZIN_ROTASYON | ${day} | Azmi | Yıllık İzin`]
    assert.equal(parse(lines.join('\n')).nextState, null)
    assert.equal(parse(lines.reverse().join('\n')).nextState, null)
  }
})
test('duty cannot silently erase existing leave', () => {
  const base = state()
  base.manualAssignments['2026-11-10'] = { annual: ['Azmi'] }
  assert.equal(parse('ASISTAN_NOBET | 2026-11-09 | Azmi | Sancaktepe', base).nextState, null)
})
test('post-duty removes only affected next-day normal assignments, with preview', () => {
  const base = state()
  base.manualAssignments['2026-11-10'] = { room: ['Azmi', 'Aslınur'] }
  base.manualAssignments['2026-11-11'] = { room: ['Azmi'] }
  const result = parse('ASISTAN_NOBET | 2026-11-09 | Azmi | Sancaktepe', deepFreeze(base))
  assert.deepEqual(result.nextState.manualAssignments['2026-11-10'].room, ['Aslınur'])
  assert.deepEqual(result.nextState.manualAssignments['2026-11-11'].room, ['Azmi'])
  assert.match(result.effects[0], /nöbet ertesi/)
})
test('leave replaces the person’s room/status, preserves others, and previews removal', () => {
  const base = state()
  base.manualAssignments['2026-11-09'] = { room: ['Azmi', 'Aslınur'], rotation: ['Azmi'] }
  const result = parse('IZIN_ROTASYON | 2026-11-09 | Azmi | Yıllık İzin', deepFreeze(base))
  assert.deepEqual(result.nextState.manualAssignments['2026-11-09'], { room: ['Aslınur'], rotation: [], annual: ['Azmi'] })
  assert.equal(result.effects.length, 2)
})
test('weekend, holiday and conflicting status types block the batch', () => {
  assert.equal(parse('IZIN_ROTASYON | 2026-11-08 | Azmi | Yıllık İzin').nextState, null)
  assert.equal(parse(mixed, state(), { statusDayError: () => 'Resmi tatil' }).nextState, null)
  assert.equal(parse('IZIN_ROTASYON | 2026-11-09 | Azmi | Yıllık İzin\nIZIN_ROTASYON | 2026-11-09 | Azmi | Rotasyon').nextState, null)
})
test('specialist duty replaces only represented days and previews deleted names', () => {
  const base = state()
  base.specialistDutyRoster = { '2026-11-09': [{ name: 'Eski', site: 'Sancaktepe' }], '2026-11-10': [{ name: 'Korunan', site: 'Çekmeköy' }] }
  const result = parse('UZMAN_NOBET | 2026-11-09 | Yeni | Feriha C123', deepFreeze(base))
  assert.deepEqual(result.nextState.specialistDutyRoster['2026-11-09'], [{ name: 'Yeni', site: 'Feriha C123' }])
  assert.deepEqual(result.nextState.specialistDutyRoster['2026-11-10'], base.specialistDutyRoster['2026-11-10'])
  assert.match(result.effects[0], /Kaldırılacak: Eski/)
})
test('same specialist may work in multiple rooms but cannot have two duty sites', () => {
  assert.equal(parse('UZMAN_NOBET | 2026-11-09 | Bir | Sancaktepe\nUZMAN_NOBET | 2026-11-09 | Bir | Çekmeköy').nextState, null)
  const result = parse('UZMAN_CALISMA | 2026-11-09 | Bir | A\nUZMAN_CALISMA | 2026-11-09 | Bir | B', state(), { workLocation: (_day,value) => ({ id:value,label:value }) })
  assert.deepEqual(result.nextState.specialistWorkAssignments['2026-11-09'], { A:['Bir'],B:['Bir'] })
})
test('truncated code block is rejected', () => assert.equal(parse('```text\n'+mixed).nextState, null))
