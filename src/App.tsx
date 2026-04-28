import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { isSupabaseConfigured, REMOTE_STATE_ROW_ID, REMOTE_STATE_TABLE, supabase } from './supabase'

type PanelMode = 'admin' | 'observer'
type AdminSection = 'assistants' | 'locations' | 'duty' | 'planner'
type ObserverSection = 'myPanel' | 'personWeek' | 'dailyMap' | 'dutyList' | 'personLookup'
type PlannerView = 'rooms' | 'status'
type LocationKind = 'normal' | 'leave' | 'duty' | 'postDuty'
type LocationTone = 'sand' | 'sage' | 'amber' | 'sky' | 'rose'
type DutySite = 'Sancaktepe' | 'Feriha Öz' | 'Çekmeköy'

type ManualAssignments = Record<string, Record<string, string[]>>
type DutyRoster = Record<string, DutyAssignment[]>
type LocationOwners = Record<string, string[]>
type LocationOwnersByMonth = Record<string, LocationOwners>

interface DutyAssignment {
  name: string
  site: DutySite
}

interface SessionInfo {
  role: 'admin' | 'assistant'
  username?: string
  assistantName?: string
}

interface WorkLocation {
  id: string
  site: string
  name: string
  kind: LocationKind
  tone: LocationTone
}

interface PlannerState {
  assistants: string[]
  locations: WorkLocation[]
  locationOwners: LocationOwners
  locationOwnersByMonth: LocationOwnersByMonth
  manualAssignments: ManualAssignments
  dutyRoster: DutyRoster
  weekStartISO: string
}

interface DayInfo {
  key: string
  label: string
  shortLabel: string
}

interface WeekGroup {
  weekStartISO: string
  label: string
  days: DayInfo[]
}

interface CalendarCellInfo {
  key: string
  inMonth: boolean
  weekend: boolean
  officialHoliday: boolean
}

interface OfficialHolidayEntry {
  date: string
  reason: string
}

interface DutyTableRow {
  dayKey: string
  bySite: Record<DutySite, string[]>
  weekend: boolean
  holidayReason: string | null
}

interface DutyTableModel {
  rows: DutyTableRow[]
}

interface Notice {
  type: 'ok' | 'warn'
  text: string
}

interface DutyParseIssue {
  lineNumber: number
  message: string
  rawLine: string
}

interface RemotePortalPayload {
  plannerState?: unknown
  userBindings?: unknown
}

const STORAGE_KEY = 'assistant-scheduler-v1'
const USER_BINDING_KEY = 'assistant-user-binding-v1'
const LAST_ASSISTANT_USER_KEY = 'assistant-last-user-v1'
const APP_PASSWORD = '1234'
const ALLOWED_ASSISTANT_USERS = ['ahmetozdemir', 'ilkerermis', 'ebubekirozgur'] as const
const DUTY_SITES: DutySite[] = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy']
const REMOTE_SAVE_DEBOUNCE_MS = 900
const DUTY_SITE_ORDER = new Map<DutySite, number>(
  DUTY_SITES.map((site, index) => [site, index]),
)

const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  normal: 'Normal Alan',
  leave: 'İzin/Serbest',
  duty: 'Nöbet',
  postDuty: 'Nöbet Ertesi',
}

const EDITABLE_KINDS = new Set<LocationKind>(['normal', 'leave'])

const FIXED_OFFICIAL_HOLIDAYS = [
  { mmdd: '01-01', reason: 'Yılbaşı' },
  { mmdd: '04-23', reason: 'Ulusal Egemenlik ve Çocuk Bayramı' },
  { mmdd: '05-01', reason: 'Emek ve Dayanışma Günü' },
  { mmdd: '05-19', reason: 'Atatürk’ü Anma, Gençlik ve Spor Bayramı' },
  { mmdd: '07-15', reason: 'Demokrasi ve Millî Birlik Günü' },
  { mmdd: '08-30', reason: 'Zafer Bayramı' },
  { mmdd: '10-28', reason: 'Cumhuriyet Bayramı Arifesi (Yarım Gün)' },
  { mmdd: '10-29', reason: 'Cumhuriyet Bayramı' },
] as const

const MOVABLE_OFFICIAL_HOLIDAYS_BY_YEAR: Record<number, OfficialHolidayEntry[]> = {
  2025: [
    { date: '2025-03-29', reason: 'Ramazan Bayramı Arifesi (Yarım Gün)' },
    { date: '2025-03-30', reason: 'Ramazan Bayramı 1. Gün' },
    { date: '2025-03-31', reason: 'Ramazan Bayramı 2. Gün' },
    { date: '2025-04-01', reason: 'Ramazan Bayramı 3. Gün' },
    { date: '2025-06-05', reason: 'Kurban Bayramı Arifesi (Yarım Gün)' },
    { date: '2025-06-06', reason: 'Kurban Bayramı 1. Gün' },
    { date: '2025-06-07', reason: 'Kurban Bayramı 2. Gün' },
    { date: '2025-06-08', reason: 'Kurban Bayramı 3. Gün' },
    { date: '2025-06-09', reason: 'Kurban Bayramı 4. Gün' },
  ],
  2026: [
    { date: '2026-03-19', reason: 'Ramazan Bayramı Arifesi (Yarım Gün)' },
    { date: '2026-03-20', reason: 'Ramazan Bayramı 1. Gün' },
    { date: '2026-03-21', reason: 'Ramazan Bayramı 2. Gün' },
    { date: '2026-03-22', reason: 'Ramazan Bayramı 3. Gün' },
    { date: '2026-05-26', reason: 'Kurban Bayramı Arifesi (Yarım Gün)' },
    { date: '2026-05-27', reason: 'Kurban Bayramı 1. Gün' },
    { date: '2026-05-28', reason: 'Kurban Bayramı 2. Gün' },
    { date: '2026-05-29', reason: 'Kurban Bayramı 3. Gün' },
    { date: '2026-05-30', reason: 'Kurban Bayramı 4. Gün' },
  ],
}

const OFFICIAL_HOLIDAY_REASON_CACHE = new Map<number, Map<string, string>>()

function resolveLocationTone(kind: LocationKind, name: string, site: string): LocationTone {
  if (kind === 'leave') {
    return 'sky'
  }
  if (kind === 'duty' || kind === 'postDuty') {
    return 'rose'
  }

  const siteToken = site.toLocaleLowerCase('tr')
  if (siteToken.includes('sancaktepe')) {
    return 'sand'
  }
  if (siteToken.includes('çekmeköy') || siteToken.includes('cekmekoy')) {
    return 'sage'
  }
  if (siteToken.includes('feriha')) {
    return 'amber'
  }

  const nameToken = name.toLocaleLowerCase('tr')
  if (
    nameToken.includes('izinli') ||
    nameToken.includes('rotasyon') ||
    nameToken.includes('dış anestezi') ||
    nameToken.includes('dis anestezi')
  ) {
    return 'sky'
  }

  return 'sand'
}

function withResolvedTone(location: WorkLocation): WorkLocation {
  return {
    ...location,
    tone: resolveLocationTone(location.kind, location.name, location.site),
  }
}

const DEFAULT_LOCATIONS: WorkLocation[] = ([
  { id: 'sancak-ameliyathane-1', site: 'Sancaktepe', name: 'Ameliyathane 1', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-2', site: 'Sancaktepe', name: 'Ameliyathane 2', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-3', site: 'Sancaktepe', name: 'Ameliyathane 3', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-4', site: 'Sancaktepe', name: 'Ameliyathane 4', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-5', site: 'Sancaktepe', name: 'Ameliyathane 5', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-6', site: 'Sancaktepe', name: 'Ameliyathane 6', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-7', site: 'Sancaktepe', name: 'Ameliyathane 7', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-8', site: 'Sancaktepe', name: 'Ameliyathane 8', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ameliyathane-9', site: 'Sancaktepe', name: 'Ameliyathane 9', kind: 'normal', tone: 'sand' },
  { id: 'sancak-dis-anestezi', site: 'Sancaktepe', name: 'Dış Anestezi', kind: 'normal', tone: 'sand' },
  { id: 'sancak-ybu', site: 'Sancaktepe', name: 'Yoğun Bakım Ünitesi', kind: 'normal', tone: 'sand' },
  { id: 'sancak-poliklinik', site: 'Sancaktepe', name: 'Poliklinik', kind: 'normal', tone: 'sand' },

  { id: 'cekmekoy-ameliyathane', site: 'Çekmeköy', name: 'Ameliyathane', kind: 'normal', tone: 'sage' },
  { id: 'cekmekoy-ybu', site: 'Çekmeköy', name: 'Yoğun Bakım Ünitesi', kind: 'normal', tone: 'sage' },
  { id: 'cekmekoy-poliklinik', site: 'Çekmeköy', name: 'Poliklinik', kind: 'normal', tone: 'sage' },

  { id: 'feriha-oz-ameliyathane', site: 'Feriha Öz', name: 'Ameliyathane', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c1', site: 'Feriha Öz', name: 'C1 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c2', site: 'Feriha Öz', name: 'C2 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c3', site: 'Feriha Öz', name: 'C3 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c4', site: 'Feriha Öz', name: 'C4 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c5', site: 'Feriha Öz', name: 'C5 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-c6', site: 'Feriha Öz', name: 'C6 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-g1', site: 'Feriha Öz', name: 'G1 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-g2', site: 'Feriha Öz', name: 'G2 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-g3', site: 'Feriha Öz', name: 'G3 Yoğun Bakım Ünitesi', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-poliklinik', site: 'Feriha Öz', name: 'Poliklinik', kind: 'normal', tone: 'amber' },
  { id: 'feriha-oz-dis-anestezi', site: 'Feriha Öz', name: 'Dış Anestezi', kind: 'normal', tone: 'amber' },

  { id: 'izinli', site: 'Diğer', name: 'İzinli', kind: 'leave', tone: 'sky' },
  { id: 'rotasyon', site: 'Diğer', name: 'Rotasyon', kind: 'leave', tone: 'sky' },
  { id: 'nobet', site: 'Diğer', name: 'Nöbet', kind: 'duty', tone: 'rose' },
  { id: 'nobet-ertesi', site: 'Diğer', name: 'Nöbet Ertesi', kind: 'postDuty', tone: 'rose' },
] as WorkLocation[]).map(withResolvedTone)

const DEFAULT_ASSISTANTS = [
  'Hilal',
  'Aslınur',
  'Gamze',
  'Ersin',
  'Ezgi',
  'Kıymet',
  'İlker',
  'Rana',
  'Özge',
  'Seyhan',
  'Tuğana',
  'Bilal',
]

function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromISODate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function buildOfficialHolidayReasonMapForYear(year: number): Map<string, string> {
  const cached = OFFICIAL_HOLIDAY_REASON_CACHE.get(year)
  if (cached) {
    return cached
  }

  const fixedDates = FIXED_OFFICIAL_HOLIDAYS.map(({ mmdd, reason }) => [`${year}-${mmdd}`, reason] as const)
  const movableDates = (MOVABLE_OFFICIAL_HOLIDAYS_BY_YEAR[year] ?? []).map(({ date, reason }) => [date, reason] as const)
  const nextMap = new Map<string, string>([...fixedDates, ...movableDates])
  OFFICIAL_HOLIDAY_REASON_CACHE.set(year, nextMap)
  return nextMap
}

function getOfficialHolidayReason(dayKey: string): string | null {
  const year = Number(dayKey.slice(0, 4))
  if (Number.isNaN(year)) {
    return null
  }
  return buildOfficialHolidayReasonMapForYear(year).get(dayKey) ?? null
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function isOfficialHoliday(date: Date): boolean {
  const isoDate = toISODate(date)
  return getOfficialHolidayReason(isoDate) !== null
}

function isNonWorkingDay(date: Date): boolean {
  return isWeekend(date) || isOfficialHoliday(date)
}

function startOfISOWeek(date: Date): Date {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = current.getDay() === 0 ? 7 : current.getDay()
  current.setDate(current.getDate() - day + 1)
  return current
}

function uniqueSortedNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'tr'),
  )
}

function normalizeDutySite(rawSite: string): DutySite | null {
  const token = rawSite.trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ')
  if (token === 'sancaktepe' || token === 'sancak') {
    return 'Sancaktepe'
  }
  if (token === 'feriha öz' || token === 'feriha oz' || token === 'feriha') {
    return 'Feriha Öz'
  }
  if (token === 'çekmeköy' || token === 'cekmekoy' || token === 'çekmekoy') {
    return 'Çekmeköy'
  }
  return null
}

function sortDutyAssignments(assignments: DutyAssignment[]): DutyAssignment[] {
  return [...assignments].sort(
    (a, b) =>
      (DUTY_SITE_ORDER.get(a.site) ?? 99) - (DUTY_SITE_ORDER.get(b.site) ?? 99) ||
      a.name.localeCompare(b.name, 'tr'),
  )
}

function uniqueDutyAssignments(assignments: DutyAssignment[]): DutyAssignment[] {
  const byName = new Map<string, DutyAssignment>()
  assignments.forEach((assignment) => {
    const key = assignment.name.trim()
    if (!key) {
      return
    }
    if (!byName.has(key)) {
      byName.set(key, { name: key, site: assignment.site })
    }
  })
  return sortDutyAssignments([...byName.values()])
}

function dutyAssignmentsToNames(assignments: DutyAssignment[]): string[] {
  return uniqueSortedNames(assignments.map((assignment) => assignment.name))
}

function dutySiteClassName(site: DutySite): string {
  if (site === 'Sancaktepe') {
    return 'sancaktepe'
  }
  if (site === 'Feriha Öz') {
    return 'feriha-oz'
  }
  return 'cekmekoy'
}

function dutySiteShortLabel(site: DutySite): string {
  if (site === 'Sancaktepe') {
    return 'Sancak'
  }
  if (site === 'Feriha Öz') {
    return 'Feriha'
  }
  return 'Çekmeköy'
}

function buildWeek(weekStartISO: string): DayInfo[] {
  const start = fromISODate(weekStartISO)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
    .map((day) => ({
      key: toISODate(day),
      label: day.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        weekday: 'long',
      }),
      shortLabel: day.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
      }),
    }))
}

function formatDayMonthLabel(isoDate: string): string {
  return fromISODate(isoDate).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
  })
}

function buildWeekGroupsForMonth(monthISO: string): WeekGroup[] {
  const monthDays = listMonthDays(monthISO)
  if (!monthDays.length) {
    return []
  }

  const weekStarts = [...new Set(monthDays.map((dayKey) => toISODate(startOfISOWeek(fromISODate(dayKey)))))]
  const eligibleWeeks = weekStarts
    .map((weekStartISO) => {
      const fullWeekDays = buildWeek(weekStartISO)
      const monthDaysInWeek = fullWeekDays.filter((day) => day.key.startsWith(`${monthISO}-`))
      const hasWeekdayInMonth = monthDaysInWeek.some((day) => !isWeekend(fromISODate(day.key)))

      return {
        weekStartISO,
        fullWeekDays,
        hasWeekdayInMonth,
      }
    })
    .filter((week) => week.hasWeekdayInMonth)

  return eligibleWeeks.map((week, index) => {
    const firstDay = week.fullWeekDays[0]?.key
    const lastDay = week.fullWeekDays[6]?.key
    const weekRangeLabel =
      firstDay && lastDay ? `${formatDayMonthLabel(firstDay)} - ${formatDayMonthLabel(lastDay)}` : week.weekStartISO

    return {
      weekStartISO: week.weekStartISO,
      label: `${index + 1}. hafta (${weekRangeLabel})`,
      days: week.fullWeekDays,
    }
  })
}

function getDayTypeLabel(dayKey: string): string | null {
  const date = fromISODate(dayKey)
  const weekend = isWeekend(date)
  const officialHoliday = isOfficialHoliday(date)

  if (weekend && officialHoliday) {
    return 'Hafta sonu ve resmi tatil'
  }
  if (officialHoliday) {
    return 'Resmi tatil'
  }
  if (weekend) {
    return 'Hafta sonu'
  }
  return null
}

function getAssignmentsForLocation(
  state: PlannerState,
  dayKey: string,
  location: WorkLocation,
): string[] {
  const dayDate = fromISODate(dayKey)
  if ((location.kind === 'normal' || location.kind === 'leave') && isNonWorkingDay(dayDate)) {
    return []
  }

  if (location.kind === 'duty') {
    return dutyAssignmentsToNames(state.dutyRoster[dayKey] ?? [])
  }
  if (location.kind === 'postDuty') {
    const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
    return dutyAssignmentsToNames(state.dutyRoster[previousDay] ?? [])
  }
  return state.manualAssignments[dayKey]?.[location.id] ?? []
}

function createSampleDuty(weekStartISO: string): DutyRoster {
  const monday = fromISODate(weekStartISO)
  const tuesday = toISODate(addDays(monday, 1))
  const thursday = toISODate(addDays(monday, 3))

  return {
    [tuesday]: [
      { name: 'Hilal', site: 'Sancaktepe' },
      { name: 'Tuğana', site: 'Feriha Öz' },
    ],
    [thursday]: [
      { name: 'Gamze', site: 'Çekmeköy' },
      { name: 'Bilal', site: 'Sancaktepe' },
    ],
  }
}

function createDefaultLocationOwners(
  locations: WorkLocation[],
  assistants: string[],
): LocationOwners {
  const normalLocations = locations.filter((location) => location.kind === 'normal')
  if (!assistants.length) {
    return {}
  }

  return Object.fromEntries(
    normalLocations.map((location, index) => [location.id, [assistants[index % assistants.length]]]),
  )
}

function isValidMonthISO(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return false
  }
  const month = Number(match[2])
  return month >= 1 && month <= 12
}

function parseMonthISO(monthISO: string): { year: number; monthIndex: number } | null {
  const match = monthISO.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null
  }
  return { year, monthIndex }
}

function shiftMonthISO(monthISO: string, delta: number): string {
  const parsed = parseMonthISO(monthISO)
  if (!parsed) {
    return monthISO
  }
  const shifted = new Date(parsed.year, parsed.monthIndex + delta, 1)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`
}

function monthFromDayKey(dayKey: string): string {
  return dayKey.slice(0, 7)
}

function normalizeLocationOwnersByScope(
  rawOwners: Record<string, unknown>,
  locations: WorkLocation[],
  assistants: string[],
  fallbackOwners?: LocationOwners,
  fillMissingWithDefault = true,
): LocationOwners {
  const normalLocations = locations.filter((location) => location.kind === 'normal')

  return Object.fromEntries(
    normalLocations.map((location, index) => {
      const rawValue = rawOwners[location.id]
      const normalizedOwners = Array.isArray(rawValue)
        ? uniqueSortedNames(rawValue.filter((item): item is string => typeof item === 'string'))
        : typeof rawValue === 'string'
          ? uniqueSortedNames([rawValue])
          : []
      const filteredOwners = normalizedOwners.filter((owner) => assistants.includes(owner))
      if (filteredOwners.length) {
        return [location.id, filteredOwners]
      }

      const fallback = uniqueSortedNames((fallbackOwners?.[location.id] ?? []).filter((owner) => assistants.includes(owner)))
      if (fallback.length) {
        return [location.id, fallback]
      }

      if (!fillMissingWithDefault) {
        return [location.id, []]
      }

      const defaultOwner = assistants[index % (assistants.length || 1)]
      return [location.id, defaultOwner ? [defaultOwner] : []]
    }),
  )
}

function getLocationOwnersForMonth(state: PlannerState, monthISO: string): LocationOwners {
  return state.locationOwnersByMonth[monthISO] ?? {}
}

function getLocationOwnersForDay(state: PlannerState, dayKey: string): LocationOwners {
  return getLocationOwnersForMonth(state, monthFromDayKey(dayKey))
}

function cloneOwnersForNormalLocations(
  owners: LocationOwners,
  locations: WorkLocation[],
  assistants: string[],
): LocationOwners {
  return Object.fromEntries(
    locations
      .filter((location) => location.kind === 'normal')
      .map((location) => [
        location.id,
        uniqueSortedNames((owners[location.id] ?? []).filter((owner) => assistants.includes(owner))),
      ]),
  )
}

function findClosestOwnersMonth(monthMap: LocationOwnersByMonth, monthISO: string): string | null {
  const months = Object.keys(monthMap).filter(isValidMonthISO).sort()
  if (!months.length) {
    return null
  }
  const previousOrEqual = [...months].reverse().find((month) => month <= monthISO)
  return previousOrEqual ?? months[months.length - 1]
}

function createSampleManual(
  weekStartISO: string,
  locations: WorkLocation[],
  locationOwners: Record<string, string[]>,
): ManualAssignments {
  const monday = fromISODate(weekStartISO)
  const mondayKey = toISODate(monday)
  const tuesdayKey = toISODate(addDays(monday, 1))
  const normalLocations = locations.filter((location) => location.kind === 'normal')

  const mondayAssignments: Record<string, string[]> = {}
  const tuesdayAssignments: Record<string, string[]> = {}

  normalLocations.slice(0, 4).forEach((location) => {
    const owner = locationOwners[location.id]?.[0]
    if (owner) {
      mondayAssignments[location.id] = [owner]
    }
  })

  normalLocations.slice(4, 8).forEach((location) => {
    const owner = locationOwners[location.id]?.[0]
    if (owner) {
      tuesdayAssignments[location.id] = [owner]
    }
  })

  return {
    [mondayKey]: mondayAssignments,
    [tuesdayKey]: tuesdayAssignments,
  }
}

function hasIsoShape(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeDateToken(raw: string): string | null {
  const value = raw.trim()

  if (hasIsoShape(value)) {
    const parsed = fromISODate(value)
    return toISODate(parsed) === value ? value : null
  }

  const trMatch = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!trMatch) {
    return null
  }

  const day = Number(trMatch[1])
  const month = Number(trMatch[2])
  const year = Number(trMatch[3])
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return toISODate(parsed)
}

function listMonthDays(monthISO: string): string[] {
  const match = monthISO.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return []
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return []
  }

  const first = new Date(year, monthIndex, 1)
  const last = new Date(year, monthIndex + 1, 0)
  const days: string[] = []

  for (let cursor = new Date(first); cursor <= last; cursor = addDays(cursor, 1)) {
    days.push(toISODate(cursor))
  }
  return days
}

function buildMonthCalendarGrid(monthISO: string): CalendarCellInfo[][] {
  const monthDays = listMonthDays(monthISO)
  if (!monthDays.length) {
    return []
  }

  const firstDay = fromISODate(monthDays[0])
  const lastDay = fromISODate(monthDays[monthDays.length - 1])
  const gridStart = startOfISOWeek(firstDay)
  const gridEnd = addDays(startOfISOWeek(lastDay), 6)
  const gridDays: CalendarCellInfo[] = []

  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    const dayKey = toISODate(cursor)
    gridDays.push({
      key: dayKey,
      inMonth: dayKey.startsWith(`${monthISO}-`),
      weekend: isWeekend(cursor),
      officialHoliday: isOfficialHoliday(cursor),
    })
  }

  const weeks: CalendarCellInfo[][] = []
  for (let index = 0; index < gridDays.length; index += 7) {
    weeks.push(gridDays.slice(index, index + 7))
  }

  return weeks
}

function buildDutyTableModel(dutyRoster: DutyRoster, monthISO: string): DutyTableModel {
  const rows: DutyTableRow[] = listMonthDays(monthISO).map((dayKey) => {
    const entries = sortDutyAssignments(dutyRoster[dayKey] ?? [])
    const bySite: Record<DutySite, string[]> = {
      Sancaktepe: [],
      'Feriha Öz': [],
      Çekmeköy: [],
    }
    entries.forEach((entry) => {
      bySite[entry.site].push(entry.name)
    })

    return {
      dayKey,
      bySite,
      weekend: isWeekend(fromISODate(dayKey)),
      holidayReason: getOfficialHolidayReason(dayKey),
    }
  })

  return { rows }
}

function formatMonthSelectLabel(monthISO: string, selectedYear?: number): string {
  const match = monthISO.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return monthISO
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return monthISO
  }

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('tr-TR', { month: 'long' })
  if (selectedYear && year !== selectedYear) {
    return `${monthName} ${year}`
  }
  return monthName
}

function normalizeDutyLineDateToken(raw: string, fallbackYear: number): string | null {
  const value = raw.trim()
  if (!value) {
    return null
  }

  if (hasIsoShape(value)) {
    return normalizeDateToken(value)
  }

  const match = value.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/)
  if (!match) {
    return null
  }

  const day = Number(match[1])
  const month = Number(match[2])
  const rawYear = match[3]
  const year = rawYear
    ? rawYear.length === 2
      ? 2000 + Number(rawYear)
      : Number(rawYear)
    : fallbackYear

  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return null
  }

  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return toISODate(parsed)
}

function parseDutyQuickLines(
  text: string,
  fallbackYear: number,
): { data: DutyRoster; issues: DutyParseIssue[]; totalNames: number } {
  const data: DutyRoster = {}
  const issues: DutyParseIssue[] = []
  const invalidDays = new Set<string>()
  let totalNames = 0

  text
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim()
      if (!line) {
        return
      }

      const match = line.match(
        /^(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s*(?:[:\-])?\s*(.+)$/u,
      )
      if (!match) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Biçim hatası. Örnek: 26.01 Aslınur (Çekmeköy), Fatih (Sancaktepe)',
        })
        return
      }

      const dayKey = normalizeDutyLineDateToken(match[1], fallbackYear)
      if (!dayKey) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Tarih geçersiz.',
        })
        return
      }

      const rawTokens = match[2]
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (!rawTokens.length) {
        invalidDays.add(dayKey)
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: `${dayKey} günü için kişi bulunamadı, günün tüm satırları iptal edildi.`,
        })
        return
      }

      const parsedAssignments: DutyAssignment[] = []
      for (const token of rawTokens) {
        const tokenMatch = token.match(/^(.+?)\s*\(([^)]+)\)\s*$/u)
        if (!tokenMatch) {
          invalidDays.add(dayKey)
          issues.push({
            lineNumber: index + 1,
            rawLine,
            message: `${dayKey} günü için "${token}" geçersiz. "Ad (NöbetYeri)" formatı gerekli.`,
          })
          return
        }

        const name = tokenMatch[1].trim()
        const site = normalizeDutySite(tokenMatch[2])
        if (!name || !site) {
          invalidDays.add(dayKey)
          issues.push({
            lineNumber: index + 1,
            rawLine,
            message: `${dayKey} günü için "${token}" içinde isim veya nöbet yeri geçersiz.`,
          })
          return
        }

        parsedAssignments.push({ name, site })
      }

      if (!parsedAssignments.length) {
        invalidDays.add(dayKey)
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: `${dayKey} günü için geçerli nöbetçi bulunamadı.`,
        })
        return
      }

      data[dayKey] = uniqueDutyAssignments([...(data[dayKey] ?? []), ...parsedAssignments])
      totalNames += parsedAssignments.length
    })

  invalidDays.forEach((dayKey) => {
    delete data[dayKey]
  })

  totalNames = Object.values(data).reduce((count, entries) => count + entries.length, 0)

  return { data, issues, totalNames }
}

function removeMonthFromDutyRoster(dutyRoster: DutyRoster, monthISO: string): DutyRoster {
  return Object.fromEntries(
    Object.entries(dutyRoster).filter(([dayKey]) => !dayKey.startsWith(`${monthISO}-`)),
  )
}

function generateDutyRosterForMonth(
  assistants: string[],
  monthISO: string,
  perDayCount: number,
): DutyRoster {
  const cleanAssistants = uniqueSortedNames(assistants)
  if (!cleanAssistants.length) {
    return {}
  }

  const monthDays = listMonthDays(monthISO)
  if (!monthDays.length) {
    return {}
  }

  const safePerDay = Math.max(1, Math.min(perDayCount, cleanAssistants.length))
  const roster: DutyRoster = {}
  let cursor = 0
  let previousDayAssignees = new Set<string>()

  monthDays.forEach((dayKey) => {
    const selected: string[] = []

    for (let offset = 0; offset < cleanAssistants.length && selected.length < safePerDay; offset += 1) {
      const candidate = cleanAssistants[(cursor + offset) % cleanAssistants.length]
      const alreadySelected = selected.includes(candidate)
      const blockedByPreviousDay = previousDayAssignees.has(candidate)
      if (alreadySelected || blockedByPreviousDay) {
        continue
      }
      selected.push(candidate)
    }

    roster[dayKey] = sortDutyAssignments(
      selected.map((name, index) => ({
        name,
        site: DUTY_SITES[index % DUTY_SITES.length],
      })),
    )
    previousDayAssignees = new Set(selected)
    cursor = (cursor + safePerDay) % cleanAssistants.length
  })

  return roster
}

function sanitizeManualAssignments(
  manualAssignments: ManualAssignments,
  dutyRoster: DutyRoster,
  locations: WorkLocation[],
): { manualAssignments: ManualAssignments; removedCount: number } {
  const locationMap = new Map(locations.map((location) => [location.id, location]))
  const next: ManualAssignments = {}
  let removedCount = 0

  Object.entries(manualAssignments).forEach(([dayKey, locationAssignments]) => {
    const prevDay = toISODate(addDays(fromISODate(dayKey), -1))
    const workingDay = !isNonWorkingDay(fromISODate(dayKey))
    const blockedForNormal = new Set([...dutyAssignmentsToNames(dutyRoster[prevDay] ?? [])])

    const normalizedLocationAssignments: Record<string, string[]> = {}

    Object.entries(locationAssignments).forEach(([locationId, names]) => {
      const location = locationMap.get(locationId)
      if (!location) {
        return
      }

      const normalizedNames = uniqueSortedNames(names)
      if (location.kind === 'normal') {
        if (!workingDay) {
          removedCount += normalizedNames.length
          normalizedLocationAssignments[locationId] = []
          return
        }
        const filtered = normalizedNames.filter((name) => !blockedForNormal.has(name))
        removedCount += normalizedNames.length - filtered.length
        normalizedLocationAssignments[locationId] = filtered
        return
      }

      if (location.kind === 'leave' && !workingDay) {
        removedCount += normalizedNames.length
        normalizedLocationAssignments[locationId] = []
        return
      }

      normalizedLocationAssignments[locationId] = normalizedNames
    })

    next[dayKey] = normalizedLocationAssignments
  })

  return { manualAssignments: next, removedCount }
}

function removeNameFromManual(
  manualAssignments: ManualAssignments,
  nameToRemove: string,
): ManualAssignments {
  return Object.fromEntries(
    Object.entries(manualAssignments).map(([day, assignments]) => {
      const nextLocations = Object.fromEntries(
        Object.entries(assignments).map(([locationId, names]) => [
          locationId,
          names.filter((name) => name !== nameToRemove),
        ]),
      )
      return [day, nextLocations]
    }),
  )
}

function removeNameFromDuty(dutyRoster: DutyRoster, nameToRemove: string): DutyRoster {
  return Object.fromEntries(
    Object.entries(dutyRoster).map(([day, entries]) => [
      day,
      entries.filter((entry) => entry.name !== nameToRemove),
    ]),
  )
}

function ensureCoreLocations(locations: WorkLocation[]): WorkLocation[] {
  const hasDuty = locations.some((location) => location.kind === 'duty')
  const hasPostDuty = locations.some((location) => location.kind === 'postDuty')
  const hasLeave = locations.some((location) => location.kind === 'leave')
  const hasRotation = locations.some(
    (location) => location.kind === 'leave' && location.name.toLowerCase() === 'rotasyon',
  )

  const next = [...locations]
  if (!hasLeave) {
    next.push({
      id: 'izinli',
      site: 'Diğer',
      name: 'İzinli',
      kind: 'leave',
      tone: 'sky',
    })
  }
  if (!hasRotation) {
    next.push({
      id: 'rotasyon',
      site: 'Diğer',
      name: 'Rotasyon',
      kind: 'leave',
      tone: 'sky',
    })
  }
  if (!hasDuty) {
    next.push({
      id: 'nobet',
      site: 'Diğer',
      name: 'Nöbet',
      kind: 'duty',
      tone: 'rose',
    })
  }
  if (!hasPostDuty) {
    next.push({
      id: 'nobet-ertesi',
      site: 'Diğer',
      name: 'Nöbet Ertesi',
      kind: 'postDuty',
      tone: 'rose',
    })
  }
  return next.map(withResolvedTone)
}

function buildFallbackState(): PlannerState {
  const now = new Date()
  const weekStartISO = toISODate(startOfISOWeek(now))
  const currentMonthISO = toISODate(now).slice(0, 7)
  const fallbackLocationOwners = createDefaultLocationOwners(DEFAULT_LOCATIONS, DEFAULT_ASSISTANTS)
  return {
    assistants: DEFAULT_ASSISTANTS,
    locations: DEFAULT_LOCATIONS,
    locationOwners: fallbackLocationOwners,
    locationOwnersByMonth: {
      [currentMonthISO]: fallbackLocationOwners,
    },
    manualAssignments: createSampleManual(weekStartISO, DEFAULT_LOCATIONS, fallbackLocationOwners),
    dutyRoster: createSampleDuty(weekStartISO),
    weekStartISO,
  }
}

function sanitizePlannerState(parsed: Partial<PlannerState>, fallback: PlannerState): PlannerState {
  const currentMonthISO = toISODate(new Date()).slice(0, 7)

  const assistants = Array.isArray(parsed.assistants)
    ? uniqueSortedNames(parsed.assistants.filter((item): item is string => typeof item === 'string'))
    : fallback.assistants

  const locations = Array.isArray(parsed.locations)
    ? ensureCoreLocations(
        parsed.locations
          .filter(
            (item): item is WorkLocation =>
              typeof item === 'object' &&
              typeof item?.id === 'string' &&
              typeof item?.site === 'string' &&
              typeof item?.name === 'string' &&
              typeof item?.kind === 'string',
          )
          .map((location) => withResolvedTone(location)),
      )
    : fallback.locations.map(withResolvedTone)

  const rawLocationOwners = (parsed as { locationOwners?: Record<string, unknown> }).locationOwners
  const legacyOwnersSource =
    rawLocationOwners && typeof rawLocationOwners === 'object'
      ? rawLocationOwners
      : createDefaultLocationOwners(locations, assistants)
  const normalizedLocationOwners = normalizeLocationOwnersByScope(
    legacyOwnersSource,
    locations,
    assistants,
  )

  const rawLocationOwnersByMonth = (parsed as { locationOwnersByMonth?: Record<string, unknown> })
    .locationOwnersByMonth
  const normalizedLocationOwnersByMonth: LocationOwnersByMonth =
    rawLocationOwnersByMonth && typeof rawLocationOwnersByMonth === 'object'
      ? Object.fromEntries(
          Object.entries(rawLocationOwnersByMonth)
            .filter(
              ([monthISO, scopedOwners]) =>
                isValidMonthISO(monthISO) && scopedOwners && typeof scopedOwners === 'object',
            )
            .map(([monthISO, scopedOwners]) => [
              monthISO,
              normalizeLocationOwnersByScope(
                scopedOwners as Record<string, unknown>,
                locations,
                assistants,
                undefined,
                false,
              ),
            ]),
        )
      : {}
  if (!Object.keys(normalizedLocationOwnersByMonth).length) {
    normalizedLocationOwnersByMonth[currentMonthISO] = normalizedLocationOwners
  }

  const manualAssignments: ManualAssignments =
    parsed.manualAssignments && typeof parsed.manualAssignments === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.manualAssignments).map(([day, locationAssignments]) => [
            day,
            Object.fromEntries(
              Object.entries(locationAssignments ?? {}).map(([locationId, names]) => [
                locationId,
                Array.isArray(names)
                  ? uniqueSortedNames(names.filter((name): name is string => typeof name === 'string'))
                  : [],
              ]),
            ),
          ]),
        )
      : fallback.manualAssignments

  const dutyRoster: DutyRoster =
    parsed.dutyRoster && typeof parsed.dutyRoster === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.dutyRoster).map(([day, entries]) => {
            if (!Array.isArray(entries)) {
              return [day, []]
            }

            const rawEntries = entries as unknown[]
            const normalizedEntries: DutyAssignment[] = rawEntries
              .map((rawEntry) => {
                if (typeof rawEntry === 'string') {
                  return {
                    name: rawEntry.trim(),
                    site: 'Sancaktepe' as DutySite,
                  }
                }

                if (typeof rawEntry !== 'object' || rawEntry === null) {
                  return null
                }

                const rawName = 'name' in rawEntry ? String(rawEntry.name ?? '').trim() : ''
                const rawSite = 'site' in rawEntry ? normalizeDutySite(String(rawEntry.site ?? '')) : null
                if (!rawName || !rawSite) {
                  return null
                }

                return { name: rawName, site: rawSite }
              })
              .filter((entry): entry is DutyAssignment => Boolean(entry))

            return [day, uniqueDutyAssignments(normalizedEntries)]
          }),
        )
      : fallback.dutyRoster

  const candidateWeekStart = typeof parsed.weekStartISO === 'string' ? parsed.weekStartISO : ''
  const normalizedWeekStart = normalizeDateToken(candidateWeekStart)

  const sanitized = sanitizeManualAssignments(manualAssignments, dutyRoster, locations)

  return {
    assistants,
    locations,
    locationOwners: normalizedLocationOwners,
    locationOwnersByMonth: normalizedLocationOwnersByMonth,
    manualAssignments: sanitized.manualAssignments,
    dutyRoster,
    weekStartISO: normalizedWeekStart ?? fallback.weekStartISO,
  }
}

function safeReadState(): PlannerState {
  const fallback = buildFallbackState()
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlannerState>
    return sanitizePlannerState(parsed, fallback)
  } catch {
    return fallback
  }
}

function sanitizeUserBindings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([username, assistantName]) => {
        return (
          ALLOWED_ASSISTANT_USERS.includes(username as (typeof ALLOWED_ASSISTANT_USERS)[number]) &&
          typeof assistantName === 'string' &&
          assistantName.trim().length > 0
        )
      })
      .map(([username, assistantName]) => [username, String(assistantName).trim()]),
  )
}

function safeReadUserBindings(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {}
  }

  const raw = localStorage.getItem(USER_BINDING_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return sanitizeUserBindings(parsed)
  } catch {
    return {}
  }
}

function App() {
  const today = useMemo(() => new Date(), [])
  const todayISO = toISODate(today)
  const currentWeekStartISO = toISODate(startOfISOWeek(today))
  const currentMonthISO = todayISO.slice(0, 7)

  const [mode, setMode] = useState<PanelMode>('admin')
  const [adminSection, setAdminSection] = useState<AdminSection>('assistants')
  const [observerSection, setObserverSection] = useState<ObserverSection>('myPanel')
  const [plannerView, setPlannerView] = useState<PlannerView>('rooms')
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loginView, setLoginView] = useState<'choose' | 'admin' | 'assistant'>('choose')
  const [passwordInput, setPasswordInput] = useState('')
  const [assistantUsernameInput, setAssistantUsernameInput] = useState('')
  const [assistantIdentityInput, setAssistantIdentityInput] = useState('')
  const [data, setData] = useState<PlannerState>(() => safeReadState())
  const [userBindings, setUserBindings] = useState<Record<string, string>>(() => safeReadUserBindings())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [cloudState, setCloudState] = useState<'checking' | 'ready' | 'offline' | 'error'>(
    isSupabaseConfigured ? 'checking' : 'offline',
  )
  const [cloudStateText, setCloudStateText] = useState(
    isSupabaseConfigured ? 'Bulut bağlantısı kontrol ediliyor...' : 'Bulut kaydı kapalı',
  )
  const [isCloudSaving, setIsCloudSaving] = useState(false)
  const [cloudLastSavedAt, setCloudLastSavedAt] = useState<string | null>(null)
  const cloudHydratedRef = useRef(false)
  const cloudPayloadRef = useRef('')
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [assistantInput, setAssistantInput] = useState('')

  const [ownersMonth, setOwnersMonth] = useState(currentMonthISO)
  const [ownersEditMode, setOwnersEditMode] = useState(false)
  const [ownersWorking, setOwnersWorking] = useState<LocationOwners>({})
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({})
  const [ownerSelectionDrafts, setOwnerSelectionDrafts] = useState<Record<string, string[]>>({})

  const [dutyMonth, setDutyMonth] = useState(currentMonthISO)
  const [dutyPerDay, setDutyPerDay] = useState(2)
  const [dutyQuickText, setDutyQuickText] = useState('')
  const [dutyImportIssues, setDutyImportIssues] = useState<string[]>([])
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({})
  const [dutyDrafts, setDutyDrafts] = useState<Record<string, string>>({})
  const [dutySiteDrafts, setDutySiteDrafts] = useState<Record<string, DutySite | ''>>({})

  const [observerAssistant, setObserverAssistant] = useState('')
  const [observerMonth, setObserverMonth] = useState(currentMonthISO)
  const [activeObserverWeek, setActiveObserverWeek] = useState('')
  const [observerDay, setObserverDay] = useState('')
  const [observerLocation, setObserverLocation] = useState('')
  const [observerLookupName, setObserverLookupName] = useState('')
  const [observerLookupDay, setObserverLookupDay] = useState('')
  const [plannerMonth, setPlannerMonth] = useState(currentMonthISO)
  const [activePlannerDay, setActivePlannerDay] = useState(todayISO)

  const weekDays = useMemo(() => buildWeek(data.weekStartISO), [data.weekStartISO])
  const plannerMonthDays = useMemo(() => listMonthDays(plannerMonth), [plannerMonth])
  const dutyMonthDays = useMemo(() => listMonthDays(dutyMonth), [dutyMonth])
  const observerWeekGroups = useMemo(() => buildWeekGroupsForMonth(observerMonth), [observerMonth])
  const observerActiveWeekDays = useMemo(
    () => observerWeekGroups.find((group) => group.weekStartISO === activeObserverWeek)?.days ?? [],
    [activeObserverWeek, observerWeekGroups],
  )
  const sortedLocations = useMemo(() => [...data.locations], [data.locations])
  const roomLocations = useMemo(
    () => data.locations.filter((location) => location.kind === 'normal'),
    [data.locations],
  )
  const statusLocations = useMemo(
    () => data.locations.filter((location) => location.kind === 'leave'),
    [data.locations],
  )

  const groupBySite = (locations: WorkLocation[]) => {
    const map = new Map<string, WorkLocation[]>()
    locations.forEach((location) => {
      map.set(location.site, [...(map.get(location.site) ?? []), location])
    })
    const siteOrder = ['Sancaktepe', 'Çekmeköy', 'Feriha Öz', 'Diğer']
    return [...map.entries()].sort(
      (a, b) => siteOrder.indexOf(a[0]) - siteOrder.indexOf(b[0]) || a[0].localeCompare(b[0], 'tr'),
    )
  }

  const groupedRoomLocations = useMemo(() => groupBySite(roomLocations), [roomLocations])
  const groupedStatusLocations = useMemo(() => groupBySite(statusLocations), [statusLocations])
  const groupedObserverLocations = useMemo(() => groupBySite(sortedLocations), [sortedLocations])
  const ownersForSelectedMonth = useMemo(
    () => getLocationOwnersForMonth(data, ownersMonth),
    [data, ownersMonth],
  )
  const visibleOwnersForMonth = ownersEditMode ? ownersWorking : ownersForSelectedMonth
  const ownersMonthOptions = useMemo(() => {
    const months = new Set<string>()
    const anchorMonth = isValidMonthISO(ownersMonth) ? ownersMonth : currentMonthISO
    for (let offset = -3; offset <= 3; offset += 1) {
      months.add(shiftMonthISO(anchorMonth, offset))
    }
    months.add(currentMonthISO)
    Object.keys(data.locationOwnersByMonth)
      .filter(isValidMonthISO)
      .forEach((monthISO) => months.add(monthISO))

    const selectedYear = Number(anchorMonth.slice(0, 4))
    return [...months]
      .sort()
      .map((monthISO) => ({
        value: monthISO,
        label: formatMonthSelectLabel(monthISO, Number.isNaN(selectedYear) ? undefined : selectedYear),
      }))
  }, [currentMonthISO, data.locationOwnersByMonth, ownersMonth])
  const roomLeftGroups = useMemo(
    () => groupedRoomLocations.filter(([siteName]) => siteName !== 'Feriha Öz'),
    [groupedRoomLocations],
  )
  const roomRightGroups = useMemo(
    () => groupedRoomLocations.filter(([siteName]) => siteName === 'Feriha Öz'),
    [groupedRoomLocations],
  )
  const plannerDayOptions = useMemo(
    () =>
      plannerMonthDays.map((dayKey) => {
        const date = fromISODate(dayKey)
        return {
          key: dayKey,
          label: date.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            weekday: 'short',
          }),
          dayTypeLabel: getDayTypeLabel(dayKey),
        }
      }),
    [plannerMonthDays],
  )
  const cloudPayload = useMemo(
    () =>
      JSON.stringify({
        plannerState: data,
        userBindings,
      }),
    [data, userBindings],
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(USER_BINDING_KEY, JSON.stringify(userBindings))
    }
  }, [userBindings])

  useEffect(() => {
    let cancelled = false

    const loadCloudState = async () => {
      if (!isSupabaseConfigured || !supabase) {
        cloudHydratedRef.current = true
        setCloudState('offline')
        setCloudStateText('Bulut kaydı kapalı (Supabase ayarı eksik).')
        return
      }

      setCloudState('checking')
      setCloudStateText('Bulut verisi yükleniyor...')

      const { data: row, error } = await supabase
        .from(REMOTE_STATE_TABLE)
        .select('payload, updated_at')
        .eq('id', REMOTE_STATE_ROW_ID)
        .maybeSingle()

      if (cancelled) {
        return
      }

      if (error) {
        cloudHydratedRef.current = true
        setCloudState('error')
        setCloudStateText('Bulut bağlantısı kurulamadı. Yerel kayıtla devam ediliyor.')
        return
      }

      const fallback = buildFallbackState()
      const currentSnapshot = {
        plannerState: data,
        userBindings,
      }

      if (row?.payload && typeof row.payload === 'object') {
        const payload = row.payload as RemotePortalPayload
        const nextPlannerState =
          payload.plannerState && typeof payload.plannerState === 'object'
            ? sanitizePlannerState(payload.plannerState as Partial<PlannerState>, fallback)
            : data
        const nextUserBindings = sanitizeUserBindings(payload.userBindings)

        const syncedPayload = JSON.stringify({
          plannerState: nextPlannerState,
          userBindings: nextUserBindings,
        })

        cloudPayloadRef.current = syncedPayload
        cloudHydratedRef.current = true
        setData(nextPlannerState)
        setUserBindings(nextUserBindings)
        setCloudState('ready')
        setCloudStateText('Bulut kaydı aktif.')
        if (typeof row.updated_at === 'string' && row.updated_at) {
          setCloudLastSavedAt(row.updated_at)
        }
        return
      }

      const { error: seedError } = await supabase.from(REMOTE_STATE_TABLE).upsert(
        {
          id: REMOTE_STATE_ROW_ID,
          payload: currentSnapshot,
        },
        { onConflict: 'id' },
      )

      if (cancelled) {
        return
      }

      if (seedError) {
        cloudHydratedRef.current = true
        setCloudState('error')
        setCloudStateText('Bulut tablosu hazır değil. SQL kurulumunu tamamlayıp yenile.')
        return
      }

      const nowISO = new Date().toISOString()
      cloudPayloadRef.current = JSON.stringify(currentSnapshot)
      cloudHydratedRef.current = true
      setCloudState('ready')
      setCloudStateText('Bulut kaydı aktif.')
      setCloudLastSavedAt(nowISO)
    }

    void loadCloudState()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !cloudHydratedRef.current) {
      return
    }
    if (cloudPayload === cloudPayloadRef.current) {
      return
    }

    if (cloudSaveTimerRef.current) {
      clearTimeout(cloudSaveTimerRef.current)
      cloudSaveTimerRef.current = null
    }

    cloudSaveTimerRef.current = setTimeout(() => {
      const persistCloudState = async () => {
        if (!supabase) {
          return
        }
        setIsCloudSaving(true)
        const payloadObject = JSON.parse(cloudPayload) as {
          plannerState: PlannerState
          userBindings: Record<string, string>
        }
        const { error } = await supabase.from(REMOTE_STATE_TABLE).upsert(
          {
            id: REMOTE_STATE_ROW_ID,
            payload: payloadObject,
          },
          { onConflict: 'id' },
        )

        if (error) {
          setCloudState('error')
          setCloudStateText('Buluta kaydedilemedi. Bağlantıyı ve tablo izinlerini kontrol et.')
          setIsCloudSaving(false)
          return
        }

        const nowISO = new Date().toISOString()
        cloudPayloadRef.current = cloudPayload
        setCloudState('ready')
        setCloudStateText('Bulut kaydı aktif.')
        setCloudLastSavedAt(nowISO)
        setIsCloudSaving(false)
      }

      void persistCloudState()
    }, REMOTE_SAVE_DEBOUNCE_MS)

    return () => {
      if (cloudSaveTimerRef.current) {
        clearTimeout(cloudSaveTimerRef.current)
        cloudSaveTimerRef.current = null
      }
    }
  }, [cloudPayload])

  useEffect(() => {
    if (loginView !== 'assistant' || assistantUsernameInput.trim()) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }

    const lastUser = localStorage.getItem(LAST_ASSISTANT_USER_KEY)?.trim().toLocaleLowerCase('tr') ?? ''
    if (
      lastUser &&
      ALLOWED_ASSISTANT_USERS.includes(lastUser as (typeof ALLOWED_ASSISTANT_USERS)[number])
    ) {
      setAssistantUsernameInput(lastUser)
    }
  }, [assistantUsernameInput, loginView])

  useEffect(() => {
    setData((previous) =>
      previous.weekStartISO === currentWeekStartISO
        ? previous
        : {
            ...previous,
            weekStartISO: currentWeekStartISO,
          },
    )
  }, [currentWeekStartISO])

  useEffect(() => {
    if (!session) {
      return
    }

    setMode(session.role === 'admin' ? 'admin' : 'observer')
    if (session.role === 'assistant') {
      setObserverSection('myPanel')
      if (session.assistantName) {
        setObserverAssistant(session.assistantName)
        setObserverLookupName(session.assistantName)
      }
    }
  }, [session])

  useEffect(() => {
    if (
      !observerAssistant &&
      session?.role === 'assistant' &&
      session.assistantName &&
      data.assistants.includes(session.assistantName)
    ) {
      setObserverAssistant(session.assistantName)
      return
    }

    if (!data.assistants.includes(observerAssistant)) {
      setObserverAssistant(data.assistants[0] ?? '')
    }
  }, [data.assistants, observerAssistant, session])

  useEffect(() => {
    if (!observerWeekGroups.length) {
      if (activeObserverWeek) {
        setActiveObserverWeek('')
      }
      return
    }

    if (!observerWeekGroups.some((group) => group.weekStartISO === activeObserverWeek)) {
      const preferredWeek = observerWeekGroups.find((group) =>
        group.days.some((day) => day.key === todayISO),
      )
      setActiveObserverWeek(preferredWeek?.weekStartISO ?? observerWeekGroups[0].weekStartISO)
    }
  }, [activeObserverWeek, observerWeekGroups, todayISO])

  useEffect(() => {
    if (!observerActiveWeekDays.length) {
      if (observerDay) {
        setObserverDay('')
      }
      return
    }

    if (!observerActiveWeekDays.some((day) => day.key === observerDay)) {
      const preferredDay = observerActiveWeekDays.find((day) => day.key === todayISO)
      setObserverDay(preferredDay?.key ?? observerActiveWeekDays[0].key)
    }
  }, [observerActiveWeekDays, observerDay, todayISO])

  useEffect(() => {
    if (!observerLookupDay) {
      setObserverLookupDay(todayISO)
    }
  }, [observerLookupDay, todayISO])

  useEffect(() => {
    if (!plannerMonthDays.length) {
      if (activePlannerDay) {
        setActivePlannerDay('')
      }
      return
    }

    if (!plannerMonthDays.includes(activePlannerDay)) {
      const preferredDay = plannerMonthDays.includes(todayISO) ? todayISO : plannerMonthDays[0]
      setActivePlannerDay(preferredDay)
    }
  }, [activePlannerDay, plannerMonthDays, todayISO])

  useEffect(() => {
    if (
      !observerLookupName &&
      session?.role === 'assistant' &&
      session.assistantName &&
      data.assistants.includes(session.assistantName)
    ) {
      setObserverLookupName(session.assistantName)
      return
    }

    if (!data.assistants.includes(observerLookupName)) {
      setObserverLookupName(data.assistants[0] ?? '')
    }
  }, [data.assistants, observerLookupName, session])

  useEffect(() => {
    if (!data.locations.some((location) => location.id === observerLocation)) {
      setObserverLocation(data.locations[0]?.id ?? '')
    }
  }, [data.locations, observerLocation])

  const showWarning = (text: string) => setNotice({ type: 'warn', text })
  const showSuccess = (text: string) => setNotice({ type: 'ok', text })

  const normalizedAssistantUsername = assistantUsernameInput.trim().toLocaleLowerCase('tr')
  const linkedAssistant = userBindings[normalizedAssistantUsername] ?? ''

  const loginAsAdmin = () => {
    if (passwordInput.trim() !== APP_PASSWORD) {
      showWarning('Şifre hatalı. Lütfen tekrar dene.')
      return
    }

    setSession({ role: 'admin' })
    setPasswordInput('')
    setNotice(null)
  }

  const loginAsAssistant = () => {
    if (!ALLOWED_ASSISTANT_USERS.includes(normalizedAssistantUsername as (typeof ALLOWED_ASSISTANT_USERS)[number])) {
      showWarning('Bu kullanıcı adı tanımlı değil. Örnek: ahmetozdemir')
      return
    }

    const existingBinding = userBindings[normalizedAssistantUsername]
    const hasValidExistingBinding =
      typeof existingBinding === 'string' && data.assistants.includes(existingBinding)

    const selectedAssistantName = hasValidExistingBinding
      ? existingBinding
      : assistantIdentityInput.trim()

    if (!selectedAssistantName || !data.assistants.includes(selectedAssistantName)) {
      showWarning('Giriş için asistan listesinden bir isim seçmelisin.')
      return
    }

    setUserBindings((previous) => ({
      ...previous,
      [normalizedAssistantUsername]: selectedAssistantName,
    }))

    setSession({
      role: 'assistant',
      username: normalizedAssistantUsername,
      assistantName: selectedAssistantName,
    })
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_ASSISTANT_USER_KEY, normalizedAssistantUsername)
    }
    setNotice(null)
    setObserverAssistant(selectedAssistantName)
    setObserverLookupName(selectedAssistantName)
  }

  const logout = () => {
    setSession(null)
    setLoginView('choose')
    setMode('admin')
    setPasswordInput('')
    setAssistantUsernameInput('')
    setAssistantIdentityInput('')
    setNotice(null)
  }

  useEffect(() => {
    if (session?.role !== 'assistant') {
      return
    }

    if (!session.assistantName || !data.assistants.includes(session.assistantName)) {
      showWarning('Asistan eşleşmesi bulunamadı. Lütfen tekrar giriş yapıp asistan seç.')
      setSession(null)
      setLoginView('assistant')
      setAssistantUsernameInput(session.username ?? '')
      setAssistantIdentityInput('')
    }
  }, [data.assistants, session])

  const findAssignedLocationForPerson = (
    state: PlannerState,
    dayKey: string,
    person: string,
    excludeLocationId?: string,
    includeDuty = true,
  ) =>
    state.locations.find((location) => {
      if (excludeLocationId && location.id === excludeLocationId) {
        return false
      }
      if (!includeDuty && (location.kind === 'duty' || location.kind === 'postDuty')) {
        return false
      }
      return getAssignmentsForLocation(state, dayKey, location).includes(person)
    })

  const getDutyAssignments = (state: PlannerState, dayKey: string): DutyAssignment[] =>
    state.dutyRoster[dayKey] ?? []

  const getDutyAssignmentForPerson = (
    state: PlannerState,
    dayKey: string,
    person: string,
  ): DutyAssignment | null => getDutyAssignments(state, dayKey).find((entry) => entry.name === person) ?? null

  const getAssistantOptionLabel = (assistant: string, dayKey: string): string => {
    const dutyAssignment = getDutyAssignmentForPerson(data, dayKey, assistant)
    if (!dutyAssignment) {
      return assistant
    }
    return `${assistant} (nöbet: ${dutyAssignment.site})`
  }

  const getDisplayAssignmentsForLocation = (
    state: PlannerState,
    dayKey: string,
    location: WorkLocation,
  ): string[] => {
    if (location.kind === 'duty') {
      return sortDutyAssignments(state.dutyRoster[dayKey] ?? []).map(
        (entry) => `${entry.name} (${entry.site})`,
      )
    }
    if (location.kind === 'postDuty') {
      const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
      return sortDutyAssignments(state.dutyRoster[previousDay] ?? []).map(
        (entry) => `${entry.name} (${entry.site})`,
      )
    }
    return getAssignmentsForLocation(state, dayKey, location)
  }

  const startOwnersEdit = () => {
    if (!isValidMonthISO(ownersMonth)) {
      showWarning('Önce geçerli bir ay seçmelisin.')
      return
    }

    const currentMonthOwners = getLocationOwnersForMonth(data, ownersMonth)
    const hasMonthRecord = Object.prototype.hasOwnProperty.call(data.locationOwnersByMonth, ownersMonth)
    const baseOwners =
      hasMonthRecord && Object.keys(currentMonthOwners).length
        ? currentMonthOwners
        : (() => {
            const closestMonth = findClosestOwnersMonth(data.locationOwnersByMonth, ownersMonth)
            if (closestMonth) {
              return getLocationOwnersForMonth(data, closestMonth)
            }
            return data.locationOwners
          })()

    setOwnersWorking(cloneOwnersForNormalLocations(baseOwners, data.locations, data.assistants))
    setOwnersEditMode(true)
    showSuccess(`${ownersMonth} ayı oda asistanları düzenleme modunda.`)
  }

  const cancelOwnersEdit = () => {
    setOwnersEditMode(false)
    setOwnersWorking({})
    setOwnerDrafts({})
    showWarning('Aylık oda asistanı değişiklikleri iptal edildi.')
  }

  const goOwnersMonth = (delta: number) => {
    if (ownersEditMode) {
      showWarning('Ay değiştirmek için önce Kaydet veya İptal etmelisin.')
      return
    }
    if (!isValidMonthISO(ownersMonth)) {
      setOwnersMonth(currentMonthISO)
      return
    }
    setOwnersMonth(shiftMonthISO(ownersMonth, delta))
  }

  const saveOwnersMonth = () => {
    if (!ownersEditMode) {
      return
    }
    if (!isValidMonthISO(ownersMonth)) {
      showWarning('Kaydetmek için geçerli bir ay seçmelisin.')
      return
    }

    setData((previous) => {
      const normalizedForMonth = cloneOwnersForNormalLocations(
        ownersWorking,
        previous.locations,
        previous.assistants,
      )

      showSuccess(`${ownersMonth} ayı oda asistanları kaydedildi.`)
      return {
        ...previous,
        locationOwners: normalizedForMonth,
        locationOwnersByMonth: {
          ...previous.locationOwnersByMonth,
          [ownersMonth]: normalizedForMonth,
        },
      }
    })

    setOwnersEditMode(false)
    setOwnerDrafts({})
  }

  const addLocationOwner = (locationId: string) => {
    if (!ownersEditMode) {
      showWarning('Değiştirmek için önce "Değiştir" butonuna bas.')
      return
    }

    const location = data.locations.find((item) => item.id === locationId)
    if (!location || location.kind !== 'normal') {
      showWarning('Sadece normal odalar için oda asistanı tanımlanabilir.')
      return
    }

    const candidate = (ownerDrafts[locationId] ?? '').trim()
    if (!candidate) {
      showWarning('Oda asistanı için bir kişi seç.')
      return
    }

    const currentOwners = ownersWorking[locationId] ?? []
    if (currentOwners.includes(candidate)) {
      showWarning(`${candidate} ${ownersMonth} ayında bu odanın asistanları arasında.`)
      return
    }

    setOwnersWorking((previous) => ({
      ...previous,
      [locationId]: uniqueSortedNames([...(previous[locationId] ?? []), candidate]),
    }))
    showSuccess(`${location.site} / ${location.name} (${ownersMonth}) taslağına ${candidate} eklendi.`)

    setOwnerDrafts((previous) => ({
      ...previous,
      [locationId]: '',
    }))
  }

  const removeLocationOwner = (locationId: string, ownerName: string) => {
    if (!ownersEditMode) {
      showWarning('Silmek için önce "Değiştir" butonuna bas.')
      return
    }

    const location = data.locations.find((item) => item.id === locationId)
    if (!location || location.kind !== 'normal') {
      return
    }

    setOwnersWorking((previous) => ({
      ...previous,
      [locationId]: (previous[locationId] ?? []).filter((owner) => owner !== ownerName),
    }))
    showSuccess(
      `${location.site} / ${location.name} (${ownersMonth}) taslağından ${ownerName} çıkarıldı.`,
    )
  }

  const addAssistant = () => {
    const candidate = assistantInput.trim()
    if (!candidate) {
      showWarning('Lütfen eklenecek asistan adını gir.')
      return
    }

    setData((previous) => {
      if (previous.assistants.includes(candidate)) {
        showWarning(`${candidate} zaten listede var.`)
        return previous
      }

      showSuccess(`${candidate} asistan havuzuna eklendi.`)
      return {
        ...previous,
        assistants: uniqueSortedNames([...previous.assistants, candidate]),
      }
    })

    setAssistantInput('')
  }

  const removeAssistant = (name: string) => {
    setData((previous) => {
      const remainingAssistants = previous.assistants.filter((assistant) => assistant !== name)
      const nextOwners = Object.fromEntries(
        Object.entries(previous.locationOwners).map(([locationId, owners]) => [
          locationId,
          uniqueSortedNames((owners ?? []).filter((owner) => owner !== name)),
        ]),
      )
      const nextOwnersByMonth = Object.fromEntries(
        Object.entries(previous.locationOwnersByMonth).map(([monthISO, monthOwners]) => [
          monthISO,
          Object.fromEntries(
            Object.entries(monthOwners).map(([locationId, owners]) => [
              locationId,
              uniqueSortedNames((owners ?? []).filter((owner) => owner !== name)),
            ]),
          ),
        ]),
      )

      showSuccess(`${name} listeden çıkarıldı.`)
      return {
        ...previous,
        assistants: remainingAssistants,
        locationOwners: nextOwners,
        locationOwnersByMonth: nextOwnersByMonth,
        manualAssignments: removeNameFromManual(previous.manualAssignments, name),
        dutyRoster: removeNameFromDuty(previous.dutyRoster, name),
      }
    })

    setUserBindings((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([, assistantName]) => assistantName !== name),
      ),
    )
  }

  const addDutyPerson = (dayKey: string) => {
    const draftKey = `duty-${dayKey}`
    const candidate = cellDrafts[draftKey] || dutyDrafts[dayKey] || ''
    const selectedSite = dutySiteDrafts[dayKey]

    if (!candidate) {
      showWarning('Nöbet için bir kişi seçmelisin.')
      return
    }
    if (!selectedSite) {
      showWarning('Nöbet eklemek için önce nöbet yerini seçmelisin.')
      return
    }
    if (!data.assistants.includes(candidate)) {
      showWarning(`${candidate} asistan listesinde yok. Lütfen önce asistan havuzuna ekle.`)
      return
    }

    setData((previous) => {
      const currentDay = previous.dutyRoster[dayKey] ?? []
      if (currentDay.some((entry) => entry.name === candidate)) {
        showWarning(`${candidate} zaten ${dayKey} nöbetinde.`)
        return previous
      }

      const leaveOrRotation = previous.locations.find((location) => {
        if (location.kind !== 'leave') {
          return false
        }
        return getAssignmentsForLocation(previous, dayKey, location).includes(candidate)
      })
      if (leaveOrRotation) {
        showWarning(
          `${candidate} ${dayKey} için ${leaveOrRotation.site} / ${leaveOrRotation.name} alanında görünüyor. Önce bu atamayı kaldır.`,
        )
        return previous
      }

      const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
      const nextDay = toISODate(addDays(fromISODate(dayKey), 1))
      const wasOnDutyYesterday = (previous.dutyRoster[previousDay] ?? []).some(
        (entry) => entry.name === candidate,
      )
      const alreadyOnDutyTomorrow = (previous.dutyRoster[nextDay] ?? []).some(
        (entry) => entry.name === candidate,
      )
      if (wasOnDutyYesterday || alreadyOnDutyTomorrow) {
        showWarning(`${candidate} üst üste iki gün nöbetçi olamaz.`)
        return previous
      }

      const nextDutyRoster: DutyRoster = {
        ...previous.dutyRoster,
        [dayKey]: uniqueDutyAssignments([...currentDay, { name: candidate, site: selectedSite }]),
      }

      const sanitized = sanitizeManualAssignments(
        previous.manualAssignments,
        nextDutyRoster,
        previous.locations,
      )

      if (sanitized.removedCount > 0) {
        showWarning(
          `${candidate} nöbete eklendi. Kural nedeniyle ${sanitized.removedCount} normal atama temizlendi.`,
        )
      } else {
        showSuccess(`${candidate} ${dayKey} için nöbete eklendi.`)
      }

      return {
        ...previous,
        dutyRoster: nextDutyRoster,
        manualAssignments: sanitized.manualAssignments,
      }
    })

    setDutyDrafts((previous) => ({ ...previous, [dayKey]: '' }))
    setDutySiteDrafts((previous) => ({ ...previous, [dayKey]: '' }))
    setCellDrafts((previous) => ({ ...previous, [draftKey]: '' }))
  }

  const removeDutyPerson = (dayKey: string, name: string) => {
    setData((previous) => {
      const filtered = (previous.dutyRoster[dayKey] ?? []).filter((entry) => entry.name !== name)
      const nextDutyRoster = { ...previous.dutyRoster, [dayKey]: filtered }

      showSuccess(`${name} ${dayKey} nöbetinden çıkarıldı.`)
      return {
        ...previous,
        dutyRoster: nextDutyRoster,
      }
    })
  }

  const generateDutySchedule = () => {
    const normalizedMonth = dutyMonth.trim()
    const monthDays = listMonthDays(normalizedMonth)
    if (!monthDays.length) {
      showWarning('Geçerli bir ay seç. Örnek: 2026-05')
      return
    }

    const normalizedPerDay = Math.max(1, Math.min(Number(dutyPerDay) || 0, data.assistants.length || 1))

    setData((previous) => {
      const generated = generateDutyRosterForMonth(previous.assistants, normalizedMonth, normalizedPerDay)
      if (!Object.keys(generated).length) {
        showWarning('Nöbet üretilemedi. Asistan listesi boş olabilir.')
        return previous
      }

      const withoutMonth = removeMonthFromDutyRoster(previous.dutyRoster, normalizedMonth)
      const nextDutyRoster = {
        ...withoutMonth,
        ...generated,
      }

      const sanitized = sanitizeManualAssignments(
        previous.manualAssignments,
        nextDutyRoster,
        previous.locations,
      )

      const generatedCount = Object.values(generated).reduce((count, names) => count + names.length, 0)
      if (sanitized.removedCount > 0) {
        showWarning(
          `${normalizedMonth} için ${generatedCount} nöbet ataması üretildi. ${sanitized.removedCount} normal atama nöbet kuralı nedeniyle temizlendi.`,
        )
      } else {
        showSuccess(`${normalizedMonth} için ${generatedCount} nöbet ataması otomatik üretildi.`)
      }

      return {
        ...previous,
        dutyRoster: nextDutyRoster,
        manualAssignments: sanitized.manualAssignments,
      }
    })

    setDutyImportIssues([])
  }

  const clearMonthDutySchedule = () => {
    const normalizedMonth = dutyMonth.trim()
    const monthDays = listMonthDays(normalizedMonth)
    if (!monthDays.length) {
      showWarning('Temizlemek için geçerli bir ay seç.')
      return
    }

    setData((previous) => {
      const nextDutyRoster = removeMonthFromDutyRoster(previous.dutyRoster, normalizedMonth)
      showSuccess(`${normalizedMonth} ayı nöbet kayıtları temizlendi.`)
      return {
        ...previous,
        dutyRoster: nextDutyRoster,
      }
    })

    setDutyImportIssues([])
  }

  const importDutyQuickLines = () => {
    const yearFromMonth = Number(dutyMonth.slice(0, 4))
    const fallbackYear = Number.isNaN(yearFromMonth) ? new Date().getFullYear() : yearFromMonth
    const parsed = parseDutyQuickLines(dutyQuickText, fallbackYear)
    const issueMessagesFromParser = parsed.issues.map(
      (issue) => `${issue.lineNumber}. satır: ${issue.message} (${issue.rawLine})`,
    )

    if (!parsed.totalNames) {
      setDutyImportIssues(issueMessagesFromParser)
      showWarning(
        'Geçerli satır bulunamadı. Örnek: 26.01 Aslınur (Çekmeköy), Fatih (Sancaktepe)',
      )
      return
    }

    let issueMessages = [...issueMessagesFromParser]

    setData((previous) => {
      const mergedDuty: DutyRoster = { ...previous.dutyRoster }
      const rejectedDays: string[] = []
      let addedCount = 0

      Object.entries(parsed.data).forEach(([dayKey, entries]) => {
        const unknownNames = uniqueSortedNames(
          entries
            .map((entry) => entry.name)
            .filter((name) => !previous.assistants.includes(name)),
        )
        if (unknownNames.length) {
          rejectedDays.push(`${dayKey} (asistan yok: ${unknownNames.join(', ')})`)
          issueMessages.push(`${dayKey}: asistan listesinde olmayan kişi var (${unknownNames.join(', ')})`)
          return
        }

        const dayNames = entries.map((entry) => entry.name)
        if (new Set(dayNames).size !== dayNames.length) {
          rejectedDays.push(`${dayKey} (aynı kişi birden fazla kez yazılmış)`)
          issueMessages.push(`${dayKey}: aynı kişi birden fazla kez yazılmış`)
          return
        }

        const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
        const nextDay = toISODate(addDays(fromISODate(dayKey), 1))
        const prevDayNames = new Set(
          dutyAssignmentsToNames(mergedDuty[previousDay] ?? previous.dutyRoster[previousDay] ?? []),
        )
        const nextDayNames = new Set(
          dutyAssignmentsToNames(mergedDuty[nextDay] ?? previous.dutyRoster[nextDay] ?? []),
        )
        const consecutiveNames = dayNames.filter(
          (name) => prevDayNames.has(name) || nextDayNames.has(name),
        )
        if (consecutiveNames.length) {
          rejectedDays.push(
            `${dayKey} (üst üste nöbet: ${uniqueSortedNames(consecutiveNames).join(', ')})`,
          )
          issueMessages.push(
            `${dayKey}: üst üste nöbet kuralı (${uniqueSortedNames(consecutiveNames).join(', ')})`,
          )
          return
        }

        const currentDay = mergedDuty[dayKey] ?? previous.dutyRoster[dayKey] ?? []
        mergedDuty[dayKey] = uniqueDutyAssignments([...currentDay, ...entries])
        addedCount += entries.length
      })

      const sanitized = sanitizeManualAssignments(previous.manualAssignments, mergedDuty, previous.locations)

      if (issueMessages.length || rejectedDays.length) {
        showWarning(
          `${addedCount} nöbetçi eklendi. Hatalı/atlanan kayıt: ${issueMessages.length}. Reddedilen gün: ${
            rejectedDays.length ? rejectedDays.join(' | ') : 'yok'
          }.`,
        )
      } else if (sanitized.removedCount > 0) {
        showWarning(
          `${addedCount} nöbetçi işlendi. ${sanitized.removedCount} normal atama nöbet kuralı nedeniyle temizlendi.`,
        )
      } else {
        showSuccess(`${addedCount} nöbetçi satırdan eklendi.`)
      }

      return {
        ...previous,
        dutyRoster: mergedDuty,
        manualAssignments: sanitized.manualAssignments,
      }
    })

    setDutyImportIssues(issueMessages)
    setDutyQuickText('')
  }

  const addAssignment = (dayKey: string, locationId: string) => {
    const draftKey = `${dayKey}-${locationId}`
    const candidate = cellDrafts[draftKey]

    if (!candidate) {
      showWarning('Atama yapmak için bir kişi seç.')
      return
    }
    if (!data.assistants.includes(candidate)) {
      showWarning(`${candidate} asistan listesinde yok.`)
      return
    }

    setData((previous) => {
      const location = previous.locations.find((item) => item.id === locationId)
      if (!location) {
        return previous
      }
      const workingDay = !isNonWorkingDay(fromISODate(dayKey))

      if (!EDITABLE_KINDS.has(location.kind)) {
        showWarning(`${location.name} alanı otomatik yönetiliyor, manuel atama kapalı.`)
        return previous
      }
      if (!workingDay && (location.kind === 'normal' || location.kind === 'leave')) {
        showWarning(
          `${location.site} / ${location.name} sadece hafta içi ve resmi tatil olmayan günlerde atanabilir.`,
        )
        return previous
      }

      const dayAssignments = {
        ...(previous.manualAssignments[dayKey] ?? {}),
      }

      const currentNames = dayAssignments[locationId] ?? []
      if (currentNames.includes(candidate)) {
        showWarning(`${candidate} zaten bu alanda görünüyor.`)
        return previous
      }

      if (location.kind === 'normal') {
        const occupiedNormalLocation = previous.locations.find((item) => {
          if (item.kind !== 'normal' || item.id === location.id) {
            return false
          }
          return getAssignmentsForLocation(previous, dayKey, item).includes(candidate)
        })
        if (occupiedNormalLocation) {
          showWarning(
            `${candidate} aynı gün birden fazla odaya yazılamaz. Şu an: ${occupiedNormalLocation.site} / ${occupiedNormalLocation.name}`,
          )
          return previous
        }

        const blockedStatusLocation = previous.locations.find((item) => {
          if (item.kind === 'normal' || item.kind === 'duty') {
            return false
          }
          return getAssignmentsForLocation(previous, dayKey, item).includes(candidate)
        })
        if (blockedStatusLocation) {
          showWarning(
            `${candidate} ${blockedStatusLocation.site} / ${blockedStatusLocation.name} durumunda olduğu için odaya yazılamaz.`,
          )
          return previous
        }
      } else {
        const existing = findAssignedLocationForPerson(previous, dayKey, candidate, locationId)
        if (existing) {
          showWarning(
            `${candidate} aynı gün sadece bir yerde olabilir. Şu an: ${existing.site} / ${existing.name}`,
          )
          return previous
        }
      }

      dayAssignments[locationId] = uniqueSortedNames([...currentNames, candidate])

      const nextManualAssignments: ManualAssignments = {
        ...previous.manualAssignments,
        [dayKey]: dayAssignments,
      }

      showSuccess(`${candidate} -> ${location.site} / ${location.name} (${dayKey}) atandı.`)
      return {
        ...previous,
        manualAssignments: nextManualAssignments,
      }
    })

    setCellDrafts((previous) => ({
      ...previous,
      [draftKey]: '',
    }))
  }

  const toggleOwnerSelection = (dayKey: string, locationId: string, ownerName: string) => {
    const draftKey = `${dayKey}-${locationId}`
    setOwnerSelectionDrafts((previous) => {
      const current = previous[draftKey] ?? []
      const next = current.includes(ownerName)
        ? current.filter((name) => name !== ownerName)
        : [...current, ownerName]

      return {
        ...previous,
        [draftKey]: next,
      }
    })
  }

  const applyOwnerSelections = (dayKey: string, locationId: string) => {
    const draftKey = `${dayKey}-${locationId}`
    const selectedOwners = uniqueSortedNames(ownerSelectionDrafts[draftKey] ?? [])
    if (!selectedOwners.length) {
      showWarning('Önce oda asistanı seçeneklerinden en az bir kişi seç.')
      return
    }

    setData((previous) => {
      const location = previous.locations.find((item) => item.id === locationId)
      if (!location || location.kind !== 'normal') {
        return previous
      }
      if (isNonWorkingDay(fromISODate(dayKey))) {
        showWarning(`${location.site} / ${location.name} hafta sonu veya resmi tatilde planlanamaz.`)
        return previous
      }

      const dayAssignments = {
        ...(previous.manualAssignments[dayKey] ?? {}),
      }
      const currentNames = dayAssignments[locationId] ?? []
      const nextNames = [...currentNames]
      const blockedByStatus: string[] = []
      const blockedByRoom: string[] = []
      let addedCount = 0

      selectedOwners.forEach((owner) => {
        if (nextNames.includes(owner)) {
          return
        }

        const blockedStatusLocation = previous.locations.find((item) => {
          if (item.kind === 'normal' || item.kind === 'duty') {
            return false
          }
          return getAssignmentsForLocation(previous, dayKey, item).includes(owner)
        })
        if (blockedStatusLocation) {
          blockedByStatus.push(owner)
          return
        }

        const occupiedRoom = previous.locations.find((item) => {
          if (item.kind !== 'normal' || item.id === locationId) {
            return false
          }
          return getAssignmentsForLocation(previous, dayKey, item).includes(owner)
        })
        if (occupiedRoom) {
          blockedByRoom.push(owner)
          return
        }

        nextNames.push(owner)
        addedCount += 1
      })

      if (!addedCount) {
        showWarning('Seçilen oda asistanları bu gün için uygun değil.')
        return previous
      }

      dayAssignments[locationId] = uniqueSortedNames(nextNames)
      const nextManualAssignments: ManualAssignments = {
        ...previous.manualAssignments,
        [dayKey]: dayAssignments,
      }

      if (blockedByStatus.length || blockedByRoom.length) {
        showWarning(
          `${dayKey} için ${addedCount} kişi eklendi. Atlananlar: ${
            blockedByStatus.length ? `durum engeli ${blockedByStatus.join(', ')}` : ''
          } ${blockedByRoom.length ? `oda çakışması ${blockedByRoom.join(', ')}` : ''}`.trim(),
        )
      } else {
        showSuccess(`${dayKey} için ${addedCount} oda asistanı eklendi.`)
      }

      return {
        ...previous,
        manualAssignments: nextManualAssignments,
      }
    })

    setOwnerSelectionDrafts((previous) => ({
      ...previous,
      [draftKey]: [],
    }))
  }

  const removeAssignment = (dayKey: string, locationId: string, name: string) => {
    setData((previous) => {
      const dayAssignments = {
        ...(previous.manualAssignments[dayKey] ?? {}),
      }

      dayAssignments[locationId] = (dayAssignments[locationId] ?? []).filter((item) => item !== name)

      showSuccess(`${name} atamadan çıkarıldı.`)
      return {
        ...previous,
        manualAssignments: {
          ...previous.manualAssignments,
          [dayKey]: dayAssignments,
        },
      }
    })
  }

  const autoFillDay = (dayKey: string) => {
    const nextOwnerDrafts: Record<string, string[]> = {}

    setData((previous) => {
      const dayAssignments = {
        ...(previous.manualAssignments[dayKey] ?? {}),
      }
      const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
      const monthOwners = getLocationOwnersForDay(previous, dayKey)

      const blocked = new Set<string>([
        ...dutyAssignmentsToNames(previous.dutyRoster[previousDay] ?? []),
      ])

      const normalLocations = previous.locations.filter((location) => location.kind === 'normal')
      const assignedToday = new Set<string>()

      previous.locations.forEach((location) => {
        if (location.kind === 'duty') {
          return
        }
        getAssignmentsForLocation(previous, dayKey, location).forEach((name) =>
          assignedToday.add(name),
        )
      })

      let updatedCount = 0
      let skippedNoOwner = 0
      let skippedBlocked = 0
      let skippedAssigned = 0
      let promptedRoomCount = 0

      normalLocations.forEach((location) => {
        const current = uniqueSortedNames(dayAssignments[location.id] ?? [])
        const owners = (monthOwners[location.id] ?? [])
          .map((owner) => owner.trim())
          .filter(Boolean)

        if (!owners.length) {
          skippedNoOwner += 1
          return
        }

        if (owners.length > 1) {
          nextOwnerDrafts[`${dayKey}-${location.id}`] = owners
          promptedRoomCount += 1
          return
        }

        const nextRoomNames = [...current]
        owners.forEach((owner) => {
          if (nextRoomNames.includes(owner)) {
            return
          }
          if (blocked.has(owner)) {
            skippedBlocked += 1
            return
          }
          const assignedLocation = findAssignedLocationForPerson(
            previous,
            dayKey,
            owner,
            location.id,
            false,
          )
          if (assignedLocation || assignedToday.has(owner)) {
            skippedAssigned += 1
            return
          }
          nextRoomNames.push(owner)
          assignedToday.add(owner)
          updatedCount += 1
        })

        const ownerSet = new Set(owners)
        const ownerFirst = owners.filter((owner) => nextRoomNames.includes(owner))
        const others = nextRoomNames.filter((name) => !ownerSet.has(name))
        dayAssignments[location.id] = [...ownerFirst, ...others]
      })

      if (!updatedCount && !promptedRoomCount) {
        showWarning(
          'Varsayılan oda ataması yapılamadı. Oda asistanı eksik veya kişi uygun olmayabilir.',
        )
        return previous
      }

      if (promptedRoomCount) {
        showSuccess(
          `${dayKey} için ${updatedCount} otomatik atama yapıldı. ${promptedRoomCount} odada birden fazla oda asistanı var; alttaki seçeneklerden işaretleyip onaylayabilirsin.`,
        )
      } else {
        showSuccess(
          `${dayKey} için ${updatedCount} odada varsayılan asistan yazıldı. Atlanan: oda asistanı yok ${skippedNoOwner}, müsait değil ${skippedBlocked}, başka yerde atanmış ${skippedAssigned}.`,
        )
      }
      return {
        ...previous,
        manualAssignments: {
          ...previous.manualAssignments,
          [dayKey]: dayAssignments,
        },
      }
    })

    if (Object.keys(nextOwnerDrafts).length) {
      setOwnerSelectionDrafts((previous) => ({
        ...previous,
        ...nextOwnerDrafts,
      }))
    }
  }

  const clearDayAssignments = (dayKey: string) => {
    setData((previous) => {
      const dayAssignments = {
        ...(previous.manualAssignments[dayKey] ?? {}),
      }
      previous.locations
        .filter((location) => EDITABLE_KINDS.has(location.kind))
        .forEach((location) => {
          dayAssignments[location.id] = []
        })

      showSuccess(`${dayKey} için manuel atamalar temizlendi.`)
      return {
        ...previous,
        manualAssignments: {
          ...previous.manualAssignments,
          [dayKey]: dayAssignments,
        },
      }
    })
  }

  const weekAssignmentsForPerson = useMemo(() => {
    if (!observerAssistant) {
      return []
    }

    return weekDays.map((day) => {
      const locations = sortedLocations.filter((location) =>
        getAssignmentsForLocation(data, day.key, location).includes(observerAssistant),
      )
      const dayTypeLabel = getDayTypeLabel(day.key)

      return {
        day,
        locations,
        dayTypeLabel,
      }
    })
  }, [data, observerAssistant, sortedLocations, weekDays])

  const selectedLocationWorkers = useMemo(() => {
    const location = data.locations.find((item) => item.id === observerLocation)
    if (!location || !observerDay) {
      return []
    }
    return getDisplayAssignmentsForLocation(data, observerDay, location)
  }, [data, observerDay, observerLocation])

  const observerLookupResult = useMemo(() => {
    if (!observerLookupDay || !observerLookupName) {
      return []
    }

    return sortedLocations.filter((location) =>
      getAssignmentsForLocation(data, observerLookupDay, location).includes(observerLookupName),
    )
  }, [data, observerLookupDay, observerLookupName, sortedLocations])

  const loggedAssistantName = session?.role === 'assistant' ? session.assistantName ?? '' : ''
  const myWeekAssignments = useMemo(() => {
    if (!loggedAssistantName) {
      return []
    }

    return weekDays.map((day) => {
      const locations = sortedLocations.filter((location) =>
        getAssignmentsForLocation(data, day.key, location).includes(loggedAssistantName),
      )
      const dayTypeLabel = getDayTypeLabel(day.key)
      return { day, locations, dayTypeLabel }
    })
  }, [data, loggedAssistantName, sortedLocations, weekDays])

  const myMonthlyDuties = useMemo(() => {
    if (!loggedAssistantName) {
      return []
    }

    return listMonthDays(observerMonth)
      .map((dayKey) => {
        const duty = (data.dutyRoster[dayKey] ?? []).find((entry) => entry.name === loggedAssistantName)
        return duty ? { dayKey, site: duty.site } : null
      })
      .filter((item): item is { dayKey: string; site: DutySite } => Boolean(item))
  }, [data.dutyRoster, loggedAssistantName, observerMonth])

  const myWeeklyActiveDayCount = useMemo(
    () => myWeekAssignments.filter((day) => day.locations.length > 0).length,
    [myWeekAssignments],
  )

  const myMonthlyDutyCount = myMonthlyDuties.length
  const myMonthlyDutyBySite = useMemo(() => {
    const counts: Record<DutySite, number> = {
      Sancaktepe: 0,
      'Feriha Öz': 0,
      Çekmeköy: 0,
    }
    myMonthlyDuties.forEach((duty) => {
      counts[duty.site] += 1
    })
    return counts
  }, [myMonthlyDuties])

  const myCalendarWeeks = useMemo(() => buildMonthCalendarGrid(observerMonth), [observerMonth])
  const myCalendarMonthTitle = useMemo(() => {
    const [yearRaw, monthRaw] = observerMonth.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return observerMonth
    }
    return new Date(year, month - 1, 1).toLocaleDateString('tr-TR', {
      month: 'long',
      year: 'numeric',
    })
  }, [observerMonth])
  const myCalendarSelectedYear = useMemo(() => Number(observerMonth.slice(0, 4)), [observerMonth])
  const myCalendarMonthOptions = useMemo(() => {
    const months = new Set<string>()

    Object.keys(data.manualAssignments).forEach((dayKey) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        months.add(dayKey.slice(0, 7))
      }
    })
    Object.keys(data.dutyRoster).forEach((dayKey) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        months.add(dayKey.slice(0, 7))
      }
    })
    Object.keys(data.locationOwnersByMonth).forEach((monthISO) => {
      if (isValidMonthISO(monthISO)) {
        months.add(monthISO)
      }
    })

    if (!months.size) {
      months.add(currentMonthISO)
    }

    return [...months]
      .sort()
      .map((value) => ({
        value,
        label: formatMonthSelectLabel(value, Number.isNaN(myCalendarSelectedYear) ? undefined : myCalendarSelectedYear),
      }))
  }, [currentMonthISO, data.dutyRoster, data.locationOwnersByMonth, data.manualAssignments, myCalendarSelectedYear])

  useEffect(() => {
    if (!myCalendarMonthOptions.length) {
      return
    }
    const availableMonths = myCalendarMonthOptions.map((option) => option.value)
    if (!availableMonths.includes(observerMonth)) {
      setObserverMonth(availableMonths[availableMonths.length - 1] ?? currentMonthISO)
    }
  }, [currentMonthISO, myCalendarMonthOptions, observerMonth])

  const myCalendarDayMap = useMemo(() => {
    const entries: Record<
      string,
      {
        locations: WorkLocation[]
        duty: DutyAssignment | null
      }
    > = {}

    myCalendarWeeks.flat().forEach((cell) => {
      const dayKey = cell.key
      const duty = (data.dutyRoster[dayKey] ?? []).find((entry) => entry.name === loggedAssistantName) ?? null
      const locations = sortedLocations.filter(
        (location) =>
          location.kind !== 'duty' &&
          location.kind !== 'postDuty' &&
          getAssignmentsForLocation(data, dayKey, location).includes(loggedAssistantName),
      )
      entries[dayKey] = {
        locations,
        duty,
      }
    })

    return entries
  }, [data, loggedAssistantName, myCalendarWeeks, sortedLocations])

  const adminDutyTableModel = useMemo(
    () => buildDutyTableModel(data.dutyRoster, dutyMonth),
    [data.dutyRoster, dutyMonth],
  )
  const observerDutyTableModel = useMemo(
    () => buildDutyTableModel(data.dutyRoster, observerMonth),
    [data.dutyRoster, observerMonth],
  )
  const selectedPlannerDay = useMemo(() => {
    if (!activePlannerDay) {
      return null
    }
    const date = fromISODate(activePlannerDay)
    return {
      key: activePlannerDay,
      label: date.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        weekday: 'long',
      }),
      dayTypeLabel: getDayTypeLabel(activePlannerDay),
    }
  }, [activePlannerDay])

  const renderDutyListTable = (tableModel: DutyTableModel, keyPrefix: string) => (
    <div className="duty-list-table-wrap">
      <table className="duty-list-table">
        <colgroup>
          <col className="duty-col-day" />
          <col className="duty-col-sancaktepe" />
          <col className="duty-col-feriha-oz" />
          <col className="duty-col-cekmekoy" />
        </colgroup>
        <thead>
          <tr>
            <th className="day-col">
              Gün
            </th>
            {DUTY_SITES.map((site) => (
              <th
                key={`${keyPrefix}-site-${site}`}
                className={`site-col-head site-col-${dutySiteClassName(site)}`}
              >
                {site}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableModel.rows.map((row) => (
            <tr
              key={`${keyPrefix}-row-${row.dayKey}`}
              className={row.holidayReason ? 'holiday-row' : row.weekend ? 'weekend-row' : ''}
            >
              <td className="day-col">
                <div className="day-col-main">
                  <strong>{fromISODate(row.dayKey).toLocaleDateString('tr-TR', { day: 'numeric' })}</strong>
                  <span>
                    {fromISODate(row.dayKey).toLocaleDateString('tr-TR', {
                      month: 'short',
                      weekday: 'short',
                    })}
                  </span>
                </div>
                {row.holidayReason ? (
                  <small className="holiday-reason-inline">{row.holidayReason}</small>
                ) : null}
              </td>

              {DUTY_SITES.map((site) => (
                <td
                  key={`${keyPrefix}-cell-${row.dayKey}-${site}`}
                  className={`site-col-cell site-col-${dutySiteClassName(site)}`}
                >
                  {row.bySite[site].length ? (
                    <div className="duty-name-stack">
                      {row.bySite[site].map((name) => (
                        <span key={`${keyPrefix}-name-${row.dayKey}-${site}-${name}`} className="duty-name-line">
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="empty tiny">-</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderPlannerGroups = (dayKey: string, groups: Array<[string, WorkLocation[]]>) => {
    const ownersForDay = getLocationOwnersForDay(data, dayKey)
    return groups.map(([siteName, locations]) => (
      <div className="site-block" key={`${dayKey}-${siteName}-${plannerView}`}>
        <h4>{siteName}</h4>
        {locations.map((location) => {
          const names = getAssignmentsForLocation(data, dayKey, location)
          const draftKey = `${dayKey}-${location.id}`
          const owners = location.kind === 'normal' ? ownersForDay[location.id] ?? [] : []
          const uniqueOwners = [...new Set(owners)]
          const orderedAssistants = uniqueOwners.length
            ? [
                ...uniqueOwners,
                ...data.assistants.filter((assistant) => !uniqueOwners.includes(assistant)),
              ]
            : data.assistants

          return (
            <div
              className={`location-row tone-${location.tone} kind-${location.kind}`}
              key={`${dayKey}-${location.id}`}
            >
              <div className="location-meta">
                <strong>
                  {location.name}
                  {location.kind === 'normal' && uniqueOwners.length > 0 ? (
                    <span className="owner-inline">
                      {' '}
                      ({uniqueOwners.join(', ')} -{' '}
                      {uniqueOwners.length > 1 ? 'bu odanın asistanları' : 'bu odanın asistanı'})
                    </span>
                  ) : null}
                </strong>
                <span>{LOCATION_KIND_LABELS[location.kind]}</span>
              </div>

              <div className="chip-wrap">
                {names.length ? (
                  names.map((name) => (
                    <button
                      key={`${dayKey}-${location.id}-${name}`}
                      type="button"
                      className="chip removable"
                      onClick={() => removeAssignment(dayKey, location.id, name)}
                    >
                      {name}
                    </button>
                  ))
                ) : (
                  <span className="empty">Atama yok</span>
                )}
              </div>

              <div className="form-row compact">
                <select
                  value={cellDrafts[draftKey] ?? ''}
                  onChange={(event) =>
                    setCellDrafts((previous) => ({
                      ...previous,
                      [draftKey]: event.target.value,
                    }))
                  }
                >
                  <option value="">Kişi seç</option>
                  {orderedAssistants.map((assistant, index) => (
                    <option key={assistant} value={assistant}>
                      {index < uniqueOwners.length && uniqueOwners.includes(assistant)
                        ? `${getAssistantOptionLabel(assistant, dayKey)} (odanın asistanı)`
                        : getAssistantOptionLabel(assistant, dayKey)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => addAssignment(dayKey, location.id)}
                >
                  Ekle
                </button>
              </div>

              {location.kind === 'normal' &&
              uniqueOwners.length > 1 &&
              ownerSelectionDrafts[draftKey] ? (
                <div className="owner-choice-box">
                  <p className="hint-text">
                    Birden fazla oda asistanı var. Uygun olanları seçip onayla.
                  </p>
                  <div className="owner-choice-grid">
                    {uniqueOwners.map((ownerName) => {
                      const selectedOwners = ownerSelectionDrafts[draftKey] ?? []
                      const isSelected = selectedOwners.includes(ownerName)
                      return (
                        <label key={`${draftKey}-owner-choice-${ownerName}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOwnerSelection(dayKey, location.id, ownerName)}
                          />
                          <span>{getAssistantOptionLabel(ownerName, dayKey)}</span>
                        </label>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => applyOwnerSelections(dayKey, location.id)}
                  >
                    Seçilenleri Onayla
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    ))
  }

  if (!session) {
    return (
      <div className="page-shell login-shell">
        <section className="card login-card fade-up">
          <p className="eyebrow">Giriş</p>
          <h1>Çalışma Listesi Portalı</h1>
          <p className="subtext">Giriş türünü seçip devam et.</p>

          {loginView === 'choose' ? (
            <div className="login-actions">
              <button type="button" onClick={() => setLoginView('admin')}>
                Admin
              </button>
              <button type="button" className="secondary" onClick={() => setLoginView('assistant')}>
                Asistan Hekim
              </button>
            </div>
          ) : null}

          {loginView === 'admin' ? (
            <>
              <div className="date-control">
                <label htmlFor="app-password">Admin Şifresi</label>
                <input
                  id="app-password"
                  type="password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  placeholder="Şifreyi gir"
                />
              </div>
              <div className="login-actions">
                <button type="button" onClick={loginAsAdmin}>
                  Admin Olarak Gir
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setLoginView('choose')
                    setPasswordInput('')
                  }}
                >
                  Geri
                </button>
              </div>
            </>
          ) : null}

          {loginView === 'assistant' ? (
            <>
              <div className="date-control">
                <label htmlFor="assistant-user">Kullanıcı Adı</label>
                <input
                  id="assistant-user"
                  list="assistant-user-options"
                  value={assistantUsernameInput}
                  onChange={(event) => setAssistantUsernameInput(event.target.value)}
                  placeholder="Örn: ahmetozdemir"
                />
                <datalist id="assistant-user-options">
                  {ALLOWED_ASSISTANT_USERS.map((username) => (
                    <option key={`username-option-${username}`} value={username} />
                  ))}
                </datalist>
              </div>

              <div className="quick-user-list">
                {ALLOWED_ASSISTANT_USERS.map((username) => (
                  <button
                    key={`quick-user-${username}`}
                    type="button"
                    className={normalizedAssistantUsername === username ? 'active' : ''}
                    onClick={() => setAssistantUsernameInput(username)}
                  >
                    {username}
                  </button>
                ))}
              </div>

              {normalizedAssistantUsername &&
              ALLOWED_ASSISTANT_USERS.includes(
                normalizedAssistantUsername as (typeof ALLOWED_ASSISTANT_USERS)[number],
              ) &&
              (!linkedAssistant || !data.assistants.includes(linkedAssistant)) ? (
                <div className="date-control">
                  <label htmlFor="assistant-identity">Asistan Listesinden Eşleştir</label>
                  <select
                    id="assistant-identity"
                    value={assistantIdentityInput}
                    onChange={(event) => setAssistantIdentityInput(event.target.value)}
                  >
                    <option value="">Asistan seç</option>
                    {data.assistants.map((assistant) => (
                      <option key={`identity-${assistant}`} value={assistant}>
                        {assistant}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {linkedAssistant && data.assistants.includes(linkedAssistant) ? (
                <p className="hint-text">Bu kullanıcı daha önce {linkedAssistant} ile eşleştirilmiş.</p>
              ) : null}

              <div className="login-actions">
                <button type="button" onClick={loginAsAssistant}>
                  Asistan Olarak Gir
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setLoginView('choose')
                    setAssistantUsernameInput('')
                    setAssistantIdentityInput('')
                  }}
                >
                  Geri
                </button>
              </div>
            </>
          ) : null}

          {notice ? (
            <div className={`notice ${notice.type === 'ok' ? 'success' : 'warning'}`}>
              {notice.text}
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <header className="topbar card fade-up">
        <div>
          <p className="eyebrow">Planlama</p>
          <h1>Çalışma Listesi Portalı</h1>
        </div>

        <div className="top-controls">
          <div className="session-role">
            <span>Aktif Giriş</span>
            <strong>
              {session.role === 'admin'
                ? 'Admin'
                : `Asistan Hekim (${session.assistantName ?? session.username ?? 'Bilinmiyor'})`}
            </strong>
          </div>

          <div className={`session-role cloud-sync cloud-${cloudState}`}>
            <span>Bulut Senkron</span>
            <strong>{isCloudSaving ? 'Kaydediliyor...' : cloudStateText}</strong>
            {cloudLastSavedAt ? (
              <small>
                Son kayıt:{' '}
                {new Date(cloudLastSavedAt).toLocaleDateString('tr-TR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}{' '}
                {new Date(cloudLastSavedAt).toLocaleTimeString('tr-TR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            ) : null}
          </div>

          <div className="date-control">
            <label htmlFor="assistant-focus">Kişi Görünümü</label>
            <select
              id="assistant-focus"
              value={observerAssistant}
              onChange={(event) => {
                setObserverAssistant(event.target.value)
                setObserverLookupName(event.target.value)
              }}
            >
              {data.assistants.map((assistant) => (
                <option key={`focus-top-${assistant}`} value={assistant}>
                  {assistant}
                </option>
              ))}
            </select>
          </div>

          <div className="header-actions">
            <button type="button" className="ghost-button" onClick={logout}>
              Çıkış Yap
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className={`notice ${notice.type === 'ok' ? 'success' : 'warning'}`}>{notice.text}</div>
      ) : null}

      <section className="stats-grid fade-up delay-1">
        <article className="stat-card">
          <span>Toplam Asistan</span>
          <strong>{data.assistants.length}</strong>
        </article>
        <article className="stat-card">
          <span>Toplam Çalışma Alanı</span>
          <strong>{data.locations.length}</strong>
        </article>
      </section>

      {mode === 'admin' ? (
        <main className="stack-layout">
          <section className="card fade-up delay-2 section-switcher">
            <h2>Admin Modülleri</h2>
            <div className="subpanel-toggle">
              <button
                type="button"
                className={adminSection === 'assistants' ? 'active' : ''}
                onClick={() => setAdminSection('assistants')}
              >
                Asistanlar
              </button>
              <button
                type="button"
                className={adminSection === 'locations' ? 'active' : ''}
                onClick={() => setAdminSection('locations')}
              >
                Alanlar
              </button>
              <button
                type="button"
                className={adminSection === 'duty' ? 'active' : ''}
                onClick={() => setAdminSection('duty')}
              >
                Nöbet
              </button>
              <button
                type="button"
                className={adminSection === 'planner' ? 'active' : ''}
                onClick={() => setAdminSection('planner')}
              >
                Planlama
              </button>
            </div>
          </section>

          {adminSection === 'assistants' ? (
            <section className="card fade-up delay-2">
            <h2>Asistan Havuzu</h2>
            <p className="subtext">
              Kişi sayısını buradan tek tek artırabilirsin. Her alan için kişi sayısı sınırsızdır.
            </p>

            <div className="form-row">
              <input
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                placeholder="Yeni asistan adı"
              />
              <button type="button" onClick={addAssistant}>
                Asistan Ekle
              </button>
            </div>

            <div className="chip-wrap">
              {data.assistants.map((assistant) => (
                <button
                  key={assistant}
                  type="button"
                  className="chip removable"
                  onClick={() => removeAssistant(assistant)}
                  title="Listeden çıkar"
                >
                  {assistant}
                </button>
              ))}
            </div>
            </section>
          ) : null}

          {adminSection === 'locations' ? (
            <section className="card fade-up delay-3">
            <h2>Çalışma Alanları</h2>
            <p className="subtext">
              Çalışma alanları sabit. Oda asistanlarını ay bazlı kaydedebilirsin. Her ay farklı
              tanımlanabilir ve planlamada seçilen tarihin ayındaki liste kullanılır.
            </p>

            <div className="form-row owners-month-row">
              <button
                type="button"
                className="ghost-button"
                disabled={ownersEditMode}
                onClick={() => goOwnersMonth(-1)}
              >
                Önceki Ay
              </button>
              <select
                className="my-calendar-month-select"
                value={ownersMonth}
                disabled={ownersEditMode}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  if (isValidMonthISO(nextMonth)) {
                    setOwnersMonth(nextMonth)
                  }
                }}
              >
                {ownersMonthOptions.map((option) => (
                  <option key={`owners-month-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button"
                disabled={ownersEditMode}
                onClick={() => goOwnersMonth(1)}
              >
                Sonraki Ay
              </button>
              <span className="hint-text owners-month-hint">
                {ownersEditMode
                  ? `${ownersMonth} ayı düzenleme modunda. Bitirince Kaydet veya İptal et.`
                  : `${ownersMonth} ayı oda asistanları görüntüleniyor.`}
              </span>
            </div>
            <div className="form-row owners-action-row">
              {!ownersEditMode ? (
                <button type="button" className="secondary" onClick={startOwnersEdit}>
                  Değiştir
                </button>
              ) : null}
              {ownersEditMode ? (
                <button type="button" className="secondary" onClick={saveOwnersMonth}>
                  Kaydet
                </button>
              ) : null}
              {ownersEditMode ? (
                <button type="button" className="ghost-button" onClick={cancelOwnersEdit}>
                  İptal
                </button>
              ) : null}
            </div>

            {groupedRoomLocations.map(([siteName, locations]) => (
              <section key={`location-group-${siteName}`} className="site-group-card">
                <h3 className="site-group-title">{siteName}</h3>
                <div className="location-chip-grid">
                  {locations.map((location) => (
                    <article
                      key={location.id}
                      className={`location-pill tone-${location.tone} kind-${location.kind}`}
                    >
                      <div>
                        <p>
                          {location.name}
                          {(visibleOwnersForMonth[location.id] ?? []).length > 0 ? (
                            <span className="owner-inline">
                              {' '}
                              (
                              {(visibleOwnersForMonth[location.id] ?? []).join(', ')} -{' '}
                              {(visibleOwnersForMonth[location.id] ?? []).length > 1
                                ? 'bu odanın asistanları'
                                : 'bu odanın asistanı'}
                              )
                            </span>
                          ) : null}
                        </p>
                        <small>{LOCATION_KIND_LABELS[location.kind]}</small>
                      </div>
                      <div className="location-actions">
                        <select
                          disabled={!ownersEditMode}
                          value={ownerDrafts[location.id] ?? ''}
                          onChange={(event) =>
                            setOwnerDrafts((previous) => ({
                              ...previous,
                              [location.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Oda asistanı seç</option>
                          {data.assistants.map((assistant) => (
                            <option key={`${location.id}-owner-${assistant}`} value={assistant}>
                              {assistant}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!ownersEditMode}
                          onClick={() => addLocationOwner(location.id)}
                        >
                          Ekle
                        </button>
                      </div>
                      {(visibleOwnersForMonth[location.id] ?? []).length ? (
                        <div className="chip-wrap">
                          {(visibleOwnersForMonth[location.id] ?? []).map((ownerName) => (
                            <button
                              key={`${location.id}-owner-chip-${ownerName}`}
                              type="button"
                              className="chip removable"
                              disabled={!ownersEditMode}
                              onClick={() => removeLocationOwner(location.id, ownerName)}
                              title="Oda asistanı listesinden çıkar"
                            >
                              {ownerName}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ))}
            </section>
          ) : null}

          {adminSection === 'duty' ? (
            <section className="card fade-up delay-4">
            <h2>Otomatik Aylık Nöbet</h2>
            <p className="subtext">
              Nöbet listesini manuel girmek yerine seçtiğin ay için otomatik üret. Üretim sonrası
              nöbet ertesi kuralı ve normal alan filtreleri otomatik uygulanır. Nöbetler her gün
              yazılır; hafta sonu ve resmi tatiller dahildir.
            </p>
            <div className="form-row responsive">
              <input
                type="month"
                value={dutyMonth}
                onChange={(event) => setDutyMonth(event.target.value)}
              />
              <input
                type="number"
                min={1}
                max={Math.max(1, data.assistants.length)}
                value={dutyPerDay}
                onChange={(event) => setDutyPerDay(Number(event.target.value))}
                placeholder="Günlük nöbetçi sayısı"
              />
              <button type="button" onClick={generateDutySchedule}>
                Otomatik Üret
              </button>
              <button type="button" className="ghost-button" onClick={clearMonthDutySchedule}>
                Ayı Temizle
              </button>
            </div>

            <p className="subtext">
              Hızlı satır girişi: <code>26.01 Aslınur (Çekmeköy), Fatih (Sancaktepe)</code> veya{' '}
              <code>2026-01-26: Aslınur (Feriha Öz); Tuğçe (Sancaktepe)</code>
            </p>
            <textarea
              value={dutyQuickText}
              onChange={(event) => setDutyQuickText(event.target.value)}
              placeholder={'26.01 Aslınur (Çekmeköy), Fatih (Sancaktepe)\n27.01 Gamze (Feriha Öz)'}
            />
            <div className="form-row">
              <button type="button" className="secondary" onClick={importDutyQuickLines}>
                Satırlardan Nöbet Ekle
              </button>
            </div>

            {dutyImportIssues.length ? (
              <article className="import-issue-card">
                <h3>Hızlı Giriş Uyarıları</h3>
                <ul>
                  {dutyImportIssues.map((issue, index) => (
                    <li key={`duty-issue-${index}`}>{issue}</li>
                  ))}
                </ul>
              </article>
            ) : null}

            <div className="week-duty-grid">
              {dutyMonthDays.map((dayKey) => {
                const dayDate = fromISODate(dayKey)
                const dayLabel = dayDate.toLocaleDateString('tr-TR', {
                  day: '2-digit',
                  month: '2-digit',
                  weekday: 'long',
                })
                const dayDuty = sortDutyAssignments(data.dutyRoster[dayKey] ?? [])
                return (
                  <article key={dayKey} className="duty-day-card">
                    <h3>{dayLabel}</h3>
                    <div className="chip-wrap">
                      {dayDuty.length ? (
                        dayDuty.map((entry) => (
                          <button
                            type="button"
                            key={`${dayKey}-${entry.name}-${entry.site}`}
                            className={`chip removable duty-site-chip duty-site-${dutySiteClassName(
                              entry.site,
                            )}`}
                            onClick={() => removeDutyPerson(dayKey, entry.name)}
                          >
                            {entry.name} ({entry.site})
                          </button>
                        ))
                      ) : (
                        <span className="empty">Nöbet kaydı yok</span>
                      )}
                    </div>

                    <div className="form-row duty-row">
                      <select
                        value={dutySiteDrafts[dayKey] ?? ''}
                        onChange={(event) =>
                          setDutySiteDrafts((previous) => ({
                            ...previous,
                            [dayKey]: normalizeDutySite(event.target.value) ?? '',
                          }))
                        }
                      >
                        <option value="">Nöbet yeri seç</option>
                        {DUTY_SITES.map((site) => (
                          <option key={`site-${dayKey}-${site}`} value={site}>
                            {site}
                          </option>
                        ))}
                      </select>
                      <select
                        value={dutyDrafts[dayKey] ?? ''}
                        onChange={(event) =>
                          setDutyDrafts((previous) => ({
                            ...previous,
                            [dayKey]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Kişi seç</option>
                        {data.assistants.map((assistant) => (
                          <option key={assistant} value={assistant}>
                            {assistant}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => addDutyPerson(dayKey)}
                      >
                        Nöbete Ekle
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>

            <article className="focus-location duty-list-module">
              <h3>Aylık Nöbet Listesi</h3>
              <p className="subtext">Excel benzeri görünüm: günler satır, nöbet yerleri sütun grupları.</p>
              {renderDutyListTable(adminDutyTableModel, 'admin-duty')}
            </article>
            </section>
          ) : null}

          {adminSection === 'planner' ? (
            <section className="card fade-up delay-5">
            <h2>Aylık Atama Editörü</h2>
            <p className="subtext">
              Ay ve tarih seçerek planlamayı yönetebilirsin. İşlem yapılmamış tarihler de görünür.
              Nöbet ertesi, izinli ve rotasyondakiler odalara yazılamaz. Nöbetçiler aynı gün odaya
              yazılabilir.
            </p>

            <div className="form-row responsive planner-date-controls">
              <input
                type="month"
                value={plannerMonth}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  setPlannerMonth(nextMonth)
                  if (!nextMonth) {
                    return
                  }
                  const nextMonthDays = listMonthDays(nextMonth)
                  if (!nextMonthDays.length) {
                    return
                  }
                  if (!nextMonthDays.includes(activePlannerDay)) {
                    const preferred = nextMonthDays.includes(todayISO) ? todayISO : nextMonthDays[0]
                    setActivePlannerDay(preferred)
                  }
                }}
              />
              <input
                type="date"
                value={activePlannerDay}
                onChange={(event) => {
                  const normalized = normalizeDateToken(event.target.value)
                  if (!normalized) {
                    return
                  }
                  setActivePlannerDay(normalized)
                  const nextMonth = normalized.slice(0, 7)
                  if (nextMonth !== plannerMonth) {
                    setPlannerMonth(nextMonth)
                  }
                }}
              />
            </div>

            <div className="planner-day-tabs planner-month-tabs">
              {plannerDayOptions.map((day) => (
                <button
                  key={`planner-tab-${day.key}`}
                  type="button"
                  className={`${activePlannerDay === day.key ? 'active' : ''}${
                    day.dayTypeLabel ? ' nonworking' : ''
                  }`}
                  onClick={() => setActivePlannerDay(day.key)}
                >
                  {day.label}
                </button>
              ))}
            </div>

            {selectedPlannerDay ? (
              (() => {
                const day = selectedPlannerDay
                return (
                  <div className="week-grid">
                    <article key={day.key} className="day-card">
                  <header>
                    <h3>{day.label}</h3>
                    <small>{day.key}</small>
                  </header>

                  {day.dayTypeLabel ? (
                    <p className="hint-text planner-hint">
                      {day.dayTypeLabel} günü: normal oda ve izin/rotasyon ataması yapılamaz.
                    </p>
                  ) : null}

                  <div className="day-tools">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => autoFillDay(day.key)}
                    >
                      Varsayılanları Yaz
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => clearDayAssignments(day.key)}
                    >
                      Manueli Temizle
                    </button>
                  </div>
                  <div className="planner-mode-tabs">
                    <button
                      type="button"
                      className={plannerView === 'rooms' ? 'active' : ''}
                      onClick={() => setPlannerView('rooms')}
                    >
                      Odalar
                    </button>
                    <button
                      type="button"
                      className={plannerView === 'status' ? 'active' : ''}
                      onClick={() => setPlannerView('status')}
                    >
                      İzin / Rotasyon
                    </button>
                  </div>

                  <div
                    className={`planner-layout ${
                      plannerView === 'rooms' ? 'planner-layout-rooms' : 'planner-layout-status'
                    }`}
                  >
                    <div className="planner-main-column">
                      {plannerView === 'rooms'
                        ? renderPlannerGroups(day.key, roomLeftGroups)
                        : renderPlannerGroups(day.key, groupedStatusLocations)}
                    </div>

                    <aside className="planner-side-panel">
                      {(() => {
                        const previousDayKey = toISODate(addDays(fromISODate(day.key), -1))
                        const dutyEntries = sortDutyAssignments(data.dutyRoster[day.key] ?? [])
                        const postDutyEntries = sortDutyAssignments(data.dutyRoster[previousDayKey] ?? [])
                        const normalLocations = data.locations.filter(
                          (location) => location.kind === 'normal',
                        )
                        const leaveLocations = data.locations.filter(
                          (location) => location.kind === 'leave',
                        )
                        const leaveNames = uniqueSortedNames(
                          leaveLocations
                            .filter(
                              (location) =>
                                !location.name.toLocaleLowerCase('tr').includes('rotasyon'),
                            )
                            .flatMap((location) =>
                              getAssignmentsForLocation(data, day.key, location),
                            ),
                        )
                        const rotationNames = uniqueSortedNames(
                          leaveLocations
                            .filter((location) =>
                              location.name.toLocaleLowerCase('tr').includes('rotasyon'),
                            )
                            .flatMap((location) =>
                              getAssignmentsForLocation(data, day.key, location),
                            ),
                        )
                        const blockedStatusLocations = data.locations.filter(
                          (location) => location.kind === 'leave' || location.kind === 'postDuty',
                        )
                        const unplacedAssignableNames = uniqueSortedNames(
                          data.assistants.filter((assistant) => {
                            const alreadyInRoom = normalLocations.some((location) =>
                              getAssignmentsForLocation(data, day.key, location).includes(assistant),
                            )
                            if (alreadyInRoom) {
                              return false
                            }

                            const blockedByStatus = blockedStatusLocations.some((location) =>
                              getAssignmentsForLocation(data, day.key, location).includes(assistant),
                            )
                            if (blockedByStatus) {
                              return false
                            }

                            return true
                          }),
                        )

                        return (
                          <>
                      <h4>Nöbetçiler</h4>
                      <div className="chip-wrap">
                            {dutyEntries.length ? (
                              dutyEntries.map((entry) => (
                            <span
                              key={`planner-duty-${day.key}-${entry.name}-${entry.site}`}
                              className={`chip duty-site-chip duty-site-${dutySiteClassName(entry.site)}`}
                            >
                              {entry.name} ({entry.site})
                            </span>
                              ))
                            ) : (
                          <span className="empty">Nöbetçi yok</span>
                            )}
                      </div>

                      <h4>Nöbet Ertesiler</h4>
                      <div className="chip-wrap">
                            {postDutyEntries.length ? (
                              postDutyEntries.map((entry) => (
                            <span
                              key={`planner-post-duty-${day.key}-${entry.name}-${entry.site}`}
                              className={`chip duty-site-chip duty-site-${dutySiteClassName(entry.site)}`}
                            >
                              {entry.name} ({entry.site})
                            </span>
                              ))
                            ) : (
                          <span className="empty">Nöbet ertesi yok</span>
                            )}
                          </div>

                          <h4>İzinliler</h4>
                          <div className="stack-list">
                            {leaveNames.length ? (
                              leaveNames.map((name) => (
                                <span key={`planner-leave-${day.key}-${name}`} className="chip">
                                  {name}
                                </span>
                              ))
                            ) : (
                              <span className="empty">İzinli yok</span>
                            )}
                          </div>

                          <h4>Rotasyondakiler</h4>
                          <div className="stack-list">
                            {rotationNames.length ? (
                              rotationNames.map((name) => (
                                <span key={`planner-rotation-${day.key}-${name}`} className="chip">
                                  {name}
                                </span>
                              ))
                            ) : (
                              <span className="empty">Rotasyonda kimse yok</span>
                            )}
                          </div>

                          <h4>Yerleştirilmeyenler (Odaya Yazılabilir)</h4>
                          <div className="chip-wrap">
                            {unplacedAssignableNames.length ? (
                              unplacedAssignableNames.map((assistantName) => {
                                const dutyEntry = dutyEntries.find(
                                  (entry) => entry.name === assistantName,
                                )
                                return (
                                <span
                                  key={`planner-unplaced-assignable-${day.key}-${assistantName}`}
                                  className={`chip ${
                                    dutyEntry
                                      ? `duty-site-chip duty-site-${dutySiteClassName(dutyEntry.site)}`
                                      : ''
                                  }`}
                                >
                                  {dutyEntry
                                    ? `${assistantName} (nöbet: ${dutyEntry.site})`
                                    : assistantName}
                                </span>
                                )
                              })
                            ) : (
                              <span className="empty">Yerleştirilmeyen yok</span>
                            )}
                          </div>
                          </>
                        )
                      })()}
                    </aside>

                    {plannerView === 'rooms' ? (
                      <div className="planner-main-column planner-right-column">
                        {renderPlannerGroups(day.key, roomRightGroups)}
                      </div>
                    ) : null}
                  </div>
                    </article>
                  </div>
                )
              })()
            ) : plannerDayOptions.length > 0 ? (
              <p className="hint-text planner-hint">Ayrıntıları görmek için bir tarih seç.</p>
            ) : null}
            {plannerDayOptions.length === 0 ? (
              <p className="hint-text planner-hint">
                Seçilen ay için gün bulunamadı.
              </p>
            ) : null}
            </section>
          ) : null}
        </main>
      ) : (
        <main className="stack-layout">
          <section className="card fade-up delay-2 section-switcher">
            <h2>Asistan Hekim Modülleri</h2>
            <div className="subpanel-toggle observer-toggle">
              <button
                type="button"
                className={observerSection === 'myPanel' ? 'active' : ''}
                onClick={() => setObserverSection('myPanel')}
              >
                Kendi Modülüm
              </button>
              <button
                type="button"
                className={observerSection === 'personWeek' ? 'active' : ''}
                onClick={() => setObserverSection('personWeek')}
              >
                Kişi Haftası
              </button>
              <button
                type="button"
                className={observerSection === 'dailyMap' ? 'active' : ''}
                onClick={() => setObserverSection('dailyMap')}
              >
                Günlük Harita
              </button>
              <button
                type="button"
                className={observerSection === 'dutyList' ? 'active' : ''}
                onClick={() => setObserverSection('dutyList')}
              >
                Nöbet Listesi
              </button>
              <button
                type="button"
                className={observerSection === 'personLookup' ? 'active' : ''}
                onClick={() => setObserverSection('personLookup')}
              >
                Kişi Sorgu
              </button>
            </div>
          </section>

          {observerSection === 'myPanel' ? (
            <section className="card fade-up delay-2">
              <h2>Kendi İsmim</h2>
              <p className="subtext">
                Bu bölüm sadece giriş yapan asistan hekimin seçili aydaki günlük çalışma yerlerini ve
                nöbetlerini takvim üzerinde gösterir.
              </p>

              <div className="my-summary-grid">
                <article className="my-summary-card">
                  <span>Bu Hafta Aktif Gün</span>
                  <strong>{myWeeklyActiveDayCount}</strong>
                </article>
                <article className="my-summary-card">
                  <span>Bu Ay Toplam Nöbet</span>
                  <strong>{myMonthlyDutyCount}</strong>
                </article>
                <article className="my-summary-card">
                  <span>Nöbet Dağılımı</span>
                  <strong>
                    S:{myMonthlyDutyBySite.Sancaktepe} F:{myMonthlyDutyBySite['Feriha Öz']} Ç:
                    {myMonthlyDutyBySite['Çekmeköy']}
                  </strong>
                </article>
              </div>

              <article className="focus-location my-calendar-panel">
                <div className="my-calendar-toolbar">
                  <h3>{myCalendarMonthTitle}</h3>
                  <select
                    className="my-calendar-month-select"
                    value={observerMonth}
                    onChange={(event) => setObserverMonth(event.target.value)}
                  >
                    {myCalendarMonthOptions.map((option) => (
                      <option key={`my-calendar-month-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="my-calendar-scroll">
                  <div className="my-calendar-weekdays">
                    {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((weekday) => (
                      <span key={`my-calendar-weekday-${weekday}`}>{weekday}</span>
                    ))}
                  </div>

                  <div className="my-calendar-grid">
                    {myCalendarWeeks.flat().map((cell) => {
                      const dayDate = fromISODate(cell.key)
                      const dayNumber = dayDate.getDate()
                      const dayData = myCalendarDayMap[cell.key]
                      const locations = dayData?.locations ?? []
                      const dutyEntry = dayData?.duty ?? null
                      const dayTypeLabel = getDayTypeLabel(cell.key)
                      const holidayReason = cell.inMonth ? getOfficialHolidayReason(cell.key) : null

                      return (
                        <article
                          key={`my-calendar-${cell.key}`}
                          className={`my-calendar-cell${cell.inMonth ? '' : ' outside-month'}${
                            cell.weekend ? ' weekend' : ''
                          }${cell.officialHoliday ? ' holiday' : ''}${cell.key === todayISO ? ' today' : ''}`}
                        >
                          <header>
                            <strong>{dayNumber}</strong>
                            <small>{cell.key}</small>
                          </header>

                          <div className="my-calendar-content">
                            {holidayReason ? (
                              <span className="my-calendar-holiday-reason">{holidayReason}</span>
                            ) : null}

                            {dutyEntry ? (
                              <span
                                className={`my-calendar-duty duty-site-${dutySiteClassName(dutyEntry.site)}`}
                              >
                                Nöbet ({dutySiteShortLabel(dutyEntry.site)})
                              </span>
                            ) : null}

                            {locations.map((location) => (
                              <span
                                key={`my-calendar-location-${cell.key}-${location.id}`}
                                className="my-calendar-location"
                              >
                                {location.site} / {location.name}
                              </span>
                            ))}

                            {!dutyEntry && !locations.length ? (
                              <span className="empty tiny">
                                {cell.inMonth && dayTypeLabel
                                  ? holidayReason
                                    ? 'Resmi tatil'
                                    : dayTypeLabel
                                  : cell.inMonth
                                    ? 'Atama yok'
                                    : ''}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              </article>
            </section>
          ) : null}

          {observerSection === 'personWeek' ? (
            <section className="card fade-up delay-2">
            <h2>Kişi Bazlı Hızlı Görünüm</h2>
            <p className="subtext">
              Bir kişi bu hafta nerede çalışıyor sorusunu tek ekranda takip edebilirsin.
            </p>

            <div className="form-row">
              <select
                value={observerAssistant}
                onChange={(event) => setObserverAssistant(event.target.value)}
              >
                <option value="">Kişi seç</option>
                {data.assistants.map((assistant) => (
                  <option key={assistant} value={assistant}>
                    {assistant}
                  </option>
                ))}
              </select>
            </div>

            <div className="timeline-grid">
              {weekAssignmentsForPerson.map(({ day, locations, dayTypeLabel }) => (
                <article key={`timeline-${day.key}`} className="timeline-card">
                  <header>
                    <strong>{day.shortLabel}</strong>
                    <small>{day.key}</small>
                  </header>
                  <div className="chip-wrap">
                    {locations.length ? (
                      locations.map((location) => (
                        <span key={`${day.key}-${location.id}`} className="chip soft">
                          {location.site} / {location.name}
                        </span>
                      ))
                    ) : dayTypeLabel ? (
                      <span className="empty offday-text">{dayTypeLabel} günü</span>
                    ) : (
                      <span className="empty">Atama görünmüyor</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            </section>
          ) : null}

          {observerSection === 'dailyMap' ? (
            <section className="card fade-up delay-3">
            <h2>Günlük Genel Dağılım</h2>
            <p className="subtext">
              Başka birinin nerede olduğunu veya bir alanda kimlerin olduğunu buradan hızlıca gör.
            </p>

            <div className="form-row responsive">
              <select
                className="my-calendar-month-select"
                value={observerMonth}
                onChange={(event) => {
                  setObserverMonth(event.target.value)
                  setActiveObserverWeek('')
                }}
              >
                {myCalendarMonthOptions.map((option) => (
                  <option key={`observer-month-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={observerLocation}
                onChange={(event) => setObserverLocation(event.target.value)}
              >
                {sortedLocations.map((location) => (
                  <option key={`filter-${location.id}`} value={location.id}>
                    {location.site} / {location.name}
                  </option>
                ))}
              </select>
            </div>

            <h3 className="observer-tab-title">Hafta Seç</h3>
            <div className="planner-day-tabs observer-week-tabs">
              {observerWeekGroups.map((group) => (
                <button
                  key={`observer-week-${group.weekStartISO}`}
                  type="button"
                  className={activeObserverWeek === group.weekStartISO ? 'active' : ''}
                  onClick={() => setActiveObserverWeek(group.weekStartISO)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            {observerActiveWeekDays.length ? (
              <>
                <h3 className="observer-tab-title">Gün Seç</h3>
                <div className="planner-day-tabs observer-day-tabs">
                {observerActiveWeekDays.map((day) => (
                  <button
                    key={`observer-day-${day.key}`}
                    type="button"
                    className={observerDay === day.key ? 'active' : ''}
                    onClick={() => setObserverDay(day.key)}
                  >
                    {day.shortLabel} (
                    {fromISODate(day.key).toLocaleDateString('tr-TR', { weekday: 'long' })})
                  </button>
                ))}
                </div>
              </>
            ) : (
              <p className="hint-text planner-hint">Bu ay için gösterilecek gün bulunamadı.</p>
            )}

            <article className="focus-location">
              <h3>Burada Kim Çalışıyor?</h3>
              <p className="subtext">
                {observerDay
                  ? new Date(observerDay).toLocaleDateString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      weekday: 'long',
                    })
                  : 'Gün seçilmedi'}{' '}
                -{' '}
                {sortedLocations.find((location) => location.id === observerLocation)?.site} /{' '}
                {sortedLocations.find((location) => location.id === observerLocation)?.name}
              </p>
              <div className="chip-wrap">
                {selectedLocationWorkers.length ? (
                  selectedLocationWorkers.map((name) => (
                    <span className="chip" key={`focus-${observerDay}-${observerLocation}-${name}`}>
                      {name}
                    </span>
                  ))
                ) : (
                  <span className="empty">Bu tarih ve alanda kimse görünmüyor.</span>
                )}
              </div>
            </article>

            {groupedObserverLocations.map(([siteName, siteLocations]) => (
              <section key={`observer-site-group-${siteName}`} className="site-group-card">
                <h3 className="site-group-title">{siteName}</h3>
                <div className="location-tiles">
                  {siteLocations.map((location) => {
                    const names = observerDay
                      ? getDisplayAssignmentsForLocation(data, observerDay, location)
                      : []

                    return (
                      <article key={`observer-${location.id}`} className={`tile tone-${location.tone}`}>
                        <header>
                          <h4>{location.name}</h4>
                          <small>{LOCATION_KIND_LABELS[location.kind]}</small>
                        </header>
                        <div className="chip-wrap">
                          {names.length ? (
                            names.map((name) => (
                              <span className="chip" key={`observer-${location.id}-${name}`}>
                                {name}
                              </span>
                            ))
                          ) : (
                            <span className="empty">Atama yok</span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
            </section>
          ) : null}

          {observerSection === 'dutyList' ? (
            <section className="card fade-up delay-3">
              <h2>Nöbet Listesi</h2>
              <p className="subtext">
                Seçili ayın nöbet dağılımını tablo halinde takip edebilirsin.
              </p>

              <div className="form-row">
                <select
                  className="my-calendar-month-select"
                  value={observerMonth}
                  onChange={(event) => setObserverMonth(event.target.value)}
                >
                  {myCalendarMonthOptions.map((option) => (
                    <option key={`observer-duty-month-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <article className="focus-location duty-list-module">
                <h3>Aylık Nöbet Listesi</h3>
                <p className="subtext">Excel benzeri görünüm: günler satır, nöbet yerleri sütun grupları.</p>
                {renderDutyListTable(observerDutyTableModel, 'observer-duty')}
              </article>
            </section>
          ) : null}

          {observerSection === 'personLookup' ? (
            <section className="card fade-up delay-3">
              <h2>Bir Kişi Bugün Nerede?</h2>
              <p className="subtext">
                Seçtiğin gün için herhangi bir kişinin tüm konumlarını ve durumunu tek kartta gör.
              </p>

              <div className="form-row responsive">
                <input
                  type="date"
                  value={observerLookupDay}
                  onChange={(event) => setObserverLookupDay(event.target.value)}
                />
                <select
                  value={observerLookupName}
                  onChange={(event) => setObserverLookupName(event.target.value)}
                >
                  {data.assistants.map((assistant) => (
                    <option key={`lookup-${assistant}`} value={assistant}>
                      {assistant}
                    </option>
                  ))}
                </select>
              </div>

              <article className="focus-location">
                <h3>
                  {observerLookupName || 'Kişi Seçilmedi'} -{' '}
                  {observerLookupDay
                    ? new Date(observerLookupDay).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        weekday: 'long',
                      })
                    : 'Tarih Seçilmedi'}
                </h3>
                <div className="chip-wrap">
                  {observerLookupResult.length ? (
                    observerLookupResult.map((location) => (
                      <span
                        className={`chip tone-${location.tone}`}
                        key={`lookup-result-${location.id}`}
                      >
                        {location.site} / {location.name} ({LOCATION_KIND_LABELS[location.kind]})
                      </span>
                    ))
                  ) : (
                    <span className="empty">Bu kişi seçilen gün için atanmış görünmüyor.</span>
                  )}
                </div>
              </article>
            </section>
          ) : null}
        </main>
      )}
    </div>
  )
}

export default App
