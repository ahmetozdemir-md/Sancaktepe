/** Shared gate for published-list refreshes. A pending local edit always wins over an idle read. */
export function canStartPortalRefresh(context) {
  return Boolean(context.accessMode) && context.visible !== false
    && !context.saving && !context.dutyPlannerOpen && !context.ownersEditMode
    && !context.plannerEditing && !context.bulkBusy && !context.libraryBusy
    && !(context.hydrated && (context.role === 'admin' || !context.role && context.accessMode === 'admin') && context.payload !== context.savedPayload);
}
export function canAdoptPortalRefresh(start, current) {
  return canStartPortalRefresh(current) && start.accessMode === current.accessMode
    && start.editVersion === current.editVersion && start.revision === current.revision
    && (!start.hydrated || start.payload === current.payload);
}
