import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  isCloudWriteEnabled,
  isSupabaseAdminAuthRequired,
  LOGIN_EVENTS_TABLE,
  REMOTE_STATE_HISTORY_TABLE,
  isSupabaseConfigured,
  REMOTE_STATE_ROW_ID,
  REMOTE_STATE_TABLE,
  supabase,
} from './supabase'
import WeeklyRotaExportView, {
  type WeeklyRotaExportDay,
  type WeeklyRotaExportGroup,
  type WeeklyRotaExportRow,
} from './WeeklyRotaExportView'
import AssistantMonthlyTableView, {
  type AssistantMonthlyCalendarCell,
  type AssistantMonthlyCalendarDayData,
} from './AssistantMonthlyTableView'

type PanelMode = 'admin' | 'observer'
type AdminSection =
  | 'assistants'
  | 'locations'
  | 'duty'
  | 'planner'
  | 'specialists'
  | 'backups'
  | 'loginEvents'
type ObserverSection = 'myPanel' | 'personWeek' | 'dailyMap'
type ObserverWeekDetailView = 'person' | 'room' | 'duty'
type PlannerView = 'rooms' | 'status'
type LocationKind = 'normal' | 'leave' | 'duty' | 'postDuty'
type LocationTone = 'sand' | 'sage' | 'amber' | 'sky' | 'rose'
type DutySite = 'Sancaktepe' | 'Feriha Öz' | 'Çekmeköy'
type AdminCloudAuthStatus = 'disabled' | 'checking' | 'signed-out' | 'signed-in' | 'unauthorized' | 'error'
type SpecialistDutySite =
  | 'Sancaktepe'
  | 'Çekmeköy'
  | 'Feriha C123'
  | 'Feriha C456'
  | 'Feriha G123'
type SeniorityLevel = number

type ManualAssignments = Record<string, Record<string, string[]>>
type DutyRoster = Record<string, DutyAssignment[]>
type SpecialistWorkAssignments = Record<string, Record<string, string[]>>
type SpecialistWorkDayAssignments = Record<string, string[]>
type SpecialistDutyRoster = Record<string, SpecialistDutyAssignment[]>
type LocationOwners = Record<string, string[]>
type LocationOwnersByMonth = Record<string, LocationOwners>
type PostDutyPoolByMonth = Record<string, string[]>
type AssistantRanks = Record<string, SeniorityLevel>

interface DutyAssignment {
  name: string
  site: DutySite
}

interface SpecialistDutyAssignment {
  name: string
  site: SpecialistDutySite
}

interface DutyCellEntry {
  label: string
  kind: 'assistant' | 'specialist'
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
  order?: number
  orderHistory?: Array<{ from: string; value: number }>
  activeFrom?: string
  activeUntil?: string | null
}

interface PlannerState {
  assistants: string[]
  assistantRanks: AssistantRanks
  locations: WorkLocation[]
  locationOwners: LocationOwners
  locationOwnersByMonth: LocationOwnersByMonth
  postDutyPoolByMonth: PostDutyPoolByMonth
  manualAssignments: ManualAssignments
  dutyRoster: DutyRoster
  specialistWorkAssignments: SpecialistWorkAssignments
  specialistDutyRoster: SpecialistDutyRoster
  weekStartISO: string
}

interface DayInfo {
  key: string
  label: string
  shortLabel: string
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
  bySite: Record<DutySite, DutyCellEntry[]>
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

interface AdminLoginGuardState {
  failedAttempts: number
  blockedUntil: number
  rememberedAdmin: boolean
}

interface LoginEventEntry {
  id: number
  personName: string
  createdAt: string
  ipHash: string | null
}

interface LoginEventRawRow {
  id?: unknown
  person_name?: unknown
  created_at?: unknown
  ip_hash?: unknown
}

interface LoginConnectionGroup {
  connectionHash: string
  assistantNames: string[]
  loginCount: number
}

interface LoginEventStats {
  totalCount: number
  todayTotalCount: number
  todayDistinctNames: string[]
  todayConnectionGroups: LoginConnectionGroup[]
  lastEntries: LoginEventEntry[]
}

interface BackupEntry {
  id: number
  savedAt: string
  source: string
  payload: RemotePortalPayload
  assistantCount: number
  locationCount: number
  dutyDayCount: number
  assignmentDayCount: number
}

interface BackupInsertResult {
  ok: boolean
  skipped: boolean
  missingTable: boolean
}

interface DutyParseIssue {
  lineNumber: number
  message: string
  rawLine: string
}

interface SpecialistParseIssue {
  lineNumber: number
  message: string
  rawLine: string
}

interface AssistantAccount {
  assistantName: string
  username: string
}

interface RemotePortalPayload {
  plannerState?: unknown
  userBindings?: unknown
}

const STORAGE_KEY = 'assistant-scheduler-v1'
const USER_BINDING_KEY = 'assistant-user-binding-v1'
const LAST_ASSISTANT_USER_KEY = 'assistant-last-user-v1'
const LOGIN_EVENT_CLEANUP_KEY = 'assistant-login-event-cleanup-v1'
const ADMIN_LOGIN_GUARD_KEY = 'assistant-admin-login-guard-v1'
const ADMIN_AUTH_EMAIL_KEY = 'assistant-admin-auth-email-v1'
const CLOUD_READ_ONLY_TEXT = 'Bulut salt-okunur modda (yerelden buluta yazma kapalı).'
const CLOUD_AUTH_LOCKED_TEXT = 'Bulut yazma kilitli: güvenli admin girişi gerekli.'
const CLOUD_SAFE_GUARD_TEXT =
  'Bulut verisi okunamadığı için güvenlik gereği yerelden buluta yazma kapatıldı.'
const CLOUD_CONFLICT_TEXT =
  'Bulutta daha yeni bir kayıt var. Güvenlik için üzerine yazma engellendi; sayfayı yenileyip tekrar dene.'
const APP_PASSWORD_HASH = '37db5704c214af212d89246fd809bac16bc924bab57601ed34078ff1625e8f43'
const ADMIN_BLOCK_STEP = 5
const ADMIN_FIRST_BLOCK_MS = 60 * 60 * 1000
const ADMIN_SECOND_BLOCK_MS = 24 * 60 * 60 * 1000
const LOGIN_EVENT_RETENTION_DAYS = 14
const LOGIN_EVENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const EMPTY_LOGIN_EVENT_STATS: LoginEventStats = {
  totalCount: 0,
  todayTotalCount: 0,
  todayDistinctNames: [],
  todayConnectionGroups: [],
  lastEntries: [],
}
const DUTY_SITES: DutySite[] = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy']
const SPECIALIST_DUTY_SITES: SpecialistDutySite[] = [
  'Sancaktepe',
  'Çekmeköy',
  'Feriha C123',
  'Feriha C456',
  'Feriha G123',
]
const REMOTE_SAVE_DEBOUNCE_MS = 900
const AUTO_HISTORY_BACKUP_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
const PRE_CHANGE_BACKUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
const DUTY_SITE_ORDER = new Map<DutySite, number>(
  DUTY_SITES.map((site, index) => [site, index]),
)
const SPECIALIST_DUTY_SITE_ORDER = new Map<SpecialistDutySite, number>(
  SPECIALIST_DUTY_SITES.map((site, index) => [site, index]),
)
const SPECIALIST_DUTY_SITE_LABELS: Record<SpecialistDutySite, string> = {
  Sancaktepe: 'Sancaktepe',
  Çekmeköy: 'Çekmeköy',
  'Feriha C123': 'C1-2-3',
  'Feriha C456': 'C4-5-6',
  'Feriha G123': 'G1-2-3',
}
const DUTY_SITE_SHORT_LABELS: Record<DutySite, string> = {
  Sancaktepe: 's',
  'Feriha Öz': 'f',
  Çekmeköy: 'ç',
}
const LOCATION_SITE_ID_PREFIX: Record<DutySite, string> = {
  Sancaktepe: 'sancak',
  'Feriha Öz': 'feriha-oz',
  Çekmeköy: 'cekmekoy',
}
const LEAVE_LOCATION_IDS = {
  excuse: 'mazeret-izni',
  annual: 'yillik-izin',
  rotation: 'rotasyon',
} as const
const BASE_SENIORITY_LEVEL_COUNT = 4
const LEGACY_LEAVE_LOCATION_ID = 'izinli'
const SITE_DISPLAY_ORDER = ['Sancaktepe', 'Çekmeköy', 'Feriha Öz', 'Diğer']

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
    { date: '2026-05-25', reason: 'Kurban Bayramı İdari Tatili' },
    { date: '2026-05-26', reason: 'Kurban Bayramı Arifesi' },
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

function getSiteDisplayRank(site: string): number {
  const index = SITE_DISPLAY_ORDER.indexOf(site)
  return index === -1 ? 99 : index
}

function normalizeOrderHistory(
  history: WorkLocation['orderHistory'],
): Array<{ from: string; value: number }> {
  if (!Array.isArray(history)) {
    return []
  }

  const shape = /^\d{4}-\d{2}-\d{2}$/
  const map = new Map<string, number>()
  history.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const from = typeof entry.from === 'string' ? entry.from : ''
    const value = Math.floor(Number(entry.value))
    if (!shape.test(from) || !Number.isFinite(value) || value < 1) {
      return
    }
    map.set(from, value)
  })

  return [...map.entries()]
    .map(([from, value]) => ({ from, value }))
    .sort((a, b) => a.from.localeCompare(b.from))
}

function getLocationOrderForDay(location: WorkLocation, dayKey: string): number {
  const history = normalizeOrderHistory(location.orderHistory)
  if (history.length) {
    const activeEntry = [...history].reverse().find((entry) => entry.from <= dayKey)
    if (activeEntry) {
      return activeEntry.value
    }
  }
  return Number.isFinite(location.order) && Number(location.order) > 0 ? Math.floor(Number(location.order)) : 1
}

function setLocationOrderFromDay(location: WorkLocation, fromDay: string, value: number): WorkLocation {
  const safeValue = Math.max(1, Math.floor(value))
  const nextHistory = normalizeOrderHistory([
    ...(location.orderHistory ?? []),
    {
      from: fromDay,
      value: safeValue,
    },
  ])

  return {
    ...location,
    order: safeValue,
    orderHistory: nextHistory,
  }
}

function isLocationActiveOnDay(location: WorkLocation, dayKey: string): boolean {
  const fromDay = location.activeFrom && hasIsoShape(location.activeFrom) ? location.activeFrom : '1900-01-01'
  const untilDay =
    location.activeUntil && hasIsoShape(location.activeUntil) ? location.activeUntil : null
  if (dayKey < fromDay) {
    return false
  }
  if (untilDay && dayKey >= untilDay) {
    return false
  }
  return true
}

function getLocationsForDay(state: PlannerState, dayKey: string): WorkLocation[] {
  return sortLocationsForState(
    state.locations.filter((location) => isLocationActiveOnDay(location, dayKey)),
    dayKey,
  )
}

function normalizeNormalLocationOrders(locations: WorkLocation[]): WorkLocation[] {
  const withIndex = locations.map((location, index) => ({ location, index }))
  const nextOrders = new Map<string, number>()

  SITE_DISPLAY_ORDER.forEach((siteName) => {
    const siteNormals = withIndex
      .filter(({ location }) => location.kind === 'normal' && location.site === siteName)
      .sort((a, b) => {
        const orderA = getLocationOrderForDay(a.location, '9999-12-31') || a.index + 1
        const orderB = getLocationOrderForDay(b.location, '9999-12-31') || b.index + 1
        return (
          orderA - orderB ||
          a.location.name.localeCompare(b.location.name, 'tr') ||
          a.index - b.index
        )
      })

    siteNormals.forEach(({ location }, position) => {
      nextOrders.set(location.id, position + 1)
    })
  })

  return locations.map((location) =>
    location.kind === 'normal'
      ? {
          ...location,
          order: nextOrders.get(location.id) ?? 1,
        }
      : location,
  )
}

function sortLocationsForState(locations: WorkLocation[], dayKey = toISODate(new Date())): WorkLocation[] {
  const kindRank: Record<LocationKind, number> = {
    normal: 0,
    leave: 1,
    duty: 2,
    postDuty: 3,
  }

  return [...locations].sort((a, b) => {
    const siteDelta = getSiteDisplayRank(a.site) - getSiteDisplayRank(b.site)
    if (siteDelta !== 0) {
      return siteDelta
    }

    if (a.kind === 'normal' && b.kind === 'normal') {
      return (
        getLocationOrderForDay(a, dayKey) - getLocationOrderForDay(b, dayKey) ||
        a.name.localeCompare(b.name, 'tr') ||
        a.id.localeCompare(b.id, 'tr')
      )
    }

    return (
      kindRank[a.kind] - kindRank[b.kind] ||
      a.name.localeCompare(b.name, 'tr') ||
      a.id.localeCompare(b.id, 'tr')
    )
  })
}

function normalizeAndSortLocations(locations: WorkLocation[]): WorkLocation[] {
  return sortLocationsForState(normalizeNormalLocationOrders(locations))
}

const DEFAULT_LOCATIONS: WorkLocation[] = normalizeAndSortLocations(([
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

  { id: LEAVE_LOCATION_IDS.excuse, site: 'Diğer', name: 'Mazeret İzni', kind: 'leave', tone: 'sky' },
  { id: LEAVE_LOCATION_IDS.annual, site: 'Diğer', name: 'Yıllık İzin', kind: 'leave', tone: 'sky' },
  { id: LEAVE_LOCATION_IDS.rotation, site: 'Diğer', name: 'Rotasyon', kind: 'leave', tone: 'sky' },
  { id: 'nobet', site: 'Diğer', name: 'Nöbet', kind: 'duty', tone: 'rose' },
  { id: 'nobet-ertesi', site: 'Diğer', name: 'Nöbet Ertesi', kind: 'postDuty', tone: 'rose' },
] as WorkLocation[]).map(withResolvedTone))

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

function isHalfDayHolidayReason(reason: string | null): boolean {
  if (!reason) {
    return false
  }
  return reason.toLocaleLowerCase('tr').includes('yarım gün')
}

function isHalfDayOfficialHoliday(date: Date): boolean {
  const reason = getOfficialHolidayReason(toISODate(date))
  return isHalfDayHolidayReason(reason)
}

function isFullOfficialHoliday(date: Date): boolean {
  if (!isOfficialHoliday(date)) {
    return false
  }
  return !isHalfDayOfficialHoliday(date)
}

function isFullNonWorkingDay(date: Date): boolean {
  return isWeekend(date) || isFullOfficialHoliday(date)
}

function isRoomAssignableDay(date: Date): boolean {
  return !isFullNonWorkingDay(date)
}

function getScheduledWorkHoursForDay(date: Date): number {
  if (isWeekend(date)) {
    return 0
  }
  if (isHalfDayOfficialHoliday(date)) {
    return 4
  }
  if (isFullOfficialHoliday(date)) {
    return 0
  }
  return 8
}

function calculateDutyOvertimeHoursForDay(dutyDate: Date): number {
  const dutyHours = 24
  const dutyDayWorkHours = getScheduledWorkHoursForDay(dutyDate)
  const nextDayWorkHours = getScheduledWorkHoursForDay(addDays(dutyDate, 1))
  const hasDutyDayWork = dutyDayWorkHours > 0
  const hasNextDayWork = nextDayWorkHours > 0

  if (!hasDutyDayWork && !hasNextDayWork) {
    return dutyHours
  }
  if (!hasDutyDayWork) {
    return Math.max(0, dutyHours - nextDayWorkHours)
  }
  if (!hasNextDayWork) {
    return Math.max(0, dutyHours - dutyDayWorkHours)
  }

  return Math.max(0, dutyHours - dutyDayWorkHours - nextDayWorkHours)
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

function formatConnectionHashLabel(ipHash: string | null): string {
  return ipHash ? `Bağlantı ${ipHash.slice(0, 8).toLocaleUpperCase('tr')}` : '-'
}

function normalizeAssistantName(rawName: string): string {
  const normalizedSpace = rawName.trim().replace(/\s+/g, ' ')
  if (!normalizedSpace) {
    return ''
  }

  const capitalizeToken = (token: string): string => {
    const lower = token.toLocaleLowerCase('tr')
    if (!lower) {
      return ''
    }
    const [first, ...rest] = [...lower]
    return `${first.toLocaleUpperCase('tr')}${rest.join('')}`
  }

  const separators = /([-'’])/g
  return normalizedSpace
    .split(' ')
    .map((word) =>
      word
        .split(separators)
        .map((piece) =>
          piece === '-' || piece === "'" || piece === '’' ? piece : capitalizeToken(piece),
        )
        .join(''),
    )
    .join(' ')
}

function buildAssistantAccounts(assistants: string[]): AssistantAccount[] {
  return uniqueSortedNames(assistants).map((assistantName) => ({
    assistantName,
    username: assistantName.toLocaleLowerCase('tr'),
  }))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function getCurrentMaxSeniorityLevel(assistants: string[], ranks: AssistantRanks): number {
  const fromRanks = assistants.reduce((maxLevel, assistant) => {
    const level = Math.floor(Number(ranks[assistant] ?? 0))
    if (!Number.isFinite(level) || level < 1) {
      return maxLevel
    }
    return Math.max(maxLevel, level)
  }, 0)
  return Math.max(BASE_SENIORITY_LEVEL_COUNT, fromRanks)
}

function buildSeniorityLevels(
  assistants: string[],
  ranks: AssistantRanks,
  includeNextLevel = false,
): SeniorityLevel[] {
  const maxLevel = getCurrentMaxSeniorityLevel(assistants, ranks) + (includeNextLevel ? 1 : 0)
  return Array.from({ length: Math.max(1, maxLevel) }, (_, index) => index + 1)
}

function toSafeSeniorityLevel(value: number, fallback = 1): SeniorityLevel {
  const normalized = Math.floor(Number(value))
  if (!Number.isFinite(normalized) || normalized < 1) {
    return Math.max(1, Math.floor(fallback))
  }
  return normalized
}

function buildRandomAssistantRanks(assistants: string[]): AssistantRanks {
  if (!assistants.length) {
    return {}
  }

  const shuffled = [...assistants].sort((a, b) => {
    const hashDiff = hashString(a) - hashString(b)
    if (hashDiff !== 0) {
      return hashDiff
    }
    return a.localeCompare(b, 'tr')
  })
  const baseLevels = Array.from({ length: BASE_SENIORITY_LEVEL_COUNT }, (_, index) => index + 1)

  return Object.fromEntries(
    shuffled.map((assistant, index) => [assistant, baseLevels[index % baseLevels.length]]),
  ) as AssistantRanks
}

function compactAssistantRanks(assistants: string[], ranks: AssistantRanks): AssistantRanks {
  if (!assistants.length) {
    return {}
  }

  const buckets = new Map<number, string[]>()
  assistants.forEach((assistant) => {
    const safeLevel = toSafeSeniorityLevel(ranks[assistant] ?? 1)
    if (!buckets.has(safeLevel)) {
      buckets.set(safeLevel, [])
    }
    buckets.get(safeLevel)?.push(assistant)
  })

  const presentLevels = [...buckets.keys()].sort((a, b) => a - b)
  const levelMap = new Map<number, SeniorityLevel>()
  presentLevels.forEach((originalLevel, index) => {
    levelMap.set(originalLevel, index + 1)
  })

  return Object.fromEntries(
    assistants.map((assistant) => {
      const originalLevel = toSafeSeniorityLevel(ranks[assistant] ?? 1)
      const targetLevel = levelMap.get(originalLevel) ?? 1
      return [assistant, targetLevel]
    }),
  ) as AssistantRanks
}

function normalizeAssistantRanks(raw: unknown, assistants: string[]): AssistantRanks {
  const parsedRanks: Partial<Record<string, SeniorityLevel>> = {}
  if (raw && typeof raw === 'object') {
    Object.entries(raw as Record<string, unknown>).forEach(([assistant, level]) => {
      const numeric = Number(level)
      if (Number.isFinite(numeric) && numeric >= 1) {
        parsedRanks[assistant] = toSafeSeniorityLevel(numeric)
      }
    })
  }

  const missingAssistants = assistants.filter((assistant) => !parsedRanks[assistant])
  const randomForMissing = buildRandomAssistantRanks(missingAssistants)

  const merged: AssistantRanks = Object.fromEntries(
    assistants.map((assistant) => [
      assistant,
      toSafeSeniorityLevel(parsedRanks[assistant] ?? randomForMissing[assistant] ?? 1),
    ]),
  ) as AssistantRanks

  return compactAssistantRanks(assistants, merged)
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

function normalizeLooseToken(value: string): string {
  return normalizeTrToken(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSpecialistDutySite(rawSite: string): SpecialistDutySite | null {
  const token = normalizeLooseToken(rawSite).replace(/\s+/g, '')
  if (!token) {
    return null
  }

  if (token === 'sancaktepe' || token === 'sancak') {
    return 'Sancaktepe'
  }
  if (token === 'cekmekoy' || token === 'cekmekoyhastanesi') {
    return 'Çekmeköy'
  }

  const isFeriha = token.includes('feriha') || token.startsWith('c') || token.startsWith('g')
  if (!isFeriha) {
    return null
  }

  if (/(c123|c1-2-3|c1_2_3|c1\/2\/3|c12?3)/.test(token)) {
    return 'Feriha C123'
  }
  if (/(c456|c4-5-6|c4_5_6|c4\/5\/6|c45?6)/.test(token)) {
    return 'Feriha C456'
  }
  if (/(g123|g1-2-3|g1_2_3|g1\/2\/3|g12?3)/.test(token)) {
    return 'Feriha G123'
  }

  return null
}

function sortSpecialistDutyAssignments(
  assignments: SpecialistDutyAssignment[],
): SpecialistDutyAssignment[] {
  return [...assignments].sort(
    (left, right) =>
      (SPECIALIST_DUTY_SITE_ORDER.get(left.site) ?? 99) -
        (SPECIALIST_DUTY_SITE_ORDER.get(right.site) ?? 99) ||
      left.name.localeCompare(right.name, 'tr'),
  )
}

function uniqueSpecialistDutyAssignments(
  assignments: SpecialistDutyAssignment[],
): SpecialistDutyAssignment[] {
  const uniqueMap = new Map<string, SpecialistDutyAssignment>()

  assignments.forEach((assignment) => {
    const name = assignment.name.trim()
    if (!name) {
      return
    }
    const key = `${name}::${assignment.site}`
    if (uniqueMap.has(key)) {
      return
    }
    uniqueMap.set(key, { name, site: assignment.site })
  })

  return sortSpecialistDutyAssignments([...uniqueMap.values()])
}

function mapSpecialistDutySiteToDutySite(site: SpecialistDutySite): DutySite {
  if (site === 'Sancaktepe') {
    return 'Sancaktepe'
  }
  if (site === 'Çekmeköy') {
    return 'Çekmeköy'
  }
  return 'Feriha Öz'
}

function formatSpecialistDutyLabel(entry: SpecialistDutyAssignment): string {
  if (entry.site === 'Sancaktepe' || entry.site === 'Çekmeköy') {
    return `Uzm: ${entry.name}`
  }
  return `Uzm: ${entry.name} (${SPECIALIST_DUTY_SITE_LABELS[entry.site]})`
}

function slugifyLocationName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildUniqueLocationId(
  site: DutySite,
  locationName: string,
  existingLocations: WorkLocation[],
): string {
  const sitePrefix = LOCATION_SITE_ID_PREFIX[site]
  const locationToken = slugifyLocationName(locationName) || 'alan'
  const baseId = `${sitePrefix}-${locationToken}`
  const takenIds = new Set(existingLocations.map((location) => location.id))
  if (!takenIds.has(baseId)) {
    return baseId
  }

  let serial = 2
  while (takenIds.has(`${baseId}-${serial}`)) {
    serial += 1
  }
  return `${baseId}-${serial}`
}

function compareAssistantNamesByRank(
  leftName: string,
  rightName: string,
  assistantRanks?: AssistantRanks,
): number {
  const leftRankRaw = Number(assistantRanks?.[leftName])
  const rightRankRaw = Number(assistantRanks?.[rightName])
  const leftRank = Number.isFinite(leftRankRaw) && leftRankRaw >= 1 ? Math.floor(leftRankRaw) : 999
  const rightRank = Number.isFinite(rightRankRaw) && rightRankRaw >= 1 ? Math.floor(rightRankRaw) : 999

  return leftRank - rightRank || leftName.localeCompare(rightName, 'tr')
}

function sortAssistantNamesByRank(
  assistantNames: string[],
  assistantRanks?: AssistantRanks,
): string[] {
  return [...assistantNames].sort((left, right) =>
    compareAssistantNamesByRank(left, right, assistantRanks),
  )
}

function sortDutyAssignments(
  assignments: DutyAssignment[],
  assistantRanks?: AssistantRanks,
): DutyAssignment[] {
  return [...assignments].sort(
    (a, b) =>
      (DUTY_SITE_ORDER.get(a.site) ?? 99) - (DUTY_SITE_ORDER.get(b.site) ?? 99) ||
      compareAssistantNamesByRank(a.name, b.name, assistantRanks),
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

function normalizeTrToken(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
}

function parseTurkishMonthDate(raw: string, fallbackYear: number): string | null {
  const token = raw.trim()
  if (!token) {
    return null
  }

  const match = token.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s*(\d{4})?$/u)
  if (!match) {
    return null
  }

  const monthToken = normalizeLooseToken(match[2]).replace(/\s+/g, '')
  const monthLookup = new Map<string, number>([
    ['ocak', 1],
    ['subat', 2],
    ['mart', 3],
    ['nisan', 4],
    ['mayis', 5],
    ['haziran', 6],
    ['temmuz', 7],
    ['agustos', 8],
    ['eylul', 9],
    ['ekim', 10],
    ['kasim', 11],
    ['aralik', 12],
  ])
  const month = monthLookup.get(monthToken)
  if (!month) {
    return null
  }

  const day = Number(match[1])
  const year = match[3] ? Number(match[3]) : fallbackYear
  if (!Number.isFinite(day) || day < 1 || day > 31 || !Number.isFinite(year) || year < 1900) {
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

function normalizeSpecialistDateToken(raw: string, fallbackYear: number): string | null {
  return normalizeDateToken(raw) ?? parseTurkishMonthDate(raw, fallbackYear)
}

function buildLocationLookupTokens(location: WorkLocation): Set<string> {
  const tokenSet = new Set<string>()
  const siteToken = normalizeLooseToken(location.site)
  const nameToken = normalizeLooseToken(location.name)

  if (nameToken) {
    tokenSet.add(nameToken)
  }
  if (siteToken && nameToken) {
    tokenSet.add(`${siteToken} ${nameToken}`)
  }

  const numericRoomMatch = location.name.match(/ameliyathane\s*(\d+)/iu)
  if (numericRoomMatch && siteToken) {
    tokenSet.add(`${siteToken} ameliyathane ${numericRoomMatch[1]}`)
  }

  const codeMatch = location.name.match(/^(C\d+|G\d+)/iu)
  if (codeMatch && siteToken) {
    tokenSet.add(`${siteToken} ${normalizeLooseToken(codeMatch[1])}`)
  }

  return tokenSet
}

function resolveSpecialistWorkLocation(
  locations: WorkLocation[],
  dayKey: string,
  rawArea: string,
): { location: WorkLocation | null; reason?: string } {
  const normalizedArea = normalizeLooseToken(rawArea)
  if (!normalizedArea) {
    return { location: null, reason: 'Alan bilgisi boş.' }
  }

  const normalLocations = locations.filter((location) => location.kind === 'normal')
  const activeNormals = normalLocations.filter((location) => isLocationActiveOnDay(location, dayKey))
  const searchPool = activeNormals.length ? activeNormals : normalLocations

  const exactMatches = searchPool.filter((location) =>
    buildLocationLookupTokens(location).has(normalizedArea),
  )
  if (exactMatches.length === 1) {
    return { location: exactMatches[0] }
  }
  if (exactMatches.length > 1) {
    return {
      location: null,
      reason: `"${rawArea}" birden fazla alana eşleşti. Lütfen hastane adını da yaz.`,
    }
  }

  const fuzzyMatches = searchPool.filter((location) => {
    const tokens = [...buildLocationLookupTokens(location)]
    return tokens.some(
      (token) =>
        token.includes(normalizedArea) ||
        (normalizedArea.length > 5 && normalizedArea.includes(token)),
    )
  })
  if (fuzzyMatches.length === 1) {
    return { location: fuzzyMatches[0] }
  }
  if (fuzzyMatches.length > 1) {
    return {
      location: null,
      reason: `"${rawArea}" belirsiz eşleşti. Lütfen daha net alan adı yaz.`,
    }
  }

  return { location: null, reason: `"${rawArea}" için eşleşen alan bulunamadı.` }
}

function getSpecialistsForLocation(state: PlannerState, dayKey: string, locationId: string): string[] {
  return sortAssistantNamesByRank(
    uniqueSortedNames(state.specialistWorkAssignments[dayKey]?.[locationId] ?? []),
    undefined,
  )
}

function formatSpecialistWorkLabel(names: string[]): string | null {
  return names.length ? `Uzm: ${names.join(', ')}` : null
}

function getWeeklyExportUnitLabel(location: WorkLocation): string {
  const name = location.name.trim()
  const normalizedName = normalizeTrToken(name)

  if (location.kind === 'leave') {
    if (location.id === LEAVE_LOCATION_IDS.rotation || normalizedName.includes('rotasyon')) {
      return 'ROT'
    }
    if (location.id === LEAVE_LOCATION_IDS.annual || normalizedName.includes('yillik')) {
      return 'YILLIK'
    }
    return 'İZİNLİ'
  }

  if (location.site === 'Sancaktepe') {
    const sancakRoomMatch = name.match(/ameliyathane\s*(\d+)/iu)
    if (sancakRoomMatch) {
      return sancakRoomMatch[1]
    }
  }

  const unitCodeMatch = name.match(/^(C\d+|G\d+)/iu)
  if (unitCodeMatch) {
    return unitCodeMatch[1].toLocaleUpperCase('tr')
  }

  if (normalizedName.includes('ameliyathane')) {
    return 'AML'
  }
  if (normalizedName.includes('yogun bakim')) {
    return 'YBU'
  }
  if (normalizedName.includes('poliklinik')) {
    return 'POL'
  }
  if (normalizedName.includes('dis anestezi')) {
    return 'DIŞ'
  }

  return name
}

function buildWeek(weekStartISO: string): DayInfo[] {
  const start = startOfISOWeek(fromISODate(weekStartISO))
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

function getDayTypeLabel(dayKey: string): string | null {
  const date = fromISODate(dayKey)
  const weekend = isWeekend(date)
  const officialHoliday = isOfficialHoliday(date)
  const halfDayHoliday = isHalfDayOfficialHoliday(date)
  const fullHoliday = officialHoliday && !halfDayHoliday

  if (weekend && fullHoliday) {
    return 'Hafta sonu ve resmi tatil'
  }
  if (fullHoliday) {
    return 'Resmi tatil'
  }
  if (weekend) {
    return 'Hafta sonu'
  }
  if (halfDayHoliday) {
    return 'Yarım gün resmi tatil (4 saat mesai)'
  }
  return null
}

function getAssignmentsForLocation(
  state: PlannerState,
  dayKey: string,
  location: WorkLocation,
): string[] {
  if (!isLocationActiveOnDay(location, dayKey)) {
    return []
  }

  const dayDate = fromISODate(dayKey)
  if ((location.kind === 'normal' || location.kind === 'leave') && !isRoomAssignableDay(dayDate)) {
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

function getPostDutyPoolForMonth(state: PlannerState, monthISO: string): string[] {
  return uniqueSortedNames(
    (state.postDutyPoolByMonth[monthISO] ?? []).filter((name) => state.assistants.includes(name)),
  )
}

function getPostDutyPoolForDay(state: PlannerState, dayKey: string): string[] {
  return getPostDutyPoolForMonth(state, monthFromDayKey(dayKey))
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

function buildDutyTableModel(
  dutyRoster: DutyRoster,
  specialistDutyRoster: SpecialistDutyRoster,
  monthISO: string,
  assistantRanks?: AssistantRanks,
): DutyTableModel {
  const rows: DutyTableRow[] = listMonthDays(monthISO).map((dayKey) => {
    const entries = sortDutyAssignments(dutyRoster[dayKey] ?? [], assistantRanks)
    const specialistEntries = sortSpecialistDutyAssignments(specialistDutyRoster[dayKey] ?? [])
    const bySite: Record<DutySite, DutyCellEntry[]> = {
      Sancaktepe: [],
      'Feriha Öz': [],
      Çekmeköy: [],
    }
    entries.forEach((entry) => {
      bySite[entry.site].push({
        label: entry.name,
        kind: 'assistant',
      })
    })
    specialistEntries.forEach((entry) => {
      const site = mapSpecialistDutySiteToDutySite(entry.site)
      bySite[site].push({
        label: formatSpecialistDutyLabel(entry),
        kind: 'specialist',
      })
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
        /^(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s*(?:[:-])?\s*(.+)$/u,
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

function parseSpecialistWorkQuickLines(
  text: string,
  fallbackYear: number,
  locations: WorkLocation[],
): { data: SpecialistWorkAssignments; issues: SpecialistParseIssue[]; totalNames: number } {
  const data: SpecialistWorkAssignments = {}
  const issues: SpecialistParseIssue[] = []

  text
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim()
      if (!line) {
        return
      }

      const strictMatch = line.match(/^(.+?)\s+-\s+(.+?)\s+-\s+(.+)$/u)
      const looseParts = line.split('-').map((part) => part.trim()).filter(Boolean)
      const parts =
        strictMatch?.slice(1, 4) ??
        (looseParts.length >= 3 ? [looseParts[0], looseParts[1], looseParts.slice(2).join('-')] : null)
      if (!parts) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Biçim hatası. Örnek: 27 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe Ameliyathane 1',
        })
        return
      }

      let dateToken = parts[0]
      let nameToken = parts[1]
      let areaToken = parts.slice(2).join(' - ')
      let dayKey = normalizeSpecialistDateToken(dateToken, fallbackYear)

      // Eski serbest formatla girilmiş satırları da (İsim - Alan - Tarih) tolere et.
      if (!dayKey) {
        const altDateToken = parts[parts.length - 1]
        const altDayKey = normalizeSpecialistDateToken(altDateToken, fallbackYear)
        if (altDayKey) {
          dayKey = altDayKey
          dateToken = altDateToken
          nameToken = parts[0]
          areaToken = parts.slice(1, parts.length - 1).join(' - ')
        }
      }

      if (!dayKey) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: `Tarih çözümlenemedi (${dateToken}).`,
        })
        return
      }

      const specialistName = normalizeAssistantName(nameToken)
      if (!specialistName) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Uzman adı boş veya geçersiz.',
        })
        return
      }

      const resolved = resolveSpecialistWorkLocation(locations, dayKey, areaToken)
      if (!resolved.location) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: resolved.reason ?? 'Alan eşleşmedi.',
        })
        return
      }

      const locationId = resolved.location.id
      const previousDayMap = data[dayKey] ?? {}
      const previousNames = previousDayMap[locationId] ?? []
      data[dayKey] = {
        ...previousDayMap,
        [locationId]: uniqueSortedNames([...previousNames, specialistName]),
      }
    })

  const totalNames = Object.values(data).reduce(
    (count, locationMap) =>
      count + Object.values(locationMap).reduce((inner, names) => inner + names.length, 0),
    0,
  )

  return { data, issues, totalNames }
}

function parseSpecialistDutyQuickLines(
  text: string,
  fallbackYear: number,
): { data: SpecialistDutyRoster; issues: SpecialistParseIssue[]; totalNames: number } {
  const data: SpecialistDutyRoster = {}
  const issues: SpecialistParseIssue[] = []

  text
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim()
      if (!line) {
        return
      }

      const strictMatch = line.match(/^(.+?)\s+-\s+(.+?)\s+-\s+(.+)$/u)
      const looseParts = line.split('-').map((part) => part.trim()).filter(Boolean)
      const parts =
        strictMatch?.slice(1, 4) ??
        (looseParts.length >= 3 ? [looseParts[0], looseParts[1], looseParts.slice(2).join('-')] : null)
      if (!parts) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Biçim hatası. Örnek: 1 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe',
        })
        return
      }

      const dateToken = parts[0]
      const specialistName = normalizeAssistantName(parts[1])
      const siteToken = parts.slice(2).join(' - ')
      const dayKey = normalizeSpecialistDateToken(dateToken, fallbackYear)
      const site = normalizeSpecialistDutySite(siteToken)

      if (!dayKey) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: `Tarih çözümlenemedi (${dateToken}).`,
        })
        return
      }
      if (!specialistName) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: 'Uzman adı boş veya geçersiz.',
        })
        return
      }
      if (!site) {
        issues.push({
          lineNumber: index + 1,
          rawLine,
          message: `Nöbet yeri geçersiz (${siteToken}).`,
        })
        return
      }

      data[dayKey] = uniqueSpecialistDutyAssignments([
        ...(data[dayKey] ?? []),
        { name: specialistName, site },
      ])
    })

  const totalNames = Object.values(data).reduce((count, entries) => count + entries.length, 0)

  return { data, issues, totalNames }
}

function cloneSpecialistWorkDayAssignments(
  assignments?: SpecialistWorkDayAssignments,
): SpecialistWorkDayAssignments {
  if (!assignments) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(assignments).map(([locationId, names]) => [locationId, uniqueSortedNames(names)]),
  )
}

function cloneSpecialistDutyDayAssignments(
  assignments?: SpecialistDutyAssignment[],
): SpecialistDutyAssignment[] {
  return uniqueSpecialistDutyAssignments(assignments ?? []).map((entry) => ({ ...entry }))
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
    const workingDay = isRoomAssignableDay(fromISODate(dayKey))
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

function sanitizeSpecialistWorkAssignments(
  specialistWorkAssignments: unknown,
  locations: WorkLocation[],
): SpecialistWorkAssignments {
  if (!specialistWorkAssignments || typeof specialistWorkAssignments !== 'object') {
    return {}
  }

  const normalLocationIds = new Set(
    locations.filter((location) => location.kind === 'normal').map((location) => location.id),
  )

  return Object.fromEntries(
    Object.entries(specialistWorkAssignments as Record<string, unknown>)
      .filter(([dayKey, dayMap]) => hasIsoShape(dayKey) && dayMap && typeof dayMap === 'object')
      .map(([dayKey, dayMap]) => {
        const normalizedDayMap = Object.fromEntries(
          Object.entries(dayMap as Record<string, unknown>)
            .filter(([locationId, names]) => normalLocationIds.has(locationId) && Array.isArray(names))
            .map(([locationId, names]) => [
              locationId,
              uniqueSortedNames(
                (names as unknown[])
                  .filter((name): name is string => typeof name === 'string')
                  .map((name) => normalizeAssistantName(name))
                  .filter(Boolean),
              ),
            ]),
        )

        return [dayKey, normalizedDayMap]
      }),
  )
}

function sanitizeSpecialistDutyRoster(raw: unknown): SpecialistDutyRoster {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([dayKey, entries]) => hasIsoShape(dayKey) && Array.isArray(entries))
      .map(([dayKey, entries]) => {
        const normalizedEntries = (entries as unknown[])
          .map((entry) => {
            if (typeof entry !== 'object' || entry === null) {
              return null
            }

            const name = normalizeAssistantName(String((entry as { name?: unknown }).name ?? ''))
            const site = normalizeSpecialistDutySite(String((entry as { site?: unknown }).site ?? ''))
            if (!name || !site) {
              return null
            }
            return { name, site }
          })
          .filter((entry): entry is SpecialistDutyAssignment => Boolean(entry))

        return [dayKey, uniqueSpecialistDutyAssignments(normalizedEntries)]
      }),
  )
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

function cloneDayLocationAssignments(
  assignments: Record<string, string[]> | undefined,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(assignments ?? {}).map(([locationId, names]) => [
      locationId,
      uniqueSortedNames(names),
    ]),
  )
}

function remapLegacyLeaveAssignments(manualAssignments: ManualAssignments): ManualAssignments {
  return Object.fromEntries(
    Object.entries(manualAssignments).map(([dayKey, assignments]) => {
      const nextAssignments: Record<string, string[]> = {}

      Object.entries(assignments).forEach(([locationId, names]) => {
        const normalized = uniqueSortedNames(names)
        if (!normalized.length) {
          return
        }

        const targetId = locationId === LEGACY_LEAVE_LOCATION_ID ? LEAVE_LOCATION_IDS.excuse : locationId
        const merged = uniqueSortedNames([...(nextAssignments[targetId] ?? []), ...normalized])
        nextAssignments[targetId] = merged
      })

      return [dayKey, nextAssignments]
    }),
  )
}

function ensureCoreLocations(locations: WorkLocation[]): WorkLocation[] {
  const hasDuty = locations.some((location) => location.kind === 'duty')
  const hasPostDuty = locations.some((location) => location.kind === 'postDuty')
  const cleaned = locations.filter(
    (location) =>
      !(
        location.kind === 'leave' &&
        (location.id === LEGACY_LEAVE_LOCATION_ID ||
          location.name.trim().toLocaleLowerCase('tr') === 'izinli')
      ),
  )
  const hasExcuseLeave = cleaned.some(
    (location) =>
      location.kind === 'leave' &&
      (location.id === LEAVE_LOCATION_IDS.excuse ||
        location.name.trim().toLocaleLowerCase('tr').includes('mazeret')),
  )
  const hasAnnualLeave = cleaned.some(
    (location) =>
      location.kind === 'leave' &&
      (location.id === LEAVE_LOCATION_IDS.annual ||
        location.name
          .trim()
          .toLocaleLowerCase('tr')
          .replace(/ı/g, 'i')
          .includes('yillik')),
  )
  const hasRotation = cleaned.some(
    (location) =>
      location.kind === 'leave' &&
      (location.id === LEAVE_LOCATION_IDS.rotation ||
        location.name.trim().toLocaleLowerCase('tr').includes('rotasyon')),
  )

  const next = [...cleaned]
  if (!hasExcuseLeave) {
    next.push({
      id: LEAVE_LOCATION_IDS.excuse,
      site: 'Diğer',
      name: 'Mazeret İzni',
      kind: 'leave',
      tone: 'sky',
    })
  }
  if (!hasAnnualLeave) {
    next.push({
      id: LEAVE_LOCATION_IDS.annual,
      site: 'Diğer',
      name: 'Yıllık İzin',
      kind: 'leave',
      tone: 'sky',
    })
  }
  if (!hasRotation) {
    next.push({
      id: LEAVE_LOCATION_IDS.rotation,
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
  return normalizeAndSortLocations(next.map(withResolvedTone))
}

function buildFallbackState(): PlannerState {
  const now = new Date()
  const weekStartISO = toISODate(startOfISOWeek(now))
  const currentMonthISO = toISODate(now).slice(0, 7)
  const fallbackLocationOwners = createDefaultLocationOwners(DEFAULT_LOCATIONS, DEFAULT_ASSISTANTS)
  const fallbackAssistantRanks = buildRandomAssistantRanks(DEFAULT_ASSISTANTS)
  return {
    assistants: DEFAULT_ASSISTANTS,
    assistantRanks: fallbackAssistantRanks,
    locations: DEFAULT_LOCATIONS,
    locationOwners: fallbackLocationOwners,
    locationOwnersByMonth: {
      [currentMonthISO]: fallbackLocationOwners,
    },
    postDutyPoolByMonth: {
      [currentMonthISO]: [],
    },
    manualAssignments: createSampleManual(weekStartISO, DEFAULT_LOCATIONS, fallbackLocationOwners),
    dutyRoster: createSampleDuty(weekStartISO),
    specialistWorkAssignments: {},
    specialistDutyRoster: {},
    weekStartISO,
  }
}

function sanitizePlannerState(parsed: Partial<PlannerState>, fallback: PlannerState): PlannerState {
  const currentMonthISO = toISODate(new Date()).slice(0, 7)

  const assistants = Array.isArray(parsed.assistants)
    ? uniqueSortedNames(parsed.assistants.filter((item): item is string => typeof item === 'string'))
    : fallback.assistants
  const assistantRanks = normalizeAssistantRanks(
    (parsed as { assistantRanks?: unknown }).assistantRanks,
    assistants,
  )

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
          .map((location) => {
            const parsedOrder = Number(location.order)
            return withResolvedTone({
              ...location,
              order: Number.isFinite(parsedOrder) && parsedOrder > 0 ? Math.floor(parsedOrder) : undefined,
              orderHistory: normalizeOrderHistory(location.orderHistory),
              activeFrom:
                typeof location.activeFrom === 'string' && hasIsoShape(location.activeFrom)
                  ? location.activeFrom
                  : undefined,
              activeUntil:
                typeof location.activeUntil === 'string' && hasIsoShape(location.activeUntil)
                  ? location.activeUntil
                  : null,
            })
          }),
      )
    : normalizeAndSortLocations(fallback.locations.map(withResolvedTone))

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

  const rawPostDutyPoolByMonth = (parsed as { postDutyPoolByMonth?: Record<string, unknown> })
    .postDutyPoolByMonth
  const normalizedPostDutyPoolByMonth: PostDutyPoolByMonth =
    rawPostDutyPoolByMonth && typeof rawPostDutyPoolByMonth === 'object'
      ? Object.fromEntries(
          Object.entries(rawPostDutyPoolByMonth)
            .filter(([monthISO, names]) => isValidMonthISO(monthISO) && Array.isArray(names))
            .map(([monthISO, names]) => [
              monthISO,
              uniqueSortedNames(
                (names as unknown[])
                  .filter((name): name is string => typeof name === 'string')
                  .map((name) => normalizeAssistantName(name))
                  .filter((name) => assistants.includes(name)),
              ),
            ]),
        )
      : {}
  if (!Object.keys(normalizedPostDutyPoolByMonth).length) {
    normalizedPostDutyPoolByMonth[currentMonthISO] = []
  }

  const rawManualAssignments: ManualAssignments =
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
  const manualAssignments = remapLegacyLeaveAssignments(rawManualAssignments)

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

  const specialistWorkAssignments = sanitizeSpecialistWorkAssignments(
    (parsed as { specialistWorkAssignments?: unknown }).specialistWorkAssignments,
    locations,
  )
  const specialistDutyRoster = sanitizeSpecialistDutyRoster(
    (parsed as { specialistDutyRoster?: unknown }).specialistDutyRoster,
  )

  const candidateWeekStart = typeof parsed.weekStartISO === 'string' ? parsed.weekStartISO : ''
  const normalizedWeekStart = normalizeDateToken(candidateWeekStart)

  const sanitized = sanitizeManualAssignments(manualAssignments, dutyRoster, locations)

  return {
    assistants,
    assistantRanks,
    locations,
    locationOwners: normalizedLocationOwners,
    locationOwnersByMonth: normalizedLocationOwnersByMonth,
    postDutyPoolByMonth: normalizedPostDutyPoolByMonth,
    manualAssignments: sanitized.manualAssignments,
    dutyRoster,
    specialistWorkAssignments,
    specialistDutyRoster,
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
          username.trim().length > 0 &&
          typeof assistantName === 'string' &&
          assistantName.trim().length > 0
        )
      })
      .map(([username, assistantName]) => [username.trim().toLocaleLowerCase('tr'), String(assistantName).trim()]),
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

function sanitizeAdminLoginGuard(raw: unknown): AdminLoginGuardState {
  if (!raw || typeof raw !== 'object') {
    return {
      failedAttempts: 0,
      blockedUntil: 0,
      rememberedAdmin: false,
    }
  }
  const record = raw as Partial<AdminLoginGuardState> & { rememberedPassword?: unknown }
  const failedAttempts =
    typeof record.failedAttempts === 'number' && Number.isFinite(record.failedAttempts) && record.failedAttempts > 0
      ? Math.floor(record.failedAttempts)
      : 0
  const blockedUntil =
    typeof record.blockedUntil === 'number' && Number.isFinite(record.blockedUntil) && record.blockedUntil > 0
      ? Math.floor(record.blockedUntil)
      : 0
  const rememberedAdmin =
    record.rememberedAdmin === true || record.rememberedPassword === 'a.918273'
  return {
    failedAttempts: Math.min(failedAttempts, 500),
    blockedUntil,
    rememberedAdmin,
  }
}

function safeReadAdminLoginGuard(): AdminLoginGuardState {
  if (typeof window === 'undefined') {
    return {
      failedAttempts: 0,
      blockedUntil: 0,
      rememberedAdmin: false,
    }
  }
  const raw = localStorage.getItem(ADMIN_LOGIN_GUARD_KEY)
  if (!raw) {
    return {
      failedAttempts: 0,
      blockedUntil: 0,
      rememberedAdmin: false,
    }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return sanitizeAdminLoginGuard(parsed)
  } catch {
    return {
      failedAttempts: 0,
      blockedUntil: 0,
      rememberedAdmin: false,
    }
  }
}

function safeReadAdminAuthEmail() {
  if (typeof window === 'undefined') {
    return ''
  }
  return localStorage.getItem(ADMIN_AUTH_EMAIL_KEY) ?? ''
}

async function sha256Hex(value: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return ''
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildRemotePayload(plannerState: PlannerState, bindings: Record<string, string>): RemotePortalPayload {
  return {
    plannerState,
    userBindings: bindings,
  }
}

function summarizeBackupRow(row: unknown): BackupEntry | null {
  if (!row || typeof row !== 'object') {
    return null
  }
  const record = row as {
    id?: unknown
    saved_at?: unknown
    source?: unknown
    payload?: unknown
  }
  if (typeof record.id !== 'number' || typeof record.saved_at !== 'string') {
    return null
  }

  const payload =
    record.payload && typeof record.payload === 'object'
      ? (record.payload as RemotePortalPayload)
      : {}
  const fallback = buildFallbackState()
  const plannerState =
    payload.plannerState && typeof payload.plannerState === 'object'
      ? sanitizePlannerState(payload.plannerState as Partial<PlannerState>, fallback)
      : fallback

  return {
    id: record.id,
    savedAt: record.saved_at,
    source: typeof record.source === 'string' ? record.source : 'auto-save',
    payload,
    assistantCount: plannerState.assistants.length,
    locationCount: plannerState.locations.filter((location) => location.kind === 'normal').length,
    dutyDayCount: Object.keys(plannerState.dutyRoster).filter(
      (dayKey) => (plannerState.dutyRoster[dayKey] ?? []).length > 0,
    ).length,
    assignmentDayCount: Object.keys(plannerState.manualAssignments).filter(
      (dayKey) => Object.values(plannerState.manualAssignments[dayKey] ?? {}).some((names) => names.length > 0),
    ).length,
  }
}

function formatRemainingBlock(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days} gün ${hours} saat`
  }
  if (hours > 0) {
    return `${hours} saat ${minutes} dk`
  }
  if (minutes > 0) {
    return `${minutes} dk ${seconds} sn`
  }
  return `${seconds} sn`
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
  const [blockClockMs, setBlockClockMs] = useState(() => Date.now())
  const initialAdminLoginGuard = useMemo(() => safeReadAdminLoginGuard(), [])
  const [adminLoginGuard, setAdminLoginGuard] = useState<AdminLoginGuardState>(initialAdminLoginGuard)
  const [passwordInput, setPasswordInput] = useState('')
  const [adminCloudAuthEmail, setAdminCloudAuthEmail] = useState(() => safeReadAdminAuthEmail())
  const [adminCloudAuthPassword, setAdminCloudAuthPassword] = useState('')
  const [adminCloudAuthStatus, setAdminCloudAuthStatus] = useState<AdminCloudAuthStatus>(
    isSupabaseAdminAuthRequired ? 'checking' : 'disabled',
  )
  const [adminCloudAuthMessage, setAdminCloudAuthMessage] = useState(
    isSupabaseAdminAuthRequired
      ? 'Güvenli admin oturumu kontrol ediliyor...'
      : 'Güvenli admin modu kapalı.',
  )
  const [isAdminCloudAuthVerified, setIsAdminCloudAuthVerified] = useState(!isSupabaseAdminAuthRequired)
  const [assistantUsernameInput, setAssistantUsernameInput] = useState('')
  const [assistantUserPickerOpen, setAssistantUserPickerOpen] = useState(false)
  const assistantLoginManuallyClearedRef = useRef(false)
  const [data, setData] = useState<PlannerState>(() => safeReadState())
  const [userBindings, setUserBindings] = useState<Record<string, string>>(() => safeReadUserBindings())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [cloudState, setCloudState] = useState<'checking' | 'ready' | 'offline' | 'error'>(
    isSupabaseConfigured ? 'checking' : 'offline',
  )
  const [cloudStateText, setCloudStateText] = useState(
    isSupabaseConfigured
      ? 'Bulut bağlantısı kontrol ediliyor...'
      : 'Bulut kaydı kapalı',
  )
  const [isCloudSaving, setIsCloudSaving] = useState(false)
  const [cloudLastSavedAt, setCloudLastSavedAt] = useState<string | null>(null)
  const cloudHydratedRef = useRef(false)
  const cloudPayloadRef = useRef('')
  const cloudCanWriteRef = useRef(false)
  const adminCloudWriteUnlockedRef = useRef(!isSupabaseAdminAuthRequired)
  const cloudRevisionRef = useRef<string | null>(null)
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cloudHistoryBackupLastAtRef = useRef(0)
  const preChangeBackupLastAtRef = useRef<Record<string, number>>({})
  const observerWeeklyScrollerRef = useRef<HTMLDivElement | null>(null)
  const observerDailyWeekScrollerRef = useRef<HTMLDivElement | null>(null)
  const observerDailyDayScrollerRef = useRef<HTMLDivElement | null>(null)
  const plannerMonthDayScrollerRef = useRef<HTMLDivElement | null>(null)
  const [backupEntries, setBackupEntries] = useState<BackupEntry[]>([])
  const [isBackupLoading, setIsBackupLoading] = useState(false)
  const [backupStatusText, setBackupStatusText] = useState('')
  const [loginEventStats, setLoginEventStats] = useState<LoginEventStats>(EMPTY_LOGIN_EVENT_STATS)
  const [isLoginEventsLoading, setIsLoginEventsLoading] = useState(false)
  const [loginEventsStatusText, setLoginEventsStatusText] = useState('')

  const [assistantInput, setAssistantInput] = useState('')
  const [assistantRankInput, setAssistantRankInput] = useState<SeniorityLevel>(1)
  const [newLocationSite, setNewLocationSite] = useState<DutySite>('Sancaktepe')
  const [newLocationName, setNewLocationName] = useState('')

  const [ownersMonth, setOwnersMonth] = useState(currentMonthISO)
  const [ownersEditMode, setOwnersEditMode] = useState(false)
  const [ownersWorking, setOwnersWorking] = useState<LocationOwners>({})
  const [postDutyPoolWorking, setPostDutyPoolWorking] = useState<string[]>([])
  const [postDutyPoolDraft, setPostDutyPoolDraft] = useState('')
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({})
  const [ownerSelectionDrafts, setOwnerSelectionDrafts] = useState<Record<string, string[]>>({})

  const [dutyMonth, setDutyMonth] = useState(currentMonthISO)
  const [dutyQuickText, setDutyQuickText] = useState('')
  const [dutyImportIssues, setDutyImportIssues] = useState<string[]>([])
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({})
  const [dutyDrafts, setDutyDrafts] = useState<Record<string, string>>({})
  const [dutySiteDrafts, setDutySiteDrafts] = useState<Record<string, DutySite | ''>>({})
  const [specialistWorkText, setSpecialistWorkText] = useState('')
  const [specialistWorkIssues, setSpecialistWorkIssues] = useState<string[]>([])
  const [specialistDutyText, setSpecialistDutyText] = useState('')
  const [specialistDutyIssues, setSpecialistDutyIssues] = useState<string[]>([])

  const [observerAssistant, setObserverAssistant] = useState('')
  const [observerMonth, setObserverMonth] = useState(currentMonthISO)
  const [assistantTableMonthDraft, setAssistantTableMonthDraft] = useState(currentMonthISO)
  const [assistantTableMonthActive, setAssistantTableMonthActive] = useState(currentMonthISO)
  const [assistantMonthlyTableOpen, setAssistantMonthlyTableOpen] = useState(false)
  const [observerDutyMonthDraft, setObserverDutyMonthDraft] = useState(currentMonthISO)
  const [observerDutyMonthActive, setObserverDutyMonthActive] = useState(currentMonthISO)
  const [observerDutyListOpen, setObserverDutyListOpen] = useState(false)
  const [activeObserverWeek, setActiveObserverWeek] = useState('')
  const [observerWeeklyWeekStart, setObserverWeeklyWeekStart] = useState(currentWeekStartISO)
  const [observerDay, setObserverDay] = useState('')
  const [observerWeekRoom, setObserverWeekRoom] = useState('')
  const [observerWeekDutySite, setObserverWeekDutySite] = useState<DutySite>('Sancaktepe')
  const [observerWeekDetailView, setObserverWeekDetailView] =
    useState<ObserverWeekDetailView>('person')
  const [plannerMonth, setPlannerMonth] = useState(currentMonthISO)
  const [activePlannerDay, setActivePlannerDay] = useState(todayISO)
  const [plannerWeeklyExportOpen, setPlannerWeeklyExportOpen] = useState(false)
  const [plannerWeeklyExportWeekStartISO, setPlannerWeeklyExportWeekStartISO] = useState(
    currentWeekStartISO,
  )
  const [plannerDraftAssignments, setPlannerDraftAssignments] = useState<ManualAssignments>({})
  const [plannerEditModes, setPlannerEditModes] = useState<Record<string, boolean>>({})

  const weekDays = useMemo(() => buildWeek(currentWeekStartISO), [currentWeekStartISO])
  const plannerMonthDays = useMemo(() => listMonthDays(plannerMonth), [plannerMonth])
  const dutyMonthDays = useMemo(() => listMonthDays(dutyMonth), [dutyMonth])
  const observerRollingWeekOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const offset = index - 2
        const weekStart = toISODate(addDays(fromISODate(currentWeekStartISO), offset * 7))
        const days = buildWeek(weekStart)
        const firstDay = days[0]?.key ?? weekStart
        const lastDay = days[6]?.key ?? weekStart
        const label =
          offset === -2
            ? '2 hafta önce'
            : offset === -1
              ? 'Geçen hafta'
              : offset === 0
                ? 'Bu hafta'
                : offset === 1
                  ? 'Gelecek hafta'
                  : `${offset} hafta sonra`

        return {
          weekStartISO: weekStart,
          label,
          rangeLabel: `${formatDayMonthLabel(firstDay)} - ${formatDayMonthLabel(lastDay)}`,
          days,
        }
      }),
    [currentWeekStartISO],
  )
  const observerActiveWeekDays = useMemo(
    () => observerRollingWeekOptions.find((group) => group.weekStartISO === activeObserverWeek)?.days ?? [],
    [activeObserverWeek, observerRollingWeekOptions],
  )
  const observerWeeklyDays = useMemo(() => buildWeek(observerWeeklyWeekStart), [observerWeeklyWeekStart])
  const sortedLocations = useMemo(() => sortLocationsForState(data.locations, todayISO), [data.locations, todayISO])
  const roomLocations = useMemo(
    () =>
      sortLocationsForState(
        data.locations.filter(
          (location) => location.kind === 'normal' && isLocationActiveOnDay(location, todayISO),
        ),
        todayISO,
      ),
    [data.locations, todayISO],
  )
  const plannerReferenceDay = activePlannerDay || todayISO
  const plannerLocations = useMemo(
    () => getLocationsForDay(data, plannerReferenceDay),
    [data, plannerReferenceDay],
  )
  const plannerRoomLocations = useMemo(
    () => plannerLocations.filter((location) => location.kind === 'normal'),
    [plannerLocations],
  )
  const plannerStatusLocations = useMemo(
    () => plannerLocations.filter((location) => location.kind === 'leave'),
    [plannerLocations],
  )

  const groupBySite = useCallback((locations: WorkLocation[], dayKey = todayISO) => {
    const orderedLocations = sortLocationsForState(locations, dayKey)
    const map = new Map<string, WorkLocation[]>()
    orderedLocations.forEach((location) => {
      map.set(location.site, [...(map.get(location.site) ?? []), location])
    })
    return [...map.entries()].sort(
      (a, b) => getSiteDisplayRank(a[0]) - getSiteDisplayRank(b[0]) || a[0].localeCompare(b[0], 'tr'),
    )
  }, [todayISO])

  const buildRelativeMonthOptions = useCallback((anchorMonth: string, extraMonths: string[]) => {
    const months = new Set<string>()
    const normalizedAnchor = isValidMonthISO(anchorMonth) ? anchorMonth : currentMonthISO
    for (let offset = -3; offset <= 3; offset += 1) {
      months.add(shiftMonthISO(normalizedAnchor, offset))
    }
    months.add(currentMonthISO)
    extraMonths.filter(isValidMonthISO).forEach((monthISO) => months.add(monthISO))

    const selectedYear = Number(normalizedAnchor.slice(0, 4))
    return [...months]
      .sort()
      .map((monthISO) => ({
        value: monthISO,
        label: formatMonthSelectLabel(monthISO, Number.isNaN(selectedYear) ? undefined : selectedYear),
      }))
  }, [currentMonthISO])

  const groupedRoomLocations = useMemo(() => groupBySite(roomLocations, todayISO), [groupBySite, roomLocations, todayISO])
  const groupedPlannerRoomLocations = useMemo(
    () => groupBySite(plannerRoomLocations, plannerReferenceDay),
    [groupBySite, plannerReferenceDay, plannerRoomLocations],
  )
  const groupedStatusLocations = useMemo(
    () => groupBySite(plannerStatusLocations, plannerReferenceDay),
    [groupBySite, plannerReferenceDay, plannerStatusLocations],
  )
  const groupedObserverLocations = useMemo(
    () => groupBySite(sortedLocations, todayISO),
    [groupBySite, sortedLocations, todayISO],
  )
  const observerWeekRoomOptions = useMemo(
    () => sortedLocations.filter((location) => location.kind === 'normal'),
    [sortedLocations],
  )
  const assistantGroupLevels = useMemo(
    () => buildSeniorityLevels(data.assistants, data.assistantRanks, false),
    [data.assistantRanks, data.assistants],
  )
  const assistantInputLevels = useMemo(
    () => buildSeniorityLevels(data.assistants, data.assistantRanks, true),
    [data.assistantRanks, data.assistants],
  )
  const assistantsBySeniority = useMemo(
    () =>
      assistantGroupLevels.map((level) => ({
        level,
        names: data.assistants.filter((assistant) => data.assistantRanks[assistant] === level),
      })),
    [assistantGroupLevels, data.assistantRanks, data.assistants],
  )
  const assistantAccounts = useMemo(() => buildAssistantAccounts(data.assistants), [data.assistants])
  const assistantLoginQuery = assistantUsernameInput.trim().toLocaleLowerCase('tr')
  const assistantLoginQueryCanonical = normalizeAssistantName(assistantUsernameInput).toLocaleLowerCase('tr')
  const filteredAssistantAccounts = useMemo(() => {
    if (!assistantLoginQuery) {
      return assistantAccounts
    }
    return assistantAccounts.filter((account) => {
      const name = account.assistantName.toLocaleLowerCase('tr')
      return name.includes(assistantLoginQuery)
    })
  }, [assistantAccounts, assistantLoginQuery])
  const matchedAssistantAccount = useMemo(
    () =>
      assistantAccounts.find((account) => {
        const lowerName = account.assistantName.toLocaleLowerCase('tr')
        return lowerName === assistantLoginQuery || lowerName === assistantLoginQueryCanonical
      }) ?? null,
    [assistantAccounts, assistantLoginQuery, assistantLoginQueryCanonical],
  )
  const ownersForSelectedMonth = useMemo(
    () => getLocationOwnersForMonth(data, ownersMonth),
    [data, ownersMonth],
  )
  const postDutyPoolForSelectedMonth = useMemo(
    () => getPostDutyPoolForMonth(data, ownersMonth),
    [data, ownersMonth],
  )
  const visibleOwnersForMonth = ownersEditMode ? ownersWorking : ownersForSelectedMonth
  const visiblePostDutyPoolForMonth = ownersEditMode
    ? postDutyPoolWorking
    : postDutyPoolForSelectedMonth
  const ownersMonthOptions = useMemo(() => {
    return buildRelativeMonthOptions(ownersMonth, [
      ...Object.keys(data.locationOwnersByMonth),
      ...Object.keys(data.postDutyPoolByMonth),
    ])
  }, [buildRelativeMonthOptions, data.locationOwnersByMonth, data.postDutyPoolByMonth, ownersMonth])
  const dutyMonthOptions = useMemo(() => {
    const dutyMonths = Object.keys(data.dutyRoster)
      .filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey))
      .map((dayKey) => dayKey.slice(0, 7))
    return buildRelativeMonthOptions(dutyMonth, dutyMonths)
  }, [buildRelativeMonthOptions, data.dutyRoster, dutyMonth])
  const plannerMonthOptions = useMemo(() => {
    const plannerMonths = [
      ...Object.keys(data.manualAssignments)
        .filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey))
        .map((dayKey) => dayKey.slice(0, 7)),
      ...Object.keys(data.dutyRoster)
        .filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey))
        .map((dayKey) => dayKey.slice(0, 7)),
    ]
    return buildRelativeMonthOptions(plannerMonth, plannerMonths)
  }, [buildRelativeMonthOptions, data.dutyRoster, data.manualAssignments, plannerMonth])
  const roomLeftGroups = useMemo(
    () => groupedPlannerRoomLocations.filter(([siteName]) => siteName === 'Sancaktepe'),
    [groupedPlannerRoomLocations],
  )
  const roomMiddleGroups = useMemo(
    () => groupedPlannerRoomLocations.filter(([siteName]) => siteName === 'Çekmeköy'),
    [groupedPlannerRoomLocations],
  )
  const roomRightGroups = useMemo(
    () => groupedPlannerRoomLocations.filter(([siteName]) => siteName === 'Feriha Öz'),
    [groupedPlannerRoomLocations],
  )
  const plannerDayOptions = useMemo(
    () =>
      plannerMonthDays.map((dayKey) => {
        const date = fromISODate(dayKey)
        const compactDate = date.toLocaleDateString('tr-TR', {
          day: '2-digit',
          month: '2-digit',
        })
        const weekdayLabel = date
          .toLocaleDateString('tr-TR', {
            weekday: 'short',
          })
          .replace('.', '')
        return {
          key: dayKey,
          label: date.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            weekday: 'short',
          }),
          compactDate,
          weekdayLabel,
          dayTypeLabel: getDayTypeLabel(dayKey),
          roomAssignmentBlocked: !isRoomAssignableDay(date),
        }
      }),
    [plannerMonthDays],
  )
  const cloudPayload = useMemo(
    () => JSON.stringify(buildRemotePayload(data, userBindings)),
    [data, userBindings],
  )
  const isTableLikeFullscreenOpen =
    (session?.role === 'admin' && plannerWeeklyExportOpen) ||
    (session?.role === 'assistant' && (assistantMonthlyTableOpen || observerDutyListOpen))
  const adminBlockRemainingMs = Math.max(0, adminLoginGuard.blockedUntil - blockClockMs)
  const isSecureCloudWriteUnlocked = !isSupabaseAdminAuthRequired || isAdminCloudAuthVerified

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    document.body.classList.toggle('table-pan-unlocked', isTableLikeFullscreenOpen)
    return () => {
      document.body.classList.remove('table-pan-unlocked')
    }
  }, [isTableLikeFullscreenOpen])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(USER_BINDING_KEY, JSON.stringify(userBindings))
    }
  }, [userBindings])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ADMIN_LOGIN_GUARD_KEY, JSON.stringify(adminLoginGuard))
    }
  }, [adminLoginGuard])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const normalizedEmail = adminCloudAuthEmail.trim()
    if (normalizedEmail) {
      localStorage.setItem(ADMIN_AUTH_EMAIL_KEY, normalizedEmail)
    } else {
      localStorage.removeItem(ADMIN_AUTH_EMAIL_KEY)
    }
  }, [adminCloudAuthEmail])

  useEffect(() => {
    if (!isSupabaseAdminAuthRequired) {
      adminCloudWriteUnlockedRef.current = true
      setIsAdminCloudAuthVerified(true)
      setAdminCloudAuthStatus('disabled')
      setAdminCloudAuthMessage('Güvenli admin modu kapalı.')
      return
    }

    if (!isSupabaseConfigured || !supabase) {
      adminCloudWriteUnlockedRef.current = false
      cloudCanWriteRef.current = false
      setIsAdminCloudAuthVerified(false)
      setAdminCloudAuthStatus('error')
      setAdminCloudAuthMessage('Güvenli admin girişi için Supabase bağlantısı gerekli.')
      return
    }

    const client = supabase
    let cancelled = false

    const lockCloudWrite = () => {
      adminCloudWriteUnlockedRef.current = false
      cloudCanWriteRef.current = false
      setIsAdminCloudAuthVerified(false)
    }

    const verifyPortalAdmin = async (userId: string, email?: string | null) => {
      setAdminCloudAuthStatus('checking')
      setAdminCloudAuthMessage('Güvenli admin yetkisi kontrol ediliyor...')

      const { data: adminRow, error } = await client
        .from('portal_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()

      if (cancelled) {
        return false
      }

      if (error) {
        lockCloudWrite()
        setAdminCloudAuthStatus('error')
        setAdminCloudAuthMessage('portal_admins tablosu veya RLS kurulumu hazır değil.')
        return false
      }

      if (!adminRow) {
        lockCloudWrite()
        setAdminCloudAuthStatus('unauthorized')
        setAdminCloudAuthMessage('Bu Supabase kullanıcısı portal admini olarak yetkili değil.')
        return false
      }

      adminCloudWriteUnlockedRef.current = true
      cloudCanWriteRef.current = cloudHydratedRef.current && isCloudWriteEnabled
      setIsAdminCloudAuthVerified(true)
      setAdminCloudAuthStatus('signed-in')
      setAdminCloudAuthMessage('Güvenli admin oturumu aktif.')
      if (email) {
        setAdminCloudAuthEmail(email)
      }
      if (cloudHydratedRef.current) {
        setCloudStateText(isCloudWriteEnabled ? 'Bulut kaydı aktif.' : CLOUD_READ_ONLY_TEXT)
      }
      return true
    }

    void client.auth.getSession().then(({ data: authData, error }) => {
      if (cancelled) {
        return
      }
      if (error || !authData.session?.user) {
        lockCloudWrite()
        setAdminCloudAuthStatus('signed-out')
        setAdminCloudAuthMessage('Güvenli admin girişi gerekli.')
        return
      }
      void verifyPortalAdmin(authData.session.user.id, authData.session.user.email)
    })

    const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        lockCloudWrite()
        setAdminCloudAuthStatus('signed-out')
        setAdminCloudAuthMessage('Güvenli admin girişi gerekli.')
        return
      }
      void verifyPortalAdmin(nextSession.user.id, nextSession.user.email)
    })

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    setBlockClockMs(Date.now())
    if (adminLoginGuard.blockedUntil <= Date.now()) {
      return
    }
    const timer = window.setInterval(() => {
      setBlockClockMs(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [adminLoginGuard.blockedUntil])

  useEffect(() => {
    if (!adminLoginGuard.blockedUntil || adminBlockRemainingMs > 0) {
      return
    }
    setAdminLoginGuard((previous) =>
      previous.blockedUntil
        ? {
            ...previous,
            blockedUntil: 0,
          }
      : previous,
    )
  }, [adminBlockRemainingMs, adminLoginGuard.blockedUntil])

  useEffect(() => {
    const scroller = plannerMonthDayScrollerRef.current
    if (!scroller) {
      return
    }

    const activeButton = scroller.querySelector<HTMLButtonElement>(
      `[data-planner-day="${activePlannerDay}"]`,
    )
    if (!activeButton) {
      return
    }

    window.requestAnimationFrame(() => {
      const left = activeButton.offsetLeft - scroller.clientWidth * 0.12
      scroller.scrollTo({
        left: Math.max(0, left),
        behavior: 'smooth',
      })
    })
  }, [activePlannerDay, plannerMonth])

  useEffect(() => {
    let cancelled = false

    const loadCloudState = async () => {
      if (!isSupabaseConfigured || !supabase) {
        cloudHydratedRef.current = true
        cloudCanWriteRef.current = false
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
        cloudCanWriteRef.current = false
        setCloudState('error')
        setCloudStateText(CLOUD_SAFE_GUARD_TEXT)
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
        cloudCanWriteRef.current = isCloudWriteEnabled && adminCloudWriteUnlockedRef.current
        cloudRevisionRef.current = typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : null
        setData(nextPlannerState)
        setUserBindings(nextUserBindings)
        setCloudState('ready')
        setCloudStateText(
          !isCloudWriteEnabled
            ? CLOUD_READ_ONLY_TEXT
            : adminCloudWriteUnlockedRef.current
              ? 'Bulut kaydı aktif.'
              : CLOUD_AUTH_LOCKED_TEXT,
        )
        if (typeof row.updated_at === 'string' && row.updated_at) {
          setCloudLastSavedAt(row.updated_at)
        }
        return
      }

      if (!isCloudWriteEnabled || !adminCloudWriteUnlockedRef.current) {
        cloudPayloadRef.current = JSON.stringify(currentSnapshot)
        cloudHydratedRef.current = true
        cloudCanWriteRef.current = false
        cloudRevisionRef.current = null
        setCloudState('ready')
        setCloudStateText(isCloudWriteEnabled ? CLOUD_AUTH_LOCKED_TEXT : CLOUD_READ_ONLY_TEXT)
        return
      }

      const seedTimestamp = new Date().toISOString()
      const { error: seedError } = await supabase.from(REMOTE_STATE_TABLE).upsert(
        {
          id: REMOTE_STATE_ROW_ID,
          payload: currentSnapshot,
          updated_at: seedTimestamp,
        },
        { onConflict: 'id' },
      )

      if (cancelled) {
        return
      }

      if (seedError) {
        cloudHydratedRef.current = true
        cloudCanWriteRef.current = false
        setCloudState('error')
        setCloudStateText('Bulut tablosu hazır değil veya yazılamıyor. SQL kurulumunu tamamlayıp yenile.')
        return
      }

      cloudPayloadRef.current = JSON.stringify(currentSnapshot)
      cloudHydratedRef.current = true
      cloudCanWriteRef.current = true
      cloudRevisionRef.current = seedTimestamp
      setCloudState('ready')
      setCloudStateText(isCloudWriteEnabled ? 'Bulut kaydı aktif.' : CLOUD_READ_ONLY_TEXT)
      setCloudLastSavedAt(seedTimestamp)
    }

    void loadCloudState()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (
      !isSupabaseConfigured ||
      !supabase ||
      !cloudHydratedRef.current ||
      !isCloudWriteEnabled ||
      !cloudCanWriteRef.current
    ) {
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

        const { data: remoteRow, error: remoteReadError } = await supabase
          .from(REMOTE_STATE_TABLE)
          .select('updated_at')
          .eq('id', REMOTE_STATE_ROW_ID)
          .maybeSingle()

        if (remoteReadError || !remoteRow) {
          cloudCanWriteRef.current = false
          setCloudState('error')
          setCloudStateText(CLOUD_SAFE_GUARD_TEXT)
          setIsCloudSaving(false)
          return
        }

        const remoteUpdatedAt =
          typeof remoteRow.updated_at === 'string' && remoteRow.updated_at ? remoteRow.updated_at : null
        const knownRevision = cloudRevisionRef.current
        if (knownRevision && remoteUpdatedAt && knownRevision !== remoteUpdatedAt) {
          cloudCanWriteRef.current = false
          setCloudState('error')
          setCloudStateText(CLOUD_CONFLICT_TEXT)
          setIsCloudSaving(false)
          return
        }

        const nextUpdatedAt = new Date().toISOString()
        const updateBase = supabase
          .from(REMOTE_STATE_TABLE)
          .update({
            payload: payloadObject,
            updated_at: nextUpdatedAt,
          })
          .eq('id', REMOTE_STATE_ROW_ID)
        const guardedUpdate = remoteUpdatedAt ? updateBase.eq('updated_at', remoteUpdatedAt) : updateBase
        const { data: updatedRows, error } = await guardedUpdate.select('updated_at')

        if (error) {
          cloudCanWriteRef.current = false
          setCloudState('error')
          setCloudStateText(CLOUD_CONFLICT_TEXT)
          setIsCloudSaving(false)
          return
        }

        const updatedAtFromServer =
          Array.isArray(updatedRows) && updatedRows.length
            ? typeof updatedRows[0]?.updated_at === 'string'
              ? updatedRows[0].updated_at
              : null
            : null
        if (!updatedAtFromServer) {
          cloudCanWriteRef.current = false
          setCloudState('error')
          setCloudStateText(CLOUD_CONFLICT_TEXT)
          setIsCloudSaving(false)
          return
        }

        const nowMs = Date.now()
        if (nowMs - cloudHistoryBackupLastAtRef.current >= AUTO_HISTORY_BACKUP_MIN_INTERVAL_MS) {
          cloudHistoryBackupLastAtRef.current = nowMs
          void supabase.from(REMOTE_STATE_HISTORY_TABLE).insert({
            state_id: REMOTE_STATE_ROW_ID,
            payload: payloadObject,
            saved_at: updatedAtFromServer,
            source: 'auto-save-throttled',
          })
        }

        cloudPayloadRef.current = cloudPayload
        cloudRevisionRef.current = updatedAtFromServer
        setCloudState('ready')
        setCloudStateText(isCloudWriteEnabled ? 'Bulut kaydı aktif.' : CLOUD_READ_ONLY_TEXT)
        setCloudLastSavedAt(updatedAtFromServer)
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
    if (
      (loginView !== 'assistant' && loginView !== 'choose') ||
      assistantUsernameInput.trim() ||
      assistantLoginManuallyClearedRef.current
    ) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }

    const lastUser = localStorage.getItem(LAST_ASSISTANT_USER_KEY)?.trim() ?? ''
    if (!lastUser) {
      return
    }
    const lowerLastUser = lastUser.toLocaleLowerCase('tr')
    const exactByName = data.assistants.find((assistant) => assistant.toLocaleLowerCase('tr') === lowerLastUser)
    if (exactByName) {
      if (loginView === 'choose') {
        setLoginView('assistant')
      }
      setAssistantUsernameInput(exactByName)
      return
    }
    const byAccount = assistantAccounts.find((account) => account.username === lowerLastUser)
    if (byAccount) {
      if (loginView === 'choose') {
        setLoginView('assistant')
      }
      setAssistantUsernameInput(byAccount.assistantName)
    }
  }, [assistantAccounts, assistantUsernameInput, data.assistants, loginView])

  useEffect(() => {
    setUserBindings((previous) => {
      const validNameByKey = new Map(
        data.assistants.map((assistant) => [assistant.toLocaleLowerCase('tr'), assistant] as const),
      )
      const next = Object.fromEntries(
        Object.entries(previous).flatMap(([rawKey, rawValue]) => {
          const key = rawKey.trim().toLocaleLowerCase('tr')
          const value = normalizeAssistantName(String(rawValue))
          if (!value) {
            return []
          }
          const validName = validNameByKey.get(value.toLocaleLowerCase('tr'))
          if (!validName || key !== validName.toLocaleLowerCase('tr')) {
            return []
          }
          return [[validName.toLocaleLowerCase('tr'), validName] as const]
        }),
      ) as Record<string, string>

      const previousKeys = Object.keys(previous)
      const nextKeys = Object.keys(next)
      if (
        previousKeys.length === nextKeys.length &&
        previousKeys.every((key) => previous[key] === next[key])
      ) {
        return previous
      }
      return next
    })
  }, [data.assistants])

  useEffect(() => {
    if (loginView !== 'assistant' && assistantUserPickerOpen) {
      setAssistantUserPickerOpen(false)
    }
  }, [assistantUserPickerOpen, loginView])

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
      setAssistantMonthlyTableOpen(false)
      setObserverDutyListOpen(false)
      setAssistantTableMonthDraft(observerMonth)
      setAssistantTableMonthActive(observerMonth)
      setObserverDutyMonthDraft(observerMonth)
      setObserverDutyMonthActive(observerMonth)
      if (session.assistantName) {
        setObserverAssistant(session.assistantName)
      }
    }
  }, [observerMonth, session])

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
    if (!observerRollingWeekOptions.length) {
      if (activeObserverWeek) {
        setActiveObserverWeek('')
      }
      return
    }

    if (!observerRollingWeekOptions.some((group) => group.weekStartISO === activeObserverWeek)) {
      const preferredWeek = observerRollingWeekOptions.find((group) =>
        group.days.some((day) => day.key === todayISO),
      )
      setActiveObserverWeek(preferredWeek?.weekStartISO ?? observerRollingWeekOptions[0].weekStartISO)
    }
  }, [activeObserverWeek, observerRollingWeekOptions, todayISO])

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
    if (
      observerRollingWeekOptions.length &&
      !observerRollingWeekOptions.some((week) => week.weekStartISO === observerWeeklyWeekStart)
    ) {
      setObserverWeeklyWeekStart(currentWeekStartISO)
    }
  }, [currentWeekStartISO, observerRollingWeekOptions, observerWeeklyWeekStart])

  useEffect(() => {
    const scrollItemToStart = (container: HTMLDivElement | null, selector: string) => {
      if (!container) {
        return
      }

      const target = container.querySelector<HTMLElement>(selector)
      if (!target) {
        return
      }

      const scrollToTarget = () => {
        const containerRect = container.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const left = Math.max(0, targetRect.left - containerRect.left + container.scrollLeft)
        container.scrollTo({ left, behavior: 'auto' })
      }

      window.requestAnimationFrame(scrollToTarget)
      window.setTimeout(scrollToTarget, 80)
    }

    if (observerSection === 'personWeek') {
      scrollItemToStart(observerWeeklyScrollerRef.current, `[data-week-start="${currentWeekStartISO}"]`)
    }

    if (observerSection === 'dailyMap') {
      scrollItemToStart(observerDailyWeekScrollerRef.current, `[data-week-start="${currentWeekStartISO}"]`)
      scrollItemToStart(observerDailyDayScrollerRef.current, `[data-day-key="${observerDay}"]`)
    }
  }, [currentWeekStartISO, observerDay, observerRollingWeekOptions, observerSection])

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
    if (!observerWeekRoomOptions.length) {
      if (observerWeekRoom) {
        setObserverWeekRoom('')
      }
      return
    }

    if (!observerWeekRoomOptions.some((location) => location.id === observerWeekRoom)) {
      setObserverWeekRoom(observerWeekRoomOptions[0]?.id ?? '')
    }
  }, [observerWeekRoom, observerWeekRoomOptions])

  useEffect(() => {
    if (!assistantInputLevels.length) {
      if (assistantRankInput !== 1) {
        setAssistantRankInput(1)
      }
      return
    }

    if (!assistantInputLevels.includes(assistantRankInput)) {
      setAssistantRankInput(assistantInputLevels[assistantInputLevels.length - 1] ?? 1)
    }
  }, [assistantInputLevels, assistantRankInput])

  const showWarning = (text: string) => setNotice({ type: 'warn', text })
  const showSuccess = (text: string) => setNotice({ type: 'ok', text })
  const isPlannerDayInEditMode = (dayKey: string): boolean => Boolean(plannerEditModes[dayKey])
  const ensurePlannerDayInEditMode = (dayKey: string): boolean => {
    if (isPlannerDayInEditMode(dayKey)) {
      return true
    }
    showWarning(`${dayKey} için önce "Değiştir" butonuna bas.`)
    return false
  }
  const getPlannerStateForDay = (dayKey: string): PlannerState => {
    if (!isPlannerDayInEditMode(dayKey)) {
      return data
    }
    const dayDraftAssignments = cloneDayLocationAssignments(
      plannerDraftAssignments[dayKey] ?? data.manualAssignments[dayKey],
    )
    return {
      ...data,
      manualAssignments: {
        ...data.manualAssignments,
        [dayKey]: dayDraftAssignments,
      },
    }
  }

  const loginAsAdmin = async () => {
    const now = Date.now()
    if (adminLoginGuard.blockedUntil > now) {
      showWarning(`Çok fazla yanlış deneme. ${formatRemainingBlock(adminLoginGuard.blockedUntil - now)} sonra tekrar dene.`)
      return
    }

    const passwordCandidate = passwordInput.trim()
    const passwordAccepted =
      adminLoginGuard.rememberedAdmin && !passwordCandidate
        ? true
        : (await sha256Hex(passwordCandidate)) === APP_PASSWORD_HASH

    if (!passwordAccepted) {
      const nextFailedAttempts = adminLoginGuard.failedAttempts + 1
      let blockedUntil = 0
      let blockDurationMs = 0

      if (nextFailedAttempts % ADMIN_BLOCK_STEP === 0) {
        blockDurationMs = nextFailedAttempts >= ADMIN_BLOCK_STEP * 2 ? ADMIN_SECOND_BLOCK_MS : ADMIN_FIRST_BLOCK_MS
        blockedUntil = now + blockDurationMs
      }

      setAdminLoginGuard((previous) => ({
        ...previous,
        failedAttempts: nextFailedAttempts,
        blockedUntil,
      }))

      if (blockedUntil > 0) {
        showWarning(
          `Şifre hatalı. ${nextFailedAttempts}. yanlış deneme sonrası giriş ${formatRemainingBlock(blockDurationMs)} bloke edildi.`,
        )
      } else {
        const remainingToBlock = ADMIN_BLOCK_STEP - (nextFailedAttempts % ADMIN_BLOCK_STEP)
        showWarning(
          `Şifre hatalı. Lütfen tekrar dene.${remainingToBlock > 0 ? ` ${remainingToBlock} yanlış sonra blok uygulanır.` : ''}`,
        )
      }
      return
    }

    if (isSupabaseAdminAuthRequired) {
      if (!isSupabaseConfigured || !supabase) {
        showWarning('Güvenli admin girişi için Supabase bağlantısı gerekli.')
        return
      }

      if (!isAdminCloudAuthVerified) {
        const email = adminCloudAuthEmail.trim()
        const cloudPassword = adminCloudAuthPassword.trim()

        if (!email || !cloudPassword) {
          showWarning('Güvenli modda Supabase admin e-posta ve şifresi de gerekli.')
          return
        }

        setAdminCloudAuthStatus('checking')
        setAdminCloudAuthMessage('Supabase admin girişi yapılıyor...')

        const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: cloudPassword,
        })

        if (signInError || !authData.user) {
          adminCloudWriteUnlockedRef.current = false
          cloudCanWriteRef.current = false
          setIsAdminCloudAuthVerified(false)
          setAdminCloudAuthStatus('signed-out')
          setAdminCloudAuthMessage('Supabase admin girişi başarısız.')
          showWarning('Supabase admin e-posta veya şifresi hatalı.')
          return
        }

        const { data: adminRow, error: adminError } = await supabase
          .from('portal_admins')
          .select('user_id')
          .eq('user_id', authData.user.id)
          .maybeSingle()

        if (adminError || !adminRow) {
          await supabase.auth.signOut()
          adminCloudWriteUnlockedRef.current = false
          cloudCanWriteRef.current = false
          setIsAdminCloudAuthVerified(false)
          setAdminCloudAuthStatus(adminError ? 'error' : 'unauthorized')
          setAdminCloudAuthMessage(
            adminError
              ? 'portal_admins tablosu veya RLS kurulumu hazır değil.'
              : 'Bu Supabase kullanıcısı portal admini olarak yetkili değil.',
          )
          showWarning(
            adminError
              ? 'Güvenli admin tablosu hazır değil. 003 SQL dosyası uygulanmalı.'
              : 'Bu Supabase kullanıcısı portal admini olarak yetkilendirilmemiş.',
          )
          return
        }

        adminCloudWriteUnlockedRef.current = true
        cloudCanWriteRef.current = cloudHydratedRef.current && isCloudWriteEnabled
        setIsAdminCloudAuthVerified(true)
        setAdminCloudAuthStatus('signed-in')
        setAdminCloudAuthMessage('Güvenli admin oturumu aktif.')
        setAdminCloudAuthEmail(email)
      }
    }

    setAdminLoginGuard({
      failedAttempts: 0,
      blockedUntil: 0,
      rememberedAdmin: true,
    })
    setSession({ role: 'admin' })
    setPasswordInput('')
    setAdminCloudAuthPassword('')
    setNotice(null)
  }

  const recordAssistantLoginEvent = useCallback(async (personName: string) => {
    if (!isSupabaseConfigured || !supabase) {
      return
    }

    if (typeof window !== 'undefined') {
      try {
        const response = await fetch('/api/login-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personName }),
        })
        const contentType = response.headers.get('content-type') ?? ''
        if (response.ok && contentType.includes('application/json')) {
          const result = (await response.json()) as { ok?: boolean }
          if (result.ok) {
            return
          }
        }
      } catch (error) {
        console.warn('Sunucu giriş kaydı denenemedi, doğrudan Supabase kaydı deneniyor.', error)
      }
    }

    const now = Date.now()
    const lastCleanup =
      typeof window === 'undefined'
        ? 0
        : Number(localStorage.getItem(LOGIN_EVENT_CLEANUP_KEY) ?? '0')
    const shouldCleanup = !lastCleanup || now - lastCleanup > LOGIN_EVENT_CLEANUP_INTERVAL_MS

    if (shouldCleanup) {
      const cutoff = new Date(now - LOGIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { error: cleanupError } = await supabase
        .from(LOGIN_EVENTS_TABLE)
        .delete()
        .lt('created_at', cutoff)

      if (cleanupError) {
        console.warn('Eski giriş kayıtları temizlenemedi:', cleanupError.message)
      } else if (typeof window !== 'undefined') {
        localStorage.setItem(LOGIN_EVENT_CLEANUP_KEY, String(now))
      }
    }

    const { error } = await supabase.from(LOGIN_EVENTS_TABLE).insert({
      person_name: personName,
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.warn('Asistan giriş kaydı tutulamadı:', error.message)
    }
  }, [])

  const loginAsAssistant = () => {
    if (!matchedAssistantAccount) {
      showWarning('Lütfen listede bulunan bir asistan ismi seç.')
      return
    }

    const selectedAssistantName = matchedAssistantAccount.assistantName
    const selectedUsername = matchedAssistantAccount.username

    setUserBindings((previous) => ({
      ...previous,
      [selectedUsername]: selectedAssistantName,
    }))

    setSession({
      role: 'assistant',
      username: selectedUsername,
      assistantName: selectedAssistantName,
    })
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_ASSISTANT_USER_KEY, selectedAssistantName)
    }
    void recordAssistantLoginEvent(selectedAssistantName)
    setNotice(null)
    setObserverAssistant(selectedAssistantName)
    setAssistantTableMonthDraft(observerMonth)
    setAssistantTableMonthActive(observerMonth)
    setAssistantMonthlyTableOpen(false)
    setAssistantUserPickerOpen(false)
  }

  const logout = () => {
    if (isSupabaseAdminAuthRequired && session?.role === 'admin' && supabase) {
      void supabase.auth.signOut()
    }
    setSession(null)
    setLoginView('choose')
    setPlannerWeeklyExportOpen(false)
    setAssistantMonthlyTableOpen(false)
    setObserverDutyListOpen(false)
    setMode('admin')
    assistantLoginManuallyClearedRef.current = false
    setPasswordInput('')
    setAdminCloudAuthPassword('')
    setAssistantUsernameInput('')
    setAssistantUserPickerOpen(false)
    if (isSupabaseAdminAuthRequired) {
      adminCloudWriteUnlockedRef.current = false
      cloudCanWriteRef.current = false
      setIsAdminCloudAuthVerified(false)
      setAdminCloudAuthStatus('signed-out')
      setAdminCloudAuthMessage('Güvenli admin girişi gerekli.')
    }
    setNotice(null)
  }

  const selectAdminSection = (section: AdminSection) => {
    setAdminSection(section)
    if (section === 'backups') {
      void refreshBackups()
    }
    if (section === 'loginEvents') {
      void refreshLoginEvents()
    }
  }

  const selectObserverSection = (section: ObserverSection) => {
    setObserverSection(section)
  }

  useEffect(() => {
    if (session?.role !== 'assistant') {
      return
    }

    if (!session.assistantName || !data.assistants.includes(session.assistantName)) {
      showWarning('Asistan eşleşmesi bulunamadı. Lütfen tekrar giriş yapıp asistan seç.')
      setSession(null)
      setLoginView('assistant')
      setAssistantUsernameInput(session.assistantName ?? '')
      setAssistantUserPickerOpen(false)
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

  const getAssistantPlacementDetail = (
    state: PlannerState,
    dayKey: string,
    assistant: string,
  ): string => {
    const normalLocation = state.locations.find(
      (location) =>
        location.kind === 'normal' &&
        getAssignmentsForLocation(state, dayKey, location).includes(assistant),
    )
    if (normalLocation) {
      return `${normalLocation.site} / ${normalLocation.name}`
    }

    const dutyAssignment = getDutyAssignmentForPerson(state, dayKey, assistant)
    if (dutyAssignment) {
      return `Nöbet (${dutyAssignment.site})`
    }

    const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
    const postDutyAssignment = (state.dutyRoster[previousDay] ?? []).find(
      (entry) => entry.name === assistant,
    )
    if (postDutyAssignment) {
      return `Nöbet Ertesi (${postDutyAssignment.site})`
    }

    const leaveLocation = state.locations.find(
      (location) =>
        location.kind === 'leave' &&
        getAssignmentsForLocation(state, dayKey, location).includes(assistant),
    )
    if (leaveLocation) {
      return leaveLocation.name
    }

    return 'Atama yok'
  }

  const getAssistantOwnerSectionsForDay = (
    state: PlannerState,
    dayKey: string,
    assistant: string,
  ): DutySite[] => {
    const ownersForDay = getLocationOwnersForDay(state, dayKey)
    const ownedSites = new Set<DutySite>()

    state.locations.forEach((location) => {
      if (location.kind !== 'normal' || !isLocationActiveOnDay(location, dayKey)) {
        return
      }
      const isOwner = (ownersForDay[location.id] ?? []).includes(assistant)
      if (!isOwner) {
        return
      }
      const normalizedSite = normalizeDutySite(location.site)
      if (normalizedSite) {
        ownedSites.add(normalizedSite)
      }
    })

    return [...ownedSites]
  }

  const getAssistantOwnerSectionForPlannerList = (
    state: PlannerState,
    dayKey: string,
    assistant: string,
    sectionOrder: Array<DutySite | 'Diğer'>,
  ): DutySite | 'Diğer' => {
    const ownedSites = getAssistantOwnerSectionsForDay(state, dayKey, assistant)
    if (!ownedSites.length) {
      return 'Diğer'
    }

    const preferredByOrder = sectionOrder.find(
      (section): section is DutySite => section !== 'Diğer' && ownedSites.includes(section),
    )
    if (preferredByOrder) {
      return preferredByOrder
    }

    return ownedSites[0] ?? 'Diğer'
  }

  const getPlannerAssistantSectionOrder = (locationSite: string): Array<DutySite | 'Diğer'> => {
    if (locationSite === 'Çekmeköy') {
      return ['Çekmeköy', 'Sancaktepe', 'Feriha Öz', 'Diğer']
    }
    if (locationSite === 'Feriha Öz') {
      return ['Feriha Öz', 'Sancaktepe', 'Çekmeköy', 'Diğer']
    }
    return ['Sancaktepe', 'Feriha Öz', 'Çekmeköy', 'Diğer']
  }

  const getAssistantOptionLabelForState = (
    state: PlannerState,
    assistant: string,
    dayKey: string,
  ): string => {
    const detail = getAssistantPlacementDetail(state, dayKey, assistant)
    if (detail === 'Atama yok') {
      return assistant
    }
    return `${assistant} - ${detail}`
  }

  const getDisplayAssignmentsForLocation = (
    state: PlannerState,
    dayKey: string,
    location: WorkLocation,
  ): string[] => {
    if (location.kind === 'duty') {
      return sortDutyAssignments(state.dutyRoster[dayKey] ?? [], state.assistantRanks).map(
        (entry) => `${entry.name} (${entry.site})`,
      )
    }
    if (location.kind === 'postDuty') {
      const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
      return sortDutyAssignments(state.dutyRoster[previousDay] ?? [], state.assistantRanks).map(
        (entry) => `${entry.name} (${entry.site})`,
      )
    }
    return sortAssistantNamesByRank(
      getAssignmentsForLocation(state, dayKey, location),
      state.assistantRanks,
    )
  }

  const getSpecialistNamesForLocation = useCallback((
    state: PlannerState,
    dayKey: string,
    location: WorkLocation,
  ): string[] => {
    if (location.kind !== 'normal') {
      return []
    }
    return getSpecialistsForLocation(state, dayKey, location.id)
  }, [])

  const getSpecialistLabelForLocation = useCallback((
    state: PlannerState,
    dayKey: string,
    location: WorkLocation,
  ): string | null => {
    const names = getSpecialistNamesForLocation(state, dayKey, location)
    return formatSpecialistWorkLabel(names)
  }, [getSpecialistNamesForLocation])

  const getWeeklyPersonLocationLabel = useCallback((
    state: PlannerState,
    dayKey: string,
    assistant: string,
    location: WorkLocation,
  ): string => {
    if (location.kind === 'duty') {
      const dutyAssignment = (state.dutyRoster[dayKey] ?? []).find((entry) => entry.name === assistant)
      return dutyAssignment ? `${dutyAssignment.site} Nöbet` : 'Nöbet'
    }

    if (location.kind === 'postDuty') {
      return 'Nöbet Ertesi'
    }

    if (location.kind === 'leave') {
      return location.name
    }

    return `${location.site} / ${location.name}`
  }, [])

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
    setPostDutyPoolWorking(getPostDutyPoolForMonth(data, ownersMonth))
    setOwnersEditMode(true)
    showSuccess(`${ownersMonth} ayı oda asistanları düzenleme modunda.`)
  }

  const cancelOwnersEdit = () => {
    setOwnersEditMode(false)
    setOwnersWorking({})
    setPostDutyPoolWorking([])
    setPostDutyPoolDraft('')
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

  const openPlannerWeeklyExport = () => {
    const anchorDay = hasIsoShape(activePlannerDay) ? activePlannerDay : todayISO
    const weekStart = toISODate(startOfISOWeek(fromISODate(anchorDay)))
    setPlannerWeeklyExportWeekStartISO(weekStart)
    setPlannerWeeklyExportOpen(true)
  }

  const closePlannerWeeklyExport = () => {
    setPlannerWeeklyExportOpen(false)
  }

  const shiftPlannerWeeklyExportWeek = (deltaWeeks: number) => {
    setPlannerWeeklyExportWeekStartISO((previous) =>
      toISODate(addDays(fromISODate(previous), deltaWeeks * 7)),
    )
  }

  const openAssistantMonthlyTable = () => {
    if (!isValidMonthISO(assistantTableMonthDraft)) {
      showWarning('Önce geçerli bir ay seçmelisin.')
      return
    }
    setAssistantTableMonthActive(assistantTableMonthDraft)
    setAssistantMonthlyTableOpen(true)
  }

  const applyAssistantMonthlyTableMonth = () => {
    if (!isValidMonthISO(assistantTableMonthDraft)) {
      showWarning('Geçerli bir ay seçmeden görüntüleyemezsin.')
      return
    }
    setAssistantTableMonthActive(assistantTableMonthDraft)
  }

  const closeAssistantMonthlyTable = () => {
    setAssistantMonthlyTableOpen(false)
  }

  const openObserverDutyList = () => {
    if (!isValidMonthISO(observerDutyMonthDraft)) {
      showWarning('Önce geçerli bir ay seçmelisin.')
      return
    }
    setObserverDutyMonthActive(observerDutyMonthDraft)
    setObserverDutyListOpen(true)
  }

  const applyObserverDutyMonth = () => {
    if (!isValidMonthISO(observerDutyMonthDraft)) {
      showWarning('Geçerli bir ay seçmeden görüntüleyemezsin.')
      return
    }
    setObserverDutyMonthActive(observerDutyMonthDraft)
  }

  const closeObserverDutyList = () => {
    setObserverDutyListOpen(false)
  }

  const refreshLoginEvents = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoginEventStats(EMPTY_LOGIN_EVENT_STATS)
      setLoginEventsStatusText('Bulut bağlantısı olmadığı için giriş kayıtları okunamadı.')
      showWarning('Giriş kayıtlarını görmek için Supabase bağlantısı gerekli.')
      return
    }
    const loginEventsClient = supabase
    if (isSupabaseAdminAuthRequired && !isSecureCloudWriteUnlocked) {
      setLoginEventStats(EMPTY_LOGIN_EVENT_STATS)
      setLoginEventsStatusText('Giriş kayıtlarını görmek için güvenli admin girişi gerekli.')
      showWarning('Giriş kayıtları güvenli modda sadece Supabase admin oturumu ile okunabilir.')
      return
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    setIsLoginEventsLoading(true)
    setLoginEventsStatusText('Giriş kayıtları yükleniyor...')

    const [lastEntriesResult, totalCountResult, todayRowsResult, todayCountResult] = await Promise.all([
      loginEventsClient
        .from(LOGIN_EVENTS_TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      loginEventsClient.from(LOGIN_EVENTS_TABLE).select('id', { count: 'exact', head: true }),
      loginEventsClient
        .from(LOGIN_EVENTS_TABLE)
        .select('*')
        .gte('created_at', todayStart.toISOString())
        .lt('created_at', tomorrowStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(500),
      loginEventsClient
        .from(LOGIN_EVENTS_TABLE)
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())
        .lt('created_at', tomorrowStart.toISOString()),
    ])

    const readError =
      lastEntriesResult.error ?? totalCountResult.error ?? todayRowsResult.error ?? todayCountResult.error
    if (readError) {
      setIsLoginEventsLoading(false)
      setLoginEventStats(EMPTY_LOGIN_EVENT_STATS)
      setLoginEventsStatusText(`Giriş kayıtları okunamadı: ${readError.message}`)
      showWarning('Giriş kayıtları okunamadı. Supabase login_events tablosu ve izinlerini kontrol et.')
      return
    }

    const lastRows = (lastEntriesResult.data ?? []) as LoginEventRawRow[]
    const todayRows = (todayRowsResult.data ?? []) as LoginEventRawRow[]
    const connectionColumnVisible = [...lastRows, ...todayRows].some((row) =>
      Object.prototype.hasOwnProperty.call(row, 'ip_hash'),
    )
    const lastEntries = lastRows
      .map((row) => ({
        id: Number(row.id),
        personName: String(row.person_name ?? '').trim(),
        createdAt: String(row.created_at ?? ''),
        ipHash: typeof row.ip_hash === 'string' && row.ip_hash ? row.ip_hash : null,
      }))
      .filter((entry) => entry.personName && entry.createdAt)

    const todayDistinctNames = uniqueSortedNames(todayRows.map((row) => String(row.person_name ?? '')))
    const todayConnectionMap = new Map<string, { names: string[]; loginCount: number }>()
    todayRows.forEach((row) => {
      const ipHash = typeof row.ip_hash === 'string' ? row.ip_hash : ''
      const personName = String(row.person_name ?? '').trim()
      if (!ipHash || !personName) {
        return
      }
      const current = todayConnectionMap.get(ipHash) ?? { names: [], loginCount: 0 }
      current.names.push(personName)
      current.loginCount += 1
      todayConnectionMap.set(ipHash, current)
    })
    const todayConnectionGroups = [...todayConnectionMap.entries()]
      .map(([connectionHash, value]) => ({
        connectionHash,
        assistantNames: uniqueSortedNames(value.names),
        loginCount: value.loginCount,
      }))
      .filter((group) => group.assistantNames.length > 1)
      .sort((a, b) => b.assistantNames.length - a.assistantNames.length || b.loginCount - a.loginCount)

    setLoginEventStats({
      totalCount: totalCountResult.count ?? lastEntries.length,
      todayTotalCount: todayCountResult.count ?? todayRows.length,
      todayDistinctNames,
      todayConnectionGroups,
      lastEntries,
    })
    setLoginEventsStatusText(
      !connectionColumnVisible && (lastRows.length > 0 || todayRows.length > 0)
        ? 'Giriş kayıtları okundu. Aynı bağlantı analizi için Supabase SQL içinde ip_hash kolonu eklenmeli.'
        : 'Giriş kayıtları güncellendi.',
    )
    setIsLoginEventsLoading(false)
  }

  const refreshBackups = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setBackupEntries([])
      setBackupStatusText('Bulut bağlantısı olmadığı için yedekler okunamadı.')
      showWarning('Yedekleri görmek için Supabase bağlantısı gerekli.')
      return
    }
    if (!isSecureCloudWriteUnlocked) {
      setBackupEntries([])
      setBackupStatusText('Yedekleri görmek için güvenli admin girişi gerekli.')
      showWarning('Yedekler güvenli modda sadece Supabase admin oturumu ile okunabilir.')
      return
    }

    setIsBackupLoading(true)
    setBackupStatusText('Yedekler yükleniyor...')
    const { data: rows, error } = await supabase
      .from(REMOTE_STATE_HISTORY_TABLE)
      .select('id, saved_at, source, payload')
      .order('saved_at', { ascending: false })
      .limit(30)

    if (error) {
      setIsBackupLoading(false)
      setBackupStatusText('Yedek listesi okunamadı.')
      showWarning('Yedek listesi okunamadı. Supabase history tablosu ve izinlerini kontrol et.')
      return
    }

    const entries = (rows ?? [])
      .map((row) => summarizeBackupRow(row))
      .filter((entry): entry is BackupEntry => Boolean(entry))
    setBackupEntries(entries)
    setBackupStatusText(entries.length ? `${entries.length} yedek listelendi.` : 'Henüz yedek kaydı yok.')
    setIsBackupLoading(false)
  }

  const insertBackupSnapshot = async (
    source: string,
    payload: RemotePortalPayload = buildRemotePayload(data, userBindings),
  ): Promise<BackupInsertResult> => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, skipped: true, missingTable: false }
    }
    if (!isSecureCloudWriteUnlocked) {
      return { ok: false, skipped: true, missingTable: false }
    }

    const { error } = await supabase.from(REMOTE_STATE_HISTORY_TABLE).insert({
      state_id: REMOTE_STATE_ROW_ID,
      payload,
      saved_at: new Date().toISOString(),
      source,
    })

    if (error) {
      const message = `${error.message ?? ''} ${error.details ?? ''}`.toLocaleLowerCase('tr')
      return {
        ok: false,
        skipped: false,
        missingTable: message.includes('portal_state_history') || message.includes('schema cache'),
      }
    }

    return { ok: true, skipped: false, missingTable: false }
  }

  const createPreChangeBackup = async (source: string, throttleKey = source, force = false) => {
    if (!isSupabaseConfigured || !supabase || !cloudCanWriteRef.current) {
      return true
    }

    const nowMs = Date.now()
    const lastBackupAt = preChangeBackupLastAtRef.current[throttleKey] ?? 0
    if (!force && nowMs - lastBackupAt < PRE_CHANGE_BACKUP_MIN_INTERVAL_MS) {
      return true
    }

    const result = await insertBackupSnapshot(source)
    if (!result.ok) {
      if (result.missingTable) {
        showWarning('Yedek tablosu henüz kurulu değil. Kayıt devam edecek; yedek sistemi için Supabase SQL kurulumu gerekli.')
        return true
      }
      showWarning('Otomatik güvenlik yedeği alınamadı. Kayıt devam edecek ama Yedekler modülünü kontrol et.')
      return true
    }

    preChangeBackupLastAtRef.current = {
      ...preChangeBackupLastAtRef.current,
      [throttleKey]: nowMs,
    }

    return true
  }

  const createManualBackup = async () => {
    if (!isSupabaseConfigured || !supabase) {
      showWarning('Manuel yedek için Supabase bağlantısı gerekli.')
      return
    }
    if (!isSecureCloudWriteUnlocked) {
      showWarning('Manuel yedek almak için güvenli Supabase admin girişi gerekli.')
      return
    }

    setIsBackupLoading(true)
    const result = await insertBackupSnapshot('manual-backup')

    if (!result.ok) {
      setIsBackupLoading(false)
      showWarning(
        result.missingTable
          ? 'Manuel yedek alınamadı. Supabase SQL ekranında portal_state_history tablosunu kurmalısın.'
          : 'Manuel yedek alınamadı. Supabase history tablosunu kontrol et.',
      )
      return
    }

    showSuccess('Manuel yedek alındı.')
    await refreshBackups()
  }

  const restoreBackup = async (backupId: number) => {
    if (!isSupabaseConfigured || !supabase) {
      showWarning('Geri yükleme için Supabase bağlantısı gerekli.')
      return
    }
    if (!isSecureCloudWriteUnlocked) {
      showWarning('Yedek geri yüklemek için güvenli Supabase admin girişi gerekli.')
      return
    }
    const backup = backupEntries.find((entry) => entry.id === backupId)
    if (!backup) {
      showWarning('Geri yüklenecek yedek bulunamadı.')
      return
    }
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `${new Date(backup.savedAt).toLocaleString('tr-TR')} tarihli yedeği geri yüklemek istediğine emin misin? Mevcut yayın verisi bu yedekle değişir. İşlem öncesi mevcut online verinin ayrı yedeği alınacak.`,
      )
    ) {
      return
    }
    if (typeof window !== 'undefined') {
      const typedApproval = window.prompt(
        'Yanlış tıklamayı önlemek için devam etmek istiyorsan YEDEGE DON yaz.',
      )
      if (typedApproval?.trim().toLocaleUpperCase('tr') !== 'YEDEGE DON') {
        showWarning('Yedek geri yükleme iptal edildi.')
        return
      }
    }

    const fallback = buildFallbackState()
    const restoredState =
      backup.payload.plannerState && typeof backup.payload.plannerState === 'object'
        ? sanitizePlannerState(backup.payload.plannerState as Partial<PlannerState>, fallback)
        : fallback
    const restoredBindings = sanitizeUserBindings(backup.payload.userBindings)
    const restoredPayload = buildRemotePayload(restoredState, restoredBindings)
    const nextUpdatedAt = new Date().toISOString()

    setIsBackupLoading(true)
    const { data: remoteRow, error: remoteReadError } = await supabase
      .from(REMOTE_STATE_TABLE)
      .select('payload, updated_at')
      .eq('id', REMOTE_STATE_ROW_ID)
      .maybeSingle()

    if (remoteReadError || !remoteRow) {
      setIsBackupLoading(false)
      showWarning('Geri yükleme durduruldu. Mevcut online veri okunamadı.')
      return
    }

    const remoteUpdatedAt =
      typeof remoteRow.updated_at === 'string' && remoteRow.updated_at ? remoteRow.updated_at : null
    const knownRevision = cloudRevisionRef.current
    if (knownRevision && remoteUpdatedAt && knownRevision !== remoteUpdatedAt) {
      cloudCanWriteRef.current = false
      setCloudState('error')
      setCloudStateText(CLOUD_CONFLICT_TEXT)
      setIsBackupLoading(false)
      showWarning('Online veri bu ekrandan sonra değişmiş. Geri yükleme durduruldu; sayfayı yenileyip tekrar dene.')
      return
    }

    const currentRemotePayload =
      remoteRow.payload && typeof remoteRow.payload === 'object'
        ? (remoteRow.payload as RemotePortalPayload)
        : buildRemotePayload(data, userBindings)
    const preRestoreBackup = await insertBackupSnapshot(`before-restore-${backup.id}`, currentRemotePayload)
    if (!preRestoreBackup.ok) {
      setIsBackupLoading(false)
      showWarning(
        preRestoreBackup.missingTable
          ? 'Geri yükleme durduruldu. Önce Supabase SQL ekranında portal_state_history tablosunu kurmalısın.'
          : 'Geri yükleme öncesi güvenlik yedeği alınamadı. İşlem durduruldu.',
      )
      return
    }

    const updateBase = supabase
      .from(REMOTE_STATE_TABLE)
      .update({
        payload: restoredPayload,
        updated_at: nextUpdatedAt,
      })
      .eq('id', REMOTE_STATE_ROW_ID)
    const guardedUpdate = remoteUpdatedAt ? updateBase.eq('updated_at', remoteUpdatedAt) : updateBase
    const { data: updatedRows, error } = await guardedUpdate.select('updated_at')

    if (error) {
      setIsBackupLoading(false)
      showWarning('Yedek geri yüklenemedi. Bulut kaydı güncellenemedi.')
      return
    }

    const restoredUpdatedAt =
      Array.isArray(updatedRows) && typeof updatedRows[0]?.updated_at === 'string'
        ? updatedRows[0].updated_at
        : nextUpdatedAt

    await supabase.from(REMOTE_STATE_HISTORY_TABLE).insert({
      state_id: REMOTE_STATE_ROW_ID,
      payload: restoredPayload,
      saved_at: restoredUpdatedAt,
      source: `restore-${backup.id}`,
    })

    const syncedPayload = JSON.stringify(restoredPayload)
    cloudPayloadRef.current = syncedPayload
    cloudRevisionRef.current = restoredUpdatedAt
    cloudHydratedRef.current = true
    cloudCanWriteRef.current = true
    setData(restoredState)
    setUserBindings(restoredBindings)
    setCloudState('ready')
    setCloudStateText(isCloudWriteEnabled ? 'Bulut kaydı aktif.' : CLOUD_READ_ONLY_TEXT)
    setCloudLastSavedAt(restoredUpdatedAt)
    setIsBackupLoading(false)
    showSuccess('Seçilen yedek geri yüklendi.')
    await refreshBackups()
  }

  const saveOwnersMonth = async () => {
    if (!ownersEditMode) {
      return
    }
    if (!isValidMonthISO(ownersMonth)) {
      showWarning('Kaydetmek için geçerli bir ay seçmelisin.')
      return
    }
    if (!(await createPreChangeBackup(`before-owners-save-${ownersMonth}`, 'owners-save'))) {
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
        postDutyPoolByMonth: {
          ...previous.postDutyPoolByMonth,
          [ownersMonth]: uniqueSortedNames(
            postDutyPoolWorking.filter((name) => previous.assistants.includes(name)),
          ),
        },
      }
    })

    setOwnersEditMode(false)
    setPostDutyPoolDraft('')
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

  const addPostDutyPoolAssistant = () => {
    if (!ownersEditMode) {
      showWarning('Nöbet ertesiciler listesini değiştirmek için önce "Değiştir" butonuna bas.')
      return
    }

    const candidate = postDutyPoolDraft.trim()
    if (!candidate) {
      showWarning('Nöbet ertesiciler listesi için bir kişi seç.')
      return
    }
    if (!data.assistants.includes(candidate)) {
      showWarning(`${candidate} asistan listesinde yok.`)
      return
    }
    if (postDutyPoolWorking.includes(candidate)) {
      showWarning(`${candidate} zaten ${ownersMonth} ayı nöbet ertesiciler listesinde.`)
      return
    }

    setPostDutyPoolWorking((previous) => uniqueSortedNames([...previous, candidate]))
    setPostDutyPoolDraft('')
    showSuccess(`${candidate} ${ownersMonth} ayı nöbet ertesiciler listesine eklendi.`)
  }

  const removePostDutyPoolAssistant = (assistantName: string) => {
    if (!ownersEditMode) {
      showWarning('Silmek için önce "Değiştir" butonuna bas.')
      return
    }

    setPostDutyPoolWorking((previous) => previous.filter((name) => name !== assistantName))
    showSuccess(`${assistantName} ${ownersMonth} ayı nöbet ertesiciler listesinden çıkarıldı.`)
  }

  const addAssistant = () => {
    const candidate = normalizeAssistantName(assistantInput)
    if (!candidate) {
      showWarning('Lütfen eklenecek asistan adını gir.')
      return
    }

    setData((previous) => {
      const hasDuplicate = previous.assistants.some(
        (assistant) => assistant.toLocaleLowerCase('tr') === candidate.toLocaleLowerCase('tr'),
      )
      if (hasDuplicate) {
        showWarning(`${candidate} zaten listede var.`)
        return previous
      }

      const nextAssistants = uniqueSortedNames([...previous.assistants, candidate])
      const nextAssistantRanks = compactAssistantRanks(nextAssistants, {
        ...previous.assistantRanks,
        [candidate]: toSafeSeniorityLevel(assistantRankInput, 1),
      })

      showSuccess(`${candidate} ${assistantRankInput}. kıdem olarak eklendi.`)
      return {
        ...previous,
        assistants: nextAssistants,
        assistantRanks: nextAssistantRanks,
      }
    })

    setAssistantInput('')
    setAssistantRankInput(1)
  }

  const addLocation = () => {
    const candidateName = newLocationName.trim()
    if (!DUTY_SITES.includes(newLocationSite)) {
      showWarning('Alan sadece Sancaktepe, Feriha Öz veya Çekmeköy için eklenebilir.')
      return
    }
    if (!candidateName) {
      showWarning('Lütfen alan adını gir.')
      return
    }
    if (ownersEditMode) {
      showWarning('Alan eklemek için önce oda asistanı düzenlemesini Kaydet veya İptal et.')
      return
    }

    setData((previous) => {
      const hasSameLocation = previous.locations.some(
        (location) =>
          location.kind === 'normal' &&
          location.site === newLocationSite &&
          location.name.trim().toLocaleLowerCase('tr') === candidateName.toLocaleLowerCase('tr'),
      )
      if (hasSameLocation) {
        showWarning(`${newLocationSite} için "${candidateName}" zaten mevcut.`)
        return previous
      }

      const nextLocation: WorkLocation = withResolvedTone({
        id: buildUniqueLocationId(newLocationSite, candidateName, previous.locations),
        site: newLocationSite,
        name: candidateName,
        kind: 'normal',
        tone: 'sand',
        order:
          previous.locations.filter(
            (location) =>
              location.kind === 'normal' &&
              location.site === newLocationSite &&
              isLocationActiveOnDay(location, todayISO),
          ).length + 1,
        orderHistory: [
          {
            from: todayISO,
            value:
              previous.locations.filter(
                (location) =>
                  location.kind === 'normal' &&
                  location.site === newLocationSite &&
                  isLocationActiveOnDay(location, todayISO),
              ).length + 1,
          },
        ],
        activeFrom: todayISO,
        activeUntil: null,
      })

      const nextLocations = normalizeAndSortLocations([...previous.locations, nextLocation])
      const nextLocationOwners = {
        ...previous.locationOwners,
        [nextLocation.id]: [],
      }

      const months = Object.keys(previous.locationOwnersByMonth).length
        ? previous.locationOwnersByMonth
        : { [currentMonthISO]: previous.locationOwners }
      const nextLocationOwnersByMonth = Object.fromEntries(
        Object.entries(months).map(([monthISO, owners]) => [
          monthISO,
          {
            ...owners,
            [nextLocation.id]: owners[nextLocation.id] ?? [],
          },
        ]),
      )

      showSuccess(`${newLocationSite} / ${candidateName} alanı eklendi.`)
      return {
        ...previous,
        locations: nextLocations,
        locationOwners: nextLocationOwners,
        locationOwnersByMonth: nextLocationOwnersByMonth,
      }
    })

    setNewLocationName('')
  }

  const removeLocation = (locationId: string) => {
    if (ownersEditMode) {
      showWarning('Alan silmek için önce oda asistanı düzenlemesini Kaydet veya İptal et.')
      return
    }

    setData((previous) => {
      const target = previous.locations.find((location) => location.id === locationId)
      if (!target || target.kind !== 'normal') {
        return previous
      }

      if (
        typeof window !== 'undefined' &&
        !window.confirm(
          `${target.site} / ${target.name} alanını ${todayISO} ve sonrası için kapatmak istediğine emin misin?`,
        )
      ) {
        return previous
      }

      if (
        target.activeUntil &&
        hasIsoShape(target.activeUntil) &&
        target.activeUntil <= todayISO
      ) {
        showWarning(`${target.site} / ${target.name} alanı zaten kapatılmış.`)
        return previous
      }

      const nextLocations = normalizeAndSortLocations(
        previous.locations.map((location) =>
          location.id === locationId
            ? {
                ...location,
                activeUntil: todayISO,
              }
            : location,
        ),
      )

      showSuccess(
        `${target.site} / ${target.name} alanı ${todayISO} ve sonrasına kapatıldı. Önceki tarihlerde görünmeye devam eder.`,
      )
      return {
        ...previous,
        locations: nextLocations,
      }
    })

    setOwnerSelectionDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([draftKey]) => !draftKey.endsWith(`-${locationId}`)),
      ),
    )
    setCellDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([draftKey]) => !draftKey.endsWith(`-${locationId}`)),
      ),
    )
  }

  const updateLocationOrder = (locationId: string, rawOrder: string) => {
    const parsedOrder = Math.floor(Number(rawOrder))
    if (!Number.isFinite(parsedOrder) || parsedOrder < 1) {
      showWarning('Sıra numarası 1 veya daha büyük olmalı.')
      return
    }

    setData((previous) => {
      const target = previous.locations.find((location) => location.id === locationId)
      if (!target || target.kind !== 'normal') {
        return previous
      }

      const siteLocations = sortLocationsForState(previous.locations).filter(
        (location) =>
          location.kind === 'normal' &&
          location.site === target.site &&
          isLocationActiveOnDay(location, todayISO),
      )
      const currentIndex = siteLocations.findIndex((location) => location.id === locationId)
      if (currentIndex === -1) {
        return previous
      }

      const clampedOrder = Math.min(parsedOrder, siteLocations.length)
      const targetIndex = clampedOrder - 1
      if (currentIndex === targetIndex) {
        return previous
      }

      const reorderedSiteLocations = [...siteLocations]
      const [moved] = reorderedSiteLocations.splice(currentIndex, 1)
      reorderedSiteLocations.splice(targetIndex, 0, moved)

      const siteOrderMap = new Map(
        reorderedSiteLocations.map((location, index) => [location.id, index + 1]),
      )
      const nextLocations = normalizeAndSortLocations(
        previous.locations.map((location) =>
          location.kind === 'normal' &&
          location.site === target.site &&
          isLocationActiveOnDay(location, todayISO)
            ? setLocationOrderFromDay(location, todayISO, siteOrderMap.get(location.id) ?? location.order ?? 1)
            : location,
        ),
      )

      showSuccess(`${target.site} alan sırası ${todayISO} ve sonrasına güncellendi.`)
      return {
        ...previous,
        locations: nextLocations,
      }
    })
  }

  const removeAssistant = (name: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `${name} isimli asistanı listeden çıkarmak istediğine emin misin? Bu işlem atama ve nöbet kayıtlarından da temizler.`,
      )
    ) {
      return
    }

    setData((previous) => {
      const remainingAssistants = previous.assistants.filter((assistant) => assistant !== name)
      const nextAssistantRanks = compactAssistantRanks(
        remainingAssistants,
        Object.fromEntries(
          Object.entries(previous.assistantRanks).filter(([assistantName]) => assistantName !== name),
        ) as AssistantRanks,
      )
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
      const nextPostDutyPoolByMonth = Object.fromEntries(
        Object.entries(previous.postDutyPoolByMonth).map(([monthISO, names]) => [
          monthISO,
          uniqueSortedNames((names ?? []).filter((assistantName) => assistantName !== name)),
        ]),
      )

      showSuccess(`${name} listeden çıkarıldı.`)
      return {
        ...previous,
        assistants: remainingAssistants,
        assistantRanks: nextAssistantRanks,
        locationOwners: nextOwners,
        locationOwnersByMonth: nextOwnersByMonth,
        postDutyPoolByMonth: nextPostDutyPoolByMonth,
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

  const importDutyQuickLines = async () => {
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

    const issueMessages = [...issueMessagesFromParser]
    if (!(await createPreChangeBackup(`before-duty-import-${dutyMonth}`, 'duty-import', true))) {
      return
    }

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

  const importSpecialistWorkLines = async () => {
    const fallbackYear = today.getFullYear()
    const parsed = parseSpecialistWorkQuickLines(specialistWorkText, fallbackYear, data.locations)
    const issueMessages = parsed.issues.map(
      (issue) => `${issue.lineNumber}. satır: ${issue.message} (${issue.rawLine})`,
    )
    const parsedDayKeys = Object.keys(parsed.data).sort()

    if (!parsed.totalNames) {
      setSpecialistWorkIssues(issueMessages)
      showWarning(
        'Geçerli uzman satırı bulunamadı. Örnek: 27 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe Ameliyathane 1',
      )
      return
    }

    if (issueMessages.length) {
      setSpecialistWorkIssues([
        ...issueMessages,
        'Format uyarısı olduğu için günlük çalışma kayıtları uygulanmadı.',
      ])
      showWarning('Format uyarısı var. Güvenlik için günlük çalışma uzman listesi uygulanmadı.')
      return
    }

    const approved = window.confirm(
      `${parsedDayKeys.length} güne ait ${parsed.totalNames} günlük çalışma uzman kaydı mevcut kayıtlarla birleştirilecek. Onaylıyor musun?`,
    )
    if (!approved) {
      setSpecialistWorkIssues(['Günlük çalışma aktarımı onaylanmadı. Kayıt yapılmadı.'])
      showWarning('Günlük çalışma uzman aktarımı iptal edildi.')
      return
    }

    if (!(await createPreChangeBackup('before-specialist-work-import', 'specialist-work-import', true))) {
      return
    }

    setData((previous) => {
      const nextWorkAssignments = { ...previous.specialistWorkAssignments }
      parsedDayKeys.forEach((dayKey) => {
        const currentDayMap = cloneSpecialistWorkDayAssignments(nextWorkAssignments[dayKey])
        Object.entries(parsed.data[dayKey] ?? {}).forEach(([locationId, specialistNames]) => {
          currentDayMap[locationId] = uniqueSortedNames([
            ...(currentDayMap[locationId] ?? []),
            ...specialistNames,
          ])
        })

        if (Object.keys(currentDayMap).length) {
          nextWorkAssignments[dayKey] = currentDayMap
        } else {
          delete nextWorkAssignments[dayKey]
        }
      })

      return {
        ...previous,
        specialistWorkAssignments: nextWorkAssignments,
      }
    })

    setSpecialistWorkIssues([])
    setSpecialistWorkText('')
    showSuccess(`${parsedDayKeys.length} güne ait ${parsed.totalNames} günlük çalışma uzman kaydı uygulandı.`)
  }

  const importSpecialistDutyLines = async () => {
    const fallbackYear = today.getFullYear()
    const parsed = parseSpecialistDutyQuickLines(specialistDutyText, fallbackYear)
    const issueMessages = parsed.issues.map(
      (issue) => `${issue.lineNumber}. satır: ${issue.message} (${issue.rawLine})`,
    )
    const parsedDayKeys = Object.keys(parsed.data).sort()

    if (!parsed.totalNames) {
      setSpecialistDutyIssues(issueMessages)
      showWarning(
        'Geçerli nöbetçi uzman satırı bulunamadı. Örnek: 1 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe',
      )
      return
    }

    if (issueMessages.length) {
      setSpecialistDutyIssues([
        ...issueMessages,
        'Format uyarısı olduğu için nöbetçi uzman kayıtları uygulanmadı.',
      ])
      showWarning('Format uyarısı var. Güvenlik için nöbetçi uzman listesi uygulanmadı.')
      return
    }

    const approved = window.confirm(
      `${parsedDayKeys.length} güne ait ${parsed.totalNames} nöbetçi uzman kaydı uygulanacak. Bu günlerdeki eski nöbetçi uzman kayıtları yeni listeyle değiştirilsin mi?`,
    )
    if (!approved) {
      setSpecialistDutyIssues(['Nöbetçi uzman aktarımı onaylanmadı. Kayıt yapılmadı.'])
      showWarning('Nöbetçi uzman aktarımı iptal edildi.')
      return
    }

    if (!(await createPreChangeBackup('before-specialist-duty-import', 'specialist-duty-import', true))) {
      return
    }

    setData((previous) => {
      const nextDutyRoster = { ...previous.specialistDutyRoster }
      parsedDayKeys.forEach((dayKey) => {
        const normalizedEntries = cloneSpecialistDutyDayAssignments(parsed.data[dayKey])
        if (normalizedEntries.length) {
          nextDutyRoster[dayKey] = normalizedEntries
        } else {
          delete nextDutyRoster[dayKey]
        }
      })

      return {
        ...previous,
        specialistDutyRoster: nextDutyRoster,
      }
    })

    setSpecialistDutyIssues([])
    setSpecialistDutyText('')
    showSuccess(`${parsedDayKeys.length} güne ait ${parsed.totalNames} nöbetçi uzman kaydı uygulandı.`)
  }

  const startPlannerDayEdit = (dayKey: string) => {
    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: cloneDayLocationAssignments(
        previous[dayKey] ?? data.manualAssignments[dayKey],
      ),
    }))
    setPlannerEditModes((previous) => ({
      ...previous,
      [dayKey]: true,
    }))
    showSuccess(`${dayKey} planı düzenlemeye açıldı.`)
  }

  const cancelPlannerDayEdit = (dayKey: string) => {
    setPlannerEditModes((previous) => {
      const next = { ...previous }
      delete next[dayKey]
      return next
    })
    setPlannerDraftAssignments((previous) => {
      const next = { ...previous }
      delete next[dayKey]
      return next
    })
    setOwnerSelectionDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([draftKey]) => !draftKey.startsWith(`${dayKey}-`)),
      ),
    )
    showWarning(`${dayKey} için taslak değişiklikler iptal edildi.`)
  }

  const savePlannerDay = async (dayKey: string) => {
    if (!isPlannerDayInEditMode(dayKey)) {
      showWarning('Kaydetmek için önce Değiştir ile düzenlemeyi aç.')
      return
    }

    const dayDraftAssignments = cloneDayLocationAssignments(
      plannerDraftAssignments[dayKey] ?? data.manualAssignments[dayKey],
    )
    if (!(await createPreChangeBackup(`before-planner-day-save-${dayKey}`, 'planner-day-save'))) {
      return
    }

    setData((previous) => {
      const nextManualAssignments = {
        ...previous.manualAssignments,
        [dayKey]: dayDraftAssignments,
      }
      const sanitized = sanitizeManualAssignments(
        nextManualAssignments,
        previous.dutyRoster,
        previous.locations,
      )

      if (sanitized.removedCount > 0) {
        showWarning(
          `${dayKey} kaydedildi. Kural nedeniyle ${sanitized.removedCount} atama temizlendi.`,
        )
      } else {
        showSuccess(`${dayKey} kaydedildi ve sisteme yayınlandı.`)
      }

      return {
        ...previous,
        manualAssignments: sanitized.manualAssignments,
      }
    })

    setPlannerEditModes((previous) => {
      const next = { ...previous }
      delete next[dayKey]
      return next
    })
    setPlannerDraftAssignments((previous) => {
      const next = { ...previous }
      delete next[dayKey]
      return next
    })
    setOwnerSelectionDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([draftKey]) => !draftKey.startsWith(`${dayKey}-`)),
      ),
    )
  }

  const addAssignment = (dayKey: string, locationId: string) => {
    if (!ensurePlannerDayInEditMode(dayKey)) {
      return
    }

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

    const plannerState = getPlannerStateForDay(dayKey)
    const location = plannerState.locations.find((item) => item.id === locationId)
    if (!location) {
      return
    }
    const workingDay = isRoomAssignableDay(fromISODate(dayKey))

    if (!EDITABLE_KINDS.has(location.kind)) {
      showWarning(`${location.name} alanı otomatik yönetiliyor, manuel atama kapalı.`)
      return
    }
    if (!workingDay && (location.kind === 'normal' || location.kind === 'leave')) {
      showWarning(
        `${location.site} / ${location.name} sadece hafta içi veya yarım gün resmi tatillerde atanabilir.`,
      )
      return
    }

    const dayAssignments = cloneDayLocationAssignments(plannerState.manualAssignments[dayKey])
    const currentNames = dayAssignments[locationId] ?? []
    if (currentNames.includes(candidate)) {
      showWarning(`${candidate} zaten bu alanda görünüyor.`)
      return
    }

    if (location.kind === 'normal') {
      const blockedStatusLocation = plannerState.locations.find((item) => {
        if (item.kind === 'normal' || item.kind === 'duty') {
          return false
        }
        return getAssignmentsForLocation(plannerState, dayKey, item).includes(candidate)
      })
      if (blockedStatusLocation) {
        showWarning(
          `${candidate} ${blockedStatusLocation.site} / ${blockedStatusLocation.name} durumunda olduğu için odaya yazılamaz.`,
        )
        return
      }

      const occupiedNormalLocation = plannerState.locations.find((item) => {
        if (item.kind !== 'normal' || item.id === location.id) {
          return false
        }
        return getAssignmentsForLocation(plannerState, dayKey, item).includes(candidate)
      })
      if (occupiedNormalLocation) {
        const confirmed =
          typeof window !== 'undefined' &&
          window.confirm(
            `${candidate} bugün zaten ${occupiedNormalLocation.site} / ${occupiedNormalLocation.name} alanında görünüyor.\n\n` +
              `${location.site} / ${location.name} alanına ikinci oda olarak da eklemek istiyor musun?`,
          )
        if (!confirmed) {
          showWarning(`${candidate} ikinci odaya eklenmedi.`)
          return
        }
      }
    } else {
      const existing = findAssignedLocationForPerson(plannerState, dayKey, candidate, locationId)
      if (existing) {
        showWarning(
          `${candidate} aynı gün sadece bir yerde olabilir. Şu an: ${existing.site} / ${existing.name}`,
        )
        return
      }
    }

    dayAssignments[locationId] = uniqueSortedNames([...currentNames, candidate])
    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: dayAssignments,
    }))
    showSuccess(
      `${candidate} -> ${location.site} / ${location.name} (${dayKey}) taslağa eklendi. Kaydet ile yayınla.`,
    )

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
    if (!ensurePlannerDayInEditMode(dayKey)) {
      return
    }

    const draftKey = `${dayKey}-${locationId}`
    const selectedOwners = uniqueSortedNames(ownerSelectionDrafts[draftKey] ?? [])
    if (!selectedOwners.length) {
      showWarning('Önce oda asistanı seçeneklerinden en az bir kişi seç.')
      return
    }

    const plannerState = getPlannerStateForDay(dayKey)
    const location = plannerState.locations.find((item) => item.id === locationId)
    if (!location || location.kind !== 'normal') {
      return
    }
    if (!isRoomAssignableDay(fromISODate(dayKey))) {
      showWarning(`${location.site} / ${location.name} hafta sonu veya tam gün resmi tatilde planlanamaz.`)
      return
    }

    const dayAssignments = cloneDayLocationAssignments(plannerState.manualAssignments[dayKey])
    const currentNames = dayAssignments[locationId] ?? []
    const nextNames = [...currentNames]
    const blockedByStatus: string[] = []
    const blockedByRoom: string[] = []
    let addedCount = 0

    selectedOwners.forEach((owner) => {
      if (nextNames.includes(owner)) {
        return
      }

      const blockedStatusLocation = plannerState.locations.find((item) => {
        if (item.kind === 'normal' || item.kind === 'duty') {
          return false
        }
        return getAssignmentsForLocation(plannerState, dayKey, item).includes(owner)
      })
      if (blockedStatusLocation) {
        blockedByStatus.push(owner)
        return
      }

      const occupiedRoom = plannerState.locations.find((item) => {
        if (item.kind !== 'normal' || item.id === locationId) {
          return false
        }
        return getAssignmentsForLocation(plannerState, dayKey, item).includes(owner)
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
      return
    }

    dayAssignments[locationId] = uniqueSortedNames(nextNames)
    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: dayAssignments,
    }))

    if (blockedByStatus.length || blockedByRoom.length) {
      showWarning(
        `${dayKey} taslağına ${addedCount} kişi eklendi. Atlananlar: ${
          blockedByStatus.length ? `durum engeli ${blockedByStatus.join(', ')}` : ''
        } ${blockedByRoom.length ? `oda çakışması ${blockedByRoom.join(', ')}` : ''}`.trim(),
      )
    } else {
      showSuccess(`${dayKey} taslağına ${addedCount} oda asistanı eklendi. Kaydet ile yayınla.`)
    }

    setOwnerSelectionDrafts((previous) => ({
      ...previous,
      [draftKey]: [],
    }))
  }

  const removeAssignment = (dayKey: string, locationId: string, name: string) => {
    if (!ensurePlannerDayInEditMode(dayKey)) {
      return
    }

    const plannerState = getPlannerStateForDay(dayKey)
    const dayAssignments = cloneDayLocationAssignments(plannerState.manualAssignments[dayKey])
    dayAssignments[locationId] = (dayAssignments[locationId] ?? []).filter((item) => item !== name)
    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: dayAssignments,
    }))
    showSuccess(`${name} atamadan çıkarıldı. Kaydet ile yayınla.`)
  }

  const autoFillDay = (dayKey: string) => {
    if (!ensurePlannerDayInEditMode(dayKey)) {
      return
    }

    if (!isRoomAssignableDay(fromISODate(dayKey))) {
      showWarning('Bu gün hafta sonu veya tam gün resmi tatil. Oda varsayılanı yazılamaz.')
      return
    }

    const nextOwnerDrafts: Record<string, string[]> = {}
    const plannerState = getPlannerStateForDay(dayKey)
    const dayAssignments = cloneDayLocationAssignments(plannerState.manualAssignments[dayKey])
    const previousDay = toISODate(addDays(fromISODate(dayKey), -1))
    const monthOwners = getLocationOwnersForDay(plannerState, dayKey)

    const blocked = new Set<string>([
      ...dutyAssignmentsToNames(plannerState.dutyRoster[previousDay] ?? []),
    ])

    const normalLocations = plannerState.locations.filter((location) => location.kind === 'normal')
    const assignedToday = new Set<string>()

    plannerState.locations.forEach((location) => {
      if (location.kind === 'duty') {
        return
      }
      getAssignmentsForLocation(plannerState, dayKey, location).forEach((name) =>
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
          plannerState,
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
      return
    }

    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: dayAssignments,
    }))

    if (promptedRoomCount) {
      showSuccess(
        `${dayKey} taslağı için ${updatedCount} otomatik atama yapıldı. ${promptedRoomCount} odada birden fazla oda asistanı var; alttaki seçeneklerden işaretleyip onaylayabilirsin.`,
      )
    } else {
      showSuccess(
        `${dayKey} taslağı için ${updatedCount} odada varsayılan asistan yazıldı. Atlanan: oda asistanı yok ${skippedNoOwner}, müsait değil ${skippedBlocked}, başka yerde atanmış ${skippedAssigned}.`,
      )
    }

    if (Object.keys(nextOwnerDrafts).length) {
      setOwnerSelectionDrafts((previous) => ({
        ...previous,
        ...nextOwnerDrafts,
      }))
    }
  }

  const clearDayAssignments = (dayKey: string) => {
    if (!ensurePlannerDayInEditMode(dayKey)) {
      return
    }

    const plannerState = getPlannerStateForDay(dayKey)
    const dayAssignments = cloneDayLocationAssignments(plannerState.manualAssignments[dayKey])
    plannerState.locations
      .filter((location) => EDITABLE_KINDS.has(location.kind))
      .forEach((location) => {
        dayAssignments[location.id] = []
      })

    setPlannerDraftAssignments((previous) => ({
      ...previous,
      [dayKey]: dayAssignments,
    }))
    showSuccess(`${dayKey} için taslak manuel atamalar temizlendi. Kaydet ile yayınla.`)
  }

  const weekAssignmentsForPerson = useMemo(() => {
    if (!observerAssistant) {
      return []
    }

    return observerWeeklyDays.map((day) => {
      const locations = sortedLocations.filter((location) =>
        getAssignmentsForLocation(data, day.key, location).includes(observerAssistant),
      )
      const assignments = locations.map((location) => ({
        location,
        locationLabel: getWeeklyPersonLocationLabel(data, day.key, observerAssistant, location),
        specialistLabel: getSpecialistLabelForLocation(data, day.key, location),
      }))
      const dayTypeLabel = getDayTypeLabel(day.key)

      return {
        day,
        assignments,
        dayTypeLabel,
      }
    })
  }, [
    data,
    getSpecialistLabelForLocation,
    getWeeklyPersonLocationLabel,
    observerAssistant,
    observerWeeklyDays,
    sortedLocations,
  ])

  const weekAssignmentsForRoom = useMemo(() => {
    const room = sortedLocations.find((location) => location.id === observerWeekRoom)
    if (!room) {
      return []
    }

    return observerWeeklyDays.map((day) => {
      const names = getDisplayAssignmentsForLocation(data, day.key, room)
      const specialistNames = getSpecialistNamesForLocation(data, day.key, room)
      const specialistLabel = formatSpecialistWorkLabel(specialistNames)
      const dayTypeLabel = getDayTypeLabel(day.key)
      return {
        day,
        names,
        specialistLabel,
        dayTypeLabel,
      }
    })
  }, [data, getSpecialistNamesForLocation, observerWeekRoom, observerWeeklyDays, sortedLocations])

  const weekDutyAssignmentsForSite = useMemo(() => {
    return observerWeeklyDays.map((day) => {
      const specialistNames = sortSpecialistDutyAssignments(
        (data.specialistDutyRoster[day.key] ?? []).filter(
          (entry) => mapSpecialistDutySiteToDutySite(entry.site) === observerWeekDutySite,
        ),
      ).map(formatSpecialistDutyLabel)
      const names = sortDutyAssignments(
        (data.dutyRoster[day.key] ?? []).filter((entry) => entry.site === observerWeekDutySite),
        data.assistantRanks,
      ).map((entry) => entry.name)
      return {
        day,
        specialistNames,
        names,
      }
    })
  }, [data.assistantRanks, data.dutyRoster, data.specialistDutyRoster, observerWeekDutySite, observerWeeklyDays])

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
    () =>
      myWeekAssignments.filter((day) =>
        day.locations.some((location) => location.kind === 'normal' || location.kind === 'duty'),
      ).length,
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
  const myMonthlyOvertimeHours = useMemo(
    () =>
      myMonthlyDuties.reduce(
        (total, duty) => total + calculateDutyOvertimeHoursForDay(fromISODate(duty.dayKey)),
        0,
      ),
    [myMonthlyDuties],
  )

  const assistantTableMonthTitle = useMemo(() => {
    const [yearRaw, monthRaw] = assistantTableMonthActive.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return assistantTableMonthActive
    }
    return new Date(year, month - 1, 1).toLocaleDateString('tr-TR', {
      month: 'long',
      year: 'numeric',
    })
  }, [assistantTableMonthActive])
  const observerDutyMonthTitle = useMemo(() => {
    const [yearRaw, monthRaw] = observerDutyMonthActive.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return observerDutyMonthActive
    }
    return new Date(year, month - 1, 1).toLocaleDateString('tr-TR', {
      month: 'long',
      year: 'numeric',
    })
  }, [observerDutyMonthActive])
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
    Object.keys(data.specialistWorkAssignments).forEach((dayKey) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        months.add(dayKey.slice(0, 7))
      }
    })
    Object.keys(data.specialistDutyRoster).forEach((dayKey) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        months.add(dayKey.slice(0, 7))
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
  }, [
    currentMonthISO,
    data.dutyRoster,
    data.locationOwnersByMonth,
    data.manualAssignments,
    data.specialistDutyRoster,
    data.specialistWorkAssignments,
    myCalendarSelectedYear,
  ])

  useEffect(() => {
    if (!myCalendarMonthOptions.length) {
      return
    }
    const availableMonths = myCalendarMonthOptions.map((option) => option.value)
    if (!availableMonths.includes(observerMonth)) {
      setObserverMonth(availableMonths[availableMonths.length - 1] ?? currentMonthISO)
    }
  }, [currentMonthISO, myCalendarMonthOptions, observerMonth])

  useEffect(() => {
    if (!myCalendarMonthOptions.length) {
      return
    }
    const availableMonths = myCalendarMonthOptions.map((option) => option.value)
    if (!availableMonths.includes(assistantTableMonthDraft)) {
      const fallback = availableMonths[availableMonths.length - 1] ?? currentMonthISO
      setAssistantTableMonthDraft(fallback)
    }
    if (!availableMonths.includes(assistantTableMonthActive)) {
      const fallback = availableMonths[availableMonths.length - 1] ?? currentMonthISO
      setAssistantTableMonthActive(fallback)
    }
    if (!availableMonths.includes(observerDutyMonthDraft)) {
      const fallback = availableMonths[availableMonths.length - 1] ?? currentMonthISO
      setObserverDutyMonthDraft(fallback)
    }
    if (!availableMonths.includes(observerDutyMonthActive)) {
      const fallback = availableMonths[availableMonths.length - 1] ?? currentMonthISO
      setObserverDutyMonthActive(fallback)
    }
  }, [
    assistantTableMonthActive,
    assistantTableMonthDraft,
    currentMonthISO,
    myCalendarMonthOptions,
    observerDutyMonthActive,
    observerDutyMonthDraft,
  ])

  const assistantTableCalendarWeeks = useMemo<AssistantMonthlyCalendarCell[][]>(
    () => buildMonthCalendarGrid(assistantTableMonthActive),
    [assistantTableMonthActive],
  )
  const assistantTableCalendarDayMap = useMemo<Record<string, AssistantMonthlyCalendarDayData>>(() => {
    if (!loggedAssistantName) {
      return {}
    }

    const entries: Record<string, AssistantMonthlyCalendarDayData> = {}
    assistantTableCalendarWeeks.flat().forEach((cell) => {
      const dayKey = cell.key
      const locations = sortedLocations
        .filter(
          (location) =>
            location.kind !== 'duty' &&
            location.kind !== 'postDuty' &&
            getAssignmentsForLocation(data, dayKey, location).includes(loggedAssistantName),
        )
        .map((location) => ({
          label: `${location.site} / ${location.name}`,
          specialistLabel: getSpecialistLabelForLocation(data, dayKey, location),
        }))
      const duty = (data.dutyRoster[dayKey] ?? []).find((entry) => entry.name === loggedAssistantName) ?? null
      const previousDayKey = toISODate(addDays(fromISODate(dayKey), -1))
      const postDuty =
        (data.dutyRoster[previousDayKey] ?? []).find((entry) => entry.name === loggedAssistantName) ?? null
      entries[dayKey] = {
        dayTypeLabel: getDayTypeLabel(dayKey),
        holidayReason: getOfficialHolidayReason(dayKey),
        locations,
        dutySite: duty?.site ?? null,
        postDutySite: postDuty?.site ?? null,
      }
    })
    return entries
  }, [assistantTableCalendarWeeks, data, getSpecialistLabelForLocation, loggedAssistantName, sortedLocations])

  const adminDutyTableModel = useMemo(
    () =>
      buildDutyTableModel(
        data.dutyRoster,
        data.specialistDutyRoster,
        dutyMonth,
        data.assistantRanks,
      ),
    [data.assistantRanks, data.dutyRoster, data.specialistDutyRoster, dutyMonth],
  )
  const observerDutyTableModel = useMemo(
    () =>
      buildDutyTableModel(
        data.dutyRoster,
        data.specialistDutyRoster,
        observerDutyMonthActive,
        data.assistantRanks,
      ),
    [data.assistantRanks, data.dutyRoster, data.specialistDutyRoster, observerDutyMonthActive],
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
      roomAssignmentBlocked: !isRoomAssignableDay(date),
    }
  }, [activePlannerDay])
  const plannerWeeklyExportDays = useMemo<WeeklyRotaExportDay[]>(() => {
    const fullWeek = buildWeek(plannerWeeklyExportWeekStartISO)
    const workingDays = fullWeek.filter((day) => isRoomAssignableDay(fromISODate(day.key)))
    const daysForExport = workingDays.length ? workingDays : fullWeek
    return daysForExport.map((day) => ({
      key: day.key,
      label: fromISODate(day.key).toLocaleDateString('tr-TR', { weekday: 'short' }),
      shortDate: fromISODate(day.key).toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
      }),
    }))
  }, [plannerWeeklyExportWeekStartISO])

  const plannerWeeklyExportWeekLabel = useMemo(() => {
    if (!plannerWeeklyExportDays.length) {
      return plannerWeeklyExportWeekStartISO
    }
    const firstDay = fromISODate(plannerWeeklyExportDays[0].key)
    const lastDay = fromISODate(plannerWeeklyExportDays[plannerWeeklyExportDays.length - 1].key)
    const firstLabel = firstDay.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
    const lastLabel = lastDay.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
    return `${firstLabel} - ${lastLabel} haftası`
  }, [plannerWeeklyExportDays, plannerWeeklyExportWeekStartISO])

  const plannerWeeklyExportGroups = useMemo<WeeklyRotaExportGroup[]>(() => {
    const dayKeys = plannerWeeklyExportDays.map((day) => day.key)
    const isActiveAnyDay = (location: WorkLocation) =>
      dayKeys.some((dayKey) => isLocationActiveOnDay(location, dayKey))

    const buildRowModel = (location: WorkLocation): WeeklyRotaExportRow => ({
      id: location.id,
      unitLabel: getWeeklyExportUnitLabel(location),
      cells: plannerWeeklyExportDays.map((day) => ({
        names: sortAssistantNamesByRank(
          getAssignmentsForLocation(data, day.key, location),
          data.assistantRanks,
        ),
        specialists: getSpecialistNamesForLocation(data, day.key, location).map(
          (specialistName) => `Uzm: ${specialistName}`,
        ),
      })),
    })

    const normalLocationsBySite = (site: string) =>
      sortLocationsForState(
        data.locations.filter(
          (location) => location.kind === 'normal' && location.site === site && isActiveAnyDay(location),
        ),
        plannerWeeklyExportWeekStartISO,
      )

    const groups: WeeklyRotaExportGroup[] = [
      {
        id: 'sancaktepe',
        title: 'SANCAKTEPE',
        tone: 'sancak',
        rows: normalLocationsBySite('Sancaktepe').map(buildRowModel),
      },
      {
        id: 'cekmekoy',
        title: 'ÇEKMEKÖY',
        tone: 'cekmekoy',
        rows: normalLocationsBySite('Çekmeköy').map(buildRowModel),
      },
      {
        id: 'feriha-oz',
        title: 'FERİHA ÖZ',
        tone: 'feriha',
        rows: normalLocationsBySite('Feriha Öz').map(buildRowModel),
      },
    ]

    const leaveOrder = new Map<string, number>([
      [LEAVE_LOCATION_IDS.excuse, 1],
      [LEAVE_LOCATION_IDS.annual, 2],
      [LEAVE_LOCATION_IDS.rotation, 3],
    ])
    const leaveRows = data.locations
      .filter((location) => location.kind === 'leave' && isActiveAnyDay(location))
      .sort(
        (left, right) =>
          (leaveOrder.get(left.id) ?? 99) - (leaveOrder.get(right.id) ?? 99) ||
          left.name.localeCompare(right.name, 'tr'),
      )
      .map(buildRowModel)
    if (leaveRows.length) {
      groups.push({
        id: 'diger',
        title: 'İZİNLİ / ROT',
        tone: 'diger',
        rows: leaveRows,
      })
    }

    return groups.filter((group) => group.rows.length > 0)
  }, [data, getSpecialistNamesForLocation, plannerWeeklyExportDays, plannerWeeklyExportWeekStartISO])

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

              {DUTY_SITES.map((site) => {
                const specialistNames = row.bySite[site].filter((entry) => entry.kind === 'specialist')
                const assistantNames = row.bySite[site].filter((entry) => entry.kind === 'assistant')

                return (
                  <td
                    key={`${keyPrefix}-cell-${row.dayKey}-${site}`}
                    className={`site-col-cell site-col-${dutySiteClassName(site)}`}
                  >
                    {specialistNames.length || assistantNames.length ? (
                      <div className="duty-name-stack">
                        {specialistNames.length ? (
                          <div className="duty-specialist-row" aria-label={`${site} nöbetçi uzmanları`}>
                            {specialistNames.map((entry) => (
                              <span
                                key={`${keyPrefix}-specialist-${row.dayKey}-${site}-${entry.label}`}
                                className="duty-name-line specialist-duty-name-line"
                              >
                                {entry.label}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {assistantNames.length ? (
                          <div className="duty-assistant-row" aria-label={`${site} nöbetçi asistanları`}>
                            {assistantNames.map((entry) => (
                              <span
                                key={`${keyPrefix}-assistant-${row.dayKey}-${site}-${entry.label}`}
                                className="duty-name-line"
                              >
                                {entry.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="empty tiny">-</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderPlannerGroups = (dayKey: string, groups: Array<[string, WorkLocation[]]>) => {
    const plannerState = getPlannerStateForDay(dayKey)
    const isEditableDay = isPlannerDayInEditMode(dayKey)
    const ownersForDay = getLocationOwnersForDay(plannerState, dayKey)
    const dutySiteByAssistant = new Map(
      (plannerState.dutyRoster[dayKey] ?? []).map((entry) => [entry.name, entry.site]),
    )
    const getPlannerAssignedChipLabel = (assistantName: string) => {
      const dutySite = dutySiteByAssistant.get(assistantName)
      return dutySite ? `${assistantName}(${DUTY_SITE_SHORT_LABELS[dutySite]})` : assistantName
    }
    return groups.map(([siteName, locations]) => (
      <div className="site-block" key={`${dayKey}-${siteName}-${plannerView}`}>
        <h4>{siteName}</h4>
        {locations.map((location) => {
          const names = getDisplayAssignmentsForLocation(plannerState, dayKey, location)
          const specialistLabel = getSpecialistLabelForLocation(plannerState, dayKey, location)
          const draftKey = `${dayKey}-${location.id}`
          const owners = location.kind === 'normal' ? ownersForDay[location.id] ?? [] : []
          const uniqueOwners = [...new Set(owners)]
          const sectionOrder = getPlannerAssistantSectionOrder(location.site)
          const previousDayKeyForOptions = toISODate(addDays(fromISODate(dayKey), -1))
          const blockedPostDutyNames = new Set(
            dutyAssignmentsToNames(plannerState.dutyRoster[previousDayKeyForOptions] ?? []),
          )
          const blockedLeaveNames = new Set(
            plannerState.locations
              .filter((item) => {
                if (item.kind !== 'leave') {
                  return false
                }
                const normalizedLeaveName = normalizeTrToken(item.name)
                return (
                  item.id === LEAVE_LOCATION_IDS.excuse ||
                  item.id === LEAVE_LOCATION_IDS.annual ||
                  item.id === LEAVE_LOCATION_IDS.rotation ||
                  normalizedLeaveName.includes('mazeret') ||
                  normalizedLeaveName.includes('yillik') ||
                  normalizedLeaveName.includes('rotasyon')
                )
              })
              .flatMap((leaveLocation) => getAssignmentsForLocation(plannerState, dayKey, leaveLocation)),
          )
          const assignedInRoomNames = new Set<string>()
          plannerState.locations
            .filter((item) => item.kind === 'normal')
            .forEach((normalLocation) => {
              getAssignmentsForLocation(plannerState, dayKey, normalLocation).forEach((name) =>
                assignedInRoomNames.add(name),
              )
            })
          const postDutyPoolSet = new Set(getPostDutyPoolForDay(plannerState, dayKey))

          const postDutyPoolGroup = {
            key: 'nobet-ertesiciler',
            label: 'Nöbet Ertesiciler',
            items: [] as Array<{ assistant: string; label: string; isOwner: boolean }>,
          }
          const hospitalGroups = sectionOrder.map((section) => ({
            key: `section-${section}`,
            section,
            label: section === 'Diğer' ? 'Diğer / Ataması Olmayan' : section,
            items: [] as Array<{ assistant: string; label: string; isOwner: boolean }>,
          }))
          const placedGroup = {
            key: 'yerlestirilenler',
            label: 'Yerleştirilenler',
            items: [] as Array<{ assistant: string; label: string; isOwner: boolean }>,
          }
          const sectionMap = new Map(hospitalGroups.map((group) => [group.section, group.items]))

          plannerState.assistants.forEach((assistant) => {
            if (blockedLeaveNames.has(assistant)) {
              return
            }
            if (blockedPostDutyNames.has(assistant)) {
              return
            }
            const ownerSection = getAssistantOwnerSectionForPlannerList(
              plannerState,
              dayKey,
              assistant,
              sectionOrder,
            )
            const isOwner = uniqueOwners.includes(assistant)
            const baseLabel = isOwner
              ? `${getAssistantOptionLabelForState(plannerState, assistant, dayKey)} (odanın asistanı)`
              : getAssistantOptionLabelForState(plannerState, assistant, dayKey)

            if (assignedInRoomNames.has(assistant)) {
              placedGroup.items.push({
                assistant,
                label: `x ${baseLabel}`,
                isOwner,
              })
              return
            }

            if (postDutyPoolSet.has(assistant)) {
              postDutyPoolGroup.items.push({
                assistant,
                label: baseLabel,
                isOwner,
              })
              return
            }

            const section = sectionMap.has(ownerSection) ? ownerSection : ('Diğer' as const)
            sectionMap.get(section)?.push({
              assistant,
              label: baseLabel,
              isOwner,
            })
          })

          const allGroupsForSort = [postDutyPoolGroup, ...hospitalGroups, placedGroup]
          allGroupsForSort.forEach((group) => {
            group.items.sort(
              (a, b) =>
                Number(b.isOwner) - Number(a.isOwner) ||
                compareAssistantNamesByRank(
                  a.assistant,
                  b.assistant,
                  plannerState.assistantRanks,
                ),
            )
          })
          const groupedAssistantOptions = allGroupsForSort.filter((group) => group.items.length)

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
              {specialistLabel ? <p className="planner-specialist-inline">{specialistLabel}</p> : null}

              <div className="chip-wrap">
                {names.length ? (
                  names.map((name) => (
                    <button
                      key={`${dayKey}-${location.id}-${name}`}
                      type="button"
                      className="chip removable"
                      disabled={!isEditableDay}
                      onClick={() => removeAssignment(dayKey, location.id, name)}
                    >
                      {getPlannerAssignedChipLabel(name)}
                    </button>
                  ))
                ) : (
                  <span className="empty">Atama yok</span>
                )}
              </div>

              <div className="form-row compact">
                <select
                  disabled={!isEditableDay}
                  value={cellDrafts[draftKey] ?? ''}
                  onChange={(event) =>
                    setCellDrafts((previous) => ({
                      ...previous,
                      [draftKey]: event.target.value,
                    }))
                  }
                >
                  <option value="">Kişi seç</option>
                  {groupedAssistantOptions.map((group) => {
                    if (!group.items.length) {
                      return null
                    }
                    return (
                      <optgroup
                        key={`${dayKey}-${location.id}-group-${group.key}`}
                        label={group.label}
                      >
                        {group.items.map((item) => (
                          <option
                            key={`${dayKey}-${location.id}-${group.key}-${item.assistant}`}
                            value={item.assistant}
                          >
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
                <button
                  type="button"
                  className="secondary"
                  disabled={!isEditableDay}
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
                        <button
                          key={`${draftKey}-owner-choice-${ownerName}`}
                          type="button"
                          className={`owner-choice-chip ${isSelected ? 'selected' : ''}`}
                          aria-pressed={isSelected}
                          disabled={!isEditableDay}
                          onClick={() => toggleOwnerSelection(dayKey, location.id, ownerName)}
                        >
                          <span className="owner-choice-chip-check">{isSelected ? '✓' : ''}</span>
                          <span>
                            {getAssistantOptionLabelForState(plannerState, ownerName, dayKey)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!isEditableDay}
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

  const renderPlannerSidePanel = (dayKey: string) => {
    const plannerState = getPlannerStateForDay(dayKey)
    const previousDayKey = toISODate(addDays(fromISODate(dayKey), -1))
    const dutyEntries = sortDutyAssignments(
      plannerState.dutyRoster[dayKey] ?? [],
      plannerState.assistantRanks,
    )
    const postDutyEntries = sortDutyAssignments(
      plannerState.dutyRoster[previousDayKey] ?? [],
      plannerState.assistantRanks,
    )
    const normalLocations = plannerState.locations.filter((location) => location.kind === 'normal')
    const leaveLocations = plannerState.locations.filter((location) => location.kind === 'leave')
    const excuseLeaveNames = sortAssistantNamesByRank(
      uniqueSortedNames(
      leaveLocations
        .filter(
          (location) =>
            location.id === LEAVE_LOCATION_IDS.excuse ||
            location.name.toLocaleLowerCase('tr').includes('mazeret') ||
            location.id === LEGACY_LEAVE_LOCATION_ID ||
            location.name.toLocaleLowerCase('tr').includes('izinli'),
        )
        .flatMap((location) => getAssignmentsForLocation(plannerState, dayKey, location)),
      ),
      plannerState.assistantRanks,
    )
    const annualLeaveNames = sortAssistantNamesByRank(
      uniqueSortedNames(
      leaveLocations
        .filter(
          (location) =>
            location.id === LEAVE_LOCATION_IDS.annual ||
            location.name
              .toLocaleLowerCase('tr')
              .replace(/ı/g, 'i')
              .includes('yillik'),
        )
        .flatMap((location) => getAssignmentsForLocation(plannerState, dayKey, location)),
      ),
      plannerState.assistantRanks,
    )
    const rotationNames = sortAssistantNamesByRank(
      uniqueSortedNames(
      leaveLocations
        .filter(
          (location) =>
            location.id === LEAVE_LOCATION_IDS.rotation ||
            location.name.toLocaleLowerCase('tr').includes('rotasyon'),
        )
        .flatMap((location) => getAssignmentsForLocation(plannerState, dayKey, location)),
      ),
      plannerState.assistantRanks,
    )
    const blockedStatusLocations = plannerState.locations.filter(
      (location) => location.kind === 'leave' || location.kind === 'postDuty',
    )
    const unplacedAssignableNames = sortAssistantNamesByRank(
      uniqueSortedNames(
      plannerState.assistants.filter((assistant) => {
        const alreadyInRoom = normalLocations.some((location) =>
          getAssignmentsForLocation(plannerState, dayKey, location).includes(assistant),
        )
        if (alreadyInRoom) {
          return false
        }

        const blockedByStatus = blockedStatusLocations.some((location) =>
          getAssignmentsForLocation(plannerState, dayKey, location).includes(assistant),
        )
        if (blockedByStatus) {
          return false
        }

        return true
      }),
      ),
      plannerState.assistantRanks,
    )

    return (
      <>
        <h4>Nöbetçiler</h4>
        <div className="chip-wrap">
          {dutyEntries.length ? (
            dutyEntries.map((entry) => (
              <span
                key={`planner-duty-${dayKey}-${entry.name}-${entry.site}`}
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
                key={`planner-post-duty-${dayKey}-${entry.name}-${entry.site}`}
                className={`chip duty-site-chip duty-site-${dutySiteClassName(entry.site)}`}
              >
                {entry.name} ({entry.site})
              </span>
            ))
          ) : (
            <span className="empty">Nöbet ertesi yok</span>
          )}
        </div>

        <h4>Mazeret İznindekiler</h4>
        <div className="stack-list">
          {excuseLeaveNames.length ? (
            excuseLeaveNames.map((name) => (
              <span key={`planner-excuse-leave-${dayKey}-${name}`} className="chip">
                {name}
              </span>
            ))
          ) : (
            <span className="empty">Mazeret izninde kimse yok</span>
          )}
        </div>

        <h4>Yıllık İznindekiler</h4>
        <div className="stack-list">
          {annualLeaveNames.length ? (
            annualLeaveNames.map((name) => (
              <span key={`planner-annual-leave-${dayKey}-${name}`} className="chip">
                {name}
              </span>
            ))
          ) : (
            <span className="empty">Yıllık izinde kimse yok</span>
          )}
        </div>

        <h4>Rotasyondakiler</h4>
        <div className="stack-list">
          {rotationNames.length ? (
            rotationNames.map((name) => (
              <span key={`planner-rotation-${dayKey}-${name}`} className="chip">
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
              const dutyEntry = dutyEntries.find((entry) => entry.name === assistantName)
              return (
                <span
                  key={`planner-unplaced-assignable-${dayKey}-${assistantName}`}
                  className={`chip ${
                    dutyEntry ? `duty-site-chip duty-site-${dutySiteClassName(dutyEntry.site)}` : ''
                  }`}
                >
                  {dutyEntry
                    ? `${assistantName} (nöbet: ${dutyEntry.site})`
                    : assistantName}
                </span>
              )
            })
          ) : (
            <span className="empty">Yerleştirilmeyen uygun kişi yok</span>
          )}
        </div>
      </>
    )
  }

  const appFooter = (
    <footer className="app-credit no-print">
      © 2026 Anestezi Asistanları Portalı · Developed by Ahmet Özdemir
    </footer>
  )

  if (!session) {
    return (
      <div className="page-shell login-shell">
        <section className="card login-card fade-up">
          <p className="eyebrow">Giriş</p>
          <h1>Asistan Sistemi</h1>
          <p className="subtext">Giriş türünü seçip devam et.</p>

          <div className="login-actions">
            <button type="button" className={loginView === 'admin' ? 'active' : ''} onClick={() => setLoginView('admin')}>
              Admin
            </button>
            <button
              type="button"
              className={loginView === 'assistant' ? 'secondary active' : 'secondary'}
              onClick={() => setLoginView('assistant')}
            >
              Asistan Hekim
            </button>
          </div>

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
                {adminBlockRemainingMs > 0 ? (
                  <p className="hint-text">
                    Geçici bloke aktif. Kalan süre: {formatRemainingBlock(adminBlockRemainingMs)}
                  </p>
                ) : adminLoginGuard.rememberedAdmin && !passwordInput ? (
                  <p className="hint-text">
                    Bu cihazda admin girişi hatırlanıyor. Giriş'e basman yeterli.
                  </p>
                ) : (
                  <p className="hint-text">Doğru girişten sonra bu cihazda admin oturumu hatırlanır.</p>
                )}
              </div>
              {isSupabaseAdminAuthRequired ? (
                <div className={`secure-login-panel secure-login-${adminCloudAuthStatus}`}>
                  <div>
                    <span>Güvenli Supabase Admin</span>
                    <strong>
                      {isAdminCloudAuthVerified ? 'Oturum doğrulandı' : adminCloudAuthMessage}
                    </strong>
                  </div>
                  {!isAdminCloudAuthVerified ? (
                    <>
                      <label htmlFor="admin-cloud-email">Supabase Admin E-posta</label>
                      <input
                        id="admin-cloud-email"
                        type="email"
                        value={adminCloudAuthEmail}
                        onChange={(event) => setAdminCloudAuthEmail(event.target.value)}
                        autoComplete="username"
                        placeholder="admin e-posta"
                      />
                      <label htmlFor="admin-cloud-password">Supabase Admin Şifresi</label>
                      <input
                        id="admin-cloud-password"
                        type="password"
                        value={adminCloudAuthPassword}
                        onChange={(event) => setAdminCloudAuthPassword(event.target.value)}
                        autoComplete="current-password"
                        placeholder="Supabase şifresi"
                      />
                    </>
                  ) : (
                    <p className="hint-text">
                      Bu cihazdaki güvenli Supabase oturumu aktif. Yerel admin şifresiyle devam edebilirsin.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="login-actions">
                <button type="button" onClick={loginAsAdmin} disabled={adminBlockRemainingMs > 0}>
                  {adminBlockRemainingMs > 0 ? 'Bloklu' : 'Giriş'}
                </button>
              </div>
            </>
          ) : null}

          {loginView === 'assistant' ? (
            <>
              <div className="date-control">
                <label htmlFor="assistant-picker-search">Asistan Seç</label>
                <div className="assistant-user-picker">
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      pointerEvents: 'none',
                      width: 0,
                      height: 0,
                      border: 0,
                      padding: 0,
                    }}
                  />
                  <input
                    id="assistant-picker-search"
                    name="assistant-picker-search"
                    type="search"
                    value={assistantUsernameInput}
                    onFocus={() => setAssistantUserPickerOpen(true)}
                    onBlur={() => {
                      setTimeout(() => setAssistantUserPickerOpen(false), 120)
                    }}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      assistantLoginManuallyClearedRef.current = !nextValue.trim()
                      setAssistantUsernameInput(nextValue)
                      setAssistantUserPickerOpen(true)
                    }}
                    placeholder="İsim ara"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoCapitalize="none"
                    inputMode="search"
                    enterKeyHint="search"
                    data-form-type="other"
                    data-lpignore="true"
                  />
                  {assistantUserPickerOpen ? (
                    <div className="assistant-user-picker-list">
                      {filteredAssistantAccounts.length ? (
                        filteredAssistantAccounts.map((account) => (
                          <button
                            key={`assistant-user-option-${account.username}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              assistantLoginManuallyClearedRef.current = false
                              setAssistantUsernameInput(account.assistantName)
                              setAssistantUserPickerOpen(false)
                            }}
                          >
                            <strong>{account.assistantName}</strong>
                          </button>
                        ))
                      ) : (
                        <span className="empty">Eşleşen kullanıcı yok.</span>
                      )}
                    </div>
                  ) : null}
                </div>
                <p className="hint-text">
                  Boşken tıklarsan tüm asistanları görürsün. Harf yazdıkça liste otomatik filtrelenir.
                </p>
              </div>

              {matchedAssistantAccount ? (
                <p className="hint-text">
                  Seçilen asistan: {matchedAssistantAccount.assistantName}
                </p>
              ) : null}

              <div className="login-actions">
                <button type="button" onClick={loginAsAssistant}>
                  Giriş
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
        {appFooter}
      </div>
    )
  }

  if (session.role === 'admin' && plannerWeeklyExportOpen) {
    return (
      <div className="page-shell weekly-export-shell">
        <WeeklyRotaExportView
          title="HAFTALIK ASİSTAN ÇALIŞMA LİSTESİ"
          weekRangeLabel={plannerWeeklyExportWeekLabel}
          days={plannerWeeklyExportDays}
          groups={plannerWeeklyExportGroups}
          onClose={closePlannerWeeklyExport}
          onPrevWeek={() => shiftPlannerWeeklyExportWeek(-1)}
          onNextWeek={() => shiftPlannerWeeklyExportWeek(1)}
          onPrint={() => window.print()}
        />
        {appFooter}
      </div>
    )
  }

  if (session.role === 'assistant' && assistantMonthlyTableOpen) {
    return (
      <div className="page-shell weekly-export-shell">
        <AssistantMonthlyTableView
          assistantName={session.assistantName ?? loggedAssistantName}
          monthOptions={myCalendarMonthOptions}
          selectedMonth={assistantTableMonthDraft}
          displayMonthLabel={assistantTableMonthTitle}
          weeks={assistantTableCalendarWeeks}
          dayDataMap={assistantTableCalendarDayMap}
          todayISO={todayISO}
          onSelectMonth={setAssistantTableMonthDraft}
          onApplyMonth={applyAssistantMonthlyTableMonth}
          onClose={closeAssistantMonthlyTable}
        />
        {appFooter}
      </div>
    )
  }

  if (session.role === 'assistant' && observerDutyListOpen) {
    return (
      <div className="page-shell weekly-export-shell">
        <div className="assistant-monthly-table-page">
          <div className="assistant-monthly-table-toolbar no-print">
            <button type="button" className="ghost-button" onClick={closeObserverDutyList}>
              Geri Dön
            </button>
            <select
              className="my-calendar-month-select"
              value={observerDutyMonthDraft}
              onChange={(event) => setObserverDutyMonthDraft(event.target.value)}
            >
              {myCalendarMonthOptions.map((option) => (
                <option key={`observer-duty-page-month-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={applyObserverDutyMonth}>
              Görüntüle
            </button>
          </div>

          <section className="assistant-monthly-table-sheet duty-list-module">
            <h1>Aylık Nöbet Listesi</h1>
            <p>{observerDutyMonthTitle}</p>
            {renderDutyListTable(observerDutyTableModel, 'observer-duty-page')}
          </section>
        </div>
        {appFooter}
      </div>
    )
  }

  return (
    <div className="page-shell app-shell">
      <header className="topbar card fade-up">
        <div className="topbar-title">
          <div>
            <p className="eyebrow">Planlama</p>
            <h1>Çalışma Listesi Portalı</h1>
          </div>
        </div>

        <div className="top-controls">
          {session.role === 'admin' ? (
            <>
              <div className="session-role">
                <span>Aktif Giriş</span>
                <strong>Admin</strong>
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

              {isSupabaseAdminAuthRequired ? (
                <div className={`session-role cloud-sync cloud-${isSecureCloudWriteUnlocked ? 'ready' : 'error'}`}>
                  <span>Admin Güvenlik</span>
                  <strong>{adminCloudAuthMessage}</strong>
                </div>
              ) : null}
            </>
          ) : null}

          {session.role === 'assistant' ? (
            <div className="session-role assistant-welcome-card">
              <span>Asistan Hekim</span>
              <strong className="assistant-welcome-text">
                Hoşgeldiniz Sayın {observerAssistant || session.assistantName || 'Asistan'}
              </strong>
            </div>
          ) : null}

          <div className="header-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                logout()
              }}
            >
              Çıkış Yap
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className={`notice ${notice.type === 'ok' ? 'success' : 'warning'}`}>{notice.text}</div>
      ) : null}

      {mode === 'admin' ? (
        <main className="stack-layout">
          <section className="card fade-up delay-2 section-switcher">
            <h2>Admin Modülleri</h2>
            <div className="subpanel-toggle">
              <button
                type="button"
                className={adminSection === 'assistants' ? 'active' : ''}
                onClick={() => selectAdminSection('assistants')}
              >
                Asistanlar
              </button>
              <button
                type="button"
                className={adminSection === 'locations' ? 'active' : ''}
                onClick={() => selectAdminSection('locations')}
              >
                Alanlar
              </button>
              <button
                type="button"
                className={adminSection === 'duty' ? 'active' : ''}
                onClick={() => selectAdminSection('duty')}
              >
                Nöbet
              </button>
              <button
                type="button"
                className={adminSection === 'planner' ? 'active' : ''}
                onClick={() => selectAdminSection('planner')}
              >
                Planlama
              </button>
              <button
                type="button"
                className={adminSection === 'specialists' ? 'active' : ''}
                onClick={() => selectAdminSection('specialists')}
              >
                Uzman
              </button>
              <button
                type="button"
                className={adminSection === 'backups' ? 'active' : ''}
                onClick={() => selectAdminSection('backups')}
              >
                Yedekler
              </button>
              <button
                type="button"
                className={adminSection === 'loginEvents' ? 'active' : ''}
                onClick={() => selectAdminSection('loginEvents')}
              >
                Girişler
              </button>
            </div>
          </section>

          {adminSection === 'assistants' ? (
            <section className="card fade-up delay-2 assistant-section-card">
              <div className="assistant-section-head">
                <h2>Asistan Havuzu</h2>
                <span className="assistant-count-pill">{data.assistants.length} kişi</span>
              </div>
              <p className="subtext">
                Eklerken kıdem seçilir. Üst kıdem boş kalırsa alt kıdemler otomatik bir üst kıdeme taşınır.
              </p>

              <div className="form-row assistant-add-row">
                <input
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  placeholder="Yeni asistan adı soyadı"
                />
                <select
                  value={String(assistantRankInput)}
                  onChange={(event) => setAssistantRankInput(toSafeSeniorityLevel(Number(event.target.value), 1))}
                >
                  {assistantInputLevels.map((level) => (
                    <option key={`assistant-rank-option-${level}`} value={String(level)}>
                      {level}. Kıdem
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addAssistant}>
                  Asistan Ekle
                </button>
              </div>

              {assistantsBySeniority.map((group) => (
                <section key={`assistant-rank-group-${group.level}`} className="assistant-rank-group">
                  <header className="assistant-rank-head">
                    <h3>{group.level}. Kıdem</h3>
                    <span>{group.names.length} kişi</span>
                  </header>
                  {group.names.length ? (
                    <div className="assistant-chip-grid">
                      {group.names.map((assistant) => (
                        <button
                          key={assistant}
                          type="button"
                          className="assistant-chip"
                          onClick={() => removeAssistant(assistant)}
                          title="Listeden çıkar"
                        >
                          <span className="assistant-chip-name">{assistant}</span>
                          <span className="assistant-chip-remove">Kaldır</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="empty">Bu kıdemde kişi yok</span>
                  )}
                </section>
              ))}
            </section>
          ) : null}

          {adminSection === 'locations' ? (
            <section className="card fade-up delay-3">
            <h2>Çalışma Alanları</h2>
            <p className="subtext">
              Sancaktepe, Feriha Öz ve Çekmeköy için yeni alan ekleyebilirsin. Oda asistanlarını
              ay bazlı kaydedebilirsin; planlamada seçilen tarihin ayındaki liste kullanılır.
              Alan ekleme/kapatma ve sıra değişikliği bugünden itibaren geçerli olur, geçmiş
              tarihlerde eski düzen korunur.
            </p>

            <div className="form-row responsive">
              <select
                value={newLocationSite}
                disabled={ownersEditMode}
                onChange={(event) => setNewLocationSite(event.target.value as DutySite)}
              >
                {DUTY_SITES.map((site) => (
                  <option key={`location-site-option-${site}`} value={site}>
                    {site}
                  </option>
                ))}
              </select>
              <input
                value={newLocationName}
                disabled={ownersEditMode}
                onChange={(event) => setNewLocationName(event.target.value)}
                placeholder="Yeni alan adı"
              />
              <button type="button" disabled={ownersEditMode} onClick={addLocation}>
                Alan Ekle
              </button>
            </div>

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
                  {locations.map((location, siteIndex) => (
                    <article
                      key={location.id}
                      className={`location-pill tone-${location.tone} kind-${location.kind}`}
                    >
                      <div className="location-pill-head">
                        <label className="location-order-control">
                          <span>Sıra</span>
                          <input
                            type="number"
                            min={1}
                            max={locations.length}
                            value={siteIndex + 1}
                            disabled={ownersEditMode}
                            onChange={(event) => updateLocationOrder(location.id, event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="ghost-button location-delete-button"
                          disabled={ownersEditMode}
                          onClick={() => removeLocation(location.id)}
                          title="Alanı kaldır"
                          aria-label="Alanı kaldır"
                        >
                          🗑
                        </button>
                      </div>
                      <div className="location-pill-main">
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

            <section className="site-group-card">
              <h3 className="site-group-title">Nöbet Ertesiciler</h3>
              <p className="hint-text">
                Hastaneye bağlı olmayan, planlamada odalara dağıtılacak havuz. Oda kartı oluşturmaz.
              </p>
              <div className="location-actions post-duty-pool-actions">
                <select
                  disabled={!ownersEditMode}
                  value={postDutyPoolDraft}
                  onChange={(event) => setPostDutyPoolDraft(event.target.value)}
                >
                  <option value="">Asistan seç</option>
                  {data.assistants.map((assistant) => (
                    <option key={`post-duty-pool-option-${assistant}`} value={assistant}>
                      {assistant}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  disabled={!ownersEditMode}
                  onClick={addPostDutyPoolAssistant}
                >
                  Ekle
                </button>
              </div>
              <div className="chip-wrap">
                {visiblePostDutyPoolForMonth.length ? (
                  visiblePostDutyPoolForMonth.map((assistantName) => (
                    <button
                      key={`post-duty-pool-chip-${assistantName}`}
                      type="button"
                      className="chip removable"
                      disabled={!ownersEditMode}
                      onClick={() => removePostDutyPoolAssistant(assistantName)}
                    >
                      {assistantName}
                    </button>
                  ))
                ) : (
                  <span className="empty">{ownersMonth} ayı için nöbet ertesi havuzu boş.</span>
                )}
              </div>
            </section>
            </section>
          ) : null}

          {adminSection === 'duty' ? (
            <section className="card fade-up delay-4">
            <h2>Aylık Nöbet</h2>
            <p className="subtext">
              Ay seçip nöbetleri satırdan veya günlük kartlardan ekle. Nöbetler her gün yazılır;
              hafta sonu ve resmi tatiller dahildir.
            </p>
            <div className="form-row month-only-row">
              <select
                className="my-calendar-month-select"
                value={dutyMonth}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  if (isValidMonthISO(nextMonth)) {
                    setDutyMonth(nextMonth)
                  }
                }}
              >
                {dutyMonthOptions.map((option) => (
                  <option key={`duty-month-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
                const dayDuty = sortDutyAssignments(data.dutyRoster[dayKey] ?? [], data.assistantRanks)
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
              Nöbet ertesi, mazeret/yıllık izin ve rotasyondakiler odalara yazılamaz. Nöbetçiler
              aynı gün odaya yazılabilir.
            </p>

            <div className="form-row month-only-row planner-date-controls">
              <select
                className="my-calendar-month-select"
                value={plannerMonth}
                onChange={(event) => {
                  const nextMonth = event.target.value
                  if (!isValidMonthISO(nextMonth)) {
                    return
                  }
                  setPlannerMonth(nextMonth)
                  const nextMonthDays = listMonthDays(nextMonth)
                  if (!nextMonthDays.length) {
                    return
                  }
                  if (!nextMonthDays.includes(activePlannerDay)) {
                    const preferred = nextMonthDays.includes(todayISO) ? todayISO : nextMonthDays[0]
                    setActivePlannerDay(preferred)
                  }
                }}
              >
                {plannerMonthOptions.map((option) => (
                  <option key={`planner-month-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row planner-export-row">
              <button
                type="button"
                className="ghost-button planner-export-open"
                onClick={openPlannerWeeklyExport}
              >
                Haftalık Çıktı / Yazdırılabilir Liste
              </button>
            </div>

            <div className="planner-day-tabs planner-month-tabs" ref={plannerMonthDayScrollerRef}>
              {plannerDayOptions.map((day) => (
                <button
                  key={`planner-tab-${day.key}`}
                  type="button"
                  data-planner-day={day.key}
                  className={`${activePlannerDay === day.key ? 'active' : ''}${
                    day.roomAssignmentBlocked ? ' nonworking' : ''
                  }`}
                  onClick={() => setActivePlannerDay(day.key)}
                >
                  <span className="planner-month-tab-date">{day.compactDate}</span>
                  <span className="planner-month-tab-weekday">{day.weekdayLabel}</span>
                </button>
              ))}
            </div>

            {selectedPlannerDay ? (
              (() => {
                const day = selectedPlannerDay
                const isDayEditable = isPlannerDayInEditMode(day.key)
                return (
                  <div className="week-grid">
                    <article key={day.key} className="day-card">
                  <header>
                    <h3>{day.label}</h3>
                    <small>{day.key}</small>
                  </header>

                  {day.dayTypeLabel ? (
                    <p className="hint-text planner-hint">
                      {day.roomAssignmentBlocked
                        ? `${day.dayTypeLabel} günü: normal oda ve mazeret/yıllık izin/rotasyon ataması yapılamaz.`
                        : `${day.dayTypeLabel} günü: normal oda ataması yapılabilir.`}
                    </p>
                  ) : null}

                  <div className="day-tools">
                    {!isDayEditable ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => startPlannerDayEdit(day.key)}
                      >
                        Değiştir
                      </button>
                    ) : null}
                    {isDayEditable ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => savePlannerDay(day.key)}
                      >
                        Kaydet
                      </button>
                    ) : null}
                    {isDayEditable ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => cancelPlannerDayEdit(day.key)}
                      >
                        İptal
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-button day-mini-action"
                      disabled={!isDayEditable}
                      onClick={() => autoFillDay(day.key)}
                    >
                      Varsayılanları Yaz
                    </button>
                    <button
                      type="button"
                      className="ghost-button day-mini-action"
                      disabled={!isDayEditable}
                      onClick={() => clearDayAssignments(day.key)}
                    >
                      Manueli Temizle
                    </button>
                  </div>
                  <p className="hint-text planner-hint">
                    {isDayEditable
                      ? 'Düzenleme açık. Değişiklikler sadece taslakta; diğer kullanıcılar Kaydet sonrası görür.'
                      : 'Bu gün kilitli. Değişiklik yapmak için önce Değiştir butonuna bas.'}
                  </p>
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
                      İzinler / Rotasyon
                    </button>
                  </div>

                  <div
                    className={`planner-layout ${
                      plannerView === 'rooms' ? 'planner-layout-rooms' : 'planner-layout-status'
                    }`}
                  >
                    {plannerView === 'rooms' ? (
                      <>
                        <div className="planner-main-column">
                          {renderPlannerGroups(day.key, roomLeftGroups)}
                        </div>
                        <div className="planner-main-column planner-middle-column">
                          {renderPlannerGroups(day.key, roomMiddleGroups)}
                          <aside className="planner-side-panel planner-side-panel-under-middle">
                            {renderPlannerSidePanel(day.key)}
                          </aside>
                        </div>
                        <div className="planner-main-column planner-right-column">
                          {renderPlannerGroups(day.key, roomRightGroups)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="planner-main-column">
                          {renderPlannerGroups(day.key, groupedStatusLocations)}
                        </div>
                        <aside className="planner-side-panel">
                          {renderPlannerSidePanel(day.key)}
                        </aside>
                      </>
                    )}
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

          {adminSection === 'specialists' ? (
            <section className="card fade-up delay-5 specialist-admin-card">
              <h2>Uzman Modülü</h2>
              <p className="subtext">
                Uzmanları kullanıcıya çevirmeden metinsel planlama verisi olarak kaydedebilirsin.
                1. kutu oda uzmanları (günlük çalışma), 2. kutu nöbetçi uzmanlar içindir.
                Tarih seçimi gerekmez; her satırda yazan tarih esas alınır.
              </p>

              <article className="specialist-input-card">
                <h3>Günlük Çalışma</h3>
                <p className="subtext">
                  Yapıştırma formatı: <code>Tarih - Uzman Adı - Alan</code>. Aynı uzman aynı gün farklı
                  odalara yazılabilir; aynı odada birden fazla uzman da olabilir. Farklı haftaların veya
                  ayların satırlarını aynı kutuya ekleyebilirsin.
                </p>
                <textarea
                  value={specialistWorkText}
                  onChange={(event) => setSpecialistWorkText(event.target.value)}
                  placeholder={
                    '27 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe Ameliyathane 1\n' +
                    '27 Nisan 2026 - Murat Öksüz - Çekmeköy Ameliyathane\n' +
                    '28 Nisan 2026 - Ayşe Demir - Feriha Öz C3 Yoğun Bakım Ünitesi'
                  }
                />
                <div className="form-row specialist-save-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!specialistWorkText.trim()}
                    onClick={importSpecialistWorkLines}
                  >
                    Günlük Çalışmayı Kaydet
                  </button>
                </div>

                {specialistWorkIssues.length ? (
                  <article className="import-issue-card">
                    <h3>Günlük Çalışma Uyarıları</h3>
                    <ul>
                      {specialistWorkIssues.map((issue, index) => (
                        <li key={`specialist-work-issue-${index}`}>{issue}</li>
                      ))}
                    </ul>
                  </article>
                ) : null}
              </article>

              <article className="specialist-input-card">
                <h3>Nöbetçi Uzmanlar</h3>
                <p className="subtext">
                  Yapıştırma formatı: <code>Tarih - Uzman Adı - NöbetYeri</code>. Nöbet yeri:
                  Sancaktepe, Çekmeköy, Feriha C123, Feriha C456, Feriha G123. Aynı kutuya
                  aylık/çok günlük liste yapıştırılabilir.
                </p>
                <textarea
                  value={specialistDutyText}
                  onChange={(event) => setSpecialistDutyText(event.target.value)}
                  placeholder={
                    '1 Nisan 2026 - Sami Yarkın Sözüer - Sancaktepe\n' +
                    '1 Nisan 2026 - Murat Öksüz - Çekmeköy\n' +
                    '1 Nisan 2026 - Ayşe Demir - Feriha C123\n' +
                    '1 Nisan 2026 - Mehmet Kaya - Feriha C456\n' +
                    '1 Nisan 2026 - Ali Veli - Feriha G123'
                  }
                />
                <div className="form-row specialist-save-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!specialistDutyText.trim()}
                    onClick={importSpecialistDutyLines}
                  >
                    Nöbetçi Uzmanları Kaydet
                  </button>
                </div>

                {specialistDutyIssues.length ? (
                  <article className="import-issue-card">
                    <h3>Nöbetçi Uzman Uyarıları</h3>
                    <ul>
                      {specialistDutyIssues.map((issue, index) => (
                        <li key={`specialist-duty-issue-${index}`}>{issue}</li>
                      ))}
                    </ul>
                  </article>
                ) : null}
              </article>
            </section>
          ) : null}

          {adminSection === 'backups' ? (
            <section className="card fade-up delay-5 backup-admin-card">
              <div className="assistant-section-head">
                <h2>Yedekler</h2>
                <span className="assistant-count-pill">{backupEntries.length} kayıt</span>
              </div>
              <p className="subtext">
                Online verinin yanlışlıkla ezilmesine karşı manuel yedek alabilir ve son kayıt noktalarına
                dönebilirsin. Geri yükleme mevcut yayın verisini seçilen yedekle değiştirir.
              </p>

              <div className="form-row backup-action-row">
                <button type="button" className="secondary" disabled={isBackupLoading} onClick={createManualBackup}>
                  Manuel Yedek Al
                </button>
                <button type="button" className="ghost-button" disabled={isBackupLoading} onClick={refreshBackups}>
                  Yedekleri Yenile
                </button>
              </div>

              {backupStatusText ? <p className="hint-text planner-hint">{backupStatusText}</p> : null}

              <div className="backup-grid">
                {backupEntries.length ? (
                  backupEntries.map((entry) => (
                    <article key={`backup-${entry.id}`} className="backup-card">
                      <header>
                        <strong>{new Date(entry.savedAt).toLocaleString('tr-TR')}</strong>
                        <small>{entry.source}</small>
                      </header>
                      <div className="backup-meta-grid">
                        <span>
                          <strong>{entry.assistantCount}</strong>
                          Asistan
                        </span>
                        <span>
                          <strong>{entry.locationCount}</strong>
                          Alan
                        </span>
                        <span>
                          <strong>{entry.dutyDayCount}</strong>
                          Nöbet günü
                        </span>
                        <span>
                          <strong>{entry.assignmentDayCount}</strong>
                          Planlı gün
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={isBackupLoading}
                        onClick={() => restoreBackup(entry.id)}
                      >
                        Bu Yedeğe Dön
                      </button>
                    </article>
                  ))
                ) : (
                  <span className="empty">Yedek listesi boş. Manuel yedek alarak ilk güvenli noktayı oluştur.</span>
                )}
              </div>
            </section>
          ) : null}

          {adminSection === 'loginEvents' ? (
            <section className="card fade-up delay-5 login-events-admin-card">
              <div className="assistant-section-head">
                <h2>Giriş Kayıtları</h2>
                <button
                  type="button"
                  className="ghost-button compact-action"
                  disabled={isLoginEventsLoading}
                  onClick={refreshLoginEvents}
                >
                  Yenile
                </button>
              </div>
              <p className="subtext">
                Asistan ismiyle yapılan girişler burada ayrı bir kayıt defteri olarak tutulur. Bu bölüm
                planlama verisini değiştirmez; sadece <code>login_events</code> tablosunu okur.
              </p>

              <div className="login-event-summary-grid">
                <article className="my-summary-card login-event-summary-card">
                  <span>Bugün Giriş Yapan Farklı Kişi</span>
                  <strong>{loginEventStats.todayDistinctNames.length}</strong>
                </article>
                <article className="my-summary-card login-event-summary-card">
                  <span>Bugünkü Toplam Giriş</span>
                  <strong>{loginEventStats.todayTotalCount}</strong>
                </article>
                <article className="my-summary-card login-event-summary-card">
                  <span>Toplam Giriş Sayısı</span>
                  <strong>{loginEventStats.totalCount}</strong>
                </article>
                <article className="my-summary-card login-event-summary-card">
                  <span>Bugün Çoklu Asistan Bağlantısı</span>
                  <strong>{loginEventStats.todayConnectionGroups.length}</strong>
                </article>
                <article className="my-summary-card login-event-summary-card">
                  <span>Son Giriş</span>
                  <strong>
                    {loginEventStats.lastEntries[0]
                      ? new Date(loginEventStats.lastEntries[0].createdAt).toLocaleString('tr-TR')
                      : '-'}
                  </strong>
                </article>
              </div>

              {loginEventsStatusText ? (
                <p className="hint-text planner-hint">{loginEventsStatusText}</p>
              ) : null}

              <article className="login-events-today-card">
                <h3>Bugün Giriş Yapan Asistanlar</h3>
                <div className="chip-wrap">
                  {loginEventStats.todayDistinctNames.length ? (
                    loginEventStats.todayDistinctNames.map((name) => (
                      <span key={`login-today-${name}`} className="chip login-name-chip">
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="empty">Bugün henüz kayıtlı asistan girişi yok.</span>
                  )}
                </div>
              </article>

              <article className="login-events-today-card">
                <h3>Aynı Bağlantıdan Girenler</h3>
                {loginEventStats.todayConnectionGroups.length ? (
                  <div className="login-connection-list">
                    {loginEventStats.todayConnectionGroups.map((group) => (
                      <div key={`login-connection-${group.connectionHash}`} className="login-connection-card">
                        <strong>{formatConnectionHashLabel(group.connectionHash)}</strong>
                        <span>
                          {group.assistantNames.length} farklı asistan, {group.loginCount} giriş
                        </span>
                        <div className="chip-wrap">
                          {group.assistantNames.map((name) => (
                            <span key={`login-connection-${group.connectionHash}-${name}`} className="chip login-name-chip">
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="empty">Bugün aynı bağlantıdan birden fazla farklı asistan girişi görünmüyor.</span>
                )}
              </article>

              <article className="login-events-table-card">
                <h3>Son 50 Giriş</h3>
                <div className="login-events-table-wrap">
                  <table className="login-events-table">
                    <thead>
                      <tr>
                        <th>Asistan</th>
                        <th>Bağlantı</th>
                        <th>Tarih</th>
                        <th>Saat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginEventStats.lastEntries.length ? (
                        loginEventStats.lastEntries.map((entry) => {
                          const entryDate = new Date(entry.createdAt)
                          return (
                            <tr key={`login-event-${entry.id}`}>
                              <td>{entry.personName}</td>
                              <td>{formatConnectionHashLabel(entry.ipHash)}</td>
                              <td>{entryDate.toLocaleDateString('tr-TR')}</td>
                              <td>
                                {entryDate.toLocaleTimeString('tr-TR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={4}>Giriş kaydı bulunamadı.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
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
                onClick={() => selectObserverSection('myPanel')}
              >
                Toplu Görünüm
              </button>
              <button
                type="button"
                className={observerSection === 'personWeek' ? 'active' : ''}
                onClick={() => selectObserverSection('personWeek')}
              >
                Haftalık Görünüm
              </button>
              <button
                type="button"
                className={observerSection === 'dailyMap' ? 'active' : ''}
                onClick={() => selectObserverSection('dailyMap')}
              >
                Günlük Harita
              </button>
            </div>
          </section>

          {observerSection === 'myPanel' ? (
            <section className="card fade-up delay-2">
              <h2>Toplu Görünüm</h2>
              <p className="subtext">
                Bu bölüm sadece giriş yapan asistan hekimin seçili ay için takvim ve nöbet
                tablolarını ayrı sayfada hızlıca açmasını sağlar.
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
                    {myMonthlyDutyBySite['Çekmeköy']} | FM: {myMonthlyOvertimeHours} saat
                  </strong>
                </article>
              </div>

              <article className="focus-location my-calendar-export-launch">
                <h3>Takvim Tablosu</h3>
                <p className="subtext">Ay seçip Görüntüle dediğinde takvim ayrı sayfada sadece tablo olarak açılır.</p>
                <div className="form-row my-calendar-export-row">
                  <select
                    className="my-calendar-month-select"
                    value={assistantTableMonthDraft}
                    onChange={(event) => setAssistantTableMonthDraft(event.target.value)}
                  >
                    {myCalendarMonthOptions.map((option) => (
                      <option key={`my-table-month-launch-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="secondary" onClick={openAssistantMonthlyTable}>
                    Görüntüle
                  </button>
                </div>
              </article>

              <article className="focus-location my-calendar-export-launch">
                <h3>Nöbet Listesi</h3>
                <p className="subtext">Ayı seçip Görüntüle dediğinde nöbet tablosu ayrı sayfada açılır.</p>
                <div className="form-row duty-list-launch-row">
                  <select
                    className="my-calendar-month-select"
                    value={observerDutyMonthDraft}
                    onChange={(event) => setObserverDutyMonthDraft(event.target.value)}
                  >
                    {myCalendarMonthOptions.map((option) => (
                      <option key={`observer-duty-month-launch-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="secondary" onClick={openObserverDutyList}>
                    Görüntüle
                  </button>
                </div>
              </article>
            </section>
          ) : null}

          {observerSection === 'personWeek' ? (
            <section className="card fade-up delay-2">
              <h2>Haftalık Görünüm</h2>
              <p className="subtext">
                Bu haftayı kişi bazlı veya oda bazlı olarak tek ekranda takip edebilirsin.
              </p>

              <div
                ref={observerWeeklyScrollerRef}
                className="planner-day-tabs observer-rolling-week-tabs"
                aria-label="Hafta seç"
              >
                {observerRollingWeekOptions.map((week) => (
                  <button
                    key={`observer-rolling-week-${week.weekStartISO}`}
                    type="button"
                    data-week-start={week.weekStartISO}
                    className={observerWeeklyWeekStart === week.weekStartISO ? 'active' : ''}
                    onClick={() => setObserverWeeklyWeekStart(week.weekStartISO)}
                  >
                    <strong>{week.label}</strong>
                    <span>{week.rangeLabel}</span>
                  </button>
                ))}
              </div>

              <div className="subpanel-toggle observer-week-detail-tabs">
                <button
                  type="button"
                  className={observerWeekDetailView === 'person' ? 'active' : ''}
                  onClick={() => setObserverWeekDetailView('person')}
                >
                  Kişi Bazlı
                </button>
                <button
                  type="button"
                  className={observerWeekDetailView === 'room' ? 'active' : ''}
                  onClick={() => setObserverWeekDetailView('room')}
                >
                  Oda Bazlı
                </button>
                <button
                  type="button"
                  className={observerWeekDetailView === 'duty' ? 'active' : ''}
                  onClick={() => setObserverWeekDetailView('duty')}
                >
                  Nöbet Bazlı
                </button>
              </div>

              {observerWeekDetailView === 'person' ? (
                <>
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
                    {weekAssignmentsForPerson.map(({ day, assignments, dayTypeLabel }) => (
                      <article key={`timeline-${day.key}`} className="timeline-card">
                        <header>
                          <strong>{day.shortLabel}</strong>
                          <small>{day.key}</small>
                        </header>
                        <div className="chip-wrap">
                          {assignments.length ? (
                            assignments.map(({ location, locationLabel, specialistLabel }) => (
                              <span key={`${day.key}-${location.id}`} className="chip soft chip-with-meta">
                                {specialistLabel ? (
                                  <small className="chip-meta specialist-work-meta">
                                    {specialistLabel}
                                  </small>
                                ) : null}
                                <span>{locationLabel}</span>
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
                </>
              ) : null}

              {observerWeekDetailView === 'room' ? (
                <>
                  <div className="form-row">
                    <select
                      value={observerWeekRoom}
                      onChange={(event) => setObserverWeekRoom(event.target.value)}
                    >
                      <option value="">Oda seç</option>
                      {observerWeekRoomOptions.map((location) => (
                        <option key={`observer-week-room-${location.id}`} value={location.id}>
                          {location.site} / {location.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="timeline-grid">
                    {weekAssignmentsForRoom.map(({ day, names, specialistLabel, dayTypeLabel }) => (
                      <article key={`timeline-room-${day.key}`} className="timeline-card">
                        <header>
                          <strong>{day.shortLabel}</strong>
                          <small>{day.key}</small>
                        </header>
                        <div className="chip-wrap">
                          {specialistLabel ? (
                            <span className="chip soft chip-with-meta">
                              <small className="chip-meta specialist-work-meta">{specialistLabel}</small>
                            </span>
                          ) : null}
                          {names.length ? (
                            names.map((name) => (
                              <span key={`${day.key}-${observerWeekRoom}-${name}`} className="chip soft">
                                {name}
                              </span>
                            ))
                          ) : dayTypeLabel ? (
                            <span className="empty offday-text">{dayTypeLabel} günü</span>
                          ) : (
                            <span className="empty">Bu odada atama görünmüyor</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}

              {observerWeekDetailView === 'duty' ? (
                <>
                  <div className="form-row">
                    <select
                      value={observerWeekDutySite}
                      onChange={(event) => setObserverWeekDutySite(event.target.value as DutySite)}
                    >
                      {DUTY_SITES.map((site) => (
                        <option key={`observer-week-duty-site-${site}`} value={site}>
                          {site}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="timeline-grid">
                    {weekDutyAssignmentsForSite.map(({ day, names, specialistNames }) => (
                      <article key={`timeline-duty-${day.key}`} className="timeline-card">
                        <header>
                          <strong>{day.shortLabel}</strong>
                          <small>{day.key}</small>
                        </header>
                        <div className="chip-wrap">
                          {specialistNames.length || names.length ? (
                            <div className="duty-name-stack weekly-duty-name-stack">
                              {specialistNames.length ? (
                                <div className="duty-specialist-row" aria-label={`${observerWeekDutySite} nöbetçi uzmanları`}>
                                  {specialistNames.map((name) => (
                                    <span
                                      key={`${day.key}-${observerWeekDutySite}-specialist-${name}`}
                                      className="duty-name-line specialist-duty-name-line"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              {names.length ? (
                                <div className="duty-assistant-row" aria-label={`${observerWeekDutySite} nöbetçi asistanları`}>
                                  {names.map((name) => (
                                    <span
                                      key={`${day.key}-${observerWeekDutySite}-${name}`}
                                      className="chip duty-site-chip"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="empty">Bu hastanede nöbetçi görünmüyor</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
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
            </div>

            <h3 className="observer-tab-title">Hafta Seç</h3>
            <div
              ref={observerDailyWeekScrollerRef}
              className="planner-day-tabs observer-week-tabs observer-rolling-week-tabs"
            >
              {observerRollingWeekOptions.map((group) => (
                <button
                  key={`observer-week-${group.weekStartISO}`}
                  type="button"
                  data-week-start={group.weekStartISO}
                  className={activeObserverWeek === group.weekStartISO ? 'active' : ''}
                  onClick={() => setActiveObserverWeek(group.weekStartISO)}
                >
                  <strong>{group.label}</strong>
                  <span>{group.rangeLabel}</span>
                </button>
              ))}
            </div>

            {observerActiveWeekDays.length ? (
              <>
                <h3 className="observer-tab-title">Gün Seç</h3>
                <div
                  ref={observerDailyDayScrollerRef}
                  className="planner-day-tabs observer-day-tabs observer-rolling-day-tabs"
                >
                {observerActiveWeekDays.map((day) => (
                  <button
                    key={`observer-day-${day.key}`}
                    type="button"
                    data-day-key={day.key}
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

            {groupedObserverLocations.map(([siteName, siteLocations]) => (
              <section key={`observer-site-group-${siteName}`} className="site-group-card">
                <h3 className="site-group-title">{siteName}</h3>
                <div className="location-tiles">
                  {siteLocations.map((location) => {
                    const names = observerDay
                      ? getDisplayAssignmentsForLocation(data, observerDay, location)
                      : []
                    const specialistLabel = observerDay
                      ? getSpecialistLabelForLocation(data, observerDay, location)
                      : null

                    return (
                      <article key={`observer-${location.id}`} className={`tile tone-${location.tone}`}>
                        <header>
                          <h4>{location.name}</h4>
                          <small>{LOCATION_KIND_LABELS[location.kind]}</small>
                        </header>
                        {specialistLabel ? (
                          <p className="tile-specialist-inline specialist-work-meta">{specialistLabel}</p>
                        ) : null}
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

        </main>
      )}
      {appFooter}
    </div>
  )
}

export default App
