import { isPostCallRotation, isPostCallUnit } from './rotations.js';
import { personGroupId, personRosterEnabled, groupActiveInMonth } from './person-history.js';

/** Shared structural validation for saves and imported backups. No warning is a save blocker. */
export function validateState(state) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== '0000';
  const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value.slice(0, 4) !== '0000';
  };
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const sites = new Set(['Sancaktepe', 'Feriha Öz', 'Çekmeköy']);
  if (!object(state)) return { valid: false, errors: ['Kayıt bir nesne olmalıdır.'] };
  if (state.schemaVersion !== 1) add('schemaVersion', 'Desteklenen sürüm 1 olmalıdır.');
  if (!timestamp(state.updatedAt)) add('updatedAt', 'Geçerli ISO zaman damgası gerekir.');
  const names = ['people', 'groups', 'targets', 'assignments', 'absences', 'requests', 'rotations', 'holidays'];
  if (state.capabilities !== undefined) names.push('capabilities');
  const rows = {};
  const ids = {};
  for (const name of names) {
    rows[name] = Array.isArray(state[name]) ? state[name] : [];
    ids[name] = new Set();
    if (!Array.isArray(state[name])) add(name, 'Liste olmalıdır.');
    rows[name].forEach((row, i) => {
      const path = `${name}[${i + 1}]`;
      if (!object(row)) return add(path, 'Nesne olmalıdır.');
      if (!text(row.id)) add(path, 'Kimlik boş olamaz.');
      else if (ids[name].has(row.id)) add(path, 'Kimlik tekrarlanmış.');
      else ids[name].add(row.id);
    });
    rows[name] = rows[name].filter(object);
  }
  const ref = (value, collection, path) => {
    if (!text(value) || !ids[collection].has(value)) add(path, 'Bağlı kayıt bulunamadı.');
  };
  const range = (row, path) => {
    if (!date(row.start) || !date(row.end) || row.start > row.end) add(path, 'Başlangıç ve bitiş geçerli ve sıralı tarihler olmalıdır.');
  };
  for (const row of rows.groups) {
    const path = `Kıdem ${row.id}`;
    if (!Number.isSafeInteger(row.order) || row.order < 1) add(path, 'Sıra pozitif tam sayı olmalıdır.');
    if (!month(row.from) || !(row.until === null || (month(row.until) && row.until > row.from))) add(path, 'Geçerlilik ayları hatalı.');
    if (row.rankHistory !== undefined) {
      if (!Array.isArray(row.rankHistory)) add(path, 'Kıdem sıra geçmişi liste olmalıdır.');
      else {
        let previousMonth = '';
        for (const entry of row.rankHistory) {
          if (!object(entry) || !month(entry.from) || !Number.isSafeInteger(entry.rank) || entry.rank < 1
            || entry.from < row.from || row.until !== null && entry.from >= row.until && !groupActiveInMonth(state, row, entry.from) || entry.from <= previousMonth) {
            add(path, 'Kıdem sıra geçmişi geçerli, tekil ve sıralı aylar içermelidir.');
          }
          previousMonth = entry?.from ?? previousMonth;
        }
      }
    }

  }
  for (const row of rows.people) {
    const path = `Kişi ${row.id}`;
    if (!text(row.name)) add(path, 'Ad boş olamaz.');
    ref(row.groupId, 'groups', path);
    if (!date(row.from) || !(row.until === null || (date(row.until) && row.until > row.from))) add(path, 'Geçerlilik tarihleri hatalı.');
    if (row.rosterHistory !== undefined) {
      if (!Array.isArray(row.rosterHistory)) add(path, 'Nöbet katılım geçmişi liste olmalıdır.');
      else {
        let previousMonth = '';
        for (const entry of row.rosterHistory) {
          if (!object(entry) || !month(entry.from) || typeof entry.enabled !== 'boolean' || entry.from <= previousMonth) add(path, 'Nöbet katılım geçmişi geçerli, tekil ve sıralı aylar içermelidir.');
          previousMonth = entry?.from ?? previousMonth;
        }
      }
    }
    if (row.groupHistory !== undefined) {
      if (!Array.isArray(row.groupHistory)) add(path, 'Kıdem geçmişi liste olmalıdır.');
      else {
        let previous = '';
        for (const entry of row.groupHistory) {
          if (!object(entry)) { add(path, 'Kıdem geçmişi kaydı nesne olmalıdır.'); continue; }
          if (!month(entry.from) || entry.from <= previous) add(path, 'Kıdem geçmişi ayları geçerli, tekil ve artan sırada olmalıdır.');
          if (month(entry.from)) previous = entry.from;
          ref(entry.groupId, 'groups', path);
        }
      }
    }
  }
  const targetKeys = new Set();
  for (const row of rows.targets) {
    const path = `Hedef ${row.id}`;
    const personTarget = row.groupId === null && text(row.personId);
    const groupTarget = row.personId === null && text(row.groupId);
    if (!personTarget && !groupTarget) add(path, 'Tam olarak bir kişi veya kıdem seçilmelidir.');
    if (personTarget) ref(row.personId, 'people', path);
    if (groupTarget) ref(row.groupId, 'groups', path);
    if (!month(row.from) || !number(row.weekday) || !number(row.weekend)) add(path, 'Ay ve negatif olmayan hedefler gerekir.');
    if (row.through != null && (!month(row.through) || row.through < row.from)) add(path, 'Bitiş ayı başlangıç ayından önce olamaz.');
    if (row.inherit !== undefined && typeof row.inherit !== 'boolean') add(path, 'Kıdem hedefine dönüş seçimi doğru veya yanlış olmalıdır.');
    if (row.inherit === true && (!personTarget || row.through != null || row.weekday !== 0 || row.weekend !== 0)) add(path, 'Kıdem hedefine dönüş yalnız kişiye, bitiş ayı olmadan tanımlanabilir.');
    const key = `${personTarget ? 'person' : 'group'}:${row.personId ?? row.groupId}:${row.from}`;
    if (targetKeys.has(key)) add(path, 'Aynı kişi veya kıdeme aynı ay için iki hedef tanımlanamaz.');
    targetKeys.add(key);
  }
  const capabilityKeys = new Set();
  for (const row of rows.capabilities ?? []) {
    const path = `Yetkinlik ${row.id}`;
    const personFlags = row.groupId === null && text(row.personId);
    const groupFlags = row.personId === null && text(row.groupId);
    if (!personFlags && !groupFlags) add(path, 'Tam olarak bir kişi veya kıdem seçilmelidir.');
    if (personFlags) ref(row.personId, 'people', path);
    if (groupFlags) ref(row.groupId, 'groups', path);
    if (!month(row.from)) add(path, 'Geçerli başlangıç ayı gerekir.');
    if (row.through != null && (!month(row.through) || row.through < row.from)) add(path, 'Bitiş ayı başlangıç ayından önce olamaz.');
    if (['triangle', 'square', 'circle', 'companion'].some(key => typeof row[key] !== 'boolean')) add(path, 'Dört yetkinlik işareti doğru veya yanlış olmalıdır.');
    if (row.triangle === true && row.circle !== true) add(path, 'Üçgenli asistan yuvarlaklı da olmalıdır.');
    if (row.companion === true && (row.triangle === true || row.square === true || row.circle === true)) add(path, 'Ç işareti diğer üç işaretle birlikte kullanılamaz.');
    if (row.inherit !== undefined && typeof row.inherit !== 'boolean') add(path, 'Kıdem işaretlerine dönüş seçimi doğru veya yanlış olmalıdır.');
    if (row.inherit === true && (!personFlags || row.through != null || row.triangle || row.square || row.circle || row.companion)) add(path, 'Kıdem işaretlerine dönüş yalnız kişiye, işaretler boş ve bitiş ayı olmadan tanımlanabilir.');
    const key = `${personFlags ? 'person' : 'group'}:${row.personId ?? row.groupId}:${row.from}`;
    if (capabilityKeys.has(key)) add(path, 'Aynı kişi veya kıdeme aynı ay için iki yetkinlik kaydı tanımlanamaz.');
    capabilityKeys.add(key);
  }
  if (state.planningSettings !== undefined) {
    const settings = state.planningSettings;
    if (!object(settings)) add('planningSettings', 'Ayarlar bir nesne olmalıdır.');
    else {
      for (const [key, minimum] of [['sancaktepeCount', 3], ['cekmekoyCount', 0], ['ferihaCapacity', 0]]) {
        if (settings[key] !== undefined && (!Number.isSafeInteger(settings[key]) || settings[key] < minimum)) add(`planningSettings.${key}`, `En az ${minimum} olan bir tam sayı gerekir.`);
      }
      if (settings.companions !== undefined) {
        if (!object(settings.companions)) add('planningSettings.companions', 'Hastane refakatçi sınırları bir nesne olmalıdır.');
        else for (const [site, bounds] of Object.entries(settings.companions)) {
          const path = `planningSettings.companions.${site}`;
          if (!sites.has(site)) add(path, 'Geçerli bir hastane gerekir.');
          if (!object(bounds)) { add(path, 'Alt ve üst sınırlar bir nesne olmalıdır.'); continue; }
          for (const key of ['min', 'max']) if (bounds[key] !== undefined && (!Number.isSafeInteger(bounds[key]) || bounds[key] < 0)) add(`${path}.${key}`, 'Negatif olmayan bir tam sayı gerekir.');
          const min = bounds.min ?? 0;
          const max = bounds.max ?? ({ 'Sancaktepe': 1, 'Feriha Öz': 3, 'Çekmeköy': 0 }[site]);
          if (min > max) add(path, 'Alt sınır üst sınırdan büyük olamaz.');
        }
      }
    }
  }
  for (const name of ['absences', 'requests', 'rotations']) {
    for (const row of rows[name]) {
      const path = `${name} ${row.id}`;
      ref(row.personId, 'people', path);
      range(row, path);
      if (name === 'absences' && !['annual', 'excused', 'exempt'].includes(row.type)) add(path, 'İzin türü hatalı.');
      if (name === 'absences' && row.zeroTarget !== undefined && (typeof row.zeroTarget !== 'boolean' || (row.zeroTarget && row.type !== 'exempt'))) add(path, 'Sıfır hedef seçimi yalnız nöbet muafiyetine uygulanabilir.');
      if (name === 'requests') {
        if (!['avoid', 'prefer', 'together'].includes(row.kind)) add(path, 'İstek türü hatalı.');
        if (row.kind === 'together') {
          if (!Array.isArray(row.personIds) || row.personIds.length < 2) add(path, 'Birlikte isteği en az iki farklı kişiyi içermelidir.');
          else {
            if (new Set(row.personIds).size !== row.personIds.length) add(path, 'Birlikte isteğinde aynı kişi tekrarlanamaz.');
            for (const personId of row.personIds) ref(personId, 'people', path);
            if (row.personId !== row.personIds[0]) add(path, 'Birlikte isteğinin bağlı kişisi listedeki ilk kişi olmalıdır.');
            if (row.personIds.some((personId, i) => i > 0 && row.personIds[i - 1] > personId)) add(path, 'Birlikte isteğinin kişi kimlikleri sıralı olmalıdır.');
          }
        } else if (row.personIds !== undefined) add(path, 'Kişi listesi yalnız birlikte isteğinde kullanılabilir.');
      }
      if (name !== 'rotations' && typeof row.note !== 'string') add(path, 'Not metin olmalıdır.');
      if (name === 'rotations' && !isPostCallRotation(row)
        && (!sites.has(row.site) || typeof row.unit !== 'string' || isPostCallUnit(row.unit))) {
        add(path, 'Hastane veya birim hatalı. Yalnız Nöbet ertesi rotasyonu hastanesiz olabilir.');
      }
    }
  }
  const holidayDates = new Set();
  for (const row of rows.holidays) {
    const path = `Tatil ${row.id}`;
    if (!date(row.date) || !text(row.name) || !number(row.weekdayCredit) || !number(row.weekendCredit)) add(path, 'Tarih, tatil adı ve negatif olmayan katkılar gerekir.');
    if (holidayDates.has(row.date)) add(path, 'Aynı tarihe iki tatil eklenemez.');
    holidayDates.add(row.date);
  }
  const people = new Map(rows.people.map(row => [row.id, row]));
  const groups = new Map(rows.groups.map(row => [row.id, row]));
  const personDates = new Map();
  for (const row of rows.assignments) {
    const path = `Nöbet ${row.id}`;
    ref(row.personId, 'people', path);
    if (!date(row.date) || !sites.has(row.site)) add(path, 'Tarih veya hastane hatalı.');
    if (!Array.isArray(row.overrides)) add(path, 'Onaylanan uyarılar liste olmalıdır.');
    const person = people.get(row.personId);
    if (person && date(row.date) && (row.date < person.from || (person.until !== null && row.date >= person.until && personRosterEnabled(person, row.date.slice(0, 7)) === null))) add(path, 'Kişi bu tarihte aktif değil.');
    const group = person && groups.get(personGroupId(person, row.date?.slice(0, 7)));
    if (group && date(row.date)) {
      const dutyMonth = row.date.slice(0, 7);
      if (dutyMonth < group.from || (group.until !== null && dutyMonth >= group.until && personRosterEnabled(person, dutyMonth) === null)) add(path, 'Kişinin kıdem grubu bu ayda aktif değil.');
    }
    if (!personDates.has(row.personId)) personDates.set(row.personId, []);
    if (date(row.date)) personDates.get(row.personId).push(row.date);
  }
  for (const [personId, dates] of personDates) {
    dates.sort();
    for (let i = 1; i < dates.length; i++) {
      const diff = (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86400000;
      if (diff === 0) add(people.get(personId)?.name ?? personId, `${dates[i]} tarihinde birden fazla nöbet olamaz.`);
      if (diff === 1) add(people.get(personId)?.name ?? personId, `${dates[i - 1]} ve ${dates[i]} ardışık günlerine nöbet yazılamaz.`);
    }
  }
  if (!object(state.months)) add('months', 'Ay kayıtları nesne olmalıdır.');
  else for (const [key, value] of Object.entries(state.months)) {
    if (!month(key) || !object(value) || !(value.completedAt === null || timestamp(value.completedAt))) add(`months.${key}`, 'Ay veya tamamlanma zamanı hatalı.');
    if (object(value) && value.weekendPairInitialized !== undefined && typeof value.weekendPairInitialized !== 'boolean') add(`months.${key}`, 'Hafta sonu eşleme durumu doğru veya yanlış olmalıdır.');
    if (object(value) && value.capabilityRulesEnabled !== undefined && typeof value.capabilityRulesEnabled !== 'boolean') add(`months.${key}`, 'Yetkinlik kontrolü doğru veya yanlış olmalıdır.');
  }
  return { valid: errors.length === 0, errors };
}
