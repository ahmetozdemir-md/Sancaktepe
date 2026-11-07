import type { DutySite, PlannerState, SpecialistDutySite } from './plannerTypes'

export const IMPORT_LABELS = {
  ASISTAN_NOBET: 'Asistan nöbeti',
  IZIN_ROTASYON: 'İzin / rotasyon',
  UZMAN_CALISMA: 'Uzman çalışma',
  UZMAN_NOBET: 'Uzman nöbeti',
  ROTASYONER: 'Rotasyoner',
} as const

export type ImportKind = keyof typeof IMPORT_LABELS
export interface ImportRow {
  line: number
  kind: ImportKind
  day: string
  name: string
  value: string
  locationId?: string
}

export interface ImportRules {
  resolveAssistant: (value: string) => { name: string | null; reason?: string }
  normalizeName: (value: string) => string
  dutySite: (value: string) => DutySite | null
  specialistDutySite: (value: string) => SpecialistDutySite | null
  workLocations: (day: string, value: string) => { locations?: { id: string; label: string }[]; reason?: string }
  statusLocation: (value: string) => { id: string; label: string } | null
  statusDayError: (day: string, locationId: string) => string | null
}

export interface ImportPreview {
  rows: ImportRow[]
  issues: string[]
  effects: string[]
  duplicateCount: number
  nextState: PlannerState | null
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function adjacentDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

const uniqueNames = (names: string[]) => [...new Set(names)].sort((a, b) => a.localeCompare(b, 'tr'))

// Build a complete candidate before touching application state. All validation uses
// the final duty roster, so mixed imports are independent of their row order.
export function prepareBulkImport(text: string, state: PlannerState, rules: ImportRules): ImportPreview {
  const rows: ImportRow[] = []
  const issues: string[] = []
  const effects: string[] = []
  const seen = new Set<string>()
  let duplicateCount = 0
  let fenceOpen = false
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim().replace(/^\uFEFF/, '')
    if (!line) return
    if (/^```(?:text|txt|plaintext)?$/i.test(line)) {
      fenceOpen = !fenceOpen
      return
    }
    const fields = line.split('|').map((field) => field.trim())
    const kind = fields[0] as ImportKind
    const fail = (message: string) => issues.push(`${index + 1}. satır: ${message}`)
    if (!Object.hasOwn(IMPORT_LABELS, kind)) {
      fail('Kayıt türü bulunamadı. ChatGPT çıktısını tür kodlarıyla birlikte yapıştır.')
      return
    }
    if (fields.length !== (kind === 'ROTASYONER' ? 3 : 4) || fields.some((field) => !field)) {
      fail(kind === 'ROTASYONER' ? 'ROTASYONER | YYYY-AA-GG | Ad biçimini kullan.' : 'TÜR | YYYY-AA-GG | Ad | Alan / tür biçimini kullan.')
      return
    }
    const [, day, rawName, rawValue = ''] = fields
    if (!validDate(day)) {
      fail(`Tarih geçersiz (${day}). Yıl dahil YYYY-AA-GG biçimini kullan.`)
      return
    }
    const row: ImportRow = { line: index + 1, kind, day, name: rules.normalizeName(rawName), value: rawValue }
    if (kind === 'ASISTAN_NOBET' || kind === 'IZIN_ROTASYON') {
      const match = rules.resolveAssistant(rawName)
      if (!match.name) { fail(match.reason ?? 'Asistan listesinde eşleşen kişi yok.'); return }
      row.name = match.name
    }
    if (!row.name) { fail('Kişi adı boş veya geçersiz.'); return }
    let expandedRows = [row]
    if (kind === 'ASISTAN_NOBET') {
      const site = rules.dutySite(rawValue)
      if (!site) { fail(`Asistan nöbet yeri geçersiz (${rawValue}).`); return }
      row.value = site
    } else if (kind === 'UZMAN_NOBET') {
      const site = rules.specialistDutySite(rawValue)
      if (!site) { fail(`Uzman nöbet yeri geçersiz (${rawValue}).`); return }
      row.value = site
    } else if (kind === 'UZMAN_CALISMA') {
      const resolved = rules.workLocations(day, rawValue)
      if (resolved.reason || !resolved.locations?.length) { fail(resolved.reason ?? 'Çalışma alanı eşleşmedi.'); return }
      expandedRows = resolved.locations.map((location) => ({ ...row, locationId: location.id, value: location.label }))
    } else if (kind === 'IZIN_ROTASYON') {
      const location = rules.statusLocation(rawValue)
      if (!location) { fail('İzin türü: Yıllık İzin, Mazeret İzni veya Rotasyon olmalı.'); return }
      row.locationId = location.id
      row.value = location.label
      const error = rules.statusDayError(day, location.id)
      if (error) { fail(error); return }
    }
    expandedRows.forEach((expanded) => {
      const key = JSON.stringify([kind, day, expanded.name, expanded.locationId ?? expanded.value])
      if (seen.has(key)) { duplicateCount++; return }
      seen.add(key)
      rows.push(expanded)
    })
  })
  if (fenceOpen) issues.push('Kod bloğu kapanmamış. ChatGPT çıktısının tamamını kopyala.')
  if (!rows.length && !issues.length) issues.push('Önizleme için en az bir kayıt yapıştır.')

  const next: PlannerState = {
    ...state,
    dutyRoster: { ...state.dutyRoster },
    specialistDutyRoster: { ...state.specialistDutyRoster },
    specialistWorkAssignments: { ...state.specialistWorkAssignments },
    rotatorRoster: { ...state.rotatorRoster },
    manualAssignments: { ...state.manualAssignments },
  }
  const failRow = (row: ImportRow, message: string) => issues.push(`${row.line}. satır: ${row.day} — ${row.name}: ${message}`)
  const statusKeys = new Map<string, string>()
  const specialistDutyDays = new Set(rows.filter((row) => row.kind === 'UZMAN_NOBET').map((row) => row.day))
  // Existing behavior: only specialist duty replaces the complete affected day.
  specialistDutyDays.forEach((day) => { next.specialistDutyRoster[day] = [] })
  rows.forEach((row) => {
    const { day, name, value, locationId } = row
    if (row.kind === 'ASISTAN_NOBET') {
      const current = next.dutyRoster[day] ?? []
      const existing = current.find((entry) => entry.name === name)
      if (existing && existing.site !== value) {
        failRow(row, `aynı gün ${existing.site} nöbeti zaten var. Önce eski nöbet kaydını düzelt.`)
      } else if (!existing) {
        next.dutyRoster[day] = [...current, { name, site: value as DutySite }]
      }
    } else if (row.kind === 'UZMAN_NOBET') {
      const current = next.specialistDutyRoster[day]
      if (current.some((entry) => entry.name === name && entry.site !== value)) {
        failRow(row, 'aynı gün birden fazla nöbet yerine yazılmış.')
      }
      next.specialistDutyRoster[day] = [...current, { name, site: value as SpecialistDutySite }]
    } else if (row.kind === 'UZMAN_CALISMA' && locationId) {
      const current = next.specialistWorkAssignments[day] ?? {}
      next.specialistWorkAssignments[day] = { ...current, [locationId]: uniqueNames([...(current[locationId] ?? []), name]) }
    } else if (row.kind === 'ROTASYONER') {
      next.rotatorRoster[day] = uniqueNames([...(next.rotatorRoster[day] ?? []), name])
    } else if (row.kind === 'IZIN_ROTASYON' && locationId) {
      const key = `${day}::${name}`
      if (statusKeys.has(key) && statusKeys.get(key) !== locationId) {
        failRow(row, 'aynı gün farklı izin / rotasyon türlerine yazılmış.')
      }
      statusKeys.set(key, locationId)
      const current = next.manualAssignments[day] ?? {}
      const dayMap: Record<string, string[]> = {}
      Object.entries(current).forEach(([id, names]) => {
        if (id !== locationId && names.includes(name)) {
          const oldLocation = state.locations.find((location) => location.id === id)
          effects.push(`${day} — ${name}: ${oldLocation?.name ?? id} kaydı kaldırılıp ${value} olarak değişecek.`)
        }
        dayMap[id] = names.filter((entry) => entry !== name)
      })
      dayMap[locationId] = uniqueNames([...(dayMap[locationId] ?? []), name])
      next.manualAssignments[day] = dayMap
    }
  })

  rows.forEach((row) => {
    if (row.kind === 'ASISTAN_NOBET') {
      for (const offset of [-1, 1]) {
        const otherDay = adjacentDay(row.day, offset)
        if (next.dutyRoster[otherDay]?.some((entry) => entry.name === row.name)) {
          failRow(row, `${otherDay} tarihinde de nöbeti var; üst üste nöbet olamaz.`)
        }
      }
      for (const day of [row.day, adjacentDay(row.day, 1)]) {
        Object.entries(next.manualAssignments[day] ?? {}).forEach(([id, names]) => {
          if (state.locations.some((location) => location.id === id && location.kind === 'leave') && names.includes(row.name)) {
            failRow(row, `${day} tarihindeki izin / rotasyon kaydıyla çakışıyor.`)
          }
        })
      }
      const nextDay = adjacentDay(row.day, 1)
      const nextDayMap = next.manualAssignments[nextDay]
      if (nextDayMap) {
        const updated = { ...nextDayMap }
        Object.entries(nextDayMap).forEach(([id, names]) => {
          if (state.locations.some((location) => location.id === id && location.kind === 'normal') && names.includes(row.name)) {
            updated[id] = names.filter((name) => name !== row.name)
            effects.push(`${nextDay} — ${row.name}: nöbet ertesi olduğu için ${state.locations.find((location) => location.id === id)?.name ?? id} ataması kaldırılacak.`)
          }
        })
        next.manualAssignments[nextDay] = updated
      }
    } else if (row.kind === 'IZIN_ROTASYON') {
      if (next.dutyRoster[row.day]?.some((entry) => entry.name === row.name)) failRow(row, 'aynı gün nöbeti var.')
      if (next.dutyRoster[adjacentDay(row.day, -1)]?.some((entry) => entry.name === row.name)) failRow(row, 'nöbet ertesi olduğu için izin / rotasyon eklenemez.')
    }
  })
  specialistDutyDays.forEach((day) => {
    const oldEntries = state.specialistDutyRoster[day] ?? []
    const removed = oldEntries.filter((old) => !next.specialistDutyRoster[day].some((entry) => entry.name === old.name && entry.site === old.site))
    effects.push(`${day}: uzman nöbet listesinin tamamı ${next.specialistDutyRoster[day].length} kayıtla değişecek.${removed.length ? ` Kaldırılacak: ${removed.map((entry) => `${entry.name} (${entry.site})`).join(', ')}.` : ''}`)
  })
  return { rows, issues: [...new Set(issues)], effects: [...new Set(effects)], duplicateCount, nextState: issues.length ? null : next }
}
