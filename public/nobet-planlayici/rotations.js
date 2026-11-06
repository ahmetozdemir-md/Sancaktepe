/** A post-call rotation has no hospital; it is not leave or a duty exemption. */
export const POST_CALL_UNIT = 'Nöbet ertesi';
export const POST_CALL_OPTION = '__post_call__';

const normalize = value => String(value ?? '').trim().replace(/\s+/gu, ' ')
  .toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/gu, 'i');

export const isPostCallUnit = value => normalize(value) === 'nobet ertesi';
export const isPostCallRotation = record => record?.site === null && record.unit === POST_CALL_UNIT;
export const rotationLabel = record => isPostCallRotation(record) ? POST_CALL_UNIT : record?.site || 'Rotasyon girilmedi';
export const rotationColorKey = record => isPostCallRotation(record) ? 'post-call' : record?.site || '';
