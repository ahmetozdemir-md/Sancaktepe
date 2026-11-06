import { daysInMonth, dayOfWeek } from './domain.js';
import { comparePeopleBySeniority } from './person-order.js';
import { capabilitiesFor, getPlanningSettings } from './capabilities.js';

const SITES = ['Sancaktepe', 'Feriha Öz', 'Çekmeköy'];
export const SHARE_HOSPITAL_SHARES = Object.freeze([0.31, 0.51, 0.18]);
const DATE_SHARE = 0.14;
const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const monthFormat = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** A detached, complete calendar snapshot. Historical assignees remain visible. */
export function buildShareModel(state, month, range = 'all') {
  const dates = daysInMonth(month);
  const people = new Map((state.people ?? []).map(person => [person.id, person]));
  const assignments = (state.assignments ?? []).filter(assignment => assignment.date?.slice(0, 7) === month);
  const compare = comparePeopleBySeniority(state, month);
  const ferihaAreaTarget = getPlanningSettings(state).ferihaCapacity;
  const rows = dates.map(date => {
    const holidayNames = (state.holidays ?? []).filter(holiday => holiday.date === date).map(holiday => String(holiday.name));
    const weekend = [0, 6].includes(dayOfWeek(date));
    const hospitals = SITES.map(site => {
      const duties = assignments.filter(assignment => assignment.date === date && assignment.site === site);
      const ordered = duties.map(duty => people.get(duty.personId) ?? { id: duty.personId, name: `Kayıt bulunamadı (${duty.personId})`, groupId: '' }).sort(compare);
      const twoAreaIds = new Set();
      if (site === 'Feriha Öz') {
        const unique = [...new Map(ordered.map(person => [person.id, person])).values()];
        const working = unique.map(person => ({ person, flags: capabilitiesFor(state, person.id, month) })).filter(item => !item.flags.companion);
        const needed = Math.max(0, ferihaAreaTarget - working.length);
        for (const item of working.filter(item => item.flags.square).slice(0, needed)) twoAreaIds.add(item.person.id);
      }
      const assignees = ordered.map(person => ({ personId: person.id, name: String(person.name), twoAreas: twoAreaIds.has(person.id) }));
      return { site, count: duties.length, names: assignees.map(person => person.name), assignees };
    });
    return {
      date, day: Number(date.slice(8)), dayName: DAY_NAMES[dayOfWeek(date)],
      holidayNames, weekend, kind: holidayNames.length ? 'holiday' : weekend ? 'weekend' : 'weekday',
      hospitals, total: hospitals.reduce((sum, hospital) => sum + hospital.count, 0),
    };
  });
  const label = monthFormat.format(new Date(`${dates[0]}T00:00:00Z`));
  const monthLabel = label.charAt(0).toLocaleUpperCase('tr-TR') + label.slice(1);
  return selectRange({
    month, monthLabel, title: monthLabel, subtitle: 'Anestezi Kliniği',
    sites: [...SITES], rows,
    total: assignments.length,
  }, range);
}

/** Calendar weeks begin on Monday; the first and last are clipped to this month. */
export function getShareRanges(month) {
  const dates = daysInMonth(month);
  const lastDay = Number(dates.at(-1).slice(8));
  const ranges = [
    { value: 'all', label: 'Tam ay', rangeLabel: 'Tam ay', start: 1, end: lastDay, fileSuffix: '' },
    { value: 'first', label: '1–15', rangeLabel: '1–15', start: 1, end: 15, fileSuffix: '-1-15' },
    { value: 'second', label: `16–${lastDay}`, rangeLabel: `16–${lastDay}`, start: 16, end: lastDay, fileSuffix: `-16-${lastDay}` },
  ];
  const weeks = [];
  for (const date of dates) {
    const day = Number(date.slice(8));
    if (!weeks.length || dayOfWeek(date) === 1) weeks.push({ start: day, end: day });
    else weeks.at(-1).end = day;
  }
  return ranges.concat(weeks.map(({ start, end }, index) => {
    const number = index + 1;
    const days = start === end ? String(start) : `${start}–${end}`;
    return { value: `week-${number}`, label: `${number}. hafta · ${days}`, rangeLabel: `${days} (${number}. hafta)`, start, end, fileSuffix: `-hafta-${number}-${start}-${end}` };
  }));
}

function selectRange(base, range) {
  const choice = getShareRanges(base.month).find(option => option.value === range);
  if (!choice) throw new RangeError('Geçerli bir paylaşım aralığı seçin.');
  const { rangeLabel, fileSuffix } = choice;
  const rows = base.rows.filter(row => row.day >= choice.start && row.day <= choice.end);
  return {
    ...base, range, rangeLabel, rows,
    title: `${base.monthLabel}${range === 'all' ? '' : ` · ${rangeLabel}`}`,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    fileSuffix,
  };
}

export function renderShareHTML(model) {
  return `<header class="share-heading"><div><p>${escapeHTML(model.subtitle)}</p><h1>${escapeHTML(model.title)}</h1></div></header>
    <div class="share-key"><span class="share-key-weekend">Cumartesi · Pazar</span><span class="share-key-holiday">Resmî tatil</span></div>
    <div class="share-table-scroll" role="region" aria-label="Nöbet listesi" tabindex="0"><table class="share-roster"><caption class="share-sr-only">${escapeHTML(model.title)} anestezi kliniği nöbet listesi</caption><colgroup><col class="share-date-col" style="width:${Number((DATE_SHARE * 100).toFixed(2))}%">${SHARE_HOSPITAL_SHARES.map(share => `<col style="width:${Number(((1 - DATE_SHARE) * share * 100).toFixed(2))}%">`).join('')}</colgroup><thead><tr><th scope="col">Tarih / Gün</th>${model.sites.map(site => `<th scope="col">${escapeHTML(site)}</th>`).join('')}</tr></thead><tbody>${model.rows.map(row => `<tr class="share-day-${row.kind}"><th scope="row"><strong>${row.day}</strong> <span class="share-day-name">${escapeHTML(row.dayName)}</span>${row.holidayNames.map(name => `<span class="share-holiday-name">${escapeHTML(name)}</span>`).join('')}</th>${row.hospitals.map(hospital => `<td><span class="share-count">${hospital.count} kişi</span><div class="share-names">${hospital.names.length ? hospital.names.map(name => `<span>${escapeHTML(name)}</span>`).join('') : '<span class="share-empty">—</span>'}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <footer class="share-source">${escapeHTML(model.title)}</footer>`;
}

let closeCurrentShare = null;

/** Open a snapshot without changing the plan or using a popup window. */
export function openShareView(state, month) {
  const baseModel = buildShareModel(state, month);
  let model = baseModel;
  closeCurrentShare?.();
  const previousFocus = document.activeElement;
  const overlay = document.createElement('section');
  overlay.id = 'share-view';
  overlay.className = 'share-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${model.monthLabel} paylaşım ve yazdırma`);
  overlay.innerHTML = `<div class="share-toolbar"><div><strong>Paylaş ve yazdır</strong><span>WhatsApp için görsel indir; PDF için yazdır.</span></div><div class="share-actions"><label class="share-range">Görünüm<select aria-label="Paylaşılacak günler">${getShareRanges(month).map(option => `<option value="${option.value}">${escapeHTML(option.label)}</option>`).join('')}</select></label><button type="button" data-share="png">WhatsApp için PNG indir</button><button type="button" data-share="print">Yazdır / PDF kaydet</button><button type="button" class="share-close" data-share="close" aria-label="Paylaşım ekranını kapat">Kapat</button></div><p class="share-progress" role="status" aria-live="polite"></p></div><article class="share-sheet">${renderShareHTML(model)}</article>`;
  const app = document.getElementById('app');
  const appWasInert = app?.inert ?? false;
  if (app) app.inert = true;
  document.body.classList.add('share-open');
  document.body.append(overlay);
  let busy = false;
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    document.body.classList.remove('share-open');
    if (app) app.inert = appWasInert;
    if (previousFocus?.isConnected) previousFocus.focus();
    if (closeCurrentShare === close) closeCurrentShare = null;
  };
  closeCurrentShare = close;
  const onKeydown = event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...overlay.querySelectorAll('button:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKeydown);
  overlay.querySelector('[data-share="close"]').addEventListener('click', close);
  overlay.querySelector('[data-share="print"]').addEventListener('click', () => window.print());
  const pngButton = overlay.querySelector('[data-share="png"]');
  const progress = overlay.querySelector('.share-progress');
  const rangeSelect = overlay.querySelector('.share-range select');
  rangeSelect.addEventListener('change', () => {
    model = selectRange(baseModel, rangeSelect.value);
    overlay.querySelector('.share-sheet').innerHTML = renderShareHTML(model);
    progress.textContent = '';
  });
  pngButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    pngButton.disabled = true;
    rangeSelect.disabled = true;
    progress.textContent = 'Görsel hazırlanıyor…';
    try {
      // Let the status render before the canvas layout work begins.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await createRosterPNG(model);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Nobet-${model.month}${model.fileSuffix}.png`;
      anchor.hidden = true;
      document.body.append(anchor);
      try { anchor.click(); }
      finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000); }
      progress.textContent = 'PNG indirildi. WhatsApp’ta görsel veya belge olarak paylaşabilirsin.';
    } catch (error) {
      progress.textContent = error?.message || 'Görsel hazırlanamadı. Yazdır / PDF seçeneğini kullanabilirsin.';
    } finally {
      busy = false;
      pngButton.disabled = false;
      rangeSelect.disabled = false;
    }
  });
  pngButton.focus();
  return { close, get model() { return model; } };
}

const CANVAS = { width: 1800, margin: 52, lineHeight: 33, nameFont: 25, smallFont: 21, maxHeight: 30_000, maxPixels: 48_000_000 };
const font = (size, weight = 400) => `${weight} ${size}px Arial, Helvetica, sans-serif`;

function wrapText(context, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    // A very long surname still stays inside its hospital column.
    let part = '';
    for (const character of word) {
      if (part && context.measureText(part + character).width > width) { lines.push(part); part = ''; }
      part += character;
    }
    line = part;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Packs whole names left to right, wrapping within a name only if its column is narrower. */
export function packShareNames(names, width, measure, { lineHeight = CANVAS.lineHeight, gap = 10, rowGap = 6, paddingX = 9, paddingY = 4 } = {}) {
  if (!Number.isFinite(width) || width <= paddingX * 2 || typeof measure !== 'function') throw new RangeError('İsim sütunu genişliği geçerli olmalı.');
  const context = { measureText: text => ({ width: measure(text) }) };
  const items = [];
  let x = 0, y = 0, rowHeight = 0;
  for (const source of names) {
    const name = String(source);
    const itemWidth = Math.min(width, Math.ceil(measure(name)) + paddingX * 2);
    const lines = wrapText(context, name, itemWidth - paddingX * 2);
    const height = lines.length * lineHeight + paddingY * 2;
    if (x > 0 && x + itemWidth > width) { x = 0; y += rowHeight + rowGap; rowHeight = 0; }
    items.push({ name, lines, x, y, width: itemWidth, height, textX: paddingX, textY: paddingY });
    x += itemWidth + gap;
    rowHeight = Math.max(rowHeight, height);
  }
  return { items, height: items.length ? y + rowHeight : 0 };
}

async function createRosterPNG(model) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS.width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Bu tarayıcıda görsel oluşturulamadı. Yazdır / PDF seçeneğini kullanabilirsin.');
  const contentWidth = CANVAS.width - CANVAS.margin * 2;
  const dateWidth = contentWidth * DATE_SHARE;
  const hospitalWidths = SHARE_HOSPITAL_SHARES.map(share => (contentWidth - dateWidth) * share);
  const hospitalOffsets = hospitalWidths.map((_, index) => hospitalWidths.slice(0, index).reduce((sum, width) => sum + width, dateWidth));
  context.font = font(CANVAS.nameFont);
  const rows = model.rows.map(row => {
    const nameLayouts = row.hospitals.map((hospital, index) => packShareNames(hospital.names.length ? hospital.names : ['—'], hospitalWidths[index] - 36, text => context.measureText(text).width));
    context.font = font(28, 700);
    const dateLines = wrapText(context, `${row.day} ${row.dayName}`, dateWidth - 36);
    context.font = font(CANVAS.smallFont, 600);
    const holidayLines = row.holidayNames.flatMap(name => wrapText(context, name, dateWidth - 36));
    context.font = font(CANVAS.nameFont);
    const nameHeight = Math.max(...nameLayouts.map(layout => layout.height)) + 56;
    const dateHeight = 36 + dateLines.length * 34 + holidayLines.length * 28;
    return { ...row, nameLayouts, dateLines, holidayLines, height: Math.max(94, nameHeight, dateHeight) };
  });
  const titleFont = 43;
  context.font = font(titleFont, 700);
  const titleLines = wrapText(context, model.title, contentWidth);
  const headerHeight = 148 + (titleLines.length - 1) * 51;
  const tableTop = CANVAS.margin + headerHeight;
  const tableHeaderHeight = 66;
  const height = tableTop + tableHeaderHeight + rows.reduce((sum, row) => sum + row.height, 0) + 84;
  if (height > CANVAS.maxHeight || height * CANVAS.width > CANVAS.maxPixels) {
    throw new Error('Bu liste tek görsel için çok uzun. Tüm isimleri korumak için Yazdır / PDF kaydet seçeneğini kullan.');
  }
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'top';
  context.fillStyle = '#64748b';
  context.font = font(23, 600);
  context.fillText(model.subtitle, CANVAS.margin, CANVAS.margin);
  context.fillStyle = '#183d50';
  context.font = font(titleFont, 700);
  titleLines.forEach((line, index) => context.fillText(line, CANVAS.margin, CANVAS.margin + 35 + index * 51));
  const legendY = tableTop - 35;
  context.font = font(20);
  context.fillStyle = '#dcecf9'; context.fillRect(CANVAS.margin, legendY, 18, 18);
  context.fillStyle = '#41566b'; context.fillText('Cumartesi · Pazar', CANVAS.margin + 29, legendY - 1);
  context.fillStyle = '#f8dfe8'; context.fillRect(CANVAS.margin + 335, legendY, 18, 18);
  context.fillStyle = '#754355'; context.fillText('Resmî tatil', CANVAS.margin + 364, legendY - 1);
  if (rows.some(row => row.hospitals.some(hospital => hospital.assignees.some(person => person.twoAreas)))) {
    context.fillStyle = '#f0e3f6'; context.fillRect(CANVAS.margin + 570, legendY, 18, 18);
    context.fillStyle = '#76368b'; context.fillText('Feriha Öz: 2 alan', CANVAS.margin + 599, legendY - 1);
  }

  let y = tableTop;
  context.fillStyle = '#1e566e';
  context.fillRect(CANVAS.margin, y, contentWidth, tableHeaderHeight);
  context.fillStyle = '#ffffff';
  context.font = font(27, 700);
  context.fillText('Tarih / Gün', CANVAS.margin + 18, y + 20);
  model.sites.forEach((site, index) => context.fillText(site, CANVAS.margin + hospitalOffsets[index] + 18, y + 20));
  y += tableHeaderHeight;
  for (const row of rows) {
    const backgrounds = { weekday: '#ffffff', weekend: '#eaf3fb', holiday: '#fce8ef' };
    context.fillStyle = backgrounds[row.kind];
    context.fillRect(CANVAS.margin, y, contentWidth, row.height);
    context.strokeStyle = '#ccd7df';
    context.lineWidth = 1;
    context.strokeRect(CANVAS.margin, y, contentWidth, row.height);
    for (let index = 0; index < 3; index++) {
      const x = CANVAS.margin + hospitalOffsets[index];
      context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + row.height); context.stroke();
    }
    context.fillStyle = row.kind === 'holiday' ? '#833e5b' : '#203b4e';
    context.font = font(28, 700);
    row.dateLines.forEach((line, index) => context.fillText(line, CANVAS.margin + 18, y + 18 + index * 34));
    context.font = font(CANVAS.smallFont, 600);
    row.holidayLines.forEach((line, index) => context.fillText(line, CANVAS.margin + 18, y + 22 + row.dateLines.length * 34 + index * 28));
    row.hospitals.forEach((hospital, index) => {
      const x = CANVAS.margin + hospitalOffsets[index];
      const hospitalWidth = hospitalWidths[index];
      context.fillStyle = '#607588';
      context.font = font(18, 600);
      context.textAlign = 'right';
      context.fillText(`${hospital.count} kişi`, x + hospitalWidth - 18, y + 11);
      context.textAlign = 'left';
      context.font = font(CANVAS.nameFont);
      for (const [nameIndex, item] of row.nameLayouts[index].items.entries()) {
        const itemX = x + 18 + item.x;
        const itemY = y + 38 + item.y;
        const twoAreas = hospital.assignees[nameIndex]?.twoAreas === true;
        if (hospital.names.length) {
          context.fillStyle = twoAreas ? '#f0e3f6' : '#ffffff80';
          context.fillRect(itemX, itemY, item.width, item.height);
          context.strokeStyle = twoAreas ? '#c7a1d4' : '#cbd8de';
          context.strokeRect(itemX, itemY, item.width, item.height);
        }
        context.fillStyle = twoAreas ? '#76368b' : hospital.names.length ? '#203b4e' : '#91a0ad';
        item.lines.forEach((line, lineIndex) => context.fillText(line, itemX + item.textX, itemY + item.textY + lineIndex * CANVAS.lineHeight));
      }
    });
    y += row.height;
  }
  context.fillStyle = '#64748b';
  context.font = font(20);
  context.fillText(model.title, CANVAS.margin, y + 27);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG oluşturulamadı. Yazdır / PDF seçeneğini kullanabilirsin.')), 'image/png'));
}
