export interface PersonGroupHistory { from: string; groupId: string }
export interface PersonHistoryView { groupId?: string; groupHistory?: PersonGroupHistory[] }
export interface PersonRankSyncWarning { code: string; message: string; personId?: string }
export function personGroupId(person: PersonHistoryView | null | undefined, month: string): string | undefined;
export function personAtMonth<T extends PersonHistoryView>(person: T, month: string): T;
export function synchronizePersonRanks<T>(state: T, portalPlannerState: unknown, options: { fromMonth: string; currentMonth: string }): { state: T; changed: boolean; warnings: PersonRankSyncWarning[] };
