export interface PublicationIssue { code: string; message: string; date?: string; personId?: string }
export interface PublishedDuty { name: string; site: 'Sancaktepe' | 'Feriha Öz' | 'Çekmeköy' }
export interface PublicationDraft {
  people: Array<{ id: string; name: string; groupId: string; groupHistory?: Array<{ from: string; groupId: string }>; rosterHistory?: Array<{ from: string; enabled: boolean }>; sourceAssistantId?: string; portalAssistantId?: string; from: string; until?: string | null; [key: string]: unknown }>;
  groups: Array<{ id: string; from: string; until?: string | null; rankHistory?: Array<{ from: string; rank: number }>; [key: string]: unknown }>;
  assignments: Array<{ id?: string; personId: string; date: string; site: string; overrides?: unknown[] }>;
  absences?: Array<{ personId: string; start: string; end: string; type: string }>;
}
export interface PublicationPortal {
  assistants: string[];
  assistantRanks?: Record<string, number>;
  dutyRoster: Record<string, PublishedDuty[]>;
  manualAssignments: Record<string, Record<string, string[]>>;
  locations: Array<{ id: string; kind: string; name?: string; site?: string; activeFrom?: string; activeUntil?: string | null }>;
}
export interface RemovedRoomAssignment {
  date: string; dutyDate: string; name: string; locationId: string; locationName: string; site: string;
}
export interface PlannerRoomChange {
  id: string; month: string; date: string; dutyDate: string; name: string; locationId: string; site: string;
  roomBefore: string[]; dayAfter: Record<string, string[]>; invalidatedAt?: string | null; restoredAt?: string | null;
}
export interface RestorableRoomAssignment extends RemovedRoomAssignment { id: string }
export interface PublicationPreview {
  month: string; count: number; changedDays: string[]; addedCount: number; removedCount: number;
  removedRoomAssignments: RemovedRoomAssignment[];
  restorableRoomAssignments: RestorableRoomAssignment[]; restoredRoomAssignments: RestorableRoomAssignment[];
  roomChangesSnapshot: PlannerRoomChange[]; restoreRoomChangeIds: string[]; recoverySignature: string;
  warnings: PublicationIssue[]; errors: PublicationIssue[]; canPublish: boolean; hasChanges: boolean;
  monthRoster: Record<string, PublishedDuty[]>;
  nextDutyRoster: Record<string, PublishedDuty[]>;
  nextManualAssignments: Record<string, Record<string, string[]>>;
  portalSignature: string;
  draftSignature: string;
  draftSnapshot: PublicationDraft | null;
}
export function normalizePublicationName(value: unknown): string;
export function createPublicationPreview(draft: PublicationDraft, portal: PublicationPortal, month: string, options?: { warnings?: PublicationIssue[]; roomChanges?: PlannerRoomChange[]; restoreRoomChangeIds?: string[] }): PublicationPreview;
export function applyPublication<T extends PublicationPortal>(portal: T, preview: PublicationPreview, currentDraft?: PublicationDraft | null): T;

export function getRestorableRoomAssignments(portal: PublicationPortal, nextDutyRoster: Record<string, PublishedDuty[]>, month: string, roomChanges?: PlannerRoomChange[], draft?: PublicationDraft | null): RestorableRoomAssignment[];
