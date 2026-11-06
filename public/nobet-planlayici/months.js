/** Remove a planning month and its duties while retaining the reusable source records. */
export function removeMonth(state, month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-')) {
    throw new RangeError('Geçerli bir planlama ayı seçilmelidir.');
  }
  if (!state || !state.months || typeof state.months !== 'object' || Array.isArray(state.months) || !Array.isArray(state.assignments)) {
    throw new TypeError('Planlama ayları veya nöbet kayıtları hatalı.');
  }
  if (!Object.hasOwn(state.months, month)) throw new RangeError('Silinecek planlama ayı bulunamadı.');

  const assignments = state.assignments.filter(row => typeof row?.date !== 'string' || !row.date.startsWith(`${month}-`));
  const removedAssignments = state.assignments.length - assignments.length;
  delete state.months[month];
  state.assignments = assignments;
  return { removedAssignments };
}
