import { isPostCallUnit, POST_CALL_UNIT } from './rotations.js';

/** Explicit, reviewable bulk input. This module never modifies the supplied state. */
export const FORMAT_HELP = {
  absence: {
    title: 'İzin ve muafiyet',
    description: 'Tarih veya tarih aralığı | Kayıtlı ad | yıllık izin / mazeret izni / nöbet muafiyeti | Açıklama (isteğe bağlı). Başlangıç ve bitiş günleri dahildir.',
    example: '01.11.2026 - 05.11.2026 | Azmi | yıllık izin\n10.11.2026 | Ahmet Özdemir | mazeret izni | Kongre\n01.11.2026 - 30.11.2026 | Burcu | nöbet muafiyeti',
    columns: ['Tarih / aralık', 'Kayıtlı ad', 'İzin türü', 'Açıklama (isteğe bağlı)'],
  },
  request: {
    title: 'Nöbet istekleri',
    description: 'Tarih veya tarih aralığı | Kayıtlı ad | yazma / yaz / birlikte | Açıklama (isteğe bağlı). Birlikte isteklerinde iki veya daha fazla kayıtlı adı + ile ayırın. “Yaz” istenen günlere nöbet ekler; “yazma” ve “birlikte” yönlendirme içindir. Aralıktaki her gün ayrı istek sayılır; ardışık günlere nöbet yazılmaz.',
    example: '03.11.2026 - 05.11.2026 | Azmi | yazma\n12.11.2026 | Ahmet Özdemir | yaz | Perşembe isteği\n01.11.2026 - 30.11.2026 | Oğuzhan + Ezgi | birlikte',
    columns: ['Tarih / aralık', 'Kayıtlı ad / Ad + Ad', 'yazma / yaz / birlikte', 'Açıklama (isteğe bağlı)'],
  },
  rotation: {
    title: 'Rotasyonlar',
    description: 'Tarih veya tarih aralığı | Kayıtlı ad | Hastane | Birim (isteğe bağlı). Hastane: Sancaktepe, Feriha Öz veya Çekmeköy. Nöbet ertesi için hastaneye - ve birime Nöbet ertesi yazın; hastane atanmaz.',
    example: '01.11.2026 - 31.12.2026 | Azmi | Sancaktepe | YBÜ\n01.11.2026 - 31.12.2026 | Ahmet Özdemir | Feriha Öz | Ameliyathane\n01.11.2026 - 30.11.2026 | Deniz | - | Nöbet ertesi',
    columns: ['Tarih / aralık', 'Kayıtlı ad', 'Hastane', 'Birim (isteğe bağlı)'],
  },
  people: {
    title: 'Kişiler ve kıdemler',
    description: 'Ad | Kıdem numarası. En kıdemli grup 1’dir. Her kişi ayrı bir satıra yazılır; aynı adı taşıyan kişiler ayırt edilecek tam adlarıyla kaydedilmelidir.',
    example: 'Ahmet Özdemir | 2\nAzmi | 2\nDeniz | 3',
    columns: ['Ad', 'Kıdem numarası'],
  },
  duty: {
    title: 'Mevcut nöbetler',
    description: 'Tek tarih | Kayıtlı ad | Hastane. Yalnız zaten belirlediğiniz nöbetleri aktarır. Her nöbet ayrı bir satırdır; isteklerin otomatik ataması değildir.',
    example: '30.10.2026 | Azmi | Sancaktepe\n01.11.2026 | Azmi | Sancaktepe',
    columns: ['Tek tarih', 'Kayıtlı ad', 'Hastane'],
  },
};

const normalize = (value) => String(value ?? '').trim().replace(/\s+/gu, ' ')
  .toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/gu, 'i');
const clean = (value) => String(value ?? '').trim().replace(/\s+/gu, ' ');
const dateToken = '(?:\\d{2}\\.\\d{2}\\.\\d{4}|\\d{4}-\\d{2}-\\d{2})';
const rangePattern = new RegExp(`^(${dateToken})(?:\\s*[-–—]\\s*(${dateToken}))?$`, 'u');
const legacyPattern = new RegExp(`^(${dateToken})\\s+(.+?)\\s+(yıllık izin|yillik izin|mazeret izni|nöbet muafiyeti|nobet muafiyeti)$`, 'iu');
const makeId = () => globalThis.crypto.randomUUID();

function parseDate(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const tr = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value);
  if (!iso && !tr) throw new Error('Tarihi gün.ay.yıl olarak yazın (örnek: 01.11.2026).');
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(tr[3]), Number(tr[2]), Number(tr[1])];
  if (year < 1 || month < 1 || month > 12 || day < 1) throw new Error(`Geçersiz tarih: ${value}.`);
  // Date.UTC treats years 0–99 specially. setUTCFullYear also validates those years correctly.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Takvimde böyle bir gün yok: ${value}.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseRange(value, singleOnly = false) {
  const match = rangePattern.exec(value);
  if (!match) throw new Error('Tarih veya aralığı açık yıl ile yazın: 01.11.2026 veya 01.11.2026 - 05.11.2026.');
  if (singleOnly && match[2]) throw new Error('Nöbet aktarımında her satırda tek tarih olmalı; tarih aralığı kullanmayın.');
  const start = parseDate(match[1]);
  const end = match[2] ? parseDate(match[2]) : start;
  if (end < start) throw new Error('Bitiş tarihi başlangıç tarihinden önce olamaz.');
  return { start, end };
}

function getPerson(name, state) {
  if (!clean(name)) throw new Error('Kişi adı boş olamaz.');
  const matches = (state?.people ?? []).filter((person) => normalize(person.name) === normalize(name));
  if (!matches.length) throw new Error(`“${name}” kayıtlı kişi listesinde bulunamadı. Kayıtlı adını eksiksiz kullanın.`);
  if (matches.length !== 1) throw new Error(`“${name}” birden fazla kişiyle eşleşiyor. Önce kişi listesinde adları ayırt edin.`);
  return matches[0];
}

function getTogetherPeople(names, state) {
  const parts = names.split('+').map(clean);
  if (parts.length < 2) throw new Error('Birlikte isteği için en az iki kayıtlı adı + ile ayırın.');
  if (parts.some(name => !name)) throw new Error('Birlikte isteğinde + işaretinin iki yanında da kayıtlı bir ad olmalı.');
  const people = parts.map(name => getPerson(name, state));
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error('Birlikte isteğinde aynı kişi birden fazla kez yazılamaz.');
  // Keep reversed name lists identical for both batch and saved-record deduplication.
  return people.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function getSite(value) {
  const site = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'].find((name) => normalize(name) === normalize(value));
  if (!site) throw new Error(`“${value || '(boş)'}” hastanesi tanınmadı. Sancaktepe, Feriha Öz veya Çekmeköy yazın.`);
  return site;
}

const absenceTypes = new Map([
  ['yillik izin', 'annual'], ['yillik', 'annual'],
  ['mazeret izni', 'excused'], ['mazeret', 'excused'], ['rapor', 'excused'], ['raporlu', 'excused'],
  ['nobet muafiyeti', 'exempt'], ['muafiyet', 'exempt'], ['muaf', 'exempt'],
]);
const requestKinds = new Map([
  ['yazma', 'avoid'], ['yazilmasin', 'avoid'], ['istemiyor', 'avoid'],
  ['yaz', 'prefer'], ['yazilsin', 'prefer'], ['istiyor', 'prefer'],
  ['birlikte', 'together'],
]);
const absenceLabels = { annual: 'Yıllık izin', excused: 'Mazeret izni / rapor', exempt: 'Nöbet muafiyeti' };
const showDate = (date) => date.split('-').reverse().join('.');
const showRange = (start, end) => start === end ? showDate(start) : `${showDate(start)} – ${showDate(end)}`;

/**
 * Parse the documented input without changing state or assigning any shifts.
 * contextMonth is intentionally not used to infer missing years or relative dates.
 * A single invalid line makes records empty; preview still describes valid lines.
 */
export function parseImport(text, kind, state, contextMonth) {
  const result = { records: [], errors: [], preview: [] };
  if (!Object.hasOwn(FORMAT_HELP, kind)) {
    result.errors.push({ line: 0, message: 'Bilinmeyen içe aktarma türü.' });
    return result;
  }
  if (typeof text !== 'string' || !text.trim()) {
    result.errors.push({ line: 0, message: 'İçe aktarılacak satırları kutuya yapıştırın.' });
    return result;
  }
  const records = [];
  const peopleSeen = new Map();
  const dutiesSeen = new Map();
  const identicalSeen = new Set();
  text.replace(/^\uFEFF/u, '').split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    try {
      let columns = line.split('|').map(clean);
      if (kind === 'absence' && columns.length === 1) {
        const legacy = legacyPattern.exec(line);
        if (!legacy) throw new Error('İzin satırını “Tarih | Ad | İzin türü” biçiminde yazın. Eski tek tarihli “15.06.2026 Azmi yıllık izin” biçimi de kullanılabilir.');
        columns = legacy.slice(1);
      }
      const allowed = kind === 'people' ? [2] : kind === 'duty' ? [3] : [3, 4];
      if (!allowed.includes(columns.length)) {
        throw new Error(`Bu tür için ${allowed.join(' veya ')} alan gerekli; alanları | ile ayırın.`);
      }
      let record;
      let preview;
      if (kind === 'people') {
        const [name, rankText] = columns;
        if (!name || !/\p{L}/u.test(name)) throw new Error('Geçerli bir kişi adı yazın.');
        if (!/^[1-9]\d*$/u.test(rankText) || !Number.isSafeInteger(Number(rankText))) {
          throw new Error('Kıdem numarası 1 veya daha büyük bir tam sayı olmalı.');
        }
        const key = normalize(name);
        const matches = (state?.people ?? []).filter((person) => normalize(person.name) === key);
        if (matches.length > 1) throw new Error(`“${name}” birden fazla kayıtlı kişiyle eşleşiyor. Önce kişi listesinde adları ayırt edin.`);
        if (peopleSeen.has(key) && peopleSeen.get(key) !== Number(rankText)) {
          throw new Error(`“${name}” aynı metinde iki farklı kıdemle yazılmış.`);
        }
        peopleSeen.set(key, Number(rankText));
        record = { name: matches[0]?.name ?? name, rank: Number(rankText) };
        preview = `${record.name} · ${record.rank}. kıdem`;
      } else {
        const [dateText, name, value, note = ''] = columns;
        const { start, end } = parseRange(dateText, kind === 'duty');
        if (kind === 'request') {
          const requestKind = requestKinds.get(normalize(value));
          if (!requestKind) throw new Error('İstek türü tanınmadı. “yazma”, “yaz” veya “birlikte” kullanın.');
          if (requestKind === 'together') {
            const people = getTogetherPeople(name, state);
            record = { personId: people[0].id, personIds: people.map(person => person.id), start, end, kind: requestKind, note };
            preview = `${showRange(start, end)} · ${people.map(person => person.name).join(' + ')} · Birlikte nöbet istiyor${note ? ` · ${note}` : ''}`;
          } else {
            if (name.includes('+')) throw new Error('“Yaz” ve “yazma” isteklerinde her kişi için ayrı satır kullanın; ortak istek için türü “birlikte” yazın.');
            const person = getPerson(name, state);
            record = { personId: person.id, start, end, kind: requestKind, note };
            preview = `${showRange(start, end)} · ${person.name} · ${requestKind === 'avoid' ? 'Nöbet istemiyor' : 'Nöbet istiyor (otomatik eklenecek)'}${note ? ` · ${note}` : ''}`;
          }
        } else if (kind === 'absence') {
          const person = getPerson(name, state);
          const type = absenceTypes.get(normalize(value));
          if (!type) throw new Error('İzin türü tanınmadı. yıllık izin, mazeret izni veya nöbet muafiyeti yazın.');
          record = { personId: person.id, start, end, type, note };
          preview = `${showRange(start, end)} · ${person.name} · ${absenceLabels[type]}${note ? ` · ${note}` : ''}`;
        } else if (kind === 'rotation') {
          const person = getPerson(name, state);
          const postCallShorthand = isPostCallUnit(value);
          const postCall = postCallShorthand || isPostCallUnit(note);
          if (postCall) {
            const noHospital = ['', '-', '–', '—'].includes(value);
            if ((!postCallShorthand && !noHospital) || (postCallShorthand && note)) {
              throw new Error('Nöbet ertesi rotasyonunun hastanesi olamaz. “Tarih | Ad | - | Nöbet ertesi” biçimini kullanın.');
            }
            record = { personId: person.id, start, end, site: null, unit: POST_CALL_UNIT };
            preview = `${showRange(start, end)} · ${person.name} · ${POST_CALL_UNIT}`;
          } else {
            const site = getSite(value);
            record = { personId: person.id, start, end, site, unit: note };
            preview = `${showRange(start, end)} · ${person.name} · ${site}${note ? ` · ${note}` : ''}`;
          }
        } else {
          const person = getPerson(name, state);
          const site = getSite(value);
          const key = `${person.id}|${start}`;
          if (dutiesSeen.has(key) && dutiesSeen.get(key) !== site) {
            throw new Error(`${person.name}, ${showDate(start)} için birden fazla hastaneye yazılmış.`);
          }
          dutiesSeen.set(key, site);
          record = { personId: person.id, date: start, site, overrides: [] };
          preview = `${showDate(start)} · ${person.name} · ${site}`;
        }
      }
      const key = JSON.stringify(record);
      if (identicalSeen.has(key)) return;
      identicalSeen.add(key);
      records.push(kind === 'people' ? record : { id: makeId(), ...record });
      result.preview.push(preview);
    } catch (error) {
      result.errors.push({ line: index + 1, message: error.message });
    }
  });
  if (!result.errors.length) result.records = records;
  return result;
}
