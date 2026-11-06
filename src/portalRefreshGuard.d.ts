export interface PortalRefreshContext {
  accessMode: string; role: string; hydrated: boolean; revision: string | null;
  payload: string; savedPayload: string; editVersion: number; visible: boolean;
  saving: boolean; dutyPlannerOpen: boolean; ownersEditMode: boolean; plannerEditing: boolean; bulkBusy: boolean; libraryBusy: boolean;
}
export function canStartPortalRefresh(context: PortalRefreshContext): boolean;
export function canAdoptPortalRefresh(start: PortalRefreshContext, current: PortalRefreshContext): boolean;
