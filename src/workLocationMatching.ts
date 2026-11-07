import type { WorkLocation } from './plannerTypes'

function normalizeArea(value: string): string {
  return value.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^sancak(?=\s|$)/, 'sancaktepe')
    .replace(/^feriha(?:\s+oz)?(?=\s|$)/, 'feriha oz')
    .replace(/\bamel\b/g, 'ameliyathane').replace(/ameliyathane\s*(\d+)/g, 'ameliyathane $1')
    .replace(/\bybu\b/g, 'yogun bakim unitesi').replace(/\byogun bakim(?:\s+unitesi)?\b/g, 'yogun bakim')
    .replace(/\bpol\b/g, 'poliklinik').replace(/\b([cg])\s+(\d+)\b/g, '$1$2')
    .replace(/\s+/g, ' ').trim()
}

function lookupTokens(location: WorkLocation): Set<string> {
  const tokens = new Set([normalizeArea(location.name), normalizeArea(`${location.site} ${location.name}`)])
  const room = location.name.match(/ameliyathane\s*(\d+)\b/iu)
  if (room) tokens.add(normalizeArea(`${location.site} Ameliyathane ${room[1]}`))
  const code = location.name.match(/^([CG]\d+)\b/iu)
  if (code) {
    tokens.add(normalizeArea(code[1]))
    tokens.add(normalizeArea(`${location.site} ${code[1]}`))
  }
  return tokens
}

/** Resolve only listed areas active on the requested date. Never guess from substrings. */
export function resolveSpecialistWorkLocations(
  locations: WorkLocation[], day: string, raw: string,
): { locations: WorkLocation[]; reason?: string } {
  const normals = locations.filter((location) => location.kind === 'normal')
  const active = normals.filter((location) => (!location.activeFrom || location.activeFrom <= day) && (!location.activeUntil || day < location.activeUntil))
  const matches = (pool: WorkLocation[], value: string) => pool.filter((location) => lookupTokens(location).has(normalizeArea(value)))
  const parts = raw.split('+').map((part) => part.trim())
  if (parts.some((part) => !part)) return { locations: [], reason: 'Her + işaretinin iki yanında da bir çalışma alanı olmalı.' }
  // A literal registered area name takes priority over separator interpretation.
  const exact = matches(active, raw)
  if (exact.length === 1) return { locations: exact }
  const resolved: WorkLocation[] = []
  let previous: WorkLocation | undefined
  const sites = [...new Set(normals.map((location) => normalizeArea(location.site)))]
  for (const part of parts) {
    const normalized = normalizeArea(part)
    const hasSite = sites.some((site) => normalized === site || normalized.startsWith(`${site} `))
    let lookup = part
    if (previous && !hasSite) {
      // Shared hospital/room headings apply only within this explicitly combined field.
      if (/^\d+$/.test(part)) {
        const numbered = previous.name.match(/^(.*?)(\d+)(.*)$/u)
        if (numbered) lookup = `${previous.site} ${numbered[1]}${part}${numbered[3]}`
      } else lookup = `${previous.site} ${part}`
    }
    const candidates = matches(active, lookup)
    if (candidates.length !== 1) {
      const reason = candidates.length > 1
        ? `"${part}" birden fazla alana eşleşti. Hastane ve oda adını açık yaz.`
        : matches(normals, lookup).length
          ? `"${part}" alanı ${day} tarihinde aktif değil.`
          : `"${part}" için eşleşen alan bulunamadı. Güncel referanstaki hastane ve alan adını kullan.`
      return { locations: [], reason }
    }
    previous = candidates[0]
    resolved.push(previous)
  }
  return { locations: resolved }
}
