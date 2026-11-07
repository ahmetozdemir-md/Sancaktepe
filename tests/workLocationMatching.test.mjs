import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSpecialistWorkLocations } from '../src/workLocationMatching.ts'
import { prepareBulkImport } from '../src/bulkImport.ts'

const room = (id, site, name, dates={}) => ({ id, site, name, kind:'normal', tone:'sand', ...dates })
const rooms = [
  ...Array.from({length:10},(_,i)=>room(`s${i+1}`,'Sancaktepe',`Ameliyathane ${i+1}`)),
  room('sp','Sancaktepe','Poliklinik'),room('sy','Sancaktepe','Yoğun Bakım Ünitesi'),
  room('ca','Çekmeköy','Ameliyathane'),room('cp','Çekmeköy','Poliklinik'),
  room('fa','Feriha Öz','Ameliyathane'),room('fp','Feriha Öz','Poliklinik'),
  room('c1','Feriha Öz','C1 Yoğun Bakım Ünitesi'),room('c2','Feriha Öz','C2 Yoğun Bakım Ünitesi'),
]
const match = (value, locations=rooms, day='2026-11-09') => resolveSpecialistWorkLocations(locations,day,value)
const ids = (value) => match(value).locations.map((location)=>location.id)

test('each full combined area shown in the reported screenshot resolves separately', () => {
  const cases = [
    ['Sancaktepe Ameliyathane 7 + Sancaktepe Ameliyathane 8',['s7','s8']],
    ['Çekmeköy Ameliyathane + Çekmeköy Poliklinik',['ca','cp']],
    ['Sancaktepe Ameliyathane 1 + Sancaktepe Ameliyathane 2',['s1','s2']],
    ['Sancaktepe Ameliyathane 9 + Sancaktepe Poliklinik',['s9','sp']],
    ['Feriha Öz Ameliyathane + Feriha Öz Poliklinik',['fa','fp']],
    ['Sancaktepe Ameliyathane 4 + Sancaktepe Ameliyathane 5',['s4','s5']],
    ['Sancaktepe Ameliyathane 7 + Sancaktepe Ameliyathane 9',['s7','s9']],
    ['Sancaktepe Ameliyathane 4 + Sancaktepe Ameliyathane 8',['s4','s8']],
    ['Sancaktepe Ameliyathane 5 + Sancaktepe Poliklinik',['s5','sp']],
  ]
  for(const [value,expected] of cases) assert.deepEqual(ids(value),expected,value)
})

test('shared headings apply only to the current combined field, including explicit hospital changes', () => {
  assert.deepEqual(ids('Sancaktepe Ameliyathane 7+8'),['s7','s8'])
  assert.deepEqual(ids('Çekmeköy Ameliyathane + Poliklinik'),['ca','cp'])
  assert.deepEqual(ids('Sancaktepe Ameliyathane 1 + Ameliyathane 2'),['s1','s2'])
  assert.deepEqual(ids('Sancaktepe Ameliyathane 7 + Çekmeköy Ameliyathane + Poliklinik'),['s7','ca','cp'])
  assert.deepEqual(ids('Feriha Öz C1 + C2'),['c1','c2'])
  assert.deepEqual(ids('8'),[])
})

test('common abbreviations and Turkish spelling map to exact canonical areas', () => {
  assert.deepEqual(ids('SANCAK AMEL. 7 + 8'),['s7','s8'])
  assert.deepEqual(ids('Sancaktepe YBÜ'),['sy'])
  assert.deepEqual(ids('Feriha C2 YBÜ'),['c2'])
  assert.deepEqual(ids('cekmekoy pol.'),['cp'])
  assert.deepEqual(ids('Feriha Öz C 2'),['c2'])
})

test('room numbers and unknown hospital names never match a substring of another area', () => {
  for(const value of ['Sancaktepe Ameliyathane 11','Bursa Ameliyathane 1','Sancaktepe Ameliyathane 1-3','Sancaktepe Ameliyathane 1 / 2']) {
    assert.equal(match(value).locations.length,0,value)
    assert.ok(match(value).reason,value)
  }
  assert.deepEqual(ids('Sancaktepe Ameliyathane 1'),['s1'])
  assert.deepEqual(ids('Sancaktepe Ameliyathane 10'),['s10'])
})

test('ambiguous hospital-free areas, missing areas, and empty combined segments fail without partial results', () => {
  for(const value of ['Ameliyathane','Poliklinik','Sancaktepe Ameliyathane 7 + Bilinmeyen','+ Sancaktepe Ameliyathane 7','Sancaktepe Ameliyathane 7 +']) {
    assert.deepEqual(match(value).locations,[],value)
    assert.ok(match(value).reason,value)
  }
})

test('opening dates are inclusive and closing dates exclusive, even if all areas are inactive', () => {
  const dated = [room('a','Sancaktepe','Ameliyathane 7',{activeFrom:'2026-11-09',activeUntil:'2026-11-16'})]
  assert.equal(match('Sancaktepe Ameliyathane 7',dated,'2026-11-08').locations.length,0)
  assert.equal(match('Sancaktepe Ameliyathane 7',dated,'2026-11-09').locations.length,1)
  assert.equal(match('Sancaktepe Ameliyathane 7',dated,'2026-11-16').locations.length,0)
  assert.match(match('Sancaktepe Ameliyathane 7',dated,'2026-11-16').reason,/aktif değil/)
  assert.deepEqual(match('Sancaktepe Ameliyathane 1 + Sancaktepe Ameliyathane 7',[rooms[0],...dated],'2026-11-16').locations,[])
})

test('a registered literal plus-name has priority; duplicate canonical names are rejected', () => {
  const literal=room('combined','Sancaktepe','A + B')
  assert.deepEqual(match('Sancaktepe A + B',[literal]).locations,[literal])
  assert.equal(match('Sancaktepe Ameliyathane 1',[rooms[0],{...rooms[0],id:'other'}]).locations.length,0)
})

test('real matching feeds canonical individual records to import preview and application state', () => {
  const base = {assistants:[],assistantRanks:{},locations:rooms,locationOwners:{},locationOwnersByMonth:{},postDutyPoolByMonth:{},manualAssignments:{},dutyRoster:{},specialistDutyRoster:{},specialistWorkAssignments:{},rotatorRoster:{},rotatorAssignments:{},weekStartISO:'2026-11-09'}
  const unexpected=()=>{throw new Error('Unrelated rule called')}
  const rules={resolveAssistant:unexpected,normalizeName:value=>value,dutySite:unexpected,specialistDutySite:unexpected,statusLocation:unexpected,statusDayError:unexpected,
    workLocations:(day,value)=>{const result=resolveSpecialistWorkLocations(rooms,day,value);return {locations:result.locations.map(l=>({id:l.id,label:`${l.site} ${l.name}`})),reason:result.reason}}}
  const result=prepareBulkImport('UZMAN_CALISMA | 2026-11-09 | Örnek Uzman | Sancaktepe Ameliyathane 7 + 8\nUZMAN_CALISMA | 2026-11-09 | Örnek Uzman | Çekmeköy Ameliyathane + Poliklinik',base,rules)
  assert.deepEqual(result.issues,[])
  assert.deepEqual(result.rows.map(r=>[r.line,r.locationId]),[[1,'s7'],[1,'s8'],[2,'ca'],[2,'cp']])
  assert.deepEqual(result.nextState.specialistWorkAssignments['2026-11-09'],{s7:['Örnek Uzman'],s8:['Örnek Uzman'],ca:['Örnek Uzman'],cp:['Örnek Uzman']})
  assert.deepEqual(base.specialistWorkAssignments,{})
})
