import { uid, activeGroups, activePeople, rankOf, targetFor, hasFullMonthTargetExemption, daysInMonth, addDays, dayOfWeek, validateAssignment } from './domain.js';
import { FORMAT_HELP, parseImport } from './imports.js';
import { planRequestAssignments } from './request-assignment.js';
import { planAutoWeekend } from './weekend-pair.js';
import { capabilitiesFor, groupCapabilitiesFor, normalizeCapabilities, getPlanningSettings } from './capabilities.js';
import { buildRequestPrompt } from './request-prompt.js';
import { comparePeopleBySeniority, sortPeopleBySeniority } from './person-order.js';
import { POST_CALL_UNIT, POST_CALL_OPTION, isPostCallRotation, isPostCallUnit, rotationLabel } from './rotations.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const norm = value => String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/gu, 'i');
const pretty = value => value?.split('-').reverse().join('.') ?? '';
const warningText = warning => `${warning.date ? `${pretty(warning.date)} · ` : ''}${warning.message}`;
const number = value => String(value).replace('.', ',');
const targetSummary = target => `<strong>${number(target.weekday + target.weekend)} toplam nöbet</strong> · ${number(target.weekend)} hafta sonu`;
const compactTarget = target => `${number(target.weekday + target.weekend)} nöbet · ${number(target.weekend)} HS`;
const label = { annual: 'Yıllık izin', excused: 'Mazeret izni', exempt: 'Nöbet muafiyeti', avoid: 'Yazılmasın', prefer: 'Yazılsın', together: 'Birlikte' };
const collections = { absence: 'absences', request: 'requests', rotation: 'rotations', duty: 'assignments' };
const personName = (state, id) => state.people.find(person => person.id === id)?.name ?? 'Kayıtlı kişi';
const personForOrder = (state, id) => state.people.find(person => person.id === id) ?? { id, name: personName(state, id) };
const orderedRecordPeople = (state, month, record) => sortPeopleBySeniority(state, month,
  (record.kind === 'together' ? record.personIds : [record.personId]).map(id => personForOrder(state, id)));
const requestNames = (state, month, record) => orderedRecordPeople(state, month, record).map(person => person.name).join(' + ');
const button = (text, action, attrs = '', primary = false) => `<button type="button" class="btn${primary ? ' primary' : ''}" data-action="${action}" ${attrs}>${esc(text)}</button>`;
const field = (title, input) => `<label class="field"><span>${esc(title)}</span>${input}</label>`;
const input = (name, value = '', type = 'text', extra = '') => `<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
const select = (name, options, value = '') => `<select name="${name}">${options.map(([key, text]) => `<option value="${esc(key)}"${String(key) === String(value) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
const empty = text => `<p class="empty">${esc(text)}</p>`;
const period = (start, end) => start === end ? pretty(start) : `${pretty(start)} – ${pretty(end)}`;
const insideMonth = (record, month) => record.start <= daysInMonth(month).at(-1) && record.end >= `${month}-01`;
const heading = (title, description, actions = '') => `<div class="section-head"><div><h2>${esc(title)}</h2><p class="muted">${esc(description)}</p></div><div>${actions}</div></div>`;
const bulkButton = (kind, text = 'Toplu aktar') => button(text, 'mg-import', `data-kind="${kind}"`);
const optionsPeople = (state, month) => sortPeopleBySeniority(state, month, activePeople(state, month)).map(person => [person.id, person.name]);
const siteOptions = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'].map(site => [site, site]);
const rotationOptions = [...siteOptions, [POST_CALL_OPTION, `${POST_CALL_UNIT} (hastanesiz)`]];
const rotationValue = record => isPostCallRotation(record) ? POST_CALL_OPTION : record?.site ?? '';
const rotationDescription = record => `${rotationLabel(record)}${record.site && record.unit ? ` / ${record.unit}` : ''}${isPostCallRotation(record) ? ' (hastanesiz)' : ''}`;
let requestDefaultSite = 'Sancaktepe';
const requestSiteField = () => field('Rotasyon hastanesi yoksa nöbet hastanesi', select('fallbackSite', siteOptions, requestDefaultSite));
const byDate = (a, b) => (a.start ?? a.date).localeCompare(b.start ?? b.date);
function byPerson(state, month) {
  const compare = comparePeopleBySeniority(state, month);
  return (a, b) => {
    const left = orderedRecordPeople(state, month, a), right = orderedRecordPeople(state, month, b);
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      const order = compare(left[index], right[index]);
      if (order) return order;
    }
    return left.length - right.length || byDate(a, b) || (a.end ?? a.date).localeCompare(b.end ?? b.date);
  };
}
function importPreview(state, month, parsed) {
  const compare = byPerson(state, month);
  return parsed.records.map((record, index) => ({ record, line: record.kind === 'together'
    ? `${period(record.start, record.end)} · ${requestNames(state, month, record)} · Birlikte nöbet istiyor${record.note ? ` · ${record.note}` : ''}`
    : isPostCallRotation(record) ? `${period(record.start, record.end)} · ${personName(state, record.personId)} · ${rotationDescription(record)}` : parsed.preview[index] })).sort((a, b) => a.record.rank
    ? a.record.rank - b.record.rank || a.record.name.localeCompare(b.record.name, 'tr')
    : compare(a.record, b.record)).map(item => item.line);
}
const table = (headers, rows) => `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const latestTarget = (state, groupId, personId, month) => {
  const candidates = state.targets.filter(target => target.from <= month
    && (personId ? target.personId === personId : !target.personId && target.groupId === groupId))
    .sort((a, b) => b.from.localeCompare(a.from));
  return personId ? candidates[0] && (!candidates[0].through || month <= candidates[0].through) ? candidates[0] : null
    : candidates.find(target => !target.through || month <= target.through);
};

const capabilityOptions = [
  ['triangle', '▲', 'KVC anestezisi'],
  ['square', '■', 'Feriha Öz iki alan'],
  ['circle', '●', 'Sancaktepe ikinci kişi'],
  ['companion', 'Ç', 'Refakatçi'],
];
const capabilityRecord = (state, groupId, personId, month) => {
  const records = (state.capabilities ?? []).filter(record => record.from <= month
    && (personId ? record.personId === personId : !record.personId && record.groupId === groupId))
    .sort((a, b) => b.from.localeCompare(a.from));
  return personId ? records[0] && (!records[0].through || month <= records[0].through) ? records[0] : null
    : records.find(record => !record.through || month <= record.through) ?? null;
};

function capabilityControls(flags, { personId = null, groupId = null, modal = false, name = '' } = {}) {
  const normalized = normalizeCapabilities(flags);
  const attrs = personId ? ` data-person-id="${esc(personId)}"` : groupId ? ` data-group-id="${esc(groupId)}"` : '';
  return `<div class="capability-controls"${modal ? ' data-capability-form' : ''} role="group" aria-label="${esc(name ? `${name} yetkinlikleri` : 'Yetkinlikler')}">${capabilityOptions.map(([key, symbol, title]) => `<label class="capability-check${key === 'companion' ? ' capability-companion' : ''}" title="${esc(title)}"><input type="checkbox"${modal ? ` name="${key}"` : ''} data-capability="${key}"${attrs} aria-label="${esc(name ? `${name} · ${title}` : title)}"${normalized[key] ? ' checked' : ''}${key !== 'companion' && normalized.companion || key === 'circle' && normalized.triangle ? ' disabled' : ''}><span aria-hidden="true">${symbol}</span></label>`).join('')}</div>`;
}

function putCapabilities(next, { personId = null, groupId = null, from, through = null, inherit = false, ...flags }) {
  const matches = record => record.from === from && (personId ? record.personId === personId : !record.personId && record.groupId === groupId);
  next.capabilities = (next.capabilities ?? []).filter(record => !matches(record));
  next.capabilities.push({ id: uid(), personId, groupId, from, through, ...normalizeCapabilities(flags), ...(inherit ? { inherit: true } : {}) });
}

export function updateCapabilityControls(form, changedInput = null) {
  const controls = [...form.querySelectorAll('[data-capability]')];
  if (!controls.length) return;
  const elements = Object.fromEntries(controls.map(control => [control.dataset.capability, control]));
  const changed = changedInput?.dataset?.capability;
  if (changed === 'companion' && changedInput.checked) for (const [key, control] of Object.entries(elements)) if (key !== 'companion') control.checked = false;
  if (changed && changed !== 'companion' && changedInput.checked && elements.companion) elements.companion.checked = false;
  const flags = normalizeCapabilities(Object.fromEntries(Object.entries(elements).map(([key, control]) => [key, control.checked])));
  const inherit = form.elements?.namedItem('mode')?.value === 'inherit';
  for (const [key, control] of Object.entries(elements)) {
    control.checked = flags[key];
    control.disabled = inherit || key !== 'companion' && flags.companion || key === 'circle' && flags.triangle;
  }
}

export async function handleCapabilityChange(element, ctx) {
  const key = element?.dataset?.capability;
  if (!capabilityOptions.some(([value]) => value === key)) return false;
  const personId = element.dataset.personId || null, groupId = element.dataset.groupId || null;
  if (!personId && !groupId) return false;
  if (personId && !activePeople(ctx.state, ctx.month).some(person => person.id === personId)
    || groupId && !activeGroups(ctx.state, ctx.month).some(group => group.id === groupId)) return false;
  const flags = { ...(personId ? capabilitiesFor(ctx.state, personId, ctx.month) : groupCapabilitiesFor(ctx.state, groupId, ctx.month)), [key]: !!element.checked };
  if (element.checked) {
    if (key === 'companion') {
      for (const [other] of capabilityOptions) if (other !== 'companion') flags[other] = false;
    } else flags.companion = false;
  }
  const existing = capabilityRecord(ctx.state, groupId, personId, ctx.month);
  await ctx.commit(next => putCapabilities(next, { personId, groupId, from: ctx.month,
    through: existing?.from === ctx.month ? existing.through ?? null : null, ...normalizeCapabilities(flags) }), 'Yetkinlikler güncellendi.');
  return true;
}

function renderPeople(state, month) {
  const groups = activeGroups(state, month);
  const people = sortPeopleBySeniority(state, month, activePeople(state, month));
  const cards = groups.map(group => {
    const members = people.filter(person => person.groupId === group.id);
    const target = latestTarget(state, group.id, null, month);
    return `<section class="panel"><div class="section-head"><div><h3>${rankOf(state, group.id, month)}. kıdem <span class="pill">${members.length} kişi</span></h3><p class="muted">${target ? `Hedef: ${targetSummary(target)}` : 'Nöbet hedefi henüz girilmedi'}</p>${capabilityControls(groupCapabilitiesFor(state, group.id, month), { groupId: group.id, name: `${rankOf(state, group.id, month)}. kıdem` })}</div><div>${button('Yetkinlik', 'mg-capabilities', `data-group-id="${esc(group.id)}"`)} ${button('Kıdem hedefi', 'mg-target', `data-group-id="${esc(group.id)}"`)} ${button('Kıdemi mezun et', 'mg-retire-group', `data-id="${esc(group.id)}"`)}</div></div><div class="group-grid">${members.map(person => {
      const own = latestTarget(state, null, person.id, month);
      const effective = targetFor(state, person.id, month);
      return `<div class="person-row">${capabilityControls(capabilitiesFor(state, person.id, month), { personId: person.id, name: person.name })}<div><strong>${esc(person.name)}</strong><div class="muted" title="${effective ? hasFullMonthTargetExemption(state, person.id, month) ? 'Muafiyet hedefi' : own && !own.inherit ? 'Kişisel hedef' : 'Kıdem hedefi' : ''}">${effective ? compactTarget(effective) : 'Hedef bekliyor'}</div></div><div class="person-actions">${button('⋯', 'mg-capabilities', `data-person-id="${esc(person.id)}" title="${esc(person.name)} yetkinlik ayrıntıları" aria-label="${esc(person.name)} yetkinlik ayrıntıları"`)} ${button('Hedef', 'mg-target', `data-person-id="${esc(person.id)}"`)} ${button('Arşivle', 'mg-retire-person', `data-id="${esc(person.id)}"`)}</div></div>`;
    }).join('') || empty('Bu kıdemde henüz kişi yok.')}</div></section>`;
  }).join('');
  const archived = sortPeopleBySeniority(state, month, state.people.filter(person => person.until && person.until <= `${month}-01`));
  return `${heading('Asistanlar ve hedefler', `${month} için ${people.length} aktif kişi · ${groups.length} kıdem. Hedefler seçtiğiniz aydan itibaren geçerli olur.`, `${bulkButton('people')} ${button('Kıdem ekle', 'mg-add-group')} ${button('Kişi ekle', 'mg-add-person', '', true)}`)}${cards}${archived.length ? `<details class="panel"><summary>Arşivdeki ${archived.length} kişi</summary><p class="muted">${archived.map(person => `${esc(person.name)} (${pretty(person.until)} itibarıyla)`).join(' · ')}</p></details>` : ''}`;
}

function recordRows(state, month, rows, collection) {
  return rows.slice().sort(byPerson(state, month)).map(record => `<tr><td><strong>${esc(personName(state, record.personId))}</strong></td><td>${esc(period(record.start, record.end))}</td><td><span class="pill">${esc(label[record.type ?? record.kind])}${record.zeroTarget ? ' · tam ay 0 hedef' : ''}</span></td><td>${esc(record.note || '—')}</td><td>${button('Düzenle', 'mg-edit-record', `data-collection="${collection}" data-id="${esc(record.id)}"`)} ${button('Sil', 'mg-delete-record', `data-collection="${collection}" data-id="${esc(record.id)}"`)}</td></tr>`);
}

function renderRecords(state, month) {
  const absences = state.absences.filter(record => insideMonth(record, month));
  const requests = state.requests.filter(record => record.kind !== 'together' && insideMonth(record, month));
  const together = state.requests.filter(record => record.kind === 'together' && insideMonth(record, month));
  const togetherRows = together.slice().sort(byPerson(state, month)).map(record => `<tr><td><strong>${esc(requestNames(state, month, record))}</strong></td><td>${esc(period(record.start, record.end))}</td><td>${esc(record.note || '—')}</td><td>${button('Düzenle', 'mg-edit-record', `data-collection="requests" data-id="${esc(record.id)}"`)} ${button('Sil', 'mg-delete-record', `data-collection="requests" data-id="${esc(record.id)}"`)}</td></tr>`);
  return `${heading('İzinler ve nöbet istekleri', `${month} ile kesişen kayıtlar. İzin, muafiyet ve yazılmasın isteği atama sırasında onayınızla aşılabilir.`, bulkButton('duty', 'Geçmiş nöbetleri aktar'))}<section class="panel">${heading('İzin ve muafiyet', 'Kişi ve tarih aralığıyla ekleyin; iki uç gün de dahildir.', `${bulkButton('absence')} ${button('İzin / muafiyet ekle', 'mg-add-record', 'data-kind="absence"', true)}`)}${absences.length ? table(['Kişi', 'Tarih', 'Tür', 'Açıklama', 'İşlem'], recordRows(state, month, absences, 'absences')) : empty('Bu ay için izin veya muafiyet kaydı yok.')}</section><section class="panel">${heading('Nöbet istekleri', '“Yazılsın” kaydedildiğinde istenen günlere nöbet eklenir. Hastane rotasyondan alınır; rotasyonu veya rotasyon hastanesi yoksa seçtiğiniz hastane kullanılır. Eklenen nöbeti plandan kaldırabilirsiniz.', `${requests.some(record => record.kind === 'prefer') ? button('Yazılsın isteklerini uygula', 'mg-apply-requests') : ''} ${bulkButton('request')} ${button('Talimat', 'mg-copy-request-prompt')} ${button('İstek ekle', 'mg-add-record', 'data-kind="request"', true)}`)}${requests.length ? table(['Kişi', 'Tarih', 'İstek', 'Açıklama', 'İşlem'], recordRows(state, month, requests, 'requests')) : empty('Bu ay için nöbet isteği kaydı yok.')}</section><section class="panel">${heading('Birlikte nöbet istekleri', 'Aynı gün, farklı hastanelerde olabilir. Biri yazılınca diğerleri planlayıcıda istekler arasında görünür.', button('Birlikte istek ekle', 'mg-add-together-request', '', true))}${togetherRows.length ? table(['Kişiler', 'Tarih', 'Açıklama', 'İşlem'], togetherRows) : empty('Bu ay için birlikte nöbet isteği yok.')}</section>`;
}

function renderRotations(state, month) {
  const rows = state.rotations.filter(record => insideMonth(record, month)).sort(byPerson(state, month));
  return `${heading('Gündüz rotasyonları', 'Rotasyon hastanesi, nöbet yerleştirirken bir tercihtir. Nöbet ertesi hastanesiz kaydedilir. Aynı tarihlerde çelişen rotasyonlar kaydedilmez.', `${bulkButton('rotation')} ${button('Dönemi topluca düzenle', 'mg-bulk-rotations', '', true)} ${button('Rotasyon ekle', 'mg-add-record', 'data-kind="rotation"')}`)}<section class="panel">${rows.length ? table(['Kişi', 'Dönem', 'Hastane', 'Birim', 'İşlem'], rows.map(record => `<tr><td><strong>${esc(personName(state, record.personId))}</strong></td><td>${esc(period(record.start, record.end))}</td><td>${isPostCallRotation(record) ? '<span class="rotation-location" data-rotation-site="post-call">Hastanesiz</span>' : esc(record.site)}</td><td>${esc(record.unit || '—')}</td><td>${button('Düzenle', 'mg-edit-record', `data-collection="rotations" data-id="${esc(record.id)}"`)} ${button('Sil', 'mg-delete-record', `data-collection="rotations" data-id="${esc(record.id)}"`)}</td></tr>`)) : empty('Bu ay için rotasyon tanımlanmadı.')}</section>`;
}

function rotationPeriodPeople(state, start, end) {
  const groups = new Map(state.groups.map(group => [group.id, group]));
  return state.people.filter(person => {
    const group = groups.get(person.groupId);
    if (!group) return false;
    const first = [start, person.from, `${group.from}-01`].sort().at(-1);
    return first <= end && (!person.until || first < person.until) && (!group.until || first < `${group.until}-01`);
  }).sort(comparePeopleBySeniority(state, start.slice(0, 7)));
}

function bulkRotationPeriodDialog(ctx) {
  const endOfNextMonth = month => daysInMonth(addDays(daysInMonth(month).at(-1), 1).slice(0, 7)).at(-1);
  const periods = new Map();
  for (const record of ctx.state.rotations.filter(record => insideMonth(record, ctx.month))) {
    if (!record.start.endsWith('-01') || record.end !== endOfNextMonth(record.start.slice(0, 7))) continue;
    const key = `${record.start}|${record.end}`;
    periods.set(key, (periods.get(key) ?? 0) + 1);
  }
  const common = [...periods].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0].split('|');
  const start = common?.[0] ?? `${ctx.month}-01`;
  const end = common?.[1] ?? endOfNextMonth(ctx.month);
  ctx.dialog({ title: 'Toplu rotasyon · Dönem', confirmLabel: 'Kişileri göster', body: `<div class="form-grid">${field('Başlangıç (dahil)', input('start', start, 'date', 'required'))}${field('Bitiş (dahil)', input('end', end, 'date', 'required'))}</div>`, onConfirm: async data => {
    const start = data.get('start'), end = data.get('end');
    if (!isDate(start) || !isDate(end) || end < start) return fail(ctx, 'Sıralı, geçerli başlangıç ve bitiş tarihleri seçin.');
    bulkRotationRowsDialog(ctx, start, end);
    return false;
  } });
}

function bulkRotationRowsDialog(ctx, start, end) {
  const members = rotationPeriodPeople(ctx.state, start, end);
  if (!members.length) return fail(ctx, 'Bu dönemde aktif kişi yok.');
  const original = JSON.stringify(ctx.state);
  const existingRows = new Map(members.map(person => [person.id, ctx.state.rotations.find(record => record.personId === person.id && record.start === start && record.end === end)]));
  const rows = members.map(person => {
    const existing = existingRows.get(person.id);
    return `<tr><td><strong class="rotation-bulk-person">${esc(person.name)}</strong></td><td><select name="site:${esc(person.id)}" aria-label="${esc(person.name)} hastane">${[['', 'Değiştirme / atla'], ...rotationOptions].map(([value, title]) => `<option value="${esc(value)}"${value === rotationValue(existing) ? ' selected' : ''}>${esc(title)}</option>`).join('')}</select></td><td><input name="unit:${esc(person.id)}" value="${esc(existing?.unit ?? '')}" aria-label="${esc(person.name)} birim" placeholder="İsteğe bağlı" autocomplete="off"></td></tr>`;
  });
  ctx.dialog({ title: 'Rotasyonları topluca düzenle', confirmLabel: 'Önizlemeyi göster', body: `<p><strong>${esc(period(start, end))}</strong> · ${members.length} kişi</p><p class="muted">Aynı dönemin kayıtları hazır gelir. Hastanesi boş satırlar değiştirilmez.</p><div class="table-wrap rotation-bulk-wrap"><table class="data-table rotation-bulk-table"><thead><tr><th>Kişi</th><th>Hastane</th><th>Birim</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`, onConfirm: async data => {
    if (JSON.stringify(ctx.state) !== original) return fail(ctx, 'Kayıtlar değişti. Toplu rotasyon tablosunu yeniden açın.');
    const updates = [], errors = [];
    for (const person of members) {
      const selection = String(data.get(`site:${person.id}`) ?? '');
      if (!selection) continue;
      if (!rotationOptions.some(([value]) => value === selection)) { errors.push(`${person.name}: Geçerli bir hastane veya Nöbet ertesi seçin.`); continue; }
      const site = selection === POST_CALL_OPTION ? null : selection;
      const unit = selection === POST_CALL_OPTION ? POST_CALL_UNIT : String(data.get(`unit:${person.id}`) ?? '').trim();
      if (site && isPostCallUnit(unit)) { errors.push(`${person.name}: Nöbet ertesi için hastane listesinden “Nöbet ertesi (hastanesiz)” seçin.`); continue; }
      const existing = existingRows.get(person.id);
      if (existing && existing.site === site && existing.unit === unit) continue;
      updates.push({ id: existing?.id ?? uid(), personId: person.id, start, end, site, unit });
    }
    const replacing = new Set(updates.map(record => record.id));
    const retained = ctx.state.rotations.filter(record => !replacing.has(record.id));
    for (const record of updates) {
      if (rotationConflict([...retained, ...updates.filter(item => item.id !== record.id)], record)) errors.push(`${personName(ctx.state, record.personId)}: Seçilen dönem mevcut farklı hastane/birim rotasyonuyla çakışıyor. Mevcut dönemi düzenleyin.`);
    }
    if (errors.length) return showErrors(ctx, errors.map(message => ({ message })));
    if (!updates.length) return fail(ctx, 'Kaydedilecek yeni veya değişen rotasyon yok.');
    const changed = updates.filter(record => existingRows.get(record.personId)).length;
    ctx.dialog({ title: 'Rotasyon önizlemesi', confirmLabel: `${updates.length} rotasyonu kaydet`, body: `<p><strong>${esc(period(start, end))}</strong> · ${updates.length - changed} yeni, ${changed} güncellenecek</p><div class="issues-scroll"><ul>${updates.map(record => `<li><strong>${esc(personName(ctx.state, record.personId))}</strong> · ${esc(rotationDescription(record))}</li>`).join('')}</ul></div>`, onConfirm: async () => {
      if (JSON.stringify(ctx.state) !== original) return fail(ctx, 'Önizlemeden sonra kayıtlar değişti. Yeniden önizleme oluşturun.');
      await ctx.commit(next => { next.rotations = [...retained, ...updates]; }, `${updates.length} rotasyon kaydedildi.`);
    } });
    return false;
  } });
}

function renderHolidays(state, month) {
  const rows = state.holidays.filter(record => record.date.startsWith(month)).sort(byDate);
  return `${heading('Tatil günleri', 'Tatil nöbetleri adı ve tarihiyle ayrı sayılır. Hafta içi tatiller varsayılan olarak yalnız tatil sayacına eklenir.', button('Tatil günü ekle', 'mg-add-holiday', '', true))}<section class="panel"><p class="notice">Cuma ve pazar toplamda birer nöbet, hafta sonunda 0,5 puandır; cumartesi ikisinde de 1 sayılır. Hafta içine gelen tatillerin hedef katkısını ayrıca ayarlayabilirsiniz.</p>${rows.length ? table(['Tarih', 'Tatil', 'Toplam hedefe katkı', 'Hafta sonu puanı', 'İşlem'], rows.map(record => {
    const dow = dayOfWeek(record.date), weekend = [0, 5, 6].includes(dow);
    return `<tr><td>${pretty(record.date)}</td><td><strong>${esc(record.name)}</strong></td><td>${weekend ? '1 (güne göre)' : number(record.weekdayCredit + record.weekendCredit)}</td><td>${weekend ? `${dow === 6 ? '1' : '0,5'} (güne göre)` : number(record.weekendCredit)}</td><td>${button('Düzenle', 'mg-edit-holiday', `data-id="${esc(record.id)}"`)} ${button('Sil', 'mg-delete-record', `data-collection="holidays" data-id="${esc(record.id)}"`)}</td></tr>`;
  })) : empty('Bu ay için tatil günü tanımlanmadı.')}</section>`;
}

function renderSettings(state) {
  const settings = getPlanningSettings(state);
  return `${heading('Ayarlar', 'Elle planlamada ekip kontrolleri.')}<section class="panel"><form data-planning-settings><div class="form-grid">${field('Sancaktepe kontrol eşiği', input('sancaktepeCount', settings.sancaktepeCount, 'number', 'min="3" step="1" required'))}${field('Feriha Öz alan hedefi', input('ferihaCapacity', settings.ferihaCapacity, 'number', 'min="0" step="1" required'))}</div><div class="settings-actions">${button('Ayarları kaydet', 'mg-save-settings', '', true)}</div></form></section>`;
}

export function renderManagement(state, month, view) {
  if (view === 'people') return renderPeople(state, month);
  if (view === 'records') return renderRecords(state, month);
  if (view === 'rotations') return renderRotations(state, month);
  if (view === 'holidays') return renderHolidays(state, month);
  if (view === 'settings') return renderSettings(state);
  return '';
}

function fail(ctx, message) { ctx.toast(message); return false; }
function isMonth(value) { try { return daysInMonth(value).length > 0; } catch { return false; } }
function isDate(value) { try { dayOfWeek(value); return true; } catch { return false; } }
function showErrors(ctx, errors) { return fail(ctx, errors.map(error => error.line ? `Satır ${error.line}: ${error.message}` : error.message).join('\n')); }
function duplicateOf(records, record) {
  const comparable = value => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && key !== 'overrides').sort(([a], [b]) => a.localeCompare(b))));
  return records.some(existing => comparable(existing) === comparable(record));
}
function rotationConflict(records, candidate, ignoreId = null) {
  return records.find(existing => existing.id !== ignoreId && existing.personId === candidate.personId && existing.start <= candidate.end && candidate.start <= existing.end && (existing.site !== candidate.site || norm(existing.unit) !== norm(candidate.unit)));
}

function capabilityDialog(ctx, element) {
  const personId = element.dataset.personId || null, groupId = element.dataset.groupId || null;
  if (!personId && !groupId) return;
  const existing = capabilityRecord(ctx.state, groupId, personId, ctx.month);
  const name = personId ? personName(ctx.state, personId) : `${rankOf(ctx.state, groupId, ctx.month)}. kıdem`;
  const flags = personId ? capabilitiesFor(ctx.state, personId, ctx.month) : groupCapabilitiesFor(ctx.state, groupId, ctx.month);
  ctx.dialog({ title: `${name} · Yetkinlik`, confirmLabel: 'Kaydet', body: `<div class="form-grid">${personId ? field('Uygulama', select('mode', [['custom', 'Kişisel işaretler'], ['inherit', 'Kıdem işaretlerine dön']], existing?.inherit ? 'inherit' : 'custom')) : ''}${field('Başlangıç ayı', input('from', ctx.month, 'month', 'required'))}${field('Bitiş ayı (isteğe bağlı)', input('through', existing?.through ?? '', 'month'))}</div>${capabilityControls(flags, { modal: true, name })}<p class="muted">▲ KVC · ■ Feriha iki alan · ● Sancak ikinci kişi · Ç refakatçi</p>`, onConfirm: async data => {
    const from = data.get('from'), through = String(data.get('through') ?? '').trim() || null;
    const inherit = !!personId && data.get('mode') === 'inherit';
    if (!isMonth(from)) return fail(ctx, 'Geçerli bir başlangıç ayı seçin.');
    if (through && (!isMonth(through) || through < from)) return fail(ctx, 'Bitiş ayı başlangıç ayından önce olamaz.');
    const flags = inherit ? normalizeCapabilities({}) : normalizeCapabilities(Object.fromEntries(capabilityOptions.map(([key]) => [key, data.has(key)])));
    await ctx.commit(next => putCapabilities(next, { personId, groupId, from, through, inherit, ...flags }), `${name} yetkinlikleri güncellendi.`);
  } });
}

async function saveSettings(ctx, element) {
  const form = element.closest('[data-planning-settings]');
  if (!form) return fail(ctx, 'Ayar formu bulunamadı.');
  const value = name => {
    const raw = String(form.elements.namedItem(name)?.value ?? '').trim();
    return raw === '' ? NaN : Number(raw);
  };
  const sancaktepeCount = value('sancaktepeCount'), ferihaCapacity = value('ferihaCapacity');
  const counts = { sancaktepeCount, ferihaCapacity };
  if (Object.entries(counts).some(([key, amount]) => !Number.isSafeInteger(amount) || amount < (key === 'sancaktepeCount' ? 3 : 0))) return fail(ctx, 'Günlük ihtiyaçları geçerli tam sayılarla girin.');
  await ctx.commit(next => { next.planningSettings = { ...next.planningSettings, ...counts }; }, 'Ayarlar kaydedildi.');
}

export function updateTargetPreview(form) {
  const output = form.querySelector('[data-target-total]');
  if (!output) return;
  const value = name => String(form.elements.namedItem(name)?.value ?? '').trim();
  if (value('mode') === 'inherit') {
    output.textContent = 'Kıdem hedefi uygulanır.';
    return;
  }
  const total = value('total'), weekend = value('weekend');
  output.textContent = total && weekend && [Number(total), Number(weekend)].every(amount => Number.isFinite(amount) && amount >= 0) && Number(weekend) <= Number(total)
    ? `${number(Number(total))} toplam nöbet · ${number(Number(weekend))} hafta sonu`
    : 'Toplam hedef için iki sayıyı da girin.';
}

function targetDialog(ctx, element) {
  const personId = element.dataset.personId || null;
  const groupId = element.dataset.groupId || null;
  const state = ctx.state, month = ctx.month;
  const target = latestTarget(state, groupId, personId, month);
  const name = personId ? personName(state, personId) : `${rankOf(state, groupId, month)}. kıdem`;
  const mode = personId && target?.inherit ? 'inherit' : 'custom';
  ctx.dialog({ title: `${name} · Nöbet hedefi`, confirmLabel: 'Hedefi kaydet', body: `<div class="form-grid">${personId ? field('Hedef türü', select('mode', [['custom', 'Kişisel hedef'], ['inherit', 'Kıdem hedefine dön']], mode)) : ''}${field('Başlangıç ayı', input('from', month, 'month', 'required'))}${field('Bitiş ayı (isteğe bağlı)', input('through', target?.through ?? '', 'month'))}${field('Toplam nöbet', input('total', target && !target.inherit ? target.weekday + target.weekend : '', 'number', 'min="0" step="0.5"'))}${field('Hafta sonu', input('weekend', target && !target.inherit ? target.weekend : '', 'number', 'min="0" step="0.5"'))}</div><p><strong data-target-total aria-live="polite">${target && !target.inherit ? `${number(target.weekday + target.weekend)} toplam nöbet · ${number(target.weekend)} hafta sonu` : mode === 'inherit' ? 'Kıdem hedefi uygulanır.' : 'İki hedefi de girin.'}</strong></p><p class="muted">Hafta sonu toplamın içindedir. Cuma/pazar: 1 nöbet, 0,5 hafta sonu.</p><p class="muted">${personId ? 'Bitiş ayı dahil geçerlidir; ardından güncel kıdem hedefine döner.' : 'Bitiş ayı dahil geçerlidir; ardından önceki kıdem hedefi uygulanır.'} Bitişi boş bırakırsanız hedef devam eder. İki nöbet alanını boş bırakmak bu başlangıç ayındaki hedefi kaldırır.</p>`, onConfirm: async data => {
    const from = data.get('from'), through = String(data.get('through') ?? '').trim() || null;
    const inherit = !!personId && data.get('mode') === 'inherit';
    const total = String(data.get('total') ?? '').trim(), weekend = String(data.get('weekend') ?? '').trim();
    if (!isMonth(from)) return fail(ctx, 'Geçerli bir başlangıç ayı seçin.');
    if (!inherit && through && (!isMonth(through) || through < from)) return fail(ctx, 'Bitiş ayı başlangıç ayından önce olamaz.');
    if (!inherit && (!total) !== (!weekend)) return fail(ctx, 'İki hedefi birlikte doldurun veya ikisini birlikte boş bırakın.');
    if (!inherit && total && (![Number(total), Number(weekend)].every(value => Number.isFinite(value) && value >= 0))) return fail(ctx, 'Hedefler sıfır veya daha büyük sayılar olmalı.');
    if (!inherit && total && Number(weekend) > Number(total)) return fail(ctx, 'Hafta sonu hedefi toplam nöbetten fazla olamaz.');
    await ctx.commit(next => {
      const matches = target => target.from === from && (personId ? target.personId === personId : !target.personId && target.groupId === groupId);
      next.targets = next.targets.filter(target => !matches(target));
      if (inherit) next.targets.push({ id: uid(), personId, groupId, from, weekday: 0, weekend: 0, inherit: true });
      else if (total) next.targets.push({ id: uid(), personId, groupId, from, through, weekday: Number(total) - Number(weekend), weekend: Number(weekend) });
    }, `${name} hedefi güncellendi.`);
  } });
}

function addPersonDialog(ctx) {
  const groups = activeGroups(ctx.state, ctx.month);
  if (!groups.length) return fail(ctx, 'Önce bir kıdem grubu ekleyin.');
  ctx.dialog({ title: 'Asistan ekle', confirmLabel: 'Kişiyi ekle', body: `<div class="form-grid">${field('Kayıtlı ad', input('name', '', 'text', 'required autocomplete="off"'))}${field('Kıdem', select('groupId', groups.map((group, i) => [group.id, `${i + 1}. kıdem`])))}${field('Başlangıç tarihi', input('from', `${ctx.month}-01`, 'date', 'required'))}</div>`, onConfirm: async data => {
    const name = String(data.get('name') ?? '').trim().replace(/\s+/gu, ' '), groupId = data.get('groupId'), from = data.get('from');
    if (!name || !/\p{L}/u.test(name) || name.includes('|')) return fail(ctx, 'Geçerli ve ayırt edilebilir bir ad yazın.');
    if (ctx.state.people.some(person => norm(person.name) === norm(name))) return fail(ctx, 'Bu ad kayıtlı veya arşivde mevcut. Kişileri ayırt eden tam ad kullanın.');
    if (!isDate(from) || !activeGroups(ctx.state, from.slice(0, 7)).some(group => group.id === groupId)) return fail(ctx, 'Başlangıç tarihi kıdemin aktif olduğu bir tarihte olmalı.');
    await ctx.commit(next => { next.people.push({ id: uid(), name, groupId, from, until: null }); }, `${name} eklendi.`);
  } });
}

function addGroupDialog(ctx) {
  const rank = activeGroups(ctx.state, ctx.month).length + 1;
  ctx.dialog({ title: `${rank}. kıdemi ekle`, confirmLabel: 'Kıdemi ekle', body: `<p>Yeni grup ${esc(ctx.month)} ayından itibaren en yeni kıdem olarak açılır. Kişileri ve nöbet hedefini daha sonra ekleyebilirsiniz.</p>`, onConfirm: async () => {
    await ctx.commit(next => { next.groups.push({ id: uid(), order: Math.max(0, ...next.groups.map(group => group.order)) + 1, from: ctx.month, until: null }); }, 'Yeni kıdem eklendi.');
  } });
}

function retireDialog(ctx, id, entireGroup) {
  const state = ctx.state, month = ctx.month, boundary = `${month}-01`;
  const group = entireGroup ? state.groups.find(item => item.id === id) : state.groups.find(item => item.id === state.people.find(person => person.id === id)?.groupId);
  if (!group) return fail(ctx, 'Kıdem bulunamadı.');
  const members = sortPeopleBySeniority(state, month, state.people.filter(person => entireGroup ? person.groupId === id && (!person.until || person.until > boundary) : person.id === id));
  const ids = new Set(members.map(person => person.id));
  const affected = state.assignments.filter(item => ids.has(item.personId) && item.date >= boundary);
  const name = entireGroup ? `${rankOf(state, id, month)}. kıdem` : members[0]?.name;
  ctx.dialog({ title: `${name} · Arşivleme`, confirmLabel: affected.length ? `${affected.length} gelecek nöbeti kaldır ve arşivle` : 'Arşivle', body: `<p><strong>${esc(pretty(boundary))}</strong> itibarıyla ${esc(members.map(person => person.name).join(', ') || 'boş kıdem grubu')} aktif listeden çıkacak. Önceki ayların nöbetleri ve kıdem sırası korunur. Kıdem boşalırsa sonraki grupların sıra numarası bu aydan itibaren bir azalır.</p>${affected.length ? `<p class="notice"><strong>${affected.length} nöbet kaldırılacak:</strong></p><ul>${affected.sort(byPerson(state, month)).map(item => `<li>${esc(personName(state, item.personId))} · ${pretty(item.date)} · ${esc(item.site)}</li>`).join('')}</ul>` : '<p class="muted">Bu aydan itibaren kaldırılacak nöbet yok.</p>'}<p class="muted">Bu işlemi üstteki Geri al düğmesiyle geri alabilirsiniz.</p>`, onConfirm: async () => {
    await ctx.commit(next => {
      next.assignments = next.assignments.filter(item => !ids.has(item.personId) || item.date < boundary);
      const removedIds = new Set();
      for (const person of next.people.filter(person => ids.has(person.id))) {
        if (person.from >= boundary) removedIds.add(person.id);
        else person.until = boundary;
      }
      next.people = next.people.filter(person => !removedIds.has(person.id));
      for (const collection of ['absences', 'requests', 'rotations']) next[collection] = next[collection].filter(record => !removedIds.has(record.personId)
        && !(record.kind === 'together' && record.personIds.some(personId => removedIds.has(personId))));
      next.targets = next.targets.filter(target => !removedIds.has(target.personId));
      if (next.capabilities) next.capabilities = next.capabilities.filter(record => !removedIds.has(record.personId));
      const remaining = next.people.some(person => person.groupId === group.id && (!person.until || person.until > boundary));
      if (!remaining) {
        const nextGroup = next.groups.find(item => item.id === group.id);
        if (nextGroup.from < month) nextGroup.until = month;
        else {
          next.groups = next.groups.filter(item => item.id !== group.id);
          next.targets = next.targets.filter(target => target.groupId !== group.id);
          if (next.capabilities) next.capabilities = next.capabilities.filter(record => record.groupId !== group.id);
        }
      }
    }, `${name} arşivlendi.`);
  } });
}

function appendRequestedAssignments(next, plan) {
  next.assignments.push(...plan.assignments);
  for (const record of plan.assignments) next.months[record.date.slice(0, 7)] ??= { completedAt: null };
  for (const [month, update] of Object.entries(plan.monthUpdates ?? {})) {
    next.months[month] ??= { completedAt: null };
    Object.assign(next.months[month], update);
  }
}

function requestPlanHTML(state, month, plan) {
  return `<div class="notice info"><strong>${plan.assignments.length} nöbet eklenecek</strong> · ${plan.alreadyAssigned.length} gün zaten nöbetli · ${plan.blocked.length} gün yazılamıyor</div>${plan.assignments.length ? `<ul>${plan.assignments.slice().sort(byPerson(state, month)).map(record => `<li>${esc(personName(state, record.personId))} · ${pretty(record.date)} · ${esc(record.site)}</li>`).join('')}</ul>` : ''}${plan.blocked.length ? `<div class="notice error" style="display:block"><strong>Kesin kurallar nedeniyle eklenmeyecek günler:</strong><ul>${plan.blocked.slice().sort(byPerson(state, month)).map(record => `<li>${esc(personName(state, record.personId))} · ${pretty(record.date)}: ${record.messages.map(esc).join(' ')}</li>`).join('')}</ul></div>` : ''}`;
}

function showRequestResult(ctx, plan, isWeekend = false) {
  if (!plan.blocked.length) return;
  ctx.dialog({ title: isWeekend ? 'Pazar eşleri kontrolü' : 'Nöbet istekleri kaydedildi', confirmLabel: 'Anladım', hideCancel: true, body: `<p>${plan.assignments.length} ${isWeekend ? 'pazar eşi' : 'nöbet'} eklendi. ${plan.alreadyAssigned.length} gün zaten nöbetliydi. Aşağıdaki ${isWeekend ? 'pazar eşlerine' : 'kaydedilen isteklere'} nöbet eklenemedi.</p><div class="issues-scroll"><ul>${plan.blocked.slice().sort(byPerson(ctx.state, ctx.month)).map(record => `<li><strong>${esc(personName(ctx.state, record.personId))}</strong> · ${pretty(record.date)}: ${record.messages.map(esc).join(' ')}</li>`).join('')}</ul></div><p class="muted">Ardışık gün yasağı aşılamaz.${isWeekend ? '' : ' Uygun bir gün seçerek isteği düzenleyebilirsiniz.'}</p>` });
}

async function saveWithRequestedAssignments(ctx, mutate, records, fallbackSite, message) {
  const before = JSON.stringify(ctx.state), draft = structuredClone(ctx.state);
  mutate(draft);
  const plan = planRequestAssignments(draft, records, fallbackSite);
  const save = async () => {
    if (JSON.stringify(ctx.state) !== before) return fail(ctx, 'Kayıtlar değişti. İstekleri yeniden kontrol edin.');
    await ctx.commit(next => { mutate(next); appendRequestedAssignments(next, plan); }, `${message} ${plan.assignments.length} nöbet eklendi${plan.blocked.length ? `; ${plan.blocked.length} gün yazılamadı` : ''}.`);
    showRequestResult(ctx, plan);
  };
  if (plan.warnings.length) {
    ctx.dialog({ title: 'İstenen nöbetler için uyarılar var', confirmLabel: 'Uyarıları onayla ve nöbetleri ekle', body: `<div class="notice" style="display:block"><strong>Devam etmek için şu uyarıları onaylayın:</strong><ul>${plan.warnings.map(warning => `<li>${esc(warningText(warning))}</li>`).join('')}</ul></div><div class="issues-scroll">${requestPlanHTML(draft, ctx.month, plan)}</div><p class="muted">Eklenen nöbetleri plandan kaldırabilir veya Geri al ile bu işlemi geri alabilirsiniz.</p>`, onConfirm: save });
    return false;
  }
  await save();
}

function applyRequestsDialog(ctx) {
  const first = `${ctx.month}-01`, last = daysInMonth(ctx.month).at(-1);
  const records = ctx.state.requests.filter(record => record.kind === 'prefer' && insideMonth(record, ctx.month)).map(record => ({ ...record, start: record.start < first ? first : record.start, end: record.end > last ? last : record.end }));
  if (!records.length) return fail(ctx, 'Bu ay için Yazılsın isteği yok.');
  ctx.dialog({ title: 'Yazılsın isteklerini uygula', confirmLabel: 'İstenen günlere nöbet ekle', body: `<p>${ctx.month} ayındaki ${records.length} Yazılsın isteği uygulanacak. Mevcut nöbetler korunur; aynı güne ikinci kez yazılmaz.</p>${requestSiteField()}<p class="muted">Hastanesi bulunan rotasyonda kişi kendi hastanesine yazılır. Rotasyonu olmayan veya hastanesi olmayan rotasyonda bulunan kişi için yukarıdaki hastane kullanılır. Elle kaldırdığınız istek nöbetleri bu düğmeyle yeniden eklenebilir.</p>`, onConfirm: async data => {
    requestDefaultSite = data.get('fallbackSite');
    return saveWithRequestedAssignments(ctx, () => {}, records, requestDefaultSite, 'İstekler uygulandı.');
  } });
}

async function copyRequestPrompt(ctx) {
  const prompt = buildRequestPrompt(ctx.state, ctx.month);
  try {
    if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('clipboard-unavailable');
    await globalThis.navigator.clipboard.writeText(prompt);
    ctx.toast('Güncel GPT talimatı kopyalandı.');
  } catch {
    ctx.dialog({ title: 'GPT talimatı', confirmLabel: 'Tamam', hideCancel: true,
      body: `<p class="muted">Otomatik kopyalama yapılamadı. Metni seçip kopyalayabilirsiniz.</p>${field('Talimat', `<textarea rows="14" readonly aria-label="GPT talimatı">${esc(prompt)}</textarea>`)}` });
  }
}

function togetherRequestDialog(ctx, existing = null) {
  const options = optionsPeople(ctx.state, ctx.month);
  for (const id of existing?.personIds ?? []) if (!options.some(([personId]) => personId === id)) options.push([id, personName(ctx.state, id)]);
  const compare = comparePeopleBySeniority(ctx.state, ctx.month);
  options.sort(([a], [b]) => compare(personForOrder(ctx.state, a), personForOrder(ctx.state, b)));
  if (options.length < 2) return fail(ctx, 'Birlikte istek için en az iki kayıtlı kişi gerekli.');
  const selected = new Set(existing?.personIds ?? []);
  ctx.dialog({ title: `Birlikte nöbet isteği · ${existing ? 'Düzenle' : 'Ekle'}`, confirmLabel: 'Kaydet',
    body: `<p class="muted">Aynı gün nöbet tutmak isteyen en az iki kişiyi seçin; hastaneler farklı olabilir.</p><div class="together-people-picker" role="group" aria-label="Birlikte nöbet isteyen kişiler">${options.map(([id, name]) => `<label class="check-field"><input type="checkbox" name="personIds" value="${esc(id)}"${selected.has(id) ? ' checked' : ''}><span>${esc(name)}</span></label>`).join('')}</div><div class="form-grid">${field('Başlangıç (dahil)', input('start', existing?.start ?? `${ctx.month}-01`, 'date', 'required'))}${field('Bitiş (dahil)', input('end', existing?.end ?? daysInMonth(ctx.month).at(-1), 'date', 'required'))}${field('Açıklama (isteğe bağlı)', input('note', existing?.note ?? ''))}</div><p class="muted">Biri yazılınca diğerleri planlayıcıda istekler arasında görünür; otomatik nöbet eklenmez.</p>`, onConfirm: async data => {
      const rawIds = data.getAll('personIds'), personIds = [...new Set(rawIds)].sort();
      const start = data.get('start'), end = data.get('end'), note = String(data.get('note') ?? '').trim();
      if (personIds.length < 2 || personIds.length !== rawIds.length) return fail(ctx, 'En az iki farklı kişi seçin.');
      if (!isDate(start) || !isDate(end) || end < start) return fail(ctx, 'Sıralı, geçerli başlangıç ve bitiş tarihleri seçin.');
      for (const id of personIds) {
        const person = ctx.state.people.find(item => item.id === id);
        const group = person && ctx.state.groups.find(item => item.id === person.groupId);
        if (!person || !group || person.from > start || person.until && person.until <= end || group.from > start.slice(0, 7) || group.until && group.until <= end.slice(0, 7)) return fail(ctx, `${personName(ctx.state, id)} seçilen tarih aralığının tamamında aktif değil.`);
      }
      const record = { id: existing?.id ?? uid(), kind: 'together', personId: personIds[0], personIds, start, end, note };
      if (duplicateOf(ctx.state.requests.filter(item => item.id !== existing?.id), record)) return fail(ctx, 'Aynı birlikte istek kaydı zaten mevcut.');
      await ctx.commit(next => { next.requests = next.requests.filter(item => item.id !== record.id); next.requests.push(record); }, 'Birlikte nöbet isteği kaydedildi.');
    } });
}

function recordDialog(ctx, kind, existing = null) {
  const options = optionsPeople(ctx.state, ctx.month);
  if (existing && !options.some(([id]) => id === existing.personId)) options.push([existing.personId, personName(ctx.state, existing.personId)]);
  if (!options.length) return fail(ctx, 'Önce kişi ekleyin.');
  const valueOptions = kind === 'absence' ? [['annual', 'Yıllık izin'], ['excused', 'Mazeret izni'], ['exempt', 'Nöbet muafiyeti']] : kind === 'request' ? [['avoid', 'Yazılmasın'], ['prefer', 'Yazılsın']] : rotationOptions;
  ctx.dialog({ title: `${FORMAT_HELP[kind].title} · ${existing ? 'Düzenle' : 'Ekle'}`, confirmLabel: 'Kaydet', body: `<div class="form-grid">${field('Kişi', select('personId', options, existing?.personId))}${field('Başlangıç (dahil)', input('start', existing?.start ?? `${ctx.month}-01`, 'date', 'required'))}${field('Bitiş (dahil)', input('end', existing?.end ?? `${ctx.month}-01`, 'date', 'required'))}${field(kind === 'rotation' ? 'Hastane' : 'Tür', select('value', valueOptions, kind === 'rotation' ? rotationValue(existing) : existing?.type ?? existing?.kind))}${field(kind === 'rotation' ? 'Birim (isteğe bağlı)' : 'Açıklama (isteğe bağlı)', input('note', existing?.note ?? existing?.unit ?? ''))}${kind === 'request' ? requestSiteField() : ''}${kind === 'absence' ? `<label class="check-field"><input name="zeroTarget" type="checkbox" value="1"${existing?.zeroTarget ? ' checked' : ''}><span>Nöbet muafiyetinin tamamını kapsadığı aylarda hedefi 0 say</span></label>` : ''}</div><p class="muted">${kind === 'rotation' ? 'Hastane nöbet için tercih olarak kullanılır. Nöbet ertesi seçiminde hastane kullanılmaz, birim otomatik belirlenir.' : kind === 'request' ? 'Yazılsın isteği kaydedildiğinde istenen günlere nöbet eklenir. Tarih aralığı girerseniz aralıktaki her gün istek sayılır; ardışık günlere nöbet yazılmaz. İstek düzenlemek veya silmek mevcut nöbetleri kaldırmaz; nöbeti plandan kaldırabilirsiniz.' : 'Çakışmalarda size uyarı gösterilir.'}</p>`, onConfirm: async data => {
    const personId = data.get('personId'), start = data.get('start'), end = data.get('end'), value = data.get('value'), note = String(data.get('note') ?? '').trim();
    if (!ctx.state.people.some(person => person.id === personId) || !isDate(start) || !isDate(end) || end < start) return fail(ctx, 'Kişiyi ve sıralı, geçerli tarihleri kontrol edin.');
    if (kind === 'rotation' && !rotationOptions.some(([option]) => option === value)) return fail(ctx, 'Geçerli bir hastane veya Nöbet ertesi seçin.');
    if (kind === 'rotation' && value !== POST_CALL_OPTION && isPostCallUnit(note)) return fail(ctx, 'Nöbet ertesi için hastane listesinden “Nöbet ertesi (hastanesiz)” seçin.');
    const record = { id: existing?.id ?? uid(), personId, start, end, ...(kind === 'rotation' ? { site: value === POST_CALL_OPTION ? null : value, unit: value === POST_CALL_OPTION ? POST_CALL_UNIT : note } : kind === 'absence' ? { type: value, note, ...(value === 'exempt' && data.get('zeroTarget') ? { zeroTarget: true } : {}) } : { kind: value, note }) };
    const collection = collections[kind];
    if (kind === 'rotation' && rotationConflict(ctx.state.rotations, record, existing?.id)) return fail(ctx, 'Bu kişinin aynı tarih aralığında farklı hastane veya birim rotasyonu var. Önce mevcut dönemi düzenleyin.');
    if (duplicateOf(ctx.state[collection].filter(item => item.id !== existing?.id), record)) return fail(ctx, 'Aynı kayıt zaten mevcut.');
    const mutate = next => {
      next[collection] = next[collection].filter(item => item.id !== record.id);
      next[collection].push(record);
    };
    if (kind === 'request' && record.kind === 'prefer') {
      requestDefaultSite = data.get('fallbackSite');
      return saveWithRequestedAssignments(ctx, mutate, [record], requestDefaultSite, 'İstek kaydedildi.');
    }
    await ctx.commit(mutate, 'Kayıt kaydedildi.');
  } });
}

function holidayDialog(ctx, existing = null) {
  ctx.dialog({ title: existing ? 'Tatil gününü düzenle' : 'Tatil günü ekle', confirmLabel: 'Tatili kaydet', body: `<div class="form-grid">${field('Tarih', input('date', existing?.date ?? `${ctx.month}-01`, 'date', 'required'))}${field('Tatilin adı', input('name', existing?.name ?? '', 'text', 'required'))}${field('Diğer nöbet katkısı', input('weekdayCredit', existing?.weekdayCredit ?? 0, 'number', 'min="0" step="0.5" required'))}${field('Hafta sonu puanı', input('weekendCredit', existing?.weekendCredit ?? 0, 'number', 'min="0" step="0.5" required'))}</div><p class="muted">Toplam hedefe katkı bu iki sayının toplamıdır. Yalnız tatil sayacında izlemek için ikisini 0 bırakın. Katkılar pazartesi–perşembe tatillerine uygulanır; cuma ve pazar toplamda 1, hafta sonunda 0,5; cumartesi ikisinde de 1 sayılır. Tatil adı ve tarihi ayrıca görünür.</p>`, onConfirm: async data => {
    const date = data.get('date'), name = String(data.get('name') ?? '').trim(), weekdayCredit = Number(data.get('weekdayCredit')), weekendCredit = Number(data.get('weekendCredit'));
    if (!isDate(date) || !name || ![weekdayCredit, weekendCredit].every(value => Number.isFinite(value) && value >= 0)) return fail(ctx, 'Tarih, tatil adı ve sıfır veya daha büyük katkıları girin.');
    if (ctx.state.holidays.some(item => item.id !== existing?.id && item.date === date)) return fail(ctx, 'Bu tarihte bir tatil zaten var. Mevcut kaydı düzenleyin.');
    await ctx.commit(next => {
      next.holidays = next.holidays.filter(item => item.id !== existing?.id);
      next.holidays.push({ id: existing?.id ?? uid(), date, name, weekdayCredit, weekendCredit });
    }, 'Tatil günü kaydedildi.');
  } });
}

function deleteDialog(ctx, collection, id) {
  if (!['absences', 'requests', 'rotations', 'holidays'].includes(collection)) return;
  const record = ctx.state[collection].find(item => item.id === id);
  if (!record) return;
  const description = collection === 'holidays' ? `${record.name} · ${pretty(record.date)}` : `${collection === 'requests' ? requestNames(ctx.state, ctx.month, record) : personName(ctx.state, record.personId)} · ${period(record.start, record.end)} · ${record.site ?? label[record.type ?? record.kind]}`;
  ctx.dialog({ title: 'Kaydı sil', confirmLabel: 'Sil', body: `<p>${esc(description)}</p><p class="muted">${collection === 'requests' ? 'Bu istekten eklenen nöbetler listede kalır; nöbeti kaldırmak için planı kullanın. ' : ''}Bu silme işlemi Geri al düğmesiyle geri alınabilir.</p>`, onConfirm: async () => { await ctx.commit(next => { next[collection] = next[collection].filter(item => item.id !== id); }, 'Kayıt silindi.'); } });
}

function prepareImport(state, month, kind, records, fallbackSite = 'Sancaktepe') {
  const draft = structuredClone(state), errors = [], warnings = [], added = [];
  let requestPlan = null, weekendPlan = null;
  let skipped = 0;
  if (kind === 'people') {
    const groups = activeGroups(draft, month);
    const ranks = [...new Set(records.map(record => record.rank))].sort((a, b) => a - b);
    const newRanks = ranks.filter(rank => rank > groups.length);
    if (newRanks.some((rank, index) => rank !== groups.length + index + 1)) {
      return { errors: [{ message: `Yeni kıdemler ${groups.length + 1} numarasından başlayarak aralıksız eklenmeli.` }], warnings, added, skipped, draft };
    }
    for (const rank of newRanks) {
      const group = { id: uid(), order: Math.max(0, ...draft.groups.map(item => item.order)) + 1, from: month, until: null };
      draft.groups.push(group); groups.push(group);
    }
    for (const record of records) {
      const group = groups[record.rank - 1];
      const person = draft.people.find(person => norm(person.name) === norm(record.name));
      if (person) {
        if (person.groupId !== group.id || !activePeople(draft, month).some(item => item.id === person.id)) errors.push({ message: `${record.name} başka bir kıdemde veya arşivde kayıtlı; kişi aktarımı geçmişini değiştiremez.` });
        else skipped++;
      } else {
        const nextPerson = { id: uid(), name: record.name, groupId: group.id, from: `${month}-01`, until: null };
        draft.people.push(nextPerson); added.push(nextPerson);
      }
    }
  } else {
    const collection = collections[kind];
    for (let record of records) {
      if (duplicateOf(draft[collection], record)) { skipped++; continue; }
      if (kind === 'rotation' && rotationConflict(draft.rotations, record)) {
        errors.push({ message: `${personName(draft, record.personId)}: ${period(record.start, record.end)} aralığında farklı hastane/birim rotasyonu mevcut.` });
        continue;
      }
      if (kind === 'duty') {
        const validation = validateAssignment(draft, record);
        errors.push(...validation.errors.map(error => ({ message: `${pretty(record.date)} · ${error.message}` })));
        warnings.push(...validation.warnings.map(warning => ({ ...warning, message: `${pretty(record.date)} · ${warning.message}` })));
        record = { ...record, overrides: validation.warnings.map(warning => warning.code) };
      }
      draft[collection].push(record); added.push(record);
    }
  }
  if (kind === 'request' && !errors.length) {
    requestPlan = planRequestAssignments(draft, added, fallbackSite);
    warnings.push(...requestPlan.warnings);
  }
  if (kind === 'duty' && !errors.length) {
    const fridays = added.filter(record => dayOfWeek(record.date) === 5 && addDays(record.date, 2).slice(0, 7) === month);
    if (fridays.length) {
      weekendPlan = planAutoWeekend(draft, fridays);
      warnings.push(...weekendPlan.warnings);
    }
  }
  return { draft, errors, warnings, added, skipped, requestPlan, weekendPlan };
}

function importDialog(ctx, kind, initialText = '') {
  const help = FORMAT_HELP[kind];
  if (!help) return;
  const description = kind === 'duty' ? 'Tek tarih | Kayıtlı ad | Hastane. Açık aya denk gelen cuma–pazar eşleri de önizlemeye eklenir.' : help.description;
  ctx.dialog({ title: `${help.title} · Toplu aktarım`, confirmLabel: 'Önizlemeyi göster', body: `<p class="muted">${esc(description)}</p><pre class="notice" style="white-space:pre-wrap">${esc(help.example)}</pre>${field('Satırları yapıştırın', `<textarea name="text" rows="10" required placeholder="${esc(help.example)}">${esc(initialText)}</textarea>`)}${kind === 'request' ? requestSiteField() : ''}<p class="muted">Hatalı bir satır varsa hiçbir kayıt aktarılmaz. Mevcut aynı kayıtlar atlanır; önce önizleme gösterilir.</p>`, onConfirm: async data => {
    const text = String(data.get('text') ?? '');
    const parsed = parseImport(text, kind, ctx.state, ctx.month);
    if (parsed.errors.length) return showErrors(ctx, parsed.errors);
    if (kind === 'request') requestDefaultSite = data.get('fallbackSite');
    const prepared = prepareImport(ctx.state, ctx.month, kind, parsed.records, requestDefaultSite);
    if (prepared.errors.length) return showErrors(ctx, prepared.errors);
    if (!prepared.added.length) return fail(ctx, `Yeni kayıt yok; ${prepared.skipped} mevcut kayıt atlandı.`);
    const stateBefore = JSON.stringify(ctx.state), monthBefore = ctx.month;
    ctx.dialog({ title: 'Aktarım önizlemesi', confirmLabel: prepared.warnings.length ? 'Uyarıları onayla ve aktar' : `${prepared.added.length} kaydı aktar`, body: `<p><strong>${prepared.added.length} yeni kayıt</strong>${prepared.skipped ? ` · ${prepared.skipped} mevcut kayıt atlanacak` : ''}</p><div class="issues-scroll"><ul>${importPreview(prepared.draft, ctx.month, parsed).map(line => `<li>${esc(line)}</li>`).join('')}</ul>${prepared.requestPlan ? requestPlanHTML(prepared.draft, ctx.month, prepared.requestPlan) : ''}${prepared.weekendPlan ? `<h3>Otomatik pazar eşleri</h3>${requestPlanHTML(prepared.draft, ctx.month, prepared.weekendPlan)}` : ''}${prepared.warnings.length ? `<div class="notice" style="display:block"><strong>Devam ederseniz şu uyarıları onaylamış olursunuz:</strong><ul>${prepared.warnings.map(warning => `<li>${esc(warningText(warning))}</li>`).join('')}</ul></div>` : ''}</div><p class="muted">${kind === 'duty' ? 'Yukarıdaki geçmiş kayıtlar ve açık aya denk gelen pazar eşleri eklenir. Diğer aylardaki eski cumalar değiştirilmez; eklenen pazarı plandan silebilirsiniz.' : kind === 'request' ? 'Yazılsın isteklerinden yukarıda görünen nöbetler eklenir. Nöbetleri daha sonra plandan kaldırabilirsiniz.' : 'Nöbet yerleştirmesi yapılmaz.'}</p>`, onConfirm: async () => {
      if (JSON.stringify(ctx.state) !== stateBefore || ctx.month !== monthBefore) return fail(ctx, 'Önizlemeden sonra kayıtlar veya ay değişti. Yeniden önizleme oluşturun.');
      await ctx.commit(next => {
        if (kind === 'people') { next.people = prepared.draft.people; next.groups = prepared.draft.groups; }
        else next[collections[kind]] = prepared.draft[collections[kind]];
        if (kind === 'duty') for (const record of prepared.added) next.months[record.date.slice(0, 7)] ??= { completedAt: null };
        if (prepared.requestPlan) appendRequestedAssignments(next, prepared.requestPlan);
        if (prepared.weekendPlan) appendRequestedAssignments(next, prepared.weekendPlan);
      }, `${prepared.added.length} kayıt aktarıldı.${prepared.requestPlan ? ` ${prepared.requestPlan.assignments.length} nöbet eklendi.` : ''}${prepared.weekendPlan ? ` ${prepared.weekendPlan.assignments.length} pazar eşi eklendi.` : ''}`);
      if (prepared.requestPlan) showRequestResult(ctx, prepared.requestPlan);
      if (prepared.weekendPlan) showRequestResult(ctx, prepared.weekendPlan, true);
    } });
    return false;
  } });
}

export async function handleManagement(action, element, ctx) {
  if (!action.startsWith('mg-')) return false;
  switch (action) {
    case 'mg-target': targetDialog(ctx, element); break;
    case 'mg-capabilities': capabilityDialog(ctx, element); break;
    case 'mg-save-settings': await saveSettings(ctx, element); break;
    case 'mg-add-person': addPersonDialog(ctx); break;
    case 'mg-add-group': addGroupDialog(ctx); break;
    case 'mg-retire-group': retireDialog(ctx, element.dataset.id, true); break;
    case 'mg-retire-person': retireDialog(ctx, element.dataset.id, false); break;
    case 'mg-add-record': recordDialog(ctx, element.dataset.kind); break;
    case 'mg-add-together-request': togetherRequestDialog(ctx); break;
    case 'mg-copy-request-prompt': await copyRequestPrompt(ctx); break;
    case 'mg-bulk-rotations': bulkRotationPeriodDialog(ctx); break;
    case 'mg-edit-record': {
      const collection = element.dataset.collection;
      const kind = Object.entries(collections).find(([, value]) => value === collection)?.[0];
      const existing = ctx.state[collection]?.find(record => record.id === element.dataset.id);
      if (kind && existing) {
        if (collection === 'requests' && existing.kind === 'together') togetherRequestDialog(ctx, existing);
        else recordDialog(ctx, kind, existing);
      }
      break;
    }
    case 'mg-add-holiday': holidayDialog(ctx); break;
    case 'mg-edit-holiday': holidayDialog(ctx, ctx.state.holidays.find(record => record.id === element.dataset.id)); break;
    case 'mg-delete-record': deleteDialog(ctx, element.dataset.collection, element.dataset.id); break;
    case 'mg-import': importDialog(ctx, element.dataset.kind); break;
    case 'mg-apply-requests': applyRequestsDialog(ctx); break;
    default: return false;
  }
  return true;
}
