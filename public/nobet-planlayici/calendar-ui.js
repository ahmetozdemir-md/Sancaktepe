const ISO_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
let pickerSequence = 0;

const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateAtNoon = date => new Date(`${date}T12:00:00Z`);
const dateISO = date => date.toISOString().split('T')[0];
const monthNumber = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthFromNumber = value => `${String(Math.floor(value / 12)).padStart(4, '0')}-${String(value % 12 + 1).padStart(2, '0')}`;
const localToday = () => {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Six complete Monday-first weeks. Cuma–Pazar follow this application's duty accounting. */
export function calendarCells(month, holidays = []) {
  if (typeof month !== 'string' || !ISO_MONTH.test(month) || Number(month.slice(0, 4)) < 1) throw new RangeError('Geçerli bir YYYY-AA ayı gerekiyor.');
  const first = dateAtNoon(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const holidayNamesByDate = new Map();
  for (const holiday of holidays) {
    if (!ISO_DATE.test(holiday?.date ?? '')) continue;
    const names = holidayNamesByDate.get(holiday.date) ?? [];
    const name = typeof holiday.name === 'string' && holiday.name.trim() ? holiday.name.trim() : 'Resmî tatil';
    if (!names.includes(name)) names.push(name);
    holidayNamesByDate.set(holiday.date, names);
  }
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const value = dateISO(date);
    const weekend = [0, 5, 6].includes(date.getUTCDay());
    const holidayNames = [...(holidayNamesByDate.get(value) ?? [])];
    return {
      date: value,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === first.getUTCMonth() && date.getUTCFullYear() === first.getUTCFullYear(),
      weekend,
      holidayNames,
      kind: holidayNames.length ? 'holiday' : weekend ? 'weekend' : 'weekday',
    };
  });
}

/** Adds a colored picker without changing native date inputs or their form values. */
export function enhanceDateInputs(container, holidays = []) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const holidaySnapshot = holidays.map(holiday => ({ date: holiday.date, name: holiday.name }));
  const fields = [];
  let active = null;
  let popup = null;
  let currentMonth = '';
  let focusDate = '';
  let closed = false;

  function closePicker(restoreFocus = false) {
    const previous = active;
    popup?.remove();
    popup = null;
    active = null;
    previous?.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previous?.input.isConnected) previous.input.focus({ preventScroll: true });
  }

  function isAllowed(date, input = active.input) {
    return ISO_DATE.test(date) && Number(date.slice(0, 4)) >= 1 && (!input.min || date >= input.min) && (!input.max || date <= input.max);
  }

  function positionPicker() {
    if (!popup || !active) return;
    const anchor = active.wrapper.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = Math.max(edge, Math.min(anchor.left, win.innerWidth - width - edge));
    const below = anchor.bottom + gap;
    const top = below + height <= win.innerHeight - edge ? below : Math.max(edge, anchor.top - height - gap);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.maxHeight = `${Math.max(80, win.innerHeight - top - edge)}px`;
  }

  function choose(date) {
    if (date && !isAllowed(date)) return;
    const input = active.input;
    input.value = date;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    closePicker(true);
  }

  function renderPicker(shouldFocus = true) {
    if (!active || !popup) return;
    const input = active.input;
    const today = localToday();
    const cells = calendarCells(currentMonth, holidaySnapshot);
    const monthIndex = Number(currentMonth.slice(5, 7)) - 1;
    const year = Number(currentMonth.slice(0, 4));
    const fullDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
    popup.innerHTML = `<div class="date-picker-header"><button type="button" class="date-picker-nav" data-date-action="previous" aria-label="Önceki ay" ${year === 1 && monthIndex === 0 ? 'disabled' : ''}>‹</button><div class="date-picker-period"><select class="date-picker-month" aria-label="Ay">${MONTHS.map((name, index) => `<option value="${index + 1}" ${index === monthIndex ? 'selected' : ''}>${name}</option>`).join('')}</select><input class="date-picker-year" type="number" aria-label="Yıl" min="1" max="9999" step="1" value="${year}"></div><button type="button" class="date-picker-nav" data-date-action="next" aria-label="Sonraki ay" ${year === 9999 && monthIndex === 11 ? 'disabled' : ''}>›</button><button type="button" class="date-picker-close" data-date-action="close" aria-label="Takvimi kapat">×</button></div><p class="date-picker-live" aria-live="polite">${MONTHS[monthIndex]} ${year}</p><table class="date-picker-grid" role="grid" aria-label="${MONTHS[monthIndex]} ${year}"><thead><tr>${WEEKDAYS.map((day, index) => `<th scope="col" class="${index >= 4 ? 'date-picker-weekend-label' : ''}">${day}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 6 }, (_, row) => `<tr>${cells.slice(row * 7, row * 7 + 7).map(cell => {
      const selected = cell.date === input.value;
      const title = `${fullDate.format(dateAtNoon(cell.date))}${cell.holidayNames.length ? ` · ${cell.holidayNames.join(', ')}` : ''}`;
      return `<td role="gridcell" aria-selected="${selected}"><button type="button" class="date-picker-day date-picker-${cell.kind}${cell.inMonth ? '' : ' date-picker-other-month'}${selected ? ' date-picker-selected' : ''}${cell.date === today ? ' date-picker-today' : ''}" data-date="${cell.date}" aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}" ${cell.date === today ? 'aria-current="date"' : ''} ${isAllowed(cell.date) ? '' : 'disabled'} tabindex="-1">${cell.day}${cell.holidayNames.length ? '<span class="date-picker-holiday-dot" aria-hidden="true"></span>' : ''}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table><div class="date-picker-legend"><span><i class="date-picker-weekend-key"></i>Cuma–Pazar</span><span><i class="date-picker-holiday-key"></i>Resmî tatil</span></div><div class="date-picker-footer"><button type="button" data-date-action="today" ${isAllowed(today) ? '' : 'disabled'}>Bugün</button>${input.required ? '' : '<button type="button" data-date-action="clear">Temizle</button>'}</div>`;
    const eligible = [...popup.querySelectorAll('[data-date]:not(:disabled)')];
    const button = eligible.find(button => button.dataset.date === focusDate)
      ?? eligible.find(button => button.dataset.date === input.value)
      ?? eligible.find(button => button.dataset.date === today && button.dataset.date.startsWith(currentMonth))
      ?? eligible.find(button => button.dataset.date.startsWith(currentMonth))
      ?? eligible[0];
    if (button) {
      button.tabIndex = 0;
      focusDate = button.dataset.date;
      if (shouldFocus) button.focus({ preventScroll: true });
    }
    positionPicker();
  }

  function changeMonth(offset) {
    const next = monthNumber(currentMonth) + offset;
    if (next < 12 || next > 9999 * 12 + 11) return;
    currentMonth = monthFromNumber(next);
    focusDate = `${currentMonth}-01`;
    renderPicker();
  }

  function onPickerClick(event) {
    const button = event.target.closest('button');
    if (!button || !popup.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.date) { choose(button.dataset.date); return; }
    switch (button.dataset.dateAction) {
      case 'previous': changeMonth(-1); break;
      case 'next': changeMonth(1); break;
      case 'today': choose(localToday()); break;
      case 'clear': choose(''); break;
      case 'close': closePicker(true); break;
    }
  }

  function onPickerChange(event) {
    if (!event.target.matches('.date-picker-month,.date-picker-year')) return;
    const year = Number(popup.querySelector('.date-picker-year').value);
    const month = Number(popup.querySelector('.date-picker-month').value);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      event.target.reportValidity();
      return;
    }
    currentMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    focusDate = `${currentMonth}-01`;
    renderPicker();
  }

  function openPicker(field) {
    if (active === field) { closePicker(true); return; }
    closePicker();
    active = field;
    field.button.setAttribute('aria-expanded', 'true');
    const inputMonth = field.input.value.slice(0, 7);
    currentMonth = ISO_MONTH.test(inputMonth) && Number(inputMonth.slice(0, 4)) >= 1 ? inputMonth : localToday().slice(0, 7);
    focusDate = field.input.value;
    popup = doc.createElement('div');
    popup.className = 'date-picker';
    popup.id = field.pickerId;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Tarih seçimi');
    popup.addEventListener('click', onPickerClick);
    popup.addEventListener('change', onPickerChange);
    container.append(popup);
    renderPicker();
  }

  function onOutsidePointer(event) {
    if (popup && !popup.contains(event.target) && !active.wrapper.contains(event.target)) closePicker();
  }

  function onKeyDown(event) {
    if (!popup) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePicker(true);
      return;
    }
    if (!event.target.matches('[data-date]') || !popup.contains(event.target)) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (Object.hasOwn(offsets, event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const next = dateAtNoon(event.target.dataset.date);
      next.setUTCDate(next.getUTCDate() + offsets[event.key]);
      const nextDate = dateISO(next);
      if (!isAllowed(nextDate)) return;
      focusDate = nextDate;
      currentMonth = nextDate.slice(0, 7);
      renderPicker();
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      changeMonth(event.key === 'PageUp' ? -1 : 1);
    }
  }

  for (const input of container.querySelectorAll('input[type="date"]')) {
    if (input.disabled || input.readOnly || input.closest('.date-field')) continue;
    const label = [...(input.labels ?? [])].map(label => label.textContent.trim()).join(' ') || input.getAttribute('aria-label') || 'Tarih';
    const wrapper = doc.createElement('span');
    wrapper.className = 'date-field';
    input.before(wrapper);
    wrapper.append(input);
    const button = doc.createElement('button');
    const pickerId = `colored-date-picker-${++pickerSequence}`;
    button.type = 'button';
    button.className = 'date-field-trigger';
    button.setAttribute('aria-label', `${label}: takvimi aç`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', pickerId);
    button.title = 'Renkli takvimi aç';
    button.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18M7 15h2m3 0h2m3 0h1M7 18h2m3 0h2"/></svg>';
    wrapper.append(button);
    const field = { input, wrapper, button, pickerId };
    const onClick = event => { event.preventDefault(); event.stopPropagation(); openPicker(field); };
    button.addEventListener('click', onClick);
    fields.push({ ...field, onClick });
  }

  doc.addEventListener('pointerdown', onOutsidePointer, true);
  doc.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('resize', positionPicker);
  container.addEventListener('scroll', positionPicker, true);
  return function cleanup() {
    if (closed) return;
    closed = true;
    closePicker();
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('resize', positionPicker);
    container.removeEventListener('scroll', positionPicker, true);
    for (const { input, wrapper, button, onClick } of fields) {
      button.removeEventListener('click', onClick);
      if (input.parentNode === wrapper) wrapper.replaceWith(input);
      else wrapper.remove();
    }
  };
}
